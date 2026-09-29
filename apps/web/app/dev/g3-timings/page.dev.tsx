// Gate G3 browser timings (step 2.2, docs/12-MILESTONES.md). Development only: the .dev.tsx extension
// makes this a page only under next dev (next.config.ts pageExtensions), and the 404 outside
// development stays as a second guard.
import { notFound } from "next/navigation";
import { G3Timings } from "./g3-timings";

export const dynamic = "force-dynamic";

export default function G3TimingsPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <G3Timings />;
}
