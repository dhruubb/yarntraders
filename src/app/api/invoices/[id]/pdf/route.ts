import { getSession } from "@/server/auth";
import { invoicePdf } from "@/server/pdfs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return new Response("Sign in first", { status: 401 });
  const { id } = await params;
  const pdf = await invoicePdf(s.ctx.businessId, Number(id));
  if (!pdf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(pdf.buffer), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${pdf.filename}"`, "cache-control": "private, no-store" } });
}
