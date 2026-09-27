// Closes the Sotto attestation of an owner wallet on devnet (step 1.6): node
// scripts/sas-close-attestation.ts --owner <wallet>. The SAS client may run only in apps/worker (D-24),
// so this runs the worker's sas:close-attestation command, which refuses mainnet and any RPC whose
// genesis hash is not devnet's, prints the attestation address and asks for confirmation.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const result = spawnSync(
  "pnpm",
  [
    "--silent",
    "--filter",
    "@sotto/worker",
    "sas:close-attestation",
    "--",
    ...process.argv.slice(2),
  ],
  { cwd: ROOT, stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
