"use client";

// The tab's key session in React (04 section 5, 10 section 3): mounted once in the /app layout, so the
// crypto worker and the connected wallet account survive client side navigation between app pages
// (key-session.ts lists what ends them). It feeds the session every address the tab shows, activity,
// visibility and the accounts the wallets offer.
import { useWallets, type UiWallet, type UiWalletAccount } from "@wallet-standard/react";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  createKeySession,
  type KeySession,
  type LockReason,
  type Unlocked,
} from "../../../lib/crypto-worker/key-session.ts";

export type SharedAccount = { account: UiWalletAccount; wallet: UiWallet };

type KeySessionValue = {
  session: KeySession;
  unlocked: Unlocked | null;
  /** The wallet whose viewing key is unlocked in this tab (step 1.8). */
  viewing: string | null;
  /** Why the keys last locked, until the next unlock. */
  lockReason: LockReason | null;
  /** The account a wallet shared on connect in this tab. */
  shared: SharedAccount | null;
  setShared: (shared: SharedAccount | null) => void;
};

const KeySessionContext = createContext<KeySessionValue | null>(null);

export function useKeySession(): KeySessionValue {
  const value = useContext(KeySessionContext);
  if (!value) throw new Error("useKeySession needs the KeySessionProvider of the /app layout");
  return value;
}

/** Reasons that also forget the account the wallet shared: it is not the account to sign with now. */
const FORGET_ACCOUNT: readonly LockReason[] = ["wallet_change", "sign_out", "other_wallet"];

export function KeySessionProvider({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState<Unlocked | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [lockReason, setLockReason] = useState<LockReason | null>(null);
  const [shared, setShared] = useState<SharedAccount | null>(null);
  const [session] = useState(() =>
    createKeySession({
      onChange: (next, reason) => {
        setUnlocked(next.unlocked);
        setViewing(next.viewing);
        setLockReason(reason);
        if (reason && FORGET_ACCOUNT.includes(reason)) setShared(null);
      },
    }),
  );
  const pathname = usePathname();
  const wallets = useWallets();

  useEffect(() => {
    session.navigated(pathname);
  }, [session, pathname]);

  // Leaving the app ends the keys.
  useEffect(() => () => session.lock("left_app"), [session]);

  useEffect(() => {
    const onActivity = () => session.activity();
    const onVisibility = () => session.visibility(document.visibilityState === "hidden");
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("keydown", onActivity);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [session]);

  useEffect(() => {
    if (!unlocked && !viewing) return;
    session.walletAccounts(wallets.flatMap((w) => w.accounts.map((a) => a.address)));
  }, [session, wallets, unlocked, viewing]);

  return (
    <KeySessionContext.Provider
      value={{ session, unlocked, viewing, lockReason, shared, setShared }}
    >
      {children}
    </KeySessionContext.Provider>
  );
}
