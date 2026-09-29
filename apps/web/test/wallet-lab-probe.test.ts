// The step 2.1 wallet lab probes (Q-15, development only): R11 transfers 1 base unit of devnet USDC
// from the owner's account to itself with SPL Token alone; R12 is one ZK ElGamal proof verification
// with no account. Both are version 0, with the owner as fee payer and only signer.
import { getCompiledTransactionMessageDecoder, type Blockhash } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { buildProbe, DEVNET_USDC_MINT, TEST_ADDRESS } from "../app/dev/wallet-lab/lab-core.ts";

const BLOCKHASH = {
  blockhash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" as Blockhash,
  lastValidBlockHeight: 1n,
};
const ACCOUNT = "GP1RuDnt44CvuujDmsUq5XyrD5Rbagt6cbEbW2rfh1zZ";

describe("wallet lab probes (Q-15)", () => {
  it("Q-15 builds R11 as an SPL Token self transfer of 1 base unit of devnet USDC", () => {
    const { messageBytes } = buildProbe(TEST_ADDRESS, "usdc", ACCOUNT, BLOCKHASH);
    const message = getCompiledTransactionMessageDecoder().decode(messageBytes);
    if (message.version !== 0) throw new Error("R11 must be a version 0 transaction");
    expect(message.staticAccounts[0]).toBe(TEST_ADDRESS);
    expect(message.header.numSignerAccounts).toBe(1);
    const [instruction] = message.instructions;
    expect(message.staticAccounts[instruction?.programAddressIndex ?? -1]).toBe(
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    );
    expect(message.staticAccounts).toContain(DEVNET_USDC_MINT);
    expect([...(instruction?.data ?? [])]).toEqual([12, 1, 0, 0, 0, 0, 0, 0, 0, 6]);
  });

  it("Q-15 builds R12 as a lone ZK ElGamal proof verification with no account", () => {
    const { messageBytes } = buildProbe(TEST_ADDRESS, "zk", ACCOUNT, BLOCKHASH);
    const message = getCompiledTransactionMessageDecoder().decode(messageBytes);
    if (message.version !== 0) throw new Error("R12 must be a version 0 transaction");
    expect(message.staticAccounts).toEqual([
      TEST_ADDRESS,
      "ZkE1Gama1Proof11111111111111111111111111111",
    ]);
    const [instruction] = message.instructions;
    expect(instruction?.accountIndices ?? []).toEqual([]);
    expect(instruction?.data?.length).toBe(97);
    expect(instruction?.data?.[0]).toBe(4);
  });
});
