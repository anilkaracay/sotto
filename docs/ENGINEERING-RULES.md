# Engineering rules

The rules for everyone who changes this repository. Sotto is a confidential business account on Solana: companies pay payroll, suppliers and payouts in USDC, amounts are encrypted onchain with Token-2022 Confidential Balances, and the company decides who can read which numbers.

Read this file first, then `00-INDEX.md` and the documents in its reading order. Code comments and documents cite these rules by number ("rule 4") or by section name ("Git workflow").

## Non-negotiable rules

1. **No assumptions.** If a fact, API name, program ID, crate path, package export or wallet behavior is not written in `02-VERIFIED-FACTS.md` or confirmed by a verification gate you ran yourself, verify it first (run the command, read the source on docs.rs or GitHub, or write a failing test). Never invent a function name. If you cannot verify, stop and ask.
2. **Verification gates come first.** A phase does not start until every gate planned for it has passed and its output is recorded in the project's verification log. A phase's gates are its first tasks. Work that depends on a gate waits for that gate. Work that does not depend on it may proceed.
3. **Open decisions block work.** Anything marked `BLOCKER` in `03-DECISIONS.md` must be answered by the founder before the part it blocks is built. Anything marked `DEFAULT` may proceed.
4. **Sotto never holds user funds or user decryption keys.** No server, database, log, analytics event or error report may ever contain an ElGamal secret key, an AES key, a viewing secret key, a wallet secret, or a plaintext amount belonging to a customer. Plaintext amounts exist only in the browser of an authorized person. Exception: amounts that are already public onchain may be stored: confidential deposit and withdraw amounts, and proof thresholds. This rule overrides convenience.
5. **The Sotto onchain program never moves tokens.** It verifies proofs and writes records. It never has authority over any token account, never CPIs into a token transfer, and never custodies anything. All token movements are Token-2022 and Token Wrap instructions signed by the user's wallet.
6. **Every claim in the UI must be true.** If a number is shown, it comes from real data. If a feature is not built, it is not shown. Design copy that is not true is corrected before it ships.
7. **Writing style for all output** (UI copy, docs, code comments, commit messages, PR descriptions): never use the em dash or en dash characters. Use a colon, a comma, a middle dot or a new sentence. Hyphens inside names such as `token-2022` are fine.
8. **Tests are part of the work.** A feature is done only when its acceptance criteria in `01-PRODUCT.md` pass as automated tests (see `11-TESTING.md`).
9. **Pin everything.** Exact versions in `package.json`, `Cargo.toml` and toolchain files. Every resolved version is recorded in `VERSIONS.md` when it is chosen.
10. **Small, reviewable steps.** One logical change per commit. Conventional commit messages. Run lint, typecheck and tests before every commit.

## Design source of truth

- The approved designs of the marketing site and of the product UI are the source of truth for layout, spacing, typography, color and motion. They are rebuilt as real components, never pasted.
- Where a design shows demo data, it is replaced with real data or the element is removed, as specified in `09-FRONTEND.md`.

## Working loop

1. Read the relevant doc section.
2. Run the gates for that phase and record them.
3. Write the test first when practical.
4. Implement.
5. Run `pnpm lint && pnpm typecheck && pnpm test` and, for program changes, the native program build and tests (`cargo-build-sbf` and `cargo test` in `programs/sotto_proofs`, exact commands recorded in `VERSIONS.md`; D-16: no Anchor).
6. Update docs if behavior changed. Docs and code must never disagree.

## Git workflow

CI runs locally (D-25).

1. Every step works on a branch named `step/<id>` (for example `step/1.1`), created from `main`.
2. Before merging, `pnpm ci:local:full` (every job from scratch, Turborepo `--force`) must be green on the branch, and its summary table goes into the step's report. `pnpm ci:local` (cached) is for daily use and does not count for a merge.
3. Merge into `main` with `git merge --no-ff step/<id>`, then push `main` and the branch.
4. No force pushes to `main`, ever.
5. Parallel work: every working session uses its own git worktree (`git worktree add ../sotto-worktrees/<branch> <branch>`), and never switches the branch of the shared working copy, which stays on `main`, or of another session's worktree. Merges into `main` are made in a worktree of `main` when no other worktree has it checked out.
6. CI runs only from a worktree of the branch under test, so another session cannot change the files under a running CI. Its log goes to the shared copy's `.localnet/ci/`, where a deploy looks for the passing run of the commit it deploys.
7. Never run two test suites on one machine at the same time: one CI run, localnet session or test command at a time, each finished before the next starts. A second suite running beside a localnet run made a payment step fail in step 4.2.2.

## Local configuration and secrets

1. Configuration comes from files, never from the shell. Every app, worker and script reads `RPC_URL` and its other settings from its own git ignored `.env.local` file: Next.js env loading for `apps/web`, the package's env loader for `apps/worker`, `dotenv` for scripts. The variables of the shell that starts a command are not a source of configuration.
2. Secret values are never echoed, printed, logged or committed; checks report only yes or no.

## When you are unsure

Stop and ask the founder, with: what you need to know, why it matters, what you checked, and the options. Do not guess.
