// The hackathon acceptance scenario (acceptance-scenario.ts) for an organization that holds devUSD
// (step 4.3, D-29), on localnet beside the USDC run: every amount says devUSD, no page says USDC, and
// the devnet test badge shows. Devnet runs it through pnpm acceptance:devnet once devUSD exists there.
import { test } from "@playwright/test";
import { acceptanceTarget } from "../acceptance-target.ts";
import { acceptanceScenario } from "../acceptance-scenario.ts";

if (process.env.SOTTO_ACCEPTANCE_TARGET === "devnet") {
  test.skip(true, "devnet runs one asset per run (SOTTO_ACCEPTANCE_ASSET)");
} else {
  acceptanceScenario(await acceptanceTarget("devusd"));
}
