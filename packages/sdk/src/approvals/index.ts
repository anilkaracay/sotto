// Approval messages (D-04; 08 section 3; step 1.9). An approver signs, with their
// wallet, a message naming the org, the cluster, the subject and `contents_hash`: the lowercase hex
// SHA-256 of the canonical JSON list of `{ line_id, recipient_wallet, idempotency_key,
// private_blob_sha256 }`. A single payment is one line whose id is the payment's. Any change to the
// contents changes the hash, so an approval signed before the change no longer counts. Pure: servers
// build and check the same message the browser shows.
import { canonicalJsonBytes } from "../disclosure/canonical.ts";
import { sha256Hex } from "../disclosure/manifest.ts";
import { UUID } from "../disclosure/payload.ts";

export type ApprovalLine = {
  line_id: string;
  recipient_wallet: string;
  idempotency_key: string;
  /** Lowercase hex SHA-256 of the line's private blob (sealed to the owner). */
  private_blob_sha256: string;
};

export type ApprovalSubjectType = "payment" | "payroll_run";

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalError";
  }
}

const HEX_64 = /^[0-9a-f]{64}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** D-04: the lowercase hex SHA-256 of the canonical JSON list of lines, in the order given. */
export async function contentsHash(lines: readonly ApprovalLine[]): Promise<string> {
  if (lines.length === 0) throw new ApprovalError("an approval covers at least one line");
  for (const line of lines) {
    if (
      Object.keys(line).sort().join(",") !==
        "idempotency_key,line_id,private_blob_sha256,recipient_wallet" ||
      !UUID.test(line.line_id) ||
      !BASE58.test(line.recipient_wallet) ||
      line.idempotency_key.length === 0 ||
      line.idempotency_key.length > 100 ||
      !HEX_64.test(line.private_blob_sha256)
    ) {
      throw new ApprovalError(
        "a line has exactly a uuid line_id, a wallet, an idempotency key and a blob hash",
      );
    }
  }
  return sha256Hex(canonicalJsonBytes(lines));
}

export type ApprovalMessageInput = {
  orgId: string;
  cluster: "localnet" | "devnet" | "mainnet";
  subjectType: ApprovalSubjectType;
  subjectId: string;
  contentsHash: string;
};

export const APPROVAL_MESSAGE_FIRST_LINE = "sotto-approval/v1";

/** The exact text an approver's wallet signs. */
export function approvalMessage(input: ApprovalMessageInput): string {
  if (!UUID.test(input.orgId) || !UUID.test(input.subjectId)) {
    throw new ApprovalError("the org and the subject are uuids");
  }
  if (!HEX_64.test(input.contentsHash)) {
    throw new ApprovalError("the contents hash is lowercase hex SHA-256");
  }
  return [
    APPROVAL_MESSAGE_FIRST_LINE,
    "I approve this in Sotto. Signing sends no transaction and costs no fee.",
    `Organization: ${input.orgId}`,
    `Cluster: ${input.cluster}`,
    `Subject: ${input.subjectType} ${input.subjectId}`,
    `Contents: ${input.contentsHash}`,
  ].join("\n");
}
