"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { postInvoiceAction } from "@/app/actions";
import { D, computeInvoice, formatIndian, formatQty, RATE_BASIS_LABEL, type RateBasis } from "@/lib/calc";
import { btn, input, label } from "@/components/ui";

export type ReturnLine = { id: number; productId: number; name: string; bags: string; kg: string; rate: string; rateBasis: RateBasis; gstRate: string; remainingBags: string };

export function ReturnForm({ invoiceId, partyId, kind, lines, interstate, today, minDate }: { invoiceId: number; partyId: number; kind: "sale_return" | "purchase_return"; lines: ReturnLine[]; interstate: boolean; today: string; minDate: string }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<number, string>>({});
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());

  const chosen = lines.filter((l) => Number(qty[l.id]) > 0);
  const calc = useMemo(
    () =>
      computeInvoice({
        lines: chosen.map((l) => ({ bags: qty[l.id], bagWeightKg: D(l.kg).div(l.bags), rate: l.rate, rateBasis: l.rateBasis, gstRate: l.gstRate })),
        interstate,
      }),
    [chosen, qty, interstate],
  );

  async function submit() {
    setError(null);
    if (chosen.length === 0) return setError("Enter the bags being returned on at least one line.");
    setBusy(true);
    const r = await postInvoiceAction({
      kind,
      partyId,
      date,
      refInvoiceId: invoiceId,
      notes,
      idempotencyKey: key,
      lines: chosen.map((l) => ({ productId: l.productId, bags: Number(qty[l.id]), rate: Number(l.rate), refLineId: l.id })),
    });
    setBusy(false);
    if (r.ok) router.push(`/invoices/${r.data.invoiceId}?posted=1${kind === "purchase_return" ? "&tab=purchases" : ""}`);
    else setError(r.error);
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
      <div className="rounded-lg border border-rule bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="border-b border-rule px-3 py-2">Yarn</th>
              <th className="border-b border-rule px-3 py-2 text-right">Billed</th>
              <th className="border-b border-rule px-3 py-2 text-right">Can return</th>
              <th className="border-b border-rule px-3 py-2 text-right">Rate</th>
              <th className="w-36 border-b border-rule px-3 py-2 text-right">Bags returned</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="border-b border-rule/70 px-3 py-2 font-medium">{l.name}</td>
                <td className="num border-b border-rule/70 px-3 py-2 text-right">{formatQty(l.bags)} bags</td>
                <td className="num border-b border-rule/70 px-3 py-2 text-right">{formatQty(l.remainingBags)}</td>
                <td className="num border-b border-rule/70 px-3 py-2 text-right">₹{formatIndian(l.rate)} <span className="text-xs text-muted">{RATE_BASIS_LABEL[l.rateBasis]}</span></td>
                <td className="border-b border-rule/70 px-3 py-1.5">
                  <input
                    aria-label={`Bags of ${l.name} returned`}
                    inputMode="decimal"
                    disabled={D(l.remainingBags).lte(0)}
                    value={qty[l.id] ?? ""}
                    onChange={(e) => setQty({ ...qty, [l.id]: e.target.value.replace(/[^\d.]/g, "") })}
                    className={`${input} num text-right ${Number(qty[l.id]) > Number(l.remainingBags) ? "border-madder text-madder" : ""}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_340px]">
        <div className="grid content-start gap-3 rounded-lg border border-rule bg-surface p-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="rdate">Return date</label>
            <input id="rdate" type="date" value={date} min={minDate} max={today} onChange={(e) => setDate(e.target.value)} className={input} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="rnotes">Reason / notes</label>
            <input id="rnotes" value={notes} onChange={(e) => setNotes(e.target.value)} className={input} placeholder="e.g. quality issue, wrong count" />
          </div>
        </div>
        <div className="rounded-lg border border-ink/20 bg-surface p-4">
          <dl className="num space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Taxable value</dt><dd>₹{formatIndian(calc.taxable)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">GST</dt><dd>₹{formatIndian(calc.cgst.add(calc.sgst).add(calc.igst))}</dd></div>
            <div className="flex justify-between border-t border-rule pt-2 text-lg font-semibold"><dt>Credit note total</dt><dd>₹{formatIndian(calc.total, 0)}</dd></div>
          </dl>
          {error && <p role="alert" className="mt-3 rounded-md bg-madder-tint px-3 py-2 text-sm text-madder">{error}</p>}
          <button disabled={busy} className={`${btn.primary} mt-4 w-full`}>{busy ? "Posting…" : "Post return"}</button>
        </div>
      </div>
    </form>
  );
}
