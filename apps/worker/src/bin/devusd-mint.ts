// The operator's devUSD mint (step 4.3, D-29), for the demo seed's treasury, through
// The operator's `devusd-mint <wallet> <whole>` command on the hosting server: devnet only (the RPC must serve
// devnet's genesis hash and the registry's devUSD mint must name this authority), at most 2,000,000
// devUSD per call, into the wallet's associated devUSD account. The faucet's limit of 1,000,000 a day is
// for everyone else; this command is the founder's, and each run is logged with its signature.
//
//   node apps/worker/src/bin/devusd-mint.ts <wallet> <whole devUSD>
import { getClusterConfig } from "@sotto/sdk/cluster";
import { createRetryingRpc, sendWithKeypairSigners } from "@sotto/sdk/tx";
import { address, isAddress } from "@solana/kit";
import { parseRpcUrl } from "../config.ts";
import { devusdMintInstructions, readiness } from "../jobs/devusd-faucet.ts";
import { loadKeypairSigner } from "../keypair.ts";
import { log } from "../log.ts";

const MAX_WHOLE = 2_000_000n;

function fail(message: string): never {
  console.error(`devusd-mint: ${message}`);
  process.exit(1);
}

const [wallet, whole] = process.argv.slice(2);
if (!wallet || !isAddress(wallet)) fail("the first argument must be a wallet address");
if (!whole || !/^[1-9]\d{0,6}$/.test(whole) || BigInt(whole) > MAX_WHOLE) {
  fail(`the second argument must be whole devUSD from 1 to ${MAX_WHOLE}`);
}
const keypair = process.env.DEVUSD_MINT_AUTHORITY_KEYPAIR?.trim();
if (!keypair) fail("DEVUSD_MINT_AUTHORITY_KEYPAIR is not set");
const devnet = getClusterConfig("devnet");
const mint = devnet.available
  ? devnet.assets.find((asset) => asset.id === "devusd")?.baseMint
  : null;
if (!mint) fail("the devnet registry has no devUSD");
const rpc = createRetryingRpc(parseRpcUrl(process.env.RPC_URL));
const authority = await loadKeypairSigner(keypair);
const ready = await readiness({ rpc, authority, mint });
if (!ready.ok) fail(`refused: ${ready.code}`);
const amount = BigInt(whole) * 1_000_000n;
const sent = await sendWithKeypairSigners({
  rpc,
  feePayer: authority,
  instructions: await devusdMintInstructions(authority, mint, address(wallet), amount),
  finalize: true,
});
log("devusd_operator_mint", { wallet, whole, signature: sent.signature });
console.log(`minted ${whole} devUSD to ${wallet}: ${sent.signature}`);
