// The demo organization of step 4.3 (founder, 2026-10-02; 12 "Seed design"): Northwind Labs Demo Ltd,
// a fictional United Kingdom company that holds devUSD, the devnet test dollar. Every name is fictional:
// the design's people (design/sotto-app.html), Sofia, Jonas and Amara added to reach the team as in
// step 4.3's first seed design, Selin Demir (the design's COO) as the twelfth line, and two fictional
// counterparties. Amounts are devUSD in whole units with two decimals at most; the payroll lines are
// between 4,000 and 12,000 each.

export const NORTHWIND = {
  legalName: "Northwind Labs Demo Ltd",
  displayName: "Northwind Labs",
  country: "GB",
  registrationNo: "NW 0001",
  website: "northwind.example",
  contactEmail: "finance@northwind.example",
} as const;

/** The treasury Elif funds, in whole devUSD. */
export const TREASURY = 1_500_000n;

export type Member = {
  /** The keypair's file or seed name. */
  key: string;
  name: string;
  role: string;
  team: string;
  country: string;
};

export type PayrollLine = Member & {
  /** The amount paid, and for employees the gross and the tax, in devUSD as typed. */
  net: string;
  gross: string | null;
  tax: string | null;
  memo: string;
};

export const ELIF: Member = {
  key: "elif",
  name: "Elif Aydın",
  role: "Owner",
  team: "Founders",
  country: "GB",
};

export const DANIEL: Member = {
  key: "daniel",
  name: "Daniel Osei",
  role: "Accountant, external",
  team: "Finance",
  country: "GH",
};

const line = (
  key: string,
  name: string,
  role: string,
  team: string,
  country: string,
  net: string,
  employee: { gross: string; tax: string } | null,
): PayrollLine => ({
  key,
  name,
  role,
  team,
  country,
  net,
  gross: employee?.gross ?? null,
  tax: employee?.tax ?? null,
  memo: `October salary, ${name.split(" ")[0]}`,
});

/** The twelve lines of October's payroll; Maya's has gross and tax for her payslip. */
export const PAYROLL: PayrollLine[] = [
  line("maya", "Maya Chen", "Design lead", "Design", "GB", "9400.00", {
    gross: "12400.00",
    tax: "3000.00",
  }),
  line("idris", "Idris Kaya", "Staff engineer", "Engineering", "TR", "11150.00", null),
  line("lucia", "Lucía Ortega", "Head of growth", "Growth", "AR", "10300.00", null),
  line("aiko", "Aiko Tanaka", "Research", "Research", "JP", "8900.00", null),
  line("tomas", "Tomás Reyes", "Contractor", "Engineering", "BR", "6800.00", null),
  line("kwame", "Kwame Mensah", "Backend engineer", "Engineering", "NG", "7600.00", null),
  line("priya", "Priya Nair", "Product designer", "Design", "IN", "7200.00", null),
  line("noah", "Noah Bennett", "Sales lead", "Sales", "CA", "9950.00", null),
  line("sofia", "Sofia Rossi", "Operations", "Operations", "IT", "5400.00", null),
  line("jonas", "Jonas Berg", "Frontend engineer", "Engineering", "SE", "8150.00", null),
  line("amara", "Amara Okafor", "Customer success", "Support", "KE", "4600.00", null),
  line("selin", "Selin Demir", "COO", "Operations", "TR", "11800.00", null),
];

export const ATLAS: Member = {
  key: "atlas",
  name: "Atlas Freight",
  role: "Supplier",
  team: "Logistics",
  country: "NL",
};

export const HALDEN: Member = {
  key: "halden",
  name: "Halden OTC",
  role: "Counterparty",
  team: "Treasury",
  country: "CH",
};

export type Payment = {
  to: Member;
  amount: string;
  category: "supplier" | "software" | "payouts" | "other";
  memo: string;
};

/** The single payments, in order: Atlas Freight's two invoices, then Halden OTC. */
export const PAYMENTS: Payment[] = [
  { to: ATLAS, amount: "48200.00", category: "supplier", memo: "Invoice AF-2207, October freight" },
  { to: ATLAS, amount: "12750.00", category: "supplier", memo: "Invoice AF-2214, customs" },
  { to: HALDEN, amount: "500000.00", category: "other", memo: "Treasury conversion, October" },
];

/** The proof of funds for Atlas Freight, in whole devUSD. */
export const PROOF = { threshold: "250000", label: "Atlas Freight" } as const;

/** Everyone the organization pays: the twelve, then the two counterparties. */
export const RECIPIENTS: Member[] = [...PAYROLL, ATLAS, HALDEN];
