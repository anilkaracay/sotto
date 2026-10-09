# 03 · Decisions

Status meanings:
- **DECIDED**: build it this way.
- **DEFAULT**: build it this way unless the founder overrides it. Proceed without waiting.
- **GATE**: the answer comes from a verification gate result, not from a person. Record the result in the verification log and in this file.
- **BLOCKER**: the founder must answer before the named phase starts. Do not build the blocked part.

---

### D-01 · Asset: wrapped USDC · DECIDED for devnet and localnet, Post-hackathon for mainnet
Gate G1 (2026-09-26) found that the Token Wrap program is not deployed at its canonical ID `TwRapQCDhWkZRrDaHfZGuHxkZ91gHDRkyuzNqeU5MgR` on mainnet or devnet, so no canonical wrapped USDC exists (facts C5). The decision is split by cluster.

**Devnet and localnet · DECIDED (founder, 2026-09-26).**
- Sotto uses its own **patched test deployment** of Token Wrap, not the canonical program: `spl-token-wrap` 1.0.0 built with one source change, the `declare_id!` line set to `EEvqpjNRQkNRwXzVziuTGGi1wYDiPv7haYVVu3XZCoQn` (facts C6, C8; build record in `VERSIONS.md`). Program `EEvqpjNRQkNRwXzVziuTGGi1wYDiPv7haYVVu3XZCoQn` on devnet, upgrade authority wallet A. Localnet loads the same `.so` at the same ID.
- Devnet wrapped USDC mint: `AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd` (Token-2022, derived under `EEvq…` from devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`).
- The Token Wrap program ID and the wrapped mint address are **per cluster configuration values, never constants**, so Sotto can switch to the canonical deployment when it exists.
- The UI must label every asset wrapped by this deployment as **"devnet test wrap"**.
- Consequences you must respect (verified on the test deployment, same as for canonical Token Wrap):
  - The mint has **no auditor** and an immutable confidential configuration (C2). Sotto cannot use a mint level auditor. Compliance and accountant access are built with application level disclosures (D-05).
  - The USDC issuer's freeze authority carries over to the wrapped mint (C3). The UI must say so in the trust page.
  - If the wrapped mint does not exist on a cluster, Sotto creates it once with the permissionless `CreateMint` (C4).
- The `declare_id!` patch changes only the program ID; the program logic is unchanged. The compliance customizer in the crate is not reachable (C7).

**Mainnet · Post-hackathon (founder, 2026-09-26).**
- The hackathon build runs on **devnet only**. No mainnet money flows and no mainnet deployment of any Sotto program during the hackathon.
- Reason: no Token-2022 USD stablecoin on mainnet allows permissionless confidential accounts today. In the G1 survey (G1 part 3, task M) `autoApproveNewAccounts` is false on PYUSD, USDG, USDP and AUSD, and canonical Token Wrap is not deployed on mainnet (facts C5).
- Candidate paths after the hackathon, in this order:
  1. Issuer approved confidential accounts on USDG or PYUSD through a partnership with Paxos. On these Paxos mints the issuer also holds the permanent delegate and the freeze authority (`2apBGMsS6ti9RyF5TwQTDswXBWskiJP2LD4cUEDqYJjk`, which is also their confidential transfer authority). How a permanent delegate interacts with confidential balances must be researched before this path.
  2. Canonical wrapped USDC once Token Wrap is officially deployed on mainnet.
  3. An audited, immutable Sotto deployment of Token Wrap on mainnet.
- Until one path is chosen: the mainnet cluster config stays unavailable, the trust page makes no mainnet asset statement, and no copy implies mainnet availability.

Rejected: forking Token Wrap to add an auditor (new program risk, splits liquidity, adds a trusted party).

### D-02 · Custody model · DECIDED
Non-custodial. Each organization's confidential wUSDC account is owned by the organization's owner wallet. Sotto has no signing authority over any token account and never receives decryption keys (ENGINEERING-RULES.md rule 4 and 5).

### D-03 · Confidential key derivation scheme · DECIDED by Gate G2 on 2026-09-27: `standard_v1`
- If all target wallets (the wallets tested in Gate G2: Phantom, Solflare, Backpack) allow a dApp to call `signMessage` on the exact bytes `solana-conf-bal/v1`, use the standard `deriveConfidentialKeys` (facts A11). Interoperable with other confidential aware wallets.
- If any target wallet refuses (facts A12), use `ConfidentialKeys.fromIkm` where IKM is the Ed25519 signature over exactly this UTF-8 message of three lines separated by newlines:
  ```
  sotto-conf-keys/v1
  This signature unlocks your Sotto confidential balances. Sign it only in the official Sotto app.
  Wallet: <ownerBase58>
  ```
  It is intentionally not bound to a domain (a domain change would lose key recovery). The residual phishing risk is accepted and documented in `10-SECURITY.md` section 2. Ed25519 signatures are deterministic, so the keys are reproducible from the wallet alone; Gate G2 checks this per wallet. If a wallet is not deterministic, it is unsupported for owners.
- The chosen scheme is stored per token account (`key_scheme` column, values `standard_v1` or `sotto_ikm_v1`). Never mix schemes on one account. Changing scheme requires a new token account and a full move of funds.
- Hardware wallets that cannot `signMessage` are not supported for owners in the MVP. Show a clear message.

**Gate G2 result (2026-09-27, the verification log, step 0.6): `standard_v1`.** Phantom, Solflare and Backpack (the tested wallets, same seed phrase) all allowed `signMessage` on the exact bytes `solana-conf-bal/v1` (R4, verified signatures, byte identical across the three wallets). By the first rule Sotto uses the standard `deriveConfidentialKeys` from `@solana-program/token-2022/confidential`. R5 was deterministic in all three wallets (identical signatures on repeat and across wallets), so the `sotto_ikm_v1` fallback was not needed; it stays defined for reference and is not used. Since Sotto is wallet agnostic (D-26), the tested wallets are examples, not a list: at runtime a wallet that refuses the standard bytes, or whose derived ElGamal key does not match the onchain key (06 section 1), cannot hold confidential balances, and the app explains why.

**Confirmed by the founder on 2026-09-27: keep `standard_v1`.** Reasons: interoperability and recoverability with standard Solana tools if Sotto disappears (to be verified in Phase 1 before the recovery guide is written: the `spl-token` CLI must derive the same ElGamal key for the same wallet; **verified 2026-09-27 in step 1.5**, both the ElGamal key and the AES key, facts A11), and compatibility with future wallet native confidential support. Accepted risk and the mitigations to build are in `10-SECURITY.md` section 2.

### D-04 · Organization signing and approvals · DECIDED
MVP: one owner wallet signs every money operation. Approvals (for example "2 of 2" on payroll) are recorded policy, not onchain enforcement, because the owner wallet can always sign directly. Sotto's API refuses to authorize, and the Sotto client refuses to execute, until the required approvers have signed an approval message (Sign-In With Solana style signed payload, stored with signature). Approval messages must include: org ID, cluster, subject type and ID, and `contents_hash` = lowercase hex SHA-256 of the canonical JSON list of `{ line_id, recipient_wallet, idempotency_key, private_blob_sha256 }`. Any change to the run after approval invalidates approvals. The UI must describe this truthfully: "Approvals are recorded in Sotto and signed by each approver. The owner wallet executes."
**Default policy (founder, 2026-09-27):** 1 approval, for payments and payroll runs (the `org_policy` defaults). The initiator's own execution counts as their approval and is recorded with the execution signature, so an owner only organization pays without an extra prompt. If the organization sets 2 or more, the other approvers must sign an approval message with the contents hash above before the payment or run is authorized. **Hackathon build (founder, 2026-09-27):** the approver screen is Post-hackathon, including the payroll run Approve action (AC-08.3). Policies above 1 cannot be set: the settings page does not offer them and the API refuses them (`PUT /orgs/:id/policy`, 422 `approval_policy_not_available`). The approval message API with the contents hash stays and is built and tested, so policies of 2 or more are exercised through the API and its tests. The payroll run page's approvals block shows only the initiator's approval.
Post-hackathon: Squads multisig as the token account owner. This requires confidential key material shared by approvers (`fromIkm` from a shared secret) and proof regeneration if the balance changes between proposal and execution. Out of scope until designed in a separate document.

### D-05 · Viewing keys are application level disclosures · DECIDED
Forced by facts A8, A11 and D-01: onchain keys are wallet wide and cannot be scoped or revoked, and the wrapped mint has no auditor. Sotto implements scoped, expiring, revocable access with per viewer encrypted disclosure records. Full design in `07-SELECTIVE-DISCLOSURE.md`. Revocation stops future disclosures and deletes stored ciphertexts; it cannot erase what a viewer already decrypted. The UI must say this.

### D-06 · Proof of funds · DECIDED
"Balance is at least X" is proven with the same cryptography Token-2022 uses for withdraw: a ciphertext commitment equality proof plus a range proof over `available_balance minus X`, verified by the ZK ElGamal Proof program into context state accounts, then checked and recorded by the Sotto program `sotto_proofs` (spec in `05-ONCHAIN-PROGRAM.md`). No new cryptography.
Result vocabulary: **Proven** or **Not proven**. A false statement cannot be proven, so "False" is never shown as a cryptographic result. The copy says so.

### D-07 · Proof of income · DEFAULT: Post-hackathon
Requires an onchain record of each payroll ciphertext so a program can sum them. Design sketch in `05-ONCHAIN-PROGRAM.md` section 8. Not in the hackathon build. The "Prove income" screen ships only when the Post-hackathon income proof ships.

### D-08 · Recipients without a wallet (email claim) · BLOCKER for Post-hackathon
MVP: every recipient connects a standard wallet and configures their confidential account through a Sotto invite link before they can be paid confidentially.
Post-hackathon email claim needs an embedded wallet provider. Founder must choose after Gate G2 style checks on: Solana support, deterministic `signMessage`, v1 transaction signing, key export, pricing. Candidates to evaluate: Privy, Dynamic, Turnkey, Para, Web3Auth.

### D-09 · Business verification (KYB) · DEFAULT for hackathon, BLOCKER for public mainnet
Hackathon and private beta: manual review by a Sotto admin in the admin console, then Sotto issues a "verified business" SAS attestation (since step 4.6 not on the devnet configuration, where D-30 verifies a new organization at once). Public mainnet: founder picks a KYB provider (for example Sumsub, Persona, Onfido) after legal review (D-23).
**Rejected organizations (founder, 2026-09-27):** in the hackathon build, rejecting an organization in review sets it to `suspended`, the same status as a revoked verification, and nothing returns a suspended organization to review (option a). A separate `rejected` status with resubmission (option b) or an admin reinstate action (option c) is decided together with the KYB provider.

### D-10 · Sanctions screening · BLOCKER for mainnet payments
Every recipient address must be screened before a payment plan is issued. Founder chooses the provider and provides credentials. Candidates: Range, Chainalysis sanctions screening, TRM Labs. Until chosen, devnet uses a local deny list file so the code path is exercised; mainnet payments are disabled by feature flag until a provider is configured.

### D-11 · Frontend stack · DEFAULT
Next.js (App Router) with TypeScript strict mode, React, CSS Modules plus a global token stylesheet that reproduces the design variables exactly. Solana client: `@solana/kit` and the `@solana-program/*` clients. Wallets through the Wallet Standard, using the official Solana Kit React bindings. At scaffold, verify the exact package names (expected `@solana/react` and `@wallet-standard/react`) and record them; if either does not exist, stop and ask. Proof generation runs in a Web Worker. Versions resolved and pinned at scaffold.

### D-12 · Backend and data · DEFAULT
Next.js route handlers for the API, PostgreSQL 16 with Drizzle ORM and SQL migrations, a separate Node worker for chain indexing and jobs. Managed Postgres: Neon (branch per environment). Founder may switch to Supabase or another Postgres host; schema is plain Postgres.

### D-13 · Hosting · DEFAULT
Web on Vercel. Worker on Fly.io. Founder may override. Proposed to be replaced by D-28 for the hackathon build (founder, 2026-10-02).

### D-14 · RPC provider · DEFAULT with GATE
Helius for devnet and mainnet, public RPC as a devnet fallback only. Gate G1 must confirm the provider serves v1 transactions (`maxSupportedTransactionVersion: 1`) and the ZK ElGamal program is active on the cluster.
**Gate result · PASSED 2026-09-26** (G1 part 1, task 1 and part 2, task 5):
- Helius devnet and Helius mainnet return `getBlock` with `maxSupportedTransactionVersion: 1` on blocks that contain v1 transactions (devnet slot 504428333, mainnet slot 450692590); `0` or an omitted parameter fails with `-32015` when full transactions are requested (facts D2). The public devnet RPC behaves the same.
- The ZK ElGamal Proof program is active on devnet and mainnet: enable, disable and re-enable gates all active, which satisfies the activation rule (facts B3, B6).
**Rule from Gate G2 (founder, 2026-09-27):** the product never depends on the public RPC. In G2 the public devnet RPC returned HTTP 429 for sends from Solflare and Backpack; through Helius all sends passed (the verification log, step 0.6). Rate limit errors (HTTP 429) are retried with exponential backoff and shown as "network busy, retrying", never as a wallet failure. The only code that ever called the public devnet RPC directly is the dev only wallet lab, which now also goes through Helius.

### D-15 · Authentication · DEFAULT
Sign-In With Solana through the Wallet Standard sign in feature when available, otherwise a signed nonce message. Session: httpOnly, secure, SameSite=Lax cookie holding an opaque session ID. No JWT in localStorage.
Implementation (step 1.3, 08 section 3): the message is the Sign-In With Solana text of `@solana/wallet-standard-util` 1.1.4, naming the host of `NEXT_PUBLIC_APP_URL`; the database stores only an HMAC of the session token. G2 R2 showed `solana:signIn` working in Phantom, Solflare and Backpack.

### D-16 · Onchain framework and upgrade authority · DECIDED by gate on 2026-09-26: native program, no Anchor
Framework: decided by a dependency check at step 0.4, before scaffolding `programs/sotto_proofs`. At step 0.2 no documentation stated that Anchor 1.2.0 (latest stable) is compatible with Agave 4.2.x: Anchor's avm map recommends Solana 4.1.2 for Anchor 1.2.0, and Anchor 1.2.0 depends on solana-* 3.x crates (see the verification log, G0 task 6).
- At step 0.4, resolve the latest stable versions of `spl-token-2022`, `solana-zk-sdk` and `spl-token-confidential-transfer-ciphertext-arithmetic` (or whatever crates G4 identifies for proof context parsing and ciphertext arithmetic) and record which major version of the solana-* crates each depends on (`cargo tree` or the crate manifests on crates.io).
- If they all depend on the same solana-* major as Anchor 1.2.0 (3.x): use Anchor 1.2.0, installed with `cargo install --git https://github.com/otter-sec/anchor --tag v1.2.0 --locked avm --force`, then `avm install 1.2.0`, `avm use 1.2.0`. Programs are built with the Agave pinned `cargo-build-sbf` 4.1.0. Record that Anchor with Agave 4.2.2 is "compatible by build and test evidence", not by documentation.
- If any of them depends on solana-* 4.x: do not use Anchor. Write `sotto_proofs` as a native program on the same solana-* major as those crates, keep the account layouts and instruction semantics from `05-ONCHAIN-PROGRAM.md` unchanged, and generate the TypeScript client with Codama from a hand written IDL. Record the reason here.
- Recheck issue otter-sec/anchor#5081 ("Bump solana/agave deps from 3.x to 4.2") at step 0.4.

**Gate result (step 0.4, 2026-09-26): the second rule applies. `sotto_proofs` is a native program; Anchor is not used and not installed.** Evidence (step 0.4 D-16 entry):
- Latest stable on crates.io: `spl-token-2022` 11.1.0, `solana-zk-sdk` 8.0.1, `spl-token-confidential-transfer-ciphertext-arithmetic` 0.5.1 (name confirmed), `anchor-lang` 1.2.0 (2.0.0-rc.1 exists, not stable).
- Direct solana-* requirements (crate manifests): `solana-zk-sdk` 8.0.1 requires `solana-signer ^4.0.0`; `spl-token-confidential-transfer-ciphertext-arithmetic` 0.5.1 requires `solana-curve25519 ^4.0.1` (also pulled by `spl-token-2022` 11.1.0 through it and `spl-token-confidential-transfer-proof-extraction` 0.6.1). The core program crates are 3.x everywhere (`solana-account-info`, `solana-program-entrypoint`, `solana-instruction`, `solana-program-error`, `solana-sysvar`), and `spl-token-2022` 11.1.0 uses `solana-address` 2.x. Anchor 1.2.0 requires 3.x core crates and `solana-pubkey ^3.0.0`.
- `cargo tree` of a scratch crate with all four: `anchor-lang` 1.2.0 resolves `solana-pubkey` 3.0.0 on `solana-address` 1.1.0, while `spl-token-2022` 11.1.0 and `solana-account-info` 3.1.1 resolve `solana-address` 2.8.0; several crates resolve at two majors (`solana-pubkey` 3 and 4, `solana-instruction` 3 and 4, `solana-address` 1 and 2, `solana-zk-elgamal-proof-interface` 0.1 and 1.0, `solana-zk-sdk` 4 and 8).
- otter-sec/anchor#5081 ("Bump solana/agave deps from 3.x to 4.2") is still open (last activity 2026-09-22); a maintainer lists "token-2022 interfaces used in public APIs changed major versions" among the breaking points.
- Feasibility: a scratch native program depending on `spl-token-2022` 11.1.0 (`no-entrypoint`) and `spl-token-confidential-transfer-ciphertext-arithmetic` 0.5.1 builds with the pinned `cargo-build-sbf` 4.1.0 (platform-tools v1.54, rustc 1.89.0).
Update from Gate G4 (step 2.2, facts K1): the program needs the interface crates that `spl-token-2022` 11.1.0 resolves (`spl-token-2022-interface` 3.1.2, `solana-zk-elgamal-proof-interface` 0.1.3, `solana-zk-sdk-pod` 0.1.2, `spl-token-confidential-transfer-ciphertext-arithmetic` 0.5.1), not `spl-token-2022` or `solana-zk-sdk` 8.0.1 themselves; programs deployed to the local validator are built as SBPF v3 (facts K8).
Consequences: `sotto_proofs` uses the same solana-* crate versions that `spl-token-2022` 11.1.0 resolves (core program crates 3.x, `solana-address` 2.x, `solana-curve25519` 4.x), keeps the account layouts and instruction semantics of `05-ONCHAIN-PROGRAM.md`, is built with `cargo-build-sbf` 4.1.0 and tested with `cargo test`, and its TypeScript client is generated with Codama from a hand written IDL (Phase 2). There is no `Anchor.toml`.

Devnet upgrade authority: deployer keypair. Mainnet upgrade authority: a Squads multisig controlled by the founders, created before the first mainnet deploy. Verifiable build published. Step 2.7: devnet deployer and upgrade authority is wallet A `7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L`, program `4rMKgJWgawaTTdUxaudUXthEExnRZ7AvFvqzsoEAr9jd` (facts N1); the Codama client is `@sotto/sdk/proofs` from the hand written IDL `scripts/proofs-idl.ts`.

### D-17 · Clusters · DECIDED
Localnet (validator with the ZK ElGamal program enabled) for automated tests, devnet as the public test environment, mainnet-beta for production after the hackathon (D-01). During the hackathon and the beta the product runs on devnet only and calls it "devnet" (founder, 2026-09-26, earlier wording "testnet" in product language is replaced). Solana's `testnet` cluster is not used because it has no USDC.

### D-18 · Repository layout · DEFAULT
pnpm workspaces and Turborepo. Layout in `04-ARCHITECTURE.md`.

### D-19 · Product name and domain · BLOCKER for public mainnet
"Sotto" is a working name. Founder confirms the final name and domain before public mainnet launch. Code uses the name only through a single config constant.

### D-20 · Design elements without defined data · DECIDED
- "Ask anything about your payments" input: removed from the MVP.
- "Privacy score": Post-hackathon (D-27, 2026-09-27); it is not shown. Before D-27 it was kept with the formula in `01-PRODUCT.md` F-18.
- Any other demo only element is replaced with real data or removed.

### D-21 · Payroll execution · DECIDED (Gate G3, step 2.2)
**Batch signing findings from Gate G2 (2026-09-27):** one `solana:signTransaction` call with three transactions returned three valid signatures for v0 in Phantom, Solflare and Backpack (R9) and for v1 in Solflare (R10); Phantom and Backpack did not declare v1 then and refused it (Backpack declares v1 since 2026-09-29, facts D5). Phantom showed one popup for the three transactions; popup counts for Solflare and Backpack were not observed, so a single prompt per batch is confirmed only for Phantom. Sotto uses one `signTransaction` call per chunk and falls back to one call per transaction if the wallet fails the batch call (D-26). Phantom adds compute budget instructions to transactions without them (G2); handling is in 06 section 9. The app sets the compute unit limit and priority fee on every transaction, so a wallet default cannot cap a proof verification; if a wallet still adds a priority fee, the cost shown to the owner comes from the confirmed transaction's fee, never from an estimate.
One confidential transfer per recipient. A run of N recipients is N transactions (v1: one transaction each; v0 fallback: several each). Proofs are generated sequentially because each transfer changes the sender's available balance. Gate G3 decides whether the client can compute the next available balance ciphertext locally so the plans of a chunk can be prepared before signing; otherwise lines are prepared and executed one at a time (`06-CONFIDENTIAL-FLOWS.md` section 7). Signing chunks are at most 10 lines: a 24 line run is 3 prompts when `signAllTransactions` works, otherwise one prompt per transaction. Copy must not claim "one transaction" and never promises a number of prompts.

**Built in step 2.3 (founder's requirements at the step 2.3 kickoff, 2026-09-29):** the lines of a chunk are built from the predicted state (facts K6, L3) and every transaction of the chunk is signed with one `solana:signTransaction` call (facts L1: `useSignTransactions`; the `@solana/react` signer refuses more than one transaction per call), one wallet prompt per chunk where the wallet batches; a wallet that fails the batch call with anything but a cancel signs one transaction at a time for the rest of the run (D-26). A chunk holds at most 10 lines and 20 transactions: 10 version 1 lines (one transaction each), 4 version 0 lines (5 transactions each, facts A17), so it lands well within its blockhash's lifetime (facts L5); a line starts only while the blockhash has blocks left for all its transactions, otherwise the chunk ends there and the remaining lines are prepared again with a new prompt. The lines are sent in order, each transaction confirmed before the next. One deviation from 06 section 9, which the batch forces: only the batch's first transaction can be simulated before the signature request, because every later one depends on transactions ahead of it that have not landed; they take the compute budget that simulation measured for the same shape of transaction earlier in the run, and every signed transaction is simulated again, with its own blockhash and signatures, right before it is sent, so nothing that would fail is sent and a failure is decoded. For version 0, whose transactions within a line depend on each other, the run's first line is sent transaction by transaction, each simulated before its own signature, and measures the shapes for the rest. The first line that fails stops the run: nothing after it is sent, its proof accounts are closed, and the run is partially settled (or not paid when no line landed) until the owner resumes it.

**Records per chunk, checked in step 2.3.1 (founder request, 2026-09-29; kept, founder 2026-09-29):** one disclosure manifest per run instead of one per chunk was checked against I-9 and the disclosure tests and not made: a stopped run would leave every settled line without the owner's record, the recipient's payslip and the grants' records until it ends or resumes, where one per chunk leaves at most one chunk, and a manifest holds at most 500 items, which a large run with grants exceeds anyway. The prompts it would save, for a 24 line run: 6 against 4 with a version 1 wallet, 17 against 12 with a version 0 wallet (07 section 4).

### D-22 · Pricing · DEFAULT
No fees in the MVP. No fee logic in code.

### D-23 · Legal · BLOCKER for public mainnet
Terms of service, privacy policy and a regulatory review (Turkey and target markets) before public mainnet onboarding. Private beta on mainnet with invited design partners is allowed only with written founder approval recorded in writing.

### D-24 · SAS client and a second `@solana/kit` version · DECIDED (founder, 2026-09-26)
- `sas-lib` 1.0.10 is used only inside `apps/worker`, which issues and reads attestations (08). It depends on `@solana/kit ^5.0.0`, so the worker carries a second `@solana/kit` version (5.x next to 8.3.0) until `sas-lib` targets kit 8. Types are converted at the boundary; G5 tests the conversion.
- `apps/web` and `packages/sdk` never import `sas-lib`; they read attestation data through the Sotto API. An ESLint `no-restricted-imports` rule enforces this everywhere outside `apps/worker`.
- Revisit when a `sas-lib` release on `@solana/kit` 8 exists (2.0.0-beta.1 peers kit 7).

### D-25 · Local CI until public launch · DECIDED (founder, 2026-09-27)
- The repository `anilkaracay/sotto` stays private until the end of the project. The founder makes it public after the public launch checklist (Phase 4).
- Reason: on the private repository GitHub Actions jobs do not start ("recent account payments have failed or your spending limit needs to be increased") and branch protection requires GitHub Pro or a public repository (HTTP 403). See the verification log, step 0.5.
- Until then CI runs locally with `pnpm ci:local` (`scripts/ci-local.sh`), the same four jobs as `.github/workflows/ci.yml`; the workflow runs on `workflow_dispatch` only. Merge rules are in ENGINEERING-RULES.md (Git workflow).
- At the public launch: restore the `push` and `pull_request` triggers, apply branch protection, and record the first green GitHub Actions run.
- 2026-10-09 (founder): the repository is public. The first run of the workflow on GitHub, started by hand, passed all four jobs (run 37894128813, commit `5d3876d`). A push to `main` now runs lint, typecheck, the unit tests and the checks job; the build, the browser tests, the program job and the localnet job stay manual. A merge still needs `pnpm ci:local:full`.
- 2026-10-09 (founder), later the same day: a pull request runs the same lightweight jobs, and `main` has branch protection: the `node` and `checks` jobs must pass, no force pushes, no deletions. Administrators are not held to the required jobs, so a merge made on the development machine after `pnpm ci:local:full` can still be pushed.

### D-26 · Wallets: capability requirements per role, wallet agnostic · DECIDED (founder, 2026-09-27)
Sotto is wallet agnostic. Any wallet that implements the Wallet Standard for Solana must appear and work. There is no whitelist: the app detects capabilities at runtime from the wallet's declared features.
- **Every user:** `standard:connect` and `solana:signTransaction`, plus at least one `solana:` chain. Wallets without them are not offered for connection.
- **Organization owners and anyone who holds confidential balances:** additionally `solana:signMessage` with deterministic signatures, because the confidential keys are derived from it (D-03, `standard_v1`). Wallets without it can sign in and receive public payments; the app explains why they cannot hold confidential balances.
- **Transaction path per wallet:** read `supportedTransactionVersions` from `solana:signTransaction`. If it includes `1`, use v1 single transaction plans; otherwise use v0 multi transaction plans (06 section 5). Never send a version the wallet does not declare (G2: Phantom fails to parse v1 with "Reached end of buffer unexpectedly"; Backpack refused with `UnsupportedTransactionVersionError` while it declared only legacy and 0; it declared 1 from 2026-09-29, facts D5).
- **Batch signing:** one `signTransaction` call with several transactions; if the wallet does not support it, fall back to one call per transaction.
- **Wallet specific behavior** (for example, modifying the transaction message before signing) is handled by capability checks and by comparing the signed message with the built one, never by wallet name, unless no check can detect it. Such an exception is documented here with evidence. None exists today.
- The wallets tested in Gate G2 (Phantom, Solflare, Backpack) are verified examples, not a supported list (the verification log, step 0.6).
- **Evidence from step 2.1 (founder 2026-09-29; facts D5):** capabilities change between wallet versions: Backpack declared `["legacy", 0]` in Gate G2 and `["legacy", 0, 1]` two days later, so Sotto now sends it version 1 on devnet with no change of code, which is why the path is read at runtime. A wallet's own pre-sign security check is not a declared capability: Backpack's closed scan blocked Sotto's confidential account setup ("Unable to verify this transaction. It cannot be signed.", no approve option) while it signed a lone ZK proof verification and devnet only token transfers, and the exact rule is unknown. No check can detect such a block before the wallet is asked, and no name based rule is added: when any wallet refuses a transaction, Sotto shows the wallet's own words after its explanation, and for the account setup the neutral message "Your wallet did not sign this confidential account setup. If your wallet mentions a security check, try another Solana wallet or contact your wallet's support.". The exception list above stays empty.

### D-27 · Hackathon scope · DECIDED (founder, 2026-09-27)
- **Kept in the hackathon build:** F-01 to F-09; F-10 grants and back fill (scopes `all_payments`, `period`, `payroll_only`, `own_payslips`); F-11 accountant books with the ledger and CSV export (AC-11.1 to AC-11.4, with reconciliation status only, no notes); F-12 my pay; F-13 proof of funds and the public verify page; F-14 access log; F-15 privacy screen; F-17 landing; F-19 proof program health.
- **Moved to Post-hackathon:** F-16 command palette; F-18 privacy score (removed from the overview mapping; supersedes D-20); AC-11.5 close checklist and the Close and export page `/app/[org]/close` (the CSV export stays inside Books); the board viewer role and route `/app/[org]/board` and the `totals_only` scope with its `month_total` items; reconciliation notes (the `reconciliation_notes` table is not built now); M5, the approver screen, including the payroll run Approve action of AC-08.3 (founder 2026-09-27: approval policies above 1 cannot be set in the hackathon build, D-04).
- **Critical demo path**, which must work end to end on devnet by Phase 4: owner onboarding and verification, fund, confidential payroll batch, accountant reads through a grant, recipient sees the payslip, proof of funds with the public verify page, and the landing. It is the hackathon acceptance scenario of the build plan, and Phase 2 is planned around it.
- Nothing Post-hackathon is shown in the landing or the app (ENGINEERING-RULES.md rule 6).
- **Balance snapshots are the owner's only** (founder, 2026-09-30, step 2.12): grant holders do not receive `balance_snapshot` items in the hackathon build, whatever their scope; sharing them with `all_payments` and `period` grants (07 section 6) is Post-hackathon.

### D-28 · Hosting on the founder's own server · DECIDED (founder, 2026-10-02; built in step 4.2)
- Replaces the D-13 default for the hackathon build: the devnet web app, worker and PostgreSQL 16 run as one isolated Docker Compose project (`sotto`) on a server the founder operates, at https://sottoapp.xyz (the app under `/app`, one origin).
- Sotto runs isolated on it: its own system user, folder, Compose project, network and volumes, and no published host port.
- Secrets on the server are limited to `RPC_URL`, `SESSION_SECRET`, `DATABASE_URL`, `ADMIN_WALLETS` and the devnet SAS signer, plus what the server needs to be reached and monitored; wallet A never goes there.
- Backups (founder, 2026-10-02): daily, encrypted with a key that never reaches the server.
- Deploys run from the founder's machine with a health check and a rollback (D-25).

### D-29 · devUSD, a devnet test dollar beside USDC · DECIDED (founder, 2026-10-02; built in step 4.3)
- Replaces the first seed design: demo amounts use **devUSD**, "Sotto Devnet Test Dollar", a classic SPL Token mint of 6 decimals that Sotto issues on devnet, wrapped one to one through the same Sotto Token Wrap test deployment as USDC (D-01). It has no value; its mint authority is a new keypair kept only on the hosting server (never in the repository, never in a browser), and it has no freeze authority.
- **Asset registry** (`packages/sdk/src/cluster/assets.ts`): per asset the symbol, the display name, the decimals, the base mint and its token program, the wrapped mint, a devnet test asset flag and the asset's own `sotto_proofs` deployment. Devnet lists USDC and, once its mints and deployment exist, devUSD; a local ledger's bootstrap makes both (`scripts/bootstrap-localnet.ts`). Mainnet has no registry during the beta (D-01).
- **One asset per organization**, chosen at account setup (`POST /api/orgs` `asset`, the onboarding form's Currency where the network has more than one), USDC by default; the server takes only an asset of its network's registry. Changing it later is out of scope: no request can.
- **Words**: every amount (pages, the payslip PDF, the CSV export, disclosures, proof statements, `/v/`) shows the organization's own symbol, and nothing holding devUSD says USDC. A devUSD proof statement reads "Balance is at least 250,000 devUSD"; USDC keeps its dollar words. Wherever devUSD appears, a "Devnet test dollar" badge says "A test token for trying Sotto on devnet. It has no value."
- **Faucet**: devnet only (the configured cluster is devnet and the RPC serves devnet's genesis hash; any other ledger is refused, by the web and by the worker), for the owner of an active devUSD organization, at most 10,000 devUSD per wallet per 24 hours, 6 requests per session an hour, logged. The web queues a request; the worker, which alone holds the mint authority (`DEVUSD_MINT_AUTHORITY_KEYPAIR`), mints it, storing each signature before it sends so a restart never mints twice.
- **sotto_proofs**: its config holds one wrapped mint (`Config.wrapped_usdc_mint`; verify check 4 refuses another mint), so devUSD gets a second deployment of the same build under its own program ID and config; no program change. Each asset's records are read with their own deployment, and a record's page names its asset.
- **Secrets on the server** (D-28) gain the devUSD mint authority keypair, approved with this decision.
- **Additions (founder, 2026-10-03):** the badge is not in the top bar: it sits next to balances and amounts (the balance cards, payments, payroll, payslips, Books, proofs, `/v/`). devUSD gets no Metaplex metadata during the hackathon: Sotto's own label and badge name it. The demo seed's accountant grant covers October 2026, the month the payments settle (nothing is backdated); its twelfth paid person is Selin Demir. For the video, Elif's demo key is imported into Phantom in a separate Chrome profile; a personal wallet is never used.

### D-30 · Devnet: a new organization is verified at once, with no review · DECIDED (founder, 2026-10-09; built in step 4.6)
- On the devnet configuration (`NEXT_PUBLIC_CLUSTER` devnet, which is also what an unset value means) `POST /api/orgs` creates the organization `active`, with `reviewed_at` the moment of its creation and no `reviewed_by`, so money features are on at once and anyone can try Sotto with test money. Every other configuration keeps the review of D-09 through the same code (`verificationOnCreate` in `apps/web/lib/org.ts`, `createOrg`); each path has its tests.
- The worker's `sas-issue` job issues the attestation as it does after an approval. Its `level` says how the organization was verified: 1 after a Sotto admin's decision (the decision carries the admin's wallet), 0 for an organization no admin decided on (`attestationLevel`). Level 0 means "verified automatically on devnet, with no review".
- True copy: the onboarding form and status of such an organization say "verified automatically on devnet, without a review" and name no admin; the public proof page adds "Entered by the organization on devnet. Sotto did not review it." under the name of an organization whose attestation has level 0. An organization a Sotto admin approved keeps the review's words and level 1.
- The details that go into the attestation (legal name, country, registration number, website) are locked from creation, as they are after a review. An admin can still suspend the organization (AC-02.4), which closes its attestation.
- `review-notify` announces nothing for it, as it never is in review.

### D-31 · Devnet SOL from the faucet · DECIDED (founder, 2026-10-09; built in step 4.6)
- A new devnet wallet has no SOL for network fees and account rent, so the faucet gives it some: nobody needs an outside faucet to try Sotto. Devnet only, by the same two checks as devUSD (the configured cluster is devnet and the RPC serves devnet's genesis hash; the web and the worker both refuse any other ledger).
- **Limits** (constants in `apps/web/lib/server/sol-faucet.ts`): one grant of 0.05 SOL per wallet per 24 hours; only while the wallet holds less than 0.02 SOL; 1 SOL for all wallets together per 24 hours (20 grants), after which the card points to https://faucet.solana.com; 3 requests per address (IP) per 24 hours and the devUSD faucet's 6 per session an hour. A failed grant counts toward no limit. 0.05 SOL is what the project's devnet runs give an owner for the account, its funding, payments and a proof (0.05 to 0.08 SOL); an invited person's account needs about 0.006 SOL.
- **Who**: any signed in wallet, as an owner needs it before the account exists and an invited person before theirs. The wallet is the session's and the amount is fixed; the request has no body.
- **Paying wallet**: a new key of its own on the hosting server (`SOL_FAUCET_KEYPAIR`, a keypair file like the others), which does nothing but pay these grants; the devUSD mint authority stays separate. The founder funds it with 2 devnet SOL from wallet A when it ships (step 4.7), and that transfer is recorded with the deploy. The worker's `sol-faucet` job never takes it below a reserve of 0.1 SOL: a grant it cannot afford above that fails and is logged for the operator (`sol_faucet_low`).
- **Secrets on the server** (D-28) gain the SOL faucet's keypair, approved with this decision.
- The lamports are Sotto's own and a grant is a plain transfer, public onchain; nothing of a customer is stored (`sol_grants`: the wallet, the lamports, the transfer's signature and state).
