# Security policy

## Status

Sotto is a beta on Solana devnet. It moves test money only. The onchain program `sotto_proofs` and the rest of this repository have not been audited. An external audit is required before a public mainnet launch.

## Reporting a vulnerability

Report privately to **info@cayvox.com**. Please do not open a public issue, pull request or discussion for a vulnerability.

Include what you can of:

- What is affected: the program, the web app, the worker, the SDK, or the hosted site at https://sottoapp.xyz.
- The steps or a proof of concept that shows the problem, on devnet or on a local validator.
- What an attacker gains, and what they need to start with.
- The commit you tested.

Never send a secret key, a recovery phrase or a viewing key. We do not need them to reproduce a report.

## Scope

In scope:

- `programs/sotto_proofs`: the program that verifies balance threshold proofs and writes proof records.
- `packages/sdk`: key derivation, confidential account flows, disclosure encryption, proof building.
- `apps/web` and `apps/worker`: the API, sessions, grants, the access log, the indexer and the jobs.
- The hosted beta at https://sottoapp.xyz.

The rules that matter most are in `docs/10-SECURITY.md` and `docs/ENGINEERING-RULES.md`: no secret key and no private amount may reach Sotto's servers (rule 4), and the program never moves tokens (rule 5). A way to break either one is the most valuable report.

Out of scope:

- Programs Sotto calls but does not maintain: Token-2022, the ZK ElGamal Proof program, Token Wrap, the Solana Attestation Service, and wallets.
- Solana devnet itself and its RPC providers.
- Denial of service by volume, spam, and social engineering.
- Findings that need a compromised device, browser or wallet.

## Good faith

Test with your own devnet accounts. Do not read, change or delete other people's data, and stop as soon as you have shown the problem.
