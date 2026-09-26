# 03 · Decisions

Status meanings:
- **DECIDED**: build it this way.
- **DEFAULT**: build it this way unless the founder overrides it. Proceed without waiting.
- **GATE**: the answer comes from a verification gate result, not from a person. Record the result in `VERIFICATION-LOG.md` and in this file.
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

**Mainnet · Post-hackathon (founder, 2026-09-26, Q-04).**
- The hackathon build runs on **devnet only**. No mainnet money flows and no mainnet deployment of any Sotto program during the hackathon.
- Reason: no Token-2022 USD stablecoin on mainnet allows permissionless confidential accounts today. In the G1 survey (`VERIFICATION-LOG.md`, G1 part 3, task M) `autoApproveNewAccounts` is false on PYUSD, USDG, USDP and AUSD, and canonical Token Wrap is not deployed on mainnet (facts C5).
- Candidate paths after the hackathon, in this order:
  1. Issuer approved confidential accounts on USDG or PYUSD through a partnership with Paxos. On these Paxos mints the issuer also holds the permanent delegate and the freeze authority (`2apBGMsS6ti9RyF5TwQTDswXBWskiJP2LD4cUEDqYJjk`, which is also their confidential transfer authority). How a permanent delegate interacts with confidential balances must be researched before this path (`QUESTIONS.md` Q-05).
  2. Canonical wrapped USDC once Token Wrap is officially deployed on mainnet.
  3. An audited, immutable Sotto deployment of Token Wrap on mainnet.
- Until one path is chosen: the mainnet cluster config stays unavailable, the trust page makes no mainnet asset statement, and no copy implies mainnet availability (`13-COPY-CORRECTIONS.md`).

Rejected: forking Token Wrap to add an auditor (new program risk, splits liquidity, adds a trusted party).

### D-02 · Custody model · DECIDED
Non-custodial. Each organization's confidential wUSDC account is owned by the organization's owner wallet. Sotto has no signing authority over any token account and never receives decryption keys (ENGINEERING-RULES.md rule 4 and 5).

### D-03 · Confidential key derivation scheme · GATE (G2)
- If all target wallets (Phantom, Solflare, Backpack; list in `14-ENVIRONMENTS-DEPLOY.md`) allow a dApp to call `signMessage` on the exact bytes `solana-conf-bal/v1`, use the standard `deriveConfidentialKeys` (facts A11). Interoperable with other confidential aware wallets.
- If any target wallet refuses (facts A12), use `ConfidentialKeys.fromIkm` where IKM is the Ed25519 signature over exactly this UTF-8 message of three lines separated by newlines:
  ```
  sotto-conf-keys/v1
  This signature unlocks your Sotto confidential balances. Sign it only in the official Sotto app.
  Wallet: <ownerBase58>
  ```
  It is intentionally not bound to a domain (a domain change would lose key recovery). The residual phishing risk is accepted and documented in `10-SECURITY.md` section 2. Ed25519 signatures are deterministic, so the keys are reproducible from the wallet alone; Gate G2 checks this per wallet. If a wallet is not deterministic, it is unsupported for owners.
- The chosen scheme is stored per token account (`key_scheme` column, values `standard_v1` or `sotto_ikm_v1`). Never mix schemes on one account. Changing scheme requires a new token account and a full move of funds.
- Hardware wallets that cannot `signMessage` are not supported for owners in the MVP. Show a clear message.

### D-04 · Organization signing and approvals · DECIDED
MVP: one owner wallet signs every money operation. Approvals (for example "2 of 2" on payroll) are recorded policy, not onchain enforcement, because the owner wallet can always sign directly. Sotto's API refuses to authorize, and the Sotto client refuses to execute, until the required approvers have signed an approval message (Sign-In With Solana style signed payload, stored with signature). Approval messages must include: org ID, cluster, subject type and ID, and `contents_hash` = lowercase hex SHA-256 of the canonical JSON list of `{ line_id, recipient_wallet, idempotency_key, private_blob_sha256 }`. Any change to the run after approval invalidates approvals. The UI must describe this truthfully: "Approvals are recorded in Sotto and signed by each approver. The owner wallet executes."
Post-hackathon: Squads multisig as the token account owner. This requires confidential key material shared by approvers (`fromIkm` from a shared secret) and proof regeneration if the balance changes between proposal and execution. Out of scope until designed in a separate document.

### D-05 · Viewing keys are application level disclosures · DECIDED
Forced by facts A8, A11 and D-01: onchain keys are wallet wide and cannot be scoped or revoked, and the wrapped mint has no auditor. Sotto implements scoped, expiring, revocable access with per viewer encrypted disclosure records. Full design in `07-SELECTIVE-DISCLOSURE.md`. Revocation stops future disclosures and deletes stored ciphertexts; it cannot erase what a viewer already decrypted. The UI must say this.

### D-06 · Proof of funds · DECIDED
"Balance is at least X" is proven with the same cryptography Token-2022 uses for withdraw: a ciphertext commitment equality proof plus a range proof over `available_balance minus X`, verified by the ZK ElGamal Proof program into context state accounts, then checked and recorded by the Sotto program `sotto_proofs` (spec in `05-ONCHAIN-PROGRAM.md`). No new cryptography.
Result vocabulary: **Proven** or **Not proven**. A false statement cannot be proven, so "False" is never shown as a cryptographic result. Copy change in `13-COPY-CORRECTIONS.md`.

### D-07 · Proof of income · DEFAULT: Post-hackathon
Requires an onchain record of each payroll ciphertext so a program can sum them. Design sketch in `05-ONCHAIN-PROGRAM.md` section 8. Not in the hackathon build. The "Prove income" screen ships only when the Post-hackathon income proof ships.

### D-08 · Recipients without a wallet (email claim) · BLOCKER for Post-hackathon
MVP: every recipient connects a standard wallet and configures their confidential account through a Sotto invite link before they can be paid confidentially.
Post-hackathon email claim needs an embedded wallet provider. Founder must choose after Gate G2 style checks on: Solana support, deterministic `signMessage`, v1 transaction signing, key export, pricing. Candidates to evaluate: Privy, Dynamic, Turnkey, Para, Web3Auth.

### D-09 · Business verification (KYB) · DEFAULT for hackathon, BLOCKER for public mainnet
Hackathon and private beta: manual review by a Sotto admin in the admin console, then Sotto issues a "verified business" SAS attestation. Public mainnet: founder picks a KYB provider (for example Sumsub, Persona, Onfido) after legal review (D-23).

### D-10 · Sanctions screening · BLOCKER for mainnet payments
Every recipient address must be screened before a payment plan is issued. Founder chooses the provider and provides credentials. Candidates: Range, Chainalysis sanctions screening, TRM Labs. Until chosen, devnet uses a local deny list file so the code path is exercised; mainnet payments are disabled by feature flag until a provider is configured.

### D-11 · Frontend stack · DEFAULT
Next.js (App Router) with TypeScript strict mode, React, CSS Modules plus a global token stylesheet that reproduces the design variables exactly. Solana client: `@solana/kit` and the `@solana-program/*` clients. Wallets through the Wallet Standard, using the official Solana Kit React bindings. At scaffold, verify the exact package names (expected `@solana/react` and `@wallet-standard/react`) and record them; if either does not exist, stop and ask. Proof generation runs in a Web Worker. Versions resolved and pinned at scaffold.

### D-12 · Backend and data · DEFAULT
Next.js route handlers for the API, PostgreSQL 16 with Drizzle ORM and SQL migrations, a separate Node worker for chain indexing and jobs. Managed Postgres: Neon (branch per environment). Founder may switch to Supabase or another Postgres host; schema is plain Postgres.

### D-13 · Hosting · DEFAULT
Web on Vercel. Worker on Fly.io. Founder may override.

### D-14 · RPC provider · DEFAULT with GATE
Helius for devnet and mainnet, public RPC as a devnet fallback only. Gate G1 must confirm the provider serves v1 transactions (`maxSupportedTransactionVersion: 1`) and the ZK ElGamal program is active on the cluster.
**Gate result · PASSED 2026-09-26** (`VERIFICATION-LOG.md`, G1 part 1, task 1 and part 2, task 5):
- Helius devnet and Helius mainnet return `getBlock` with `maxSupportedTransactionVersion: 1` on blocks that contain v1 transactions (devnet slot 504428333, mainnet slot 450692590); `0` or an omitted parameter fails with `-32015` when full transactions are requested (facts D2). The public devnet RPC behaves the same.
- The ZK ElGamal Proof program is active on devnet and mainnet: enable, disable and re-enable gates all active, which satisfies the activation rule (facts B3, B6).

### D-15 · Authentication · DEFAULT
Sign-In With Solana through the Wallet Standard sign in feature when available, otherwise a signed nonce message. Session: httpOnly, secure, SameSite=Lax cookie holding an opaque session ID. No JWT in localStorage.

### D-16 · Onchain framework and upgrade authority · DECIDED by gate on 2026-09-26: native program, no Anchor
Framework: decided by a dependency check at step 0.4, before scaffolding `programs/sotto_proofs`. At step 0.2 no documentation stated that Anchor 1.2.0 (latest stable) is compatible with Agave 4.2.x: Anchor's avm map recommends Solana 4.1.2 for Anchor 1.2.0, and Anchor 1.2.0 depends on solana-* 3.x crates (see `VERIFICATION-LOG.md`, G0 task 6).
- At step 0.4, resolve the latest stable versions of `spl-token-2022`, `solana-zk-sdk` and `spl-token-confidential-transfer-ciphertext-arithmetic` (or whatever crates G4 identifies for proof context parsing and ciphertext arithmetic) and record which major version of the solana-* crates each depends on (`cargo tree` or the crate manifests on crates.io).
- If they all depend on the same solana-* major as Anchor 1.2.0 (3.x): use Anchor 1.2.0, installed with `cargo install --git https://github.com/otter-sec/anchor --tag v1.2.0 --locked avm --force`, then `avm install 1.2.0`, `avm use 1.2.0`. Programs are built with the Agave pinned `cargo-build-sbf` 4.1.0. Record that Anchor with Agave 4.2.2 is "compatible by build and test evidence", not by documentation.
- If any of them depends on solana-* 4.x: do not use Anchor. Write `sotto_proofs` as a native program on the same solana-* major as those crates, keep the account layouts and instruction semantics from `05-ONCHAIN-PROGRAM.md` unchanged, and generate the TypeScript client with Codama from a hand written IDL. Record the reason here.
- Recheck issue otter-sec/anchor#5081 ("Bump solana/agave deps from 3.x to 4.2") at step 0.4.

**Gate result (step 0.4, 2026-09-26): the second rule applies. `sotto_proofs` is a native program; Anchor is not used and not installed.** Evidence (`VERIFICATION-LOG.md`, step 0.4 D-16 entry):
- Latest stable on crates.io: `spl-token-2022` 11.1.0, `solana-zk-sdk` 8.0.1, `spl-token-confidential-transfer-ciphertext-arithmetic` 0.5.1 (name confirmed), `anchor-lang` 1.2.0 (2.0.0-rc.1 exists, not stable).
- Direct solana-* requirements (crate manifests): `solana-zk-sdk` 8.0.1 requires `solana-signer ^4.0.0`; `spl-token-confidential-transfer-ciphertext-arithmetic` 0.5.1 requires `solana-curve25519 ^4.0.1` (also pulled by `spl-token-2022` 11.1.0 through it and `spl-token-confidential-transfer-proof-extraction` 0.6.1). The core program crates are 3.x everywhere (`solana-account-info`, `solana-program-entrypoint`, `solana-instruction`, `solana-program-error`, `solana-sysvar`), and `spl-token-2022` 11.1.0 uses `solana-address` 2.x. Anchor 1.2.0 requires 3.x core crates and `solana-pubkey ^3.0.0`.
- `cargo tree` of a scratch crate with all four: `anchor-lang` 1.2.0 resolves `solana-pubkey` 3.0.0 on `solana-address` 1.1.0, while `spl-token-2022` 11.1.0 and `solana-account-info` 3.1.1 resolve `solana-address` 2.8.0; several crates resolve at two majors (`solana-pubkey` 3 and 4, `solana-instruction` 3 and 4, `solana-address` 1 and 2, `solana-zk-elgamal-proof-interface` 0.1 and 1.0, `solana-zk-sdk` 4 and 8).
- otter-sec/anchor#5081 ("Bump solana/agave deps from 3.x to 4.2") is still open (last activity 2026-09-22); a maintainer lists "token-2022 interfaces used in public APIs changed major versions" among the breaking points.
- Feasibility: a scratch native program depending on `spl-token-2022` 11.1.0 (`no-entrypoint`) and `spl-token-confidential-transfer-ciphertext-arithmetic` 0.5.1 builds with the pinned `cargo-build-sbf` 4.1.0 (platform-tools v1.54, rustc 1.89.0).
Consequences: `sotto_proofs` uses the same solana-* crate versions that `spl-token-2022` 11.1.0 resolves (core program crates 3.x, `solana-address` 2.x, `solana-curve25519` 4.x), keeps the account layouts and instruction semantics of `05-ONCHAIN-PROGRAM.md`, is built with `cargo-build-sbf` 4.1.0 and tested with `cargo test`, and its TypeScript client is generated with Codama from a hand written IDL (Phase 2). There is no `Anchor.toml`.

Devnet upgrade authority: deployer keypair. Mainnet upgrade authority: a Squads multisig controlled by the founders, created before the first mainnet deploy. Verifiable build published.

### D-17 · Clusters · DECIDED
Localnet (validator with the ZK ElGamal program enabled) for automated tests, devnet as the public test environment, mainnet-beta for production after the hackathon (D-01). During the hackathon and the beta the product runs on devnet only and calls it "devnet" (founder, 2026-09-26, Q-04; earlier wording "testnet" in product language is replaced). Solana's `testnet` cluster is not used because it has no USDC.

### D-18 · Repository layout · DEFAULT
pnpm workspaces and Turborepo. Layout in `04-ARCHITECTURE.md`.

### D-19 · Product name and domain · BLOCKER for public mainnet
"Sotto" is a working name. Founder confirms the final name and domain before public mainnet launch. Code uses the name only through a single config constant.

### D-20 · Design elements without defined data · DECIDED
- "Ask anything about your payments" input: removed from the MVP.
- "Privacy score": kept, with the formula defined in `01-PRODUCT.md` F-18. If the founder prefers, remove it; do not show an undefined number.
- Any other demo only element is listed in `13-COPY-CORRECTIONS.md` with its fate.

### D-21 · Payroll execution · GATE (G3)
One confidential transfer per recipient. A run of N recipients is N transactions (v1: one transaction each; v0 fallback: several each). Proofs are generated sequentially because each transfer changes the sender's available balance. Gate G3 decides whether the client can compute the next available balance ciphertext locally so the plans of a chunk can be prepared before signing; otherwise lines are prepared and executed one at a time (`06-CONFIDENTIAL-FLOWS.md` section 7). Signing chunks are at most 10 lines: a 24 line run is 3 prompts when `signAllTransactions` works, otherwise one prompt per transaction. Copy must not claim "one transaction" and never promises a number of prompts.

### D-22 · Pricing · DEFAULT
No fees in the MVP. No fee logic in code.

### D-23 · Legal · BLOCKER for public mainnet
Terms of service, privacy policy and a regulatory review (Turkey and target markets) before public mainnet onboarding. Private beta on mainnet with invited design partners is allowed only with written founder approval recorded in `QUESTIONS.md`.
