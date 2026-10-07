// Injected Wallet Standard test wallet for E2E (docs/11-TESTING.md section 3), added with
// page.addInitScript. Its Ed25519 key is generated in the page with WebCrypto, or imported from a
// 64 byte Solana keypair (seed, then public key) that a spec sets as window.__sottoTestWalletKeypair
// in an earlier init script. Like the wallets tested in Gate G2, it signs sign in requests and any
// message, deterministically, and it logs the text of every message it signs
// (window.__sottoTestWallet.signedMessages). A spec can make it refuse given messages, as a wallet that
// follows the guidance to refuse solana-conf-bal/v1 would (window.__sottoTestWallet.refuse), refuse
// every transaction with a given error (refuseTransactions, step 2.1), or hand
// out given signatures for the next messages instead of its own, as a wallet with randomized
// signatures would (window.__sottoTestWallet.queueSignatures, base64). Since step 1.7 it signs
// legacy and version 0 transactions (solana:signTransaction) for localnet flows, and counts them
// (window.__sottoTestWallet.signedTransactions); since step 1.7.1 it can switch to another account
// (window.__sottoTestWallet.switchAccount). Since step 2.3 a spec can make it declare and sign
// version 1 transactions too (window.__sottoTestWalletVersions = ["legacy", 0, 1] in an earlier init
// script), it records the number of transactions of each signTransaction call
// (window.__sottoTestWallet.signTransactionCalls, one entry per call, as one prompt), and it awaits
// window.__sottoOnSignTransaction(call, count) before answering a call when a spec exposed one. It
// registers through the Wallet Standard events (wallet-standard:register-wallet and
// wallet-standard:app-ready).
(() => {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const CHAINS = ["solana:devnet", "solana:localnet"];
  const ICON =
    "data:image/svg+xml;base64," +
    btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="9" fill="#1F5BE8"/></svg>',
    );

  function base58(bytes) {
    let zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
    const digits = [];
    for (const byte of bytes) {
      let carry = byte;
      for (let i = 0; i < digits.length; i += 1) {
        carry += digits[i] * 256;
        digits[i] = carry % 58;
        carry = Math.floor(carry / 58);
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = Math.floor(carry / 58);
      }
    }
    return (
      "1".repeat(zeros) +
      digits
        .reverse()
        .map((digit) => ALPHABET[digit])
        .join("")
    );
  }

  // The Sign-In With Solana text, field for field as @solana/wallet-standard-util 1.1.4
  // createSignInMessageText builds it.
  function signInText(input) {
    let message = `${input.domain} wants you to sign in with your Solana account:\n${input.address}`;
    if (input.statement) message += `\n\n${input.statement}`;
    const fields = [];
    if (input.uri) fields.push(`URI: ${input.uri}`);
    if (input.version) fields.push(`Version: ${input.version}`);
    if (input.chainId) fields.push(`Chain ID: ${input.chainId}`);
    if (input.nonce) fields.push(`Nonce: ${input.nonce}`);
    if (input.issuedAt) fields.push(`Issued At: ${input.issuedAt}`);
    if (input.expirationTime) fields.push(`Expiration Time: ${input.expirationTime}`);
    if (input.notBefore) fields.push(`Not Before: ${input.notBefore}`);
    if (input.requestId) fields.push(`Request ID: ${input.requestId}`);
    if (input.resources) {
      fields.push("Resources:");
      for (const resource of input.resources) fields.push(`- ${resource}`);
    }
    if (fields.length) message += `\n\n${fields.join("\n")}`;
    return message;
  }

  let keys;
  let account;
  const listeners = new Set();
  const signedMessages = [];
  let refused = new Set();
  // When set, every transaction signature is refused with this error, as a wallet whose own check
  // blocks a transaction does (step 2.1): { name, message }.
  let transactionRefusal = null;
  let queued = [];
  let signedTransactions = 0;
  const signTransactionCalls = [];
  const versions = Array.isArray(window.__sottoTestWalletVersions)
    ? window.__sottoTestWalletVersions
    : ["legacy", 0];
  const fixed = window.__sottoTestWalletKeypair;
  // PKCS #8 prefix of a raw Ed25519 private key (RFC 8410).
  const PKCS8_ED25519 = [48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32];

  async function createKeys(fresh = false) {
    if (!fresh && Array.isArray(fixed) && fixed.length === 64) {
      const pkcs8 = new Uint8Array([...PKCS8_ED25519, ...fixed.slice(0, 32)]);
      const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, [
        "sign",
      ]);
      return { privateKey, publicKey: new Uint8Array(fixed.slice(32)) };
    }
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    return { privateKey: pair.privateKey, publicKey };
  }

  async function ensureAccount(fresh = false) {
    if (account && !fresh) return account;
    keys = await createKeys(fresh);
    const publicKey = keys.publicKey;
    account = Object.freeze({
      address: base58(publicKey),
      publicKey,
      chains: CHAINS,
      features: ["solana:signIn", "solana:signMessage", "solana:signTransaction"],
      label: "Test account",
    });
    return account;
  }

  async function sign(bytes) {
    return new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, keys.privateKey, bytes));
  }

  // Solana's compact u16 length (shortvec).
  function readShortVec(bytes, offset) {
    let value = 0;
    let size = 0;
    for (;;) {
      const byte = bytes[offset + size];
      value |= (byte & 0x7f) << (7 * size);
      size += 1;
      if ((byte & 0x80) === 0) return [value, size];
    }
  }

  // A version 1 transaction puts its message first and the signatures after it; the message's
  // header gives the number of signers, and its static accounts start at byte 42 (kit 8.3).
  async function signMessageFirst(wire) {
    if (!versions.includes(1)) throw new Error("This wallet does not sign version 1 transactions");
    const required = wire[1];
    const messageLength = wire.length - required * 64;
    const message = wire.slice(0, messageLength);
    let index = -1;
    for (let i = 0; i < required; i += 1) {
      const key = message.slice(42 + i * 32, 42 + (i + 1) * 32);
      if (key.every((byte, j) => byte === account.publicKey[j])) {
        index = i;
        break;
      }
    }
    if (index < 0) throw new Error("This account does not sign this transaction");
    const signed = new Uint8Array(wire);
    signed.set(await sign(message), messageLength + index * 64);
    signedTransactions += 1;
    return signed;
  }

  // Signs a wire transaction (signatures, then the message) as its signer at this account's index.
  async function signWireTransaction(wire) {
    if (wire[0] & 0x80) return signMessageFirst(wire);
    const [count, countSize] = readShortVec(wire, 0);
    const messageStart = countSize + count * 64;
    const message = wire.slice(messageStart);
    let offset = 0;
    if (message[0] & 0x80) {
      if ((message[0] & 0x7f) !== 0)
        throw new Error("This wallet signs legacy and version 0 transactions only");
      offset = 1;
    }
    const required = message[offset];
    offset += 3;
    const [keyCount, keySize] = readShortVec(message, offset);
    offset += keySize;
    let index = -1;
    for (let i = 0; i < Math.min(keyCount, required); i += 1) {
      const key = message.slice(offset + i * 32, offset + (i + 1) * 32);
      if (key.every((byte, j) => byte === account.publicKey[j])) {
        index = i;
        break;
      }
    }
    if (index < 0) throw new Error("This account does not sign this transaction");
    const signed = new Uint8Array(wire);
    signed.set(await sign(message), countSize + index * 64);
    signedTransactions += 1;
    return signed;
  }

  function emit(properties) {
    for (const listener of listeners) listener(properties);
  }

  const wallet = {
    version: "1.0.0",
    name: "Sotto Test Wallet",
    icon: ICON,
    chains: CHAINS,
    get accounts() {
      return account ? [account] : [];
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          const connected = await ensureAccount();
          emit({ accounts: [connected] });
          return { accounts: [connected] };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          account = undefined;
          emit({ accounts: [] });
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (event, listener) => {
          if (event !== "change") return () => {};
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      "solana:signIn": {
        version: "1.0.0",
        signIn: async (...inputs) => {
          const signer = await ensureAccount();
          return Promise.all(
            inputs.map(async (input) => {
              const text = signInText({
                ...input,
                domain: input.domain ?? location.host,
                address: signer.address,
              });
              const signedMessage = new TextEncoder().encode(text);
              return {
                account: signer,
                signedMessage,
                signature: await sign(signedMessage),
                signatureType: "ed25519",
              };
            }),
          );
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async (...inputs) =>
          Promise.all(
            inputs.map(async ({ message }) => {
              const text = new TextDecoder().decode(message);
              if (refused.has(text)) throw new Error("This wallet does not sign this message");
              signedMessages.push(text);
              const next = queued.shift();
              const signature = next
                ? Uint8Array.from(atob(next), (c) => c.charCodeAt(0))
                : await sign(message);
              return { signedMessage: message, signature };
            }),
          ),
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: versions,
        signTransaction: async (...inputs) => {
          await ensureAccount();
          if (transactionRefusal) {
            throw Object.assign(new Error(transactionRefusal.message), {
              name: transactionRefusal.name,
            });
          }
          signTransactionCalls.push(inputs.length);
          const signed = await Promise.all(
            inputs.map(async ({ transaction }) => ({
              signedTransaction: await signWireTransaction(new Uint8Array(transaction)),
            })),
          );
          if (typeof window.__sottoOnSignTransaction === "function") {
            await window.__sottoOnSignTransaction(signTransactionCalls.length, inputs.length);
          }
          return signed;
        },
      },
    },
  };

  const register = ({ register: add }) => add(wallet);
  window.addEventListener("wallet-standard:app-ready", ({ detail }) => register(detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  window.__sottoTestWallet = {
    get address() {
      return account ? account.address : undefined;
    },
    get signedMessages() {
      return [...signedMessages];
    },
    get signedTransactions() {
      return signedTransactions;
    },
    get signTransactionCalls() {
      return [...signTransactionCalls];
    },
    refuse(texts) {
      refused = new Set(texts);
    },
    refuseTransactions(refusal) {
      transactionRefusal = refusal;
    },
    queueSignatures(signatures) {
      queued = [...signatures];
    },
    // Switches to a new account with a random key, as a user switching accounts in a wallet does.
    async switchAccount() {
      const next = await ensureAccount(true);
      emit({ accounts: [next] });
      return next.address;
    },
  };
})();
