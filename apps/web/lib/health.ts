// The proof program and network banners in words (F-19, AC-19.1, D-14; step 2.9), for the app shell,
// the confidential actions and their tests. No server only imports.
import type { NetworkView } from "./server/network-view.ts";

/** What the shell shows: nothing, the unreachable network, or the unavailable proof program. */
export type HealthState = "ok" | "unreachable" | "program_unavailable";

export function healthState(network: NetworkView): HealthState {
  if (!network.available) return "ok";
  // D-14: a network Sotto cannot reach says so; it is no verdict on the program.
  if (network.check.status === "unreachable") return "unreachable";
  return network.proofProgram.status === "unavailable" ? "program_unavailable" : "ok";
}

export const UNREACHABLE_TITLE = "Network unreachable, retrying";

export function unreachableDetail(label: string): string {
  return `Sotto cannot reach the ${label} network right now, so balances and account actions wait until it answers. This page tries again every 15 seconds. Your keys and your funds are not affected.`;
}

export const PROGRAM_TITLE = "Confidential actions are paused";

export function programDetail(label: string): string {
  return `The ZK ElGamal Proof program, which checks every confidential transaction, is not available on ${label} right now. Your funds are safe: they stay encrypted in your account. Confidential balances cannot be withdrawn until the program is active again, because a withdrawal needs its proofs. Account setup, deposits, payments, payroll, withdrawals and proofs of funds are paused; public balances and public actions keep working.`;
}

/** Next to a disabled confidential action. */
export const PROGRAM_BLOCKED =
  "Paused while the ZK ElGamal Proof program is unavailable. Your funds are safe; see the notice at the top of the page.";
