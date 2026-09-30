# 05 · Onchain program: `sotto_proofs`

## 1. Purpose and hard limits

`sotto_proofs` verifies that a Token-2022 confidential available balance is at least a threshold and writes a public `ProofRecord`. That is all.

Hard limits (tests must prove each one):
- It never holds, moves, mints, burns or freezes tokens.
- It never signs for or becomes authority of any token account.
- It performs no CPI except to the System Program for account creation.
- It stores no plaintext amounts other than the threshold the owner chose to prove.

## 2. Dependencies (resolve at Gate G4, pin, record in `VERSIONS.md`)

- No Anchor (D-16, decided at step 0.4): a native program on the solana-* crate versions that `spl-token-2022` 11.1.0 resolves (core program crates 3.x, `solana-address` 2.x). Built with `cargo-build-sbf` 4.1.0, tested with `cargo test`; TypeScript client generated with Codama from a hand written IDL.
- `spl-token-2022` for state parsing with extensions (`StateWithExtensions`, `ConfidentialTransferAccount`).
- The ZK ElGamal Proof program's state types for proof context accounts (`ProofContextState`, `ProofType`, and the context data structs for ciphertext commitment equality and batched range proofs). Expected location: the `solana-zk-sdk` crate. Confirm the exact module path on docs.rs for the pinned version.
- ElGamal ciphertext arithmetic that runs onchain through syscalls, the same code Token-2022 uses to subtract a plaintext amount from a ciphertext. Expected: the `spl-token-confidential-transfer-ciphertext-arithmetic` crate. Confirm function names on docs.rs.
Do not implement any curve arithmetic yourself.

Resolved at Gate G4 (step 2.2, facts K1 to K3, K8): the program depends on the interface crates `spl-token-2022` 11.1.0 itself resolves, not on `spl-token-2022` or `solana-zk-sdk`: `spl-token-2022-interface` =3.1.2 (`extension::{StateWithExtensions, BaseStateWithExtensions}`, `state::Account`, `extension::confidential_transfer::ConfidentialTransferAccount`, `id()`), `solana-zk-elgamal-proof-interface` =0.1.3 (`state::ProofContextState`, `proof_data::{ProofType, CiphertextCommitmentEqualityProofContext, BatchedRangeProofContext}`, `id()`), `solana-zk-sdk-pod` =0.1.2 (the pod ciphertext, public key and commitment types), `spl-token-confidential-transfer-ciphertext-arithmetic` =0.5.1 (`subtract_from`) and `bytemuck` =1.25.0, with the core crates already pinned. It is built with `cargo-build-sbf --arch v3`: the local validator refuses new SBPF v0 to v2 deployments (SIMD-0500), devnet accepts v3. The Rust test of section 7 that makes real proofs needs a proof generation crate whose proof data matches the runtime's verifier; step 2.7 chooses it (the arithmetic crate's own tests use `solana-zk-sdk` 6.0.1 and `spl-token-confidential-transfer-proof-generation` 0.6.0).

Built in step 2.7 (facts N1 to N5): the crates above plus `solana-clock` 3.2.1, `solana-sysvar` 3.1.1, `solana-rent` 3.1.0, `solana-cpi` 3.1.0, `solana-instruction` 3.5.1, `solana-sdk-ids` 3.1.0, `solana-sha256-hasher` 3.1.0, `solana-system-interface` 3.3.0 (its program ID only), `solana-define-syscall` 4.0.1 (`sol_log_data`) and `bytemuck` 1.25.2 (the runtime test crates need 1.25.2; G4 pinned 1.25.0). The program encodes its four System Program instructions itself: the crate's bincode builders doubled the build (82000 bytes against 44360); a property test checks both encodings are equal. The Rust tests' proofs come from `spl-token-confidential-transfer-proof-generation` 0.6.1 on `solana-zk-sdk` 7.0.1, dev-dependencies only: it works with the G4 pins (it outputs the `solana-zk-elgamal-proof-interface` 0.1.3 proof data types) and matches the verifier of the test runtime, `solana-program-test` 4.3.0 (facts N3), so the `solana-zk-sdk` fallback was not needed. The TypeScript client is `@sotto/sdk/proofs`, generated with Codama (`@codama/renderers-js` 2.5.0) from the hand written IDL `scripts/proofs-idl.ts` (`programs/sotto_proofs/idl/sotto_proofs.json`).

## 3. Accounts

### Config (PDA, seeds `["config"]`)
| Field | Type | Notes |
|-------|------|-------|
| version | u8 | 1 |
| admin | Pubkey | Must equal the program upgrade authority at init |
| wrapped_usdc_mint | Pubkey | Only this mint is accepted |
| paused | bool | Blocks new records when true |
| bump | u8 | |

### ProofRecord (PDA, seeds `["proof", token_account, nonce]`, nonce is 16 bytes)
| Field | Type | Notes |
|-------|------|-------|
| version | u8 | 1 |
| token_account | Pubkey | The proven account |
| owner | Pubkey | Token account owner at proof time |
| mint | Pubkey | Equals config mint |
| threshold | u64 | Base units (6 decimals for USDC) |
| slot | u64 | Clock slot at verification |
| unix_time | i64 | Clock unix timestamp |
| expiry | i64 | Chosen by owner, at most 365 days after `unix_time` |
| balance_ciphertext_hash | [u8; 32] | SHA-256 of the `available_balance` ciphertext bytes used |
| counterparty_hash | [u8; 32] | SHA-256 of (16 byte random salt concatenated with the UTF-8 counterparty label). The salt and the label are offchain (`proof_records.counterparty_salt`, `proof_records.counterparty_label`) |
| bump | u8 | |

Layout (step 2.7): the fields in the table order, packed without padding, integers little endian, a bool as one byte, an address as 32 bytes: Config is 67 bytes, ProofRecord 194. Neither carries a discriminator; the program creates no other account, the config is the PDA of `["config"]` and a record is any 194 byte account it owns. The record's nonce is not stored.

## 4. Instructions

Instruction data: one byte naming the instruction (0 `initialize_config`, 1 `set_paused`, 2 `verify_balance_threshold`, 3 `close_proof_record`), then the arguments packed without padding, integers little endian (a bool as one byte); any other length is refused with `InvalidInstructionData`. Malformed input that no check names returns the built in error: `NotEnoughAccountKeys`, `MissingRequiredSignature`, `InvalidSeeds` for an account that is not the expected PDA, `InvalidAccountOwner`, `InvalidAccountData`, `AccountAlreadyInitialized` for an existing config or record, `IncorrectProgramId` for another program in the System Program's place. A PDA someone funded before its creation is topped up, allocated and assigned instead of created.

### 4.1 `initialize_config(wrapped_usdc_mint)`
Signer must be the program's current upgrade authority (read the ProgramData account). Creates Config.
Accounts: `config` (mut, the PDA), `authority` (signer, becomes `admin`), `program_data` (the program's ProgramData account, the PDA of the program ID under the upgradeable loader; its header's upgrade authority must be `authority`, an immutable program has none), `payer` (signer, mut), `system_program`.

### 4.2 `set_paused(paused)`
Signer must be `config.admin`. Accounts: `config` (mut), `admin` (signer).

### 4.3 `verify_balance_threshold(threshold: u64, nonce: [u8; 16], expiry: i64, counterparty_hash: [u8; 32])`
Accounts: `config`, `owner` (signer), `token_account`, `equality_context`, `range_context`, `proof_record` (init), `payer` (signer, mut), `system_program`.

Checks, in this order, each with its own error:
1. `config.paused == false`.
2. `threshold > 0`.
3. `unix_time < expiry <= unix_time + 365 days`.
4. `token_account` is owned by the Token-2022 program, parses with extensions, `mint == config.wrapped_usdc_mint`, `owner == owner.key`, and has an approved `ConfidentialTransferAccount`.
5. `equality_context` is owned by the ZK ElGamal Proof program, its proof type is ciphertext commitment equality, its context state authority equals `owner`.
6. The equality context's ElGamal public key equals the token account's `elgamal_pubkey`.
7. The equality context's ciphertext equals `available_balance minus threshold`, computed onchain with the ciphertext arithmetic library (section 2).
8. `range_context` is owned by the ZK ElGamal Proof program, its proof type is the batched range proof used for the remaining balance in Token-2022 withdraw, `BatchedRangeProofU64` (Gate G4, facts K2), its context state authority equals `owner`.
9. The range context proves exactly one commitment with bit length 64, and that commitment equals the equality context's commitment. Any other used slot is an error.
10. Write the record, emit `ProofVerified { record, token_account, owner, threshold, slot, expiry }`.
The record PDA must be the one of `token_account` and `nonce` (`InvalidSeeds`); `balance_ciphertext_hash` is the SHA-256 of the 64 bytes of `available_balance`. The event is one `sol_log_data` call ("Program data:" log line) with seven fields: the bytes of `ProofVerified`, the record, the token account and the owner addresses, then threshold (u64), slot (u64) and expiry (i64) little endian (`proofVerifiedEvent` of `@sotto/sdk/proofs` reads it). The token account is read only: the program never writes it and the runtime would refuse a write to an account the program does not own.

### 4.4 `close_proof_record()`
Signer: `owner` of the record. Allowed only after `expiry` (error `NotExpired`). Closes the account, rent to owner.
Accounts: `proof_record` (mut), `owner` (signer, mut). The record may be closed from the clock's `unix_timestamp >= expiry` on; another signer than the record's owner gets `Unauthorized`. The account is emptied and given back to the System Program.

## 5. Errors

`Paused`, `ZeroThreshold`, `BadExpiry`, `WrongTokenProgram`, `WrongMint`, `WrongOwner`, `NotConfidential`, `NotApproved`, `WrongProofProgram`, `WrongProofType`, `WrongContextAuthority`, `PubkeyMismatch`, `CiphertextMismatch`, `RangeShape`, `CommitmentMismatch`, `Unauthorized`, `NotExpired`. As built (step 2.7), custom program errors 0 to 16 in this order (`programs/sotto_proofs/src/error.rs`, the IDL and the generated client's `SOTTO_PROOFS_ERROR__*` constants agree, checked by `scripts/test/proofs-idl.test.ts`).

## 6. Compute

Measure at Gate G4 with `solana-program-test` or LiteSVM and a real proof. Set the client's compute unit limit to measured value plus 20 percent. If the instruction exceeds the per instruction limit, split the check into a two step flow and document it here before implementing.

Measured at Gate G4 (step 2.2, facts K4): the checks 4 to 9 with real proofs on localnet take 4728 compute units (a probe program, `programs/g4_probe`, and `scripts/g4-probe-localnet.ts`, both removed in step 2.7 once `sotto_proofs` and its tests replaced them; the proofs come from the token-2022 withdraw proof builder, which makes the statement of 06 section 8). The whole instruction adds the config and clock reads, one SHA-256 and the record PDA creation, measured in step 2.7; it stays far below the 200000 unit default, so it is one instruction, no split. Measured in step 2.7 (facts N2): 12980 units on the Agave 4.2.2 test validator and on devnet, 13142 under `solana-program-test` 4.3.0, for a nonce whose record address has bump 255; each further bump try costs about 1500 (13142 to 22142 over 64 random nonces). The client picks such nonces (`recordNonce`) and its limit for a transaction that cannot be simulated first is 16000 (`VERIFY_BALANCE_THRESHOLD_COMPUTE_UNITS`); every simulated transaction takes its own simulation plus 20 percent (06 section 9).

## 7. Tests (all required)

- Happy path on localnet with real proofs generated by `@solana/zk-sdk` (TypeScript test) and by `solana-zk-sdk` (Rust test). The Rust test's proofs (founder, 2026-09-29, at the start of step 2.3): the proof generation crate that Token-2022's own client tooling uses to build withdraw proofs (expected `spl-token-confidential-transfer-proof-generation`), as a dev-dependency only, never in the program. Step 2.7 first verifies its name, that its version works with the interface crates pinned at G4 (facts K1) and that it produces `CiphertextCommitmentEquality` and `BatchedRangeProofU64` data for a withdraw of a given amount; if it conflicts with the pinned versions, the test falls back to `solana-zk-sdk` as a dev-dependency and the reason is recorded.
- Each error in section 5 has a negative test.
- A proof built for balance B fails after the balance changes (ciphertext mismatch).
- A context account created by another authority is rejected.
- Contexts owned by any program other than the ZK ElGamal Proof program, including the deprecated ZK Token Proof program address, are rejected.
- The program has no instruction that references a token program in a CPI (static test: grep the IDL and source).
- Fuzz the instruction data (threshold, expiry, nonce) with `proptest` or Trident.

Built in step 2.7 (`cargo test --locked -p sotto_proofs`, after `cargo-build-sbf --arch v3`; and the SDK's localnet test):
- the happy path with proofs from the proof generation crate: `tests/verify.rs` (the record's fields, its rent, the event line, the token account unchanged); with proofs from `@solana/zk-sdk` through the token-2022 withdraw proof builder on the Agave 4.2.2 test validator: `packages/sdk/test/proofs-localnet.test.ts` (the record read back with the Codama client, the event, every proof account closed and the token account's lamports unchanged, the close after expiry);
- every error: `tests/verify.rs` (checks 1 to 10, `NotExpired` and `Unauthorized` for the close) and `tests/config.rs` (`Unauthorized` for `initialize_config`, also for an immutable program, and for `set_paused`);
- a balance that changed after the proofs: `CiphertextMismatch` in `tests/verify.rs` (another ciphertext) and on localnet (1 wUSDC more deposited and applied);
- contexts verified by the ZK ElGamal Proof program for another authority: `WrongContextAuthority`, both contexts;
- contexts owned by the deprecated ZK Token Proof program (facts B4; the test names it through `solana_sdk_ids::zk_token_proof_program::ID`), Token-2022, the System Program or `sotto_proofs` itself: `WrongProofProgram`, both contexts;
- only System Program calls: the static test `tests/static_limits.rs` (every cross program call inside `invoke_system`, which refuses any other program; no token instruction built, the token account never written; the IDL names no token program and passes the token account read only) and at runtime the inner instructions of a verification (`tests/verify.rs`);
- `proptest`: instruction data decoding and round trips, the expiry rule over all times, the account layouts, and 48 runtime cases of arbitrary threshold, expiry and nonce against the outcome the checks predict (`tests/properties.rs`).

## 8. Post-hackathon design sketch: proof of income (do not build in the MVP)

Goal: prove "every month in the last N months, confidential payments from employer E to me summed to at least X".
Sketch:
- `record_payment` runs in the same transaction as the Token-2022 confidential transfer. It reads the instructions sysvar to confirm a Token-2022 confidential transfer instruction with the same source and destination exists in the transaction, and copies the destination amount ciphertexts from that transfer's validity proof context into a `PaymentRecord` PDA. It never CPIs into Token-2022.
- `verify_income_threshold` sums the destination ciphertexts of the month's records homomorphically, subtracts X, and checks an equality plus range proof exactly like 4.3.
This needs its own security review document before implementation.
