import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  forbiddenColumns,
  forbiddenMetadataKeys,
  FORBIDDEN_COLUMN_NAME,
} from "../src/golden-rule.ts";
import * as schema from "../src/schema.ts";

/**
 * The tables of step 1.2, rate_limits, payroll_runs since step 2.3, access_log since 2.4,
 * chain_activity and reconciliations since 2.5, and proof_records since 2.8.
 */
export const TABLES = [
  "access_log",
  "admins",
  "approvals",
  "auth_nonces",
  "chain_activity",
  "cluster_health",
  "disclosures",
  "faucet_mints",
  "grants",
  "invites",
  "manifests",
  "memberships",
  "org_policy",
  "orgs",
  "payment_attempts",
  "payments",
  "payroll_runs",
  "proof_records",
  "rate_limits",
  "recipients",
  "reconciliations",
  "screenings",
  "sessions",
  "sol_grants",
  "token_accounts",
  "users",
  "viewer_keys",
  "waitlist",
];

function schemaTables(): PgTable[] {
  return (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
    is(value, PgTable),
  );
}

describe("golden rule for data (08 section 1)", () => {
  it("defines the tables of step 1.2, rate_limits, payroll_runs (step 2.3), access_log (step 2.4), chain_activity and reconciliations (step 2.5), proof_records (step 2.8), waitlist (step 3.2), faucet_mints (step 4.3), sol_grants (step 4.6)", () => {
    expect(
      schemaTables()
        .map((t) => getTableConfig(t).name)
        .sort(),
    ).toEqual(TABLES);
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

  it("AC-14.1 finds amount like keys at any depth of access log metadata (step 2.4)", () => {
    expect(
      forbiddenMetadataKeys({ grantId: "g", scope: "period", items: 3, lines: [{ id: "l" }] }),
    ).toEqual([]);
    expect(
      forbiddenMetadataKeys({ amount: "5", nested: { grossPay: 1 }, list: [{ tax: 0 }] }),
    ).toEqual(["amount", "nested.grossPay", "list[0].tax"]);
  });
});
