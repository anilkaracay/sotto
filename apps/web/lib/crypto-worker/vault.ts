// The key vault that runs inside the crypto Web Worker: it derives and holds the confidential keys and
// the viewing key (10 section 3), and does the work that needs them: the determinism check before
// account setup, the account setup instructions, the decryption of balances and the apply
// instruction. It answers with public keys, status, balances for display and public instruction
// data only. The SDK modules (and with them the zk-sdk WASM) load on the first request, so the worker
// is ready before the WASM is. The vault makes no network calls: the page reads the chain and passes
// account data in. Since step 1.9 it builds confidential transfer plans (06 section 5): it keeps the
// keypairs of the accounts a plan creates until the page ends the plan or the keys lock, and signs
// with them over transactions the wallet already signed; rent comes from the page. Since step 2.3 it
// builds the plans of a payroll chunk (06 section 7), each from the state the line ahead leaves.
import type { ConfidentialKeyMaterial, ViewingKeyMaterial } from "@sotto/sdk/keys";
import {
  address,
  createNoopSigner,
  getBase64Decoder,
  getTransactionDecoder,
  type KeyPairSigner,
} from "@solana/kit";
import type {
  ApplyInstructionResult,
  CheckAccountResult,
  ClearResult,
  ConfirmSignatureResult,
  CosignResult,
  DecryptResult,
  EndPlanResult,
  OpenSealedResult,
  SealResult,
  SetupInstructionsResult,
  StatusResult,
  TransferChunkResult,
  TransferPlanResult,
  BalanceProofsResult,
  UnlockResult,
  ViewingResult,
  WorkerErrorCode,
  WorkerRequest,
  WorkerResponse,
  WorkerResult,
} from "./protocol.ts";

export type VaultModules = typeof import("@sotto/sdk/keys") &
  typeof import("@sotto/sdk/confidential") &
  typeof import("@sotto/sdk/disclosure/seal") &
  Pick<typeof import("@sotto/sdk/proofs/plan"), "balanceThresholdProofs">;

/** The SDK modules the vault needs, loaded together (the worker calls this on the first request). */
export async function loadVaultModules(): Promise<VaultModules> {
  const [keys, confidential, seal, proofs] = await Promise.all([
    import("@sotto/sdk/keys"),
    import("@sotto/sdk/confidential"),
    import("@sotto/sdk/disclosure/seal"),
    import("@sotto/sdk/proofs/plan"),
  ]);
  return {
    ...keys,
    ...confidential,
    ...seal,
    balanceThresholdProofs: proofs.balanceThresholdProofs,
  };
}

export class VaultError extends Error {
  readonly code: WorkerErrorCode;
  constructor(code: WorkerErrorCode, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

const NOT_UNLOCKED = "Unlock the confidential keys first";

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
}

export type VaultOptions = {
  /** The rent exempt minimum for an account size, asked of the page (step 1.9). */
  rent?: (space: bigint) => Promise<bigint>;
};

export function createVault(load: () => Promise<VaultModules>, options: VaultOptions = {}) {
  let modules: Promise<VaultModules> | null = null;
  const sdk = () => (modules ??= load());
  let wallet: string | null = null;
  let confidential: ConfidentialKeyMaterial | null = null;
  /**
   * SHA-256 of the signature the keys came from, for the determinism check: a second signature is
   * compared with it, so the signature itself is not kept.
   */
  let unlockDigest: Uint8Array | null = null;
  let viewing: ViewingKeyMaterial | null = null;
  /**
   * Step 4.6 (D-32): set once a published demo viewing key is loaded, and never unset. A demo vault
   * opens sealed records and answers its status; it takes no wallet signature, derives no key, seals
   * nothing and builds nothing, so no real key and no demo key ever share a worker.
   */
  let demo = false;
  /** Step 1.9: the signers of each open transfer plan, by plan id. */
  const plans = new Map<string, KeyPairSigner[]>();

  async function forWallet(next: string): Promise<VaultModules> {
    const loaded = await sdk();
    if (wallet !== null && wallet !== next) clear(loaded);
    wallet = next;
    return loaded;
  }

  function clear(loaded: VaultModules): void {
    if (confidential) loaded.zeroConfidentialKeys(confidential);
    if (viewing) loaded.zeroViewingKey(viewing);
    unlockDigest?.fill(0);
    confidential = null;
    unlockDigest = null;
    viewing = null;
    plans.clear();
  }

  /** The unlocked wallet and its keys, or not_unlocked. */
  function held(): { owner: string; keys: ConfidentialKeyMaterial } {
    if (!confidential || !wallet) throw new VaultError("not_unlocked", NOT_UNLOCKED);
    return { owner: wallet, keys: confidential };
  }

  async function unlock(walletAddress: string, signature: Uint8Array): Promise<UnlockResult> {
    try {
      const loaded = await forWallet(walletAddress);
      const derived = await loaded.deriveStandardKeys(address(walletAddress), signature);
      const digest = await sha256(signature);
      if (confidential) loaded.zeroConfidentialKeys(confidential);
      unlockDigest?.fill(0);
      confidential = derived;
      unlockDigest = digest;
      return { elgamalPubkey: derived.elgamalPubkey };
    } finally {
      signature.fill(0);
    }
  }

  async function checkAccount(elgamalPubkey: string): Promise<CheckAccountResult> {
    const loaded = await sdk();
    const { keys } = held();
    return { matches: loaded.elgamalKeyMatches(keys.elgamalPubkey, address(elgamalPubkey)) };
  }

  /**
   * The determinism check (step 1.7): a second signature of the key message must equal the one the
   * keys came from. A wallet whose signatures differ would derive other keys next time, and a balance
   * under these keys could no longer be read.
   */
  async function confirmSignature(
    walletAddress: string,
    signature: Uint8Array,
  ): Promise<ConfirmSignatureResult> {
    try {
      const loaded = await sdk();
      const { owner } = held();
      if (owner !== walletAddress || !unlockDigest) {
        throw new VaultError("not_unlocked", NOT_UNLOCKED);
      }
      const valid = await loaded.verifyWalletSignature(
        walletAddress,
        loaded.confidentialKeysMessage(),
        signature,
      );
      if (!valid) {
        throw new VaultError(
          "bad_signature",
          "The signature is not the wallet's signature of the key message",
        );
      }
      const digest = await sha256(signature);
      const same = loaded.bytesEqual(digest, unlockDigest);
      digest.fill(0);
      return { same };
    } finally {
      signature.fill(0);
    }
  }

  async function setupInstructions(mint: string): Promise<SetupInstructionsResult> {
    const loaded = await sdk();
    const { owner, keys } = held();
    return loaded.confidentialAccountSetupInstructions({
      owner: createNoopSigner(address(owner)),
      mint: address(mint),
      keys,
    });
  }

  async function decrypt(account: Uint8Array): Promise<DecryptResult> {
    const loaded = await sdk();
    const { keys } = held();
    return loaded.decryptTokenAccount(loaded.decodeToken2022Account(account), keys);
  }

  async function applyInstruction(
    token: string,
    account: Uint8Array,
  ): Promise<ApplyInstructionResult> {
    const loaded = await sdk();
    const { owner, keys } = held();
    const tokenAccount = loaded.decodeToken2022Account(account);
    if (tokenAccount.owner !== owner) {
      throw new VaultError("wrong_owner", "The token account belongs to another wallet");
    }
    return {
      instruction: loaded.applyPendingBalanceInstruction({
        token: address(token),
        tokenAccount,
        owner: createNoopSigner(address(owner)),
        keys,
      }),
    };
  }

  async function unlockViewing(
    walletAddress: string,
    signature: Uint8Array,
  ): Promise<ViewingResult> {
    try {
      const loaded = await forWallet(walletAddress);
      const derived = await loaded.deriveViewingKey(address(walletAddress), signature);
      if (viewing) loaded.zeroViewingKey(viewing);
      viewing = derived;
      return { publicKey: getBase64Decoder().decode(derived.publicKey) };
    } finally {
      signature.fill(0);
    }
  }

  /**
   * Step 4.6 (D-32): loads a published viewing secret key of the demo company. Refused once this
   * vault has held a wallet's keys: a tab's real keys and demo keys never meet.
   */
  async function demoViewing(secretKey: Uint8Array): Promise<ViewingResult> {
    try {
      if (wallet !== null || confidential !== null || (viewing !== null && !demo)) {
        throw new VaultError(
          "demo_read_only",
          "The demo keys are not loaded beside a wallet's keys",
        );
      }
      const loaded = await sdk();
      const pair = await loaded.viewingKeyFromSecret(secretKey);
      if (viewing) loaded.zeroViewingKey(viewing);
      viewing = pair;
      demo = true;
      return { publicKey: getBase64Decoder().decode(pair.publicKey) };
    } finally {
      secretKey.fill(0);
    }
  }

  /** Step 1.8: seals canonical JSON to a viewer's public key; needs no key of this tab. */
  async function seal(publicKey: Uint8Array, value: unknown): Promise<SealResult> {
    const loaded = await sdk();
    return { ciphertext: await loaded.sealJson(value, publicKey) };
  }

  /** Step 1.8: opens a sealed box with the viewing key unlocked in this tab. */
  async function openSealed(ciphertext: Uint8Array): Promise<OpenSealedResult> {
    const loaded = await sdk();
    if (!viewing) throw new VaultError("not_viewing", "Unlock the viewing key first");
    try {
      return { value: await loaded.openJson(ciphertext, viewing) };
    } catch {
      throw new VaultError("cannot_open", "This viewing key cannot open the sealed data");
    }
  }

  /** Step 1.9: a confidential transfer plan from the page's fresh account data (06 section 5). */
  async function transferPlan(
    request: Extract<WorkerRequest, { type: "transferPlan" }>,
  ): Promise<TransferPlanResult> {
    const loaded = await sdk();
    const { owner, keys } = held();
    const rent = options.rent;
    if (!rent) throw new VaultError("failed", "The worker has no way to ask for rent");
    const plan = await loaded.confidentialTransferPlan({
      owner: address(owner),
      sourceToken: address(request.sourceToken),
      sourceTokenAccount: loaded.decodeToken2022Account(new Uint8Array(request.sourceAccount)),
      destinationToken: address(request.destinationToken),
      destinationTokenAccount: loaded.decodeToken2022Account(
        new Uint8Array(request.destinationAccount),
      ),
      mint: address(request.mint),
      mintAccount: loaded.decodeToken2022Mint(new Uint8Array(request.mintAccount)),
      amount: BigInt(request.amount),
      keys,
      version: request.version,
      rent,
    });
    const planId = crypto.randomUUID();
    plans.set(planId, plan.signers);
    return {
      planId,
      variant: plan.variant,
      transactions: plan.transactions,
      cleanup: plan.cleanup,
      signers: plan.signers.map((signer) => signer.address),
      availableBefore: plan.availableBefore,
    };
  }

  /** Step 2.3: a payroll chunk's plans from the page's fresh account data (06 section 7). */
  async function transferChunk(
    request: Extract<WorkerRequest, { type: "transferChunk" }>,
  ): Promise<TransferChunkResult> {
    const loaded = await sdk();
    const { owner, keys } = held();
    const rent = options.rent;
    if (!rent) throw new VaultError("failed", "The worker has no way to ask for rent");
    const chunk = await loaded.confidentialTransferChunk({
      owner: address(owner),
      sourceToken: address(request.sourceToken),
      sourceTokenAccount: loaded.decodeToken2022Account(new Uint8Array(request.sourceAccount)),
      mint: address(request.mint),
      mintAccount: loaded.decodeToken2022Mint(new Uint8Array(request.mintAccount)),
      lines: request.lines.map((line) => ({
        destinationToken: address(line.destinationToken),
        destinationTokenAccount: loaded.decodeToken2022Account(
          new Uint8Array(line.destinationAccount),
        ),
        amount: BigInt(line.amount),
      })),
      keys,
      version: request.version,
      rent,
    });
    return {
      plans: chunk.plans.map((plan) => {
        const planId = crypto.randomUUID();
        plans.set(planId, plan.signers);
        return {
          planId,
          variant: plan.variant,
          transactions: plan.transactions,
          cleanup: plan.cleanup,
          signers: plan.signers.map((signer) => signer.address),
          availableBefore: plan.availableBefore,
        };
      }),
      availableAfter: chunk.availableAfter,
    };
  }

  /** Step 1.10: a withdraw plan from the page's fresh account data (06 section 6). */
  async function withdrawPlan(
    request: Extract<WorkerRequest, { type: "withdrawPlan" }>,
  ): Promise<TransferPlanResult> {
    const loaded = await sdk();
    const { owner, keys } = held();
    const rent = options.rent;
    if (!rent) throw new VaultError("failed", "The worker has no way to ask for rent");
    const plan = await loaded.confidentialWithdrawPlan({
      owner: address(owner),
      token: address(request.token),
      tokenAccount: loaded.decodeToken2022Account(new Uint8Array(request.account)),
      mint: address(request.mint),
      decimals: request.decimals,
      amount: BigInt(request.amount),
      keys,
      version: request.version,
      rent,
    });
    const planId = crypto.randomUUID();
    plans.set(planId, plan.signers);
    return {
      planId,
      variant: plan.variant,
      transactions: plan.transactions,
      cleanup: plan.cleanup,
      signers: plan.signers.map((signer) => signer.address),
      availableBefore: plan.availableBefore,
    };
  }

  /** Step 2.8: the proofs of a balance threshold (06 section 8); below it, insufficient_balance. */
  async function balanceProofs(
    request: Extract<WorkerRequest, { type: "balanceProofs" }>,
  ): Promise<BalanceProofsResult> {
    const loaded = await sdk();
    const { owner, keys } = held();
    const rent = options.rent;
    if (!rent) throw new VaultError("failed", "The worker has no way to ask for rent");
    const proofs = await loaded.balanceThresholdProofs({
      owner: address(owner),
      token: address(request.token),
      tokenAccount: loaded.decodeToken2022Account(new Uint8Array(request.account)),
      mint: address(request.mint),
      decimals: request.decimals,
      threshold: BigInt(request.threshold),
      keys,
      rent,
    });
    const planId = crypto.randomUUID();
    plans.set(planId, proofs.signers);
    return {
      planId,
      transactions: proofs.transactions,
      equalityContext: proofs.equalityContext,
      rangeContext: proofs.rangeContext,
      cleanup: proofs.cleanup,
      signers: proofs.signers.map((signer) => signer.address),
      availableBefore: proofs.availableBefore,
    };
  }

  /** Step 1.9: the plan's signatures over a transaction the wallet signed, for the signers it needs. */
  async function cosign(planId: string, wire: Uint8Array): Promise<CosignResult> {
    const signers = plans.get(planId);
    if (!signers) throw new VaultError("no_plan", "This transfer plan has ended");
    const transaction = getTransactionDecoder().decode(wire);
    const signatures: Record<string, Uint8Array> = {};
    for (const signer of signers) {
      if (!(signer.address in transaction.signatures)) continue;
      const [dictionary] = await signer.signTransactions([
        transaction as Parameters<KeyPairSigner["signTransactions"]>[0][number],
      ]);
      const signature = dictionary?.[signer.address];
      if (signature) signatures[signer.address] = new Uint8Array(signature);
    }
    return { signatures };
  }

  function endPlan(planId: string): EndPlanResult {
    plans.delete(planId);
    return { ended: true };
  }

  /** Zeroes and drops every key; the worker is terminated right after (key-session.ts). */
  async function clearAll(): Promise<ClearResult> {
    if (modules) clear(await sdk());
    wallet = null;
    return { cleared: true };
  }

  function status(): StatusResult {
    return {
      wallet,
      unlocked: confidential !== null,
      viewing: viewing !== null,
      ...(demo ? { demo: true } : {}),
    };
  }

  /** What a demo vault still answers (D-32): opening, its status, another demo key, and the end. */
  const DEMO_REQUESTS: ReadonlySet<WorkerRequest["type"]> = new Set([
    "demoViewing",
    "openSealed",
    "status",
    "clear",
  ]);

  async function run(request: WorkerRequest): Promise<WorkerResult> {
    if (demo && !DEMO_REQUESTS.has(request.type)) {
      throw new VaultError("demo_read_only", "The demo company is read only");
    }
    switch (request.type) {
      case "demoViewing":
        return demoViewing(new Uint8Array(request.secretKey));
      case "unlock":
        return unlock(request.wallet, new Uint8Array(request.signature));
      case "checkAccount":
        return checkAccount(request.elgamalPubkey);
      case "unlockViewing":
        return unlockViewing(request.wallet, new Uint8Array(request.signature));
      case "status":
        return status();
      case "confirmSignature":
        return confirmSignature(request.wallet, new Uint8Array(request.signature));
      case "setupInstructions":
        return setupInstructions(request.mint);
      case "decrypt":
        return decrypt(new Uint8Array(request.account));
      case "applyInstruction":
        return applyInstruction(request.token, new Uint8Array(request.account));
      case "clear":
        return clearAll();
      case "seal":
        return seal(new Uint8Array(request.publicKey), request.value);
      case "openSealed":
        return openSealed(new Uint8Array(request.ciphertext));
      case "transferPlan":
        return transferPlan(request);
      case "withdrawPlan":
        return withdrawPlan(request);
      case "transferChunk":
        return transferChunk(request);
      case "balanceProofs":
        return balanceProofs(request);
      case "cosign":
        return cosign(request.planId, new Uint8Array(request.transaction));
      case "endPlan":
        return endPlan(request.planId);
    }
  }

  /** One request in, one response out; failures become error codes, never stack traces. */
  async function handle(request: WorkerRequest): Promise<WorkerResponse> {
    const fail = (code: WorkerErrorCode, message: string): WorkerResponse => ({
      id: request.id,
      ok: false,
      error: { code, message },
    });
    try {
      return { id: request.id, ok: true, result: await run(request) };
    } catch (error) {
      if (error instanceof VaultError) return fail(error.code, error.message);
      if (error instanceof Error && error.name === "KeyDerivationError") {
        return fail("bad_signature", error.message);
      }
      if (error instanceof Error && error.name === "ConfidentialAccountError") {
        const reason = (error as Error & { reason: WorkerErrorCode }).reason;
        return fail(reason, error.message);
      }
      return fail("failed", "The confidential keys could not do this in this browser");
    }
  }

  return { handle };
}
