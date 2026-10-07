// The landing's trust section (F-17, step 3.1), from the approved landing design.
import { Fragment } from "react";
import type { LandingView } from "../use-landing.ts";

export function Trust({ v }: { v: LandingView }) {
  return (
    <section className="sec soft" id="v8trust">
      <div className="w5 anat">
        <div className="anl">
          <h2 className="H2">{"Confidential, not anonymous."}</h2>
          <p className="lead" style={{ marginTop: "20px", maxWidth: "24em" }}>
            {"Every Sotto payment is three things at once. Hover to see which part is which."}
          </p>
          <div className="legend">
            {v.groups.map((g, index) => (
              <Fragment key={index}>
                <button
                  type="button"
                  className={g.cls}
                  aria-pressed={g.on}
                  onClick={g.pick}
                  onMouseEnter={g.pick}
                >
                  <span className={g.tagCls}>{g.tag}</span>
                  <b>{g.title}</b>
                  <span className="lg-d">{g.desc}</span>
                </button>
              </Fragment>
            ))}
          </div>
        </div>
        <div className={v.rcptCls}>
          <div className="rh">
            <div>
              <small>{"Payment"}</small>
              <b className="mono">{"tx 5Kq9\u2026Wm2r"}</b>
            </div>
            <span className="pill5">
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
              {"Settled"}
            </span>
          </div>
          <div className="rr g-public">
            <span className="rk">{"From"}</span>
            <span className="rval">
              <span
                className="av5 pho u-atlas"
                style={{
                  width: "24px",
                  height: "24px",
                  background: "var(--ink)",
                  backgroundImage: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "7px",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 26 26" aria-hidden="true">
                  <circle cx="13" cy="13" r="10.5" fill="none" stroke="#FFFFFF" strokeWidth="2.6" />
                  <path d="M13 2.5a10.5 10.5 0 000 21z" fill="#FFFFFF" />
                </svg>
              </span>
              {"Northwind Labs "}
              <em className="mono">{"9xQe\u2026t7Lm"}</em>
            </span>
            <span className="rt public">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
                <circle cx="12" cy="12" r="2.5" />
              </svg>
              {"Public"}
            </span>
          </div>
          <div className="rr g-public">
            <span className="rk">{"To"}</span>
            <span className="rval">
              <span className="av5 pho u-maya" style={{ width: "24px", height: "24px" }} />
              {"Maya Chen "}
              <em className="mono">{"7Fq2\u20269kLm"}</em>
            </span>
            <span className="rt public">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
                <circle cx="12" cy="12" r="2.5" />
              </svg>
              {"Public"}
            </span>
          </div>
          <div className="rr g-public">
            <span className="rk">{"When"}</span>
            <span className="rval">{"Oct 30, 2026, 09:14 UTC"}</span>
            <span className="rt public">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
                <circle cx="12" cy="12" r="2.5" />
              </svg>
              {"Public"}
            </span>
          </div>
          <div className="rr g-sealed">
            <span className="rk">{"Amount"}</span>
            <span className="rval">
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
                <span className="v num">{"$9,400.00"}</span>
              </span>
            </span>
            <span className="rt sealed">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <rect x="5" y="11" width="14" height="10" rx="2.5" />
                <path d="M8 11V8a4 4 0 018 0v3" />
              </svg>
              {"Sealed"}
            </span>
          </div>
          <div className="rr g-sealed">
            <span className="rk">{"Memo"}</span>
            <span className="rval">
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
                <span className="v">{"October salary"}</span>
              </span>
            </span>
            <span className="rt sealed">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <rect x="5" y="11" width="14" height="10" rx="2.5" />
                <path d="M8 11V8a4 4 0 018 0v3" />
              </svg>
              {"Sealed"}
            </span>
          </div>
          <div className="rr g-checked">
            <span className="rk">{"Business"}</span>
            <span className="rval">{"Verified, attested on Solana"}</span>
            <span className="rt checked">
              <svg
                width="12"
                height="12"
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
              {"Checked"}
            </span>
          </div>
          <div className="rr g-checked">
            <span className="rk">{"Screening"}</span>
            <span className="rval">{"Recipient clear on the screening list"}</span>
            <span className="rt checked">
              <svg
                width="12"
                height="12"
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
              {"Checked"}
            </span>
          </div>
          <div className="rr g-checked">
            <span className="rk">{"Custody"}</span>
            <span className="rval">{"Northwind Labs, never Sotto"}</span>
            <span className="rt checked">
              <svg
                width="12"
                height="12"
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
              {"Checked"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
