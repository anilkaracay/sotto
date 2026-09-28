// The payment jobs of step 1.9 (08 section 4) against a fresh test database and RPC stand ins:
// confirm-executions settles a payment when its transfer transaction is finalized, fails an attempt
// whose transfer failed onchain or never landed within its blockhash window, still reads a transfer
// the page ended as failed_clean inside that window (I-7), and makes no RPC call with nothing to
// check; proof-program-health stores the verdict of the check per cluster and stores nothing when
// the RPC cannot be reached.
import { clusterHealth, orgs, paymentAttempts, payments, recipients, users } from "@sotto/db";
import { createTestDatabase, type TestDatabase } from "@sotto/db/testing";
import { GENESIS_HASHES } from "@sotto/sdk/cluster";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { getAddressDecoder, getBase58Decoder, type Address } from "@solana/kit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confirmExecutionsJob } from "../src/jobs/confirm-executions.ts";
import { proofProgramHealthJob } from "../src/jobs/proof-program-health.ts";

const randomAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));
const randomSignature = () => getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(64)));

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database?.drop();
});

const context = (lines: string[] = []) => ({
  signal: new AbortController().signal,
  log: (event: string) => void lines.push(event),
});

type Status = { err: unknown; confirmationStatus: "confirmed" | "finalized"; slot: bigint } | null;

function statusRpc(statuses: Map<string, Status>) {
  const calls = { statuses: 0 };
  const rpc = {
    getSignatureStatuses: (signatures: string[]) => ({
      send: async () => {
        calls.statuses += 1;
        return {
          context: { slot: 99n },
          value: signatures.map((signature) => {
            const status = statuses.get(signature) ?? null;
            return status ? { ...status, confirmations: null } : null;
          }),
        };
      },
    }),
  };
  return { rpc: rpc as unknown as SolanaRpc, calls };
}

async function paymentWithAttempt(input: {
  paymentStatus: "executing" | "failed_clean";
  attemptStatus: "sent" | "failed_clean";
  startedMinutesAgo?: number;
}) {
  const [user] = await database.db
    .insert(users)
    .values({ wallet: randomAddress() })
    .returning({ id: users.id });
  if (!user) throw new Error("user not inserted");
  const [org] = await database.db
    .insert(orgs)
    .values({
      displayName: "Northwind",
      legalName: "Northwind Labs Ltd",
      country: "TR",
      registrationNo: "0001",
      website: "https://northwind.example",
      contactEmail: "ops@northwind.example",
      ownerUserId: user.id,
      status: "active",
    })
    .returning({ id: orgs.id });
  if (!org) throw new Error("org not inserted");
  const [recipient] = await database.db
    .insert(recipients)
    .values({ orgId: org.id, displayName: "Maya", wallet: randomAddress() })
    .returning({ id: recipients.id });
  if (!recipient) throw new Error("recipient not inserted");
  const [payment] = await database.db
    .insert(payments)
    .values({
      orgId: org.id,
      kind: "single",
      recipientId: recipient.id,
      idempotencyKey: crypto.randomUUID(),
      createdBy: user.id,
      privateBlob: Buffer.alloc(96, 1),
      status: input.paymentStatus,
    })
    .returning({ id: payments.id });
  if (!payment) throw new Error("payment not inserted");
  const proof = randomSignature();
  const transfer = randomSignature();
  await database.db.insert(paymentAttempts).values({
    paymentId: payment.id,
    attemptNo: 1,
    signatures: [proof, transfer],
    status: input.attemptStatus,
    transferSignature: transfer,
    createdAt: new Date(Date.now() - (input.startedMinutesAgo ?? 0) * 60_000),
  });
  return { paymentId: payment.id, signatures: [proof, transfer], transfer };
}

async function stateOf(paymentId: string) {
  const [payment] = await database.db.select().from(payments).where(eq(payments.id, paymentId));
  const [attempt] = await database.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.paymentId, paymentId));
  return { payment, attempt };
}

describe("confirm-executions job", () => {
  it("makes no RPC call with nothing to check", async () => {
    const { rpc, calls } = statusRpc(new Map());
    expect(await confirmExecutionsJob({ db: database.db, rpc }).run(context())).toEqual({
      checked: 0,
      settled: 0,
    });
    expect(calls.statuses).toBe(0);
  });

  it("AC-06.4 settles a payment when the transfer is finalized, and fails attempts that failed onchain or never landed", async () => {
    const good = await paymentWithAttempt({ paymentStatus: "executing", attemptStatus: "sent" });
    const bad = await paymentWithAttempt({ paymentStatus: "executing", attemptStatus: "sent" });
    const lost = await paymentWithAttempt({
      paymentStatus: "executing",
      attemptStatus: "sent",
      startedMinutesAgo: 4,
    });
    const pending = await paymentWithAttempt({ paymentStatus: "executing", attemptStatus: "sent" });
    const statuses = new Map<string, Status>([
      [good.transfer, { err: null, confirmationStatus: "finalized", slot: 1234n }],
      [
        bad.transfer,
        {
          err: { InstructionError: [0, { Custom: 1 }] },
          confirmationStatus: "confirmed",
          slot: 1235n,
        },
      ],
      [pending.transfer, { err: null, confirmationStatus: "confirmed", slot: 1236n }],
    ]);
    const { rpc } = statusRpc(statuses);
    const job = confirmExecutionsJob({ db: database.db, rpc });
    expect(await job.run(context())).toEqual({ checked: 4, settled: 1, failed: 2 });

    const settled = await stateOf(good.paymentId);
    expect(settled.payment).toMatchObject({
      status: "settled",
      settledSlot: 1234n,
      signatures: good.signatures,
    });
    expect(settled.attempt?.status).toBe("finalized");
    const failed = await stateOf(bad.paymentId);
    expect(failed.payment?.status).toBe("failed");
    expect(failed.attempt?.errorCode).toMatch(/^onchain:/);
    const expired = await stateOf(lost.paymentId);
    expect(expired.attempt).toMatchObject({ status: "failed", errorCode: "transfer_not_found" });
    expect((await stateOf(pending.paymentId)).attempt?.status).toBe("confirmed");

    // The next pass reads only the one still in flight, which is now finalized.
    statuses.set(pending.transfer, { err: null, confirmationStatus: "finalized", slot: 1240n });
    expect(await job.run(context())).toEqual({ checked: 1, settled: 1, failed: 0 });
  });

  it("I-7 settles a transfer that landed after the page ended the attempt as failed_clean", async () => {
    const late = await paymentWithAttempt({
      paymentStatus: "failed_clean",
      attemptStatus: "failed_clean",
    });
    const { rpc } = statusRpc(
      new Map([[late.transfer, { err: null, confirmationStatus: "finalized", slot: 77n }]]),
    );
    await confirmExecutionsJob({ db: database.db, rpc }).run(context());
    expect((await stateOf(late.paymentId)).payment).toMatchObject({
      status: "settled",
      settledSlot: 77n,
    });
    // Outside the landing window a failed_clean attempt is not read again.
    const old = await paymentWithAttempt({
      paymentStatus: "failed_clean",
      attemptStatus: "failed_clean",
      startedMinutesAgo: 10,
    });
    const quiet = statusRpc(new Map());
    await confirmExecutionsJob({ db: database.db, rpc: quiet.rpc }).run(context());
    expect((await stateOf(old.paymentId)).payment?.status).toBe("failed_clean");
  });
});

describe("proof-program-health job", () => {
  const genesis = (hash: string) =>
    ({ getGenesisHash: () => ({ send: async () => hash }) }) as unknown as SolanaRpc;
  const feePayer = randomAddress() as Address;

  it("F-19 stores the verdict of the check per cluster", async () => {
    const lines: string[] = [];
    const failing = proofProgramHealthJob({
      db: database.db,
      rpc: genesis(GENESIS_HASHES.devnet),
      feePayer,
      check: async () => ({
        ok: false,
        reason: '{"InstructionError":[0,"InvalidInstructionData"]}',
      }),
    });
    expect(await failing.run(context(lines))).toEqual({
      checked: true,
      cluster: "devnet",
      ok: false,
    });
    expect(lines).toContain("proof_program_unavailable");
    const [stored] = await database.db
      .select()
      .from(clusterHealth)
      .where(eq(clusterHealth.cluster, "devnet"));
    expect(stored).toMatchObject({ proofProgramOk: false });
    expect(stored?.detail).toContain("InvalidInstructionData");

    const passing = proofProgramHealthJob({
      db: database.db,
      rpc: genesis(GENESIS_HASHES.devnet),
      feePayer,
      check: async () => ({ ok: true }),
    });
    await passing.run(context());
    const [after] = await database.db
      .select()
      .from(clusterHealth)
      .where(eq(clusterHealth.cluster, "devnet"));
    expect(after).toMatchObject({ proofProgramOk: true, detail: null });

    // A local ledger's genesis hash is recorded as localnet.
    const local = proofProgramHealthJob({
      db: database.db,
      rpc: genesis("LocalLedgerGenesis1111111111111111111111111"),
      feePayer,
      check: async () => ({ ok: true }),
    });
    expect(await local.run(context())).toMatchObject({ cluster: "localnet" });
  });

  it("stores nothing when the RPC cannot be reached", async () => {
    const lines: string[] = [];
    const down = {
      getGenesisHash: () => ({
        send: async () => {
          throw new Error("fetch failed");
        },
      }),
    } as unknown as SolanaRpc;
    const before = await database.db.select().from(clusterHealth);
    const job = proofProgramHealthJob({ db: database.db, rpc: down, feePayer });
    expect(await job.run(context(lines))).toEqual({ checked: false });
    expect(lines).toContain("proof_program_check_unreachable");
    expect(await database.db.select().from(clusterHealth)).toEqual(before);
  });
});
