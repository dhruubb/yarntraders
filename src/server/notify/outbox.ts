import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { notifications } from "@/db/schema";
import { getBusiness } from "../settings";
import { activeChannels } from "./channels";

export type AlertType = "major_txn" | "low_stock" | "unusual" | "overdue" | "daily_summary" | "test";

/**
 * Notifications are written to an outbox inside the same DB transaction as the business event,
 * so an alert exists if and only if the transaction committed. Delivery happens afterwards
 * (right after the request, and again by the cron job for retries).
 */
export async function enqueue(tx: DbOrTx, businessId: number, type: AlertType, message: string, dedupeKey?: string) {
  await tx
    .insert(notifications)
    .values({ businessId, type, message, dedupeKey: dedupeKey ?? null })
    .onConflictDoNothing();
}

const typeToSetting: Record<AlertType, keyof Awaited<ReturnType<typeof getBusiness>>["resolved"]["alerts"] | null> = {
  major_txn: "majorTxn",
  low_stock: "lowStock",
  unusual: "unusual",
  overdue: "overdue",
  daily_summary: "dailySummary",
  test: null,
};

let dispatching = false;

/** Sends pending notifications. Safe to call often; failures are retried up to 5 times. */
export async function dispatchPending(limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  if (dispatching) return { sent: 0, failed: 0, skipped: 0 };
  dispatching = true;
  const counts = { sent: 0, failed: 0, skipped: 0 };
  try {
    const rows = await db
      .select()
      .from(notifications)
      .where(and(inArray(notifications.status, ["pending", "failed"]), lt(notifications.attempts, 5)))
      .orderBy(asc(notifications.id))
      .limit(limit);
    const businessCache = new Map<number, Awaited<ReturnType<typeof getBusiness>>>();
    for (const n of rows) {
      let b = businessCache.get(n.businessId);
      if (!b) {
        b = await getBusiness(db, n.businessId);
        businessCache.set(n.businessId, b);
      }
      const settingKey = typeToSetting[n.type as AlertType];
      const enabled = settingKey ? b.resolved.alerts[settingKey] : true;
      const channels = activeChannels.filter((c) => c.isConfigured(b!.resolved));
      if (!enabled || channels.length === 0) {
        await db.update(notifications).set({ status: "skipped", lastError: enabled ? "No channel configured" : "Alert type turned off" }).where(eq(notifications.id, n.id));
        counts.skipped++;
        continue;
      }
      try {
        for (const c of channels) await c.send(`${b.name}\n${n.message}`, b.resolved);
        await db.update(notifications).set({ status: "sent", sentAt: new Date(), attempts: sql`${notifications.attempts} + 1` }).where(eq(notifications.id, n.id));
        counts.sent++;
      } catch (e) {
        await db
          .update(notifications)
          .set({ status: "failed", lastError: String((e as Error).message).slice(0, 500), attempts: sql`${notifications.attempts} + 1` })
          .where(eq(notifications.id, n.id));
        counts.failed++;
      }
    }
  } finally {
    dispatching = false;
  }
  return counts;
}

/** Fire-and-forget dispatch after a successful post. Never throws into the request. */
export function dispatchSoon() {
  if (process.env.VITEST) return;
  dispatchPending().catch((e) => console.error("notification dispatch failed", e));
}
