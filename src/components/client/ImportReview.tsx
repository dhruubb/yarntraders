"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postImportAction, updateImportRowAction } from "@/app/actions";
import { formatIndian } from "@/lib/calc";
import { Badge, btn, input } from "@/components/ui";

export type ReviewRow = {
  id: number;
  rowNo: number;
  status: "pending" | "posted" | "rejected" | "error";
  error: string | null;
  resultId: number | null;
  data: Record<string, unknown>;
  check?: { errors: string[]; taxable: string | null; total: string | null; match: "ok" | "mismatch" | "none" };
};

export function ImportReview({ batchId, kind, rows, parties, products, isOcr }: { batchId: number; kind: string; rows: ReviewRow[]; parties: { id: number; name: string }[]; products: { id: number; name: string }[]; isOcr: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | "post" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const txn = kind === "sale" || kind === "purchase";
  const ready = rows.filter((r) => (r.status === "pending" || r.status === "error") && (!r.check || r.check.errors.length === 0));
  const blocked = rows.filter((r) => (r.status === "pending" || r.status === "error") && r.check && r.check.errors.length > 0);

  const save = async (r: ReviewRow, patch: Record<string, unknown>, status?: "pending" | "rejected") => {
    setBusy(r.id);
    const res = await updateImportRowAction(r.id, patch, status);
    setBusy(null);
    if (!res.ok) setMsg({ ok: false, t: res.error });
    router.refresh();
  };

  const field = (r: ReviewRow, key: string, opts: { w?: string; numeric?: boolean; type?: string } = {}) => (
    <input
      aria-label={`${key} row ${r.rowNo}`}
      type={opts.type ?? "text"}
      inputMode={opts.numeric ? "decimal" : undefined}
      defaultValue={String(r.data[key] ?? "")}
      disabled={r.status === "posted"}
      onBlur={(e) => {
        if (e.target.value !== String(r.data[key] ?? "")) save(r, { [key]: e.target.value });
      }}
      className={`${input} px-2 py-1 ${opts.numeric ? "num text-right" : ""} ${opts.w ?? ""} ${r.check?.errors.includes(key === "product_id" ? "yarn" : key) ? "border-madder" : ""}`}
    />
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-rule bg-surface p-3">
        <span className="text-sm"><b>{ready.length}</b> rows ready{blocked.length > 0 && <>, <span className="text-madder"><b>{blocked.length}</b> need fixing</span></>}</span>
        <button
          disabled={busy !== null || ready.length === 0}
          className={btn.primary}
          onClick={async () => {
            if (!confirm(`Post ${ready.length} rows? ${txn ? "Bills, stock and balances will be updated." : ""}`)) return;
            setBusy("post");
            const r = await postImportAction(batchId);
            setBusy(null);
            setMsg(r.ok ? { ok: r.data.failed === 0, t: `${r.data.posted} rows posted${r.data.failed ? `, ${r.data.failed} failed — see the error on each row` : ""}.` } : { ok: false, t: r.error });
            router.refresh();
          }}
        >
          {busy === "post" ? "Posting…" : `Post ${ready.length} ready rows`}
        </button>
        {msg && <span role="status" className={`text-sm ${msg.ok ? "text-leaf" : "text-madder"}`}>{msg.t}</span>}
      </div>
      {txn && <p className="text-xs text-muted">Rows with the same date and party{kind === "purchase" ? " and bill no." : ""} become one bill. “Register” compares the amount written in the register with the amount calculated from bags × rate (before or after GST).{isOcr && " Check every OCR row against the photo — low-confidence rows are highlighted."}</p>}
      <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="border-b border-rule px-2 py-2">#</th>
              {txn ? (
                <>
                  <th className="border-b border-rule px-2 py-2">Date</th>
                  <th className="border-b border-rule px-2 py-2">Party</th>
                  <th className="border-b border-rule px-2 py-2">Yarn</th>
                  <th className="border-b border-rule px-2 py-2 text-right">Bags</th>
                  <th className="border-b border-rule px-2 py-2 text-right">Rate</th>
                  <th className="border-b border-rule px-2 py-2 text-right">Kg</th>
                  {kind === "purchase" && <th className="border-b border-rule px-2 py-2">Bill no.</th>}
                  <th className="border-b border-rule px-2 py-2 text-right">Register ₹</th>
                  <th className="border-b border-rule px-2 py-2 text-right">Calculated</th>
                </>
              ) : (
                <th className="border-b border-rule px-2 py-2">Data</th>
              )}
              <th className="border-b border-rule px-2 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const low = r.data.confidence === "low";
              return (
                <tr key={r.id} className={`${r.status === "rejected" ? "opacity-50" : ""} ${low && r.status !== "posted" ? "bg-turmeric-tint/60" : ""}`}>
                  <td className="border-b border-rule/70 px-2 py-1.5 text-muted">{r.rowNo}</td>
                  {txn ? (
                    <>
                      <td className="border-b border-rule/70 px-2 py-1.5">{field(r, "date", { type: "date", w: "w-36" })}</td>
                      <td className="border-b border-rule/70 px-2 py-1.5">
                        <select aria-label={`Party row ${r.rowNo}`} disabled={r.status === "posted"} value={String(r.data.party_id ?? "")} onChange={(e) => save(r, { party_id: e.target.value ? Number(e.target.value) : null })} className={`${input} min-w-40 px-2 py-1 ${!r.data.party_id ? "border-madder" : ""}`}>
                          <option value="">{r.data.party ? `“${String(r.data.party)}” — pick` : "Pick party"}</option>
                          {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </td>
                      <td className="border-b border-rule/70 px-2 py-1.5">
                        <select aria-label={`Yarn row ${r.rowNo}`} disabled={r.status === "posted"} value={String(r.data.product_id ?? "")} onChange={(e) => save(r, { product_id: e.target.value ? Number(e.target.value) : null })} className={`${input} min-w-36 px-2 py-1 ${!r.data.product_id ? "border-madder" : ""}`}>
                          <option value="">{r.data.product ? `“${String(r.data.product)}” — pick` : "Pick yarn"}</option>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </td>
                      <td className="border-b border-rule/70 px-2 py-1.5">{field(r, "bags", { numeric: true, w: "w-20" })}</td>
                      <td className="border-b border-rule/70 px-2 py-1.5">{field(r, "rate", { numeric: true, w: "w-28" })}</td>
                      <td className="border-b border-rule/70 px-2 py-1.5">{field(r, "kg", { numeric: true, w: "w-24" })}</td>
                      {kind === "purchase" && <td className="border-b border-rule/70 px-2 py-1.5">{field(r, "bill_no", { w: "w-28" })}</td>}
                      <td className="border-b border-rule/70 px-2 py-1.5">{field(r, "register_amount", { numeric: true, w: "w-28" })}</td>
                      <td className="num border-b border-rule/70 px-2 py-1.5 text-right whitespace-nowrap">
                        {r.check?.taxable ? <>₹{formatIndian(r.check.taxable, 0)}<div className="text-xs text-muted">₹{formatIndian(r.check.total ?? 0, 0)} with GST</div></> : "—"}
                        {r.check?.match === "ok" && <Badge tone="ok">Matches</Badge>}
                        {r.check?.match === "mismatch" && (r.data.amount_ok ? <Badge tone="warn">Different — accepted</Badge> : (
                          <span className="block">
                            <Badge tone="due">Doesn&rsquo;t match</Badge>
                            {r.status !== "posted" && <button className="ml-1 text-xs font-medium text-ink underline" onClick={() => save(r, { amount_ok: true })}>Calculated is right</button>}
                          </span>
                        ))}
                      </td>
                    </>
                  ) : (
                    <td className="border-b border-rule/70 px-2 py-1.5 text-xs">{Object.entries(r.data).map(([k, v]) => <span key={k} className="mr-3"><span className="text-muted">{k}:</span> {String(v ?? "")}</span>)}</td>
                  )}
                  <td className="border-b border-rule/70 px-2 py-1.5 whitespace-nowrap">
                    {r.status === "posted" ? (
                      r.resultId && txn ? <a href={`/invoices/${r.resultId}`} className="text-leaf underline">Posted</a> : <Badge tone="ok">Posted</Badge>
                    ) : r.status === "rejected" ? (
                      <button className={btn.ghost} onClick={() => save(r, {}, "pending")}>Include</button>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        {r.check && r.check.errors.length > 0 && <Badge tone="due">{r.check.errors.length === 1 && r.check.errors[0] === "amount" ? "Check amount" : `Fix ${r.check.errors.join(", ")}`}</Badge>}
                        {r.status === "error" && <span className="max-w-56 whitespace-normal text-xs text-madder">{r.error}</span>}
                        <button className={btn.ghost} disabled={busy === r.id} onClick={() => save(r, {}, "rejected")}>Skip</button>
                      </span>
                    )}
                    {Boolean(r.data.struck_through) && <div className="text-xs text-muted">Struck through in register</div>}
                    {Boolean(r.data.note) && <div className="max-w-56 whitespace-normal text-xs text-turmeric">{String(r.data.note)}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
