// /app/sign-in (F-01): the sign in screen; a signed in visitor goes straight to /app, or to the app
// page named by `?next=` (for example an invite link; step 1.8).
import { redirect } from "next/navigation";
import { currentSession } from "../../../lib/server/current-session.ts";
import { currentNetworkLabel } from "../../../lib/network.ts";
import { safeNextPath } from "../../../lib/next-path.ts";
import { SignInScreen } from "../_components/sign-in-screen.tsx";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  if (await currentSession()) redirect(safeNextPath(typeof next === "string" ? next : null));
  return <SignInScreen network={currentNetworkLabel()} />;
}
