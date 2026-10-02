// The landing's developers section (F-17, step 3.1), on the design's layout (design/sotto-landing.html,
// .dev8). The copy follows 13 L12, L17 to L20, L29 and L32 and the founder's rule of 2026-09-30: no
// open source claim while the repository is private, the SDK labelled Preview because it is not
// published, no docs or GitHub link, no verifier crate, and code samples that call the real
// @sotto/sdk functions and the real API with their real names.
import { Fragment, type ReactNode } from "react";
import type { LandingView } from "../use-landing.ts";

/** A code line: plain text and highlighted tokens (k keyword, t type, s string, c comment, f call, n number). */
type Token = string | [cls: "k" | "t" | "s" | "c" | "f" | "n", text: string];

type Sample = { lines: Token[][]; output: string[]; result: string };

/** The three samples (exported for the landing tests). */
export const SAMPLES: Sample[] = [
  {
    lines: [
      [
        ["k", "import"],
        " { ",
        ["t", "payPayrollLines"],
        " } ",
        ["k", "from"],
        " ",
        ["s", '"@sotto/sdk/confidential"'],
        ";",
      ],
      [" "],
      [["c", "// Pay a run. Every amount is encrypted onchain."]],
      [["k", "const"], " outcome = ", ["k", "await"], " ", ["f", "payPayrollLines"], "({"],
      ["  rpc, wallet, version: ", ["n", "1"], ","],
      ["  sourceToken, mint: wrappedUsdc,"],
      ["  payments,           ", ["c", "// one per line"]],
      ["  buildChunk,         ", ["c", "// proofs made in the browser"]],
      ["  onSignature: save,  ", ["c", "// kept before each send"]],
      ["});"],
    ],
    // 07 section 4 and VERIFICATION-LOG.md step 2.3: 10 lines per wallet approval with a version 1
    // wallet, so a 24 line run takes 3.
    output: [
      "Up to 10 lines per wallet approval",
      "Every line settles on Solana",
      "Each signature kept before its transaction is sent",
    ],
    result: "outcome.prompts: 3",
  },
  {
    lines: [
      [
        ["k", "import"],
        " { ",
        ["t", "sealPayload"],
        " } ",
        ["k", "from"],
        " ",
        ["s", '"@sotto/sdk/disclosure/seal"'],
        ";",
      ],
      [" "],
      [["c", "// Invite Daniel, your accountant, to read the third quarter."]],
      [["k", "await"], " ", ["f", "fetch"], "(", ["s", "`/api/orgs/${org}/grants`"], ", {"],
      ["  method: ", ["s", '"POST"'], ","],
      [
        "  body: JSON.",
        ["f", "stringify"],
        "({ holderName: ",
        ["s", '"Daniel Osei"'],
        ", scope: ",
        ["s", '"period"'],
        ",",
      ],
      [
        "    periodFrom: ",
        ["s", '"2026-07-01"'],
        ", periodTo: ",
        ["s", '"2026-09-30"'],
        ", expiry: ",
        ["s", '"end_of_year"'],
        " }),",
      ],
      ["});"],
      [["c", "// Once he accepts, each record is sealed to his own key."]],
      [
        ["k", "const"],
        " box = ",
        ["k", "await"],
        " ",
        ["f", "sealPayload"],
        "(record, daniel.publicKey);",
      ],
    ],
    output: [
      "An invite link for Daniel, valid for 7 days",
      "He accepts with his own wallet and registers a viewing key",
      "Revoking stops his access from then on",
    ],
    result: 'grant.scope: "period"',
  },
  {
    lines: [
      [
        ["k", "import"],
        " { ",
        ["t", "balanceThresholdProofs"],
        " } ",
        ["k", "from"],
        " ",
        ["s", '"@sotto/sdk/proofs/plan"'],
        ";",
      ],
      [" "],
      [["c", "// Prove the balance is at least $1,000,000 without revealing it."]],
      [["k", "const"], " proofs = ", ["k", "await"], " ", ["f", "balanceThresholdProofs"], "({"],
      ["  owner, token, tokenAccount, mint, decimals: ", ["n", "6"], ","],
      ["  threshold: ", ["n", "1_000_000_000_000n"], ",  ", ["c", "// base units"]],
      ["  keys, rent,"],
      ["});"],
      [["c", "// sotto_proofs checks them onchain and writes a public record."]],
    ],
    // VERIFICATION-LOG.md step 2.7: the verification costs 13142 compute units.
    output: [
      "Range proof made in the browser",
      "Checked onchain by the Sotto program, about 13,000 compute units",
      "Anyone can open the record at /v/<address>",
    ],
    result: "Proven, balance disclosed: none",
  },
];

function Code({ sample }: { sample: Sample }) {
  const total = String(sample.lines.length);
  return (
    <div className="pane">
      {/* Step 3.10: it scrolls sideways on a phone, so the keyboard can reach it (WCAG 2.1.1). */}
      <pre className="mono" tabIndex={0} aria-label="SDK sample">
        <code>
          {sample.lines.map((line, index) => (
            <span key={index} className="cl" style={{ "--l": String(index) }}>
              {line.map((token, t): ReactNode =>
                typeof token === "string" ? (
                  <Fragment key={t}>{token}</Fragment>
                ) : (
                  <span key={t} className={token[0]}>
                    {token[1]}
                  </span>
                ),
              )}
            </span>
          ))}
          <span className="caret" style={{ "--L": total }} />
        </code>
      </pre>
      <div className="term">
        <div className="tmh">
          <span>Output</span>
          <span className="mono">Preview</span>
        </div>
        {sample.output.map((line, index) => (
          <div key={index} className="ol" style={{ "--o": String(index), "--L": total }}>
            <span className="ok8">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <span>{line}</span>
          </div>
        ))}
        <div className="resx" style={{ "--L": total }}>
          <span className="mono">{sample.result}</span>
        </div>
      </div>
    </div>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function Developers({ v }: { v: LandingView }) {
  const shown = [v.sdk0, v.sdk1, v.sdk2].indexOf(true);
  const sample = SAMPLES[shown] ?? SAMPLES[0];
  return (
    <section className="dev8" id="v8dev">
      <div className="glow8" aria-hidden="true" />
      <div className="w5">
        <div className="dtop">
          <div>
            <h2 className="H2">The engine is an SDK.</h2>
            <p className="lead">
              Everything the Sotto app does is built on @sotto/sdk: payroll in chunks, a sealed
              record for each reader, proofs of funds. It is a preview and not published yet.
            </p>
          </div>
          <div className="dact">
            <div className="inst">
              <span className="mono">@sotto/sdk</span>
              <span className="cpy" data-testid="sdk-preview">
                Preview
              </span>
            </div>
          </div>
        </div>
        <div className="dgrid8">
          <div className="prims" role="group" aria-label="SDK primitives">
            {v.prims.map((p) => (
              <button
                key={p.file}
                type="button"
                className={p.cls}
                aria-pressed={p.on}
                onClick={p.pick}
              >
                <span className="pi">{p.idx}</span>
                <span className="pt">
                  <b>{p.title}</b>
                  <span>{p.desc}</span>
                </span>
                <span className="pf mono">{p.file}</span>
                <span className="pbar">
                  <span />
                </span>
              </button>
            ))}
          </div>
          <div className="ide">
            <div className="ihd">
              <div className="itabs">
                {v.prims.map((p) => (
                  <button key={p.file} type="button" className={p.tabCls} onClick={p.pick}>
                    {p.file}
                  </button>
                ))}
              </div>
              <span className="lang">{v.sdkLang}</span>
            </div>
            {sample ? <Code key={shown} sample={sample} /> : null}
          </div>
        </div>
        <div className="specs">
          <div>
            <Icon>
              <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" />
            </Icon>
            <b>TypeScript</b>
            <span>The SDK the Sotto app runs on</span>
          </div>
          <div>
            <Icon>
              <rect x="3" y="6" width="18" height="13" rx="3" />
              <path d="M3 10h18M16 14.5h2" />
            </Icon>
            {/* 13 L17 with Q-15 (founder, 2026-09-30): Backpack blocks the account setup, so the
                landing names only the wallets tested and implies no other. */}
            <b>Wallet Standard</b>
            <span>Tested with Solflare and Phantom.</span>
          </div>
          <div>
            <Icon>
              <path d="M12 3v18M5 8l7-5 7 5M5 16l7 5 7-5" />
            </Icon>
            <b>Checked onchain</b>
            <span>Proof records anyone can verify</span>
          </div>
          <div>
            <Icon>
              <rect x="5" y="11" width="14" height="10" rx="2.5" />
              <path d="M8 11V8a4 4 0 018 0v3" />
            </Icon>
            <b>No new cryptography</b>
            <span>Built on Token-2022 confidential transfers</span>
          </div>
        </div>
      </div>
    </section>
  );
}
