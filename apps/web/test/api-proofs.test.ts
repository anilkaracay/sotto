// Proofs of funds on the server (F-13, step 2.8) against a test database and an RPC stand in that
// serves records, the program's config and SAS attestations as the chain holds them:
// - AC-13.1: the owner records a proof its tab wrote; the server checks it against the chain (the
//   owner's wallet, the cluster's program and wrapped mint) and the counterparty hash, stores
//   the label and salt, and logs proof_issued without an amount; anyone else, another org's record
//   and a label or salt that does not match are refused; the list shows each record's state now.
// - AC-13.3: the public view needs no sign in and reads the record, the pause flag and the
//   organization's legal name from its attestation from chain; the database adds only the
//   label; expired, paused, closed, never written and foreign accounts each say so.
import { accessLog, orgs, proofRecords } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { attestationAddress } from "@sotto/sdk/attestation";
import { getClusterConfig, type AvailableClusterConfig } from "@sotto/sdk/cluster";
import { counterpartyHash, getConfigEncoder, getProofRecordEncoder } from "@sotto/sdk/proofs";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBase64Decoder,
  type Address,
} from "@solana/kit";
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

const devnet = getClusterConfig("devnet") as AvailableClusterConfig;
const PROGRAM = devnet.sottoProofs?.program as Address;
const CONFIG = devnet.sottoProofs?.config as Address;
const WUSDC = devnet.wrappedUsdcMint as Address;
const DAY = 24 * 60 * 60;

/** The accounts the stand in serves, and addresses that have a transaction history. */
const chain = new Map<string, { owner: string; data: Uint8Array }>();
const history = new Set<string>();

const accountValue = (target: string) => {
  const account = chain.get(target);
  return account
    ? {
        data: [getBase64Decoder().decode(account.data), "base64"],
        executable: false,
        lamports: 1_000_000n,
        owner: account.owner,
        space: BigInt(account.data.length),
        rentEpoch: 0n,
      }
    : null;
};

vi.mock("../lib/server/chain.ts", () => ({
  serverRpc: () => ({
    getAccountInfo: (target: string) => ({
      send: async () => ({ context: { slot: 1n }, value: accountValue(target) }),
    }),
    getMultipleAccounts: (targets: string[]) => ({
      send: async () => ({ context: { slot: 1n }, value: targets.map(accountValue) }),
    }),
    getSignaturesForAddress: (target: string) => ({
      send: async () =>
        history.has(target) ? [{ signature: "5".repeat(88), slot: 1n, err: null }] : [],
    }),
  }),
}));

const { GET: listRoute, POST: recordRoute } = await import("../app/api/orgs/[id]/proofs/route.ts");
const { GET: publicRoute } = await import("../app/api/public/proofs/[address]/route.ts");

let test: TestDatabase;
const params = (values: Record<string, string>) => ({ params: Promise.resolve(values) });
const randomAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

beforeAll(async () => {
  test = await setUpApiTest();
});

afterAll(async () => {
  await tearDownApiTest(test);
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  chain.set(CONFIG, {
    owner: PROGRAM,
    data: new Uint8Array(
      getConfigEncoder().encode({
        version: 1,
        admin: randomAddress(),
        wrappedUsdcMint: WUSDC,
        paused: false,
        bump: 253,
      }),
    ),
  });
});

/** A record owned by `owner` written now, valid for `days`, with the hash of `salt` and `label`. */
async function writeRecord(input: {
  owner: string;
  label: string;
  salt: Uint8Array;
  days?: number;
  threshold?: bigint;
  mint?: Address;
}): Promise<Address> {
  const record = randomAddress();
  const now = Math.floor(Date.now() / 1000);
  chain.set(record, {
    owner: PROGRAM,
    data: new Uint8Array(
      getProofRecordEncoder().encode({
        version: 1,
        tokenAccount: randomAddress(),
        owner: address(input.owner),
        mint: input.mint ?? WUSDC,
        threshold: input.threshold ?? 100_000_000_000n,
        slot: 505_000_000n,
        unixTime: BigInt(now - 60),
        expiry: BigInt(now + (input.days ?? 30) * DAY),
        balanceCiphertextHash: new Uint8Array(32).fill(3),
        counterpartyHash: await counterpartyHash(input.salt, input.label),
        bump: 255,
      }),
    ),
  });
  history.add(record);
  return record;
}

/** The org's SAS attestation (facts E4, E5) at the PDA of the owner's wallet, as the worker issues it. */
async function attest(owner: string, legalName: string, expiry: bigint): Promise<void> {
  const text = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    return [...new Uint8Array(new Uint32Array([bytes.length]).buffer), ...bytes];
  };
  const i64 = (value: bigint) => [...new Uint8Array(new BigInt64Array([value]).buffer)];
  const data = [...text("org"), ...text(legalName), ...text("TR"), ...i64(1_790_000_000n), 1];
  const key = (value: string) => [...getAddressEncoder().encode(address(value))];
  const bytes = [
    2,
    ...key(owner),
    ...key(devnet.sasCredential as string),
    ...key(devnet.sasBusinessSchema as string),
    ...new Uint8Array(new Uint32Array([data.length]).buffer),
    ...data,
    ...key(randomAddress()),
    ...i64(expiry),
    ...key("11111111111111111111111111111111"),
  ];
  chain.set(
    await attestationAddress({
      sasProgram: devnet.programs.sas,
      credential: devnet.sasCredential as Address,
      schema: devnet.sasBusinessSchema as Address,
      nonce: address(owner),
    }),
    { owner: devnet.programs.sas, data: Uint8Array.from(bytes) },
  );
}

async function publicView(target: string) {
  const response = await publicRoute(
    jsonRequest(`/api/public/proofs/${target}`, "GET", null),
    params({ address: target }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

describe("proofs of funds (F-13)", () => {
  it("AC-13.1 records the owner's proof after checking it against the chain and the counterparty hash", async () => {
    const owner = await createKeyUser(test);
    const orgId = await createOrgWithStatus(test, owner.userId, "active");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const record = await writeRecord({ owner: owner.wallet, label: "Hollis Supply Co.", salt });
    const post = (cookie: string, body: Record<string, unknown>) =>
      recordRoute(
        jsonRequest(`/api/orgs/${orgId}/proofs`, "POST", cookie, body),
        params({ id: orgId }),
      );

    // Another label, another salt, another org's record and a stranger are refused.
    expect(
      await errorOf(
        await post(owner.cookie, {
          recordAddress: record,
          counterpartyLabel: "Northbank",
          counterpartySalt: b64(salt),
        }),
      ),
    ).toMatchObject({ code: "counterparty_hash_mismatch" });
    expect(
      await errorOf(
        await post(owner.cookie, {
          recordAddress: record,
          counterpartyLabel: "Hollis Supply Co.",
          counterpartySalt: b64(new Uint8Array(16)),
        }),
      ),
    ).toMatchObject({ code: "counterparty_hash_mismatch" });
    const other = await createKeyUser(test);
    const foreign = await writeRecord({ owner: other.wallet, label: "Hollis Supply Co.", salt });
    expect(
      await errorOf(
        await post(owner.cookie, {
          recordAddress: foreign,
          counterpartyLabel: "Hollis Supply Co.",
          counterpartySalt: b64(salt),
        }),
      ),
    ).toMatchObject({ code: "proof_record_not_yours" });
    const otherMint = await writeRecord({
      owner: owner.wallet,
      label: "Hollis Supply Co.",
      salt,
      mint: randomAddress(),
    });
    expect(
      await errorOf(
        await post(owner.cookie, {
          recordAddress: otherMint,
          counterpartyLabel: "Hollis Supply Co.",
          counterpartySalt: b64(salt),
        }),
      ),
    ).toMatchObject({ code: "proof_record_not_yours" });
    expect(
      await errorOf(
        await post(owner.cookie, {
          recordAddress: randomAddress(),
          counterpartyLabel: "Hollis Supply Co.",
          counterpartySalt: b64(salt),
        }),
      ),
    ).toMatchObject({ code: "proof_record_not_found" });
    expect(
      await errorOf(
        await post(other.cookie, {
          recordAddress: record,
          counterpartyLabel: "Hollis Supply Co.",
          counterpartySalt: b64(salt),
        }),
      ),
    ).toMatchObject({ code: "forbidden" });

    // The matching label and salt: stored once, logged without an amount.
    for (let i = 0; i < 2; i++) {
      const response = await post(owner.cookie, {
        recordAddress: record,
        counterpartyLabel: "Hollis Supply Co.",
        counterpartySalt: b64(salt),
      });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        proof: {
          recordAddress: record,
          threshold: "100000000000",
          counterpartyLabel: "Hollis Supply Co.",
          state: "valid",
        },
      });
    }
    const rows = await test.db.select().from(proofRecords).where(eq(proofRecords.orgId, orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      cluster: "devnet",
      recordAddress: record,
      thresholdBaseUnits: 100_000_000_000n,
      counterpartyLabel: "Hollis Supply Co.",
    });
    expect(Buffer.from(rows[0]?.counterpartySalt ?? []).equals(Buffer.from(salt))).toBe(true);
    const events = await test.db.select().from(accessLog).where(eq(accessLog.orgId, orgId));
    expect(events.map((event) => [event.action, event.subjectType, event.subjectId])).toEqual([
      ["proof_issued", "proof", record],
    ]);
    expect(JSON.stringify(events[0]?.metadata)).not.toMatch(/100000|threshold|amount/);
  });

  it("AC-13.1 lists the issued proofs with each record's state from chain now", async () => {
    const owner = await createKeyUser(test);
    const orgId = await createOrgWithStatus(test, owner.userId, "active");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const valid = await writeRecord({ owner: owner.wallet, label: "Lender", salt });
    const closed = await writeRecord({ owner: owner.wallet, label: "Supplier", salt });
    for (const record of [valid, closed]) {
      const response = await recordRoute(
        jsonRequest(`/api/orgs/${orgId}/proofs`, "POST", owner.cookie, {
          recordAddress: record,
          counterpartyLabel: record === valid ? "Lender" : "Supplier",
          counterpartySalt: b64(salt),
        }),
        params({ id: orgId }),
      );
      expect(response.status).toBe(201);
    }
    chain.delete(closed);
    // An expired one, as stored after its expiry passed.
    await test.db
      .update(proofRecords)
      .set({ expiry: new Date(Date.now() - 1000) })
      .where(eq(proofRecords.recordAddress, valid));
    const response = await listRoute(
      jsonRequest(`/api/orgs/${orgId}/proofs`, "GET", owner.cookie),
      params({ id: orgId }),
    );
    const body = (await response.json()) as { proofs: { recordAddress: string; state: string }[] };
    expect(
      Object.fromEntries(body.proofs.map((proof) => [proof.recordAddress, proof.state])),
    ).toEqual({ [valid]: "expired", [closed]: "closed" });
  });

  it("AC-13.3 shows the public view from chain without a sign in, the legal name from the attestation and the label from Sotto", async () => {
    const owner = await createKeyUser(test);
    const orgId = await createOrgWithStatus(test, owner.userId, "active");
    await attest(
      owner.wallet,
      "Northwind Labs Ltd",
      BigInt(Math.floor(Date.now() / 1000) + 300 * DAY),
    );
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const record = await writeRecord({ owner: owner.wallet, label: "Hollis Supply Co.", salt });
    await test.db.insert(proofRecords).values({
      orgId,
      cluster: "devnet",
      recordAddress: record,
      thresholdBaseUnits: 100_000_000_000n,
      counterpartyLabel: "Hollis Supply Co.",
      counterpartySalt: Buffer.from(salt),
      expiry: new Date(Date.now() + DAY * 1000),
    });
    const view = await publicView(record);
    expect(view).toMatchObject({
      state: "found",
      status: "valid",
      organization: { status: "verified", legalName: "Northwind Labs Ltd", country: "TR" },
      counterpartyLabel: "Hollis Supply Co.",
      balanceDisclosed: "none",
      record: {
        address: record,
        owner: owner.wallet,
        threshold: "100000000000",
        slot: "505000000",
      },
    });

    // The legal name comes from chain: renaming the org in Sotto changes nothing on the page.
    await test.db.update(orgs).set({ legalName: "Renamed In Sotto" }).where(eq(orgs.id, orgId));
    expect(await publicView(record)).toMatchObject({
      organization: { legalName: "Northwind Labs Ltd" },
    });

    // Paused program, expired record, expired attestation, no attestation.
    chain.set(CONFIG, {
      owner: PROGRAM,
      data: new Uint8Array(
        getConfigEncoder().encode({
          version: 1,
          admin: randomAddress(),
          wrappedUsdcMint: WUSDC,
          paused: true,
          bump: 253,
        }),
      ),
    });
    expect(await publicView(record)).toMatchObject({ state: "found", status: "paused" });
    chain.delete(CONFIG);
    expect(await publicView(record)).toMatchObject({ status: "paused" });
  });

  it("AC-13.3 says when a record expired, was closed, was never written or is not a record", async () => {
    const owner = await createKeyUser(test);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const expired = await writeRecord({ owner: owner.wallet, label: "Lender", salt, days: -1 });
    expect(await publicView(expired)).toMatchObject({
      state: "found",
      status: "expired",
      organization: { status: "not_verified" },
      counterpartyLabel: null,
    });
    await attest(owner.wallet, "Old Name Ltd", BigInt(Math.floor(Date.now() / 1000) - DAY));
    expect(await publicView(expired)).toMatchObject({
      organization: { status: "attestation_expired", legalName: "Old Name Ltd" },
    });
    const closed = await writeRecord({ owner: owner.wallet, label: "Lender", salt });
    chain.delete(closed);
    expect(await publicView(closed)).toEqual({ state: "closed", address: closed });
    const never = randomAddress();
    expect(await publicView(never)).toEqual({ state: "not_found", address: never });
    expect(await publicView("not-an-address")).toEqual({
      state: "not_found",
      address: "not-an-address",
    });
    const foreign = randomAddress();
    chain.set(foreign, { owner: randomAddress(), data: new Uint8Array(194) });
    expect(await publicView(foreign)).toEqual({ state: "not_a_record", address: foreign });
  });
});
