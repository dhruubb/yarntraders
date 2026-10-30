import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requirePage } from "@/server/auth";
import { openItems } from "@/server/queries";
import { D, todayIST, addDays } from "@/lib/calc";
import { Badge, Empty, Filters, Money, PageHeader, Qty, RowLink, Table, btn, fmtDate, input, label, td, tdR, th, thR, KIND_LABEL } from "@/components/ui";

type SP = { q?: string; from?: string; to?: string; status?: string; pay?: string };

export async function InvoiceList({ kinds, title, newHref, newLabel, searchParams }: { kinds: string[]; title: string; newHref?: string; newLabel?: string; searchParams: SP }) {
  const s = await requirePage();
  const today = todayIST();
  const from = searchParams.from || addDays(today, -30);
  const to = searchParams.to || today;
  const q = searchParams.q?.trim() ?? "";
  const status = searchParams.status || "posted";
  const like = `%${q}%`;
  const rows = (
    await db.execute<{ id: number; kind: string; number: string; supplier_bill_no: string; date: string; due_date: string | null; party_id: number; party: string; taxable: string; total: string; status: string; items: string; bags: string; source: string }>(sql`
      SELECT i.id, i.kind, i.number, i.supplier_bill_no, i.date, i.due_date, i.party_id, p.name AS party, i.taxable, i.total, i.status, i.source,
        (SELECT string_agg(trim(to_char(l.bags, 'FM999999990.###'), '.') || ' × ' || pr.name, ', ' ORDER BY l.line_no)
           FROM invoice_lines l JOIN products pr ON pr.id = l.product_id WHERE l.invoice_id = i.id) AS items,
        (SELECT SUM(l.bags) FROM invoice_lines l WHERE l.invoice_id = i.id) AS bags
      FROM invoices i JOIN parties p ON p.id = i.party_id
      WHERE i.business_id = ${s.ctx.businessId} AND i.kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
        AND i.date BETWEEN ${from} AND ${to}
        ${status !== "all" ? sql`AND i.status = ${status}` : sql``}
        ${q ? sql`AND (p.name ILIKE ${like} OR i.number ILIKE ${like} OR i.supplier_bill_no ILIKE ${like} OR EXISTS (SELECT 1 FROM invoice_lines l JOIN products pr ON pr.id = l.product_id WHERE l.invoice_id = i.id AND pr.name ILIKE ${like}))` : sql``}
      ORDER BY i.date DESC, i.id DESC LIMIT 500`)
  ).rows;

  const isMain = kinds.length === 1 && (kinds[0] === "sale" || kinds[0] === "purchase");
  const outstanding = new Map<number, { amt: string; days: number }>();
  if (isMain) {
    for (const o of await openItems(s.ctx.businessId, kinds[0] === "sale" ? "receivable" : "payable"))
      if (o.invoice_id) outstanding.set(o.invoice_id, { amt: o.outstanding, days: o.days_overdue });
  }
  let shown = rows;
  if (isMain && searchParams.pay === "unpaid") shown = rows.filter((r) => r.status === "posted" && outstanding.has(r.id));
  if (isMain && searchParams.pay === "overdue") shown = rows.filter((r) => (outstanding.get(r.id)?.days ?? 0) > 0);
  const posted = shown.filter((r) => r.status === "posted");
  const sum = (k: "taxable" | "total" | "bags") => posted.reduce((a, r) => a.add(r[k] ?? 0), D(0));

  return (
    <>
      <PageHeader
        title={title}
        sub={`${fmtDate(from)} – ${fmtDate(to)}`}
        actions={newHref ? <Link href={newHref} className={btn.primary}>{newLabel}</Link> : undefined}
      />
      <Filters q={q} from={from} to={to} placeholder="Party, bill no. or yarn">
        <div>
          <label className={label} htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status} className={input}>
            <option value="posted">Posted</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
        </div>
        {isMain && (
          <div>
            <label className={label} htmlFor="pay">Payment</label>
            <select id="pay" name="pay" defaultValue={searchParams.pay ?? ""} className={input}>
              <option value="">Any</option>
              <option value="unpaid">Not fully paid</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>
        )}
      </Filters>
      <div className="rounded-lg border border-rule bg-surface">
        {shown.length === 0 ? (
          <Empty title="Nothing in this period" action={newHref ? <Link href={newHref} className={btn.primary}>{newLabel}</Link> : undefined}>
            Change the dates or search to see older entries.
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Bill</th>
                <th className={th}>Party</th>
                <th className={th}>Yarn</th>
                <th className={thR}>Bags</th>
                <th className={thR}>Taxable</th>
                <th className={thR}>Total</th>
                <th className={th}>{isMain ? "Payment" : "Type"}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const o = outstanding.get(r.id);
                return (
                  <tr key={r.id} className={r.status === "cancelled" ? "text-muted line-through decoration-muted/50" : "hover:bg-paper/60"}>
                    <td className={`${td} whitespace-nowrap`}>{fmtDate(r.date)}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      <RowLink href={`/invoices/${r.id}`}>{r.number}</RowLink>
                      {r.supplier_bill_no && <div className="text-xs text-muted">Bill {r.supplier_bill_no}</div>}
                    </td>
                    <td className={td}><Link href={`/parties/${r.party_id}`} className="hover:underline">{r.party}</Link></td>
                    <td className={`${td} max-w-72 text-muted`}>{r.items}</td>
                    <td className={tdR}><Qty v={r.bags} /></td>
                    <td className={tdR}><Money v={r.taxable} /></td>
                    <td className={`${tdR} font-medium`}><Money v={r.total} /></td>
                    <td className={`${td} whitespace-nowrap`}>
                      {r.status === "cancelled" ? (
                        <Badge>Cancelled</Badge>
                      ) : isMain ? (
                        !o ? <Badge tone="ok">Paid</Badge> : o.days > 0 ? <Badge tone="due">₹{D(o.amt).toFixed(0)} · {o.days}d late</Badge> : D(o.amt).lt(r.total) ? <Badge tone="warn">Part paid</Badge> : <Badge tone="neutral">Due {fmtDate(r.due_date)}</Badge>
                      ) : (
                        <Badge tone="ink">{KIND_LABEL[r.kind]}</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className={td} colSpan={4}>{posted.length} posted bills{rows.length === 500 ? " (showing latest 500 — narrow the dates)" : ""}</td>
                <td className={tdR}><Qty v={sum("bags")} /></td>
                <td className={tdR}><Money v={sum("taxable")} /></td>
                <td className={tdR}><Money v={sum("total")} /></td>
                <td className={td} />
              </tr>
            </tfoot>
          </Table>
        )}
      </div>
    </>
  );
}
