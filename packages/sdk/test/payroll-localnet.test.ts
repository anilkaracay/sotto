// Payroll chunks on localnet (step 2.3, 06 section 7, D-21, AC-08.4, AC-08.5): the lines of a run are
// built in chunks from the state each line leaves (facts K6), signed with one wallet call per chunk
// and sent in order, each line confirmed before the next, every signature handed out before its
// transaction is sent. A 24 line run in chunks of 10 (version 1), a failure forced on line 12 that
// stops the run with lines 1 to 11 paid and a resume that pays lines 12 to 24 once, the version 0
// path (the first line one transaction at a time, then the rest of the chunk in one call), and a
// wallet that changes a signed message, which stops the chunk before anything is sent (06 section 9).
// Needs the bootstrapped localnet; skipped unless SOTTO_LOCALNET_RPC_URL is set (scripts/ci-local.sh
// runs it in the localnet job).
import { fetchToken } from "@solana-program/token-2022";
import {
  fetchEncodedAccounts,
  type Address,
  type KeyPairSigner,
  type SignatureBytes,
  type Transaction,
  type TransactionMessage,
  type TransactionModifyingSigner,
} from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BudgetMemory,
  chunkLinesFor,
  confidentialTransferChunk,
  decodeToken2022Account,
  decodeToken2022Mint,
  decryptTokenAccount,
  payPayrollLines,
  type BuiltChunk,
  type PayrollPayment,
} from "../src/confidential/index.ts";
import { keypairWallet } from "../src/testing/index.ts";
import {
  applyLocalnetPending,
  fundLocalnetAccount,
  newLocalnetOwner,
  readLocalnetBootstrap,
  setLocalnetConfidentialCredits,
  setUpLocalnetAccount,
  type LocalnetBootstrap,
  type LocalnetOwner,
} from "../src/testing/localnet.ts";
import {
  createRetryingRpc,
  WalletChangedTransactionError,
  type SolanaRpc,
} from "../src/tx/index.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const USDC = 1_000_000n;
const LINES = 24;

function cosigner(signers: readonly KeyPairSigner[]) {
  return async (transaction: Transaction): Promise<Record<Address, SignatureBytes>> => {
    const signatures: Record<Address, SignatureBytes> = {};
    for (const signer of signers) {
      if (!(signer.address in transaction.signatures)) continue;
      const [dictionary] = await signer.signTransactions([
        transaction as Parameters<KeyPairSigner["signTransactions"]>[0][number],
      ]);
      const signature = dictionary?.[signer.address];
      if (signature) signatures[signer.address] = signature;
    }
    return signatures;
  };
}

/** The wallet, counting its signature requests and the transactions in each. */
function counting(wallet: TransactionModifyingSigner) {
  const calls: number[] = [];
  const counted: TransactionModifyingSigner = {
    address: wallet.address,
    modifyAndSignTransactions: async (transactions, config) => {
      calls.push(transactions.length);
      return wallet.modifyAndSignTransactions(transactions, config);
    },
  };
  return { wallet: counted, calls };
}

describe.skipIf(!RPC_URL)("payroll chunks on localnet", () => {
  let rpc: SolanaRpc;
  let bootstrap: LocalnetBootstrap;
  let owner: LocalnetOwner;
  let people: LocalnetOwner[] = [];

  async function pendingOf(who: LocalnetOwner): Promise<bigint> {
    const token = await fetchToken(rpc, who.wusdc, { commitment: "confirmed" });
    return decryptTokenAccount(token.data, who.keys).pending;
  }

  async function availableOf(who: LocalnetOwner): Promise<bigint> {
    const token = await fetchToken(rpc, who.wusdc, { commitment: "confirmed" });
    return decryptTokenAccount(token.data, who.keys).available;
  }

  /** What the crypto worker does in the browser: the chunk's plans with the owner's keys. */
  function builder(version: 0 | 1, closedChecks: string[][]) {
    return async (input: {
      source: Uint8Array;
      mint: Uint8Array;
      lines: { destinationToken: Address; destination: Uint8Array; amount: bigint }[];
    }): Promise<BuiltChunk> => {
      const chunk = await confidentialTransferChunk({
        owner: owner.signer.address,
        sourceToken: owner.wusdc,
        sourceTokenAccount: decodeToken2022Account(input.source),
        mint: bootstrap.wrappedUsdcMint,
        mintAccount: decodeToken2022Mint(input.mint),
        lines: input.lines.map((line) => ({
          destinationToken: line.destinationToken,
          destinationTokenAccount: decodeToken2022Account(line.destination),
          amount: line.amount,
        })),
        keys: owner.keys,
        version,
        rent: (space) => rpc.getMinimumBalanceForRentExemption(space).send(),
      });
      for (const plan of chunk.plans) {
        closedChecks.push(
          plan.cleanup.map((instruction) => instruction.accounts[0]?.address ?? ""),
        );
      }
      return {
        lines: chunk.plans.map((plan) => ({
          transactions: plan.transactions,
          cosign: cosigner(plan.signers),
        })),
        cleanups: chunk.plans.map((plan) => plan.cleanup),
        availableAfter: chunk.availableAfter,
        release: async () => undefined,
      };
    };
  }

  async function allClosed(closedChecks: string[][]): Promise<boolean> {
    const targets = closedChecks.flat() as Address[];
    for (let i = 0; i < targets.length; i += 100) {
      const accounts = await fetchEncodedAccounts(rpc, targets.slice(i, i + 100), {
        commitment: "confirmed",
      });
      if (accounts.some((account) => account.exists)) return false;
    }
    return true;
  }

  const paymentsFor = (who: readonly LocalnetOwner[], base: bigint): PayrollPayment[] =>
    who.map((person, index) => ({
      id: `line-${index + 1}`,
      destinationToken: person.wusdc,
      amount: base + BigInt(index + 1) * 10_000n,
    }));

  beforeAll(async () => {
    rpc = createRetryingRpc(RPC_URL as string);
    bootstrap = readLocalnetBootstrap();
    owner = await newLocalnetOwner(rpc, bootstrap, 200n);
    await setUpLocalnetAccount(rpc, owner, bootstrap);
    await fundLocalnetAccount(rpc, owner, bootstrap, 150n * USDC);
    await applyLocalnetPending(rpc, owner);
    people = [];
    for (let i = 0; i < LINES; i += 6) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(6, LINES - i) }, () => newLocalnetOwner(rpc, bootstrap, 0n)),
      );
      await Promise.all(batch.map((person) => setUpLocalnetAccount(rpc, person, bootstrap)));
      people.push(...batch);
    }
  }, 300_000);

  it(
    "AC-08.4 pays a 24 line run in chunks of 10, one wallet call per chunk, each line signed before the one ahead of it landed (version 1)",
    { timeout: 300_000 },
    async () => {
      const payments = paymentsFor(people, 1n * USDC);
      const total = payments.reduce((sum, payment) => sum + payment.amount, 0n);
      const before = await availableOf(owner);
      const pendingBefore = await Promise.all(people.map(pendingOf));
      const { wallet, calls } = counting(owner.wallet);
      const recorded: string[] = [];
      const unsentAtRecord: boolean[] = [];
      const closedChecks: string[][] = [];
      const chunks: number[] = [];
      expect(chunkLinesFor(1)).toBe(10);
      const started = Date.now();
      const outcome = await payPayrollLines({
        rpc,
        wallet,
        version: 1,
        sourceToken: owner.wusdc,
        mint: bootstrap.wrappedUsdcMint,
        payments,
        buildChunk: builder(1, closedChecks),
        // 08 section 3: each signature is recorded before its transaction is sent.
        onSignature: async (payment, role, signature) => {
          recorded.push(`${payment.id}:${role}`);
          const { value } = await rpc.getSignatureStatuses([signature as never]).send();
          unsentAtRecord.push(value[0] === null);
        },
        onChunkLanded: async (chunk) => {
          chunks.push(chunk.lines.length);
          // The chunk's prediction held: the balance is the one the plans were built toward.
          expect(chunk.availableAfter).toBe(await availableOf(owner));
        },
      });
      console.log(
        `v1 payroll of 24 lines: ${Date.now() - started} ms, wallet calls ${calls.join(" ")}`,
      );
      expect(outcome.stopped).toBeNull();
      expect(outcome.landed.map((paid) => paid.payment.id)).toEqual(payments.map((p) => p.id));
      expect(calls).toEqual([10, 10, 4]);
      expect(outcome.prompts).toBe(3);
      expect(chunks).toEqual([10, 10, 4]);
      expect(recorded).toEqual(payments.map((payment) => `${payment.id}:transfer`));
      expect(unsentAtRecord.every(Boolean)).toBe(true);
      expect(await availableOf(owner)).toBe(before - total);
      const pendingAfter = await Promise.all(people.map(pendingOf));
      pendingAfter.forEach((pending, index) =>
        expect(pending).toBe((pendingBefore[index] ?? 0n) + (payments[index]?.amount ?? 0n)),
      );
      expect(await allClosed(closedChecks)).toBe(true);
    },
  );

  it(
    "AC-08.5 stops at a failed line 12 with lines 1 to 11 paid, then a resume pays lines 12 to 24 and never pays lines 1 to 11 twice",
    { timeout: 300_000 },
    async () => {
      const payments = paymentsFor(people, 2n * USDC);
      const pendingBefore = await Promise.all(people.map(pendingOf));
      const before = await availableOf(owner);
      const twelfth = people[11] as LocalnetOwner;
      const credits = (on: boolean) => setLocalnetConfidentialCredits(rpc, twelfth, on);
      const closedChecks: string[][] = [];
      const recorded: string[] = [];
      const budgets = new BudgetMemory();
      const first = await payPayrollLines({
        rpc,
        wallet: owner.wallet,
        version: 1,
        sourceToken: owner.wusdc,
        mint: bootstrap.wrappedUsdcMint,
        payments,
        budgets,
        buildChunk: builder(1, closedChecks),
        onSignature: async (payment) => void recorded.push(payment.id),
        // Line 12's recipient turns confidential credits off once line 11 landed, after the chunk
        // of lines 11 to 20 was signed.
        onLineLanded: async (paid) => {
          if (paid.payment.id === "line-11") await credits(false);
        },
      });
      expect(first.landed.map((paid) => paid.payment.id)).toEqual(
        payments.slice(0, 11).map((p) => p.id),
      );
      expect(first.stopped?.payment.id).toBe("line-12");
      expect(first.stopped?.step?.role).toBe("transfer");
      // The simulation right before sending caught it: line 12 never reached the network.
      expect(first.stopped?.sent).toBe(false);
      expect(first.stopped?.cleaned).toBe(true);
      expect(recorded).toEqual(payments.slice(0, 11).map((p) => p.id));
      const paidFirst = payments.slice(0, 11).reduce((sum, p) => sum + p.amount, 0n);
      expect(await availableOf(owner)).toBe(before - paidFirst);

      // The resume: the lines that did not land, from chain state.
      await credits(true);
      const done = new Set(first.landed.map((paid) => paid.payment.id));
      const second = await payPayrollLines({
        rpc,
        wallet: owner.wallet,
        version: 1,
        sourceToken: owner.wusdc,
        mint: bootstrap.wrappedUsdcMint,
        payments: payments.filter((payment) => !done.has(payment.id)),
        budgets,
        buildChunk: builder(1, closedChecks),
        onSignature: async (payment) => void recorded.push(payment.id),
      });
      expect(second.stopped).toBeNull();
      expect(second.landed.map((paid) => paid.payment.id)).toEqual(
        payments.slice(11).map((p) => p.id),
      );
      // Every recipient received its line exactly once.
      const pendingAfter = await Promise.all(people.map(pendingOf));
      pendingAfter.forEach((pending, index) =>
        expect(pending).toBe((pendingBefore[index] ?? 0n) + (payments[index]?.amount ?? 0n)),
      );
      const total = payments.reduce((sum, payment) => sum + payment.amount, 0n);
      expect(await availableOf(owner)).toBe(before - total);
      expect(await allClosed(closedChecks)).toBe(true);
    },
  );

  it(
    "AC-08.4 pays version 0 lines: the first line transaction by transaction, then one wallet call for the rest of each chunk",
    { timeout: 300_000 },
    async () => {
      const six = people.slice(0, 6);
      const payments = paymentsFor(six, 3n * USDC);
      const pendingBefore = await Promise.all(six.map(pendingOf));
      const { wallet, calls } = counting(owner.wallet);
      const closedChecks: string[][] = [];
      expect(chunkLinesFor(0)).toBe(4);
      const started = Date.now();
      const outcome = await payPayrollLines({
        rpc,
        wallet,
        version: 0,
        sourceToken: owner.wusdc,
        mint: bootstrap.wrappedUsdcMint,
        payments,
        buildChunk: builder(0, closedChecks),
        onSignature: async () => undefined,
      });
      console.log(
        `v0 payroll of 6 lines: ${Date.now() - started} ms, wallet calls ${calls.join(" ")}`,
      );
      expect(outcome.stopped).toBeNull();
      // Chunk 1: line 1 one transaction at a time (5 calls), lines 2 to 4 in one call (15
      // transactions); chunk 2: lines 5 and 6 in one call with the budgets line 1 measured.
      expect(calls).toEqual([1, 1, 1, 1, 1, 15, 10]);
      const pendingAfter = await Promise.all(six.map(pendingOf));
      pendingAfter.forEach((pending, index) =>
        expect(pending).toBe((pendingBefore[index] ?? 0n) + (payments[index]?.amount ?? 0n)),
      );
      expect(await allClosed(closedChecks)).toBe(true);
    },
  );

  it(
    "AC-08.4 sends nothing of a chunk when the wallet changed a signed message (06 section 9)",
    { timeout: 120_000 },
    async () => {
      const two = people.slice(0, 2);
      const payments = paymentsFor(two, 4n * USDC);
      const before = await availableOf(owner);
      const pendingBefore = await Promise.all(two.map(pendingOf));
      // A wallet that rewrites the first instruction's data before signing.
      const changing = keypairWallet(
        owner.signer,
        (message: TransactionMessage) =>
          ({
            ...message,
            instructions: message.instructions.map((instruction, index) =>
              index === 0 && instruction.data
                ? { ...instruction, data: new Uint8Array([...instruction.data].reverse()) }
                : instruction,
            ),
          }) as TransactionMessage,
      );
      const outcome = await payPayrollLines({
        rpc,
        wallet: changing,
        version: 1,
        sourceToken: owner.wusdc,
        mint: bootstrap.wrappedUsdcMint,
        payments,
        buildChunk: builder(1, []),
        onSignature: async () => {
          throw new Error("nothing is recorded when nothing is sent");
        },
      });
      expect(outcome.landed).toEqual([]);
      expect(outcome.stopped?.payment.id).toBe("line-1");
      expect(outcome.stopped?.error).toBeInstanceOf(WalletChangedTransactionError);
      expect(outcome.stopped?.sent).toBe(false);
      expect(await availableOf(owner)).toBe(before);
      expect(await Promise.all(two.map(pendingOf))).toEqual(pendingBefore);
    },
  );
});
