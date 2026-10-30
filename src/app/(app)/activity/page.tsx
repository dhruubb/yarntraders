import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requirePage } from "@/server/auth";
import { addDays, todayIST } from "@/lib/calc";
import { Badge, Empty, Filters, PageHeader, Table, fmtDateTime, input, label, td, th } from "@/components/ui";

export const metadata = { title: "Activity log" };

const LINK: Record<string, (id: string) => string> = { invoice: (id) => `/invoices/${id}`, payment: (id) => `/payments/${id}`, party: (id) => `/parties/${id}`, product: (id) => `/stock/products/${id}`, stock: (id) => `/stock/products/${id}` };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requirePage("view_audit");
  const sp = await searchParams;
  const today = todayIST();
  const from = sp.from || addDays(today, -7);
  const to = sp.to || today;
  const q = sp.q?.trim() ?? "";
  const rows = (
    await db.execute<{ id: number; created_at: string; user_name: string | null; action: string; entity: string; entity_id: string; summary: string }>(sql`
      SELECT a.id, a.created_at, u.name AS user_name, a.action, a.entity, a.entity_id, a.summary
      FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.business_id = ${s.ctx.businessId} AND (a.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from} AND ${to}
        ${sp.action ? sql`AND a.action = ${sp.action}` : sql``}
        ${sp.user ? sql`AND a.user_id = ${Number(sp.user)}` : sql``}
        ${q ? sql`AND a.summary ILIKE ${`%${q}%`}` : sql``}
      ORDER BY a.id DESC LIMIT 1000`)
  ).rows;
  const us = (await db.execute<{ id: number; name: string }>(sql`SELECT id, name FROM users WHERE business_id = ${s.ctx.businessId} ORDER BY name`)).rows;
  return (
    <>
      <PageHeader title="Activity log" sub="Every entry, change, cancellation and sign-in, with who did it. This log can't be edited or deleted." />
      <Filters q={q} from={from} to={to} placeholder="Search text">
        <div>
          <label className={label} htmlFor="action">Action</label>
          <select id="action" name="action" defaultValue={sp.action ?? ""} className={input}>
            <option value="">All</option><option value="create">Created</option><option value="update">Changed</option><option value="cancel">Cancelled</option><option value="login">Sign-in</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="user">User</label>
          <select id="user" name="user" defaultValue={sp.user ?? ""} className={input}>
            <option value="">Everyone</option>
            {us.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </Filters>
      <div className="rounded-lg border border-rule bg-surface">
        {rows.length === 0 ? <Empty title="No activity in this period" /> : (
          <Table>
            <thead><tr><th className={th}>When</th><th className={th}>Who</th><th className={th}>Action</th><th className={th}>What</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={`${td} whitespace-nowrap text-muted`}>{fmtDateTime(r.created_at)}</td>
                  <td className={`${td} whitespace-nowrap`}>{r.user_name ?? "System"}</td>
                  <td className={td}><Badge tone={r.action === "cancel" ? "due" : r.action === "update" ? "warn" : r.action === "login" ? "neutral" : "ink"}>{{ create: "Created", update: "Changed", cancel: "Cancelled", login: "Sign-in" }[r.action] ?? r.action}</Badge></td>
                  <td className={td}>{LINK[r.entity] && r.entity_id ? <Link href={LINK[r.entity](r.entity_id)} className="hover:underline">{r.summary}</Link> : r.summary}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
