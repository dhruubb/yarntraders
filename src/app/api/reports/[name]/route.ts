import { getSession } from "@/server/auth";
import { runReport } from "@/server/reports";
import { reportToCsv, reportToPdf, reportToXlsx } from "@/server/export";
import { can } from "@/lib/permissions";
import { todayIST, addDays } from "@/lib/calc";

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const s = await getSession();
  if (!s) return new Response("Sign in first", { status: 401 });
  if (!can(s.ctx.role, "export_reports")) return new Response("Only the owner can export reports", { status: 403 });
  const { name } = await params;
  const url = new URL(req.url);
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const to = re.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : todayIST();
  const from = re.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : addDays(to, -30);
  const format = url.searchParams.get("format") ?? "csv";
  const r = await runReport(name, s.ctx.businessId, s.ctx.role, from, to);
  if (!r) return new Response("Report not found", { status: 404 });
  const base = `${r.title.replace(/[^\w]+/g, "-")}-${from}-to-${to}`;
  const headers = (type: string, ext: string) => ({ "content-type": type, "content-disposition": `attachment; filename="${base}.${ext}"`, "cache-control": "private, no-store" });
  if (format === "xlsx") return new Response(new Uint8Array(await reportToXlsx(r, s.business.name)), { headers: headers("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx") });
  if (format === "pdf") return new Response(new Uint8Array(await reportToPdf(r, s.business.name)), { headers: headers("application/pdf", "pdf") });
  return new Response(reportToCsv(r), { headers: headers("text/csv; charset=utf-8", "csv") });
}
