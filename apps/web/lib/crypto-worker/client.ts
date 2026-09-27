// The page side of the crypto Web Worker. Wallet signatures are copied into a buffer that is
// transferred to the worker (so it is detached here), and the wallet's own copy is zeroed (10 section
// 3). Locking terminates the worker, which ends every key in it.
import type { PortableInstruction } from "@sotto/sdk/tx";
import type {
  ApplyInstructionResult,
  CheckAccountResult,
  ConfirmSignatureResult,
  DecryptResult,
  OpenSealedResult,
  SealResult,
  SetupInstructionsResult,
  StatusResult,
  UnlockResult,
  ViewingResult,
  WorkerErrorCode,
  WorkerRequest,
  WorkerResponse,
  WorkerResult,
} from "./protocol.ts";

export class CryptoWorkerError extends Error {
  readonly code: WorkerErrorCode | "locked";
  constructor(code: WorkerErrorCode | "locked", message: string) {
    super(message);
    this.name = "CryptoWorkerError";
    this.code = code;
  }
}

export type WorkerLike = {
  postMessage(message: WorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

/** The worker itself; the literal `new Worker(new URL(...))` lets Turbopack bundle it. */
export function createCryptoWorker(): WorkerLike {
  return new Worker(new URL("./crypto.worker.ts", import.meta.url), {
    type: "module",
    name: "sotto-crypto",
  }) as unknown as WorkerLike;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class CryptoWorkerClient {
  private readonly worker: WorkerLike;
  private readonly ready: Promise<void>;
  private readonly pending = new Map<
    number,
    { resolve: (result: WorkerResult) => void; reject: (error: Error) => void }
  >();
  private nextId = 1;
  private terminated = false;
  private closing = false;

  constructor(worker: WorkerLike = createCryptoWorker()) {
    this.worker = worker;
    let markReady: () => void = () => {};
    let failReady: (error: Error) => void = () => {};
    this.ready = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      failReady = reject;
    });
    worker.onmessage = (event) => {
      const message = event.data;
      if ("type" in message) {
        markReady();
        return;
      }
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.ok) waiting.resolve(message.result);
      else waiting.reject(new CryptoWorkerError(message.error.code, message.error.message));
    };
    worker.onerror = () => {
      const error = new CryptoWorkerError("failed", "The crypto worker stopped");
      failReady(error);
      this.rejectAll(error);
    };
  }

  private rejectAll(error: Error): void {
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
  }

  private async request(
    message: DistributiveOmit<WorkerRequest, "id">,
    transfer: Transferable[] = [],
  ): Promise<WorkerResult> {
    const clearing = message.type === "clear";
    if (this.closing && !clearing) throw new CryptoWorkerError("locked", "The keys are locked");
    await this.ready;
    if (this.terminated || (this.closing && !clearing)) {
      throw new CryptoWorkerError("locked", "The keys are locked");
    }
    const id = this.nextId++;
    return new Promise<WorkerResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id } as WorkerRequest, transfer);
    });
  }

  /** Moves the signature into the worker: the buffer is transferred and the caller's copy zeroed. */
  private static handOver(signature: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(signature);
    signature.fill(0);
    return copy.buffer;
  }

  async unlock(wallet: string, signature: Uint8Array): Promise<UnlockResult> {
    const buffer = CryptoWorkerClient.handOver(signature);
    return (await this.request({ type: "unlock", wallet, signature: buffer }, [
      buffer,
    ])) as UnlockResult;
  }

  async unlockViewing(wallet: string, signature: Uint8Array): Promise<ViewingResult> {
    const buffer = CryptoWorkerClient.handOver(signature);
    return (await this.request({ type: "unlockViewing", wallet, signature: buffer }, [
      buffer,
    ])) as ViewingResult;
  }

  /** I-5: whether the unlocked keys match a token account's onchain ElGamal key. */
  async checkAccount(elgamalPubkey: string): Promise<CheckAccountResult> {
    return (await this.request({ type: "checkAccount", elgamalPubkey })) as CheckAccountResult;
  }

  async status(): Promise<StatusResult> {
    return (await this.request({ type: "status" })) as StatusResult;
  }

  /**
   * The determinism check before account setup: whether a second signature of the key message equals
   * the one the keys came from. The signature is handed over like the unlock signature.
   */
  async confirmSignature(wallet: string, signature: Uint8Array): Promise<ConfirmSignatureResult> {
    const buffer = CryptoWorkerClient.handOver(signature);
    return (await this.request({ type: "confirmSignature", wallet, signature: buffer }, [
      buffer,
    ])) as ConfirmSignatureResult;
  }

  /** The instructions that create and configure the unlocked wallet's account for `mint`. */
  async setupInstructions(mint: string): Promise<SetupInstructionsResult> {
    return (await this.request({ type: "setupInstructions", mint })) as SetupInstructionsResult;
  }

  /** Decrypts a token account the page read from chain, for display on this page. */
  async decrypt(account: Uint8Array): Promise<DecryptResult> {
    return (await this.request({
      type: "decrypt",
      account: new Uint8Array(account).buffer,
    })) as DecryptResult;
  }

  /** The apply instruction for a token account's fresh state (read just before). */
  async applyInstruction(token: string, account: Uint8Array): Promise<PortableInstruction> {
    const result = (await this.request({
      type: "applyInstruction",
      token,
      account: new Uint8Array(account).buffer,
    })) as ApplyInstructionResult;
    return result.instruction;
  }

  /** Seals canonical JSON to a viewer's public key (step 1.8). */
  async seal(publicKey: Uint8Array, value: unknown): Promise<Uint8Array> {
    const result = (await this.request({
      type: "seal",
      publicKey: new Uint8Array(publicKey).buffer,
      value,
    })) as SealResult;
    return result.ciphertext;
  }

  /** Opens a sealed box with the viewing key unlocked in this tab (step 1.8). */
  async openSealed(ciphertext: Uint8Array): Promise<unknown> {
    const result = (await this.request({
      type: "openSealed",
      ciphertext: new Uint8Array(ciphertext).buffer,
    })) as OpenSealedResult;
    return result.value;
  }

  /**
   * Locks: asks the vault to zero every key it holds, then terminates the worker, so the keys and the
   * WASM memory go with it. The worker is terminated after at most `timeoutMs` even if the vault does
   * not answer; nothing else can be requested once closing started.
   */
  async close(timeoutMs = 500): Promise<void> {
    if (this.terminated || this.closing) return;
    const clearing = this.request({ type: "clear" }).catch(() => undefined);
    this.closing = true;
    await Promise.race([clearing, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    this.terminate();
  }

  /** Terminates the worker at once, so every key in it is gone. */
  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.worker.terminate();
    this.rejectAll(new CryptoWorkerError("locked", "The keys are locked"));
  }
}
