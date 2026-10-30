import Link from "next/link";
import { requirePage } from "@/server/auth";
import { partyOptions, productOptions } from "@/server/formdata";
import { InvoiceForm } from "@/components/client/InvoiceForm";
import { PageHeader, Empty, btn } from "@/components/ui";
import { todayIST } from "@/lib/calc";

export async function InvoiceEntryPage({ kind, partyId }: { kind: "sale" | "purchase"; partyId?: number }) {
  const s = await requirePage("create_transactions");
  const [parties, products] = await Promise.all([
    partyOptions(s.ctx.businessId, kind === "sale" ? "customer" : "supplier"),
    productOptions(s.ctx.businessId, kind),
  ]);
  const title = kind === "sale" ? "New sale" : "New purchase";
  if (products.length === 0 || parties.length === 0)
    return (
      <>
        <PageHeader title={title} />
        <div className="rounded-lg border border-rule bg-surface">
          <Empty
            title={products.length === 0 ? "Add your yarn products first" : `Add a ${kind === "sale" ? "customer" : "supplier"} first`}
            action={<Link className={btn.primary} href={products.length === 0 ? "/stock/products/new" : "/parties/new"}>{products.length === 0 ? "Add product" : "Add party"}</Link>}
          >
            {products.length === 0 ? "Each product stores its bag weight and how its rate is quoted (per 5 kg, per kg…), so bills calculate like your register." : "Bills are entered against a party."}
          </Empty>
        </div>
      </>
    );
  return (
    <>
      <PageHeader
        title={title}
        sub={kind === "sale" ? "Rates are taken before GST. GST is added on the bill." : "Enter the supplier's rate before GST; GST is added to match their bill."}
        actions={<Link href="/parties/new" className={btn.secondary}>Add party</Link>}
      />
      <InvoiceForm kind={kind} parties={parties} products={products} businessStateCode={s.business.stateCode} today={todayIST()} initialPartyId={partyId} />
    </>
  );
}
