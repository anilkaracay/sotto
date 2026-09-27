# 08 · Backend

Stack per D-12: Next.js route handlers, PostgreSQL 16, Drizzle ORM with SQL migrations, a Node worker. All request bodies validated with `zod`. All timestamps `timestamptz` in UTC.

## 1. The golden rule for data

The database must never contain: plaintext payment amounts, salaries, balances, budgets, notes about money, or any key material. Amount bearing data exists only as ciphertext (disclosures, encrypted blobs to the owner). A schema test fails the build if any column name matches `amount|salary|balance|budget|gross|tax|net` outside the allow list: `proof_records.threshold_base_units` and `chain_activity.public_amount_base_units`. Both hold amounts that are already public onchain (proof thresholds, confidential deposit and withdraw amounts; ENGINEERING-RULES.md rule 4).

## 2. Schema (logical; implement as Drizzle migrations)

```
users(id uuid pk, wallet text unique not null, display_name, created_at)
auth_nonces(nonce text pk, wallet text, expires_at, used_at)
sessions(id text pk, user_id fk, created_at, last_seen_at, expires_at, revoked_at)
admins(wallet text pk)          -- source of truth for Sotto admins; ADMIN_WALLETS is used only by the seed script to insert rows

orgs(id uuid pk, display_name, legal_name, country char(2), registration_no, website, contact_email,
     status enum(pending_review, active, suspended), owner_user_id fk,
     attestation_address text null, reviewed_by text null, reviewed_at null, created_at,
     private_blob bytea null,          -- encrypted to owner self: budgets and settings with amounts
     unique(owner_user_id))            -- one org per owner wallet, the attestation nonce (section 5; step 1.4)
memberships(id uuid pk, org_id fk, user_id fk, role enum(owner, approver, accountant, board, recipient),
            created_at, removed_at null, unique(org_id, user_id, role))
invites(token text pk, org_id fk, role, created_by fk, expires_at, accepted_by null, accepted_at null)
org_policy(org_id pk fk, payment_approvals_required int default 1, payroll_approvals_required int default 1)

viewer_keys(id uuid pk, user_id fk, public_key bytea(32), registration_signature bytea(64),
            status enum(active, rotated), created_at)
token_accounts(id uuid pk, user_id fk, org_id fk null, cluster enum(localnet, devnet, mainnet),
               address text, mint text, key_scheme enum(standard_v1, sotto_ikm_v1), configured_slot bigint,
               apply_flagged_at timestamptz null,   -- step 1.7: set by pending-credits (AC-04.3)
               unique(cluster, address))

recipients(id uuid pk, org_id fk, display_name, role_title, team, country char(2), wallet text,
           user_id fk null, readiness enum(no_account, not_configured, ready), readiness_checked_at,
           private_blob bytea null)          -- encrypted to owner self key: default amount and notes
screenings(id uuid pk, org_id fk, wallet, provider, result enum(clear, hit, error), provider_ref, created_at)

payments(id uuid pk, org_id fk, kind enum(single, payroll_line), run_id fk null, recipient_id fk,
         idempotency_key text unique, status enum(draft, authorized, executing, settled, failed_clean, failed),
         signatures text[], settled_slot bigint null, error_code text null, created_at, updated_at)
payment_attempts(id, payment_id, attempt_no, signatures text[], status enum(sent, confirmed, finalized, failed, failed_clean),
                 error_code, created_at)
payroll_runs(id uuid pk, org_id fk, title, period char(7), status enum(draft, awaiting_approval, approved,
             executing, settled, partially_settled, failed), line_count int, created_by fk, created_at,
             executed_at null, private_blob bytea)   -- encrypted to owner: amounts per line
approvals(id uuid pk, org_id fk, subject_type enum(payment, payroll_run), subject_id uuid,
          approver_user_id fk, kind enum(message, execution) default message,
          message text null, signature bytea null, execution_signature text null,
          created_at, unique(subject_type, subject_id, approver_user_id))
          -- kind execution: the initiator's approval, recorded with the execution signature (Q-11)

grants(id uuid pk, org_id fk, viewer_user_id fk null, invite_token text fk, scope enum(all_payments, period, payroll_only, own_payslips),
       period_from date null, period_to date null, expires_at null,
       status enum(pending_viewer_key, active, revoked, expired), created_by fk, created_at, revoked_at null,
       last_used_at null)          -- always created through an invite; viewer_user_id is null until the invite is accepted; totals_only is Post-hackathon (D-27)
manifests(id uuid pk, org_id fk, signer_wallet text, manifest jsonb, signature bytea, created_at)
disclosures(id uuid pk, org_id fk, grant_id fk null, viewer_user_id fk, kind enum(payment, payroll_line, month_total, balance_snapshot),
            subject text, ciphertext bytea, manifest_id fk, created_at)

proof_records(id uuid pk, org_id fk, cluster, record_address text unique, threshold_base_units bigint,
              counterparty_label text, counterparty_salt bytea(16), expiry timestamptz, created_at)
reconciliations(payment_id pk fk, org_id fk, status enum(matched, needs_receipt), updated_by fk, updated_at)
-- reconciliation_notes and close_items are Post-hackathon (D-27) and are not built in the hackathon build
reconciliation_notes(id uuid pk, payment_id fk, org_id fk, viewer_user_id fk, ciphertext bytea, manifest_id fk, created_at,
                     unique(payment_id, viewer_user_id))   -- one sealed box per reader (owner plus each accountant with a covering grant), created and signed exactly like disclosures
close_items(org_id fk, month char(7), item_key text, done bool, done_by fk null, done_at null, primary key(org_id, month, item_key))
access_log(id bigserial pk, org_id fk, actor_user_id fk null, action text, subject_type text, subject_id text,
           metadata jsonb, created_at)
waitlist(id uuid pk, email citext unique, company text, token text, confirmed_at null, created_at)
```

Implementation (step 1.2): Drizzle schema `packages/db/src/schema.ts` and SQL migrations generated by drizzle-kit in `packages/db/migrations`, applied with `pnpm --filter @sotto/db migrate`. Phase 1 creates the tables listed for step 1.2 in `12-MILESTONES.md`; `payroll_runs` (with the foreign key of `payments.run_id`) arrives in Phase 2, and the other tables with the features that need them. Physical rules beyond the logical schema: wallet and address columns hold base58 (32 to 44 characters); `country` is two uppercase letters; `viewer_keys.public_key` is 32 bytes and every Ed25519 signature column 64 bytes; one active viewer key per user; one recipient per org and wallet; approval policies at least 1; approvals of kind `message` carry the message and its signature, of kind `execution` the execution signature (Q-11); `period` grants need `period_from <= period_to`; `sessions.id` is the HMAC of the cookie token, never the token. Technical table outside the logical schema: `rate_limits(key text pk, window_start, count)`, the shared counters of section 6.

Row access is enforced in the API layer with one helper `requireMembership(orgId, roles[])`. Every query that reads org data goes through it. Write a test per endpoint for forbidden access.

## 3. API

All endpoints under `/api`. Errors: `{ "error": { "code": "...", "message": "..." } }` with correct HTTP status. The message is also the HTTP reason phrase (the RPC client reads only that). Codes used by the foundation (step 1.2, `apps/web/lib/server/errors.ts`): `invalid_request` (400), `unauthenticated` (401), `forbidden` and `forbidden_origin` (403), `payload_too_large` (413), `unsupported_media_type` (415), `rate_limited` (429 with `Retry-After`), `internal_error` and `server_misconfigured` (500), `approval_policy_not_available` (422, Q-12), and `sign_in_invalid` and `sign_in_expired` (401, step 1.3). Every response carries `x-request-id`.

Auth
- `POST /auth/nonce { wallet }` returns a sign in message (domain, statement, nonce, issued at, expiration 5 minutes).
- `POST /auth/verify { wallet, message, signature }` verifies Ed25519, nonce unused and unexpired, sets the session cookie.
- `POST /auth/logout`, `GET /me`.
- Implementation (step 1.3, `apps/web/lib/server/auth.ts`, `app/api/auth`, `app/api/me`):
  - `POST /auth/nonce { wallet }` returns `{ input, message }`. `input` holds the `solana:signIn` fields: `domain` (the host of `NEXT_PUBLIC_APP_URL`, never taken from the request; on Vercel preview deployments only it is derived from `VERCEL_URL` at build time, 14 section 2), `address`, `statement` "Sign in to Sotto. This request does not send a transaction or cost any fees.", `uri` (that origin), `version` "1", `nonce` (16 random bytes, hex), `issuedAt`, `expirationTime` (5 minutes later). `message` is the same fields as Sign-In With Solana text, built by `@solana/wallet-standard-util` `createSignInMessageText`, for wallets without `solana:signIn` (D-15). The nonce is stored in `auth_nonces` for that wallet.
  - `POST /auth/verify { wallet, message, signature }` (base64): the signed text is parsed with the util's parser and must name the configured origin (never the request's Host header), the wallet, the statement, version 1 and the issued nonce, with issue and expiry times exactly 5 minutes apart, no Not Before, Request ID or Resources, and nothing outside the canonical text of its fields; a Chain ID added by the wallet is tolerated. The Ed25519 signature is checked before the nonce is consumed, so bad signatures cannot burn a pending nonce; the nonce is then consumed atomically (unused, unexpired, same wallet and expiry). The user is created on first sign in and the session cookie set. Failures are 401 `sign_in_invalid` (the message or signature does not match) or `sign_in_expired` (replayed or expired, AC-01.2).
  - `POST /auth/logout` sets `sessions.revoked_at` and clears the cookie (204, AC-01.3).
  - `GET /me` returns `{ user: { id, wallet, displayName }, memberships: [{ orgId, orgName, orgStatus, role }], isAdmin }`.

Organizations and people
- `POST /orgs`, `GET /orgs/:id`, `PATCH /orgs/:id` (owner).
- Implementation (step 1.4, `apps/web/lib/org.ts`, `lib/server/orgs.ts`, `app/api/orgs`):
  - `POST /orgs { legalName, country, registrationNo, website, contactEmail, displayName? }` (session, write limits) creates the org as `pending_review`, the caller's `owner` membership and the `org_policy` defaults in one transaction and returns 201 `{ org }` (AC-02.1). Validation is shared with the onboarding form: trimmed text without control characters; legal name at most 200 characters and 400 UTF-8 bytes (it is attestation data, section 5); country one of the 249 ISO 3166-1 alpha-2 codes (`apps/web/lib/countries.ts`); registration number at most 64 characters; website an `http` or `https` URL with a domain name; contact email at most 254 characters; the display name defaults to the legal name; unknown fields such as `status` are refused. A wallet owns at most one org: 409 `org_exists` "This wallet already has an organization" (the unique index on `orgs.owner_user_id`).
  - `GET /orgs/:id` (any active member) returns `{ org, roles }` with `cache-control: no-store`.
  - `PATCH /orgs/:id` (owner, membership checked before the body): any subset of the create fields. The fields the admin reviewed (legal name, country, registration number, website) change only while the org is `pending_review`, otherwise 409 `org_details_locked`; the display name and the contact email stay editable.
- `POST /orgs/:id/invites { role }`, `POST /invites/:token/accept`.
- `PUT /orgs/:id/policy { paymentApprovalsRequired, payrollApprovalsRequired }` (owner, step 1.2.1): integers of at least 1; the hackathon build accepts only 1 and refuses higher values with 422 `approval_policy_not_available`, "Approval policies above 1 are not available in this build" (Q-12, D-04). Membership is checked before the body.
- Admin: `GET /admin/orgs?status=`, `POST /admin/orgs/:id/approve`, `/reject`, `/suspend`.
- Implementation (step 1.4, `app/api/admin/orgs`, D-09): only wallets in the `admins` table (403 otherwise; `ADMIN_WALLETS` only seeds that table). `GET /admin/orgs?status=pending_review|active|suspended` (no status: all) lists orgs oldest first with the owner wallet and the reviewer, at most 200, with `truncated`. The decisions are one conditional update each, which also records `reviewed_by` (the admin wallet) and `reviewed_at`: approve moves `pending_review` to `active`; reject moves `pending_review` to `suspended` (the hackathon build has no separate rejected status, Q-13 option a, D-09); suspend moves `active` to `suspended`. Any other starting status is 409 `org_status_conflict` (for example "Only in review organizations can be approved; this one is active"), so a suspended org cannot be approved again in this build; an unknown org is 404 `org_not_found`. The worker's `sas-issue` job then issues or closes the attestation (section 4).
- Money gate (AC-02.2, AC-02.4): every money endpoint (F-03 to F-09) authorizes with `requireMoneyAccess(db, session, orgId, roles)` instead of `requireMembership` alone: the role check first (403 `forbidden` for non members), then 403 `org_not_active` unless the org is `active` ("Money features open once Sotto verifies the organization" while in review, "Money features are disabled while the organization is not verified" when suspended). Each money endpoint's tests include these cases.

Keys and accounts
- `POST /viewer-keys { publicKey, signature }`, `GET /users/:id/viewer-key`.
- Implementation (step 1.5, `apps/web/lib/server/viewer-keys.ts`, 07 section 5): `POST /viewer-keys` (session, write limits) takes base64 of exactly 32 and 64 bytes, checks that the signature is the caller's wallet signature of `sotto-view-key-register/v1\n<base64 key>` (400 `viewer_key_signature_invalid` otherwise, nothing stored), and in one transaction marks the active key `rotated` and inserts the new one (201); the key that is already active answers 200 and changes nothing; a concurrent registration that loses the one active key per user index is 409 `viewer_key_conflict`. `GET /users/:id/viewer-key` returns `{ viewerKey: { id, userId, wallet, publicKey, signature, status, createdAt } }` with `cache-control: no-store`, to the user and to an owner of an org the user is an active member of (403 otherwise; 404 `viewer_key_not_found` without an active key). The browser verifies the signature before it encrypts to the key (I-8).
- `POST /token-accounts { address, keyScheme }`: the server verifies onchain that the account exists, belongs to the caller's wallet, uses the configured wUSDC mint and has the confidential extension before storing.
- Implementation (step 1.7, `apps/web/lib/server/token-accounts.ts`, `app/api/token-accounts`): `POST /token-accounts { orgId, address, keyScheme }` is a money endpoint: `requireMoneyAccess` with the owner role, so non members and other roles get 403 `forbidden` and an org in review or suspended 403 `org_not_active`, before the chain is read (AC-02.2). The body names the org because the money gate needs it. `keyScheme` is `standard_v1` only (D-03); the scheme cannot be read from chain. The server's RPC (`RPC_URL`) reads the account, which must exist, be a Token-2022 account of the caller's wallet for the cluster's wUSDC mint and have an approved `ConfidentialTransferAccount` extension; otherwise 422 `token_account_invalid` with the reason ("The token account does not exist onchain", "The account is not a Token-2022 token account", "The token account belongs to another wallet", "The token account does not hold this network's wUSDC", "The token account is not configured for confidential balances", "The token account is not approved for confidential balances"), and nothing is stored. The row records the slot of that read as `configured_slot`. 201 with `{ tokenAccount }` when new; 200 with the same row when the caller recorded it before; 409 `token_account_taken` when another user did; 503 `confidential_unavailable` when the cluster has no wUSDC mint (localnet without `LOCALNET_USDC_MINT`). The cluster is the server's (`NEXT_PUBLIC_CLUSTER`, read at runtime, `apps/web/lib/server/cluster.ts`).

Wallet diagnostics
- `POST /wallet-reports` (step 1.7, `apps/web/lib/server/wallet-reports.ts`; session, write limits): one structured warning line `wallet_report` with the user ID, the wallet's name, the Wallet Standard version it declares and the versions of the features Sotto used (`solana:signMessage`, `solana:signTransaction`; the Wallet Standard gives apps no wallet app version), for `signature_not_deterministic` (the determinism check before account setup, 06 section 3), `compute_budget_changed` (the changed budget fields and values) or `transaction_changed` (what changed; the transaction was not sent, 06 section 9). The body is strict: no other fields, no free text beyond a short description, never keys, signatures or amounts. 204; nothing is stored. It is not a money endpoint: it reads and writes no org data.

Recipients and screening
- `GET/POST/PATCH/DELETE /orgs/:id/recipients`.
- `POST /orgs/:id/recipients/:rid/readiness` re-checks chain state.
- `POST /orgs/:id/screen { wallets[] }` calls the provider (D-10); stores results; returns `clear | hit | error`.

Payments and payroll
- `POST /orgs/:id/payments { recipientId, idempotencyKey }` creates a draft.
- `POST /orgs/:id/payroll-runs { title, period, lines:[{ recipientId, idempotencyKey }], privateBlob }`.
- `POST /approvals { subjectType, subjectId, message, signature }`. The message must include org ID, cluster, subject type and ID, and `contents_hash` = lowercase hex SHA-256 of the canonical JSON list of `{ line_id, recipient_wallet, idempotency_key, private_blob_sha256 }` (D-04). Any change to the run after approval invalidates approvals.
- `POST /orgs/:id/payments/:pid/authorize` returns `{ authorized: true }` only if: org active, recipient ready, screening clear within 24 hours, approvals satisfied, proof program available. Approvals (D-04, Q-11): the initiator counts as one approval; a policy of N (2 or more) needs N minus 1 approval messages signed by other members. Otherwise a precise error code.
- `POST /orgs/:id/payments/:pid/executions { signatures[] }` records attempt signatures before and after sending. With the first execution signature it records the initiator's approval (`approvals.kind = execution`, `execution_signature` set; Q-11).
- The worker moves payments to `settled` after finality.

Disclosure
- `POST /orgs/:id/disclosures { manifest, signature, items:[{ viewerUserId, grantId|null, kind, subject, ciphertext }] }`: verifies the manifest signature against the org owner wallet and that every item hash matches the manifest.
- `GET /orgs/:id/disclosures?kind=&from=&to=` returns items for the caller only, plus their manifests.
- Grants: `GET/POST /orgs/:id/grants`, `POST /orgs/:id/grants/:gid/revoke` (deletes disclosures in the same DB transaction).

Proofs
- `POST /orgs/:id/proofs { recordAddress, counterpartyLabel }`: server reads the record from chain and stores metadata.
- `GET /public/proofs/:address`: no auth. Reads chain, returns statement, slot, time, expiry, org `legal_name` from the SAS attestation, and `balanceDisclosed: "none"`.

RPC proxy
- `POST /rpc`: all browser Solana RPC goes through this server proxy, with a JSON-RPC method allow list, a per session rate limit and a body size limit. Implemented in step 1.2 (`apps/web/app/api/rpc/route.ts`, `apps/web/lib/server/rpc.ts`): a signed in session is required (401); one JSON-RPC 2.0 request object per call, batches refused (400); body at most 32 KiB (413); 600 requests per minute per session (429). Allowed methods: `getAccountInfo`, `getBalance`, `getBlock`, `getGenesisHash`, `getLatestBlockhash`, `getMinimumBalanceForRentExemption`, `getMultipleAccounts`, `getRecentPrioritizationFees`, `getSignatureStatuses`, `getTokenAccountBalance`, `getTransaction`, `sendTransaction`, `simulateTransaction`; anything else is 403 `rpc_method_not_allowed`. The request goes unchanged to `RPC_URL`. An upstream 429 stays 429 (`rpc_upstream_busy`, "Network busy, retrying", D-14), other upstream failures are 502, no answer within 20 seconds is 504, and the upstream URL never appears in a response or a log. A method joins the list only with a test and an update of this list.

Other
- `GET /orgs/:id/access-log`, reconciliation status endpoints (the close checklist is Post-hackathon, D-27), `POST /waitlist`, `GET /waitlist/confirm/:token`, `GET /health`.
- `GET /health` (step 1.2): `{ "status": "ok", "database": "ok" }`, or 503 with `{ "status": "degraded", "database": "unavailable" }`; no session, no rate limit, no configuration detail.

## 4. Worker jobs

| Job | Interval | What |
|-----|----------|------|
| `confirm-executions` | 5 s | For payments `executing`: fetch signature statuses; mark `settled` at finalized; mark failures with decoded error. |
| `index-accounts` | 15 s | For every org token account: `getSignaturesForAddress`, fetch with `maxSupportedTransactionVersion: 1`, classify with `identifyToken2022Instruction`, store public activity rows (type, signature, slot, counterparty address, public amount only for deposit and withdraw, raw destination ciphertext for incoming confidential transfers). |
| `recipient-readiness` | 60 s | Re-check recipients not `ready`. |
| `proof-program-health` | 5 min | Simulate a minimal proof verification; set a global flag (F-19). |
| `sas-issue` | 5 s | Issue or close attestations after admin actions (step 1.4, below). |
| `pending-credits` | 60 s | Step 1.7 (AC-04.3): read the pending balance credit counter of every recorded wUSDC account on the worker's cluster and set `token_accounts.apply_flagged_at` while it is at or above 80 percent of the maximum, clearing it below; the app prompts the owner to apply on the next unlock. |
| `grant-expiry` | hourly | Expire grants, delete their disclosures, log. |

Job loop (step 1.4, `apps/worker/src/jobs/runner.ts`, `src/main.ts`): each job runs on its own interval and never overlaps itself; a failed run is logged (`job_failed`) and retried at the next interval; SIGTERM or SIGINT stops the loop after the running jobs finish. `node src/index.ts --once` (the package's `start` script plus `--once`) runs each job one time and exits 1 if one failed. At start the worker needs `RPC_URL`, `DATABASE_URL`, `SAS_SIGNER_KEYPAIR`, `SAS_CREDENTIAL_ADDRESS` and `SAS_SCHEMA_ADDRESS` (14 section 2); 429 responses are retried as "network busy, retrying".

`sas-issue` (`apps/worker/src/jobs/sas-issue.ts`) polls the orgs table every 5 seconds, 10 orgs per pass:
- An `active` org without `attestation_address`: derive the attestation address (credential, schema, nonce = owner wallet), issue the `sotto.business.v1` attestation if none exists there (data `org_id`, `legal_name`, `country`, `verified_at` = `reviewed_at` in Unix seconds, `level` 1; expiry 365 days from now), then store the address (AC-02.3). An existing attestation for the same org is reused, so a crash between the chain write and the database update repairs itself. An existing attestation there with another `org_id` is left alone and logged as `sas_issue_conflict` (error level) for manual resolution; it can happen only when a database is reset while the chain keeps an attestation for the same owner wallet.
- A `suspended` org with `attestation_address`: close the attestation if it still exists (its rent returns to the SAS signer), then clear the address (AC-02.4). The address is stored even if the org was suspended while its attestation was being issued, so this step closes it.
- Tested on localnet against the SAS program cloned from devnet (`apps/worker/test/sas-issue-localnet.test.ts`, in the `ci:local` localnet job): issue, read back, the longest accepted legal name, idempotence, close on suspension.

`pending-credits` (`apps/worker/src/jobs/pending-credits.ts`, step 1.7): the worker's cluster comes from the RPC's genesis hash (devnet, mainnet, otherwise localnet; facts H6), read once. Every 60 seconds the job reads the recorded accounts of that cluster in batches of 100 (`getMultipleAccounts`), takes the public `pendingBalanceCreditCounter` and `maximumPendingBalanceCreditCounter` of the confidential extension and flags or clears. An account that no longer reads as configured keeps its state and is logged (`pending_credits_unreadable`). Nothing is applied: the flag only prompts the owner (AC-04.3). With no recorded account it makes no RPC call. Tested with an RPC stand in and on localnet (`apps/worker/test/pending-credits-localnet.test.ts`: flagged after 4 deposits into an account with a maximum of 5, cleared after the owner applies).

Public activity table (add to schema): `chain_activity(id, org_id, signature, slot, block_time, instruction_type, counterparty_address, public_amount_base_units null, destination_ciphertext bytea null)`. Public amounts exist only for deposit and withdraw, which are public onchain (facts A2); they are allowed in the column allow list with this justification. For each incoming confidential transfer, `destination_ciphertext` stores the raw destination ciphertext bytes (public data, allowed; see `07-SELECTIVE-DISCLOSURE.md` section 3).

## 5. SAS setup

- One Sotto credential per cluster with the worker's attestation signer as authorized signer. Created by the worker's `bootstrap:sas` (`14-ENVIRONMENTS-DEPLOY.md` section 4; in `apps/worker` because of D-24). Credential name `sotto`. On devnet and localnet the SAS signer is the credential authority, its only authorized signer and the payer of every SAS transaction; mainnet uses the KMS backed signer (section 5 of 14).
- Schema `sotto.business.v1` fields: `org_id` (string), `legal_name` (string), `country` (string), `verified_at` (i64), `level` (u8). Encode the layout exactly as `sas-lib` requires for the pinned version (Gate G5). Verified in G5: layout `[12, 12, 12, 8, 0]` (SAS schema data types String, String, String, I64, U8), field names in that order, version 1 (the program creates every schema at version 1), attestation data encoded as Borsh (facts E5). `verified_at` is Unix seconds; `country` is the ISO 3166-1 alpha-2 code from `orgs.country`. `level` 1 means manual review by a Sotto admin (D-09); other values are reserved for a KYB provider (Post-hackathon).
- Attestation nonce: the org owner's wallet address, so the attestation is discoverable from `ProofRecord.owner`. Verify in G5 that SAS derives the attestation address from credential, schema and nonce; if not, stop and ask. Expiry: 365 days. **VERIFIED** in G5 (2026-09-27, devnet and localnet, facts E4): the address is the PDA of `["attestation", credential, schema, nonce]` under the SAS program, and the program rejects any other address with `InvalidAttestation` (custom error 2). Closing an attestation needs an authorized signer and returns its rent to the payer.
- Devnet addresses (facts E7): credential `4KX4P7he62x5x8X35vubNNhJRhV4vJXPGNsc8skPyKFT`, schema `A4PX8yuPQYeZFqtPomd5E3Jce7dTuWktcnpzb9YCM4z3`.
- Closing an attestation by hand (step 1.6): `scripts/sas-close-attestation.ts --owner <wallet>`, devnet only, with confirmation (14 section 4). On localnet, `scripts/bootstrap-localnet.ts` creates the credential and schema with a throwaway signer. They are in the cluster config (`packages/sdk/src/cluster/config.ts`) and in `apps/worker/.env.local` (`SAS_CREDENTIAL_ADDRESS`, `SAS_SCHEMA_ADDRESS`).

## 6. Cross cutting

- Rate limits per IP and per session on auth and write endpoints. Implementation (step 1.2, `apps/web/lib/server/rate-limit.ts`): fixed one minute windows counted in Postgres (`rate_limits`), so every server instance shares them, keyed by an HMAC of the session ID or of the client IP (first `x-forwarded-for` entry). Defaults: auth 20 per IP, writes 60 per session and 120 per IP, `/rpc` 600 per session.
- CSRF: SameSite=Lax cookie plus `Origin` header check on every non GET request. The Origin must be the request's own origin or `NEXT_PUBLIC_APP_URL`; a missing Origin is refused (403 `forbidden_origin`).
- Logging: structured JSON, request ID, user ID, org ID. A redaction list blocks fields named like keys, signatures of key derivation messages, ciphertexts and blobs. Implementation (step 1.2, `apps/web/lib/server/log.ts`): one JSON line per request with request ID, method, path, status, duration and user ID; fields whose names match key, secret, signature, ciphertext, blob, seed, mnemonic, password, passphrase, token, cookie, authorization, session, ikm, private or an amount word are replaced, and connection strings, API keys and the configured secret values are removed from every string. Request bodies are never logged. Since step 1.4 an error from a failed query keeps only the statement: Drizzle puts the query parameters (which can be what a user typed, such as a contact email) into its message, so the parameters are cut off, and the database error is logged as its message, code and constraint without its detail (which can repeat the row). The worker's log lines (`apps/worker/src/log.ts`) follow the same rules and also remove database URLs.
- Sessions (step 1.2, `apps/web/lib/server/session.ts`): the cookie `sotto_session` holds a random 32 byte token (httpOnly, Secure, SameSite=Lax); the database stores only its HMAC with `SESSION_SECRET`. Idle timeout 12 hours, absolute lifetime 7 days (04 section 5).
- Error reporting service must use the same redaction.
