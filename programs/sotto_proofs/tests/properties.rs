//! Property tests (docs/05 section 7: "Fuzz the instruction data (threshold, expiry, nonce)") with
//! `proptest`: any instruction data decodes without panicking and every valid one round trips; the
//! expiry rule of check 3 holds for every pair of times, overflow included; the account layouts round
//! trip; and on the runtime, with one set of real proofs, arbitrary thresholds, expiries and nonces
//! give exactly the outcome the checks 2, 3 and 7 predict, and every success writes its record at the
//! PDA of its nonce.

mod common;

use std::cell::RefCell;

use common::*;
use proptest::{prelude::*, test_runner::TestRunner};
use solana_address::Address;
use sotto_proofs::{
    error::SottoError,
    instruction::{self as ix, SottoInstruction},
    processor::check_expiry,
    state::{Config, ProofRecord, MAX_EXPIRY_SECONDS},
};

fn address() -> impl Strategy<Value = Address> {
    any::<[u8; 32]>().prop_map(Address::new_from_array)
}

proptest! {
    #[test]
    fn any_instruction_data_decodes_without_panicking(data in proptest::collection::vec(any::<u8>(), 0..128)) {
        let _ = SottoInstruction::unpack(&data);
    }

    #[test]
    fn verify_arguments_round_trip(threshold: u64, nonce: [u8; 16], expiry: i64, counterparty_hash: [u8; 32]) {
        let instruction = SottoInstruction::VerifyBalanceThreshold { threshold, nonce, expiry, counterparty_hash };
        let data = instruction.pack();
        prop_assert_eq!(data.len(), 1 + 8 + 16 + 8 + 32);
        prop_assert_eq!(SottoInstruction::unpack(&data).unwrap(), instruction);
        // One byte more or less is refused.
        prop_assert!(SottoInstruction::unpack(&data[..data.len() - 1]).is_err());
        let mut longer = data.clone();
        longer.push(0);
        prop_assert!(SottoInstruction::unpack(&longer).is_err());
    }

    #[test]
    fn the_other_instructions_round_trip(mint in address(), paused: bool) {
        for instruction in [
            SottoInstruction::InitializeConfig { wrapped_usdc_mint: mint },
            SottoInstruction::SetPaused { paused },
            SottoInstruction::CloseProofRecord,
        ] {
            prop_assert_eq!(SottoInstruction::unpack(&instruction.pack()).unwrap(), instruction);
        }
    }

    #[test]
    fn check_3_accepts_exactly_expiries_after_now_and_within_365_days(now: i64, expiry: i64) {
        let valid = now < expiry && i128::from(expiry) <= i128::from(now) + i128::from(MAX_EXPIRY_SECONDS);
        prop_assert_eq!(check_expiry(now, expiry).is_ok(), valid);
    }

    #[test]
    fn check_3_near_the_bounds(now in -10_000_000_000i64..10_000_000_000, offset in -5i64..5) {
        prop_assert_eq!(check_expiry(now, now + offset).is_ok(), offset > 0);
        let edge = now + MAX_EXPIRY_SECONDS + offset;
        prop_assert_eq!(check_expiry(now, edge).is_ok(), offset <= 0);
    }

    #[test]
    fn the_accounts_round_trip(
        admin in address(),
        mint in address(),
        paused: bool,
        bump: u8,
        token in address(),
        owner in address(),
        numbers: (u64, u64, i64, i64),
        hashes: ([u8; 32], [u8; 32]),
    ) {
        let config = Config { version: 1, admin, wrapped_usdc_mint: mint, paused, bump };
        prop_assert_eq!(Config::unpack(&config.pack()).unwrap(), config);
        let record = ProofRecord {
            version: 1,
            token_account: token,
            owner,
            mint,
            threshold: numbers.0,
            slot: numbers.1,
            unix_time: numbers.2,
            expiry: numbers.3,
            balance_ciphertext_hash: hashes.0,
            counterparty_hash: hashes.1,
            bump,
        };
        let packed = record.pack();
        prop_assert_eq!(ProofRecord::unpack(&packed).unwrap(), record);
        prop_assert!(ProofRecord::unpack(&packed[..ProofRecord::LEN - 1]).is_err());
        prop_assert!(Config::unpack(&packed).is_err());
    }
}

/// What the checks 2, 3 and 7 predict for these arguments and the proven threshold.
fn predicted(threshold: u64, proven: u64, now: i64, expiry: i64) -> Result<(), u32> {
    if threshold == 0 {
        return Err(SottoError::ZeroThreshold as u32);
    }
    if check_expiry(now, expiry).is_err() {
        return Err(SottoError::BadExpiry as u32);
    }
    if threshold != proven {
        return Err(SottoError::CiphertextMismatch as u32);
    }
    Ok(())
}

#[test]
fn arbitrary_threshold_expiry_and_nonce_on_the_runtime() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let (env, proven) = runtime.block_on(async {
        let mut env = start(true).await;
        let proven = prove(&mut env, 10 * USDC, 7 * USDC).await;
        (env, proven)
    });
    let state = RefCell::new(env);
    let threshold = prop_oneof![
        Just(0u64),
        Just(7 * USDC),
        Just(7 * USDC - 1),
        Just(7 * USDC + 1),
        any::<u64>(),
    ];
    let expiry_offset = prop_oneof![
        Just(0i64),
        Just(1),
        Just(MAX_EXPIRY_SECONDS),
        Just(MAX_EXPIRY_SECONDS + 1),
        -1_000i64..MAX_EXPIRY_SECONDS + 1_000,
    ];
    let mut runner = TestRunner::new(ProptestConfig::with_cases(48));
    runner
        .run(
            &(threshold, expiry_offset, any::<[u8; 16]>()),
            |(threshold, offset, nonce)| {
                let mut env = state.borrow_mut();
                runtime.block_on(async {
                    let now = env.now().await;
                    let args = Verify {
                        threshold,
                        nonce,
                        expiry: now.saturating_add(offset),
                        counterparty_hash: [9; 32],
                    };
                    let instruction = verify_instruction(&env, &proven, &args);
                    let outcome = env
                        .send(&[instruction], &[&proven.owner])
                        .await
                        .map(|_| ())
                        .map_err(custom_error);
                    prop_assert_eq!(outcome, predicted(threshold, 7 * USDC, now, args.expiry));
                    let (record, _) =
                        ix::proof_record_address(&env.program_id, &proven.token_address, &nonce);
                    if outcome.is_ok() {
                        let stored = env.record(record).await;
                        prop_assert_eq!(stored.threshold, threshold);
                        prop_assert_eq!(stored.expiry, args.expiry);
                    } else {
                        prop_assert!(env.account(record).await.is_none());
                    }
                    Ok(())
                })
            },
        )
        .unwrap();
}
