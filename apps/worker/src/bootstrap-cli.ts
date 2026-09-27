// Command line of the SAS bootstrap (src/bin/bootstrap-sas.ts).
import { parseArgs } from "node:util";
import { address, isAddress, type Address } from "@solana/kit";

export type BootstrapCluster = "devnet" | "localnet";

export function parseCli(argv: readonly string[]): {
  cluster: BootstrapCluster;
  testOwner: Address | null;
  /** Localnet only: a keypair file to use instead of SAS_SIGNER_KEYPAIR (scripts/bootstrap-localnet.ts). */
  signer: string | null;
} {
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  const { values } = parseArgs({
    args,
    options: {
      cluster: { type: "string" },
      "test-attestation": { type: "string" },
      signer: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.cluster === "mainnet") {
    throw new Error("mainnet is refused: Sotto writes to devnet and localnet only (D-01)");
  }
  if (values.cluster !== "devnet" && values.cluster !== "localnet") {
    throw new Error("--cluster devnet or --cluster localnet is required");
  }
  const owner = values["test-attestation"];
  if (owner !== undefined && !isAddress(owner)) {
    throw new Error("--test-attestation needs a wallet address");
  }
  if (values.signer !== undefined && values.cluster !== "localnet") {
    throw new Error("--signer is for localnet only; devnet uses SAS_SIGNER_KEYPAIR");
  }
  return {
    cluster: values.cluster,
    testOwner: owner === undefined ? null : address(owner),
    signer: values.signer ?? null,
  };
}
