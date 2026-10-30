import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { parties, products } from "@/db/schema";
import { requirePage } from "@/server/auth";
import { checkLine, getBatch } from "@/server/importer";
import { ImportReview, type ReviewRow } from "@/components/client/ImportReview";
import { PageHeader } from "@/components/ui";
import type { RateBasis } from "@/lib/calc";

export default async function ImportReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("import_data");
  const { id } = await params;
  const data = await getBatch(s.ctx.businessId, Number(id));
  if (!data) notFound();
  const { batch, rows } = data;
  const [ps, prs] = await Promise.all([
    db.select({ id: parties.id, name: parties.name, stateCode: parties.stateCode, type: parties.type }).from(parties).where(eq(parties.businessId, s.ctx.businessId)),
    db.select({ id: products.id, name: products.name, bagWeightKg: products.bagWeightKg, rateBasis: products.rateBasis, gstRate: products.gstRate }).from(products).where(eq(products.businessId, s.ctx.businessId)),
  ]);
  const pMap = new Map(ps.map((p) => [p.id, p]));
  const prMap = new Map(prs.map((p) => [p.id, p]));
  const txn = batch.kind === "sale" || batch.kind === "purchase";
  const review: ReviewRow[] = rows.map((r) => {
    const party = pMap.get(Number(r.data.party_id));
    const prod = prMap.get(Number(r.data.product_id));
    return {
      id: r.id, rowNo: r.rowNo, status: r.status, error: r.error, resultId: r.resultId, data: r.data,
      check: txn ? checkLine(r.data, prod ? { bagWeightKg: prod.bagWeightKg, rateBasis: prod.rateBasis as RateBasis, gstRate: prod.gstRate } : undefined, party ? party.stateCode !== s.business.stateCode : false) : undefined,
    };
  });
  const partyChoices = ps.filter((p) => (batch.kind === "sale" ? p.type !== "supplier" : batch.kind === "purchase" ? p.type !== "customer" : true)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <PageHeader title={`Review import #${batch.id}`} sub={`${batch.source === "ocr" ? "Register photo" : batch.fileName} · ${rows.length} rows · edit any cell, skip wrong rows, then post`} />
      <ImportReview batchId={batch.id} kind={batch.kind} isOcr={batch.source === "ocr"} rows={review} parties={partyChoices} products={prs.sort((a, b) => a.name.localeCompare(b.name))} />
    </>
  );
}
