// Command line of the attestation close (src/bin/sas-close-attestation.ts).
import { parseArgs } from "node:util";
import { address, isAddress, type Address } from "@solana/kit";

export function parseCloseCli(argv: readonly string[]): { owner: Address } {
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  const { values } = parseArgs({
    args,
    options: { owner: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  if (values.owner === undefined) throw new Error("--owner <wallet> is required");
  if (!isAddress(values.owner)) throw new Error("--owner needs a wallet address");
  return { owner: address(values.owner) };
}
