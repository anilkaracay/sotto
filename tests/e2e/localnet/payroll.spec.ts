// F-08 in the browser on localnet (step 2.3): the owner uploads payroll CSVs and runs them with the
// injected test wallet, declaring version 1 like the demo wallet. The CSV is validated row by row in
// the tab (AC-08.1); a run with a recipient who is not ready and one on the deny list is blocked
// before anything is signed (AC-08.2); a 24 line run is paid in chunks of 10 with one signTransaction
// call per chunk, a failure is forced on line 12 (its recipient turns confidential credits off once
// the chunk of lines 11 to 20 is signed), the run stops partially settled with lines 1 to 11 paid,
// and Resume pays lines 12 to 24 to settlement without paying lines 1 to 11 twice (AC-08.4,
// AC-08.5). Every settled line has its self disclosure and, for the recipient who registered a
// viewing key, the recipient's, and she reads it on her pay page (AC-08.6). The amounts and memos
// appear in no request (I-2). The accounts are prepared with the SDK; everything the owner and the
// recipient do runs in the browser. Runs in the localnet job of scripts/ci-local.sh, never on devnet.
import { decryptTokenAccount } from "@sotto/sdk/confidential";
import { associatedTokenAccount, decodeToken2022Account } from "@sotto/sdk/confidential/public";
import { confidentialKeysMessage, deriveStandardKeys } from "@sotto/sdk/keys";
import { keypairWallet } from "@sotto/sdk/testing";
import {
  applyLocalnetPending,
  fundLocalnetAccount,
  fundLocalnetWallet,
  readLocalnetBootstrap,
  setLocalnetConfidentialCredits,
  setUpLocalnetAccount,
  type LocalnetOwner,
} from "@sotto/sdk/testing/localnet";
import { createRetryingRpc } from "@sotto/sdk/tx";
import {
  createKeyPairSignerFromBytes,
  fetchEncodedAccount,
  signBytes,
  type Address,
} from "@solana/kit";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { e2eKeypair, seededKeypair } from "../fixtures.ts";
import { addTestWallet, clientAddress, openSetup, OVERVIEW_URL, signIn } from "../helpers.ts";

const bootstrap = readLocalnetBootstrap();
const rpc = createRetryingRpc(bootstrap.rpcUrl);
const PAY_URL = /\/app\/[0-9a-f-]{36}\/pay$/;
const RUN_URL = /\/app\/[0-9a-f-]{36}\/payroll\/[0-9a-f-]{36}$/;
const OWNER = seededKeypair("sotto-e2e-payroll-owner/v1");
const PEOPLE = Array.from({ length: 24 }, (_, index) =>
  seededKeypair(`sotto-e2e-payroll-person-${index + 1}/v1`),
);
const NOT_READY = seededKeypair("sotto-e2e-payroll-not-ready/v1");
const DENIED = seededKeypair("sotto-e2e-denied/v1");
const UNKNOWN = seededKeypair("sotto-e2e-payroll-unknown/v1");
const TEAMS = ["Engineering", "Design", "Growth"];
const USDC = 1_000_000n;
/** I-2: line amounts that are never used for a deposit or a withdrawal, and a memo. */
const amountOf = (index: number) => 2_000_000n + BigInt(index + 1) * 11_111n;
const MEMO = "October salary sentinel 5521";
const V1_WALLET = "window.__sottoTestWalletVersions = ['legacy', 0, 1];";

async function chainPerson(keypair: number[], usdc: bigint): Promise<LocalnetOwner> {
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(keypair));
  const funded = await fundLocalnetWallet(rpc, bootstrap, signer.address, { sol: 2n, usdc });
  const signature = new Uint8Array(
    await signBytes(signer.keyPair.privateKey, confidentialKeysMessage()),
  );
  return {
    signer,
    wallet: keypairWallet(signer),
    keys: await deriveStandardKeys(signer.address, signature),
    usdc: funded.usdc,
    wusdc: await associatedTokenAccount(signer.address, bootstrap.wrappedUsdcMint),
  };
}

async function ensureAccount(who: LocalnetOwner) {
  const account = await fetchEncodedAccount(rpc, who.wusdc as Address, {
    commitment: "confirmed",
  });
  if (!account.exists) await setUpLocalnetAccount(rpc, who, bootstrap);
}

async function balancesOf(who: LocalnetOwner) {
  const account = await fetchEncodedAccount(rpc, who.wusdc as Address, { commitment: "confirmed" });
  if (!account.exists) throw new Error("the account does not exist");
  return decryptTokenAccount(decodeToken2022Account(new Uint8Array(account.data)), who.keys);
}

async function newPage(browser: Browser): Promise<Page> {
  const baseURL = test.info().project.use.baseURL;
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    extraHTTPHeaders: clientAddress(),
  });
  return context.newPage();
}

async function unlock(page: Page) {
  const connect = page.getByRole("button", { name: "Connect" });
  const signing = page.getByTestId("keys-wallet");
  await expect(connect.or(signing)).toBeVisible();
  if (await connect.isVisible()) await connect.click();
  await page.getByRole("button", { name: "Unlock with your wallet" }).click();
  await expect(page.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
}

const wallet = <T>(page: Page, key: "signTransactionCalls" | "signedTransactions") =>
  page.evaluate(
    (name) =>
      (window as unknown as { __sottoTestWallet: Record<string, unknown> }).__sottoTestWallet[
        name
      ] as T,
    key,
  );

async function uploadCsv(page: Page, name: string, rows: string[]) {
  const csv = ["wallet,amount,memo,name,team,country", ...rows].join("\n");
  await page
    .getByLabel("Payroll CSV")
    .setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv) });
}

const format = (base: bigint) => {
  const whole = base / USDC;
  const fraction = (base % USDC).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
};

test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.30" } });

test.describe.serial("payroll runs on localnet", () => {
  let owner: LocalnetOwner;
  let people: LocalnetOwner[] = [];
  let orgId = "";

  test.beforeAll(async () => {
    test.setTimeout(420_000);
    owner = await chainPerson(OWNER.keypair, 200n);
    await ensureAccount(owner);
    await fundLocalnetAccount(rpc, owner, bootstrap, 120n * USDC);
    await applyLocalnetPending(rpc, owner);
    people = [];
    for (let i = 0; i < PEOPLE.length; i += 6) {
      const batch = await Promise.all(
        PEOPLE.slice(i, i + 6).map((person) => chainPerson(person.keypair, 0n)),
      );
      await Promise.all(batch.map(ensureAccount));
      people.push(...batch);
    }
    await ensureAccount(await chainPerson(DENIED.keypair, 0n));
    // Line 12's recipient takes credits again if a rerun on the same ledger left them off.
    await setLocalnetConfidentialCredits(rpc, people[11] as LocalnetOwner, true);
  });

  test("AC-08.1 AC-08.2 validates the CSV row by row, then blocks a run with a recipient who is not ready and one on the deny list before anything is signed", async ({
    page,
    browser,
  }) => {
    test.setTimeout(480_000);
    await page.addInitScript({ content: V1_WALLET });
    await signIn(page, OWNER.keypair);
    await page.getByLabel("Legal name").fill("Payroll Test Ltd");
    await page.getByLabel("Country").selectOption("DE");
    await page.getByLabel("Registration number").fill("HRB 23");
    await page.getByLabel("Website").fill("payroll.example");
    await page.getByLabel("Contact email").fill("ops@payroll.example");
    await page.getByRole("button", { name: "Send for review" }).click();
    await expect(page.getByTestId("org-status")).toHaveText("In review");
    const admin = await newPage(browser);
    await signIn(admin, e2eKeypair());
    await admin.goto("/app/admin");
    await admin.getByRole("button", { name: "Approve" }).click();
    await admin.getByRole("button", { name: "Confirm approve" }).click();
    await expect(admin.getByText("No organization is waiting for review.")).toBeVisible();
    await admin.context().close();

    await page.goto("/app");
    await expect(page).toHaveURL(OVERVIEW_URL);
    orgId = OVERVIEW_URL.exec(new URL(page.url()).pathname)?.[1] ?? "";
    await openSetup(page);
    await unlock(page);
    await page.getByRole("button", { name: "Create viewing key" }).click();
    await expect(page.getByTestId("viewing-key-status")).toHaveText("Registered");

    // The recipients, through the API the recipients page uses.
    const origin = new URL(page.url()).origin;
    const add = async (displayName: string, address: string, index: number) => {
      const response = await page.request.post(`/api/orgs/${orgId}/recipients`, {
        headers: { origin },
        data: {
          displayName,
          wallet: address,
          team: TEAMS[index % TEAMS.length],
          country: "DE",
        },
      });
      expect(response.status()).toBe(201);
    };
    for (const [index, person] of PEOPLE.entries()) {
      await add(index === 0 ? "Maya Chen" : `Person ${index + 1}`, person.address, index);
    }
    await add("Not Ready", NOT_READY.address, 0);
    await add("Blocked Vendor", DENIED.address, 1);

    // Maya joins through her invite and registers her viewing key.
    await page.getByRole("navigation").getByRole("link", { name: "Recipients" }).click();
    await page
      .locator(`[data-testid="recipient-row"][data-wallet="${PEOPLE[0]?.address}"]`)
      .getByRole("button", { name: "Invite link" })
      .click();
    const inviteLink = await page.getByTestId("invite-link").inputValue();
    const maya = await newPage(browser);
    await addTestWallet(maya, PEOPLE[0]?.keypair);
    await maya.goto(new URL(inviteLink).pathname);
    await maya.getByTestId("invite-sign-in").click();
    const option = maya.getByTestId("wallet-option").filter({ hasText: "Sotto Test Wallet" });
    await option.getByRole("button", { name: "Connect" }).click();
    await option.getByRole("button", { name: "Sign in" }).click();
    await maya.getByRole("button", { name: "Accept invite" }).click();
    await unlock(maya);
    await maya.getByRole("button", { name: "Create viewing key" }).click();
    await expect(maya.getByTestId("viewing-key-status")).toHaveText("Registered");
    await maya.context().close();

    // AC-08.1: every row validated; an unknown wallet is "Add this recipient first".
    await page.getByRole("navigation").getByRole("link", { name: "Payroll" }).click();
    await uploadCsv(page, "unknown.csv", [
      `${PEOPLE[1]?.address},1.5,,,,`,
      `${UNKNOWN.address},2,,,,`,
      `${PEOPLE[2]?.address},0,,,,`,
    ]);
    const rows = page.getByTestId("csv-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute("data-state", "ok");
    await expect(rows.nth(1).getByTestId("csv-row-error")).toHaveText("Add this recipient first");
    await expect(rows.nth(2).getByTestId("csv-row-error")).toContainText(
      "Enter an amount above zero with at most 6 decimals.",
    );
    await expect(page.getByRole("button", { name: "Create run" })).toBeDisabled();

    // AC-08.2: a recipient not ready and one on the deny list block the run before any signature.
    await uploadCsv(page, "blocked.csv", [
      `${PEOPLE[1]?.address},1.5,,,,`,
      `${NOT_READY.address},2,,Not Ready,,`,
      `${DENIED.address},3,,Blocked Vendor,,`,
    ]);
    await expect(page.getByTestId("csv-summary")).toContainText("3 lines from blocked.csv");
    await page.getByRole("button", { name: "Create run" }).click();
    await expect(page).toHaveURL(RUN_URL);
    await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "draft");
    const signedBefore = await wallet<number>(page, "signedTransactions");
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("run-problem")).toHaveText(
      "Lines 2, 3 cannot be paid now; nothing was signed",
    );
    const lines = page.getByTestId("run-line");
    await expect(lines.nth(1).getByTestId("line-status")).toHaveText("Not ready");
    await expect(lines.nth(1).getByTestId("line-reason")).toContainText(
      "there is no wUSDC account at this wallet",
    );
    await expect(lines.nth(2).getByTestId("line-status")).toHaveText("Blocked by screening");
    expect(await wallet<number>(page, "signedTransactions")).toBe(signedBefore);
    expect(await wallet<number[]>(page, "signTransactionCalls")).toEqual([]);
  });

  test("AC-08.4 AC-08.5 AC-08.6 pays 24 lines in chunks, stops at a failure forced on line 12, and a resume settles the run without paying lines 1 to 11 twice", async ({
    page,
    browser,
  }) => {
    test.setTimeout(600_000);
    await page.addInitScript({ content: V1_WALLET });
    await signIn(page, OWNER.keypair, OVERVIEW_URL);
    await page.getByRole("navigation").getByRole("link", { name: "Payroll" }).click();
    const traffic: string[] = [];
    page.on("request", (request) => {
      traffic.push(request.url());
      traffic.push(request.postData() ?? "");
    });
    await uploadCsv(
      page,
      "october.csv",
      PEOPLE.map(
        (person, index) =>
          `${person.address},${format(amountOf(index))},${index === 0 ? MEMO : ""},,,`,
      ),
    );
    await expect(page.getByTestId("csv-summary")).toContainText("24 lines from october.csv");
    await page.getByRole("button", { name: "Create run" }).click();
    await expect(page).toHaveURL(RUN_URL);
    await unlock(page);
    await expect(page.getByTestId("gauge")).toHaveAttribute("data-ticks", "24");
    await expect(page.getByTestId("approval-chip")).toHaveText("Waiting for you");

    const before = await Promise.all(people.map(balancesOf));
    const ownerBefore = await balancesOf(owner);
    // Line 12's recipient turns credits off once the chunk of lines 11 to 20 is signed.
    let chunks = 0;
    await page.exposeFunction("__sottoOnSignTransaction", async (_call: number, count: number) => {
      if (count < 2) return;
      chunks += 1;
      if (chunks === 2)
        await setLocalnetConfidentialCredits(rpc, people[11] as LocalnetOwner, false);
    });
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("run-problem")).toContainText("Line 12 (Person 12)", {
      timeout: 300_000,
    });
    await expect(page.getByTestId("run-problem")).toContainText(
      "11 lines were paid and stay paid; Resume pays the rest.",
    );
    await expect(page.getByTestId("run-status")).toHaveAttribute(
      "data-status",
      "partially_settled",
    );
    await expect(page.getByTestId("approval-chip")).toHaveText("Approved");
    // One signTransaction call per chunk of 10 lines (version 1: one transaction per line).
    expect(await wallet<number[]>(page, "signTransactionCalls")).toEqual([10, 10]);
    const stopped = await Promise.all(people.map(balancesOf));
    stopped.forEach((balance, index) =>
      expect(balance.pending).toBe(
        (before[index]?.pending ?? 0n) + (index < 11 ? amountOf(index) : 0n),
      ),
    );

    // The resume pays lines 12 to 24 from chain state.
    await setLocalnetConfidentialCredits(rpc, people[11] as LocalnetOwner, true);
    await expect(page.getByTestId("run-button")).toHaveText("Resume");
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("run-done")).toContainText("13 lines were sent and confirmed", {
      timeout: 300_000,
    });
    await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "settled", {
      timeout: 120_000,
    });
    await expect(page.getByTestId("gauge-head")).toHaveText("24 of 24 paid");
    await expect(page.getByTestId("gauge")).toHaveAttribute("data-lit", "24");
    expect(await wallet<number[]>(page, "signTransactionCalls")).toEqual([10, 10, 10, 3]);
    // Each recipient was paid its line exactly once, and the owner the total less.
    const after = await Promise.all(people.map(balancesOf));
    after.forEach((balance, index) =>
      expect(balance.pending).toBe((before[index]?.pending ?? 0n) + amountOf(index)),
    );
    const total = PEOPLE.reduce((sum, _, index) => sum + amountOf(index), 0n);
    expect((await balancesOf(owner)).available).toBe(ownerBefore.available - total);
    await expect(page.getByTestId("run-total-amount")).toHaveText(`${format(total)} USDC`);

    // AC-08.6: a self disclosure for every line, and Maya's own.
    const disclosures = (await (
      await page.request.get(`/api/orgs/${orgId}/disclosures?kind=payroll_line`)
    ).json()) as { items: { subject: string }[] };
    expect(new Set(disclosures.items.map((item) => item.subject)).size).toBe(24);
    const everything = traffic.join("\n");
    for (const plaintext of [format(amountOf(0)), amountOf(0).toString(), MEMO]) {
      expect(everything).not.toContain(plaintext);
    }

    const maya = await newPage(browser);
    await signIn(maya, PEOPLE[0]?.keypair, PAY_URL);
    await unlock(maya);
    const received = maya.getByTestId("received-row").first();
    await expect(received).toHaveAttribute("data-state", "opened");
    await expect(received.getByTestId("received-amount")).toHaveText(`${format(amountOf(0))} USDC`);
    await expect(received).toContainText(MEMO);
    await expect(received).toContainText("Payroll");
    await maya.context().close();
  });
});
