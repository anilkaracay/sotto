// F-19 (AC-19.1; step 2.9): the proof program's health from the worker's verdict in cluster_health
// (failing, or no success within 15 minutes), an unreachable network told apart from it (D-14), the
// shell's banner in words, and every confidential action disabled with its explanation while public
// ones keep working: account setup, deposit and apply, a payment, a payroll run, a confidential
// withdrawal and a proof of funds; the public unwrap stays available.
import { clusterHealth } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { healthState, PROGRAM_BLOCKED, programDetail, UNREACHABLE_TITLE } from "../lib/health.ts";
import { programHealthOf, readProgramHealth } from "../lib/server/program-health.ts";
import { assetView, type NetworkView } from "../lib/server/network-view.ts";
import { expectAmountsInside, privacyOn } from "./helpers/amounts.ts";
import { setUpApiTest, tearDownApiTest } from "./helpers/api.ts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined, push: () => undefined }),
}));

const { HealthBannerView } = await import("../app/app/_components/health-banner.tsx");
const { ConfidentialContext } = await import("../app/app/_components/confidential/context.tsx");
const { KeySessionContext } = await import("../app/app/_components/key-session.tsx");
const { AccountCard, FundingCard } =
  await import("../app/app/_components/confidential/account-cards.tsx");
const { WithdrawForm } = await import("../app/app/_components/confidential/withdraw.tsx");
const { PayCard } = await import("../app/app/[org]/payments/new/payments-panel.tsx");
const { ApplyPending } = await import("../app/app/[org]/pay/pay-panel.tsx");
const { Builder, Proofs } = await import("../app/app/[org]/proofs/proofs-panel.tsx");
const { RunView } = await import("../app/app/[org]/payroll/[run]/run-panel.tsx");

const NOW = new Date("2026-09-30T10:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

function network(
  check: "ok" | "unreachable",
  proofProgram: Extract<NetworkView, { available: true }>["proofProgram"],
): Extract<NetworkView, { available: true }> {
  return {
    available: true,
    cluster: "devnet",
    label: "Devnet",
    chain: "solana:devnet",
    wrapLabel: "devnet test wrap",
    tokenWrapProgram: "EEvqpjNRQkNRwXzVziuTGGi1wYDiPv7haYVVu3XZCoQn",
    asset: assetView("usdc"),
    assets: [assetView("usdc")],
    baseMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    baseTokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    wrappedMint: "AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd",
    decimals: 6,
    v1: true,
    check: check === "ok" ? { status: "ok" } : { status: "unreachable" },
    proofProgram,
  };
}
const DOWN = { status: "unavailable", reason: "failing", checkedAt: NOW.toISOString() } as const;

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();

let test: TestDatabase;
beforeAll(async () => {
  test = await setUpApiTest();
});
afterAll(async () => {
  await tearDownApiTest(test);
});

describe("proof program health (F-19)", () => {
  it("AC-19.1 is unavailable when the latest verdict failed or no success came within 15 minutes", async () => {
    expect(programHealthOf({ ok: true, checkedAt: minutesAgo(4) }, NOW)).toEqual({ status: "ok" });
    expect(programHealthOf({ ok: true, checkedAt: minutesAgo(15) }, NOW)).toEqual({ status: "ok" });
    expect(programHealthOf({ ok: true, checkedAt: minutesAgo(16) }, NOW)).toEqual({
      status: "unavailable",
      reason: "stale",
      checkedAt: minutesAgo(16).toISOString(),
    });
    expect(programHealthOf({ ok: false, checkedAt: minutesAgo(1) }, NOW)).toMatchObject({
      status: "unavailable",
      reason: "failing",
    });
    expect(programHealthOf(null, NOW)).toEqual({
      status: "unavailable",
      reason: "stale",
      checkedAt: null,
    });
    // From the worker's row in cluster_health.
    expect(await readProgramHealth(test.db, "devnet", NOW)).toMatchObject({ reason: "stale" });
    await test.db
      .insert(clusterHealth)
      .values({ cluster: "devnet", proofProgramOk: true, checkedAt: minutesAgo(5) });
    expect(await readProgramHealth(test.db, "devnet", NOW)).toEqual({ status: "ok" });
    await test.db
      .update(clusterHealth)
      .set({ proofProgramOk: false, detail: "simulation failed", checkedAt: minutesAgo(1) });
    expect(await readProgramHealth(test.db, "devnet", NOW)).toMatchObject({ reason: "failing" });
  });

  it("AC-19.1 shows the banner: funds safe, no withdrawal until the program is back, public actions keep working", () => {
    const html = renderToStaticMarkup(<HealthBannerView network={network("ok", DOWN)} />);
    expect(html).toContain('data-testid="proof-program-banner"');
    expect(html).toContain('role="alert"');
    const words = text(html);
    expect(words).toContain("Confidential actions are paused");
    expect(words).toContain("Your funds are safe");
    expect(words).toContain(
      "Confidential balances cannot be withdrawn until the program is active again",
    );
    expect(words).toContain("public balances and public actions keep working");
    expect(programDetail("Devnet")).toContain("not available on Devnet");
    expect(
      renderToStaticMarkup(<HealthBannerView network={network("ok", { status: "ok" })} />),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <HealthBannerView
          network={{ available: false, label: "Mainnet", asset: assetView("usdc") }}
        />,
      ),
    ).toBe("");
  });

  it("AC-19.1 says Network unreachable, retrying instead when the network cannot be reached (D-14)", () => {
    const view = network("unreachable", DOWN);
    expect(healthState(view)).toBe("unreachable");
    const html = renderToStaticMarkup(<HealthBannerView network={view} />);
    expect(html).toContain('data-testid="network-unreachable"');
    expect(text(html)).toContain(UNREACHABLE_TITLE);
    expect(text(html)).toContain("tries again every 15 seconds");
    expect(html).not.toContain("proof-program-banner");
    expect(healthState(network("ok", DOWN))).toBe("program_unavailable");
    expect(healthState(network("ok", { status: "ok" }))).toBe("ok");
  });
});

/** Renders `node` with a confidential context whose program is unavailable (or not). */
function paused(
  node: ReactNode,
  blocked: string | null = PROGRAM_BLOCKED,
  wusdc: object = { status: "present", amount: 2_000_000n, configured: true },
) {
  const value = {
    wallet: "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L",
    orgId: "3f1b6a2e-5c4d-4e8f-9a0b-1c2d3e4f5a6b",
    network: network("ok", blocked ? DOWN : { status: "ok" }),
    wallets: [],
    setAccount: () => undefined,
    ready: true,
    vault: {
      worker: () => {
        throw new Error("no worker in this test");
      },
      unlocked: { elgamalPubkey: "BxMVLbjVntF9DJtDjfpQLrgw4hopedMgNkZZKGcVkZp6" },
      unlock: async () => ({ elgamalPubkey: "" }),
      lock: () => undefined,
      hold: () => () => undefined,
      lockReason: null,
    },
    connected: {
      signer: { address: "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L" },
      account: { address: "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L" },
      version: 1,
      info: { name: "Test Wallet" },
    },
    data: {
      loading: false,
      error: null,
      usdcAccount: "3jQWYMoKNXGmYZESFLYYWd8u64yywAwGXBsP3G4bzj2s",
      wusdcAccount: "5xhtiW4M8bbModvzx4ckUvVpFRZmz7bm8q1HHLdh88ja",
      usdc: { status: "present", amount: 9_000_000n },
      wusdc,
      confidential: {
        kind: "decrypted",
        available: 5_000_000n,
        pending: 1_000_000n,
        credits: 1n,
        maximumCredits: 65536n,
      },
    },
    refresh: async () => undefined,
    blocked,
  };
  const keys = {
    session: {},
    unlocked: null,
    viewing: { wallet: value.wallet, publicKey: new Uint8Array(32) },
    lockReason: null,
    shared: null,
    setShared: () => undefined,
  };
  return renderToStaticMarkup(
    <KeySessionContext.Provider value={keys as never}>
      <ConfidentialContext.Provider value={value as never}>
        {privacyOn(node)}
      </ConfidentialContext.Provider>
    </KeySessionContext.Provider>,
  );
}

/** The `disabled` attribute of the button whose text contains `label`. */
function buttonDisabled(html: string, label: string): boolean {
  const button = [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)]
    .map((match) => match[0])
    .find((markup) => text(markup).includes(label));
  if (!button) throw new Error(`no button "${label}" in ${text(html)}`);
  return /\sdisabled=""/.test(button);
}

describe("confidential actions while the proof program is unavailable (F-19)", () => {
  const owner = {
    userId: "u1",
    wallet: "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L",
    publicKey: "k",
    signature: "s",
  };

  it("AC-19.1 disables account setup with the explanation", () => {
    const html = paused(<AccountCard recorded={null} />, PROGRAM_BLOCKED, {
      status: "missing",
      address: "5xhtiW4M8bbModvzx4ckUvVpFRZmz7bm8q1HHLdh88ja",
    });
    expect(buttonDisabled(html, "Set up the account")).toBe(true);
    expect(html).toContain('data-testid="action-paused"');
    expect(text(html)).toContain(PROGRAM_BLOCKED);
  });

  it("AC-19.1 disables funding, deposit and apply with the explanation", () => {
    const html = paused(<FundingCard recorded={null} />);
    expect(html).toContain('data-testid="action-paused"');
    expectAmountsInside(html);
    for (const label of ["Fund account", "Apply pending balance", "Deposit"]) {
      expect(buttonDisabled(html, label)).toBe(true);
    }
  });

  it("AC-19.1 disables a confidential withdrawal but keeps the public unwrap", () => {
    const html = paused(<WithdrawForm />);
    expect(buttonDisabled(html, "Withdraw")).toBe(true);
    expect(buttonDisabled(html, "Unwrap")).toBe(false);
    expect(text(html)).toContain("Available now: 5 wUSDC");
    expectAmountsInside(html);
    expect(text(html)).toContain(PROGRAM_BLOCKED);
    // Not paused, the same form can withdraw.
    expect(buttonDisabled(paused(<WithdrawForm />, null), "Withdraw")).toBe(false);
  });

  it("AC-19.1 disables a payment with the explanation", () => {
    const html = paused(<PayCard recipients={[]} ownerKey={owner} />);
    expect(buttonDisabled(html, "Pay")).toBe(true);
    expect(text(html)).toContain(PROGRAM_BLOCKED);
  });

  it("AC-19.1 disables applying the pending balance on My pay", () => {
    const html = paused(<ApplyPending />);
    expect(buttonDisabled(html, "Apply pending balance")).toBe(true);
    expect(text(html)).toContain(PROGRAM_BLOCKED);
  });

  it("AC-19.1 disables a payroll run with the explanation", () => {
    const run = {
      id: "r1",
      title: "October payroll",
      period: "2026-10",
      status: "draft",
      lineCount: 0,
      idempotencyKey: "k",
      createdAt: NOW.toISOString(),
      executedAt: null,
      createdBy: { userId: "u1", displayName: null, wallet: owner.wallet },
      lines: [],
      readers: [],
      contentsHash: "h",
      approvals: { required: 1, messages: 0, execution: null },
    };
    const html = paused(
      <RunView orgId="o" run={run} you={{ displayName: null }} viewerKeys={{}} ownerKey={owner} />,
    );
    expect(html).toMatch(
      /data-testid="run-button"[^>]*disabled=""|disabled=""[^>]*data-testid="run-button"/,
    );
    expect(text(html)).toContain(PROGRAM_BLOCKED);
  });

  it("AC-19.1 disables a proof of funds with the explanation, and with the program's pause", () => {
    for (const stopped of [PROGRAM_BLOCKED, "Paused while the Sotto proof program is paused."]) {
      const html = renderToStaticMarkup(
        <Builder running={false} again={false} ready stopped={stopped} onProve={() => undefined} />,
      );
      expect(buttonDisabled(html, "Generate proof")).toBe(true);
      expect(text(html)).toContain(stopped);
    }
    const ready = renderToStaticMarkup(
      <Builder running={false} again={false} ready stopped={null} onProve={() => undefined} />,
    );
    expect(buttonDisabled(ready, "Generate proof")).toBe(false);
  });

  it("AC-19.1 shows the paused sotto_proofs program on the proofs page, and payments are not affected", () => {
    const view = network("ok", { status: "ok" });
    const html = paused(
      <Proofs
        orgId="o"
        orgName="Acme"
        network={view}
        program="4rMKgJWgawaTTdUxaudUXthEExnRZ7AvFvqzsoEAr9jd"
        proofs={[]}
        paused
      />,
      null,
    );
    expect(html).toContain('data-testid="proofs-paused"');
    expect(text(html)).toContain("Payments are not affected");
    expectAmountsInside(html);
    expect(buttonDisabled(html, "Generate proof")).toBe(true);
    expect(text(html)).toContain("Paused while the Sotto proof program is paused.");
    // The program's pause does not stop a payment: only the ZK ElGamal Proof program's health does.
    const pay = paused(<PayCard recipients={[]} ownerKey={owner} />, null);
    expect(pay).not.toContain("action-paused");
  });
});
