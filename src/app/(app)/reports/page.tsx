import Link from "next/link";
import { requirePage } from "@/server/auth";
import { REPORTS, runReport, type Col } from "@/server/reports";
import { can } from "@/lib/permissions";
import { D, formatIndian, formatQty, todayIST, financialYear } from "@/lib/calc";
import { Empty, Filters, Panel, Table, btn, fmtDate, td, tdR, th, thR } from "@/components/ui";

export const metadata = { title: "Reports" };

function Cell({ c, v }: { c: Col; v: unknown }) {
  if (v === null || v === undefined || v === "") return <>—</>;
  if (c.type === "money") return <span className={D(String(v)).isNeg() ? "text-madder" : ""}>₹{formatIndian(String(v), 0)}</span>;
  if (c.type === "qty") return <>{formatQty(String(v))}</>;
  if (c.type === "pct") return <>{String(v)}%</>;
  if (c.type === "date") return <span className="whitespace-nowrap">{fmtDate(String(v))}</span>;
  return <>{String(v)}</>;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const s = await requirePage("view_reports");
  const sp = await searchParams;
  const today = todayIST();
  const key = sp.r && REPORTS.some((r) => r.key === sp.r) ? sp.r : "daybook";
  const from = sp.from || (key === "pnl" || key === "gst_summary" ? `${financialYear(today).slice(0, 4)}-04-01` : `${today.slice(0, 7)}-01`);
  const to = sp.to || today;
  const meta = REPORTS.find((r) => r.key === key)!;
  const visible = REPORTS.filter((r) => !r.ownerOnly || can(s.ctx.role, "view_cost_profit"));
  const report = await runReport(key, s.ctx.businessId, s.ctx.role, from, to);
  const q = (format: string) => `/api/reports/${key}?from=${from}&to=${to}&format=${format}`;
  const right = (c: Col) => ["money", "qty", "pct"].includes(c.type);

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Reports" className="no-print">
        <ul className="space-y-0.5 rounded-lg border border-rule bg-surface p-1.5">
          {visible.map((r) => (
            <li key={r.key}>
              <Link href={`/reports?r=${r.key}&from=${from}&to=${to}`} aria-current={r.key === key ? "page" : undefined} className={`block rounded-md px-3 py-2 text-sm ${r.key === key ? "bg-ink-tint font-semibold text-ink" : "hover:bg-paper"}`}>
                {r.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold">{report?.title ?? meta.label}</h1>
            <p className="text-sm text-muted">{meta.description}{report?.subtitle && !meta.noDates ? ` · ${fmtDate(from)} – ${fmtDate(to)}` : ""}</p>
          </div>
          {can(s.ctx.role, "export_reports") && report && (
            <div className="no-print flex gap-2">
              <a className={btn.secondary} href={q("xlsx")}>Excel</a>
              <a className={btn.secondary} href={q("csv")}>CSV</a>
              <a className={btn.secondary} href={q("pdf")} target="_blank" rel="noopener">PDF</a>
            </div>
          )}
        </div>
        <div className="no-print">
          <Filters from={meta.noDates ? undefined : from} to={to}>
            <input type="hidden" name="r" value={key} />
          </Filters>
        </div>
        {!report ? (
          <Panel><Empty title="This report is for the owner only" /></Panel>
        ) : (
          <Panel pad={false}>
            {report.rows.length === 0 ? (
              <Empty title="No entries for this period" />
            ) : (
              <Table>
                <thead><tr>{report.columns.map((c) => <th key={c.key} className={right(c) ? thR : th}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {report.rows.map((row, i) => {
                    const strong = key === "pnl" && ["Net sales", "Gross profit", "Net profit"].includes(String(row.item));
                    return (
                      <tr key={i} className={strong ? "bg-paper/70 font-semibold" : ""}>
                        {report.columns.map((c) => <td key={c.key} className={right(c) ? tdR : td}><Cell c={c} v={row[c.key]} /></td>)}
                      </tr>
                    );
                  })}
                </tbody>
                {report.totals && (
                  <tfoot>
                    <tr className="font-semibold">
                      {report.columns.map((c, i) => <td key={c.key} className={right(c) ? tdR : td}>{i === 0 ? "Total" : report.totals![c.key] !== undefined ? <Cell c={c} v={report.totals![c.key]} /> : ""}</td>)}
                    </tr>
                  </tfoot>
                )}
              </Table>
            )}
            {report.note && <p className="border-t border-rule px-4 py-2 text-xs text-muted">{report.note}</p>}
          </Panel>
        )}
      </div>
    </div>
  );
}
