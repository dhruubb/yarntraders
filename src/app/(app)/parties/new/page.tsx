import { requirePage } from "@/server/auth";
import { GST_STATES } from "@/server/masters";
import { PartyForm } from "@/components/client/PartyForm";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Add party" };

export default async function Page({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const s = await requirePage("manage_parties");
  const sp = await searchParams;
  const type = sp.type === "supplier" ? "supplier" : sp.type === "both" ? "both" : "customer";
  return (
    <>
      <PageHeader title="Add party" />
      <PartyForm
        states={GST_STATES}
        canEditOpening={s.ctx.role === "owner"}
        initial={{ name: "", type, phone: "", email: "", gstin: "", stateCode: s.business.stateCode, address: "", city: "", creditDays: 30, creditLimit: "", openingBalance: "", openingSide: "receivable", notes: "", active: true }}
      />
    </>
  );
}
