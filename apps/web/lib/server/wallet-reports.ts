// POST /api/wallet-reports (06 section 9, step 1.7): the browser records what a wallet did with a
// signing request, for diagnostics:
// - signature_not_deterministic: the determinism check before account setup got a second signature
//   of the key message that differs from the first, so setup was refused;
// - compute_budget_changed: the wallet changed only the compute budget of a transaction, which was
//   sent (the changed fields and values);
// - transaction_changed: the wallet changed a transaction otherwise, which was not sent (what changed);
// - funding_split: wrap and deposit did not fit in one transaction of the wallet's version, so they
//   went in two (the version, the combined size and the limit; step 1.7.1).
// Each report is one structured log line with the wallet's name, the Wallet Standard version it
// declares and the versions of the features Sotto used; the Wallet Standard gives apps no wallet app
// version. Never keys, signatures or amounts, and nothing is stored. The check itself never looks at
// the wallet name (D-26).
import { z } from "zod";
import { log } from "./log.ts";

const CONTROL = /\p{Cc}/u;

const walletInfo = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .refine((value) => !CONTROL.test(value), "must not contain control characters"),
    version: z.string().regex(/^[0-9A-Za-z.+-]{1,16}$/, "must be a version"),
    features: z
      .array(
        z
          .object({
            name: z.string().regex(/^[a-z]+:[A-Za-z]{1,40}$/, "must be a feature name"),
            version: z.string().regex(/^[0-9A-Za-z.+-]{1,16}$/, "must be a version"),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();

const budgetValue = z.union([z.string().regex(/^\d{1,20}$/, "must be a whole number"), z.null()]);

export const walletReportSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("signature_not_deterministic"), wallet: walletInfo }).strict(),
  z
    .object({
      kind: z.literal("compute_budget_changed"),
      wallet: walletInfo,
      changes: z
        .array(
          z
            .object({
              field: z.enum([
                "computeUnitLimit",
                "computeUnitPrice",
                "priorityFeeLamports",
                "loadedAccountsDataSizeLimit",
                "heapSize",
              ]),
              built: budgetValue,
              signed: budgetValue,
            })
            .strict(),
        )
        .max(5),
    })
    .strict(),
  z
    .object({
      kind: z.literal("funding_split"),
      wallet: walletInfo,
      version: z.union([z.literal(0), z.literal(1)]),
      size: z.int().min(1).max(65_536),
      limit: z.int().min(1).max(65_536),
    })
    .strict(),
  z
    .object({
      kind: z.literal("transaction_changed"),
      wallet: walletInfo,
      reason: z.string().regex(/^[A-Za-z0-9 :,()'.-]{1,120}$/, "must be a short description"),
    })
    .strict(),
]);

export type WalletReport = z.infer<typeof walletReportSchema>;

export function logWalletReport(
  report: WalletReport,
  context: { requestId: string; userId: string },
) {
  const { wallet, ...details } = report;
  log("warn", "wallet_report", {
    requestId: context.requestId,
    userId: context.userId,
    walletName: wallet.name,
    walletStandardVersion: wallet.version,
    walletFeatures: wallet.features,
    ...details,
  });
}
