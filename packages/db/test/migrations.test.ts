// Exit test of step 1.2: the migrations apply on a fresh database, the result matches the schema, and
// the constraints hold. Needs the test server (scripts/db-local.sh test-up).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forbiddenColumns } from "../src/golden-rule.ts";
import { MIGRATIONS_FOLDER, migrateDatabase } from "../src/migrate.ts";
import * as schema from "../src/schema.ts";
import { createTestDatabase, type TestDatabase } from "../src/testing.ts";
import { PHASE_1_TABLES } from "./golden-rule.test.ts";

const WALLET_A = "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L";
const WALLET_B = "6xosZg2PbZuneXX4riov7GmUCJmydQc3o5MGX6p5EU2";

let test: TestDatabase;

function migrationCount(): number {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
  ) as {
    entries: unknown[];
  };
  return journal.entries.length;
}

beforeAll(async () => {
  test = await createTestDatabase();
});

afterAll(async () => {
  await test?.drop();
});

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await test.db.execute(query)) as unknown as T[];
}

async function violation(query: ReturnType<typeof sql>): Promise<string> {
  try {
    await test.db.execute(query);
  } catch (error) {
    const cause = (error as { cause?: { constraint_name?: string; code?: string } }).cause;
    return cause?.constraint_name ?? cause?.code ?? String(error);
  }
  throw new Error("expected a constraint violation");
}

describe("migrations on a fresh database", () => {
  it("create exactly the Phase 1 tables", async () => {
    const tables = await rows<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    expect(tables.map((t) => t.table_name)).toEqual(PHASE_1_TABLES);
  });

  it("keep the golden rule in the database itself", async () => {
    const columns = await rows<{ table: string; column: string }>(
      sql`select table_name as "table", column_name as "column" from information_schema.columns where table_schema = 'public'`,
    );
    expect(forbiddenColumns(columns)).toEqual([]);
  });

  it("apply again as a no op", async () => {
    await expect(migrateDatabase(test.url)).resolves.toBeUndefined();
    const applied = await rows<{ count: string }>(
      sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
    );
    expect(applied[0]?.count).toBe(String(migrationCount()));
  });

  it("match src/schema.ts (no drift between the schema and the migrations)", async () => {
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
    ) as {
      entries: { idx: number }[];
    };
    const last = journal.entries.at(-1)?.idx ?? 0;
    const snapshot = JSON.parse(
      readFileSync(
        join(MIGRATIONS_FOLDER, "meta", `${String(last).padStart(4, "0")}_snapshot.json`),
        "utf8",
      ),
    );
    const current = generateDrizzleJson(schema as Record<string, unknown>, snapshot.id);
    expect(await generateMigration(snapshot, current)).toEqual([]);
  });
});

describe("constraints", () => {
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    const [user] = await rows<{ id: string }>(
      sql`insert into users (wallet) values (${WALLET_A}) returning id`,
    );
    if (!user) throw new Error("user not inserted");
    userId = user.id;
    const [org] = await rows<{ id: string }>(
      sql`insert into orgs (display_name, legal_name, country, registration_no, website, contact_email, owner_user_id)
          values ('Test', 'Test Ltd', 'TR', '123', 'https://example.com', 'ops@example.com', ${userId}) returning id`,
    );
    if (!org) throw new Error("org not inserted");
    orgId = org.id;
  });

  it("reject a wallet that is not base58", async () => {
    expect(await violation(sql`insert into users (wallet) values ('not a wallet')`)).toBe(
      "users_wallet_base58",
    );
  });

  it("reject a lowercase or three letter country", async () => {
    expect(
      await violation(
        sql`insert into orgs (display_name, legal_name, country, registration_no, website, contact_email, owner_user_id)
            values ('x', 'x', 'tr', '1', 'https://x.example', 'a@x.example', ${userId})`,
      ),
    ).toBe("orgs_country_iso");
  });

  it("allow one membership per org, user and role", async () => {
    await test.db.execute(
      sql`insert into memberships (org_id, user_id, role) values (${orgId}, ${userId}, 'owner')`,
    );
    expect(
      await violation(
        sql`insert into memberships (org_id, user_id, role) values (${orgId}, ${userId}, 'owner')`,
      ),
    ).toBe("memberships_org_user_role_key");
  });

  it("default the approval policy to 1 and refuse 0 (D-04, Q-11)", async () => {
    await test.db.execute(sql`insert into org_policy (org_id) values (${orgId})`);
    const [policy] = await rows<{ p: number; r: number }>(
      sql`select payment_approvals_required as p, payroll_approvals_required as r from org_policy where org_id = ${orgId}`,
    );
    expect(policy).toEqual({ p: 1, r: 1 });
    expect(
      await violation(
        sql`update org_policy set payment_approvals_required = 0 where org_id = ${orgId}`,
      ),
    ).toBe("org_policy_payment_approvals_min");
  });

  it("require the signed message for message approvals and the signature for executions", async () => {
    const subject = "00000000-0000-4000-8000-000000000001";
    expect(
      await violation(
        sql`insert into approvals (org_id, subject_type, subject_id, approver_user_id) values (${orgId}, 'payment', ${subject}, ${userId})`,
      ),
    ).toBe("approvals_kind_fields");
    await test.db.execute(
      sql`insert into approvals (org_id, subject_type, subject_id, approver_user_id, kind, execution_signature)
          values (${orgId}, 'payment', ${subject}, ${userId}, 'execution', '5ps3cgtm')`,
    );
    expect(
      await violation(
        sql`insert into approvals (org_id, subject_type, subject_id, approver_user_id, message, signature)
            values (${orgId}, 'payment', ${"00000000-0000-4000-8000-000000000002"}, ${userId}, 'm', ${Buffer.alloc(63)})`,
      ),
    ).toBe("approvals_signature_length");
  });

  it("keep viewer key sizes and one active viewer key per user", async () => {
    expect(
      await violation(
        sql`insert into viewer_keys (user_id, public_key, registration_signature) values (${userId}, ${Buffer.alloc(31)}, ${Buffer.alloc(64)})`,
      ),
    ).toBe("viewer_keys_public_key_length");
    await test.db.execute(
      sql`insert into viewer_keys (user_id, public_key, registration_signature) values (${userId}, ${Buffer.alloc(32, 1)}, ${Buffer.alloc(64, 2)})`,
    );
    expect(
      await violation(
        sql`insert into viewer_keys (user_id, public_key, registration_signature) values (${userId}, ${Buffer.alloc(32, 3)}, ${Buffer.alloc(64, 4)})`,
      ),
    ).toBe("viewer_keys_one_active_per_user");
  });

  it("require bounds for period grants", async () => {
    await test.db.execute(
      sql`insert into invites (token, org_id, role, created_by, expires_at) values ('invite-hash-1', ${orgId}, 'accountant', ${userId}, now() + interval '1 day')`,
    );
    expect(
      await violation(
        sql`insert into grants (org_id, invite_token, scope, created_by) values (${orgId}, 'invite-hash-1', 'period', ${userId})`,
      ),
    ).toBe("grants_period_bounds");
    await test.db.execute(
      sql`insert into grants (org_id, invite_token, scope, period_from, period_to, created_by)
          values (${orgId}, 'invite-hash-1', 'period', '2026-01-01', '2026-03-31', ${userId})`,
    );
  });

  it("allow one org per owner wallet (the attestation nonce, 08 section 5)", async () => {
    expect(
      await violation(
        sql`insert into orgs (display_name, legal_name, country, registration_no, website, contact_email, owner_user_id)
            values ('Second', 'Second Ltd', 'TR', '2', 'https://second.example', 'a@second.example', ${userId})`,
      ),
    ).toBe("orgs_owner_user_id_key");
  });

  it("keep recipient wallets unique per org", async () => {
    await test.db.execute(
      sql`insert into recipients (org_id, display_name, wallet) values (${orgId}, 'B', ${WALLET_B})`,
    );
    expect(
      await violation(
        sql`insert into recipients (org_id, display_name, wallet) values (${orgId}, 'B again', ${WALLET_B})`,
      ),
    ).toBe("recipients_org_wallet_key");
  });
});
