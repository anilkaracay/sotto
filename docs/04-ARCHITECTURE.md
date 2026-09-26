# 04 · Architecture

## 1. Components

```
Browser (Next.js app, Web Worker for proofs)
  |  holds: wallet connection, confidential keys (memory only), viewing secret key (memory only)
  |  does: proof generation, transaction building, encryption and decryption of disclosures
  |
  |-- HTTPS --> Sotto API (Next.js route handlers)
  |               stores: orgs, members, recipients, runs, grants, disclosure ciphertexts,
  |                       execution metadata, access log. Never plaintext amounts, never keys.
  |               talks to: Postgres, sanctions provider, SAS (via worker)
  |
  |-- RPC via /api/rpc (Sotto API JSON-RPC proxy) --> Solana (Token-2022, Token Wrap, ZK ElGamal Proof, SAS, sotto_proofs)
  |
Worker (Node)
  indexes org accounts, confirms executions, issues SAS attestations,
  checks proof program availability, expires grants, cleans up orphaned proof accounts
```

## 2. Trust model

| Party | Trusted for | Not trusted for |
|-------|-------------|-----------------|
| Solana runtime, Token-2022, Token Wrap, ZK ElGamal Proof program | Correct execution of audited programs | Nothing beyond their spec |
| `sotto_proofs` | Writing proof records only after onchain checks pass | It never touches funds; a bug can at worst write an invalid record, never move tokens |
| Sotto API and database | Availability, storing ciphertexts, enforcing app policy (approvals, grants) | Confidentiality of amounts (it never has plaintext), integrity of amounts (clients verify against chain) |
| Owner's browser and wallet | Keys, plaintext, signatures | Nothing on behalf of other users |
| Viewer's browser | Decrypting what was granted | Keeping data after revocation (cannot be enforced) |
| Sanctions and KYB providers | Screening results | Anything else |

Integrity rule: any amount shown to a viewer from a disclosure must be checked, when possible, against chain data. For the owner, disclosures are checked against their own decrypted balance deltas. For recipients, the check runs on demand ("Verify against chain" button), not automatically: the recipient's browser decrypts the stored destination ciphertext of the transfer (`07-SELECTIVE-DISCLOSURE.md` section 3) with their ElGamal secret and compares it with the disclosure amount. Mismatch shows a red "disclosure does not match chain" warning and is logged.

## 3. Repository layout

```
/
  ENGINEERING-RULES.md
  docs/
  design/                      approved HTML designs (reference only)
  apps/
    web/                       Next.js: landing at "/", app at "/app", proof verify at "/v/[address]"
    worker/                    Node worker: indexer, jobs
  packages/
    sdk/                       @sotto/sdk: all Solana logic, pure TypeScript, no React
      src/keys/                confidential key derivation (D-03), viewing keys
      src/wrap/                Token Wrap helpers
      src/confidential/        configure, deposit, apply, transfer, withdraw, plans
      src/proofs/              proof of funds (client side proof generation, verify ix)
      src/disclosure/          encryption formats, grant scope evaluation
      src/tx/                  v1 and v0 transaction building, sending, confirmation
      src/cluster/             cluster config, program ID verification at startup
    db/                        Drizzle schema, migrations, typed queries
    ui/                        design tokens, primitives shared by landing and app
    config/                    eslint, tsconfig, prettier
  programs/
    sotto_proofs/              native Solana program (D-16, no Anchor)
  tests/
    e2e/                       Playwright against localnet and devnet
    fixtures/
  scripts/                     gates, bootstrap (create wrapped mint, SAS credential), deploy
```

## 4. Key flows at a glance

Detailed sequences live in `06-CONFIDENTIAL-FLOWS.md`.

1. **Owner setup:** sign in, create org, admin approves, SAS attestation issued, owner derives keys, creates and configures wUSDC account, registers viewing key.
2. **Fund:** wrap USDC, deposit, apply.
3. **Pay:** screen, approve, plan, prove, sign, send, confirm, disclose.
4. **Grant:** register viewer key, create grant, back fill disclosures.
5. **Read (accountant):** fetch disclosures, decrypt in browser, verify where possible.
6. **Prove:** generate proofs, verify into context accounts, call `sotto_proofs`, share link.

## 5. Where each secret lives

| Secret | Lives | Lifetime |
|--------|-------|----------|
| Wallet private key | Wallet only | Wallet's |
| Confidential ElGamal secret, AES key | Browser memory of the owner (or recipient) | Tab session; re-derived by signature |
| Viewing secret key (X25519) | Browser memory of the viewer | Tab session; re-derived by signature |
| Session ID | httpOnly cookie | 12 hours idle, 7 days absolute |
| Provider API keys (sanctions, RPC) | Server environment variables | Rotated per `10-SECURITY.md` |
| SAS credential signer | Worker environment (devnet); hardware or KMS backed key on mainnet | Rotated per `10-SECURITY.md` |

Web Worker: proof generation and decryption run in a dedicated worker. Wallet signatures happen on the main thread; the signature bytes are transferred to the worker by `postMessage` and zeroed on the main thread. Keys are zeroed after use where the WASM API allows. Gate G3 confirms the helpers accept raw key material; if a helper needs a signer object, the raw keys are wrapped inside the worker.
