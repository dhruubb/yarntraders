import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { parties } from "@/db/schema";
import { requirePage } from "@/server/auth";
import { GST_STATES } from "@/server/masters";
import { PartyForm } from "@/components/client/PartyForm";
import { PageHeader } from "@/components/ui";
import { D } from "@/lib/calc";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("manage_parties");
  const { id } = await params;
  const [p] = await db.select().from(parties).where(and(eq(parties.id, Number(id)), eq(parties.businessId, s.ctx.businessId)));
  if (!p) notFound();
  const ob = D(p.openingBalance);
  return (
    <>
      <PageHeader title={`Edit ${p.name}`} />
      <PartyForm
        id={p.id}
        states={GST_STATES}
        canEditOpening={s.ctx.role === "owner"}
        initial={{ name: p.name, type: p.type, phone: p.phone, email: p.email, gstin: p.gstin, stateCode: p.stateCode, address: p.address, city: p.city, creditDays: p.creditDays, creditLimit: p.creditLimit ? D(p.creditLimit).toString() : "", openingBalance: ob.isZero() ? "" : ob.abs().toString(), openingSide: ob.isNeg() ? "payable" : "receivable", notes: p.notes, active: p.active }}
      />
    </>
  );
}
