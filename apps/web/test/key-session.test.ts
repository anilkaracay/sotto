// The tab's key session (04 section 5, 10 section 3; step 1.7.1): keys unlocked once serve every page of
// the tab, and each end condition locks them and closes the worker: the Lock button, 15 minutes idle,
// 5 minutes hidden, sign out or another signed in wallet, an org switch, a change of the wallet account.
// Reload ends the tab's scripts; the browser tests cover it. Since step 1.8.1 one Unlock click asks for
// the confidential key signature and then the viewing key signature (unlock.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CryptoWorkerError, type CryptoWorkerClient } from "../lib/crypto-worker/client.ts";
import {
  createKeySession,
  orgOfPath,
  type LockReason,
  type Unlocked,
  type Viewing,
} from "../lib/crypto-worker/key-session.ts";
import { unlockKeys, unlockViewingKey, type SignProblem } from "../lib/crypto-worker/unlock.ts";

const WALLET = "EQMW3o1DVsB72Ej1RRRmHLW1XaEpbjLKrMHUbS8cRLZC";
const OTHER = "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L";
const ORG_A = "0b8f3c3e-5d53-4d4e-9d7f-0f3f2d1c0a11";
const ORG_B = "7c2a9e41-1b2c-4f0e-8a77-3d5e6f708192";

/** A worker client stand in: unlock answers a public key; close is recorded. */
function fakeClient() {
  const client = {
    closed: 0,
    unlock: vi.fn(async () => ({ elgamalPubkey: "BxMVLbjVntF9DJtDjfpQLrgw4hopedMgNkZZKGcVkZp6" })),
    unlockViewing: vi.fn(async () => ({ publicKey: "AAAA" })),
    close: vi.fn(async () => {
      client.closed += 1;
    }),
  };
  return client;
}

function setUp() {
  const clients: ReturnType<typeof fakeClient>[] = [];
  const changes: {
    unlocked: Unlocked | null;
    viewing: Viewing | null;
    reason: LockReason | null;
  }[] = [];
  const session = createKeySession({
    onChange: (snapshot, reason) => changes.push({ ...snapshot, reason }),
    createClient: () => {
      const client = fakeClient();
      clients.push(client);
      return client as unknown as CryptoWorkerClient;
    },
  });
  const unlock = async () => {
    await session.unlock(WALLET, new Uint8Array(64));
    expect(session.unlocked()).toMatchObject({ wallet: WALLET });
  };
  const lastReason = () => changes.at(-1)?.reason ?? null;
  return { session, clients, changes, unlock, lastReason };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the tab's key session", () => {
  it("AC-03.5 opens with the worker holding the keys and starts none once they locked", async () => {
    const { session, clients, unlock } = setUp();
    expect(() => session.openWorker()).toThrow(CryptoWorkerError);
    expect(clients).toHaveLength(0);
    await unlock();
    expect(session.openWorker()).toBe(clients[0]);
    session.lock("wallet_change");
    // A read still running after the lock gets "locked", and no new worker starts for it.
    let caught: unknown = null;
    try {
      session.openWorker();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CryptoWorkerError);
    expect((caught as CryptoWorkerError).code).toBe("locked");
    expect(clients).toHaveLength(1);
    expect(clients[0]?.closed).toBe(1);
  });

  it("AC-03.5 keeps the keys across the pages of one org and ends them on the Lock button", async () => {
    const { session, clients, unlock, lastReason } = setUp();
    session.navigated(`/app/${ORG_A}/setup`);
    await unlock();
    for (const page of [
      `/app/${ORG_A}/overview`,
      "/app/onboarding",
      "/app/admin",
      `/app/${ORG_A}/setup`,
    ]) {
      session.navigated(page);
      expect(session.unlocked(), page).not.toBeNull();
    }
    expect(clients).toHaveLength(1);
    session.lock("button");
    expect(session.unlocked()).toBeNull();
    expect(lastReason()).toBe("button");
    expect(clients[0]?.closed).toBe(1);
    // The next unlock gets a new worker: nothing of the closed one is reused.
    await unlock();
    expect(clients).toHaveLength(2);
  });

  it("ends the keys after 15 minutes without activity and after 5 minutes hidden, never during a hold", async () => {
    const idle = setUp();
    await idle.unlock();
    vi.advanceTimersByTime(14 * 60 * 1000);
    idle.session.activity();
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(idle.session.unlocked()).not.toBeNull();
    vi.advanceTimersByTime(60 * 1000);
    expect(idle.session.unlocked()).toBeNull();
    expect(idle.lastReason()).toBe("idle");
    expect(idle.clients[0]?.closed).toBe(1);

    const hidden = setUp();
    await hidden.unlock();
    hidden.session.visibility(true);
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(hidden.session.unlocked()).toBeNull();
    expect(hidden.lastReason()).toBe("hidden");

    const held = setUp();
    await held.unlock();
    const release = held.session.hold();
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(held.session.unlocked()).not.toBeNull();
    release();
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(held.lastReason()).toBe("idle");
  });

  it("ends the keys on sign out and on a page of another signed in wallet", async () => {
    const out = setUp();
    await out.unlock();
    out.session.signedIn(WALLET);
    expect(out.session.unlocked()).not.toBeNull();
    out.session.signOut();
    expect(out.lastReason()).toBe("sign_out");
    expect(out.clients[0]?.closed).toBe(1);

    const other = setUp();
    await other.unlock();
    other.session.signedIn(OTHER);
    expect(other.lastReason()).toBe("other_wallet");

    const none = setUp();
    await none.unlock();
    none.session.signedIn(null);
    expect(none.lastReason()).toBe("sign_out");
  });

  it("ends the keys on a switch to another org, and when the tab leaves the app", async () => {
    const { session, clients, unlock, lastReason } = setUp();
    session.navigated(`/app/${ORG_A}/setup`);
    await unlock();
    session.navigated("/app/onboarding");
    expect(session.unlocked()).not.toBeNull();
    session.navigated(`/app/${ORG_B}/setup`);
    expect(session.unlocked()).toBeNull();
    expect(lastReason()).toBe("org_switch");
    expect(clients[0]?.closed).toBe(1);

    await unlock();
    session.navigated("/");
    expect(lastReason()).toBe("left_app");
    expect(orgOfPath(`/app/${ORG_A.toUpperCase()}/overview`)).toBe(ORG_A);
    expect(orgOfPath("/app/sign-in")).toBeNull();
  });

  it("ends the keys when the wallet no longer offers the unlocked account", async () => {
    const { session, clients, unlock, lastReason } = setUp();
    await unlock();
    session.walletAccounts([OTHER, WALLET]);
    expect(session.unlocked()).not.toBeNull();
    session.walletAccounts([OTHER]);
    expect(session.unlocked()).toBeNull();
    expect(lastReason()).toBe("wallet_change");
    expect(clients[0]?.closed).toBe(1);

    await unlock();
    session.walletAccounts([]);
    expect(lastReason()).toBe("wallet_change");
  });

  it("holds the viewing key under the same end conditions (step 1.8)", async () => {
    const { session, clients, changes, lastReason } = setUp();
    expect(await session.unlockViewing(WALLET, new Uint8Array(64))).toEqual({
      wallet: WALLET,
      publicKey: "AAAA",
    });
    expect(session.viewing()).toEqual({ wallet: WALLET, publicKey: "AAAA" });
    expect(changes.at(-1)).toEqual({
      unlocked: null,
      viewing: { wallet: WALLET, publicKey: "AAAA" },
      reason: null,
    });
    session.signedIn(WALLET);
    session.walletAccounts([WALLET]);
    expect(session.viewing()).toMatchObject({ wallet: WALLET });
    session.walletAccounts([OTHER]);
    expect(session.viewing()).toBeNull();
    expect(lastReason()).toBe("wallet_change");
    expect(clients[0]?.closed).toBe(1);

    await session.unlockViewing(WALLET, new Uint8Array(64));
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(session.viewing()).toBeNull();
    expect(lastReason()).toBe("idle");
  });

  it("discards an unlock that a lock overtook", async () => {
    let finish: () => void = () => {};
    const closes: number[] = [];
    const session = createKeySession({
      onChange: () => {},
      createClient: () =>
        ({
          unlock: () =>
            new Promise((resolve) => {
              finish = () =>
                resolve({ elgamalPubkey: "BxMVLbjVntF9DJtDjfpQLrgw4hopedMgNkZZKGcVkZp6" });
            }),
          close: async () => void closes.push(1),
        }) as unknown as CryptoWorkerClient,
    });
    const waiting = session.unlock(WALLET, new Uint8Array(64));
    session.lock("button");
    finish();
    await expect(waiting).rejects.toThrow("locked while unlocking");
    expect(session.unlocked()).toBeNull();
    expect(closes).toHaveLength(1);
  });
});

describe("one Unlock click (step 1.8.1)", () => {
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

  /** A wallet stand in: answers each message with a distinct signature, or with a problem. */
  function wallet(answers: Record<string, SignProblem> = {}) {
    const asked: string[] = [];
    const sign = vi.fn(async (message: Uint8Array) => {
      const request = text(message);
      asked.push(request);
      return answers[request] ?? new Uint8Array(64).fill(asked.length);
    });
    return { asked, sign };
  }

  it("AC-03.2 asks for the confidential key signature, then the viewing key signature, and holds both keys for the tab", async () => {
    const { session, clients } = setUp();
    const { asked, sign } = wallet();
    expect(await unlockKeys({ wallet: WALLET, sign, session })).toEqual({
      keys: "unlocked",
      viewing: "unlocked",
    });
    expect(asked).toEqual(["solana-conf-bal/v1", `sotto-view-key/v1\n${WALLET}`]);
    // Two derivations from two signatures: neither key comes from the other's signature.
    const client = clients[0];
    const confidential = client?.unlock.mock.calls[0] as unknown as [string, Uint8Array];
    const viewingCall = client?.unlockViewing.mock.calls[0] as unknown as [string, Uint8Array];
    expect(confidential[1][0]).toBe(1);
    expect(viewingCall[1][0]).toBe(2);
    expect(session.unlocked()).toMatchObject({ wallet: WALLET });
    expect(session.viewing()).toMatchObject({ wallet: WALLET });
    // The same lock conditions end both, with one close of the one worker.
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(session.unlocked()).toBeNull();
    expect(session.viewing()).toBeNull();
    expect(clients).toHaveLength(1);
    expect(clients[0]?.closed).toBe(1);
  });

  it("keeps the confidential keys when the viewing key signature is refused, and can ask for it again", async () => {
    const { session } = setUp();
    const refusing = wallet({ [`sotto-view-key/v1\n${WALLET}`]: "refused" });
    expect(await unlockKeys({ wallet: WALLET, sign: refusing.sign, session })).toEqual({
      keys: "unlocked",
      viewing: "refused",
    });
    expect(session.unlocked()).toMatchObject({ wallet: WALLET });
    expect(session.viewing()).toBeNull();
    const willing = wallet();
    expect(await unlockViewingKey({ wallet: WALLET, sign: willing.sign, session })).toBe(
      "unlocked",
    );
    expect(willing.asked).toEqual([`sotto-view-key/v1\n${WALLET}`]);
    expect(session.viewing()).toMatchObject({ wallet: WALLET });
    expect(session.unlocked()).toMatchObject({ wallet: WALLET });
  });

  it("asks for no viewing key signature when the confidential keys do not unlock", async () => {
    const cancelled = setUp();
    const cancelling = wallet({ "solana-conf-bal/v1": "cancelled" });
    expect(
      await unlockKeys({ wallet: WALLET, sign: cancelling.sign, session: cancelled.session }),
    ).toEqual({ keys: "cancelled" });
    expect(cancelling.asked).toEqual(["solana-conf-bal/v1"]);
    expect(cancelled.session.unlocked()).toBeNull();

    // A signature the worker rejects: nothing stays unlocked and the worker is closed.
    const closes: number[] = [];
    const session = createKeySession({
      onChange: () => {},
      createClient: () =>
        ({
          unlock: async () => {
            throw new CryptoWorkerError("bad_signature", "The signature does not verify");
          },
          close: async () => void closes.push(1),
        }) as unknown as CryptoWorkerClient,
    });
    const { asked, sign } = wallet();
    expect(await unlockKeys({ wallet: WALLET, sign, session })).toEqual({
      keys: "bad_signature",
    });
    expect(asked).toEqual(["solana-conf-bal/v1"]);
    expect(session.unlocked()).toBeNull();
    expect(closes).toHaveLength(1);
  });
});
