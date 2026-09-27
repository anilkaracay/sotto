// POST /api/wallet-reports (06 section 9, step 1.7): the diagnostic log line with the wallet name and
// version for the determinism check and the signed message check, and the strict body that keeps
// keys, signatures and amounts out of it.
import type { TestDatabase } from "@sotto/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/wallet-reports/route.ts";
import {
  APP_ORIGIN,
  apiRequest,
  createUserWithSession,
  setUpApiTest,
  tearDownApiTest,
} from "./helpers/api.ts";

let test: TestDatabase;
let ip = 0;
let lines: Record<string, unknown>[] = [];

beforeAll(async () => {
  test = await setUpApiTest();
});

afterAll(async () => {
  await tearDownApiTest(test);
});

beforeEach(() => {
  lines = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => {
    lines.push(JSON.parse(line) as Record<string, unknown>);
  });
});

const WALLET = {
  name: "Test Wallet",
  version: "1.0.0",
  features: [
    { name: "solana:signMessage", version: "1.1.0" },
    { name: "solana:signTransaction", version: "1.0.0" },
  ],
};

function post(cookie: string | null, body: unknown) {
  ip += 1;
  return POST(
    apiRequest("/api/wallet-reports", {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        origin: APP_ORIGIN,
        "content-type": "application/json",
        "x-forwarded-for": `198.20.${Math.floor(ip / 250)}.${ip % 250}`,
        ...(cookie ? { cookie } : {}),
      },
    }),
  );
}

const reports = () => lines.filter((line) => line.event === "wallet_report");

describe("POST /api/wallet-reports", () => {
  it("AC-03.3 logs a wallet whose key signature changed, with its name and version, and stores nothing", async () => {
    const user = await createUserWithSession(test);
    const response = await post(user.cookie, {
      kind: "signature_not_deterministic",
      wallet: WALLET,
    });
    expect(response.status).toBe(204);
    expect(reports()).toEqual([
      expect.objectContaining({
        level: "warn",
        kind: "signature_not_deterministic",
        userId: user.userId,
        walletName: "Test Wallet",
        walletStandardVersion: "1.0.0",
        walletFeatures: WALLET.features,
      }),
    ]);
  });

  it("logs the compute budget a wallet changed, a transaction it changed otherwise, and a funding split", async () => {
    const user = await createUserWithSession(test);
    const changes = [{ field: "computeUnitPrice", built: "100", signed: "500000" }];
    expect(
      (await post(user.cookie, { kind: "compute_budget_changed", wallet: WALLET, changes })).status,
    ).toBe(204);
    expect(
      (
        await post(user.cookie, {
          kind: "transaction_changed",
          wallet: WALLET,
          reason: "instruction 1: the data",
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await post(user.cookie, {
          kind: "funding_split",
          wallet: WALLET,
          version: 0,
          size: 1300,
          limit: 1232,
        })
      ).status,
    ).toBe(204);
    expect(reports()).toEqual([
      expect.objectContaining({ level: "warn", kind: "compute_budget_changed", changes }),
      expect.objectContaining({
        level: "warn",
        kind: "transaction_changed",
        reason: "instruction 1: the data",
        walletName: "Test Wallet",
      }),
      expect.objectContaining({ kind: "funding_split", version: 0, size: 1300, limit: 1232 }),
    ]);
  });

  it("refuses anything but the defined reports: no signatures, keys or free text", async () => {
    const user = await createUserWithSession(test);
    const bodies = [
      { kind: "other", wallet: WALLET },
      { kind: "signature_not_deterministic", wallet: WALLET, signature: "AAAA" },
      { kind: "signature_not_deterministic", wallet: { ...WALLET, name: "bad\nname" } },
      { kind: "signature_not_deterministic", wallet: { ...WALLET, version: "1.0.0 beta" } },
      { kind: "signature_not_deterministic", wallet: { ...WALLET, secretKey: "x" } },
      {
        kind: "compute_budget_changed",
        wallet: WALLET,
        changes: [{ field: "computeUnitPrice", built: "1.5", signed: "2" }],
      },
      {
        kind: "compute_budget_changed",
        wallet: WALLET,
        changes: [{ field: "amount", built: "1", signed: "2" }],
      },
      { kind: "transaction_changed", wallet: WALLET, reason: "x".repeat(121) },
      { kind: "transaction_changed", wallet: WALLET, reason: "<script>" },
      { kind: "funding_split", wallet: WALLET, version: 2, size: 1300, limit: 1232 },
      { kind: "funding_split", wallet: WALLET, version: 0, size: 1.5, limit: 1232 },
    ];
    for (const body of bodies) {
      const response = await post(user.cookie, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(reports()).toEqual([]);
    expect((await post(null, { kind: "signature_not_deterministic", wallet: WALLET })).status).toBe(
      401,
    );
  });
});
