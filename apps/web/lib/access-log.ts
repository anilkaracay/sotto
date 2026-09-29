// The access log in words (F-14, AC-14.1; step 2.4), for the viewing keys page and its tests. No server
// only imports. Each event is metadata only: who, what, which subject by its label, counts and dates,
// never an amount (the design's rows about exports, auditors and the board are not events of this
// build, 13 A28).
import type { AccessEventView } from "./server/access-log.ts";
import { formatDate, shortWallet } from "./format.ts";
import { monthLabel } from "./books.ts";
import { expiryWords, scopeWords, type GrantScopeName } from "./grant.ts";

const count = (value: unknown, one: string, many: string) => {
  const n = typeof value === "number" ? value : 0;
  return `${n} ${n === 1 ? one : many}`;
};

/** The event's title and its detail line; "You" for the owner reading the log, "Sotto" for the worker. */
export function eventWords(
  event: AccessEventView,
  you: string,
): { title: string; detail: string | null } {
  const actor =
    event.actor === null
      ? "Sotto"
      : event.actor.userId === you
        ? "You"
        : (event.actor.displayName ?? shortWallet(event.actor.wallet));
  const subject = event.subject.label ?? "a holder";
  const meta = event.metadata;
  switch (event.action) {
    case "grant_created": {
      const scope = scopeWords(
        (meta.scope as GrantScopeName) ?? "all_payments",
        (meta.periodFrom as string | null) ?? null,
        (meta.periodTo as string | null) ?? null,
      );
      return {
        title: `${actor} invited ${subject} to read ${scope.charAt(0).toLowerCase()}${scope.slice(1)}`,
        detail: expiryWords((meta.expiresAt as string | null) ?? null),
      };
    }
    case "grant_invite_renewed":
      return { title: `${actor} sent ${subject} a new invite link`, detail: null };
    case "grant_accepted":
      return { title: `${subject} accepted the invite`, detail: "Waiting for their viewing key" };
    case "grant_activated":
      return { title: `${subject}'s viewing key is active`, detail: null };
    case "grant_backfilled":
      return {
        title: `${actor} shared past records with ${subject}`,
        detail: count(meta.items, "record", "records"),
      };
    case "grant_revoked":
      return {
        title: `${actor} revoked ${subject}'s key`,
        detail: `${count(meta.deleted, "record", "records")} deleted`,
      };
    case "grant_expired":
      return {
        title: `${subject}'s key expired`,
        detail: `${count(meta.deleted, "record", "records")} deleted`,
      };
    case "disclosure_batch_created":
      return {
        title: `${actor} saved encrypted records`,
        detail: `${count(meta.items, "record", "records")} for ${count(meta.viewers, "reader", "readers")}`,
      };
    case "payment_executed":
      return {
        title: `${actor} sent a payment to ${event.subject.label ?? "a recipient"}`,
        detail: null,
      };
    case "payment_settled":
      return {
        title: `A payment to ${event.subject.label ?? "a recipient"} settled on Solana`,
        detail: null,
      };
    case "payroll_executed":
      return {
        title: `${actor} ${meta.resumed === true ? "resumed" : "ran"} ${event.subject.label ?? "a payroll run"}`,
        detail: count(meta.lines, "line", "lines"),
      };
    case "payroll_run_stopped":
      return {
        title: `${event.subject.label ?? "A payroll run"} stopped before every line was paid`,
        detail: meta.status === "failed" ? "No line was paid" : "Resume pays the rest",
      };
    case "payroll_run_settled":
      return {
        title: `${event.subject.label ?? "A payroll run"} settled on Solana`,
        detail: count(meta.lines, "line", "lines"),
      };
    case "approval_recorded":
      return { title: `${actor} approved ${event.subject.label ?? "a payment"}`, detail: null };
    case "export_created": {
      // AC-11.4: who exported how many rows, under which grant's scope; never an amount.
      const who = actor === "You" ? actor : (event.subject.label ?? actor);
      const scope = scopeWords(
        (meta.scope as GrantScopeName) ?? "all_payments",
        (meta.periodFrom as string | null) ?? null,
        (meta.periodTo as string | null) ?? null,
      );
      const month = typeof meta.month === "string" ? monthLabel(meta.month, true) : null;
      return {
        title: `${who} exported ${count(meta.rows, "record", "records")} to CSV`,
        detail: month ? `${scope}, ${month}` : scope,
      };
    }
    case "reconciliation_updated":
      return {
        title: `${actor} marked a payment to ${event.subject.label ?? "a recipient"} as ${meta.status === "matched" ? "matched" : "needing a receipt"}`,
        detail: null,
      };
    default:
      return { title: event.action.replaceAll("_", " "), detail: null };
  }
}

/** "Just now", "12 minutes ago", "3 hours ago", "Yesterday", or the date. */
export function whenWords(createdAt: string, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(createdAt).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  if (hours < 48) return "Yesterday";
  return formatDate(createdAt);
}
