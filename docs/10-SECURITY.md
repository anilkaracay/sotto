# 10 · Security

## 1. Invariants (each has an automated test or a CI check)

| ID | Invariant | Enforced by |
|----|-----------|-------------|
| I-1 | No plaintext amount or key material in the database | Schema column name test (08 section 1), code review checklist |
| I-2 | No key material or plaintext amount leaves the browser except as ciphertext | Network test: Playwright intercepts all requests during flows and fails on any payload matching known test amounts or key bytes. It uses sentinel payment amounts that are never used for deposits or withdrawals, and exempts the cleartext amount field of deposit and withdraw instructions. Since step 1.9 the localnet payments spec pays a sentinel amount (12.345678 USDC) with a memo and fails if any request's URL or body holds either |
| I-3 | `sotto_proofs` has no token CPI and no authority over token accounts | Static test over source and IDL (05 section 7) |
| I-4 | The deprecated ZK Token Proof program is never referenced | Grep test in CI over the repo and the lockfiles' resolved sources |
| I-5 | Confidential keys are compared with the onchain ElGamal public key before any use | SDK unit test and runtime assertion; since step 1.7 `decryptTokenAccount` and `applyPendingBalanceInstruction` refuse a key mismatch (unit tests), and account setup reads the account back with the worker's key check before recording it |
| I-6 | Sotto's API refuses to authorize, and the Sotto client refuses to execute, without screening and approvals | API tests per error code; since step 1.9 the API refuses to authorize before screening, approvals, the recipient's readiness from chain and a recent proof program check (API tests), and the payment page runs the transfer only after the server answered authorized |
| I-7 | No double payment on retry | Idempotency key tests plus chain check before resend; since step 1.9 the same key returns the same draft, a retry after a failed attempt first reads the chain for that attempt's transfer signature (API test), and `confirm-executions` settles a transfer that landed after the page gave up (worker test) |
| I-8 | Viewer public keys are used only after their registration signature verifies | SDK unit test; since step 1.8 the recipients page verifies the owner's own viewing key registration before it seals a default amount to it |
| I-9 | Disclosures are trusted only with a valid owner manifest signature | SDK unit test; since step 1.8 the server verifies the manifest (this org, the owner wallet's signature, every item's hash) before it stores a batch, and the viewer's client verifies again what it reads (`verifyManifest`, `itemInManifest`; SDK and API tests: tampered item, wrong signer, manifest for another org). Since step 1.10 the pages that open disclosures (the overview's recent activity, the recipient's pay page) go through `apps/web/lib/client/disclosures.ts`: an item opens only when its manifest names the org, the owner wallet signed it and it lists the item for this viewer with its ciphertext hash, and the payload must name the org and the item's kind (`apps/web/test/disclosures-open.test.ts`: tampered item, another signer, another org, another viewer, a missing manifest, a key that does not open it) |
| I-10 | Revocation deletes all disclosures of the grant atomically | API test |

## 2. Threats and mitigations

| Threat | Mitigation |
|--------|------------|
| Malicious or compromised Sotto server reads amounts | It only ever has ciphertexts (I-1, I-2) |
| Server swaps a viewer key to read disclosures | Registration signatures checked client side (I-8) |
| Server forges disclosures | Owner manifest signatures (I-9) |
| XSS steals in-memory keys | Strict Content Security Policy (no inline scripts except Next nonce, no third party scripts on app routes), Trusted Types where supported, dependency review, no `dangerouslySetInnerHTML` |
| Phishing site asks for the key derivation signature | Accepted risk (D-03 `standard_v1`, founder 2026-09-27, Q-09): the derivation message is the constant `solana-conf-bal/v1`, which names neither Sotto nor the wallet, so any site that obtains the signature of `solana-conf-bal/v1` can read (never move) all confidential balances of that wallet. Mitigations to build: (1) the unlock screen explains in plain words what the signature does and says "Only sign this in Sotto"; (2) the app never requests this signature automatically, only after an explicit Unlock click; (3) if a wallet refuses the message in the future, the app shows a clear message and a recovery guide using the standard CLI. Built in step 1.5: (1) and (2) on `/app/[org]/setup` (13 A36; the E2E test checks that nothing is signed before the click), (3) as the refusal message with a link to `/app/recovery`, whose commands were run on localnet (facts A11, H7, H8); since step 1.6 the guide gets the exact amount from `scripts/recover-balance.ts`, which derives the keys on the user's computer and sends nothing |
| Supply chain attack on npm or crates | Exact pins, lockfiles committed, `pnpm audit` and `cargo audit` in CI, Renovate with manual merge, provenance checks for critical packages |
| Proof program disabled by feature gate (facts B5) | F-19 detection and banner |
| Upgrade of `sotto_proofs` by attacker | Mainnet upgrade authority is a Squads multisig (D-16) |
| Race: balance changes during proof of funds | Ciphertext match check in program (05 check 7) |
| Replay of sign in or approval messages | Nonces with expiry; approval messages include org ID, cluster, subject type and ID, and `contents_hash` (D-04); any change to the run after approval invalidates approvals |
| Sanctioned recipient | Screening gate (D-10) |
| USDC issuer freezes wrapped tokens | Disclosed on trust page (D-01) |

## 3. Key handling rules

- Keys are derived on demand after an explicit "Unlock" click, never automatically on page load. Since step 1.8.1 (founder, 2026-09-28) one click asks for two signatures in sequence, the confidential key message and then the viewing key message (06 sections 1 and 2), and both keys stay available for the whole tab under the same lock conditions below; the two derivations stay separate. If the second signature is refused, the confidential keys stay unlocked and the page says what is not available. No page has an unlock of its own for the viewing key (the recipients page's "Show default amounts" is gone); the keys card asks for the viewing key signature alone only after it was refused. Tests: the order of the two requests, the two signatures reaching two derivations, the refused second signature and the retry, and no second request after a failed first (`apps/web/test/key-session.test.ts`), and in the browser the explainer, the refusal and retry (`tests/e2e/specs/keys.spec.ts`) and the default amounts opening after one click (`tests/e2e/localnet/recipients.spec.ts`).
- Keys live in a Web Worker's memory, per tab, across in-app navigation (step 1.7.1: the worker belongs to the tab's key session in the `/app` layout, not to a page). The main thread receives only decrypted display values. Wallet signatures happen on the main thread; the signature bytes are transferred to the worker and zeroed on the main thread. G3 confirms the helpers accept raw key material; if a helper needs a signer object, the raw keys are wrapped inside the worker.
- Locking (button, 15 minutes idle, tab hidden for 5 minutes, reload, sign out, org switch, wallet account change) zeroes the keys the vault holds and terminates the worker. Auto lock is suspended while an execution or proof is in progress, and resumes after. Tests (step 1.7.1): each end condition in unit tests of the key session (`apps/web/test/key-session.test.ts`), the zeroing of every key, the viewing key and the signature digest in the vault tests, and in the browser the keys surviving navigation between the setup page and the overview without a new signature, and reload, Lock, sign out and a wallet account change each ending them and closing the worker (`tests/e2e/localnet/setup.spec.ts`).
- Never write keys, decrypted amounts or disclosure plaintext to `localStorage`, `sessionStorage`, IndexedDB, cookies, URLs or logs.
- A bearer token that travels in a URL (the invite link token) never reaches a log: every logged string has it replaced with `:token` (Q-16, step 2.1; 08 section 6). The database keeps only its SHA-256 (step 1.8).
- Implementation (step 1.5): 04 section 5. The E2E keys test derives the keys with the CLI checked test keypair and fails if any request (URL, headers or body) or the page's storage holds the derivation signatures, the ElGamal secret key, the AES key or the viewing secret key in hex, base64 or base58.
- Implementation (step 1.7): the worker also does the work that needs the keys: the determinism check before account setup (it keeps the SHA-256 of the unlock signature, not the signature, and compares a second signature with it), the account setup and apply instructions, and the decryption of token account data the page read from chain. Its answers add balances decrypted for display on that page and instruction data, which the transaction publishes onchain anyway (the encrypted zero balance, the pubkey validity proof, the new decryptable balance of an apply); still no key or signature. The worker makes no network calls. The localnet E2E spec (`tests/e2e/localnet/setup.spec.ts`) runs setup, wrap, deposit and apply and fails if any request holds the key signature, the ElGamal secret key or the AES key in hex, base64 or base58.

## 4. Program security process

- Unit, negative and fuzz tests (05 section 7).
- Independent review by a second engineer of every line of `sotto_proofs` before mainnet.
- External audit: required before public mainnet (D-23). The private beta may run with the program only because it holds no funds and cannot move tokens; the worst case is an invalid proof record. State this publicly on the trust page.
- Verifiable build published with the deployed hash.

## 5. Operational security

- Secrets in the hosting providers' secret stores; never in the repo. `.env.example` lists names only.
- Rotation: RPC and provider keys every 90 days and on any suspicion. SAS signer on mainnet in a KMS or hardware backed key.
- Incident runbook in `14-ENVIRONMENTS-DEPLOY.md`: pause flag in `sotto_proofs`, feature flags to disable confidential actions, status banner.
- Responsible disclosure email and `security.txt` on the landing domain.
