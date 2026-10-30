"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordPaymentAction } from "@/app/actions";
import { D, formatIndian } from "@/lib/calc";
import { btn, input, label } from "@/components/ui";
import { Combobox } from "./Combobox";
import type { PartyOpt } from "./InvoiceForm";

type Acct = { id: number; name: string; type: "cash" | "bank" };

export function PaymentForm({ parties, accounts, today, initial }: { parties: PartyOpt[]; accounts: Acct[]; today: string; initial: { direction: "in" | "out"; partyId?: number; amount?: string } }) {
  const router = useRouter();
  const [direction, setDirection] = useState(initial.direction);
  const [partyId, setPartyId] = useState<number | null>(initial.partyId ?? null);
  const [amount, setAmount] = useState(initial.amount ?? "");
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<"cash" | "bank" | "upi" | "cheque">("cash");
  const cashAccts = accounts.filter((a) => a.type === "cash");
  const bankAccts = accounts.filter((a) => a.type === "bank");
  const choices = mode === "cash" ? cashAccts : bankAccts;
  const [accountId, setAccountId] = useState<number | null>(cashAccts[0]?.id ?? null);
  const [chequeNo, setChequeNo] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dup, setDup] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const party = parties.find((p) => p.id === partyId);

  const setModeAndAccount = (m: typeof mode) => {
    setMode(m);
    const list = m === "cash" ? cashAccts : bankAccts;
    if (!list.some((a) => a.id === accountId)) setAccountId(list[0]?.id ?? null);
  };

  async function submit(confirmDuplicate = false) {
    setError(null);
    if (!partyId) return setError("Pick a party.");
    if (!accountId) return setError(`Add a ${mode === "cash" ? "cash" : "bank"} account in Settings first.`);
    setBusy(true);
    const r = await recordPaymentAction({ direction, partyId, accountId, date, amount: Number(amount), mode, chequeNo, reference, notes, idempotencyKey: key, confirmDuplicate });
    setBusy(false);
    if (r.ok) router.push(`/parties/${partyId}?paid=1${r.data.warnings.length ? `&w=${encodeURIComponent(r.data.warnings.join(" | "))}` : ""}`);
    else if (r.code === "possible_duplicate") setDup(r.error);
    else setError(r.error);
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="max-w-2xl space-y-4 rounded-lg border border-rule bg-surface p-5">
      <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-1 rounded-md bg-paper p-1">
        {(["in", "out"] as const).map((d) => (
          <button key={d} type="button" role="radio" aria-checked={direction === d} onClick={() => setDirection(d)} className={`rounded px-3 py-2 text-sm font-semibold ${direction === d ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>
            {d === "in" ? "Receive from customer" : "Pay to supplier"}
          </button>
        ))}
      </div>
      <div>
        <label className={label} htmlFor="pparty">Party</label>
        <Combobox id="pparty" autoFocus={!initial.partyId} options={parties.map((p) => ({ value: p.id, label: p.name, hint: p.city }))} value={partyId} onChange={setPartyId} placeholder="Type a name" />
        {party && (
          <p className="mt-1 text-sm">
            {D(party.balance).isZero() ? <span className="text-muted">Account settled</span> : D(party.balance).gt(0) ? <span className="text-madder">Owes you ₹{formatIndian(party.balance, 0)}</span> : <span className="text-ink">You owe ₹{formatIndian(D(party.balance).abs(), 0)}</span>}
            {((direction === "in" && D(party.balance).gt(0)) || (direction === "out" && D(party.balance).lt(0))) && (
              <button type="button" className="ml-2 text-xs font-medium text-ink underline" onClick={() => setAmount(D(party.balance).abs().toFixed(0))}>Use full amount</button>
            )}
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="amt">Amount (₹)</label>
          <input id="amt" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className={`${input} num text-lg font-semibold`} />
          {Number(amount) > 0 && <p className="num mt-1 text-xs text-muted">₹{formatIndian(amount)}</p>}
        </div>
        <div>
          <label className={label} htmlFor="pdate">Date</label>
          <input id="pdate" type="date" required value={date} max={today} onChange={(e) => setDate(e.target.value)} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="mode">Mode</label>
          <select id="mode" value={mode} onChange={(e) => setModeAndAccount(e.target.value as typeof mode)} className={input}>
            <option value="cash">Cash</option>
            <option value="bank">Bank transfer (NEFT/RTGS)</option>
            <option value="upi">UPI</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="acct">{mode === "cash" ? "Cash account" : "Bank account"}</label>
          <select id="acct" value={accountId ?? ""} onChange={(e) => setAccountId(Number(e.target.value))} className={input}>
            {choices.length === 0 && <option value="">None — add one in Settings</option>}
            {choices.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        {mode === "cheque" && (
          <div>
            <label className={label} htmlFor="chq">Cheque no.</label>
            <input id="chq" required value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} className={input} />
            <p className="mt-1 text-xs text-muted">Counts in the bank balance only after you mark it cleared.</p>
          </div>
        )}
        <div className={mode === "cheque" ? "" : "sm:col-span-2"}>
          <label className={label} htmlFor="ref">{mode === "cash" ? "Received by / reference" : "UTR / reference"}</label>
          <input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} className={input} placeholder="Optional" />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="pnotes">Notes</label>
          <input id="pnotes" value={notes} onChange={(e) => setNotes(e.target.value)} className={input} placeholder="Optional" />
        </div>
      </div>
      {error && <p role="alert" className="rounded-md bg-madder-tint px-3 py-2 text-sm text-madder">{error}</p>}
      {dup ? (
        <div role="alert" className="rounded-md border border-turmeric/30 bg-turmeric-tint p-3 text-sm text-turmeric">
          <p className="font-medium">{dup}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className={btn.secondary} onClick={() => setDup(null)}>Go back</button>
            <button type="button" className={btn.primary} onClick={() => { setDup(null); submit(true); }}>Save anyway</button>
          </div>
        </div>
      ) : (
        <button disabled={busy} className={`${btn.primary} w-full py-2.5`}>{busy ? "Saving…" : direction === "in" ? "Save receipt" : "Save payment"}</button>
      )}
    </form>
  );
}
