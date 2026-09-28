# 06 · Confidential flows

All flows live in `packages/sdk`. Every function takes an explicit `cluster` config object whose program IDs were verified at startup (section 0). Use the high level helpers documented in facts A9 whenever they fit; drop to lower level builders only when a flow below says so. Verify every export name against the installed version before use (ENGINEERING-RULES.md rule 1). Encodings: hashes are lowercase hex; base64 is RFC 4648 standard alphabet with padding.

## 0. Startup verification (every app load and every worker start)

For the active cluster, check and cache:
1. `TOKEN_2022_PROGRAM_ADDRESS`, the Token Wrap program, the ZK ElGamal Proof program, the SAS program and `sotto_proofs` are executable accounts.
2. The wrapped USDC mint PDA derived from (USDC mint, Token-2022 program) exists and has `ConfidentialTransferMint` with no auditor (facts C2). If it does not exist, the app offers `createWrappedMint` (owner pays) and does nothing else confidential until it exists.
3. RPC returns a v1 capable response (`getLatestBlockhash` plus a `getBlock` with `maxSupportedTransactionVersion: 1`).
Failure of 1 or 2 disables confidential features with a banner; failure of 3 switches to the v0 path and logs a warning.
Implementation (step 1.6, `@sotto/sdk/cluster/verify`): `verifyCluster(rpc, config, mints?)` returns the program checks, the wrapped mint status (`ok`, `missing`, `mismatch`, `invalid` with the reason, or `not_configured` when the cluster has no USDC mint, which the localnet bootstrap supplies through `mints`), whether the RPC serves version 1 blocks, and from those `confidentialEnabled` and `transactionPath`. The wrapped mint is derived under the cluster's Token Wrap program (`@sotto/sdk/wrap`), because the canonical program is not deployed (facts C5, C8). The `sotto_proofs` check joins when the program is deployed (Phase 2). Devnet passed on 2026-09-27 (read only). Since step 1.7 the setup page and the overview run it on the server at every load with the server's RPC (`apps/web/lib/server/network-view.ts`), because two of its reads (`getSlot`, `getBlocks`) are not on the `/rpc` allow list: the pages get the result, the USDC mint's token program and decimals, and the labels of 13 A25. A missing wrapped mint is offered for creation on the setup page (the owner's wallet pays; the server checks again after it lands), any other failure shows a banner and turns the confidential cards off, and an RPC that cannot be reached leaves the keys usable.

## 1. Key derivation

```
unlockConfidentialKeys(wallet, scheme) -> { elgamalKeypair, aeKey }
```
- `standard_v1`: `deriveConfidentialKeys({ signer })` from `@solana-program/token-2022/confidential`.
- `sotto_ikm_v1`: message = exactly this UTF-8 message of three lines separated by newlines (D-03):
  ```
  sotto-conf-keys/v1
  This signature unlocks your Sotto confidential balances. Sign it only in the official Sotto app.
  Wallet: <ownerBase58>
  ```
  signature = wallet `signMessage(message)`, keys = `ConfidentialKeys.fromIkm(signature)` from `@solana/zk-sdk`. Rebuild WASM objects from bytes as the guide describes.
- Before first use on an account: derive, then compare the derived ElGamal public key with the `elgamal_pubkey` stored on the configured token account. Mismatch means wrong scheme or wrong wallet: stop, never proceed.
- Implementation (step 1.5, `packages/sdk/src/keys`): `deriveStandardKeys(wallet, signature)` checks that the signature is the wallet's Ed25519 signature of exactly `solana-conf-bal/v1`, then runs `deriveConfidentialKeys` with a signer that replays that signature and refuses any other message. The wallet's `signMessage` output is used only if the signed bytes equal the requested bytes (`checkSignedMessage`). The key match (I-5) is `elgamalKeyMatches` and `assertElGamalKeyMatches`, and the crypto worker's `checkAccount` request; step 1.7 calls it before any use of an account. The `spl-token` CLI derives the same keys (facts A11); the unit tests use its test vector.
- One Unlock click (founder, 2026-09-28, step 1.8.1; `apps/web/lib/crypto-worker/unlock.ts`): the page asks the wallet for the signature of `solana-conf-bal/v1` and, only after it unlocked the confidential keys, for the viewing key signature of section 2, one popup after the other, with one explainer that says two popups follow and why (13 A36). The two derivations stay separate: the confidential keys come only from the first signature and the viewing key only from the second; neither is derived from the other. Both keys then live in the tab's key session under the same lock conditions (10 section 3). A refused or failed first signature unlocks nothing and the second is not asked for; a refused or failed second signature leaves the confidential keys unlocked, and the keys card says that the amounts the user keeps sealed and the payment details shared with them stay closed, with a button that asks for the viewing key signature alone.

## 2. Viewing key derivation (application level)

```
unlockViewingKey(wallet) -> { x25519PublicKey, x25519SecretKey }
```
message = UTF-8 `sotto-view-key/v1\n<walletBase58>`; seed = HKDF-SHA256(ikm = signature, salt = "sotto", info = "x25519", 32 bytes); keypair = `crypto_box_seed_keypair(seed)` (libsodium). Registration stores the public key server side together with a signature by the wallet over `sotto-view-key-register/v1\n<publicKeyBase64>` so the server can prove the wallet published it.
Implementation (step 1.5): `deriveViewingKey(wallet, signature)` (HKDF with WebCrypto, `libsodium-wrappers-sumo` 0.8.4) after checking the wallet's signature of the message; a test recomputes the key independently (HKDF, SHA-512 of the seed, X25519 with `node:crypto`).
Since step 1.8.1 the viewing key is unlocked by the same Unlock click as the confidential keys (section 1), as the second signature, and stays in the tab's key session with them; registering it then takes one signature (the registration message), because the tab already holds the key and its public key. Without an unlocked viewing key, "Create viewing key" still asks for both signatures and derives the key in a worker of its own that ends at once. If the tab's viewing key differs from the registered one (a wallet whose signature changed), the viewing key card says that data sealed to the registered key cannot be opened in this tab.

## 3. Account setup

Preconditions: org active, keys unlocked.
1. Derive the Token-2022 associated token account for (owner, wUSDC mint).
2. If missing: create it (owner pays). Include the space for the confidential extension as required by the helper.
3. Configure Confidential Balances with the owner's ElGamal public key and AES encrypted zero balance, plus the pubkey validity proof, using the token-2022 client's configure instruction builder. Owner signs.
4. Read back. Assert: extension present, `elgamal_pubkey` equals derived key, account approved (auto approve per C2).
5. Store in DB: token account address, `key_scheme`, configured slot.
Idempotent: if already configured with the same key, skip; if configured with a different key, stop with a clear error.
Implementation (step 1.7):
- Before the first account is configured, the wallet signs `solana-conf-bal/v1` a second time and the crypto worker compares it with the signature the keys came from; the worker keeps only the SHA-256 of that signature for this. A different signature refuses setup, explains why (a wallet whose signature changes derives other keys next time, and a balance under the first keys could no longer be read) and reports the wallet through `POST /wallet-reports` (founder, 2026-09-27).
- Steps 1 to 3 are `getCreateConfidentialTransferAccountInstructionPlan`, built in the crypto worker (`confidentialAccountSetupInstructions`, `@sotto/sdk/confidential`) with placeholder signers: one non divisible sequence of the idempotent associated account creation, the reallocation for `ConfidentialTransferAccount`, the configure instruction (encrypted zero balance, the default maximum credit counter of 65536) and the pubkey validity proof it reads one instruction later. The helper's RPC parameter is used only for proof context accounts (`@solana-program/zk-elgamal-proof` 0.4.0), so the worker passes one that fails if called. The worker posts the instructions as plain data (address and role per account, program, data), which the transaction publishes anyway; the page signs and sends them through the wallet path of section 9.
- Step 4 reads the account back (`accountSetupStatus`: extension, the derived key, approved) and the worker confirms the key (I-5). Step 5 is `POST /token-accounts`, which checks the account again with the server's RPC and records the slot of that read as `configured_slot` (the account was configured at or before it). An account configured with this wallet's keys but not recorded is recorded after the next unlock.
- Localnet tests: `packages/sdk/test/confidential-localnet.test.ts` (setup as one v1 transaction, idempotence, another key stops setup) and the browser flow in `tests/e2e/localnet/setup.spec.ts`.

## 4. Wrap and deposit

1. `wrap(amount)`: Token Wrap `Wrap` from the owner's USDC account into the owner's wUSDC account (public balance). Escrow and PDAs from facts C1.
2. `deposit(amount)`: Token-2022 confidential deposit from public wUSDC to pending. Amount is public by design (facts A2).
3. `applyPending()`: `getApplyConfidentialPendingBalanceInstructionFromToken` (import from `@solana-program/token-2022/confidential`) with the ElGamal secret and AES key. No proofs.
Steps 1 and 2 may share one transaction; step 3 must read fresh account state first.
Implementation (step 1.7): `wrapInstructions` (`@sotto/sdk/wrap`) builds `Wrap` with `getWrapInstruction` and every PDA under the cluster's Token Wrap program (the client's `singleSignerWrap` only knows the canonical ID), after an idempotent creation of the owner's wUSDC account; the owner signs as transfer authority. `confidentialDepositInstruction` needs no keys. The apply instruction is built in the crypto worker from account data the page read just before (`applyPendingBalanceInstruction`, after the key match). Since step 1.7.1 (founder, 2026-09-27) the owner funds in two signatures: step 1 wraps and deposits in one transaction when it fits the size limit of the wallet's transaction version (`wrapAndDepositTransactions`, `measureTransaction`: the message with its compute budget before it is prepared, against 1232 bytes for v0 and 4096 for v1; 588 and 557 bytes with the devnet mints), otherwise in two transactions, and the page says why and reports it (`funding_split`, 08 section 3); step 2 applies after a fresh read. The page shows "Step 1 of 2" and "Step 2 of 2" and reads every balance from chain again after each transaction (AC-04.4). A deposit of public wUSDC the owner already holds, and an apply of a pending balance, remain separate actions (the way back when the second of two transactions fails). A deposit counts as a credit of the pending balance credit counter (localnet test); the worker's `pending-credits` job flags an account at 80 percent of its maximum and the page then prompts the owner to apply (AC-04.3, 08 section 4).

## 5. Confidential transfer (one recipient)

Preconditions: recipient token account configured (`allow_confidential_credits` true, credit counter below maximum), sender available balance at least the amount (check with AES decrypt), screening passed, approvals satisfied.
1. If sender pending is non zero, apply first (section 4.3) and wait for confirmation.
2. `getConfidentialTransferInstructionPlan` (import from `@solana-program/token-2022/confidential`) with `({ rpc, payer, sourceToken, mint, destinationToken, sourceTokenAccount, destinationTokenAccount, authority, amount, sourceElgamalKeypair, aesKey, auditorElgamalPubkey })`. `auditorElgamalPubkey` is `undefined` because the wrapped mint has no auditor (D-01). This parameter list is illustrative: Gate G3 records the real signature of `getConfidentialTransferInstructionPlan` and this section is updated to match.
3. Build transactions from the plan. If v1 is available and the plan fits in 4096 bytes, use one v1 transaction and set compute unit limit and loaded accounts data size in the v1 config mask (facts D3). Otherwise use the plan's multi transaction sequence with v0.
4. Sign (see section 7 for batches), send, confirm each at `confirmed`, then `finalized` before marking the payment settled.
5. After settlement: read the sender account, AES decrypt the new available balance, assert it equals previous minus amount. If not, raise an integrity alert.
6. Create disclosures (see `07-SELECTIVE-DISCLOSURE.md`).
Failure handling: if a transaction in a multi transaction plan fails after proof context accounts were created, run the plan's cleanup (close context accounts) and mark the attempt `failed_clean`. Never resend a transfer transaction without first checking chain state for that attempt's signature.
Closing proof accounts: every proof context account (and any proof record account) is closed with the lamport destination set to the **fee payer wallet**, never to a token account, both on success and in cleanup. If the helper chooses the destination itself, override it or build the close instructions directly. Reason: `spl-token` 5.6.1 closes them into the sender's token account, which parks the rent there until the token account is closed (facts H4).
Transaction count observed in Gate G1 (CLI path, `spl-token` 5.6.1, legacy transactions): 8 transactions per confidential transfer and 6 per withdraw (facts A5). Step 1.9 measured the app path (facts A17): 1 transaction as v1, 5 as v0; Gate G3 still measures the browser timings.

Implementation (step 1.9; the real signature and plan of step 2 are facts A16, verified from the 0.19.0 source, which replaces the illustrative list above; `auditorElgamalPubkey` is left out and the decoded mint is passed, so the helper uses the mint's zero auditor key, D-01):
- `confidentialTransferPlan` (`@sotto/sdk/confidential`, where the keys live: the tab's crypto worker, or a keypair in tests) checks the sender's key against the account (I-5), that the recipient's account is approved, takes confidential credits and is below its credit maximum (else `recipient_not_ready`), and that the available balance decrypted with the AES key covers the amount (else `insufficient_balance`). A version 1 transaction takes the inline plan; a version 0 transaction takes the record variant, because the inline range proof transaction cannot hold the compute budget instructions of section 9. kit's transaction planner packs the plan into transactions measured with that budget (`planTransactions`), and each transaction is labeled as a proof, the transfer or the cleanup. The plan's own keypairs (proof context accounts, the record account and its authority) stay where the plan was built.
- The crypto worker makes no network calls: it asks the page for the rent of the accounts the plan creates (a `rent` message answered from `getMinimumBalanceForRentExemption`). The page sends the transactions in order (`sendTransferTransactions`): each goes through the rules of section 9 and the signed message check, then the worker adds the plan's signatures over the message the wallet returned (`cosign`), so a compute budget change by the wallet cannot invalidate them; the transfer transaction waits for `finalized`.
- Failure handling: a failed transaction names its step ("Step 3 of 5 (verifying a proof) failed: ..."), and `closeProofAccounts` closes the proof context and record accounts that exist, with their rent to the fee payer; the attempt is recorded `failed_clean`. A retry is a new attempt after a new authorization, which first reads the chain for the earlier attempt's transfer signature (08 section 3), and the worker's `confirm-executions` job settles a transfer that landed after all (I-7). The SDK localnet test forces a failure right before the transfer transaction (the recipient turns confidential credits off): the step is named, the accounts close, and both balances are unchanged.
- Step 5, the integrity check: the page reads the sender's account again after the transfer is finalized and compares the available balance with the previous one minus the amount; the result is recorded, and a mismatch is logged as `payment_integrity_alert` (no amount).
- Step 6: the self disclosure and the recipient disclosure (AC-06.4 Phase 1 part) are sealed in the worker to the owner's and the recipient's registered viewing keys after their registration signatures verify (I-8), and posted with one manifest the owner wallet signs (07 section 4). A recipient without a viewing key gets no disclosure yet.

## 6. Withdraw and unwrap

1. Apply pending if needed.
2. `getConfidentialWithdrawInstructionPlan(...)` (import from `@solana-program/token-2022/confidential`) for the amount, then execute (v1 or v0 as above).
3. Token Wrap `Unwrap` from wUSDC to USDC.

Implementation (step 1.10, AC-09.1; facts A18):
- The withdrawn amount is public onchain by design (facts A2); the remaining balance stays confidential. Nothing about a withdraw is stored by Sotto.
- `confidentialWithdrawPlan` (`packages/sdk/src/confidential/transfer.ts`) checks the source like a transfer (the wallet owns the account, it has a confidential balance, the keys derive its ElGamal key, I-5, and the available balance covers the amount), then builds the plan of step 2: as version 1 with the range proof inline (1 transaction), as version 0 with the range proof in an SPL Record account (4 transactions, facts A18, H9). It is packed and sent exactly like a transfer (section 5): the crypto worker builds it from account data the page just read (`withdrawPlan`), keeps the keypairs of the accounts it creates and adds their signatures after the wallet's, and a failed step is named and its proof accounts are closed with their rent to the fee payer.
- Step 1 runs in the page first: the account is read from chain, and a pending balance is applied (one wallet signature) and the account read again before the plan is built.
- Step 3 is `unwrapInstructions` (`packages/sdk/src/wrap`): the USDC associated account is created idempotently, then `Unwrap` of the same amount, signed by the wallet. Unwrapping is a choice in the form, on by default.
- The owner withdraws from a drawer on the overview; a recipient from the pay page (`/app/[org]/pay`, 09). Balances are read from chain after every step (AC-04.4).

## 7. Payroll batch (D-21)

Input: validated lines, each with a stable `line_id` and idempotency key.
1. Apply pending once. Read sender available balance ciphertext `B0` and plaintext `b0` (AES).
2. For each line i in order: build the transfer plan against a **simulated** source state where available balance ciphertext is `B(i-1)` and decryptable balance is re-encrypted `b(i-1)`. Compute `B(i)` locally with the ciphertext arithmetic the helper exposes, or, if the helper cannot take a simulated source state, prepare and execute lines one at a time (fallback, slower). Gate G3 decides which path is possible with the installed helpers; record the result.
3. Signing: if the wallet supports `signAllTransactions` for the transaction version used, request one signature batch per chunk of at most 10 lines (a 24 line run is 3 prompts); otherwise one prompt per transaction. Copy never promises a number of prompts. Gate G3 measures the time per line; chunk size is reduced so a chunk completes within 60 seconds. If a pre signed chunk's blockhash expires before sending, rebuild the remaining lines and prompt again. Durable nonces are out of MVP.
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
8. Close both context accounts with the lamport destination set to the fee payer wallet, never to a token account (section 5).
If the balance changes between step 1 and step 7, the program rejects the proof (ciphertext mismatch). The client re-reads and retries once, then asks the owner to pause payments while proving.

## 9. Transaction building rules

- Blockhash freshness: refetch per transaction; for batches, refetch per chunk.
- Priority fees: read recent prioritization fees for the involved accounts and set the 75th percentile, capped by config. Implementation (`packages/sdk/src/tx/compute-budget.ts`): the writable accounts of the transaction, the nearest rank 75th percentile, a default cap of 1,000,000 micro-lamports per compute unit, and a price of 0 when the RPC returns no samples.
- Compute budget (Q-08): every v0 transaction the app builds includes SetComputeUnitLimit (simulated units plus 20 percent rounded up, at most 1.4 million; the simulation runs with the 1.4 million limit) and SetComputeUnitPrice (the priority fee rule above). v1 transactions carry the same values in the config mask (facts D3). A wallet then has no reason to add its own; Phantom documents that it does not (`VERIFICATION-LOG.md` step 0.6).
- Signed message check (Q-08): after every `signTransaction`, compare the signed message with the message the app built:
  - Identical: proceed.
  - Different only in ComputeBudget instructions (and the ComputeBudget program key): log a warning, record the wallet name and the difference (the changed ComputeBudget instructions and their values, never amounts), and proceed.
  - Any other difference: refuse to send and show "Your wallet changed this transaction. It was not sent."
  The check is by content, never by wallet name (D-26); the wallet name is recorded only for diagnostics.
- Signing order (Q-08): the wallet signs through the `@solana/react` transaction signer (a modifying signer); ephemeral keypairs (proof context and record accounts) sign afterwards, over the message the wallet returned (`@solana/signers` uses modifying signers before partial signers).
- Simulation: simulate every transaction before asking for a signature; show the decoded failure if simulation fails.
- Confirmation: `confirmed` for UI progress, `finalized` for the settled state and for disclosures.
- Every RPC read of blocks or transactions passes `maxSupportedTransactionVersion: 1` (facts D2).
- Implementation (step 1.6, `@sotto/sdk/tx`): `prepareTransaction` applies these rules for a keypair or a wallet (fresh blockhash, capped 75th percentile fee over the writable accounts, simulation with the maximum limits, limit at the simulated units plus 20 percent). A v1 transaction carries the limit, a total priority fee of price times limit in lamports (rounded up) and a loaded account data limit at the simulated size plus 20 percent (at most 64 MiB, facts D3); v1 budgets both limits as zero when they are unset. Kit appends the ComputeBudget instructions of a v0 message after the app's instructions. `compareSignedMessage` implements the signed message check on decompiled messages: the ComputeBudget instructions and key, and the v1 config, are set aside and reported as budget changes; a message the wallet recompiled with the same content counts as the second case with no changes; versions other than 0 and 1, and address lookup tables, which Sotto does not build, count as changed. `decodeTransactionError` gives plain words, naming Token-2022, associated token and System program errors by the program of the failed instruction; simulation failures and failed transactions carry it. `waitForConfirmation` waits for `confirmed` or `finalized`; `sendWithKeypairSigners` sends v0 or v1. The browser path (step 1.7, `sendWithWallet`): the transaction is prepared with the wallet's address as fee payer, compiled, signed through the `@solana/react` modifying signer and compared before anything is sent; the page hears every comparison and reports budget changes and refusals with the wallet name, the Wallet Standard version it declares and its feature versions (`POST /wallet-reports`, 08 section 3; the Wallet Standard gives apps no wallet app version). The version is 1 only when the RPC serves version 1 (section 0) and the wallet declares it (D-26); otherwise 0. The signer hook refuses an account that does not offer the network's chain while rendering, so the page creates it only for `solana:devnet` or `solana:localnet` accounts that declare it.
