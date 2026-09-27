import type { ReactNode } from "react";
import { KeySessionProvider } from "./_components/key-session.tsx";

// Every /app screen uses the app theme (X-42). The key session lives here, once per tab, so unlocked
// keys survive client side navigation between app pages (04 section 5, 10 section 3).
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="theme-app">
      <KeySessionProvider>{children}</KeySessionProvider>
    </div>
  );
}
