// The landing's footer section (F-17, step 3.1), from design/sotto-landing.html.
import { RequestAccessForm } from "../request-access.tsx";
import { SottoLockupInk, SottoWordmarkWhite } from "@sotto/ui";
import type { LandingView } from "../use-landing.ts";

export function Footer({ v }: { v: LandingView }) {
  return (
    <footer id="v8access">
      <div className="fsky">
        <svg
          className="cloud "
          viewBox="0 0 1600 620"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <filter
              id="v5cF"
              x="0"
              y="0"
              width="100%"
              height="100%"
              colorInterpolationFilters="sRGB"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.0024 0.0068"
                numOctaves="7"
                seed="33"
                result="n"
              />
              <feColorMatrix
                in="n"
                type="matrix"
                values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  3.1 0 0 0 -1.4"
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
          <rect width="1600" height="620" filter="url(#v5cF)" />
        </svg>
        <div className="w5">
          <h2 className="H2">{"Move money onchain without publishing your business."}</h2>
          <p className="lead">
            {
              "Early access for teams already paying payroll, contractors or suppliers in USDC. The beta runs on Solana devnet."
            }
          </p>
          <RequestAccessForm />
        </div>
        <div
          className={v.wmCls}
          style={{ "--fx": `${v.fx}px`, "--fy": `${v.fy}px` }}
          onMouseMove={v.onFootMove}
          onMouseLeave={v.onFootLeave}
          aria-hidden="true"
        >
          <span className="bl">
            <SottoWordmarkWhite height={256} decorative />
          </span>
          <span className="sh">
            <SottoWordmarkWhite height={256} decorative />
          </span>
        </div>
      </div>
      <div className="w5">
        <div className="fcols">
          <div>
            <a className="logo" href="#v8top">
              <SottoLockupInk height={28} />
            </a>
            <p>{"The confidential business account for companies that pay in stablecoins."}</p>
          </div>
          <div>
            <b>{"Product"}</b>
            <a href="#v8views">{"Business account"}</a>
            <a href="#v8views">{"Viewing keys"}</a>
            <a href="#v8proof">{"Proofs"}</a>
            <a href="#v8uses">{"Payouts"}</a>
          </div>
          <div>
            <b>{"Use cases"}</b>
            <a href="#v8uses">{"Payroll"}</a>
            <a href="#v8uses">{"Suppliers"}</a>
            <a href="#v8uses">{"Treasury"}</a>
          </div>
          <div>
            <b>{"Developers"}</b>
            <a href="#v8dev">{"SDK"}</a>
          </div>
          <div>
            <b>{"Company"}</b>
            {/* 13 L36: the trust page exists since step 3.4. */}
            <a href="/trust">{"Trust"}</a>
            <a href="/trust">{"Security"}</a>
            <a href="#v8access">{"Contact"}</a>
          </div>
        </div>
        <div className="fbase">
          <span>{"\u00a9 2026 Sotto. Built for Colosseum's Crypto World's Fair."}</span>
          <nav aria-label="Legal">
            <a href="/trust">{"Security"}</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
