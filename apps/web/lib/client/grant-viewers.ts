// The holders a new record is disclosed to (07 sections 6 and 7, AC-06.4; step 2.4): after a payment or
// a payroll chunk settles, the owner's browser seals the record to the owner, the recipient and every
// active grant whose scope covers it. A holder's viewing key is used only after its registration
// signature verifies for the holder's wallet (I-8). A recipient's own payslips are not a holder here:
// the recipient's own item carries them.
import { scopeCovers, type DisclosureKind, type GrantScope } from "@sotto/sdk/disclosure";
import { verifyViewKeyRegistration } from "@sotto/sdk/keys/public";
import type { GrantView } from "../server/grants.ts";
import { callApi } from "./api.ts";

export type GrantViewer = {
  grantId: string;
  scope: GrantScope;
  periodFrom: string | null;
  periodTo: string | null;
  viewer: { userId: string; wallet: string; publicKey: string; signature: string };
};

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** The org's active grants whose holder has a viewing key that verifies (I-8). */
export async function activeGrantViewers(orgId: string): Promise<GrantViewer[]> {
  const { grants } = await callApi<{ grants: GrantView[] }>(`/api/orgs/${orgId}/grants`);
  const viewers: GrantViewer[] = [];
  for (const grant of grants) {
    const key = grant.viewer?.viewerKey;
    if (grant.status !== "active" || grant.scope === "own_payslips" || !grant.viewer || !key) {
      continue;
    }
    const verified = await verifyViewKeyRegistration({
      wallet: grant.viewer.wallet,
      publicKey: fromBase64(key.publicKey),
      signature: fromBase64(key.signature),
    });
    if (!verified) continue;
    viewers.push({
      grantId: grant.id,
      scope: grant.scope,
      periodFrom: grant.periodFrom,
      periodTo: grant.periodTo,
      viewer: {
        userId: grant.viewer.userId,
        wallet: grant.viewer.wallet,
        publicKey: key.publicKey,
        signature: key.signature,
      },
    });
  }
  return viewers;
}

/** The grants that cover a record of this kind settling now (07 section 6). */
export function coveringGrants(
  viewers: readonly GrantViewer[],
  kind: DisclosureKind,
  settledAt = new Date(),
): GrantViewer[] {
  return viewers.filter((grant) => scopeCovers(grant, { kind, settledAt }));
}
