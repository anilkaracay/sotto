// The crypto Web Worker (04 section 5, 10 section 3): the only place where confidential and viewing
// keys exist. It attaches its message handler, then reports ready: Turbopack's worker bootstrap starts
// delivering messages before a module with a statically imported WASM would have attached its handler,
// so the page waits for "ready" and the WASM loads on the first request (VERIFICATION-LOG step 1.5).
// Since step 1.7 the first request loads the confidential accounts module too (setup, decryption,
// apply), which uses the same WASM.
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";
import { createVault, loadVaultModules } from "./vault.ts";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

const vault = createVault(loadVaultModules);

scope.onmessage = (event) => {
  void vault.handle(event.data).then((response) => scope.postMessage(response));
};

scope.postMessage({ type: "ready" });
