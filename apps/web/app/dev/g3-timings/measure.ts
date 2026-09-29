// Gate G3 (step 2.2): the browser time of each client side proof step, with the product's own SDK
// functions and throwaway keys: the standard keys and the viewing key from a wallet signature, the
// account setup proof, a transfer plan and a withdraw plan in both transaction versions. The proofs
// of a proof of funds (06 section 8) are the withdraw plan's two proofs for the threshold: the
// equality proof over the available balance minus X and the 64 bit batched range proof over the same
// commitment (token-2022 0.19.0 `buildConfidentialWithdrawProofData`, VERIFICATION-LOG step 2.2), so
// the version 1 withdraw plan for X measures them. The accounts are built in memory; nothing is sent.
const RUNS = 5;

export type G3Step = { runs: number[]; medianMs: number; maxMs: number };
export type G3Result = {
  where: "worker" | "main";
  userAgent: string;
  hardwareConcurrency: number;
  moduleLoadMs: number;
  steps: Record<string, G3Step>;
};

async function time(run: () => Promise<unknown> | unknown): Promise<G3Step> {
  const runs: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await run();
    runs.push(Math.round((performance.now() - start) * 10) / 10);
  }
  const sorted = [...runs].sort((a, b) => a - b);
  return { runs, medianMs: sorted[Math.floor(RUNS / 2)] ?? 0, maxMs: sorted[RUNS - 1] ?? 0 };
}

export async function measure(where: "worker" | "main"): Promise<G3Result> {
  const loadStart = performance.now();
  const [keys, confidential, testing, kit] = await Promise.all([
    import("@sotto/sdk/keys"),
    import("@sotto/sdk/confidential"),
    import("@sotto/sdk/testing"),
    import("@solana/kit"),
  ]);
  const moduleLoadMs = Math.round(performance.now() - loadStart);

  // A throwaway wallet: an Ed25519 key made here, whose signatures stand in for the wallet's.
  const wallet = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  const owner = await kit.getAddressFromPublicKey(wallet.publicKey);
  const sign = async (message: Uint8Array) =>
    new Uint8Array(
      await crypto.subtle.sign({ name: "Ed25519" }, wallet.privateKey, new Uint8Array(message)),
    );
  const keySignature = await sign(keys.confidentialKeysMessage());
  const viewSignature = await sign(keys.viewKeyMessage(owner));
  const recipientWallet = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign"]);
  const recipient = await kit.getAddressFromPublicKey(recipientWallet.publicKey);
  const recipientKeys = await keys.deriveStandardKeys(
    recipient,
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "Ed25519" },
        recipientWallet.privateKey,
        new Uint8Array(keys.confidentialKeysMessage()),
      ),
    ),
  );

  const steps: Record<string, G3Step> = {};
  steps.keyDerivation = await time(() => keys.deriveStandardKeys(owner, keySignature));
  steps.viewingKeyDerivation = await time(() => keys.deriveViewingKey(owner, viewSignature));
  const material = await keys.deriveStandardKeys(owner, keySignature);
  const mint = kit.address("AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd");
  steps.setupProof = await time(() =>
    confidential.confidentialAccountSetupInstructions({
      owner: kit.createNoopSigner(owner),
      mint,
      keys: material,
    }),
  );
  const source = testing.encryptedTokenAccount({
    owner,
    mint,
    keys: material,
    available: 1_000_000_000n,
    pending: 0n,
  });
  const destination = testing.encryptedTokenAccount({
    owner: recipient,
    mint,
    keys: recipientKeys,
    available: 0n,
    pending: 0n,
  });
  const mintAccount = confidential.decodeToken2022Mint(
    testing.encodeConfidentialMint({ decimals: 6 }),
  );
  const rent = async () => 1_000_000n;
  for (const version of [1, 0] as const) {
    steps[`transferPlanV${version}`] = await time(() =>
      confidential.confidentialTransferPlan({
        owner,
        sourceToken: owner,
        sourceTokenAccount: source,
        destinationToken: recipient,
        destinationTokenAccount: destination,
        mint,
        mintAccount,
        amount: 12_345_678n,
        keys: material,
        version,
        rent,
      }),
    );
    steps[`withdrawPlanV${version}`] = await time(() =>
      confidential.confidentialWithdrawPlan({
        owner,
        token: owner,
        tokenAccount: source,
        mint,
        decimals: 6,
        amount: 7_000_000n,
        keys: material,
        version,
        rent,
      }),
    );
  }
  // 06 section 8: the proof of funds proofs for X = 7 USDC are the version 1 withdraw plan's proofs.
  steps.proofOfFundsProofs = steps.withdrawPlanV1 ?? { runs: [], medianMs: 0, maxMs: 0 };
  return {
    where,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    moduleLoadMs,
    steps,
  };
}
