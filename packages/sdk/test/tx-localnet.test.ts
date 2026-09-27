// The 06 section 9 rules against a local validator (step 1.6 exit test): a v0 and a v1 transaction
// signed by a keypair, confirmed then finalized, with the compute budget the rules chose read back
// from chain; a decoded simulation failure; the startup verification (06 section 0) against the
// bootstrapped localnet (.localnet/bootstrap.json from scripts/bootstrap-localnet.ts). Skipped unless
// SOTTO_LOCALNET_RPC_URL is set; scripts/ci-local.sh runs it in the localnet job after the bootstrap.
import { existsSync, readFileSync } from "node:fs";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  decompileTransactionMessage,
  generateKeyPairSigner,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionMessageComputeUnitLimit,
  getTransactionMessageComputeUnitPrice,
  getTransactionMessageLoadedAccountsDataSizeLimit,
  getTransactionMessagePriorityFeeLamports,
  lamports,
  type Address,
  type KeyPairSigner,
  type Signature,
  type TransactionMessage,
} from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { getClusterConfig, type AvailableClusterConfig } from "../src/cluster/config.ts";
import { verifyCluster } from "../src/cluster/verify.ts";
import {
  computeUnitLimitFromSimulation,
  createRetryingRpc,
  prepareTransaction,
  sendWithKeypairSigners,
  SimulationFailedError,
  waitForConfirmation,
  type SolanaRpc,
} from "../src/tx/index.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const BOOTSTRAP = new URL("../../../.localnet/bootstrap.json", import.meta.url);

type V0 = Extract<TransactionMessage, { version: 0 }>;
type V1 = Extract<TransactionMessage, { version: 1 }>;

async function landedMessage(rpc: SolanaRpc, signature: Signature): Promise<TransactionMessage> {
  const found = await rpc
    .getTransaction(signature, {
      encoding: "base64",
      maxSupportedTransactionVersion: 1,
      commitment: "finalized",
    })
    .send();
  if (!found) throw new Error(`transaction ${signature} not found`);
  expect(found.meta?.err ?? null).toBeNull();
  const wire = getTransactionDecoder().decode(getBase64Encoder().encode(found.transaction[0]));
  return decompileTransactionMessage(
    getCompiledTransactionMessageDecoder().decode(wire.messageBytes),
  ) as TransactionMessage;
}

describe.skipIf(!RPC_URL)("transaction rules on localnet", () => {
  let rpc: SolanaRpc;
  let payer: KeyPairSigner;
  let recipient: Address;

  beforeAll(async () => {
    rpc = createRetryingRpc(RPC_URL as string);
    payer = await generateKeyPairSigner();
    recipient = (await generateKeyPairSigner()).address;
    await waitForConfirmation(
      rpc,
      await rpc.requestAirdrop(payer.address, lamports(10_000_000_000n)).send(),
    );
  });

  const transfer = (amount: bigint) =>
    getTransferSolInstruction({ source: payer, destination: recipient, amount: lamports(amount) });

  it(
    "sends a v0 transaction with the budget as instructions, confirmed then finalized",
    { timeout: 120_000 },
    async () => {
      const sent = await sendWithKeypairSigners({
        rpc,
        feePayer: payer,
        instructions: [transfer(2_000_000n)],
        version: 0,
        finalize: true,
      });
      expect(sent.computeUnitLimit).toBe(computeUnitLimitFromSimulation(sent.unitsConsumed));
      const { value } = await rpc.getSignatureStatuses([sent.signature]).send();
      expect(value[0]?.confirmationStatus).toBe("finalized");
      const landed = await landedMessage(rpc, sent.signature);
      expect(landed.version).toBe(0);
      expect(getTransactionMessageComputeUnitLimit(landed)).toBe(sent.computeUnitLimit);
      expect(getTransactionMessageComputeUnitPrice(landed as V0)).toBe(sent.computeUnitPrice);
    },
  );

  it(
    "sends a v1 transaction with the budget in its config, confirmed then finalized",
    { timeout: 120_000 },
    async () => {
      const sent = await sendWithKeypairSigners({
        rpc,
        feePayer: payer,
        instructions: [transfer(3_000_000n)],
        version: 1,
        finalize: true,
      });
      expect(sent.version).toBe(1);
      expect(sent.budget.loadedAccountsDataSizeLimit).toBeGreaterThan(0);
      const landed = await landedMessage(rpc, sent.signature);
      expect(landed.version).toBe(1);
      expect(landed.instructions.some((i) => i.programAddress.startsWith("ComputeBudget"))).toBe(
        false,
      );
      expect(getTransactionMessageComputeUnitLimit(landed)).toBe(sent.budget.computeUnitLimit);
      expect(getTransactionMessagePriorityFeeLamports(landed as V1)).toBe(sent.priorityFeeLamports);
      expect(getTransactionMessageLoadedAccountsDataSizeLimit(landed)).toBe(
        sent.budget.loadedAccountsDataSizeLimit,
      );
      expect(await rpc.getBalance(recipient, { commitment: "finalized" }).send()).toMatchObject({
        value: 5_000_000n,
      });
    },
  );

  it("stops at the simulation with a decoded failure, before anything is signed", async () => {
    const error = await prepareTransaction({
      rpc,
      version: 0,
      feePayer: payer,
      instructions: [transfer(1_000_000_000_000_000n)],
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SimulationFailedError);
    expect((error as SimulationFailedError).decoded).toMatchObject({
      code: "system_1",
      message: "The account does not have enough SOL to perform the operation.",
      instructionIndex: 0,
    });
  });

  it("passes the startup verification on the bootstrapped localnet", async () => {
    if (!existsSync(BOOTSTRAP)) throw new Error("run node scripts/bootstrap-localnet.ts first");
    const bootstrap = JSON.parse(readFileSync(BOOTSTRAP, "utf8")) as {
      genesisHash: string;
      usdcMint: Address;
      wrappedUsdcMint: Address;
    };
    expect(bootstrap.genesisHash).toBe(await rpc.getGenesisHash().send());
    const check = await verifyCluster(rpc, getClusterConfig("localnet") as AvailableClusterConfig, {
      usdcMint: bootstrap.usdcMint,
      wrappedUsdcMint: bootstrap.wrappedUsdcMint,
    });
    expect(check).toMatchObject({
      wrappedMint: { status: "ok", address: bootstrap.wrappedUsdcMint },
      v1: true,
      confidentialEnabled: true,
      transactionPath: "v1",
    });
    expect(check.programs.every((program) => program.executable)).toBe(true);
  });
});
