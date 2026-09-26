//! `sotto_proofs`: verifies that a Token-2022 confidential available balance is at least a
//! threshold and writes a public proof record (docs/05-ONCHAIN-PROGRAM.md).
//!
//! Skeleton only: no instruction is implemented yet, so every instruction is rejected.
//! The program never moves tokens and performs no token CPI (ENGINEERING-RULES.md rule 5).

use solana_account_info::AccountInfo;
use solana_address::Address;
use solana_program_error::{ProgramError, ProgramResult};

#[cfg(not(feature = "no-entrypoint"))]
solana_program_entrypoint::entrypoint!(process_instruction);

/// Program entry. Rejects every instruction until the instructions in
/// docs/05-ONCHAIN-PROGRAM.md section 4 are implemented.
pub fn process_instruction(
    _program_id: &Address,
    _accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    Err(ProgramError::InvalidInstructionData)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_every_instruction_until_implemented() {
        let program_id = Address::new_from_array([7; 32]);
        assert_eq!(
            process_instruction(&program_id, &[], &[]),
            Err(ProgramError::InvalidInstructionData)
        );
        assert_eq!(
            process_instruction(&program_id, &[], &[0, 1, 2]),
            Err(ProgramError::InvalidInstructionData)
        );
    }
}
