# 10 · Security

## 1. Invariants (each has an automated test or a CI check)

| ID | Invariant | Enforced by |
|----|-----------|-------------|
| I-1 | No plaintext amount or key material in the database | Schema column name test (08 section 1), code review checklist |
| I-2 | No key material or plaintext amount leaves the browser except as ciphertext | Network test: Playwright intercepts all requests during flows and fails on any payload matching known test amounts or key bytes |
| I-3 | `sotto_proofs` has no token CPI and no authority over token accounts | Static test over source and IDL (05 section 7) |
| I-4 | The deprecated ZK Token Proof program is never referenced | Grep test in CI over the repo and the lockfiles' resolved sources |
| I-5 | Confidential keys are compared with the onchain ElGamal public key before any use | SDK unit test and runtime assertion |
| I-6 | Every payment is screened and approved before authorization | API tests per error code |
| I-7 | No double payment on retry | Idempotency key tests plus chain check before resend |
| I-8 | Viewer public keys are used only after their registration signature verifies | SDK unit test |
| I-9 | Disclosures are trusted only with a valid owner manifest signature | SDK unit test |
| I-10 | Revocation deletes all disclosures of the grant atomically | API test |

## 2. Threats and mitigations

| Threat | Mitigation |
|--------|------------|
| Malicious or compromised Sotto server reads amounts | It only ever has ciphertexts (I-1, I-2) |
| Server swaps a viewer key to read disclosures | Registration signatures checked client side (I-8) |
| Server forges disclosures | Owner manifest signatures (I-9) |
| XSS steals in-memory keys | Strict Content Security Policy (no inline scripts except Next nonce, no third party scripts on app routes), Trusted Types where supported, dependency review, no `dangerouslySetInnerHTML` |
| Phishing site asks for the key derivation signature | Domain bound messages include the purpose and wallet; user education on the unlock prompt; recommend wallets that show message text |
| Supply chain attack on npm or crates | Exact pins, lockfiles committed, `pnpm audit` and `cargo audit` in CI, Renovate with manual merge, provenance checks for critical packages |
| Proof program disabled by feature gate (facts B5) | F-19 detection and banner |
| Upgrade of `sotto_proofs` by attacker | Mainnet upgrade authority is a Squads multisig (D-16) |
| Race: balance changes during proof of funds | Ciphertext match check in program (05 check 7) |
| Replay of sign in or approval messages | Nonces with expiry; approval messages include subject ID, org ID and cluster |
| Sanctioned recipient | Screening gate (D-10) |
| USDC issuer freezes wrapped tokens | Disclosed on trust page (D-01) |

## 3. Key handling rules

- Keys are derived on demand after an explicit "Unlock" click, never automatically on page load.
- Keys live in a Web Worker's memory. The main thread receives only decrypted display values.
- Locking (button, 15 minutes idle, tab hidden for 5 minutes) terminates the worker.
- Never write keys, decrypted amounts or disclosure plaintext to `localStorage`, `sessionStorage`, IndexedDB, cookies, URLs or logs.

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
