import { getSession } from "@/server/auth";
import { statementPdf } from "@/server/pdfs";
import { todayIST } from "@/lib/calc";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return new Response("Sign in first", { status: 401 });
  const { id } = await params;
  const url = new URL(req.url);
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const to = re.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : todayIST();
  const from = re.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : `${to.slice(0, 4)}-04-01`;
  const pdf = await statementPdf(s.ctx.businessId, Number(id), from, to);
  if (!pdf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(pdf.buffer), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${pdf.filename}"`, "cache-control": "private, no-store" } });
}
