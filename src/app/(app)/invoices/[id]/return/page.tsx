import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoiceLines, invoices, parties, products } from "@/db/schema";
import { requirePage } from "@/server/auth";
import { D, todayIST } from "@/lib/calc";
import { PageHeader, KIND_LABEL } from "@/components/ui";
import { ReturnForm, type ReturnLine } from "@/components/client/ReturnForm";

export const metadata = { title: "Make return" };

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("create_transactions");
  const { id } = await params;
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, Number(id)), eq(invoices.businessId, s.ctx.businessId)));
  if (!inv || !(inv.kind === "sale" || inv.kind === "purchase") || inv.status !== "posted") notFound();
  const kind = inv.kind === "sale" ? "sale_return" : "purchase_return";
  const [party] = await db.select().from(parties).where(eq(parties.id, inv.partyId));
  const rows = await db.select({ l: invoiceLines, name: products.name }).from(invoiceLines).innerJoin(products, eq(products.id, invoiceLines.productId)).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.lineNo));
  const returned = await db.execute<{ ref_line_id: number; bags: string }>(sql`
    SELECT l.ref_line_id, SUM(l.bags) AS bags FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
    WHERE i.ref_invoice_id = ${inv.id} AND i.status = 'posted' GROUP BY l.ref_line_id`);
  const retMap = new Map(returned.rows.map((r) => [r.ref_line_id, r.bags]));
  const lines: ReturnLine[] = rows.map(({ l, name }) => ({
    id: l.id, productId: l.productId, name, bags: l.bags, kg: l.kg, rate: l.rate, rateBasis: l.rateBasis, gstRate: l.gstRate,
    remainingBags: D(l.bags).sub(retMap.get(l.id) ?? 0).toString(),
  }));
  return (
    <>
      <PageHeader title={`${KIND_LABEL[kind]} against ${inv.number}`} sub={`${party.name} · returns use the original rate, weight per bag and GST`} />
      <ReturnForm invoiceId={inv.id} partyId={party.id} kind={kind} lines={lines} interstate={inv.isInterstate} today={todayIST()} minDate={inv.date} />
    </>
  );
}
