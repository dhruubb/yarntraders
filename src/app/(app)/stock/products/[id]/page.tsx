import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices, productStock, products, stockMovements } from "@/db/schema";
import { requirePage } from "@/server/auth";
import { can } from "@/lib/permissions";
import { D, RATE_BASIS_LABEL, formatIndian, todayIST } from "@/lib/calc";
import { ProductForm } from "@/components/client/ProductForm";
import { StockAdjustForm } from "@/components/client/StockAdjustForm";
import { ClickRow } from "@/components/client/ClickRow";
import { Badge, Money, Qty, Segmented, Stat, Table, btn, fmtDate, td, tdR, th, thR } from "@/components/ui";

const MOVE: Record<string, string> = { opening: "Opening stock", purchase: "Purchase", sale: "Sale", sale_return: "Sale return", purchase_return: "Purchase return", adjustment: "Count correction", reversal: "Cancelled bill" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; saved?: string }> }) {
  const s = await requirePage();
  const { id } = await params;
  const sp = await searchParams;
  const [p] = await db.select().from(products).where(and(eq(products.id, Number(id)), eq(products.businessId, s.ctx.businessId)));
  if (!p) notFound();
  const [st] = await db.select().from(productStock).where(eq(productStock.productId, p.id));
  const moves = await db
    .select({ m: stockMovements, number: invoices.number })
    .from(stockMovements)
    .leftJoin(invoices, eq(invoices.id, stockMovements.invoiceId))
    .where(eq(stockMovements.productId, p.id))
    .orderBy(desc(stockMovements.id))
    .limit(200);
  const showCost = can(s.ctx.role, "view_cost_profit");
  const canAdjust = can(s.ctx.role, "adjust_stock");
  const canEdit = can(s.ctx.role, "manage_products");
  const tabs = ["history", ...(canAdjust ? ["adjust"] : []), ...(canEdit ? ["details"] : [])];
  const tab = tabs.includes(sp.tab ?? "") ? sp.tab! : moves.length === 0 && canAdjust ? "adjust" : "history";
  const kg = D(st?.kg ?? 0);
  const base = `/stock/products/${p.id}`;
  const low = D(p.lowStockBags).gt(0) && D(st?.bags ?? 0).lt(p.lowStockBags);
  return (
    <div className="space-y-4">
      {sp.saved && <div role="status" className="rounded-md border border-leaf/30 bg-leaf-tint px-4 py-3 text-sm text-leaf"><b>Stock updated.</b> The entry is at the top of the history.</div>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/stock" className="text-sm text-muted hover:text-text">← Stock</Link>
          <h1 className="mt-1 flex items-center gap-2 text-[22px] font-semibold tracking-tight">{p.name} {!p.active && <Badge>Inactive</Badge>} {low && <Badge tone="warn">Running low</Badge>}</h1>
          <p className="text-sm text-muted">{D(p.bagWeightKg).toString()} kg bag · rate {RATE_BASIS_LABEL[p.rateBasis]} · HSN {p.hsn} · GST {D(p.gstRate).toString()}%</p>
        </div>
        <div className="flex gap-2">
          <Link href="/purchases/new" className={btn.secondary}>Buy</Link>
          <Link href="/sales/new" className={btn.primary}>Sell</Link>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="In stock" value={<Qty v={st?.bags ?? 0} unit="bags" />} note={<Qty v={kg} unit="kg" />} />
        {showCost && <Stat label="Average cost" value={kg.gt(0) ? `₹${formatIndian(D(st!.value).div(kg))}/kg` : "—"} note="before GST" />}
        {showCost && <Stat label="Stock value" value={<Money v={st?.value ?? 0} />} />}
      </div>
      <Segmented label="Yarn views" items={[
        { href: `${base}?tab=history`, label: "History", active: tab === "history" },
        ...(canAdjust ? [{ href: `${base}?tab=adjust`, label: "Opening stock / correction", active: tab === "adjust" }] : []),
        ...(canEdit ? [{ href: `${base}?tab=details`, label: "Edit yarn", active: tab === "details" }] : []),
      ]} />
      {tab === "history" && (
        <div className="overflow-hidden rounded-lg border border-rule bg-surface">
          <Table>
            <thead><tr><th className={th}>Date</th><th className={th}>Entry</th><th className={thR}>Bags</th><th className={`${thR} hidden sm:table-cell`}>Kg</th>{showCost && <th className={`${thR} hidden md:table-cell`}>Cost /kg</th>}</tr></thead>
            <tbody>
              {moves.map(({ m, number }) => {
                const cells = (
                  <>
                    <td className={`${td} whitespace-nowrap`}>{fmtDate(m.date)}</td>
                    <td className={td}>{MOVE[m.type]} {number && <span className="text-muted">{number}</span>}{m.lotNo && <span className="text-xs text-muted"> · lot {m.lotNo}</span>}{m.note && <div className="text-xs text-muted">{m.note}</div>}</td>
                    <td className={`${tdR} font-medium ${D(m.bags).isNeg() ? "text-madder" : "text-leaf"}`}>{D(m.bags).gt(0) ? "+" : ""}<Qty v={m.bags} /></td>
                    <td className={`${tdR} hidden sm:table-cell`}><Qty v={m.kg} /></td>
                    {showCost && <td className={`${tdR} hidden md:table-cell`}>₹{formatIndian(m.unitCostPerKg)}</td>}
                  </>
                );
                return m.invoiceId ? <ClickRow key={m.id} href={`/invoices/${m.invoiceId}`}>{cells}</ClickRow> : <tr key={m.id}>{cells}</tr>;
              })}
              {moves.length === 0 && <tr><td colSpan={5} className={`${td} py-8 text-center text-muted`}>No stock movements yet</td></tr>}
            </tbody>
          </Table>
        </div>
      )}
      {tab === "adjust" && canAdjust && (
        <div className="max-w-2xl rounded-lg border border-rule bg-surface p-4">
          <StockAdjustForm productId={p.id} today={todayIST()} hasStock={moves.length > 0} />
        </div>
      )}
      {tab === "details" && canEdit && (
        <ProductForm id={p.id} initial={{ count: p.count, brand: p.brand, quality: p.quality, hsn: p.hsn, gstRate: D(p.gstRate).toString(), bagWeightKg: D(p.bagWeightKg).toString(), rateBasis: p.rateBasis, conesPerBag: p.conesPerBag ? String(p.conesPerBag) : "", lowStockBags: D(p.lowStockBags).toString(), active: p.active }} />
      )}
    </div>
  );
}
