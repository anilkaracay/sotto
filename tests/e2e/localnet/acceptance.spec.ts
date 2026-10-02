// The hackathon acceptance scenario (acceptance-scenario.ts) with the target's asset: USDC, or devUSD
// with SOTTO_ACCEPTANCE_ASSET=devusd; on localnet, or on devnet through pnpm acceptance:devnet.
import { acceptanceTarget } from "../acceptance-target.ts";
import { acceptanceScenario } from "../acceptance-scenario.ts";

acceptanceScenario(await acceptanceTarget());
