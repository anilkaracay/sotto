// Sign-In With Solana (D-15, F-01, 08 section 3). The server issues the sign in fields and stores the
// nonce. The wallet signs either through solana:signIn, building the text from the fields, or through
// solana:signMessage, signing the text the server built. Verification parses the signed text with the
// official @solana/wallet-standard-util parser and requires each field to be the one the server issued
// for the configured app origin, never the request's Host header: a message signed for another domain,
// wallet, nonce or time is refused. Only a chain ID added by the wallet is tolerated.
import { randomBytes } from "node:crypto";
import {
  address,
  getPublicKeyFromAddress,
  isAddress,
  signatureBytes,
  verifySignature,
} from "@solana/kit";
import {
  createSignInMessageText,
  parseSignInMessage,
  type SolanaSignInInputWithRequiredFields,
} from "@solana/wallet-standard-util";

export const SIGN_IN_STATEMENT =
  "Sign in to Sotto. This request does not send a transaction or cost any fees.";
/** Sign in messages expire after 5 minutes (08 section 3). */
export const SIGN_IN_TTL_MS = 5 * 60 * 1000;
export const SIGN_IN_VERSION = "1";

const NONCE = /^[0-9a-f]{32}$/;

export type SignInInput = SolanaSignInInputWithRequiredFields;

export function newSignInNonce(): string {
  return randomBytes(16).toString("hex");
}

/** The fields the wallet signs; `origin` is the configured app origin (NEXT_PUBLIC_APP_URL). */
export function signInInput(
  origin: string,
  wallet: string,
  nonce: string,
  issuedAt: Date,
): SignInInput {
  const url = new URL(origin);
  return {
    domain: url.host,
    address: wallet,
    statement: SIGN_IN_STATEMENT,
    uri: url.origin,
    version: SIGN_IN_VERSION,
    nonce,
    issuedAt: issuedAt.toISOString(),
    expirationTime: new Date(issuedAt.getTime() + SIGN_IN_TTL_MS).toISOString(),
  };
}

export function signInMessageText(input: SignInInput): string {
  return createSignInMessageText(input);
}

export type SignInCheck =
  | { ok: true; nonce: string; expiresAt: Date }
  | { ok: false; reason: "unparseable" | "wallet" | "domain" | "fields" | "signature" };

function time(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) || new Date(parsed).toISOString() !== value ? null : parsed;
}

/** Stateless checks of a signed sign in message; the caller then consumes the nonce atomically. */
export async function checkSignedSignIn(params: {
  origin: string;
  wallet: string;
  message: Uint8Array;
  signature: Uint8Array;
}): Promise<SignInCheck> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(params.message);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  const parsed = parseSignInMessage(params.message);
  if (!parsed) return { ok: false, reason: "unparseable" };
  if (!isAddress(params.wallet) || parsed.address !== params.wallet)
    return { ok: false, reason: "wallet" };
  const origin = new URL(params.origin);
  if (parsed.domain !== origin.host || parsed.uri !== origin.origin)
    return { ok: false, reason: "domain" };
  const issuedAt = time(parsed.issuedAt);
  const expiresAt = time(parsed.expirationTime);
  if (
    parsed.statement !== SIGN_IN_STATEMENT ||
    parsed.version !== SIGN_IN_VERSION ||
    !parsed.nonce ||
    !NONCE.test(parsed.nonce) ||
    issuedAt === null ||
    expiresAt === null ||
    expiresAt - issuedAt !== SIGN_IN_TTL_MS ||
    parsed.notBefore !== undefined ||
    parsed.requestId !== undefined ||
    parsed.resources !== undefined ||
    // The signed text must be exactly the canonical text of its fields: nothing hidden around them.
    text.replace(/\n+$/, "") !== createSignInMessageText(parsed)
  ) {
    return { ok: false, reason: "fields" };
  }
  if (params.signature.length !== 64) return { ok: false, reason: "signature" };
  const publicKey = await getPublicKeyFromAddress(address(params.wallet));
  const valid = await verifySignature(publicKey, signatureBytes(params.signature), params.message);
  if (!valid) return { ok: false, reason: "signature" };
  return { ok: true, nonce: parsed.nonce, expiresAt: new Date(expiresAt) };
}
