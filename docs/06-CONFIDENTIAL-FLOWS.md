# 06 · Confidential flows

All flows live in `packages/sdk`. Every function takes an explicit `cluster` config object whose program IDs were verified at startup (section 0). Use the high level helpers documented in facts A9 whenever they fit; drop to lower level builders only when a flow below says so. Verify every export name against the installed version before use (ENGINEERING-RULES.md rule 1).

## 0. Startup verification (every app load and every worker start)

For the active cluster, check and cache:
1. `TOKEN_2022_PROGRAM_ADDRESS`, the Token Wrap program, the ZK ElGamal Proof program, the SAS program and `sotto_proofs` are executable accounts.
2. The wrapped USDC mint PDA derived from (USDC mint, Token-2022 program) exists and has `ConfidentialTransferMint` with no auditor (facts C2). If it does not exist, the app offers `createWrappedMint` (owner pays) and does nothing else confidential until it exists.
3. RPC returns a v1 capable response (`getLatestBlockhash` plus a `getBlock` with `maxSupportedTransactionVersion: 1`).
Failure of 1 or 2 disables confidential features with a banner; failure of 3 switches to the v0 path and logs a warning.

## 1. Key derivation

```
unlockConfidentialKeys(wallet, scheme) -> { elgamalKeypair, aeKey }
```
- `standard_v1`: `deriveConfidentialKeys({ signer })` from `@solana-program/token-2022/confidential`.
- `sotto_ikm_v1`: message = UTF-8 `sotto-conf-keys/v1\n<ownerBase58>`, signature = wallet `signMessage(message)`, keys = `ConfidentialKeys.fromIkm(signature)` from `@solana/zk-sdk`. Rebuild WASM objects from bytes as the guide describes.
- Before first use on an account: derive, then compare the derived ElGamal public key with the `elgamal_pubkey` stored on the configured token account. Mismatch means wrong scheme or wrong wallet: stop, never proceed.

## 2. Viewing key derivation (application level)

```
unlockViewingKey(wallet) -> { x25519PublicKey, x25519SecretKey }
```
message = UTF-8 `sotto-view-key/v1\n<walletBase58>`; seed = HKDF-SHA256(ikm = signature, salt = "sotto", info = "x25519", 32 bytes); keypair = `crypto_box_seed_keypair(seed)` (libsodium). Registration stores the public key server side together with a signature by the wallet over `sotto-view-key-register/v1\n<publicKeyBase64>` so the server can prove the wallet published it.

## 3. Account setup

Preconditions: org active, keys unlocked.
1. Derive the Token-2022 associated token account for (owner, wUSDC mint).
2. If missing: create it (owner pays). Include the space for the confidential extension as required by the helper.
3. Configure Confidential Balances with the owner's ElGamal public key and AES encrypted zero balance, plus the pubkey validity proof, using the token-2022 client's configure instruction builder. Owner signs.
4. Read back. Assert: extension present, `elgamal_pubkey` equals derived key, account approved (auto approve per C2).
5. Store in DB: token account address, `key_scheme`, configured slot.
Idempotent: if already configured with the same key, skip; if configured with a different key, stop with a clear error.

## 4. Wrap and deposit

1. `wrap(amount)`: Token Wrap `Wrap` from the owner's USDC account into the owner's wUSDC account (public balance). Escrow and PDAs from facts C1.
2. `deposit(amount)`: Token-2022 confidential deposit from public wUSDC to pending. Amount is public by design (facts A2).
3. `applyPending()`: `getApplyConfidentialPendingBalanceInstructionFromToken` with the ElGamal secret and AES key. No proofs.
Steps 1 and 2 may share one transaction; step 3 must read fresh account state first.

## 5. Confidential transfer (one recipient)

Preconditions: recipient token account configured (`allow_confidential_credits` true, credit counter below maximum), sender available balance at least the amount (check with AES decrypt), screening passed, approvals satisfied.
1. If sender pending is non zero, apply first (section 4.3) and wait for confirmation.
2. `getConfidentialTransferInstructionPlan({ rpc, payer, sourceToken, mint, destinationToken, sourceTokenAccount, destinationTokenAccount, authority, amount, sourceElgamalKeypair, aesKey, auditorElgamalPubkey })`. `auditorElgamalPubkey` is `undefined` because the wrapped mint has no auditor (D-01).
3. Build transactions from the plan. If v1 is available and the plan fits in 4096 bytes, use one v1 transaction and set compute unit limit and loaded accounts data size in the v1 config mask (facts D3). Otherwise use the plan's multi transaction sequence with v0.
4. Sign (see section 7 for batches), send, confirm each at `confirmed`, then `finalized` before marking the payment settled.
5. After settlement: read the sender account, AES decrypt the new available balance, assert it equals previous minus amount. If not, raise an integrity alert.
6. Create disclosures (see `07-SELECTIVE-DISCLOSURE.md`).
Failure handling: if a transaction in a multi transaction plan fails after proof context accounts were created, run the plan's cleanup (close context accounts) and mark the attempt `failed_clean`. Never resend a transfer transaction without first checking chain state for that attempt's signature.

## 6. Withdraw and unwrap

1. Apply pending if needed.
2. `getConfidentialWithdrawInstructionPlan(...)` for the amount, then execute (v1 or v0 as above).
3. Token Wrap `Unwrap` from wUSDC to USDC.

## 7. Payroll batch (D-21)

Input: validated lines, each with a stable `line_id` and idempotency key.
1. Apply pending once. Read sender available balance ciphertext `B0` and plaintext `b0` (AES).
2. For each line i in order: build the transfer plan against a **simulated** source state where available balance ciphertext is `B(i-1)` and decryptable balance is re-encrypted `b(i-1)`. Compute `B(i)` locally with the ciphertext arithmetic the helper exposes, or, if the helper cannot take a simulated source state, prepare and execute lines one at a time (fallback, slower). Gate G3 decides which path is possible with the installed helpers; record the result.
3. Signing: if the wallet supports `signAllTransactions` for the transaction version used, request one signature batch per chunk of at most 10 lines; otherwise one prompt per line.
4. Send sequentially. Line i+1 is sent only after line i is `confirmed`. If a line fails, stop, mark the run `partially_settled`, and require the owner to resume. Resume recomputes from chain state; settled lines are skipped by checking their stored signatures.
5. Disclosures are created per settled line.

## 8. Proof of funds (client side)

Given threshold `X` (base units), the owner's token account and keys:
1. Apply pending if non zero and wait for confirmation. Read the account; take `available_balance` ciphertext `A` at slot `s`.
2. Compute `A' = A - X` (ElGamal ciphertext minus a plaintext amount). Decrypt `b = AES(decryptable_available_balance)`. If `b < X`, stop: **Not proven** (D-06). Nothing is sent.
3. Choose a fresh Pedersen opening `r`, commitment `C = Commit(b - X, r)`.
4. Build `CiphertextCommitmentEqualityProofData` proving `A'` (under the owner's ElGamal key) and `C` hide the same value.
5. Build a range proof over `C` for 64 bits using the batched range proof type that Token-2022 withdraw uses for the remaining balance (Gate G4 confirms the exact type).
6. Verify both proofs into two context state accounts (context authority = owner) with `@solana-program/zk-elgamal-proof` instructions.
7. Call `sotto_proofs::verify_balance_threshold` (spec in `05-ONCHAIN-PROGRAM.md`) in the same transaction when size allows (v1), otherwise in the next transaction.
8. Close both context accounts.
If the balance changes between step 1 and step 7, the program rejects the proof (ciphertext mismatch). The client re-reads and retries once, then asks the owner to pause payments while proving.

## 9. Transaction building rules

- Blockhash freshness: refetch per transaction; for batches, refetch per chunk.
- Priority fees: read recent prioritization fees for the involved accounts and set the 75th percentile, capped by config.
- Simulation: simulate every transaction before asking for a signature; show the decoded failure if simulation fails.
- Confirmation: `confirmed` for UI progress, `finalized` for the settled state and for disclosures.
- Every RPC read of blocks or transactions passes `maxSupportedTransactionVersion: 1` (facts D2).
