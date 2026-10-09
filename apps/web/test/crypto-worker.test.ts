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
  confidentialTokenAccount,
  encodeConfidentialMint,
  encodeToken2022Account,
  encryptedTokenAccount,
  randomizedEd25519Signature,
} from "@sotto/sdk/testing";
import { fromPortableInstruction } from "@sotto/sdk/tx";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairFromPrivateKeyBytes,
  createTransactionMessage,
  getAddressFromPublicKey,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signBytes,
  type Blockhash,
} from "@solana/kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutoLock, HIDDEN_LOCK_MS, IDLE_LOCK_MS } from "../lib/crypto-worker/auto-lock.ts";
import {
  CryptoWorkerClient,
  CryptoWorkerError,
  type WorkerLike,
} from "../lib/crypto-worker/client.ts";
import type { RentReply, WorkerRequest, WorkerResponse } from "../lib/crypto-worker/protocol.ts";
import { createVault, loadVaultModules } from "../lib/crypto-worker/vault.ts";

// The spl-token CLI check keypair (verified in step 1.5).
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
    answered.worker.respond({ id: idOf(request?.message), ok: true, result: { cleared: true } });
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

describe("sealed data in the vault (step 1.8)", () => {
  it("seals to a viewer key with no key of the tab, and opens only with the unlocked viewing key", async () => {
    const vault = createVault(loadVaultModules);
    const wallet = await testWallet(CLI_SEED);
    const viewSignature = await wallet.sign(viewKeyMessage(wallet.address));
    const viewing = await deriveViewingKey(wallet.address, viewSignature);
    const value = { v: 1, default_amount: "9400000000", notes: "Monthly" };
    const sealed = await vault.handle({
      id: 1,
      type: "seal",
      publicKey: viewing.publicKey.slice().buffer,
      value,
    });
    if (!("ok" in sealed) || !sealed.ok || !("ciphertext" in sealed.result)) {
      throw new Error("not sealed");
    }
    const ciphertext = sealed.result.ciphertext;
    expect(ciphertext.length).toBeGreaterThan(48);
    const open = (id: number, bytes: Uint8Array) =>
      vault.handle({ id, type: "openSealed", ciphertext: bytes.slice().buffer });
    expect(await open(2, ciphertext)).toMatchObject({ ok: false, error: { code: "not_viewing" } });
    await vault.handle({
      id: 3,
      type: "unlockViewing",
      wallet: wallet.address,
      signature: new Uint8Array(viewSignature).buffer,
    });
    expect(await open(4, ciphertext)).toEqual({ id: 4, ok: true, result: { value } });
    const tampered = ciphertext.slice();
    tampered[0] = (tampered[0] ?? 0) ^ 1;
    expect(await open(5, tampered)).toMatchObject({ ok: false, error: { code: "cannot_open" } });
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

/** The id of a posted request (rent replies have none). */
const idOf = (message: WorkerRequest | RentReply | undefined) =>
  message && "id" in message ? message.id : 0;

/** A worker stand in: records posted messages and lets the test answer. */
function fakeWorker() {
  const posted: { message: WorkerRequest | RentReply; transfer: Transferable[] }[] = [];
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
      id: idOf(posted[0]?.message),
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

describe("confidential transfers in the vault (step 1.9)", () => {
  it("AC-06.4 builds a transfer plan with the held keys, asks the page for rent, and co-signs only its own accounts", async () => {
    const asked: bigint[] = [];
    const vault = createVault(loadVaultModules, {
      rent: async (space) => {
        asked.push(space);
        return 1_000_000n;
      },
    });
    const sender = await testWallet(CLI_SEED);
    const signature = await sender.sign(confidentialKeysMessage());
    const keys = await deriveStandardKeys(sender.address, signature);
    const recipient = await testWallet(new Uint8Array(32).fill(9));
    const recipientKeys = await deriveStandardKeys(
      recipient.address,
      await recipient.sign(confidentialKeysMessage()),
    );
    const source = encodeToken2022Account(
      encryptedTokenAccount({
        owner: sender.address,
        mint: MINT,
        keys,
        available: 50_000_000n,
        pending: 0n,
      }),
    );
    const destination = encodeToken2022Account(
      encryptedTokenAccount({
        owner: recipient.address,
        mint: MINT,
        keys: recipientKeys,
        available: 0n,
        pending: 0n,
      }),
    );
    const mint = encodeConfidentialMint({ decimals: 6 });
    const request = (id: number, amount: string, to = destination) =>
      vault.handle({
        id,
        type: "transferPlan",
        sourceToken: address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"),
        sourceAccount: source.slice().buffer,
        destinationToken: address("EQMW3o1DVsB72Ej1RRRmHLW1XaEpbjLKrMHUbS8cRLZC"),
        destinationAccount: to.slice().buffer,
        mint: MINT,
        mintAccount: mint.slice().buffer,
        amount,
        version: 0,
      });
    expect(await request(1, "7500000")).toMatchObject({ error: { code: "not_unlocked" } });
    await vault.handle({
      id: 2,
      type: "unlock",
      wallet: sender.address,
      signature: new Uint8Array(signature).buffer,
    });

    const planned = await request(3, "7500000");
    if (!("ok" in planned) || !planned.ok || !("variant" in planned.result)) {
      throw new Error("no transfer plan");
    }
    const plan = planned.result;
    expect(plan.variant).toBe("record");
    expect(plan.availableBefore).toBe(50_000_000n);
    expect(plan.transactions.filter((t) => t.role === "transfer")).toHaveLength(1);
    expect(plan.signers.length).toBeGreaterThanOrEqual(3);
    expect(plan.signers).not.toContain(sender.address);
    expect(asked.length).toBeGreaterThanOrEqual(3);
    // Plain data only, and no key in it.
    expect(structuredClone(plan)).toEqual(plan);
    const serialized = JSON.stringify(plan, (_, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    for (const secret of [signature, keys.elgamalSecretKey, keys.aeKey]) {
      expect(serialized).not.toContain(hex(secret));
      expect(serialized).not.toContain(b64(secret));
    }

    // The worker signs a transaction the wallet would sign, for the plan's accounts it names only.
    const [first] = plan.transactions;
    if (!first) throw new Error("no transaction");
    const compiled = compileTransaction(
      pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayer(address(sender.address), m),
        (m) =>
          setTransactionMessageLifetimeUsingBlockhash(
            {
              blockhash: "11111111111111111111111111111111" as Blockhash,
              lastValidBlockHeight: 0n,
            },
            m,
          ),
        (m) =>
          appendTransactionMessageInstructions(first.instructions.map(fromPortableInstruction), m),
      ),
    );
    const cosigned = await vault.handle({
      id: 4,
      type: "cosign",
      planId: plan.planId,
      transaction: new Uint8Array(getTransactionEncoder().encode(compiled)).buffer,
    });
    if (!("ok" in cosigned) || !cosigned.ok || !("signatures" in cosigned.result)) {
      throw new Error("not co-signed");
    }
    const signed = Object.entries(cosigned.result.signatures);
    expect(signed.length).toBeGreaterThan(0);
    for (const [signer, bytes] of signed) {
      expect(plan.signers).toContain(signer);
      expect(Object.keys(compiled.signatures)).toContain(signer);
      expect(
        await verifyWalletSignature(signer, new Uint8Array(compiled.messageBytes), bytes),
      ).toBe(true);
    }
    expect(Object.keys(cosigned.result.signatures)).not.toContain(sender.address);

    // Refusals: more than the available balance, a recipient that cannot receive now.
    expect(await request(5, "60000000")).toMatchObject({ error: { code: "insufficient_balance" } });
    const closed = encodeToken2022Account(
      confidentialTokenAccount({
        owner: address(recipient.address),
        mint: MINT,
        elgamalPubkey: recipientKeys.elgamalPubkey,
        approved: false,
      }),
    );
    expect(await request(6, "1000000", closed)).toMatchObject({
      error: { code: "recipient_not_ready" },
    });

    // An ended plan signs nothing more, and a lock drops every plan.
    await vault.handle({ id: 7, type: "endPlan", planId: plan.planId });
    expect(
      await vault.handle({
        id: 8,
        type: "cosign",
        planId: plan.planId,
        transaction: new ArrayBuffer(0),
      }),
    ).toMatchObject({ error: { code: "no_plan" } });
    const again = await request(9, "1000000");
    if (!("ok" in again) || !again.ok || !("planId" in again.result)) throw new Error("no plan");
    await vault.handle({ id: 10, type: "clear" });
    expect(
      await vault.handle({
        id: 11,
        type: "cosign",
        planId: again.result.planId,
        transaction: new ArrayBuffer(0),
      }),
    ).toMatchObject({ error: { code: "no_plan" } });
  });

  it("AC-09.1 builds a withdraw plan with the held keys in both versions, and refuses more than the available balance", async () => {
    const vault = createVault(loadVaultModules, { rent: async () => 1_000_000n });
    const owner = await testWallet(CLI_SEED);
    const signature = await owner.sign(confidentialKeysMessage());
    const keys = await deriveStandardKeys(owner.address, signature);
    const account = encodeToken2022Account(
      encryptedTokenAccount({
        owner: owner.address,
        mint: MINT,
        keys,
        available: 20_000_000n,
        pending: 0n,
      }),
    );
    const request = (id: number, amount: string, version: 0 | 1) =>
      vault.handle({
        id,
        type: "withdrawPlan",
        token: address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"),
        account: account.slice().buffer,
        mint: MINT,
        decimals: 6,
        amount,
        version,
      });
    expect(await request(1, "3000000", 1)).toMatchObject({ error: { code: "not_unlocked" } });
    await vault.handle({
      id: 2,
      type: "unlock",
      wallet: owner.address,
      signature: new Uint8Array(signature).buffer,
    });
    for (const [version, variant] of [
      [1, "inline"],
      [0, "record"],
    ] as const) {
      const planned = await request(3 + version, "3000000", version);
      if (!("ok" in planned) || !planned.ok || !("variant" in planned.result)) {
        throw new Error("no withdraw plan");
      }
      const plan = planned.result;
      expect(plan.variant).toBe(variant);
      expect(plan.availableBefore).toBe(20_000_000n);
      expect(plan.transactions.filter((t) => t.role === "transfer")).toHaveLength(1);
      expect(plan.signers.length).toBeGreaterThanOrEqual(2);
      expect(plan.signers).not.toContain(owner.address);
      const serialized = JSON.stringify(plan, (_, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      );
      for (const secret of [signature, keys.elgamalSecretKey, keys.aeKey]) {
        expect(serialized).not.toContain(hex(secret));
        expect(serialized).not.toContain(b64(secret));
      }
      await vault.handle({ id: 10 + version, type: "endPlan", planId: plan.planId });
    }
    expect(await request(20, "20000001", 1)).toMatchObject({
      error: { code: "insufficient_balance" },
    });
  });

  it("AC-13.1 AC-13.2 builds the proofs of a balance threshold with two context accounts, and refuses one above the balance before any proof", async () => {
    const vault = createVault(loadVaultModules, { rent: async () => 1_000_000n });
    const owner = await testWallet(CLI_SEED);
    const signature = await owner.sign(confidentialKeysMessage());
    const keys = await deriveStandardKeys(owner.address, signature);
    const account = encodeToken2022Account(
      encryptedTokenAccount({
        owner: owner.address,
        mint: MINT,
        keys,
        available: 20_000_000n,
        pending: 0n,
      }),
    );
    const request = (id: number, threshold: string) =>
      vault.handle({
        id,
        type: "balanceProofs",
        token: address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"),
        account: account.slice().buffer,
        mint: MINT,
        decimals: 6,
        threshold,
      });
    expect(await request(1, "7000000")).toMatchObject({ error: { code: "not_unlocked" } });
    await vault.handle({
      id: 2,
      type: "unlock",
      wallet: owner.address,
      signature: new Uint8Array(signature).buffer,
    });
    const built = await request(3, "7000000");
    if (!("ok" in built) || !built.ok || !("equalityContext" in built.result)) {
      throw new Error("no proofs");
    }
    const proofs = built.result;
    expect(proofs.availableBefore).toBe(20_000_000n);
    expect(proofs.transactions.every((transaction) => transaction.role === "proof")).toBe(true);
    expect(proofs.transactions.length).toBeGreaterThanOrEqual(2);
    expect(proofs.equalityContext).not.toBe(proofs.rangeContext);
    expect(proofs.cleanup.map((instruction) => instruction.accounts[0]?.address)).toEqual(
      expect.arrayContaining([proofs.equalityContext, proofs.rangeContext]),
    );
    expect(proofs.signers).not.toContain(owner.address);
    const serialized = JSON.stringify(proofs, (_, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    for (const secret of [signature, keys.elgamalSecretKey, keys.aeKey]) {
      expect(serialized).not.toContain(hex(secret));
      expect(serialized).not.toContain(b64(secret));
    }
    await vault.handle({ id: 4, type: "endPlan", planId: proofs.planId });
    // AC-13.2: above the balance nothing is built.
    expect(await request(5, "20000001")).toMatchObject({ error: { code: "insufficient_balance" } });
  });

  it("AC-08.4 builds a payroll chunk's plans in order, each from the balance the line ahead leaves, with its own signers", async () => {
    const vault = createVault(loadVaultModules, { rent: async () => 1_000_000n });
    const sender = await testWallet(CLI_SEED);
    const signature = await sender.sign(confidentialKeysMessage());
    const keys = await deriveStandardKeys(sender.address, signature);
    const recipient = await testWallet(new Uint8Array(32).fill(9));
    const recipientKeys = await deriveStandardKeys(
      recipient.address,
      await recipient.sign(confidentialKeysMessage()),
    );
    const source = encodeToken2022Account(
      encryptedTokenAccount({
        owner: sender.address,
        mint: MINT,
        keys,
        available: 50_000_000n,
        pending: 0n,
      }),
    );
    const destination = encodeToken2022Account(
      encryptedTokenAccount({
        owner: recipient.address,
        mint: MINT,
        keys: recipientKeys,
        available: 0n,
        pending: 0n,
      }),
    );
    const mint = encodeConfidentialMint({ decimals: 6 });
    const chunk = (id: number, amounts: string[]) =>
      vault.handle({
        id,
        type: "transferChunk",
        sourceToken: address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"),
        sourceAccount: source.slice().buffer,
        mint: MINT,
        mintAccount: mint.slice().buffer,
        lines: amounts.map((amount) => ({
          destinationToken: address("EQMW3o1DVsB72Ej1RRRmHLW1XaEpbjLKrMHUbS8cRLZC"),
          destinationAccount: destination.slice().buffer,
          amount,
        })),
        version: 1,
      });
    expect(await chunk(1, ["1000000"])).toMatchObject({ error: { code: "not_unlocked" } });
    await vault.handle({
      id: 2,
      type: "unlock",
      wallet: sender.address,
      signature: new Uint8Array(signature).buffer,
    });
    const built = await chunk(3, ["10000000", "15000000", "5000000"]);
    if (!("ok" in built) || !built.ok || !("plans" in built.result)) throw new Error("no chunk");
    const { plans, availableAfter } = built.result;
    expect(plans.map((plan) => plan.availableBefore)).toEqual([
      50_000_000n,
      40_000_000n,
      25_000_000n,
    ]);
    expect(availableAfter).toBe(20_000_000n);
    expect(new Set(plans.map((plan) => plan.planId)).size).toBe(3);
    expect(plans.every((plan) => plan.variant === "inline")).toBe(true);
    const serialized = JSON.stringify(built.result, (_, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    for (const secret of [signature, keys.elgamalSecretKey, keys.aeKey]) {
      expect(serialized).not.toContain(hex(secret));
      expect(serialized).not.toContain(b64(secret));
    }
    // The chunk's lines together above the balance: refused before anything is signed.
    expect(await chunk(4, ["30000000", "30000000"])).toMatchObject({
      error: { code: "insufficient_balance" },
    });
  });

  it("answers the worker's rent question with the page's reader while a plan is built", async () => {
    const { worker, posted } = fakeWorker();
    const client = new CryptoWorkerClient(worker);
    worker.respond({ type: "ready" });
    const reader = vi.fn(async (space: bigint) => space * 10n);
    const planning = client.transferPlan(
      {
        sourceToken: "a",
        sourceAccount: new Uint8Array(1),
        destinationToken: "b",
        destinationAccount: new Uint8Array(1),
        mint: "c",
        mintAccount: new Uint8Array(1),
        amount: 5n,
        version: 0,
      },
      reader,
    );
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    worker.respond({ type: "rent", callId: 3, space: "161" });
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]?.message).toEqual({ type: "rentReply", callId: 3, lamports: "1610" });
    expect(reader).toHaveBeenCalledWith(161n);
    worker.respond({
      id: idOf(posted[0]?.message),
      ok: true,
      result: {
        planId: "p",
        variant: "record",
        transactions: [],
        cleanup: [],
        signers: [],
        availableBefore: 0n,
      },
    });
    expect(await planning).toMatchObject({ planId: "p" });
    // After the plan, a rent question gets an error answer.
    worker.respond({ type: "rent", callId: 4, space: "1" });
    await vi.waitFor(() => expect(posted).toHaveLength(3));
    expect(posted[2]?.message).toMatchObject({
      type: "rentReply",
      callId: 4,
      error: expect.any(String),
    });
  });
});

describe("the demo company's read only vault (step 4.6, D-32)", () => {
  const value = { v: 1, default_amount: "9400000000", notes: "Monthly" };

  async function published() {
    const wallet = await testWallet(CLI_SEED);
    const viewing = await deriveViewingKey(
      wallet.address,
      await wallet.sign(viewKeyMessage(wallet.address)),
    );
    // A record sealed to the role's registered viewing public key, as the owner's browser seals it.
    const sealer = createVault(loadVaultModules);
    const sealed = await sealer.handle({
      id: 1,
      type: "seal",
      publicKey: viewing.publicKey.slice().buffer,
      value,
    });
    if (!("ok" in sealed) || !sealed.ok || !("ciphertext" in sealed.result)) {
      throw new Error("not sealed");
    }
    return { wallet, viewing, ciphertext: sealed.result.ciphertext };
  }

  it("opens a role's records with its published viewing key alone, and answers only the public key", async () => {
    const { viewing, ciphertext } = await published();
    const vault = createVault(loadVaultModules);
    const loaded = await vault.handle({
      id: 1,
      type: "demoViewing",
      secretKey: viewing.secretKey.slice().buffer,
    });
    // The public key follows from the secret key: it is the one the role registered.
    expect(loaded).toEqual({ id: 1, ok: true, result: { publicKey: b64(viewing.publicKey) } });
    expect(JSON.stringify(loaded)).not.toContain(b64(viewing.secretKey));
    expect(await vault.handle({ id: 2, type: "status" })).toEqual({
      id: 2,
      ok: true,
      result: { wallet: null, unlocked: false, viewing: true, demo: true },
    });
    expect(
      await vault.handle({ id: 3, type: "openSealed", ciphertext: ciphertext.slice().buffer }),
    ).toEqual({ id: 3, ok: true, result: { value } });
    // A key of the wrong length is refused.
    const short = createVault(loadVaultModules);
    expect(
      await short.handle({ id: 1, type: "demoViewing", secretKey: new Uint8Array(31).buffer }),
    ).toMatchObject({ ok: false });
  });

  it("does nothing but open: no seal, no wallet signature, no key derivation, no plan, no cosigning", async () => {
    const { wallet, viewing } = await published();
    const vault = createVault(loadVaultModules);
    await vault.handle({ id: 1, type: "demoViewing", secretKey: viewing.secretKey.slice().buffer });
    const account = new Uint8Array(8).buffer;
    const refused: WorkerRequest[] = [
      { id: 2, type: "seal", publicKey: viewing.publicKey.slice().buffer, value },
      {
        id: 3,
        type: "unlock",
        wallet: wallet.address,
        signature: (await wallet.sign(confidentialKeysMessage())).buffer as ArrayBuffer,
      },
      {
        id: 4,
        type: "unlockViewing",
        wallet: wallet.address,
        signature: (await wallet.sign(viewKeyMessage(wallet.address))).buffer as ArrayBuffer,
      },
      { id: 5, type: "confirmSignature", wallet: wallet.address, signature: new ArrayBuffer(64) },
      { id: 6, type: "checkAccount", elgamalPubkey: CLI_ELGAMAL_KEY },
      { id: 7, type: "setupInstructions", mint: wallet.address },
      { id: 8, type: "decrypt", account },
      { id: 9, type: "applyInstruction", token: wallet.address, account },
      {
        id: 10,
        type: "transferPlan",
        sourceToken: wallet.address,
        sourceAccount: account,
        destinationToken: wallet.address,
        destinationAccount: account,
        mint: wallet.address,
        mintAccount: account,
        amount: "1",
        version: 0,
      },
      {
        id: 11,
        type: "withdrawPlan",
        token: wallet.address,
        account,
        mint: wallet.address,
        decimals: 6,
        amount: "1",
        version: 0,
      },
      {
        id: 12,
        type: "transferChunk",
        sourceToken: wallet.address,
        sourceAccount: account,
        mint: wallet.address,
        mintAccount: account,
        lines: [],
        version: 0,
      },
      {
        id: 13,
        type: "balanceProofs",
        token: wallet.address,
        account,
        mint: wallet.address,
        decimals: 6,
        threshold: "1",
      },
      { id: 14, type: "cosign", planId: "p", transaction: account },
      { id: 15, type: "endPlan", planId: "p" },
    ];
    for (const request of refused) {
      expect(await vault.handle(request), request.type).toEqual({
        id: request.id,
        ok: false,
        error: { code: "demo_read_only", message: "The demo company is read only" },
      });
    }
    // It stays a demo vault after its key is cleared: no wallet's keys ever enter it.
    await vault.handle({ id: 20, type: "clear" });
    expect(
      await vault.handle({
        id: 21,
        type: "unlockViewing",
        wallet: wallet.address,
        signature: (await wallet.sign(viewKeyMessage(wallet.address))).buffer as ArrayBuffer,
      }),
    ).toMatchObject({ ok: false, error: { code: "demo_read_only" } });
  });

  it("is refused in a vault that holds a wallet's keys", async () => {
    const { wallet, viewing } = await published();
    const vault = createVault(loadVaultModules);
    await vault.handle({
      id: 1,
      type: "unlockViewing",
      wallet: wallet.address,
      signature: (await wallet.sign(viewKeyMessage(wallet.address))).buffer as ArrayBuffer,
    });
    expect(
      await vault.handle({
        id: 2,
        type: "demoViewing",
        secretKey: viewing.secretKey.slice().buffer,
      }),
    ).toMatchObject({ ok: false, error: { code: "demo_read_only" } });
    expect(await vault.handle({ id: 3, type: "status" })).toEqual({
      id: 3,
      ok: true,
      result: { wallet: wallet.address, unlocked: false, viewing: true },
    });
  });
});
