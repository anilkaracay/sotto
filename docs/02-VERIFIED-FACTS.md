# 02 · Verified facts

Researched on 26 September 2026. Every fact has a source. Facts marked **RE-VERIFY** must be confirmed by a gate command before code depends on them, because they are version or cluster specific. Anything not in this file is unknown until you verify it.

## A. Confidential Balances (Token-2022)

A1. Account addresses, the mint and the owner of each account stay public. Only amounts and balances are encrypted. This gives confidentiality from public observers, not anonymity.
Source: https://solana.com/docs/tokens/extensions/confidential-transfer/integration-guide

A2. A configured account has a public balance plus encrypted **pending** and **available** balances. Tokens move between public and confidential state with deposit and withdraw. Deposits and withdrawals carry cleartext amounts; confidential transfers do not.
Source: same as A1.

A3. The `ConfidentialTransferAccount` extension stores: `elgamal_pubkey`, `pending_balance_lo`, `pending_balance_hi`, `available_balance` (ElGamal ciphertexts), `decryptable_available_balance` (AES ciphertext), `allow_confidential_credits`, `allow_non_confidential_credits`, `pending_balance_credit_counter`, `maximum_pending_balance_credit_counter`. When the credit counter reaches the maximum, the account cannot receive more confidential credits until the owner applies the pending balance.
Source: same as A1.

A4. Display the available balance by decrypting `decryptable_available_balance` with the AES key (constant time). Decrypting ElGamal ciphertexts requires a discrete log and must not be used for routine display.
Source: same as A1.

A5. A confidential transfer needs three client side proofs: ciphertext commitment equality, batched grouped ciphertext 3 handles validity, and batched range proof (U128 in the transfer path). Proofs are usually placed in proof context state accounts, referenced by the transfer, then closed. A withdraw needs an equality proof and a range proof.
Source: same as A1.

A6. Configuring an account requires the account owner to sign and to supply a proof of ownership of the ElGamal public key. A third party can create and fund the bare token account but cannot configure it without the owner.
Source: same as A1.

A7. The ElGamal registry (`spl-elgamal-registry` program, Rust `ConfigureAccountWithRegistry`) lets a user register an ElGamal key once so third parties can configure accounts later without the owner. As of the source date, the JS client did **not** expose registry helpers.
Source: same as A1. **RE-VERIFY** at scaffold: check the current `@solana-program/token-2022` release notes.

A8. A mint may set one **global auditor** ElGamal public key. Every transfer then also encrypts its amount to the auditor. The auditor sees all transfers on that mint.
Source: same as A1, and https://solana.com/docs/tokens/extensions/confidential-transfer/issuer-guide

A9. Libraries (names as published in the official guide):
- `@solana-program/token-2022`: instructions, state parsing, key derivation, high level helpers. Documented exports used by Sotto: `deriveConfidentialKeys` from `@solana-program/token-2022/confidential`, `fetchToken`, `getApplyConfidentialPendingBalanceInstructionFromToken`, `getConfidentialTransferInstructionPlan`, `getConfidentialWithdrawInstructionPlan`, `identifyToken2022Instruction`, `Token2022Instruction`, `TOKEN_2022_PROGRAM_ADDRESS`.
- `@solana/zk-sdk`: WASM encryption primitives and proof data. Documented: `AeCiphertext`, `ConfidentialKeys.fromIkm`, `ConfidentialKeys.fromPrf`, `CiphertextCommitmentEqualityProofData`, `BatchedGroupedCiphertext3HandlesValidityProofData`, `BatchedRangeProofU128Data`. The display example imports from `@solana/zk-sdk/bundler`.
- `@solana-program/zk-elgamal-proof`: proof verification instructions.
- `spl-token-client` (Rust): end to end helpers, including `confidential_transfer_configure_token_account_with_registry` and `confidential_transfer_transfer_with_fee`.
Source: same as A1. **RE-VERIFY** every export against the installed version before use (`node -e "console.log(Object.keys(require('<pkg>')))"` or read the package `.d.ts`).

A10. On 27 August 2026 the Solana changelog listed JavaScript SDK releases: Token-2022 Program v0.16.0, ZK ElGamal Proof Program v0.4.0, Token Wrap v2.7.0.
Source: https://solana.com/news/solana-changelog-august-27-2026. **RE-VERIFY** which npm package names these versions map to and use the latest stable at scaffold.

A11. Standard key derivation: the owner signs the constant message `solana-conf-bal/v1` once; both the ElGamal keypair and the AES key are derived from that signature. One wallet maps to one ElGamal keypair and one AES key across **all** mints and token accounts. Sharing these keys discloses every confidential account of that owner.
Source: same as A1.

A12. The official guidance says wallets **should refuse** generic `signMessage` requests for messages starting with `solana-conf-bal/v1`, because that signature is key material. A dApp may therefore be unable to derive the standard keys through a generic wallet `signMessage` call.
Source: same as A1. This drives decision D-03.

A13. Confidential keys can instead be derived from independent key material with `ConfidentialKeys.fromIkm` or `ConfidentialKeys.fromPrf` (WebAuthn PRF).
Source: same as A1.

## B. ZK ElGamal Proof program

B1. The ZK ElGamal Proof program is a native program that verifies the zero knowledge proofs used by Confidential Balances.
Source: https://www.helius.dev/blog/agave-v4-0

B2. It was disabled on mainnet at the start of epoch 805 on 19 June 2025 after a Fiat-Shamir transcript bug. Token-2022 was also upgraded to disable confidential transfers on 11 June 2025.
Source: https://solana.com/news/post-mortem-june-25-2025

B3. A third party article reports it was re-enabled on mainnet on 4 June 2026 via the `reenable_zk_elgamal_proof_program` feature gate and has stayed enabled as of 17 September 2026. **RE-VERIFY** with `solana feature status` on each cluster and with a live end to end confidential transfer (Gate G1). Sotto marketing copy currently says "August 2026": fix it to the verified date (see `13-COPY-CORRECTIONS.md`).
Source: https://dev.to/sulimanmukhtar/confidential-transfers-have-a-kill-switch-what-it-costs-you-5h39

B4. The older **ZK Token Proof** program address still exists as a stub that returns success without verifying anything. Never reference it. Any code or dependency that does is a critical bug.
Source: same as B3.

B5. A disable feature gate exists and was used once. Sotto must handle "proof program disabled" as a runtime condition: detect it, stop confidential operations, show a clear banner, keep public balances usable.
Source: same as B3.

## C. Token Wrap program

C1. Program ID `TwRapQCDhWkZRrDaHfZGuHxkZ91gHDRkyuzNqeU5MgR`. Wrapped mint address is a PDA of seeds `["mint", unwrapped_mint, wrapped_token_program_id]` under the Token Wrap program. Wrapped mint authority is a PDA of `["authority", wrapped_mint]`. A backpointer PDA stores the unwrapped mint. Unwrapped tokens are held in an escrow owned by the wrapped mint authority.
Sources: https://lib.rs/crates/spl-token-wrap-cli and https://docs.rs/crate/spl-token-wrap/latest/source/src/lib.rs

C2. Every Token-2022 wrapped mint gets `ConfidentialTransferMint` with: authority `None` (immutable), **no auditor**, and **auto approve** of new accounts.
Source: https://github.com/solana-program/token-wrap

C3. If the unwrapped token has a freeze authority, that freeze authority is preserved on the wrapped token. (For USDC this means the USDC issuer's freeze authority applies to wrapped USDC.)
Source: https://lib.rs/crates/spl-token-wrap-cli

C4. `CreateMint` is permissionless; the caller pre-funds the mint account.
Source: https://lib.rs/crates/spl-token-wrap-cli

C5. **RE-VERIFY**: that Token Wrap is deployed on devnet and mainnet at the ID above (`solana program show TwRapQCDhWkZRrDaHfZGuHxkZ91gHDRkyuzNqeU5MgR -u <cluster>`), and whether the wrapped mint for USDC already exists on each cluster (derive the PDA, then `solana account`). If it does not exist, Sotto creates it once with `CreateMint` (permissionless).

## D. Transactions

D1. Transaction format v1 raises the maximum size from 1232 to 4096 bytes (SIMD-0296, SIMD-0385). Legacy and v0 keep working.
Source: https://solana.com/de/upgrades/larger-transaction-sizes

D2. v1 was activated on mainnet at the start of epoch 1035 on 15 September 2026. RPC calls to `getBlock` and `getTransaction` must pass `maxSupportedTransactionVersion: 1` (integer) or they fail with error `-32015` on blocks containing v1 transactions.
Source: https://www.ankr.com/docs/changelog/solana-transaction-v1-2026-09-15/

D3. In v1, compute unit limit and loaded account data size move into a `TransactionConfigMask` inside the message instead of ComputeBudget instructions. v1 has no implicit defaults: omitted fields are treated as zero and the transaction fails. Feature gate: `txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL`.
Source: https://solanacompass.com/news/solana-v1-transactions-now-testable-locally-as-mainnet-activation-nears

D4. With v1, a confidential transfer can execute in a single onchain transaction. Without v1 it spans several dependent transactions (proof accounts, transfer, cleanup).
Source: A1 guide.

D5. **RE-VERIFY**: v1 activation on devnet (`solana feature status txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL -u devnet`), and which target wallets can sign v1 transactions (Gate G2). Sotto must support both paths.

## E. Solana Attestation Service (SAS)

E1. SAS associates offchain data with onchain accounts through credentials (an issuing authority with authorized signers), schemas (data layout) and attestations (signed claims with expiry and optional token account).
Source: https://solana.com/it/docs/tools/attestations

E2. Libraries: `sas-lib` (npm) and `solana-attestation-service-client` (Rust). `getCreateAttestationInstruction` takes payer, authority, credential, schema, attestation, systemProgram, nonce, data, expiry. `getCreateSchemaInstruction` takes name, description, layout, fieldNames.
Sources: https://solana.com/id/docs/tools/attestations/instructions/create-attestation and https://solana.com/vi/docs/tools/attestations/instructions/create-schema

E3. **RE-VERIFY**: program ID per cluster from the constant exported by the installed `sas-lib`, cross checked with `solana program show`.

## F. Assets

F1. Sotto uses USDC wrapped into Token-2022 through Token Wrap. **RE-VERIFY** the USDC mint address per cluster from Circle's official documentation before writing it into config. Do not copy mint addresses from memory, blog posts or this repo without that check.

## G. Explicitly unknown (verify before use)

- Whether Phantom, Solflare and Backpack allow `signMessage` of `solana-conf-bal/v1` (A12). Gate G2.
- Whether those wallets sign v1 transactions and `signAllTransactions` with v1. Gate G2.
- Browser performance of `@solana/zk-sdk` proof generation (time per transfer). Gate G3.
- Exact Rust module paths for proof context state parsing and ElGamal ciphertext arithmetic that `sotto_proofs` needs. Gate G4.
- Compute units used by `sotto_proofs::verify_balance_threshold`. Gate G4.
- SAS program ID per cluster (E3), Token Wrap deployment (C5), USDC mints (F1).
- The Token-2022 program ID, the ZK ElGamal Proof program ID, and the deprecated ZK Token Proof program ID (from the pinned Agave source). Gate G1 step 4 records them from pinned sources and chain; they are added to this file as verified facts after the gate. Until then, code must import them from package constants, never literals.
