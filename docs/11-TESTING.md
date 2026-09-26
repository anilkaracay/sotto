# 11 · Testing

## 1. Layers

| Layer | Tool | Runs against | Required for merge |
|-------|------|--------------|--------------------|
| Unit (TS) | Vitest | Pure functions: canonical JSON, scope evaluation, CSV parsing, amount math with `bigint` | Yes |
| Unit (Rust) | `cargo test` | `sotto_proofs` helpers | Yes |
| Program | Anchor tests or LiteSVM, plus Rust `solana-program-test` if needed | Localnet program with real proofs | Yes |
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

## 5. Devnet release checklist

Run the full E2E suite on devnet with fresh wallets. Record run ID, commit, and results in `VERIFICATION-LOG.md`.

## 6. Visual regression tolerance

Pixel diff at most 0.5 percent per screen after masking dynamic regions (times, addresses, animated elements). Update baselines only with founder approval.

## 7. CI (GitHub Actions)

Jobs: install with frozen lockfile, lint, typecheck, unit, program build and test, SDK integration on local validator, API tests, E2E localnet, visual, security checks, `pnpm audit`, `cargo audit`. Cache toolchains. Block merge on any failure.
