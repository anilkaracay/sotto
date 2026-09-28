// The balance states of the org pages (step 1.7 exit test, component level): Locked never shows a
// number (AC-03.5), decrypted and public balances (AC-03.4, AC-05.1) with the devnet test wrap label on
// wUSDC (13 A25, D-01), absent accounts said in words, and the apply prompt (AC-04.3).
import type { PublicTokenBalance, TokenAccountState } from "@sotto/sdk/confidential/public";
import { address } from "@solana/kit";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ApplyPromptNotice,
  applyPromptNeeded,
} from "../app/app/_components/confidential/apply-prompt.tsx";
import {
  BalanceCards,
  type BalanceCardsProps,
} from "../app/app/_components/confidential/balances.tsx";

const OWNER = address("EQMW3o1DVsB72Ej1RRRmHLW1XaEpbjLKrMHUbS8cRLZC");
const MINT = address("AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd");
const TOKEN = address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");

const wusdc = (amount: bigint): TokenAccountState => ({
  status: "present",
  address: TOKEN,
  owner: OWNER,
  mint: MINT,
  amount,
  confidential: {
    elgamalPubkey: address("BxMVLbjVntF9DJtDjfpQLrgw4hopedMgNkZZKGcVkZp6"),
    approved: true,
    allowConfidentialCredits: true,
    allowNonConfidentialCredits: true,
    pendingBalanceCreditCounter: 1n,
    maximumPendingBalanceCreditCounter: 65_536n,
  },
});
const usdc = (amount: bigint): PublicTokenBalance => ({
  status: "present",
  address: TOKEN,
  programAddress: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  owner: OWNER,
  amount,
});

function render(props: Partial<BalanceCardsProps>) {
  return renderToStaticMarkup(
    <BalanceCards
      decimals={6}
      wrapLabel="devnet test wrap"
      loading={false}
      error={null}
      confidential={{ kind: "locked", configured: true }}
      wusdc={wusdc(15_000_000n)}
      usdc={usdc(75_000_000n)}
      {...props}
    />,
  );
}

/** The state and the visible text of one card's value. */
function card(html: string, id: string) {
  const match = new RegExp(
    `data-testid="${id}" data-state="([a-z]+)"[\\s\\S]*?data-testid="${id}-value">([\\s\\S]*?)</div>[\\s\\S]*?<p[^>]*>([\\s\\S]*?)</p>`,
  ).exec(html);
  if (!match) throw new Error(`card ${id} not found`);
  const text = (fragment: string) =>
    fragment
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return {
    state: match[1],
    value: text(match[2] ?? ""),
    note: text(match[3] ?? ""),
    html: match[0],
  };
}

describe("balance cards", () => {
  it("AC-03.5 shows the confidential balances as Locked, never as zero, until the owner unlocks", () => {
    const html = render({ confidential: { kind: "locked", configured: true } });
    for (const id of ["balance-available", "balance-pending"]) {
      const locked = card(html, id);
      expect(locked.state).toBe("locked");
      expect(locked.value).toBe("Unlock to see");
      expect(locked.html).toContain("Locked");
      expect(locked.value).not.toMatch(/\d/);
    }
    // Public balances need no keys: they show while the keys are locked.
    expect(card(html, "balance-public-wusdc").value).toBe("15 wUSDC");
    expect(card(html, "balance-public-usdc").value).toBe("75 USDC");

    // Locked without a configured account: words, not zero.
    const notSetUp = render({ confidential: { kind: "locked", configured: false } });
    expect(card(notSetUp, "balance-available")).toMatchObject({
      state: "absent",
      value: "Not set up yet",
    });
  });

  it("AC-03.4 AC-05.1 shows the decrypted available and pending balances next to public wUSDC and USDC", () => {
    const html = render({
      confidential: {
        kind: "decrypted",
        available: 10_000_000n,
        pending: 2_500_000n,
        credits: 1n,
        maximumCredits: 65_536n,
      },
    });
    expect(card(html, "balance-available")).toMatchObject({ state: "amount", value: "10 wUSDC" });
    expect(card(html, "balance-pending")).toMatchObject({ state: "amount", value: "2.5 wUSDC" });
    expect(card(html, "balance-public-wusdc")).toMatchObject({ value: "15 wUSDC" });
    expect(card(html, "balance-public-usdc")).toMatchObject({ value: "75 USDC" });
    // Every wUSDC figure carries the devnet test wrap label (D-01); USDC does not.
    for (const id of ["balance-available", "balance-pending", "balance-public-wusdc"]) {
      expect(card(html, id).note).toContain("devnet test wrap");
    }
    expect(card(html, "balance-public-usdc").note).not.toContain("devnet test wrap");
  });

  it("says in words when an account is missing, unreadable or still loading", () => {
    const html = render({
      confidential: { kind: "unreadable", reason: "key_mismatch" },
      wusdc: { status: "missing", address: TOKEN },
      usdc: { status: "missing", address: TOKEN },
    });
    expect(card(html, "balance-available")).toMatchObject({
      state: "unavailable",
      value: "Your keys cannot read this account",
    });
    expect(card(html, "balance-public-wusdc")).toMatchObject({
      state: "absent",
      value: "No account yet",
    });
    expect(card(html, "balance-public-usdc")).toMatchObject({
      state: "absent",
      value: "No USDC account",
    });
    const loading = render({ wusdc: null, usdc: null, loading: true });
    expect(card(loading, "balance-public-wusdc").state).toBe("loading");
    expect(loading).toContain("Reading from the network");
  });
});

describe("apply prompt", () => {
  it("AC-04.3 prompts the owner to apply when the worker flagged the account or the counter is at 80 percent", () => {
    expect(applyPromptNeeded({ flagged: true, credits: 3n, maximumCredits: 65_536n })).toBe(true);
    expect(applyPromptNeeded({ flagged: false, credits: 52_429n, maximumCredits: 65_536n })).toBe(
      true,
    );
    expect(applyPromptNeeded({ flagged: false, credits: 52_428n, maximumCredits: 65_536n })).toBe(
      false,
    );
    // Nothing pending: the flag is stale (the worker clears it on its next pass).
    expect(applyPromptNeeded({ flagged: true, credits: 0n, maximumCredits: 65_536n })).toBe(false);
    const html = renderToStaticMarkup(
      <ApplyPromptNotice
        credits={52_429n}
        maximumCredits={65_536n}
        action={<button type="button">Apply pending balance</button>}
      />,
    );
    expect(html).toContain("52429 deposits or payments");
    expect(html).toContain("Apply pending balance");
  });
});
