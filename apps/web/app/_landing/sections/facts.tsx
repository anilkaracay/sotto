// The landing's facts row (F-17, step 3.1), on the design's .srcs layout. Founder,
// 2026-09-30: the design's three market statistics are removed and replaced by facts Sotto measured,
// each taken only from a recorded measurement, whose step is named next to it.
const FACTS = [
  {
    // Measured in the manual devnet run of the Phase 1 exit, step 6: the transfer is one version 1
    // transaction of 10 instructions; again in "Manual devnet run (Phase 2 exit)", steps 2 and 3, with
    // Solflare for both accounts.
    text: "A confidential payment is one Solana transaction in Solflare.",
    source: "Measured on Solana devnet, September 2026",
  },
  {
    // Measured in step 2.3: the SDK's 24 line payroll run in three wallet calls, with the
    // test wallet declaring version 1. Not measured in Solflare, so no wallet is named (founder,
    // 2026-09-30).
    text: "A 24 person payroll run takes 3 wallet approvals.",
    source: "Measured on a local Solana validator with a test wallet, September 2026",
  },
  {
    // Measured in step 2.7: the verification instruction costs 13142 compute units.
    text: "Verifying a proof of funds onchain costs about 13,000 compute units.",
    source: "The Sotto program on Solana devnet, September 2026",
  },
  {
    // Measured in step 2.10: the acceptance spec checks every request, console line and
    // server log line; and "Manual devnet run (Phase 2 exit)", "Nothing in plaintext".
    text: "No amount or memo reaches Sotto's servers in plaintext.",
    source: "Checked by an end to end test on every build",
  },
];

export function Facts() {
  return (
    <section style={{ padding: "20px 0 110px" }} aria-label="Measured facts">
      <div className="w5">
        <div className="srcs four" style={{ marginTop: "0" }} data-testid="landing-facts">
          {FACTS.map((fact) => (
            <p key={fact.text}>
              {fact.text}
              <small>{fact.source}</small>
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
