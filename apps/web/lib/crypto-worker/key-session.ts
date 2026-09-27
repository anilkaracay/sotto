// The key session of a browser tab (04 section 5, 10 section 3; founder, 2026-09-27): one crypto
// worker per tab, shared across in-app navigation, so keys unlocked on one page serve every page of the
// tab without a new signature. The keys end on:
// - the Lock button;
// - 15 minutes without activity, or 5 minutes with the tab hidden (auto-lock.ts), unless an execution
//   holds them open;
// - reload (the tab's scripts end with the page);
// - sign out, or a page of another signed in wallet;
// - a switch to another org (the org in the address changes);
// - a change of the wallet account (the unlocked wallet's account is no longer offered).
// Locking asks the vault to zero the keys it holds and then terminates the worker (client.ts close).
// This module holds no keys: the worker does; the session knows the unlocked wallet and its public key.
import { createAutoLock } from "./auto-lock.ts";
import { CryptoWorkerClient } from "./client.ts";
import type { UnlockResult } from "./protocol.ts";

export type LockReason =
  | "button"
  | "idle"
  | "hidden"
  | "sign_out"
  | "other_wallet"
  | "org_switch"
  | "wallet_change"
  | "left_app";

export type Unlocked = { wallet: string; elgamalPubkey: string };

type Timers = NonNullable<Parameters<typeof createAutoLock>[0]["timers"]>;

/** The org of an org page address (/app/<org id>/...), or null for any other page. */
export function orgOfPath(pathname: string): string | null {
  const match =
    /^\/app\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i.exec(
      pathname,
    );
  return match?.[1]?.toLowerCase() ?? null;
}

export function createKeySession(options: {
  onChange: (unlocked: Unlocked | null, reason: LockReason | null) => void;
  createClient?: () => CryptoWorkerClient;
  timers?: Timers;
  idleMs?: number;
  hiddenMs?: number;
}) {
  const createClient = options.createClient ?? (() => new CryptoWorkerClient());
  let client: CryptoWorkerClient | null = null;
  let unlocked: Unlocked | null = null;
  let autoLock: ReturnType<typeof createAutoLock> | null = null;
  let hidden = false;
  let org: string | null = null;

  function worker(): CryptoWorkerClient {
    return (client ??= createClient());
  }

  function lock(reason: LockReason): void {
    if (!client && !unlocked) return;
    const ending = client;
    const wasUnlocked = unlocked !== null;
    client = null;
    unlocked = null;
    autoLock?.stop();
    autoLock = null;
    void ending?.close();
    if (wasUnlocked) options.onChange(null, reason);
  }

  function arm(): void {
    autoLock?.stop();
    autoLock = createAutoLock({
      // The timer that fired: hidden when the tab is hidden, idle otherwise.
      onLock: () => lock(hidden ? "hidden" : "idle"),
      ...(options.timers ? { timers: options.timers } : {}),
      ...(options.idleMs === undefined ? {} : { idleMs: options.idleMs }),
      ...(options.hiddenMs === undefined ? {} : { hiddenMs: options.hiddenMs }),
    });
    if (hidden) autoLock.visibility(true);
  }

  return {
    /** The tab's worker: the one holding the keys, or a new one before unlock. */
    worker,
    unlocked: (): Unlocked | null => unlocked,
    async unlock(wallet: string, signature: Uint8Array): Promise<UnlockResult> {
      const current = worker();
      const result = await current.unlock(wallet, signature);
      if (client !== current) throw new Error("The keys were locked while unlocking");
      unlocked = { wallet, elgamalPubkey: result.elgamalPubkey };
      arm();
      options.onChange(unlocked, null);
      return result;
    },
    lock,
    /** Keeps the keys open during an execution; call the returned function when done. */
    hold: (): (() => void) => autoLock?.hold() ?? (() => {}),
    activity: (): void => autoLock?.activity(),
    visibility(isHidden: boolean): void {
      hidden = isHidden;
      autoLock?.visibility(isHidden);
    },
    /** Every address the tab shows; a page of another org locks. */
    navigated(pathname: string): void {
      if (!pathname.startsWith("/app")) {
        lock("left_app");
        return;
      }
      const next = orgOfPath(pathname);
      if (next === null) return;
      if (org !== null && next !== org) lock("org_switch");
      org = next;
    },
    /** The accounts the tab's wallets offer; the unlocked wallet's account must stay among them. */
    walletAccounts(addresses: readonly string[]): void {
      if (unlocked && !addresses.includes(unlocked.wallet)) lock("wallet_change");
    },
    /** The signed in wallet a page was rendered for; another wallet, or none, locks. */
    signedIn(wallet: string | null): void {
      if (unlocked && unlocked.wallet !== wallet) lock(wallet ? "other_wallet" : "sign_out");
    },
    signOut: (): void => lock("sign_out"),
  };
}

export type KeySession = ReturnType<typeof createKeySession>;
