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
import { TABLES } from "./golden-rule.test.ts";

const WALLET_A = "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L";
const WALLET_B = "6xosZg2PbZuneXX4riov7GmUCJmydQc3o5MGX6p5EU2";
// Invite tokens are stored as the lowercase hex SHA-256 of the link token (step 1.8).
const INVITE_HASH = "0f".repeat(32);

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
  it("create exactly the tables of the schema", async () => {
    const tables = await rows<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    expect(tables.map((t) => t.table_name)).toEqual(TABLES);
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
      sql`insert into invites (token, org_id, role, created_by, expires_at) values (${INVITE_HASH}, ${orgId}, 'accountant', ${userId}, now() + interval '1 day')`,
    );
    expect(
      await violation(
        sql`insert into grants (org_id, invite_token, scope, created_by) values (${orgId}, ${INVITE_HASH}, 'period', ${userId})`,
      ),
    ).toBe("grants_period_bounds");
    await test.db.execute(
      sql`insert into grants (org_id, invite_token, scope, period_from, period_to, created_by)
          values (${orgId}, ${INVITE_HASH}, 'period', '2026-01-01', '2026-03-31', ${userId})`,
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

  it("store invite tokens as SHA-256 hex and tie recipient invites to a recipient (step 1.8)", async () => {
    const invite = (token: string, role: string, recipientId: string | null) =>
      sql`insert into invites (token, org_id, role, recipient_id, created_by, expires_at)
          values (${token}, ${orgId}, ${role}, ${recipientId}, ${userId}, now() + interval '1 day')`;
    expect(await violation(invite("plain-link-token", "accountant", null))).toBe(
      "invites_token_sha256",
    );
    expect(await violation(invite("1a".repeat(32), "recipient", null))).toBe(
      "invites_recipient_role",
    );
    const [recipient] = await rows<{ id: string }>(
      sql`insert into recipients (org_id, display_name, wallet) values (${orgId}, 'A', ${WALLET_A}) returning id`,
    );
    if (!recipient) throw new Error("recipient not inserted");
    expect(await violation(invite("2b".repeat(32), "accountant", recipient.id))).toBe(
      "invites_recipient_role",
    );
    await test.db.execute(invite("3c".repeat(32), "recipient", recipient.id));
    // Removing the recipient removes its invites.
    await test.db.execute(sql`delete from recipients where id = ${recipient.id}`);
    expect(await rows(sql`select token from invites where token = ${"3c".repeat(32)}`)).toEqual([]);
  });

  it("keep payroll periods as YYYY-MM and tie payroll lines to a run with a line number (step 2.3)", async () => {
    const run = (key: string, period: string) =>
      sql`insert into payroll_runs (org_id, title, period, idempotency_key, line_count, created_by)
          values (${orgId}, 'October payroll', ${period}, ${key}, 1, ${userId}) returning id`;
    expect(await violation(run("run-a", "2026-13"))).toBe("payroll_runs_period_format");
    expect(await violation(run("run-b", "26-10"))).toBe("payroll_runs_period_format");
    const [created] = await rows<{ id: string }>(run("run-c", "2026-10"));
    if (!created) throw new Error("run not inserted");
    const [recipient] = await rows<{ id: string }>(
      sql`insert into recipients (org_id, display_name, wallet) values (${orgId}, 'L', ${WALLET_A}) returning id`,
    );
    if (!recipient) throw new Error("recipient not inserted");
    const line = (key: string, kind: string, runId: string | null, lineNo: number | null) =>
      sql`insert into payments (org_id, kind, run_id, line_no, recipient_id, idempotency_key, created_by)
          values (${orgId}, ${kind}, ${runId}, ${lineNo}, ${recipient.id}, ${key}, ${userId})`;
    expect(await violation(line("line-a", "payroll_line", null, null))).toBe("payments_kind_run");
    expect(await violation(line("line-b", "payroll_line", created.id, 0))).toBe(
      "payments_kind_run",
    );
    expect(await violation(line("line-c", "single", created.id, 1))).toBe("payments_kind_run");
    await test.db.execute(line("line-d", "payroll_line", created.id, 1));
    expect(await violation(line("line-e", "payroll_line", created.id, 1))).toBe(
      "payments_run_line_key",
    );
    await test.db.execute(line("single-f", "single", null, null));
  });

  it("keep access log actions as short snake case names (step 2.4)", async () => {
    const event = (action: string) =>
      sql`insert into access_log (org_id, actor_user_id, action, subject_type, subject_id, metadata)
          values (${orgId}, ${userId}, ${action}, 'grant', 'g1', '{}'::jsonb)`;
    expect(await violation(event("Grant Created"))).toBe("access_log_action_format");
    expect(await violation(event("x"))).toBe("access_log_action_format");
    await test.db.execute(event("grant_created"));
    const [row] = await rows<{ id: string; metadata: unknown }>(
      sql`select id::text as id, metadata from access_log where action = 'grant_created'`,
    );
    expect(row?.metadata).toEqual({});
  });

  it("AC-05.3 keep only deposit and withdraw amounts in chain activity (step 2.5, ENGINEERING-RULES.md rule 4)", async () => {
    const account = "HmEvErXi8iX36Qi9ow6qb7MAUijbiHSUXx7Tiqvq3Srq";
    const signature =
      "571SV857ZQbj8RgBQ4Kdk1gtbSzVCnu8BGU4LNmJh39iEEf9UkDacJJd5i4TLyTreCzeoc4AJk7PaaANsfp4n159";
    let index = 0;
    const activity = (type: string, amount: bigint | null, counterparty: string | null = null) =>
      sql`insert into chain_activity (org_id, token_account, signature, slot, instruction_index, instruction_type, counterparty_address, public_amount_base_units)
          values (${orgId}, ${account}, ${signature}, 7, ${index++}, ${type}, ${counterparty}, ${amount})`;
    expect(await violation(activity("deposit", null))).toBe("chain_activity_public_amount");
    expect(await violation(activity("transfer_out", 5n, account))).toBe(
      "chain_activity_public_amount",
    );
    expect(await violation(activity("wrap", 5n))).toBe("chain_activity_public_amount");
    expect(await violation(activity("withdraw", -1n))).toBe("chain_activity_public_amount");
    expect(await violation(activity("transfer_in", null, "not an address"))).toBe(
      "chain_activity_counterparty_base58",
    );
    await test.db.execute(activity("deposit", 20_000_000n));
    await test.db.execute(activity("withdraw", 3_000_000n));
    await test.db.execute(activity("transfer_out", null, account));
    const [count] = await rows<{ count: string }>(
      sql`select count(*)::text as count from chain_activity where org_id = ${orgId}`,
    );
    expect(count?.count).toBe("3");
  });

  it("AC-13.1 keep a proof record's 16 byte salt, a positive threshold and a short label (step 2.8, X-32)", async () => {
    let n = 0;
    const record = (salt: Buffer, threshold: bigint, label: string, address?: string) =>
      sql`insert into proof_records (org_id, cluster, record_address, threshold_base_units, counterparty_label, counterparty_salt, expiry)
          values (${orgId}, 'devnet', ${address ?? `EsVM5jHqyNVyVypQNRs3UFieQhJx1NBaF2idHHNxT${"GHy"[n++ % 3]}${n}`}, ${threshold}, ${label}, ${salt}, now())`;
    const salt = Buffer.alloc(16, 7);
    expect(await violation(record(Buffer.alloc(15), 1n, "Lender"))).toBe(
      "proof_records_salt_16_bytes",
    );
    expect(await violation(record(salt, 0n, "Lender"))).toBe("proof_records_threshold_positive");
    expect(await violation(record(salt, 1n, ""))).toBe("proof_records_label_length");
    expect(await violation(record(salt, 1n, "x".repeat(121)))).toBe("proof_records_label_length");
    expect(await violation(record(salt, 1n, "Lender", "not an address"))).toBe(
      "proof_records_record_address_base58",
    );
    const address = "DFqVbjLfr1edLKBrmGB6tATRc2vvEqdRr5DVubyhqGXf";
    await test.db.execute(record(salt, 100_000_000_000n, "Harbor Bank", address));
    expect(await violation(record(salt, 1n, "Lender", address))).toBe(
      "proof_records_record_address_unique",
    );
  });
});
