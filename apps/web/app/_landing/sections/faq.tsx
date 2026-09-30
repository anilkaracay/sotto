// The landing's faq section (F-17, step 3.1), from design/sotto-landing.html.
import { Fragment } from "react";
import type { LandingView } from "../use-landing.ts";

export function Faq({ v }: { v: LandingView }) {
  return (
    <section className="sec faq8" id="v8faq">
      <div className="w5 fqg">
        <div className="fql">
          <h2 className="H2">{"Questions, answered."}</h2>
          <p className="lead" style={{ marginTop: "20px", maxWidth: "20em" }}>
            {"The short version of everything we get asked about privacy, payments and compliance."}
          </p>
          <div className="fflt" role="group" aria-label="Filter questions">
            {v.fcats.map((c, index) => (
              <Fragment key={index}>
                <button type="button" className={c.cls} aria-pressed={c.on} onClick={c.pick}>
                  {c.label}
                  <span className="fct">{c.count}</span>
                </button>
              </Fragment>
            ))}
          </div>
          <div className="fcard">
            <div className="fci">
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
                <rect x="3" y="5" width="18" height="14" rx="3" />
                <path d="M3.5 7l8.5 6 8.5-6" />
              </svg>
            </div>
            <div>
              <b>{"Still curious?"}</b>
              <span>
                {"Request access with your work email and company, and we will be in touch."}
              </span>
            </div>
            <a className="b b-ink" href="#v8access">
              {"Request access"}
            </a>
          </div>
        </div>
        <div className="fqs">
          <div className={v.fq0.cls}>
            <button type="button" className="fqb" aria-expanded={v.fq0.open} onClick={v.fq0.pick}>
              <span className="fqi mono">{"01"}</span>
              <span className="fqq">{"Is Sotto a mixer?"}</span>
              <span className="fqc">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
                  <circle cx="12" cy="12" r="2.5" />
                </svg>
                {"Privacy"}
              </span>
              <span className="pm" aria-hidden="true" />
            </button>
            <div className="fa">
              <div>
                <div className="fab">
                  <p>
                    {
                      "No. Addresses stay public, so anyone can see who paid whom and when. Only the amounts are encrypted, using Solana's native confidential transfers, and memos never go onchain. Funds are never pooled with anyone else's."
                    }
                  </p>
                  <div className="fx">
                    <span className="fxc">
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
                      {"Addresses public"}
                    </span>
                    <span className="fxc">
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
                      {"Amounts sealed"}
                    </span>
                    <span className="fxc">
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
                      {"No pooled funds"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className={v.fq1.cls}>
            <button type="button" className="fqb" aria-expanded={v.fq1.open} onClick={v.fq1.pick}>
              <span className="fqi mono">{"02"}</span>
              <span className="fqq">{"Who can read my amounts?"}</span>
              <span className="fqc">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
                  <circle cx="12" cy="12" r="2.5" />
                </svg>
                {"Privacy"}
              </span>
              <span className="pm" aria-hidden="true" />
            </button>
            <div className="fa">
              <div>
                <div className="fab">
                  <p>
                    {
                      "You, and anyone you hand a viewing key to. A key covers every amount, one period or payroll only, and you can revoke it at any time."
                    }
                  </p>
                  <div className="fx">
                    <span className="kh">
                      <span className="av5 pho u-acct" />
                      <span className="av5 pho u-auditor" />
                    </span>
                    <span className="fxt">
                      {"Daniel and your auditor, each with their own scope"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className={v.fq2.cls}>
            <button type="button" className="fqb" aria-expanded={v.fq2.open} onClick={v.fq2.pick}>
              <span className="fqi mono">{"03"}</span>
              <span className="fqq">{"Do my employees and suppliers need a crypto wallet?"}</span>
              <span className="fqc">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="6" width="18" height="13" rx="3" />
                  <path d="M3 10h18" />
                </svg>
                {"Payments"}
              </span>
              <span className="pm" aria-hidden="true" />
            </button>
            <div className="fa">
              <div>
                <div className="fab">
                  <p>{"Today they connect a Solana wallet. Email claim is coming."}</p>
                </div>
              </div>
            </div>
          </div>
          <div className={v.fq3.cls}>
            <button type="button" className="fqb" aria-expanded={v.fq3.open} onClick={v.fq3.pick}>
              <span className="fqi mono">{"04"}</span>
              <span className="fqq">{"Which stablecoins are supported?"}</span>
              <span className="fqc">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="6" width="18" height="13" rx="3" />
                  <path d="M3 10h18" />
                </svg>
                {"Payments"}
              </span>
              <span className="pm" aria-hidden="true" />
            </button>
            <div className="fa">
              <div>
                <div className="fab">
                  <p>
                    {
                      "During the beta, Sotto runs on Solana devnet with devnet USDC, wrapped one to one by a test deployment of Solana's Token Wrap program. Mainnet assets are not decided yet."
                    }
                  </p>
                  <div className="fx">
                    <span className="fxc">
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
                      {"Devnet USDC during the beta"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className={v.fq4.cls}>
            <button type="button" className="fqb" aria-expanded={v.fq4.open} onClick={v.fq4.pick}>
              <span className="fqi mono">{"05"}</span>
              <span className="fqq">{"How does compliance work?"}</span>
              <span className="fqc">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
                </svg>
                {"Compliance"}
              </span>
              <span className="pm" aria-hidden="true" />
            </button>
            <div className="fa">
              <div>
                <div className="fab">
                  <p>
                    {
                      "Businesses are verified before an account opens, every recipient is screened before a payment, and auditors or regulators can be given read access. During the beta, screening uses a deny list. Sotto never takes custody of funds."
                    }
                  </p>
                  <div className="fx">
                    <span className="fxc">
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
                      {"Business verified"}
                    </span>
                    <span className="fxc">
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
                      {"Recipients screened"}
                    </span>
                    <span className="fxc">
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
                      {"Non-custodial"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className={v.fq5.cls}>
            <button type="button" className="fqb" aria-expanded={v.fq5.open} onClick={v.fq5.pick}>
              <span className="fqi mono">{"06"}</span>
              <span className="fqq">{"Has it been audited?"}</span>
              <span className="fqc">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="5" y="11" width="14" height="10" rx="2.5" />
                  <path d="M8 11V8a4 4 0 018 0v3" />
                </svg>
                {"Security"}
              </span>
              <span className="pm" aria-hidden="true" />
            </button>
            <div className="fa">
              <div>
                <div className="fab">
                  <p>
                    {
                      "Sotto builds on Solana's confidential transfers and adds no new cryptography. Its own program only checks proofs and writes records: it holds no funds and cannot move tokens. It gets an external audit before public mainnet."
                    }
                  </p>
                  <div className="fx">
                    <span className="fxc">
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
                      {"No new cryptography"}
                    </span>
                    <span className="fxc">
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
                      {"Audit before public mainnet"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
