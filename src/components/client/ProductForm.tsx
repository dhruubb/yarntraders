"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveProductAction } from "@/app/actions";
import { D, formatIndian, lineAmount, lineKg, type RateBasis } from "@/lib/calc";
import { btn, input, label } from "@/components/ui";

export type ProductValues = { count: string; brand: string; quality: string; hsn: string; gstRate: string; bagWeightKg: string; rateBasis: RateBasis; conesPerBag: string; lowStockBags: string; active: boolean };

const BASIS: { v: RateBasis; t: string; hint: string }[] = [
  { v: "per_5kg", t: "Per 5 kg", hint: "Most cotton yarn: 30 Amrut 40 × 1258 → 40 bags × 50 kg ÷ 5 × ₹1,258" },
  { v: "per_kg", t: "Per kg", hint: "e.g. 58 Silver 12 × 238 → 12 bags × 64 kg × ₹238" },
  { v: "per_bag", t: "Per bag", hint: "Rate is for the whole bag" },
  { v: "per_lb", t: "Per lb", hint: "Rate per pound (0.4536 kg)" },
];

export function ProductForm({ id, initial }: { id?: number; initial: ProductValues }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ProductValues>(k: K, val: ProductValues[K]) => setV((x) => ({ ...x, [k]: val }));
  const sample = Number(v.bagWeightKg) > 0 ? lineAmount(v.rateBasis, 10, lineKg(10, v.bagWeightKg), 1000) : null;
  return (
    <form
      className="max-w-3xl space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await saveProductAction({ ...v, gstRate: Number(v.gstRate), bagWeightKg: Number(v.bagWeightKg), conesPerBag: v.conesPerBag ? Number(v.conesPerBag) : "", lowStockBags: Number(v.lowStockBags || 0) }, id);
        setBusy(false);
        if (r.ok) router.push(`/stock/products/${r.data}`);
        else setError(r.error);
      }}
    >
      <section className="grid gap-3 rounded-lg border border-rule bg-surface p-4 sm:grid-cols-3">
        <div><label className={label} htmlFor="cnt">Count</label><input id="cnt" required autoFocus value={v.count} onChange={(e) => set("count", e.target.value)} className={input} placeholder="30, 47, 2/40" /></div>
        <div><label className={label} htmlFor="brand">Brand / mill</label><input id="brand" required value={v.brand} onChange={(e) => set("brand", e.target.value)} className={input} placeholder="Amrut" /></div>
        <div><label className={label} htmlFor="qual">Quality (optional)</label><input id="qual" value={v.quality} onChange={(e) => set("quality", e.target.value)} className={input} placeholder="Combed, PC, cone…" /></div>
        <p className="text-sm text-muted sm:col-span-3">Shown on bills as <b className="text-text">{[v.count, v.brand, v.quality].filter(Boolean).join(" ") || "…"}</b></p>
      </section>
      <section className="grid gap-3 rounded-lg border border-rule bg-surface p-4 sm:grid-cols-2">
        <div><label className={label} htmlFor="bw">Standard bag weight (kg)</label><input id="bw" required inputMode="decimal" value={v.bagWeightKg} onChange={(e) => set("bagWeightKg", e.target.value.replace(/[^\d.]/g, ""))} className={`${input} num`} placeholder="50" /><p className="mt-1 text-xs text-muted">Common: 50 kg, 60 kg, 45.36 kg (100 lb), 64 kg. Each bill line can override with the weighed kg.</p></div>
        <fieldset>
          <legend className={label}>Rate is quoted</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {BASIS.map((b) => (
              <label key={b.v} className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${v.rateBasis === b.v ? "border-ink bg-ink-tint font-semibold text-ink" : "border-rule"}`}>
                <input type="radio" className="sr-only" checked={v.rateBasis === b.v} onChange={() => set("rateBasis", b.v)} />
                {b.t}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{BASIS.find((b) => b.v === v.rateBasis)?.hint}</p>
        </fieldset>
        {sample && <p className="num rounded-md bg-ink-tint px-3 py-2 text-sm text-ink sm:col-span-2">Check: 10 bags at rate ₹1,000 = ₹{formatIndian(sample, 0)}</p>}
        <div><label className={label} htmlFor="hsn">HSN code</label><input id="hsn" value={v.hsn} onChange={(e) => set("hsn", e.target.value)} className={input} /><p className="mt-1 text-xs text-muted">5205 cotton yarn · 5509 synthetic staple · 5402 filament</p></div>
        <div><label className={label} htmlFor="gst">GST %</label><input id="gst" inputMode="decimal" value={v.gstRate} onChange={(e) => set("gstRate", e.target.value)} className={`${input} num`} /></div>
        <div><label className={label} htmlFor="cones">Cones per bag (optional)</label><input id="cones" inputMode="numeric" value={v.conesPerBag} onChange={(e) => set("conesPerBag", e.target.value.replace(/\D/g, ""))} className={`${input} num`} /></div>
        <div><label className={label} htmlFor="low">Low-stock alert below (bags)</label><input id="low" inputMode="decimal" value={v.lowStockBags} onChange={(e) => set("lowStockBags", e.target.value.replace(/[^\d.]/g, ""))} className={`${input} num`} placeholder="0 = no alert" /></div>
        {id && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={v.active} onChange={(e) => set("active", e.target.checked)} /> Active (inactive products are hidden from new bills)</label>}
      </section>
      {id && D(initial.bagWeightKg).toString() !== D(v.bagWeightKg || 0).toString() && <p className="rounded-md bg-turmeric-tint px-3 py-2 text-sm text-turmeric">Changing the bag weight only affects new bills. Posted bills keep their weights.</p>}
      {error && <p role="alert" className="rounded-md bg-madder-tint px-3 py-2 text-sm text-madder">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className={btn.primary}>{busy ? "Saving…" : id ? "Save changes" : "Add product"}</button>
        <button type="button" onClick={() => router.back()} className={btn.secondary}>Back</button>
      </div>
    </form>
  );
}
