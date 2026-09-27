# 11 · Testing

## 1. Layers

| Layer | Tool | Runs against | Required for merge |
|-------|------|--------------|--------------------|
| Unit (TS) | Vitest | Pure functions: canonical JSON, scope evaluation, CSV parsing, amount math with `bigint` | Yes |
| Unit (Rust) | `cargo test` | `sotto_proofs` helpers | Yes |
| Program | Rust `cargo test` of the native program (D-16), with LiteSVM or `solana-program-test` for runtime tests | Localnet program with real proofs | Yes |
| SDK integration | Vitest | Local validator with Token-2022, Token Wrap, ZK ElGamal Proof program active | Yes |
| API | Vitest plus a test Postgres | Route handlers, authorization matrix | Yes |
| E2E | Playwright | Localnet (every PR), devnet (nightly and before release) | Yes (localnet) |
| Visual | Playwright screenshots | Every screen vs baselines from our own build after founder visual sign off (app at 1440; landing at 1440 and 390) | Yes, from Phase 3 |
| Security | Custom CI checks for I-1 to I-10 | Repo and E2E traffic (I-2 uses sentinel payment amounts that are never used for deposits or withdrawals, and exempts the cleartext amount field of deposit and withdraw instructions) | Yes |

## 2. Local validator

- Use the Solana test validator (or Surfpool) from the pinned Agave version. Gate G1 (localnet part) must confirm that the ZK ElGamal Proof program is active and that a full confidential transfer works locally. If the default test validator does not activate it, find the correct flag or clone the program from devnet, record the exact command in `VERSIONS.md`, and put it in `scripts/localnet.sh`.
- Clone Token Wrap into the local validator from devnet or build it from the pinned source.
- Create a local USDC-like mint (6 decimals) and its wrapped mint in the bootstrap script.

## 3. Test wallets

- E2E uses an injected Wallet Standard test wallet backed by a local keypair that implements `signMessage`, `signTransaction`, `signAllTransactions` and sign in. It must behave like the gate results for real wallets (G2): if real wallets refuse the standard derivation message, the test wallet refuses too.
- Never use real funds in automated tests. Devnet wallets are funded by a faucet script with rate limit handling.

## 4. Acceptance suite

Every `AC-xx.y` in `01-PRODUCT.md` has a test with the AC ID in its name, for example `test("AC-06.5 failed transfer cleans up proof accounts", ...)`. CI publishes a table of AC IDs to test results. The AC manifest is phase scoped: `tests/ac-manifest.json` lists which ACs are required at the end of each phase; a missing required AC fails the build.

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

**Until the public launch: local CI (D-25).** `pnpm ci:local` (`scripts/ci-local.sh`) runs the same four jobs as `.github/workflows/ci.yml`, in the same order, on the development machine, stops at the first failure and prints a summary table. It must be green before any merge into `main`, and the summary goes into the step report (ENGINEERING-RULES.md, Git workflow).
1. `node`: Node 24.21.0 and pnpm 12.6.0 version checks, `pnpm install --frozen-lockfile`, `pnpm lint` (ESLint and Prettier), `pnpm typecheck`, `pnpm test`, `pnpm build`.
2. `program`: Agave 4.2.2 and `cargo-build-sbf` 4.1.0 version checks, `cargo-build-sbf` build of `sotto_proofs`, `cargo test --locked -p sotto_proofs`.
3. `localnet`: `scripts/fetch-token-wrap.sh` (SHA-256 checked), `scripts/localnet.sh` in the background, wait for `getHealth`, `scripts/localnet-smoke.sh`, stop the validator, remove the ledger and smoke keypairs.
4. `checks`: `scripts/checks/no-dashes.py` (tracked files and the last commit message), `scripts/checks/ac-manifest.py` (required ACs for the current phase), gitleaks 8.30.1 from its release tarball (SHA-256 pinned and checked against the release checksums file) over the full history with `.gitleaks.toml`, `scripts/checks/no-zk-token-proof.sh` (invariant I-4).

The current phase for the AC manifest check has a single source: `currentPhase` in `tests/ac-manifest.json`. It is raised when a phase starts.

**After the public launch: GitHub Actions.** The same jobs run in `.github/workflows/ci.yml` on `push` and `pull_request`, with third party actions pinned by commit SHA (`VERSIONS.md`), Agave installed with the official Anza installer through `.github/actions/setup-agave`, caches for the pnpm store, the cargo registry and target, and the Agave install, and branch protection on `main` requiring all four jobs (public launch checklist in `12-MILESTONES.md`). Until then the workflow runs on `workflow_dispatch` only.

Planned additions as the code grows: SDK integration on the local validator, API tests with a test Postgres, E2E on localnet, visual tests from Phase 3, the remaining security checks (I-1 to I-10), `pnpm audit` and `cargo audit`. Each is added to both `scripts/ci-local.sh` and the workflow.
