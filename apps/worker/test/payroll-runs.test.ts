// The payroll-runs job of step 2.3 (08 section 4, AC-08.2) against a fresh test database: a run whose
// every line settled becomes settled, a run whose page went away with nothing in flight for ten
// minutes becomes partially settled or not paid, and a run still sending, or whose owner may still be
// over a wallet prompt, is left alone.
import { orgs, paymentAttempts, payments, payrollRuns, recipients, users } from "@sotto/db";
import { createTestDatabase, type TestDatabase } from "@sotto/db/testing";
import { getAddressDecoder, getBase58Decoder } from "@solana/kit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { payrollRunsJob } from "../src/jobs/payroll-runs.ts";

const randomAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));
const randomSignature = () => getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(64)));

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database?.drop();
});

const context = () => ({ signal: new AbortController().signal, log: () => undefined });

type LineState = {
  status: "authorized" | "executing" | "settled" | "failed" | "failed_clean";
  attempt?: {
    status: "sent" | "confirmed" | "finalized" | "failed" | "failed_clean";
    minutesAgo: number;
  };
};

/** A run of an active org with lines in the given states. */
async function runWith(status: "executing" | "partially_settled" | "approved", lines: LineState[]) {
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
  const [run] = await database.db
    .insert(payrollRuns)
    .values({
      orgId: org.id,
      title: "October payroll",
      period: "2026-10",
      idempotencyKey: crypto.randomUUID(),
      lineCount: lines.length,
      createdBy: user.id,
      status,
    })
    .returning({ id: payrollRuns.id });
  if (!run) throw new Error("run not inserted");
  for (const [index, line] of lines.entries()) {
    const [recipient] = await database.db
      .insert(recipients)
      .values({ orgId: org.id, displayName: `Person ${index}`, wallet: randomAddress() })
      .returning({ id: recipients.id });
    if (!recipient) throw new Error("recipient not inserted");
    const [payment] = await database.db
      .insert(payments)
      .values({
        orgId: org.id,
        kind: "payroll_line",
        runId: run.id,
        lineNo: index + 1,
        recipientId: recipient.id,
        idempotencyKey: crypto.randomUUID(),
        createdBy: user.id,
        privateBlob: Buffer.alloc(96, 1),
        status: line.status,
      })
      .returning({ id: payments.id });
    if (!payment) throw new Error("line not inserted");
    if (line.attempt) {
      const signature = randomSignature();
      await database.db.insert(paymentAttempts).values({
        paymentId: payment.id,
        attemptNo: 1,
        signatures: [signature],
        status: line.attempt.status,
        transferSignature: signature,
        createdAt: new Date(Date.now() - line.attempt.minutesAgo * 60_000),
      });
    }
  }
  return run.id;
}

async function statusOf(runId: string) {
  const [run] = await database.db
    .select({ status: payrollRuns.status })
    .from(payrollRuns)
    .where(eq(payrollRuns.id, runId));
  return run?.status;
}

describe("payroll-runs job", () => {
  it("AC-08.2 settles a run once every line settled, and a resumed partially settled run too", async () => {
    const done = await runWith("executing", [
      { status: "settled", attempt: { status: "finalized", minutesAgo: 1 } },
      { status: "settled", attempt: { status: "finalized", minutesAgo: 1 } },
    ]);
    const resumed = await runWith("partially_settled", [
      { status: "settled", attempt: { status: "finalized", minutesAgo: 9 } },
    ]);
    const open = await runWith("executing", [
      { status: "settled", attempt: { status: "finalized", minutesAgo: 1 } },
      { status: "executing", attempt: { status: "confirmed", minutesAgo: 1 } },
    ]);
    await payrollRunsJob({ db: database.db }).run(context());
    expect(await statusOf(done)).toBe("settled");
    expect(await statusOf(resumed)).toBe("settled");
    expect(await statusOf(open)).toBe("executing");
  });

  it("AC-08.2 stops a run its page left, as partially settled when a line landed and not paid otherwise", async () => {
    const left = await runWith("executing", [
      { status: "settled", attempt: { status: "finalized", minutesAgo: 11 } },
      { status: "authorized" },
    ]);
    const nothing = await runWith("executing", [
      { status: "failed", attempt: { status: "failed", minutesAgo: 11 } },
      { status: "authorized" },
    ]);
    // Within ten minutes, or with a line in flight, the page may still be working (its owner may be
    // reading the next chunk's wallet prompt).
    const recent = await runWith("executing", [
      { status: "settled", attempt: { status: "finalized", minutesAgo: 6 } },
      { status: "authorized" },
    ]);
    const flying = await runWith("executing", [
      { status: "executing", attempt: { status: "sent", minutesAgo: 11 } },
      { status: "authorized" },
    ]);
    const approved = await runWith("approved", [{ status: "authorized" }]);
    const result = await payrollRunsJob({ db: database.db }).run(context());
    expect(result).toMatchObject({ stopped: 2 });
    expect(await statusOf(left)).toBe("partially_settled");
    expect(await statusOf(nothing)).toBe("failed");
    expect(await statusOf(recent)).toBe("executing");
    expect(await statusOf(flying)).toBe("executing");
    expect(await statusOf(approved)).toBe("approved");
  });
});
