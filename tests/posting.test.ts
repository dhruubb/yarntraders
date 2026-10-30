import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, notifications, productStock } from "@/db/schema";
import { adjustStock, cancelInvoice, cancelPayment, postInvoice, recordExpense, recordPayment, setChequeStatus, partyBalance } from "@/server/posting";
import { accountBalances, openItems, partyLedger, tradingFigures, invoicePaymentStatus } from "@/server/queries";
import { todayIST, addDays } from "@/lib/calc";
import { fixture, key } from "./helpers";

let f: Awaited<ReturnType<typeof fixture>>;
const T = todayIST();
const stockOf = async (productId: number) => (await db.select().from(productStock).where(eq(productStock.productId, productId)))[0];

const buy = (productId: number, bags: number, rate: number, extra: Record<string, unknown> = {}) =>
  postInvoice(f.owner, { kind: "purchase", partyId: f.party.shrenik, date: T, idempotencyKey: key(), lines: [{ productId, bags, rate }], ...extra });
const sell = (productId: number, bags: number, rate: number, extra: Record<string, unknown> = {}) =>
  postInvoice(f.staff, { kind: "sale", partyId: f.party.khalid, date: T, idempotencyKey: key(), lines: [{ productId, bags, rate }], ...extra });

beforeEach(async () => {
  f = await fixture();
});

describe("purchase → stock → sale → profit", () => {
  it("keeps weighted average cost (ex-GST) and books cost of goods on sale", async () => {
    await buy(f.p.amrut30, 100, 1150); // 5000 kg, ₹11,50,000 taxable → ₹230/kg
    await buy(f.p.amrut30, 100, 1250); // 5000 kg, ₹12,50,000 → ₹250/kg; avg ₹240/kg
    let s = await stockOf(f.p.amrut30);
    expect(s.bags).toBe("200.000");
    expect(s.kg).toBe("10000.000");
    expect(s.value).toBe("2400000.00");

    const r = await sell(f.p.amrut30, 40, 1258); // Khalid B.R line from the register
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, r.invoiceId));
    expect(inv.taxable).toBe("503200.00");
    expect(inv.cgst).toBe("12580.00");
    expect(inv.total).toBe("528360.00");
    expect(inv.cogs).toBe("480000.00"); // 2000 kg × ₹240
    expect(inv.number).toMatch(/^S\/\d{4}-\d{2}\/0001$/);

    s = await stockOf(f.p.amrut30);
    expect(s.bags).toBe("160.000");
    expect(s.value).toBe("1920000.00");

    const tf = await tradingFigures(f.business.id, T, T);
    expect(tf.netSales).toBe("503200.00");
    expect(tf.grossProfit).toBe("23200.00");
  });

  it("uses IGST for an out-of-state supplier", async () => {
    const r = await postInvoice(f.owner, { kind: "purchase", partyId: f.party.suresh, date: T, idempotencyKey: key(), lines: [{ productId: f.p.vpn47, bags: 200, rate: 1620 }] });
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, r.invoiceId));
    expect(inv.isInterstate).toBe(true);
    expect(inv.igst).toBe("194400.00");
    expect(inv.total).toBe("4082400.00");
    expect(inv.dueDate).toBe(addDays(T, 45));
  });

  it("refuses to sell more than is in stock", async () => {
    await buy(f.p.vpn47, 10, 1700);
    await expect(sell(f.p.vpn47, 11, 1745)).rejects.toThrow(/Not enough stock of 47 VPN/);
    expect((await stockOf(f.p.vpn47)).bags).toBe("10.000");
  });
});

describe("duplicate prevention", () => {
  it("the same submission (double-click / retry) posts only once", async () => {
    await buy(f.p.amrut30, 50, 1200);
    const k = key();
    const input = { kind: "sale" as const, partyId: f.party.khalid, date: T, idempotencyKey: k, lines: [{ productId: f.p.amrut30, bags: 10, rate: 1290 }] };
    const [a, b] = await Promise.allSettled([postInvoice(f.staff, input), postInvoice(f.staff, input)]);
    const ok = [a, b].filter((x) => x.status === "fulfilled");
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const c = await postInvoice(f.staff, input);
    expect(c.alreadyPosted).toBe(true);
    expect((await stockOf(f.p.amrut30)).bags).toBe("40.000");
  });

  it("warns about same party + date + total and posts only when confirmed", async () => {
    await buy(f.p.amrut30, 50, 1200);
    await sell(f.p.amrut30, 10, 1290);
    await expect(sell(f.p.amrut30, 10, 1290)).rejects.toMatchObject({ code: "possible_duplicate" });
    await sell(f.p.amrut30, 10, 1290, { confirmDuplicate: true });
    expect((await stockOf(f.p.amrut30)).bags).toBe("30.000");
  });

  it("blocks re-entering the same supplier bill number", async () => {
    await buy(f.p.amrut30, 10, 1200, { supplierBillNo: "SB-77" });
    await expect(buy(f.p.amrut30, 12, 1200, { supplierBillNo: "sb-77" })).rejects.toThrow(/already entered/);
  });
});

describe("returns and cancellations", () => {
  it("sale return puts stock back at original cost and reduces what the customer owes", async () => {
    await buy(f.p.amrut30, 100, 1200); // ₹240/kg
    const s1 = await sell(f.p.amrut30, 40, 1258);
    const [line] = (await db.execute<{ id: number }>(sql`SELECT id FROM invoice_lines WHERE invoice_id = ${s1.invoiceId}`)).rows;
    await buy(f.p.amrut30, 100, 1300); // average moves, return must still use ₹240
    const ret = await postInvoice(f.owner, { kind: "sale_return", partyId: f.party.khalid, date: T, refInvoiceId: s1.invoiceId, idempotencyKey: key(), lines: [{ productId: f.p.amrut30, bags: 5, rate: 0, refLineId: line.id }] });
    const [r] = await db.select().from(invoices).where(eq(invoices.id, ret.invoiceId));
    expect(r.taxable).toBe("62900.00"); // 5 × 1258 × 10
    expect(r.cogs).toBe("60000.00"); // 250 kg × ₹240
    expect(await partyBalance(db, f.party.khalid)).toBe(String((528360 - 66045).toFixed(2)));
    await expect(
      postInvoice(f.owner, { kind: "sale_return", partyId: f.party.khalid, date: T, refInvoiceId: s1.invoiceId, idempotencyKey: key(), lines: [{ productId: f.p.amrut30, bags: 36, rate: 0, refLineId: line.id }] }),
    ).rejects.toThrow(/only 35 bags/);
    const tf = await tradingFigures(f.business.id, T, T);
    expect(tf.netSales).toBe("440300.00");
    expect(tf.cogs).toBe("420000.00");
  });

  it("cancelling a sale restores stock and the party balance; posted rows stay in history", async () => {
    await buy(f.p.silver58, 20, 230);
    const s = await sell(f.p.silver58, 12, 238);
    await expect(cancelInvoice(f.staff, s.invoiceId, "wrong party")).rejects.toThrow(/permission/);
    await cancelInvoice(f.owner, s.invoiceId, "wrong party");
    expect((await stockOf(f.p.silver58)).bags).toBe("20.000");
    expect((await stockOf(f.p.silver58)).value).toBe("294400.00");
    expect(await partyBalance(db, f.party.khalid)).toBe("0.00");
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, s.invoiceId));
    expect(inv.status).toBe("cancelled");
    await expect(cancelInvoice(f.owner, s.invoiceId, "again")).rejects.toThrow(/already cancelled/);
  });

  it("won't cancel a purchase whose stock has already been sold", async () => {
    const p = await buy(f.p.vpn47, 10, 1700);
    await sell(f.p.vpn47, 6, 1745);
    await expect(cancelInvoice(f.owner, p.invoiceId, "typo")).rejects.toThrow(/already been sold/);
  });

  it("the database itself refuses edits and deletes of posted invoices", async () => {
    const p = await buy(f.p.vpn47, 10, 1700);
    const cause = (re: RegExp) => ({ cause: expect.objectContaining({ message: expect.stringMatching(re) }) });
    await expect(db.execute(sql`UPDATE invoices SET total = 1 WHERE id = ${p.invoiceId}`)).rejects.toMatchObject(cause(/cannot be edited/));
    await expect(db.execute(sql`DELETE FROM invoices WHERE id = ${p.invoiceId}`)).rejects.toMatchObject(cause(/not allowed/));
    await expect(db.execute(sql`UPDATE audit_log SET summary = 'x'`)).rejects.toMatchObject(cause(/append-only/));
  });
});

describe("payments, ledgers and outstanding", () => {
  it("tracks part payments FIFO, overdue days and cash/bank balances", async () => {
    await buy(f.p.amrut30, 100, 1200);
    const old = await postInvoice(f.owner, { kind: "sale", partyId: f.party.khalid, date: addDays(T, -40), idempotencyKey: key(), lines: [{ productId: f.p.amrut30, bags: 10, rate: 1258 }] }); // ₹1,32,090
    const recent = await sell(f.p.amrut30, 10, 1258); // ₹1,32,090
    await recordPayment(f.staff, { direction: "in", partyId: f.party.khalid, accountId: f.cash.id, date: T, amount: 100000, mode: "cash", idempotencyKey: key() });

    const items = await openItems(f.business.id, "receivable");
    expect(items.map((i) => [i.invoice_id, i.outstanding])).toEqual([
      [old.invoiceId, "32090.00"],
      [recent.invoiceId, "132090.00"],
    ]);
    expect(items[0].days_overdue).toBe(10);
    const st = await invoicePaymentStatus(f.business.id, { id: old.invoiceId, partyId: f.party.khalid, kind: "sale", total: "132090.00", status: "posted" });
    expect(st?.status).toBe("part-paid");

    const cheque = await recordPayment(f.owner, { direction: "in", partyId: f.party.khalid, accountId: f.bank.id, date: T, amount: 50000, mode: "cheque", chequeNo: "004512", idempotencyKey: key() });
    let bal = await accountBalances(f.business.id);
    expect(bal.find((a) => a.name === "HDFC")!.balance).toBe("500000.00"); // pending cheque not in bank yet
    expect(bal.find((a) => a.name === "Cash")!.balance).toBe("110000.00");
    expect(await partyBalance(db, f.party.khalid)).toBe("114180.00");

    await setChequeStatus(f.staff, cheque.paymentId, "bounced");
    expect(await partyBalance(db, f.party.khalid)).toBe("164180.00");
    const notes = await db.select().from(notifications);
    expect(notes.some((n) => n.message.includes("bounced"))).toBe(true);

    const ledger = await partyLedger(f.business.id, f.party.khalid);
    expect(ledger!.closing).toBe("164180.00");
    expect(ledger!.entries).toHaveLength(3);
  });

  it("warns on a duplicate payment and lets the owner cancel one", async () => {
    const k = { direction: "out" as const, partyId: f.party.shrenik, accountId: f.bank.id, date: T, amount: 25000, mode: "bank" as const };
    const p = await recordPayment(f.owner, { ...k, idempotencyKey: key() });
    await expect(recordPayment(f.owner, { ...k, idempotencyKey: key() })).rejects.toMatchObject({ code: "possible_duplicate" });
    await cancelPayment(f.owner, p.paymentId, "entered twice");
    expect(await partyBalance(db, f.party.shrenik)).toBe("0.00");
  });

  it("net profit = gross profit − expenses", async () => {
    await buy(f.p.amrut30, 10, 1200);
    await sell(f.p.amrut30, 10, 1300);
    await recordExpense(f.staff, { date: T, category: "Rent", amount: 2000, accountId: f.cash.id, idempotencyKey: key() });
    const tf = await tradingFigures(f.business.id, T, T);
    expect(tf.grossProfit).toBe("10000.00"); // 500 kg × (₹260 − ₹240)
    expect(tf.netProfit).toBe("8000.00");
  });
});

describe("permissions, alerts and concurrency", () => {
  it("staff can't adjust stock or cancel; owner can", async () => {
    await expect(adjustStock(f.staff, { productId: f.p.amrut30, type: "opening", date: T, bags: 10, costPerKg: 240, note: "opening count" })).rejects.toThrow(/permission/);
    await adjustStock(f.owner, { productId: f.p.amrut30, type: "opening", date: T, bags: 10, costPerKg: 240, note: "opening count" });
    expect((await stockOf(f.p.amrut30)).value).toBe("120000.00");
  });

  it("treats blank form fields as 'not given', not zero (regression)", async () => {
    await adjustStock(f.owner, { productId: f.p.vpn47, type: "opening", date: T, bags: 20, kg: "", costPerKg: 310, note: "opening count" });
    let s = await stockOf(f.p.vpn47);
    expect(s.kg).toBe("1200.000"); // 20 × 60 kg standard
    expect(s.value).toBe("372000.00");
    await adjustStock(f.owner, { productId: f.p.vpn47, type: "adjustment", date: T, bags: 2, kg: "", costPerKg: "", note: "found two" });
    s = await stockOf(f.p.vpn47);
    expect(s.value).toBe("409200.00"); // added at current average ₹310/kg
    const r = await postInvoice(f.staff, { kind: "sale", partyId: f.party.khalid, date: T, idempotencyKey: key(), lines: [{ productId: f.p.vpn47, bags: 2, kg: "", rate: 1745 }] });
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, r.invoiceId));
    expect(inv.taxable).toBe("41880.00");
  });

  it("queues low-stock, large-transaction and below-cost alerts", async () => {
    await buy(f.p.amrut30, 30, 1300); // 30 bags, low-stock level 20
    await postInvoice(f.owner, { kind: "sale", partyId: f.party.khalid, date: T, idempotencyKey: key(), lines: [{ productId: f.p.amrut30, bags: 15, rate: 1200 }] });
    const types = (await db.select().from(notifications)).map((n) => n.type);
    expect(types).toContain("low_stock");
    expect(types).toContain("unusual"); // sold below cost
    await postInvoice(f.owner, { kind: "purchase", partyId: f.party.suresh, date: T, idempotencyKey: key(), lines: [{ productId: f.p.vpn47, bags: 200, rate: 1620 }] });
    expect((await db.select().from(notifications)).some((n) => n.type === "major_txn")).toBe(true);
  });

  it("two people selling the last bags at the same moment can't oversell", async () => {
    await buy(f.p.vpn47, 10, 1700);
    const results = await Promise.allSettled([
      postInvoice(f.staff, { kind: "sale", partyId: f.party.khalid, date: T, idempotencyKey: key(), lines: [{ productId: f.p.vpn47, bags: 8, rate: 1745 }] }),
      postInvoice(f.owner, { kind: "sale", partyId: f.party.nidhi, date: T, idempotencyKey: key(), lines: [{ productId: f.p.vpn47, bags: 8, rate: 1750 }] }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await stockOf(f.p.vpn47)).bags).toBe("2.000");
  });

  it("rejects a sale to a supplier-only party and future dates", async () => {
    await buy(f.p.vpn47, 10, 1700);
    await expect(postInvoice(f.owner, { kind: "sale", partyId: f.party.shrenik, date: T, idempotencyKey: key(), lines: [{ productId: f.p.vpn47, bags: 1, rate: 1 }] })).rejects.toThrow(/supplier only/);
    await expect(postInvoice(f.owner, { kind: "sale", partyId: f.party.khalid, date: addDays(T, 5), idempotencyKey: key(), lines: [{ productId: f.p.vpn47, bags: 1, rate: 1 }] })).rejects.toThrow(/future/);
  });
});
