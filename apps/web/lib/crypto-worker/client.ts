// The page side of the crypto Web Worker. Wallet signatures are copied into a buffer that is
// transferred to the worker (so it is detached here), and the wallet's own copy is zeroed (10 section
// 3). Locking terminates the worker, which ends every key in it. Since step 1.9 the page answers the
// worker's rent questions while a transfer plan is built, with the reader the caller gives.
import type { PortableInstruction } from "@sotto/sdk/tx";
import {
  getTransactionEncoder,
  type Address,
  type SignatureBytes,
  type Transaction,
} from "@solana/kit";
import type {
  ApplyInstructionResult,
  CheckAccountResult,
  ConfirmSignatureResult,
  CosignResult,
  DecryptResult,
  OpenSealedResult,
  RentReply,
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

export class CryptoWorkerError extends Error {
  readonly code: WorkerErrorCode | "locked";
  constructor(code: WorkerErrorCode | "locked", message: string) {
    super(message);
    this.name = "CryptoWorkerError";
    this.code = code;
  }
}

export type WorkerLike = {
  postMessage(message: WorkerRequest | RentReply, transfer: Transferable[]): void;
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
  /** Answers the worker's rent questions while a transfer plan is built (step 1.9). */
  private rentReader: ((space: bigint) => Promise<bigint>) | null = null;

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
        if (message.type === "rent") this.answerRent(message.callId, message.space);
        else markReady();
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

  private answerRent(callId: number, space: string): void {
    const reader = this.rentReader;
    const reply = (answer: Omit<RentReply, "type" | "callId">) =>
      this.worker.postMessage({ type: "rentReply", callId, ...answer }, []);
    if (!reader) {
      reply({ error: "no transfer plan is being built" });
      return;
    }
    reader(BigInt(space)).then(
      (lamports) => reply({ lamports: lamports.toString() }),
      () => reply({ error: "the rent could not be read from the network" }),
    );
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

  /**
   * Step 4.6 (D-32): makes this worker a demo worker with a published viewing secret key. The buffer
   * is transferred like a signature; the caller's copy is zeroed.
   */
  async demoViewing(secretKey: Uint8Array): Promise<ViewingResult> {
    const buffer = CryptoWorkerClient.handOver(secretKey);
    return (await this.request({ type: "demoViewing", secretKey: buffer }, [
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
   * Step 1.9: a confidential transfer plan built with the keys, from account data the page just read;
   * `rent` reads the rent exempt minimum of an account size from chain.
   */
  async transferPlan(
    input: {
      sourceToken: string;
      sourceAccount: Uint8Array;
      destinationToken: string;
      destinationAccount: Uint8Array;
      mint: string;
      mintAccount: Uint8Array;
      amount: bigint;
      version: 0 | 1;
    },
    rent: (space: bigint) => Promise<bigint>,
  ): Promise<TransferPlanResult> {
    this.rentReader = rent;
    try {
      return (await this.request({
        type: "transferPlan",
        sourceToken: input.sourceToken,
        sourceAccount: new Uint8Array(input.sourceAccount).buffer,
        destinationToken: input.destinationToken,
        destinationAccount: new Uint8Array(input.destinationAccount).buffer,
        mint: input.mint,
        mintAccount: new Uint8Array(input.mintAccount).buffer,
        amount: input.amount.toString(),
        version: input.version,
      })) as TransferPlanResult;
    } finally {
      this.rentReader = null;
    }
  }

  /** Step 1.10: a withdraw plan (available to public wUSDC), rent read as for a transfer. */
  async withdrawPlan(
    input: {
      token: string;
      account: Uint8Array;
      mint: string;
      decimals: number;
      amount: bigint;
      version: 0 | 1;
    },
    rent: (space: bigint) => Promise<bigint>,
  ): Promise<TransferPlanResult> {
    this.rentReader = rent;
    try {
      return (await this.request({
        type: "withdrawPlan",
        token: input.token,
        account: new Uint8Array(input.account).buffer,
        mint: input.mint,
        decimals: input.decimals,
        amount: input.amount.toString(),
        version: input.version,
      })) as TransferPlanResult;
    } finally {
      this.rentReader = null;
    }
  }

  /**
   * Step 2.8: the proofs that the available balance is at least `threshold` (06 section 8), from the
   * account data the page just read. Below the threshold it fails with insufficient_balance before any
   * proof is made (AC-13.2).
   */
  async balanceProofs(
    input: {
      token: string;
      account: Uint8Array;
      mint: string;
      decimals: number;
      threshold: bigint;
    },
    rent: (space: bigint) => Promise<bigint>,
  ): Promise<BalanceProofsResult> {
    this.rentReader = rent;
    try {
      return (await this.request({
        type: "balanceProofs",
        token: input.token,
        account: new Uint8Array(input.account).buffer,
        mint: input.mint,
        decimals: input.decimals,
        threshold: input.threshold.toString(),
      })) as BalanceProofsResult;
    } finally {
      this.rentReader = null;
    }
  }

  /**
   * Step 2.3: the plans of a payroll chunk (06 section 7), built with the keys from account data the
   * page just read, each line from the state the line ahead of it leaves.
   */
  async transferChunk(
    input: {
      sourceToken: string;
      sourceAccount: Uint8Array;
      mint: string;
      mintAccount: Uint8Array;
      lines: { destinationToken: string; destinationAccount: Uint8Array; amount: bigint }[];
      version: 0 | 1;
    },
    rent: (space: bigint) => Promise<bigint>,
  ): Promise<TransferChunkResult> {
    this.rentReader = rent;
    try {
      return (await this.request({
        type: "transferChunk",
        sourceToken: input.sourceToken,
        sourceAccount: new Uint8Array(input.sourceAccount).buffer,
        mint: input.mint,
        mintAccount: new Uint8Array(input.mintAccount).buffer,
        lines: input.lines.map((line) => ({
          destinationToken: line.destinationToken,
          destinationAccount: new Uint8Array(line.destinationAccount).buffer,
          amount: line.amount.toString(),
        })),
        version: input.version,
      })) as TransferChunkResult;
    } finally {
      this.rentReader = null;
    }
  }

  /** Step 1.9: the plan's own signatures over a transaction the wallet signed. */
  async cosign(
    planId: string,
    transaction: Transaction,
  ): Promise<Readonly<Record<Address, SignatureBytes>>> {
    const wire = new Uint8Array(getTransactionEncoder().encode(transaction));
    const result = (await this.request({
      type: "cosign",
      planId,
      transaction: wire.buffer,
    })) as CosignResult;
    return result.signatures as unknown as Record<Address, SignatureBytes>;
  }

  /** Step 1.9: the plan is done; its keypairs are dropped. */
  async endPlan(planId: string): Promise<void> {
    await this.request({ type: "endPlan", planId });
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
