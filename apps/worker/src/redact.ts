// Removes database and RPC URLs and API keys from text before it is printed (ENGINEERING-RULES.md: configuration values are
// never printed), and the bearer token of an invite link path (step 2.1: the same prefixes as
// BEARER_PATH_PREFIXES in apps/web/lib/server/log.ts; the worker serves no such URL, but an error
// text could carry one).
const BEARER_PATTERNS = [
  /(\/api\/invites\/|\/app\/invite\/)[^/?#&\s"'<>]+/g,
  /(%2Fapi%2Finvites%2F|%2Fapp%2Finvite%2F)[^%&\s"'<>]+/gi,
];

export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("<redacted>");
  }
  for (const pattern of BEARER_PATTERNS) out = out.replace(pattern, "$1:token");
  return out
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "<database-url>")
    .replace(/https?:\/\/[^\s"'<>]*helius-rpc\.com[^\s"'<>]*/g, "<rpc-url>")
    .replace(/api-key=[^\s"'&<>]*/g, "api-key=<redacted>");
}
