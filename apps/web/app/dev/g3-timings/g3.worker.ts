// The Gate G3 measurements inside a Web Worker, where the product makes its proofs (04 section 5).
import { measure } from "./measure";

self.onmessage = () => {
  measure("worker").then(
    (result) => self.postMessage(result),
    (error: unknown) => self.postMessage({ error: String(error) }),
  );
};
