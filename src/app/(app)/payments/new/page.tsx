import { requirePage } from "@/server/auth";
import { accountOptions, partyOptions } from "@/server/formdata";
import { PaymentForm } from "@/components/client/PaymentForm";
import { PageHeader } from "@/components/ui";
import { todayIST } from "@/lib/calc";

export const metadata = { title: "Record payment" };

export default async function Page({ searchParams }: { searchParams: Promise<{ direction?: string; party?: string; amount?: string }> }) {
  const s = await requirePage("create_transactions");
  const sp = await searchParams;
  const [parties, accounts] = await Promise.all([partyOptions(s.ctx.businessId, "any"), accountOptions(s.ctx.businessId)]);
  return (
    <>
      <PageHeader title="Record payment" sub="Payments reduce the party's running balance. Older bills are settled first." />
      <PaymentForm parties={parties} accounts={accounts} today={todayIST()} initial={{ direction: sp.direction === "out" ? "out" : "in", partyId: sp.party ? Number(sp.party) : undefined, amount: sp.amount }} />
    </>
  );
}
