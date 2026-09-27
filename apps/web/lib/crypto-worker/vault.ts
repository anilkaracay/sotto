// The key vault that runs inside the crypto Web Worker: it derives and holds the confidential keys and
// the viewing key (10 section 3), and does the work that needs them: the determinism check before
// account setup, the account setup instructions, the decryption of balances and the apply
// instruction. It answers with public keys, status, balances for display and public instruction
// data only. The SDK modules (and with them the zk-sdk WASM) load on the first request, so the worker
// is ready before the WASM is. The vault makes no network calls: the page reads the chain and passes
// account data in.
import type { ConfidentialKeyMaterial, ViewingKeyMaterial } from "@sotto/sdk/keys";
import { address, createNoopSigner, getBase64Decoder } from "@solana/kit";
import type {
  ApplyInstructionResult,
  CheckAccountResult,
  ClearResult,
  ConfirmSignatureResult,
  DecryptResult,
  SetupInstructionsResult,
  StatusResult,
  UnlockResult,
  ViewingResult,
  WorkerErrorCode,
  WorkerRequest,
  WorkerResponse,
  WorkerResult,
} from "./protocol.ts";

export type VaultModules = typeof import("@sotto/sdk/keys") &
  typeof import("@sotto/sdk/confidential");

/** The SDK modules the vault needs, loaded together (the worker calls this on the first request). */
export async function loadVaultModules(): Promise<VaultModules> {
  const [keys, confidential] = await Promise.all([
    import("@sotto/sdk/keys"),
    import("@sotto/sdk/confidential"),
  ]);
  return { ...keys, ...confidential };
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

export function createVault(load: () => Promise<VaultModules>) {
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

  /** Zeroes and drops every key; the worker is terminated right after (key-session.ts). */
  async function clearAll(): Promise<ClearResult> {
    if (modules) clear(await sdk());
    wallet = null;
    return { cleared: true };
  }

  function status(): StatusResult {
    return { wallet, unlocked: confidential !== null, viewing: viewing !== null };
  }

  async function run(request: WorkerRequest): Promise<WorkerResult> {
    switch (request.type) {
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
