// Proofs of funds on the server (F-13, AC-13.1, AC-13.3; step 2.8; 08 section 3 "Proofs").
// - readPublicProof: what the public page /v/<address> shows, from chain alone (the record, the
//   config's pause flag, the organization's legal name from its SAS attestation found through the
//   record's owner, X-21), plus the counterparty label from the database when a caller passes a
//   lookup; nothing it proves comes from the database. A record whose account is gone but whose
//   address has a transaction history was closed; one without history was never written.
// - recordProof: after the owner's tab wrote a record, the server reads it from chain, checks that it
//   is this organization's (the owner's wallet, the cluster's program and wrapped mint) and that its
//   counterparty hash is SHA-256 of the salt and label it is given (X-32), then stores the label and
//   salt, which never go onchain, and logs "proof_issued" without an amount (AC-14.1).
// - listProofs: the issued list with each record's state now (valid, expired, closed).
import { createHash } from "node:crypto";
import { insertAccessEvent, orgs, proofRecords, users, type Database } from "@sotto/db";
import { attestationAddress, decodeBusinessAttestation } from "@sotto/sdk/attestation";
import { getConfigDecoder, getProofRecordDecoder } from "@sotto/sdk/proofs";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { address, getBase64Encoder, isAddress, type Address } from "@solana/kit";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { ServerCluster } from "./cluster.ts";
import { ApiError, apiErrors } from "./errors.ts";
import { requireMoneyAccess } from "./orgs.ts";
import type { Session } from "./session.ts";

/** A proof record as the chain holds it; amounts and slots as decimal strings, times as ISO. */
export type RecordView = {
  address: string;
  owner: string;
  tokenAccount: string;
  threshold: string;
  slot: string;
  writtenAt: string;
  expiry: string;
};

export type PublicProofView =
  | { state: "unavailable" }
  | { state: "not_found"; address: string }
  | { state: "closed"; address: string }
  | { state: "not_a_record"; address: string }
  | {
      state: "found";
      record: RecordView;
      /** valid, expired, or paused (the program is paused: the 14 section 7 runbook). */
      status: "valid" | "expired" | "paused";
      organization:
        | { status: "verified"; legalName: string; country: string }
        | { status: "not_verified" }
        | { status: "attestation_expired"; legalName: string; country: string };
      counterpartyLabel: string | null;
      balanceDisclosed: "none";
    };

const RECORD_LEN = 194;
const CONFIG_LEN = 67;

async function accountBytes(
  rpc: SolanaRpc,
  target: Address,
): Promise<{ owner: Address; data: Uint8Array } | null> {
  const { value } = await rpc
    .getAccountInfo(target, { encoding: "base64", commitment: "confirmed" })
    .send();
  if (!value) return null;
  return {
    owner: value.owner,
    data: new Uint8Array(getBase64Encoder().encode(value.data[0])),
  };
}

/** The record at `target` if it is one of this cluster's program, else null. */
async function readRecord(
  rpc: SolanaRpc,
  program: Address,
  target: Address,
): Promise<RecordView | "missing" | "not_a_record"> {
  const account = await accountBytes(rpc, target);
  if (!account) return "missing";
  if (account.owner !== program || account.data.length !== RECORD_LEN) return "not_a_record";
  const record = getProofRecordDecoder().decode(account.data);
  if (record.version !== 1) return "not_a_record";
  return {
    address: target,
    owner: record.owner,
    tokenAccount: record.tokenAccount,
    threshold: record.threshold.toString(),
    slot: record.slot.toString(),
    writtenAt: new Date(Number(record.unixTime) * 1000).toISOString(),
    expiry: new Date(Number(record.expiry) * 1000).toISOString(),
  };
}

async function readPaused(rpc: SolanaRpc, program: Address, config: Address): Promise<boolean> {
  const account = await accountBytes(rpc, config);
  // No config means the program cannot write records: treat it as paused rather than vouch.
  if (!account || account.owner !== program || account.data.length !== CONFIG_LEN) return true;
  return getConfigDecoder().decode(account.data).paused;
}

async function readOrganization(
  rpc: SolanaRpc,
  sas: NonNullable<ServerCluster["sas"]>,
  owner: Address,
  now: Date,
): Promise<Extract<PublicProofView, { state: "found" }>["organization"]> {
  const attestation = await attestationAddress({
    sasProgram: sas.program,
    credential: sas.credential,
    schema: sas.schema,
    nonce: owner,
  });
  const account = await accountBytes(rpc, attestation);
  if (!account || account.owner !== sas.program) return { status: "not_verified" };
  let decoded;
  try {
    decoded = decodeBusinessAttestation(account.data);
  } catch {
    return { status: "not_verified" };
  }
  if (
    decoded.nonce !== owner ||
    decoded.credential !== sas.credential ||
    decoded.schema !== sas.schema
  ) {
    return { status: "not_verified" };
  }
  const expired = decoded.expiry !== 0n && decoded.expiry * 1000n <= BigInt(now.getTime());
  const named = { legalName: decoded.data.legalName, country: decoded.data.country };
  return expired ? { status: "attestation_expired", ...named } : { status: "verified", ...named };
}

/** AC-13.3: the public view of a record address, from chain; `label` may add the counterparty label. */
export async function readPublicProof(
  rpc: SolanaRpc,
  cluster: ServerCluster | null,
  raw: string,
  options: { label?: (recordAddress: string) => Promise<string | null>; now?: Date } = {},
): Promise<PublicProofView> {
  if (!cluster?.sottoProofs) return { state: "unavailable" };
  if (!isAddress(raw)) return { state: "not_found", address: raw };
  const target = address(raw);
  const now = options.now ?? new Date();
  const record = await readRecord(rpc, cluster.sottoProofs.program, target);
  if (record === "not_a_record") return { state: "not_a_record", address: raw };
  if (record === "missing") {
    const history = await rpc
      .getSignaturesForAddress(target, { limit: 1, commitment: "confirmed" })
      .send();
    return history.length > 0
      ? { state: "closed", address: raw }
      : { state: "not_found", address: raw };
  }
  const [paused, organization, counterpartyLabel] = await Promise.all([
    readPaused(rpc, cluster.sottoProofs.program, cluster.sottoProofs.config),
    cluster.sas
      ? readOrganization(rpc, cluster.sas, address(record.owner), now)
      : Promise.resolve({ status: "not_verified" as const }),
    options.label ? options.label(raw) : Promise.resolve(null),
  ]);
  const expired = new Date(record.expiry).getTime() <= now.getTime();
  return {
    state: "found",
    record,
    status: paused ? "paused" : expired ? "expired" : "valid",
    organization,
    counterpartyLabel,
    balanceDisclosed: "none",
  };
}

/** Whether the cluster's sotto_proofs config is paused (14 section 7), for the owner's proofs page. */
export async function proofsPaused(
  rpc: SolanaRpc,
  cluster: ServerCluster | null,
): Promise<boolean> {
  if (!cluster?.sottoProofs) return false;
  return readPaused(rpc, cluster.sottoProofs.program, cluster.sottoProofs.config);
}

/** The counterparty label the owner gave a record, if Sotto stored it (display only). */
export function labelLookup(db: Database) {
  return async (recordAddress: string): Promise<string | null> => {
    const [row] = await db
      .select({ label: proofRecords.counterpartyLabel })
      .from(proofRecords)
      .where(eq(proofRecords.recordAddress, recordAddress))
      .limit(1);
    return row?.label ?? null;
  };
}

export const proofErrors = {
  unavailable: () =>
    new ApiError(503, "proofs_unavailable", "Proofs of funds are not available on this network"),
  recordNotFound: () =>
    new ApiError(404, "proof_record_not_found", "The proof record is not onchain yet"),
  notYours: () =>
    new ApiError(403, "proof_record_not_yours", "The proof record is not this organization's"),
  hashMismatch: () =>
    new ApiError(
      400,
      "counterparty_hash_mismatch",
      "The counterparty label and salt do not match the record",
    ),
};

export const recordProofSchema = z
  .object({
    recordAddress: z.string().refine(isAddress, "must be a base58 address"),
    counterpartyLabel: z.string().trim().min(1).max(120),
    /** The 16 byte salt of X-32, base64. */
    counterpartySalt: z
      .string()
      .refine((value) => Buffer.from(value, "base64").length === 16, "must be 16 bytes, base64"),
  })
  .strict();

export type IssuedProof = {
  recordAddress: string;
  threshold: string;
  counterpartyLabel: string;
  expiry: string;
  createdAt: string;
  state: "valid" | "expired" | "closed";
};

async function ownerWallet(db: Database, orgId: string): Promise<string> {
  const [org] = await db
    .select({ wallet: users.wallet })
    .from(orgs)
    .innerJoin(users, eq(users.id, orgs.ownerUserId))
    .where(eq(orgs.id, orgId))
    .limit(1);
  if (!org) throw apiErrors.forbidden();
  return org.wallet;
}

/** X-32: SHA-256 of the 16 byte salt followed by the UTF-8 label. */
export function counterpartyHashOf(salt: Uint8Array, label: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(salt).update(label, "utf8").digest());
}

/** POST /orgs/:id/proofs: the owner records a proof its tab wrote; the chain is the source of truth. */
export async function recordProof(
  db: Database,
  session: Session | null,
  orgId: string,
  input: z.infer<typeof recordProofSchema>,
  rpc: SolanaRpc,
  cluster: ServerCluster | null,
  now = new Date(),
): Promise<{ proof: IssuedProof }> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  if (!session) throw apiErrors.unauthenticated();
  if (!cluster?.sottoProofs || !cluster.wrappedUsdcMint) throw proofErrors.unavailable();
  const target = address(input.recordAddress);
  const account = await accountBytes(rpc, target);
  if (!account) throw proofErrors.recordNotFound();
  if (account.owner !== cluster.sottoProofs.program || account.data.length !== RECORD_LEN) {
    throw proofErrors.notYours();
  }
  const record = getProofRecordDecoder().decode(account.data);
  if (record.owner !== (await ownerWallet(db, orgId)) || record.mint !== cluster.wrappedUsdcMint) {
    throw proofErrors.notYours();
  }
  const salt = new Uint8Array(Buffer.from(input.counterpartySalt, "base64"));
  const expected = counterpartyHashOf(salt, input.counterpartyLabel);
  if (Buffer.compare(Buffer.from(expected), Buffer.from(record.counterpartyHash)) !== 0) {
    throw proofErrors.hashMismatch();
  }
  const expiry = new Date(Number(record.expiry) * 1000);
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(proofRecords)
      .values({
        orgId,
        cluster: cluster.config.name,
        recordAddress: target,
        thresholdBaseUnits: record.threshold,
        counterpartyLabel: input.counterpartyLabel,
        counterpartySalt: Buffer.from(salt),
        expiry,
      })
      .onConflictDoNothing()
      .returning({ id: proofRecords.id });
    if (inserted.length === 0) return;
    await insertAccessEvent(tx, {
      orgId,
      actorUserId: session.userId,
      action: "proof_issued",
      subjectType: "proof",
      subjectId: target,
      metadata: { expiry: expiry.toISOString() },
    });
  });
  return {
    proof: {
      recordAddress: target,
      threshold: record.threshold.toString(),
      counterpartyLabel: input.counterpartyLabel,
      expiry: expiry.toISOString(),
      createdAt: now.toISOString(),
      state: expiry.getTime() <= now.getTime() ? "expired" : "valid",
    },
  };
}

/** GET /orgs/:id/proofs: the issued list, newest first, each record's state read from chain now. */
export async function listProofs(
  db: Database,
  session: Session | null,
  orgId: string,
  rpc: SolanaRpc,
  now = new Date(),
): Promise<{ proofs: IssuedProof[] }> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  const rows = await db
    .select()
    .from(proofRecords)
    .where(and(eq(proofRecords.orgId, orgId)))
    .orderBy(desc(proofRecords.createdAt))
    .limit(100);
  if (rows.length === 0) return { proofs: [] };
  const { value } = await rpc
    .getMultipleAccounts(
      rows.map((row) => address(row.recordAddress)),
      { encoding: "base64", commitment: "confirmed" },
    )
    .send();
  return {
    proofs: rows.map((row, index) => ({
      recordAddress: row.recordAddress,
      threshold: row.thresholdBaseUnits.toString(),
      counterpartyLabel: row.counterpartyLabel,
      expiry: row.expiry.toISOString(),
      createdAt: row.createdAt.toISOString(),
      state:
        value[index] === null
          ? "closed"
          : row.expiry.getTime() <= now.getTime()
            ? "expired"
            : "valid",
    })),
  };
}
