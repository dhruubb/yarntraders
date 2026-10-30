import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { importRows, invoices, parties } from "@/db/schema";
import { checkLine, createBatch, getBatch, parseDate, parseSpreadsheet, postBatch, updateRow } from "@/server/importer";
import { parseOcrText } from "@/server/ocr";
import { partyBalance } from "@/server/posting";
import { todayIST, addDays } from "@/lib/calc";
import { fixture } from "./helpers";

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
});

describe("import parsing", () => {
  it("reads dates in Indian formats", () => {
    expect(parseDate("29/10/2026")).toBe("2026-10-29");
    expect(parseDate("1-4-26")).toBe("2026-04-01");
    expect(parseDate("2026-10-29")).toBe("2026-10-29");
    expect(parseDate("garbage")).toBeNull();
  });

  it("maps common column names and strips ₹ and commas", async () => {
    const csv = "Date,Party Name,Yarn,Qty,Rate,Amount\n" + `${todayIST()},Khalid B.R,30 amrut,40,1258,"5,03,200"\n`;
    const rows = await parseSpreadsheet("x.csv", Buffer.from(csv), "sale");
    expect(rows[0]).toMatchObject({ date: todayIST(), party: "Khalid B.R", product: "30 amrut", bags: "40", rate: "1258", register_amount: "5,03,200" });
  });

  it("flags mismatches between the register amount and the calculated amount", () => {
    const prod = { bagWeightKg: "50", rateBasis: "per_5kg" as const, gstRate: "5" };
    expect(checkLine({ date: "2026-10-01", party_id: 1, product_id: 1, bags: 40, rate: 1258, register_amount: "503200" }, prod, false).match).toBe("ok");
    expect(checkLine({ date: "2026-10-01", party_id: 1, product_id: 1, bags: 40, rate: 1258, register_amount: "528360" }, prod, false).match).toBe("ok"); // incl. GST
    const bad = checkLine({ date: "2026-10-01", party_id: 1, product_id: 1, bags: 40, rate: 1258, register_amount: "500000" }, prod, false);
    expect(bad.match).toBe("mismatch");
    expect(bad.errors).toEqual(["amount"]); // blocked until someone confirms
    expect(checkLine({ date: "2026-10-01", party_id: 1, product_id: 1, bags: 40, rate: 1258, register_amount: "500000", amount_ok: true }, prod, false).errors).toEqual([]);
    expect(checkLine({ date: "x", party_id: null, product_id: 1, bags: 0, rate: 1 }, prod, false).errors).toEqual(["date", "party", "bags"]);
  });

  it("parses the photo reader's JSON and tolerates surrounding text", () => {
    const lines = parseOcrText('Here you go:\n{"lines":[{"party":"Nidhi Traders","product":"58 Silver","bags":12,"rate":238,"register_amount":182784,"struck_through":false,"confidence":"high"},{"party":"Sufiyan Metro","product":"58 silverspring","bags":12,"rate":null,"register_amount":182784,"struck_through":true,"confidence":"medium"}]}');
    expect(lines).toHaveLength(2);
    expect(lines[1].struck_through).toBe(true);
    expect(lines[1].rate).toBeNull();
  });
});

describe("import review and posting", () => {
  it("stages rows without posting, then posts grouped bills through the normal engine", async () => {
    await (await import("@/server/posting")).postInvoice(f.owner, { kind: "purchase", partyId: f.party.shrenik, date: addDays(todayIST(), -5), idempotencyKey: "seed-stock-1", lines: [{ productId: f.p.amrut30, bags: 100, rate: 1200 }] });
    const d = addDays(todayIST(), -2);
    const csv = `date,party,product,bags,rate,register_amount\n${d},Khalid B.R,30 Amrut,40,1258,503200\n${d},Khalid B.R,30 Amrut,5,1258,\n${d},Unknown Party,30 Amrut,1,1,\n${d},Khalid B.R,30 Amrut,1,1258,99\n`;
    const rows = await parseSpreadsheet("old.csv", Buffer.from(csv), "sale");
    const batchId = await createBatch(f.owner, "sale", "csv", "old.csv", rows);
    expect(await db.select().from(invoices).where(eq(invoices.kind, "sale"))).toHaveLength(0);

    const b = (await getBatch(f.business.id, batchId))!;
    expect(b.rows[0].data.party_id).toBe(f.party.khalid);
    expect(b.rows[2].data.party_id).toBeNull();
    await updateRow(f.owner, b.rows[2].id, {}, "rejected");

    // Row 4's register amount (₹99) doesn't match → not posted until confirmed
    expect(await postBatch(f.owner, batchId)).toEqual({ posted: 2, failed: 0 });
    await updateRow(f.owner, b.rows[3].id, { amount_ok: true });
    const res = await postBatch(f.owner, batchId);
    expect(res).toEqual({ posted: 1, failed: 0 });
    const sales = await db.select().from(invoices).where(eq(invoices.kind, "sale"));
    expect(sales).toHaveLength(2); // rows 1+2 (same date + party) → one bill; row 4 posted later as its own bill
    expect(sales[0].taxable).toBe("566100.00");
    expect(sales[0].source).toBe("import");
    expect(Number(await partyBalance(db, f.party.khalid))).toBeGreaterThan(0);

    // Posting again does nothing (rows already posted)
    expect(await postBatch(f.owner, batchId)).toEqual({ posted: 0, failed: 0 });
  });

  it("imports parties with opening balances and refuses staff", async () => {
    const csv = "name,type,phone,city,gstin,state_code,credit_days,credit_limit,opening_balance\nNew Mill,supplier,,Erode,,33,45,,-250000\n";
    await expect(createBatch(f.staff, "parties", "csv", "p.csv", await parseSpreadsheet("p.csv", Buffer.from(csv), "parties"))).rejects.toThrow(/permission/);
    const id = await createBatch(f.owner, "parties", "csv", "p.csv", await parseSpreadsheet("p.csv", Buffer.from(csv), "parties"));
    expect(await postBatch(f.owner, id)).toEqual({ posted: 1, failed: 0 });
    const [p] = await db.select().from(parties).where(eq(parties.name, "New Mill"));
    expect(p.openingBalance).toBe("-250000.00");
    const rows = await db.select().from(importRows).where(eq(importRows.batchId, id));
    expect(rows[0].status).toBe("posted");
  });
});
