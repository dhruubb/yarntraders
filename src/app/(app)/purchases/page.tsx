import { TradeTab } from "@/components/TradeTab";
export const metadata = { title: "Purchases" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  return <TradeTab side="purchase" sp={await searchParams} />;
}
