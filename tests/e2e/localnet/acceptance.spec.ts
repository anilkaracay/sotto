// The hackathon acceptance scenario (12, D-27; step 2.10) as one end to end run on localnet, in order,
// every step through the app with the injected test wallet: (1) the owner signs in and creates the
// organization, the E2E admin approves it and the worker issues its SAS attestation; (2) the owner
// unlocks, registers the viewing key, sets up the confidential account and funds it; (3) the owner
// adds three recipients, and each accepts the invite, unlocks, registers a viewing key and sets up
// the account; (4) a payroll CSV for the three runs to settlement; (5) an accountant invited with
// every amount accepts, the owner shares the past records, and the accountant's Books hold exactly the
// three lines and export them; (6) a recipient reads the payslip on My pay; (7) the owner proves the
// balance is at least $10 and a signed out browser sees Proven with the attested legal name; (8) with
// the privacy screen on, no amount on the overview is readable. Across the run: no request, browser
// console line or server log line holds an amount or memo of the scenario (I-2), no browser context
// logs an error or warning, the health banner never shows, and every balance shown equals the chain
// read here. A full page screenshot per step goes to this test's output directory (git ignored) and,
// once the run passes, to .demo-shots/<UTC time>/ (git ignored, never cleared by Playwright); the step
// times go to the report. The memos hold a comma, so the payroll CSV quotes them (RFC 4180). Only the
// wallets' SOL and USDC come from outside the app: the local faucet on localnet, wallet A on devnet.
// Runs in the localnet job of scripts/ci-local.sh; since step 3.11 also on devnet against the running
// app and worker with fresh keypairs, through pnpm acceptance:devnet (acceptance-target.ts, 14).
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { decodeBusinessAttestation } from "@sotto/sdk/attestation";
import { decryptTokenAccount } from "@sotto/sdk/confidential";
import {
  associatedTokenAccount,
  decodeToken2022Account,
  formatTokenAmount,
  readPublicTokenBalance,
} from "@sotto/sdk/confidential/public";
import { confidentialKeysMessage, deriveStandardKeys } from "@sotto/sdk/keys";
import {
  address,
  createKeyPairSignerFromBytes,
  fetchEncodedAccount,
  signBytes,
  type Address,
} from "@solana/kit";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { acceptanceTarget } from "../acceptance-target.ts";
import {
  addTestWallet,
  ANY_APP_PAGE,
  approveOrg,
  clientAddress,
  expectAmountsWrapped,
  openSetup,
  OVERVIEW_URL,
  privacyScreenOn,
  signIn,
} from "../helpers.ts";
import { expectAccessible } from "../a11y.ts";
import { expectVisual } from "../visual.ts";

const target = await acceptanceTarget();
const rpc = target.rpc;
const PAY_URL = /\/app\/[0-9a-f-]{36}\/pay$/;
const RUN_URL = /\/app\/[0-9a-f-]{36}\/payroll\/[0-9a-f-]{36}$/;
const LEGAL_NAME = target.legalName;
const OWNER = target.owner;
const ACCOUNTANT = target.accountant;
const DECIMALS = 6;
const V1_WALLET = "window.__sottoTestWalletVersions = ['legacy', 0, 1];";
/** The owner's deposit, public onchain by design (I-2 exempts it). */
const FUNDING = target.funding;
/** I-2: net, gross and tax per line and a memo, never used for a deposit or a withdrawal. */
const PEOPLE = [
  {
    name: "Maya Chen",
    team: "Design",
    memo: "Salary, ref 7301",
  },
  {
    name: "Idris Kaya",
    team: "Engineering",
    memo: "Salary, ref 7302",
  },
  {
    name: "Lena Novak",
    team: "Growth",
    memo: "Salary, ref 7303",
  },
].map((person, index) => {
  const { net, tax } = target.lines[index] ?? { net: 0n, tax: 0n };
  return { ...person, net, tax, gross: net + tax, keypair: target.people[index] ?? [] };
});
const TOTAL = PEOPLE.reduce((sum, person) => sum + person.net, 0n);
const show = (base: bigint) => formatTokenAmount(base, DECIMALS);
/** Every amount and memo of the scenario that must never leave a browser in plaintext. */
const SECRETS = PEOPLE.flatMap((person) => [
  ...[person.net, person.gross, person.tax].flatMap((base) => [show(base), base.toString()]),
  person.memo,
]).concat([TOTAL, FUNDING * 1_000_000n - TOTAL].flatMap((base) => [show(base), base.toString()]));

type Person = {
  address: Address;
  usdc: Address;
  keys: Awaited<ReturnType<typeof deriveStandardKeys>>;
};

/** A wallet with SOL and whole USDC (the local faucet, or wallet A before a devnet run), and its keys. */
async function person(keypair: number[], sol: bigint, usdc: bigint): Promise<Person> {
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(keypair));
  const usdcAccount = await target.prepare(signer.address, sol, usdc);
  const signature = new Uint8Array(
    await signBytes(signer.keyPair.privateKey, confidentialKeysMessage()),
  );
  return {
    address: signer.address,
    usdc: usdcAccount,
    keys: await deriveStandardKeys(signer.address, signature),
  };
}

async function publicBalance(account: Address): Promise<bigint> {
  const balance = await readPublicTokenBalance(rpc, account);
  return balance.status === "present" ? balance.amount : 0n;
}

/** A public USDC balance, or null where the wallet has no USDC account (a devnet recipient). */
async function publicUsdcBalance(account: Address): Promise<bigint | null> {
  const balance = await readPublicTokenBalance(rpc, account);
  return balance.status === "present" ? balance.amount : null;
}

/** The balances a page shows, read from chain here and decrypted with the owner's own keys. */
async function chainBalances(who: Person) {
  const wusdc = await associatedTokenAccount(who.address, target.wrappedUsdcMint);
  const account = await fetchEncodedAccount(rpc, wusdc, { commitment: "confirmed" });
  if (!account.exists) throw new Error("the wUSDC account does not exist");
  const decrypted = decryptTokenAccount(
    decodeToken2022Account(new Uint8Array(account.data)),
    who.keys,
  );
  return {
    available: decrypted.available,
    pending: decrypted.pending,
    publicWusdc: await publicBalance(wusdc),
    publicUsdc: await publicUsdcBalance(who.usdc),
  };
}

/** Every balance card on the page equals the chain (AC-04.4), read again until they agree. */
async function expectBalancesFromChain(page: Page, who: Person) {
  const value = (card: string) => page.getByTestId(`${card}-value`);
  await expect(async () => {
    const chain = await chainBalances(who);
    await expect(value("balance-available")).toHaveText(`${show(chain.available)} wUSDC`, {
      timeout: 2_000,
    });
    await expect(value("balance-pending")).toHaveText(`${show(chain.pending)} wUSDC`, {
      timeout: 2_000,
    });
    await expect(value("balance-public-wusdc")).toHaveText(`${show(chain.publicWusdc)} wUSDC`, {
      timeout: 2_000,
    });
    // The page's words for a wallet without a USDC account (balances.tsx publicUsdcValue).
    await expect(value("balance-public-usdc")).toHaveText(
      chain.publicUsdc === null ? "No USDC account" : `${show(chain.publicUsdc)} USDC`,
      { timeout: 2_000 },
    );
  }).toPass({ timeout: 90_000 * target.slow });
  return chainBalances(who);
}

/** What every browser context of the run sent, logged and showed (the checks across the run). */
type Watch = { traffic: string[]; console: string[]; problems: string[]; banners: string[] };
const watch: Watch = { traffic: [], console: [], problems: [], banners: [] };

const BANNER_OBSERVER = `(() => {
  const ids = ["proof-program-banner", "network-unreachable"];
  const check = () => {
    for (const id of ids) {
      if (document.querySelector('[data-testid="' + id + '"]')) window.__sottoHealthBanner?.(id);
    }
  };
  new MutationObserver(check).observe(document, { childList: true, subtree: true });
})();`;

async function watchContext(context: BrowserContext, who: string) {
  context.on("request", (request) => {
    watch.traffic.push(
      `${who} ${request.method()} ${request.url()} ${JSON.stringify(request.headers())} ${
        request.postDataBuffer()?.toString("utf8") ?? ""
      }`,
    );
  });
  context.on("console", (message) => {
    watch.console.push(`${who} ${message.type()} ${message.text()}`);
    if (message.type() === "error" || message.type() === "warning") {
      watch.problems.push(`${who} console ${message.type()}: ${message.text()}`);
    }
  });
  context.on("weberror", (error) =>
    watch.problems.push(`${who} page error: ${error.error().message}`),
  );
  await context.exposeBinding("__sottoHealthBanner", ({ page }, id: string) => {
    watch.banners.push(`${who} ${id} on ${page?.url() ?? "?"}`);
  });
  await context.addInitScript({ content: BANNER_OBSERVER });
}

async function newPage(browser: Browser, who: string): Promise<Page> {
  const baseURL = test.info().project.use.baseURL;
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    extraHTTPHeaders: clientAddress(),
  });
  await watchContext(context, who);
  return context.newPage();
}

/** Connects the wallet on a page with the wallet card, if this tab has not yet. */
async function connectWallet(page: Page) {
  const connect = page.getByRole("button", { name: "Connect" });
  const signing = page.getByTestId("keys-wallet");
  await expect(connect.or(signing)).toBeVisible();
  if (await connect.isVisible()) await connect.click();
  await expect(signing).toBeVisible();
}

/** One Unlock click opens both keys; they stay open across the tab's client side navigation. */
async function unlock(page: Page) {
  await connectWallet(page);
  await page.getByRole("button", { name: "Unlock with your wallet" }).click();
  await expect(page.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
}

async function go(page: Page, name: string) {
  await page.getByRole("navigation").getByRole("link", { name, exact: true }).click();
}

/** The invite page's sign in with the invited wallet, back on the invite. */
async function signInFromInvite(page: Page) {
  await page.getByTestId("invite-sign-in").click();
  const option = page.getByTestId("wallet-option").filter({ hasText: "Sotto Test Wallet" });
  await option.getByRole("button", { name: "Connect" }).click();
  await option.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\/invite\/[A-Za-z0-9_-]{43}$/);
}

/** The run's checks that hold at every step: no banner, no console error or warning. */
function expectCleanSoFar(step: string) {
  expect(watch.banners, `health banner shown by ${step}`).toEqual([]);
  expect(watch.problems, `console errors or warnings by ${step}`).toEqual([]);
}

/** A CSV value as RFC 4180 writes it: in double quotes, with each quote doubled, when it needs them. */
const csvValue = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** One RFC 4180 line (no line breaks in its values) split into its values. */
function csvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') {
      value += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

const timings: { step: string; seconds: number }[] = [];
const screenshots: string[] = [];
const stepShots: string[] = [];

/**
 * A full page screenshot once the page's finite animations ended (the month bars grow for about a
 * second; a picture taken earlier shows them, and their month tags, still squashed).
 */
async function shoot(page: Page, name: string) {
  await page.mouse.move(0, 0);
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== "running" ||
          animation.effect?.getTiming().iterations === Infinity,
      ),
  );
  const path = test.info().outputPath(name);
  await page.screenshot({ path, fullPage: true });
  await test.info().attach(name, { path, contentType: "image/png" });
  screenshots.push(path);
  // Step 3.8: the approved screens against their baselines, the public proof page since its
  // design's approval (step 3.4.1, step 3.10.1); localnet only, devnet shows other data.
  if (target.visual) await expectVisual(page, name.replace(/\.png$/, ""));
  // Step 3.10: no WCAG 2.1 A or AA violation on any page of the scenario.
  await expectAccessible(page, name);
}

async function step(name: string, screenshot: string, body: () => Promise<Page>) {
  await test.step(name, async () => {
    const started = Date.now();
    const shown = await body();
    await shoot(shown, screenshot);
    stepShots.push(screenshot);
    timings.push({ step: name, seconds: Math.round((Date.now() - started) / 100) / 10 });
    expectCleanSoFar(name);
  });
}

// A click that cannot happen fails within a minute instead of waiting out the test.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.50" }, actionTimeout: 60_000 });

test(`the hackathon acceptance scenario runs end to end on ${target.name}, amounts never leave the browsers`, async ({
  page,
  browser,
}) => {
  test.setTimeout(1_200_000 * target.slow);
  const started = Date.now();
  const owner = await person(OWNER, 5n, 60n);
  const people: Person[] = [];
  for (const entry of PEOPLE) people.push(await person(entry.keypair, 2n, 0n));
  await target.prepare(
    (await createKeyPairSignerFromBytes(new Uint8Array(ACCOUNTANT))).address,
    1n,
    0n,
  );
  // The watchers are live: a context that warns and shows a banner is caught, then forgotten.
  const canary = await newPage(browser, "canary");
  await canary.goto("/");
  await canary.evaluate(() => {
    console.warn("sotto acceptance canary");
    document.body.insertAdjacentHTML("beforeend", '<div data-testid="proof-program-banner"></div>');
  });
  await expect.poll(() => watch.banners.length).toBeGreaterThan(0);
  await expect.poll(() => watch.problems.some((line) => line.includes("canary"))).toBe(true);
  await canary.context().close();
  watch.banners.length = 0;
  watch.problems.length = 0;
  watch.console.length = 0;
  await watchContext(page.context(), "owner");
  await page.addInitScript({ content: V1_WALLET });
  let orgId = "";
  let recordAddress = "";
  let attestationAddress = "";

  await step(
    "1. The organization is created, approved and attested",
    "01-org-verified.png",
    async () => {
      await signIn(page, OWNER);
      await page.getByLabel("Legal name").fill(LEGAL_NAME);
      await page.getByLabel("Country").selectOption("NL");
      await page.getByLabel("Registration number").fill("KVK 30");
      await page.getByLabel("Website").fill("acceptance.example");
      await page.getByLabel("Contact email").fill("ops@acceptance.example");
      await page.getByRole("button", { name: "Send for review" }).click();
      await expect(page.getByTestId("org-status")).toHaveText("In review");
      const admin = await newPage(browser, "admin");
      // The admin wallet (the E2E admin on localnet, the run's own admin on devnet) may own an
      // organization of another spec: any app page after sign in.
      await signIn(admin, target.admin, ANY_APP_PAGE);
      await approveOrg(admin, LEGAL_NAME);
      await admin.context().close();
      // The worker issues the attestation; the status page shows its address once it is onchain.
      await expect(async () => {
        await page.goto("/app/onboarding");
        await expect(page.getByTestId("attestation-address")).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 120_000 * target.slow });
      await expect(page.getByTestId("org-status")).toHaveText("Verified");
      const attestation = address(
        (await page.getByTestId("attestation-address").innerText()).trim(),
      );
      const account = await fetchEncodedAccount(rpc, attestation, { commitment: "confirmed" });
      expect(account.exists).toBe(true);
      const decoded = decodeBusinessAttestation(new Uint8Array(account.exists ? account.data : []));
      expect(decoded.data).toMatchObject({ legalName: LEGAL_NAME, country: "NL" });
      expect(decoded.credential).toBe(target.sasCredential);
      attestationAddress = attestation;
      orgId = decoded.data.orgId;
      await page.goto("/app");
      await expect(page).toHaveURL(OVERVIEW_URL);
      expect(OVERVIEW_URL.exec(new URL(page.url()).pathname)?.[1]).toBe(orgId);
      await page.goto("/app/onboarding");
      await expect(page.getByTestId("attestation-address")).toHaveText(attestation);
      return page;
    },
  );

  await step(
    "2. The owner unlocks, sets up the account and funds it",
    "02-account-funded.png",
    async () => {
      await page.goto("/app");
      await expect(page).toHaveURL(OVERVIEW_URL);
      await openSetup(page);
      await unlock(page);
      await page.getByRole("button", { name: "Create viewing key" }).click();
      await expect(page.getByTestId("viewing-key-status")).toHaveText("Registered");
      await page.getByRole("button", { name: "Set up the account" }).click();
      await expect(page.getByTestId("account-status")).toHaveText("Set up");
      await expect(page.getByTestId("account-recorded")).toHaveText("Recorded");
      const funding = page.getByTestId("funding-card");
      await page.getByLabel("Amount of USDC").fill(FUNDING.toString());
      await funding.getByRole("button", { name: "Fund account" }).click();
      await expect(funding.getByTestId("step-done")).toContainText(
        `Funded ${FUNDING} wUSDC in two steps`,
        { timeout: 180_000 * target.slow },
      );
      const chain = await expectBalancesFromChain(page, owner);
      expect(chain).toMatchObject({ available: FUNDING * 1_000_000n, pending: 0n });
      return page;
    },
  );

  await step(
    "3. Three recipients accept their invites and set up their accounts",
    "03-recipients-ready.png",
    async () => {
      await go(page, "Recipients");
      const form = page.getByTestId("add-recipient-card");
      const links: string[] = [];
      for (const [index, entry] of PEOPLE.entries()) {
        await form.getByLabel("Name").fill(entry.name);
        await form.getByLabel("Team").fill(entry.team);
        await form.getByLabel("Country").selectOption("NL");
        await form.getByLabel("Default amount (USDC)").fill(show(entry.net));
        await form.getByLabel("Solana wallet address").fill(people[index]?.address ?? "");
        await form.getByRole("button", { name: "Add recipient" }).click();
        const row = page.locator(
          `[data-testid="recipient-row"][data-wallet="${people[index]?.address}"]`,
        );
        await expect(row).toContainText(entry.name);
        await row.getByRole("button", { name: "Invite link" }).click();
        const link = page.getByLabel(`Invite link for ${entry.name}`);
        await expect(link).toHaveValue(/\/app\/invite\/[A-Za-z0-9_-]{43}$/);
        links.push(new URL(await link.inputValue()).pathname);
      }
      for (const [index, entry] of PEOPLE.entries()) {
        const recipient = await newPage(browser, entry.name);
        await addTestWallet(recipient, entry.keypair);
        await recipient.goto(links[index] ?? "");
        await signInFromInvite(recipient);
        await expect(recipient.getByTestId("invite-details")).toContainText(entry.name);
        await recipient.getByRole("button", { name: "Accept invite" }).click();
        await expect(recipient.getByTestId("invite-joined")).toContainText(
          `You joined ${LEGAL_NAME}`,
        );
        await unlock(recipient);
        await recipient.getByRole("button", { name: "Create viewing key" }).click();
        await expect(recipient.getByTestId("viewing-key-status")).toHaveText("Registered");
        await recipient.getByRole("button", { name: "Set up the account" }).click();
        await expect(recipient.getByTestId("account-status")).toHaveText("Set up");
        await expect(recipient.getByTestId("account-recorded")).toHaveText("Recorded");
        await recipient.context().close();
      }
      // The owner sees all three ready, from chain state.
      await expect(async () => {
        await go(page, "Overview");
        await go(page, "Recipients");
        for (const entry of people) {
          await expect(
            page
              .locator(`[data-testid="recipient-row"][data-wallet="${entry.address}"]`)
              .getByTestId("recipient-readiness"),
          ).toHaveAttribute("data-readiness", "ready", { timeout: 2_000 });
        }
      }).toPass({ timeout: 120_000 * target.slow });
      // Step 3.8: a reload, so the shot never keeps the invite links an earlier visit showed (the
      // router kept that state in some runs and not in others).
      await page.reload();
      await expect(page.getByTestId("recipient-row")).toHaveCount(3);
      // A reload locks the keys; the run of step 4 needs them.
      await unlock(page);
      return page;
    },
  );

  await step("4. A payroll run for the three settles", "04-payroll-settled.png", async () => {
    const before = await Promise.all(people.map(chainBalances));
    const ownerBefore = await chainBalances(owner);
    await go(page, "Payroll");
    const csv = [
      "wallet,amount,memo,name,team,country,gross,tax",
      ...PEOPLE.map(
        (entry, index) =>
          `${people[index]?.address},${show(entry.net)},${csvValue(entry.memo)},,,,${show(entry.gross)},${show(entry.tax)}`,
      ),
    ];
    await page.getByLabel("Payroll CSV").setInputFiles({
      name: "october.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv.join("\n")),
    });
    await expect(page.getByTestId("csv-summary")).toContainText("3 lines from october.csv");
    const rows = page.getByTestId("csv-row");
    await expect(rows).toHaveCount(3);
    for (const row of await rows.all()) await expect(row).toHaveAttribute("data-state", "ok");
    await expect(page.getByRole("button", { name: "Create run" })).toBeEnabled();
    await page.getByRole("button", { name: "Create run" }).click();
    await expect(page).toHaveURL(RUN_URL);
    await expect(page.getByTestId("run-button")).toBeEnabled();
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("run-done")).toContainText("3 lines were sent and confirmed", {
      timeout: 300_000 * target.slow,
    });
    await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "settled", {
      timeout: 120_000 * target.slow,
    });
    await expect(page.getByTestId("gauge-head")).toHaveText("3 of 3 paid");
    await expect(page.getByTestId("run-total-amount")).toHaveText(`${show(TOTAL)} USDC`);
    const after = await Promise.all(people.map(chainBalances));
    after.forEach((balance, index) =>
      expect(balance.pending).toBe((before[index]?.pending ?? 0n) + (PEOPLE[index]?.net ?? 0n)),
    );
    expect((await chainBalances(owner)).available).toBe(ownerBefore.available - TOTAL);
    // The overview's balances after the run equal the chain; back to the settled run for its picture.
    await go(page, "Overview");
    await expect(page).toHaveURL(OVERVIEW_URL);
    await expectBalancesFromChain(page, owner);
    await page.goBack();
    await expect(page).toHaveURL(RUN_URL);
    await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "settled");
    return page;
  });

  await step(
    "5. The accountant reads exactly the three lines in Books and exports them",
    "05-books-accountant.png",
    async () => {
      await go(page, "Viewing keys");
      await page.getByTestId("open-grant").click();
      const drawer = page.getByRole("dialog", { name: "Grant a viewing key" });
      await drawer.getByLabel("Name").fill("Daniel Osei");
      await drawer.getByLabel("Role, optional").fill("Accountant, external");
      await drawer.getByRole("button", { name: "Every amount" }).click();
      await drawer.getByRole("button", { name: "No expiry" }).click();
      await drawer.getByTestId("grant-key").click();
      const link = await drawer.getByTestId("grant-invite-link").inputValue();
      await drawer.getByRole("button", { name: "Done" }).click();
      const row = page.getByTestId("key-row").filter({ hasText: "Daniel Osei" });
      await expect(row.getByTestId("key-status")).toHaveText("Invite sent");

      const daniel = await newPage(browser, "accountant");
      await addTestWallet(daniel, ACCOUNTANT);
      await daniel.goto(new URL(link).pathname);
      await signInFromInvite(daniel);
      await expect(daniel.getByTestId("invite-details")).toContainText("Every amount");
      await daniel.getByRole("button", { name: "Accept invite" }).click();
      await expect(daniel.getByTestId("invite-joined")).toContainText("as its accountant");
      await connectWallet(daniel);
      await daniel.getByRole("button", { name: "Create viewing key" }).click();
      await expect(daniel.getByTestId("viewing-key-status")).toHaveText("Registered");

      // The owner shares the past records: the three lines.
      await page.reload();
      await expect(row.getByTestId("key-status")).toHaveText("Active");
      await unlock(page);
      const backfill = page.getByTestId("backfill");
      await expect(backfill.getByTestId("backfill-row")).toContainText("Daniel Osei");
      await expect(backfill.getByTestId("backfill-row")).toContainText("3 records in scope");
      await backfill.getByRole("button", { name: "Share past records" }).click();
      await expect(backfill.getByTestId("backfill-message")).toHaveText(
        "Shared 3 past records with Daniel Osei, encrypted for them only.",
        { timeout: 60_000 * target.slow },
      );
      // Step 3.7: the viewing keys page with an active key, for the pixel fidelity pass.
      await shoot(page, "05a-viewing-keys.png");

      await daniel.goto("/app");
      await expect(daniel).toHaveURL(new RegExp(`/app/${orgId}/books$`));
      await connectWallet(daniel);
      await daniel
        .getByTestId("viewing-unlock-card")
        .getByRole("button", { name: "Unlock with your wallet" })
        .click();
      await expect(daniel.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
      const ledger = daniel.getByTestId("ledger-row");
      await expect(ledger).toHaveCount(3);
      await expect(
        daniel.locator('[data-testid="ledger-row"][data-kind="payroll_line"]'),
      ).toHaveCount(3);
      await expect(daniel.getByTestId("money-out-total")).toHaveText(`${show(TOTAL)} USDC`);
      const amounts = await daniel.getByTestId("ledger-amount").allInnerTexts();
      expect(amounts.map((text) => text.trim()).sort()).toEqual(
        PEOPLE.map((entry) => `${show(entry.net)} USDC`).sort(),
      );
      const downloading = daniel.waitForEvent("download");
      await daniel.getByTestId("export-csv").click();
      const exported = (await readFile((await (await downloading).path()) as string, "utf8")).split(
        "\r\n",
      );
      expect(exported[0]).toBe(
        "date,counterparty,memo,category,amount,currency,type,reconciliation,transaction",
      );
      const lines = exported.slice(1).filter((line) => line !== "");
      expect(lines).toHaveLength(3);
      // The memos hold a comma: the export quotes them, so each row still has its nine values.
      const records = lines.map(csvLine);
      for (const record of records) expect(record).toHaveLength(9);
      expect(records.map((record) => record[4]).sort()).toEqual(
        PEOPLE.map((entry) => show(entry.net)).sort(),
      );
      expect(records.map((record) => record[2]).sort()).toEqual(
        PEOPLE.map((entry) => entry.memo).sort(),
      );
      await expect(daniel.getByTestId("export-result")).toContainText("Exported 3 rows to CSV");
      return daniel;
    },
  );

  await step("6. A recipient reads the payslip on My pay", "06-my-pay-payslip.png", async () => {
    const maya = PEOPLE[0];
    if (!maya) throw new Error("no recipient");
    const recipient = await newPage(browser, `${maya.name} again`);
    await signIn(recipient, maya.keypair, PAY_URL);
    await unlock(recipient);
    await expect(recipient.getByTestId("payslip-net")).toHaveText(`${show(maya.net)} USDC`);
    await expect(recipient.getByTestId("payslip-gross")).toHaveText(`${show(maya.gross)} USDC`);
    await expect(recipient.getByTestId("payslip-tax")).toHaveText(`(${show(maya.tax)} USDC)`);
    const received = recipient.getByTestId("received-row").first();
    await expect(received).toHaveAttribute("data-state", "opened");
    await expect(received).toContainText(maya.memo);
    const chain = await expectBalancesFromChain(recipient, people[0] as Person);
    expect(chain.pending).toBe(maya.net);
    return recipient;
  });

  let visitor: Page | null = null;
  await step(
    "7. A proof of funds shows Proven on the public page",
    "07-proof-verified.png",
    async () => {
      await go(page, "Proofs");
      await expect(
        page.getByRole("heading", { name: "Prove it, without showing it" }),
      ).toBeVisible();
      const builder = page.getByTestId("proof-builder");
      await builder.getByRole("button", { name: "Custom" }).click();
      await builder.getByLabel("Custom amount (US dollars)").fill(target.proofDollars);
      await builder.getByLabel("Share the answer with").fill("Harbor Bank");
      await builder.getByRole("button", { name: "Generate proof" }).click();
      const certificate = page.getByTestId("certificate");
      await expect(certificate).toHaveAttribute("data-result", "proven", {
        timeout: 180_000 * target.slow,
      });
      const href = await certificate
        .getByRole("link", { name: "Open the public page" })
        .getAttribute("href");
      recordAddress = /^\/v\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(href ?? "")?.[1] ?? "";
      expect(recordAddress).not.toBe("");
      const record = await fetchEncodedAccount(rpc, address(recordAddress), {
        commitment: "confirmed",
      });
      expect(record.exists && record.programAddress).toBe(target.sottoProofsProgram);
      // Step 3.7: the proofs page with its certificate and the issued proof.
      await shoot(page, "07a-proofs.png");

      const signedOut = await newPage(browser, "visitor");
      visitor = signedOut;
      await signedOut.goto(`/v/${recordAddress}`);
      await expect(signedOut.getByTestId("verify-word")).toHaveText("Proven");
      await expect(signedOut.getByTestId("verify-organization")).toHaveText(`${LEGAL_NAME}, NL`);
      await expect(signedOut.getByTestId("verify-statement")).toHaveText(target.statement);
      await expect(signedOut.getByTestId("verify-disclosed")).toHaveText("none");
      expect((await signedOut.context().cookies()).length).toBe(0);
      return signedOut;
    },
  );

  await step(
    "8. With the privacy screen on, no amount on the overview is readable",
    "08-privacy-screen.png",
    async () => {
      await go(page, "Overview");
      await expect(page).toHaveURL(OVERVIEW_URL);
      const chain = await expectBalancesFromChain(page, owner);
      // AC-05.2: the balance growth card, from today's snapshot (written at the first unlock on the
      // overview, after the run) and the public flows since: one bar, this month's balance.
      const growth = page.getByTestId("balance-growth");
      await expect(growth.getByTestId("growth-bar")).toHaveCount(1);
      await expect(growth.getByTestId("growth-bar-none")).toHaveCount(0);
      await expect(growth).toContainText(`${show(chain.available + chain.pending)} wUSDC`);
      const today = new Date();
      const month = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")[
        today.getUTCMonth()
      ];
      await expect(growth.getByTestId("growth-starts")).toHaveText(
        `Balance history starts on ${today.getUTCDate()} ${month} ${today.getUTCFullYear()}`,
      );
      // At most one snapshot a day, though the overview was unlocked twice.
      const snapshots = (await (
        await page.request.get(`/api/orgs/${orgId}/disclosures?kind=balance_snapshot`)
      ).json()) as { items: unknown[] };
      expect(snapshots.items).toHaveLength(1);
      await shoot(page, "08a-balance-growth.png");
      await privacyScreenOn(page);
      await expectAmountsWrapped(page, "overview");
      await page.mouse.move(0, 0);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      const amounts = page.locator("[data-amount]:visible");
      expect(await amounts.count()).toBeGreaterThan(0);
      for (const amount of await amounts.all()) {
        await expect
          .poll(() => amount.evaluate((element) => getComputedStyle(element).filter))
          .toContain("blur(");
      }
      return page;
    },
  );

  // I-2 across the run: no amount or memo in any request, browser console line or server log line.
  const server = await target.serverLog();
  expect(server).toContain('"event":"api_request"');
  expect(server).toContain('"job":"payroll-runs"');
  // On devnet the app's database too, every row of every table (as in step 2.11's manual run).
  const database = await target.databaseText();
  const everything = {
    requests: watch.traffic.join("\n"),
    console: watch.console.join("\n"),
    server,
    ...(database === null ? {} : { database }),
  };
  expect(watch.traffic.length).toBeGreaterThan(100);
  for (const [where, text] of Object.entries(everything)) {
    for (const secret of SECRETS) {
      // A base amount leaks as a number of its own; inside a longer number (a slot, a time in
      // milliseconds, lamports) its digits are not the amount.
      const found = /^\d+$/.test(secret)
        ? new RegExp(`(?<![0-9])${secret}(?![0-9])`).test(text)
        : text.includes(secret);
      expect(found, `${secret} in ${where}`).toBe(false);
    }
  }
  expectCleanSoFar("the end");
  await (visitor as Page | null)?.context().close();

  const total = Math.round((Date.now() - started) / 1000);
  const table = [...timings.map((entry) => `${entry.seconds}s  ${entry.step}`), `${total}s  total`];
  console.log(`acceptance scenario timings\n${table.join("\n")}`);
  await test.info().attach("timings.json", {
    body: JSON.stringify({ steps: timings, totalSeconds: total }, null, 2),
    contentType: "application/json",
  });

  // The run passed: the screenshots also go where Playwright never clears them, for the demo plan.
  const stamp = new Date()
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replaceAll(":", "-");
  const shots = target.shotsDir(stamp);
  await mkdir(shots, { recursive: true });
  for (const path of screenshots) {
    const name = path.split("/").pop() ?? "";
    if (target.stepShotsOnly && !stepShots.includes(name)) continue;
    await copyFile(path, `${shots}/${name}`);
  }
  console.log(`acceptance scenario screenshots: ${shots}`);
  await target.record({
    target: target.name,
    legalName: LEGAL_NAME,
    orgId,
    attestation: attestationAddress,
    proofRecord: recordAddress,
    statement: target.statement,
    owner: owner.address,
    recipients: people.map((entry) => entry.address),
    accountant: (await createKeyPairSignerFromBytes(new Uint8Array(ACCOUNTANT))).address,
    screenshots: shots,
    timings: { steps: timings, totalSeconds: total },
  });
});
