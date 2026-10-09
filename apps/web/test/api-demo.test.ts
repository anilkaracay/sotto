// The demo company's server side (step 4.6, D-32; the founder's constraints of 2026-10-09) against a
// test database holding a seeded demo company:
// 1. Only derived viewing keys are published, labelled as devnet demo keys; no wallet signature and
//    no key that signs. Each role's view opens with that role's key and with no other.
// 2. A demo request is refused by every route but the demo's own: every write, grant, revocation,
//    payment, proof, export, faucet and admin call, with or without a session cookie.
// 4. The keys and views exist for the one organization of the demo file on the devnet configuration,
//    and are refused for any other organization or configuration.
// And the views are read only in the database itself: a write inside one fails.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accessLog, disclosures, grants, orgs, sessions } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { openPayload } from "@sotto/sdk/disclosure/seal";
import { viewingKeyFromSecret, viewKeyMessage } from "@sotto/sdk/keys";
import { getBase58Decoder } from "@solana/kit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getKeys } from "../app/api/demo/keys/route.ts";
import { GET as getView } from "../app/api/demo/views/[role]/route.ts";
import { ledgerRows } from "../lib/books.ts";
import { openDisclosures } from "../lib/client/disclosures.ts";
import { payslipsOf } from "../lib/pay.ts";
import { serverCluster } from "../lib/server/cluster.ts";
import {
  DEMO_HEADER,
  DEMO_KEYS_LABEL,
  demoRoleView,
  loadDemoCompany,
  readOnly,
  type DemoAccountantView,
  type DemoCompareView,
  type DemoEmployeeView,
  type DemoFile,
  type DemoKeysView,
  type DemoOutsiderView,
  type DemoOwnerView,
} from "../lib/server/demo.ts";
import { createSession, SESSION_COOKIE } from "../lib/server/session.ts";
import {
  APP_ORIGIN,
  apiRequest,
  SESSION_SECRET,
  setUpApiTest,
  tearDownApiTest,
} from "./helpers/api.ts";
import { seedDemoCompany, type DemoFixture } from "./helpers/demo-company.ts";

let test: TestDatabase;
let demo: DemoFixture;
let folder: string;
let ip = 0;

function useFile(contents: unknown): void {
  const path = join(folder, `demo-${(ip += 1)}.json`);
  writeFileSync(path, typeof contents === "string" ? contents : JSON.stringify(contents));
  vi.stubEnv("DEMO_COMPANY_FILE", path);
}

beforeAll(async () => {
  test = await setUpApiTest();
  folder = mkdtempSync(join(tmpdir(), "sotto-demo-"));
  demo = await seedDemoCompany(test.db);
});

afterAll(async () => {
  rmSync(folder, { recursive: true, force: true });
  await tearDownApiTest(test);
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_CLUSTER", "devnet");
  useFile(demo.file);
});

/** A request as the demo's pages send it: the demo header, no cookie unless one is given. */
function demoRequest(path: string, method = "GET", cookie: string | null = null): Request {
  ip += 1;
  return apiRequest(path, {
    method,
    ...(method === "GET" ? {} : { body: "{}" }),
    headers: {
      origin: APP_ORIGIN,
      [DEMO_HEADER]: "1",
      "x-forwarded-for": `198.18.${Math.floor(ip / 250) % 250}.${ip % 250}`,
      ...(method === "GET" ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
  });
}

const keys = async () => {
  const response = await getKeys(demoRequest("/api/demo/keys"));
  return { status: response.status, body: (await response.json()) as DemoKeysView };
};
async function view<T>(role: string): Promise<{ status: number; view: T; text: string }> {
  const response = await getView(demoRequest(`/api/demo/views/${role}`), {
    params: Promise.resolve({ role }),
  });
  const text = await response.text();
  return { status: response.status, view: (JSON.parse(text) as { view: T }).view, text };
}
const unavailable = async () => {
  const [k, v] = [
    await getKeys(demoRequest("/api/demo/keys")),
    await getView(demoRequest("/api/demo/views/owner"), {
      params: Promise.resolve({ role: "owner" }),
    }),
  ];
  return [k, v].map((response) => response.status);
};

/** Opens a role's records the way the demo's browser does: manifests first, then the role's key. */
async function opened(
  role: "owner" | "accountant" | "employee",
  input: { viewerUserId: string; sealed: DemoOwnerView["sealed"]; ownerWallet: string },
  withKeyOf = role,
) {
  const key = await viewingKeyFromSecret(
    new Uint8Array(Buffer.from(demo.file.roles[withKeyOf].viewingKey, "base64")),
  );
  return openDisclosures({
    orgId: demo.orgId,
    ownerWallet: input.ownerWallet,
    viewerUserId: input.viewerUserId,
    items: input.sealed.items,
    manifests: input.sealed.manifests,
    open: (ciphertext) => openPayload(ciphertext, key),
  });
}
const payloads = (records: Awaited<ReturnType<typeof opened>>) =>
  records.flatMap((record) => (record.state === "opened" ? [record.payload] : []));

describe("the demo company's published keys (constraint 1)", () => {
  it("are derived viewing keys only, labelled as devnet demo keys, and nothing that signs", async () => {
    const { status, body } = await keys();
    expect(status).toBe(200);
    expect(body.label).toBe(DEMO_KEYS_LABEL);
    expect(body.label).toContain("Devnet demo keys");
    expect(body.label).toContain("cannot sign, spend, seal or revoke");
    expect(body.cluster).toBe("devnet");
    expect(body.org).toEqual({ id: demo.orgId, legalName: "Northwind Labs Demo Ltd" });
    expect(Object.keys(body.keys).sort()).toEqual(["accountant", "employee", "owner"]);
    const people = {
      owner: demo.keys.elif,
      accountant: demo.keys.daniel,
      employee: demo.keys.maya,
    };
    const everything = JSON.stringify(body);
    for (const role of ["owner", "accountant", "employee"] as const) {
      const entry = body.keys[role];
      expect(Object.keys(entry).sort()).toEqual(["registeredKey", "viewingKey", "wallet"]);
      expect(entry.wallet).toBe(people[role].wallet);
      // The key is the viewing key the wallet registered: 32 bytes whose public key is on record.
      const pair = await viewingKeyFromSecret(
        new Uint8Array(Buffer.from(entry.viewingKey, "base64")),
      );
      expect(Buffer.from(pair.publicKey).toString("base64")).toBe(entry.registeredKey);
      // No wallet signature is published: not the viewing key message's, in any encoding.
      const signature = await people[role].sign(viewKeyMessage(people[role].wallet));
      for (const encoded of [
        Buffer.from(signature).toString("base64"),
        Buffer.from(signature).toString("hex"),
        getBase58Decoder().decode(signature),
      ]) {
        expect(everything).not.toContain(encoded);
      }
    }
    // Nor a wallet's secret key: the fixture's wallets come from these seeds.
    for (const name of ["elif", "daniel", "maya"]) {
      const seed = createHash("sha256").update(`sotto-demo-fixture/a/${name}`).digest();
      expect(everything).not.toContain(seed.toString("base64"));
      expect(everything).not.toContain(seed.toString("hex"));
    }
  });

  it("each role's view opens with that role's key and with no other role's", async () => {
    const owner = (await view<DemoOwnerView>("owner")).view;
    const accountant = (await view<DemoAccountantView>("accountant")).view;
    const employee = (await view<DemoEmployeeView>("employee")).view;

    // The owner: every payment and the balance snapshot, from the owner's own records.
    const own = payloads(await opened("owner", owner));
    expect(
      own
        .filter((p) => p.kind !== "balance_snapshot")
        .map((p) => p.amount)
        .sort(),
    ).toEqual(["12750000000", "48200000000", "7150000000", "9400000000"].sort());
    const snapshot = own.find((p) => p.kind === "balance_snapshot");
    expect(snapshot).toMatchObject({
      amount: demo.snapshot.available,
      pending: "0",
      subject: demo.snapshot.day,
      currency: "devUSD",
    });
    expect(owner.payments).toHaveLength(4);
    expect(owner.grants.map((grant) => grant.holder.name)).toContain("Daniel Osei");
    expect(owner.proofs).toEqual([
      expect.objectContaining({ recordAddress: demo.proofRecord, threshold: "250000000000" }),
    ]);

    // The accountant: the ledger of the granted period, through the app's own ledger function.
    const ledger = ledgerRows(
      payloads(await opened("accountant", accountant)),
      accountant.books.payments,
    );
    expect(ledger.map((row) => `${row.counterparty} ${row.amount}`).sort()).toEqual([
      "Atlas Freight 48200000000",
      "Halden OTC 12750000000",
      "Jonas Weber 7150000000",
      "Maya Chen 9400000000",
    ]);
    expect(accountant.books.grants).toEqual([expect.objectContaining({ scope: "period" })]);

    // The employee: her own payslip and nothing else.
    const slips = payslipsOf(payloads(await opened("employee", employee)), employee.pay);
    expect(slips).toHaveLength(1);
    expect(slips[0]).toMatchObject({
      net: 9_400_000_000n,
      gross: 12_400_000_000n,
      tax: 3_000_000_000n,
      signature: demo.paid.mayaLine.signature,
    });
    expect(employee.sealed.items.map((item) => item.subject)).toEqual([demo.paid.mayaLine.id]);

    // No key opens another role's records.
    for (const record of await opened("owner", owner, "accountant")) {
      expect(record.state).toBe("unreadable");
    }
    for (const record of await opened("accountant", accountant, "employee")) {
      expect(record.state).toBe("unreadable");
    }
    for (const record of await opened("employee", employee, "accountant")) {
      expect(record.state).toBe("unreadable");
    }
  });

  it("gives the outsider no key and no sealed record: only what the chain shows", async () => {
    const { view: outsider, text } = await view<DemoOutsiderView>("outsider");
    expect(outsider.role).toBe("outsider");
    expect(text).not.toContain("ciphertext");
    expect(text).not.toContain("viewingKey");
    const transfers = outsider.chain.filter((row) => row.type === "transfer_out");
    expect(transfers).toHaveLength(4);
    for (const row of transfers) expect(row.publicAmount).toBeNull();
    // The one amount the chain shows is the deposit's, which is public onchain.
    expect(outsider.chain.find((row) => row.type === "deposit")?.publicAmount).toBe(
      "1500000000000",
    );
    expect(outsider.proofs.map((proof) => proof.recordAddress)).toEqual([demo.proofRecord]);
    // Who a proof was made for is not onchain, so it is not in the outsider's view.
    expect(outsider.proofs[0]?.counterpartyLabel).toBeNull();
    expect(text).not.toContain("Atlas Freight");
    for (const amount of ["48200000000", "12750000000", "9400000000", demo.snapshot.available]) {
      expect(text).not.toContain(amount);
    }
  });

  it("compares one payment from every role's own view (constraint 7)", async () => {
    const compare = (await view<DemoCompareView>("compare")).view;
    expect(compare.paymentId).toBe(demo.paid.atlas.id);
    expect(compare.recipient).toBe("Atlas Freight");
    const open = async (role: "owner" | "accountant", side: DemoCompareView["owner"]) =>
      payloads(
        await opened(role, {
          viewerUserId: side.viewerUserId,
          ownerWallet: compare.ownerWallet,
          sealed: { items: side.item ? [side.item] : [], manifests: side.manifests },
        }),
      );
    expect(await open("owner", compare.owner)).toEqual([
      expect.objectContaining({ amount: "48200000000", counterparty: "Atlas Freight" }),
    ]);
    expect(await open("accountant", compare.accountant)).toEqual([
      expect.objectContaining({ amount: "48200000000", memo: "Freight, invoice 2291" }),
    ]);
    expect(compare.accountant.grant).toMatchObject({ scope: "period" });
    // The employee's view holds her payslip and not this payment.
    expect(compare.employee).toMatchObject({ item: null, manifests: [], records: 1 });
    // The outsider's side is the chain's: the transfer, its accounts and time, and no amount.
    expect(compare.outsider).toMatchObject({
      signature: demo.paid.atlas.signature,
      from: demo.orgAccount,
      to: demo.paid.atlas.to,
    });
    expect(compare.outsider.chain).toMatchObject({ type: "transfer_out", publicAmount: null });
  });
});

describe("the demo company is scoped to one organization on devnet (constraint 4)", () => {
  it("is refused on any other configuration", async () => {
    for (const cluster of ["localnet", "mainnet"]) {
      vi.stubEnv("NEXT_PUBLIC_CLUSTER", cluster);
      expect(await unavailable()).toEqual([404, 404]);
    }
    vi.stubEnv("NEXT_PUBLIC_CLUSTER", "devnet");
    expect(await unavailable()).toEqual([200, 200]);
    // Without the file, with one that cannot be read, or with one for another cluster.
    vi.stubEnv("DEMO_COMPANY_FILE", "");
    expect(await unavailable()).toEqual([404, 404]);
    vi.stubEnv("DEMO_COMPANY_FILE", join(folder, "missing.json"));
    expect(await unavailable()).toEqual([404, 404]);
    useFile("{ not json");
    expect(await unavailable()).toEqual([404, 404]);
    useFile({ ...demo.file, cluster: "localnet" });
    expect(await unavailable()).toEqual([404, 404]);
    useFile({ ...demo.file, extra: true });
    expect(await unavailable()).toEqual([404, 404]);
  });

  it("is refused for any other organization, and serves nothing of one", async () => {
    // Another company, whose accountant is the same demo wallet with records of its own there.
    const other = await seedDemoCompany(test.db, "b");
    await test.db.insert((await import("@sotto/db")).memberships).values({
      orgId: other.orgId,
      userId: demo.ids.daniel,
      role: "accountant",
    });
    // The demo's keys for another organization: its owner is not the file's owner.
    const file: DemoFile = { ...demo.file, orgId: other.orgId };
    useFile(file);
    expect(await unavailable()).toEqual([404, 404]);
    // The other company's own people with the demo's organization: not its owner, not its members.
    useFile({ ...other.file, orgId: demo.orgId });
    expect(await unavailable()).toEqual([404, 404]);
    useFile({
      ...demo.file,
      roles: { ...demo.file.roles, accountant: other.file.roles.accountant },
    });
    expect(await unavailable()).toEqual([404, 404]);
    // An organization that is not active.
    await test.db.update(orgs).set({ status: "suspended" }).where(eq(orgs.id, other.orgId));
    useFile(other.file);
    expect(await unavailable()).toEqual([404, 404]);

    // Back on the demo's own file: nothing of the other organization is in any view.
    useFile(demo.file);
    for (const role of ["owner", "accountant", "employee", "outsider", "compare"]) {
      const { status, text } = await view<unknown>(role);
      expect(status).toBe(200);
      expect(text).not.toContain(other.orgId);
      expect(text).not.toContain(other.wallets.elif);
      expect(text).not.toContain(other.paid.atlas.signature);
    }
    expect((await view<unknown>("admin")).status).toBe(404);
  });
});

describe("the demo company's views write nothing", () => {
  it("run in a read only transaction: a write inside one fails in the database", async () => {
    await expect(
      readOnly(test.db, (tx) =>
        tx.update(grants).set({ lastUsedAt: new Date() }).where(eq(grants.id, demo.grantId)),
      ),
    ).rejects.toThrow();
    await expect(
      readOnly(test.db, (tx) => tx.delete(disclosures).where(eq(disclosures.orgId, demo.orgId))),
    ).rejects.toMatchObject({ cause: { code: "25006" } });
    // Reading in one works.
    const cluster = await serverCluster();
    const company = await loadDemoCompany(test.db, cluster);
    if (!company || !cluster) throw new Error("the demo company is configured");
    expect((await demoRoleView(test.db, company, "accountant", cluster)).role).toBe("accountant");
  });

  it("leave the grant's last use, the sessions and the access log as they were", async () => {
    const count = async () => ({
      sessions: (await test.db.select().from(sessions)).length,
      accessLog: (await test.db.select().from(accessLog)).length,
      disclosures: (await test.db.select().from(disclosures)).length,
    });
    const before = await count();
    for (const role of ["owner", "accountant", "employee", "outsider", "compare"]) {
      expect((await view<unknown>(role)).status).toBe(200);
    }
    expect((await keys()).status).toBe(200);
    expect(await count()).toEqual(before);
    const [grant] = await test.db.select().from(grants).where(eq(grants.id, demo.grantId));
    expect(grant?.lastUsedAt).toBeNull();
    expect(grant?.status).toBe("active");
  });
});

describe("a demo request is refused by every route but the demo's own (constraint 2)", () => {
  const modules = (
    import.meta as unknown as {
      glob: (pattern: string) => Record<string, () => Promise<Record<string, unknown>>>;
    }
  ).glob("../app/api/**/route.ts");
  const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
  const ID = "3f1b6a2e-5c4d-4e8f-9a0b-1c2d3e4f5a6b";
  const anyParams = () => ({
    params: Promise.resolve(
      new Proxy({} as Record<string, string>, {
        get: (_, name) => (name === "then" ? undefined : ID),
      }),
    ),
  });
  type Handler = (request: Request, context: ReturnType<typeof anyParams>) => Promise<Response>;

  it("refuses every write, grant, revocation, payment, proof, export, faucet and admin call, with or without a session", async () => {
    const { token } = await createSession(test.db, demo.ids.elif, SESSION_SECRET);
    const ownerCookie = `${SESSION_COOKIE}=${token}`;
    const called: string[] = [];
    for (const [file, load] of Object.entries(modules)) {
      const path = file
        .replace("../app", "")
        .replace("/route.ts", "")
        .replace(/\[[a-z]+\]/g, ID);
      const exported = await load();
      for (const method of METHODS) {
        const handler = exported[method] as Handler | undefined;
        if (!handler) continue;
        const name = `${method} ${file.replace("../app", "").replace("/route.ts", "")}`;
        if (path.startsWith("/api/demo/")) {
          // The demo's own routes read only: they export nothing but GET.
          expect(method, name).toBe("GET");
          continue;
        }
        // As a demo visitor, and as one whose browser also holds the owner's real session.
        for (const cookie of [null, ownerCookie]) {
          const response = await handler(demoRequest(path, method, cookie), anyParams());
          expect(response.status, name).toBe(403);
          expect(((await response.json()) as { error: { code: string } }).error.code, name).toBe(
            "demo_read_only",
          );
        }
        called.push(name);
      }
    }
    // The calls the founder named are among them, so an empty walk cannot pass.
    for (const expected of [
      "POST /api/orgs",
      "PATCH /api/orgs/[id]",
      "POST /api/orgs/[id]/grants",
      "POST /api/orgs/[id]/grants/[gid]/revoke",
      "POST /api/orgs/[id]/payments",
      "POST /api/orgs/[id]/payroll-runs",
      "POST /api/orgs/[id]/proofs",
      "POST /api/orgs/[id]/exports",
      "POST /api/orgs/[id]/disclosures",
      "PUT /api/orgs/[id]/reconciliations/[pid]",
      "POST /api/orgs/[id]/faucet",
      "POST /api/faucet/sol",
      "POST /api/admin/orgs/[id]/approve",
      "POST /api/admin/orgs/[id]/suspend",
      "POST /api/viewer-keys",
      "POST /api/rpc",
      "POST /api/auth/verify",
      "GET /api/orgs/[id]/disclosures",
      "GET /api/me",
    ]) {
      expect(called, expected).toContain(expected);
    }
    expect(called.length).toBeGreaterThan(50);
    // The owner's session itself still works without the demo's header: the refusal is the header's.
    const me = (await import("../app/api/me/route.ts")).GET as Handler;
    expect(
      (await me(apiRequest("/api/me", { headers: { cookie: ownerCookie } }), anyParams())).status,
    ).toBe(200);
  });

  it("a demo route refuses anything but a read", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await getKeys(demoRequest("/api/demo/keys", method));
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        "demo_read_only",
      );
    }
  });
});
