// Writes the demo company's file (step 4.6, D-32): the organization's ID, the three roles' wallets
// and their derived viewing keys, and the payment the Compare views screen shows. The web reads it
// as DEMO_COMPANY_FILE and publishes those keys at /api/demo/keys.
//
// Run it on the machine that holds the demo wallets' keypair files; the keypairs never leave it.
// Each wallet signs its viewing key message here, the viewing key is derived from that signature as
// in the app, and only the derived key goes into the file: no wallet key and no signature. A viewing
// key opens the records sealed to that wallet and can do nothing else; these wallets are demo
// wallets and are used for nothing else.
//
// Usage: node scripts/demo-company-file.ts --org <org id> --payment <payment id>
//          --owner <keypair.json> --accountant <keypair.json> --employee <keypair.json> --out <file>
import { readFileSync, writeFileSync } from "node:fs";
import { deriveViewingKey, viewKeyMessage } from "@sotto/sdk/keys";
import { createKeyPairFromBytes, getAddressFromPublicKey, signBytes } from "@solana/kit";

export type DemoCompanyFile = {
  v: 1;
  cluster: "devnet";
  orgId: string;
  roles: Record<"owner" | "accountant" | "employee", { wallet: string; viewingKey: string }>;
  comparePaymentId: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The wallet of a 64 byte keypair and its derived viewing key, in base64. */
export async function demoRole(
  keypair: Uint8Array,
): Promise<{ wallet: string; viewingKey: string }> {
  const keys = await createKeyPairFromBytes(keypair);
  const wallet = await getAddressFromPublicKey(keys.publicKey);
  const signature = new Uint8Array(await signBytes(keys.privateKey, viewKeyMessage(wallet)));
  const viewing = await deriveViewingKey(wallet, signature);
  signature.fill(0);
  return { wallet, viewingKey: Buffer.from(viewing.secretKey).toString("base64") };
}

export async function demoCompanyFile(input: {
  orgId: string;
  comparePaymentId: string;
  keypairs: Record<"owner" | "accountant" | "employee", Uint8Array>;
}): Promise<DemoCompanyFile> {
  if (!UUID.test(input.orgId)) throw new Error("--org is not an organization ID");
  if (!UUID.test(input.comparePaymentId)) throw new Error("--payment is not a payment ID");
  const roles = {
    owner: await demoRole(input.keypairs.owner),
    accountant: await demoRole(input.keypairs.accountant),
    employee: await demoRole(input.keypairs.employee),
  };
  if (new Set(Object.values(roles).map((role) => role.wallet)).size !== 3) {
    throw new Error("the three roles need three different wallets");
  }
  return {
    v: 1,
    cluster: "devnet",
    orgId: input.orgId,
    roles,
    comparePaymentId: input.comparePaymentId,
  };
}

function readKeypair(path: string): Uint8Array {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed) || parsed.length !== 64) {
    throw new Error(`${path} is not a 64 byte keypair file`);
  }
  return Uint8Array.from(parsed as number[]);
}

async function main(argv: string[]): Promise<number> {
  const option = (name: string): string => {
    const at = argv.indexOf(`--${name}`);
    const value = at >= 0 ? argv[at + 1] : undefined;
    if (!value) throw new Error(`--${name} is missing`);
    return value;
  };
  try {
    const file = await demoCompanyFile({
      orgId: option("org"),
      comparePaymentId: option("payment"),
      keypairs: {
        owner: readKeypair(option("owner")),
        accountant: readKeypair(option("accountant")),
        employee: readKeypair(option("employee")),
      },
    });
    const out = option("out");
    writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o644 });
    // The wallets are public; the keys are in the file and are not printed.
    console.log(`wrote ${out}`);
    for (const [role, entry] of Object.entries(file.roles)) console.log(`${role}: ${entry.wallet}`);
    return 0;
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  process.exitCode = await main(process.argv.slice(2));
}
