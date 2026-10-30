import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { MoreHorizontal, Phone } from "lucide-react";
import { db } from "@/db";
import { parties } from "@/db/schema";
import { requirePage } from "@/server/auth";
import { GST_STATES } from "@/server/masters";
import { openItems, partyLedger, partyBalance } from "@/server/queries";
import { D, todayIST } from "@/lib/calc";
import { resolvePeriod } from "@/lib/period";
import { ClickRow } from "@/components/client/ClickRow";
import { Menu, type MenuItem } from "@/components/client/Menu";
import { Badge, Balance, Empty, ListToolbar, Money, Segmented, Table, btn, fmtDate, hrefWith, td, tdR, th, thR } from "@/components/ui";

export default async function PartyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const s = await requirePage();
  const { id } = await params;
  const sp = await searchParams;
  const [p] = await db.select().from(parties).where(and(eq(parties.id, Number(id)), eq(parties.businessId, s.ctx.businessId)));
  if (!p) notFound();
  const today = todayIST();
  const tab = ["bills", "statement", "details"].includes(sp.tab ?? "") ? sp.tab! : "bills";
  const period = resolvePeriod(sp, today, "fy");
  const [ledger, recv, pay, balance] = await Promise.all([
    partyLedger(s.ctx.businessId, p.id, period.from, period.to),
    openItems(s.ctx.businessId, "receivable", p.id),
    openItems(s.ctx.businessId, "payable", p.id),
    partyBalance(p.id),
  ]);
  const open = [...recv, ...pay];
  const bal = D(balance);
  const overLimit = p.creditLimit && bal.gt(p.creditLimit);
  const sells = p.type !== "supplier";
  const buys = p.type !== "customer";
  const base = `/parties/${p.id}`;

  const receive = <Link href={`/payments/new?direction=in&party=${p.id}${bal.gt(0) ? `&amount=${bal.toFixed(0)}` : ""}`} className={bal.gt(0) ? btn.primary : btn.secondary}>Receive payment</Link>;
  const payBtn = <Link href={`/payments/new?direction=out&party=${p.id}${bal.lt(0) ? `&amount=${bal.abs().toFixed(0)}` : ""}`} className={bal.lt(0) ? btn.primary : btn.secondary}>Pay</Link>;
  const menu: MenuItem[] = [
    ...(sells && buys ? [{ kind: "link" as const, href: `/purchases/new?party=${p.id}`, label: "New purchase" }] : []),
    { kind: "link", href: `/api/parties/${p.id}/statement?from=${period.from}&to=${period.to}`, label: "Download statement (PDF)", external: true },
    { kind: "link", href: `/parties/${p.id}/edit`, label: "Edit details" },
  ];

  return (
    <div className="space-y-4">
      {sp.paid && (
        <div role="status" className="rounded-md border border-leaf/30 bg-leaf-tint px-4 py-3 text-sm text-leaf">
          <b>Payment saved.</b> The balance below is updated.
          {sp.w && sp.w.split(" | ").map((w) => <p key={w} className="mt-1 font-medium text-turmeric">{w}</p>)}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/parties" className="text-sm text-muted hover:text-text">← Parties</Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight">{p.name}</h1>
            {!p.active && <Badge>Inactive</Badge>}
            {overLimit && <Badge tone="due">Over credit limit</Badge>}
          </div>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">
            <span>{p.type === "both" ? "Customer & supplier" : p.type === "customer" ? "Customer" : "Supplier"}</span>
            {p.city && <span>{p.city}</span>}
            {p.phone && <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 text-ink hover:underline"><Phone size={13} aria-hidden /> {p.phone}</a>}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">Balance today</div>
          <Balance v={bal} className="text-2xl font-semibold" />
        </div>
      </div>

      <div className="no-print flex flex-wrap items-center gap-2">
        {sells && receive}
        {buys && payBtn}
        {sells ? <Link href={`/sales/new?party=${p.id}`} className={btn.secondary}>New sale</Link> : <Link href={`/purchases/new?party=${p.id}`} className={btn.secondary}>New purchase</Link>}
        <Menu triggerClass={`${btn.secondary} px-2.5`} trigger={<><MoreHorizontal size={16} aria-hidden /><span className="sr-only">More actions</span></>} items={menu} align="left" />
      </div>

      <Segmented
        label="Party views"
        items={[
          { href: base, label: "Unpaid bills", active: tab === "bills", count: open.length },
          { href: `${base}?tab=statement`, label: "Statement", active: tab === "statement" },
          { href: `${base}?tab=details`, label: "Details", active: tab === "details" },
        ]}
      />

      {tab === "bills" && (
        <div className="overflow-hidden rounded-lg border border-rule bg-surface">
          {open.length === 0 ? (
            <Empty title="Nothing outstanding" />
          ) : (
            <>
              <Table>
                <thead><tr><th className={th}>Bill</th><th className={`${th} hidden sm:table-cell`}>Due</th><th className={`${thR} hidden sm:table-cell`}>Bill total</th><th className={thR}>Still due</th><th className={th}><span className="sr-only">Status</span></th></tr></thead>
                <tbody>
                  {open.map((o) =>
                    o.invoice_id ? (
                      <ClickRow key={`${o.kind}-${o.invoice_id}`} href={`/invoices/${o.invoice_id}${o.kind.startsWith("purchase") ? "?tab=purchases" : ""}`}>
                        <td className={td}><div className="font-medium">{o.number}</div><div className="text-xs text-muted">{fmtDate(o.date)}</div></td>
                        <td className={`${td} hidden sm:table-cell`}>{fmtDate(o.due_date)}</td>
                        <td className={`${tdR} hidden sm:table-cell`}><Money v={o.total} /></td>
                        <td className={`${tdR} font-semibold`}><Money v={o.outstanding} /></td>
                        <td className={td}>{o.days_overdue > 0 ? <Badge tone="due">{o.days_overdue} days late</Badge> : <Badge>Not due</Badge>}</td>
                      </ClickRow>
                    ) : (
                      <tr key={`${o.kind}-open`}>
                        <td className={td}><div className="font-medium">Opening balance</div></td>
                        <td className={`${td} hidden sm:table-cell`}>—</td>
                        <td className={`${tdR} hidden sm:table-cell`}><Money v={o.total} /></td>
                        <td className={`${tdR} font-semibold`}><Money v={o.outstanding} /></td>
                        <td className={td} />
                      </tr>
                    ),
                  )}
                </tbody>
              </Table>
              <p className="border-t border-rule bg-paper/50 px-3 py-2 text-xs text-muted">Payments settle the oldest bills first.</p>
            </>
          )}
        </div>
      )}

      {tab === "statement" && ledger && (
        <>
          <ListToolbar base={base} keep={{ tab: "statement" }} period={period} q="" showPeriod />
          <div className="overflow-hidden rounded-lg border border-rule bg-surface">
            <Table>
              <thead><tr><th className={th}>Date</th><th className={th}>Entry</th><th className={thR}>They owe +</th><th className={thR}>Paid / returned −</th><th className={thR}>Balance</th></tr></thead>
              <tbody>
                <tr className="bg-paper/50"><td className={td} colSpan={4}>Opening balance on {fmtDate(period.from)}</td><td className={tdR}><Balance v={ledger.opening} /></td></tr>
                {ledger.entries.map((e, i) =>
                  e.link ? (
                    <ClickRow key={i} href={e.link}>
                      <td className={`${td} whitespace-nowrap`}>{fmtDate(e.date)}</td>
                      <td className={td}>{e.kind} {e.ref.startsWith("#") ? "" : <span className="text-muted">{e.ref}</span>}{e.description && <div className="text-xs capitalize text-muted">{e.description}</div>}</td>
                      <td className={tdR}>{D(e.debit).isZero() ? "" : <Money v={e.debit} />}</td>
                      <td className={tdR}>{D(e.credit).isZero() ? "" : <Money v={e.credit} tone="in" />}</td>
                      <td className={tdR}><Balance v={e.balance} /></td>
                    </ClickRow>
                  ) : null,
                )}
                {ledger.entries.length === 0 && <tr><td className={`${td} text-muted`} colSpan={5}>No entries in this period</td></tr>}
              </tbody>
            </Table>
          </div>
          <a href={hrefWith(`/api/parties/${p.id}/statement`, { from: period.from, to: period.to })} target="_blank" rel="noopener" className={`${btn.secondary} mt-3`}>Download this statement (PDF)</a>
        </>
      )}

      {tab === "details" && (
        <div className="rounded-lg border border-rule bg-surface p-4">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Item k="Phone" v={p.phone} />
            <Item k="Email" v={p.email} />
            <Item k="GSTIN" v={p.gstin} />
            <Item k="State" v={`${GST_STATES[p.stateCode] ?? ""} (${p.stateCode})`} />
            <Item k="Address" v={[p.address, p.city].filter(Boolean).join(", ")} />
            <Item k="Credit" v={`${p.creditDays} days${p.creditLimit ? ` · limit ₹${D(p.creditLimit).toFixed(0)}` : ""}`} />
            <Item k="Opening balance" v={D(p.openingBalance).isZero() ? "None" : `₹${D(p.openingBalance).abs().toFixed(0)} ${D(p.openingBalance).gt(0) ? "they owed" : "you owed"}`} />
            {p.notes && <Item k="Notes" v={p.notes} />}
          </dl>
          <Link href={`/parties/${p.id}/edit`} className={`${btn.secondary} mt-4`}>Edit details</Link>
        </div>
      )}
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="whitespace-pre-wrap">{v || "—"}</dd>
    </div>
  );
}
