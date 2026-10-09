import type { Metadata } from "next";
import type { ReactNode } from "react";

// The demo company (step 4.6, D-32) uses the app theme and nothing else of the app: no session, no
// key session and no wallet. Its screens read only.
export const metadata: Metadata = {
  title: "Demo company · Sotto",
  robots: { index: false },
};

export default function DemoLayout({ children }: { children: ReactNode }) {
  return <div className="theme-app">{children}</div>;
}
