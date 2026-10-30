import Link from "next/link";
import { Phone, Plus } from "lucide-react";
import { requirePage } from "@/server/auth";
import { partyList } from "@/server/queries";
import { D } from "@/lib/calc";
import { ClickRow } from "@/components/client/ClickRow";
import { Badge, Balance, Chips, Empty, ListToolbar, Money, Table, btn, hrefWith, td, tdR, th, thR } from "@/components/ui";

export const metadata = { title: "Parties" };

const SHOW = [
  { key: "all", label: "All" },
  { key: "customers", label: "Customers" },
  { key: "suppliers", label: "Suppliers" },
  { key: "owe-you", label: "Owe you" },
  { key: "you-owe", label: "You owe" },
] as const;

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requirePage();
  const sp = await searchParams;
  // Old links (?type= / ?balance=) still work
  const show = SHOW.some((x) => x.key === sp.show) ? sp.show : sp.balance === "receivable" ? "owe-you" : sp.balance === "payable" ? "you-owe" : sp.type === "customer" ? "customers" : sp.type === "supplier" ? "suppliers" : "all";
  const q = sp.q?.trim() ?? "";
  const all = await partyList(s.ctx.businessId, { search: q });
  const rows = all.filter((r) => {
    const b = D(r.balance);
    if (show === "customers") return r.type !== "supplier";
    if (show === "suppliers") return r.type !== "customer";
    if (show === "owe-you") return b.gt(0);
    if (show === "you-owe") return b.lt(0);
    return true;
  });
  const recv = all.filter((r) => D(r.balance).gt(0)).reduce((a, r) => a.add(r.balance), D(0));
  const pay = all.filter((r) => D(r.balance).lt(0)).reduce((a, r) => a.add(r.balance), D(0)).abs();
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Parties</h1>
          <p className="mt-0.5 text-sm text-muted">They owe you <Money v={recv} tone="due" /> · you owe <Money v={pay} /></p>
        </div>
        <Link href="/parties/new" className={btn.primary}><Plus size={16} aria-hidden /> Add party</Link>
      </div>
      <ListToolbar base="/parties" keep={{ show: show === "all" ? undefined : show }} q={q} placeholder="Name, phone, city or GSTIN" showPeriod={false} />
      <div className="mb-3">
        <Chips label="Show" items={SHOW.map((x) => ({ label: x.label, active: x.key === show, href: hrefWith("/parties", { show: x.key === "all" ? undefined : x.key, q }) }))} />
      </div>
      <div className="overflow-hidden rounded-lg border border-rule bg-surface">
        {rows.length === 0 ? (
          <Empty title={q ? `No party matches “${q}”` : "No parties here"} action={<Link href="/parties/new" className={btn.primary}>Add party</Link>} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Name</th>
                <th className={`${th} hidden sm:table-cell`}>Phone</th>
                <th className={thR}>Balance</th>
                <th className={th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const b = D(r.balance);
                return (
                  <ClickRow key={r.id} href={`/parties/${r.id}`} className={r.active ? "" : "text-muted"}>
                    <td className={td}>
                      <div className="font-medium">{r.name} {!r.active && <Badge>Inactive</Badge>}</div>
                      <div className="text-xs text-muted">{[r.type === "both" ? "Customer & supplier" : r.type === "customer" ? "Customer" : "Supplier", r.city].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className={`${td} hidden sm:table-cell`}>{r.phone && <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 hover:underline"><Phone size={13} aria-hidden />{r.phone}</a>}</td>
                    <td className={tdR}><Balance v={r.balance} /></td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      {b.gt(0) && <Link href={`/payments/new?direction=in&party=${r.id}&amount=${b.toFixed(0)}`} className={`${btn.secondary} px-2.5 py-1 text-xs`}>Receive</Link>}
                      {b.lt(0) && <Link href={`/payments/new?direction=out&party=${r.id}&amount=${b.abs().toFixed(0)}`} className={`${btn.secondary} px-2.5 py-1 text-xs`}>Pay</Link>}
                    </td>
                  </ClickRow>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}
