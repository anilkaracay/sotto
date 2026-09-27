// Messages between the page and the crypto Web Worker (04 section 5, 10 section 3). Requests carry
// wallet signatures as transferred buffers; responses carry public keys and status only. No response
// type has a field for secret key material, so none can leave the worker.
export type WorkerRequest =
  | { id: number; type: "unlock"; wallet: string; signature: ArrayBuffer }
  | { id: number; type: "checkAccount"; elgamalPubkey: string }
  | { id: number; type: "unlockViewing"; wallet: string; signature: ArrayBuffer }
  | { id: number; type: "status" };

export type UnlockResult = { elgamalPubkey: string };
export type CheckAccountResult = { matches: boolean };
export type ViewingResult = { publicKey: string };
export type StatusResult = { wallet: string | null; unlocked: boolean; viewing: boolean };
export type WorkerResult = UnlockResult | CheckAccountResult | ViewingResult | StatusResult;

export type WorkerErrorCode = "bad_signature" | "not_unlocked" | "failed";

export type WorkerResponse =
  | { type: "ready" }
  | { id: number; ok: true; result: WorkerResult }
  | { id: number; ok: false; error: { code: WorkerErrorCode; message: string } };
