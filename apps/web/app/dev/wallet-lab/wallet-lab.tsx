"use client";

// Gate G2 wallet capability matrix (docs/12-MILESTONES.md, step 0.6). Development only.
import { useSignIn, useSignMessage, useSignTransaction, useSignTransactions } from "@solana/react";
import {
  getWalletFeature,
  useConnect,
  useDisconnect,
  useWallets,
  type UiWallet,
  type UiWalletAccount,
} from "@wallet-standard/react";
import { Component, useCallback, useState, type ReactNode } from "react";
import {
  buildSelfTransfer,
  checkSignedTransaction,
  d03Message,
  DEVNET_CHAIN,
  DEVNET_RPC_URL,
  latestBlockhash,
  sendAndConfirm,
  TEST_ADDRESS,
  toHex,
  utf8,
  verifyEd25519,
} from "./lab-core";

type RowResult = {
  outcome: string;
  detail: string;
  data?: Record<string, unknown>;
  at: string;
};
type Record_ = (id: string, result: Omit<RowResult, "at">) => void;
type RowProps = { account: UiWalletAccount; record: Record_; results: Record<string, RowResult> };

const ROWS: { id: string; title: string; feature?: string }[] = [
  { id: "R1", title: "Connect, list features with versions and declared transaction versions" },
  {
    id: "R2",
    title: "Sign In With Solana (solana:signIn), verify the signature",
    feature: "solana:signIn",
  },
  {
    id: "R3",
    title: "signMessage on arbitrary text, verify Ed25519",
    feature: "solana:signMessage",
  },
  {
    id: "R4",
    title: 'signMessage on the exact bytes "solana-conf-bal/v1"',
    feature: "solana:signMessage",
  },
  {
    id: "R5",
    title: "signMessage on the D-03 fallback message, twice, compare bytes",
    feature: "solana:signMessage",
  },
  { id: "R6", title: "R5 signature as lowercase hex (compare across wallets)" },
  {
    id: "R7",
    title: "v0 self transfer of 1 lamport: signTransaction, verify, send, confirm",
    feature: "solana:signTransaction",
  },
  {
    id: "R8",
    title: "v1 self transfer of 1 lamport: build with kit 8.3.0, sign, send, confirm",
    feature: "solana:signTransaction",
  },
  {
    id: "R9",
    title: "signTransaction with three v0 transactions in one call",
    feature: "solana:signTransaction",
  },
  {
    id: "R10",
    title: "signTransaction with three v1 transactions in one call",
    feature: "solana:signTransaction",
  },
];

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const context = (error as { context?: unknown }).context;
    return [
      `${error.name}: ${error.message}`,
      code !== undefined ? `code ${String(code)}` : "",
      context !== undefined ? `context ${JSON.stringify(context)}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function classify(error: unknown): { outcome: string; detail: string } {
  const detail = errorText(error);
  const code = (error as { code?: unknown } | null)?.code;
  const refused = code === 4001 || /reject|denied|declin|cancel|refus|not allowed/i.test(detail);
  return { outcome: refused ? "refused" : "error", detail };
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

class RowBoundary extends Component<
  { id: string; record: Record_; children: ReactNode },
  { error: string | null }
> {
  override state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: errorText(error) };
  }
  override componentDidCatch(error: unknown) {
    this.props.record(this.props.id, {
      outcome: "error",
      detail: `hook failed: ${errorText(error)}`,
    });
  }
  override render() {
    if (this.state.error) return <span>hook failed: {this.state.error}</span>;
    return this.props.children;
  }
}

function RunButton({ onRun }: { onRun: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onRun();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Running..." : "Run"}
    </button>
  );
}

function featureSummary(wallet: UiWallet) {
  return wallet.features.map((name) => {
    const feature = getWalletFeature(wallet, name) as {
      version?: string;
      supportedTransactionVersions?: readonly (string | number)[];
    };
    return {
      name,
      version: feature?.version ?? null,
      supportedTransactionVersions: feature?.supportedTransactionVersions ?? null,
    };
  });
}

function R1Row({ wallet, account, record }: { wallet: UiWallet } & RowProps) {
  return (
    <RunButton
      onRun={async () => {
        const features = featureSummary(wallet);
        const pick = (n: string) =>
          features.find((f) => f.name === n)?.supportedTransactionVersions ?? null;
        record("R1", {
          outcome: "pass",
          detail: `${features.length} features; signTransaction versions ${JSON.stringify(pick("solana:signTransaction"))}; signAndSendTransaction versions ${JSON.stringify(pick("solana:signAndSendTransaction"))}`,
          data: {
            account: account.address,
            accountChains: account.chains,
            walletChains: wallet.chains,
            features,
          },
        });
      }}
    />
  );
}

function R2Row({ account, record }: RowProps) {
  const signIn = useSignIn(account);
  return (
    <RunButton
      onRun={async () => {
        try {
          const input = {
            domain: window.location.host,
            statement: "Sotto wallet lab, Gate G2. This signs in only; nothing is sent.",
            uri: window.location.origin,
            version: "1",
            chainId: "devnet",
            nonce: randomNonce(),
            issuedAt: new Date().toISOString(),
          };
          const output = await signIn(input);
          const signed = new Uint8Array(output.signedMessage);
          const text = new TextDecoder().decode(signed);
          const valid = await verifyEd25519(
            output.account.address,
            new Uint8Array(output.signature),
            signed,
          );
          record("R2", {
            outcome: valid ? "pass" : "error",
            detail: valid ? "signature verified" : "signature did not verify",
            data: {
              signedMessageText: text,
              containsDomain: text.includes(input.domain),
              containsAddress: text.includes(account.address),
              signatureHex: toHex(new Uint8Array(output.signature)),
            },
          });
        } catch (error) {
          record("R2", classify(error));
        }
      }}
    />
  );
}

function SignMessageRow({
  id,
  message,
  account,
  record,
}: RowProps & { id: "R3" | "R4"; message: Uint8Array }) {
  const signMessage = useSignMessage(account);
  return (
    <RunButton
      onRun={async () => {
        try {
          const output = await signMessage({ message });
          const signed = new Uint8Array(output.signedMessage);
          const valid = await verifyEd25519(
            account.address,
            new Uint8Array(output.signature),
            signed,
          );
          record(id, {
            outcome: valid ? "pass" : "error",
            detail: valid ? "allowed; signature verified" : "allowed; signature did not verify",
            data: {
              signedMessageEqualsInput: toHex(signed) === toHex(message),
              signatureHex: toHex(new Uint8Array(output.signature)),
            },
          });
        } catch (error) {
          record(id, classify(error));
        }
      }}
    />
  );
}

function R5Row({ account, record }: RowProps) {
  const signMessage = useSignMessage(account);
  return (
    <RunButton
      onRun={async () => {
        try {
          const message = utf8(d03Message(account.address));
          const first = await signMessage({ message });
          const second = await signMessage({ message });
          const a = toHex(new Uint8Array(first.signature));
          const b = toHex(new Uint8Array(second.signature));
          const validA = await verifyEd25519(
            account.address,
            new Uint8Array(first.signature),
            new Uint8Array(first.signedMessage),
          );
          const validB = await verifyEd25519(
            account.address,
            new Uint8Array(second.signature),
            new Uint8Array(second.signedMessage),
          );
          const deterministic = a === b;
          record("R5", {
            outcome: validA && validB && deterministic ? "pass" : "error",
            detail: `deterministic ${deterministic}; signatures valid ${validA} and ${validB}`,
            data: {
              message: d03Message(account.address),
              walletLineIsTestAddress: account.address === TEST_ADDRESS,
              signedMessageEqualsInput:
                toHex(new Uint8Array(first.signedMessage)) === toHex(message),
              signature1Hex: a,
              signature2Hex: b,
            },
          });
        } catch (error) {
          record("R5", classify(error));
        }
      }}
    />
  );
}

function R6Row({ record, results }: RowProps) {
  return (
    <RunButton
      onRun={async () => {
        const r5 = results["R5"];
        const hex = r5?.data?.["signature1Hex"];
        if (typeof hex !== "string") {
          record("R6", { outcome: "error", detail: "run R5 first" });
          return;
        }
        record("R6", { outcome: "pass", detail: hex, data: { signatureHex: hex } });
      }}
    />
  );
}

function SingleTransactionRow({
  id,
  version,
  account,
  record,
}: RowProps & { id: "R7" | "R8"; version: 0 | 1 }) {
  const signTransaction = useSignTransaction(account, DEVNET_CHAIN);
  return (
    <RunButton
      onRun={async () => {
        let built: ReturnType<typeof buildSelfTransfer>;
        try {
          built = buildSelfTransfer(account.address, version, await latestBlockhash(), 1n);
        } catch (error) {
          record(id, {
            outcome: version === 1 ? "not buildable with kit 8.3.0" : "error",
            detail: errorText(error),
          });
          return;
        }
        try {
          const { signedTransaction } = await signTransaction({ transaction: built.wire });
          const { check, transaction } = await checkSignedTransaction(
            account.address,
            new Uint8Array(signedTransaction),
            built.messageBytes,
          );
          if (!check.signatureValid) {
            record(id, {
              outcome: "error",
              detail: "signature did not verify",
              data: { ...check },
            });
            return;
          }
          const signature = await sendAndConfirm(transaction);
          record(id, {
            outcome: "pass",
            detail: `confirmed ${signature}`,
            data: { ...check, transactionSignature: signature, wireBytes: built.wire.length },
          });
        } catch (error) {
          record(id, classify(error));
        }
      }}
    />
  );
}

function BatchRow({
  id,
  version,
  account,
  record,
}: RowProps & { id: "R9" | "R10"; version: 0 | 1 }) {
  const signTransactions = useSignTransactions(account, DEVNET_CHAIN);
  return (
    <RunButton
      onRun={async () => {
        let built: ReturnType<typeof buildSelfTransfer>[];
        try {
          const blockhash = await latestBlockhash();
          built = [1n, 2n, 3n].map((amount) =>
            buildSelfTransfer(account.address, version, blockhash, amount),
          );
        } catch (error) {
          record(id, {
            outcome: version === 1 ? "not buildable with kit 8.3.0" : "error",
            detail: errorText(error),
          });
          return;
        }
        try {
          const outputs = await signTransactions(...built.map((b) => ({ transaction: b.wire })));
          const checks = [];
          for (let i = 0; i < outputs.length; i++) {
            const output = outputs[i];
            const original = built[i];
            if (!output || !original) continue;
            const { check } = await checkSignedTransaction(
              account.address,
              new Uint8Array(output.signedTransaction),
              original.messageBytes,
            );
            checks.push(check);
          }
          const allValid = checks.length === 3 && checks.every((c) => c.signatureValid);
          record(id, {
            outcome: allValid ? "pass" : "error",
            detail: `${outputs.length} signed transactions returned; all signatures valid ${allValid}; prompt count noted by the tester`,
            data: { signed: checks },
          });
        } catch (error) {
          record(id, classify(error));
        }
      }}
    />
  );
}

function Rows({ wallet, account, record, results }: { wallet: UiWallet } & RowProps) {
  const props = { account, record, results };
  const cell = (id: string): ReactNode => {
    switch (id) {
      case "R1":
        return <R1Row wallet={wallet} {...props} />;
      case "R2":
        return <R2Row {...props} />;
      case "R3":
        return (
          <SignMessageRow
            id="R3"
            message={utf8(`Sotto wallet lab R3: arbitrary text for ${account.address}`)}
            {...props}
          />
        );
      case "R4":
        return <SignMessageRow id="R4" message={utf8("solana-conf-bal/v1")} {...props} />;
      case "R5":
        return <R5Row {...props} />;
      case "R6":
        return <R6Row {...props} />;
      case "R7":
        return <SingleTransactionRow id="R7" version={0} {...props} />;
      case "R8":
        return <SingleTransactionRow id="R8" version={1} {...props} />;
      case "R9":
        return <BatchRow id="R9" version={0} {...props} />;
      case "R10":
        return <BatchRow id="R10" version={1} {...props} />;
      default:
        return null;
    }
  };
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead>
        <tr>
          <th align="left">Row</th>
          <th align="left">Check</th>
          <th align="left">Run</th>
          <th align="left">Result</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => {
          const missing =
            row.feature !== undefined && !account.features.includes(row.feature as never);
          const result = results[row.id];
          return (
            <tr key={row.id} style={{ borderTop: "1px solid #ccc", verticalAlign: "top" }}>
              <td>{row.id}</td>
              <td>{row.title}</td>
              <td>
                {missing ? (
                  <RunButton
                    onRun={async () =>
                      record(row.id, {
                        outcome: "error",
                        detail: `feature missing: ${row.feature} is not in the account features`,
                      })
                    }
                  />
                ) : (
                  <RowBoundary id={row.id} record={record}>
                    {cell(row.id)}
                  </RowBoundary>
                )}
              </td>
              <td style={{ wordBreak: "break-all", fontFamily: "monospace", fontSize: 12 }}>
                {result ? `${result.outcome}: ${result.detail}` : ""}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function WalletEntry({
  wallet,
  active,
  onConnected,
  onDisconnected,
  record,
}: {
  wallet: UiWallet;
  active: boolean;
  onConnected: (wallet: UiWallet, account: UiWalletAccount) => void;
  onDisconnected: () => void;
  record: Record_;
}) {
  const [isConnecting, connect] = useConnect(wallet);
  const [isDisconnecting, disconnect] = useDisconnect(wallet);
  return (
    <li>
      <strong>{wallet.name}</strong> (Wallet Standard {wallet.version}; chains{" "}
      {wallet.chains.join(", ")}){" "}
      {active ? (
        <button
          disabled={isDisconnecting}
          onClick={async () => {
            await disconnect();
            onDisconnected();
          }}
        >
          Disconnect
        </button>
      ) : (
        <button
          disabled={isConnecting}
          onClick={async () => {
            try {
              const accounts = await connect();
              const account = accounts[0];
              if (!account) throw new Error("the wallet returned no account");
              onConnected(wallet, account);
            } catch (error) {
              record("R1", classify(error));
            }
          }}
        >
          Connect
        </button>
      )}
    </li>
  );
}

export function WalletLab() {
  const wallets = useWallets();
  const [connected, setConnected] = useState<{ wallet: UiWallet; account: UiWalletAccount } | null>(
    null,
  );
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [exported, setExported] = useState("");

  const record = useCallback<Record_>((id, result) => {
    setResults((previous) => ({ ...previous, [id]: { ...result, at: new Date().toISOString() } }));
  }, []);

  const exportJson = async () => {
    const payload = {
      lab: "Sotto wallet lab, Gate G2",
      testAddress: TEST_ADDRESS,
      rpc: DEVNET_RPC_URL,
      wallet: connected
        ? { name: connected.wallet.name, walletStandardVersion: connected.wallet.version }
        : null,
      account: connected?.account.address ?? null,
      rows: results,
    };
    const text = JSON.stringify(payload, null, 2);
    setExported(text);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // The text area below still holds the JSON for manual copy.
    }
  };

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1200 }}>
      <h1>Wallet lab (Gate G2, development only)</h1>
      <p>
        Test address: <code>{TEST_ADDRESS}</code>. Cluster: devnet ({DEVNET_RPC_URL}). Switch the
        wallet to devnet before connecting.
      </p>
      <h2>Detected Wallet Standard wallets ({wallets.length})</h2>
      <ul>
        {wallets.map((wallet) => (
          <WalletEntry
            key={wallet.name}
            wallet={wallet}
            active={connected?.wallet.name === wallet.name}
            onConnected={(w, a) => {
              setResults({});
              setExported("");
              setConnected({ wallet: w, account: a });
            }}
            onDisconnected={() => setConnected(null)}
            record={record}
          />
        ))}
      </ul>
      {connected ? (
        <>
          <p>
            Connected: <strong>{connected.wallet.name}</strong>, account{" "}
            <code>{connected.account.address}</code>
            {connected.account.address !== TEST_ADDRESS ? " (not the test address)" : ""}
          </p>
          <Rows
            wallet={connected.wallet}
            account={connected.account}
            record={record}
            results={results}
          />
          <p>
            <button onClick={exportJson}>Copy results as JSON</button>
          </p>
          {exported ? (
            <textarea readOnly value={exported} rows={16} style={{ width: "100%" }} />
          ) : null}
        </>
      ) : (
        <p>Connect a wallet to run the rows.</p>
      )}
    </main>
  );
}
