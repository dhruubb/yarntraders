import { sql } from "drizzle-orm";
import { db } from "@/db";
import { D, formatIndian, todayIST } from "@/lib/calc";
import { dashboard, openItems } from "../queries";
import { enqueue, dispatchPending } from "./outbox";

const r = (v: string | number | ReturnType<typeof D>) => `₹${formatIndian(String(v), 0)}`;

async function businessIds() {
  return (await db.execute<{ id: number }>(sql`SELECT id FROM businesses ORDER BY id`)).rows.map((b) => b.id);
}

export async function queueDailySummary(date = todayIST()) {
  for (const id of await businessIds()) {
    const d = await dashboard(id, date);
    const [counts] = (
      await db.execute<{ sales: number; purchases: number; cancelled: number }>(sql`
        SELECT COUNT(*) FILTER (WHERE kind = 'sale' AND status = 'posted')::int AS sales,
               COUNT(*) FILTER (WHERE kind = 'purchase' AND status = 'posted')::int AS purchases,
               (SELECT COUNT(*)::int FROM audit_log WHERE business_id = ${id} AND action = 'cancel' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = ${date}) AS cancelled
        FROM invoices WHERE business_id = ${id} AND date = ${date}`)
    ).rows;
    const lines = [
      `Daily summary — ${date}`,
      `Sales: ${r(d.today.sales)} (${counts.sales} bills)`,
      `Purchases: ${r(d.today.purchases)} (${counts.purchases} bills)`,
      `Gross profit: ${r(d.today.grossProfit)} (${d.today.grossMarginPct}%)`,
      `Collected: ${r(d.cashToday.received)} · Paid out: ${r(d.cashToday.paid)}`,
      `Cash & bank: ${r(d.cashTotal)}`,
      `To receive: ${r(d.receivables)}${D(d.overdueReceivables).gt(0) ? ` (overdue ${r(d.overdueReceivables)})` : ""}`,
      `To pay: ${r(d.payables)}`,
      `Stock: ${formatIndian(d.stockBags, 0)} bags, value ${r(d.stockValue)}`,
      d.lowStock.length ? `Low stock: ${d.lowStock.map((p) => `${p.name} (${D(p.bags).toString()} bags)`).join(", ")}` : "",
      counts.cancelled ? `Cancellations today: ${counts.cancelled}` : "",
    ].filter(Boolean);
    await enqueue(db, id, "daily_summary", lines.join("\n"), `daily-summary:${date}`);
  }
}

export async function queueOverdueAlerts(date = todayIST()) {
  for (const id of await businessIds()) {
    const items = (await openItems(id, "receivable", undefined, date)).filter((i) => i.days_overdue > 0);
    if (items.length === 0) continue;
    const byParty = new Map<string, { amt: ReturnType<typeof D>; days: number; phone: string }>();
    for (const i of items) {
      const e = byParty.get(i.party_name) ?? { amt: D(0), days: 0, phone: i.phone };
      e.amt = e.amt.add(i.outstanding);
      e.days = Math.max(e.days, i.days_overdue);
      byParty.set(i.party_name, e);
    }
    const sorted = [...byParty.entries()].sort((a, b) => b[1].amt.cmp(a[1].amt));
    const total = sorted.reduce((a, [, e]) => a.add(e.amt), D(0));
    const lines = [
      `Overdue payments — ${sorted.length} parties, ${r(total)}`,
      ...sorted.slice(0, 15).map(([name, e]) => `• ${name}: ${r(e.amt)}, oldest ${e.days} days late${e.phone ? ` (${e.phone})` : ""}`),
      sorted.length > 15 ? `…and ${sorted.length - 15} more. See Reports → Receivables ageing.` : "",
    ].filter(Boolean);
    await enqueue(db, id, "overdue", lines.join("\n"), `overdue:${date}`);
  }
}

export async function runJob(job: string) {
  if (job === "daily-summary") await queueDailySummary();
  else if (job === "overdue") await queueOverdueAlerts();
  else if (job !== "dispatch") throw new Error(`Unknown job ${job}`);
  return dispatchPending(200);
}
