// The owner's daily balance snapshot (AC-05.2, 07 section 6; step 2.12): when the owner's keys are
// unlocked on the overview, the tab writes a `balance_snapshot` self disclosure at most once per UTC
// day, holding the decrypted available and pending balances, sealed to the owner's own viewing key
// after its registration verified (I-8), under a manifest the owner wallet signs (one signature a
// day). The balances leave the tab only inside the sealed box. The server keeps one per day (409
// snapshot_exists), so two tabs cannot write two. In the hackathon build no grant receives snapshots.
import { validatePayload, type DisclosurePayloadV1 } from "@sotto/sdk/disclosure";
import { verifyViewKeyRegistration } from "@sotto/sdk/keys/public";
import type { CryptoWorkerClient } from "../crypto-worker/client.ts";
import type { DisclosureItemView } from "../server/disclosures.ts";
import { ApiCallError, callApi } from "./api.ts";
import { storeRecords } from "./records.ts";
import type { AssetSymbol } from "@sotto/sdk/cluster/assets";

export type OwnerViewerKey = {
  userId: string;
  wallet: string;
  publicKey: string;
  signature: string;
};

export type SnapshotResult =
  /** Written now. */
  | "saved"
  /** Today's snapshot was already saved (by this tab, another tab or an earlier unlock). */
  | "exists"
  /** The wallet did not sign the manifest; nothing was saved. */
  | "not_signed"
  /** The owner's viewing key registration did not verify, so nothing was sealed to it. */
  | "key_unverified";

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Today's UTC day, the snapshot's subject. */
export const snapshotDay = (now: Date) => now.toISOString().slice(0, 10);

export async function saveDailySnapshot(input: {
  orgId: string;
  /** The organization's asset's symbol, the record's currency (step 4.3). */
  currency: AssetSymbol;
  owner: OwnerViewerKey;
  available: bigint;
  pending: bigint;
  now: Date;
  sign: (message: Uint8Array) => Promise<Uint8Array | string>;
  worker: () => CryptoWorkerClient;
}): Promise<SnapshotResult> {
  const day = snapshotDay(input.now);
  const { items } = await callApi<{ items: DisclosureItemView[] }>(
    `/api/orgs/${input.orgId}/disclosures?kind=balance_snapshot&from=${day}`,
  );
  if (items.some((item) => item.subject === day)) return "exists";
  const verified = await verifyViewKeyRegistration({
    wallet: input.owner.wallet,
    publicKey: fromBase64(input.owner.publicKey),
    signature: fromBase64(input.owner.signature),
  });
  if (!verified) return "key_unverified";
  const payload: DisclosurePayloadV1 = validatePayload({
    v: 1,
    org: input.orgId,
    kind: "balance_snapshot",
    direction: "in",
    category: "other",
    subject: day,
    amount: input.available.toString(),
    currency: input.currency,
    memo: null,
    gross: null,
    tax: null,
    counterparty: null,
    signatures: [],
    created_at: input.now.toISOString(),
    pending: input.pending.toString(),
  });
  try {
    const stored = await storeRecords({
      orgId: input.orgId,
      items: [
        {
          id: crypto.randomUUID(),
          viewerUserId: input.owner.userId,
          grantId: null,
          kind: "balance_snapshot",
          subject: day,
          ciphertext: await input.worker().seal(fromBase64(input.owner.publicKey), payload),
        },
      ],
      sign: input.sign,
    });
    return stored.kind === "not_signed" ? "not_signed" : "saved";
  } catch (error) {
    if (error instanceof ApiCallError && error.code === "snapshot_exists") return "exists";
    throw error;
  }
}
