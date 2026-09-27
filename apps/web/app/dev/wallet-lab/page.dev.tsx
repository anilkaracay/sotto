// Gate G2 wallet lab (docs/12-MILESTONES.md). Development only: the .dev.tsx extension makes this file a
// page only under next dev (next.config.ts pageExtensions), so production builds do not contain it. The
// 404 outside development stays as a second guard.
import { notFound } from "next/navigation";
import { WalletLab } from "./wallet-lab";

export const dynamic = "force-dynamic";

export default function WalletLabPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }
  return <WalletLab />;
}
