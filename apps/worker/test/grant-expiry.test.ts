// The grant-expiry job of step 2.4 (08 section 4, 07 section 7, AC-10.4, AC-10.5) against a fresh test
// database: a grant past its expiry becomes expired with its records deleted in the same transaction
// and the expiry logged with metadata only; a grant not yet due, one without expiry and a revoked one
// are left as they are.
import { accessLog, disclosures, grants, invites, manifests, orgs, users } from "@sotto/db";
import { createTestDatabase, type TestDatabase } from "@sotto/db/testing";
import { getAddressDecoder } from "@solana/kit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { grantExpiryJob } from "../src/jobs/grant-expiry.ts";

const randomAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));
const context = () => ({ signal: new AbortController().signal, log: () => undefined });

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database?.drop();
});

async function setUp() {
  const [owner] = await database.db
    .insert(users)
    .values({ wallet: randomAddress() })
    .returning({ id: users.id, wallet: users.wallet });
  const [viewer] = await database.db
    .insert(users)
    .values({ wallet: randomAddress() })
    .returning({ id: users.id });
  if (!owner || !viewer) throw new Error("users not inserted");
  const [org] = await database.db
    .insert(orgs)
    .values({
      displayName: "Northwind",
      legalName: "Northwind Labs Ltd",
      country: "TR",
      registrationNo: "0001",
      website: "https://northwind.example",
      contactEmail: "ops@northwind.example",
      ownerUserId: owner.id,
      status: "active",
    })
    .returning({ id: orgs.id });
  if (!org) throw new Error("org not inserted");
  const [manifest] = await database.db
    .insert(manifests)
    .values({
      orgId: org.id,
      signerWallet: owner.wallet,
      manifest: {},
      signature: Buffer.alloc(64, 1),
    })
    .returning({ id: manifests.id });
  if (!manifest) throw new Error("manifest not inserted");
  const grant = async (expiresAt: Date | null, status: "active" | "revoked" = "active") => {
    const token = crypto.randomUUID().replaceAll("-", "").padEnd(64, "0");
    await database.db.insert(invites).values({
      token,
      orgId: org.id,
      role: "accountant",
      createdBy: owner.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const [row] = await database.db
      .insert(grants)
      .values({
        orgId: org.id,
        viewerUserId: viewer.id,
        inviteToken: token,
        scope: "all_payments",
        expiresAt,
        status,
        createdBy: owner.id,
        holderName: "Daniel Osei",
      })
      .returning({ id: grants.id });
    if (!row) throw new Error("grant not inserted");
    await database.db.insert(disclosures).values({
      orgId: org.id,
      grantId: row.id,
      viewerUserId: viewer.id,
      kind: "payment",
      subject: crypto.randomUUID(),
      ciphertext: Buffer.alloc(96, 2),
      manifestId: manifest.id,
    });
    return row.id;
  };
  return { orgId: org.id, grant };
}

const statusOf = async (id: string) =>
  (await database.db.select().from(grants).where(eq(grants.id, id)))[0]?.status;
const itemsOf = async (id: string) =>
  (await database.db.select().from(disclosures).where(eq(disclosures.grantId, id))).length;

describe("grant-expiry job", () => {
  it("AC-10.4 AC-10.5 expires a grant past its expiry, deletes its records and logs it, and leaves the rest", async () => {
    const { orgId, grant } = await setUp();
    const past = await grant(new Date(Date.now() - 60_000));
    const future = await grant(new Date(Date.now() + 86_400_000));
    const never = await grant(null);
    const revoked = await grant(new Date(Date.now() - 60_000), "revoked");
    const result = await grantExpiryJob({ db: database.db }).run(context());
    expect(result).toEqual({ expired: 1, deleted: 1 });
    expect(await statusOf(past)).toBe("expired");
    expect(await itemsOf(past)).toBe(0);
    for (const kept of [future, never]) {
      expect(await statusOf(kept)).toBe("active");
      expect(await itemsOf(kept)).toBe(1);
    }
    expect(await statusOf(revoked)).toBe("revoked");
    const events = await database.db.select().from(accessLog).where(eq(accessLog.orgId, orgId));
    expect(events).toMatchObject([
      {
        action: "grant_expired",
        subjectType: "grant",
        subjectId: past,
        actorUserId: null,
        metadata: { deleted: 1, scope: "all_payments" },
      },
    ]);
    // A second run finds nothing more to do.
    expect(await grantExpiryJob({ db: database.db }).run(context())).toEqual({
      expired: 0,
      deleted: 0,
    });
  });
});
