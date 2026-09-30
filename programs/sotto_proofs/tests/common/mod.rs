//! The runtime tests' harness (docs/05-ONCHAIN-PROGRAM.md section 7): `solana-program-test` 4.3.0
//! runs the SBF build of the program (`target/deploy/sotto_proofs.so`, built by `cargo-build-sbf
//! --arch v3` before `cargo test`) under the upgradeable loader with a test upgrade authority, next
//! to the runtime's own ZK ElGamal Proof program, which verifies every proof here. The proofs come
//! from `spl-token-confidential-transfer-proof-generation` 0.6.1, the crate Token-2022's client
//! tooling uses for withdraw proofs, on `solana-zk-sdk` 7.0.1, the version the runtime's verifier
//! uses. The token accounts are Token-2022 account bytes with a confidential transfer extension and
//! a real ElGamal ciphertext; the program only reads them.
#![allow(dead_code)]

use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_instruction_error::InstructionError;
use solana_keypair::Keypair;
use solana_program_test::{BanksClientError, ProgramTest, ProgramTestContext};
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;
use solana_zk_elgamal_proof_interface::{
    instruction::{ContextStateInfo, ProofInstruction},
    proof_data::{
        BatchedRangeProofContext, BatchedRangeProofU64Data,
        CiphertextCommitmentEqualityProofContext, CiphertextCommitmentEqualityProofData,
    },
    state::ProofContextState,
};
use solana_zk_sdk::encryption::elgamal::{ElGamalCiphertext, ElGamalKeypair};
use solana_zk_sdk_pod::encryption::elgamal::{PodElGamalCiphertext, PodElGamalPubkey};
use sotto_proofs::{
    instruction::{self as ix, VerifyAccounts},
    state::{Config, ProofRecord},
};
use spl_token_2022_interface::{
    extension::{
        confidential_transfer::ConfidentialTransferAccount, BaseStateWithExtensionsMut,
        ExtensionType, StateWithExtensionsMut,
    },
    state::{Account as TokenAccount, AccountState},
};
use spl_token_confidential_transfer_proof_generation::withdraw::withdraw_proof_data;

pub const USDC: u64 = 1_000_000;
pub const LOADER_V3: Address = solana_sdk_ids::bpf_loader_upgradeable::ID;
pub const ZK_PROGRAM: Address = solana_sdk_ids::zk_elgamal_proof_program::ID;
pub const DEPRECATED_ZK_TOKEN_PROOF: Address = solana_sdk_ids::zk_token_proof_program::ID;
pub const TOKEN_2022: Address = spl_token_2022_interface::ID;
/// The legacy SPL Token program.
pub const TOKEN: Address = Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const EQUALITY_CONTEXT_LEN: usize =
    std::mem::size_of::<ProofContextState<CiphertextCommitmentEqualityProofContext>>();
pub const RANGE_CONTEXT_LEN: usize =
    std::mem::size_of::<ProofContextState<BatchedRangeProofContext>>();

/// The program's SBF build, as `cargo-build-sbf` writes it.
pub fn program_elf() -> Vec<u8> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/deploy/sotto_proofs.so"
    );
    std::fs::read(path).unwrap_or_else(|error| {
        panic!("{path}: {error}; build it first with cargo-build-sbf --arch v3")
    })
}

/// A program deployed with the upgradeable loader: the program account and its ProgramData, whose
/// header (facts M4) names `authority` as upgrade authority, `None` for an immutable program.
pub fn add_program(test: &mut ProgramTest, program_id: &Address, authority: Option<&Address>) {
    let program_data = ix::program_data_address(program_id);
    let mut program = 2u32.to_le_bytes().to_vec();
    program.extend_from_slice(program_data.as_ref());
    let mut data = 3u32.to_le_bytes().to_vec();
    data.extend_from_slice(&0u64.to_le_bytes());
    match authority {
        Some(key) => {
            data.push(1);
            data.extend_from_slice(key.as_ref());
        }
        None => {
            data.push(0);
            data.extend_from_slice(&[0u8; 32]);
        }
    }
    data.extend_from_slice(&program_elf());
    for (address, bytes, executable) in [(*program_id, program, true), (program_data, data, false)]
    {
        test.add_account(
            address,
            Account {
                lamports: 1_000_000_000_000,
                data: bytes,
                owner: LOADER_V3,
                executable,
                rent_epoch: 0,
            },
        );
    }
}

pub struct Env {
    pub context: ProgramTestContext,
    /// Signatures sent so far: a repeated transaction waits for a new blockhash instead.
    pub sent: std::collections::HashSet<solana_signature::Signature>,
    pub program_id: Address,
    pub authority: Keypair,
    pub mint: Address,
}

/// A fresh runtime with the program; `initialize` also runs `initialize_config` for `mint`.
pub async fn start(initialize: bool) -> Env {
    let program_id = Address::new_unique();
    let authority = Keypair::new();
    let mut test = ProgramTest::default();
    test.prefer_bpf(true);
    add_program(&mut test, &program_id, Some(&authority.pubkey()));
    test.add_account(
        authority.pubkey(),
        Account::new(10_000_000_000, 0, &solana_system_interface::program::ID),
    );
    let context = test.start_with_context().await;
    let mut env = Env {
        context,
        sent: Default::default(),
        program_id,
        authority,
        mint: Address::new_unique(),
    };
    if initialize {
        let instruction = ix::initialize_config(
            &env.program_id,
            &env.authority.pubkey(),
            &env.authority.pubkey(),
            &env.mint,
        );
        let authority = env.authority.insecure_clone();
        env.send(&[instruction], &[&authority]).await.unwrap();
    }
    env
}

impl Env {
    /// Sends `instructions`, paid by the harness payer, signed by it and `signers`.
    pub async fn send(
        &mut self,
        instructions: &[Instruction],
        signers: &[&Keypair],
    ) -> Result<solana_program_test::BanksTransactionResultWithMetadata, BanksClientError> {
        let payer = self.context.payer.insecure_clone();
        let mut all: Vec<&Keypair> = vec![&payer];
        all.extend_from_slice(signers);
        let mut blockhash = self.context.banks_client.get_latest_blockhash().await?;
        let mut transaction = Transaction::new_signed_with_payer(
            instructions,
            Some(&payer.pubkey()),
            &all,
            blockhash,
        );
        while self.sent.contains(&transaction.signatures[0]) {
            blockhash = self.context.get_new_latest_blockhash().await?;
            transaction = Transaction::new_signed_with_payer(
                instructions,
                Some(&payer.pubkey()),
                &all,
                blockhash,
            );
        }
        self.sent.insert(transaction.signatures[0]);
        let result = self
            .context
            .banks_client
            .process_transaction_with_metadata(transaction)
            .await?;
        match &result.result {
            Ok(()) => Ok(result),
            Err(error) => Err(BanksClientError::TransactionError(error.clone())),
        }
    }

    pub async fn account(&mut self, address: Address) -> Option<Account> {
        self.context
            .banks_client
            .get_account(address)
            .await
            .unwrap()
    }

    pub async fn config(&mut self) -> Config {
        let address = ix::config_address(&self.program_id).0;
        Config::unpack(&self.account(address).await.expect("config").data).unwrap()
    }

    pub async fn record(&mut self, address: Address) -> ProofRecord {
        ProofRecord::unpack(&self.account(address).await.expect("record").data).unwrap()
    }

    pub fn set_account(&mut self, address: &Address, account: &Account) {
        self.context.set_account(address, &account.clone().into());
    }

    /// Moves the clock's unix time to `unix_timestamp`.
    pub async fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock: solana_clock::Clock = self.context.banks_client.get_sysvar().await.unwrap();
        clock.unix_timestamp = unix_timestamp;
        self.context.set_sysvar(&clock);
    }

    pub async fn now(&mut self) -> i64 {
        let clock: solana_clock::Clock = self.context.banks_client.get_sysvar().await.unwrap();
        clock.unix_timestamp
    }

    /// A system account holding SOL for `keypair`.
    pub fn fund(&mut self, keypair: &Keypair) {
        let account = Account::new(10_000_000_000, 0, &solana_system_interface::program::ID);
        self.set_account(&keypair.pubkey(), &account);
    }
}

/// How a test token account differs from a correct one.
#[derive(Clone, Copy)]
pub struct TokenShape {
    pub mint: Address,
    pub owner: Address,
    pub program: Address,
    pub confidential: bool,
    pub approved: bool,
}

/// Token-2022 account bytes of `shape`, with `available` as its available balance ciphertext under
/// `pubkey`.
pub fn token_account(
    shape: TokenShape,
    pubkey: &PodElGamalPubkey,
    available: &PodElGamalCiphertext,
) -> Account {
    let extensions: &[ExtensionType] = if shape.confidential {
        &[ExtensionType::ConfidentialTransferAccount]
    } else {
        &[]
    };
    let len = if shape.confidential {
        ExtensionType::try_calculate_account_len::<TokenAccount>(extensions).unwrap()
    } else {
        <TokenAccount as solana_program_pack::Pack>::LEN
    };
    let mut data = vec![0u8; len];
    let mut state =
        StateWithExtensionsMut::<TokenAccount>::unpack_uninitialized(&mut data).unwrap();
    state.base = TokenAccount {
        mint: shape.mint,
        owner: shape.owner,
        state: AccountState::Initialized,
        ..TokenAccount::default()
    };
    state.pack_base();
    if shape.confidential {
        state.init_account_type().unwrap();
        let extension = state
            .init_extension::<ConfidentialTransferAccount>(true)
            .unwrap();
        extension.approved = shape.approved.into();
        extension.elgamal_pubkey = *pubkey;
        extension.available_balance = *available;
    }
    Account {
        lamports: 10_000_000,
        data,
        owner: shape.program,
        executable: false,
        rent_epoch: 0,
    }
}

pub fn pod_pubkey(keypair: &ElGamalKeypair) -> PodElGamalPubkey {
    PodElGamalPubkey(keypair.pubkey().to_bytes())
}

pub fn pod_ciphertext(ciphertext: &ElGamalCiphertext) -> PodElGamalCiphertext {
    PodElGamalCiphertext(ciphertext.to_bytes())
}

/// An owner with a confidential wUSDC account holding `balance`, the proofs of "at least
/// `threshold`" made by the withdraw proof generator, and their verified context accounts.
pub struct Proven {
    pub owner: Keypair,
    pub elgamal: ElGamalKeypair,
    pub token_address: Address,
    pub token: Account,
    pub available: ElGamalCiphertext,
    pub balance: u64,
    pub threshold: u64,
    pub equality: Address,
    pub range: Address,
    pub equality_data: CiphertextCommitmentEqualityProofData,
    pub range_data: BatchedRangeProofU64Data,
}

pub fn correct_shape(env: &Env, owner: &Address) -> TokenShape {
    TokenShape {
        mint: env.mint,
        owner: *owner,
        program: TOKEN_2022,
        confidential: true,
        approved: true,
    }
}

/// Sets up `Proven` for `balance` and `threshold`, the contexts owned by `authority` (the owner by
/// default).
pub async fn prove(env: &mut Env, balance: u64, threshold: u64) -> Proven {
    let owner = Keypair::new();
    env.fund(&owner);
    let elgamal = ElGamalKeypair::new_rand();
    let available = elgamal.pubkey().encrypt(balance);
    let token_address = Address::new_unique();
    let token = token_account(
        correct_shape(env, &owner.pubkey()),
        &pod_pubkey(&elgamal),
        &pod_ciphertext(&available),
    );
    env.set_account(&token_address, &token);
    let proofs = withdraw_proof_data(&available, balance, threshold, &elgamal).unwrap();
    let equality = verify_context(
        env,
        ProofInstruction::VerifyCiphertextCommitmentEquality,
        &proofs.equality_proof_data,
        EQUALITY_CONTEXT_LEN,
        &owner,
    )
    .await;
    let range = verify_context(
        env,
        ProofInstruction::VerifyBatchedRangeProofU64,
        &proofs.range_proof_data,
        RANGE_CONTEXT_LEN,
        &owner,
    )
    .await;
    Proven {
        owner,
        elgamal,
        token_address,
        token,
        available,
        balance,
        threshold,
        equality,
        range,
        equality_data: proofs.equality_proof_data,
        range_data: proofs.range_proof_data,
    }
}

/// Verifies `proof` with the ZK ElGamal Proof program into a new context account whose context
/// state authority is `authority`.
pub async fn verify_context<T, U>(
    env: &mut Env,
    instruction: ProofInstruction,
    proof: &T,
    len: usize,
    authority: &Keypair,
) -> Address
where
    T: bytemuck::Pod + solana_zk_elgamal_proof_interface::proof_data::ZkProofData<U>,
    U: bytemuck::Pod,
{
    let context = Keypair::new();
    let rent = env.context.banks_client.get_rent().await.unwrap();
    let create = sotto_proofs::processor::system::create_account(
        &env.context.payer.pubkey(),
        &context.pubkey(),
        rent.minimum_balance(len),
        len as u64,
        &ZK_PROGRAM,
    );
    let verify = instruction.encode_verify_proof(
        Some(ContextStateInfo {
            context_state_account: &context.pubkey(),
            context_state_authority: &authority.pubkey(),
        }),
        proof,
    );
    env.send(&[create, verify], &[&context]).await.unwrap();
    context.pubkey()
}

pub struct Verify {
    pub threshold: u64,
    pub nonce: [u8; 16],
    pub expiry: i64,
    pub counterparty_hash: [u8; 32],
}

pub fn verify_instruction(env: &Env, proven: &Proven, args: &Verify) -> Instruction {
    ix::verify_balance_threshold(
        &env.program_id,
        &VerifyAccounts {
            owner: proven.owner.pubkey(),
            token_account: proven.token_address,
            equality_context: proven.equality,
            range_context: proven.range,
            payer: env.context.payer.pubkey(),
        },
        args.threshold,
        args.nonce,
        args.expiry,
        args.counterparty_hash,
    )
}

/// Arguments that pass, for `proven`, at the runtime's current time.
pub async fn arguments(env: &mut Env, proven: &Proven) -> Verify {
    let now = env.now().await;
    Verify {
        threshold: proven.threshold,
        nonce: rand_nonce(),
        expiry: now + 30 * 24 * 60 * 60,
        counterparty_hash: [7u8; 32],
    }
}

pub fn rand_nonce() -> [u8; 16] {
    Address::new_unique().to_bytes()[..16].try_into().unwrap()
}

/// Replaces one account meta of an instruction.
pub fn with_account(mut instruction: Instruction, index: usize, meta: AccountMeta) -> Instruction {
    instruction.accounts[index] = meta;
    instruction
}

/// The custom error code of a failed transaction.
pub fn custom_error(error: BanksClientError) -> u32 {
    match error.unwrap() {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => code,
        other => panic!("expected a custom program error, got {other:?}"),
    }
}

pub fn instruction_error(error: BanksClientError) -> InstructionError {
    match error.unwrap() {
        TransactionError::InstructionError(_, error) => error,
        other => panic!("expected an instruction error, got {other:?}"),
    }
}
