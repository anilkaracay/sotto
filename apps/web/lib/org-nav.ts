// The top nav of an org's pages (09 section 2): only screens that exist (rule 6). Step 1.7 adds the
// overview with the balance cards next to the setup page, step 1.8 the recipients, step 1.9 the
// single payment page, step 1.10 the recipient's pay page, step 2.3 payroll (after Overview, as in
// the design's nav), step 2.4 the viewing keys (after Payroll, as in the design), step 2.8 proofs of
// funds (after the viewing keys, as in the design).
import type { TopNavItem } from "@sotto/ui";

export function ownerNav(
  orgId: string,
  active: "overview" | "payroll" | "keys" | "proofs" | "recipients" | "payments" | "setup",
): TopNavItem[] {
  return [
    {
      key: "overview",
      label: "Overview",
      href: `/app/${orgId}/overview`,
      active: active === "overview",
    },
    {
      key: "payroll",
      label: "Payroll",
      href: `/app/${orgId}/payroll`,
      active: active === "payroll",
    },
    {
      key: "keys",
      label: "Viewing keys",
      href: `/app/${orgId}/keys`,
      active: active === "keys",
    },
    {
      key: "proofs",
      label: "Proofs",
      href: `/app/${orgId}/proofs`,
      active: active === "proofs",
    },
    {
      key: "recipients",
      label: "Recipients",
      href: `/app/${orgId}/recipients`,
      active: active === "recipients",
    },
    {
      key: "payments",
      label: "Payments",
      href: `/app/${orgId}/payments/new`,
      active: active === "payments",
    },
    {
      key: "setup",
      label: "Account setup",
      href: `/app/${orgId}/setup`,
      active: active === "setup",
    },
  ];
}

/** An accountant's nav (step 2.5): Books; Close and export is Post-hackathon (D-27, 13 A30). */
export function accountantNav(orgId: string): TopNavItem[] {
  return [{ key: "books", label: "Books", href: `/app/${orgId}/books`, active: true }];
}

/** A recipient's nav: the minimal pay page of step 1.10 (My pay comes in Phase 2). */
export function recipientNav(orgId: string): TopNavItem[] {
  return [{ key: "pay", label: "My pay", href: `/app/${orgId}/pay`, active: true }];
}
