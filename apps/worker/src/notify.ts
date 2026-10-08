// The review notification (step 4.2, founder 2026-10-02): one message to
// SOTTO_NOTIFY_URL when an organization enters review, so the founder reviews new organizations
// in time. The URL decides the service: a Discord webhook (JSON "content") or a Telegram bot's
// sendMessage with its chat_id (JSON "chat_id" and "text"). The URL holds a token, so it is never
// logged; the message names the organization, its country and the time, nothing else.

export type NotifyTarget =
  { kind: "discord"; url: string } | { kind: "telegram"; url: string; chatId: string };

const DISCORD_HOSTS = new Set([
  "discord.com",
  "discordapp.com",
  "ptb.discord.com",
  "canary.discord.com",
]);

/** The service a SOTTO_NOTIFY_URL names, or null when it is absent or neither service. */
export function notifyTarget(value: string | null | undefined): NotifyTarget | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (DISCORD_HOSTS.has(url.hostname) && /^\/api\/webhooks\/\d+\/[\w-]+\/?$/.test(url.pathname)) {
    return { kind: "discord", url: `${url.origin}${url.pathname}` };
  }
  const chatId = url.searchParams.get("chat_id");
  if (
    url.hostname === "api.telegram.org" &&
    /^\/bot\d+:[\w-]+\/sendMessage$/.test(url.pathname) &&
    chatId &&
    /^-?\d+$|^@\w+$/.test(chatId)
  ) {
    return { kind: "telegram", url: `${url.origin}${url.pathname}`, chatId };
  }
  return null;
}

/** The words of the message: the organization's legal name, its country and when it was sent. */
export function reviewMessage(org: {
  legalName: string;
  country: string;
  createdAt: Date;
}): string {
  const at = org.createdAt.toISOString().slice(0, 16).replace("T", " ");
  return `Sotto: ${org.legalName} (${org.country}) is waiting for review since ${at} UTC.`;
}

export type SendResult = "sent" | "refused" | "failed";

/**
 * Posts one message. "refused" is a 4xx answer (a wrong URL or a removed webhook: retrying will not
 * help), "failed" a network error or a 5xx answer (worth another try).
 */
export async function sendNotification(
  target: NotifyTarget,
  text: string,
  fetchFn: typeof fetch = fetch,
): Promise<SendResult> {
  const body =
    target.kind === "discord"
      ? { content: text, allowed_mentions: { parse: [] } }
      : { chat_id: target.chatId, text };
  try {
    const response = await fetchFn(target.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return "sent";
    return response.status >= 400 && response.status < 500 ? "refused" : "failed";
  } catch {
    return "failed";
  }
}
