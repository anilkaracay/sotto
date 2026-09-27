// Recipient fields and readiness (F-07, 08 sections 2 and 3; step 1.8), shared by the API and the
// recipients page so both validate the same way. No server only imports. The default amount and notes
// never travel in plaintext: the page seals them to the owner's own viewing key (the private blob,
// 07 section 2) and the server stores the ciphertext.
import { isAddress } from "@solana/kit";
import { z } from "zod";
import { isCountryCode } from "./countries.ts";

const CONTROL = /\p{Cc}/u;
/** A sealed box adds 48 bytes; the blob holds a default amount and short notes. */
const BLOB_MIN_BYTES = 48;
const BLOB_MAX_BYTES = 2048;

function text(required: string, max: number) {
  return z
    .string(required)
    .trim()
    .min(1, required)
    .max(max, `Use at most ${max} characters`)
    .refine((value) => !CONTROL.test(value), "Remove the control characters");
}

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .refine((value) => !CONTROL.test(value), "Remove the control characters")
    .transform((value) => (value === "" ? null : value))
    .nullable();
}

function base64Bytes(value: string): number | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export const privateBlobSchema = z
  .string()
  .refine((value) => {
    const bytes = base64Bytes(value);
    return bytes !== null && bytes >= BLOB_MIN_BYTES && bytes <= BLOB_MAX_BYTES;
  }, "must be a sealed box in base64")
  .nullable();

export const recipientFieldsSchema = z
  .object({
    displayName: text("Enter the recipient's name", 120),
    roleTitle: optionalText(80).optional(),
    team: optionalText(80).optional(),
    country: z.string().refine(isCountryCode, "Choose a country").nullable().optional(),
    wallet: z
      .string("Enter a Solana wallet address")
      .trim()
      .refine((value) => isAddress(value), "Enter a Solana wallet address"),
    privateBlob: privateBlobSchema.optional(),
  })
  .strict();

/** PATCH: any subset except the wallet (a recipient's wallet does not change; add a new recipient). */
export const recipientUpdateSchema = recipientFieldsSchema
  .omit({ wallet: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Send at least one field to change");

export type RecipientCreate = z.infer<typeof recipientFieldsSchema>;
export type RecipientUpdate = z.infer<typeof recipientUpdateSchema>;

/** What the owner's private blob holds, sealed to the owner's viewing key. */
export type RecipientPrivate = { v: 1; default_amount: string | null; notes: string | null };

/**
 * Notes in the private blob: at most 500 characters (UTF-16 code units) without control characters,
 * so the sealed blob stays under its 2048 byte limit and opens again with parseRecipientPrivate.
 */
export const RECIPIENT_NOTES_MAX = 500;

/** Why these notes cannot go into the private blob, or null. The page checks before sealing. */
export function notesProblem(notes: string): string | null {
  if (notes.length > RECIPIENT_NOTES_MAX) return `Use at most ${RECIPIENT_NOTES_MAX} characters`;
  if (CONTROL.test(notes)) return "Remove the control characters";
  return null;
}

export function parseRecipientPrivate(value: unknown): RecipientPrivate | null {
  if (typeof value !== "object" || value === null) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "default_amount,notes,v" || input.v !== 1)
    return null;
  const amount = input.default_amount;
  const notes = input.notes;
  if (amount !== null && (typeof amount !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(amount))) {
    return null;
  }
  if (notes !== null && (typeof notes !== "string" || notesProblem(notes) !== null)) return null;
  return { v: 1, default_amount: amount, notes };
}

export type Readiness = "no_account" | "not_configured" | "ready";

export const READINESS_LABEL: Record<Readiness, string> = {
  no_account: "No account",
  not_configured: "Not set up",
  ready: "Ready",
};

/** AC-07.4: whether a recipient can be paid confidentially, and in plain words why not. */
export function payability(readiness: Readiness): { payable: boolean; reason: string } {
  switch (readiness) {
    case "no_account":
      return {
        payable: false,
        reason:
          "Cannot be paid confidentially yet: there is no wUSDC account at this wallet. Their invite link walks them through setting one up.",
      };
    case "not_configured":
      return {
        payable: false,
        reason:
          "Cannot be paid confidentially yet: the wUSDC account at this wallet is not set up for confidential payments. Their invite link walks them through it.",
      };
    case "ready":
      return {
        payable: true,
        reason: "Ready: the wUSDC account at this wallet can receive confidential payments.",
      };
  }
}
