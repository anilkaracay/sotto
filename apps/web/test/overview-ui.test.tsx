// The overview's recent activity card (step 1.10, component level): the loading, error, empty, locked
// and opened states. Amounts show only when the tab holds the viewing key, and never as a number
// before that (09 section 3; the same rule as AC-03.5 for the balances). Since step 2.5 payroll lines
// are listed with single payments and "Can read amount" names who else holds each record.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityView, type ActivityState } from "../app/app/[org]/overview/activity.tsx";
import type { ActivityPaymentView } from "../lib/server/activity.ts";
import { expectAmountsInside, privacyOn } from "./helpers/amounts.ts";

const ORG = "3f1b6a2e-5c4d-4e8f-9a0b-1c2d3e4f5a6b";
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function payment(
  id: string,
  status: string,
  errorCode: string | null = null,
  extra: Partial<ActivityPaymentView> = {},
): ActivityPaymentView {
  return {
    id,
    kind: "single",
    run: null,
    recipient: { displayName: "Maya Chen", wallet: "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L" },
    status,
    errorCode,
    createdAt: "2026-09-28T09:30:00.000Z",
    settledAt: null,
    privateBlob: "c2VhbGVk",
    readers: [],
    ...extra,
  };
}

function render(
  state: ActivityState,
  options: { unlocked?: boolean; secrets?: Parameters<typeof ActivityView>[0]["secrets"] } = {},
) {
  return renderToStaticMarkup(
    privacyOn(
      <ActivityView
        orgId={ORG}
        state={state}
        unlocked={options.unlocked ?? false}
        secrets={options.secrets ?? {}}
        unverified={0}
        onRetry={() => undefined}
      />,
    ),
  );
}

describe("overview recent activity", () => {
  it("shows the loading, error and empty states in words", () => {
    expect(text(render({ kind: "loading" }))).toContain("Reading your recent payments…");
    const error = render({
      kind: "error",
      message: "Recent activity could not be loaded. Try again.",
    });
    expect(error).toContain('data-testid="activity-error"');
    expect(text(error)).toContain("Recent activity could not be loaded. Try again. Try again");
    expect(text(render({ kind: "loaded", payments: [] }))).toContain(
      "No payments yet. The payments you make appear here, with amounts only you can read.",
    );
  });

  it("keeps every amount, memo and type sealed while locked, and opens them once the tab holds the viewing key", () => {
    const id = "a0000000-0000-4000-8000-000000000001";
    const payments = [payment(id, "settled")];
    const locked = text(render({ kind: "loaded", payments }));
    expect(locked).toContain(
      "Amounts, memos and types open in this tab once you unlock your keys.",
    );
    expect(locked).toContain("Maya Chen 7SSp…Gq4L Sealed Settled Only you Sealed");
    expect(locked).not.toMatch(/\d+(\.\d+)? USDC/);
    // A secret the page holds is not shown while locked.
    const stale = text(
      render(
        { kind: "loaded", payments },
        {
          secrets: {
            [id]: { amount: "12345678", memo: "Invoice 7", category: "supplier" },
          },
        },
      ),
    );
    expect(stale).not.toContain("12.345678");
    const open = text(
      render(
        { kind: "loaded", payments },
        {
          unlocked: true,
          secrets: {
            [id]: { amount: "12345678", memo: "Invoice 7", category: "supplier" },
          },
        },
      ),
    );
    expect(open).not.toContain("once you unlock");
    expect(open).toContain("Maya Chen Invoice 7 Supplier Settled Only you 12.345678 USDC");
    expectAmountsInside(
      render(
        { kind: "loaded", payments },
        {
          unlocked: true,
          secrets: { [id]: { amount: "12345678", memo: "Invoice 7", category: "supplier" } },
        },
      ),
    );
  });

  it("names a payment that does not open with this key, and a payment screening blocked", () => {
    const unreadable = "a0000000-0000-4000-8000-000000000002";
    const payments = [
      payment(unreadable, "failed_clean"),
      payment("a0000000-0000-4000-8000-000000000003", "draft", "screening_hit"),
    ];
    const html = text(
      render(
        { kind: "loaded", payments },
        { unlocked: true, secrets: { [unreadable]: "unreadable" } },
      ),
    );
    expect(html).toContain("Did not complete Only you Not readable with this key");
    expect(html).toContain("Blocked by screening Only you Sealed");
  });

  it("lists a payroll line with its run and names who else can read each amount", () => {
    const line = "a0000000-0000-4000-8000-000000000004";
    const html = render(
      {
        kind: "loaded",
        payments: [
          payment(line, "settled", null, {
            kind: "payroll_line",
            run: { id: "b0000000-0000-4000-8000-000000000001", title: "August payroll" },
            readers: [
              { name: "Maya Chen", via: "recipient" },
              { name: "Daniel Osei", via: "grant" },
            ],
          }),
        ],
      },
      { unlocked: false },
    );
    expect(html).toContain('data-kind="payroll_line"');
    expect(text(html)).toContain(
      "Maya Chen August payroll Sealed Settled M D Maya Chen, Daniel Osei Sealed",
    );
    expect(html).toContain('title="Maya Chen, Daniel Osei"');
  });
});
