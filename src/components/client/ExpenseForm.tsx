"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordExpenseAction } from "@/app/actions";
import { btn, input, label } from "@/components/ui";

export function ExpenseForm({ categories, accounts, today }: { categories: string[]; accounts: { id: number; name: string; type: string }[]; today: string }) {
  const router = useRouter();
  const blank = () => ({ date: today, category: categories[0], amount: "", accountId: accounts[0]?.id ?? 0, paidTo: "", notes: "", key: crypto.randomUUID() });
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await recordExpenseAction({ date: f.date, category: f.category, amount: Number(f.amount), accountId: f.accountId, paidTo: f.paidTo, notes: f.notes, idempotencyKey: f.key });
        setBusy(false);
        if (r.ok) {
          setMsg({ ok: true, text: "Expense saved." });
          setF(blank());
          router.refresh();
        } else setMsg({ ok: false, text: r.error });
      }}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[140px_1fr_140px_1fr_1fr_auto] lg:items-end"
    >
      <div><label className={label} htmlFor="edate">Date</label><input id="edate" type="date" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={input} /></div>
      <div>
        <label className={label} htmlFor="ecat">Category</label>
        <input id="ecat" list="ecats" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={input} />
        <datalist id="ecats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <div><label className={label} htmlFor="eamt">Amount (₹)</label><input id="eamt" required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} className={`${input} num text-right`} /></div>
      <div>
        <label className={label} htmlFor="eacct">Paid from</label>
        <select id="eacct" value={f.accountId} onChange={(e) => setF({ ...f, accountId: Number(e.target.value) })} className={input}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div><label className={label} htmlFor="eto">Paid to / note</label><input id="eto" value={f.paidTo} onChange={(e) => setF({ ...f, paidTo: e.target.value })} className={input} placeholder="Optional" /></div>
      <button disabled={busy || accounts.length === 0} className={btn.primary}>{busy ? "Saving…" : "Add expense"}</button>
      {msg && <p role="status" className={`text-sm sm:col-span-2 lg:col-span-6 ${msg.ok ? "text-leaf" : "text-madder"}`}>{msg.text}</p>}
    </form>
  );
}
