// One Unlock click (founder, 2026-09-28, step 1.8.1; 06 sections 1 and 2, 10 section 3): the wallet
// signs the confidential key message, then the viewing key message, one popup after the other, and the
// tab's key session keeps both keys under the same lock conditions. The derivations stay separate: the
// confidential keys come only from the first signature (D-03 standard_v1), the viewing key only from
// the second (06 section 2). If the first signature fails, nothing is unlocked and the second is not
// asked for; if the second fails, the confidential keys stay unlocked and the page says what is not
// available.
import { confidentialKeysMessage, viewKeyMessage } from "@sotto/sdk/keys/public";
import { CryptoWorkerError } from "./client.ts";
import type { KeySession } from "./key-session.ts";

/** Why a wallet did not give a usable signature (the page's signer checks what was signed). */
export type SignProblem = "cancelled" | "refused" | "message_changed" | "bad_signature";

export type Signer = (message: Uint8Array) => Promise<Uint8Array | SignProblem>;

export type UnlockOutcome =
  | { keys: "unlocked"; viewing: "unlocked" | SignProblem | "failed" }
  | { keys: SignProblem | "failed" };

type Session = Pick<KeySession, "unlock" | "unlockViewing" | "lock">;

/** The viewing key alone: its signature and derivation, into the tab's key session. */
export async function unlockViewingKey(input: {
  wallet: string;
  sign: Signer;
  session: Session;
}): Promise<"unlocked" | SignProblem | "failed"> {
  const signature = await input.sign(viewKeyMessage(input.wallet));
  if (typeof signature === "string") return signature;
  try {
    await input.session.unlockViewing(input.wallet, signature);
    return "unlocked";
  } catch {
    return "failed";
  }
}

export async function unlockKeys(input: {
  wallet: string;
  sign: Signer;
  session: Session;
}): Promise<UnlockOutcome> {
  const signature = await input.sign(confidentialKeysMessage());
  if (typeof signature === "string") return { keys: signature };
  try {
    await input.session.unlock(input.wallet, signature);
  } catch (error) {
    input.session.lock("button");
    return {
      keys:
        error instanceof CryptoWorkerError && error.code === "bad_signature"
          ? "bad_signature"
          : "failed",
    };
  }
  return { keys: "unlocked", viewing: await unlockViewingKey(input) };
}
