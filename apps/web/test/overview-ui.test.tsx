// The overview's recent activity card (step 1.10, component level): the loading, error, empty, locked
// and opened states. Amounts show only when the tab holds the viewing key, and never as a number
// before that (09 section 3; the same rule as AC-03.5 for the balances).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityView, type ActivityState } from "../app/app/[org]/overview/activity.tsx";
import type { PaymentView } from "../lib/server/payments.ts";

const ORG = "3f1b6a2e-5c4d-4e8f-9a0b-1c2d3e4f5a6b";
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function payment(id: string, status: string, errorCode: string | null = null): PaymentView {
  return {
    id,
    recipientId: "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e",
    recipient: { displayName: "Maya Chen", wallet: "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L" },
    idempotencyKey: "0d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6",
    status,
    privateBlob: "c2VhbGVk",
    signatures: [],
    settledSlot: null,
    errorCode,
    createdAt: "2026-09-28T09:30:00.000Z",
    attempts: [],
    contentsHash: null,
    approvals: { required: 1, messages: 0 },
  };
}

function render(
  state: ActivityState,
  options: { unlocked?: boolean; secrets?: Parameters<typeof ActivityView>[0]["secrets"] } = {},
) {
  return renderToStaticMarkup(
    <ActivityView
      orgId={ORG}
      state={state}
      unlocked={options.unlocked ?? false}
      secrets={options.secrets ?? {}}
      unverified={0}
      onRetry={() => undefined}
    />,
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
    expect(locked).toContain("Maya Chen 7SSp…Gq4L Sealed Settled Sealed");
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
    expect(open).toContain("Maya Chen Invoice 7 Supplier Settled 12.345678 USDC");
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
    expect(html).toContain("Did not complete Not readable with this key");
    expect(html).toContain("Blocked by screening Sealed");
  });
});
