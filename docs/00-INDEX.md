# Sotto build documentation

Read in this order. Each document states what it owns. If two documents seem to disagree: lower authority number wins. On a tie, the row listed earlier wins. Every conflict still gets an entry in `QUESTIONS.md`.

| # | File | What it owns | Authority |
|---|------|--------------|-----------|
| 1 | `ENGINEERING-RULES.md` | Rules of engagement | 1 |
| 2 | `02-VERIFIED-FACTS.md` | Ecosystem facts, with sources, and what must be re-verified | 2 |
| 3 | `03-DECISIONS.md` | Architecture decisions, defaults and blockers | 3 |
| 4 | `01-PRODUCT.md` | Scope, roles, features, acceptance criteria | 4 |
| 5 | `04-ARCHITECTURE.md` | System components, trust model, data flow | 5 |
| 6 | `06-CONFIDENTIAL-FLOWS.md` | Exact onchain sequences for every money operation | 5 |
| 7 | `05-ONCHAIN-PROGRAM.md` | The `sotto_proofs` program specification | 5 |
| 8 | `07-SELECTIVE-DISCLOSURE.md` | Viewing keys, grants, revocation, cryptography | 5 |
| 9 | `08-BACKEND.md` | API, database schema, worker, integrations | 6 |
| 10 | `09-FRONTEND.md` | App and landing implementation, screen by screen | 6 |
| 11 | `10-SECURITY.md` | Threat model, invariants, key handling | 5 |
| 12 | `11-TESTING.md` | Test strategy, environments, acceptance suite | 6 |
| 13 | `12-MILESTONES.md` | Phases, verification gates, deadlines | 6 |
| 14 | `13-COPY-CORRECTIONS.md` | Design copy that must change before launch | 6 |
| 15 | `14-ENVIRONMENTS-DEPLOY.md` | Localnet, devnet, mainnet, runbooks | 6 |
| 16 | `RESOLUTIONS-0.1.md` | Record of step 0.1 decisions (already applied to the documents above) | Record |
| 17 | `15-POST-HACKATHON.md` | The post-hackathon roadmap, built only from what the documents above record (step 2.11); it owns nothing and follows them | Record |

Files that grow during the build (append only, never rewrite history):

- `VERIFICATION-LOG.md`: output of every gate you ran, with date, cluster, command and result.
- `VERSIONS.md`: every pinned tool, crate and package version.

**Parallel sessions** (founder, 2026-10-02; ENGINEERING-RULES.md, Git workflow 5 and 6): each working session works in its own git worktree under `../sotto-worktrees/<branch>`, never switches the shared working copy's branch (it stays on `main`) or another session's worktree, and runs CI only from a worktree of the branch under test.
- `QUESTIONS.md`: open questions for the founder.

## Glossary

- **Confidential Balances**: the Token-2022 extension (formerly called Confidential Transfers) that keeps balances and transfer amounts encrypted onchain. Addresses stay public.
- **ElGamal keypair**: per-owner keypair used to encrypt balances and build proofs.
- **AES key (AeKey)**: per-owner symmetric key used to decrypt the "decryptable available balance" quickly.
- **Pending balance / available balance**: incoming confidential credits land in pending; `ApplyPendingBalance` moves them to available; only available can be spent.
- **Proof context state account**: a temporary account owned by the ZK ElGamal Proof program holding a verified proof, referenced by a later instruction, then closed.
- **Wrapped USDC (wUSDC in this repo)**: the Token-2022 mint created by the Token Wrap program for the USDC mint. It carries the Confidential Balances extension. One wUSDC always redeems for one USDC through the Token Wrap program.
- **Disclosure**: an application level record that encrypts a plaintext amount (and memo) to one viewer's public key. This is how Sotto implements scoped, revocable "viewing keys".
- **Grant**: a rule that says which viewer receives disclosures for which scope (all payments, a period, payroll only, totals only, own payslips).
- **Proof record**: an onchain account written by `sotto_proofs` after it verified that a sealed balance is at least a threshold.
- **Organization (org)**: a business using Sotto.
