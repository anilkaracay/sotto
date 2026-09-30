import type { ReactNode } from "react";

// The public proof verification page (F-13, AC-13.3; step 2.8) uses the app theme (X-42) and needs no
// sign in: no session and no key session here.
export default function VerifyLayout({ children }: { children: ReactNode }) {
  return <div className="theme-app">{children}</div>;
}
