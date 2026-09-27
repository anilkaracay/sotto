// /app/sign-in (F-01): the sign in screen; a signed in visitor goes straight to /app.
import { redirect } from "next/navigation";
import { currentSession } from "../../../lib/server/current-session.ts";
import { networkLabel } from "../../../lib/network.ts";
import { SignInScreen } from "../_components/sign-in-screen.tsx";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if (await currentSession()) redirect("/app");
  return <SignInScreen network={networkLabel(process.env.NEXT_PUBLIC_CLUSTER)} />;
}
