# 08 · Backend

Stack per D-12: Next.js route handlers, PostgreSQL 16, Drizzle ORM with SQL migrations, a Node worker. All request bodies validated with `zod`. All timestamps `timestamptz` in UTC.

## 1. The golden rule for data

The database must never contain: plaintext payment amounts, salaries, balances, budgets, notes about money, or any key material. Amount bearing data exists only as ciphertext (disclosures, encrypted blobs to the owner). A schema test fails the build if any column name matches `amount|salary|balance|budget|gross|tax|net` outside the allow list (`proof_records.threshold_base_units`, which is public onchain anyway).

## 2. Schema (logical; implement as Drizzle migrations)

```
users(id uuid pk, wallet text unique not null, created_at)
auth_nonces(nonce text pk, wallet text, expires_at, used_at)
sessions(id text pk, user_id fk, created_at, last_seen_at, expires_at, revoked_at)
admins(wallet text pk)

orgs(id uuid pk, display_name, legal_name, country char(2), registration_no, website, contact_email,
     status enum(pending_review, active, suspended), owner_user_id fk,
     attestation_address text null, reviewed_by text null, reviewed_at null, created_at)
memberships(id uuid pk, org_id fk, user_id fk, role enum(owner, approver, accountant, board, recipient),
            created_at, removed_at null, unique(org_id, user_id, role))
invites(token text pk, org_id fk, role, created_by fk, expires_at, accepted_by null, accepted_at null)
org_policy(org_id pk fk, payment_approvals_required int default 1, payroll_approvals_required int default 1)

viewer_keys(id uuid pk, user_id fk, public_key bytea(32), registration_signature bytea(64),
            status enum(active, rotated), created_at)
token_accounts(id uuid pk, user_id fk, org_id fk null, cluster enum(localnet, devnet, mainnet),
               address text, mint text, key_scheme enum(standard_v1, sotto_ikm_v1), configured_slot bigint,
               unique(cluster, address))

recipients(id uuid pk, org_id fk, display_name, role_title, team, country char(2), wallet text,
           user_id fk null, readiness enum(no_account, not_configured, ready), readiness_checked_at,
           private_blob bytea null)          -- encrypted to owner self key: default amount and notes
screenings(id uuid pk, org_id fk, wallet, provider, result enum(clear, hit, error), provider_ref, created_at)

payments(id uuid pk, org_id fk, kind enum(single, payroll_line), run_id fk null, recipient_id fk,
         idempotency_key text unique, status enum(draft, authorized, executing, settled, failed_clean, failed),
         signatures text[], settled_slot bigint null, error_code text null, created_at, updated_at)
payroll_runs(id uuid pk, org_id fk, title, period char(7), status enum(draft, awaiting_approval, approved,
             executing, settled, partially_settled, failed), line_count int, created_by fk, created_at,
             executed_at null, private_blob bytea)   -- encrypted to owner: amounts per line
approvals(id uuid pk, org_id fk, subject_type enum(payment, payroll_run), subject_id uuid,
          approver_user_id fk, message text, signature bytea, created_at, unique(subject_type, subject_id, approver_user_id))

grants(id uuid pk, org_id fk, viewer_user_id fk, scope enum(all_payments, period, payroll_only, totals_only, own_payslips),
       period_from date null, period_to date null, expires_at null,
       status enum(pending_viewer_key, active, revoked, expired), created_by fk, created_at, revoked_at null,
       last_used_at null)
manifests(id uuid pk, org_id fk, signer_wallet text, manifest jsonb, signature bytea, created_at)
disclosures(id uuid pk, org_id fk, grant_id fk null, viewer_user_id fk, kind enum(payment, payroll_line, month_total, balance_snapshot),
            subject text, ciphertext bytea, manifest_id fk, created_at)

proof_records(id uuid pk, org_id fk, cluster, record_address text unique, threshold_base_units bigint,
              counterparty_label text, expiry timestamptz, created_at)
reconciliations(payment_id pk fk, org_id fk, status enum(matched, needs_receipt), updated_by fk, updated_at)
close_items(org_id fk, month char(7), item_key text, done bool, done_by fk null, done_at null, primary key(org_id, month, item_key))
access_log(id bigserial pk, org_id fk, actor_user_id fk null, action text, subject_type text, subject_id text,
           metadata jsonb, created_at)
waitlist(id uuid pk, email citext unique, company text, token text, confirmed_at null, created_at)
```

Row access is enforced in the API layer with one helper `requireMembership(orgId, roles[])`. Every query that reads org data goes through it. Write a test per endpoint for forbidden access.

## 3. API

All endpoints under `/api`. Errors: `{ "error": { "code": "...", "message": "..." } }` with correct HTTP status.

Auth
- `POST /auth/nonce { wallet }` returns a sign in message (domain, statement, nonce, issued at, expiration 5 minutes).
- `POST /auth/verify { wallet, message, signature }` verifies Ed25519, nonce unused and unexpired, sets the session cookie.
- `POST /auth/logout`, `GET /me`.

Organizations and people
- `POST /orgs`, `GET /orgs/:id`, `PATCH /orgs/:id` (owner).
- `POST /orgs/:id/invites { role }`, `POST /invites/:token/accept`.
- Admin: `GET /admin/orgs?status=`, `POST /admin/orgs/:id/approve`, `/reject`, `/suspend`.

Keys and accounts
- `POST /viewer-keys { publicKey, signature }`, `GET /users/:id/viewer-key`.
- `POST /token-accounts { address, keyScheme }`: the server verifies onchain that the account exists, belongs to the caller's wallet, uses the configured wUSDC mint and has the confidential extension before storing.

Recipients and screening
- `GET/POST/PATCH/DELETE /orgs/:id/recipients`.
- `POST /orgs/:id/recipients/:rid/readiness` re-checks chain state.
- `POST /orgs/:id/screen { wallets[] }` calls the provider (D-10); stores results; returns `clear | hit | error`.

Payments and payroll
- `POST /orgs/:id/payments { recipientId, idempotencyKey }` creates a draft.
- `POST /orgs/:id/payroll-runs { title, period, lines:[{ recipientId, idempotencyKey }], privateBlob }`.
- `POST /approvals { subjectType, subjectId, message, signature }`.
- `POST /orgs/:id/payments/:pid/authorize` returns `{ authorized: true }` only if: org active, recipient ready, screening clear within 24 hours, approvals satisfied, proof program available. Otherwise a precise error code.
- `POST /orgs/:id/payments/:pid/executions { signatures[] }` records attempt signatures before and after sending.
- The worker moves payments to `settled` after finality.

Disclosure
- `POST /orgs/:id/disclosures { manifest, signature, items:[{ viewerUserId, grantId|null, kind, subject, ciphertext }] }`: verifies the manifest signature against the org owner wallet and that every item hash matches the manifest.
- `GET /orgs/:id/disclosures?kind=&from=&to=` returns items for the caller only, plus their manifests.
- Grants: `GET/POST /orgs/:id/grants`, `POST /orgs/:id/grants/:gid/revoke` (deletes disclosures in the same DB transaction).

Proofs
- `POST /orgs/:id/proofs { recordAddress, counterpartyLabel }`: server reads the record from chain and stores metadata.
- `GET /public/proofs/:address`: no auth. Reads chain, returns statement, slot, time, expiry, org display name from the SAS attestation, and `balanceDisclosed: "none"`.

Other
- `GET /orgs/:id/access-log`, reconciliation and close checklist endpoints, `POST /waitlist`, `GET /waitlist/confirm/:token`, `GET /health`.

## 4. Worker jobs

| Job | Interval | What |
|-----|----------|------|
| `confirm-executions` | 5 s | For payments `executing`: fetch signature statuses; mark `settled` at finalized; mark failures with decoded error. |
| `index-accounts` | 15 s | For every org token account: `getSignaturesForAddress`, fetch with `maxSupportedTransactionVersion: 1`, classify with `identifyToken2022Instruction`, store public activity rows (type, signature, slot, counterparty address, public amount only for deposit and withdraw). |
| `recipient-readiness` | 60 s | Re-check recipients not `ready`. |
| `proof-program-health` | 5 min | Simulate a minimal proof verification; set a global flag (F-19). |
| `sas-issue` | on event | Issue or close attestations after admin actions. |
| `grant-expiry` | hourly | Expire grants, delete their disclosures, log. |

Public activity table (add to schema): `chain_activity(id, org_id, signature, slot, block_time, instruction_type, counterparty_address, public_amount_base_units null)`. Public amounts exist only for deposit and withdraw, which are public onchain (facts A2); they are allowed in the column allow list with this justification.

## 5. SAS setup

- One Sotto credential per cluster with the worker's attestation signer as authorized signer. Created by `scripts/bootstrap-sas.ts`.
- Schema `sotto.business.v1` fields: `org_id` (string), `legal_name` (string), `country` (string), `verified_at` (i64), `level` (u8). Encode the layout exactly as `sas-lib` requires for the pinned version (Gate G5).
- Attestation subject: the org owner wallet. Expiry: 365 days. Nonce: a new keypair address per attestation.

## 6. Cross cutting

- Rate limits per IP and per session on auth and write endpoints.
- CSRF: SameSite=Lax cookie plus `Origin` header check on every non GET request.
- Logging: structured JSON, request ID, user ID, org ID. A redaction list blocks fields named like keys, signatures of key derivation messages, ciphertexts and blobs.
- Error reporting service must use the same redaction.
