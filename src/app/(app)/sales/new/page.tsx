import { InvoiceEntryPage } from "@/components/InvoiceEntryPage";
export const metadata = { title: "New sale" };
export default async function Page({ searchParams }: { searchParams: Promise<{ party?: string }> }) {
  const { party } = await searchParams;
  return <InvoiceEntryPage kind="sale" partyId={party ? Number(party) : undefined} />;
}
