//! `verify_balance_threshold` and `close_proof_record` on the runtime with real proofs (docs/05
//! section 7): the happy path and its record and event, a negative test for every error of the checks
//! 1 to 10 in their order, a balance that changes between the proof and the verification, contexts of
//! another authority and of any other program (the deprecated ZK Token Proof program included), the
//! token account left untouched, only System Program calls, the close only after expiry (X-31) with
//! the rent to the owner, and the compute units of the whole instruction.

mod common;

use common::*;
use solana_address::Address;
use solana_instruction::AccountMeta;
use solana_instruction_error::InstructionError;
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_zk_elgamal_proof_interface::instruction::ProofInstruction;
use solana_zk_sdk::{
    encryption::{elgamal::ElGamalKeypair, pedersen::Pedersen},
    zk_elgamal_proof_program::build_batched_range_proof_u64_data,
};
use sotto_proofs::{error::SottoError, instruction as ix, processor::PROOF_VERIFIED_EVENT};

const DAY: i64 = 24 * 60 * 60;

fn code(error: SottoError) -> u32 {
    error as u32
}

#[tokio::test]
async fn verifies_a_real_proof_and_writes_the_record_and_event() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    let args = arguments(&mut env, &proven).await;
    let token_before = env.account(proven.token_address).await.unwrap();
    let result = env
        .send(
            &[verify_instruction(&env, &proven, &args)],
            &[&proven.owner],
        )
        .await
        .unwrap();

    let (record_address, bump) =
        ix::proof_record_address(&env.program_id, &proven.token_address, &args.nonce);
    let record = env.record(record_address).await;
    let clock: solana_clock::Clock = env.context.banks_client.get_sysvar().await.unwrap();
    assert_eq!(record.version, 1);
    assert_eq!(record.token_account, proven.token_address);
    assert_eq!(record.owner, proven.owner.pubkey());
    assert_eq!(record.mint, env.mint);
    assert_eq!(record.threshold, 7 * USDC);
    assert_eq!(record.slot, clock.slot);
    assert_eq!(record.unix_time, clock.unix_timestamp);
    assert_eq!(record.expiry, args.expiry);
    assert_eq!(
        record.balance_ciphertext_hash,
        solana_sha256_hasher::hash(&proven.available.to_bytes()).to_bytes()
    );
    assert_eq!(record.counterparty_hash, args.counterparty_hash);
    assert_eq!(record.bump, bump);
    let account = env.account(record_address).await.unwrap();
    assert_eq!(account.owner, env.program_id);
    let rent = env.context.banks_client.get_rent().await.unwrap();
    assert_eq!(
        account.lamports,
        rent.minimum_balance(sotto_proofs::state::ProofRecord::LEN)
    );

    // The token account is read only: same bytes, owner and lamports afterwards.
    assert_eq!(
        env.account(proven.token_address).await.unwrap(),
        token_before
    );

    // The event: "Program data:" with its fields, base64.
    let logs = result.metadata.unwrap().log_messages;
    let event = [
        PROOF_VERIFIED_EVENT.to_vec(),
        record_address.to_bytes().to_vec(),
        proven.token_address.to_bytes().to_vec(),
        proven.owner.pubkey().to_bytes().to_vec(),
        (7 * USDC).to_le_bytes().to_vec(),
        clock.slot.to_le_bytes().to_vec(),
        args.expiry.to_le_bytes().to_vec(),
    ]
    .iter()
    .map(|field| base64(field))
    .collect::<Vec<_>>()
    .join(" ");
    assert!(
        logs.contains(&format!("Program data: {event}")),
        "no ProofVerified event in {logs:#?}"
    );
}

#[tokio::test]
async fn calls_no_program_but_the_system_program() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    let args = arguments(&mut env, &proven).await;
    let logs = env
        .send(
            &[verify_instruction(&env, &proven, &args)],
            &[&proven.owner],
        )
        .await
        .unwrap()
        .metadata
        .unwrap()
        .log_messages;
    let inner: Vec<&String> = logs
        .iter()
        .filter(|line| line.ends_with(" invoke [2]"))
        .collect();
    assert_eq!(
        inner,
        vec![&format!(
            "Program {} invoke [2]",
            solana_system_interface::program::ID
        )],
        "{logs:#?}"
    );
    assert!(!logs.iter().any(|line| line.contains(" invoke [3]")));
}

#[tokio::test]
async fn measures_the_compute_units_of_the_whole_instruction() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    // 64 random nonces, then 64 whose record PDA has bump 255 (the SDK's recordNonce picks those):
    // each extra try of the bump search costs about 1500 units.
    let mut random = Vec::new();
    let mut first_try = Vec::new();
    while random.len() < 64 || first_try.len() < 64 {
        let args = arguments(&mut env, &proven).await;
        let (_, bump) =
            ix::proof_record_address(&env.program_id, &proven.token_address, &args.nonce);
        if random.len() == 64 && bump != 255 {
            continue;
        }
        let logs = env
            .send(
                &[verify_instruction(&env, &proven, &args)],
                &[&proven.owner],
            )
            .await
            .unwrap()
            .metadata
            .unwrap()
            .log_messages;
        let consumed: u64 = logs
            .iter()
            .find_map(|line| {
                line.strip_prefix(&format!("Program {} consumed ", env.program_id))
                    .and_then(|rest| rest.split(' ').next())
                    .and_then(|units| units.parse().ok())
            })
            .expect("a consumed line");
        if random.len() < 64 {
            random.push(consumed);
        } else {
            first_try.push(consumed);
        }
    }
    for units in [&mut random, &mut first_try] {
        units.sort_unstable();
    }
    println!(
        "verify_balance_threshold: random nonces min {} median {} max {}; bump 255 min {} max {} compute units",
        random[0], random[32], random[63], first_try[0], first_try[63]
    );
    // The client budget (06 section 9, the SDK's VERIFY_BALANCE_THRESHOLD_COMPUTE_UNITS) is the
    // cost with a bump 255 nonce plus 20 percent; this bound fails if the instruction grows past it.
    assert_eq!(first_try[0], first_try[63], "{first_try:?}");
    assert!(first_try[63] * 120 / 100 <= VERIFY_BUDGET, "{first_try:?}");
}

/// The SDK's `VERIFY_BALANCE_THRESHOLD_COMPUTE_UNITS`.
const VERIFY_BUDGET: u64 = 16_000;

#[tokio::test]
async fn check_1_refuses_while_paused() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    let authority = env.authority.insecure_clone();
    env.send(
        &[ix::set_paused(&env.program_id, &authority.pubkey(), true)],
        &[&authority],
    )
    .await
    .unwrap();
    let args = arguments(&mut env, &proven).await;
    let error = env
        .send(
            &[verify_instruction(&env, &proven, &args)],
            &[&proven.owner],
        )
        .await
        .unwrap_err();
    assert_eq!(custom_error(error), code(SottoError::Paused));
    // Unpaused, the same proofs verify.
    env.send(
        &[ix::set_paused(&env.program_id, &authority.pubkey(), false)],
        &[&authority],
    )
    .await
    .unwrap();
    env.send(
        &[verify_instruction(&env, &proven, &args)],
        &[&proven.owner],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn check_2_refuses_a_zero_threshold() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    let mut args = arguments(&mut env, &proven).await;
    args.threshold = 0;
    let error = env
        .send(
            &[verify_instruction(&env, &proven, &args)],
            &[&proven.owner],
        )
        .await
        .unwrap_err();
    assert_eq!(custom_error(error), code(SottoError::ZeroThreshold));
}

#[tokio::test]
async fn check_3_refuses_an_expiry_not_after_now_or_past_365_days() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    let now = env.now().await;
    for expiry in [now - 1, now, now + 365 * DAY + 1, i64::MAX] {
        let mut args = arguments(&mut env, &proven).await;
        args.expiry = expiry;
        let error = env
            .send(
                &[verify_instruction(&env, &proven, &args)],
                &[&proven.owner],
            )
            .await
            .unwrap_err();
        assert_eq!(
            custom_error(error),
            code(SottoError::BadExpiry),
            "expiry {expiry}"
        );
    }
    for expiry in [now + 1, now + 365 * DAY] {
        let mut args = arguments(&mut env, &proven).await;
        args.expiry = expiry;
        env.send(
            &[verify_instruction(&env, &proven, &args)],
            &[&proven.owner],
        )
        .await
        .unwrap();
    }
}

/// Replaces the token account with one of `shape` and returns the verification's error code.
async fn with_token(env: &mut Env, proven: &Proven, shape: TokenShape) -> u32 {
    let account = token_account(
        shape,
        &pod_pubkey(&proven.elgamal),
        &pod_ciphertext(&proven.available),
    );
    env.set_account(&proven.token_address, &account);
    let args = arguments(env, proven).await;
    let error = env
        .send(&[verify_instruction(env, proven, &args)], &[&proven.owner])
        .await
        .unwrap_err();
    custom_error(error)
}

#[tokio::test]
async fn check_4_refuses_a_token_account_that_is_not_the_owners_approved_confidential_wusdc() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    let correct = correct_shape(&env, &proven.owner.pubkey());
    for (shape, error) in [
        (
            TokenShape {
                program: TOKEN,
                ..correct
            },
            SottoError::WrongTokenProgram,
        ),
        (
            TokenShape {
                program: solana_system_interface::program::ID,
                ..correct
            },
            SottoError::WrongTokenProgram,
        ),
        (
            TokenShape {
                mint: Address::new_unique(),
                ..correct
            },
            SottoError::WrongMint,
        ),
        (
            TokenShape {
                owner: Address::new_unique(),
                ..correct
            },
            SottoError::WrongOwner,
        ),
        (
            TokenShape {
                confidential: false,
                ..correct
            },
            SottoError::NotConfidential,
        ),
        (
            TokenShape {
                approved: false,
                ..correct
            },
            SottoError::NotApproved,
        ),
    ] {
        assert_eq!(
            with_token(&mut env, &proven, shape).await,
            code(error),
            "{error:?}"
        );
    }
}

/// Copies a context account under another owner program and returns the verification's error code
/// with it in place of the equality (`slot` 3) or range (`slot` 4) context.
async fn with_context_owner(env: &mut Env, proven: &Proven, slot: usize, owner: Address) -> u32 {
    let source = if slot == 3 {
        proven.equality
    } else {
        proven.range
    };
    let mut account = env.account(source).await.unwrap();
    account.owner = owner;
    let copy = Address::new_unique();
    env.set_account(&copy, &account);
    let args = arguments(env, proven).await;
    let instruction = with_account(
        verify_instruction(env, proven, &args),
        slot,
        AccountMeta::new_readonly(copy, false),
    );
    custom_error(
        env.send(&[instruction], &[&proven.owner])
            .await
            .unwrap_err(),
    )
}

#[tokio::test]
async fn checks_5_and_8_refuse_contexts_of_any_other_program_the_deprecated_zk_token_proof_included(
) {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    let program_id = env.program_id;
    for owner in [
        DEPRECATED_ZK_TOKEN_PROOF,
        TOKEN_2022,
        solana_system_interface::program::ID,
        program_id,
    ] {
        for slot in [3, 4] {
            assert_eq!(
                with_context_owner(&mut env, &proven, slot, owner).await,
                code(SottoError::WrongProofProgram),
                "owner {owner}, slot {slot}"
            );
        }
    }
}

#[tokio::test]
async fn checks_5_and_8_refuse_a_context_of_the_wrong_proof_type() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    let args = arguments(&mut env, &proven).await;
    // The range context as the equality context, and the other way round.
    let swapped = verify_instruction(&env, &proven, &args);
    let as_equality = with_account(
        swapped.clone(),
        3,
        AccountMeta::new_readonly(proven.range, false),
    );
    let as_range = with_account(
        swapped,
        4,
        AccountMeta::new_readonly(proven.equality, false),
    );
    for instruction in [as_equality, as_range] {
        let error = env
            .send(&[instruction], &[&proven.owner])
            .await
            .unwrap_err();
        assert_eq!(custom_error(error), code(SottoError::WrongProofType));
    }
}

#[tokio::test]
async fn checks_5_and_8_refuse_contexts_created_by_another_authority() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    let other = Keypair::new();
    env.fund(&other);
    // The same valid proofs, verified into contexts whose authority is someone else.
    let equality = verify_context(
        &mut env,
        ProofInstruction::VerifyCiphertextCommitmentEquality,
        &proven.equality_data,
        EQUALITY_CONTEXT_LEN,
        &other,
    )
    .await;
    let range = verify_context(
        &mut env,
        ProofInstruction::VerifyBatchedRangeProofU64,
        &proven.range_data,
        RANGE_CONTEXT_LEN,
        &other,
    )
    .await;
    let args = arguments(&mut env, &proven).await;
    for (slot, context) in [(3, equality), (4, range)] {
        let instruction = with_account(
            verify_instruction(&env, &proven, &args),
            slot,
            AccountMeta::new_readonly(context, false),
        );
        let error = env
            .send(&[instruction], &[&proven.owner])
            .await
            .unwrap_err();
        assert_eq!(
            custom_error(error),
            code(SottoError::WrongContextAuthority),
            "slot {slot}"
        );
    }
}

#[tokio::test]
async fn check_6_refuses_an_equality_context_under_another_elgamal_key() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    let other = ElGamalKeypair::new_rand();
    let account = token_account(
        correct_shape(&env, &proven.owner.pubkey()),
        &pod_pubkey(&other),
        &pod_ciphertext(&proven.available),
    );
    env.set_account(&proven.token_address, &account);
    let args = arguments(&mut env, &proven).await;
    let error = env
        .send(
            &[verify_instruction(&env, &proven, &args)],
            &[&proven.owner],
        )
        .await
        .unwrap_err();
    assert_eq!(custom_error(error), code(SottoError::PubkeyMismatch));
}

#[tokio::test]
async fn check_7_refuses_another_threshold_than_the_proven_one() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    for threshold in [7 * USDC + 1, 7 * USDC - 1, 1, u64::MAX] {
        let mut args = arguments(&mut env, &proven).await;
        args.threshold = threshold;
        let error = env
            .send(
                &[verify_instruction(&env, &proven, &args)],
                &[&proven.owner],
            )
            .await
            .unwrap_err();
        assert_eq!(
            custom_error(error),
            code(SottoError::CiphertextMismatch),
            "{threshold}"
        );
    }
}

#[tokio::test]
async fn check_7_refuses_a_proof_once_the_balance_has_changed() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    // A payment of 1 USDC in: the available balance ciphertext is now another one.
    let changed = proven.available + proven.elgamal.pubkey().encrypt(USDC);
    let account = token_account(
        correct_shape(&env, &proven.owner.pubkey()),
        &pod_pubkey(&proven.elgamal),
        &pod_ciphertext(&changed),
    );
    env.set_account(&proven.token_address, &account);
    let args = arguments(&mut env, &proven).await;
    let error = env
        .send(
            &[verify_instruction(&env, &proven, &args)],
            &[&proven.owner],
        )
        .await
        .unwrap_err();
    assert_eq!(custom_error(error), code(SottoError::CiphertextMismatch));
}

#[tokio::test]
async fn check_9_refuses_a_range_proof_of_another_shape_or_commitment() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    let remaining = 3 * USDC;
    // Two commitments of 32 bits each: valid proof, wrong shape.
    let (first, first_opening) = Pedersen::new(remaining);
    let (second, second_opening) = Pedersen::new(0u64);
    let two = build_batched_range_proof_u64_data(
        vec![&first, &second],
        vec![remaining, 0],
        vec![32, 32],
        vec![&first_opening, &second_opening],
    )
    .unwrap();
    // One commitment of 64 bits to the same amount, with another opening: another commitment.
    let (fresh, fresh_opening) = Pedersen::new(remaining);
    let other = build_batched_range_proof_u64_data(
        vec![&fresh],
        vec![remaining],
        vec![64],
        vec![&fresh_opening],
    )
    .unwrap();
    let owner = proven.owner.insecure_clone();
    for (data, error) in [
        (two, SottoError::RangeShape),
        (other, SottoError::CommitmentMismatch),
    ] {
        let range = verify_context(
            &mut env,
            ProofInstruction::VerifyBatchedRangeProofU64,
            &data,
            RANGE_CONTEXT_LEN,
            &owner,
        )
        .await;
        let args = arguments(&mut env, &proven).await;
        let instruction = with_account(
            verify_instruction(&env, &proven, &args),
            4,
            AccountMeta::new_readonly(range, false),
        );
        let failure = env
            .send(&[instruction], &[&proven.owner])
            .await
            .unwrap_err();
        assert_eq!(custom_error(failure), code(error), "{error:?}");
    }
}

#[tokio::test]
async fn check_10_refuses_a_record_address_that_is_not_the_nonces_pda() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    let args = arguments(&mut env, &proven).await;
    let instruction = with_account(
        verify_instruction(&env, &proven, &args),
        5,
        AccountMeta::new(Address::new_unique(), false),
    );
    let error = env
        .send(&[instruction], &[&proven.owner])
        .await
        .unwrap_err();
    assert_eq!(instruction_error(error), InstructionError::InvalidSeeds);
    // The same nonce twice: the record exists, the second is refused.
    env.send(
        &[verify_instruction(&env, &proven, &args)],
        &[&proven.owner],
    )
    .await
    .unwrap();
    let error = env
        .send(
            &[verify_instruction(&env, &proven, &args)],
            &[&proven.owner],
        )
        .await
        .unwrap_err();
    assert_eq!(
        instruction_error(error),
        InstructionError::AccountAlreadyInitialized
    );
}

#[tokio::test]
async fn creates_a_record_whose_address_someone_funded_first() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    let args = arguments(&mut env, &proven).await;
    let (record, _) = ix::proof_record_address(&env.program_id, &proven.token_address, &args.nonce);
    env.set_account(
        &record,
        &solana_account::Account::new(1_000, 0, &solana_system_interface::program::ID),
    );
    env.send(
        &[verify_instruction(&env, &proven, &args)],
        &[&proven.owner],
    )
    .await
    .unwrap();
    let account = env.account(record).await.unwrap();
    let rent = env.context.banks_client.get_rent().await.unwrap();
    assert_eq!(account.owner, env.program_id);
    assert_eq!(
        account.lamports,
        rent.minimum_balance(sotto_proofs::state::ProofRecord::LEN)
    );
}

#[tokio::test]
async fn requires_the_owners_signature() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    let args = arguments(&mut env, &proven).await;
    let instruction = with_account(
        verify_instruction(&env, &proven, &args),
        1,
        AccountMeta::new_readonly(proven.owner.pubkey(), false),
    );
    let error = env.send(&[instruction], &[]).await.unwrap_err();
    assert_eq!(
        instruction_error(error),
        InstructionError::MissingRequiredSignature
    );
}

#[tokio::test]
async fn closes_a_record_only_after_its_expiry_and_only_for_its_owner() {
    let mut env = start(true).await;
    let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
    let mut args = arguments(&mut env, &proven).await;
    let now = env.now().await;
    args.expiry = now + DAY;
    env.send(
        &[verify_instruction(&env, &proven, &args)],
        &[&proven.owner],
    )
    .await
    .unwrap();
    let (record, _) = ix::proof_record_address(&env.program_id, &proven.token_address, &args.nonce);
    let close = ix::close_proof_record(&env.program_id, &record, &proven.owner.pubkey());

    // Before the expiry, and at one second before: NotExpired (X-31).
    for time in [now, now + DAY - 1] {
        env.set_time(time).await;
        let error = env
            .send(std::slice::from_ref(&close), &[&proven.owner])
            .await
            .unwrap_err();
        assert_eq!(
            custom_error(error),
            code(SottoError::NotExpired),
            "time {time}"
        );
    }
    env.set_time(now + DAY).await;
    // Someone else: Unauthorized.
    let stranger = Keypair::new();
    env.fund(&stranger);
    let theirs = ix::close_proof_record(&env.program_id, &record, &stranger.pubkey());
    let error = env.send(&[theirs], &[&stranger]).await.unwrap_err();
    assert_eq!(custom_error(error), code(SottoError::Unauthorized));

    // The owner, at the expiry: closed, the rent to the owner.
    let rent = env.account(record).await.unwrap().lamports;
    let before = env.account(proven.owner.pubkey()).await.unwrap().lamports;
    env.send(&[close], &[&proven.owner]).await.unwrap();
    assert!(env.account(record).await.is_none());
    assert_eq!(
        env.account(proven.owner.pubkey()).await.unwrap().lamports,
        before + rent
    );
}

fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ALPHABET[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}
