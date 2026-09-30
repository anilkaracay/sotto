"use client";

// The account parts of the setup page (F-03, F-04; 06 sections 0, 3 and 4):
// - Wrapped USDC (AC-03.1): the startup verification's view of the wrapped mint; a missing mint is
//   created permissionless, the owner's wallet paying, and the server checks it again.
// - Confidential account (AC-03.3): before the first account is configured, the wallet signs the key
//   message a second time and the worker compares it with the first signature (step 1.7); a wallet
//   whose signatures differ is refused and reported with its name and version. Then one transaction
//   from getCreateConfidentialTransferAccountInstructionPlan (built in the worker), the read back of
//   06 section 3 step 4 and the record of POST /api/token-accounts.
// - Fund your account (AC-04.1 to AC-04.3): two signatures (step 1.7.1): wrap and deposit in one
//   transaction when it fits the wallet's transaction version, then apply after a fresh read; a
//   deposit of public wUSDC on its own; balances read from chain after each (AC-04.4); the apply
//   prompt of the worker's flag.
import {
  accountSetupStatus,
  confidentialDepositInstruction,
  formatTokenAmount,
  parseTokenAmount,
  readTokenAccountState,
  wrapAndDepositTransactions,
} from "@sotto/sdk/confidential/public";
import { confidentialKeysMessage } from "@sotto/sdk/keys/public";
import { createWrappedMintInstructions } from "@sotto/sdk/wrap";
import { Button, Card, Chip } from "@sotto/ui";
import { address, createNoopSigner, fetchEncodedAccount } from "@solana/kit";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ApiCallError, callApi } from "../../../../lib/client/api.ts";
import { browserRpc } from "../../../../lib/client/rpc.ts";
import { reportWallet } from "../../../../lib/client/wallet-report.ts";
import { SETUP_BLOCKED } from "../../../../lib/client/transactions.ts";
import { withWalletWords } from "../../../../lib/client/wallet-words.ts";
import { ApplyPromptNotice, applyPromptNeeded } from "./apply-prompt.tsx";
import styles from "./cards.module.css";
import extra from "./confidential.module.css";
import { useConfidential, type SignProblem } from "./context.tsx";
import { PausedNote } from "./paused-note.tsx";
import { StepError, useSend, type SendState } from "./use-send.ts";
import { Amount, WithAmounts } from "../privacy.tsx";

export type RecordedAccount = { address: string; applyFlagged: boolean };

export const NOT_DETERMINISTIC =
  "Your wallet signed the key message twice and gave two different signatures. Your confidential keys come from this signature, so this wallet would derive different keys the next time, and a balance held under the first keys could no longer be read. Sotto did not set up the account. Use a wallet that gives the same signature every time.";

/** The determinism check's second signature, when the wallet does not give it. */
const SECOND_SIGNATURE: Record<SignProblem, string> = {
  cancelled: "You cancelled the signature in your wallet. The account was not set up.",
  refused:
    "Your wallet refused to sign the key message again, so Sotto cannot check that its signature stays the same. The account was not set up.",
  message_changed:
    "Your wallet signed a different message than the one Sotto asked for. The account was not set up.",
  bad_signature: "Your wallet's signature did not verify. The account was not set up.",
};

function Outcome({ state, network }: { state: SendState; network: string }) {
  return (
    <>
      {state.busy ? (
        <div className={extra.done} role="status">
          <WithAmounts>{state.busy}</WithAmounts>
        </div>
      ) : null}
      {state.done ? (
        <div className={extra.done} role="status" data-testid="step-done">
          <WithAmounts>{state.done.text}</WithAmounts> Transaction{" "}
          {network === "devnet" ? (
            <a
              className={styles.link}
              href={`https://explorer.solana.com/tx/${state.done.signature}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
            >
              <span className="mono">{state.done.signature.slice(0, 12)}…</span>
            </a>
          ) : (
            <span className="mono">{state.done.signature.slice(0, 12)}…</span>
          )}
        </div>
      ) : null}
      {state.problem ? (
        <p className={styles.problem} role="alert">
          <WithAmounts>{state.problem}</WithAmounts>
        </p>
      ) : null}
    </>
  );
}

export function WrappedMintCard() {
  const { network, connected, ready } = useConfidential();
  const router = useRouter();
  const sending = useSend();
  const check = network.check;
  const missing = check.status === "wrapped_missing";

  async function create() {
    if (!connected || !network.usdcMint) return;
    const owner = connected.account.address;
    const usdcMint = network.usdcMint;
    await sending.send({
      busy: "Creating the wrapped USDC mint…",
      done: "The wrapped USDC mint exists now.",
      build: async () =>
        (
          await createWrappedMintInstructions({
            rpc: browserRpc(),
            payer: createNoopSigner(address(owner)),
            unwrappedMint: address(usdcMint),
            programAddress: address(network.tokenWrapProgram),
          })
        ).instructions,
      // The server runs the startup verification again and shows the recorded address.
      after: async () => router.refresh(),
    });
  }

  return (
    <Card data-testid="wrapped-mint-card">
      <div className={styles.head}>
        <h2 className={styles.cardTitle}>Wrapped USDC</h2>
        <Chip
          tone={ready ? "green" : missing ? "amber" : "neutral"}
          data-testid="wrapped-mint-status"
        >
          {ready ? "Ready" : missing ? "Not created" : "Unavailable"}
        </Chip>
      </div>
      {ready ? (
        <>
          <p className={styles.lead}>
            Confidential balances hold wUSDC: USDC wrapped one to one by Token Wrap. On{" "}
            {network.label} the wrapping program is Sotto&apos;s test deployment, so wUSDC here is
            labeled {network.wrapLabel}.
          </p>
          <dl className={styles.details}>
            <dt>wUSDC mint</dt>
            <dd className="mono" data-testid="wrapped-mint">
              {network.wrappedMint}
            </dd>
            <dt>Label</dt>
            <dd>
              <span className={extra.wrapLabel} data-testid="wrap-label">
                {network.wrapLabel}
              </span>
            </dd>
            <dt>USDC mint</dt>
            <dd className="mono">{network.usdcMint}</dd>
          </dl>
        </>
      ) : missing ? (
        <>
          <p className={styles.lead}>
            The wrapped USDC mint does not exist on {network.label} yet, so confidential balances
            are off. Anyone can create it: your wallet pays the rent of its accounts, and it will be
            the mint at <span className="mono">{check.address}</span>, labeled {network.wrapLabel}.
          </p>
          <div className={styles.actions}>
            <Button
              variant="blue"
              disabled={!sending.canSend || sending.busy !== null}
              onClick={create}
            >
              Create the wrapped USDC mint
            </Button>
          </div>
        </>
      ) : (
        <p className={styles.lead}>
          Confidential balances are off on this network until Sotto can check the wrapped USDC mint.
        </p>
      )}
      <Outcome state={sending} network={network.cluster} />
    </Card>
  );
}

export function AccountCard({ recorded }: { recorded: RecordedAccount | null }) {
  const { wallet, orgId, network, ready, vault, connected, data, blocked } = useConfidential();
  const router = useRouter();
  const sending = useSend();
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [recording, setRecording] = useState<"idle" | "busy" | string>("idle");
  const recordedFor = useRef<string | null>(null);

  const status =
    ready && data.wusdc && vault.unlocked && network.wrappedMint
      ? accountSetupStatus(data.wusdc, {
          owner: address(wallet),
          mint: address(network.wrappedMint),
          elgamalPubkey: address(vault.unlocked.elgamalPubkey),
        })
      : null;
  const configuredPublicly = data.wusdc?.status === "present" && data.wusdc.confidential !== null;

  async function record(token: string) {
    setRecording("busy");
    try {
      await callApi("/api/token-accounts", {
        method: "POST",
        body: { orgId, address: token, keyScheme: "standard_v1" },
      });
      setRecording("idle");
      router.refresh();
    } catch (error) {
      const message = error instanceof ApiCallError ? error.message : "Sotto could not be reached.";
      setRecording(`The account is set up, but Sotto could not record it: ${message}`);
    }
  }

  // An account configured with this wallet's keys (the worker decrypted it, I-5) but not recorded
  // yet, for example after a failed record, is recorded once per page.
  useEffect(() => {
    if (status?.kind !== "configured" || recorded || !data.wusdcAccount) return;
    if (data.confidential.kind !== "decrypted" || recordedFor.current === data.wusdcAccount) return;
    recordedFor.current = data.wusdcAccount;
    void record(data.wusdcAccount);
    // record only reads props it is given; the guard above keeps this to one call per account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.kind, recorded, data.wusdcAccount, data.confidential.kind]);

  async function setUp() {
    if (!connected?.signer || !vault.unlocked || !network.wrappedMint) return;
    setProblem(null);
    // The determinism check (step 1.7): the key message signed a second time must give the same
    // signature as the one the keys came from.
    setChecking(true);
    const check = await (async (): Promise<boolean | string> => {
      try {
        const second = await connected.sign(confidentialKeysMessage());
        if (typeof second === "string") {
          return withWalletWords(SECOND_SIGNATURE[second], connected.walletWords());
        }
        return (await vault.worker().confirmSignature(wallet, second)).same;
      } catch {
        return "The keys could not check your wallet's signature. Unlock again and retry.";
      } finally {
        setChecking(false);
      }
    })();
    if (typeof check === "string") {
      setProblem(check);
      return;
    }
    if (!check) {
      reportWallet(connected.info, { kind: "signature_not_deterministic" });
      setProblem(NOT_DETERMINISTIC);
      return;
    }
    const mint = network.wrappedMint;
    const expected = {
      owner: address(wallet),
      mint: address(mint),
      elgamalPubkey: address(vault.unlocked.elgamalPubkey),
    };
    let token = "";
    await sending.send({
      busy: "Setting up the account…",
      done: "The account is set up with your encryption key.",
      refused: SETUP_BLOCKED,
      build: async () => {
        const setup = await vault.worker().setupInstructions(mint);
        token = setup.token;
        return setup.instructions;
      },
      after: async () => {
        // 06 section 3, step 4: the account reads back with the extension, this wallet's key and
        // approval; the worker confirms the key (I-5).
        const state = await readTokenAccountState(browserRpc(), address(token));
        const readBack = accountSetupStatus(state, expected);
        if (readBack.kind !== "configured") {
          throw new StepError(
            "The transaction landed, but the account did not read back as configured with your key. Reload the page to check it again.",
          );
        }
        const { matches } = await vault.worker().checkAccount(readBack.confidential.elgamalPubkey);
        if (!matches) throw new StepError("The account's key does not match this wallet's keys.");
        recordedFor.current = token;
        await record(token);
      },
    });
  }

  const chip = !ready
    ? { tone: "neutral" as const, text: "Unavailable" }
    : status?.kind === "configured" || (!status && configuredPublicly)
      ? { tone: "green" as const, text: "Set up" }
      : status && status.kind !== "needs_setup"
        ? { tone: "red" as const, text: "Cannot use" }
        : { tone: "amber" as const, text: "Not set up" };

  return (
    <Card data-testid="account-card">
      <div className={styles.head}>
        <h2 className={styles.cardTitle}>Confidential account</h2>
        <Chip tone={chip.tone} data-testid="account-status">
          {chip.text}
        </Chip>
      </div>
      {!ready ? (
        <p className={styles.lead}>The account can be set up once confidential balances are on.</p>
      ) : !vault.unlocked ? (
        <p className={styles.lead}>
          {configuredPublicly
            ? "Your wUSDC account is configured for confidential balances. Unlock your keys to check it with your key and to fund it."
            : "Unlock your keys to set up your confidential wUSDC account."}
        </p>
      ) : !status ? (
        <p className={styles.lead}>Reading your account from the network…</p>
      ) : status.kind === "needs_setup" ? (
        <>
          <p className={styles.lead}>
            Setting up asks your wallet to sign the key message once more, to check that it gives
            the same signature every time, and then to approve one transaction that{" "}
            {status.created
              ? "configures your wUSDC account"
              : "creates your wUSDC account and configures it"}{" "}
            for confidential balances with your encryption key. Your wallet pays the network fee
            {status.created ? "" : " and the account's rent"}.
          </p>
          <div className={styles.actions}>
            <Button
              variant="blue"
              disabled={!sending.canSend || checking || sending.busy !== null || blocked !== null}
              onClick={setUp}
            >
              {checking ? "Waiting for your wallet…" : "Set up the account"}
            </Button>
          </div>
          <PausedNote />
        </>
      ) : status.kind === "configured" ? (
        <>
          <dl className={styles.details}>
            <dt>wUSDC account</dt>
            <dd className="mono" data-testid="token-account">
              {data.wusdcAccount}
            </dd>
            <dt>In Sotto</dt>
            <dd data-testid="account-recorded">
              {recorded ? "Recorded" : recording === "busy" ? "Recording…" : "Not recorded yet"}
            </dd>
          </dl>
          {recording !== "idle" && recording !== "busy" && !recorded ? (
            <>
              <p className={styles.problem} role="alert">
                {recording}
              </p>
              <div className={styles.actions}>
                <Button
                  variant="line"
                  onClick={() => data.wusdcAccount && void record(data.wusdcAccount)}
                >
                  Record the account
                </Button>
              </div>
            </>
          ) : null}
        </>
      ) : status.kind === "other_key" ? (
        <p className={styles.problem} role="alert">
          Your wUSDC account is configured with another encryption key, so the keys this wallet
          derives in Sotto cannot read it: it was set up with another key scheme or by another app.
          Sotto will not change it.
        </p>
      ) : status.kind === "not_approved" ? (
        <p className={styles.problem} role="alert">
          Your wUSDC account waits for approval by the mint, so it cannot hold confidential balances
          yet.
        </p>
      ) : (
        <p className={styles.problem} role="alert">
          The account at your wUSDC address is not a wUSDC account of this wallet, so Sotto cannot
          use it.
        </p>
      )}
      {problem ? (
        <p className={styles.problem} role="alert" data-testid="account-problem">
          {problem}
        </p>
      ) : null}
      <Outcome state={sending} network={network.cluster} />
    </Card>
  );
}

export function FundingCard({ recorded }: { recorded: RecordedAccount | null }) {
  const { wallet, network, ready, vault, data, connected, blocked } = useConfidential();
  const sending = useSend();
  const [text, setText] = useState("");
  const [split, setSplit] = useState<string | null>(null);
  const inputId = useId();
  const decimals = network.decimals ?? 6;
  const amount = parseTokenAmount(text, decimals);
  const configured = data.wusdc?.status === "present" && data.wusdc.confidential !== null;
  const publicUsdc = data.usdc?.status === "present" ? data.usdc.amount : null;
  const publicWusdc = data.wusdc?.status === "present" ? data.wusdc.amount : null;
  const decrypted = data.confidential.kind === "decrypted" ? data.confidential : null;
  // F-19: deposits and applying are confidential actions, paused while the proof program is down.
  const idle = sending.canSend && sending.busy === null && blocked === null;
  const owner = createNoopSigner(address(wallet));
  const shown = amount === null ? "" : formatTokenAmount(amount, decimals);

  /** 06 section 4, step 3: the apply instruction is built from fresh account state. */
  function applyStep(busy: string, done: string) {
    if (!data.wusdcAccount) return Promise.resolve(false);
    const token = data.wusdcAccount;
    return sending.send({
      busy,
      done,
      build: async () => {
        const account = await fetchEncodedAccount(browserRpc(), address(token), {
          commitment: "confirmed",
        });
        if (!account.exists) throw new StepError("Your wUSDC account does not exist.");
        return [await vault.worker().applyInstruction(token, new Uint8Array(account.data))];
      },
    });
  }

  /**
   * Funding in two signatures (step 1.7.1): step 1 wraps and deposits in one transaction when it fits
   * the wallet's transaction version, otherwise in two, and the reason is shown and reported; step 2
   * applies after a fresh read.
   */
  async function fund() {
    if (amount === null || !connected || !network.usdcMint || !network.usdcTokenProgram) return;
    setSplit(null);
    const plan = await wrapAndDepositTransactions({
      owner,
      unwrappedMint: address(network.usdcMint),
      unwrappedTokenProgram: address(network.usdcTokenProgram),
      programAddress: address(network.tokenWrapProgram),
      amount,
      decimals,
      version: connected.version,
    });
    if (plan.split) {
      setSplit(
        `Wrap and deposit did not fit in one version ${connected.version} transaction (${plan.split.size} bytes, the limit is ${plan.split.limit}), so your wallet signs them one after the other.`,
      );
      reportWallet(connected.info, {
        kind: "funding_split",
        version: connected.version,
        size: plan.split.size,
        limit: plan.split.limit,
      });
    }
    const parts = plan.transactions.length;
    for (const [index, instructions] of plan.transactions.entries()) {
      const what =
        parts === 1
          ? `wrapping ${shown} USDC and depositing it`
          : index === 0
            ? `wrapping ${shown} USDC (transaction 1 of 2)`
            : `depositing ${shown} wUSDC (transaction 2 of 2)`;
      const landed = await sending.send({
        busy: `Step 1 of 2: ${what}…`,
        done: `Step 1 of 2 done: ${shown} wUSDC is in your pending balance.`,
        build: async () => instructions,
      });
      if (!landed) return;
    }
    await applyStep(
      `Step 2 of 2: applying ${shown} wUSDC to your available balance…`,
      `Funded ${shown} wUSDC in two steps: wrapped and deposited, then applied to your available balance.`,
    );
  }

  function depositPublic() {
    if (!publicWusdc || !data.wusdcAccount || !network.wrappedMint) return;
    const token = data.wusdcAccount;
    const mint = network.wrappedMint;
    const all = publicWusdc;
    void sending.send({
      busy: "Depositing your public wUSDC…",
      done: `Deposited ${formatTokenAmount(all, decimals)} public wUSDC into your pending balance.`,
      build: async () => [
        confidentialDepositInstruction({
          token: address(token),
          mint: address(mint),
          owner,
          amount: all,
          decimals,
        }),
      ],
    });
  }

  function apply() {
    void applyStep(
      "Applying your pending balance…",
      "Applied your pending balance to your available balance.",
    );
  }

  const promptNeeded =
    decrypted !== null &&
    applyPromptNeeded({
      flagged: recorded?.applyFlagged ?? false,
      credits: decrypted.credits,
      maximumCredits: decrypted.maximumCredits,
    });

  return (
    <Card data-testid="funding-card">
      <h2 className={styles.cardTitle}>Fund your account</h2>
      <PausedNote />
      {promptNeeded && decrypted ? (
        <ApplyPromptNotice
          credits={decrypted.credits}
          maximumCredits={decrypted.maximumCredits}
          action={
            <Button variant="blue" disabled={!idle} onClick={apply}>
              Apply pending balance
            </Button>
          }
        />
      ) : null}
      {!ready || !configured ? (
        <p className={styles.lead}>Set up your confidential account first.</p>
      ) : (
        <>
          <p className={styles.lead}>
            Funding takes two signatures. Step 1 wraps USDC into wUSDC ({network.wrapLabel}) and
            deposits it into your confidential pending balance; step 2 applies it to your available
            balance. The funded amount is public onchain; your confidential balance is not.
          </p>
          <label className={extra.field} htmlFor={inputId}>
            Amount of USDC
            <span className={extra.amountRow}>
              <input
                id={inputId}
                className={extra.input}
                inputMode="decimal"
                data-amount=""
                autoComplete="off"
                placeholder="0.00"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </span>
          </label>
          {text.trim() !== "" && amount === null ? (
            <p className={styles.problem} role="alert">
              Enter an amount above zero with at most {decimals} decimals.
            </p>
          ) : null}
          <div className={extra.steps}>
            <Button
              variant="blue"
              disabled={
                !idle ||
                !vault.unlocked ||
                amount === null ||
                publicUsdc === null ||
                amount > publicUsdc
              }
              onClick={() => void fund()}
            >
              Fund account
            </Button>
            {publicWusdc ? (
              <Button variant="line" disabled={!idle} onClick={depositPublic}>
                Deposit{" "}
                <Amount inControl>{formatTokenAmount(publicWusdc, decimals)} public wUSDC</Amount>
              </Button>
            ) : null}
            {decrypted && decrypted.pending > 0n && !promptNeeded ? (
              <Button variant="line" disabled={!idle} onClick={apply}>
                Apply pending balance
              </Button>
            ) : null}
          </div>
          {amount !== null && publicUsdc !== null && amount > publicUsdc ? (
            <div className={extra.done} data-testid="amount-limits">
              {shown} is more than your public USDC.
            </div>
          ) : null}
          {!vault.unlocked ? (
            <div className={extra.done}>
              Unlock your keys to fund: step 2 applies the deposit with your keys.
            </div>
          ) : null}
        </>
      )}
      {split ? (
        <div className={extra.done} role="status" data-testid="funding-split">
          {split}
        </div>
      ) : null}
      <Outcome state={sending} network={network.cluster} />
    </Card>
  );
}
