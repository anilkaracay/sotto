// The demo company's shared words and names (step 4.6, D-32), for the server and the browser alike.

/** Every request of the demo carries it; the route wrapper then serves only the demo's own routes. */
export const DEMO_HEADER = "x-sotto-demo";
/** The words on every demo screen (founder, 2026-10-09). */
export const DEMO_BANNER = "Demo company on devnet · read only";
export const DEMO_EXIT = "Create your own company";
export const DEMO_ENTRY = "Explore Northwind as";
/** The two ways in, side by side on the landing and the sign in screen (step 4.6, D-33). */
export const ENTRY_DEMO = { label: "Explore the demo company", detail: "No wallet needed" };
export const ENTRY_QUICK_START = { label: "Quick start", detail: "Connect a wallet" };

export const DEMO_KEY_ROLES = ["owner", "accountant", "employee"] as const;
export type DemoKeyRole = (typeof DEMO_KEY_ROLES)[number];
export const DEMO_ROLES = [...DEMO_KEY_ROLES, "outsider"] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

/** The four roles as the picker, the banner and the landing name them. */
export const DEMO_ROLE_WORDS: Record<DemoRole, { label: string; person: string; sees: string }> = {
  owner: {
    label: "Owner",
    person: "Elif",
    sees: "The balance, every payment and payroll line, who holds a viewing key, and the proofs.",
  },
  accountant: {
    label: "Accountant",
    person: "Daniel",
    sees: "The books of the period Elif granted him: each payment with its amount and memo.",
  },
  employee: {
    label: "Employee",
    person: "Maya",
    sees: "Her own pay: net, gross and tax of her payslips. Nothing of anyone else.",
  },
  outsider: {
    label: "Outsider",
    person: "",
    sees: "What the chain shows anyone: who paid whom and when, never how much, and the public proof.",
  },
};

export const demoRoleTitle = (role: DemoRole): string =>
  DEMO_ROLE_WORDS[role].person
    ? `${DEMO_ROLE_WORDS[role].label} (${DEMO_ROLE_WORDS[role].person})`
    : DEMO_ROLE_WORDS[role].label;

export function isDemoRole(value: string): value is DemoRole {
  return (DEMO_ROLES as readonly string[]).includes(value);
}

/**
 * The demo recipient a quick start company on devnet starts with (step 4.8, D-34): Atlas Freight's
 * demo wallet, whose wdevUSD account is set up for confidential payments, so a first payment needs
 * no second wallet. Its name says what it is; the owner renames or removes it like any recipient.
 */
export const DEMO_RECIPIENT = {
  displayName: "Atlas Freight (demo recipient)",
  roleTitle: "Demo wallet for test payments",
  wallet: "E6FbeoKRFNcCuSGkbn6QJgGzwoNYfDeHELJLS5BLLkDB",
} as const;
