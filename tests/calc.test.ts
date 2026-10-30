import { describe, expect, it } from "vitest";
import { amountInWords, computeInvoice, financialYear, formatIndian, lineAmount, lineKg } from "@/lib/calc";

const sale = (bags: number, bagKg: number, rate: number, basis: "per_5kg" | "per_kg" | "per_bag" = "per_5kg") =>
  lineAmount(basis, bags, lineKg(bags, bagKg), rate).toNumber();

describe("register math (from the client's sale register photo)", () => {
  it.each([
    ["Khalid B.R — 30 Amrut 40 × 1258", sale(40, 50, 1258), 503200],
    ["Abid Dost — 47 VPN 150 × 1745", sale(150, 60, 1745), 3141000],
    ["Abid Dost — 47 VPN 150 × 1750", sale(150, 60, 1750), 3150000],
    ["Salim Siddiq — 47 VPN 10 × 1665", sale(10, 60, 1665), 199800],
    ["Gani Textiles — 41 Divakar 22 × 1612", sale(22, 60, 1612), 425568],
    ["Shoid Noble — 30 Gajraj 20 × 1195", sale(20, 50, 1195), 239000],
    ["Nidhi Traders — 58 Silver 12 × 238 /kg", sale(12, 64, 238, "per_kg"), 182784],
    ["Khalid Bhikku — 30 Amrut 30 × 1210", sale(30, 50, 1210), 363000],
    ["Master Fabrics — 30 Patiala 10 × 1190", sale(10, 50, 1190), 119000],
  ])("%s", (_l, got, want) => expect(got).toBe(want));

  it("Javid Sandip — 32 Rameshwar 32 × 1570 on a 45.36 kg bag rounds to ₹4,55,777", () => {
    const r = computeInvoice({ lines: [{ bags: 32, bagWeightKg: 45.36, rate: 1570, rateBasis: "per_5kg", gstRate: 0 }], interstate: false });
    expect(r.lines[0].amount.toFixed(2)).toBe("455777.28");
    expect(r.total.toNumber()).toBe(455777);
    expect(r.roundOff.toFixed(2)).toBe("-0.28");
  });
});

describe("purchase register amounts include 5% GST", () => {
  it("Shrenik Shah — 48 bags 58 Silverspring at ₹238/kg → ₹7,67,693", () => {
    const r = computeInvoice({ lines: [{ bags: 48, bagWeightKg: 64, rate: 238, rateBasis: "per_kg", gstRate: 5 }], interstate: false });
    expect(r.taxable.toFixed(2)).toBe("731136.00");
    expect(r.cgst.toFixed(2)).toBe("18278.40");
    expect(r.total.toNumber()).toBe(767693);
  });
  it("Suresh Bucha — 200 bags 47 VPN at ₹1,620 per 5 kg, interstate IGST → ₹40,82,400", () => {
    const r = computeInvoice({ lines: [{ bags: 200, bagWeightKg: 60, rate: 1620, rateBasis: "per_5kg", gstRate: 5 }], interstate: true });
    expect(r.igst.toFixed(2)).toBe("194400.00");
    expect(r.cgst.toNumber()).toBe(0);
    expect(r.total.toNumber()).toBe(4082400);
  });
  it("Selvraj — 25 bags 63 Kumran at ₹13,500/bag → ₹3,54,375", () => {
    const r = computeInvoice({ lines: [{ bags: 25, bagWeightKg: 50, rate: 13500, rateBasis: "per_bag", gstRate: 5 }], interstate: false });
    expect(r.total.toNumber()).toBe(354375);
  });
});

describe("invoice adjustments", () => {
  it("spreads freight and discount over lines by amount and keeps totals exact", () => {
    const r = computeInvoice({
      lines: [
        { bags: 10, bagWeightKg: 50, rate: 1258, rateBasis: "per_5kg", gstRate: 5 },
        { bags: 3, bagWeightKg: 64, rate: 238, rateBasis: "per_kg", gstRate: 5 },
      ],
      freight: 1000,
      discount: 333.33,
      interstate: false,
    });
    expect(r.linesAmount.toFixed(2)).toBe("171496.00");
    expect(r.taxable.toFixed(2)).toBe("172162.67");
    expect(r.lines.reduce((s, l) => s + l.taxable.toNumber(), 0)).toBeCloseTo(172162.67, 2);
    expect(r.total.toNumber()).toBe(Math.round(r.beforeRound.toNumber()));
  });
  it("uses the weighed kg when given instead of standard bag weight", () => {
    const r = computeInvoice({ lines: [{ bags: 10, bagWeightKg: 50, kgOverride: 498.5, rate: 1258, rateBasis: "per_5kg", gstRate: 0 }], interstate: false });
    expect(r.lines[0].kg.toNumber()).toBe(498.5);
    expect(r.total.toNumber()).toBe(125423);
  });
});

describe("formatting", () => {
  it("formats Indian digit groups", () => {
    expect(formatIndian(4082400, 0)).toBe("40,82,400");
    expect(formatIndian(123, 2)).toBe("123.00");
    expect(formatIndian(-12345678.5, 2)).toBe("-1,23,45,678.50");
  });
  it("writes amounts in words", () => {
    expect(amountInWords(455777)).toBe("Four Lakh Fifty Five Thousand Seven Hundred Seventy Seven Rupees Only");
    expect(amountInWords(31410000)).toBe("Three Crore Fourteen Lakh Ten Thousand Rupees Only");
    expect(amountInWords(100.5)).toBe("One Hundred Rupees and Fifty Paise Only");
  });
  it("computes the Indian financial year", () => {
    expect(financialYear("2026-10-29")).toBe("2026-27");
    expect(financialYear("2027-03-31")).toBe("2026-27");
    expect(financialYear("2027-04-01")).toBe("2027-28");
  });
});
