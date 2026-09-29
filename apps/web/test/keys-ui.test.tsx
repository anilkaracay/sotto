// The viewing keys page (step 2.4, component level): the coverage bars compute each active key's share
// of the owner's own records from counts (09 section 3) and say that none of the holders are at Sotto
// (13 A5); the access log reads as words with metadata only (AC-14.1), naming the owner "You" and the
// worker "Sotto".
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Coverage } from "../app/app/[org]/keys/keys-panel.tsx";
import { eventWords, whenWords } from "../lib/access-log.ts";
import type { AccessEventView } from "../lib/server/access-log.ts";
import type { GrantView } from "../lib/server/grants.ts";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function grant(name: string, scope: GrantView["scope"], items: number): GrantView {
  return {
    id: crypto.randomUUID(),
    scope,
    periodFrom: null,
    periodTo: null,
    expiresAt: null,
    status: "active",
    holder: { name, title: null },
    viewer: null,
    invite: null,
    createdAt: "2026-09-29T10:00:00.000Z",
    activatedAt: "2026-09-29T10:00:00.000Z",
    revokedAt: null,
    lastUsedAt: null,
    items,
    missing: 0,
  };
}

const OWNER = "0d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6";

function event(action: string, metadata: Record<string, unknown>, actor: string | null = OWNER) {
  return {
    id: "1",
    action,
    actor: actor
      ? { userId: actor, displayName: null, wallet: "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L" }
      : null,
    subject: { type: "grant", id: "g", label: "Daniel Osei" },
    metadata,
    createdAt: "2026-09-29T10:00:00.000Z",
  } satisfies AccessEventView;
}

describe("viewing keys page (F-10, F-14)", () => {
  it("AC-10.1 shows each active key's share of the owner's own records, from counts", () => {
    const html = renderToStaticMarkup(
      <Coverage
        orgName="Northwind"
        ownerItems={40}
        grants={[grant("Daniel Osei", "all_payments", 40), grant("Maya Chen", "own_payslips", 2)]}
      />,
    );
    expect(text(html)).toContain("Who can read Northwind");
    expect(text(html)).toContain("None of them at Sotto");
    expect(html.match(/data-testid="coverage-share">(\d+)%/g)).toEqual([
      'data-testid="coverage-share">100%',
      'data-testid="coverage-share">5%',
    ]);
    const empty = renderToStaticMarkup(<Coverage orgName="Northwind" ownerItems={0} grants={[]} />);
    expect(text(empty)).toContain("No key is active.");
  });

  it("AC-14.1 reads each event as words from its metadata, without amounts", () => {
    expect(
      eventWords(
        event("grant_created", {
          scope: "period",
          periodFrom: "2026-07-01",
          periodTo: "2026-09-30",
          expiresAt: "2027-01-01T00:00:00.000Z",
        }),
        OWNER,
      ),
    ).toEqual({
      title: "You invited Daniel Osei to read every amount, 1 Jul 2026 to 30 Sep 2026",
      detail: "Until 31 Dec 2026",
    });
    expect(eventWords(event("grant_revoked", { deleted: 3 }), OWNER)).toEqual({
      title: "You revoked Daniel Osei's key",
      detail: "3 records deleted",
    });
    expect(eventWords(event("grant_expired", { deleted: 1 }, null), OWNER)).toEqual({
      title: "Daniel Osei's key expired",
      detail: "1 record deleted",
    });
    expect(eventWords(event("grant_backfilled", { items: 12 }), OWNER).detail).toBe("12 records");
    expect(eventWords(event("payroll_run_settled", { lines: 24 }, null), OWNER).title).toBe(
      "Daniel Osei settled on Solana",
    );
    expect(whenWords("2026-09-29T09:58:00.000Z", new Date("2026-09-29T10:00:00.000Z"))).toBe(
      "2 minutes ago",
    );
    // Step 2.5 (AC-11.4, AC-11.3): an export and a reconciliation, from their metadata only.
    const accountant = "1d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6";
    expect(
      eventWords(
        event(
          "export_created",
          { rows: 4, scope: "all_payments", periodFrom: null, periodTo: null, month: "2026-09" },
          accountant,
        ),
        OWNER,
      ),
    ).toEqual({
      title: "Daniel Osei exported 4 records to CSV",
      detail: "Every amount, September 2026",
    });
    expect(
      eventWords(
        {
          ...event("reconciliation_updated", { status: "matched" }, accountant),
          subject: { type: "payment", id: "p", label: "Maya Chen" },
        },
        OWNER,
      ).title,
    ).toBe("7SSp…Gq4L marked a payment to Maya Chen as matched");
  });
});
