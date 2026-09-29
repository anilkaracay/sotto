//! Instruction data (docs/05-ONCHAIN-PROGRAM.md section 4): one byte naming the instruction, then its
//! arguments packed without padding, integers little endian. The account lists are in the builders
//! below (host only, for tests and tools) and in `idl/sotto_proofs.json`.

use solana_address::Address;
#[cfg(not(target_os = "solana"))]
use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::ProgramError;

use crate::state::{CONFIG_SEED, PROOF_SEED};

pub const INITIALIZE_CONFIG: u8 = 0;
pub const SET_PAUSED: u8 = 1;
pub const VERIFY_BALANCE_THRESHOLD: u8 = 2;
pub const CLOSE_PROOF_RECORD: u8 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SottoInstruction {
    /// Accounts: config (writable, the PDA of `["config"]`), authority (signer, the program's upgrade
    /// authority), program_data (the program's ProgramData account), payer (signer, writable),
    /// system_program.
    InitializeConfig { wrapped_usdc_mint: Address },
    /// Accounts: config (writable), admin (signer).
    SetPaused { paused: bool },
    /// Accounts: config, owner (signer), token_account, equality_context, range_context,
    /// proof_record (writable, the PDA of `["proof", token_account, nonce]`), payer (signer,
    /// writable), system_program.
    VerifyBalanceThreshold {
        threshold: u64,
        nonce: [u8; 16],
        expiry: i64,
        counterparty_hash: [u8; 32],
    },
    /// Accounts: proof_record (writable), owner (signer, writable; receives the rent).
    CloseProofRecord,
}

impl SottoInstruction {
    pub fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
        let (&tag, rest) = data
            .split_first()
            .ok_or(ProgramError::InvalidInstructionData)?;
        match tag {
            INITIALIZE_CONFIG => {
                let mint: [u8; 32] = exact(rest)?;
                Ok(Self::InitializeConfig {
                    wrapped_usdc_mint: Address::new_from_array(mint),
                })
            }
            SET_PAUSED => match exact::<1>(rest)? {
                [0] => Ok(Self::SetPaused { paused: false }),
                [1] => Ok(Self::SetPaused { paused: true }),
                _ => Err(ProgramError::InvalidInstructionData),
            },
            VERIFY_BALANCE_THRESHOLD => {
                let args: [u8; 8 + 16 + 8 + 32] = exact(rest)?;
                Ok(Self::VerifyBalanceThreshold {
                    threshold: u64::from_le_bytes(part(&args[0..8])),
                    nonce: part(&args[8..24]),
                    expiry: i64::from_le_bytes(part(&args[24..32])),
                    counterparty_hash: part(&args[32..64]),
                })
            }
            CLOSE_PROOF_RECORD if rest.is_empty() => Ok(Self::CloseProofRecord),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }

    pub fn pack(&self) -> Vec<u8> {
        match self {
            Self::InitializeConfig { wrapped_usdc_mint } => {
                let mut data = vec![INITIALIZE_CONFIG];
                data.extend_from_slice(wrapped_usdc_mint.as_ref());
                data
            }
            Self::SetPaused { paused } => vec![SET_PAUSED, u8::from(*paused)],
            Self::VerifyBalanceThreshold {
                threshold,
                nonce,
                expiry,
                counterparty_hash,
            } => {
                let mut data = vec![VERIFY_BALANCE_THRESHOLD];
                data.extend_from_slice(&threshold.to_le_bytes());
                data.extend_from_slice(nonce);
                data.extend_from_slice(&expiry.to_le_bytes());
                data.extend_from_slice(counterparty_hash);
                data
            }
            Self::CloseProofRecord => vec![CLOSE_PROOF_RECORD],
        }
    }
}

fn exact<const N: usize>(data: &[u8]) -> Result<[u8; N], ProgramError> {
    data.try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)
}

fn part<const N: usize>(slice: &[u8]) -> [u8; N] {
    let mut out = [0u8; N];
    out.copy_from_slice(slice);
    out
}

/// The config PDA and its bump.
pub fn config_address(program_id: &Address) -> (Address, u8) {
    Address::find_program_address(&[CONFIG_SEED], program_id)
}

/// The proof record PDA of a token account and nonce, and its bump.
pub fn proof_record_address(
    program_id: &Address,
    token_account: &Address,
    nonce: &[u8; 16],
) -> (Address, u8) {
    Address::find_program_address(&[PROOF_SEED, token_account.as_ref(), nonce], program_id)
}

/// The ProgramData account of a program deployed with the upgradeable loader (v3).
pub fn program_data_address(program_id: &Address) -> Address {
    Address::find_program_address(
        &[program_id.as_ref()],
        &solana_sdk_ids::bpf_loader_upgradeable::id(),
    )
    .0
}

#[cfg(not(target_os = "solana"))]
pub fn initialize_config(
    program_id: &Address,
    authority: &Address,
    payer: &Address,
    wrapped_usdc_mint: &Address,
) -> Instruction {
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(config_address(program_id).0, false),
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new_readonly(program_data_address(program_id), false),
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(solana_system_interface::program::ID, false),
        ],
        data: SottoInstruction::InitializeConfig {
            wrapped_usdc_mint: *wrapped_usdc_mint,
        }
        .pack(),
    }
}

#[cfg(not(target_os = "solana"))]
pub fn set_paused(program_id: &Address, admin: &Address, paused: bool) -> Instruction {
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(config_address(program_id).0, false),
            AccountMeta::new_readonly(*admin, true),
        ],
        data: SottoInstruction::SetPaused { paused }.pack(),
    }
}

/// The accounts of `verify_balance_threshold` besides the program's own PDAs.
#[cfg(not(target_os = "solana"))]
pub struct VerifyAccounts {
    pub owner: Address,
    pub token_account: Address,
    pub equality_context: Address,
    pub range_context: Address,
    pub payer: Address,
}

#[cfg(not(target_os = "solana"))]
pub fn verify_balance_threshold(
    program_id: &Address,
    accounts: &VerifyAccounts,
    threshold: u64,
    nonce: [u8; 16],
    expiry: i64,
    counterparty_hash: [u8; 32],
) -> Instruction {
    let record = proof_record_address(program_id, &accounts.token_account, &nonce).0;
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new_readonly(config_address(program_id).0, false),
            AccountMeta::new_readonly(accounts.owner, true),
            AccountMeta::new_readonly(accounts.token_account, false),
            AccountMeta::new_readonly(accounts.equality_context, false),
            AccountMeta::new_readonly(accounts.range_context, false),
            AccountMeta::new(record, false),
            AccountMeta::new(accounts.payer, true),
            AccountMeta::new_readonly(solana_system_interface::program::ID, false),
        ],
        data: SottoInstruction::VerifyBalanceThreshold {
            threshold,
            nonce,
            expiry,
            counterparty_hash,
        }
        .pack(),
    }
}

#[cfg(not(target_os = "solana"))]
pub fn close_proof_record(program_id: &Address, record: &Address, owner: &Address) -> Instruction {
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(*record, false),
            AccountMeta::new(*owner, true),
        ],
        data: SottoInstruction::CloseProofRecord.pack(),
    }
}
