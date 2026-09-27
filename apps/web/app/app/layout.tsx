import type { ReactNode } from "react";

// Every /app screen uses the app theme (X-42).
export default function AppLayout({ children }: { children: ReactNode }) {
  return <div className="theme-app">{children}</div>;
}
