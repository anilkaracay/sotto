<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <img src="docs/assets/logo-light.svg" alt="Sotto" width="260">
  </picture>
</p>

<p align="center"><strong>Selective privacy for onchain finance</strong></p>

<p align="center">
  Sotto is a confidential business account on Solana: a company pays payroll, suppliers and payouts in stablecoins,<br>
  the amounts are encrypted onchain, and the company decides who can read which numbers.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-1F5BE8" alt="License: Apache 2.0"></a>
  <a href="https://github.com/anilkaracay/sotto/actions/workflows/ci.yml"><img src="https://github.com/anilkaracay/sotto/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://explorer.solana.com/address/A7pejhdwBy4a2VtzmCpWiL1jVymiWEn42NZoDwMTQRhG?cluster=devnet"><img src="https://img.shields.io/badge/Solana-devnet-9945FF" alt="Solana devnet"></a>
  <a href="https://sottoapp.xyz"><img src="https://img.shields.io/website?url=https%3A%2F%2Fsottoapp.xyz&label=sottoapp.xyz" alt="Live site: sottoapp.xyz"></a>
</p>

## Demo

<p align="center">
  <a href="https://youtu.be/99sRcDDkwgE">
    <img src="docs/assets/demo-thumbnail.jpg" alt="Watch the Sotto product demo on YouTube" width="820">
  </a>
</p>

<p align="center">
  <a href="https://sottoapp.xyz">sottoapp.xyz</a> ·
  <a href="https://sottoapp.xyz/v/7ssfLgVmvaC4zAFm9aVBw4jrJdb9mSisCKQXvFHjUbEX">A live proof of funds</a>
</p>

## Why

- Every payment on a public chain shows its amount.
- So anyone can read what a company pays its suppliers, what it pays its people and how long its money will last.
- Sotto keeps the amounts sealed onchain and leaves the choice of who reads them to the company.

## What

Three modules, one account.

### 01 · Confidential accounts

Balances and payment amounts are encrypted onchain with Token-2022 Confidential Balances. The company funds its account, pays a supplier or runs a payroll, and only it can read its own numbers. Who paid whom, and in which token, stays public.

<img src="docs/assets/module-confidential-accounts.png" alt="The overview of a Sotto account on devnet: the available balance decrypted in the browser, beside the pending and public balances" width="100%">

### 02 · Selective disclosure

The company grants a viewing key with a scope: every amount, one period, payroll only, or a person's own payslips. The records in scope are encrypted to that reader's own key, a grant can be revoked, and grants, shares, revocations and exports are recorded in the access log.

<img src="docs/assets/module-selective-disclosure.png" alt="An accountant's read only view of the October books: the scope of the grant above the totals decrypted for that reader" width="100%">

### 03 · Verifiable proofs

The company proves that its balance is at least a threshold. The proof is made in the browser, checked onchain by the `sotto_proofs` program with the ZK ElGamal proof program, and written as a record anyone can open. The balance itself is never disclosed.

<img src="docs/assets/module-verifiable-proofs.png" alt="The public page of a proof of funds: the statement, Proven, the slot it was verified at, and balance disclosed: none" width="100%">

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/architecture-dark.png">
  <img src="docs/assets/architecture-light.png" alt="Architecture: the company's browser holds the keys and sends signed transactions to Solana and sealed records to the Sotto service; readers get ciphertext from Solana and scoped access from the service" width="100%">
</picture>

- **The company's browser** derives the keys from a wallet signature. It encrypts, decrypts and builds the proofs. Nothing secret leaves the tab.
- **Solana** holds the money: Token-2022 Confidential Balances, the ZK ElGamal proof program and `sotto_proofs`. Amounts are encrypted onchain. Every token movement is an instruction signed by the user's wallet; `sotto_proofs` never moves tokens.
- **The Sotto service** holds the grants, the access log and sealed records only. It never holds a secret key or a private amount.
- **Readers** (an accountant, an auditor, an employee, a counterparty) each see their scope, and nothing else.

The details are in [`docs/04-ARCHITECTURE.md`](docs/04-ARCHITECTURE.md), [`docs/06-CONFIDENTIAL-FLOWS.md`](docs/06-CONFIDENTIAL-FLOWS.md) and [`docs/07-SELECTIVE-DISCLOSURE.md`](docs/07-SELECTIVE-DISCLOSURE.md).

## Try it

Sotto runs on Solana devnet with test money.

See a live proof of funds: https://sottoapp.xyz/v/7ssfLgVmvaC4zAFm9aVBw4jrJdb9mSisCKQXvFHjUbEX
It states that Northwind Labs Demo Ltd holds at least 250,000 devUSD. Status: Proven, valid until 4 April 2027. Balance disclosed: none.

Open your own account:

1. Use Phantom or Solflare on Solana devnet, and get a little devnet SOL from https://faucet.solana.com for fees and account rent.
2. Sign in at https://sottoapp.xyz/app by signing a message with your wallet.
3. Create your organization with its legal name and country, choose devUSD as the currency, and send it for review. A Sotto admin reviews every organization by hand, usually within one business day, and money features stay off until it is verified. Once verified, Sotto issues an attestation onchain to your wallet.
4. On Account setup, set up your confidential account, get devUSD from the faucet (at most 10,000 devUSD per wallet every 24 hours) and fund your account with it.
5. On Recipients, add a recipient and send them the invite link. They sign in with their own wallet, register a viewing key and set up their account, which needs a little devnet SOL. Then pay them on Payments, or pay many people at once on Payroll.
6. On Viewing keys, invite a reader with a scope. They sign in and accept with their viewing key, and you share the past records their scope covers.
7. On Proofs, choose a threshold and who the answer is for. Your browser makes the proof, your wallet signs, and you get a public link anyone can open.

## Verify it

- A payment on the explorer shows the sender, the recipient and the token, but not the amount: https://explorer.solana.com/tx/4y8odT3AYxoZvcW5Xnbf6DMMNA3pcdHhqQVGJVffiTEkVEgq6Gc4vwGYeEmf8vMNeXCibxhnWqiuzTJUHanKTqD3?cluster=devnet
- The proof record is checked onchain by the sotto_proofs program with the ZK ElGamal proof program: https://explorer.solana.com/address/7ssfLgVmvaC4zAFm9aVBw4jrJdb9mSisCKQXvFHjUbEX?cluster=devnet
- A reader decrypts only what their grant covers. Grants, shares, revocations, payments, payroll runs, exports and proofs are recorded in the access log, and every viewing key shows when it was last used.
- No secret key and no private amount reaches Sotto's servers. They store public keys, and only amounts that are already public onchain, such as deposits and withdrawals.

Devnet addresses:

- sotto_proofs (USDC): [4rMKgJWgawaTTdUxaudUXthEExnRZ7AvFvqzsoEAr9jd](https://explorer.solana.com/address/4rMKgJWgawaTTdUxaudUXthEExnRZ7AvFvqzsoEAr9jd?cluster=devnet)
- sotto_proofs (devUSD): [A7pejhdwBy4a2VtzmCpWiL1jVymiWEn42NZoDwMTQRhG](https://explorer.solana.com/address/A7pejhdwBy4a2VtzmCpWiL1jVymiWEn42NZoDwMTQRhG?cluster=devnet)
- Wrapped USDC mint: [AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd](https://explorer.solana.com/address/AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd?cluster=devnet)
- devUSD mint: [KttR31BxvWErtewYs1uNiywFWwi3nwxUToixi5A2Akx](https://explorer.solana.com/address/KttR31BxvWErtewYs1uNiywFWwi3nwxUToixi5A2Akx?cluster=devnet)
- SAS credential: [4KX4P7he62x5x8X35vubNNhJRhV4vJXPGNsc8skPyKFT](https://explorer.solana.com/address/4KX4P7he62x5x8X35vubNNhJRhV4vJXPGNsc8skPyKFT?cluster=devnet)

## Run it locally

Prerequisites, pinned in [`docs/VERSIONS.md`](docs/VERSIONS.md): Node.js 24.21.0, pnpm 12.6.0, Rust 1.98.1, the Agave CLI suite 4.2.2 (with `cargo-build-sbf` 4.1.0) and Docker.

```sh
pnpm install --frozen-lockfile
```

**Configuration.** Every app reads its settings from its own git ignored file: `apps/web/.env.local`, `apps/worker/.env.local` and `packages/db/.env.local`. The names are in [`.env.example`](.env.example); no value belongs in the repository.

| Used by        | Names                                                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web            | `NEXT_PUBLIC_CLUSTER`, `NEXT_PUBLIC_APP_URL`, `RPC_URL`, `LOCALNET_USDC_MINT`, `DATABASE_URL`, `SESSION_SECRET`, `SCREENING_PROVIDER`, `SCREENING_API_KEY`, `ADMIN_WALLETS`, `RESEND_API_KEY`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` |
| Worker         | `RPC_URL`, `DATABASE_URL`, `LOCALNET_USDC_MINT`, `SENTRY_DSN`, `SAS_SIGNER_KEYPAIR`, `SAS_SIGNER_KMS_KEY_ID`, `SAS_CREDENTIAL_ADDRESS`, `SAS_SCHEMA_ADDRESS`, `SOTTO_NOTIFY_URL` (optional)                                           |
| Database tools | `DATABASE_URL`, `ADMIN_WALLETS`                                                                                                                                                                                                       |

**Database.** PostgreSQL 16 in Docker, created once with the password of your `DATABASE_URL`:

```sh
docker volume create sotto-pgdata
docker run -d --name sotto-postgres --restart unless-stopped \
  -e POSTGRES_USER=sotto -e POSTGRES_DB=sotto \
  -e POSTGRES_PASSWORD=<the password in DATABASE_URL> \
  -p 127.0.0.1:56432:5432 -v sotto-pgdata:/var/lib/postgresql/data postgres:16.15

scripts/db-local.sh up              # start it again later
pnpm --filter @sotto/db migrate     # apply the migrations
```

**A local chain.** A validator with the confidential stack, then the mints, the Token Wrap escrow, the attestation credential and `sotto_proofs`:

```sh
pnpm program:build                  # the SBF build of sotto_proofs
scripts/localnet.sh                 # a local validator, in the foreground
node scripts/bootstrap-localnet.ts  # in another terminal; writes .localnet/bootstrap.json
```

**The apps.**

```sh
pnpm dev                            # the web app
pnpm --filter @sotto/worker start   # the worker
```

**Tests.**

```sh
pnpm lint && pnpm typecheck
scripts/db-local.sh test-up && pnpm test               # unit and API tests, on a throwaway Postgres
pnpm program:build && pnpm program:test                # the program
pnpm build && pnpm --filter @sotto/e2e e2e             # browser tests on the production build
pnpm build && pnpm --filter @sotto/e2e e2e:localnet    # browser flows on a fresh local validator
pnpm ci:local                                          # every job, as the project's CI runs them
```

## Repository layout

```
apps/
  web/              the Next.js app: landing, product, public proof pages, API
  worker/           the background jobs: indexer, settlement, attestations, faucet
packages/
  sdk/              keys, confidential accounts and transfers, disclosure, proofs
  db/               the Drizzle schema, the migrations and the database tools
  ui/               the design tokens, the themes and the shared components
  config/           the shared ESLint, TypeScript and Prettier settings
programs/
  sotto_proofs/     the onchain program: verifies a threshold, writes a proof record
scripts/            the local validator, its bootstrap, devnet tools, repository checks
tests/e2e/          the Playwright suites: public pages, localnet flows, acceptance
design/brand-kit/   the logo, the icons, the tokens and the brand guidelines
docs/               the specification, decisions, verified facts and pinned versions
```

## Tech stack

- **Solana** with **Token-2022 Confidential Balances** for encrypted balances and transfer amounts.
- The **ZK ElGamal proof program** for the proofs behind transfers, withdrawals and balance thresholds.
- **Token Wrap** to wrap USDC one to one into a Token-2022 mint that carries the confidential extension.
- **sotto_proofs**, a native Solana program in Rust (no framework): the modular `solana-*` crates of the 3.x line with `solana-program-entrypoint` 3.1.1, `spl-token-2022-interface` 3.1.2, `solana-zk-elgamal-proof-interface` 0.1.3 and `bytemuck` 1.25.2, built with `cargo-build-sbf` 4.1.0 from Agave 4.2.2. Its TypeScript client is generated with Codama from a hand written IDL.
- The **Solana Attestation Service** for the attestation that a business is verified.
- **Next.js** 16.3.6 and **React** 19.3.0 in **TypeScript** 6.0.3, with `@solana/kit` 8.3.0.
- **PostgreSQL** 16 with **Drizzle** 0.45.3.

Every version is pinned and recorded in [`docs/VERSIONS.md`](docs/VERSIONS.md).

## Security model and limits

Two rules come before everything else ([`docs/ENGINEERING-RULES.md`](docs/ENGINEERING-RULES.md), [`docs/10-SECURITY.md`](docs/10-SECURITY.md)):

- Sotto never holds user funds or user decryption keys. No secret key and no private amount reaches its servers.
- The onchain program never moves tokens. It verifies proofs and writes records.

Limits today:

- Devnet only. No mainnet money moves yet.
- USDC is wrapped one to one with Token Wrap. USDG and PYUSD carry the confidential extension on mainnet, but every confidential account needs the issuer's approval today.
- Unwrapping back to plain USDC shows the amount at that moment.
- Access grants are stored on Sotto's service, not onchain. The records shared under a grant are encrypted to the reader's own key.
- sotto_proofs has not been audited yet. An external audit is required before a public mainnet launch.

To report a vulnerability, see [`SECURITY.md`](SECURITY.md).

## Roadmap

- **Now.** Live on devnet: confidential accounts and payments, scoped disclosure with books and payslips, onchain proof of funds.
- **Next 90 days.** Mainnet, with an external audit of `sotto_proofs`, multisig accounts with Squads, USDG with Paxos or Token Wrap, and the first design partners.
- **Then.** Privacy for Solana DvP, a proof API for verifiers, solvency and income statements, new markets.

## Related work

- Confidential cash leg, design analysis and verified mechanics: [solana-foundation/dvp#19](https://github.com/solana-foundation/dvp/issues/19)
- The design proposal and verification spike for confidential legs in Solana DvP: [cayvox/dvp-confidential-legs](https://github.com/cayvox/dvp-confidential-legs)

## License and credits

Licensed under the [Apache License, Version 2.0](LICENSE). Third party material and its terms are listed in [`NOTICE`](NOTICE).

Built by Cayvox Labs ([cayvox.com](https://cayvox.com)). Contact: info@cayvox.com
