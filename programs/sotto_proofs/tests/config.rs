//! `initialize_config` and `set_paused` (docs/05 sections 4.1 and 4.2): the config is created only by
//! the program's current upgrade authority as read from its ProgramData account, once; an immutable
//! program has no authority to create it; only the admin pauses and unpauses.

mod common;

use common::*;
use solana_address::Address;
use solana_instruction::AccountMeta;
use solana_instruction_error::InstructionError;
use solana_keypair::Keypair;
use solana_program_test::ProgramTest;
use solana_signer::Signer;
use sotto_proofs::{error::SottoError, instruction as ix, state::Config};

#[tokio::test]
async fn the_upgrade_authority_creates_the_config_once() {
    let mut env = start(false).await;
    let authority = env.authority.insecure_clone();
    let payer = env.context.payer.pubkey();
    // Paid by another account than the authority.
    let instruction =
        ix::initialize_config(&env.program_id, &authority.pubkey(), &payer, &env.mint);
    env.send(std::slice::from_ref(&instruction), &[&authority])
        .await
        .unwrap();
    let (_, bump) = ix::config_address(&env.program_id);
    assert_eq!(
        env.config().await,
        Config {
            version: 1,
            admin: authority.pubkey(),
            wrapped_usdc_mint: env.mint,
            paused: false,
            bump,
        }
    );
    // A second time: the account exists.
    let other_mint = ix::initialize_config(
        &env.program_id,
        &authority.pubkey(),
        &payer,
        &Address::new_unique(),
    );
    let error = env.send(&[other_mint], &[&authority]).await.unwrap_err();
    assert_eq!(
        instruction_error(error),
        InstructionError::AccountAlreadyInitialized
    );
}

#[tokio::test]
async fn anyone_else_is_unauthorized_to_create_the_config() {
    let mut env = start(false).await;
    let stranger = Keypair::new();
    env.fund(&stranger);
    let instruction = ix::initialize_config(
        &env.program_id,
        &stranger.pubkey(),
        &stranger.pubkey(),
        &env.mint,
    );
    let error = env.send(&[instruction], &[&stranger]).await.unwrap_err();
    assert_eq!(custom_error(error), SottoError::Unauthorized as u32);
    assert!(env
        .account(ix::config_address(&env.program_id).0)
        .await
        .is_none());
}

#[tokio::test]
async fn refuses_a_program_data_account_that_is_not_the_programs() {
    let mut env = start(false).await;
    let authority = env.authority.insecure_clone();
    let instruction = with_account(
        ix::initialize_config(
            &env.program_id,
            &authority.pubkey(),
            &authority.pubkey(),
            &env.mint,
        ),
        2,
        AccountMeta::new_readonly(Address::new_unique(), false),
    );
    let error = env.send(&[instruction], &[&authority]).await.unwrap_err();
    assert_eq!(instruction_error(error), InstructionError::InvalidSeeds);
}

#[tokio::test]
async fn an_immutable_program_has_no_authority_to_create_the_config() {
    let program_id = Address::new_unique();
    let signer = Keypair::new();
    let mut test = ProgramTest::default();
    test.prefer_bpf(true);
    add_program(&mut test, &program_id, None);
    let context = test.start_with_context().await;
    let mut env = Env {
        context,
        sent: Default::default(),
        program_id,
        authority: signer.insecure_clone(),
        mint: Address::new_unique(),
    };
    env.fund(&signer);
    let instruction =
        ix::initialize_config(&program_id, &signer.pubkey(), &signer.pubkey(), &env.mint);
    let error = env.send(&[instruction], &[&signer]).await.unwrap_err();
    assert_eq!(custom_error(error), SottoError::Unauthorized as u32);
}

#[tokio::test]
async fn only_the_admin_pauses_and_unpauses() {
    let mut env = start(true).await;
    let authority = env.authority.insecure_clone();
    let stranger = Keypair::new();
    env.fund(&stranger);
    let error = env
        .send(
            &[ix::set_paused(&env.program_id, &stranger.pubkey(), true)],
            &[&stranger],
        )
        .await
        .unwrap_err();
    assert_eq!(custom_error(error), SottoError::Unauthorized as u32);
    assert!(!env.config().await.paused);
    env.send(
        &[ix::set_paused(&env.program_id, &authority.pubkey(), true)],
        &[&authority],
    )
    .await
    .unwrap();
    assert!(env.config().await.paused);
    env.send(
        &[ix::set_paused(&env.program_id, &authority.pubkey(), false)],
        &[&authority],
    )
    .await
    .unwrap();
    assert!(!env.config().await.paused);
}

#[tokio::test]
async fn refuses_a_config_that_is_not_the_programs_pda() {
    let mut env = start(true).await;
    let authority = env.authority.insecure_clone();
    // The real config's bytes at another address owned by the program.
    let config = env
        .account(ix::config_address(&env.program_id).0)
        .await
        .unwrap();
    let copy = Address::new_unique();
    env.set_account(&copy, &config);
    let instruction = with_account(
        ix::set_paused(&env.program_id, &authority.pubkey(), true),
        0,
        AccountMeta::new(copy, false),
    );
    let error = env.send(&[instruction], &[&authority]).await.unwrap_err();
    assert_eq!(instruction_error(error), InstructionError::InvalidSeeds);
}
