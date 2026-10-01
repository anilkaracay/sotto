// The trust page's statements (step 3.3, built in step 3.4; 13 L6, L7, L36), each from the document
// that decides it, so the page and its tests say only what holds. No server only imports.
import { getClusterConfig } from "@sotto/sdk/cluster";

const devnet = getClusterConfig("devnet");
if (!devnet.available || !devnet.sottoProofs || !devnet.wrappedUsdcMint || !devnet.usdcMint) {
  throw new Error("the devnet cluster config lacks the trust page's addresses");
}

/** The onchain facts in the page's table, from the devnet cluster config (D-01; step 2.7). */
export const ONCHAIN = {
  network: "Solana devnet",
  usdcMint: devnet.usdcMint,
  tokenWrap: devnet.programs.tokenWrap,
  wrappedMint: devnet.wrappedUsdcMint,
  proofsProgram: devnet.sottoProofs.program,
  // VERIFICATION-LOG.md step 2.7: the build of commit 87fbc40, 44360 bytes; `solana program dump`
  // of the deployed program hashes to it over those bytes (the rest of the account is zeros).
  proofsBuildSha256: "63c4002c3db312f82632ba7723725b906c30b9833593cb5de723d6cab92f32d8",
} as const;

export type TrustCard = { id: string; title: string; body: string[] };

export const TRUST_CARDS: TrustCard[] = [
  {
    // D-02, ENGINEERING-RULES.md rules 4 and 5; 13 L7.
    id: "custody",
    title: "Non-custodial",
    body: [
      "Your organization's confidential wUSDC account belongs to your owner wallet. Sotto has no signing authority over any token account: every payment, deposit and withdrawal is a transaction your wallet signs.",
      "The USDC issuer's freeze controls still apply.",
    ],
  },
  {
    // 04 and 06: Token-2022 Confidential Balances; 07: decryption in the authorized tab only.
    id: "sealed",
    title: "Amounts sealed onchain",
    body: [
      "Balances and transfer amounts are encrypted onchain with Solana's Token-2022 Confidential Balances. Addresses, times and the fact that a payment happened stay public.",
      "Amounts are decrypted only in the browser of someone you authorize, with keys their own wallet derives. Sotto's servers store sealed records they cannot open.",
    ],
  },
  {
    // D-05, 07 section 4; 13 L6.
    id: "access",
    title: "Access per person and scope",
    body: [
      "Access is granted per person and scope. Revoking stops access from then on.",
      "Revoking cannot erase what a person already viewed, so grant only what each person needs.",
    ],
  },
  {
    // D-01, facts C3.
    id: "freeze",
    title: "The issuer's freeze authority",
    body: [
      "Wrapped USDC keeps the freeze authority of the USDC it wraps, so the USDC issuer can freeze it as it can freeze USDC. Sotto holds no freeze authority.",
    ],
  },
  {
    // D-01, the devnet beta rule of 13, L8.
    id: "devnet",
    title: "Devnet test wrap",
    body: [
      "During the beta, Sotto runs on Solana devnet with devnet USDC, which has no value. It is wrapped one to one by a test deployment of Solana's Token Wrap program whose only change is its program ID, and the app labels it devnet test wrap.",
      "Mainnet assets are not decided yet.",
    ],
  },
  {
    // 10 section 4, 05.
    id: "program",
    title: "The proof program",
    body: [
      "sotto_proofs checks proofs of funds and writes their records. It holds no funds, has no authority over any token account and never moves tokens.",
      "It has not been audited externally yet. An external audit comes before any public mainnet launch; until then the worst it can do is write an invalid proof record.",
    ],
  },
];

/** ENGINEERING-RULES.md rule 4: what never reaches Sotto's servers, logs or analytics. */
export const NEVER_HELD = [
  "Your wallet's secret key",
  "Your confidential balance keys",
  "Anyone's viewing key",
  "A plaintext amount or memo of yours",
];
