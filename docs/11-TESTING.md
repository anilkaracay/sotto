# 11 · Testing

## 1. Layers

| Layer | Tool | Runs against | Required for merge |
|-------|------|--------------|--------------------|
| Unit (TS) | Vitest | Pure functions: canonical JSON, scope evaluation, CSV parsing, amount math with `bigint` | Yes |
| Component | Vitest with `react-dom/server` | Presentational components rendered to markup (CSS Modules keep local class names): since step 1.7 the balance states (Locked never a number, decrypted and public balances, the devnet test wrap label, absent accounts in words) and the apply prompt (`apps/web/test/balances.test.tsx`) | Yes |
| Unit (Rust) | `cargo test` | `sotto_proofs` helpers | Yes |
| Program | Rust `cargo test` of the native program (D-16), with LiteSVM or `solana-program-test` for runtime tests | Localnet program with real proofs | Yes |
| SDK integration | Vitest | Local validator with Token-2022, Token Wrap, ZK ElGamal Proof program active | Yes |
| API | Vitest plus a test Postgres | Route handlers, authorization matrix. Each test file creates, migrates and drops its own database on the test server of `scripts/db-local.sh test-up` (127.0.0.1:56433, trust authentication on the loopback interface, data in memory); `pnpm test` needs that server running (step 1.2) | Yes |
| E2E | Playwright | Localnet (every PR), devnet (nightly and before release) | Yes (localnet). Temporary (founder, 2026-09-27, plan move M3): in Phase 1 only the happy path (sign in, connect wallet, see the overview) is required; the full suite is required from Phase 2. The harness is the workspace package `tests/e2e` (step 1.3): `server.ts` creates a fresh test database and serves the production build of `apps/web` with `next start` on port 3200. Specs: sign in and connect wallet (1.3); create an organization and see it in review (1.4, AC-02.1); unlock the keys and register the viewing key (1.5, AC-03.2: the wallet refusal and the public recovery guide, the ElGamal key of the CLI check derived in the worker, nothing secret in requests or storage, Locked after a reload). `server.ts` seeds the fixed keypair wallet of `tests/e2e/fixtures.ts` into `admins`, so that spec approves its own org. Since step 1.7 the localnet specs (`tests/e2e/localnet`, `pnpm --filter @sotto/e2e e2e:localnet`, `playwright.localnet.config.ts`) run in the localnet job against the bootstrapped validator (`server.ts --localnet` takes the cluster, RPC URL and USDC mint from `.localnet/bootstrap.json`) with the injected test wallet signing transactions: the determinism refusal (AC-03.3), setup, wrap, deposit and apply with every balance compared with chain and no secret in any request (AC-03.1, AC-03.3, AC-03.4, AC-04.x), Locked after a reload on the setup page and the overview (AC-03.5, AC-05.1). Since step 1.7.1: funding in two signatures with the steps the page shows, a deposit of public wUSDC made outside Sotto, the keys kept across in-app navigation without a new signature, and reload, Lock, sign out and a wallet account change each ending them and closing the crypto worker (`page.workers()`). They need a fresh validator: the CI job starts one each run |
| Visual | Playwright screenshots | Every screen vs baselines from our own build after founder visual sign off (app at 1440; landing at 1440 and 390) | Yes, from Phase 3 |
| Security | Custom CI checks for I-1 to I-10 | Repo and E2E traffic (I-2 uses sentinel payment amounts that are never used for deposits or withdrawals, and exempts the cleartext amount field of deposit and withdraw instructions) | Yes |

## 2. Local validator

- Use the Solana test validator (or Surfpool) from the pinned Agave version. Gate G1 (localnet part) must confirm that the ZK ElGamal Proof program is active and that a full confidential transfer works locally. If the default test validator does not activate it, find the correct flag or clone the program from devnet, record the exact command in `VERSIONS.md`, and put it in `scripts/localnet.sh`.
- Clone Token Wrap into the local validator from devnet or build it from the pinned source.
- Create a local USDC-like mint (6 decimals) and its wrapped mint in the bootstrap script.

## 3. Test wallets

- E2E uses an injected Wallet Standard test wallet backed by a local keypair that implements `signMessage`, `signTransaction`, `signAllTransactions` and sign in. It must behave like the gate results for real wallets (G2): if real wallets refuse the standard derivation message, the test wallet refuses too.
- Since step 1.5 (`tests/e2e/test-wallet.js`): a spec can give it a fixed keypair (`window.__sottoTestWalletKeypair`, the step 1.5 CLI check keypair, derived from a public seed in `tests/e2e/fixtures.ts`, never committed as a file), read the texts it signed (`signedMessages`) and make it refuse given messages (`refuse`), as a wallet following the facts A12 guidance would.
- Implementation (step 1.3): `tests/e2e/test-wallet.js`, added with `page.addInitScript`, registers through the Wallet Standard events with an Ed25519 key generated in the page by WebCrypto. It implements `standard:connect`, `standard:disconnect`, `standard:events`, `solana:signIn` (the text built field for field like `@solana/wallet-standard-util` 1.1.4) and `solana:signMessage`, and signs any message deterministically like the G2 wallets. Its `solana:signTransaction` declares `legacy` and 0; since step 1.7 it signs such transactions at its signer index and counts them (`signedTransactions`), and a spec can make it hand out given signatures for the next messages instead of its own (`queueSignatures`) and, since step 1.7.1, switch to another account with a random key (`switchAccount`), as a wallet with randomized signatures would: the spec computes a valid Ed25519 signature with a random nonce in Node (`randomizedEd25519Signature`, `@sotto/sdk/testing`) for the determinism check. SDK tests use `keypairWallet` (`@sotto/sdk/testing`), a keypair behind the same modifying signer interface as a browser wallet, which can also change the message before signing to test the signed message check.
- Never use real funds in automated tests. Devnet wallets are funded by a faucet script with rate limit handling.

## 4. Acceptance suite

Every `AC-xx.y` in `01-PRODUCT.md` has a test with the AC ID in its title, for example `test("AC-06.5 failed transfer cleans up proof accounts", ...)`. Only a title counts: the first argument of a `test`, `it` or `describe` call, chained forms included (founder, 2026-09-27); an AC ID in a comment, an assertion or any other text does not. `scripts/checks/ac-manifest.py` reads the titles with the TypeScript compiler (`scripts/checks/test-titles.ts`); `--list` prints the ACs that titles name. Rust tests have no string titles and do not count for an AC. CI publishes a table of AC IDs to test results. The AC manifest is phase scoped: `tests/ac-manifest.json` lists which ACs are required at the end of each phase; a missing required AC fails the build.

Key scenarios that must exist:
1. Full owner journey on localnet: sign in, org, admin approval, attestation, setup, wrap, deposit, apply, pay one recipient, recipient sees payslip, accountant sees payment, withdraw, unwrap.
2. Payroll with 24 lines, including one recipient not ready (blocked), one screening hit (blocked), a forced failure on line 12 (run becomes `partially_settled`), resume completes without paying lines 1 to 11 twice.
3. Grant back fill, revoke, expiry.
4. Proof of funds: proven, not proven, balance changed mid proof (rejected), public verify page.
5. Locked states everywhere after reload.
6. Proof program unavailable simulation (mock the availability flag) shows the banner and disables actions.
7. Proof account close destination: for a confidential transfer, a withdraw and a proof of funds on localnet, every proof context and proof record account that the flow creates is closed, and its lamports go to the fee payer wallet. The test asserts the token accounts' lamports are unchanged by the closes and that no ZK ElGamal Proof program account created by the flow remains open (06 sections 5 and 8, facts H4).

## 5. Devnet release checklist

Run the full E2E suite on devnet with fresh wallets. Record run ID, commit, and results in `VERIFICATION-LOG.md`.

## 6. Visual regression tolerance

Pixel diff at most 0.5 percent per screen after masking dynamic regions (times, addresses, animated elements). Update baselines only with founder approval.

## 7. CI

**Until the public launch: local CI (D-25).** `scripts/ci-local.sh` runs the same four jobs as `.github/workflows/ci.yml`, in the same order, on the development machine, stops at the first failure and prints a summary table. Two modes:
- `pnpm ci:local`: cached. Turborepo replays lint, typecheck, test and build results for unchanged inputs. For daily use.
- `pnpm ci:local:full`: every job from scratch: Turborepo `--force` for lint, typecheck, test and build, and before the program build the removal of `target/sbpf-solana-solana` and `target/deploy` (the `cargo-build-sbf` output, including dependencies) plus `cargo clean -p sotto_proofs`. **Mandatory before any merge into `main`**; its summary goes into the step report (ENGINEERING-RULES.md, Git workflow).
1. `node`: Node 24.21.0 and pnpm 12.6.0 version checks, `pnpm install --frozen-lockfile`, `scripts/db-local.sh test-up` (the test Postgres; the job removes it when it ends, and the exit handler does after a failure or an interrupt; the workflow uses a `postgres` service container on the same port), `pnpm lint` (ESLint and Prettier), `pnpm typecheck`, `pnpm test`, `pnpm build`, `scripts/checks/build-output.py` (no env file or server only value in the Next.js build output, 14 section 2), `playwright install chromium` and the E2E suite (`pnpm --filter @sotto/e2e e2e`, step 1.3).
2. `program`: Agave 4.2.2 and `cargo-build-sbf` 4.1.0 version checks, `cargo-build-sbf` build of `sotto_proofs`, `cargo test --locked -p sotto_proofs`.
3. `localnet`: `scripts/fetch-token-wrap.sh` (SHA-256 checked), `scripts/localnet.sh` in the background, wait for `getHealth`, `scripts/localnet-smoke.sh`, the worker's SAS flow on localnet (`pnpm --filter @sotto/worker test:localnet` with `SOTTO_LOCALNET_RPC_URL`, a throwaway signer funded by airdrop; step 1.1) and, since step 1.4, the `sas-issue` job against the same validator with a fresh test database (the job starts the test Postgres with `scripts/db-local.sh test-up` around these tests and removes it; the workflow's localnet job has the same `postgres` service as the node job), since step 1.6 `scripts/bootstrap-localnet.ts` before the tests and the localnet tests of `@sotto/sdk` (v0 and v1 transactions by the 06 section 9 rules, the startup verification; since step 1.7 the confidential account ACs through the wallet path) and `@sotto/scripts` (`recover-balance` against a balance the `spl-token` CLI creates), since step 1.7 the worker's `pending-credits` job and then the Playwright localnet specs (with the node job's production build locally; the workflow builds the web app on its runner first), stop the validator, remove the ledger, the smoke keypairs and the bootstrap files.
4. `checks`: `scripts/checks/no-dashes.py` (tracked files and the last commit message), the tests of the AC checker (`python3 -m unittest discover -s scripts/checks -p "test_*.py"`), `scripts/checks/ac-manifest.py --list` (required ACs for the current phase, named in test titles), gitleaks 8.30.1 from its release tarball (SHA-256 pinned and checked against the release checksums file) over the full history with `.gitleaks.toml`, `scripts/checks/no-zk-token-proof.sh` (invariant I-4), `scripts/checks/env-files.sh` (no env file tracked, stray or in the Docker build context, 14 section 2).

The current phase for the AC manifest check has a single source: `currentPhase` in `tests/ac-manifest.json`. It is raised when a phase ends, as part of that phase's exit check: the manifest requires a phase's ACs at the end of the phase (founder, 2026-09-27).

**After the public launch: GitHub Actions.** The same jobs run in `.github/workflows/ci.yml` on `push` and `pull_request`, with third party actions pinned by commit SHA (`VERSIONS.md`), Agave installed with the official Anza installer through `.github/actions/setup-agave`, caches for the pnpm store, the cargo registry and target, and the Agave install, and branch protection on `main` requiring all four jobs (public launch checklist in `12-MILESTONES.md`). Until then the workflow runs on `workflow_dispatch` only.

Planned additions as the code grows: SDK integration on the local validator, E2E on localnet, visual tests from Phase 3, the remaining security checks (I-1 to I-10), `pnpm audit` and `cargo audit`. Each is added to both `scripts/ci-local.sh` and the workflow.
