import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePage } from "@/server/auth";
import { lotStock, stockSummary } from "@/server/queries";
import { can } from "@/lib/permissions";
import { D, RATE_BASIS_LABEL, formatIndian, formatQty, type RateBasis } from "@/lib/calc";
import { ClickRow } from "@/components/client/ClickRow";
import { Badge, Chips, Empty, ListToolbar, Money, Qty, Segmented, Table, btn, hrefWith, td, tdR, th, thR } from "@/components/ui";

export const metadata = { title: "Stock" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requirePage();
  const sp = await searchParams;
  const view = sp.view === "lots" ? "lots" : "yarns";
  const show = sp.show === "low" ? "low" : sp.show === "inactive" ? "inactive" : "all";
  const q = sp.q?.trim().toLowerCase() ?? "";
  const showCost = can(s.ctx.role, "view_cost_profit");
  const all = await stockSummary(s.ctx.businessId);
  const isLow = (r: (typeof all)[number]) => r.active && D(r.low_stock_bags).gt(0) && D(r.bags).lt(r.low_stock_bags);
  const rows = all.filter((r) => (show === "low" ? isLow(r) : show === "inactive" ? !r.active : r.active) && (!q || r.name.toLowerCase().includes(q)));
  const totals = all.filter((r) => r.active).reduce((a, r) => ({ bags: a.bags.add(r.bags), value: a.value.add(r.value) }), { bags: D(0), value: D(0) });
  const lowCount = all.filter(isLow).length;
  const lots = view === "lots" ? (await lotStock(s.ctx.businessId)).filter((l) => !q || l.name.toLowerCase().includes(q) || l.lot_no.toLowerCase().includes(q)) : [];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Stock</h1>
          <p className="mt-0.5 text-sm text-muted"><Qty v={totals.bags} unit="bags" /> in godown{showCost && <> · worth <Money v={totals.value} /> at cost</>}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/purchases/new" className={btn.secondary}>New purchase</Link>
          {can(s.ctx.role, "manage_products") && <Link href="/stock/products/new" className={btn.primary}><Plus size={16} aria-hidden /> Add yarn</Link>}
        </div>
      </div>
      <Segmented label="Stock views" items={[
        { href: "/stock", label: "By yarn", active: view === "yarns", count: undefined },
        { href: "/stock?view=lots", label: "By lot", active: view === "lots" },
      ]} />
      <ListToolbar base="/stock" keep={{ view: view === "lots" ? "lots" : undefined, show: show === "all" ? undefined : show }} q={sp.q ?? ""} placeholder={view === "lots" ? "Yarn or lot no." : "Yarn, e.g. 30 Amrut"} showPeriod={false} />
      {view === "yarns" && (
        <div className="mb-3">
          <Chips label="Show" items={[
            { label: "In use", active: show === "all", href: hrefWith("/stock", { q: sp.q }) },
            { label: `Running low${lowCount ? ` (${lowCount})` : ""}`, active: show === "low", href: hrefWith("/stock", { show: "low", q: sp.q }) },
            { label: "Inactive", active: show === "inactive", href: hrefWith("/stock", { show: "inactive", q: sp.q }) },
          ]} />
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-rule bg-surface">
        {view === "lots" ? (
          lots.length === 0 ? <Empty title="No stock" /> : (
            <Table>
              <thead><tr><th className={th}>Yarn</th><th className={th}>Lot</th><th className={thR}>Bags</th><th className={thR}>Kg</th></tr></thead>
              <tbody>{lots.map((l, i) => (
                <ClickRow key={i} href={`/stock/products/${l.product_id}`}>
                  <td className={`${td} font-medium`}>{l.name}</td><td className={td}>{l.lot_no || <span className="text-muted">No lot</span>}</td><td className={tdR}><Qty v={l.bags} /></td><td className={tdR}><Qty v={l.kg} /></td>
                </ClickRow>
              ))}</tbody>
            </Table>
          )
        ) : rows.length === 0 ? (
          <Empty
            title={all.length === 0 ? "No yarns yet" : show === "low" ? "Nothing is running low" : "No yarn matches"}
            action={all.length === 0 && can(s.ctx.role, "manage_products") ? <Link href="/stock/products/new" className={btn.primary}>Add yarn</Link> : undefined}
          >
            {all.length === 0 ? "Add each yarn with its bag weight and how its rate is quoted (per 5 kg, per kg…)." : undefined}
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Yarn</th>
                <th className={thR}>Bags</th>
                <th className={`${thR} hidden sm:table-cell`}>Kg</th>
                {showCost && <th className={`${thR} hidden md:table-cell`}>Value</th>}
                <th className={`${thR} hidden md:table-cell`}>Last sold at</th>
                <th className={th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <ClickRow key={r.id} href={`/stock/products/${r.id}`} className={r.active ? "" : "text-muted"}>
                  <td className={td}>
                    <div className="font-medium">{r.name} {isLow(r) && <Badge tone="warn">Low</Badge>}</div>
                    <div className="text-xs text-muted">{formatQty(r.bag_weight_kg)} kg bag · rate {RATE_BASIS_LABEL[r.rate_basis as RateBasis]}</div>
                  </td>
                  <td className={`${tdR} text-[15px] font-semibold`}><Qty v={r.bags} /></td>
                  <td className={`${tdR} hidden sm:table-cell`}><Qty v={r.kg} /></td>
                  {showCost && <td className={`${tdR} hidden md:table-cell`}><Money v={r.value} /><div className="text-xs text-muted">{D(r.kg).gt(0) ? `₹${formatIndian(r.avg_cost_per_kg)}/kg` : ""}</div></td>}
                  <td className={`${tdR} hidden md:table-cell`}>{r.last_sale_rate ? `₹${formatIndian(r.last_sale_rate)}` : "—"}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {isLow(r) ? <Link href="/purchases/new" className={`${btn.secondary} px-2.5 py-1 text-xs`}>Buy</Link> : D(r.bags).gt(0) && <Link href="/sales/new" className={`${btn.secondary} px-2.5 py-1 text-xs`}>Sell</Link>}
                  </td>
                </ClickRow>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
