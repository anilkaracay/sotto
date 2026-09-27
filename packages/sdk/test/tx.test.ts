import {
  AccountRole,
  address,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SolanaError,
  type Instruction,
  type RpcTransport,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  computeUnitLimitFromSimulation,
  MAX_COMPUTE_UNIT_LIMIT,
  MAX_RPC_RETRIES,
  priorityFeeFromRecentFees,
  retryingTransport,
  writableAccounts,
} from "../src/tx/index.ts";

describe("compute budget (06 section 9)", () => {
  it("sets the compute unit limit at simulated usage plus 20 percent, capped at 1.4 million", () => {
    expect(computeUnitLimitFromSimulation(150n)).toBe(180);
    expect(computeUnitLimitFromSimulation(151n)).toBe(182); // ceil(181.2)
    expect(computeUnitLimitFromSimulation(0n)).toBe(0);
    expect(computeUnitLimitFromSimulation(1_300_000n)).toBe(MAX_COMPUTE_UNIT_LIMIT);
    expect(() => computeUnitLimitFromSimulation(-1n)).toThrow();
  });

  it("uses the nearest rank 75th percentile of recent fees, capped", () => {
    const fees = [10n, 40n, 20n, 30n].map((prioritizationFee) => ({ prioritizationFee }));
    expect(priorityFeeFromRecentFees(fees, 1_000n)).toBe(30n);
    expect(priorityFeeFromRecentFees(fees, 25n)).toBe(25n);
    expect(priorityFeeFromRecentFees([], 1_000n)).toBe(0n);
    expect(priorityFeeFromRecentFees([{ prioritizationFee: 7 }], 1_000n)).toBe(7n);
  });

  it("collects writable accounts once", () => {
    const a = address("7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L");
    const b = address("6xosZg2PbZuneXX4riov7GmUCJmydQc3o5MGX6p5EU2");
    const c = address("11111111111111111111111111111111");
    const instructions: Instruction[] = [
      {
        programAddress: c,
        accounts: [
          { address: a, role: AccountRole.WRITABLE_SIGNER },
          { address: b, role: AccountRole.READONLY },
        ],
      },
      {
        programAddress: c,
        accounts: [
          { address: a, role: AccountRole.WRITABLE },
          { address: b, role: AccountRole.WRITABLE },
        ],
      },
    ];
    expect(writableAccounts(instructions)).toEqual([a, b]);
  });
});

describe("retryingTransport (D-14)", () => {
  const rateLimited = () =>
    new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
      headers: new Headers(),
      message: "Too Many Requests",
      statusCode: 429,
    });
  const config = {
    payload: { jsonrpc: "2.0", id: 1, method: "getSlot" },
  } as unknown as Parameters<RpcTransport>[0];

  it("retries 429 with 1 s, 2 s, 4 s backoff and reports each retry", async () => {
    let calls = 0;
    const inner = (async () => {
      calls++;
      if (calls <= 3) throw rateLimited();
      return { ok: true };
    }) as unknown as RpcTransport;
    const notices: number[][] = [];
    const sleeps: number[] = [];
    await expect(
      retryingTransport(
        inner,
        (r, m, d) => notices.push([r, m, d]),
        async (ms) => {
          sleeps.push(ms);
        },
      )(config),
    ).resolves.toEqual({ ok: true });
    expect(sleeps).toEqual([1000, 2000, 4000]);
    expect(notices).toEqual([
      [1, 3, 1000],
      [2, 3, 2000],
      [3, 3, 4000],
    ]);
  });

  it("gives up after the last retry and never retries other errors", async () => {
    let calls = 0;
    const always = (async () => {
      calls++;
      throw rateLimited();
    }) as unknown as RpcTransport;
    await expect(retryingTransport(always, undefined, async () => {})(config)).rejects.toThrow();
    expect(calls).toBe(MAX_RPC_RETRIES + 1);
    let other = 0;
    const boom = (async () => {
      other++;
      throw new Error("boom");
    }) as unknown as RpcTransport;
    await expect(retryingTransport(boom, undefined, async () => {})(config)).rejects.toThrow(
      "boom",
    );
    expect(other).toBe(1);
  });
});
