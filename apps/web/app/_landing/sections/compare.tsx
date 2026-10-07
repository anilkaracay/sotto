// The landing's compare section (F-17, step 3.1), from the approved landing design.
import type { LandingView } from "../use-landing.ts";

export function Compare({ v }: { v: LandingView }) {
  return (
    <section className="sec soft">
      <div className="w5 ctr">
        <h2 className="H2">{"Same payments. Two worlds."}</h2>
        <p className="lead">
          {
            "On the left, what any block explorer reveals about a company today. On the right, the same account on Sotto. Drag to compare."
          }
        </p>
        <div className="cmp rv">
          <div className="ly">
            <div className="lbl">
              <span className="tg pub">
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
                {"Any public explorer, today"}
              </span>
              <span className="tg sot" style={{ visibility: "hidden" }}>
                {"With Sotto"}
              </span>
            </div>
            <div className="xhd">
              <span>{"Date"}</span>
              <span>{"Wallet"}</span>
              <span>{"Amount"}</span>
              <span>{"What it reveals"}</span>
            </div>
            <div className="xr">
              <span className="d">{"Oct 30"}</span>
              <span className="mono w2">{"7Fq2\u20269kLm"}</span>
              <span className="v">{"$9,400.00"}</span>
              <span className="s hot">{"Reads as a salary"}</span>
            </div>
            <div className="xr">
              <span className="d">{"Oct 30"}</span>
              <span className="mono w2">{"Hn4P\u20262xQe"}</span>
              <span className="v">{"$11,150.00"}</span>
              <span className="s hot">{"Reads as a salary"}</span>
            </div>
            <div className="xr">
              <span className="d">{"Oct 28"}</span>
              <span className="mono w2">{"K2mD\u2026Lc07"}</span>
              <span className="v">{"$38,000.00"}</span>
              <span className="s hot">{"Your supplier price"}</span>
            </div>
            <div className="xr">
              <span className="d">{"Oct 14"}</span>
              <span className="mono w2">{"Batch 0917"}</span>
              <span className="v">{"$75,900.00"}</span>
              <span className="s hot">{"Creator economics"}</span>
            </div>
            <div className="xr">
              <span className="d">{"Balance"}</span>
              <span className="mono w2">{"9xQe\u2026t7Lm"}</span>
              <span className="v">{"$1,840,300.00"}</span>
              <span className="s hot">{"Your runway"}</span>
            </div>
          </div>
          <div className="tp ly" style={{ clipPath: `inset(0 0 0 ${v.split}%)` }}>
            <div className="lbl">
              <span className="tg pub" style={{ visibility: "hidden" }}>
                {"Any public explorer, today"}
              </span>
              <span className="tg sot">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="5" y="11" width="14" height="10" rx="2.5" />
                  <path d="M8 11V8a4 4 0 018 0v3" />
                </svg>
                {"With Sotto"}
              </span>
            </div>
            <div className="xhd">
              <span>{"Date"}</span>
              <span>{"Wallet"}</span>
              <span>{"Amount"}</span>
              <span>{"Status"}</span>
            </div>
            <div className="xr">
              <span className="d">{"Oct 30"}</span>
              <span className="mono w2">{"7Fq2\u20269kLm"}</span>
              <span className="v">
                <span className="frz">{"$9,400.00"}</span>
              </span>
              <span className="s">
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
                {"Sealed"}
              </span>
            </div>
            <div className="xr">
              <span className="d">{"Oct 30"}</span>
              <span className="mono w2">{"Hn4P\u20262xQe"}</span>
              <span className="v">
                <span className="frz">{"$11,150.00"}</span>
              </span>
              <span className="s">
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
                {"Sealed"}
              </span>
            </div>
            <div className="xr">
              <span className="d">{"Oct 28"}</span>
              <span className="mono w2">{"K2mD\u2026Lc07"}</span>
              <span className="v">
                <span className="frz">{"$38,000.00"}</span>
              </span>
              <span className="s">
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
                {"Sealed"}
              </span>
            </div>
            <div className="xr">
              <span className="d">{"Oct 14"}</span>
              <span className="mono w2">{"Batch 0917"}</span>
              <span className="v">
                <span className="frz">{"$75,900.00"}</span>
              </span>
              <span className="s">
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
                {"Sealed"}
              </span>
            </div>
            <div className="xr">
              <span className="d">{"Balance"}</span>
              <span className="mono w2">{"9xQe\u2026t7Lm"}</span>
              <span className="v">
                <span className="frz">{"$1,840,300.00"}</span>
              </span>
              <span className="s">
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
                {"Sealed"}
              </span>
            </div>
          </div>
          <div className="hand" style={{ left: `${v.split}%` }}>
            <em className="drag">{"Drag"}</em>
            <i>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 6l-6 6 6 6M15 6l6 6-6 6" />
              </svg>
            </i>
          </div>
          <label className="sr" htmlFor="v8range">
            {"Compare a public explorer with Sotto"}
          </label>
          <input
            id="v8range"
            className="rng"
            type="range"
            min="0"
            max="100"
            value={v.split}
            onChange={v.onSplit}
          />
        </div>
      </div>
    </section>
  );
}
