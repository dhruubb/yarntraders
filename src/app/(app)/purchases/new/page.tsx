import { InvoiceEntryPage } from "@/components/InvoiceEntryPage";
export const metadata = { title: "New purchase" };
export default async function Page({ searchParams }: { searchParams: Promise<{ party?: string }> }) {
  const { party } = await searchParams;
  return <InvoiceEntryPage kind="purchase" partyId={party ? Number(party) : undefined} />;
}
