import Link from "next/link";
import { sql } from "drizzle-orm";
import { AlertCircle, Banknote, PackageMinus, Phone, Truck } from "lucide-react";
import { db } from "@/db";
import { requirePage } from "@/server/auth";
import { dashboard, openItems, type OpenItem } from "@/server/queries";
import { can } from "@/lib/permissions";
import { D, formatQty, todayIST } from "@/lib/calc";
import { SalesChart } from "@/components/client/SalesChart";
import { ChequeButtons } from "@/components/client/ChequeButtons";
import { Money, Stat, btn, fmtDate, fmtDateTime, hrefWith, input } from "@/components/ui";

export const metadata = { title: "Home" };

type PartyDue = { id: number; name: string; phone: string; amount: ReturnType<typeof D>; days: number };

function byParty(items: OpenItem[]): PartyDue[] {
  const m = new Map<number, PartyDue>();
  for (const i of items) {
    if (i.days_overdue <= 0) continue;
    const e = m.get(i.party_id) ?? { id: i.party_id, name: i.party_name, phone: i.phone, amount: D(0), days: 0 };
    e.amount = e.amount.add(i.outstanding);
    e.days = Math.max(e.days, i.days_overdue);
    m.set(i.party_id, e);
  }
  return [...m.values()].sort((a, b) => b.amount.cmp(a.amount));
}

export default async function Home({ searchParams }: { searchParams: Promise<{ date?: string; denied?: string }> }) {
  const s = await requirePage();
  const sp = await searchParams;
  const today = todayIST();
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;
  const isToday = date === today;
  const owner = can(s.ctx.role, "view_cost_profit");
  const [d, recv, pay, cheques] = await Promise.all([
    dashboard(s.ctx.businessId, date),
    openItems(s.ctx.businessId, "receivable", undefined, date),
    openItems(s.ctx.businessId, "payable", undefined, date),
    db.execute<{ id: number; party: string; amount: string; cheque_no: string; direction: "in" | "out"; date: string }>(sql`
      SELECT y.id, p.name AS party, y.amount, y.cheque_no, y.direction, y.date FROM payments y JOIN parties p ON p.id = y.party_id
      WHERE y.business_id = ${s.ctx.businessId} AND y.status = 'posted' AND y.cheque_status = 'pending' ORDER BY y.date LIMIT 8`),
  ]);
  const collect = byParty(recv);
  const toPay = byParty(pay);
  const tasks = collect.length + toPay.length + cheques.rows.length + d.lowStock.length;

  return (
    <div className="space-y-5">
      {sp.denied && <p role="alert" className="rounded-md bg-turmeric-tint px-4 py-2 text-sm text-turmeric">That page is for the owner only.</p>}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">{isToday ? "Today" : fmtDate(date)}</h1>
          <p className="text-sm text-muted">{fmtDate(date)}{owner && <> · gross profit <Money v={d.today.grossProfit} tone="auto" className="font-medium text-text" /> ({d.today.grossMarginPct}%)</>}</p>
        </div>
        <form className="hidden items-center gap-2 sm:flex">
          <label htmlFor="day" className="whitespace-nowrap text-sm text-muted">Show day</label>
          <input id="day" type="date" name="date" defaultValue={date} max={today} className={`${input} w-auto py-1.5`} />
          <button className={`${btn.secondary} py-1.5`}>Go</button>
          {!isToday && <Link href="/" className={btn.ghost}>Back to today</Link>}
        </form>
      </div>

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={isToday ? "Sold today" : "Sold"} value={<Money v={d.today.sales} />} note={<>with GST <Money v={d.today.salesTotal} /></>} href={hrefWith("/sales", { p: "custom", from: date, to: date })} />
        <Stat label={isToday ? "Bought today" : "Bought"} value={<Money v={d.today.purchases} />} note={<>with GST <Money v={d.today.purchasesTotal} /></>} href={hrefWith("/purchases", { p: "custom", from: date, to: date })} />
        <Stat label={isToday ? "Money received today" : "Money received"} value={<Money v={d.cashToday.received} />} note={<>paid out <Money v={d.cashToday.paid} /></>} href={hrefWith("/sales", { view: "payments", p: "custom", from: date, to: date })} />
        <Stat
          label="Customers owe you"
          value={<Money v={d.receivables} />}
          tone={D(d.overdueReceivables).gt(0) ? "due" : undefined}
          note={D(d.overdueReceivables).gt(0) ? <span className="text-madder"><Money v={d.overdueReceivables} /> overdue</span> : "nothing overdue"}
          href="/parties?show=owe-you"
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section aria-labelledby="todo" className="rounded-lg border border-rule bg-surface">
          <h2 id="todo" className="flex items-center justify-between border-b border-rule px-4 py-3 text-sm font-semibold">
            Needs attention
            <span className="text-xs font-normal text-muted">{tasks === 0 ? "all clear" : `${tasks} item${tasks === 1 ? "" : "s"}`}</span>
          </h2>
          {tasks === 0 && <p className="px-4 py-10 text-center text-sm text-muted">Nothing overdue, no cheques waiting, stock is above alert levels.</p>}

          {collect.length > 0 && (
            <Group icon={<AlertCircle size={16} className="text-madder" />} title="Collect overdue payments" more={collect.length > 5 ? { href: "/reports?r=ageing", label: `All ${collect.length}` } : undefined}>
              {collect.slice(0, 5).map((p) => (
                <Row key={p.id} title={<Link href={`/parties/${p.id}`} className="hover:underline">{p.name}</Link>} sub={<span className="text-madder">oldest bill {p.days} days late</span>} amount={<Money v={p.amount} className="font-semibold" />}>
                  {p.phone && <a href={`tel:${p.phone}`} aria-label={`Call ${p.name}`} className={`${btn.secondary} px-2 py-1`}><Phone size={14} /></a>}
                  <Link href={`/payments/new?direction=in&party=${p.id}&amount=${p.amount.toFixed(0)}`} className={`${btn.primary} px-3 py-1 text-xs`}>Receive</Link>
                </Row>
              ))}
            </Group>
          )}

          {cheques.rows.length > 0 && (
            <Group icon={<Banknote size={16} className="text-turmeric" />} title="Cheques to clear" more={{ href: "/sales?view=payments&status=cheques", label: "View all" }}>
              {cheques.rows.map((c) => (
                <Row key={c.id} title={<Link href={`/payments/${c.id}`} className="hover:underline">{c.party}</Link>} sub={`#${c.cheque_no} · ${c.direction === "in" ? "received" : "given"} ${fmtDate(c.date)}`} amount={<Money v={c.amount} className="font-semibold" />}>
                  <ChequeButtons id={c.id} />
                </Row>
              ))}
            </Group>
          )}

          {toPay.length > 0 && (
            <Group icon={<Truck size={16} className="text-ink" />} title="Supplier bills past due" more={toPay.length > 3 ? { href: "/reports?r=payables_ageing", label: `All ${toPay.length}` } : undefined}>
              {toPay.slice(0, 3).map((p) => (
                <Row key={p.id} title={<Link href={`/parties/${p.id}`} className="hover:underline">{p.name}</Link>} sub={`${p.days} days past due`} amount={<Money v={p.amount} className="font-semibold" />}>
                  <Link href={`/payments/new?direction=out&party=${p.id}&amount=${p.amount.toFixed(0)}`} className={`${btn.secondary} px-3 py-1 text-xs`}>Pay</Link>
                </Row>
              ))}
            </Group>
          )}

          {d.lowStock.length > 0 && (
            <Group icon={<PackageMinus size={16} className="text-turmeric" />} title="Running low">
              {d.lowStock.map((p) => (
                <Row key={p.id} title={<Link href={`/stock/products/${p.id}`} className="hover:underline">{p.name}</Link>} sub={`alert below ${formatQty(p.low_stock_bags)} bags`} amount={<span className="num font-semibold">{formatQty(p.bags)} bags</span>}>
                  <Link href="/purchases/new" className={`${btn.secondary} px-3 py-1 text-xs`}>Buy</Link>
                </Row>
              ))}
            </Group>
          )}
        </section>

        <div className="space-y-5">
          <section aria-labelledby="trend" className="rounded-lg border border-rule bg-surface p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="trend" className="text-sm font-semibold">Last 30 days</h2>
              <p className="text-xs text-muted">
                This month: sold <Money v={d.month.netSales} className="text-text" />
                {owner && <> · profit <Money v={d.month.netProfit} tone="auto" className="text-text" /> after expenses</>}
              </p>
            </div>
            <SalesChart data={d.series.map((r) => ({ day: r.day, sales: Number(r.sales), purchases: Number(r.purchases) }))} />
          </section>

          <section aria-labelledby="recent" className="rounded-lg border border-rule bg-surface">
            <h2 id="recent" className="flex items-center justify-between border-b border-rule px-4 py-3 text-sm font-semibold">
              Latest entries
              {owner && <Link href="/activity" className="text-xs font-medium text-ink hover:underline">Activity log</Link>}
            </h2>
            <ul className="divide-y divide-rule/70">
              {d.recent.slice(0, 6).map((r) => {
                const href = r.entity === "invoice" ? `/invoices/${r.entity_id}` : r.entity === "payment" ? `/payments/${r.entity_id}` : r.entity === "stock" ? `/stock/products/${r.entity_id}` : undefined;
                const text = <span className={r.action === "cancel" ? "text-madder" : ""}>{r.summary.replace(/ \(.*\)$/, "")}</span>;
                return (
                  <li key={r.id} className="px-4 py-2 text-sm">
                    {href ? <Link href={href} className="hover:underline">{text}</Link> : text}
                    <div className="text-xs text-muted">{r.user_name} · {fmtDateTime(r.created_at)}</div>
                  </li>
                );
              })}
              {d.recent.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">No entries yet. Use <b>New sale</b> or <b>New purchase</b> at the top.</li>}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function Group({ icon, title, children, more }: { icon: React.ReactNode; title: string; children: React.ReactNode; more?: { href: string; label: string } }) {
  return (
    <div className="border-b border-rule last:border-0">
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-semibold text-muted">{icon}{title}</h3>
        {more && <Link href={more.href} className="text-xs font-medium text-ink hover:underline">{more.label}</Link>}
      </div>
      <ul>{children}</ul>
    </div>
  );
}

function Row({ title, sub, amount, children }: { title: React.ReactNode; sub: React.ReactNode; amount: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2 sm:grid-cols-[1fr_auto_auto]">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted">{sub}</div>
      </div>
      <div className="text-right text-sm">{amount}</div>
      <div className="col-span-2 flex items-center justify-end gap-1.5 sm:col-span-1">{children}</div>
    </li>
  );
}
