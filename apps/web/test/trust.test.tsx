// The trust page (step 3.3, built in step 3.4; 13 L6, L7, L36): every statement the founder listed
// on 2026-10-01, each true to the document that decides it: non-custodial (D-02), amounts sealed
// onchain and decrypted only in authorized browsers, the issuer's freeze authority (D-01, facts C3),
// the devnet test wrap (D-01), revocation (D-05), sotto_proofs never moves tokens and is not audited
// externally yet (10 section 4), and the recovery guide; the addresses from the devnet cluster
// config; nothing that implies mainnet, real money or an audit.
import { getClusterConfig } from "@sotto/sdk/cluster";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TrustPage from "../app/trust/page.tsx";

const html = renderToStaticMarkup(<TrustPage />);
const text = html
  .replace(/<svg[\s\S]*?<\/svg>/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replaceAll("&#x27;", "'")
  .replace(/\s+/g, " ");
const devnet = getClusterConfig("devnet");

describe("the trust page", () => {
  it("says Sotto is non-custodial and its program never moves tokens (D-02, 10 section 4)", () => {
    expect(text).toContain("Sotto has no signing authority over any token account");
    expect(text).toContain(
      "every payment, deposit and withdrawal is a transaction your wallet signs",
    );
    expect(text).toContain(
      "It holds no funds, has no authority over any token account and never moves tokens.",
    );
    expect(text).toContain("It has not been audited externally yet.");
    expect(text).toContain("An external audit comes before any public mainnet launch");
  });

  it("says the amounts are sealed onchain and open only in an authorized browser", () => {
    expect(text).toContain("Balances and transfer amounts are encrypted onchain");
    expect(text).toContain("Amounts are decrypted only in the browser of someone you authorize");
    expect(text).toContain("What Sotto never holds");
    for (const item of [
      "Your wallet's secret key",
      "Your confidential balance keys",
      "Anyone's viewing key",
      "A plaintext amount or memo of yours",
    ]) {
      expect(text).toContain(item);
    }
  });

  it("states the freeze authority, the devnet test wrap and revocation (D-01, C3, D-05, L6, L7)", () => {
    expect(text).toContain("The USDC issuer's freeze controls still apply to USDC.");
    expect(text).toContain("so the USDC issuer can freeze it as it can freeze USDC");
    expect(text).toContain("devnet test wrap");
    expect(text).toContain("devnet USDC, which has no value");
    expect(text).toContain("Mainnet assets are not decided yet.");
    expect(text).toContain(
      "Access is granted per person and scope. Revoking stops access from then on.",
    );
    expect(text).toContain("Revoking cannot erase what a person already viewed");
  });

  it("lists the onchain addresses from the devnet config, the build hash and the upgrade authority", () => {
    if (!devnet.available || !devnet.sottoProofs || !devnet.wrappedUsdcMint)
      throw new Error("devnet");
    for (const value of [
      devnet.programs.tokenWrap,
      devnet.wrappedUsdcMint,
      devnet.sottoProofs.program,
    ]) {
      expect(text).toContain(value);
    }
    expect(text).toContain("63c4002c3db312f82632ba7723725b906c30b9833593cb5de723d6cab92f32d8");
    expect(text).toContain("A Sotto key, for every program Sotto deployed, during the beta");
    // Step 4.3: devUSD's mint, its wrapped mint and its own deployment of the same build.
    const devusd = devnet.assets.find((asset) => asset.id === "devusd");
    if (!devusd?.sottoProofs) throw new Error("the devnet registry lists devUSD");
    for (const value of [devusd.baseMint, devusd.wrappedMint, devusd.sottoProofs.program]) {
      expect(text).toContain(value);
    }
    expect(text).toContain("devUSD is a test token Sotto issues on devnet");
    expect(text).toContain("It has no freeze authority.");
  });

  it("links the recovery guide and claims nothing it cannot", () => {
    expect(html).toContain('href="/app/recovery"');
    expect(text).toContain("If Sotto disappears");
    for (const claim of [
      /audited by/i,
      /available on mainnet/i,
      /open source/i,
      /real money/i,
      /\u2014|\u2013/,
    ]) {
      expect(text).not.toMatch(claim);
    }
  });
});

describe("the trust page's devUSD facts (step 4.3, D-29)", () => {
  it("adds what holds for devUSD once the devnet registry lists it, and nothing before", async () => {
    const { DEVUSD, trustCards } = await import("../app/trust/trust-facts.ts");
    const { assetConfig } = await import("@sotto/sdk/cluster/assets");
    const { address } = await import("@solana/kit");
    const mint = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    const devusd = assetConfig("devusd", { baseMint: mint, wrappedMint: mint, sottoProofs: null });
    const words = (cards: ReturnType<typeof trustCards>) =>
      cards.flatMap((card) => [card.title, ...card.body]).join(" ");
    const withDevusd = words(trustCards(devusd));
    expect(withDevusd).toContain("devUSD is a test token Sotto issues on devnet");
    expect(withDevusd).toContain("It has no value and is not a US dollar.");
    expect(withDevusd).toContain("It has no freeze authority.");
    expect(withDevusd).toContain("at most 10,000 devUSD a day");
    expect(withDevusd).toContain("The USDC issuer's freeze controls still apply to USDC.");
    const without = words(trustCards(null));
    expect(without).not.toContain("devUSD");
    // Today's devnet registry: the page names devUSD only if it is there.
    expect(text.includes("devUSD")).toBe(DEVUSD !== null);
  });
});
