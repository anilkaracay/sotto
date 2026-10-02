// The asset registry and its words (step 4.3, D-29; founder, 2026-10-02): each asset's symbol, name,
// decimals and devnet test flag; every amount in the organization's own symbol, so nothing holding
// devUSD says USDC (pages, the payslip PDF, the privacy screen's amount detection); and the "Devnet
// test dollar" badge with its tooltip wherever devUSD appears, and never for USDC.
import {
  ASSET_IDS,
  ASSET_WORDS,
  DEFAULT_ASSET,
  DEVNET_USDC,
  assetConfig,
  isAssetId,
} from "@sotto/sdk/cluster/assets";
import { clusters } from "@sotto/sdk/cluster";
import { address } from "@solana/kit";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssetWordsProvider } from "../app/app/_components/asset.tsx";
import { BalanceCards } from "../app/app/_components/confidential/balances.tsx";
import { ConfidentialContext } from "../app/app/_components/confidential/context.tsx";
import { FaucetCard } from "../app/app/_components/confidential/faucet-card.tsx";
import { DevnetTestBadge } from "../app/app/_components/devnet-badge.tsx";
import { ReadinessCell } from "../app/app/[org]/recipients/readiness-cell.tsx";
import { splitAmounts } from "../lib/amount-text.ts";
import {
  assetWords,
  DEVNET_TEST_ASSET_BADGE,
  DEVNET_TEST_ASSET_TOOLTIP,
  formatAmount,
  formatWrapped,
} from "../lib/asset-words.ts";
import { chainAmountWords, chainTypeWords } from "../lib/chain-activity.ts";
import type { Payslip } from "../lib/pay.ts";
import { payslipLines } from "../lib/payslip-pdf.ts";
import { payability } from "../lib/recipient.ts";
import { assetView } from "../lib/server/network-view.ts";
import { expectAmountsInside, privacyOn } from "./helpers/amounts.ts";

const USDC = assetWords("usdc");
const DEVUSD = assetWords("devusd");
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("the asset registry (step 4.3, D-29)", () => {
  it("has USDC, the default, and devUSD, a devnet test asset, each with 6 decimals", () => {
    expect(ASSET_IDS).toEqual(["usdc", "devusd"]);
    expect(DEFAULT_ASSET).toBe("usdc");
    expect(ASSET_WORDS.usdc).toEqual({
      symbol: "USDC",
      wrappedSymbol: "wUSDC",
      displayName: "USDC",
      devnetTestAsset: false,
    });
    expect(ASSET_WORDS.devusd).toEqual({
      symbol: "devUSD",
      wrappedSymbol: "wdevUSD",
      displayName: "Sotto Devnet Test Dollar",
      devnetTestAsset: true,
    });
    const mint = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    const entry = assetConfig("devusd", { baseMint: mint, wrappedMint: mint, sottoProofs: null });
    expect(entry).toMatchObject({ id: "devusd", symbol: "devUSD", decimals: 6 });
    expect(isAssetId("devusd")).toBe(true);
    for (const bad of ["USDC", "devUSD", "", null, 1]) expect(isAssetId(bad)).toBe(false);
  });

  it("keeps devnet USDC's addresses and lists it first on devnet; mainnet has no registry", () => {
    const devnet = clusters.devnet;
    if (!devnet.available) throw new Error("devnet is available");
    expect(devnet.assets[0]).toBe(DEVNET_USDC);
    expect(devnet.usdcMint).toBe(DEVNET_USDC.baseMint);
    expect(devnet.wrappedUsdcMint).toBe(DEVNET_USDC.wrappedMint);
    expect(devnet.sottoProofs).toEqual(DEVNET_USDC.sottoProofs);
    expect(clusters.mainnet.available).toBe(false);
  });
});

describe("amounts in the organization's own symbol", () => {
  it("formats amounts and wrapped amounts in the asset's symbol", () => {
    expect(formatAmount(48_200_000_000n, DEVUSD)).toBe("48200 devUSD");
    expect(formatWrapped(1_500_000n, DEVUSD)).toBe("1.5 wdevUSD");
    expect(formatAmount(48_200_000_000n, USDC)).toBe("48200 USDC");
  });

  it("never says USDC for devUSD: chain words, readiness and the payslip PDF", () => {
    const words = [
      chainTypeWords("wrap", DEVUSD),
      chainTypeWords("unwrap", DEVUSD),
      chainAmountWords({ type: "deposit", publicAmount: "5000000" }, DEVUSD).text,
      ...(["no_account", "not_configured", "ready"] as const).map(
        (readiness) => payability(readiness, DEVUSD).reason,
      ),
    ];
    expect(words.join(" ")).not.toContain("USDC");
    expect(chainTypeWords("wrap", DEVUSD)).toBe("devUSD wrapped to wdevUSD");
    expect(chainAmountWords({ type: "deposit", publicAmount: "5000000" }, DEVUSD).text).toBe(
      "5 wdevUSD",
    );

    const slip: Payslip = {
      id: "a0000000-0000-4000-8000-000000000001",
      kind: "payroll_line",
      date: "2026-09-30T10:00:00.000Z",
      month: "2026-09",
      memo: "September salary",
      category: "payroll",
      net: 6_000_000_000n,
      gross: 8_000_000_000n,
      tax: 2_000_000_000n,
      readers: [],
      signature: null,
    };
    const document = {
      orgName: "Northwind Labs Demo Ltd",
      recipientName: "Maya",
      roleTitle: null,
      wallet: "HmEvErXi8iX36Qi9ow6qb7MAUijbiHSUXx7Tiqvq3Srq",
      slip,
    };
    const devusd = payslipLines({ ...document, asset: DEVUSD }).map((line) => line.text);
    expect(devusd).toContain("Net pay: 6000 devUSD");
    expect(devusd).toContain("Gross pay: 8000 devUSD");
    expect(devusd).toContain(
      "devUSD: devnet test dollar. A test token for trying Sotto on devnet. It has no value.",
    );
    expect(devusd.join(" ")).not.toContain("USDC");
    const usdc = payslipLines({ ...document, asset: USDC }).map((line) => line.text);
    expect(usdc).toContain("Net pay: 6000 USDC");
    expect(usdc.join(" ")).not.toContain("devUSD");
  });

  it("finds devUSD amounts for the privacy screen", () => {
    const amounts = splitAmounts("Funded 30 wdevUSD; at least 250,000 devUSD, or 100k devUSD.")
      .filter((part) => part.amount)
      .map((part) => part.text);
    expect(amounts).toEqual(["30 wdevUSD", "250,000 devUSD", "100k devUSD"]);
  });

  it("names devUSD on the balance cards, every figure behind the privacy screen", () => {
    const html = renderToStaticMarkup(
      privacyOn(
        <BalanceCards
          asset={DEVUSD}
          decimals={6}
          wrapLabel="devnet test wrap"
          loading={false}
          error={null}
          confidential={{
            kind: "decrypted",
            available: 1_500_000_000_000n,
            pending: 0n,
            credits: 0n,
            maximumCredits: 65536n,
          }}
          wusdc={null}
          usdc={{
            status: "missing",
            address: address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"),
          }}
        />,
      ),
    );
    expectAmountsInside(html);
    const words = text(html);
    expect(words).toContain("1500000 wdevUSD");
    expect(words).toContain("Public devUSD");
    expect(words).toContain("No devUSD account");
    expect(words).toContain(DEVNET_TEST_ASSET_BADGE);
    expect(words).not.toContain("USDC");
  });

  it("gives the organization's words to every component under the provider", () => {
    const html = renderToStaticMarkup(
      <AssetWordsProvider asset={DEVUSD}>
        <ReadinessCell readiness="no_account" />
      </AssetWordsProvider>,
    );
    expect(text(html)).toContain("there is no wdevUSD account at this wallet");
    expect(text(renderToStaticMarkup(<ReadinessCell readiness="no_account" />))).toContain(
      "there is no wUSDC account at this wallet",
    );
  });
});

describe("the devnet test dollar badge", () => {
  it("shows for devUSD with its tooltip, and never for USDC", () => {
    const html = renderToStaticMarkup(<DevnetTestBadge asset={DEVUSD} />);
    expect(text(html)).toBe("Devnet test dollar");
    expect(html).toContain('title="A test token for trying Sotto on devnet. It has no value."');
    expect(html).toContain(`aria-label="${DEVNET_TEST_ASSET_BADGE}: ${DEVNET_TEST_ASSET_TOOLTIP}"`);
    expect(html).toContain('tabindex="0"');
    expect(renderToStaticMarkup(<DevnetTestBadge asset={USDC} />)).toBe("");
  });
});

describe("the devUSD faucet card", () => {
  it("names devUSD, says it has no value and its daily limit, with the badge", () => {
    const value = {
      orgId: "3f1b6a2e-5c4d-4e8f-9a0b-1c2d3e4f5a6b",
      network: { cluster: "devnet", asset: assetView("devusd") },
      refresh: async () => {},
    };
    const html = renderToStaticMarkup(
      <ConfidentialContext.Provider value={value as never}>
        <FaucetCard />
      </ConfidentialContext.Provider>,
    );
    const words = text(html);
    expect(words).toContain("Get devUSD Devnet test dollar");
    expect(words).toContain("devUSD is a test token for trying Sotto on devnet. It has no value.");
    expect(words).toContain("up to 10,000 devUSD every 24 hours");
    expect(words).not.toContain("USDC");
    // Nothing to ask for before the faucet's state is read.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Get devUSD<\/button>/);
  });
});
