// The trust page's statements (step 3.3, built in step 3.4; L7, L36), each from the document
// that decides it, so the page and its tests say only what holds. No server only imports. Step 4.3
// (D-29): once the devnet registry lists devUSD, the page adds what holds for it (Sotto issues it, its
// mint authority can mint more, it has no freeze authority and no value) and its addresses.
import { getClusterConfig } from "@sotto/sdk/cluster";
import type { AssetConfig } from "@sotto/sdk/cluster/assets";

const devnet = getClusterConfig("devnet");
if (!devnet.available || !devnet.sottoProofs || !devnet.wrappedUsdcMint || !devnet.usdcMint) {
  throw new Error("the devnet cluster config lacks the trust page's addresses");
}

/** devUSD where the devnet registry lists it (D-29), else null. */
export const DEVUSD: AssetConfig | null =
  devnet.assets.find((asset) => asset.id === "devusd") ?? null;

/** The onchain facts in the page's table, from the devnet cluster config (D-01; step 2.7). */
export const ONCHAIN = {
  network: "Solana devnet",
  usdcMint: devnet.usdcMint,
  tokenWrap: devnet.programs.tokenWrap,
  wrappedMint: devnet.wrappedUsdcMint,
  proofsProgram: devnet.sottoProofs.program,
  // Measured in step 2.7: the build of commit 87fbc40, 44360 bytes; `solana program dump`
  // of the deployed program hashes to it over those bytes (the rest of the account is zeros).
  proofsBuildSha256: "63c4002c3db312f82632ba7723725b906c30b9833593cb5de723d6cab92f32d8",
} as const;

export type TrustCard = { id: string; title: string; body: string[] };

/** The cards, with devUSD's where the registry has it (D-29). */
export function trustCards(devusd: AssetConfig | null): TrustCard[] {
  const cards = BASE_CARDS.map((card) =>
    devusd && card.id === "custody"
      ? {
          ...card,
          body: [
            "Your organization's confidential account (wUSDC, or wdevUSD for devUSD) belongs to your owner wallet. Sotto has no signing authority over any token account: every payment, deposit and withdrawal is a transaction your wallet signs.",
            "The USDC issuer's freeze controls still apply to USDC.",
          ],
        }
      : card,
  );
  if (!devusd) return cards;
  return [
    ...cards,
    {
      // D-29.
      id: "devusd",
      title: "devUSD, the devnet test dollar",
      body: [
        "devUSD is a test token Sotto issues on devnet for trying Sotto with realistic amounts. It has no value and is not a US dollar.",
        "Its mint authority is a key on Sotto's server, which can mint more: the faucet gives each wallet at most 10,000 devUSD a day. It has no freeze authority. It is wrapped one to one by the same Token Wrap test deployment as USDC.",
      ],
    },
  ];
}

const BASE_CARDS: TrustCard[] = [
  {
    // D-02, ENGINEERING-RULES.md rules 4 and 5.
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
    // D-05, 07 section 4.
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
    // D-01, the devnet beta rule.
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

export const TRUST_CARDS: TrustCard[] = trustCards(DEVUSD);
