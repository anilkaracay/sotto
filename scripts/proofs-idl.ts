// The hand written Codama IDL of `sotto_proofs` (D-16, docs/05-ONCHAIN-PROGRAM.md): its accounts,
// PDAs, instructions and errors exactly as the native program in `programs/sotto_proofs` lays them
// out. It is written by hand, not derived from the Rust source; `test/proofs-idl.test.ts` checks it
// against the committed JSON and the program's static test (`programs/sotto_proofs/tests/
// static_limits.rs`) checks that no instruction names a token program. `generate-proofs-client.ts`
// writes the JSON and renders the TypeScript client of `@sotto/sdk/proofs`.
import {
  accountNode,
  accountValueNode,
  argumentValueNode,
  booleanTypeNode,
  bytesTypeNode,
  constantPdaSeedNodeFromString,
  errorNode,
  fieldDiscriminatorNode,
  fixedSizeTypeNode,
  instructionAccountNode,
  instructionArgumentNode,
  instructionNode,
  numberTypeNode,
  numberValueNode,
  pdaLinkNode,
  pdaNode,
  pdaSeedValueNode,
  pdaValueNode,
  programNode,
  publicKeyTypeNode,
  publicKeyValueNode,
  rootNode,
  sizeDiscriminatorNode,
  structFieldTypeNode,
  structTypeNode,
  variablePdaSeedNode,
  type InstructionAccountNode,
  type InstructionArgumentNode,
  type RootNode,
} from "@codama/nodes";

/** The devnet deployment (step 2.7, facts N1). Localnet deploys its own per ledger. */
export const SOTTO_PROOFS_DEVNET_PROGRAM_ID = "4rMKgJWgawaTTdUxaudUXthEExnRZ7AvFvqzsoEAr9jd";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const LOADER_V3 = "BPFLoaderUpgradeab1e11111111111111111111111";

const u8 = numberTypeNode("u8");
const u64 = numberTypeNode("u64");
const i64 = numberTypeNode("i64");
const bytes = (size: number) => fixedSizeTypeNode(bytesTypeNode(), size);

/** The first byte of instruction data (`programs/sotto_proofs/src/instruction.rs`). */
function discriminator(value: number): InstructionArgumentNode {
  return instructionArgumentNode({
    name: "discriminator",
    type: u8,
    defaultValue: numberValueNode(value),
    defaultValueStrategy: "omitted",
  });
}

const account = (
  name: string,
  flags: { isWritable?: boolean; isSigner?: boolean },
  docs: string,
  defaultValue?: InstructionAccountNode["defaultValue"],
): InstructionAccountNode =>
  instructionAccountNode({
    name,
    isWritable: flags.isWritable ?? false,
    isSigner: flags.isSigner ?? false,
    docs: [docs],
    ...(defaultValue ? { defaultValue } : {}),
  });

const systemProgram = () =>
  account(
    "systemProgram",
    {},
    "The System Program, the only program this one calls.",
    publicKeyValueNode(SYSTEM_PROGRAM, "systemProgram"),
  );

export function sottoProofsIdl(programId = SOTTO_PROOFS_DEVNET_PROGRAM_ID): RootNode {
  return rootNode(
    programNode({
      name: "sottoProofs",
      publicKey: programId,
      version: "0.1.0",
      docs: [
        "Verifies that a Token-2022 confidential available balance is at least a threshold and writes a public proof record. It never moves tokens and calls no program but the System Program.",
      ],
      pdas: [
        pdaNode({ name: "config", seeds: [constantPdaSeedNodeFromString("utf8", "config")] }),
        pdaNode({
          name: "proofRecord",
          seeds: [
            constantPdaSeedNodeFromString("utf8", "proof"),
            variablePdaSeedNode("tokenAccount", publicKeyTypeNode()),
            variablePdaSeedNode("nonce", bytes(16)),
          ],
        }),
        pdaNode({
          name: "programData",
          docs: ["The program's ProgramData account under the upgradeable loader (v3)."],
          programId: LOADER_V3,
          seeds: [variablePdaSeedNode("program", publicKeyTypeNode())],
        }),
      ],
      accounts: [
        accountNode({
          name: "config",
          size: 67,
          pda: pdaLinkNode("config"),
          discriminators: [sizeDiscriminatorNode(67)],
          data: structTypeNode([
            structFieldTypeNode({ name: "version", type: u8 }),
            structFieldTypeNode({ name: "admin", type: publicKeyTypeNode() }),
            structFieldTypeNode({ name: "wrappedUsdcMint", type: publicKeyTypeNode() }),
            structFieldTypeNode({ name: "paused", type: booleanTypeNode() }),
            structFieldTypeNode({ name: "bump", type: u8 }),
          ]),
        }),
        accountNode({
          name: "proofRecord",
          size: 194,
          pda: pdaLinkNode("proofRecord"),
          discriminators: [sizeDiscriminatorNode(194)],
          data: structTypeNode([
            structFieldTypeNode({ name: "version", type: u8 }),
            structFieldTypeNode({ name: "tokenAccount", type: publicKeyTypeNode() }),
            structFieldTypeNode({ name: "owner", type: publicKeyTypeNode() }),
            structFieldTypeNode({ name: "mint", type: publicKeyTypeNode() }),
            structFieldTypeNode({ name: "threshold", type: u64 }),
            structFieldTypeNode({ name: "slot", type: u64 }),
            structFieldTypeNode({ name: "unixTime", type: i64 }),
            structFieldTypeNode({ name: "expiry", type: i64 }),
            structFieldTypeNode({ name: "balanceCiphertextHash", type: bytes(32) }),
            structFieldTypeNode({ name: "counterpartyHash", type: bytes(32) }),
            structFieldTypeNode({ name: "bump", type: u8 }),
          ]),
        }),
      ],
      instructions: [
        instructionNode({
          name: "initializeConfig",
          docs: ["Creates the config. The signer must be the program's current upgrade authority."],
          accounts: [
            account("config", { isWritable: true }, "The config PDA.", pdaValueNode("config")),
            account("authority", { isSigner: true }, "The program's upgrade authority, the admin."),
            account(
              "programData",
              {},
              "The program's ProgramData account (the programData PDA of the program's own address).",
            ),
            account("payer", { isWritable: true, isSigner: true }, "Pays the config's rent."),
            systemProgram(),
          ],
          arguments: [
            discriminator(0),
            instructionArgumentNode({ name: "wrappedUsdcMint", type: publicKeyTypeNode() }),
          ],
          discriminators: [fieldDiscriminatorNode("discriminator")],
        }),
        instructionNode({
          name: "setPaused",
          docs: ["Pauses or unpauses new records. The signer must be the config's admin."],
          accounts: [
            account("config", { isWritable: true }, "The config PDA.", pdaValueNode("config")),
            account("admin", { isSigner: true }, "The config's admin."),
          ],
          arguments: [
            discriminator(1),
            instructionArgumentNode({ name: "paused", type: booleanTypeNode() }),
          ],
          discriminators: [fieldDiscriminatorNode("discriminator")],
        }),
        instructionNode({
          name: "verifyBalanceThreshold",
          docs: [
            "Checks that the owner's confidential available balance is at least the threshold, from two verified proof context accounts, and writes the proof record.",
          ],
          accounts: [
            account("config", {}, "The config PDA.", pdaValueNode("config")),
            account("owner", { isSigner: true }, "The token account's owner."),
            account("tokenAccount", {}, "The owner's confidential wUSDC account, read only."),
            account(
              "equalityContext",
              {},
              "The ciphertext commitment equality context, owned by the ZK ElGamal Proof program.",
            ),
            account(
              "rangeContext",
              {},
              "The batched range proof (U64) context, owned by the ZK ElGamal Proof program.",
            ),
            account(
              "proofRecord",
              { isWritable: true },
              "The record PDA of the token account and nonce.",
              pdaValueNode("proofRecord", [
                pdaSeedValueNode("tokenAccount", accountValueNode("tokenAccount")),
                pdaSeedValueNode("nonce", argumentValueNode("nonce")),
              ]),
            ),
            account("payer", { isWritable: true, isSigner: true }, "Pays the record's rent."),
            systemProgram(),
          ],
          arguments: [
            discriminator(2),
            instructionArgumentNode({ name: "threshold", type: u64 }),
            instructionArgumentNode({ name: "nonce", type: bytes(16) }),
            instructionArgumentNode({ name: "expiry", type: i64 }),
            instructionArgumentNode({ name: "counterpartyHash", type: bytes(32) }),
          ],
          discriminators: [fieldDiscriminatorNode("discriminator")],
        }),
        instructionNode({
          name: "closeProofRecord",
          docs: ["Closes an expired record; its rent goes to the owner."],
          accounts: [
            account("proofRecord", { isWritable: true }, "The record."),
            account("owner", { isWritable: true, isSigner: true }, "The record's owner."),
          ],
          arguments: [discriminator(3)],
          discriminators: [fieldDiscriminatorNode("discriminator")],
        }),
      ],
      errors: [
        ["paused", "The proof program is paused"],
        ["zeroThreshold", "The threshold must be above zero"],
        ["badExpiry", "The expiry must be after now and at most 365 days away"],
        ["wrongTokenProgram", "The token account is not a Token-2022 account"],
        ["wrongMint", "The token account is not of the wrapped USDC mint"],
        ["wrongOwner", "The token account belongs to someone else"],
        ["notConfidential", "The token account has no confidential balance"],
        ["notApproved", "The token account's confidential balance is not approved"],
        ["wrongProofProgram", "A proof context is not owned by the ZK ElGamal Proof program"],
        ["wrongProofType", "A proof context is of another proof type"],
        ["wrongContextAuthority", "A proof context belongs to someone else"],
        ["pubkeyMismatch", "The equality proof is for another encryption key"],
        ["ciphertextMismatch", "The proof does not match the current balance minus the threshold"],
        ["rangeShape", "The range proof does not prove one 64 bit amount"],
        ["commitmentMismatch", "The range proof is for another commitment"],
        ["unauthorized", "The signer may not do this"],
        ["notExpired", "The record has not expired yet"],
      ].map(([name, message], code) =>
        errorNode({ name: name as string, code, message: message as string }),
      ),
    }),
  );
}
