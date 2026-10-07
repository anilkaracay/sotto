// The crypto Web Worker (04 section 5, 10 section 3): the only place where confidential and viewing
// keys exist. It attaches its message handler, then reports ready: Turbopack's worker bootstrap starts
// delivering messages before a module with a statically imported WASM would have attached its handler,
// so the page waits for "ready" and the WASM loads on the first request (verified in step 1.5).
// Since step 1.7 the first request loads the confidential accounts module too (setup, decryption,
// apply), which uses the same WASM. Since step 1.9 a transfer plan asks the page for rent exempt
// minimums (the worker makes no network calls): a `rent` message out, a `rentReply` back.
import type { RentReply, WorkerRequest, WorkerResponse } from "./protocol.ts";
import { createVault, loadVaultModules } from "./vault.ts";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest | RentReply>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

const waiting = new Map<
  number,
  { resolve: (lamports: bigint) => void; reject: (error: Error) => void }
>();
let nextCall = 1;

function rent(space: bigint): Promise<bigint> {
  const callId = nextCall++;
  return new Promise<bigint>((resolve, reject) => {
    waiting.set(callId, { resolve, reject });
    scope.postMessage({ type: "rent", callId, space: space.toString() });
  });
}

const vault = createVault(loadVaultModules, { rent });

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "rentReply") {
    const call = waiting.get(message.callId);
    if (!call) return;
    waiting.delete(message.callId);
    if (message.lamports !== undefined) call.resolve(BigInt(message.lamports));
    else call.reject(new Error(message.error ?? "the page could not read the rent"));
    return;
  }
  void vault.handle(message).then((response) => scope.postMessage(response));
};

scope.postMessage({ type: "ready" });
