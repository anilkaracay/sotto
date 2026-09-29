//! `sotto_proofs` (docs/05-ONCHAIN-PROGRAM.md): verifies that a Token-2022 confidential available
//! balance is at least a threshold and writes a public `ProofRecord`. Native program (D-16) on the
//! interface crates Gate G4 confirmed (facts K1 to K3); no curve arithmetic of its own.
//!
//! Hard limits (section 1, each proven by a test in `tests/`): it never holds, moves, mints, burns or
//! freezes tokens; it never signs for or becomes authority of a token account; its only cross
//! program calls go to the System Program; it stores no plaintext amount other than the threshold.

pub mod error;
pub mod instruction;
pub mod processor;
pub mod state;

pub use processor::process_instruction;

#[cfg(not(feature = "no-entrypoint"))]
solana_program_entrypoint::entrypoint!(process_instruction);
