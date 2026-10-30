import { redirect } from "next/navigation";
export default async function Page({ searchParams }: { searchParams: Promise<{ dir?: string; cheques?: string }> }) {
  const sp = await searchParams;
  redirect(`/${sp.dir === "out" ? "purchases" : "sales"}?view=payments${sp.cheques ? "&status=cheques" : ""}`);
}
