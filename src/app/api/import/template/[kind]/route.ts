import { getSession } from "@/server/auth";
import { TEMPLATES, templateCsv, type ImportKind } from "@/server/importer";

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  if (!(await getSession())) return new Response("Sign in first", { status: 401 });
  const { kind } = await params;
  if (!(kind in TEMPLATES)) return new Response("Not found", { status: 404 });
  return new Response(templateCsv(kind as ImportKind), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="template-${kind}.csv"` } });
}
