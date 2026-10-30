"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { savePartyAction } from "@/app/actions";
import { btn, input, label } from "@/components/ui";

export type PartyValues = {
  name: string; type: "customer" | "supplier" | "both"; phone: string; email: string; gstin: string; stateCode: string; address: string; city: string;
  creditDays: number; creditLimit: string; openingBalance: string; openingSide: "receivable" | "payable"; notes: string; active: boolean;
};

export function PartyForm({ id, initial, states, canEditOpening }: { id?: number; initial: PartyValues; states: Record<string, string>; canEditOpening: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof PartyValues>(k: K, val: PartyValues[K]) => setV((x) => ({ ...x, [k]: val }));
  return (
    <form
      className="max-w-3xl space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await savePartyAction({ ...v, creditLimit: v.creditLimit === "" ? "" : Number(v.creditLimit), openingBalance: Number(v.openingBalance || 0) }, id);
        setBusy(false);
        if (r.ok) router.push(`/parties/${r.data}`);
        else setError(r.error);
      }}
    >
      <section className="grid gap-3 rounded-lg border border-rule bg-surface p-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="pn">Party name</label>
          <input id="pn" required autoFocus value={v.name} onChange={(e) => set("name", e.target.value)} className={input} placeholder="e.g. Khalid B.R" />
        </div>
        <fieldset className="sm:col-span-2">
          <legend className={label}>Type</legend>
          <div className="flex flex-wrap gap-2">
            {(["customer", "supplier", "both"] as const).map((t) => (
              <label key={t} className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${v.type === t ? "border-ink bg-ink-tint font-semibold text-ink" : "border-rule"}`}>
                <input type="radio" name="type" className="sr-only" checked={v.type === t} onChange={() => set("type", t)} />
                {t === "customer" ? "Customer (we sell to them)" : t === "supplier" ? "Supplier (we buy from them)" : "Customer & supplier"}
              </label>
            ))}
          </div>
        </fieldset>
        <div><label className={label} htmlFor="pph">Phone</label><input id="pph" type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} className={input} /></div>
        <div><label className={label} htmlFor="pcity">City</label><input id="pcity" value={v.city} onChange={(e) => set("city", e.target.value)} className={input} placeholder="e.g. Malegaon" /></div>
        <div>
          <label className={label} htmlFor="pgst">GSTIN</label>
          <input id="pgst" value={v.gstin} onChange={(e) => { const g = e.target.value.toUpperCase(); set("gstin", g); if (/^\d{2}/.test(g) && states[g.slice(0, 2)]) set("stateCode", g.slice(0, 2)); }} className={`${input} uppercase`} placeholder="Optional" maxLength={15} />
        </div>
        <div>
          <label className={label} htmlFor="pstate">State</label>
          <select id="pstate" value={v.stateCode} onChange={(e) => set("stateCode", e.target.value)} className={input}>
            {Object.entries(states).sort((a, b) => a[1].localeCompare(b[1])).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted">Decides CGST+SGST or IGST on bills.</p>
        </div>
        <div className="sm:col-span-2"><label className={label} htmlFor="paddr">Address</label><textarea id="paddr" rows={2} value={v.address} onChange={(e) => set("address", e.target.value)} className={input} /></div>
        <div><label className={label} htmlFor="pemail">Email</label><input id="pemail" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} className={input} /></div>
      </section>
      <section className="grid gap-3 rounded-lg border border-rule bg-surface p-4 sm:grid-cols-2">
        <div><label className={label} htmlFor="pcd">Credit days</label><input id="pcd" type="number" min={0} max={365} value={v.creditDays} onChange={(e) => set("creditDays", Number(e.target.value))} className={input} /></div>
        <div><label className={label} htmlFor="pcl">Credit limit (₹)</label><input id="pcl" inputMode="decimal" value={v.creditLimit} onChange={(e) => set("creditLimit", e.target.value.replace(/[^\d.]/g, ""))} className={`${input} num`} placeholder="No limit" /></div>
        <div>
          <label className={label} htmlFor="pob">Opening balance (₹)</label>
          <input id="pob" inputMode="decimal" disabled={!canEditOpening} value={v.openingBalance} onChange={(e) => set("openingBalance", e.target.value.replace(/[^\d.]/g, ""))} className={`${input} num`} placeholder="0" />
          {!canEditOpening && <p className="mt-1 text-xs text-muted">Only the owner can change this.</p>}
        </div>
        <div>
          <label className={label} htmlFor="pos">Opening balance is</label>
          <select id="pos" disabled={!canEditOpening} value={v.openingSide} onChange={(e) => set("openingSide", e.target.value as PartyValues["openingSide"])} className={input}>
            <option value="receivable">Owed to us (they owe us)</option>
            <option value="payable">Owed by us (we owe them)</option>
          </select>
        </div>
        <div className="sm:col-span-2"><label className={label} htmlFor="pnotes">Notes</label><textarea id="pnotes" rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} className={input} /></div>
        {id && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={v.active} onChange={(e) => set("active", e.target.checked)} /> Active (inactive parties are hidden from new bills)
          </label>
        )}
      </section>
      {error && <p role="alert" className="rounded-md bg-madder-tint px-3 py-2 text-sm text-madder">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className={btn.primary}>{busy ? "Saving…" : id ? "Save changes" : "Add party"}</button>
        <button type="button" onClick={() => router.back()} className={btn.secondary}>Back</button>
      </div>
    </form>
  );
}
