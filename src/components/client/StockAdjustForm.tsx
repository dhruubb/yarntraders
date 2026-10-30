"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adjustStockAction } from "@/app/actions";
import { btn, input, label } from "@/components/ui";

export function StockAdjustForm({ productId, today, hasStock }: { productId: number; today: string; hasStock: boolean }) {
  const router = useRouter();
  const [type, setType] = useState<"opening" | "adjustment">(hasStock ? "adjustment" : "opening");
  const [dir, setDir] = useState<"add" | "remove">("add");
  const [bags, setBags] = useState("");
  const [kg, setKg] = useState("");
  const [cost, setCost] = useState("");
  const [lot, setLot] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const sign = type === "opening" || dir === "add" ? 1 : -1;
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await adjustStockAction({ productId, type, date, bags: sign * Number(bags), kg: kg ? sign * Number(kg) : "", costPerKg: cost ? Number(cost) : "", lotNo: lot, note });
        setBusy(false);
        if (r.ok) {
          setBags(""); setKg(""); setCost(""); setNote("");
          router.push(`/stock/products/${productId}?tab=history&saved=1`, { scroll: false });
        } else setMsg({ ok: false, t: r.error });
      }}
    >
      <div>
        <label className={label} htmlFor="atype">Entry</label>
        <select id="atype" value={type} onChange={(e) => setType(e.target.value as typeof type)} className={input}>
          <option value="opening">Opening stock</option>
          <option value="adjustment">Physical count correction</option>
        </select>
      </div>
      {type === "adjustment" ? (
        <div>
          <label className={label} htmlFor="adir">Change</label>
          <select id="adir" value={dir} onChange={(e) => setDir(e.target.value as typeof dir)} className={input}>
            <option value="add">Add (found extra)</option>
            <option value="remove">Remove (short / damaged)</option>
          </select>
        </div>
      ) : <div />}
      <div><label className={label} htmlFor="abags">Bags</label><input id="abags" required inputMode="decimal" value={bags} onChange={(e) => setBags(e.target.value.replace(/[^\d.]/g, ""))} className={`${input} num`} /></div>
      <div><label className={label} htmlFor="akg">Kg (blank = standard)</label><input id="akg" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value.replace(/[^\d.]/g, ""))} className={`${input} num`} /></div>
      {sign > 0 && <div><label className={label} htmlFor="acost">Cost ₹ per kg (before GST)</label><input id="acost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, ""))} className={`${input} num`} placeholder={type === "opening" ? "Required" : "Blank = current average"} /></div>}
      <div><label className={label} htmlFor="alot">Lot</label><input id="alot" value={lot} onChange={(e) => setLot(e.target.value)} className={input} /></div>
      <div><label className={label} htmlFor="adate">Date</label><input id="adate" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className={input} /></div>
      <div className="sm:col-span-2"><label className={label} htmlFor="anote">Note</label><input id="anote" required minLength={3} value={note} onChange={(e) => setNote(e.target.value)} className={input} placeholder="e.g. Godown count on 31 Oct" /></div>
      {msg && <p role="status" className={`text-sm sm:col-span-2 ${msg.ok ? "text-leaf" : "text-madder"}`}>{msg.t}</p>}
      <button disabled={busy} className={`${btn.primary} sm:col-span-2`}>{busy ? "Saving…" : "Save stock entry"}</button>
    </form>
  );
}
