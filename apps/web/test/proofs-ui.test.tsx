// The proofs page and the public page at component level (F-13, step 2.8): the certificate of a proven
// record shows the statement, Proven, the slot, the validity and "Balance disclosed: None" with a copy
// link (AC-13.1); Not proven shows the 13 words and that nothing was sent, with no link (AC-13.2); the
// issued list offers Copy link except for a closed record and Close only after expiry (X-31); the
// public page shows the organization's legal name, the statement, slot, time, expiry and "Balance
// disclosed: none", and says when a record expired, was closed, was never written or the program is
// paused (AC-13.3). No page says True or False (D-06).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CertificateView, IssuedProofsView } from "../app/app/[org]/proofs/proofs-panel.tsx";
import { VerifyView } from "../app/v/[address]/verify-view.tsx";
import type { IssuedProof, PublicProofView } from "../lib/server/proofs.ts";
import { expectAmountsInside, privacyOn } from "./helpers/amounts.ts";

const RECORD = "EsVM5jHqyNVyVypQNRs3UFieQhJx1NBaF2idHHNxTGHy";
const OWNER = "E425As4SphdVfbkaF9h9V82NuraqufveTjF4xmZPuBPp";
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();

const noTrueOrFalse = (html: string) => expect(text(html)).not.toMatch(/\b(True|False)\b/);

describe("proofs page (F-13)", () => {
  it("AC-13.1 shows the certificate of the record just written, with its link", () => {
    const html = renderToStaticMarkup(
      privacyOn(
        <CertificateView
          orgName="Northwind"
          threshold={100_000_000_000n}
          label="Hollis Supply Co."
          origin="https://app.sotto.test"
          outcome={{
            kind: "proven",
            closed: true,
            stored: null,
            record: {
              address: RECORD,
              threshold: 100_000_000_000n,
              label: "Hollis Supply Co.",
              slot: 505_624_879n,
              expiry: BigInt(Date.UTC(2026, 9, 30) / 1000),
              signature: "4jBo",
            },
          }}
        />,
      ),
    );
    expect(text(html)).toContain(
      "Proven The statement holds. The balance stays sealed. Statement Balance is at least $100,000 Shared with Hollis Supply Co. Verified by Sotto program on Solana, slot 505624879 Valid until 30 Oct 2026 Balance disclosed None",
    );
    expect(html).toContain('data-result="proven"');
    expect(html).toContain(`href="/v/${RECORD}"`);
    expect(text(html)).toContain("Copy link");
    noTrueOrFalse(html);
    expectAmountsInside(html);
  });

  it("AC-13.2 shows Not proven with the 13 words and that nothing was sent", () => {
    const html = renderToStaticMarkup(
      privacyOn(
        <CertificateView
          orgName="Northwind"
          threshold={2_500_000_000_000n}
          label="Northbank"
          outcome={{ kind: "not_proven" }}
        />,
      ),
    );
    expect(text(html)).toContain(
      "Not proven This statement could not be proven. Nothing else was revealed. Statement Balance is at least $2,500,000 Shared with Northbank Sent onchain Nothing Balance disclosed None",
    );
    expect(html).toContain('data-result="not-proven"');
    expect(text(html)).not.toContain("Copy link");
    expect(html).not.toContain("/v/");
    noTrueOrFalse(html);
    expectAmountsInside(html);
  });

  it("lists issued proofs with Copy link unless closed and Close only after expiry (X-31)", () => {
    const proof = (state: IssuedProof["state"], label: string): IssuedProof => ({
      recordAddress: `${label}${RECORD}`.slice(0, 44),
      threshold: "500000000000",
      counterpartyLabel: label,
      expiry: state === "valid" ? "2026-10-30T10:00:00.000Z" : "2026-09-01T10:00:00.000Z",
      createdAt: "2026-08-01T10:00:00.000Z",
      state,
    });
    const html = renderToStaticMarkup(
      privacyOn(
        <IssuedProofsView
          proofs={[proof("valid", "Lender"), proof("expired", "Supplier"), proof("closed", "Bank")]}
          now={new Date("2026-09-30T10:00:00Z")}
          copied={null}
          busy={false}
          problem={null}
          onCopy={() => undefined}
          onClose={() => undefined}
        />,
      ),
    );
    const rows = html.split('data-testid="issued-row"').slice(1).map(text);
    expect(rows[0]).toContain(
      "Lender Balance is at least $500,000 Proven 1 Aug 2026 Valid until 30 Oct 2026 Copy link",
    );
    expect(rows[0]).not.toContain("Close");
    expect(rows[1]).toContain("Expired on 1 Sep 2026 Copy link Close");
    expect(rows[2]).toContain("Closed");
    expect(rows[2]).not.toContain("Copy link");
    expect(text(html)).toContain("Issued proofs 3 issued");
    noTrueOrFalse(html);
    expectAmountsInside(html);
  });
});

describe("public verification page (AC-13.3)", () => {
  const found = (
    status: "valid" | "expired" | "paused",
    organization: Extract<PublicProofView, { state: "found" }>["organization"],
  ): PublicProofView => ({
    state: "found",
    status,
    organization,
    counterpartyLabel: "Hollis Supply Co.",
    balanceDisclosed: "none",
    record: {
      address: RECORD,
      owner: OWNER,
      tokenAccount: "DFqVbjLfr1edLKBrmGB6tATRc2vvEqdRr5DVubyhqGXf",
      threshold: "500000",
      slot: "505624879",
      writtenAt: "2026-09-29T19:13:58.000Z",
      expiry: "2026-10-06T19:13:58.000Z",
    },
  });
  const render = (view: PublicProofView) =>
    renderToStaticMarkup(
      <VerifyView view={view} now={new Date("2026-09-30T10:00:00Z")} cluster="devnet" />,
    );

  it("AC-13.3 shows the legal name, the statement, slot, time, expiry and Balance disclosed: none", () => {
    const html = render(
      found("valid", { status: "verified", legalName: "Northwind Labs Ltd", country: "TR" }),
    );
    expect(text(html)).toContain(
      "Organization Northwind Labs Ltd, TR Statement Balance is at least $0.50 Shared with Hollis Supply Co. Proven The statement held when the record was written, and the record is still valid. Verified at Slot 505624879 29 Sep 2026, 19:13 UTC Valid until 6 Oct 2026 19:13 UTC Balance disclosed none The balance stays encrypted",
    );
    expect(text(html)).toContain(`Record ${RECORD} Owner wallet ${OWNER}`);
    expect(html).toContain('data-state="valid"');
    noTrueOrFalse(html);
  });

  it("says when the record expired, the program is paused or the organization is not verified", () => {
    expect(text(render(found("expired", { status: "not_verified" })))).toContain(
      "Organization Not verified by Sotto Statement Balance is at least $0.50 Shared with Hollis Supply Co. Expired The statement was proven, but the record expired on 6 Oct 2026.",
    );
    expect(
      text(render(found("paused", { status: "verified", legalName: "N", country: "TR" }))),
    ).toContain(
      "Verification paused The Sotto proof program is paused while an issue is looked into",
    );
    expect(
      text(
        render(
          found("valid", { status: "attestation_expired", legalName: "Old Ltd", country: "DE" }),
        ),
      ),
    ).toContain("Organization Old Ltd, DE (verification expired)");
  });

  it("says when a record was closed, never written, or is not a record", () => {
    expect(text(render({ state: "closed", address: RECORD }))).toContain(
      "This record was closed Its owner closed it after it expired",
    );
    expect(text(render({ state: "not_found", address: RECORD }))).toContain(
      "No proof record Nothing was ever written at this address.",
    );
    expect(text(render({ state: "not_a_record", address: RECORD }))).toContain(
      "Not a Sotto proof record",
    );
    expect(text(render({ state: "unavailable" }))).toContain("Proofs are not available here");
  });
});
