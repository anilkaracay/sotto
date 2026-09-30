// The proof of funds run in the tab (F-13, 06 section 8; step 2.8) with the wallet path, the proof
// account closes, the network and the API stood in: below the threshold it returns Not proven and
// signs, simulates and sends nothing (AC-13.2); a balance that changed between the proofs and the
// verification (CiphertextMismatch) closes the proof accounts, reads the account again and tries once
// more; a second change explains itself; a proven run closes the proof accounts (AC-13.4) and gives
// the server the label and the salt, which the verify instruction only carries as a hash (X-32).
import { getAddressEncoder, type Address } from "@solana/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const PROGRAM = "4rMKgJWgawaTTdUxaudUXthEExnRZ7AvFvqzsoEAr9jd" as Address;
const TOKEN = "DFqVbjLfr1edLKBrmGB6tATRc2vvEqdRr5DVubyhqGXf" as Address;
const RECORD = "EsVM5jHqyNVyVypQNRs3UFieQhJx1NBaF2idHHNxTGHy" as Address;
const OWNER = "E425As4SphdVfbkaF9h9V82NuraqufveTjF4xmZPuBPp" as Address;
const EQUALITY = "FNPNgqcJ3jk7ffAkQ9XVEjSpXmiXinV7TxYtxn7unYm6";
const RANGE = "4FBAEjmfPBjqYzzCbmWxQ3Z74Wps5gFhDD87vdrXESfV";

const calls = vi.hoisted(() => ({
  sent: [] as { programs: string[]; data: Uint8Array[] }[],
  closes: 0,
  api: [] as { path: string; body: unknown }[],
  /** How many verifications refuse with CiphertextMismatch before one passes. */
  mismatches: 0,
}));

vi.mock("../lib/client/rpc.ts", () => ({
  browserRpc: () => ({
    getMinimumBalanceForRentExemption: () => ({ send: async () => 1_000_000n }),
    getTransaction: () => ({ send: async () => ({ meta: { logMessages: [eventLine()] } }) }),
  }),
}));

vi.mock("../lib/client/api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/client/api.ts")>()),
  callApi: async (path: string, init: { body: unknown }) => {
    calls.api.push({ path, body: init.body });
    return {};
  },
}));

vi.mock("../lib/client/wallet-report.ts", () => ({ reportComparison: () => undefined }));

vi.mock("@sotto/sdk/tx", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sotto/sdk/tx")>()),
  sendWithWallet: async (options: {
    instructions: { programAddress: string; data: Uint8Array }[];
  }) => {
    calls.sent.push({
      programs: options.instructions.map((instruction) => instruction.programAddress),
      data: options.instructions.map((instruction) => instruction.data),
    });
    if (options.instructions[0]?.programAddress === PROGRAM && calls.mismatches > 0) {
      calls.mismatches -= 1;
      throw Object.assign(new Error("simulation failed"), {
        err: { InstructionError: [0, { Custom: 12 }] },
        decoded: { programAddress: PROGRAM },
      });
    }
    return { signature: "5".repeat(88) };
  },
}));

vi.mock("@sotto/sdk/confidential/public", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sotto/sdk/confidential/public")>()),
  associatedTokenAccount: async () => TOKEN,
  closeProofAccounts: async () => {
    calls.closes += 1;
    return { closed: [], signatures: [] };
  },
}));

vi.mock("@solana/kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@solana/kit")>()),
  fetchEncodedAccount: async () => ({ exists: true, data: new Uint8Array(8) }),
  fetchEncodedAccounts: async (_: unknown, addresses: string[]) =>
    addresses.map(() => ({ exists: false })),
}));

function eventLine(): string {
  const key = (value: Address) => Buffer.from(getAddressEncoder().encode(value)).toString("base64");
  const le = (value: bigint, signed = false) => {
    const bytes = Buffer.alloc(8);
    if (signed) bytes.writeBigInt64LE(value);
    else bytes.writeBigUInt64LE(value);
    return bytes.toString("base64");
  };
  return `Program data: ${[
    Buffer.from("ProofVerified").toString("base64"),
    key(RECORD),
    key(TOKEN),
    key(OWNER),
    le(10_000_000n),
    le(1431n),
    le(1_791_311_638n, true),
  ].join(" ")}`;
}

const { runProof } = await import("../app/app/[org]/proofs/proof-run.ts");
const { CryptoWorkerError } = await import("../lib/crypto-worker/client.ts");

function worker(options: { below?: boolean } = {}) {
  const counts = { proofs: 0, ended: 0 };
  const client = {
    decrypt: async () => ({ available: 20_000_000n, pending: 0n }),
    applyInstruction: async () => {
      throw new Error("no pending balance here");
    },
    balanceProofs: async () => {
      counts.proofs += 1;
      if (options.below) {
        throw new CryptoWorkerError("insufficient_balance", "below the threshold");
      }
      return {
        planId: `plan-${counts.proofs}`,
        transactions: [
          { role: "proof", instructions: [] },
          { role: "proof", instructions: [] },
          { role: "proof", instructions: [] },
        ],
        equalityContext: EQUALITY,
        rangeContext: RANGE,
        cleanup: [
          {
            programAddress: "x",
            accounts: [{ address: EQUALITY, role: 1 }],
            data: new Uint8Array(),
          },
        ],
        signers: [],
        availableBefore: 20_000_000n,
      };
    },
    cosign: async () => ({ signatures: {} }),
    endPlan: async () => {
      counts.ended += 1;
      return { ended: true };
    },
  };
  return { client, counts };
}

const connected = {
  signer: { address: OWNER, modifyAndSignTransactions: async () => [] },
  version: 1,
  info: { name: "Test Wallet" },
} as never;

const input = {
  orgId: "3f1b6a2e-5c4d-4e8f-9a0b-1c2d3e4f5a6b",
  threshold: 10_000_000n,
  label: "Harbor Bank",
  validityDays: 7,
  wrappedMint: "AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd",
  program: PROGRAM,
};

beforeEach(() => {
  calls.sent = [];
  calls.closes = 0;
  calls.api = [];
  calls.mismatches = 0;
});

describe("proof of funds run (06 section 8)", () => {
  it("AC-13.2 stops below the threshold with Not proven and sends nothing", async () => {
    const { client, counts } = worker({ below: true });
    const outcome = await runProof({
      input,
      connected,
      worker: () => client as never,
      onProgress: () => undefined,
    });
    expect(outcome).toEqual({ kind: "not_proven" });
    expect(counts.proofs).toBe(1);
    expect(calls.sent).toEqual([]);
    expect(calls.closes).toBe(0);
    expect(calls.api).toEqual([]);
  });

  it("AC-13.1 AC-13.4 proves, closes the proof accounts and gives Sotto the label and salt, never onchain", async () => {
    const { client, counts } = worker();
    const outcome = await runProof({
      input,
      connected,
      worker: () => client as never,
      onProgress: () => undefined,
    });
    expect(outcome).toMatchObject({
      kind: "proven",
      closed: true,
      stored: null,
      record: { address: RECORD, threshold: 10_000_000n, slot: 1431n, label: "Harbor Bank" },
    });
    // Three proof transactions, then the verification alone.
    expect(calls.sent.map((call) => call.programs)).toEqual([[], [], [], [PROGRAM]]);
    expect(calls.closes).toBe(1);
    expect(counts.ended).toBe(1);
    const body = calls.api[0]?.body as { counterpartyLabel: string; counterpartySalt: string };
    expect(calls.api[0]?.path).toBe(`/api/orgs/${input.orgId}/proofs`);
    expect(body.counterpartyLabel).toBe("Harbor Bank");
    expect(Buffer.from(body.counterpartySalt, "base64")).toHaveLength(16);
    // The verify instruction carries neither the label nor the salt, only their hash (X-32).
    const verify = Buffer.from(calls.sent[3]?.data[0] ?? []);
    expect(verify).toHaveLength(65);
    expect(verify.includes(Buffer.from("Harbor Bank"))).toBe(false);
    expect(verify.includes(Buffer.from(body.counterpartySalt, "base64"))).toBe(false);
  });

  it("reads again and retries once when the balance changed between the proofs and the verification", async () => {
    calls.mismatches = 1;
    const { client, counts } = worker();
    const progress: string[] = [];
    const outcome = await runProof({
      input,
      connected,
      worker: () => client as never,
      onProgress: (text) => progress.push(text),
    });
    expect(outcome).toMatchObject({ kind: "proven" });
    expect(counts.proofs).toBe(2);
    expect(calls.closes).toBe(2);
    expect(counts.ended).toBe(2);
    expect(progress).toContain(
      "Your balance changed while proving. Reading it again and trying once more…",
    );
  });

  it("explains after a second change and records nothing", async () => {
    calls.mismatches = 2;
    const { client, counts } = worker();
    const outcome = await runProof({
      input,
      connected,
      worker: () => client as never,
      onProgress: () => undefined,
    });
    expect(outcome).toEqual({
      kind: "failed",
      message:
        "Your balance changed twice while proving, so the proof no longer matched it and nothing was recorded. Pause payments to and from this account for a minute, then try again.",
    });
    expect(counts.proofs).toBe(2);
    expect(calls.closes).toBe(2);
    expect(calls.api).toEqual([]);
  });
});
