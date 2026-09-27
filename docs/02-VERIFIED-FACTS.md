# 02 · Verified facts

Researched on 26 September 2026. Every fact has a source. Facts marked **RE-VERIFY** must be confirmed by a gate command before code depends on them, because they are version or cluster specific. Anything not in this file is unknown until you verify it.

Facts confirmed by a gate carry a line **VERIFIED** with date, cluster and the `VERIFICATION-LOG.md` entry. "G1 part N" means the entry "G1 · Cluster facts · part N" of 2026-09-26. Facts that a gate proved wrong are corrected in place with a note of what changed.

## A. Confidential Balances (Token-2022)

A1. Account addresses, the mint and the owner of each account stay public. Only amounts and balances are encrypted. This gives confidentiality from public observers, not anonymity.
Source: https://solana.com/docs/tokens/extensions/confidential-transfer/integration-guide

A2. A configured account has a public balance plus encrypted **pending** and **available** balances. Tokens move between public and confidential state with deposit and withdraw. Deposits and withdrawals carry cleartext amounts; confidential transfers do not.
Source: same as A1.
**VERIFIED** 2026-09-26 · devnet and localnet · G1 part 3, task 7 and 8 (deposit, apply, confidential transfer, apply, withdraw with `spl-token` 5.6.1; public balances move only on deposit and withdraw).

A3. The `ConfidentialTransferAccount` extension stores: `elgamal_pubkey`, `pending_balance_lo`, `pending_balance_hi`, `available_balance` (ElGamal ciphertexts), `decryptable_available_balance` (AES ciphertext), `allow_confidential_credits`, `allow_non_confidential_credits`, `pending_balance_credit_counter`, `maximum_pending_balance_credit_counter`. When the credit counter reaches the maximum, the account cannot receive more confidential credits until the owner applies the pending balance.
Source: same as A1.
**VERIFIED** 2026-09-26 · devnet and localnet · G1 part 3, task 7 (fields shown by `spl-token display`; the receiver's credit counter is 1 after a transfer and resets on apply; `spl-token` 5.6.1 configures a maximum of 65536). The credit limit behavior itself was not exercised.

A4. Display the available balance by decrypting `decryptable_available_balance` with the AES key (constant time). Decrypting ElGamal ciphertexts requires a discrete log and must not be used for routine display.
Source: same as A1.

A5. A confidential transfer needs three client side proofs: ciphertext commitment equality, batched grouped ciphertext 3 handles validity, and batched range proof (U128 in the transfer path). Proofs are usually placed in proof context state accounts, referenced by the transfer, then closed. A withdraw needs an equality proof and a range proof.
Source: same as A1.
**VERIFIED (structure)** 2026-09-26 · localnet and devnet · G1 part 3, task 7: with `spl-token` 5.6.1 and legacy transactions a transfer took 8 transactions (a record account and two proof context accounts created, one range proof verification from the record account, the `Transfer` instruction at 15096 CU, three closes) and a withdraw took 6. Which proof type sits in which account was not decoded.

A6. Configuring an account requires the account owner to sign and to supply a proof of ownership of the ElGamal public key. A third party can create and fund the bare token account but cannot configure it without the owner.
Source: same as A1.

A7. The ElGamal registry (`spl-elgamal-registry` program, Rust `ConfigureAccountWithRegistry`) lets a user register an ElGamal key once so third parties can configure accounts later without the owner. As of the source date, the JS client did **not** expose registry helpers.
Source: same as A1. **RE-VERIFY** at scaffold: check the current `@solana-program/token-2022` release notes.

A8. A mint may set one **global auditor** ElGamal public key. Every transfer then also encrypts its amount to the auditor. The auditor sees all transfers on that mint.
Source: same as A1, and https://solana.com/docs/tokens/extensions/confidential-transfer/issuer-guide

A9. Libraries (names as published in the official guide):
- `@solana-program/token-2022`: instructions, state parsing, key derivation, high level helpers. Documented exports used by Sotto: from the subpath `@solana-program/token-2022/confidential`: `deriveConfidentialKeys`, `getApplyConfidentialPendingBalanceInstructionFromToken`, `getConfidentialTransferInstructionPlan`, `getConfidentialWithdrawInstructionPlan`; from the root `@solana-program/token-2022`: `fetchToken`, `identifyToken2022Instruction`, `Token2022Instruction`, `TOKEN_2022_PROGRAM_ADDRESS`. **VERIFIED (entry points)** 2026-09-26 against the installed 0.19.0 (`VERIFICATION-LOG.md`, step 0.4 inventory; Q-06). Gate G3 records the full signatures.
- `@solana/zk-sdk`: WASM encryption primitives and proof data. Documented: `AeCiphertext`, `ConfidentialKeys.fromIkm`, `ConfidentialKeys.fromPrf`, `CiphertextCommitmentEqualityProofData`, `BatchedGroupedCiphertext3HandlesValidityProofData`, `BatchedRangeProofU128Data`. The display example imports from `@solana/zk-sdk/bundler`.
- `@solana-program/zk-elgamal-proof`: proof verification instructions.
- `spl-token-client` (Rust): end to end helpers, including `confidential_transfer_configure_token_account_with_registry` and `confidential_transfer_transfer_with_fee`.
Source: same as A1. **RE-VERIFY** every export against the installed version before use (`node -e "console.log(Object.keys(require('<pkg>')))"` or read the package `.d.ts`).

A10. On 27 August 2026 the Solana changelog listed JavaScript SDK releases: Token-2022 Program v0.16.0, ZK ElGamal Proof Program v0.4.0, Token Wrap v2.7.0.
Source: https://solana.com/news/solana-changelog-august-27-2026. **RE-VERIFY** which npm package names these versions map to and use the latest stable at scaffold.

A11. Standard key derivation: the owner signs the constant message `solana-conf-bal/v1` once; both the ElGamal keypair and the AES key are derived from that signature. One wallet maps to one ElGamal keypair and one AES key across **all** mints and token accounts. Sharing these keys discloses every confidential account of that owner.
Source: same as A1.
Observation 2026-09-26 · G1 part 3, task 7 and 8: `spl-token` 5.6.1 configured wallet B with the same ElGamal public key on every mint, on localnet and devnet. This shows one key per wallet for the CLI; it does not show which derivation the CLI uses.

A12. The official guidance says wallets **should refuse** generic `signMessage` requests for messages starting with `solana-conf-bal/v1`, because that signature is key material. A dApp may therefore be unable to derive the standard keys through a generic wallet `signMessage` call.
Source: same as A1. This drives decision D-03.
**Observed** 2026-09-27 · devnet · Gate G2 (`VERIFICATION-LOG.md` step 0.6, row R4): Phantom, Solflare and Backpack (desktop Chrome extensions) allowed a generic `signMessage` of the exact bytes `solana-conf-bal/v1`; the signatures verified and were byte identical across the three wallets for the same seed. Phantom showed no warning; the popup text of the other two was not observed. The guidance above stays the source statement: a wallet may start refusing, which D-03 and `10-SECURITY.md` section 2 handle.

A13. Confidential keys can instead be derived from independent key material with `ConfidentialKeys.fromIkm` or `ConfidentialKeys.fromPrf` (WebAuthn PRF).
Source: same as A1.

## B. ZK ElGamal Proof program

B1. The ZK ElGamal Proof program is a native program that verifies the zero knowledge proofs used by Confidential Balances.
Source: https://www.helius.dev/blog/agave-v4-0
**VERIFIED** 2026-09-26 · mainnet, devnet, localnet · G1 part 1, task 2 and part 3, task 6: program ID `ZkE1Gama1Proof11111111111111111111111111111` (`solana-sdk-ids` 3.1.0, the version Agave v4.2.2 resolves), owner `NativeLoader1111111111111111111111111111111`, executable.

B2. It was disabled on mainnet at the start of epoch 805 on 19 June 2025 after a Fiat-Shamir transcript bug. Token-2022 was also upgraded to disable confidential transfers on 11 June 2025.
Source: https://solana.com/news/post-mortem-june-25-2025
**VERIFIED (disable gate)** 2026-09-26 · mainnet · G1 part 1, task 1: `disable_zk_elgamal_proof_program` activated at slot 347760000, epoch 805, first block time 2025-06-19 06:07:13 UTC. The Token-2022 upgrade date was not checked.

B3. **VERIFIED, replaces the earlier third party report.** The ZK ElGamal Proof program was re-enabled by the `reenable_zk_elgamal_proof_program` feature gate:
- mainnet: slot 424224000, epoch 982, **2026-06-04** 10:18:07 UTC;
- devnet: slot 455760000, epoch 1055, **2026-04-15** 19:07:58 UTC;
- localnet (`solana-test-validator` 4.2.2): active from slot 0.
Dates are the block time of the activation slot (each activation slot produced a block). The program works on all three clusters by the rule in B6, and a live end to end confidential transfer passed on devnet and localnet. Marketing copy must say "June 2026" (`13-COPY-CORRECTIONS.md` L1).
**VERIFIED** 2026-09-26 · mainnet, devnet, localnet · G1 part 1, task 1; part 3, tasks 6 to 8. Earlier source (consistent): https://dev.to/sulimanmukhtar/confidential-transfers-have-a-kill-switch-what-it-costs-you-5h39

B4. **CORRECTED 2026-09-26.** The older **ZK Token Proof** program address `ZkTokenProof1111111111111111111111111111111` (`solana-sdk-ids` 3.1.0) has **no account** on mainnet or devnet, and its gate `zk_token_sdk_enabled` (`zk1snxsc6Fh3wsGNbbHAJNHiJoYgF29mMnTSusGx5EJ`) reports inactive on both. It is not a stub that returns success, as this fact said before. The rule stays: never reference it. Any code or dependency that does is a critical bug.
**VERIFIED** 2026-09-26 · mainnet, devnet · G1 part 1, task 2 (Helius and public RPC `getAccountInfo` null). Earlier source: same as B3.

B5. A disable feature gate exists and was used once. Sotto must handle "proof program disabled" as a runtime condition: detect it, stop confidential operations, show a clear banner, keep public balances usable.
Source: same as B3.

B6. **Activation rule (VERIFIED from source).** Three feature gates control the ZK ElGamal Proof program. IDs from https://github.com/anza-xyz/agave/blob/v4.2.2/feature-set/src/lib.rs:
- `zk_elgamal_proof_program_enabled` = `zkhiy5oLowR7HY4zogXjCjeMXyruLqBwSWH21qcFtnv` (registers the builtin; https://github.com/anza-xyz/agave/blob/v4.2.2/builtins/src/lib.rs `enable_feature_id`);
- `disable_zk_elgamal_proof_program` = `zkdoVwnSFnSLtGJG7irJPEYUpmb4i7sGMGcnN6T9rnC`;
- `reenable_zk_elgamal_proof_program` = `zkexuyPRdyTVbZqEAREueqL2xvvoBhRgth9xGSc1tMN`.
The program processes instructions only when **enable is active, and either disable is inactive or re-enable is active**. Otherwise every instruction fails with "zk-elgamal-proof program is temporarily disabled" (`InvalidInstructionData`). Source: https://github.com/anza-xyz/agave/blob/v4.2.2/programs/zk-elgamal-proof/src/lib.rs lines 174 to 187. Enable activation: mainnet slot 315792000 (epoch 731, 2025-01-23), devnet slot 346032000 (epoch 801, 2024-12-10). The runtime detection in B5 must evaluate all three gates.
**VERIFIED** 2026-09-26 · mainnet, devnet, localnet · G1 part 1, task 1; part 3, task 6.

## C. Token Wrap program

C1. **CORRECTED 2026-09-26.** The canonical program ID declared in the Token Wrap source is `TwRapQCDhWkZRrDaHfZGuHxkZ91gHDRkyuzNqeU5MgR` (`spl-token-wrap` 1.0.0 `src/lib.rs:19`, the latest program crate; also `@solana-program/token-wrap` 2.7.1 `TOKEN_WRAP_PROGRAM_ADDRESS`), but **no program is deployed at that ID on mainnet or devnet** (see C5). Wrapped mint address is a PDA of seeds `["mint", unwrapped_mint, wrapped_token_program_id]` under the Token Wrap program. Wrapped mint authority is a PDA of `["authority", wrapped_mint]`. A backpointer PDA (`["backpointer", wrapped_mint]`) stores the unwrapped mint. Unwrapped tokens are held in an escrow, the associated token account of the wrapped mint authority for the unwrapped mint.
Sources: https://lib.rs/crates/spl-token-wrap-cli and https://docs.rs/crate/spl-token-wrap/latest/source/src/lib.rs
**VERIFIED (seeds, escrow owner)** 2026-09-26 · devnet (Sotto test deployment, C8) and localnet · G1 part 3, task D and task 8: `spl-token-wrap` 1.0.0 `src/lib.rs` lines 21 to 123; backpointer owned by the program and holding the unwrapped mint; escrow token owner equals the wrapped mint authority.

C2. Every Token-2022 wrapped mint gets `ConfidentialTransferMint` with: authority `None` (immutable), **no auditor**, and **auto approve** of new accounts.
Source: https://github.com/solana-program/token-wrap
**VERIFIED** 2026-09-26 · devnet (Sotto test deployment, C8) and localnet · G1 part 3, task D: `spl-token display` shows "Authority: authority disabled", "Account approve policy: auto", "Audit key: audits are disabled". Source: `processor.rs:807` always uses `DefaultToken2022Customizer` (`mint_customizer/default_token_2022.rs:38-46`). See C7 for the unused compliance customizer.

C3. If the unwrapped token has a freeze authority, that freeze authority is preserved on the wrapped token. (For USDC this means the USDC issuer's freeze authority applies to wrapped USDC.)
Source: https://lib.rs/crates/spl-token-wrap-cli
**VERIFIED** 2026-09-26 · devnet · G1 part 3, task D: the devnet wrapped USDC mint's freeze authority is `CJtyoKSLrktozQzjERTiK3btQtiTK3nN4QrqGHLidyCT`, equal to the devnet USDC freeze authority. Localnet with a mock mint showed the same behavior.

C4. `CreateMint` is permissionless; the caller pre-funds the mint account.
Source: https://lib.rs/crates/spl-token-wrap-cli
**VERIFIED** 2026-09-26 · devnet · G1 part 3, task D: wallet A created the wrapped mint; the CLI pre-funded the wrapped mint (2189480 lamports) and the backpointer (812800 lamports); the program checks rent pre-funding (`processor.rs:126-131, 169-174`).

C5. **CORRECTED 2026-09-26 (was RE-VERIFY).** Token Wrap is **not deployed** at `TwRapQCDhWkZRrDaHfZGuHxkZ91gHDRkyuzNqeU5MgR` on mainnet or devnet, as of 2026-09-26. Evidence: `getAccountInfo` returns null on both clusters (Helius and public RPC); `getSignaturesForAddress` returns no transactions on either cluster; https://www.solana-program.com/docs/token-wrap, section Deployments, says "Mainnet: (not yet deployed) · Testnet: (not yet deployed)". So no canonical wrapped USDC exists on any cluster; the mainnet canonical wrapped mint PDA `4gaM1o816Ma3utkudekQAZRJQc1fmTyMxnBoYJh6jRpG` does not exist. The Token Wrap program ID is a per cluster configuration value (D-01).
**VERIFIED** 2026-09-26 · mainnet, devnet · G1 part 1, task 2; part 3, task 4.

C6. **The Token Wrap program ID is compiled into the program.** `spl-token-wrap` 1.0.0 derives every PDA with its own `id()` (`src/lib.rs` lines 29, 83, 113) and validates accounts and signs with those PDAs (`processor.rs:68-84, 136-145` and the wrap, unwrap and metadata paths). The unmodified build deployed under any other ID cannot create a mint: a devnet simulation returned `PrivilegeEscalation` with PDAs derived under `TwRap…` and `WrappedMintMismatch` (custom error 0) with PDAs derived under the deployed ID. A redeploy under another ID requires changing the `declare_id!` line to that ID. `spl-token-wrap-cli` 2.0.0 has no program ID option and uses `spl_token_wrap::id()`, so it also needs a build against the patched crate. `@solana-program/token-wrap` 2.7.1 accepts `config.programAddress` in its generated instruction builders and PDA finders, but not in the `createMint` and `createEscrowAccount` helpers.
**VERIFIED** 2026-09-26 · devnet · G1 part 2, task D.

C7. The crate contains a second mint customizer, `compliance` (confidential transfer authority, auditor and a fixed freeze authority). It is **not reachable** through the program's instructions (CreateMint, Wrap, Unwrap, CloseStuckEscrow, SyncMetadataToToken2022, SyncMetadataToSplToken); only the crate's test `tests/test_compliance_customizer.rs` uses it. Using it requires a source change.
**VERIFIED** 2026-09-26 · source · G1 part 3, task D.

C8. **Sotto devnet test deployment (not canonical).** Program `EEvqpjNRQkNRwXzVziuTGGi1wYDiPv7haYVVu3XZCoQn`, upgrade authority wallet A `7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L`, ProgramData `FgxifZMddWjdh3xd4ks2T37nVhuGJNRiqYz3kqo5QNEZ`, built from `spl-token-wrap` 1.0.0 with the one line `declare_id!` patch (`VERSIONS.md`), `.so` SHA-256 `533a3023040ee2a70f7687dcb1086462c5acd5960ad805327b708a02013eb22a`. Devnet wrapped USDC: mint `AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd`, mint authority `7ZnRqwgKPvXAM5e5owXaMM1LzpHXrUu3XQnrGfYBc2vw`, backpointer `88BAkeT6mVhiJotw9ecNSu7D4Y6Qi8s6X7yd8RpSQj4b`, escrow `hdJ9rkwLacnu7QFckNJiM6bEuduC4GU4q7W4NRDpwxW`. Wrap, confidential transfer and unwrap passed end to end. Localnet loads the same `.so` at the same ID.
**VERIFIED** 2026-09-26 · devnet, localnet · G1 part 3, tasks D, 4, 6, 8.

## D. Transactions

D1. Transaction format v1 raises the maximum size from 1232 to 4096 bytes (SIMD-0296, SIMD-0385). Legacy and v0 keep working.
Source: https://solana.com/de/upgrades/larger-transaction-sizes

D2. v1 was activated on mainnet at the start of epoch 1035 on 15 September 2026. RPC calls to `getBlock` and `getTransaction` must pass `maxSupportedTransactionVersion: 1` (integer) or they fail with error `-32015` on blocks containing v1 transactions.
Source: https://www.ankr.com/docs/changelog/solana-transaction-v1-2026-09-15/
**VERIFIED and REFINED** 2026-09-26 · mainnet, devnet · G1 part 1, task 1 and part 2, task 5: `enable_tx_v1` activated on mainnet at slot 447120000, epoch 1035, 2026-09-15 01:04:23 UTC. `getBlock` on blocks containing v1 transactions (Helius devnet and mainnet, public devnet) with `transactionDetails: "full"` succeeds with `maxSupportedTransactionVersion: 1` and fails with `-32015` "Transaction version (1) is not supported by the requesting client" with `0` or with the parameter omitted. With `transactionDetails: "signatures"` the same requests succeed: `-32015` occurs only when transactions are requested with full details. `getTransaction` was not tested for this.

D3. In v1, compute unit limit and loaded account data size move into a `TransactionConfigMask` inside the message instead of ComputeBudget instructions. v1 has no implicit defaults: omitted fields are treated as zero and the transaction fails. Feature gate: `txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL`.
Source: https://solanacompass.com/news/solana-v1-transactions-now-testable-locally-as-mainnet-activation-nears
**VERIFIED (feature gate ID only)** 2026-09-26 · G1 part 1, task 1: `enable_tx_v1` = `txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL` ("SIMD-0385: Transaction V1") in Agave v4.2.2 `feature-set/src/lib.rs`. The message format details were not verified.

D4. With v1, a confidential transfer can execute in a single onchain transaction. Without v1 it spans several dependent transactions (proof accounts, transfer, cleanup).
Source: A1 guide.

D5. v1 activation on devnet: **VERIFIED** 2026-09-26 · G1 part 1, task 1: slot 492480000, epoch 1140, 2026-09-03 11:38:04 UTC; localnet (`solana-test-validator` 4.2.2) active from slot 0. Sotto must support both paths. Note: `spl-token` 5.6.1 sent legacy transactions in G1 tasks 7 and 8.
**VERIFIED (wallets)** 2026-09-27 · devnet · Gate G2 (`VERIFICATION-LOG.md` step 0.6, rows R1, R8 to R10): `supportedTransactionVersions` of `solana:signTransaction` is `["legacy", 0, 1]` in Solflare (a v1 self transfer confirmed on devnet, `41vyVV2ADjfnzrJL6odXHqPaoUza67pDpRVZejNoC812RZV9R9k6UA1z8c8aZS2nqUgFVVW6REkpDXqw9xfp72j7`) and `["legacy", 0]` in Phantom (a v1 transaction fails with "Reached end of buffer unexpectedly") and Backpack (refuses v1 with `UnsupportedTransactionVersionError`). One `signTransaction` call with several transactions works for v0 in all three and for v1 in Solflare. Sotto picks the path per wallet from the declared versions (D-26).

## E. Solana Attestation Service (SAS)

E1. SAS associates offchain data with onchain accounts through credentials (an issuing authority with authorized signers), schemas (data layout) and attestations (signed claims with expiry and optional token account).
Source: https://solana.com/it/docs/tools/attestations

E2. Libraries: `sas-lib` (npm) and `solana-attestation-service-client` (Rust). `getCreateAttestationInstruction` takes payer, authority, credential, schema, attestation, systemProgram, nonce, data, expiry. `getCreateSchemaInstruction` takes name, description, layout, fieldNames.
Sources: https://solana.com/id/docs/tools/attestations/instructions/create-attestation and https://solana.com/vi/docs/tools/attestations/instructions/create-schema

E3. SAS program ID `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`, from `sas-lib` 1.0.10 (npm dist-tag `latest`; `SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS` in `dist/src/generated/programs/solanaAttestationService.js`, exported through `dist/src/index.d.ts`). Deployed on both clusters, upgradeable, same ProgramData `HqaxR5hg8yYyuM5QPiWMhSAvXGWwfDBbvthvYpqMQ73v`: mainnet authority `8b9gfG1UTVxaANPdrC19jnmd5XFeHFYei96eEjjFfiDP`, last deployed slot 345635788; devnet authority `47EDHLEkxw4ASr4HypUaHmnGmj7ZzRvv6HXkpXqUCfyQ`, last deployed slot 385530432. **RE-VERIFY** against the `sas-lib` version pinned at scaffold (the tarball was read, not installed).
**VERIFIED** 2026-09-26 · mainnet, devnet · G1 part 1, task 2.

## F. Assets

F1. Sotto uses USDC wrapped into Token-2022 through Token Wrap (devnet and localnet: the test deployment in C8; mainnet: open, D-01 and Q-04). USDC mint addresses from Circle's official documentation, https://developers.circle.com/stablecoins/usdc-contract-addresses (row "Solana" in the mainnet table, row "Solana Devnet" in the testnet table):
- mainnet `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`: SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`), 6 decimals, mint authority `BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG`, freeze authority `7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar`;
- devnet `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`: SPL Token, 6 decimals, mint authority `GrNg1XM2ctzeE2mXxXCfhcTUbejM8Z4z4wNVTy2FjMEz`, freeze authority `CJtyoKSLrktozQzjERTiK3btQtiTK3nN4QrqGHLidyCT`.
Do not copy mint addresses from memory, blog posts or this repo without checking Circle's page again when configuring a new cluster.
**VERIFIED** 2026-09-26 · mainnet, devnet · G1 part 2, task 3.

F2. A read only survey of USD stablecoins that are Token-2022 mints on mainnet (PYUSD, USDG, USDP, AUSD; addresses from issuer documentation, every extension recorded) is in `VERIFICATION-LOG.md`, G1 part 3, task M. It records data only, no conclusions. USD1 (`USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB`, from World Liberty Financial's documentation) is an SPL Token mint, not Token-2022.
**VERIFIED** 2026-09-26 · mainnet · G1 part 3, task M.

## G. Explicitly unknown (verify before use)

- Browser performance of `@solana/zk-sdk` proof generation (time per transfer). Gate G3.
- Exact Rust module paths for proof context state parsing and ElGamal ciphertext arithmetic that `sotto_proofs` needs. Gate G4.
- Compute units used by `sotto_proofs::verify_balance_threshold`. Gate G4.
- The mainnet asset (D-01, Q-04). Canonical Token Wrap is not deployed (C5).

Resolved by Gate G2 on 2026-09-27 and moved out of this list: whether the tested wallets allow `signMessage` of `solana-conf-bal/v1` (A12) and sign v1 transactions, including batches (D5).

Resolved by Gate G1 on 2026-09-26 and moved out of this list: SAS program ID per cluster (E3), Token Wrap deployment (C5), USDC mints (F1), and the Token-2022, ZK ElGamal Proof and ZK Token Proof program IDs (H1).

## H. Programs and clusters (verified by Gate G1)

H1. Program IDs from pinned sources, confirmed on chain on 2026-09-26 (G1 part 1, task 2):

| Program | ID | Pinned source | Mainnet | Devnet |
|---|---|---|---|---|
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | `spl-token-2022-interface` 3.1.1 `src/lib.rs:29`, re-exported by `spl-token-2022` 11.1.0 | upgradeable, executable; ProgramData `DoU57AYuPFu2QU514RktNPG22QhApEjnKxnBcu4BHDTY`; authority `AeLmXCbPaQHGWRLr2saFsEVfmMNuKnxRAbWCT9P5twgz`; last deployed slot 427147035 | same ProgramData; authority `3URRPr96EV2wuNRgQKwQpuZitHHsVyDUen1eRSvEun9G`; last deployed slot 503153936 |
| ZK ElGamal Proof | `ZkE1Gama1Proof11111111111111111111111111111` | `solana-sdk-ids` 3.1.0 | native builtin (NativeLoader) | native builtin |
| ZK Token Proof (deprecated, never reference) | `ZkTokenProof1111111111111111111111111111111` | `solana-sdk-ids` 3.1.0 | no account | no account |
| Token Wrap (canonical) | `TwRapQCDhWkZRrDaHfZGuHxkZ91gHDRkyuzNqeU5MgR` | `spl-token-wrap` 1.0.0 `src/lib.rs:19` | not deployed | not deployed |
| SAS | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` | `sas-lib` 1.0.10 | see E3 | see E3 |

H2. Mainnet and devnet RPC nodes reported `"apiVersion":"4.3.0"` on 2026-09-26 (public RPC `getAccountInfo` responses). The pinned Agave CLI is 4.2.2 (`VERSIONS.md`).
**VERIFIED** 2026-09-26 · mainnet, devnet · G1 part 1, task 2.

H3. `solana-test-validator` 4.2.2 bundles Token-2022 from `program-binaries/src/programs/spl_token_2022-10.0.0.so` (Agave v4.2.2), built **without** the `zk-ops` feature: confidential `Deposit` and the other zk operations fail with `InvalidInstructionData` (`spl-token-2022` 10.0.0 `src/extension/confidential_transfer/processor.rs:1355-1364`). Confidential transfers on localnet need Token-2022 cloned from devnet (`--clone-upgradeable-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb --url https://api.devnet.solana.com`). Exact validator command: `VERSIONS.md`.
**VERIFIED** 2026-09-26 · localnet · G1 part 3, task 6.

H4. `spl-token` 5.6.1 closes the proof record and proof context accounts of a confidential transfer (and withdraw) to the **token account** of the sender (withdrawer), not to the wallet. The rent (about 8.5 million lamports per transfer on localnet, 6.2 million on devnet) stays in the token account and returns only when that token account is closed. Which close destination Sotto's own flows use is not decided yet (`06-CONFIDENTIAL-FLOWS.md`).
**VERIFIED** 2026-09-26 · localnet, devnet · G1 part 3, task 7.

H5. Devnet rent is lower than localnet rent for the same size (469 bytes: 3032760 lamports on devnet, 4155120 on localnet; `getMinimumBalanceForRentExemption`). Cost estimates must be computed per cluster with that RPC call, not from constants.
**VERIFIED** 2026-09-26 · devnet, localnet · G1 part 3, task 7.
