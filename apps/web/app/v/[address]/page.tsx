// /v/<proof_record_address> (F-13, AC-13.3; step 2.8): anyone can check a Sotto proof of funds without
// signing in. The page reads the record from chain, and the organization's legal name from its SAS
// attestation, found through the record's owner; it states when the record expired, was closed
// or does not exist, and when the proof program is paused. The database adds only the
// counterparty label; nothing on the page is proven by it.
import type { Metadata } from "next";
import { serverRpc } from "../../../lib/server/chain.ts";
import { serverCluster } from "../../../lib/server/cluster.ts";
import { getDb } from "../../../lib/server/db.ts";
import { labelLookup, readPublicProof } from "../../../lib/server/proofs.ts";
import { VerifyView } from "./verify-view.tsx";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Proof of funds · Sotto",
  robots: { index: false },
};

export default async function VerifyPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const cluster = await serverCluster();
  const view = await readPublicProof(serverRpc(), cluster, address, {
    label: labelLookup(getDb()),
  });
  return <VerifyView view={view} now={new Date()} cluster={cluster?.config.name ?? null} />;
}
