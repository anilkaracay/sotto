// Payroll run fields and rules (F-08; step 2.3), shared by the payroll pages and their tests. No
// server only imports. Amounts never travel in plaintext: the CSV is read in the browser, and each
// line's amount, memo, gross and tax are sealed in the tab to the owner's viewing key (the line's
// private blob, 07 section 2), then disclosed to the owner and the recipient once the line settles.
import { formatTokenAmount, parseTokenAmount } from "@sotto/sdk/confidential/public";
import { isAddress } from "@solana/kit";
import { isCountryCode } from "./countries.ts";
import { memoProblem } from "./payment.ts";
import { payability, type Readiness } from "./recipient.ts";

export const DECIMALS = 6;
/** AC-08.1: the header of a payroll CSV; `gross,tax` may follow as extension columns (AC-12.1). */
export const CSV_COLUMNS = ["wallet", "amount", "memo", "name", "team", "country"] as const;
export const CSV_EXTENSION_COLUMNS = ["gross", "tax"] as const;
/** The server's limit on lines per run (08 section 3). */
export const MAX_RUN_LINES = 250;
export const TITLE_MAX = 100;
const TEAM_MAX = 80;
const CONTROL = /\p{Cc}/u;

/** What a payroll line's private blob holds, sealed to the owner's viewing key. */
export type PayrollLinePrivate = {
  v: 1;
  /** The net amount paid, base units as a decimal string. */
  amount: string;
  memo: string | null;
  gross: string | null;
  tax: string | null;
};

export type CsvRecipient = {
  id: string;
  displayName: string;
  wallet: string;
  team: string | null;
  country: string | null;
  readiness: Readiness;
};

export type CsvRow = {
  /** The row's number in the spreadsheet: the header is row 1. */
  row: number;
  wallet: string;
  amount: string;
  memo: string;
  name: string;
  team: string;
  country: string;
  gross: string;
  tax: string;
  recipient: CsvRecipient | null;
  /** The parsed amounts in base units, when valid. */
  base: bigint | null;
  grossBase: bigint | null;
  taxBase: bigint | null;
  errors: string[];
  /** Not an error: the recipient's account was not ready when Sotto last read it (AC-07.4). */
  warning: string | null;
};

export type ParsedCsv = { rows: CsvRow[]; fileErrors: string[]; extension: boolean };

/** RFC 4180 records: commas, double quoted fields with "" for a quote, CRLF or LF line ends. */
export function csvRecords(text: string): string[][] {
  const input = text.startsWith("﻿") ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  // Blank lines carry no row.
  return records.filter((values) => !(values.length === 1 && values[0]?.trim() === ""));
}

function amountOrZero(text: string): bigint | null {
  if (/^0+(\.0+)?$/.test(text.trim())) return 0n;
  return parseTokenAmount(text, DECIMALS);
}

const normalized = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");

/**
 * AC-08.1: every row validated, errors per row. Rows match existing recipients by wallet; an unknown
 * wallet is "Add this recipient first". A wallet may appear once per run.
 */
export function parsePayrollCsv(text: string, recipients: readonly CsvRecipient[]): ParsedCsv {
  const records = csvRecords(text);
  const header = records[0]?.map((value) => value.trim().toLowerCase()) ?? [];
  const base = [...CSV_COLUMNS] as string[];
  const withExtension = [...CSV_COLUMNS, ...CSV_EXTENSION_COLUMNS] as string[];
  const extension = header.join(",") === withExtension.join(",");
  if (records.length === 0) {
    return { rows: [], fileErrors: ["The file is empty."], extension: false };
  }
  if (!extension && header.join(",") !== base.join(",")) {
    return {
      rows: [],
      fileErrors: [
        `The first row must be the header ${base.join(",")}, optionally followed by ${CSV_EXTENSION_COLUMNS.join(",")}.`,
      ],
      extension: false,
    };
  }
  const data = records.slice(1);
  if (data.length === 0) {
    return { rows: [], fileErrors: ["The file has no payroll rows."], extension };
  }
  const fileErrors =
    data.length > MAX_RUN_LINES ? [`A run has at most ${MAX_RUN_LINES} rows.`] : [];
  const byWallet = new Map(recipients.map((recipient) => [recipient.wallet, recipient]));
  const seen = new Map<string, number>();
  const columns = extension ? withExtension.length : base.length;
  const rows = data.map((values, index): CsvRow => {
    const row = index + 2;
    const at = (position: number) => (values[position] ?? "").trim();
    const parsed: CsvRow = {
      row,
      wallet: at(0),
      amount: at(1),
      memo: at(2),
      name: at(3),
      team: at(4),
      country: at(5).toUpperCase(),
      gross: extension ? at(6) : "",
      tax: extension ? at(7) : "",
      recipient: null,
      base: null,
      grossBase: null,
      taxBase: null,
      errors: [],
      warning: null,
    };
    const errors = parsed.errors;
    if (values.length !== columns) {
      errors.push(`This row has ${values.length} values; the header has ${columns}.`);
    }
    if (!parsed.wallet || !isAddress(parsed.wallet)) {
      errors.push("Enter a Solana wallet address.");
    } else {
      const earlier = seen.get(parsed.wallet);
      if (earlier !== undefined) errors.push(`This wallet is already on row ${earlier}.`);
      else seen.set(parsed.wallet, row);
      parsed.recipient = byWallet.get(parsed.wallet) ?? null;
      if (!parsed.recipient) errors.push("Add this recipient first");
    }
    parsed.base = parseTokenAmount(parsed.amount, DECIMALS);
    if (parsed.base === null) {
      errors.push(`Enter an amount above zero with at most ${DECIMALS} decimals.`);
    }
    const memo = memoProblem(parsed.memo);
    if (memo) errors.push(`Memo: ${memo}.`);
    if (
      parsed.name &&
      parsed.recipient &&
      normalized(parsed.name) !== normalized(parsed.recipient.displayName)
    ) {
      errors.push(
        `The name does not match this wallet's recipient, ${parsed.recipient.displayName}.`,
      );
    }
    if (parsed.team.length > TEAM_MAX || CONTROL.test(parsed.team)) {
      errors.push(`Team: use at most ${TEAM_MAX} characters without control characters.`);
    }
    if (parsed.country && !isCountryCode(parsed.country)) {
      errors.push("Country: use a two letter country code.");
    }
    if (extension && (parsed.gross !== "" || parsed.tax !== "")) {
      parsed.grossBase = amountOrZero(parsed.gross);
      parsed.taxBase = amountOrZero(parsed.tax);
      if (parsed.gross === "" || parsed.tax === "") {
        errors.push("Give both gross and tax, or neither.");
      } else if (parsed.grossBase === null || parsed.taxBase === null) {
        errors.push(`Gross and tax are amounts with at most ${DECIMALS} decimals.`);
      } else if (parsed.base !== null && parsed.grossBase - parsed.taxBase !== parsed.base) {
        errors.push("Gross minus tax must equal the amount.");
      }
    }
    if (parsed.recipient && parsed.recipient.readiness !== "ready") {
      parsed.warning = payability(parsed.recipient.readiness).reason;
    }
    return parsed;
  });
  return { rows, fileErrors, extension };
}

/** The sealed contents of a valid row's line. */
export function linePrivateOf(row: CsvRow): PayrollLinePrivate {
  if (row.base === null) throw new Error("the row has no valid amount");
  return {
    v: 1,
    amount: row.base.toString(),
    memo: row.memo === "" ? null : row.memo,
    gross: row.grossBase === null ? null : row.grossBase.toString(),
    tax: row.taxBase === null ? null : row.taxBase.toString(),
  };
}

const UNITS = /^(0|[1-9][0-9]{0,19})$/;

export function parseLinePrivate(value: unknown): PayrollLinePrivate | null {
  if (typeof value !== "object" || value === null) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "amount,gross,memo,tax,v" || input.v !== 1) {
    return null;
  }
  if (typeof input.amount !== "string" || !/^[1-9][0-9]{0,19}$/.test(input.amount)) return null;
  if (input.memo !== null && (typeof input.memo !== "string" || memoProblem(input.memo))) {
    return null;
  }
  for (const field of ["gross", "tax"] as const) {
    const amount = input[field];
    if (amount !== null && (typeof amount !== "string" || !UNITS.test(amount))) return null;
  }
  return {
    v: 1,
    amount: input.amount,
    memo: input.memo as string | null,
    gross: input.gross as string | null,
    tax: input.tax as string | null,
  };
}

export const formatUsdc = (base: bigint) => `${formatTokenAmount(base, DECIMALS)} USDC`;

/**
 * X-18, AC-08.4: the settlement gauge has as many ticks as lines, clamped to 12 at least and 48 at
 * most; above 48 lines each tick stands for ceil(lines / 48) lines.
 */
export function gaugeTicks(lines: number): { ticks: number; perTick: number } {
  if (lines <= 0) return { ticks: 12, perTick: 1 };
  if (lines <= 48) return { ticks: Math.max(12, lines), perTick: 1 };
  const perTick = Math.ceil(lines / 48);
  return { ticks: Math.ceil(lines / perTick), perTick };
}

/**
 * The filled ticks: one per settled line from 12 to 48 lines, one per ceil(lines / 48) settled lines
 * above, and each line's share of the 12 ticks below 12 lines. Full only when every line settled.
 */
export function filledTicks(lines: number, settled: number): number {
  if (lines <= 0 || settled <= 0) return 0;
  const { ticks, perTick } = gaugeTicks(lines);
  if (settled >= lines) return ticks;
  if (lines < 12) return Math.floor((settled * ticks) / lines);
  return Math.floor(settled / perTick);
}

/** The words for a run's status (AC-08.2). */
export const RUN_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  awaiting_approval: "Waiting for approval",
  approved: "Approved",
  executing: "Settling",
  settled: "Settled",
  partially_settled: "Partially settled",
  failed: "Not paid",
};

const RUN_STATUS_TONE: Record<string, "green" | "amber" | "neutral" | "red"> = {
  draft: "neutral",
  awaiting_approval: "amber",
  approved: "neutral",
  executing: "amber",
  settled: "green",
  partially_settled: "amber",
  failed: "red",
};

export function runStatusChip(status: string): {
  label: string;
  tone: "green" | "amber" | "neutral" | "red";
} {
  return { label: RUN_STATUS_LABEL[status] ?? status, tone: RUN_STATUS_TONE[status] ?? "neutral" };
}

/** Why a line cannot be paid now, from its error code (AC-07.4 words, D-10), or null. */
export function blockedReason(errorCode: string | null): string | null {
  if (!errorCode) return null;
  if (errorCode === "screening_hit") {
    return "The recipient's wallet is on the screening list, so the payment is blocked";
  }
  if (errorCode.startsWith("recipient_not_ready:")) {
    const readiness = errorCode.slice("recipient_not_ready:".length);
    if (readiness === "no_account" || readiness === "not_configured") {
      return payability(readiness).reason;
    }
  }
  return null;
}

/** The status chip of a line of a run (AC-08.4: each line has its own status). */
export function lineStatusChip(
  status: string,
  errorCode: string | null,
): { label: string; tone: "green" | "amber" | "neutral" | "red" } {
  if (errorCode === "screening_hit") return { label: "Blocked by screening", tone: "red" };
  if (errorCode?.startsWith("recipient_not_ready:") && status !== "settled") {
    return { label: "Not ready", tone: "amber" };
  }
  switch (status) {
    case "settled":
      return { label: "Settled", tone: "green" };
    case "executing":
      return { label: "Settling", tone: "amber" };
    case "failed_clean":
      return { label: "Did not complete", tone: "amber" };
    case "failed":
      return { label: "Failed", tone: "red" };
    default:
      return { label: "Not paid yet", tone: "neutral" };
  }
}
