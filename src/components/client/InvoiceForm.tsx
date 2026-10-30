"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { postInvoiceAction } from "@/app/actions";
import { D, computeInvoice, formatIndian, formatQty, lineKg, rateUnits, RATE_BASIS_LABEL, addDays, KG_PER_LB, type RateBasis } from "@/lib/calc";
import { btn, input, label } from "@/components/ui";
import { Combobox } from "./Combobox";

export type PartyOpt = { id: number; name: string; city: string; stateCode: string; creditDays: number; balance: string };
export type ProductOpt = { id: number; name: string; bagWeightKg: string; rateBasis: RateBasis; gstRate: string; stockBags: string; lastRate: string | null };

type Line = { key: number; productId: number | null; bags: string; kg: string; rate: string; lotNo: string };

const newKey = () => Math.floor(Math.random() * 1e9);
const emptyLine = (): Line => ({ key: newKey(), productId: null, bags: "", kg: "", rate: "", lotNo: "" });

export function InvoiceForm({
  kind,
  parties,
  products,
  businessStateCode,
  today,
  initialPartyId,
}: {
  kind: "sale" | "purchase";
  parties: PartyOpt[];
  products: ProductOpt[];
  businessStateCode: string;
  today: string;
  initialPartyId?: number;
}) {
  const router = useRouter();
  const [partyId, setPartyId] = useState<number | null>(initialPartyId ?? null);
  const [date, setDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [billNo, setBillNo] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [freight, setFreight] = useState("");
  const [discount, setDiscount] = useState("");
  const [agent, setAgent] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dup, setDup] = useState<string | null>(null);
  const [idemKey] = useState(() => crypto.randomUUID());
  const productRefs = useRef(new Map<number, HTMLInputElement | null>());

  const party = parties.find((p) => p.id === partyId) ?? null;
  const prodMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const interstate = party ? party.stateCode !== businessStateCode : false;
  const autoDue = party && date ? addDays(date, party.creditDays) : "";

  const valid = lines.filter((l) => l.productId && Number(l.bags) > 0 && l.rate !== "" && Number(l.rate) >= 0);
  const calc = useMemo(() => {
    try {
      return computeInvoice({
        lines: valid.map((l) => {
          const p = prodMap.get(l.productId!)!;
          return { bags: l.bags, bagWeightKg: p.bagWeightKg, kgOverride: l.kg || null, rate: l.rate, rateBasis: p.rateBasis, gstRate: p.gstRate };
        }),
        freight: freight || 0,
        discount: discount || 0,
        interstate,
      });
    } catch {
      return null;
    }
  }, [valid, prodMap, freight, discount, interstate]);

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => {
    const l = emptyLine();
    setLines((ls) => [...ls, l]);
    setTimeout(() => productRefs.current.get(l.key)?.focus(), 0);
  };

  async function submit(confirmDuplicate = false) {
    setError(null);
    if (!partyId) return setError("Pick a party.");
    if (valid.length === 0) return setError("Add at least one line with product, bags and rate.");
    const incomplete = lines.filter((l) => (l.productId || l.bags || l.rate) && !valid.includes(l));
    if (incomplete.length) return setError("One line is missing its product, bags or rate. Fill it in or remove it.");
    setBusy(true);
    const r = await postInvoiceAction({
      kind,
      partyId,
      date,
      dueDate: dueDate || "",
      supplierBillNo: billNo,
      freight: Number(freight || 0),
      discount: Number(discount || 0),
      agent,
      notes,
      idempotencyKey: idemKey,
      confirmDuplicate,
      lines: valid.map((l) => ({ productId: l.productId!, bags: Number(l.bags), kg: l.kg === "" ? "" : Number(l.kg), rate: Number(l.rate), lotNo: l.lotNo })),
    });
    setBusy(false);
    if (r.ok) {
      const w = r.data.warnings?.length ? `&w=${encodeURIComponent(r.data.warnings.join(" | "))}` : "";
      router.push(`/invoices/${r.data.invoiceId}?posted=1${kind === "purchase" ? "&tab=purchases" : ""}${w}`);
      return;
    }
    if (r.code === "possible_duplicate") setDup(r.error);
    else setError(r.error);
  }

  const noun = kind === "sale" ? "sale" : "purchase";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          submit();
        }
      }}
      className="space-y-4"
    >
      <section className="grid gap-3 rounded-lg border border-rule bg-surface p-4 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <label className={label} htmlFor="party">{kind === "sale" ? "Customer" : "Supplier"}</label>
          <Combobox
            id="party"
            autoFocus={!initialPartyId}
            options={parties.map((p) => ({ value: p.id, label: p.name, hint: p.city }))}
            value={partyId}
            onChange={setPartyId}
            placeholder="Type a name"
          />
          {party && (
            <p className="mt-1 text-xs text-muted">
              {D(party.balance).isZero() ? "No balance" : D(party.balance).gt(0) ? `Owes you ₹${formatIndian(party.balance, 0)}` : `You owe ₹${formatIndian(D(party.balance).abs(), 0)}`}
              {" · "}
              {interstate ? "Other state: IGST" : "Same state: CGST + SGST"}
            </p>
          )}
        </div>
        <div>
          <label className={label} htmlFor="date">Date</label>
          <input id="date" type="date" required value={date} max={addDays(today, 1)} onChange={(e) => setDate(e.target.value)} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="due">Due date</label>
          <input id="due" type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} className={input} />
          {!dueDate && autoDue && <p className="mt-1 text-xs text-muted">Auto: {party?.creditDays} days credit</p>}
        </div>
        {kind === "purchase" ? (
          <div>
            <label className={label} htmlFor="bill">Supplier bill no.</label>
            <input id="bill" value={billNo} onChange={(e) => setBillNo(e.target.value)} className={input} placeholder="Optional" />
          </div>
        ) : (
          <div>
            <label className={label} htmlFor="agent">Agent / broker</label>
            <input id="agent" value={agent} onChange={(e) => setAgent(e.target.value)} className={input} placeholder="Optional" />
          </div>
        )}
      </section>

      <section className="rounded-lg border border-rule bg-surface">
        <div className="hidden grid-cols-[minmax(180px,2.2fr)_90px_110px_130px_100px_130px_36px] gap-2 border-b border-rule px-4 py-2 text-xs font-semibold text-muted md:grid">
          <span>Yarn (count + brand)</span>
          <span className="text-right">Bags</span>
          <span className="text-right">Weight kg</span>
          <span className="text-right">Rate</span>
          <span>Lot</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        <ol>
          {lines.map((l, idx) => {
            const p = l.productId ? prodMap.get(l.productId) : undefined;
            const stdKg = p && Number(l.bags) > 0 ? lineKg(l.bags, p.bagWeightKg) : null;
            const kg = p && Number(l.bags) > 0 ? lineKg(l.bags, p.bagWeightKg, l.kg || null) : null;
            const amt = p && kg && l.rate !== "" ? rateUnits(p.rateBasis, l.bags, kg).mul(l.rate || 0).toDecimalPlaces(2) : null;
            const short = kind === "sale" && p && Number(l.bags) > Number(p.stockBags);
            return (
              <li key={l.key} className="border-b border-rule/70 px-4 py-3 last:border-0">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(180px,2.2fr)_90px_110px_130px_100px_130px_36px] md:items-start">
                  <div className="col-span-2 md:col-span-1">
                    <label className="sr-only" htmlFor={`p-${l.key}`}>Yarn for line {idx + 1}</label>
                    <Combobox
                      id={`p-${l.key}`}
                      inputRef={(el) => {
                        productRefs.current.set(l.key, el);
                      }}
                      options={products.map((o) => ({ value: o.id, label: o.name, hint: kind === "sale" ? `${formatQty(o.stockBags)} bags` : RATE_BASIS_LABEL[o.rateBasis] }))}
                      value={l.productId}
                      onChange={(v) => {
                        const np = v ? prodMap.get(v) : undefined;
                        update(l.key, { productId: v, rate: l.rate || (np?.lastRate ? String(Number(np.lastRate)) : "") });
                      }}
                      placeholder="e.g. 30 Amrut"
                    />
                  </div>
                  <Num id={`b-${l.key}`} label="Bags" value={l.bags} onChange={(v) => update(l.key, { bags: v })} invalid={!!short} />
                  <Num id={`k-${l.key}`} label="Weight kg" value={l.kg} onChange={(v) => update(l.key, { kg: v })} placeholder={stdKg ? formatQty(stdKg) : "auto"} />
                  <Num
                    id={`r-${l.key}`}
                    label={p ? `Rate ${RATE_BASIS_LABEL[p.rateBasis]}` : "Rate"}
                    value={l.rate}
                    onChange={(v) => update(l.key, { rate: v })}
                    onEnter={idx === lines.length - 1 ? addLine : undefined}
                    suffix={p ? RATE_BASIS_LABEL[p.rateBasis].replace("per ", "/") : undefined}
                  />
                  <div>
                    <label className="mb-1 block text-xs text-muted md:sr-only" htmlFor={`lot-${l.key}`}>Lot</label>
                    <input id={`lot-${l.key}`} value={l.lotNo} onChange={(e) => update(l.key, { lotNo: e.target.value })} className={input} placeholder="—" />
                  </div>
                  <div className="flex items-center justify-end self-center text-right">
                    <span className="num text-[15px] font-semibold">{amt ? `₹${formatIndian(amt, 2)}` : "—"}</span>
                  </div>
                  <div className="col-span-2 flex justify-end md:col-span-1">
                    <button
                      type="button"
                      onClick={() => setLines((ls) => (ls.length === 1 ? [emptyLine()] : ls.filter((x) => x.key !== l.key)))}
                      className="rounded p-1.5 text-muted hover:bg-madder-tint hover:text-madder"
                      aria-label={`Remove line ${idx + 1}`}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
                {p && kg && (
                  <p className="num mt-1.5 text-[13px] text-muted">
                    {formatQty(l.bags)} bags × {formatQty(l.kg ? D(l.kg).div(l.bags) : p.bagWeightKg)} kg = <b className="font-semibold text-text">{formatQty(kg)} kg</b>
                    {l.rate !== "" && (
                      <>
                        {"  ·  "}
                        {p.rateBasis === "per_5kg" && <>{formatQty(kg)} ÷ 5 × ₹{formatIndian(l.rate)}</>}
                        {p.rateBasis === "per_kg" && <>{formatQty(kg)} kg × ₹{formatIndian(l.rate)}</>}
                        {p.rateBasis === "per_bag" && <>{formatQty(l.bags)} bags × ₹{formatIndian(l.rate)}</>}
                        {p.rateBasis === "per_lb" && <>{formatQty(kg.div(KG_PER_LB).toDecimalPlaces(2))} lb × ₹{formatIndian(l.rate)}</>}
                        {" = "}
                        <b className="font-semibold text-text">₹{formatIndian(amt ?? 0)}</b>
                      </>
                    )}
                    {kind === "sale" && (
                      <span className={short ? "ml-2 font-medium text-madder" : "ml-2"}>
                        {short ? `Only ${formatQty(p.stockBags)} bags in stock` : `${formatQty(p.stockBags)} bags in stock`}
                      </span>
                    )}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <div className="border-t border-rule px-4 py-2.5">
          <button type="button" onClick={addLine} className={btn.ghost}>
            <Plus size={16} /> Add line
          </button>
          <span className="ml-2 text-xs text-muted">Enter in the last rate box also adds a line</span>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="grid content-start gap-3 rounded-lg border border-rule bg-surface p-4 sm:grid-cols-2">
          <Num alwaysLabel id="freight" label="Freight / other charges (₹)" value={freight} onChange={setFreight} />
          <Num alwaysLabel id="discount" label="Discount (₹)" value={discount} onChange={setDiscount} />
          {kind === "purchase" && (
            <div className="sm:col-span-2">
              <label className={label} htmlFor="agent">Agent / broker</label>
              <input id="agent" value={agent} onChange={(e) => setAgent(e.target.value)} className={input} placeholder="Optional" />
            </div>
          )}
          <div className="sm:col-span-2">
            <label className={label} htmlFor="notes">Notes</label>
            <textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={input} placeholder="Vehicle no., transporter, remarks" />
          </div>
          <p className="text-xs text-muted sm:col-span-2">Freight and discount are spread over the lines before GST, so tax stays correct.</p>
        </section>

        <section className="rounded-lg border border-ink/20 bg-surface p-4" aria-live="polite">
          <dl className="num space-y-1.5 text-sm">
            <Row k="Lines" v={calc?.linesAmount} />
            {calc && !calc.freight.isZero() && <Row k="Freight" v={calc.freight} />}
            {calc && !calc.discount.isZero() && <Row k="Discount" v={calc.discount.neg()} />}
            <Row k="Taxable value" v={calc?.taxable} strong />
            {interstate ? <Row k="IGST" v={calc?.igst} /> : (<><Row k="CGST" v={calc?.cgst} /><Row k="SGST" v={calc?.sgst} /></>)}
            {calc && !calc.roundOff.isZero() && <Row k="Round off" v={calc.roundOff} />}
          </dl>
          <div className="mt-3 flex items-baseline justify-between border-t border-rule pt-3">
            <span className="text-sm font-medium text-muted">Bill total</span>
            <span className="num text-2xl font-semibold tracking-tight">₹{formatIndian(calc?.total ?? 0, 0)}</span>
          </div>
          {error && <p role="alert" className="mt-3 rounded-md bg-madder-tint px-3 py-2 text-sm text-madder">{error}</p>}
          {dup ? (
            <div role="alert" className="mt-3 rounded-md border border-turmeric/30 bg-turmeric-tint p-3 text-sm text-turmeric">
              <p className="font-medium">{dup}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" className={btn.secondary} onClick={() => setDup(null)}>Go back</button>
                <button type="button" className={btn.primary} disabled={busy} onClick={() => { setDup(null); submit(true); }}>
                  Post anyway
                </button>
              </div>
            </div>
          ) : (
            <button disabled={busy} className={`${btn.primary} mt-4 w-full py-2.5 text-[15px]`}>
              {busy ? "Posting…" : `Post ${noun}`}
            </button>
          )}
          <p className="mt-2 text-center text-xs text-muted">Ctrl + Enter to post. Posted bills can be cancelled, not edited.</p>
        </section>
      </div>
    </form>
  );
}

function Row({ k, v, strong }: { k: string; v?: ReturnType<typeof D> | null; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold" : ""}`}>
      <dt className={strong ? "" : "text-muted"}>{k}</dt>
      <dd>{v && v.isNeg() ? "−" : ""}₹{formatIndian(v ? v.abs() : 0, 2)}</dd>
    </div>
  );
}

export function Num({
  id,
  label: lab,
  value,
  onChange,
  placeholder,
  invalid,
  onEnter,
  suffix,
  alwaysLabel,
}: {
  alwaysLabel?: boolean;
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  onEnter?: () => void;
  suffix?: string;
}) {
  return (
    <div>
      <label className={alwaysLabel ? label : "mb-1 block text-xs text-muted md:sr-only"} htmlFor={id}>{lab}</label>
      <div className="relative">
        <input
          id={id}
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d.]/g, "");
            if (/^\d*\.?\d*$/.test(v)) onChange(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              onEnter();
            }
          }}
          aria-invalid={invalid || undefined}
          className={`${input} num text-right ${suffix ? "pr-11" : ""} ${invalid ? "border-madder text-madder" : ""}`}
        />
        {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted">{suffix}</span>}
      </div>
    </div>
  );
}
