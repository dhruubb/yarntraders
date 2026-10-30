import { TradeTab } from "@/components/TradeTab";
export const metadata = { title: "Sales" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  return <TradeTab side="sale" sp={await searchParams} />;
}
