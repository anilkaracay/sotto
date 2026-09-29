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
**VERIFIED** 2026-09-27 · localnet, devnet (read only) · step 1.5: `spl-token` 5.6.1 derives the same keys as `deriveConfidentialKeys` of `@solana-program/token-2022` 0.19.0 for the same keypair. On localnet the CLI configured the fixed test keypair `EQMW3o1DVsB72Ej1RRRmHLW1XaEpbjLKrMHUbS8cRLZC` (seed: SHA-256 of the text `sotto-cli-key-check/v1`) with ElGamal public key `BxMVLbjVntF9DJtDjfpQLrgw4hopedMgNkZZKGcVkZp6`, equal to our derivation, and our AES key decrypted the decryptable available balance the CLI wrote (40000000 base units); on devnet the CLI configured accounts of wallets A and B in G1 hold the keys our derivation gives. In token-2022 0.19.0, `deriveConfidentialKeys` asks its signer for one signature of `ConfidentialKeys.signerMessage()` (the 18 bytes `solana-conf-bal/v1`) and returns `ConfidentialKeys.fromSignature(signature)`; in `@solana/zk-sdk` 0.5.3 `signerMessage` takes no argument.

A12. The official guidance says wallets **should refuse** generic `signMessage` requests for messages starting with `solana-conf-bal/v1`, because that signature is key material. A dApp may therefore be unable to derive the standard keys through a generic wallet `signMessage` call.
Source: same as A1. This drives decision D-03.
**Observed** 2026-09-27 · devnet · Gate G2 (`VERIFICATION-LOG.md` step 0.6, row R4): Phantom, Solflare and Backpack (desktop Chrome extensions) allowed a generic `signMessage` of the exact bytes `solana-conf-bal/v1`; the signatures verified and were byte identical across the three wallets for the same seed. Phantom showed no warning; the popup text of the other two was not observed. The guidance above stays the source statement: a wallet may start refusing, which D-03 and `10-SECURITY.md` section 2 handle.

A13. Confidential keys can instead be derived from independent key material with `ConfidentialKeys.fromIkm` or `ConfidentialKeys.fromPrf` (WebAuthn PRF).
Source: same as A1.

A14. Account setup with the token-2022 client: `getCreateConfidentialTransferAccountInstructionPlan` (0.19.0) returns one non divisible sequential plan of four instructions: `CreateAssociatedTokenIdempotent`, `Reallocate` for `ConfidentialTransferAccount`, `ConfigureConfidentialTransferAccount` (the AES encrypted zero balance, `maximumPendingBalanceCreditCounter` defaulting to 65536, the proof one instruction later) and `VerifyPubkeyValidity`. Its `rpc` parameter is read only when a proof context account is created (`@solana-program/zk-elgamal-proof` 0.4.0 `verifyPubkeyValidity`), which this plan does not do. The four fit one version 1 transaction.
**VERIFIED** 2026-09-27 · source (`dist/src/confidential.mjs`) and localnet · step 1.7 (`packages/sdk/test/confidential-localnet.test.ts`).

A15. A confidential deposit adds one to the account's `pendingBalanceCreditCounter`; applying the pending balance sets it back to 0 (`getApplyConfidentialPendingBalanceInstructionFromToken` sends the counter it read as the expected counter). With a maximum of 5, four deposits put the counter at 4, 80 percent.
**VERIFIED** 2026-09-27 · localnet · step 1.7 (the SDK and worker localnet tests).

A16. `getConfidentialTransferInstructionPlan` (token-2022 0.19.0) takes `{ sourceToken, mint, mintAccount?, destinationToken, sourceTokenAccount, auditorElgamalPubkey?, authority, amount, sourceElgamalKeypair, aesKey, multiSigners?, programAddress?, payer, rpc }` plus either `destinationTokenAccount` (and optionally `destinationElgamalPubkey`) or `destinationElgamalPubkey`; `rpc` needs `getMinimumBalanceForRentExemption` (rent of the proof context accounts) and `getAccountInfo` (only to fetch the mint when neither `auditorElgamalPubkey` nor `mintAccount` is given; a mint without an auditor gives the zero auditor key). The plan is a sequence of three parts: in parallel, the setup of three proof context accounts (each created from a new `generateKeyPairSigner()` keypair, which signs its creation, then verified: `CiphertextCommitmentEquality`, `BatchedGroupedCiphertext3HandlesValidity`, `BatchedRangeProofU128`); the `Transfer` instruction; in parallel, the three `CloseContextState` instructions with `destination: payer.address`, so the rent returns to the fee payer (06 section 5). The helper's own documentation says the inline range proof transaction sits close to the size limit and cannot take a compute unit limit instruction; `getConfidentialTransferWithRecordInstructionPlan` stages the range proof in an SPL Record account instead (record payer and rent receiver default to the payer, the record authority is another new keypair), with a record `Write` plan that packs its data over transactions. The context account sizes are exported by `@solana-program/zk-elgamal-proof` 0.4.0 (for example `BATCHED_RANGE_PROOF_CONTEXT_ACCOUNT_SIZE`, 297 bytes). Both close instructions name the closed account first.
**VERIFIED** 2026-09-28 · source (`dist/src/confidential.mjs`, `dist/types/confidentialTransferHelpers.d.ts`, the zk-elgamal-proof and record packages) and localnet · step 1.9.

A17. The app path of one confidential transfer on localnet (step 1.9, kit 8.3 `createTransactionPlanner`, every message measured with the compute budget of 06 section 9): version 1 with the range proof inline is **1 transaction** of 10 instructions, 2897 of 4096 bytes; version 0 with the range proof in a record account is **5 transactions** of 732, 956, 1232, 889 and 812 of 1232 bytes, the last holding the transfer and the four closes. The CLI path took 8 legacy transactions (A5).
**VERIFIED** 2026-09-28 · localnet · step 1.9 (`packages/sdk/test/transfer-localnet.test.ts`).

A18. `getConfidentialWithdrawInstructionPlan` (token-2022 0.19.0) takes `{ token, mint, tokenAccount, authority, amount, decimals, elgamalKeypair, aesKey, multiSigners?, programAddress?, payer, rpc }`, where `rpc` needs only `getMinimumBalanceForRentExemption`; its record variant `getConfidentialWithdrawWithRecordInstructionPlan` adds the optional `recordPayer`, `recordAuthority` and `recordRentReceiver`, with the same defaults as the transfer's. The plan is a sequence of three parts: in parallel, the setup of two proof context accounts (`CiphertextCommitmentEquality` and `BatchedRangeProofU64`); the `ConfidentialWithdraw` instruction with the new decryptable available balance encrypted with the AES key; in parallel, the two closes. The helper's documentation carries the same note as the transfer's about the inline range proof and the compute unit limit. The app path on localnet (step 1.10, measured with the compute budget of 06 section 9): version 1 with the range proof inline is **1 transaction** of 7 instructions, 1966 of 4096 bytes; version 0 with the range proof in a record account is **4 transactions** of 732, 1232, 825 and 618 of 1232 bytes. Token Wrap 2.7.1 `getUnwrapInstruction` burns the wrapped amount from the owner's wUSDC account and releases the same amount of USDC from the escrow to the owner's USDC account (accounts: escrow, recipient USDC account, wrapped mint authority PDA, unwrapped mint, wrapped token program, unwrapped token program, the owner's wUSDC account, wrapped mint, transfer authority); the app creates the USDC associated account idempotently first.
**VERIFIED** 2026-09-28 · source of `@solana-program/token-2022` 0.19.0 (`dist/src/confidential.mjs`, `getConfidentialWithdrawInstructionPlan` and `assembleConfidentialWithdrawPlan`), the `UnwrapInput` type of `@solana-program/token-wrap` 2.7.1, and localnet · step 1.10 (`packages/sdk/test/transfer-localnet.test.ts`, AC-09.1 for version 0 and 1).

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
Also 2026-09-27 · step 1.6: the published `spl-token-wrap-cli` 2.0.0 derives the canonical wrapped mint for devnet USDC (`find-pdas` prints `F7mhRgYbBVhzkUNRkvJfDDQG2iQoTw8yr1snUzH2Dhgt`), while the copy `scripts/build-token-wrap.sh --cli` builds against the patched crate derives the configured `AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd`. The JS client `@solana-program/token-wrap` 2.7.1 takes a program address in its PDA finders and instruction builders, but its `createMint` and `createEscrowAccount` helpers always use the canonical ID, so Sotto builds those steps itself (`@sotto/sdk/wrap`); the localnet bootstrap created a wrapped mint through the deployment with them, and the startup verification found it valid.

C9. `Wrap` through the Sotto deployment works with `getWrapInstruction(input, { programAddress })` and the wrapped mint, mint authority and escrow derived under that program (the escrow is the associated token account of the wrapped mint authority for the unwrapped mint, under the unwrapped mint's token program). The client's `singleSignerWrap` and `singleSignerUnwrap` resolve every PDA under the canonical ID (`@solana-program/token-wrap` 2.7.1 `resolveAddrs`), so they cannot address the deployment.
**VERIFIED** 2026-09-27 · source and localnet · step 1.7 (`wrapInstructions`, `@sotto/sdk/wrap`).

## D. Transactions

D1. Transaction format v1 raises the maximum size from 1232 to 4096 bytes (SIMD-0296, SIMD-0385). Legacy and v0 keep working.
Source: https://solana.com/de/upgrades/larger-transaction-sizes

Also 2026-09-27 · step 1.7.1: `@solana/kit` 8.3 measures these limits per version (`getTransactionSize`, `getTransactionSizeLimit`: `LEGACY_TRANSACTION_SIZE_LIMIT` 1232 for legacy and v0, `V1_TRANSACTION_SIZE_LIMIT` 4096 for v1). Sotto's combined wrap and deposit transaction, with its compute budget, measures 588 bytes as v0 and 557 bytes as v1 with the devnet mints (`measureTransaction`); 40 SOL transfers do not fit v0 and fit v1 (unit test).

D2. v1 was activated on mainnet at the start of epoch 1035 on 15 September 2026. RPC calls to `getBlock` and `getTransaction` must pass `maxSupportedTransactionVersion: 1` (integer) or they fail with error `-32015` on blocks containing v1 transactions.
Source: https://www.ankr.com/docs/changelog/solana-transaction-v1-2026-09-15/
**VERIFIED and REFINED** 2026-09-26 · mainnet, devnet · G1 part 1, task 1 and part 2, task 5: `enable_tx_v1` activated on mainnet at slot 447120000, epoch 1035, 2026-09-15 01:04:23 UTC. `getBlock` on blocks containing v1 transactions (Helius devnet and mainnet, public devnet) with `transactionDetails: "full"` succeeds with `maxSupportedTransactionVersion: 1` and fails with `-32015` "Transaction version (1) is not supported by the requesting client" with `0` or with the parameter omitted. With `transactionDetails: "signatures"` the same requests succeed: `-32015` occurs only when transactions are requested with full details. `getTransaction` was not tested for this.

D3. In v1, compute unit limit and loaded account data size move into a `TransactionConfigMask` inside the message instead of ComputeBudget instructions. v1 has no implicit defaults: omitted fields are treated as zero and the transaction fails. Feature gate: `txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL`.
Source: https://solanacompass.com/news/solana-v1-transactions-now-testable-locally-as-mainnet-activation-nears
**VERIFIED (feature gate ID only)** 2026-09-26 · G1 part 1, task 1: `enable_tx_v1` = `txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL` ("SIMD-0385: Transaction V1") in Agave v4.2.2 `feature-set/src/lib.rs`. The message format details were not verified.
**VERIFIED (config in practice)** 2026-09-27 · localnet (`solana-test-validator` 4.2.2) · step 1.6: `@solana/kit` 8.3 builds v1 messages with a config of `computeUnitLimit`, `heapSize`, `loadedAccountsDataSizeLimit` and `priorityFeeLamports` (a total fee in lamports, not a price per unit); its documentation states that an unset compute unit limit or loaded account data limit is budgeted as zero. A v1 transfer with the limit, the fee and a loaded data limit set from the simulation (the simulation reports `loadedAccountsDataSize`) landed, finalized, with those values in its config and no ComputeBudget instruction. The loaded account data limit is at most 64 MiB (`MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES`, `solana-program-runtime` 2.3.7 `execution_budget.rs`). For v0 messages kit appends the ComputeBudget instructions after the existing instructions (discriminators 1 heap frame, 2 unit limit, 3 unit price, 4 loaded data limit).

D4. With v1, a confidential transfer can execute in a single onchain transaction. Without v1 it spans several dependent transactions (proof accounts, transfer, cleanup).
Source: A1 guide.
**VERIFIED** 2026-09-28 · localnet · step 1.9: 1 transaction as v1, 5 as v0 (A17).

D5. v1 activation on devnet: **VERIFIED** 2026-09-26 · G1 part 1, task 1: slot 492480000, epoch 1140, 2026-09-03 11:38:04 UTC; localnet (`solana-test-validator` 4.2.2) active from slot 0. Sotto must support both paths. Note: `spl-token` 5.6.1 sent legacy transactions in G1 tasks 7 and 8.
**VERIFIED (wallets)** 2026-09-27 · devnet · Gate G2 (`VERIFICATION-LOG.md` step 0.6, rows R1, R8 to R10): `supportedTransactionVersions` of `solana:signTransaction` is `["legacy", 0, 1]` in Solflare (a v1 self transfer confirmed on devnet, `41vyVV2ADjfnzrJL6odXHqPaoUza67pDpRVZejNoC812RZV9R9k6UA1z8c8aZS2nqUgFVVW6REkpDXqw9xfp72j7`) and `["legacy", 0]` in Phantom (a v1 transaction fails with "Reached end of buffer unexpectedly") and Backpack (refuses v1 with `UnsupportedTransactionVersionError`); Backpack's declaration had changed to `["legacy", 0, 1]` by 2026-09-29 (see the step 2.1 observation below). One `signTransaction` call with several transactions works for v0 in all three and for v1 in Solflare. Sotto picks the path per wallet from the declared versions (D-26).
**Observed (Phase 1 exit run)** 2026-09-29 · devnet (`VERIFICATION-LOG.md` step 1.10, manual devnet run): Solflare signed every Sotto transaction of the run as version 1 and returned each message unchanged (no signed message comparison was reported): the account setup (4 instructions) for the owner and the recipient, wrap and deposit, apply, the confidential transfer (1 transaction of 10 instructions, A17) and the withdraw (1 transaction of 7 instructions, A18), and the unwrap. Backpack blocked the owner's confidential account setup transaction before signing, with its own screen "Transaction blocked! Unable to verify this transaction. It cannot be signed.", so a Backpack wallet cannot set up a Sotto account today (Q-15; the transaction version Sotto built for it is not logged).
**Observed (step 2.1, Q-15)** 2026-09-29 · devnet (`VERIFICATION-LOG.md` step 2.1): wallet capabilities change between wallet versions. Backpack declared `supportedTransactionVersions` `["legacy", 0]` for `solana:signTransaction` in Gate G2 (2026-09-27) and `["legacy", 0, 1]` for `solana:signTransaction` and `solana:signAndSendTransaction` on 2026-09-29 (the wallet lab's R1 row, reported by the founder), so Sotto now picks version 1 for it on devnet. This supports D-26: capabilities are read at runtime, never assumed per wallet name. Backpack checks every transaction with a security scan before signing; in its public source (`coral-xyz/backpack`, `packages/secure-ui`) the transactions go to a Blowfish scan whose URL is fixed to mainnet, and a BLOCK answer shows "Transaction blocked!" with the scan's critical warning. That source was last updated on 2024-08-12 (GitHub `pushed_at`), so it may not match the extension the founder uses, whose scan is closed source: the exact rule is unknown. Probes with the test wallet in Backpack, all built for devnet: a SOL self transfer (R7, `5g3a9Jcf…8TDg`), a transfer of 1 base unit of devnet USDC to itself (R11, devnet only mint and account, `mX69ur9B…mAJcE`) and one lone ZK ElGamal proof verification (R12, `5mR1zB9P…2BEi9`) were signed and confirmed, all version 0; Sotto's own account setup transaction for a fresh account of the test wallet (R13: creation of the associated account `4QHNHpkTVwssfTGM4ygotqKnf7Qiwq5FWifh9D16Z8aQ`, reallocation, `ConfigureAccount` and its pubkey validity proof, on the G1 Token-2022 test mint `4hteAX4eGnP5qyjYPhfnmnZ83uTVEy9RP3PKaZXHXejp` with confidential transfers, sent through Sotto's wallet path), which passes devnet simulation as version 1 and version 0, was blocked with "Unable to verify this transaction. It cannot be signed." and no approve option, and nothing was sent. So neither devnet only accounts nor a proof verification alone trigger the block; the confidential account setup does, under the closed scan.

## E. Solana Attestation Service (SAS)

E1. SAS associates offchain data with onchain accounts through credentials (an issuing authority with authorized signers), schemas (data layout) and attestations (signed claims with expiry and optional token account).
Source: https://solana.com/it/docs/tools/attestations

E2. Libraries: `sas-lib` (npm) and `solana-attestation-service-client` (Rust). `getCreateAttestationInstruction` takes payer, authority, credential, schema, attestation, systemProgram, nonce, data, expiry. `getCreateSchemaInstruction` takes name, description, layout, fieldNames.
Sources: https://solana.com/id/docs/tools/attestations/instructions/create-attestation and https://solana.com/vi/docs/tools/attestations/instructions/create-schema

E3. SAS program ID `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`, from `sas-lib` 1.0.10 (npm dist-tag `latest`; `SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS` in `dist/src/generated/programs/solanaAttestationService.js`, exported through `dist/src/index.d.ts`). Deployed on both clusters, upgradeable, same ProgramData `HqaxR5hg8yYyuM5QPiWMhSAvXGWwfDBbvthvYpqMQ73v`: mainnet authority `8b9gfG1UTVxaANPdrC19jnmd5XFeHFYei96eEjjFfiDP`, last deployed slot 345635788; devnet authority `47EDHLEkxw4ASr4HypUaHmnGmj7ZzRvv6HXkpXqUCfyQ`, last deployed slot 385530432. Re-verified against the installed `sas-lib` 1.0.10 on 2026-09-27: `apps/worker/test/sas-program.test.ts` and `sas-boundary.test.ts` compare the package constant with the cluster config.
**VERIFIED** 2026-09-26 · mainnet, devnet · G1 part 1, task 2. **VERIFIED** 2026-09-27 · installed package · G5 (step 1.1).

E4. SAS addresses and checks. Credential PDA `["credential", authority, name]`, created with the authority's signature. Schema PDA `["schema", credential, name, [version]]`: the program always creates version 1, and the credential authority signs. Attestation PDA `["attestation", credential, schema, nonce]`: `CreateAttestation` rejects any other address with custom error 2 `InvalidAttestation` (`create_attestation.rs` lines 71 to 83), and one of the credential's authorized signers must sign. `CloseAttestation` also needs an authorized signer and moves the attestation's lamports to the payer account; its event authority is `DzSpKpST2TSyrxokMXchFz3G2yn5WEGoxzpGEUDjCX4g`, the PDA of `["__event_authority"]`. The first byte of every account is its discriminator: credential 0, schema 1, attestation 2 (`state/discriminator.rs`). The Codama enum `SolanaAttestationServiceAccount` in `sas-lib` 1.0.10 orders them differently (Attestation 0, Credential 1, Schema 2) and must not be used to read account bytes. Custom errors: 0 InvalidCredential, 1 InvalidSchema, 2 InvalidAttestation, 3 InvalidAuthority, 4 InvalidSchemaDataType, 5 SignerNotAuthorized, 6 InvalidAttestationData, 7 InvalidEventAuthority, 8 InvalidMint, 9 InvalidProgramSigner, 10 InvalidTokenAccount, 11 SchemaPaused (`error.rs`).
Sources: https://github.com/solana-foundation/solana-attestation-service `master`, `program/src/processor/{create_credential,create_schema,create_attestation,close_attestation}.rs`, `program/src/state/{discriminator,schema}.rs`, `program/src/error.rs` (fetched 2026-09-27); `sas-lib` 1.0.10 `dist/src/pdas.js`. Behavior of the deployed program (E8): a create at the PDA of another nonce failed in simulation with custom error 2 on devnet and localnet; the discriminators were read from accounts it created on localnet.
**VERIFIED** 2026-09-27 · devnet, localnet · G5 (step 1.1).

E5. Schema layout codes and data encoding. The program's `SchemaDataTypes`: 0 U8, 1 U16, 2 U32, 3 U64, 4 U128, 5 I8, 6 I16, 7 I32, 8 I64, 9 I128, 10 Bool, 11 Char, 12 String, 13 VecU8, 14 VecU16, 15 VecU32, 16 VecU64, 17 VecU128, 18 VecI8, 19 VecI16, 20 VecI32, 21 VecI64, 22 VecI128, 23 VecBool, 24 VecChar, 25 VecString. `sas-lib` 1.0.10 (`dist/src/utils.js`, `compactLayoutMapping`) maps 0 to 23 the same way, but 24 to `Vec<String>` and 25 to a 4 byte char: codes 24 and 25 disagree with the program, so Sotto uses neither (`sotto.business.v1` uses 0, 8 and 12). The schema stores field names as consecutive UTF-8 strings, each with a u32 little endian length prefix, and the layout length must equal the number of field names. Attestation data is Borsh (`serializeAttestationData`): String as a u32 little endian length plus UTF-8 bytes, i64 as 8 bytes little endian (decoded as bigint), u8 as 1 byte. Example: `{org_id: "o", legal_name: "L", country: "ZZ", verified_at: 1, level: 1}` encodes to the 25 bytes `01000000 6f 01000000 4c 02000000 5a5a 0100000000000000 01` (`apps/worker/test/sas-boundary.test.ts`).
Sources: `program/src/state/schema.rs` (same repository and date as E4); `sas-lib` 1.0.10 `dist/src/utils.js`.
**VERIFIED** 2026-09-27 · devnet, localnet, unit test · G5 (step 1.1).

E6. `sas-lib` 1.0.10 depends on `@solana/kit ^5.0.0` (resolved 5.5.1, nested under `sas-lib`). Its instruction builders return plain objects whose account roles use the same `AccountRole` numbers as `@solana/kit` 8.3.0 (0 READONLY, 1 WRITABLE, 2 READONLY_SIGNER, 3 WRITABLE_SIGNER) and carry the signer object in the account meta. A kit 8.3.0 `KeyPairSigner` passes `sas-lib`'s signer check (kit 5 `isTransactionSigner`), and kit 8.3.0 `signTransactionMessageWithSigners` signs messages built from these instructions. The builders used by Sotto (create credential, create schema, create attestation, close attestation) are synchronous.
Sources: `sas-lib` 1.0.10 `dist/src/generated/shared/index.js` (`getAccountMetaFactory`) and `dist/src/generated/instructions/*.js`; `apps/worker/test/sas-boundary.test.ts` (D-24 conversion test); the G5 devnet transactions (E7).
**VERIFIED** 2026-09-27 · host, devnet · G5 (step 1.1).

E7. Sotto SAS setup on devnet: the SAS signer `CE2yDeympDQmYYM29eSth9i8XBN48nGPqodFg2ggxXqe` is the credential authority, its only authorized signer and the payer. Credential `sotto` at `4KX4P7he62x5x8X35vubNNhJRhV4vJXPGNsc8skPyKFT` (slot 504753613). Schema `sotto.business.v1` version 1 at `A4PX8yuPQYeZFqtPomd5E3Jce7dTuWktcnpzb9YCM4z3` (slot 504753623): layout `[12, 12, 12, 8, 0]`, field names `org_id, legal_name, country, verified_at, level`, not paused. Devnet rent: credential 1046480 lamports, schema 1717040, attestation 1762760 (returned when the attestation is closed). The addresses depend only on the program ID, the authority and the names, so a localnet ledger bootstrapped with the same signer has the same addresses.
**VERIFIED** 2026-09-27 · devnet · G5 (step 1.1); signatures in `VERIFICATION-LOG.md`.

E8. SAS on localnet: `scripts/localnet.sh` clones the program from devnet (`--clone-upgradeable-program 22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`). On 2026-09-27 `solana program dump` from localnet and from devnet both gave 135680 bytes with SHA-256 `afacc7215d6ab6759bcf5edb958a1ad1d9de7559d53ac807c6aa4775a1a5a357`. The clone follows devnet upgrades.
**VERIFIED** 2026-09-27 · localnet, devnet · step 1.1.

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

H7. `spl-token` 5.6.1 `withdraw-confidential-tokens <mint> ALL` fails with "ALL keyword is not currently supported for withdraw", although its `--help` says the amount "accepts keyword ALL". An amount above the available balance fails with `InsufficientFunds` and costs no lamports. There is no command that prints a decrypted confidential balance.
**VERIFIED** 2026-09-27 · localnet · step 1.5.

H8. `solana-keygen` 4.2.2 `recover 'prompt://?key=0/0'` derives the account at m/44'/501'/0'/0' (compared with an independent SLIP-0010 derivation of a throwaway phrase); `prompt://` without a path derives a different key. `recover <base58 keypair string>` writes the same keypair file. The confirmation "Continue? (y/n)" is read from standard input; the phrase prompt reads the terminal.
**VERIFIED** 2026-09-27 · host · step 1.5.

H9. The SPL Record program `recr1L3PCGKLbckBqMNcJhuuyU1zgo8nBhfLVsJNwr5` (the address in `@solana-program/record` 0.5.0) is an upgradeable program on devnet (programdata `2sCyyjQHA5Pw3xjhji51TLix8y58jG1b4CQqUW3fbhFf`, last deployed in slot 377465796, 30560 bytes); `scripts/localnet.sh` clones it, and on the local validator it is executable. **The program is required for the version 0 path**: a version 0 confidential transfer (A17) and a version 0 withdraw (A18) stage their range proof in a record account, so a wallet that signs only version 0 transactions cannot pay or withdraw on a cluster without it (founder, step 1.9 choice 1). Version 1 transactions do not use it. Its presence on mainnet is not checked yet: the read only presence check is part of the post-hackathon mainnet work (12, G7).
**VERIFIED** 2026-09-28 · devnet (read only, `solana program show`; read again in step 1.10: same programdata, slot 377465796 and 30560 bytes) and localnet · steps 1.9 and 1.10.

H6. Genesis hashes: devnet `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` (the Helius devnet RPC and the public devnet RPC agree), mainnet `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` (public mainnet RPC, read only `getGenesisHash`). Every localnet ledger has its own. Scripts that write to chain compare the endpoint's genesis hash with the cluster they were asked for and refuse mainnet (`clusterFromGenesisHash` in `packages/sdk/src/cluster/config.ts`, used by `bootstrap:sas`).
**VERIFIED** 2026-09-27 · devnet, mainnet (read only) · step 1.1.

## I. Browser runtime and wallets (verified in steps 1.5, 1.7 and 1.8)

I1. `@solana/zk-sdk` 0.5.3 runs inside a module Web Worker bundled by Turbopack (next 16.3.6), in `next dev` and in the production build. `@solana-program/token-2022/confidential` imports `@solana/zk-sdk/bundler`, whose `index.js` imports `index_bg.wasm` as a module; Turbopack emits it (production: `.next/static/chunks/<hash>.wasm`, byte identical to the package file, SHA-256 `802bd267…80c8`) and serves it as `application/wasm`. Loading took about 100 ms in dev and 170 ms in production on this machine, the derivation a few milliseconds. A worker module that imports the WASM statically attaches its message handler only after the WASM has loaded, and a message the page posts when it creates the worker is lost; the Sotto worker therefore attaches its handler first, reports ready, and loads the WASM on the first request.
**VERIFIED** 2026-09-27 · Chrome for Testing 153 · step 1.5.

I2. `libsodium-wrappers-sumo` 0.8.4 (ESM build, `crypto_box_seed_keypair`) works in Node 24 and in the same Turbopack Web Worker.
**VERIFIED** 2026-09-27 · step 1.5 (unit tests and the E2E viewing key registration).

I3. In `@solana/zk-sdk` 0.5.3, `ElGamalKeypair.fromSecretKey(secret)` borrows the secret key (the generated glue passes its pointer and does not take ownership), so the caller frees both objects.
**VERIFIED** 2026-09-27 · source (`dist/bundler/index_bg.js`) · step 1.7.

I4. Wallet Standard and `@solana/react` 8.3.0: a wallet's `version` is the version of the Wallet Standard it implements, "NOT a version of the Wallet" (`@wallet-standard/base` 1.1.1); apps get no wallet app version, only the wallet name and each feature's version (`getWalletFeature`). `useSignTransaction`, and with it `useWalletAccountTransactionSigner`, throws while rendering when the account does not list the chain passed to it. The modifying signer returns the transaction the wallet signed, with its own `messageBytes`, so the app can compare them with the message it built.
**VERIFIED** 2026-09-27 · source (`dist/index.browser.mjs`, type declarations) · step 1.7.

I5. An Ed25519 signature made with a random nonce instead of the RFC 8032 deterministic one verifies under WebCrypto (`@solana/kit` `verifySignature`) and libsodium like any other: a wallet that signs this way gives a different valid signature of `solana-conf-bal/v1` each time, and so different confidential keys. Sotto's test helper `randomizedEd25519Signature` makes such signatures with libsodium's scalar operations.
**VERIFIED** 2026-09-27 · Node 24 and Chrome for Testing · step 1.7 (unit tests and the localnet E2E determinism check).

I6. `libsodium-wrappers-sumo` 0.8.4 `crypto_box_seal(message, publicKey)` makes an anonymous sealed box of exactly the message length plus 48 bytes (`crypto_box_SEALBYTES` is 48: the ephemeral X25519 public key and the MAC), and `crypto_box_seal_open(ciphertext, publicKey, privateKey)` opens it only with the recipient's keypair; with another keypair it throws "incorrect key pair for the given ciphertext". Both work in the Turbopack Web Worker.
**VERIFIED** 2026-09-27 · Node 24.21.0 and Chrome for Testing · step 1.8 (a direct check, the SDK disclosure tests and the localnet E2E default amount sealed and opened in the tab's worker).

## J. Server runtime (verified in step 1.8)

J1. In Node 24 (undici), `new Response(body, { statusText })` requires the status text to be a ByteString: a character above U+00FF, for example "…" (U+2026), throws `TypeError: Cannot convert argument to a ByteString`, while Latin-1 is accepted. The Sotto API error format passes the error message as the status text (`apps/web/lib/server/errors.ts`), so API error messages must stay Latin-1; Sotto keeps them ASCII.
**VERIFIED** 2026-09-27 · Node 24.21.0 · step 1.8 (a direct check; found when the invite wrong wallet message contained a shortened address with "…").
