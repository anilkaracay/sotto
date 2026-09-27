// The top nav of an owner's org pages (09 section 2): only screens that exist (rule 6). Step 1.7 adds
// the overview with the balance cards next to the setup page, step 1.8 the recipients.
import type { TopNavItem } from "@sotto/ui";

export function ownerNav(orgId: string, active: "overview" | "recipients" | "setup"): TopNavItem[] {
  return [
    {
      key: "overview",
      label: "Overview",
      href: `/app/${orgId}/overview`,
      active: active === "overview",
    },
    {
      key: "recipients",
      label: "Recipients",
      href: `/app/${orgId}/recipients`,
      active: active === "recipients",
    },
    {
      key: "setup",
      label: "Account setup",
      href: `/app/${orgId}/setup`,
      active: active === "setup",
    },
  ];
}
