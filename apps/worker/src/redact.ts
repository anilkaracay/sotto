// Removes RPC URLs and API keys from text before it is printed (ENGINEERING-RULES.md: configuration values are
// never printed).
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("<redacted>");
  }
  return out
    .replace(/https?:\/\/[^\s"'<>]*helius-rpc\.com[^\s"'<>]*/g, "<rpc-url>")
    .replace(/api-key=[^\s"'&<>]*/g, "api-key=<redacted>");
}
