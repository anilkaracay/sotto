"use client";

// The privacy screen (F-15, AC-15.1; step 2.9; design .ct.priv .m): when it is on, every amount in the
// app is blurred, and hovering or focusing one amount shows only that one. Every amount renders
// through `Amount`, so nothing is left out (the localnet specs check each page, 11 section 2). The
// choice is kept per device as one boolean in localStorage, the only thing this writes; it is neither
// key material nor an amount.
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { splitAmounts } from "../../../lib/amount-text.ts";
import { splitWalletWords } from "../../../lib/client/wallet-words.ts";
import styles from "./privacy.module.css";

export const PRIVACY_STORAGE_KEY = "sotto.privacy-screen";

type Privacy = { on: boolean; toggle: () => void };

/** Exported for the component tests (F-15). */
export const PrivacyContext = createContext<Privacy>({ on: false, toggle: () => undefined });

/** The choice of this page, used when storage cannot be read or written (blocked storage). */
let inMemory = false;

/** The stored choice, else this page's; off on the server (exported for the unit tests). */
export function readStored(): boolean {
  try {
    const stored = window.localStorage.getItem(PRIVACY_STORAGE_KEY);
    return stored === null ? inMemory : stored === "on";
  } catch {
    return inMemory;
  }
}

const listeners = new Set<() => void>();
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Turns the privacy screen on or off, the one write to storage (exported for the unit tests). */
export function togglePrivacy(): void {
  inMemory = !readStored();
  try {
    window.localStorage.setItem(PRIVACY_STORAGE_KEY, inMemory ? "on" : "off");
  } catch {
    // Blocked storage: the choice holds for this page only.
  }
  for (const listener of listeners) listener();
}

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const on = useSyncExternalStore(subscribe, readStored, () => false);
  const value = useMemo(() => ({ on, toggle: togglePrivacy }), [on]);
  return (
    <PrivacyContext.Provider value={value}>
      <div className={styles.root} data-privacy={on ? "on" : "off"}>
        {children}
      </div>
    </PrivacyContext.Provider>
  );
}

export function usePrivacy(): Privacy {
  return useContext(PrivacyContext);
}

/**
 * An amount on screen: a balance, a payment, a line, a threshold, a chart label. Blurred while the
 * privacy screen is on; focusable then, so a keyboard can show one amount at a time. An amount inside
 * a button (`inControl`) shows with its button's hover or focus instead of being a second tab stop.
 */
export function Amount({
  children,
  className,
  inControl = false,
}: {
  children: ReactNode;
  className?: string;
  inControl?: boolean;
}) {
  const { on } = usePrivacy();
  return (
    <span
      className={className ? `${styles.amount} ${className}` : styles.amount}
      data-amount=""
      tabIndex={on && !inControl ? 0 : undefined}
    >
      {children}
    </span>
  );
}

/** A message with amounts in it ("Funded 5 wUSDC…"): each amount renders through `Amount`. */
export function WithAmounts({ children }: { children: string | null | undefined }) {
  if (!children) return null;
  return (
    <>
      {splitAmounts(children).map((part, index) =>
        part.amount ? (
          <Amount key={index}>{part.text}</Amount>
        ) : (
          splitWalletWords(part.text).map((piece, at) =>
            piece.wallet ? (
              <span key={`${index}-${at}`} className={styles.walletWords}>
                {piece.text}
              </span>
            ) : (
              piece.text
            ),
          )
        ),
      )}
    </>
  );
}
