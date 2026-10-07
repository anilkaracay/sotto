// Approval messages (D-04; step 1.9): the contents hash over the canonical JSON list of
// lines, which any change to a line changes, and the exact message an approver's wallet signs.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApprovalError, approvalMessage, contentsHash } from "../src/approvals/index.ts";

const LINE = {
  line_id: "0b8f3c3e-5d53-4d4e-9d7f-0f3f2d1c0a11",
  recipient_wallet: "EQMW3o1DVsB72Ej1RRRmHLW1XaEpbjLKrMHUbS8cRLZC",
  idempotency_key: "7c2a9e41-1b2c-4f0e-8a77-3d5e6f708192",
  private_blob_sha256: "a".repeat(64),
};

describe("approval messages", () => {
  it("AC-06.3 hashes the canonical JSON list of lines, and any change to a line changes the hash", async () => {
    const expected = createHash("sha256")
      .update(
        `[{"idempotency_key":"${LINE.idempotency_key}","line_id":"${LINE.line_id}","private_blob_sha256":"${LINE.private_blob_sha256}","recipient_wallet":"${LINE.recipient_wallet}"}]`,
      )
      .digest("hex");
    expect(await contentsHash([LINE])).toBe(expected);
    for (const changed of [
      { ...LINE, private_blob_sha256: "b".repeat(64) },
      { ...LINE, recipient_wallet: "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L" },
      { ...LINE, idempotency_key: "other" },
    ]) {
      expect(await contentsHash([changed])).not.toBe(expected);
    }
    for (const bad of [[], [{ ...LINE, line_id: "x" }], [{ ...LINE, extra: 1 }]]) {
      await expect(contentsHash(bad as never)).rejects.toThrow(ApprovalError);
    }
  });

  it("builds the exact message with the org, the cluster, the subject and the contents", () => {
    const message = approvalMessage({
      orgId: LINE.idempotency_key,
      cluster: "devnet",
      subjectType: "payment",
      subjectId: LINE.line_id,
      contentsHash: "c".repeat(64),
    });
    expect(message).toBe(
      [
        "sotto-approval/v1",
        "I approve this in Sotto. Signing sends no transaction and costs no fee.",
        `Organization: ${LINE.idempotency_key}`,
        "Cluster: devnet",
        `Subject: payment ${LINE.line_id}`,
        `Contents: ${"c".repeat(64)}`,
      ].join("\n"),
    );
    expect(() =>
      approvalMessage({
        orgId: "x",
        cluster: "devnet",
        subjectType: "payment",
        subjectId: LINE.line_id,
        contentsHash: "c".repeat(64),
      }),
    ).toThrow(ApprovalError);
  });
});
