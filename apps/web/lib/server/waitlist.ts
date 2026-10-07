// Request access (F-17, AC-17.2; step 3.2): the landing's form stores a work email and a company with
// the visitor's explicit consent, one row per email. Nothing is sent: double opt in by email is
// Post-hackathon with D-19 (15). The email is personal data, so it is never logged, and a
// repeated request answers the same as the first, so the form does not tell who has asked before.
import { waitlist, type Database } from "@sotto/db";
import { z } from "zod";

const CONTROL = /\p{Cc}/u;

export const waitlistRequestSchema = z
  .object({
    email: z.email().max(254),
    company: z
      .string()
      .trim()
      .min(1, "Enter your company")
      .max(120, "Use at most 120 characters")
      .refine((value) => !CONTROL.test(value), "Remove the control characters"),
    /** The consent checkbox; the request is refused without it. */
    consent: z.literal(true, "Tick the box to agree that Sotto stores your details"),
  })
  .strict();

export type WaitlistRequest = z.infer<typeof waitlistRequestSchema>;

/** Stores the request once per email; a later request with the same email changes nothing. */
export async function addToWaitlist(
  db: Database,
  input: WaitlistRequest,
  now = new Date(),
): Promise<void> {
  await db
    .insert(waitlist)
    .values({ email: input.email.trim().toLowerCase(), company: input.company, consentAt: now })
    .onConflictDoNothing({ target: waitlist.email });
}
