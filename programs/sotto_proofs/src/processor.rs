//! The four instructions of docs/05-ONCHAIN-PROGRAM.md section 4. The program only reads the token
//! account and the proof context accounts; it writes only the accounts it owns (the config and the
//! proof records). Its only cross program calls go to the System Program, to create those accounts,
//! through `invoke_system`, which refuses any other program (hard limits of section 1).

use solana_account_info::AccountInfo;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::{ProgramError, ProgramResult};
use solana_rent::Rent;
use solana_sysvar::Sysvar;
use solana_zk_elgamal_proof_interface::{
    proof_data::{
        BatchedRangeProofContext, CiphertextCommitmentEqualityProofContext, PodProofType, ProofType,
    },
    state::ProofContextState,
};
use solana_zk_sdk_pod::encryption::pedersen::PodPedersenCommitment;
use spl_token_2022_interface::{
    extension::{
        confidential_transfer::ConfidentialTransferAccount, BaseStateWithExtensions,
        StateWithExtensions,
    },
    state::Account,
};
use spl_token_confidential_transfer_ciphertext_arithmetic::subtract_from;

use crate::{
    error::SottoError,
    instruction::{config_address, program_data_address, proof_record_address, SottoInstruction},
    state::{Config, ProofRecord, CONFIG_SEED, MAX_EXPIRY_SECONDS, PROOF_SEED, VERSION},
};

/// The bit length Token-2022 withdraw proves for the remaining balance (facts K2).
const REMAINING_BALANCE_BIT_LENGTH: u8 = 64;
/// The bincode tag of `UpgradeableLoaderState::ProgramData` and the length of its header (a u32 tag,
/// the slot as u64, then an `Option<Address>`: one byte and 32), facts M4.
const PROGRAM_DATA_TAG: u32 = 3;
const PROGRAM_DATA_HEADER: usize = 45;
/// The first field of the `ProofVerified` event (docs/05-ONCHAIN-PROGRAM.md section 4.3, check 10).
pub const PROOF_VERIFIED_EVENT: &[u8] = b"ProofVerified";

pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    match SottoInstruction::unpack(instruction_data)? {
        SottoInstruction::InitializeConfig { wrapped_usdc_mint } => {
            initialize_config(program_id, accounts, wrapped_usdc_mint)
        }
        SottoInstruction::SetPaused { paused } => set_paused(program_id, accounts, paused),
        SottoInstruction::VerifyBalanceThreshold {
            threshold,
            nonce,
            expiry,
            counterparty_hash,
        } => verify_balance_threshold(
            program_id,
            accounts,
            threshold,
            nonce,
            expiry,
            counterparty_hash,
        ),
        SottoInstruction::CloseProofRecord => close_proof_record(program_id, accounts),
    }
}

/// 4.1: the signer must be the program's current upgrade authority, read from its ProgramData.
fn initialize_config(
    program_id: &Address,
    accounts: &[AccountInfo],
    wrapped_usdc_mint: Address,
) -> ProgramResult {
    let [config, authority, program_data, payer, system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signed(authority)?;
    signed(payer)?;
    if program_data.key != &program_data_address(program_id) {
        return Err(ProgramError::InvalidSeeds);
    }
    if program_data.owner != &solana_sdk_ids::bpf_loader_upgradeable::id() {
        return Err(ProgramError::InvalidAccountOwner);
    }
    if upgrade_authority(&program_data.try_borrow_data()?)? != Some(*authority.key) {
        return Err(SottoError::Unauthorized.into());
    }
    let (address, bump) = config_address(program_id);
    if config.key != &address {
        return Err(ProgramError::InvalidSeeds);
    }
    create_owned_account(
        payer,
        config,
        system_program,
        Config::LEN,
        program_id,
        &[CONFIG_SEED, &[bump]],
    )?;
    let state = Config {
        version: VERSION,
        admin: *authority.key,
        wrapped_usdc_mint,
        paused: false,
        bump,
    };
    config.try_borrow_mut_data()?.copy_from_slice(&state.pack());
    Ok(())
}

/// 4.2: the signer must be the config's admin.
fn set_paused(program_id: &Address, accounts: &[AccountInfo], paused: bool) -> ProgramResult {
    let [config, admin] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signed(admin)?;
    let mut state = load_config(program_id, config)?;
    if state.admin != *admin.key {
        return Err(SottoError::Unauthorized.into());
    }
    state.paused = paused;
    config.try_borrow_mut_data()?.copy_from_slice(&state.pack());
    Ok(())
}

/// 4.3: the checks 1 to 10, in this order, each with its own error.
fn verify_balance_threshold(
    program_id: &Address,
    accounts: &[AccountInfo],
    threshold: u64,
    nonce: [u8; 16],
    expiry: i64,
    counterparty_hash: [u8; 32],
) -> ProgramResult {
    let [config, owner, token_account, equality_account, range_account, record, payer, system_program] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signed(owner)?;
    signed(payer)?;
    let config = load_config(program_id, config)?;

    // 1. Not paused.
    if config.paused {
        return Err(SottoError::Paused.into());
    }
    // 2. A threshold above zero.
    if threshold == 0 {
        return Err(SottoError::ZeroThreshold.into());
    }
    // 3. unix_time < expiry <= unix_time + 365 days.
    let clock = Clock::get()?;
    check_expiry(clock.unix_timestamp, expiry)?;

    // 4. A Token-2022 account of the config's mint, owned by the signer, with an approved
    // confidential transfer extension.
    if token_account.owner != &spl_token_2022_interface::id() {
        return Err(SottoError::WrongTokenProgram.into());
    }
    let token_data = token_account.try_borrow_data()?;
    let token = StateWithExtensions::<Account>::unpack(&token_data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if token.base.mint != config.wrapped_usdc_mint {
        return Err(SottoError::WrongMint.into());
    }
    if token.base.owner != *owner.key {
        return Err(SottoError::WrongOwner.into());
    }
    let confidential = token
        .get_extension::<ConfidentialTransferAccount>()
        .map_err(|_| SottoError::NotConfidential)?;
    if !bool::from(confidential.approved) {
        return Err(SottoError::NotApproved.into());
    }

    // 5. The equality context: its program, its proof type, the owner as its authority.
    let equality_data = equality_account.try_borrow_data()?;
    let equality = context::<CiphertextCommitmentEqualityProofContext>(
        equality_account,
        &equality_data,
        ProofType::CiphertextCommitmentEquality,
        owner.key,
    )?;
    // 6. The token account's ElGamal public key.
    if equality.pubkey != confidential.elgamal_pubkey {
        return Err(SottoError::PubkeyMismatch.into());
    }
    // 7. The available balance minus the threshold, computed onchain.
    let remaining = subtract_from(&confidential.available_balance, threshold)
        .ok_or(SottoError::CiphertextMismatch)?;
    if equality.ciphertext != remaining {
        return Err(SottoError::CiphertextMismatch.into());
    }

    // 8. The range context: the batched range proof of Token-2022 withdraw (U64).
    let range_data = range_account.try_borrow_data()?;
    let range = context::<BatchedRangeProofContext>(
        range_account,
        &range_data,
        ProofType::BatchedRangeProofU64,
        owner.key,
    )?;
    // 9. Exactly one commitment of 64 bits, every other slot unused, and it is the equality
    // context's commitment.
    check_range(range, &equality.commitment)?;

    // 10. The record and the event.
    let (address, bump) = proof_record_address(program_id, token_account.key, &nonce);
    if record.key != &address {
        return Err(ProgramError::InvalidSeeds);
    }
    let balance_ciphertext_hash =
        solana_sha256_hasher::hashv(&[bytemuck::bytes_of(&confidential.available_balance)])
            .to_bytes();
    create_owned_account(
        payer,
        record,
        system_program,
        ProofRecord::LEN,
        program_id,
        &[PROOF_SEED, token_account.key.as_ref(), &nonce, &[bump]],
    )?;
    let state = ProofRecord {
        version: VERSION,
        token_account: *token_account.key,
        owner: *owner.key,
        mint: config.wrapped_usdc_mint,
        threshold,
        slot: clock.slot,
        unix_time: clock.unix_timestamp,
        expiry,
        balance_ciphertext_hash,
        counterparty_hash,
        bump,
    };
    record.try_borrow_mut_data()?.copy_from_slice(&state.pack());
    log_data(&[
        PROOF_VERIFIED_EVENT,
        record.key.as_ref(),
        token_account.key.as_ref(),
        owner.key.as_ref(),
        &threshold.to_le_bytes(),
        &clock.slot.to_le_bytes(),
        &expiry.to_le_bytes(),
    ]);
    Ok(())
}

/// 4.4: the record's owner closes it once it has expired (X-31); the rent goes to the owner.
fn close_proof_record(program_id: &Address, accounts: &[AccountInfo]) -> ProgramResult {
    let [record, owner] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signed(owner)?;
    if record.owner != program_id {
        return Err(ProgramError::InvalidAccountOwner);
    }
    let state = ProofRecord::unpack(&record.try_borrow_data()?)?;
    if state.owner != *owner.key {
        return Err(SottoError::Unauthorized.into());
    }
    if Clock::get()?.unix_timestamp < state.expiry {
        return Err(SottoError::NotExpired.into());
    }
    let lamports = record.lamports();
    **owner.try_borrow_mut_lamports()? = owner
        .lamports()
        .checked_add(lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    **record.try_borrow_mut_lamports()? = 0;
    record.resize(0)?;
    record.assign(&solana_system_interface::program::ID);
    Ok(())
}

/// Check 3: `now < expiry <= now + 365 days`.
pub fn check_expiry(now: i64, expiry: i64) -> ProgramResult {
    if now < expiry && expiry <= now.saturating_add(MAX_EXPIRY_SECONDS) {
        Ok(())
    } else {
        Err(SottoError::BadExpiry.into())
    }
}

/// Check 9 on a range context: bit length 64 in the first slot, nothing in the others, and the
/// equality context's commitment in the first.
pub fn check_range(
    range: &BatchedRangeProofContext,
    commitment: &PodPedersenCommitment,
) -> ProgramResult {
    let unused = <PodPedersenCommitment as bytemuck::Zeroable>::zeroed();
    if range.bit_lengths[0] != REMAINING_BALANCE_BIT_LENGTH
        || range.bit_lengths[1..].iter().any(|length| *length != 0)
        || range.commitments[1..].iter().any(|other| *other != unused)
    {
        return Err(SottoError::RangeShape.into());
    }
    if range.commitments[0] != *commitment {
        return Err(SottoError::CommitmentMismatch.into());
    }
    Ok(())
}

/// Checks 5 and 8 on a proof context account: owned by the ZK ElGamal Proof program (not the
/// deprecated ZK Token Proof program or any other), of the given proof type, with the owner as its
/// context state authority.
fn context<'a, T: bytemuck::Pod>(
    account: &AccountInfo,
    data: &'a [u8],
    proof_type: ProofType,
    owner: &Address,
) -> Result<&'a T, ProgramError> {
    if account.owner != &solana_zk_elgamal_proof_interface::id() {
        return Err(SottoError::WrongProofProgram.into());
    }
    // The proof type byte follows the 32 byte authority (facts K1).
    if data.get(32).copied() != Some(PodProofType::from(proof_type).0) {
        return Err(SottoError::WrongProofType.into());
    }
    let state = bytemuck::try_from_bytes::<ProofContextState<T>>(data)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if state.context_state_authority != *owner {
        return Err(SottoError::WrongContextAuthority.into());
    }
    Ok(&state.proof_context)
}

/// The config at the PDA of `["config"]`, owned by this program.
fn load_config(program_id: &Address, config: &AccountInfo) -> Result<Config, ProgramError> {
    if config.owner != program_id {
        return Err(ProgramError::InvalidAccountOwner);
    }
    let state = Config::unpack(&config.try_borrow_data()?)?;
    let address = Address::create_program_address(&[CONFIG_SEED, &[state.bump]], program_id)
        .map_err(|_| ProgramError::InvalidSeeds)?;
    if config.key != &address {
        return Err(ProgramError::InvalidSeeds);
    }
    Ok(state)
}

/// The upgrade authority in a ProgramData account's header, `None` for an immutable program.
pub fn upgrade_authority(data: &[u8]) -> Result<Option<Address>, ProgramError> {
    let header = data
        .get(..PROGRAM_DATA_HEADER)
        .ok_or(ProgramError::InvalidAccountData)?;
    let mut tag = [0u8; 4];
    tag.copy_from_slice(&header[0..4]);
    if u32::from_le_bytes(tag) != PROGRAM_DATA_TAG {
        return Err(ProgramError::InvalidAccountData);
    }
    match header[12] {
        0 => Ok(None),
        1 => {
            let mut key = [0u8; 32];
            key.copy_from_slice(&header[13..45]);
            Ok(Some(Address::new_from_array(key)))
        }
        _ => Err(ProgramError::InvalidAccountData),
    }
}

fn signed(account: &AccountInfo) -> ProgramResult {
    if account.is_signer {
        Ok(())
    } else {
        Err(ProgramError::MissingRequiredSignature)
    }
}

/// Creates an account owned by this program at a PDA of it, funded by the payer to be rent exempt.
/// A PDA that already holds lamports (sent by anyone to block its creation) is topped up, allocated
/// and assigned instead, since the System Program refuses to create an account with lamports.
fn create_owned_account<'a>(
    payer: &AccountInfo<'a>,
    target: &AccountInfo<'a>,
    system_program: &AccountInfo<'a>,
    space: usize,
    owner: &Address,
    seeds: &[&[u8]],
) -> ProgramResult {
    if system_program.key != &solana_system_interface::program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if target.owner != &solana_system_interface::program::ID || !target.data_is_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    let rent = Rent::get()?.minimum_balance(space);
    let current = target.lamports();
    let accounts = [payer.clone(), target.clone(), system_program.clone()];
    if current == 0 {
        let create = system::create_account(payer.key, target.key, rent, space as u64, owner);
        return invoke_system(&create, &accounts, seeds);
    }
    if current < rent {
        let top_up = system::transfer(payer.key, target.key, rent - current);
        invoke_system(&top_up, &accounts, &[])?;
    }
    let allocate = system::allocate(target.key, space as u64);
    invoke_system(&allocate, &accounts, seeds)?;
    let assign = system::assign(target.key, owner);
    invoke_system(&assign, &accounts, seeds)
}

/// The program's only cross program call: to the System Program, and nothing else.
fn invoke_system(
    instruction: &Instruction,
    accounts: &[AccountInfo],
    seeds: &[&[u8]],
) -> ProgramResult {
    if instruction.program_id != solana_system_interface::program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if seeds.is_empty() {
        solana_cpi::invoke(instruction, accounts)
    } else {
        solana_cpi::invoke_signed(instruction, accounts, &[seeds])
    }
}

/// The four System Program instructions the program uses, encoded as the System Program reads them
/// (a u32 variant index, then the fields little endian; `solana-system-interface` 3.3.0 encodes them
/// with bincode, which would add most of the program's size). `tests/system_encoding.rs` checks
/// that each equals the crate's own builder.
pub mod system {
    use super::{AccountMeta, Address, Instruction};
    use solana_system_interface::program::ID;

    const CREATE_ACCOUNT: u32 = 0;
    const ASSIGN: u32 = 1;
    const TRANSFER: u32 = 2;
    const ALLOCATE: u32 = 8;

    pub fn create_account(
        from: &Address,
        to: &Address,
        lamports: u64,
        space: u64,
        owner: &Address,
    ) -> Instruction {
        let mut data = Vec::with_capacity(52);
        data.extend_from_slice(&CREATE_ACCOUNT.to_le_bytes());
        data.extend_from_slice(&lamports.to_le_bytes());
        data.extend_from_slice(&space.to_le_bytes());
        data.extend_from_slice(owner.as_ref());
        Instruction {
            program_id: ID,
            accounts: vec![AccountMeta::new(*from, true), AccountMeta::new(*to, true)],
            data,
        }
    }

    pub fn transfer(from: &Address, to: &Address, lamports: u64) -> Instruction {
        let mut data = Vec::with_capacity(12);
        data.extend_from_slice(&TRANSFER.to_le_bytes());
        data.extend_from_slice(&lamports.to_le_bytes());
        Instruction {
            program_id: ID,
            accounts: vec![AccountMeta::new(*from, true), AccountMeta::new(*to, false)],
            data,
        }
    }

    pub fn allocate(address: &Address, space: u64) -> Instruction {
        let mut data = Vec::with_capacity(12);
        data.extend_from_slice(&ALLOCATE.to_le_bytes());
        data.extend_from_slice(&space.to_le_bytes());
        Instruction {
            program_id: ID,
            accounts: vec![AccountMeta::new(*address, true)],
            data,
        }
    }

    pub fn assign(address: &Address, owner: &Address) -> Instruction {
        let mut data = Vec::with_capacity(36);
        data.extend_from_slice(&ASSIGN.to_le_bytes());
        data.extend_from_slice(owner.as_ref());
        Instruction {
            program_id: ID,
            accounts: vec![AccountMeta::new(*address, true)],
            data,
        }
    }
}

/// `sol_log_data`, the syscall behind "Program data:" log lines.
fn log_data(fields: &[&[u8]]) {
    #[cfg(target_os = "solana")]
    // SAFETY: the syscall reads `fields.len()` slices laid out as (pointer, length) pairs, which is
    // how a Rust `&[&[u8]]` is laid out on the SBF target; Anchor 1.2.0 calls it the same way.
    unsafe {
        solana_define_syscall::definitions::sol_log_data(
            fields as *const _ as *const u8,
            fields.len() as u64,
        )
    };
    #[cfg(not(target_os = "solana"))]
    core::hint::black_box(fields);
}
