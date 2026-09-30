// The owner's daily balance snapshot (AC-05.2, 07 section 6; step 2.12): at most once per UTC day, only
// after the owner's viewing key registration verifies (I-8), sealed to that key under a signed
// manifest, and the balances never leave the tab in plaintext. The balance growth card in each state,
// every figure inside Amount with the privacy screen on (F-15).
import { openPayload } from "@sotto/sdk/disclosure/seal";
import { viewKeyRegistrationMessage } from "@sotto/sdk/keys/public";
import { sealJson } from "@sotto/sdk/disclosure/seal";
import { viewerKeypair } from "@sotto/sdk/testing";
import { generateKeyPairSigner, signBytes } from "@solana/kit";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiCallError } from "../lib/client/api.ts";
import { expectAmountsInside, privacyOn } from "./helpers/amounts.ts";

const calls: { path: string; body: string }[] = [];
let existing: { subject: string }[] = [];
let postError: ApiCallError | null = null;

vi.mock("../lib/client/api.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/client/api.ts")>();
  return {
    ...original,
    callApi: async (path: string, options?: { method?: string; body?: unknown }) => {
      calls.push({ path, body: JSON.stringify(options?.body ?? null) });
      if (options?.method === "POST") {
        if (postError) throw postError;
        return { manifestId: "m", count: 1 };
      }
      return { items: existing, manifests: [] };
    },
  };
});

const { saveDailySnapshot } = await import("../lib/client/balance-snapshot.ts");
const { BalanceGrowthView, SNAPSHOT_NOTES } =
  await import("../app/app/[org]/overview/balance-growth.tsx");

const ORG = "3f1b6a2e-5c4d-4e8f-9a0b-1c2d3e4f5a6b";
const NOW = new Date("2026-09-30T08:00:00.000Z");
/** I-2: balances that must never be in a request. */
const AVAILABLE = 32_199_481n;
const PENDING = 1_937_153n;

async function owner() {
  const wallet = await generateKeyPairSigner();
  const keys = await viewerKeypair();
  const signature = new Uint8Array(
    await signBytes(wallet.keyPair.privateKey, viewKeyRegistrationMessage(keys.publicKey)),
  );
  const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  return {
    keys,
    wallet,
    record: {
      userId: "a0000000-0000-4000-8000-000000000001",
      wallet: wallet.address,
      publicKey: toBase64(keys.publicKey),
      signature: toBase64(signature),
    },
  };
}

function save(record: Awaited<ReturnType<typeof owner>>["record"], sign = vi.fn()) {
  return saveDailySnapshot({
    orgId: ORG,
    owner: record,
    available: AVAILABLE,
    pending: PENDING,
    now: NOW,
    sign: sign.mockImplementation(async () => new Uint8Array(64).fill(7)),
    // The crypto worker's seal: canonical JSON sealed to the key, as in the tab.
    worker: () =>
      ({
        seal: (publicKey: Uint8Array, value: unknown) => sealJson(value, publicKey),
      }) as never,
  });
}

beforeEach(() => {
  calls.length = 0;
  existing = [];
  postError = null;
});

describe("the daily balance snapshot (AC-05.2)", () => {
  it("AC-05.2 saves one snapshot a day, sealed to the owner's key, with no plaintext balance in any request", async () => {
    const { keys, record } = await owner();
    const sign = vi.fn();
    expect(await save(record, sign)).toBe("saved");
    expect(sign).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => call.path)).toEqual([
      `/api/orgs/${ORG}/disclosures?kind=balance_snapshot&from=2026-09-30`,
      `/api/orgs/${ORG}/disclosures`,
    ]);
    const posted = JSON.parse(calls[1]?.body ?? "null") as {
      items: {
        kind: string;
        subject: string;
        viewerUserId: string;
        grantId: null;
        ciphertext: string;
      }[];
    };
    expect(posted.items).toHaveLength(1);
    expect(posted.items[0]).toMatchObject({
      kind: "balance_snapshot",
      subject: "2026-09-30",
      viewerUserId: record.userId,
      grantId: null,
    });
    // I-2: the balances travel only inside the box sealed to the owner's key.
    const everything = calls.map((call) => `${call.path} ${call.body}`).join("\n");
    for (const secret of [AVAILABLE, PENDING, AVAILABLE + PENDING]) {
      expect(everything).not.toContain(secret.toString());
    }
    expect(everything).not.toContain("32.199481");
    const opened = await openPayload(
      new Uint8Array(Buffer.from(posted.items[0]?.ciphertext ?? "", "base64")),
      keys,
    );
    expect(opened).toMatchObject({
      kind: "balance_snapshot",
      subject: "2026-09-30",
      amount: AVAILABLE.toString(),
      pending: PENDING.toString(),
    });
  });

  it("AC-05.2 writes nothing, and asks for no signature, when today's snapshot exists", async () => {
    const { record } = await owner();
    existing = [{ subject: "2026-09-30" }];
    const sign = vi.fn();
    expect(await save(record, sign)).toBe("exists");
    expect(sign).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    // Another tab saved it between the check and the write: the server's 409 is the same answer.
    existing = [];
    postError = new ApiCallError(
      409,
      "snapshot_exists",
      "Today's balance snapshot is already saved",
    );
    expect(await save(record)).toBe("exists");
  });

  it("AC-05.2 seals nothing to a viewing key whose registration does not verify (I-8)", async () => {
    const { record } = await owner();
    const other = await owner();
    const sign = vi.fn();
    expect(await save({ ...record, publicKey: other.record.publicKey }, sign)).toBe(
      "key_unverified",
    );
    expect(sign).not.toHaveBeenCalled();
    expect(calls.some((call) => call.path.endsWith("/disclosures") && call.body !== "null")).toBe(
      false,
    );
  });
});

describe("the balance growth card (AC-05.2)", () => {
  const render = (state: Parameters<typeof BalanceGrowthView>[0]["state"], note = null) =>
    renderToStaticMarkup(
      privacyOn(<BalanceGrowthView state={state} note={note} onRetry={() => undefined} />),
    );
  const text = (html: string) =>
    html
      .replace(/<[^>]+>/g, " ")
      .replaceAll("&#x27;", "'")
      .replace(/\s+/g, " ")
      .trim();

  it("AC-05.2 draws one bar per month with data, no bar for the others, and the history's first day", () => {
    const html = render({
      kind: "ready",
      unverified: 0,
      history: {
        kind: "history",
        months: [
          { month: "2026-07", balance: 12_000_000n },
          { month: "2026-08", balance: null },
          { month: "2026-09", balance: 32_199_481n },
        ],
        startsOn: "2026-07-14",
        latest: "2026-09",
      },
    });
    expect(html.match(/data-testid="growth-bar"/g)).toHaveLength(2);
    expect(html.match(/data-testid="growth-bar-none"/g)).toHaveLength(1);
    expect(text(html)).toContain("September 2026 32.199481 wUSDC");
    expect(text(html)).toContain("Balance history starts on 14 Jul 2026");
    expectAmountsInside(html);
  });

  it("AC-05.2 says when there is no history yet, while locked, and when it cannot be read", () => {
    expect(text(render({ kind: "ready", unverified: 0, history: { kind: "empty" } }))).toContain(
      "No balance history yet. Sotto records your balance once a day when you unlock your keys here, encrypted for you only.",
    );
    expect(text(render({ kind: "locked" }))).toContain("Unlock to see");
    expect(text(render({ kind: "error" }))).toContain(
      "Your balance history could not be read. Try again",
    );
    expect(
      text(
        renderToStaticMarkup(
          <BalanceGrowthView
            state={{ kind: "loading" }}
            note={SNAPSHOT_NOTES.not_signed ?? null}
            onRetry={() => undefined}
          />,
        ),
      ),
    ).toContain(
      "Your wallet did not sign today's balance record, so today is not in the history yet.",
    );
    // No invented bars: a history of one month shows one bar and no empty columns before it.
    const one = render({
      kind: "ready",
      unverified: 0,
      history: {
        kind: "history",
        months: [{ month: "2026-09", balance: 5_000_000n }],
        startsOn: "2026-09-30",
        latest: "2026-09",
      },
    });
    expect(one.match(/data-testid="growth-bar"/g)).toHaveLength(1);
    expect(one).not.toContain("growth-bar-none");
  });
});
