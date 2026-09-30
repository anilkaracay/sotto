// Payroll CSV and gauge rules (F-08; step 2.3): the header of AC-08.1 with the optional gross and tax
// columns (AC-12.1), every row validated with its errors, rows matched to existing recipients by
// wallet ("Add this recipient first"), and the settlement gauge's ticks (X-18, AC-08.4).
import { describe, expect, it } from "vitest";
import {
  blockedReason,
  csvRecords,
  readCsvRecords,
  filledTicks,
  gaugeTicks,
  lineStatusChip,
  linePrivateOf,
  parseLinePrivate,
  parsePayrollCsv,
  type CsvRecipient,
} from "../lib/payroll.ts";

const MAYA = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const IDRIS = "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L";
const LUCIA = "6xosZg2PbZuneXX4riov7GmUCJmydQc3o5MGX6p5EU2";
const UNKNOWN = "3is1rfSs3j8ethSn2WVnZAPufEuUFMEe3ay8hgRoQWqK";

const recipients: CsvRecipient[] = [
  {
    id: "r1",
    displayName: "Maya Chen",
    wallet: MAYA,
    team: "Design",
    country: "US",
    readiness: "ready",
  },
  {
    id: "r2",
    displayName: "Idris Kaya",
    wallet: IDRIS,
    team: "Engineering",
    country: "TR",
    readiness: "ready",
  },
  {
    id: "r3",
    displayName: "Lucia Moreno",
    wallet: LUCIA,
    team: null,
    country: null,
    readiness: "not_configured",
  },
];

const HEADER = "wallet,amount,memo,name,team,country";

describe("payroll CSV (AC-08.1)", () => {
  it("AC-08.1 reads quoted fields, CRLF and a byte order mark as RFC 4180 records", () => {
    expect(csvRecords('﻿a,"b,c","say ""hi"""\r\nd,,e\n\n')).toEqual([
      ["a", "b,c", 'say "hi"'],
      ["d", "", "e"],
    ]);
  });

  it("AC-08.1 keeps commas, doubled quotes and line breaks inside a quoted value (RFC 4180)", () => {
    expect(csvRecords('a,"Salary, October","He said ""paid""","two\nlines","x\r\ny"\n')).toEqual([
      ["a", "Salary, October", 'He said "paid"', "two\nlines", "x\r\ny"],
    ]);
    // An empty quoted value and a quoted value at the end of the file without a line end.
    expect(csvRecords('"",b\n"c"')).toEqual([["", "b"], ["c"]]);
  });

  it("AC-08.1 accepts UTF-8 with or without a byte order mark, and CRLF or LF line ends", () => {
    const rows = ["wallet,amount", "Çağrı Öztürk,1", "Zoë,2"];
    const expected = [
      ["wallet", "amount"],
      ["Çağrı Öztürk", "1"],
      ["Zoë", "2"],
    ];
    for (const text of [
      rows.join("\n"),
      rows.join("\r\n"),
      `\uFEFF${rows.join("\r\n")}\r\n`,
      `\uFEFF${rows.join("\n")}\n`,
      `${rows[0]}\r\n${rows[1]}\n${rows[2]}`,
    ]) {
      expect(csvRecords(text)).toEqual(expected);
    }
    // A byte order mark is skipped only at the start of the file.
    expect(csvRecords("a\n\uFEFFb")).toEqual([["a"], ["\uFEFFb"]]);
  });

  it("AC-08.1 marks a record that breaks the quoting rules instead of splitting it silently", () => {
    expect(readCsvRecords('a,b"c,d\ne,"f"g,h\ni,"never closed\nj,k')).toEqual([
      { values: ["a", 'b"c', "d"], problem: { column: 1, kind: "stray" } },
      { values: ["e", "fg", "h"], problem: { column: 1, kind: "trailing" } },
      { values: ["i", "never closed\nj,k"], problem: { column: 1, kind: "unclosed" } },
    ]);
  });

  it("AC-08.1 reports a malformed row as a row error with a clear message", () => {
    const csv = [
      HEADER,
      `${MAYA},9400.50,"Salary, October",Maya Chen,Design,US`,
      `${IDRIS},100,Salary, October,,,`,
      `${LUCIA},300,Bonus "Q3",,,`,
      `${UNKNOWN},5,"Bonus"Q3,,,`,
      `${UNKNOWN},6,"Bonus,,,`,
    ].join("\r\n");
    const { rows, fileErrors } = parsePayrollCsv(csv, recipients);
    expect(fileErrors).toEqual([]);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ memo: "Salary, October", errors: [] });
    // The unquoted comma shifts the values, so later columns fail too; the first error says why.
    expect(rows[1]?.errors[0]).toBe(
      "This row has 7 values; the header has 6. Put a value that contains a comma in double quotes.",
    );
    expect(rows[2]?.errors).toEqual([
      'The memo value has a double quote inside it but does not start with one. Put the whole value in double quotes and write each quote in it as two ("").',
    ]);
    expect(rows[3]?.errors[0]).toBe(
      'The memo value has text after its closing double quote. Put the whole value in double quotes and write each quote in it as two ("").',
    );
    expect(rows[4]?.errors[0]).toBe(
      "The memo value opens a double quote that is never closed, so the rest of the file was read into it. Close the quote.",
    );
    // A quoted memo with a line break is read whole; the memo rule refuses the control character.
    const broken = parsePayrollCsv(`${HEADER}\n${MAYA},1,"Salary\nOctober",,,`, recipients);
    expect(broken.rows).toHaveLength(1);
    expect(broken.rows[0]?.errors).toEqual(["Memo: Remove the control characters."]);
  });

  it("AC-08.1 refuses a file that is not UTF-8 and a header that breaks the quoting rules", () => {
    // The browser decodes a Windows-1252 file as UTF-8 and turns its accented bytes into U+FFFD.
    expect(parsePayrollCsv(`${HEADER}\n${MAYA},1,Caf\uFFFD,,,`, recipients).fileErrors).toEqual([
      'The file is not UTF-8 text. Save it as "CSV UTF-8" in your spreadsheet and upload it again.',
    ]);
    expect(parsePayrollCsv(`wallet,"amount\n${MAYA},1`, recipients).fileErrors).toEqual([
      "Value 2 opens a double quote that is never closed, so the rest of the file was read into it. Close the quote.",
    ]);
  });

  it("AC-08.1 matches rows to recipients by wallet and validates every row with its own errors", () => {
    const csv = [
      HEADER,
      `${MAYA},9400.50,"Salary, October",Maya Chen,Design,US`,
      `${UNKNOWN},100,,,,`,
      `${IDRIS},12.1234567,,Idris Kaya,,TR`,
      `${IDRIS},0,,,,`,
      `not-a-wallet,5,,,,`,
      `${LUCIA},300,,Someone Else,,XX`,
      `${MAYA},1,,,`,
    ].join("\n");
    const { rows, fileErrors } = parsePayrollCsv(csv, recipients);
    expect(fileErrors).toEqual([]);
    expect(rows.map((row) => row.row)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(rows[0]).toMatchObject({
      recipient: { id: "r1" },
      base: 9_400_500_000n,
      memo: "Salary, October",
      errors: [],
      warning: null,
    });
    expect(rows[1]?.errors).toEqual(["Add this recipient first"]);
    expect(rows[2]?.errors).toEqual(["Enter an amount above zero with at most 6 decimals."]);
    expect(rows[3]?.errors).toEqual([
      "This wallet is already on row 4.",
      "Enter an amount above zero with at most 6 decimals.",
    ]);
    expect(rows[4]?.errors).toEqual(["Enter a Solana wallet address."]);
    expect(rows[5]?.errors).toEqual([
      "The name does not match this wallet's recipient, Lucia Moreno.",
      "Country: use a two letter country code.",
    ]);
    // Not an error: the account was not ready at the last read; authorization reads the chain.
    expect(rows[5]?.warning).toContain("not set up for confidential payments");
    expect(rows[6]?.errors).toEqual([
      "This row has 5 values; the header has 6.",
      "This wallet is already on row 2.",
    ]);
  });

  it("AC-08.1 takes the gross and tax extension columns and keeps net, gross and tax consistent (AC-12.1)", () => {
    const csv = [
      `${HEADER},gross,tax`,
      `${MAYA},800,,,,,1000,200`,
      `${IDRIS},800,,,,,1000,`,
      `${LUCIA},800,,,,,1000,100`,
    ].join("\n");
    const { rows, extension } = parsePayrollCsv(csv, recipients);
    expect(extension).toBe(true);
    expect(rows[0]?.errors).toEqual([]);
    expect(linePrivateOf(rows[0] as never)).toEqual({
      v: 1,
      amount: "800000000",
      memo: null,
      gross: "1000000000",
      tax: "200000000",
    });
    expect(rows[1]?.errors).toEqual(["Give both gross and tax, or neither."]);
    expect(rows[2]?.errors).toEqual(["Gross minus tax must equal the amount."]);
  });

  it("AC-08.1 refuses a file without the header or rows", () => {
    expect(parsePayrollCsv("", recipients).fileErrors).toEqual(["The file is empty."]);
    expect(parsePayrollCsv("wallet,amount\nx,1", recipients).fileErrors[0]).toContain(
      "The first row must be the header wallet,amount,memo,name,team,country",
    );
    expect(parsePayrollCsv(HEADER, recipients).fileErrors).toEqual([
      "The file has no payroll rows.",
    ]);
  });

  it("AC-08.1 opens only a line blob with exactly the line fields", () => {
    expect(parseLinePrivate({ v: 1, amount: "5", memo: null, gross: null, tax: null })).toEqual({
      v: 1,
      amount: "5",
      memo: null,
      gross: null,
      tax: null,
    });
    expect(parseLinePrivate({ v: 1, amount: "5", memo: null, gross: null })).toBeNull();
    expect(parseLinePrivate({ v: 1, amount: "0", memo: null, gross: null, tax: null })).toBeNull();
  });
});

describe("settlement gauge (X-18)", () => {
  it("AC-08.4 has as many ticks as lines, at least 12 and at most 48, each standing for ceil(lines / 48) lines above 48", () => {
    expect(gaugeTicks(3)).toEqual({ ticks: 12, perTick: 1 });
    expect(gaugeTicks(12)).toEqual({ ticks: 12, perTick: 1 });
    expect(gaugeTicks(24)).toEqual({ ticks: 24, perTick: 1 });
    expect(gaugeTicks(48)).toEqual({ ticks: 48, perTick: 1 });
    expect(gaugeTicks(96)).toEqual({ ticks: 48, perTick: 2 });
    expect(gaugeTicks(100)).toEqual({ ticks: 34, perTick: 3 });
  });

  it("AC-08.4 fills one tick per settled line, and is full only when every line settled", () => {
    expect(filledTicks(24, 0)).toBe(0);
    expect(filledTicks(24, 11)).toBe(11);
    expect(filledTicks(24, 24)).toBe(24);
    expect(filledTicks(96, 95)).toBe(47);
    expect(filledTicks(96, 96)).toBe(48);
    // Under 12 lines each line fills its share of the 12 ticks.
    expect(filledTicks(3, 1)).toBe(4);
    expect(filledTicks(3, 3)).toBe(12);
  });

  it("AC-08.4 names each line's status and why a blocked line cannot be paid", () => {
    expect(lineStatusChip("settled", null)).toEqual({ label: "Settled", tone: "green" });
    expect(lineStatusChip("draft", "screening_hit")).toEqual({
      label: "Blocked by screening",
      tone: "red",
    });
    expect(lineStatusChip("draft", "recipient_not_ready:no_account").label).toBe("Not ready");
    expect(blockedReason("recipient_not_ready:no_account")).toContain(
      "there is no wUSDC account at this wallet",
    );
    expect(blockedReason("screening_hit")).toBe(
      "The recipient's wallet is on the screening list, so the payment is blocked",
    );
    expect(blockedReason(null)).toBeNull();
  });
});
