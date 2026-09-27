import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { forbiddenColumns, FORBIDDEN_COLUMN_NAME } from "../src/golden-rule.ts";
import * as schema from "../src/schema.ts";

export const PHASE_1_TABLES = [
  "admins",
  "approvals",
  "auth_nonces",
  "disclosures",
  "grants",
  "invites",
  "manifests",
  "memberships",
  "org_policy",
  "orgs",
  "payment_attempts",
  "payments",
  "rate_limits",
  "recipients",
  "screenings",
  "sessions",
  "token_accounts",
  "users",
  "viewer_keys",
];

function schemaTables(): PgTable[] {
  return (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
    is(value, PgTable),
  );
}

describe("golden rule for data (08 section 1)", () => {
  it("defines the Phase 1 tables of 12 step 1.2 plus rate_limits", () => {
    expect(
      schemaTables()
        .map((t) => getTableConfig(t).name)
        .sort(),
    ).toEqual(PHASE_1_TABLES);
  });

  it("has no column named like an amount outside the allow list", () => {
    const columns = schemaTables().flatMap((table) => {
      const config = getTableConfig(table);
      return config.columns.map((column) => ({ table: config.name, column: column.name }));
    });
    expect(columns.length).toBeGreaterThan(100);
    expect(forbiddenColumns(columns)).toEqual([]);
  });

  it("catches amount like names and allows only the two public amount columns", () => {
    for (const name of [
      "amount",
      "salary_cents",
      "balance",
      "budget",
      "gross_pay",
      "tax",
      "net_pay",
    ]) {
      expect(FORBIDDEN_COLUMN_NAME.test(name)).toBe(true);
    }
    expect(
      forbiddenColumns([
        { table: "payments", column: "amount" },
        { table: "chain_activity", column: "public_amount_base_units" },
        { table: "proof_records", column: "threshold_base_units" },
        { table: "orgs", column: "monthly_budget" },
      ]),
    ).toEqual(["orgs.monthly_budget", "payments.amount"]);
  });
});
