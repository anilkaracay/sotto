# 03 · Decisions

Status meanings:
- **DECIDED**: build it this way.
- **DEFAULT**: build it this way unless the founder overrides it. Proceed without waiting.
- **GATE**: the answer comes from a verification gate result, not from a person. Record the result in `VERIFICATION-LOG.md` and in this file.
- **BLOCKER**: the founder must answer before the named phase starts. Do not build the blocked part.

---

### D-01 · Asset: canonical wrapped USDC · DECIDED
Use the Token Wrap program's canonical Token-2022 wrapped mint for USDC (facts C1 to C5). Consequences you must respect:
- The mint has **no auditor** and an immutable confidential configuration (C2). Sotto cannot use a mint level auditor. Compliance and accountant access are built with application level disclosures (D-05).
- The USDC issuer's freeze authority carries over to the wrapped mint (C3). The UI must say so in the trust page.
- If the wrapped mint does not exist on a cluster, Sotto creates it once with the permissionless `CreateMint` (C4).
Rejected: forking Token Wrap to add an auditor (new program risk, splits liquidity, adds a trusted party).

### D-02 · Custody model · DECIDED
Non-custodial. Each organization's confidential wUSDC account is owned by the organization's owner wallet. Sotto has no signing authority over any token account and never receives decryption keys (ENGINEERING-RULES.md rule 4 and 5).

### D-03 · Confidential key derivation scheme · GATE (G2)
- If all target wallets (Phantom, Solflare, Backpack; list in `14-ENVIRONMENTS-DEPLOY.md`) allow a dApp to call `signMessage` on the exact bytes `solana-conf-bal/v1`, use the standard `deriveConfidentialKeys` (facts A11). Interoperable with other confidential aware wallets.
- If any target wallet refuses (facts A12), use `ConfidentialKeys.fromIkm` where IKM is the Ed25519 signature over the UTF-8 message `sotto-conf-keys/v1` followed by a newline and the owner address in base58. Ed25519 signatures are deterministic, so the keys are reproducible from the wallet alone.
- The chosen scheme is stored per token account (`key_scheme` column, values `standard_v1` or `sotto_ikm_v1`). Never mix schemes on one account. Changing scheme requires a new token account and a full move of funds.
- Hardware wallets that cannot `signMessage` are not supported for owners in the MVP. Show a clear message.

### D-04 · Organization signing and approvals · DEFAULT (founder please confirm)
MVP: one owner wallet signs every money operation. Approvals (for example "2 of 2" on payroll) are an application policy enforced by Sotto: the backend refuses to hand out an execution plan until the required approvers have signed an approval message (Sign-In With Solana style signed payload, stored with signature). The UI must describe this truthfully: "Approvals are recorded in Sotto and signed by each approver. The owner wallet executes."
Phase 2: Squads multisig as the token account owner. This requires confidential key material shared by approvers (`fromIkm` from a shared secret) and proof regeneration if the balance changes between proposal and execution. Out of scope until designed in a separate document.

### D-05 · Viewing keys are application level disclosures · DECIDED
Forced by facts A8, A11 and D-01: onchain keys are wallet wide and cannot be scoped or revoked, and the wrapped mint has no auditor. Sotto implements scoped, expiring, revocable access with per viewer encrypted disclosure records. Full design in `07-SELECTIVE-DISCLOSURE.md`. Revocation stops future disclosures and deletes stored ciphertexts; it cannot erase what a viewer already decrypted. The UI must say this.

### D-06 · Proof of funds · DECIDED
"Balance is at least X" is proven with the same cryptography Token-2022 uses for withdraw: a ciphertext commitment equality proof plus a range proof over `available_balance minus X`, verified by the ZK ElGamal Proof program into context state accounts, then checked and recorded by the Sotto program `sotto_proofs` (spec in `05-ONCHAIN-PROGRAM.md`). No new cryptography.
Result vocabulary: **Proven** or **Not proven**. A false statement cannot be proven, so "False" is never shown as a cryptographic result. Copy change in `13-COPY-CORRECTIONS.md`.

### D-07 · Proof of income · DEFAULT: Phase 2
Requires an onchain record of each payroll ciphertext so a program can sum them. Design sketch in `05-ONCHAIN-PROGRAM.md` section 8. Not in the hackathon build. The "Prove income" screen ships only when Phase 2 ships.

### D-08 · Recipients without a wallet (email claim) · BLOCKER for Phase 2
MVP (Phase 1): every recipient connects a standard wallet and configures their confidential account through a Sotto invite link before they can be paid confidentially.
Phase 2 needs an embedded wallet provider. Founder must choose after Gate G2 style checks on: Solana support, deterministic `signMessage`, v1 transaction signing, key export, pricing. Candidates to evaluate: Privy, Dynamic, Turnkey, Para, Web3Auth.

### D-09 · Business verification (KYB) · DEFAULT for hackathon, BLOCKER for public mainnet
Hackathon and private beta: manual review by a Sotto admin in the admin console, then Sotto issues a "verified business" SAS attestation. Public mainnet: founder picks a KYB provider (for example Sumsub, Persona, Onfido) after legal review (D-23).

### D-10 · Sanctions screening · BLOCKER for Phase 1 payments
Every recipient address must be screened before a payment plan is issued. Founder chooses the provider and provides credentials. Candidates: Range, Chainalysis sanctions screening, TRM Labs. Until chosen, devnet uses a local deny list file so the code path is exercised; mainnet payments are disabled by feature flag until a provider is configured.

### D-11 · Frontend stack · DEFAULT
Next.js (App Router) with TypeScript strict mode, React, CSS Modules plus a global token stylesheet that reproduces the design variables exactly. Solana client: `@solana/kit` and the `@solana-program/*` clients. Wallets through the Wallet Standard. Proof generation runs in a Web Worker. Versions resolved and pinned at scaffold.

### D-12 · Backend and data · DEFAULT
Next.js route handlers for the API, PostgreSQL 16 with Drizzle ORM and SQL migrations, a separate Node worker for chain indexing and jobs. Managed Postgres: Neon (branch per environment). Founder may switch to Supabase or another Postgres host; schema is plain Postgres.

### D-13 · Hosting · DEFAULT
Web on Vercel. Worker on Fly.io. Founder may override.

### D-14 · RPC provider · DEFAULT with GATE
Helius for devnet and mainnet, public RPC as a devnet fallback only. Gate G1 must confirm the provider serves v1 transactions (`maxSupportedTransactionVersion: 1`) and the ZK ElGamal program is active on the cluster.

### D-15 · Authentication · DEFAULT
Sign-In With Solana through the Wallet Standard sign in feature when available, otherwise a signed nonce message. Session: httpOnly, secure, SameSite=Lax cookie holding an opaque session ID. No JWT in localStorage.

### D-16 · Onchain framework and upgrade authority · DEFAULT
`sotto_proofs` written with Anchor (version pinned at scaffold). Devnet upgrade authority: deployer keypair. Mainnet upgrade authority: a Squads multisig controlled by the founders, created before the first mainnet deploy. Verifiable build published.

### D-17 · Clusters · DECIDED
Localnet (validator with the ZK ElGamal program enabled) for automated tests, devnet as the public test environment ("testnet" in product language), mainnet-beta for production. Solana's `testnet` cluster is not used because it has no USDC.

### D-18 · Repository layout · DEFAULT
pnpm workspaces and Turborepo. Layout in `04-ARCHITECTURE.md`.

### D-19 · Product name and domain · BLOCKER for public mainnet
"Sotto" is a working name. Founder confirms the final name and domain before public mainnet launch. Code uses the name only through a single config constant.

### D-20 · Design elements without defined data · DECIDED
- "Ask anything about your payments" input: removed from the MVP.
- "Privacy score": kept, with the formula defined in `01-PRODUCT.md` F-18. If the founder prefers, remove it; do not show an undefined number.
- Any other demo only element is listed in `13-COPY-CORRECTIONS.md` with its fate.

### D-21 · Payroll execution · DECIDED
One confidential transfer per recipient. A run of N recipients is N transactions (v1: one transaction each; v0 fallback: several each). Proofs are generated sequentially because each transfer changes the sender's available balance; the client computes the next available balance ciphertext locally so all plans can be prepared before signing. Signing uses one `signAllTransactions` prompt when the wallet supports it, otherwise one prompt per transaction. Copy must not claim "one transaction".

### D-22 · Pricing · DEFAULT
No fees in the MVP. No fee logic in code.

### D-23 · Legal · BLOCKER for public mainnet
Terms of service, privacy policy and a regulatory review (Turkey and target markets) before public mainnet onboarding. Private beta on mainnet with invited design partners is allowed only with written founder approval recorded in `QUESTIONS.md`.
