// Storing new records (07 sections 4 and 7; step 2.4): a batch the server refuses because a grant's
// scope does not cover a record by the server's settlement time is signed again without the grants'
// items, so the owner's and the recipients' records are kept (AC-06.4, AC-08.6); any other refusal
// stays an error, and a wallet that does not sign stores nothing. A grant covers a record by the time
// it settled, which the page takes from Sotto when Sotto holds it.
import { validateManifest } from "@sotto/sdk/disclosure";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiCallError } from "../lib/client/api.ts";
import { coveringGrants, type GrantViewer } from "../lib/client/grant-viewers.ts";
import { storeRecords, type RecordItem } from "../lib/client/records.ts";

const ORG = "0d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6";
const OWNER = "1d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6";
const HOLDER = "2d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6";
const GRANT = "3d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6";
const SUBJECT = "4d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6";

const item = (viewerUserId: string, grantId: string | null): RecordItem => ({
  id: crypto.randomUUID(),
  viewerUserId,
  grantId,
  kind: "payroll_line",
  subject: SUBJECT,
  ciphertext: new Uint8Array(96).fill(grantId ? 2 : 1),
});

type Posted = { manifest: unknown; items: { viewerUserId: string; grantId: string | null }[] };

/** A server stand in: each answer in turn, a status and an error code or 201. */
function server(...answers: (number | [number, string])[]) {
  const posted: Posted[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, init: { body: string }) => {
      posted.push(JSON.parse(init.body) as Posted);
      const answer = answers[posted.length - 1] ?? 201;
      if (typeof answer === "number") {
        return new Response(JSON.stringify({ manifestId: "m", count: 1 }), { status: answer });
      }
      return new Response(
        JSON.stringify({ error: { code: answer[1], message: `refused: ${answer[1]}` } }),
        { status: answer[0] },
      );
    }),
  );
  return posted;
}

const signs = () => vi.fn(async () => new Uint8Array(64).fill(7));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storing new records (07 section 4, step 2.4)", () => {
  it("AC-06.4 signs a refused batch again without the grants' items, keeping the owner's and the recipient's", async () => {
    const posted = server([422, "disclosure_not_allowed"], 201);
    const sign = signs();
    const items = [item(OWNER, null), item(HOLDER, null), item(HOLDER, GRANT)];
    expect(await storeRecords({ orgId: ORG, items, sign })).toEqual({
      kind: "stored",
      withoutGrants: true,
    });
    expect(sign).toHaveBeenCalledTimes(2);
    expect(posted.map((batch) => batch.items.map((entry) => entry.grantId))).toEqual([
      [null, null, GRANT],
      [null, null],
    ]);
    // The second batch has a manifest of its own that lists only what it stores (I-9).
    expect(validateManifest(posted[1]?.manifest).items).toHaveLength(2);
  });

  it("stores a batch the server takes in one signature", async () => {
    const posted = server(201);
    const sign = signs();
    expect(
      await storeRecords({ orgId: ORG, items: [item(OWNER, null), item(HOLDER, GRANT)], sign }),
    ).toEqual({ kind: "stored", withoutGrants: false });
    expect(sign).toHaveBeenCalledTimes(1);
    expect(posted).toHaveLength(1);
  });

  it("keeps any other refusal an error, and a refused batch without grants' items or with only them", async () => {
    for (const [answer, items] of [
      [
        [409, "disclosure_exists"],
        [item(OWNER, null), item(HOLDER, GRANT)],
      ],
      [
        [422, "disclosure_not_allowed"],
        [item(OWNER, null), item(HOLDER, null)],
      ],
      [[422, "disclosure_not_allowed"], [item(HOLDER, GRANT)]],
    ] as const) {
      const posted = server(answer as [number, string]);
      await expect(storeRecords({ orgId: ORG, items, sign: signs() })).rejects.toBeInstanceOf(
        ApiCallError,
      );
      expect(posted).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });

  it("stores nothing when the wallet does not sign", async () => {
    const posted = server(201);
    expect(
      await storeRecords({
        orgId: ORG,
        items: [item(OWNER, null)],
        sign: async () => "cancelled",
      }),
    ).toEqual({ kind: "not_signed" });
    expect(posted).toEqual([]);
  });

  it("AC-10.1 covers a record by the time it settled, not the time its record is written", () => {
    const quarter: GrantViewer = {
      grantId: GRANT,
      scope: "period",
      periodFrom: "2026-07-01",
      periodTo: "2026-09-30",
      viewer: { userId: HOLDER, wallet: "w", publicKey: "k", signature: "s" },
    };
    const every: GrantViewer = { ...quarter, grantId: SUBJECT, scope: "all_payments" };
    const settledInQuarter = new Date("2026-09-30T23:59:59.000Z");
    expect(coveringGrants([quarter, every], "payroll_line", settledInQuarter)).toEqual([
      quarter,
      every,
    ]);
    expect(
      coveringGrants([quarter, every], "payroll_line", new Date("2026-10-01T00:00:00.000Z")),
    ).toEqual([every]);
  });
});
