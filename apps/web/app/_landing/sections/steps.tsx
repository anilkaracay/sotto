// The landing's steps section (F-17, step 3.1), from design/sotto-landing.html.
import { Fragment } from "react";
import type { LandingView } from "../use-landing.ts";

export function Steps({ v }: { v: LandingView }) {
  return (
    <section className="sec">
      <div className="w5">
        <h2 className="H2" style={{ maxWidth: "12em" }}>
          {"Three steps. No new habits."}
        </h2>
        <div className="steps">
          <div className="slist">
            {v.steps.map((s, index) => (
              <Fragment key={index}>
                <button type="button" className={s.cls} aria-pressed={s.on} onClick={s.pick}>
                  <span className="n">{s.n}</span>
                  <b>{s.title}</b>
                  <span className="d">{s.desc}</span>
                  <span className="pb">
                    <span />
                  </span>
                </button>
              </Fragment>
            ))}
          </div>
          <div className="pview">
            {v.step0 ? (
              <>
                <div className="pv">
                  <div className="paper" style={{ padding: "20px" }}>
                    <div className="frow">
                      <span className="coin">{"USDC"}</span>
                      <div>
                        <div style={{ fontSize: "12.5px", color: "var(--faint)" }}>{"Deposit"}</div>
                        <div className="bg2 num">{"250,000.00"}</div>
                      </div>
                    </div>
                  </div>
                  <div className="down">
                    <svg
                      width="22"
                      height="30"
                      viewBox="0 0 22 30"
                      fill="none"
                      stroke="#1F5BE8"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <path d="M11 2v24M4 19l7 7 7-7" />
                    </svg>
                  </div>
                  <div className="paper" style={{ padding: "20px" }}>
                    <div className="frow">
                      <span className="coin s">
                        <svg width="13" height="13" viewBox="0 0 26 26" aria-hidden="true">
                          <circle
                            cx="13"
                            cy="13"
                            r="10.5"
                            fill="none"
                            stroke="#FFFFFF"
                            strokeWidth="2.6"
                          />
                          <path d="M13 2.5a10.5 10.5 0 000 21z" fill="#FFFFFF" />
                        </svg>
                      </span>
                      <div style={{ flex: "1" }}>
                        <div style={{ fontSize: "12.5px", color: "var(--faint)" }}>
                          {"Sealed balance on Solana"}
                        </div>
                        <div style={{ marginTop: "8px" }}>
                          <span className="amt sealed" style={{ height: "38px", fontSize: "20px" }}>
                            <span className="lk">
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="#1F5BE8"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <rect x="5" y="11" width="14" height="10" rx="2.5" />
                                <path d="M8 11V8a4 4 0 018 0v3" />
                              </svg>
                            </span>
                            <span className="v num">{"$250,000.00"}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: "14px", fontSize: "13px", color: "var(--muted)" }}>
                      {"Still one to one with the dollar. Only you can read it."}
                    </div>
                  </div>
                </div>
              </>
            ) : null}
            {v.step1 ? (
              <>
                <div className="pv">
                  <div className="paper" style={{ padding: "20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div
                        style={{
                          width: "44px",
                          height: "44px",
                          borderRadius: "12px",
                          background: "#EBF1FF",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#1F5BE8"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        >
                          <path d="M7 3h7l5 5v13H7z" />
                          <path d="M14 3v5h5M10 13h6M10 17h6" />
                        </svg>
                      </div>
                      <div>
                        <div style={{ fontWeight: "500" }}>{"september.csv"}</div>
                        <div style={{ fontSize: "12.5px", color: "var(--faint)" }}>
                          {"24 people, validated"}
                        </div>
                      </div>
                      <span className="pill5" style={{ marginLeft: "auto" }}>
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M5 12.5l4.5 4.5L19 7.5" />
                        </svg>
                        {"Ready"}
                      </span>
                    </div>
                    <div
                      style={{
                        marginTop: "18px",
                        paddingTop: "16px",
                        borderTop: "1px solid var(--line)",
                        fontSize: "13px",
                        color: "var(--muted)",
                      }}
                    >
                      {"Approved by the owner, recorded in Sotto"}
                    </div>
                    <button
                      type="button"
                      className="b b-ink"
                      style={{ width: "100%", marginTop: "18px" }}
                    >
                      {"Run payroll"}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
            {v.step2 ? (
              <>
                <div className="pv">
                  <div className="paper" style={{ padding: "6px 20px" }}>
                    <div className="mrow">
                      <span
                        className="av5 pho u-acct"
                        role="img"
                        aria-label="Daniel Osei, accountant"
                      />
                      <div>
                        {"Daniel Osei, accountant"}
                        <small>{"Every amount, this fiscal year"}</small>
                      </div>
                      <span className="tgl" />
                    </div>
                    <div className="mrow">
                      <span
                        className="av5 pho u-auditor"
                        role="img"
                        aria-label="External auditor"
                      />
                      <div>
                        {"External auditor"}
                        <small>{"Q3 only, ended October 15"}</small>
                      </div>
                      <span className="tgl off" />
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
