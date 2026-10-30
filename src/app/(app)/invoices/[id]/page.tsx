import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { FileDown, Undo2, Wallet } from "lucide-react";
import { db } from "@/db";
import { invoiceLines, invoices, parties, products, users } from "@/db/schema";
import { requirePage } from "@/server/auth";
import { invoicePaymentStatus } from "@/server/queries";
import { can } from "@/lib/permissions";
import { D, RATE_BASIS_LABEL, formatIndian } from "@/lib/calc";
import { cancelInvoiceAction } from "@/app/actions";
import { CancelButton } from "@/components/client/CancelButton";
import { Badge, Money, Panel, Qty, Table, btn, fmtDate, fmtDateTime, td, tdR, th, thR, KIND_LABEL } from "@/components/ui";
import { GST_STATES } from "@/server/masters";

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ posted?: string; w?: string }> }) {
  const s = await requirePage();
  const { id } = await params;
  const sp = await searchParams;
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, Number(id)), eq(invoices.businessId, s.ctx.businessId)));
  if (!inv) notFound();
  const [party] = await db.select().from(parties).where(eq(parties.id, inv.partyId));
  const lines = await db
    .select({ l: invoiceLines, name: products.name, hsn: products.hsn })
    .from(invoiceLines)
    .innerJoin(products, eq(products.id, invoiceLines.productId))
    .where(eq(invoiceLines.invoiceId, inv.id))
    .orderBy(asc(invoiceLines.lineNo));
  const [creator] = await db.select({ name: users.name }).from(users).where(eq(users.id, inv.createdBy));
  const canceller = inv.cancelledBy ? (await db.select({ name: users.name }).from(users).where(eq(users.id, inv.cancelledBy)))[0] : null;
  const related = await db
    .select({ id: invoices.id, number: invoices.number, kind: invoices.kind, total: invoices.total, date: invoices.date, status: invoices.status })
    .from(invoices)
    .where(sql`${invoices.refInvoiceId} = ${inv.id} OR ${invoices.id} = ${inv.refInvoiceId ?? 0}`);
  const pay = await invoicePaymentStatus(s.ctx.businessId, inv);
  const showCost = can(s.ctx.role, "view_cost_profit");
  const margin = inv.kind === "sale" ? D(inv.taxable).sub(inv.cogs) : null;
  const isMain = inv.kind === "sale" || inv.kind === "purchase";
  const posted = inv.status === "posted";
  const isSaleSide = inv.kind === "sale" || inv.kind === "sale_return";

  return (
    <div className="space-y-4">
      {sp.posted && posted && (
        <div role="status" className="rounded-md border border-leaf/30 bg-leaf-tint px-4 py-3 text-sm text-leaf">
          <b>{KIND_LABEL[inv.kind]} {inv.number} posted.</b> Stock and {party.name}&rsquo;s account are updated.{" "}
          <Link className="font-semibold underline" href={inv.kind === "sale" ? "/sales/new" : inv.kind === "purchase" ? "/purchases/new" : "/"}>
            {isMain ? `Enter next ${inv.kind}` : "Back to Home"}
          </Link>
          {sp.w && sp.w.split(" | ").map((w) => <p key={w} className="mt-1 font-medium text-turmeric">⚠ {w}</p>)}
        </div>
      )}
      {!posted && (
        <div role="status" className="rounded-md border border-madder/30 bg-madder-tint px-4 py-3 text-sm text-madder">
          <b>Cancelled</b> {inv.cancelledAt && fmtDateTime(inv.cancelledAt)} by {canceller?.name ?? "—"}. Reason: {inv.cancelReason}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={isSaleSide ? "/sales" + (isMain ? "" : "?view=returns") : "/purchases" + (isMain ? "" : "?view=returns")} className="text-sm text-muted hover:text-text">
            ← {isSaleSide ? "Sales" : "Purchases"}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight">{party.name}</h1>
            {pay && <Badge tone={pay.status === "paid" ? "ok" : pay.daysOverdue > 0 ? "due" : pay.status === "part-paid" ? "warn" : "neutral"}>{pay.status === "paid" ? "Paid" : pay.daysOverdue > 0 ? `${pay.daysOverdue} days overdue` : pay.status === "part-paid" ? "Part paid" : "Unpaid"}</Badge>}
            {!posted && <Badge tone="due">Cancelled</Badge>}
            {inv.source !== "manual" && <Badge tone="ink">Imported</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {KIND_LABEL[inv.kind]} {inv.number} · {fmtDate(inv.date)}
            {inv.dueDate && <> · due {fmtDate(inv.dueDate)}</>}
            {inv.supplierBillNo && <> · supplier bill {inv.supplierBillNo}</>}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">{pay && pay.status !== "paid" ? "Still due" : "Bill total"}</div>
          <div className="text-2xl font-semibold"><Money v={pay && pay.status !== "paid" ? pay.outstanding : inv.total} tone={pay && pay.status !== "paid" && isSaleSide ? "due" : undefined} /></div>
          {pay && pay.status !== "paid" && <div className="text-xs text-muted">of <Money v={inv.total} /></div>}
        </div>
      </div>

      <div className="no-print flex flex-wrap gap-2">
        {posted && isMain && pay && pay.status !== "paid" && (
          <Link href={`/payments/new?direction=${inv.kind === "sale" ? "in" : "out"}&party=${party.id}&amount=${D(pay.outstanding).toFixed(0)}`} className={btn.primary}>
            <Wallet size={16} /> {inv.kind === "sale" ? "Receive payment" : "Pay supplier"}
          </Link>
        )}
        <a href={`/api/invoices/${inv.id}/pdf`} className={btn.secondary} target="_blank" rel="noopener">
          <FileDown size={16} /> {inv.kind === "sale" ? "Invoice PDF" : "PDF"}
        </a>
        {posted && isMain && (
          <Link href={`/invoices/${inv.id}/return`} className={btn.secondary}>
            <Undo2 size={16} /> Make return
          </Link>
        )}
        {posted && isMain && (
          <Link href={inv.kind === "sale" ? `/sales/new?party=${party.id}` : `/purchases/new?party=${party.id}`} className={btn.ghost}>
            New {inv.kind === "sale" ? "sale" : "purchase"} for {party.name}
          </Link>
        )}
      </div>

      <Panel pad={false}>
        <Table>
          <thead>
            <tr>
              <th className={`${th} hidden md:table-cell`}>#</th>
              <th className={th}>Yarn</th>
              <th className={`${th} hidden md:table-cell`}>Lot</th>
              <th className={thR}>Bags</th>
              <th className={thR}>Weight</th>
              <th className={thR}>Rate</th>
              <th className={`${thR} hidden md:table-cell`}>Amount</th>
              <th className={thR}>Taxable</th>
              <th className={`${thR} hidden sm:table-cell`}>GST</th>
              {showCost && inv.kind === "sale" && <th className={`${thR} hidden lg:table-cell`}>Cost</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map(({ l, name, hsn }) => (
              <tr key={l.id}>
                <td className={`${td} hidden text-muted md:table-cell`}>{l.lineNo}</td>
                <td className={td}>
                  {name} <span className="text-xs text-muted">HSN {hsn}</span>
                </td>
                <td className={`${td} hidden md:table-cell`}>{l.lotNo || "—"}</td>
                <td className={tdR}><Qty v={l.bags} /></td>
                <td className={tdR}><Qty v={l.kg} unit="kg" /></td>
                <td className={tdR}>₹{formatIndian(l.rate)} <span className="text-xs text-muted">{RATE_BASIS_LABEL[l.rateBasis]}</span></td>
                <td className={`${tdR} hidden md:table-cell`}><Money v={l.amount} decimals={2} /></td>
                <td className={tdR}><Money v={l.taxable} decimals={2} /></td>
                <td className={`${tdR} hidden sm:table-cell`}>
                  <Money v={D(l.cgst).add(l.sgst).add(l.igst)} decimals={2} /> <span className="text-xs text-muted">{D(l.gstRate).toString()}%</span>
                </td>
                {showCost && inv.kind === "sale" && <td className={`${tdR} hidden lg:table-cell`}><Money v={l.cogs} /> <div className="text-xs text-muted">₹{formatIndian(l.costPerKg)}/kg</div></td>}
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="grid gap-4 border-t border-rule p-4 md:grid-cols-2">
          <div className="space-y-1 text-sm text-muted">
            <p>{inv.isInterstate ? `Interstate supply (${GST_STATES[party.stateCode]}) — IGST` : "Within state — CGST + SGST"}</p>
            {inv.agent && <p>Agent: {inv.agent}</p>}
            {inv.notes && <p>Notes: {inv.notes}</p>}
            <p>Entered by {creator?.name} on {fmtDateTime(inv.createdAt)}</p>
            {showCost && margin && (
              <p className="pt-2 text-text">
                Gross profit on this bill: <Money v={margin} tone="auto" className="font-semibold" />{" "}
                ({D(inv.taxable).isZero() ? 0 : margin.div(inv.taxable).mul(100).toFixed(1)}%)
              </p>
            )}
          </div>
          <dl className="num ml-auto w-full max-w-xs space-y-1 text-sm">
            <Line k="Lines" v={inv.linesAmount} />
            {!D(inv.freight).isZero() && <Line k="Freight" v={inv.freight} />}
            {!D(inv.discount).isZero() && <Line k="Discount" v={D(inv.discount).neg().toString()} />}
            <Line k="Taxable value" v={inv.taxable} />
            {inv.isInterstate ? <Line k="IGST" v={inv.igst} /> : <><Line k="CGST" v={inv.cgst} /><Line k="SGST" v={inv.sgst} /></>}
            {!D(inv.roundOff).isZero() && <Line k="Round off" v={inv.roundOff} />}
            <div className="flex justify-between border-t border-rule pt-2 text-lg font-semibold"><dt>Total</dt><dd><Money v={inv.total} /></dd></div>
            {pay && pay.status !== "paid" && <div className="flex justify-between text-madder"><dt>Outstanding</dt><dd><Money v={pay.outstanding} /></dd></div>}
          </dl>
        </div>
      </Panel>

      {related.length > 0 && (
        <Panel title={inv.refInvoiceId ? "Original bill" : "Returns against this bill"}>
          <ul className="space-y-1 text-sm">
            {related.map((r) => (
              <li key={r.id} className={r.status === "cancelled" ? "text-muted line-through" : ""}>
                <Link href={`/invoices/${r.id}`} className="font-medium text-ink hover:underline">{KIND_LABEL[r.kind]} {r.number}</Link> · {fmtDate(r.date)} · <Money v={r.total} />
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {posted && can(s.ctx.role, "cancel_posted") && (
        <div className="no-print flex items-center justify-between gap-3 border-t border-rule pt-4 text-sm text-muted">
          <span>Made a mistake? Cancel this bill and enter it again. It stays in history.</span>
          <CancelButton what="bill" action={cancelInvoiceAction.bind(null, inv.id)} />
        </div>
      )}
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{k}</dt>
      <dd>{D(v).isNeg() ? "−" : ""}₹{formatIndian(D(v).abs())}</dd>
    </div>
  );
}
