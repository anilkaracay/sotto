// The SOL faucet's low balance alert (step 4.6, D-31), with a stand-in RPC and a stand-in service:
// one message under 0.5 SOL, none at or above it, again after 24 hours while it stays low, a failed
// send tried again, and nothing read on any ledger but devnet's.
import { GENESIS_HASHES } from "@sotto/sdk/cluster";
import type { SolanaRpc } from "@sotto/sdk/tx";
import type { Address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  lowBalanceMessage,
  SOL_FAUCET_ALERT_LAMPORTS,
  solFaucetHealthJob,
} from "../src/jobs/sol-faucet-health.ts";
import { notifyTarget } from "../src/notify.ts";

const PAYER = "8QJKvfopCqqDHEGfp5Lf4m8SCC1uQGWpZa8YC8L6tVJn" as Address;
const target = notifyTarget("https://discord.com/api/webhooks/1/hidden-token");
const context = { signal: new AbortController().signal, log: () => {} };

function setUp(genesis: string = GENESIS_HASHES.devnet) {
  const state = { balance: 3_000_000_000n, now: Date.parse("2026-10-09T12:00:00Z"), status: 204 };
  const asked: string[] = [];
  const sent: string[] = [];
  const rpc = {
    getGenesisHash: () => ({
      send: async () => {
        asked.push("getGenesisHash");
        return genesis;
      },
    }),
    getBalance: () => ({
      send: async () => {
        asked.push("getBalance");
        return { value: state.balance };
      },
    }),
  } as unknown as SolanaRpc;
  const fetchFn = (async (_url: unknown, init?: { body?: unknown }) => {
    sent.push((JSON.parse(String(init?.body)) as { content: string }).content);
    return new Response(null, { status: state.status });
  }) as typeof fetch;
  const job = solFaucetHealthJob({
    rpc,
    payer: PAYER,
    target,
    fetchFn,
    now: () => new Date(state.now),
  });
  return { state, asked, sent, run: () => job.run(context) };
}

describe("sol-faucet-health job", () => {
  it("tells the operator once when the wallet falls under 0.5 SOL, and again after 24 hours", async () => {
    const { state, sent, run } = setUp();
    expect(await run()).toEqual({ checked: true, low: false });
    state.balance = SOL_FAUCET_ALERT_LAMPORTS;
    expect(await run()).toEqual({ checked: true, low: false });
    expect(sent).toEqual([]);

    state.balance = SOL_FAUCET_ALERT_LAMPORTS - 1n;
    expect(await run()).toEqual({ checked: true, low: true, alerted: true, service: "discord" });
    expect(sent).toEqual([
      `Sotto: the SOL faucet's wallet ${PAYER} holds 0.49 SOL, under 0.50 SOL. Send it devnet SOL so new wallets keep getting test SOL.`,
    ]);
    expect(sent[0]).toBe(lowBalanceMessage(PAYER, SOL_FAUCET_ALERT_LAMPORTS - 1n));
    // Still low five minutes later: no second message.
    state.now += 5 * 60 * 1000;
    state.balance = 120_000_000n;
    expect(await run()).toEqual({ checked: true, low: true, alerted: false });
    expect(sent).toHaveLength(1);
    // Still low a day later: one more.
    state.now += 24 * 60 * 60 * 1000;
    expect(await run()).toMatchObject({ low: true, alerted: true });
    expect(sent[1]).toContain("holds 0.12 SOL");
    // Funded, then low again: a new message at once.
    state.balance = 3_000_000_000n;
    expect(await run()).toEqual({ checked: true, low: false });
    state.balance = 400_000_000n;
    expect(await run()).toMatchObject({ low: true, alerted: true });
    expect(sent).toHaveLength(3);
  });

  it("tries a failed send again at the next run, and says nothing without a service", async () => {
    const { state, sent, run } = setUp();
    state.balance = 100_000_000n;
    state.status = 503;
    expect(await run()).toMatchObject({ low: true, alerted: false });
    state.status = 204;
    expect(await run()).toMatchObject({ low: true, alerted: true });
    expect(sent).toHaveLength(2);

    const quiet = solFaucetHealthJob({
      rpc: {
        getGenesisHash: () => ({ send: async () => GENESIS_HASHES.devnet }),
        getBalance: () => ({ send: async () => ({ value: 1n }) }),
      } as unknown as SolanaRpc,
      payer: PAYER,
      target: null,
    });
    expect(await quiet.run(context)).toEqual({
      checked: true,
      low: true,
      alerted: false,
      skipped: true,
    });
  });

  it("reads no balance on any ledger but devnet's", async () => {
    const { asked, sent, run } = setUp(GENESIS_HASHES.mainnet);
    expect(await run()).toEqual({ checked: false });
    expect(await run()).toEqual({ checked: false });
    expect(asked).toEqual(["getGenesisHash"]);
    expect(sent).toEqual([]);
  });
});
