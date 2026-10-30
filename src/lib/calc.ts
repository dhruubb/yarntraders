/**
 * Pure money/quantity math shared by the browser (live totals) and the server (source of truth).
 * The server always recomputes from raw inputs — totals sent by a browser are never trusted.
 *
 * Yarn rates in the registers are quoted per a unit that is NOT the bag:
 *   30s Amrut   "40 × 1258"  → 40 bags × 50 kg ÷ 5 × ₹1,258 = ₹5,03,200   (rate per 5 kg)
 *   58 Silver   "12 × 238"   → 12 bags × 64 kg × ₹238       = ₹1,82,784   (rate per kg)
 * so every line converts bags → kg → rate units.
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type RateBasis = "per_5kg" | "per_kg" | "per_bag" | "per_lb";

export const RATE_BASIS_LABEL: Record<RateBasis, string> = {
  per_5kg: "per 5 kg",
  per_kg: "per kg",
  per_bag: "per bag",
  per_lb: "per lb",
};

export const KG_PER_LB = new Decimal("0.45359237");

export type Num = Decimal.Value;
export const D = (v: Num | null | undefined) => new Decimal(v === null || v === undefined || v === "" ? 0 : v);

export const round2 = (v: Num) => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export const round3 = (v: Num) => D(v).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
export const round4 = (v: Num) => D(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

/** How many rate-units a line contains. */
export function rateUnits(basis: RateBasis, bags: Num, kg: Num): Decimal {
  switch (basis) {
    case "per_5kg":
      return D(kg).div(5);
    case "per_kg":
      return D(kg);
    case "per_bag":
      return D(bags);
    case "per_lb":
      return D(kg).div(KG_PER_LB);
  }
}

export function lineKg(bags: Num, bagWeightKg: Num, kgOverride?: Num | null): Decimal {
  if (kgOverride !== undefined && kgOverride !== null && kgOverride !== "" && D(kgOverride).gt(0)) return round3(kgOverride);
  return round3(D(bags).mul(bagWeightKg));
}

export function lineAmount(basis: RateBasis, bags: Num, kg: Num, rate: Num): Decimal {
  return round2(rateUnits(basis, bags, kg).mul(rate));
}

/** Rate in ₹/kg for a given basis, used to compare a sale price with average cost. */
export function ratePerKg(basis: RateBasis, rate: Num, bags: Num, kg: Num): Decimal {
  if (D(kg).isZero()) return D(0);
  return lineAmount(basis, bags, kg, rate).div(kg);
}

export type CalcLineInput = {
  bags: Num;
  bagWeightKg: Num;
  kgOverride?: Num | null;
  rate: Num;
  rateBasis: RateBasis;
  gstRate: Num;
};

export type CalcLine = {
  bags: Decimal;
  kg: Decimal;
  amount: Decimal;
  taxable: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
};

export type CalcInvoice = {
  lines: CalcLine[];
  linesAmount: Decimal;
  freight: Decimal;
  discount: Decimal;
  taxable: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  beforeRound: Decimal;
  roundOff: Decimal;
  total: Decimal;
};

/**
 * Invoice math:
 *  1. line amount = rate × rate-units (bags → kg → units)
 *  2. invoice freight (+) and discount (−) are spread over lines in proportion to amount
 *     (the last line takes the rounding remainder) → line taxable value
 *  3. GST per line on taxable value: CGST+SGST (half each) within the state, IGST across states
 *  4. grand total rounded to the nearest rupee; difference shown as round-off
 */
export function computeInvoice(input: {
  lines: CalcLineInput[];
  freight?: Num;
  discount?: Num;
  interstate: boolean;
}): CalcInvoice {
  const freight = round2(input.freight ?? 0);
  const discount = round2(input.discount ?? 0);
  const base = input.lines.map((l) => {
    const bags = round3(l.bags);
    const kg = lineKg(bags, l.bagWeightKg, l.kgOverride);
    const amount = lineAmount(l.rateBasis, bags, kg, l.rate);
    return { bags, kg, amount, gstRate: D(l.gstRate) };
  });
  const linesAmount = base.reduce((s, l) => s.add(l.amount), D(0));
  const adjust = freight.sub(discount);

  let allocated = D(0);
  const lines: CalcLine[] = base.map((l, i) => {
    let share: Decimal;
    if (adjust.isZero() || linesAmount.isZero()) share = D(0);
    else if (i === base.length - 1) share = adjust.sub(allocated);
    else share = round2(adjust.mul(l.amount).div(linesAmount));
    allocated = allocated.add(share);
    const taxable = l.amount.add(share);
    let cgst = D(0),
      sgst = D(0),
      igst = D(0);
    if (input.interstate) igst = round2(taxable.mul(l.gstRate).div(100));
    else {
      cgst = round2(taxable.mul(l.gstRate).div(200));
      sgst = cgst;
    }
    return { bags: l.bags, kg: l.kg, amount: l.amount, taxable, cgst, sgst, igst };
  });

  const taxable = lines.reduce((s, l) => s.add(l.taxable), D(0));
  const cgst = lines.reduce((s, l) => s.add(l.cgst), D(0));
  const sgst = lines.reduce((s, l) => s.add(l.sgst), D(0));
  const igst = lines.reduce((s, l) => s.add(l.igst), D(0));
  const beforeRound = taxable.add(cgst).add(sgst).add(igst);
  const total = beforeRound.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return { lines, linesAmount, freight, discount, taxable, cgst, sgst, igst, beforeRound, roundOff: total.sub(beforeRound), total };
}

/** Indian digit grouping: 4082400 → "40,82,400". */
export function formatIndian(v: Num, decimals = 2): string {
  const d = D(v);
  const neg = d.isNeg();
  const fixed = d.abs().toFixed(decimals);
  const [int, frac] = fixed.split(".");
  let out: string;
  if (int.length <= 3) out = int;
  else {
    const last3 = int.slice(-3);
    const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    out = `${rest},${last3}`;
  }
  return `${neg ? "-" : ""}${out}${frac ? "." + frac : ""}`;
}

export const inr = (v: Num, decimals = 2) => `₹${formatIndian(v, decimals)}`;

export function formatQty(v: Num, decimals = 3): string {
  const d = D(v);
  const s = formatIndian(d, decimals);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`;
}
function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? twoDigits(r) : ""].filter(Boolean).join(" ");
}

/** 455777 → "Four Lakh Fifty Five Thousand Seven Hundred Seventy Seven Rupees Only" */
export function amountInWords(v: Num): string {
  const d = round2(v);
  let rupees = d.trunc().toNumber();
  const paise = d.sub(d.trunc()).mul(100).toNumber();
  if (rupees === 0 && paise === 0) return "Zero Rupees Only";
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10000000);
  rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000);
  rupees %= 100000;
  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;
  if (crore) parts.push(`${crore >= 100 ? threeDigits(crore) : twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rupees) parts.push(threeDigits(rupees));
  let s = parts.join(" ");
  s = s ? `${s} Rupees` : "";
  if (paise) s += `${s ? " and " : ""}${twoDigits(Math.round(paise))} Paise`;
  return `${s} Only`;
}

/** Indian financial year label for a YYYY-MM-DD date: 2026-10-29 → "2026-27". */
export function financialYear(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

/** Today's date in India (the business timezone), as YYYY-MM-DD. */
export function todayIST(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
}
