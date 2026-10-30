import Link from "next/link";
import { D, formatIndian, formatQty, type Num } from "@/lib/calc";

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink-2 disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-md border border-rule bg-surface px-3.5 py-2 text-sm font-medium text-text hover:bg-ink-tint disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-md border border-madder/30 bg-surface px-3.5 py-2 text-sm font-medium text-madder hover:bg-madder-tint disabled:opacity-50",
  ghost: "inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-ink hover:bg-ink-tint",
};

export const input =
  "w-full rounded-md border border-rule bg-surface px-3 py-2 text-sm text-text placeholder:text-muted/70 focus:border-ink-2 focus:outline-none focus:ring-2 focus:ring-ink-2/20 disabled:bg-paper";
export const label = "mb-1 block text-[13px] font-medium text-muted";

export function PageHeader({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-text">{title}</h1>
        {sub && <div className="mt-0.5 text-sm text-muted">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, action, children, className = "", pad = true }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`rounded-lg border border-rule bg-surface ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          {action}
        </div>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

/** ₹ amount with Indian grouping. `tone` colours dues/receipts. */
export function Money({ v, decimals = 0, tone, className = "" }: { v: Num | null | undefined; decimals?: number; tone?: "auto" | "due" | "in"; className?: string }) {
  const d = D(v ?? 0);
  const color = tone === "due" ? "text-madder" : tone === "in" ? "text-leaf" : tone === "auto" ? (d.isNeg() ? "text-madder" : "") : "";
  return <span className={`num whitespace-nowrap ${color} ${className}`}>{d.isNeg() ? "−" : ""}₹{formatIndian(d.abs(), decimals)}</span>;
}

/** Party balance shown as "Dr/Cr" the way registers do: Dr = they owe us. */
export function Balance({ v, className = "" }: { v: Num; className?: string }) {
  const d = D(v);
  if (d.isZero()) return <span className={`num text-muted ${className}`}>Settled</span>;
  return (
    <span className={`num whitespace-nowrap ${d.gt(0) ? "text-madder" : "text-ink"} ${className}`}>
      ₹{formatIndian(d.abs(), 0)} <span className="text-xs font-medium">{d.gt(0) ? "to receive" : "to pay"}</span>
    </span>
  );
}

export function Qty({ v, unit }: { v: Num; unit?: string }) {
  return (
    <span className="num whitespace-nowrap">
      {formatQty(v)}
      {unit ? <span className="text-muted"> {unit}</span> : null}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "due" | "warn" | "ok" | "ink" }) {
  const t = {
    neutral: "bg-paper text-muted border-rule",
    due: "bg-madder-tint text-madder border-madder/20",
    warn: "bg-turmeric-tint text-turmeric border-turmeric/20",
    ok: "bg-leaf-tint text-leaf border-leaf/20",
    ink: "bg-ink-tint text-ink border-ink/15",
  }[tone];
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="font-medium text-text">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Table({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`max-w-full overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
export const th = "border-b border-rule bg-paper/60 px-3 py-2 text-left text-xs font-semibold text-muted whitespace-nowrap";
export const thR = `${th} text-right`;
export const td = "border-b border-rule/70 px-3 py-2 align-top";
export const tdR = `${td} text-right num`;

export function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-ink hover:underline">
      {children}
    </Link>
  );
}

/** GET-form filter bar: search + date range + extra selects. Works without JavaScript. */
export function Filters({ children, q, from, to, placeholder = "Search" }: { children?: React.ReactNode; q?: string; from?: string; to?: string; placeholder?: string }) {
  return (
    <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
      {q !== undefined && (
        <div className="min-w-48 flex-1">
          <label className={label} htmlFor="q">
            Search
          </label>
          <input id="q" name="q" defaultValue={q} placeholder={placeholder} className={input} />
        </div>
      )}
      {from !== undefined && (
        <div>
          <label className={label} htmlFor="from">
            From
          </label>
          <input id="from" type="date" name="from" defaultValue={from} className={input} />
        </div>
      )}
      {to !== undefined && (
        <div>
          <label className={label} htmlFor="to">
            To
          </label>
          <input id="to" type="date" name="to" defaultValue={to} className={input} />
        </div>
      )}
      {children}
      <button className={btn.secondary}>Apply</button>
    </form>
  );
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

export function fmtDateTime(ts: string | Date) {
  const d = new Date(ts);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export const KIND_LABEL: Record<string, string> = { sale: "Sale", purchase: "Purchase", sale_return: "Sale return", purchase_return: "Purchase return" };

// ───────────────────────── Navigation helpers (server-safe) ─────────────────────────

/** Builds a URL keeping only non-empty params. */
export function hrefWith(base: string, params: Record<string, string | number | undefined | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/** Sub-tabs inside a main tab (links, so they work without JavaScript and keep their own URL). */
export function Segmented({ items, label: aria }: { items: { href: string; label: string; active: boolean; count?: number }[]; label: string }) {
  return (
    <nav aria-label={aria} className="mb-4 flex gap-1 overflow-x-auto border-b border-rule">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          scroll={false}
          aria-current={i.active ? "page" : undefined}
          className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors ${i.active ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-text"}`}
        >
          {i.label}
          {i.count !== undefined && i.count > 0 && <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] ${i.active ? "bg-ink text-white" : "bg-rule text-muted"}`}>{i.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Pill filters. */
export function Chips({ items, label: aria }: { items: { href: string; label: string; active: boolean }[]; label: string }) {
  return (
    <div role="group" aria-label={aria} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
      {items.map((i) => (
        <Link
          key={i.href + i.label}
          href={i.href}
          scroll={false}
          aria-current={i.active ? "true" : undefined}
          className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] transition-colors ${i.active ? "border-ink bg-ink text-white" : "border-rule bg-surface text-text hover:border-ink/40"}`}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}

export type PeriodKey = "today" | "7d" | "month" | "fy" | "custom";
export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "month", label: "This month" },
  { key: "fy", label: "This year" },
  { key: "custom", label: "Pick dates" },
];

/** Search box + period pills. `keep` = params to preserve (view, status…). */
export function ListToolbar({
  base,
  keep,
  period,
  q,
  placeholder = "Search",
  showPeriod = true,
}: {
  base: string;
  keep: Record<string, string | undefined>;
  period?: { key: PeriodKey; from: string; to: string };
  q: string;
  placeholder?: string;
  showPeriod?: boolean;
}) {
  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <form role="search" className="relative w-full sm:w-auto sm:min-w-52 sm:max-w-sm sm:flex-1">
          {Object.entries({ ...keep, p: period?.key, from: period?.key === "custom" ? period.from : undefined, to: period?.key === "custom" ? period.to : undefined })
            .filter(([, v]) => v)
            .map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label htmlFor="q" className="sr-only">Search</label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder={placeholder} className={`${input} pl-8`} />
          <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="9" r="6" /><path d="m14 14 4 4" /></svg>
        </form>
        {showPeriod && period && (
          <Chips
            label="Period"
            items={PERIODS.map((p) => ({ label: p.label, active: p.key === period.key, href: hrefWith(base, { ...keep, q, p: p.key, ...(p.key === "custom" ? { from: period.from, to: period.to } : {}) }) }))}
          />
        )}
      </div>
      {showPeriod && period?.key === "custom" && (
        <form className="flex flex-wrap items-end gap-2">
          {Object.entries({ ...keep, q, p: "custom" }).filter(([, v]) => v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <div><label className={label} htmlFor="from">From</label><input id="from" type="date" name="from" defaultValue={period.from} className={input} /></div>
          <div><label className={label} htmlFor="to">To</label><input id="to" type="date" name="to" defaultValue={period.to} className={input} /></div>
          <button className={btn.secondary}>Show</button>
        </form>
      )}
    </div>
  );
}

export function Stat({ label: l, value, note, href, tone }: { label: string; value: React.ReactNode; note?: React.ReactNode; href?: string; tone?: "due" }) {
  const body = (
    <>
      <div className="text-[13px] text-muted">{l}</div>
      <div className={`mt-1 text-2xl font-semibold tracking-tight ${tone === "due" ? "text-madder" : ""}`}>{value}</div>
      {note && <div className="mt-0.5 text-xs text-muted">{note}</div>}
    </>
  );
  const cls = "block rounded-lg border border-rule bg-surface px-4 py-3";
  return href ? <Link href={href} className={`${cls} transition-colors hover:border-ink/40`}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Phone layout for lists: one tappable card per row (tables are shown from md up). */
export function CardList({ items }: { items: { key: string | number; href?: string; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; rightSub?: React.ReactNode; action?: React.ReactNode; muted?: boolean }[] }) {
  return (
    <ul className="divide-y divide-rule/70 md:hidden">
      {items.map((i) => {
        const body = (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-medium">{i.title}</div>
              {i.sub && <div className="mt-0.5 text-xs text-muted">{i.sub}</div>}
            </div>
            <div className="shrink-0 text-right">
              <div className="font-semibold">{i.right}</div>
              {i.rightSub && <div className="mt-0.5 text-xs">{i.rightSub}</div>}
            </div>
          </div>
        );
        return (
          <li key={i.key} className={`px-4 py-3 ${i.muted ? "text-muted" : ""}`}>
            {i.href ? <Link href={i.href} className="block">{body}</Link> : body}
            {i.action && <div className="mt-2 flex justify-end gap-2">{i.action}</div>}
          </li>
        );
      })}
    </ul>
  );
}
