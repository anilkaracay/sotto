// Funding in two signatures (06 section 4, step 1.7.1): wrap and deposit share one transaction when it
// fits the size limit of the transaction version, otherwise they go apart and the reason is kept; the
// size is measured against the version's limit (1232 bytes for v0, 4096 for v1).
import { getTransferSolInstruction } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { createNoopSigner, generateKeyPairSigner, lamports } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { getClusterConfig, type AvailableClusterConfig } from "../src/cluster/config.ts";
import { fundingTransactions, wrapAndDepositTransactions } from "../src/confidential/public.ts";
import { measureTransaction } from "../src/tx/size.ts";

const devnet = getClusterConfig("devnet") as AvailableClusterConfig;

describe("wrap and deposit (06 section 4)", () => {
  it("AC-04.1 AC-04.2 wraps and deposits in one transaction that fits version 0 and version 1", async () => {
    const owner = createNoopSigner((await generateKeyPairSigner()).address);
    for (const version of [0, 1] as const) {
      const plan = await wrapAndDepositTransactions({
        owner,
        unwrappedMint: devnet.usdcMint as NonNullable<typeof devnet.usdcMint>,
        unwrappedTokenProgram: TOKEN_PROGRAM_ADDRESS,
        programAddress: devnet.programs.tokenWrap,
        amount: 25_000_000n,
        decimals: 6,
        version,
      });
      expect(plan.split).toBeNull();
      expect(plan.transactions).toHaveLength(1);
      const [only] = plan.transactions;
      // The idempotent account creation, the wrap and the deposit, in that order.
      expect(only?.map((instruction) => instruction.programAddress)).toEqual([
        "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
        devnet.programs.tokenWrap,
        devnet.programs.token2022,
      ]);
      const measured = measureTransaction({
        feePayer: owner.address,
        instructions: only ?? [],
        version,
      });
      expect(measured.fits).toBe(true);
      expect(measured.limit).toBe(version === 0 ? 1232 : 4096);
    }
  });

  it("falls back to two transactions over the limit and keeps the sizes as the reason", async () => {
    const owner = await generateKeyPairSigner();
    const wrap = [
      getTransferSolInstruction({
        source: owner,
        destination: (await generateKeyPairSigner()).address,
        amount: lamports(1n),
      }),
    ];
    const deposit = getTransferSolInstruction({
      source: owner,
      destination: (await generateKeyPairSigner()).address,
      amount: lamports(2n),
    });
    expect(fundingTransactions(wrap, deposit, { size: 1300, limit: 1232, fits: false })).toEqual({
      transactions: [wrap, [deposit]],
      split: { size: 1300, limit: 1232 },
    });
    expect(fundingTransactions(wrap, deposit, { size: 700, limit: 1232, fits: true })).toEqual({
      transactions: [[...wrap, deposit]],
      split: null,
    });
  });

  it("measures against the limit of the version: 40 transfers do not fit v0 but fit v1", async () => {
    const payer = await generateKeyPairSigner();
    const instructions = await Promise.all(
      Array.from({ length: 40 }, async () =>
        getTransferSolInstruction({
          source: payer,
          destination: (await generateKeyPairSigner()).address,
          amount: lamports(1n),
        }),
      ),
    );
    const v0 = measureTransaction({ feePayer: payer.address, instructions, version: 0 });
    const v1 = measureTransaction({ feePayer: payer.address, instructions, version: 1 });
    expect(v0).toMatchObject({ limit: 1232, fits: false });
    expect(v0.size).toBeGreaterThan(1232);
    expect(v1).toMatchObject({ limit: 4096, fits: true });
  });
});
