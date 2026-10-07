// The landing (F-17, AC-17.1; step 3.1): the approved landing design with every approved copy
// correction, the devnet beta rule and the founder's rules of 2026-09-30 (no open source claim while
// the repository is private, the Revenue use case removed, L31 on every board mention, L2 and L19 on
// every "one transaction" caption, Privacy and Terms hidden until D-23, the event's name).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Landing } from "../app/_landing/landing.tsx";
import { SAMPLES } from "../app/_landing/sections/developers.tsx";
import { Steps } from "../app/_landing/sections/steps.tsx";
import { proofWords } from "../app/_landing/use-landing.ts";

const html = renderToStaticMarkup(<Landing />);
const text = html
  .replace(/<svg[\s\S]*?<\/svg>/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replaceAll("&#x27;", "'")
  .replaceAll("&quot;", '"')
  .replaceAll("&amp;", "&")
  .replace(/\s+/g, " ");
const links = [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
  href: m[1] ?? "",
  label: (m[2] ?? "").replace(/<[^>]+>/g, "").trim(),
}));

describe("the landing (AC-17.1)", () => {
  it("AC-17.1 applies the hero rows: L1, L2, L15 and L27", () => {
    expect(text).toContain("back on in June 2026");
    expect(text).not.toContain("August 2026");
    expect(text).toContain("Every line settles on Solana.");
    expect(text).toContain("Readable by Daniel, your accountant");
    expect(text).toContain("Sample data. Public view");
    expect(text).toContain("Beta on Solana devnet");
    expect(links.find((link) => link.label === "Sign in")?.href).toBe("/app");
    // The footer's Trust and Security open the trust page.
    expect(links.filter((link) => link.label === "Security").map((link) => link.href)).toEqual([
      "/trust",
      "/trust",
    ]);
  });

  it("AC-17.1 replaces the market statistics with facts from recorded measurements", () => {
    for (const gone of ["733%", "226 billion", "Fewer than 1%", "Fireblocks", "McKinsey"]) {
      expect(text).not.toContain(gone);
    }
    for (const fact of [
      "A confidential payment is one Solana transaction in Solflare.",
      "A 24 person payroll run takes 3 wallet approvals.",
      "Verifying a proof of funds onchain costs about 13,000 compute units.",
      "No amount or memo reaches Sotto's servers in plaintext.",
    ]) {
      expect(text).toContain(fact);
    }
    // Plain words for a business reader; a wallet is named only where the log measured it.
    expect(text).toContain(
      "Measured on a local Solana validator with a test wallet, September 2026",
    );
    expect(text).not.toContain("version 1 wallet");
  });

  it("AC-17.1 says Proven and at least, never True, False or above (L3, L5, L26)", () => {
    expect(text).not.toMatch(/\b(True|False)\b/);
    expect(text).toContain("Proven");
    expect(text).toContain("Balance is at least 250,000 USDC");
    expect(text).toContain("Prove the balance is at least");
    expect(text).not.toMatch(/Balance above|Statement: above/);
    expect(proofWords(true)).toEqual({
      result: "Proven",
      sub: "The statement holds. The balance stays sealed.",
    });
    expect(proofWords(false)).toEqual({
      result: "Not proven",
      sub: "This statement could not be proven. Nothing else was revealed.",
    });
    expect(text).not.toContain("talked into a yes");
    expect(text).toContain("A Solana program. Not us.");
  });

  it("AC-17.1 keeps the illustrations' figures sample and invented ids out", () => {
    expect(text).toContain("Example: 2,140 people in 31 countries");
    expect(text).toContain("Sample statement of account");
    for (const gone of ["312,448,901", "7c1e", "99.8%"]) expect(text).not.toContain(gone);
  });

  it("AC-17.1 removes the board, the multisig approvals and the Revenue use case (founder)", () => {
    expect(text).not.toMatch(/\bboard\b/i);
    expect(html).not.toContain("u-board");
    expect(text).not.toMatch(/multisig|2 of 3/);
    // The second step's preview, which shows while that step is active.
    const second = renderToStaticMarkup(
      <Steps v={{ steps: [], step0: false, step1: true, step2: false } as never} />,
    );
    expect(second).toContain("Approved by the owner, recorded in Sotto");
    expect(second).not.toMatch(/multisig|2 of 3|u-ak|u-se/);
    const third = renderToStaticMarkup(
      <Steps v={{ steps: [], step0: false, step1: false, step2: true } as never} />,
    );
    expect(third).not.toMatch(/Board|Treasury and totals/);
    expect(text).toContain("Your accountant sees the runway. The market doesn't.");
    expect(text).not.toMatch(/\bRevenue\b|revenue never/);
  });

  it("AC-17.1 claims no open source and calls the real SDK, labelled Preview", () => {
    expect(text).not.toMatch(/open source/i);
    expect(html).toContain('data-testid="sdk-preview"');
    expect(text).not.toContain("npm i");
    for (const gone of [
      "sotto_verifier",
      "CPI",
      "verify.rs",
      "Anchor",
      "mainnet-beta",
      "keys.grant",
      "viewers: [accountant, board]",
      "Read the docs",
      "GitHub",
    ]) {
      expect(text).not.toContain(gone);
    }
    // Every sample tab, not only the first the page renders.
    const code = SAMPLES.map((sample) =>
      [
        ...sample.lines.flat().map((token) => (typeof token === "string" ? token : token[1])),
        ...sample.output,
        sample.result,
      ].join(" "),
    ).join("\n");
    for (const real of [
      "payPayrollLines",
      "sealPayload",
      "balanceThresholdProofs",
      "/grants",
      "holderName",
    ]) {
      expect(code).toContain(real);
    }
    for (const gone of [
      "sotto_verifier",
      "keys.grant",
      "mainnet-beta",
      "one transaction",
      "board",
    ]) {
      expect(code).not.toContain(gone);
    }
    expect(text).toContain("Tested with Solflare and Phantom.");
    expect(text).not.toMatch(/Backpack|any Solana wallet|Any Solana wallet|embedded or hardware/);
    expect(text).not.toMatch(/one transaction/i);
  });

  it("AC-17.1 answers the FAQ with what the build does (L8, L9, L10, L21, L22, D-05)", () => {
    expect(text).toContain(
      "During the beta, Sotto runs on Solana devnet with devnet USDC, wrapped one to one by Token Wrap, and devUSD, a test dollar with no value. On mainnet, USDG and PYUSD already carry the confidential extension, but each confidential account needs the issuer's approval, so Sotto uses Token Wrap until then.",
    );
    expect(text).toContain("Devnet USDC during the beta");
    expect(text).toContain("Today they connect a Solana wallet. Email claim is coming.");
    expect(text).not.toContain("maya@northwind.com");
    expect(text).toContain("Daniel and your auditor, each with their own scope");
    // D-05: revoking stops access from then on and cannot erase what was already viewed.
    expect(text).toContain(
      "Revoking stops access from then on; it cannot erase what was already viewed.",
    );
    expect(text).not.toContain("revoke it at any time");
    expect(text).toContain("It gets an external audit before public mainnet.");
    expect(text).toContain("During the beta, screening uses a deny list.");
    expect(text).not.toContain("sanctions lists");
    expect(text).not.toContain("Every message is read by the team");
  });

  it("AC-17.1 closes with the devnet request form and the footer rows (L24, L25, L28, D-23)", () => {
    expect(text).toContain("The beta runs on Solana devnet.");
    expect(html).toMatch(
      /<input[^>]*type="email"[^>]*autoComplete="email"|<input[^>]*autocomplete="email"/i,
    );
    expect(html).toMatch(/autocomplete="organization"/i);
    expect(text).toContain("Work email");
    expect(text).toContain("Company");
    expect(text).toContain("Built for Colosseum's Crypto World's Fair");
    expect(links.map((link) => link.label)).not.toEqual(
      expect.arrayContaining(["Privacy", "Terms", "Docs", "GitHub", "Revenue"]),
    );
    for (const label of ["Privacy", "Terms"]) {
      expect(links.some((link) => link.label === label)).toBe(false);
    }
  });
});

describe("the landing's copy of step 4.4 (founder, 2026-10-04)", () => {
  it("names the category in the eyebrow and keeps the headline", () => {
    expect(text).toContain("Selective privacy for onchain finance");
    expect(text).toContain("Private books.");
    expect(text).toContain("Public chain.");
    expect(text).toContain(
      "Amounts sealed on Solana. Every reader sees only their scope. Prove your balance without showing it.",
    );
    expect(text).toContain(
      "Solana switched confidential transfers back on in June 2026. Sotto is the business account built on them.",
    );
    expect(text).not.toContain("Confidential payments on Solana");
  });

  it("never says selective privacy and confidential in one sentence", () => {
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (/selective privacy/i.test(sentence)) expect(sentence).not.toMatch(/confidential/i);
    }
  });

  it("shows Atlas Freight, October and 250,000 USDC in the sample data", () => {
    expect(text).not.toMatch(/Hollis|September payroll|Payslip, September|\$100,000/);
    expect(text).toContain("Atlas Freight");
    expect(text).toContain("October payroll");
    expect(text).toContain("Northwind Labs, October 2026");
  });

  it("shows the Solana mark in its brand color and Circle's USDC lockup, with the trademark line", () => {
    expect(html).toContain('fill="#9945FF"');
    expect(html).toContain('aria-label="USDC"');
    expect(html).toContain('viewBox="0 0 1068 309"');
    expect(text).toContain("All trademarks are property of their respective owners.");
  });
});

describe("request access on the landing (AC-17.2)", () => {
  it("AC-17.2 asks for the work email, the company and an explicit consent, with no email promised", async () => {
    const { CONSENT_TEXT, RequestAccessForm, requestProblem } =
      await import("../app/_landing/request-access.tsx");
    const { ApiCallError } = await import("../lib/client/api.ts");
    const form = renderToStaticMarkup(<RequestAccessForm />);
    expect(form).toContain('type="checkbox"');
    expect(form).toContain(CONSENT_TEXT);
    expect(form).not.toMatch(/disabled=""/);
    expect(form).not.toMatch(/confirm|inbox|email you/i);
    expect(requestProblem(new ApiCallError(429, "rate_limited", "Too many requests"))).toBe(
      "Too many requests from this network. Try again later.",
    );
    expect(
      requestProblem(
        new ApiCallError(400, "invalid_request", "Invalid request: email: Invalid email address"),
      ),
    ).toBe("Enter your work email.");
    expect(
      requestProblem(
        new ApiCallError(400, "invalid_request", "Invalid request: consent: Tick the box"),
      ),
    ).toBe("Tick the box to agree that Sotto stores your details.");
    expect(requestProblem(new Error("offline"))).toBe("Sotto could not be reached. Try again.");
  });
});
