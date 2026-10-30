import { requirePage } from "@/server/auth";
import { ProductForm } from "@/components/client/ProductForm";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Add product" };

export default async function Page() {
  await requirePage("manage_products");
  return (
    <>
      <PageHeader title="Add product" sub="One product per count + brand, e.g. 30 Amrut, 47 VPN, 58 Silver." />
      <ProductForm initial={{ count: "", brand: "", quality: "", hsn: "5205", gstRate: "5", bagWeightKg: "50", rateBasis: "per_5kg", conesPerBag: "", lowStockBags: "", active: true }} />
    </>
  );
}
