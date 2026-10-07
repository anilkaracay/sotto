"use client";

// The confidential session of an org page (setup, overview; 04 section 5, 10 section 3):
// - the signed in wallet, connected in this tab, with its message signer (the signed message is checked
//   before use) and, when it can sign for this network, its transaction signer (the modifying signer of
//   @solana/react, D-26);
// - the tab's key session (the /app layout's KeySessionProvider): the crypto Web Worker that holds the
//   keys across in-app navigation, its auto lock and holds during executions;
// - the account data read from chain through /api/rpc: the public USDC and wUSDC balances, the wUSDC
//   account's state, and the confidential balances the worker decrypts for display. Locked keys show
//   as Locked, never as zero (AC-03.5), and every refresh reads chain state again (AC-04.4).
import {
  associatedTokenAccount,
  readPublicTokenBalance,
  tokenAccountState,
  type PublicTokenBalance,
  type TokenAccountState,
} from "@sotto/sdk/confidential/public";
import { checkSignedMessage } from "@sotto/sdk/keys/public";
import {
  canHoldConfidentialBalances,
  transactionPath,
  walletCapabilities,
} from "@sotto/sdk/wallet";
import {
  useSignMessage,
  useSignTransactions,
  useWalletAccountTransactionSigner,
} from "@solana/react";
import { address, fetchEncodedAccount, type TransactionModifyingSigner } from "@solana/kit";
import {
  getWalletFeature,
  useWallets,
  type UiWallet,
  type UiWalletAccount,
} from "@wallet-standard/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CryptoWorkerClient, CryptoWorkerError } from "../../../../lib/crypto-worker/client.ts";
import type { LockReason } from "../../../../lib/crypto-worker/key-session.ts";
import type { UnlockResult } from "../../../../lib/crypto-worker/protocol.ts";
import type { SignProblem } from "../../../../lib/crypto-worker/unlock.ts";
import { batchSigner } from "../../../../lib/client/batch-signer.ts";
import { browserRpc } from "../../../../lib/client/rpc.ts";
import { isWalletCancel } from "../../../../lib/client/transactions.ts";
import { walletInfo, type WalletInfo } from "../../../../lib/client/wallet-report.ts";
import { walletWords, type WalletWords } from "../../../../lib/client/wallet-words.ts";
import { PROGRAM_BLOCKED } from "../../../../lib/health.ts";
import type { NetworkView } from "../../../../lib/server/network-view.ts";
import { useKeySession } from "../key-session.tsx";

export type AvailableNetwork = Extract<NetworkView, { available: true }>;

export type { SignProblem };

export type Vault = {
  worker: () => CryptoWorkerClient;
  /** The worker holding the keys, for reads; throws "locked" rather than start one (AC-03.5). */
  openWorker: () => CryptoWorkerClient;
  /** The keys of this page's signed in wallet, when unlocked in this tab. */
  unlocked: { elgamalPubkey: string } | null;
  unlock: (wallet: string, signature: Uint8Array) => Promise<UnlockResult>;
  /** The Lock button. */
  lock: () => void;
  /** Keeps the keys open during an execution; call the returned function when done. */
  hold: () => () => void;
  /** Why the keys last locked in this tab, until the next unlock. */
  lockReason: LockReason | null;
};

export type Connected = {
  account: UiWalletAccount;
  info: WalletInfo;
  /** Signs exactly these bytes, or says why not; the signature verifies for the wallet. */
  sign: (message: Uint8Array) => Promise<Uint8Array | SignProblem>;
  /**
   * The wallet's own words for the last `sign` it refused or cancelled, null after a
   * signature or a problem Sotto found itself (a changed message, a bad signature).
   */
  walletWords: () => WalletWords | null;
  /** Null when the wallet cannot sign transactions for this network's chain. */
  signer: TransactionModifyingSigner | null;
  /**
   * Step 2.3: signs several transactions in one Wallet Standard call (a payroll chunk, D-21); null
   * with `signer`.
   */
  batchSigner: TransactionModifyingSigner | null;
  /** The transaction version for this wallet and network (D-26). */
  version: 0 | 1;
};

/** What the Available and Pending cards show. */
export type ConfidentialView =
  | { kind: "locked"; configured: boolean }
  | { kind: "not_set_up" }
  | { kind: "unreadable"; reason: string }
  | {
      kind: "decrypted";
      available: bigint;
      pending: bigint;
      credits: bigint;
      maximumCredits: bigint;
    };

export type AccountData = {
  loading: boolean;
  /** Set when the chain could not be read. */
  error: string | null;
  usdcAccount: string | null;
  wusdcAccount: string | null;
  usdc: PublicTokenBalance | null;
  wusdc: TokenAccountState | null;
  confidential: ConfidentialView;
};

export type ContextValue = {
  wallet: string;
  orgId: string;
  network: AvailableNetwork;
  /** Wallets in this browser that can hold confidential balances (D-26). */
  wallets: UiWallet[];
  /** Records the account a wallet shared on connect. */
  setAccount: (account: UiWalletAccount, wallet: UiWallet) => void;
  /** Chain reads are possible: the startup verification passed. */
  ready: boolean;
  vault: Vault;
  connected: Connected | null;
  data: AccountData;
  refresh: () => Promise<void>;
  /**
   * F-19 (step 2.9): why confidential actions are paused (the ZK ElGamal Proof program is unavailable),
   * or null. Every confidential action is disabled with these words; public ones keep working.
   */
  blocked: string | null;
};

/** Exported for the component tests, which render confidential actions without a wallet. */
export const ConfidentialContext = createContext<ContextValue | null>(null);

/** Holds the wallet's words of the last refused signature, set and read outside rendering. */
class WalletWordsBox {
  #words: WalletWords | null = null;
  set(words: WalletWords | null): void {
    this.#words = words;
  }
  get(): WalletWords | null {
    return this.#words;
  }
}

export function useConfidential(): ContextValue {
  const value = useContext(ConfidentialContext);
  if (!value) throw new Error("useConfidential needs a ConfidentialProvider");
  return value;
}

/** The tab's key session as this page's vault, for the page's signed in wallet only. */
function useVault(wallet: string): Vault {
  const { session, unlocked, lockReason } = useKeySession();
  // A page of another signed in wallet (or none) ends the keys (key-session.ts).
  useEffect(() => {
    session.signedIn(wallet);
  }, [session, wallet]);
  const mine = unlocked?.wallet === wallet ? unlocked : null;
  return useMemo(
    () => ({
      worker: () => session.worker(),
      openWorker: () => session.openWorker(),
      unlocked: mine ? { elgamalPubkey: mine.elgamalPubkey } : null,
      unlock: (owner: string, signature: Uint8Array) => session.unlock(owner, signature),
      lock: () => session.lock("button"),
      hold: () => session.hold(),
      lockReason,
    }),
    [session, mine, lockReason],
  );
}

const EMPTY: AccountData = {
  loading: true,
  error: null,
  usdcAccount: null,
  wusdcAccount: null,
  usdc: null,
  wusdc: null,
  confidential: { kind: "locked", configured: false },
};

/** The version of transactions this wallet signs on this network: v1 only if both support it. */
function versionFor(wallet: UiWallet, networkV1: boolean): 0 | 1 {
  if (!networkV1 || !wallet.features.includes("solana:signTransaction")) return 0;
  const feature = getWalletFeature(wallet, "solana:signTransaction");
  const capabilities = walletCapabilities({
    chains: wallet.chains,
    features: { "solana:signTransaction": feature },
  });
  return transactionPath(capabilities) === "v1" ? 1 : 0;
}

/** The account data of the signed in wallet, read from chain and decrypted in the worker if unlocked. */
async function readAccountData(input: {
  wallet: string;
  network: AvailableNetwork;
  unlocked: boolean;
  vault: Vault;
}): Promise<AccountData> {
  const { network } = input;
  if (!network.wrappedMint) return { ...EMPTY, loading: false };
  try {
    const rpc = browserRpc();
    const owner = address(input.wallet);
    const wusdcAccount = await associatedTokenAccount(owner, address(network.wrappedMint));
    const usdcAccount =
      network.baseMint && network.baseTokenProgram
        ? await associatedTokenAccount(
            owner,
            address(network.baseMint),
            address(network.baseTokenProgram),
          )
        : null;
    const [encoded, usdc] = await Promise.all([
      fetchEncodedAccount(rpc, wusdcAccount, { commitment: "confirmed" }),
      usdcAccount ? readPublicTokenBalance(rpc, usdcAccount) : Promise.resolve(null),
    ]);
    const wusdc = tokenAccountState(encoded);
    const configured = wusdc.status === "present" && wusdc.confidential !== null;
    let confidential: ConfidentialView;
    if (!input.unlocked) {
      confidential = { kind: "locked", configured };
    } else if (!configured || !encoded.exists) {
      confidential = { kind: "not_set_up" };
    } else {
      try {
        const decrypted = await input.vault.openWorker().decrypt(new Uint8Array(encoded.data));
        confidential = {
          kind: "decrypted",
          available: decrypted.available,
          pending: decrypted.pending,
          credits: decrypted.pendingBalanceCreditCounter,
          maximumCredits: decrypted.maximumPendingBalanceCreditCounter,
        };
      } catch (error) {
        confidential =
          error instanceof CryptoWorkerError && error.code === "locked"
            ? { kind: "locked", configured }
            : {
                kind: "unreadable",
                reason: error instanceof CryptoWorkerError ? error.code : "failed",
              };
      }
    }
    return { loading: false, error: null, usdcAccount, wusdcAccount, usdc, wusdc, confidential };
  } catch {
    return {
      ...EMPTY,
      loading: false,
      error: "The balances could not be read from the network. Try again.",
    };
  }
}

export function ConfidentialProvider({
  wallet,
  orgId,
  network,
  readAccount = true,
  children,
}: {
  wallet: string;
  orgId: string;
  network: AvailableNetwork;
  /** False on pages that show no balances or account (the recipients page): no chain reads. */
  readAccount?: boolean;
  children: ReactNode;
}) {
  const wallets = useWallets().filter((w) => canHoldConfidentialBalances(walletCapabilities(w)));
  const { shared, setShared } = useKeySession();
  const setAccount = useCallback(
    (account: UiWalletAccount, from: UiWallet) => setShared({ account, wallet: from }),
    [setShared],
  );
  // The signed in wallet's account: shared on connect in this tab, or already authorized.
  const authorizedWallet =
    wallets.find((w) => w.accounts.some((a) => a.address === wallet)) ?? null;
  const account =
    (shared?.account.address === wallet ? shared.account : null) ??
    authorizedWallet?.accounts.find((a) => a.address === wallet) ??
    null;
  const uiWallet = (shared?.account.address === wallet ? shared.wallet : null) ?? authorizedWallet;
  const vault = useVault(wallet);
  const ready = network.check.status === "ok" && network.wrappedMint !== null;
  const [data, setData] = useState<AccountData>(EMPTY);
  const request = useRef(0);

  /** Reads everything from chain once; the caller decides whether the result is still wanted. */
  const read = useCallback(
    () => readAccountData({ wallet, network, unlocked: vault.unlocked !== null, vault }),
    [wallet, network, vault],
  );

  // Every change of the keys (unlock, lock) reads the chain again: Locked shows no number.
  useEffect(() => {
    if (!ready || !readAccount) return;
    const id = ++request.current;
    void read().then((next) => {
      if (id === request.current) setData(next);
    });
  }, [ready, readAccount, read]);

  /** Reads chain state again after a step (AC-04.4); the last values stay while it reads. */
  const refresh = useCallback(async () => {
    if (!ready || !readAccount) return;
    const id = ++request.current;
    setData((current) => ({ ...current, loading: true, error: null }));
    const next = await read();
    if (id === request.current) setData(next);
  }, [ready, readAccount, read]);

  const blocked = network.proofProgram.status === "unavailable" ? PROGRAM_BLOCKED : null;
  const base = {
    wallet,
    orgId,
    network,
    wallets,
    setAccount,
    ready,
    vault,
    data,
    refresh,
    blocked,
  };
  if (!account || !uiWallet) {
    return (
      <ConfidentialContext.Provider value={{ ...base, connected: null }}>
        {children}
      </ConfidentialContext.Provider>
    );
  }
  return (
    <ConnectedLayer base={base} account={account} uiWallet={uiWallet}>
      {children}
    </ConnectedLayer>
  );
}

function ConnectedLayer({
  base,
  account,
  uiWallet,
  children,
}: {
  base: Omit<ContextValue, "connected">;
  account: UiWalletAccount;
  uiWallet: UiWallet;
  children: ReactNode;
}) {
  const signMessage = useSignMessage(account);
  const wallet = base.wallet;
  // Outside React state: what the wallet said for the last refused signature, read after the call.
  const [lastWords] = useState(() => new WalletWordsBox());
  const sign = useCallback(
    async (message: Uint8Array): Promise<Uint8Array | SignProblem> => {
      lastWords.set(null);
      let output: { signedMessage: Uint8Array; signature: Uint8Array };
      try {
        output = await signMessage({ message });
      } catch (error) {
        lastWords.set(walletWords(uiWallet.name, error));
        return isWalletCancel(error) ? "cancelled" : "refused";
      }
      const signature = new Uint8Array(output.signature);
      const check = await checkSignedMessage({
        wallet,
        requested: message,
        signedMessage: new Uint8Array(output.signedMessage),
        signature,
      });
      if (!check.ok) {
        signature.fill(0);
        return check.reason;
      }
      return signature;
    },
    [signMessage, wallet, uiWallet.name, lastWords],
  );
  const words = useCallback(() => lastWords.get(), [lastWords]);
  const info = useMemo(() => walletInfo(uiWallet), [uiWallet]);
  const version = versionFor(uiWallet, base.network.v1);
  const provide = (
    signer: TransactionModifyingSigner | null,
    batch: TransactionModifyingSigner | null,
  ) => (
    <ConfidentialContext.Provider
      value={{
        ...base,
        connected: {
          account,
          info,
          sign,
          walletWords: words,
          signer,
          batchSigner: batch,
          version,
        },
      }}
    >
      {children}
    </ConfidentialContext.Provider>
  );
  // The signer hook refuses, while rendering, an account that does not offer the chain.
  return account.chains.includes(base.network.chain) ? (
    <TransactionSigner account={account} chain={base.network.chain}>
      {provide}
    </TransactionSigner>
  ) : (
    provide(null, null)
  );
}

function TransactionSigner({
  account,
  chain,
  children,
}: {
  account: UiWalletAccount;
  chain: `solana:${string}`;
  children: (signer: TransactionModifyingSigner, batch: TransactionModifyingSigner) => ReactNode;
}) {
  const signer = useWalletAccountTransactionSigner(account, chain);
  const signTransactions = useSignTransactions(account, chain);
  const batch = useMemo(
    () => batchSigner(account.address, signTransactions),
    [account.address, signTransactions],
  );
  return <>{children(signer, batch)}</>;
}
