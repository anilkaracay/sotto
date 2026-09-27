// Browser side of sign in (D-15): ask the API for the sign in message, then send the wallet's signed
// message back. Only the signature and the signed message travel; no key material.
import { getBase64Decoder } from "@solana/kit";

export type IssuedSignIn = {
  input: {
    domain: string;
    address: string;
    statement: string;
    uri: string;
    version: string;
    nonce: string;
    issuedAt: string;
    expirationTime: string;
  };
  message: string;
};

export class SignInError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SignInError";
    this.code = code;
  }
}

async function post(path: string, body: unknown): Promise<Response> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!response.ok) {
    let code = "request_failed";
    let message = `Request failed (${response.status})`;
    try {
      const error = ((await response.json()) as { error?: { code?: string; message?: string } })
        .error;
      if (error?.code) code = error.code;
      if (error?.message) message = error.message;
    } catch {
      // Keep the generic message.
    }
    throw new SignInError(code, message);
  }
  return response;
}

export async function requestSignIn(wallet: string): Promise<IssuedSignIn> {
  return (await (await post("/api/auth/nonce", { wallet })).json()) as IssuedSignIn;
}

export async function completeSignIn(
  wallet: string,
  signedMessage: Uint8Array,
  signature: Uint8Array,
): Promise<void> {
  const base64 = getBase64Decoder();
  await post("/api/auth/verify", {
    wallet,
    message: base64.decode(signedMessage),
    signature: base64.decode(signature),
  });
}

export async function signOut(): Promise<void> {
  await post("/api/auth/logout", {});
}

/** A plain message for a wallet error; wallet rejections read as a cancellation. */
export function describeWalletError(error: unknown): string {
  if (error instanceof SignInError) return error.message;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/reject|denied|cancel|declin/i.test(text)) return "Sign in was cancelled in your wallet.";
  return "The wallet could not sign in. Try again, or choose another wallet.";
}
