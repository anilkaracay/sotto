//! The errors of docs/05-ONCHAIN-PROGRAM.md section 5, in that order, as custom program errors 0 to 16.
//! Malformed input that no check of section 4 names (instruction data, account list, a PDA address,
//! a missing signature) returns the matching built in `ProgramError` instead.

use solana_program_error::ProgramError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum SottoError {
    /// Check 1: the config is paused.
    Paused = 0,
    /// Check 2: the threshold is zero.
    ZeroThreshold = 1,
    /// Check 3: the expiry is not after now, or more than 365 days after now.
    BadExpiry = 2,
    /// Check 4: the token account is not owned by Token-2022.
    WrongTokenProgram = 3,
    /// Check 4: the token account's mint is not the config's wrapped USDC mint.
    WrongMint = 4,
    /// Check 4: the token account's owner is not the signing owner.
    WrongOwner = 5,
    /// Check 4: the token account has no confidential transfer extension.
    NotConfidential = 6,
    /// Check 4: the confidential transfer extension is not approved.
    NotApproved = 7,
    /// Checks 5 and 8: a context account not owned by the ZK ElGamal Proof program.
    WrongProofProgram = 8,
    /// Checks 5 and 8: a context account of another proof type.
    WrongProofType = 9,
    /// Checks 5 and 8: a context account whose context state authority is not the owner.
    WrongContextAuthority = 10,
    /// Check 6: the equality context's ElGamal public key is not the token account's.
    PubkeyMismatch = 11,
    /// Check 7: the equality context's ciphertext is not the available balance minus the threshold.
    CiphertextMismatch = 12,
    /// Check 9: the range context does not prove exactly one commitment of 64 bits.
    RangeShape = 13,
    /// Check 9: the range context's commitment is not the equality context's.
    CommitmentMismatch = 14,
    /// `initialize_config` not signed by the upgrade authority, `set_paused` not by the admin,
    /// `close_proof_record` not by the record's owner.
    Unauthorized = 15,
    /// `close_proof_record` before the record's expiry.
    NotExpired = 16,
}

impl From<SottoError> for ProgramError {
    fn from(error: SottoError) -> Self {
        ProgramError::Custom(error as u32)
    }
}
