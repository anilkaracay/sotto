// The payslip PDF (F-12, AC-12.3; step 2.6), made in the recipient's tab from their own opened record,
// never on the server; a record outside category payroll gives a payment receipt instead, with the
// amount received and no gross or tax: one A4 page of text in the standard Helvetica font (PDF 1.4, no embedded font,
// no dependency). Text outside Latin-1, which Helvetica's WinAnsi encoding cannot show, is written
// without its accents where Unicode decomposes it and as "?" otherwise. Step 4.3: amounts in the
// organization's asset (USDC or devUSD), and a devnet test asset says it has no value.
import {
  DEVNET_TEST_ASSET_BADGE,
  DEVNET_TEST_ASSET_TOOLTIP,
  formatAmount,
  type AssetWords,
} from "./asset-words.ts";
import { formatDate } from "./format.ts";
import { BOOKS_CATEGORY_LABEL } from "./books.ts";
import { isPayslip, payslipTitle, type Payslip } from "./pay.ts";

export type PayslipDocument = {
  orgName: string;
  recipientName: string;
  roleTitle: string | null;
  wallet: string;
  slip: Payslip;
  /** The paying organization's asset. */
  asset: AssetWords;
};

/** Letters outside Latin-1 that Unicode does not decompose, and typographic quotes and dashes. */
const PLAIN: Record<string, string> = {
  ı: "i",
  Ł: "L",
  ł: "l",
  Đ: "D",
  đ: "d",
  Œ: "OE",
  œ: "oe",
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u2013": "-",
  "\u2014": "-",
};

/**
 * Latin-1 only: a letter outside it loses its accents where Unicode decomposes it (ğ, ş) or takes its
 * plain form (ı, ł), and anything else outside it is "?".
 */
export function latin1(text: string): string {
  return [...text]
    .map((char) => {
      if (char.codePointAt(0) !== undefined && (char.codePointAt(0) as number) < 256) return char;
      if (PLAIN[char] !== undefined) return PLAIN[char];
      const plain = [...char.normalize("NFD")].filter((part) => !/\p{M}/u.test(part)).join("");
      return plain.length > 0 && [...plain].every((part) => part.charCodeAt(0) < 256) ? plain : "?";
    })
    .join("");
}

/** A PDF string literal: backslash, parentheses and line breaks escaped. */
function literal(text: string): string {
  return `(${latin1(text)
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replace(/[\r\n]+/g, " ")})`;
}

/** The lines of the payslip or the payment receipt: the size of their font and their text. */
export function payslipLines(document: PayslipDocument): { size: number; text: string }[] {
  const { slip, asset } = document;
  const amount = (base: bigint) => formatAmount(base, asset);
  const payslip = isPayslip(slip);
  const lines: { size: number; text: string }[] = [
    { size: 20, text: `${payslip ? "Payslip" : "Payment receipt"}: ${payslipTitle(slip)}` },
    { size: 12, text: payslip ? document.orgName : `Payment from ${document.orgName}` },
    { size: 12, text: "" },
    {
      size: 11,
      text: `Paid to: ${document.recipientName}${document.roleTitle ? `, ${document.roleTitle}` : ""}`,
    },
    { size: 11, text: `Wallet: ${document.wallet}` },
    { size: 11, text: `Paid on: ${formatDate(slip.date)}` },
  ];
  if (payslip) {
    if (slip.memo) lines.push({ size: 11, text: `Memo: ${slip.memo}` });
    lines.push({ size: 11, text: "" });
    if (slip.gross !== null && slip.tax !== null) {
      lines.push({ size: 11, text: `Gross pay: ${amount(slip.gross)}` });
      lines.push({ size: 11, text: `Tax withheld: ${amount(slip.tax)}` });
    }
    lines.push({ size: 14, text: `Net pay: ${amount(slip.net)}` });
  } else {
    // The memo is the receipt's title already.
    lines.push({ size: 11, text: `Category: ${BOOKS_CATEGORY_LABEL[slip.category]}` });
    lines.push({ size: 11, text: "" });
    lines.push({ size: 14, text: `Amount received: ${amount(slip.net)}` });
  }
  lines.push({ size: 11, text: "" });
  // The signature on its own line: with its label it ran past the page's right edge.
  if (slip.signature) {
    lines.push({ size: 9, text: "Solana transaction:" });
    lines.push({ size: 9, text: slip.signature });
  }
  lines.push({
    size: 9,
    text: `Paid in confidential ${asset.wrappedSymbol} on Solana: the amount is encrypted onchain.`,
  });
  if (asset.devnetTestAsset) {
    lines.push({
      size: 9,
      text: `${asset.symbol}: ${DEVNET_TEST_ASSET_BADGE.toLowerCase()}. ${DEVNET_TEST_ASSET_TOOLTIP}`,
    });
  }
  lines.push({
    size: 9,
    text: "Made in your browser from your own sealed payment record. Sotto never saw these amounts.",
  });
  return lines;
}

const bytes = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(text, (char) => char.charCodeAt(0));

/** AC-12.3: the payslip or the payment receipt as the bytes of a one page PDF. */
export function payslipPdf(document: PayslipDocument): Uint8Array<ArrayBuffer> {
  let y = 790;
  const content = ["BT"];
  for (const line of payslipLines(document)) {
    y -= line.size + 8;
    if (line.text) content.push(`/F1 ${line.size} Tf 1 0 0 1 56 ${y} Tm ${literal(line.text)} Tj`);
  }
  content.push("ET");
  const stream = content.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let file = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(file.length);
    file += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${String(offset).padStart(10, "0")} 00000 n \n`;
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return bytes(file);
}
