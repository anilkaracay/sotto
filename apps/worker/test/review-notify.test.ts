// The review notification of step 4.2 (founder 2026-10-02): SOTTO_NOTIFY_URL names a Discord webhook
// or a Telegram bot, detected from the URL; the message names the organization, its country and the
// time only; the job announces each organization in review once, marks nothing without a URL, does
// not retry a refused message and retries a failed one. Against a fresh test database.
import { orgs, users } from "@sotto/db";
import { createTestDatabase, type TestDatabase } from "@sotto/db/testing";
import { getAddressDecoder } from "@solana/kit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reviewNotifyJob } from "../src/jobs/review-notify.ts";
import { notifyTarget, reviewMessage, sendNotification } from "../src/notify.ts";

const DISCORD = "https://discord.com/api/webhooks/123456789012345678/AbC-dEf_123";
const TELEGRAM = "https://api.telegram.org/bot123456:AAH-xyz_987/sendMessage?chat_id=-1001234567";
const context = () => ({ signal: new AbortController().signal, log: () => undefined });
const randomAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));

describe("SOTTO_NOTIFY_URL", () => {
  it("names a Discord webhook or a Telegram bot with its chat, from the URL", () => {
    expect(notifyTarget(DISCORD)).toEqual({ kind: "discord", url: DISCORD });
    expect(notifyTarget("https://discordapp.com/api/webhooks/1/x")?.kind).toBe("discord");
    expect(notifyTarget(TELEGRAM)).toEqual({
      kind: "telegram",
      url: "https://api.telegram.org/bot123456:AAH-xyz_987/sendMessage",
      chatId: "-1001234567",
    });
    expect(notifyTarget(`${TELEGRAM.split("?")[0]}?chat_id=@sotto_reviews`)?.kind).toBe("telegram");
  });

  it("ignores an absent value, plain http, another host and a Telegram URL without its chat", () => {
    for (const value of [
      undefined,
      "",
      "not a url",
      DISCORD.replace("https:", "http:"),
      "https://discord.example/api/webhooks/1/x",
      "https://discord.com/channels/1/2",
      TELEGRAM.split("?")[0],
      "https://api.telegram.org/bot123456:AAH/getUpdates?chat_id=1",
    ]) {
      expect(notifyTarget(value), String(value)).toBeNull();
    }
  });

  it("says only the legal name, the country and the time", () => {
    expect(
      reviewMessage({
        legalName: "Northwind Labs Demo Ltd",
        country: "GB",
        createdAt: new Date("2026-10-04T09:30:12Z"),
      }),
    ).toBe("Sotto: Northwind Labs Demo Ltd (GB) is waiting for review since 2026-10-04 09:30 UTC.");
  });

  it("posts Discord's content and Telegram's chat and text, and tells refused from failed", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const answer =
      (status: number): typeof fetch =>
      async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(null, { status });
      };
    const discord = notifyTarget(DISCORD);
    const telegram = notifyTarget(TELEGRAM);
    if (!discord || !telegram) throw new Error("targets");
    expect(await sendNotification(discord, "hello", answer(204))).toBe("sent");
    expect(calls[0]).toEqual({
      url: DISCORD,
      body: { content: "hello", allowed_mentions: { parse: [] } },
    });
    expect(await sendNotification(telegram, "hello", answer(200))).toBe("sent");
    expect(calls[1]?.body).toEqual({ chat_id: "-1001234567", text: "hello" });
    expect(await sendNotification(discord, "x", answer(404))).toBe("refused");
    expect(await sendNotification(discord, "x", answer(502))).toBe("failed");
    const offline: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await sendNotification(discord, "x", offline)).toBe("failed");
  });
});

describe("review-notify", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.drop();
  });

  async function org(status: "pending_review" | "active", legalName: string) {
    const [owner] = await database.db
      .insert(users)
      .values({ wallet: randomAddress() })
      .returning({ id: users.id, wallet: users.wallet });
    if (!owner) throw new Error("user");
    const [row] = await database.db
      .insert(orgs)
      .values({
        displayName: legalName,
        legalName,
        country: "GB",
        registrationNo: "REG-555",
        website: "https://example.org",
        contactEmail: "owner@example.org",
        ownerUserId: owner.id,
        status,
      })
      .returning({ id: orgs.id });
    if (!row) throw new Error("org");
    return { id: row.id, wallet: owner.wallet };
  }

  const notified = async (id: string) =>
    (await database.db.select().from(orgs).where(eq(orgs.id, id)))[0]?.reviewNotifiedAt ?? null;

  it("announces each organization in review once, with no wallet, email or registration number", async () => {
    const waiting = await org("pending_review", "Kinfolk Studio Ltd");
    const active = await org("active", "Hollis Supply Co");
    const sent: string[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      sent.push(String(init?.body));
      return new Response(null, { status: 204 });
    };
    const job = reviewNotifyJob({ db: database.db, target: notifyTarget(DISCORD), fetchFn });
    expect(await job.run(context())).toMatchObject({ sent: 1, service: "discord" });
    expect(await notified(waiting.id)).not.toBeNull();
    expect(await notified(active.id)).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Kinfolk Studio Ltd (GB)");
    for (const secret of [waiting.wallet, "owner@example.org", "REG-555"]) {
      expect(sent[0]).not.toContain(secret);
    }
    // Once only.
    expect(await job.run(context())).toMatchObject({ sent: 0 });
    expect(sent).toHaveLength(1);
  });

  it("marks nothing without a URL, so the organizations are announced once it is set", async () => {
    const waiting = await org("pending_review", "Stratus Cloud Ltd");
    const job = reviewNotifyJob({ db: database.db, target: null });
    expect(await job.run(context())).toMatchObject({ skipped: true, sent: 0 });
    expect(await notified(waiting.id)).toBeNull();
  });

  it("does not try a refused message again and tries a failed one at the next run", async () => {
    const refused = await org("pending_review", "Refused Example Ltd");
    let status = 404;
    const fetchFn: typeof fetch = async () => new Response(null, { status });
    const pending = (await database.db.select().from(orgs)).filter(
      (row) => row.status === "pending_review" && row.reviewNotifiedAt === null,
    );
    for (const row of pending.filter((row) => row.id !== refused.id)) {
      await database.db
        .update(orgs)
        .set({ reviewNotifiedAt: new Date() })
        .where(eq(orgs.id, row.id));
    }
    const job = reviewNotifyJob({ db: database.db, target: notifyTarget(TELEGRAM), fetchFn });
    expect(await job.run(context())).toMatchObject({ refused: 1 });
    expect(await notified(refused.id)).not.toBeNull();

    const failing = await org("pending_review", "Failing Example Ltd");
    status = 503;
    expect(await job.run(context())).toMatchObject({ failed: 1 });
    expect(await notified(failing.id)).toBeNull();
    status = 200;
    expect(await job.run(context())).toMatchObject({ sent: 1 });
    expect(await notified(failing.id)).not.toBeNull();
  });
});
