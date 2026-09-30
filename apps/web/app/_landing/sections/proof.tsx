// The landing's proof section (F-17, step 3.1), from design/sotto-landing.html.
import { Fragment } from "react";
import type { LandingView } from "../use-landing.ts";

export function ProofDemo({ v }: { v: LandingView }) {
  return (
    <section className="sec soft" id="v8proof">
      <div className="w5">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: "48px",
            flexWrap: "wrap",
          }}
        >
          <h2 className="H2" style={{ maxWidth: "9em" }}>
            {"Prove it. Without showing it."}
          </h2>
          <p className="lead" style={{ maxWidth: "23em" }}>
            {
              "Pick a statement and who it's for. A zero-knowledge proof checks it against your sealed balance. They learn yes or no. Nothing else."
            }
          </p>
        </div>
        <div className="mach">
          <div className="mc">
            <div className="ml">{"A sample sealed balance"}</div>
            <div className="sealbox">
              <span
                className="coin s"
                style={{ width: "36px", height: "36px", borderRadius: "11px" }}
              >
                <svg width="13" height="13" viewBox="0 0 26 26" aria-hidden="true">
                  <circle cx="13" cy="13" r="10.5" fill="none" stroke="#FFFFFF" strokeWidth="2.6" />
                  <path d="M13 2.5a10.5 10.5 0 000 21z" fill="#FFFFFF" />
                </svg>
              </span>
              <span className="amt sealed">
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
                <span className="v num">{"$1,840,300.00"}</span>
              </span>
            </div>
            <div className="grp">
              <div className="ml">{"Prove the balance is at least"}</div>
              <div className="opts">
                {v.ths.map((o, index) => (
                  <Fragment key={index}>
                    <button type="button" className={o.cls} aria-pressed={o.on} onClick={o.pick}>
                      {o.label}
                    </button>
                  </Fragment>
                ))}
              </div>
            </div>
            <div className="grp">
              <div className="ml">{"Share the answer with"}</div>
              <div className="opts">
                {v.tgs.map((o, index) => (
                  <Fragment key={index}>
                    <button type="button" className={o.cls} aria-pressed={o.on} onClick={o.pick}>
                      {o.label}
                    </button>
                  </Fragment>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="b b-ink"
              disabled={v.running}
              onClick={v.generateProof}
            >
              {v.proveLabel}
            </button>
          </div>
          <div className="cz">
            <div className="top">
              <span>{"What the proof checks"}</span>
              <span className="mono">{"range proof, sealed balance"}</span>
            </div>
            <div className={v.scaleCls}>
              <div className="track" />
              <span className="tk" style={{ left: "0%" }}>
                {"$0"}
              </span>
              <span className="tk" style={{ left: "17.86%" }}>
                {"$500k"}
              </span>
              <span className="tk" style={{ left: "35.71%" }}>
                {"$1M"}
              </span>
              <span className="tk" style={{ left: "53.57%" }}>
                {"$1.5M"}
              </span>
              <span className="tk" style={{ left: "71.43%" }}>
                {"$2M"}
              </span>
              <span className="tk" style={{ left: "89.29%" }}>
                {"$2.5M"}
              </span>
              {v.certEmpty ? (
                <>
                  <div className="veilz">
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
                    <span>{"Balance sealed. Its position is unknown."}</span>
                  </div>
                </>
              ) : null}
              {v.done ? (
                <>
                  <div className={v.zoneCls} style={{ left: `${v.zoneL}%`, width: `${v.zoneW}%` }}>
                    <span>{v.zoneText}</span>
                  </div>
                </>
              ) : null}
              <div className="beam" />
              <div className="thm" style={{ left: `${v.thPct}%` }}>
                <em>{v.thLabel}</em>
              </div>
            </div>
            <div className="pins">
              <div>
                <span>
                  {"Commitment"}
                  <i>{"public"}</i>
                </span>
                <b className="mono">{"8f3a\u2026c21e"}</b>
              </div>
              <div>
                <span>
                  {"Threshold"}
                  <i>{"public"}</i>
                </span>
                <b>{v.thF}</b>
              </div>
              <div>
                <span>
                  {"Balance"}
                  <i className="pv">{"private"}</i>
                </span>
                <span className="amt sealed" style={{ height: "28px", fontSize: "13px" }}>
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
                  <span className="v num">{"$1,840,300.00"}</span>
                </span>
              </div>
            </div>
            <div className="ccap">
              <span className={v.spinCls}>
                {v.done ? (
                  <>
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#FFFFFF"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 12l5 5 9-10" />
                    </svg>
                  </>
                ) : null}
              </span>
              <span>{v.capText}</span>
            </div>
          </div>
          <div>
            {v.certEmpty ? (
              <>
                <div className="ph">
                  <svg
                    width="30"
                    height="30"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#9AA8BC"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 3h10l4 4v14H3V3h4z" />
                    <path d="M8 13l3 3 5-6" />
                  </svg>
                  <span>
                    {"Your proof certificate"}
                    <br />
                    {"appears here"}
                  </span>
                </div>
              </>
            ) : null}
            {v.done ? (
              <>
                <div className="cert">
                  <div className="ch">
                    <span>{"Proof of funds"}</span>
                    <span className="mono">{"Illustration"}</span>
                  </div>
                  <div className="res">
                    <span className={v.stampCls}>
                      <svg
                        width="28"
                        height="28"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#FFFFFF"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d={v.stampPath} />
                      </svg>
                    </span>
                    <div>
                      <b className={v.resCls}>{v.resText}</b>
                      <span>{v.resSub}</span>
                    </div>
                  </div>
                  <dl className="flds">
                    <div>
                      <dt>{"Statement"}</dt>
                      <dd>{v.stmtText}</dd>
                    </div>
                    <div>
                      <dt>{"Requested by"}</dt>
                      <dd>{v.tgText}</dd>
                    </div>
                    <div>
                      <dt>{"Verified by"}</dt>
                      <dd>{"The Sotto program on Solana"}</dd>
                    </div>
                    <div>
                      <dt>{"Balance disclosed"}</dt>
                      <dd>{"None"}</dd>
                    </div>
                  </dl>
                  <div className="bc">
                    <svg width="236" height="34" viewBox="0 0 236 34" aria-hidden="true">
                      <rect x="0" y="0" width="2" height="34" />
                      <rect x="4" y="0" width="3" height="34" />
                      <rect x="19" y="0" width="4" height="34" />
                      <rect x="33" y="0" width="1" height="34" />
                      <rect x="37" y="0" width="1" height="34" />
                      <rect x="49" y="0" width="1" height="34" />
                      <rect x="53" y="0" width="3" height="34" />
                      <rect x="62" y="0" width="4" height="34" />
                      <rect x="74" y="0" width="1" height="34" />
                      <rect x="83" y="0" width="2" height="34" />
                      <rect x="87" y="0" width="2" height="34" />
                      <rect x="98" y="0" width="2" height="34" />
                      <rect x="104" y="0" width="1" height="34" />
                      <rect x="107" y="0" width="2" height="34" />
                      <rect x="111" y="0" width="3" height="34" />
                      <rect x="115" y="0" width="3" height="34" />
                      <rect x="119" y="0" width="2" height="34" />
                      <rect x="122" y="0" width="1" height="34" />
                      <rect x="125" y="0" width="4" height="34" />
                      <rect x="131" y="0" width="3" height="34" />
                      <rect x="139" y="0" width="2" height="34" />
                      <rect x="142" y="0" width="1" height="34" />
                      <rect x="145" y="0" width="4" height="34" />
                      <rect x="151" y="0" width="3" height="34" />
                      <rect x="158" y="0" width="3" height="34" />
                      <rect x="168" y="0" width="1" height="34" />
                      <rect x="171" y="0" width="3" height="34" />
                      <rect x="176" y="0" width="4" height="34" />
                      <rect x="185" y="0" width="1" height="34" />
                      <rect x="188" y="0" width="4" height="34" />
                      <rect x="193" y="0" width="2" height="34" />
                      <rect x="197" y="0" width="4" height="34" />
                      <rect x="207" y="0" width="2" height="34" />
                      <rect x="210" y="0" width="1" height="34" />
                      <rect x="213" y="0" width="1" height="34" />
                      <rect x="219" y="0" width="4" height="34" />
                      <rect x="233" y="0" width="4" height="34" />
                    </svg>
                    <small>
                      {"1 bit"}
                      <br />
                      {"disclosed"}
                    </small>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
        <div className="learn">
          <div>
            <small>{"What they learn"}</small>
            <b>{"One bit. Yes or no."}</b>
          </div>
          <div>
            <small>{"What they never see"}</small>
            <b>{"Your balance or history."}</b>
          </div>
          <div>
            <small>{"Who checks the math"}</small>
            <b>{"A Solana program. Not us."}</b>
          </div>
        </div>
      </div>
    </section>
  );
}
