//! The accounts of docs/05-ONCHAIN-PROGRAM.md section 3, in the field order of its tables, packed
//! without padding: integers little endian, a bool as one byte (0 or 1), an address as its 32 bytes.
//! Neither account carries a discriminator; the program tells them apart by address (the config is
//! the PDA of `["config"]`) and by length, and it creates no other account.

use solana_address::Address;
use solana_program_error::ProgramError;

pub const VERSION: u8 = 1;
pub const CONFIG_SEED: &[u8] = b"config";
pub const PROOF_SEED: &[u8] = b"proof";
/// The longest expiry after the verification time: 365 days.
pub const MAX_EXPIRY_SECONDS: i64 = 365 * 24 * 60 * 60;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Config {
    pub version: u8,
    pub admin: Address,
    pub wrapped_usdc_mint: Address,
    pub paused: bool,
    pub bump: u8,
}

impl Config {
    pub const LEN: usize = 1 + 32 + 32 + 1 + 1;

    pub fn pack(&self) -> [u8; Self::LEN] {
        let mut out = [0u8; Self::LEN];
        out[0] = self.version;
        out[1..33].copy_from_slice(self.admin.as_ref());
        out[33..65].copy_from_slice(self.wrapped_usdc_mint.as_ref());
        out[65] = u8::from(self.paused);
        out[66] = self.bump;
        out
    }

    pub fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
        let data: &[u8; Self::LEN] = data
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?;
        let paused = match data[65] {
            0 => false,
            1 => true,
            _ => return Err(ProgramError::InvalidAccountData),
        };
        if data[0] != VERSION {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(Self {
            version: data[0],
            admin: address(&data[1..33]),
            wrapped_usdc_mint: address(&data[33..65]),
            paused,
            bump: data[66],
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProofRecord {
    pub version: u8,
    pub token_account: Address,
    pub owner: Address,
    pub mint: Address,
    pub threshold: u64,
    pub slot: u64,
    pub unix_time: i64,
    pub expiry: i64,
    pub balance_ciphertext_hash: [u8; 32],
    pub counterparty_hash: [u8; 32],
    pub bump: u8,
}

impl ProofRecord {
    pub const LEN: usize = 1 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 32 + 32 + 1;

    pub fn pack(&self) -> [u8; Self::LEN] {
        let mut out = [0u8; Self::LEN];
        out[0] = self.version;
        out[1..33].copy_from_slice(self.token_account.as_ref());
        out[33..65].copy_from_slice(self.owner.as_ref());
        out[65..97].copy_from_slice(self.mint.as_ref());
        out[97..105].copy_from_slice(&self.threshold.to_le_bytes());
        out[105..113].copy_from_slice(&self.slot.to_le_bytes());
        out[113..121].copy_from_slice(&self.unix_time.to_le_bytes());
        out[121..129].copy_from_slice(&self.expiry.to_le_bytes());
        out[129..161].copy_from_slice(&self.balance_ciphertext_hash);
        out[161..193].copy_from_slice(&self.counterparty_hash);
        out[193] = self.bump;
        out
    }

    pub fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
        let data: &[u8; Self::LEN] = data
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?;
        if data[0] != VERSION {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(Self {
            version: data[0],
            token_account: address(&data[1..33]),
            owner: address(&data[33..65]),
            mint: address(&data[65..97]),
            threshold: u64::from_le_bytes(bytes(&data[97..105])),
            slot: u64::from_le_bytes(bytes(&data[105..113])),
            unix_time: i64::from_le_bytes(bytes(&data[113..121])),
            expiry: i64::from_le_bytes(bytes(&data[121..129])),
            balance_ciphertext_hash: bytes(&data[129..161]),
            counterparty_hash: bytes(&data[161..193]),
            bump: data[193],
        })
    }
}

fn bytes<const N: usize>(slice: &[u8]) -> [u8; N] {
    let mut out = [0u8; N];
    out.copy_from_slice(slice);
    out
}

fn address(slice: &[u8]) -> Address {
    Address::new_from_array(bytes(slice))
}
