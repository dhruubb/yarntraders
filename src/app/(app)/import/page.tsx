import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requirePage } from "@/server/auth";
import { TEMPLATES, type ImportKind } from "@/server/importer";
import { todayIST } from "@/lib/calc";
import { ImportUpload } from "@/components/client/ImportUpload";
import { Badge, PageHeader, Panel, Table, fmtDateTime, td, th } from "@/components/ui";

export const metadata = { title: "Import" };

const LABEL: Record<ImportKind, string> = { sale: "Sales", purchase: "Purchases", parties: "Parties", products: "Products", opening_stock: "Opening stock" };

export default async function ImportPage() {
  const s = await requirePage("import_data");
  const batches = (
    await db.execute<{ id: number; kind: ImportKind; source: string; file_name: string; status: string; created_at: string; total: number; posted: number; errors: number }>(sql`
      SELECT b.id, b.kind, b.source, b.file_name, b.status, b.created_at,
        COUNT(r.id)::int AS total, COUNT(r.id) FILTER (WHERE r.status = 'posted')::int AS posted, COUNT(r.id) FILTER (WHERE r.status = 'error')::int AS errors
      FROM import_batches b LEFT JOIN import_rows r ON r.batch_id = b.id
      WHERE b.business_id = ${s.ctx.businessId} GROUP BY b.id ORDER BY b.id DESC LIMIT 30`)
  ).rows;
  return (
    <>
      <PageHeader title="Import" sub="Bring in parties, products, opening stock and old bills. Nothing is posted until you review it." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Upload"><ImportUpload ocrReady={Boolean(process.env.ANTHROPIC_API_KEY)} today={todayIST()} /></Panel>
        <Panel title="Templates">
          <p className="mb-2 text-sm text-muted">Suggested order when starting: products → parties (with opening balances) → opening stock → old bills (optional).</p>
          <ul className="space-y-2 text-sm">
            {(Object.keys(TEMPLATES) as ImportKind[]).map((k) => (
              <li key={k}>
                <a className="font-medium text-ink hover:underline" href={`/api/import/template/${k}`}>{LABEL[k]} template (CSV)</a>
                <p className="text-xs text-muted">{TEMPLATES[k].help}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      {batches.length > 0 && (
        <Panel title="Recent imports" pad={false} className="mt-4">
          <Table>
            <thead><tr><th className={th}>#</th><th className={th}>What</th><th className={th}>From</th><th className={th}>When</th><th className={th}>Rows</th><th className={th}>Status</th></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className={td}><Link className="font-medium text-ink hover:underline" href={`/import/${b.id}`}>#{b.id}</Link></td>
                  <td className={td}>{LABEL[b.kind]}</td>
                  <td className={td}>{b.source === "ocr" ? "Photo" : b.file_name}</td>
                  <td className={td}>{fmtDateTime(b.created_at)}</td>
                  <td className={td}>{b.posted}/{b.total} posted{b.errors ? `, ${b.errors} with errors` : ""}</td>
                  <td className={td}>{b.status === "done" ? <Badge tone="ok">Done</Badge> : <Badge tone="warn">Needs review</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
