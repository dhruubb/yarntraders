"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveAccountAction, saveSettingsAction, saveUserAction, telegramChatsAction, telegramTestAction } from "@/app/actions";
import { btn, input, label } from "@/components/ui";
import { formatIndian } from "@/lib/calc";

function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => {
    setBusy(true);
    setMsg(null);
    const r = await fn();
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: true, t: okText });
      router.refresh();
    } else setMsg({ ok: false, t: r.error ?? "Failed" });
    return r.ok;
  };
  const Msg = () => (msg ? <p role="status" className={`text-sm ${msg.ok ? "text-leaf" : "text-madder"}`}>{msg.t}</p> : null);
  return { busy, run, Msg };
}

export type BusinessForm = {
  name: string; gstin: string; stateCode: string; address: string; phone: string; bankDetails: string; invoiceTerms: string;
  majorTxnThreshold: string; backdateAlertDays: string; telegramChatIds: string;
  alerts: { majorTxn: boolean; overdue: boolean; lowStock: boolean; unusual: boolean; dailySummary: boolean };
};

export function BusinessSettings({ initial, states, telegramConfigured }: { initial: BusinessForm; states: Record<string, string>; telegramConfigured: boolean }) {
  const [v, setV] = useState(initial);
  const { busy, run, Msg } = useSave();
  const [chats, setChats] = useState<{ id: string; name: string }[] | null>(null);
  const [tmsg, setTmsg] = useState<string | null>(null);
  const set = <K extends keyof BusinessForm>(k: K, val: BusinessForm[K]) => setV((x) => ({ ...x, [k]: val }));
  const save = () => run(() => saveSettingsAction({ ...v, majorTxnThreshold: Number(v.majorTxnThreshold || 0), backdateAlertDays: Number(v.backdateAlertDays || 0) }), "Settings saved.");
  const ALERTS: [keyof BusinessForm["alerts"], string][] = [
    ["majorTxn", "Large bills and payments"],
    ["overdue", "Overdue payments (every morning)"],
    ["lowStock", "Low stock"],
    ["unusual", "Unusual activity: cancellations, sale below cost, credit limit crossed, back-dated entries, bounced cheques"],
    ["dailySummary", "Daily summary (every evening)"],
  ];
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <section className="grid gap-3 rounded-lg border border-rule bg-surface p-4 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Business</h2>
        <div><label className={label} htmlFor="bn">Name on bills</label><input id="bn" required value={v.name} onChange={(e) => set("name", e.target.value)} className={input} /></div>
        <div><label className={label} htmlFor="bg">GSTIN</label><input id="bg" value={v.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} className={`${input} uppercase`} maxLength={15} /></div>
        <div>
          <label className={label} htmlFor="bs">State</label>
          <select id="bs" value={v.stateCode} onChange={(e) => set("stateCode", e.target.value)} className={input}>
            {Object.entries(states).sort((a, b) => a[1].localeCompare(b[1])).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </div>
        <div><label className={label} htmlFor="bp">Phone</label><input id="bp" value={v.phone} onChange={(e) => set("phone", e.target.value)} className={input} /></div>
        <div className="sm:col-span-2"><label className={label} htmlFor="ba">Address</label><textarea id="ba" rows={2} value={v.address} onChange={(e) => set("address", e.target.value)} className={input} /></div>
        <div><label className={label} htmlFor="bb">Bank details on sale bills</label><textarea id="bb" rows={3} value={v.bankDetails} onChange={(e) => set("bankDetails", e.target.value)} className={input} placeholder={"Bank, A/c no., IFSC"} /></div>
        <div><label className={label} htmlFor="bt">Terms on sale bills</label><textarea id="bt" rows={3} value={v.invoiceTerms} onChange={(e) => set("invoiceTerms", e.target.value)} className={input} /></div>
      </section>

      <section className="grid gap-3 rounded-lg border border-rule bg-surface p-4 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Telegram alerts</h2>
        {!telegramConfigured && (
          <p className="rounded-md bg-turmeric-tint px-3 py-2 text-sm text-turmeric sm:col-span-2">
            The bot token isn&rsquo;t set on the server yet. Create a bot with @BotFather in Telegram, put its token in <code>TELEGRAM_BOT_TOKEN</code>, and restart the app.
          </p>
        )}
        <div className="sm:col-span-2">
          <label className={label} htmlFor="tc">Chat IDs to alert (comma separated)</label>
          <input id="tc" value={v.telegramChatIds} onChange={(e) => set("telegramChatIds", e.target.value)} className={`${input} num`} placeholder="e.g. 123456789" />
          <p className="mt-1 text-xs text-muted">Open your bot in Telegram, send it /start, then press Find my chat ID.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={!telegramConfigured} className={btn.secondary} onClick={async () => {
              setTmsg(null);
              const r = await telegramChatsAction();
              if (r.ok) { setChats(r.data); if (!r.data.length) setTmsg("No chats found. Send /start to the bot first."); } else setTmsg(r.error);
            }}>Find my chat ID</button>
            <button type="button" disabled={!telegramConfigured} className={btn.secondary} onClick={async () => {
              setTmsg(null);
              const r = await telegramTestAction();
              setTmsg(r.ok ? "Test alert sent. Check Telegram." : r.error);
            }}>Send test alert</button>
          </div>
          {chats && chats.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {chats.map((c) => (
                <li key={c.id}>{c.name} — <code>{c.id}</code>{" "}
                  <button type="button" className="text-ink underline" onClick={() => set("telegramChatIds", [...new Set([...v.telegramChatIds.split(/[\s,]+/).filter(Boolean), c.id])].join(", "))}>Add</button>
                </li>
              ))}
            </ul>
          )}
          {tmsg && <p role="status" className="mt-2 text-sm text-muted">{tmsg}</p>}
        </div>
        <div><label className={label} htmlFor="mt">Alert for bills/payments of at least (₹)</label><input id="mt" inputMode="decimal" value={v.majorTxnThreshold} onChange={(e) => set("majorTxnThreshold", e.target.value.replace(/[^\d.]/g, ""))} className={`${input} num`} /></div>
        <div><label className={label} htmlFor="bd">Alert for entries back-dated more than (days)</label><input id="bd" inputMode="numeric" value={v.backdateAlertDays} onChange={(e) => set("backdateAlertDays", e.target.value.replace(/\D/g, ""))} className={`${input} num`} /></div>
        <fieldset className="space-y-1.5 sm:col-span-2">
          <legend className={label}>Send these alerts</legend>
          {ALERTS.map(([k, t]) => (
            <label key={k} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={v.alerts[k]} onChange={(e) => set("alerts", { ...v.alerts, [k]: e.target.checked })} /> {t}
            </label>
          ))}
        </fieldset>
      </section>
      <div className="flex items-center gap-3">
        <button disabled={busy} className={btn.primary}>{busy ? "Saving…" : "Save settings"}</button>
        <Msg />
      </div>
    </form>
  );
}

type Acct = { id: number; name: string; type: "cash" | "bank"; openingBalance: string; active: boolean; balance: string };

export function AccountsEditor({ accounts }: { accounts: Acct[] }) {
  const { busy, run, Msg } = useSave();
  const [edit, setEdit] = useState<Partial<Acct> & { id?: number } | null>(null);
  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted"><th className="py-1.5">Account</th><th>Type</th><th className="text-right">Opening</th><th className="text-right">Balance now</th><th /></tr></thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id} className={`border-t border-rule/70 ${a.active ? "" : "text-muted"}`}>
              <td className="py-2">{a.name}{!a.active && " (inactive)"}</td><td className="capitalize">{a.type}</td>
              <td className="num text-right">₹{formatIndian(a.openingBalance, 0)}</td>
              <td className={`num text-right ${Number(a.balance) < 0 ? "text-madder" : ""}`}>{Number(a.balance) < 0 ? "−" : ""}₹{formatIndian(Math.abs(Number(a.balance)), 0)}</td>
              <td className="text-right"><button className={btn.ghost} onClick={() => setEdit(a)}>Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit ? (
        <form className="grid gap-2 rounded-md border border-rule p-3 sm:grid-cols-[1fr_120px_160px_auto]" onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() => saveAccountAction({ name: edit.name ?? "", type: edit.type ?? "bank", openingBalance: Number(edit.openingBalance ?? 0), active: edit.active ?? true }, edit.id), "Account saved.");
          if (ok) setEdit(null);
        }}>
          <input aria-label="Account name" required placeholder="e.g. HDFC current a/c" value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={input} />
          <select aria-label="Type" value={edit.type ?? "bank"} onChange={(e) => setEdit({ ...edit, type: e.target.value as "cash" | "bank" })} className={input}><option value="bank">Bank</option><option value="cash">Cash</option></select>
          <input aria-label="Opening balance" inputMode="decimal" placeholder="Opening balance" value={edit.openingBalance ?? ""} onChange={(e) => setEdit({ ...edit, openingBalance: e.target.value.replace(/[^\d.-]/g, "") })} className={`${input} num`} />
          <div className="flex gap-2">
            <button disabled={busy} className={btn.primary}>Save</button>
            <button type="button" className={btn.secondary} onClick={() => setEdit(null)}>Close</button>
          </div>
          {edit.id && <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>}
        </form>
      ) : (
        <button className={btn.secondary} onClick={() => setEdit({ type: "bank" })}>Add account</button>
      )}
      <Msg />
    </div>
  );
}

type U = { id: number; name: string; username: string; role: "owner" | "staff"; active: boolean; lastLoginAt: string | null };

export function UsersEditor({ users, meId }: { users: U[]; meId: number }) {
  const { busy, run, Msg } = useSave();
  const [edit, setEdit] = useState<(Partial<U> & { password?: string }) | null>(null);
  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted"><th className="py-1.5">Name</th><th>Login</th><th>Role</th><th>Last sign-in</th><th /></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={`border-t border-rule/70 ${u.active ? "" : "text-muted"}`}>
              <td className="py-2">{u.name}{u.id === meId && " (you)"}{!u.active && " (disabled)"}</td><td>{u.username}</td><td className="capitalize">{u.role}</td>
              <td className="text-xs">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Never"}</td>
              <td className="text-right"><button className={btn.ghost} onClick={() => setEdit({ ...u, password: "" })}>Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit ? (
        <form className="grid gap-2 rounded-md border border-rule p-3 sm:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() => saveUserAction({ name: edit.name ?? "", username: edit.username ?? "", role: edit.role ?? "staff", password: edit.password ?? "", active: edit.active ?? true }, edit.id), edit.id ? "User updated." : "User added. Share the login with them.");
          if (ok) setEdit(null);
        }}>
          <div><label className={label} htmlFor="un">Name</label><input id="un" required value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={input} /></div>
          <div><label className={label} htmlFor="ul">Login</label><input id="ul" required autoCapitalize="none" value={edit.username ?? ""} onChange={(e) => setEdit({ ...edit, username: e.target.value })} className={input} /></div>
          <div>
            <label className={label} htmlFor="ur">Role</label>
            <select id="ur" value={edit.role ?? "staff"} onChange={(e) => setEdit({ ...edit, role: e.target.value as "owner" | "staff" })} className={input}>
              <option value="staff">Staff — enters bills and payments; can&rsquo;t see cost or profit, cancel, or export</option>
              <option value="owner">Owner — everything</option>
            </select>
          </div>
          <div><label className={label} htmlFor="up">{edit.id ? "New password (leave blank to keep)" : "Password"}</label><input id="up" type="password" autoComplete="new-password" minLength={edit.id ? undefined : 8} required={!edit.id} value={edit.password ?? ""} onChange={(e) => setEdit({ ...edit, password: e.target.value })} className={input} /></div>
          {edit.id && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Can sign in</label>}
          <div className="flex gap-2 sm:col-span-2">
            <button disabled={busy} className={btn.primary}>{edit.id ? "Save user" : "Add user"}</button>
            <button type="button" className={btn.secondary} onClick={() => setEdit(null)}>Close</button>
          </div>
        </form>
      ) : (
        <button className={btn.secondary} onClick={() => setEdit({ role: "staff", active: true })}>Add user</button>
      )}
      <Msg />
    </div>
  );
}
