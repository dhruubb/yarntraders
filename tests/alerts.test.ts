import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { businesses, notifications } from "@/db/schema";
import { postInvoice } from "@/server/posting";
import { queueDailySummary, queueOverdueAlerts } from "@/server/notify/jobs";
import { dispatchPending } from "@/server/notify/outbox";
import { addDays, todayIST } from "@/lib/calc";
import { fixture, key } from "./helpers";

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Telegram alerts", () => {
  it("queues one daily summary and one overdue list per day (no repeats)", async () => {
    await postInvoice(f.owner, { kind: "purchase", partyId: f.party.shrenik, date: addDays(todayIST(), -50), idempotencyKey: key(), lines: [{ productId: f.p.amrut30, bags: 50, rate: 1200 }] });
    await postInvoice(f.owner, { kind: "sale", partyId: f.party.khalid, date: addDays(todayIST(), -45), idempotencyKey: key(), lines: [{ productId: f.p.amrut30, bags: 10, rate: 1290 }] });
    await queueDailySummary();
    await queueDailySummary();
    await queueOverdueAlerts();
    await queueOverdueAlerts();
    const rows = await db.select().from(notifications);
    expect(rows.filter((r) => r.type === "daily_summary")).toHaveLength(1);
    const overdue = rows.filter((r) => r.type === "overdue");
    expect(overdue).toHaveLength(1);
    expect(overdue[0].message).toContain("Khalid B.R");
    expect(overdue[0].message).toContain("15 days late");
  });

  it("skips sending when no chat is configured, and sends to Telegram when it is", async () => {
    await queueDailySummary();
    expect(await dispatchPending()).toMatchObject({ skipped: 1, sent: 0 });

    await queueOverdueAlerts(); // nothing overdue → nothing queued
    await db.update(businesses).set({ settings: { telegramChatIds: ["12345"] } }).where(eq(businesses.id, f.business.id));
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      calls.push({ url, body: init.body });
      return new Response("{}", { status: 200 });
    });
    await postInvoice(f.owner, { kind: "purchase", partyId: f.party.suresh, date: todayIST(), idempotencyKey: key(), lines: [{ productId: f.p.vpn47, bags: 200, rate: 1620 }] });
    const r = await dispatchPending();
    expect(r.sent).toBe(1);
    expect(calls[0].url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(JSON.parse(calls[0].body)).toMatchObject({ chat_id: "12345" });
    expect(JSON.parse(calls[0].body).text).toContain("Large Purchase");
  });

  it("retries failed sends and records the error", async () => {
    await db.update(businesses).set({ settings: { telegramChatIds: ["12345"] } }).where(eq(businesses.id, f.business.id));
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubGlobal("fetch", async () => new Response("chat not found", { status: 400 }));
    await queueDailySummary();
    expect(await dispatchPending()).toMatchObject({ failed: 1 });
    const [n] = await db.select().from(notifications);
    expect(n.status).toBe("failed");
    expect(n.lastError).toContain("chat not found");
    expect(n.attempts).toBe(1);
  });
});
