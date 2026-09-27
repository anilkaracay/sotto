// The key vault that runs inside the crypto Web Worker: it derives and holds the confidential keys and
// the viewing key, and answers with public keys only (10 section 3). The keys module (and with it the
// zk-sdk WASM) loads on the first request, so the worker is ready before the WASM is.
import type { ConfidentialKeyMaterial, ViewingKeyMaterial } from "@sotto/sdk/keys";
import { address, getBase64Decoder } from "@solana/kit";
import type {
  CheckAccountResult,
  StatusResult,
  UnlockResult,
  ViewingResult,
  WorkerErrorCode,
  WorkerRequest,
  WorkerResponse,
  WorkerResult,
} from "./protocol.ts";

type KeysModule = typeof import("@sotto/sdk/keys");

export class VaultError extends Error {
  readonly code: WorkerErrorCode;
  constructor(code: WorkerErrorCode, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

export function createVault(load: () => Promise<KeysModule>) {
  let keysModule: Promise<KeysModule> | null = null;
  const keys = () => (keysModule ??= load());
  let wallet: string | null = null;
  let confidential: ConfidentialKeyMaterial | null = null;
  let viewing: ViewingKeyMaterial | null = null;

  async function forWallet(next: string): Promise<KeysModule> {
    const sdk = await keys();
    if (wallet !== null && wallet !== next) clear(sdk);
    wallet = next;
    return sdk;
  }

  function clear(sdk: KeysModule): void {
    if (confidential) sdk.zeroConfidentialKeys(confidential);
    if (viewing) sdk.zeroViewingKey(viewing);
    confidential = null;
    viewing = null;
  }

  async function unlock(walletAddress: string, signature: Uint8Array): Promise<UnlockResult> {
    try {
      const sdk = await forWallet(walletAddress);
      const derived = await sdk.deriveStandardKeys(address(walletAddress), signature);
      if (confidential) sdk.zeroConfidentialKeys(confidential);
      confidential = derived;
      return { elgamalPubkey: derived.elgamalPubkey };
    } finally {
      signature.fill(0);
    }
  }

  async function checkAccount(elgamalPubkey: string): Promise<CheckAccountResult> {
    const sdk = await keys();
    if (!confidential) throw new VaultError("not_unlocked", "Unlock the confidential keys first");
    return {
      matches: sdk.elgamalKeyMatches(confidential.elgamalPubkey, address(elgamalPubkey)),
    };
  }

  async function unlockViewing(
    walletAddress: string,
    signature: Uint8Array,
  ): Promise<ViewingResult> {
    try {
      const sdk = await forWallet(walletAddress);
      const derived = await sdk.deriveViewingKey(address(walletAddress), signature);
      if (viewing) sdk.zeroViewingKey(viewing);
      viewing = derived;
      return { publicKey: getBase64Decoder().decode(derived.publicKey) };
    } finally {
      signature.fill(0);
    }
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
    }
  }

  /** One request in, one response out; failures become error codes, never stack traces. */
  async function handle(request: WorkerRequest): Promise<WorkerResponse> {
    try {
      return { id: request.id, ok: true, result: await run(request) };
    } catch (error) {
      if (error instanceof VaultError) {
        return { id: request.id, ok: false, error: { code: error.code, message: error.message } };
      }
      if (error instanceof Error && error.name === "KeyDerivationError") {
        return {
          id: request.id,
          ok: false,
          error: { code: "bad_signature", message: error.message },
        };
      }
      return {
        id: request.id,
        ok: false,
        error: { code: "failed", message: "The keys could not be derived in this browser" },
      };
    }
  }

  return { handle };
}
