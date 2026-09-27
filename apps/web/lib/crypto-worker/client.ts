// The page side of the crypto Web Worker. Wallet signatures are copied into a buffer that is
// transferred to the worker (so it is detached here), and the wallet's own copy is zeroed (10 section
// 3). Locking terminates the worker, which ends every key in it.
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
    await this.ready;
    if (this.terminated) throw new CryptoWorkerError("locked", "The keys are locked");
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

  /** Locks: terminates the worker, so every key in it is gone. */
  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.worker.terminate();
    this.rejectAll(new CryptoWorkerError("locked", "The keys are locked"));
  }
}
