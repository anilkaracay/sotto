// The crypto Web Worker pieces (04 section 5, 10 section 3): the key vault that runs in the worker, the
// page client and the auto lock. The vault runs here in Node with the same keys module.
import { createHash } from "node:crypto";
import {
  confidentialKeysMessage,
  deriveStandardKeys,
  deriveViewingKey,
  verifyWalletSignature,
  viewKeyMessage,
} from "@sotto/sdk/keys";
import {
  encodeToken2022Account,
  encryptedTokenAccount,
  randomizedEd25519Signature,
} from "@sotto/sdk/testing";
import {
  address,
  createKeyPairFromPrivateKeyBytes,
  getAddressFromPublicKey,
  signBytes,
} from "@solana/kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutoLock, HIDDEN_LOCK_MS, IDLE_LOCK_MS } from "../lib/crypto-worker/auto-lock.ts";
import {
  CryptoWorkerClient,
  CryptoWorkerError,
  type WorkerLike,
} from "../lib/crypto-worker/client.ts";
import type { WorkerRequest, WorkerResponse } from "../lib/crypto-worker/protocol.ts";
import { createVault, loadVaultModules } from "../lib/crypto-worker/vault.ts";

// The spl-token CLI check keypair (VERIFICATION-LOG step 1.5).
const CLI_SEED = createHash("sha256").update("sotto-cli-key-check/v1").digest();
const CLI_ELGAMAL_KEY = "BxMVLbjVntF9DJtDjfpQLrgw4hopedMgNkZZKGcVkZp6";

async function testWallet(seed: Uint8Array) {
  const keys = await createKeyPairFromPrivateKeyBytes(new Uint8Array(seed));
  return {
    address: await getAddressFromPublicKey(keys.publicKey),
    sign: async (message: Uint8Array) => new Uint8Array(await signBytes(keys.privateKey, message)),
  };
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

afterEach(() => {
  vi.useRealTimers();
});

describe("key vault (inside the worker)", () => {
  it("AC-03.2 derives and holds the keys and answers with public keys only", async () => {
    const vault = createVault(loadVaultModules);
    const wallet = await testWallet(CLI_SEED);
    const signature = await wallet.sign(confidentialKeysMessage());
    const viewSignature = await wallet.sign(viewKeyMessage(wallet.address));
    // The secrets the vault must never return, derived here from the same signatures.
    const secrets = await deriveStandardKeys(wallet.address, signature);
    const viewing = await deriveViewingKey(wallet.address, viewSignature);
    const secretPatterns = [
      signature,
      viewSignature,
      secrets.elgamalSecretKey,
      secrets.aeKey,
      viewing.secretKey,
    ].flatMap((bytes) => [hex(bytes), b64(bytes)]);

    const sent = new Uint8Array(signature);
    const responses: WorkerResponse[] = [];
    const unlocked = await vault.handle({
      id: 1,
      type: "unlock",
      wallet: wallet.address,
      signature: sent.buffer,
    });
    responses.push(unlocked);
    expect(unlocked).toEqual({ id: 1, ok: true, result: { elgamalPubkey: CLI_ELGAMAL_KEY } });
    // The worker zeroes the signature bytes once the keys are derived.
    expect(sent.every((byte) => byte === 0)).toBe(true);

    responses.push(
      await vault.handle({ id: 2, type: "checkAccount", elgamalPubkey: CLI_ELGAMAL_KEY }),
    );
    responses.push(
      await vault.handle({ id: 3, type: "checkAccount", elgamalPubkey: wallet.address }),
    );
    expect(responses[1]).toEqual({ id: 2, ok: true, result: { matches: true } });
    expect(responses[2]).toEqual({ id: 3, ok: true, result: { matches: false } });

    const view = await vault.handle({
      id: 4,
      type: "unlockViewing",
      wallet: wallet.address,
      signature: new Uint8Array(viewSignature).buffer,
    });
    responses.push(view);
    expect(view).toEqual({ id: 4, ok: true, result: { publicKey: b64(viewing.publicKey) } });
    responses.push(await vault.handle({ id: 5, type: "status" }));
    expect(responses[4]).toEqual({
      id: 5,
      ok: true,
      result: { wallet: wallet.address, unlocked: true, viewing: true },
    });

    const serialized = JSON.stringify(responses);
    for (const pattern of secretPatterns) expect(serialized).not.toContain(pattern);
  });

  it("I-5 refuses the account check before unlock, and bad signatures", async () => {
    const vault = createVault(loadVaultModules);
    const wallet = await testWallet(CLI_SEED);
    expect(
      await vault.handle({ id: 1, type: "checkAccount", elgamalPubkey: CLI_ELGAMAL_KEY }),
    ).toEqual({
      id: 1,
      ok: false,
      error: { code: "not_unlocked", message: "Unlock the confidential keys first" },
    });
    const wrongMessage = await wallet.sign(new TextEncoder().encode("sign in"));
    const response = await vault.handle({
      id: 2,
      type: "unlock",
      wallet: wallet.address,
      signature: wrongMessage.buffer,
    });
    expect(response).toMatchObject({ id: 2, ok: false, error: { code: "bad_signature" } });
    expect(await vault.handle({ id: 3, type: "status" })).toMatchObject({
      result: { unlocked: false },
    });
  });

  it("clears the keys of the previous wallet when another wallet unlocks", async () => {
    const vault = createVault(loadVaultModules);
    const first = await testWallet(CLI_SEED);
    const second = await testWallet(new Uint8Array(32).fill(4));
    await vault.handle({
      id: 1,
      type: "unlock",
      wallet: first.address,
      signature: (await first.sign(confidentialKeysMessage())).buffer,
    });
    await vault.handle({
      id: 2,
      type: "unlockViewing",
      wallet: second.address,
      signature: (await second.sign(viewKeyMessage(second.address))).buffer,
    });
    expect(await vault.handle({ id: 3, type: "status" })).toEqual({
      id: 3,
      ok: true,
      result: { wallet: second.address, unlocked: false, viewing: true },
    });
  });
});

const MINT = address("AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd");

describe("locking (step 1.7.1)", () => {
  it("AC-03.5 leaves no key material in the vault after a lock: keys, viewing key and digest are zeroed", async () => {
    const held: Uint8Array[] = [];
    const vault = createVault(async () => {
      const modules = await loadVaultModules();
      return {
        ...modules,
        deriveStandardKeys: async (...args: Parameters<typeof modules.deriveStandardKeys>) => {
          const keys = await modules.deriveStandardKeys(...args);
          held.push(keys.elgamalSecretKey, keys.aeKey);
          return keys;
        },
        deriveViewingKey: async (...args: Parameters<typeof modules.deriveViewingKey>) => {
          const keys = await modules.deriveViewingKey(...args);
          held.push(keys.secretKey);
          return keys;
        },
      };
    });
    const wallet = await testWallet(CLI_SEED);
    await vault.handle({
      id: 1,
      type: "unlock",
      wallet: wallet.address,
      signature: (await wallet.sign(confidentialKeysMessage())).buffer,
    });
    await vault.handle({
      id: 2,
      type: "unlockViewing",
      wallet: wallet.address,
      signature: (await wallet.sign(viewKeyMessage(wallet.address))).buffer,
    });
    expect(held).toHaveLength(3);
    expect(held.every((bytes) => bytes.some((byte) => byte !== 0))).toBe(true);

    expect(await vault.handle({ id: 3, type: "clear" })).toEqual({
      id: 3,
      ok: true,
      result: { cleared: true },
    });
    expect(held.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
    expect(await vault.handle({ id: 4, type: "status" })).toEqual({
      id: 4,
      ok: true,
      result: { wallet: null, unlocked: false, viewing: false },
    });
    // Nothing that needs the keys or the unlock signature's digest works any more.
    expect(await vault.handle({ id: 5, type: "setupInstructions", mint: MINT })).toMatchObject({
      error: { code: "not_unlocked" },
    });
    expect(
      await vault.handle({
        id: 6,
        type: "confirmSignature",
        wallet: wallet.address,
        signature: (await wallet.sign(confidentialKeysMessage())).buffer,
      }),
    ).toMatchObject({ error: { code: "not_unlocked" } });
  });

  it("closes the worker after the vault cleared, or after a timeout, and refuses requests meanwhile", async () => {
    const answered = fakeWorker();
    const client = new CryptoWorkerClient(answered.worker);
    answered.worker.respond({ type: "ready" });
    const closing = client.close();
    await vi.waitFor(() => expect(answered.posted).toHaveLength(1));
    const [request] = answered.posted;
    expect(request?.message.type).toBe("clear");
    await expect(client.status()).rejects.toMatchObject({ code: "locked" });
    expect(answered.isTerminated()).toBe(false);
    answered.worker.respond({ id: request?.message.id ?? 0, ok: true, result: { cleared: true } });
    await closing;
    expect(answered.isTerminated()).toBe(true);

    // A worker that never answers is terminated after the timeout.
    const silent = fakeWorker();
    const stuck = new CryptoWorkerClient(silent.worker);
    silent.worker.respond({ type: "ready" });
    await stuck.close(20);
    expect(silent.isTerminated()).toBe(true);
  });
});

describe("account work in the vault (step 1.7)", () => {
  it("AC-03.3 refuses account setup when the wallet's second key signature differs (determinism check)", async () => {
    const vault = createVault(loadVaultModules);
    const wallet = await testWallet(CLI_SEED);
    const message = confidentialKeysMessage();
    const confirm = (id: number, signature: Uint8Array, from = wallet.address) =>
      vault.handle({
        id,
        type: "confirmSignature",
        wallet: from,
        signature: signature.buffer as ArrayBuffer,
      });

    expect(await confirm(1, await wallet.sign(message))).toMatchObject({
      ok: false,
      error: { code: "not_unlocked" },
    });
    await vault.handle({
      id: 2,
      type: "unlock",
      wallet: wallet.address,
      signature: (await wallet.sign(message)).buffer,
    });

    // A deterministic wallet gives the same signature again; the vault zeroes it after the check.
    const again = await wallet.sign(message);
    expect(await confirm(3, again)).toEqual({ id: 3, ok: true, result: { same: true } });
    expect(again.every((byte) => byte === 0)).toBe(true);

    // A wallet with random nonces gives another valid signature: the keys would change next time.
    const randomized = await randomizedEd25519Signature(CLI_SEED, message);
    expect(await verifyWalletSignature(wallet.address, message, randomized)).toBe(true);
    expect(await confirm(4, randomized)).toEqual({ id: 4, ok: true, result: { same: false } });

    const other = await testWallet(new Uint8Array(32).fill(9));
    expect(await confirm(5, await other.sign(message))).toMatchObject({
      error: { code: "bad_signature" },
    });
    expect(await confirm(6, await other.sign(message), other.address)).toMatchObject({
      error: { code: "not_unlocked" },
    });
  });

  it("AC-03.3 AC-03.4 builds the setup instructions and decrypts only with the account's keys", async () => {
    const vault = createVault(loadVaultModules);
    const wallet = await testWallet(CLI_SEED);
    const signature = await wallet.sign(confidentialKeysMessage());
    const keys = await deriveStandardKeys(wallet.address, signature);
    const secretPatterns = [signature, keys.elgamalSecretKey, keys.aeKey].flatMap((bytes) => [
      hex(bytes),
      b64(bytes),
    ]);
    expect(
      await vault.handle({ id: 1, type: "decrypt", account: new ArrayBuffer(8) }),
    ).toMatchObject({ error: { code: "not_unlocked" } });
    await vault.handle({
      id: 2,
      type: "unlock",
      wallet: wallet.address,
      signature: new Uint8Array(signature).buffer,
    });

    const setup = await vault.handle({ id: 3, type: "setupInstructions", mint: MINT });
    expect(setup).toMatchObject({ ok: true, result: { instructions: expect.any(Array) } });
    if (!("ok" in setup) || !setup.ok || !("instructions" in setup.result)) {
      throw new Error("no setup instructions");
    }
    expect(setup.result.instructions).toHaveLength(4);
    expect(structuredClone(setup.result)).toEqual(setup.result);

    const own = encodeToken2022Account(
      encryptedTokenAccount({
        owner: wallet.address,
        mint: MINT,
        keys,
        available: 42n,
        pending: 5n,
      }),
    );
    const decrypted = await vault.handle({ id: 4, type: "decrypt", account: own.slice().buffer });
    expect(decrypted).toEqual({
      id: 4,
      ok: true,
      result: {
        available: 42n,
        pending: 5n,
        pendingBalanceCreditCounter: 0n,
        maximumPendingBalanceCreditCounter: 65_536n,
      },
    });
    const apply = await vault.handle({
      id: 5,
      type: "applyInstruction",
      token: MINT,
      account: own.slice().buffer,
    });
    expect(apply).toMatchObject({
      ok: true,
      result: { instruction: { accounts: expect.any(Array) } },
    });

    const stranger = await testWallet(new Uint8Array(32).fill(5));
    const strangerKeys = await deriveStandardKeys(
      stranger.address,
      await stranger.sign(confidentialKeysMessage()),
    );
    const theirs = encodeToken2022Account(
      encryptedTokenAccount({
        owner: stranger.address,
        mint: MINT,
        keys: strangerKeys,
        available: 1n,
        pending: 0n,
      }),
    );
    expect(
      await vault.handle({ id: 6, type: "decrypt", account: theirs.slice().buffer }),
    ).toMatchObject({ ok: false, error: { code: "key_mismatch" } });
    expect(
      await vault.handle({
        id: 7,
        type: "applyInstruction",
        token: MINT,
        account: theirs.slice().buffer,
      }),
    ).toMatchObject({ ok: false, error: { code: "wrong_owner" } });

    const serialized = JSON.stringify([setup, decrypted, apply], (_, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    for (const pattern of secretPatterns) expect(serialized).not.toContain(pattern);
  });
});

/** A worker stand in: records posted messages and lets the test answer. */
function fakeWorker() {
  const posted: { message: WorkerRequest; transfer: Transferable[] }[] = [];
  let terminated = false;
  const worker: WorkerLike & { respond: (message: WorkerResponse) => void } = {
    onmessage: null,
    onerror: null,
    postMessage: (message, transfer) => posted.push({ message, transfer }),
    terminate: () => {
      terminated = true;
    },
    respond: (message) => worker.onmessage?.({ data: message } as MessageEvent<WorkerResponse>),
  };
  return { worker, posted, isTerminated: () => terminated };
}

describe("crypto worker client (the page side)", () => {
  it("waits for ready, transfers the signature and zeroes the page's copy", async () => {
    const { worker, posted } = fakeWorker();
    const client = new CryptoWorkerClient(worker);
    const signature = new Uint8Array(64).fill(7);
    const pending = client.unlock("EQMW3o1DVsB72Ej1RRRmHLW1XaEpbjLKrMHUbS8cRLZC", signature);
    expect(signature.every((byte) => byte === 0)).toBe(true);
    await Promise.resolve();
    expect(posted).toHaveLength(0);

    worker.respond({ type: "ready" });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const [first] = posted;
    if (!first || first.message.type !== "unlock") throw new Error("expected an unlock request");
    expect(first.transfer).toEqual([first.message.signature]);
    expect(new Uint8Array(first.message.signature).every((byte) => byte === 7)).toBe(true);
    worker.respond({ id: first.message.id, ok: true, result: { elgamalPubkey: CLI_ELGAMAL_KEY } });
    await expect(pending).resolves.toEqual({ elgamalPubkey: CLI_ELGAMAL_KEY });
  });

  it("maps worker errors, and locking terminates the worker and rejects what is pending", async () => {
    const { worker, posted, isTerminated } = fakeWorker();
    const client = new CryptoWorkerClient(worker);
    worker.respond({ type: "ready" });
    const failing = client.checkAccount(CLI_ELGAMAL_KEY);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    worker.respond({
      id: posted[0]?.message.id ?? 0,
      ok: false,
      error: { code: "not_unlocked", message: "Unlock the confidential keys first" },
    });
    await expect(failing).rejects.toMatchObject({ code: "not_unlocked" });

    const hanging = client.status();
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    client.terminate();
    expect(isTerminated()).toBe(true);
    await expect(hanging).rejects.toBeInstanceOf(CryptoWorkerError);
    await expect(client.status()).rejects.toMatchObject({ code: "locked" });
  });
});

describe("auto lock (10 section 3)", () => {
  it("locks after 15 idle minutes, and activity restarts the wait", () => {
    vi.useFakeTimers();
    const onLock = vi.fn();
    const lock = createAutoLock({ onLock });
    vi.advanceTimersByTime(IDLE_LOCK_MS - 1000);
    lock.activity();
    vi.advanceTimersByTime(IDLE_LOCK_MS - 1000);
    expect(onLock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onLock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(IDLE_LOCK_MS * 2);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("locks 5 minutes after the tab is hidden, not if it comes back", () => {
    vi.useFakeTimers();
    const onLock = vi.fn();
    const lock = createAutoLock({ onLock });
    lock.visibility(true);
    vi.advanceTimersByTime(HIDDEN_LOCK_MS - 1000);
    lock.visibility(false);
    vi.advanceTimersByTime(HIDDEN_LOCK_MS);
    expect(onLock).not.toHaveBeenCalled();
    lock.visibility(true);
    vi.advanceTimersByTime(HIDDEN_LOCK_MS);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("never locks while an execution or proof holds it, and resumes after", () => {
    vi.useFakeTimers();
    const onLock = vi.fn();
    const lock = createAutoLock({ onLock });
    lock.visibility(true);
    const release = lock.hold();
    vi.advanceTimersByTime(IDLE_LOCK_MS * 3);
    expect(onLock).not.toHaveBeenCalled();
    release();
    release();
    vi.advanceTimersByTime(HIDDEN_LOCK_MS);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("does nothing once stopped", () => {
    vi.useFakeTimers();
    const onLock = vi.fn();
    createAutoLock({ onLock }).stop();
    vi.advanceTimersByTime(IDLE_LOCK_MS * 2);
    expect(onLock).not.toHaveBeenCalled();
  });
});
