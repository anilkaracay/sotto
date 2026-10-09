// Recipients (F-07, 08 section 3; step 1.8): add with a sealed private blob and readiness from chain
// (AC-07.1, AC-07.2), list, update, delete, check readiness again, and the money gate of AC-02.2. The
// chain is a stand in for the server's RPC that serves encoded Token-2022 accounts.
import { memberships, recipients } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { getClusterConfig } from "@sotto/sdk/cluster";
import { associatedTokenAccount } from "@sotto/sdk/confidential/public";
import { confidentialTokenAccount, encodeToken2022Account } from "@sotto/sdk/testing";
import { address, getAddressDecoder, getBase64Decoder, type Address } from "@solana/kit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createKeyUser,
  createOrgWithStatus,
  errorOf,
  jsonRequest,
  setUpApiTest,
  tearDownApiTest,
} from "./helpers/api.ts";

const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const devnet = getClusterConfig("devnet");
const WUSDC = (devnet.available ? devnet.wrappedUsdcMint : null) as Address;
const WDEVUSD = (
  devnet.available ? devnet.assets.find((asset) => asset.id === "devusd")?.wrappedMint : null
) as Address;
const ELGAMAL = address("BxMVLbjVntF9DJtDjfpQLrgw4hopedMgNkZZKGcVkZp6");
const BLOB = Buffer.alloc(80, 7).toString("base64");

const chain = new Map<string, Uint8Array>();
let chainDown = false;

vi.mock("../lib/server/chain.ts", () => ({
  serverRpc: () => ({
    getAccountInfo: (target: string) => ({
      send: async () => {
        if (chainDown) throw new Error("the network is down");
        const data = chain.get(target);
        return {
          context: { slot: 7n },
          value: data
            ? {
                data: [getBase64Decoder().decode(data), "base64"],
                executable: false,
                lamports: 2_039_280n,
                owner: TOKEN_2022,
                space: BigInt(data.length),
                rentEpoch: 0n,
              }
            : null,
        };
      },
    }),
  }),
}));

const { GET, POST } = await import("../app/api/orgs/[id]/recipients/route.ts");
const quickStart = await import("../app/api/orgs/quick-start/route.ts");
const { DEMO_RECIPIENT } = await import("../lib/demo.ts");
const one = await import("../app/api/orgs/[id]/recipients/[rid]/route.ts");
const readiness = await import("../app/api/orgs/[id]/recipients/[rid]/readiness/route.ts");

let test: TestDatabase;

beforeAll(async () => {
  test = await setUpApiTest();
});

afterAll(async () => {
  await tearDownApiTest(test);
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_CLUSTER", "devnet");
  chainDown = false;
});

const randomAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));

/** A wallet whose associated wUSDC account is configured for confidential payments onchain. */
async function readyWallet(): Promise<string> {
  const wallet = randomAddress();
  const ata = await associatedTokenAccount(wallet, WUSDC);
  chain.set(
    ata,
    encodeToken2022Account(
      confidentialTokenAccount({ owner: wallet, mint: WUSDC, elgamalPubkey: ELGAMAL }),
    ),
  );
  return wallet;
}

async function owner(status: "pending_review" | "active" | "suspended" = "active") {
  const user = await createKeyUser(test);
  return { ...user, orgId: await createOrgWithStatus(test, user.userId, status) };
}

const params = (id: string, rid?: string) => ({
  params: Promise.resolve(rid ? { id, rid } : { id }),
});
const list = (cookie: string | null, orgId: string) =>
  GET(jsonRequest(`/api/orgs/${orgId}/recipients`, "GET", cookie), params(orgId));
const add = (cookie: string | null, orgId: string, body: unknown) =>
  POST(jsonRequest(`/api/orgs/${orgId}/recipients`, "POST", cookie, body), params(orgId));

describe("recipients", () => {
  it("AC-07.1 AC-07.2 adds recipients with a sealed private blob and their readiness from chain", async () => {
    const me = await owner();
    const ready = await readyWallet();
    const created = await add(me.cookie, me.orgId, {
      displayName: "Maya Chen",
      roleTitle: "Design lead",
      team: "Design",
      country: "GB",
      wallet: ready,
      privateBlob: BLOB,
    });
    expect(created.status).toBe(201);
    const { recipient } = (await created.json()) as { recipient: Record<string, unknown> };
    expect(recipient).toMatchObject({
      displayName: "Maya Chen",
      roleTitle: "Design lead",
      team: "Design",
      country: "GB",
      wallet: ready,
      joined: false,
      readiness: "ready",
      privateBlob: BLOB,
      invite: { status: "none", expiresAt: null },
    });
    expect(recipient.readinessCheckedAt).toEqual(expect.any(String));

    const fresh = await add(me.cookie, me.orgId, {
      displayName: "Idris Kaya",
      wallet: randomAddress(),
    });
    expect(((await fresh.json()) as { recipient: { readiness: string } }).recipient.readiness).toBe(
      "no_account",
    );
    const listed = (await (await list(me.cookie, me.orgId)).json()) as {
      recipients: { displayName: string }[];
    };
    expect(listed.recipients.map((row) => row.displayName)).toEqual(["Idris Kaya", "Maya Chen"]);
    // The server stores the sealed blob as it came; it holds no amount.
    const [row] = await test.db.select().from(recipients).where(eq(recipients.wallet, ready));
    expect(Buffer.from(row?.privateBlob ?? []).toString("base64")).toBe(BLOB);
  });

  it("updates fields but not the wallet, and removes only recipients who have not joined", async () => {
    const me = await owner();
    const created = await add(me.cookie, me.orgId, {
      displayName: "Lucia Ortega",
      wallet: randomAddress(),
    });
    const { recipient } = (await created.json()) as { recipient: { id: string } };
    const patch = (body: unknown) =>
      one.PATCH(
        jsonRequest(`/api/orgs/${me.orgId}/recipients/${recipient.id}`, "PATCH", me.cookie, body),
        params(me.orgId, recipient.id),
      );
    const updated = await patch({ team: "Growth", privateBlob: BLOB, country: null });
    expect(
      ((await updated.json()) as { recipient: Record<string, unknown> }).recipient,
    ).toMatchObject({ team: "Growth", privateBlob: BLOB, country: null });
    expect((await patch({ wallet: randomAddress() })).status).toBe(400);

    const remove = (id: string) =>
      one.DELETE(
        jsonRequest(`/api/orgs/${me.orgId}/recipients/${id}`, "DELETE", me.cookie),
        params(me.orgId, id),
      );
    const joined = await add(me.cookie, me.orgId, {
      displayName: "Joined",
      wallet: randomAddress(),
    });
    const joinedId = ((await joined.json()) as { recipient: { id: string } }).recipient.id;
    await test.db.update(recipients).set({ userId: me.userId }).where(eq(recipients.id, joinedId));
    expect(await errorOf(await remove(joinedId))).toMatchObject({ code: "recipient_joined" });
    expect((await remove(recipient.id)).status).toBe(204);
    expect(await errorOf(await remove(recipient.id))).toMatchObject({
      code: "recipient_not_found",
    });
  });

  it("AC-07.2 reads readiness from chain again, and says when the chain cannot be read", async () => {
    const me = await owner();
    const wallet = randomAddress();
    const created = await add(me.cookie, me.orgId, { displayName: "Ana", wallet });
    const { recipient } = (await created.json()) as {
      recipient: { id: string; readiness: string };
    };
    expect(recipient.readiness).toBe("no_account");
    const check = () =>
      readiness.POST(
        jsonRequest(
          `/api/orgs/${me.orgId}/recipients/${recipient.id}/readiness`,
          "POST",
          me.cookie,
        ),
        params(me.orgId, recipient.id),
      );
    const ata = await associatedTokenAccount(wallet, WUSDC);
    chain.set(
      ata,
      encodeToken2022Account(
        confidentialTokenAccount({
          owner: wallet,
          mint: WUSDC,
          elgamalPubkey: ELGAMAL,
          confidential: false,
        }),
      ),
    );
    expect(
      ((await (await check()).json()) as { recipient: { readiness: string } }).recipient.readiness,
    ).toBe("not_configured");
    chain.set(
      ata,
      encodeToken2022Account(
        confidentialTokenAccount({ owner: wallet, mint: WUSDC, elgamalPubkey: ELGAMAL }),
      ),
    );
    expect(
      ((await (await check()).json()) as { recipient: { readiness: string } }).recipient.readiness,
    ).toBe("ready");
    chainDown = true;
    expect(await errorOf(await check())).toMatchObject({ code: "readiness_unavailable" });
  });

  it("validates the fields and refuses a wallet that is already a recipient", async () => {
    const me = await owner();
    const wallet = randomAddress();
    expect((await add(me.cookie, me.orgId, { displayName: "A", wallet })).status).toBe(201);
    expect(
      await errorOf(await add(me.cookie, me.orgId, { displayName: "B", wallet })),
    ).toMatchObject({
      code: "recipient_exists",
    });
    for (const body of [
      { displayName: "", wallet: randomAddress() },
      { displayName: "C", wallet: "not a wallet" },
      { displayName: "C", wallet: randomAddress(), country: "XX" },
      {
        displayName: "C",
        wallet: randomAddress(),
        privateBlob: Buffer.alloc(20).toString("base64"),
      },
      {
        displayName: "C",
        wallet: randomAddress(),
        privateBlob: Buffer.alloc(4096).toString("base64"),
      },
      { displayName: "C", wallet: randomAddress(), amount: "1000" },
      { displayName: "bad\u0007name", wallet: randomAddress() },
    ]) {
      const response = await add(me.cookie, me.orgId, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("AC-02.2 refuses non owners and organizations that are not verified, for every recipients endpoint", async () => {
    const active = await owner();
    const created = await add(active.cookie, active.orgId, {
      displayName: "R",
      wallet: randomAddress(),
    });
    const rid = ((await created.json()) as { recipient: { id: string } }).recipient.id;
    const endpoints = (cookie: string | null, orgId: string, id = rid) => [
      list(cookie, orgId),
      add(cookie, orgId, { displayName: "X", wallet: randomAddress() }),
      one.PATCH(
        jsonRequest(`/api/orgs/${orgId}/recipients/${id}`, "PATCH", cookie, { team: "X" }),
        params(orgId, id),
      ),
      one.DELETE(
        jsonRequest(`/api/orgs/${orgId}/recipients/${id}`, "DELETE", cookie),
        params(orgId, id),
      ),
      readiness.POST(
        jsonRequest(`/api/orgs/${orgId}/recipients/${id}/readiness`, "POST", cookie),
        params(orgId, id),
      ),
    ];
    const stranger = await createKeyUser(test);
    const member = await createKeyUser(test);
    await test.db
      .insert(memberships)
      .values({ orgId: active.orgId, userId: member.userId, role: "recipient" });
    for (const response of [
      ...(await Promise.all(endpoints(stranger.cookie, active.orgId))),
      ...(await Promise.all(endpoints(member.cookie, active.orgId))),
    ]) {
      expect(await errorOf(response)).toMatchObject({ code: "forbidden" });
    }
    for (const status of ["pending_review", "suspended"] as const) {
      const other = await owner(status);
      for (const response of await Promise.all(endpoints(other.cookie, other.orgId))) {
        expect(response.status).toBe(403);
        expect((await errorOf(response)).code).toBe("org_not_active");
      }
    }
    for (const response of await Promise.all(endpoints(null, active.orgId))) {
      expect(response.status).toBe(401);
    }
  });
});

describe("the demo recipient of a quick start company (step 4.8, D-34)", () => {
  const start = (cookie: string) =>
    quickStart.POST(jsonRequest("/api/orgs/quick-start", "POST", cookie, {}), {
      params: Promise.resolve({}),
    });
  const started = async (cookie: string) =>
    ((await (await start(cookie)).json()) as { org: { id: string; asset: string } }).org;
  const listed = async (cookie: string, orgId: string) =>
    ((await (await list(cookie, orgId)).json()) as { recipients: Record<string, unknown>[] })
      .recipients;
  /** Atlas Freight's wdevUSD account as devnet holds it: set up for confidential payments. */
  async function demoAccountOnChain() {
    const wallet = address(DEMO_RECIPIENT.wallet);
    chain.set(
      await associatedTokenAccount(wallet, WDEVUSD),
      encodeToken2022Account(
        confidentialTokenAccount({ owner: wallet, mint: WDEVUSD, elgamalPubkey: ELGAMAL }),
      ),
    );
  }

  it("a new company in the devnet test dollar starts with it, named as a demo recipient and ready from chain", async () => {
    await demoAccountOnChain();
    const user = await createKeyUser(test);
    const org = await started(user.cookie);
    expect(org.asset).toBe("devusd");
    const recipients = await listed(user.cookie, org.id);
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({
      displayName: "Atlas Freight (demo recipient)",
      roleTitle: "Demo wallet for test payments",
      wallet: "E6FbeoKRFNcCuSGkbn6QJgGzwoNYfDeHELJLS5BLLkDB",
      readiness: "ready",
      joined: false,
      // Nothing is sealed for it: the server holds no key to seal with.
      privateBlob: null,
      invite: { status: "none", expiresAt: null },
    });
    expect(recipients[0]?.readinessCheckedAt).not.toBeNull();
  });

  it("is removed like any recipient, and a second quick start does not bring it back", async () => {
    await demoAccountOnChain();
    const user = await createKeyUser(test);
    const org = await started(user.cookie);
    const [demo] = await listed(user.cookie, org.id);
    const id = demo?.id as string;
    // Renamed like any recipient.
    const renamed = await one.PATCH(
      jsonRequest(`/api/orgs/${org.id}/recipients/${id}`, "PATCH", user.cookie, {
        displayName: "Atlas Freight",
      }),
      params(org.id, id),
    );
    expect(renamed.status).toBe(200);
    const removed = await one.DELETE(
      jsonRequest(`/api/orgs/${org.id}/recipients/${id}`, "DELETE", user.cookie),
      params(org.id, id),
    );
    expect(removed.status).toBe(204);
    expect(await listed(user.cookie, org.id)).toEqual([]);
    expect((await started(user.cookie)).id).toBe(org.id);
    expect(await listed(user.cookie, org.id)).toEqual([]);
    // The owner adds the same wallet again by hand, like any wallet.
    const again = await add(user.cookie, org.id, {
      displayName: "Atlas Freight",
      wallet: DEMO_RECIPIENT.wallet,
    });
    expect(again.status).toBe(201);
  });

  it("is there without a readable chain, not checked yet, for the readiness job to fill in", async () => {
    chainDown = true;
    const user = await createKeyUser(test);
    const org = await started(user.cookie);
    const recipients = await listed(user.cookie, org.id);
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({
      displayName: DEMO_RECIPIENT.displayName,
      readiness: "no_account",
      readinessCheckedAt: null,
    });
  });

  it("belongs to quick start only: a company made by the form has none, and no other configuration starts one", async () => {
    const formed = await owner();
    expect(await listed(formed.cookie, formed.orgId)).toEqual([]);
    vi.stubEnv("NEXT_PUBLIC_CLUSTER", "localnet");
    const user = await createKeyUser(test);
    const refused = await start(user.cookie);
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).code).toBe("quick_start_devnet_only");
    expect(
      await test.db.select().from(recipients).where(eq(recipients.wallet, DEMO_RECIPIENT.wallet)),
    ).not.toContainEqual(expect.objectContaining({ orgId: formed.orgId }));
  });
});
