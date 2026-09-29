// Storing a batch of new records (07 sections 4 and 7; step 2.4): the owner wallet signs the batch's
// manifest and the server stores it. The owner's browser picks the grants that cover a record with
// its own clock or the record's settlement time, and the server checks again with the settlement
// time it holds; at a period's boundary, or with this device's clock off, the two can disagree, and
// the server refuses the grant's item (disclosure_not_allowed) with the whole batch. The batch is then
// signed again without the grants' items, so the owner's and the recipients' records are kept; the
// grants get theirs from Share past records, which the server computes with its own times.
import { buildManifest, manifestMessage, type DisclosureKind } from "@sotto/sdk/disclosure";
import { ApiCallError, callApi } from "./api.ts";

export type RecordItem = {
  id: string;
  viewerUserId: string;
  grantId: string | null;
  kind: DisclosureKind;
  subject: string;
  ciphertext: Uint8Array;
};

export type StoreRecordsResult =
  /** Stored; `withoutGrants` when the grants' items were left out after a refusal. */
  | { kind: "stored"; withoutGrants: boolean }
  /** The wallet did not sign; nothing was stored. */
  | { kind: "not_signed" };

/** Copy for a batch stored without its grants' items, or whose grants could not be read. */
export const GRANT_COPIES_MISSING =
  "No copy was saved for the keys you granted; Viewing keys shows the records to share.";

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export async function storeRecords(options: {
  orgId: string;
  items: readonly RecordItem[];
  /** The owner wallet's message signature, or a problem name when it did not sign. */
  sign: (message: Uint8Array) => Promise<Uint8Array | string>;
}): Promise<StoreRecordsResult> {
  const store = async (items: readonly RecordItem[]): Promise<boolean> => {
    const manifest = await buildManifest({
      org: options.orgId,
      createdAt: new Date().toISOString(),
      items: items.map((item) => ({
        id: item.id,
        viewer: item.viewerUserId,
        ciphertext: item.ciphertext,
      })),
    });
    const signature = await options.sign(await manifestMessage(manifest));
    if (typeof signature === "string") return false;
    await callApi(`/api/orgs/${options.orgId}/disclosures`, {
      method: "POST",
      body: {
        manifest,
        signature: toBase64(signature),
        items: items.map((item) => ({
          id: item.id,
          viewerUserId: item.viewerUserId,
          grantId: item.grantId,
          kind: item.kind,
          subject: item.subject,
          ciphertext: toBase64(item.ciphertext),
        })),
      },
    });
    return true;
  };
  try {
    return (await store(options.items))
      ? { kind: "stored", withoutGrants: false }
      : { kind: "not_signed" };
  } catch (error) {
    const own = options.items.filter((item) => item.grantId === null);
    const refused = error instanceof ApiCallError && error.code === "disclosure_not_allowed";
    if (!refused || own.length === 0 || own.length === options.items.length) throw error;
    return (await store(own)) ? { kind: "stored", withoutGrants: true } : { kind: "not_signed" };
  }
}
