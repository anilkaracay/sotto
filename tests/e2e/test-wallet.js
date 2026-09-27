// Injected Wallet Standard test wallet for E2E (docs/11-TESTING.md section 3), added with
// page.addInitScript. Its Ed25519 key is generated in the page with WebCrypto. Like the wallets tested
// in Gate G2, it signs sign in requests and any message, deterministically. It registers through the
// Wallet Standard events (wallet-standard:register-wallet and wallet-standard:app-ready).
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

  async function ensureAccount() {
    if (account) return account;
    keys = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
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
            inputs.map(async ({ message }) => ({
              signedMessage: message,
              signature: await sign(message),
            })),
          ),
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: async () => {
          throw new Error("The Sotto test wallet does not sign transactions yet");
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
  };
})();
