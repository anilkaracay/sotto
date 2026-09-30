import type { ReactNode } from "react";
import { KeySessionProvider } from "./_components/key-session.tsx";
import { PrivacyProvider } from "./_components/privacy.tsx";

// Every /app screen uses the app theme (X-42). The key session lives here, once per tab, so unlocked
// keys survive client side navigation between app pages (04 section 5, 10 section 3). The privacy
// screen (F-15) covers every /app screen.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="theme-app">
      <PrivacyProvider>
        <KeySessionProvider>{children}</KeySessionProvider>
      </PrivacyProvider>
    </div>
  );
}
