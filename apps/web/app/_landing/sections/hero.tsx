// The landing's hero section (F-17, step 3.1), from the approved landing design.
import { DEMO_ENTRY, DEMO_ROLES, demoRoleTitle } from "../../../lib/demo.ts";
import Link from "next/link";
import { SottoLockupWhite } from "@sotto/ui";
import { SolanaMark, UsdcLockup } from "../brand-logos.tsx";
import type { LandingView } from "../use-landing.ts";

export function Hero({ v }: { v: LandingView }) {
  return (
    <section className="hero5" id="v8top">
      <div className="glow" aria-hidden="true" />
      <svg
        className="cloud cC"
        viewBox="0 0 1600 420"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <filter id="v5cC" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.003 0.009"
              numOctaves="7"
              seed="21"
              result="n"
            />
            <feColorMatrix
              in="n"
              type="matrix"
              values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  3.2 0 0 0 -1.6"
              result="a"
            />
            <feGaussianBlur in="a" stdDeviation="1.2" />
          </filter>
        </defs>
        <rect width="1600" height="420" filter="url(#v5cC)" />
      </svg>
      <svg
        className="cloud cA"
        viewBox="0 0 1600 620"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <filter id="v5cA" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.0024 0.0066"
              numOctaves="7"
              seed="5"
              result="n"
            />
            <feColorMatrix
              in="n"
              type="matrix"
              values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  3.0 0 0 0 -1.36"
              result="a"
            />
            <feDiffuseLighting
              in="n"
              surfaceScale="3.5"
              diffuseConstant="1.1"
              lightingColor="#FFFFFF"
              result="l"
            >
              <feDistantLight azimuth="245" elevation="52" />
            </feDiffuseLighting>
            <feColorMatrix
              in="l"
              type="matrix"
              values=".26 0 0 0 .74  0 .26 0 0 .76  0 0 .24 0 .8  0 0 0 0 1"
              result="lt"
            />
            <feComposite in="lt" in2="a" operator="in" />
          </filter>
        </defs>
        <rect width="1600" height="620" filter="url(#v5cA)" />
      </svg>
      <svg
        className="cloud cB"
        viewBox="0 0 1600 700"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <filter id="v5cB" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.0019 0.0058"
              numOctaves="7"
              seed="12"
              result="n"
            />
            <feColorMatrix
              in="n"
              type="matrix"
              values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  3.2 0 0 0 -1.38"
              result="a"
            />
            <feDiffuseLighting
              in="n"
              surfaceScale="3.5"
              diffuseConstant="1.1"
              lightingColor="#FFFFFF"
              result="l"
            >
              <feDistantLight azimuth="245" elevation="52" />
            </feDiffuseLighting>
            <feColorMatrix
              in="l"
              type="matrix"
              values=".26 0 0 0 .74  0 .26 0 0 .76  0 0 .24 0 .8  0 0 0 0 1"
              result="lt"
            />
            <feComposite in="lt" in2="a" operator="in" />
          </filter>
        </defs>
        <rect width="1600" height="700" filter="url(#v5cB)" />
      </svg>
      <header className="nav5">
        <div className="in">
          <a className="logo" href="#v8top" aria-label="Sotto home">
            <SottoLockupWhite height={28} decorative />
          </a>
          <nav className="nl" aria-label="Main">
            <a href="#v8views">{"Product"}</a>
            <a href="#v8uses">{"Use cases"}</a>
            <a href="#v8proof">{"Proofs"}</a>
            <a href="#v8trust">{"Trust"}</a>
            <a href="#v8dev">{"Developers"}</a>
            <a href="#v8faq">{"FAQ"}</a>
          </nav>
          <div className="nr">
            <Link className="si" href="/app">
              {"Sign in"}
            </Link>
            <a className="b b-white" href="#v8access">
              {"Request access"}
            </a>
          </div>
        </div>
      </header>
      <div className="w5 htxt">
        <div className="kicker">
          <b>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="8" cy="15" r="4" />
              <path d="M11 12l9-9M17 6l3 3" />
            </svg>
            {"Beta on Solana devnet"}
          </b>
          <span>{"Selective privacy for onchain finance"}</span>
        </div>
        <h1 className="H1">
          <span className="L">
            <span>{"Private books."}</span>
          </span>
          <span className="L b2">
            <span>{"Public chain."}</span>
          </span>
        </h1>
        <p className="lead">
          {
            "Amounts sealed on Solana. Every reader sees only their scope. Prove your balance without showing it."
          }
        </p>
        <div className="hcta">
          <a className="b b-white" href="#v8access">
            {"Request access "}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
          <a className="b b-glass" href="#v8views">
            {"See who sees what"}
          </a>
        </div>
        {/* Step 4.6 (D-32): the demo company on devnet, read only, as each of its four readers. */}
        <nav className="hdemo" aria-label={DEMO_ENTRY} data-testid="demo-entry">
          <span className="hdemo-l">{DEMO_ENTRY}</span>
          {DEMO_ROLES.map((role) => (
            <a key={role} className="hdemo-r" href={`/demo/${role}`}>
              {demoRoleTitle(role)}
            </a>
          ))}
        </nav>
      </div>
      <div className="stage5" onMouseMove={v.onTilt} onMouseLeave={v.onTiltEnd}>
        <div className="tiltw" style={{ transform: `${v.tiltT}` }}>
          <div className="bezel">
            <div className="sheet">
              <div className="shead">
                <div>
                  <div className="org">
                    <i>
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
                    </i>
                    <span>{"Northwind Labs"}</span>
                    <span style={{ color: "#B4BFCE" }}>{"/"}</span>
                    <span>{"Payroll"}</span>
                  </div>
                  {/* Step 3.10: a card title, not a heading: an h3 here broke the heading order under the h1. */}
                  <p className="sheetTitle">{"October payroll"}</p>
                  <div className="facts5">
                    <span>
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
                        <circle cx="9" cy="8" r="3.5" />
                        <path d="M3 20c.8-3.5 3.3-5 6-5s5.2 1.5 6 5" />
                        <path d="M16 5.5a3 3 0 010 5.5M18 15c1.6.6 2.6 2 3 5" />
                      </svg>
                      {"24 people"}
                    </span>
                    <span>
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
                        <circle cx="12" cy="12" r="9" />
                        <path d="M14.5 9.5c-.4-1-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2 0 2.8 5 1.6 5 4.2 0 1.2-1.1 1.8-2.5 1.8-1.2 0-2.2-.6-2.6-1.6M12 6.5v1.5M12 16v1.5" />
                      </svg>
                      {"Paid in USDC"}
                    </span>
                    <span>
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
                        <path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z" />
                      </svg>
                      {"Every line settles on Solana."}
                    </span>
                  </div>
                </div>
                <div className="total">
                  <small>{"Total paid"}</small>
                  <span className={`tamt num ${v.heroSeal}`}>{"$186,420.00"}</span>
                  <div>
                    <div className="keyseg" role="group" aria-label="View as">
                      <button
                        type="button"
                        className={v.ksPub}
                        aria-pressed={v.ksPubOn}
                        onClick={v.showSealed}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="12" r="9" />
                          <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
                        </svg>
                        {"Public"}
                      </button>
                      <button
                        type="button"
                        className={v.ksAcc}
                        aria-pressed={v.ksAccOn}
                        onClick={v.showOpen}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <circle cx="8" cy="15" r="4" />
                          <path d="M11 12l9-9M17 6l3 3" />
                        </svg>
                        {"Accountant key"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className={v.scanCls} aria-hidden="true" />
              <div className="thd">
                <span>{"Person"}</span>
                <span className="x">{"Team"}</span>
                <span>{"Wallet"}</span>
                <span style={{ textAlign: "right" }}>{"Amount"}</span>
                <span />
              </div>
              <div className="trw">
                <div className="pp">
                  <span className="av5 pho u-maya" role="img" aria-label="Maya Chen" />
                  <div>
                    <b>{"Maya Chen"}</b>
                    <span>{"Design lead"}</span>
                  </div>
                </div>
                <span className="dept x">{"Design"}</span>
                <span className="wl mono">{"7Fq2\u20269kLm"}</span>
                <span className={`amt ${v.heroSeal}`} style={{ transitionDelay: "0ms" }}>
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
                  <span className="v num" style={{ transitionDelay: "0ms" }}>
                    {"$9,400.00"}
                  </span>
                </span>
                <span className="ok5">
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
                </span>
              </div>
              <div className="trw">
                <div className="pp">
                  <span className="av5 pho u-idris" role="img" aria-label="Idris Kaya" />
                  <div>
                    <b>{"Idris Kaya"}</b>
                    <span>{"Staff engineer"}</span>
                  </div>
                </div>
                <span className="dept x">{"Platform"}</span>
                <span className="wl mono">{"Hn4P\u20262xQe"}</span>
                <span className={`amt ${v.heroSeal}`}>
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
                  <span className="v num" style={{ transitionDelay: "80ms" }}>
                    {"$11,150.00"}
                  </span>
                </span>
                <span className="ok5">
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
                </span>
              </div>
              <div className="trw">
                <div className="pp">
                  <span className="av5 pho u-lucia" role="img" aria-label="Luc\u00eda Ortega" />
                  <div>
                    <b>{"Luc\u00eda Ortega"}</b>
                    <span>{"Head of growth"}</span>
                  </div>
                </div>
                <span className="dept x">{"Growth"}</span>
                <span className="wl mono">{"3vTz\u2026Wd81"}</span>
                <span className={`amt ${v.heroSeal}`}>
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
                  <span className="v num" style={{ transitionDelay: "160ms" }}>
                    {"$10,300.00"}
                  </span>
                </span>
                <span className="ok5">
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
                </span>
              </div>
              <div className="trw">
                <div className="pp">
                  <span className="av5 pho u-aiko" role="img" aria-label="Aiko Tanaka" />
                  <div>
                    <b>{"Aiko Tanaka"}</b>
                    <span>{"Research"}</span>
                  </div>
                </div>
                <span className="dept x">{"Research"}</span>
                <span className="wl mono">{"Zp8C\u2026r2Hn"}</span>
                <span className={`amt ${v.heroSeal}`}>
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
                    {"$8,900.00"}
                  </span>
                </span>
                <span className="ok5">
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
                </span>
              </div>
              <div className="trw">
                <div className="pp">
                  <span className="av5 pho u-tomas" role="img" aria-label="Tom\u00e1s Reyes" />
                  <div>
                    <b>{"Tom\u00e1s Reyes"}</b>
                    <span>{"Contractor"}</span>
                  </div>
                </div>
                <span className="dept x">{"Engineering"}</span>
                <span className="wl mono">{"C9aJ\u2026pE5s"}</span>
                <span className={`amt ${v.heroSeal}`}>
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
                  <span className="v num" style={{ transitionDelay: "320ms" }}>
                    {"$6,800.00"}
                  </span>
                </span>
                <span className="ok5">
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
                </span>
              </div>
              <div className="sfoot">
                <div className="who">
                  <div className="stack">
                    <span
                      className="av5 pho u-acct"
                      role="img"
                      aria-label="Daniel Osei, accountant"
                    />
                  </div>
                  <span>{"Readable by Daniel, your accountant"}</span>
                  <span className="more">{"19 more people"}</span>
                </div>
                <a className="b b-ink" href="#v8views">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
                    <circle cx="12" cy="12" r="2.5" />
                  </svg>
                  {"Share a view"}
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="cap5">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
        <span>{v.heroCap}</span>
      </p>
      <p className="why7">
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
          <path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z" />
        </svg>
        <span>
          {
            "Solana switched confidential transfers back on in June 2026. Sotto is the business account built on them."
          }
        </span>
      </p>
      <div className="w5 built5">
        <span>{"Built with"}</span>
        <b>
          <SolanaMark />
          {"Solana"}
        </b>
        <b className="usdc">
          <UsdcLockup />
        </b>
        <b>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="5" y="11" width="14" height="10" rx="2.5" />
            <path d="M8 11V8a4 4 0 018 0v3" />
          </svg>
          {"Token-2022 Confidential Balances"}
        </b>
        <b>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          {"Solana Attestation Service"}
        </b>
      </div>
    </section>
  );
}
