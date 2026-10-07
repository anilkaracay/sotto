# Sotto

Confidential business account on Solana. Private books, public chain.

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

Demo video: TODO-VIDEO

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

## Limits

- Devnet only. No mainnet money moves yet.
- USDC is wrapped one to one with Token Wrap. USDG and PYUSD carry the confidential extension on mainnet, but every confidential account needs the issuer's approval today.
- Unwrapping back to plain USDC shows the amount at that moment.
- Access grants are stored on Sotto's service, not onchain. The records shared under a grant are encrypted to the reader's own key.
- sotto_proofs has not been audited yet. An external audit is required before a public mainnet launch.

## Contact

info@cayvox.com

## Repository

- Start here: `docs/ENGINEERING-RULES.md`, then `docs/00-INDEX.md`.
- Pinned versions of every tool, crate and package: `docs/VERSIONS.md`.
