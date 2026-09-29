//! Gate G4 probe (step 2.2, docs/12-MILESTONES.md): not a product program. It runs the checks 4 to 9
//! of `sotto_proofs::verify_balance_threshold` (docs/05-ONCHAIN-PROGRAM.md section 4.3) on a
//! Token-2022 account and two proof context accounts that `scripts/g4-probe-localnet.ts` creates on
//! a local validator with real proofs, so their compute units can be measured. It only reads
//! accounts: no write, no CPI, no signer (the owner check of the real instruction is left out).
//! Instruction data: the threshold, u64 little endian. Accounts: token account, equality context,
//! range context.

use bytemuck::Zeroable;
use solana_account_info::AccountInfo;
use solana_address::Address;
use solana_program_error::{ProgramError, ProgramResult};
use solana_zk_elgamal_proof_interface::{
    proof_data::{BatchedRangeProofContext, CiphertextCommitmentEqualityProofContext, ProofType},
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

/// The bit length Token-2022 withdraw proves for the remaining balance (proof extraction 0.6.1).
const REMAINING_BALANCE_BIT_LENGTH: u8 = 64;

/// The error names of docs/05-ONCHAIN-PROGRAM.md section 5 that these checks can raise.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum ProbeError {
    WrongTokenProgram = 1,
    NotConfidential = 2,
    NotApproved = 3,
    WrongProofProgram = 4,
    WrongProofType = 5,
    WrongContextAuthority = 6,
    PubkeyMismatch = 7,
    CiphertextMismatch = 8,
    RangeShape = 9,
    CommitmentMismatch = 10,
}

impl From<ProbeError> for ProgramError {
    fn from(error: ProbeError) -> Self {
        ProgramError::Custom(error as u32)
    }
}

#[cfg(not(feature = "no-entrypoint"))]
solana_program_entrypoint::entrypoint!(process_instruction);

/// A proof context account of the ZK ElGamal Proof program, of the given proof type.
fn context<'a, T: bytemuck::Pod>(
    account: &'a [u8],
    owner: &Address,
    proof_type: ProofType,
) -> Result<&'a ProofContextState<T>, ProgramError> {
    if owner != &solana_zk_elgamal_proof_interface::id() {
        return Err(ProbeError::WrongProofProgram.into());
    }
    let state = bytemuck::try_from_bytes::<ProofContextState<T>>(account)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if state.proof_type != proof_type.into() {
        return Err(ProbeError::WrongProofType.into());
    }
    Ok(state)
}

pub fn process_instruction(
    _program_id: &Address,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let [token_account, equality_account, range_account] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let threshold = u64::from_le_bytes(
        instruction_data
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );

    // 4. A Token-2022 account with an approved confidential transfer extension.
    if token_account.owner != &spl_token_2022_interface::id() {
        return Err(ProbeError::WrongTokenProgram.into());
    }
    let token_data = token_account.try_borrow_data()?;
    let token = StateWithExtensions::<Account>::unpack(&token_data)?;
    let confidential = token
        .get_extension::<ConfidentialTransferAccount>()
        .map_err(|_| ProbeError::NotConfidential)?;
    if !bool::from(confidential.approved) {
        return Err(ProbeError::NotApproved.into());
    }
    let owner = token.base.owner;

    // 5. The equality context: its program, its proof type, its authority.
    let equality_data = equality_account.try_borrow_data()?;
    let equality = context::<CiphertextCommitmentEqualityProofContext>(
        &equality_data,
        equality_account.owner,
        ProofType::CiphertextCommitmentEquality,
    )?;
    if equality.context_state_authority != owner {
        return Err(ProbeError::WrongContextAuthority.into());
    }
    // 6. The same ElGamal public key as the token account.
    if equality.proof_context.pubkey != confidential.elgamal_pubkey {
        return Err(ProbeError::PubkeyMismatch.into());
    }
    // 7. The proven ciphertext is the available balance minus the threshold, computed onchain.
    let remaining = subtract_from(&confidential.available_balance, threshold)
        .ok_or(ProbeError::CiphertextMismatch)?;
    if equality.proof_context.ciphertext != remaining {
        return Err(ProbeError::CiphertextMismatch.into());
    }

    // 8. The range context: the batched range proof Token-2022 withdraw uses (U64).
    let range_data = range_account.try_borrow_data()?;
    let range = context::<BatchedRangeProofContext>(
        &range_data,
        range_account.owner,
        ProofType::BatchedRangeProofU64,
    )?;
    if range.context_state_authority != owner {
        return Err(ProbeError::WrongContextAuthority.into());
    }
    // 9. Exactly one commitment of 64 bits, the equality context's; every other slot unused.
    let proof = &range.proof_context;
    if proof.bit_lengths[0] != REMAINING_BALANCE_BIT_LENGTH {
        return Err(ProbeError::RangeShape.into());
    }
    if proof.commitments[0] != equality.proof_context.commitment {
        return Err(ProbeError::CommitmentMismatch.into());
    }
    let unused = PodPedersenCommitment::zeroed();
    if proof.bit_lengths[1..].iter().any(|length| *length != 0)
        || proof.commitments[1..].iter().any(|commitment| *commitment != unused)
    {
        return Err(ProbeError::RangeShape.into());
    }
    Ok(())
}
