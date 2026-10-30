/**
 * The Sales and Purchases tabs. Each has sub-views:
 *   Sales:     Bills · Returns · Money received
 *   Purchases: Bills · Returns · Payments made · Expenses
 */
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Plus } from "lucide-react";
import { db } from "@/db";
import { requirePage } from "@/server/auth";
import { openItems } from "@/server/queries";
import { accountOptions } from "@/server/formdata";
import { EXPENSE_CATEGORIES } from "@/server/posting";
import { can } from "@/lib/permissions";
import { D, todayIST } from "@/lib/calc";
import { resolvePeriod } from "@/lib/period";
import { cancelExpenseAction } from "@/app/actions";
import { ClickRow } from "@/components/client/ClickRow";
import { ChequeButtons } from "@/components/client/ChequeButtons";
import { CancelButton } from "@/components/client/CancelButton";
import { ExpenseForm } from "@/components/client/ExpenseForm";
import { Badge, CardList, Chips, Empty, ListToolbar, Money, Qty, Segmented, Table, btn, fmtDate, hrefWith, td, tdR, th, thR } from "@/components/ui";

type Side = "sale" | "purchase";
type SP = Record<string, string | undefined>;

const COPY = {
  sale: {
    title: "Sales",
    base: "/sales",
    party: "Customer",
    newHref: "/sales/new",
    newLabel: "New sale",
    payHref: "/payments/new?direction=in",
    payLabel: "Receive payment",
    payShort: "Receive",
    paymentsTab: "Money received",
    dueWord: "to collect",
  },
  purchase: {
    title: "Purchases",
    base: "/purchases",
    party: "Supplier",
    newHref: "/purchases/new",
    newLabel: "New purchase",
    payHref: "/payments/new?direction=out",
    payLabel: "Pay supplier",
    payShort: "Pay",
    paymentsTab: "Payments made",
    dueWord: "to pay",
  },
} as const;

export async function TradeTab({ side, sp }: { side: Side; sp: SP }) {
  const s = await requirePage();
  const c = COPY[side];
  const today = todayIST();
  const views = side === "sale" ? (["bills", "returns", "payments"] as const) : (["bills", "returns", "payments", "expenses"] as const);
  const view = (views as readonly string[]).includes(sp.view ?? "") ? (sp.view as (typeof views)[number]) : "bills";
  const period = resolvePeriod(sp, today);
  const q = sp.q?.trim() ?? "";

  // Outstanding bills drive the "to collect / to pay" figure, unpaid badges and the inline Receive/Pay buttons
  const open = await openItems(s.ctx.businessId, side === "sale" ? "receivable" : "payable");
  const outstanding = new Map<number, { amt: string; days: number }>();
  for (const o of open) if (o.invoice_id) outstanding.set(o.invoice_id, { amt: o.outstanding, days: o.days_overdue });
  const totalDue = open.reduce((a, o) => a.add(o.outstanding), D(0));
  const overdueCount = open.filter((o) => o.days_overdue > 0 && o.invoice_id).length;
  const pendingCheques = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM payments WHERE business_id = ${s.ctx.businessId} AND status = 'posted' AND cheque_status = 'pending' AND direction = ${side === "sale" ? "in" : "out"}`);

  const label: Record<string, string> = { bills: "Bills", returns: "Returns", payments: c.paymentsTab, expenses: "Expenses" };
  const keepPeriod = { p: period.key, from: period.key === "custom" ? period.from : undefined, to: period.key === "custom" ? period.to : undefined };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">{c.title}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {totalDue.isZero() ? `Nothing ${c.dueWord}` : <><Money v={totalDue} tone={side === "sale" ? "due" : undefined} /> {c.dueWord}</>}
            {overdueCount > 0 && <> · <Link href={hrefWith(c.base, { status: "overdue", p: "fy" })} className="text-madder underline-offset-2 hover:underline">{overdueCount} overdue bill{overdueCount === 1 ? "" : "s"}</Link></>}
          </p>
        </div>
        {side === "purchase" && <Link href={c.payHref} className={btn.secondary}>{c.payLabel}</Link>}
      </div>

      <Segmented
        label={`${c.title} views`}
        items={views.map((v) => ({
          href: hrefWith(c.base, { view: v === "bills" ? undefined : v, ...keepPeriod }),
          label: label[v],
          active: v === view,
          count: v === "payments" ? pendingCheques.rows[0].n : undefined,
        }))}
      />

      {view === "bills" || view === "returns" ? (
        <BillsView side={side} view={view} sp={sp} q={q} period={period} outstanding={outstanding} businessId={s.ctx.businessId} />
      ) : view === "payments" ? (
        <PaymentsView side={side} sp={sp} q={q} period={period} businessId={s.ctx.businessId} />
      ) : (
        <ExpensesView sp={sp} q={q} period={period} businessId={s.ctx.businessId} canCancel={can(s.ctx.role, "cancel_posted")} />
      )}
    </>
  );
}

type Period = ReturnType<typeof resolvePeriod>;

async function BillsView({ side, view, sp, q, period, outstanding, businessId }: { side: Side; view: "bills" | "returns"; sp: SP; q: string; period: Period; outstanding: Map<number, { amt: string; days: number }>; businessId: number }) {
  const c = COPY[side];
  const kind = view === "bills" ? side : `${side}_return`;
  const status = ["unpaid", "overdue", "cancelled"].includes(sp.status ?? "") ? sp.status! : "all";
  const like = `%${q}%`;
  const rows = (
    await db.execute<{ id: number; number: string; supplier_bill_no: string; date: string; due_date: string | null; party_id: number; party: string; total: string; status: string; items: string; bags: string }>(sql`
      SELECT i.id, i.number, i.supplier_bill_no, i.date, i.due_date, i.party_id, p.name AS party, i.total, i.status,
        (SELECT string_agg(trim(to_char(l.bags, 'FM999999990.###'), '.') || ' × ' || pr.name, ', ' ORDER BY l.line_no)
           FROM invoice_lines l JOIN products pr ON pr.id = l.product_id WHERE l.invoice_id = i.id) AS items,
        (SELECT SUM(l.bags) FROM invoice_lines l WHERE l.invoice_id = i.id) AS bags
      FROM invoices i JOIN parties p ON p.id = i.party_id
      WHERE i.business_id = ${businessId} AND i.kind = ${kind}
        AND i.date BETWEEN ${period.from} AND ${period.to}
        AND i.status = ${status === "cancelled" ? "cancelled" : "posted"}
        ${q ? sql`AND (p.name ILIKE ${like} OR i.number ILIKE ${like} OR i.supplier_bill_no ILIKE ${like} OR EXISTS (SELECT 1 FROM invoice_lines l JOIN products pr ON pr.id = l.product_id WHERE l.invoice_id = i.id AND pr.name ILIKE ${like}))` : sql``}
      ORDER BY i.date DESC, i.id DESC LIMIT 500`)
  ).rows;
  let shown = rows;
  if (status === "unpaid") shown = rows.filter((r) => outstanding.has(r.id));
  if (status === "overdue") shown = rows.filter((r) => (outstanding.get(r.id)?.days ?? 0) > 0);
  const total = shown.reduce((a, r) => a.add(r.total), D(0));
  const bags = shown.reduce((a, r) => a.add(r.bags ?? 0), D(0));
  const keep = { view: view === "bills" ? undefined : view, status: status === "all" ? undefined : status };
  const tabParam = side === "purchase" ? "?tab=purchases" : "";

  return (
    <>
      <ListToolbar base={c.base} keep={keep} period={period} q={q} placeholder={`${c.party}, bill no. or yarn`} />
      <div className="mb-3">
        <Chips
          label="Status"
          items={(view === "bills" ? ["all", "unpaid", "overdue", "cancelled"] : ["all", "cancelled"]).map((st) => ({
            label: { all: "All", unpaid: "Not fully paid", overdue: "Overdue", cancelled: "Cancelled" }[st]!,
            active: st === status,
            href: hrefWith(c.base, { view: keep.view, status: st === "all" ? undefined : st, q, p: period.key, from: period.key === "custom" ? period.from : undefined, to: period.key === "custom" ? period.to : undefined }),
          }))}
        />
      </div>
      <div className="overflow-hidden rounded-lg border border-rule bg-surface">
        {shown.length === 0 ? (
          <Empty
            title={q ? `No ${view} match “${q}”` : `No ${view === "bills" ? "bills" : "returns"} in this period`}
            action={view === "bills" ? <Link href={c.newHref} className={btn.primary}>{c.newLabel}</Link> : undefined}
          >
            {view === "returns" ? `Open a ${side} bill and choose “Make return”.` : "Try another period above."}
          </Empty>
        ) : (
          <>
          <CardList
            items={shown.map((r) => {
              const o = outstanding.get(r.id);
              const cancelled = r.status === "cancelled";
              return {
                key: r.id,
                href: `/invoices/${r.id}${tabParam}`,
                muted: cancelled,
                title: r.party,
                sub: <>{fmtDate(r.date)} · {r.items}</>,
                right: <span className={cancelled ? "line-through" : ""}><Money v={r.total} /></span>,
                rightSub: cancelled ? <Badge>Cancelled</Badge> : view !== "bills" ? null : !o ? <Badge tone="ok">Paid</Badge> : o.days > 0 ? <Badge tone="due">{o.days} days late</Badge> : D(o.amt).lt(r.total) ? <Badge tone="warn">Part paid</Badge> : <span className="text-muted">Due {fmtDate(r.due_date)}</span>,
                action: o && !cancelled && view === "bills" ? <Link href={`/payments/new?direction=${side === "sale" ? "in" : "out"}&party=${r.party_id}&amount=${D(o.amt).toFixed(0)}`} className={`${btn.secondary} px-3 py-1 text-xs`}>{c.payShort}</Link> : undefined,
              };
            })}
          />
          <Table className="hidden md:block">
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>{c.party}</th>
                <th className={`${th} hidden md:table-cell`}>Yarn</th>
                <th className={thR}>Total</th>
                <th className={th}>{view === "bills" ? "Payment" : ""}</th>
                <th className={th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const o = outstanding.get(r.id);
                const cancelled = r.status === "cancelled";
                return (
                  <ClickRow key={r.id} href={`/invoices/${r.id}${tabParam}`} className={cancelled ? "text-muted" : ""}>
                    <td className={`${td} whitespace-nowrap`}>{fmtDate(r.date)}</td>
                    <td className={td}>
                      <div className={`font-medium ${cancelled ? "line-through" : ""}`}>{r.party}</div>
                      <div className="text-xs text-muted">{r.number}{r.supplier_bill_no ? ` · bill ${r.supplier_bill_no}` : ""}</div>
                    </td>
                    <td className={`${td} hidden max-w-80 text-muted md:table-cell`}>{r.items}</td>
                    <td className={`${tdR} font-medium`}><span className={cancelled ? "line-through" : ""}><Money v={r.total} /></span></td>
                    <td className={`${td} whitespace-nowrap`}>
                      {cancelled ? <Badge>Cancelled</Badge> : view !== "bills" ? null : !o ? <Badge tone="ok">Paid</Badge> : o.days > 0 ? <Badge tone="due">{o.days} days late</Badge> : D(o.amt).lt(r.total) ? <Badge tone="warn">Part paid</Badge> : <span className="text-xs text-muted">Due {fmtDate(r.due_date)}</span>}
                    </td>
                    <td className={`${td} text-right`}>
                      {o && !cancelled && view === "bills" && (
                        <Link href={`/payments/new?direction=${side === "sale" ? "in" : "out"}&party=${r.party_id}&amount=${D(o.amt).toFixed(0)}`} className={`${btn.secondary} px-3 py-1 text-xs`}>
                          {c.payShort}
                        </Link>
                      )}
                    </td>
                  </ClickRow>
                );
              })}
            </tbody>
          </Table>
          </>
        )}
        {shown.length > 0 && (
          <div className="flex flex-wrap justify-between gap-2 border-t border-rule bg-paper/50 px-3 py-2 text-sm">
            <span className="text-muted">{shown.length} {view === "bills" ? "bills" : "returns"} · <Qty v={bags} unit="bags" />{rows.length === 500 ? " · showing latest 500" : ""}</span>
            <span className="font-semibold">Total <Money v={total} /></span>
          </div>
        )}
      </div>
    </>
  );
}

async function PaymentsView({ side, sp, q, period, businessId }: { side: Side; sp: SP; q: string; period: Period; businessId: number }) {
  const c = COPY[side];
  const direction = side === "sale" ? "in" : "out";
  const filter = sp.status === "cheques" ? "cheques" : "all";
  const rows = (
    await db.execute<{ id: number; date: string; party_id: number; party: string; amount: string; mode: string; account: string; cheque_no: string; cheque_status: string; reference: string; status: string }>(sql`
      SELECT y.id, y.date, y.party_id, p.name AS party, y.amount, y.mode, a.name AS account, y.cheque_no, y.cheque_status, y.reference, y.status
      FROM payments y JOIN parties p ON p.id = y.party_id JOIN accounts a ON a.id = y.account_id
      WHERE y.business_id = ${businessId} AND y.direction = ${direction}
        ${filter === "cheques" ? sql`AND y.cheque_status = 'pending' AND y.status = 'posted'` : sql`AND y.date BETWEEN ${period.from} AND ${period.to}`}
        ${q ? sql`AND (p.name ILIKE ${`%${q}%`} OR y.cheque_no ILIKE ${`%${q}%`} OR y.reference ILIKE ${`%${q}%`})` : sql``}
      ORDER BY y.date DESC, y.id DESC LIMIT 500`)
  ).rows;
  const live = rows.filter((r) => r.status === "posted" && r.cheque_status !== "bounced");
  const total = live.reduce((a, r) => a.add(r.amount), D(0));
  const tabParam = side === "purchase" ? "&tab=purchases" : "";
  return (
    <>
      <ListToolbar base={c.base} keep={{ view: "payments", status: filter === "cheques" ? "cheques" : undefined }} period={period} q={q} placeholder="Party, cheque no. or reference" showPeriod={filter !== "cheques"} />
      <div className="mb-3">
        <Chips
          label="Show"
          items={[
            { label: "All payments", active: filter === "all", href: hrefWith(c.base, { view: "payments", q, p: period.key, from: period.key === "custom" ? period.from : undefined, to: period.key === "custom" ? period.to : undefined }) },
            { label: "Cheques to clear", active: filter === "cheques", href: hrefWith(c.base, { view: "payments", status: "cheques" }) },
          ]}
        />
      </div>
      <div className="overflow-hidden rounded-lg border border-rule bg-surface">
        {rows.length === 0 ? (
          <Empty title={filter === "cheques" ? "No cheques waiting to clear" : "No payments in this period"} action={<Link href={c.payHref} className={btn.primary}>{c.payLabel}</Link>} />
        ) : (
          <>
          <CardList
            items={rows.map((r) => ({
              key: r.id,
              href: `/payments/${r.id}?direction=${direction}${tabParam}`,
              muted: r.status === "cancelled",
              title: r.party,
              sub: <span className="capitalize">{fmtDate(r.date)} · {r.mode}{r.cheque_no ? ` #${r.cheque_no}` : ""}</span>,
              right: <span className={r.status === "cancelled" ? "line-through" : ""}><Money v={r.amount} tone={side === "sale" ? "in" : undefined} /></span>,
              rightSub: r.status === "cancelled" ? <Badge>Cancelled</Badge> : r.cheque_status === "bounced" ? <Badge tone="due">Bounced</Badge> : r.cheque_status === "cleared" ? <Badge tone="ok">Cleared</Badge> : null,
              action: r.status === "posted" && r.cheque_status === "pending" ? <ChequeButtons id={r.id} /> : undefined,
            }))}
          />
          <Table className="hidden md:block">
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Party</th>
                <th className={`${th} hidden sm:table-cell`}>How</th>
                <th className={thR}>Amount</th>
                <th className={th}><span className="sr-only">Status</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <ClickRow key={r.id} href={`/payments/${r.id}?direction=${direction}${tabParam}`} className={r.status === "cancelled" ? "text-muted" : ""}>
                  <td className={`${td} whitespace-nowrap`}>{fmtDate(r.date)}</td>
                  <td className={td}><div className="font-medium">{r.party}</div><div className="text-xs text-muted sm:hidden capitalize">{r.mode}{r.cheque_no ? ` #${r.cheque_no}` : ""}</div></td>
                  <td className={`${td} hidden capitalize sm:table-cell`}>{r.mode}{r.cheque_no ? ` #${r.cheque_no}` : ""}<div className="text-xs normal-case text-muted">{r.account}{r.reference ? ` · ${r.reference}` : ""}</div></td>
                  <td className={`${tdR} font-medium`}><span className={r.status === "cancelled" ? "line-through" : ""}><Money v={r.amount} tone={side === "sale" ? "in" : undefined} /></span></td>
                  <td className={`${td} text-right`}>
                    {r.status === "cancelled" ? <Badge>Cancelled</Badge> : r.cheque_status === "pending" ? <ChequeButtons id={r.id} /> : r.cheque_status === "bounced" ? <Badge tone="due">Bounced</Badge> : r.cheque_status === "cleared" ? <Badge tone="ok">Cleared</Badge> : null}
                  </td>
                </ClickRow>
              ))}
            </tbody>
          </Table>
          </>
        )}
        {rows.length > 0 && (
          <div className="flex justify-between border-t border-rule bg-paper/50 px-3 py-2 text-sm">
            <span className="text-muted">{rows.length} payments</span>
            <span className="font-semibold">Total <Money v={total} /></span>
          </div>
        )}
      </div>
    </>
  );
}

async function ExpensesView({ sp, q, period, businessId, canCancel }: { sp: SP; q: string; period: Period; businessId: number; canCancel: boolean }) {
  const accounts = await accountOptions(businessId);
  const rows = (
    await db.execute<{ id: number; date: string; category: string; amount: string; account: string; paid_to: string; status: string; cancel_reason: string | null }>(sql`
      SELECT e.id, e.date, e.category, e.amount, a.name AS account, e.paid_to, e.status, e.cancel_reason
      FROM expenses e JOIN accounts a ON a.id = e.account_id
      WHERE e.business_id = ${businessId} AND e.date BETWEEN ${period.from} AND ${period.to}
        ${q ? sql`AND (e.category ILIKE ${`%${q}%`} OR e.paid_to ILIKE ${`%${q}%`})` : sql``}
      ORDER BY e.date DESC, e.id DESC`)
  ).rows;
  const byCat = new Map<string, ReturnType<typeof D>>();
  for (const r of rows) if (r.status === "posted") byCat.set(r.category, (byCat.get(r.category) ?? D(0)).add(r.amount));
  const total = [...byCat.values()].reduce((a, v) => a.add(v), D(0));
  return (
    <>
      <details className="group mb-4 rounded-lg border border-rule bg-surface" open={rows.length === 0 || sp.add === "1"}>
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2"><Plus size={16} aria-hidden /> Add an expense</span>
          <span className="text-xs font-normal text-muted group-open:hidden">Rent, salary, transport, electricity…</span>
        </summary>
        <div className="border-t border-rule p-4"><ExpenseForm categories={EXPENSE_CATEGORIES} accounts={accounts} today={todayIST()} /></div>
      </details>
      <ListToolbar base="/purchases" keep={{ view: "expenses" }} period={period} q={q} placeholder="Category or paid to" />
      {byCat.size > 0 && (
        <p className="mb-3 text-sm text-muted">
          {[...byCat.entries()].sort((a, b) => b[1].cmp(a[1])).slice(0, 4).map(([k, v], i) => <span key={k}>{i > 0 && " · "}{k} <Money v={v} className="text-text" /></span>)}
        </p>
      )}
      <div className="overflow-hidden rounded-lg border border-rule bg-surface">
        {rows.length === 0 ? (
          <Empty title="No expenses in this period" />
        ) : (
          <Table>
            <thead><tr><th className={th}>Date</th><th className={th}>Expense</th><th className={`${th} hidden sm:table-cell`}>Paid from</th><th className={thR}>Amount</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.status === "cancelled" ? "text-muted" : ""}>
                  <td className={`${td} whitespace-nowrap`}>{fmtDate(r.date)}</td>
                  <td className={td}><div className="font-medium">{r.category}</div>{r.paid_to && <div className="text-xs text-muted">{r.paid_to}</div>}</td>
                  <td className={`${td} hidden sm:table-cell`}>{r.account}</td>
                  <td className={tdR}><span className={r.status === "cancelled" ? "line-through" : ""}><Money v={r.amount} /></span></td>
                  <td className={`${td} text-right`}>{r.status === "cancelled" ? <Badge>Cancelled</Badge> : canCancel ? <CancelButton what="expense" compact action={cancelExpenseAction.bind(null, r.id)} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {rows.length > 0 && <div className="flex justify-between border-t border-rule bg-paper/50 px-3 py-2 text-sm"><span className="text-muted">{rows.length} expenses</span><span className="font-semibold">Total <Money v={total} /></span></div>}
      </div>
    </>
  );
}
