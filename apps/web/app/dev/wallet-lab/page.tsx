// Gate G2 wallet lab (docs/12-MILESTONES.md). Development only: every other environment gets a 404.
import { notFound } from "next/navigation";
import { WalletLab } from "./wallet-lab";

export const dynamic = "force-dynamic";

export default function WalletLabPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }
  return <WalletLab />;
}
