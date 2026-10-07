// The landing's views section (F-17, step 3.1), from the approved landing design.
import { Fragment } from "react";
import type { LandingView } from "../use-landing.ts";

export function Views({ v }: { v: LandingView }) {
  return (
    <section className="sec" id="v8views">
      <div className="w5 ctr">
        <h2 className="H2">{"One ledger. Four views."}</h2>
        <p className="lead">
          {
            "Addresses stay public, so anyone can verify you paid. Amounts open only for the people you choose."
          }
        </p>
        <div className="tabs" role="group" aria-label="View the ledger as">
          {v.roles.map((r, index) => (
            <Fragment key={index}>
              <button type="button" className={r.cls} aria-pressed={r.pressed} onClick={r.pick}>
                <span className={r.avCls} />
                {r.label}
              </button>
            </Fragment>
          ))}
        </div>
        <div className={v.vcCls}>
          <div className="vtop">
            <div>
              <b>{"Sample statement of account"}</b>
              <small>{"Northwind Labs, October 2026"}</small>
            </div>
            <span className="cnt">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
                <circle cx="12" cy="12" r="2.5" />
              </svg>
              <span>{v.visText}</span>
            </span>
          </div>
          <div className="vhd">
            <span>{"Payment"}</span>
            <span>{"Wallet"}</span>
            <span>{"Key holders"}</span>
            <span style={{ textAlign: "right" }}>{"Amount"}</span>
          </div>
          <div className="vr">
            <div className="w">
              <b>{"Salary"}</b>
              {v.isTeam ? (
                <>
                  <span className="you">{"You"}</span>
                </>
              ) : null}
              <span>{"Design lead"}</span>
            </div>
            <span className="a wl mono">{"7Fq2\u20269kLm"}</span>
            <span className="rb">
              <span className="av5 pho u-maya" title="maya" />
              <span className="av5 pho u-acct" title="acct" />
            </span>
            <span className={`amt ${v.vMaya}`}>
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
          </div>
          <div className="vr">
            <div className="w">
              <b>{"Salary"}</b>
              <span>{"Staff engineer"}</span>
            </div>
            <span className="a wl mono">{"Hn4P\u20262xQe"}</span>
            <span className="rb">
              <span className="av5 pho u-idris" title="idris" />
              <span className="av5 pho u-acct" title="acct" />
            </span>
            <span className={`amt ${v.vIdris}`}>
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
              <span className="v num" style={{ transitionDelay: "60ms" }}>
                {"$11,150.00"}
              </span>
            </span>
          </div>
          <div className="vr">
            <div className="w">
              <b>{"Supplier invoice 1042"}</b>
              <span>{"Atlas Freight"}</span>
            </div>
            <span className="a wl mono">{"K2mD\u2026Lc07"}</span>
            <span className="rb">
              <span className="av5 pho u-atlas" title="atlas" />
              <span className="av5 pho u-acct" title="acct" />
            </span>
            <span className={`amt ${v.vSupplier}`}>
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
              <span className="v num" style={{ transitionDelay: "120ms" }}>
                {"$38,000.00"}
              </span>
            </span>
          </div>
          <div className="vr">
            <div className="w">
              <b>{"Creator payouts"}</b>
              <span>{"2,140 recipients, one run"}</span>
            </div>
            <span className="a wl mono">{"Batch 0917"}</span>
            <span className="rb">
              <span className="av5 pho u-acct" title="acct" />
            </span>
            <span className={`amt ${v.vPayout}`}>
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
              <span className="v num" style={{ transitionDelay: "180ms" }}>
                {"$75,900.00"}
              </span>
            </span>
          </div>
          <div className="vr">
            <div className="w">
              <b>{"Treasury balance"}</b>
              <span>{"Company account"}</span>
            </div>
            <span className="a wl mono">{"9xQe\u2026t7Lm"}</span>
            <span className="rb">
              <span className="av5 pho u-acct" title="acct" />
            </span>
            <span className={`amt ${v.vTreasury}`}>
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
              <span className="v num" style={{ transitionDelay: "240ms" }}>
                {"$1,840,300.00"}
              </span>
            </span>
          </div>
          <div className="vr">
            <div className="w">
              <b>{"Proof of funds"}</b>
              <span>{"Balance is at least 250,000 USDC"}</span>
            </div>
            <span className="a wl mono">{"Proof record"}</span>
            <span className="rb">
              <span className="av5 pho u-atlas" title="atlas" />
              <span className="av5 pho u-acct" title="acct" />
            </span>
            <span className={`amt ${v.vProof}`}>
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
              <span className="v num" style={{ transitionDelay: "300ms", color: "#0B7A51" }}>
                {"Proven"}
              </span>
            </span>
          </div>
          <div className="vnote">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#1F5BE8"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
            <span>{v.roleNote}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
