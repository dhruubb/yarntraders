/**
 * Development seed data, based on the entries in the client's register photos.
 * Refuses to run in production and refuses to touch a database that already has data.
 * Usage: npm run db:seed  (add --reset to wipe a dev database first)
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db, getPool } from "../src/db";
import { accounts, businesses, users } from "../src/db/schema";
import { saveProductRecord, savePartyRecord } from "../src/server/masters";
import { adjustStock, postInvoice, recordExpense, recordPayment, type Ctx } from "../src/server/posting";
import { addDays, todayIST } from "../src/lib/calc";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production.");

const existing = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM businesses`);
if (existing.rows[0].n > 0) {
  if (!process.argv.includes("--reset")) {
    console.log("Database already has data. Run with --reset to wipe this DEV database and reseed.");
    process.exit(0);
  }
  const tables = await db.execute<{ tablename: string }>(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '__drizzle%'`);
  await db.execute(sql.raw(`TRUNCATE ${tables.rows.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`));
}

const [b] = await db.insert(businesses).values({ name: "Demo Yarn Traders", stateCode: "27", gstin: "27AABCD1234E1Z5", address: "Demo address, Maharashtra", phone: "" }).returning();
const [o] = await db.insert(users).values({ businessId: b.id, name: "Owner (demo)", username: "owner", passwordHash: await bcrypt.hash("demo-owner-123", 12), role: "owner" }).returning();
await db.insert(users).values({ businessId: b.id, name: "Staff (demo)", username: "staff", passwordHash: await bcrypt.hash("demo-staff-123", 12), role: "staff" });
const owner: Ctx = { userId: o.id, businessId: b.id, role: "owner", name: o.name };
const [cash] = await db.insert(accounts).values({ businessId: b.id, name: "Cash", type: "cash", openingBalance: "250000" }).returning();
const [bank] = await db.insert(accounts).values({ businessId: b.id, name: "Bank (current a/c)", type: "bank", openingBalance: "8000000" }).returning();

const P = async (count: string, brand: string, bagWeightKg: number, rateBasis: "per_5kg" | "per_kg" | "per_bag", lowStockBags = 10) =>
  saveProductRecord(owner, { count, brand, bagWeightKg, rateBasis, lowStockBags });
const prod = {
  amrut30: await P("30", "Amrut", 50, "per_5kg", 30),
  gajraj30: await P("30", "Gajraj", 50, "per_5kg"),
  gc30: await P("30", "G.C", 50, "per_5kg"),
  patiala30: await P("30", "Patiala", 50, "per_5kg"),
  shriniwas30: await P("30", "Shriniwas", 50, "per_5kg"),
  rameshwar32: await P("32", "Rameshwar", 45.36, "per_5kg"),
  divakar41: await P("41", "Divakar", 60, "per_5kg"),
  vpn47: await P("47", "VPN", 60, "per_5kg", 50),
  silver58: await P("58", "Silverspring", 64, "per_kg"),
  bhavani60: await P("60", "Bhavani", 60, "per_5kg"),
  kumran63: await P("63", "Kumran", 50, "per_bag"),
};

const party = async (name: string, type: "customer" | "supplier" | "both", city: string, stateCode = "27", creditDays = 30, creditLimit?: number) =>
  savePartyRecord(owner, { name, type, city, stateCode, creditDays, creditLimit: creditLimit ?? "" });
const sup = {
  suresh: await party("Suresh Bucha", "supplier", "Coimbatore", "33", 45),
  manoj: await party("Manoj Bucha", "supplier", "Coimbatore", "33", 45),
  abhay: await party("Abhay Coimbatore", "supplier", "Coimbatore", "33", 30),
  shrenik: await party("Shrenik Shah", "supplier", "Bhiwandi", "27", 30),
  amish: await party("Amishbhai", "supplier", "Surat", "24", 30),
  selvraj: await party("Selvraj", "supplier", "Tiruppur", "33", 30),
};
const cus = {
  salim: await party("Salim Siddiq", "customer", "Malegaon", "27", 30, 2500000),
  javid: await party("Javid Sandip", "customer", "Malegaon"),
  abid: await party("Abid Dost", "customer", "Malegaon", "27", 45, 8000000),
  gani: await party("Gani Textiles", "customer", "Bhiwandi"),
  khalid: await party("Khalid B.R", "customer", "Malegaon", "27", 30, 1500000),
  shoid: await party("Shoid Noble Fabrics", "customer", "Malegaon"),
  nidhi: await party("Nidhi Traders", "both", "Ichalkaranji"),
  bhikku: await party("Khalid Bhikku", "customer", "Malegaon"),
  yasin: await party("Yasin Bidi", "customer", "Malegaon"),
  habib: await party("Habibseth Rehmani", "customer", "Malegaon"),
  swastik: await party("Swastik Fabtex", "customer", "Bhiwandi"),
  master: await party("Master Fabrics", "customer", "Malegaon"),
};

const T = todayIST();
const d = (n: number) => addDays(T, -n);
const inv = (kind: "sale" | "purchase", partyId: number, date: string, lines: [number, number, number][], extra: Record<string, unknown> = {}) =>
  postInvoice(owner, { kind, partyId, date, idempotencyKey: randomUUID(), lines: lines.map(([productId, bags, rate]) => ({ productId, bags, rate })), ...extra });

// Opening stock for a few lines
for (const [id, bags, cost] of [[prod.gajraj30, 40, 228], [prod.gc30, 30, 242], [prod.patiala30, 25, 226], [prod.divakar41, 40, 305]] as const)
  await adjustStock(owner, { productId: id, type: "opening", date: d(45), bags, costPerKg: cost, note: "Opening stock (demo)" });

// Purchases (from the purchase register)
await inv("purchase", sup.shrenik, d(42), [[prod.shriniwas30, 200, 1310]], { supplierBillNo: "SS/221" });
await inv("purchase", sup.amish, d(41), [[prod.rameshwar32, 238, 1480]], { supplierBillNo: "AM-1180" });
await inv("purchase", sup.shrenik, d(40), [[prod.amrut30, 130, 1150]], { supplierBillNo: "SS/226" });
await inv("purchase", sup.abhay, d(38), [[prod.bhavani60, 50, 1610]]);
await inv("purchase", sup.suresh, d(36), [[prod.vpn47, 200, 1620]], { supplierBillNo: "SB/4471" });
await inv("purchase", sup.suresh, d(30), [[prod.vpn47, 100, 1620]], { supplierBillNo: "SB/4502" });
await inv("purchase", sup.selvraj, d(28), [[prod.kumran63, 25, 13500]]);
await inv("purchase", sup.shrenik, d(20), [[prod.silver58, 48, 238]], { supplierBillNo: "SS/240" });
await inv("purchase", sup.suresh, d(12), [[prod.vpn47, 200, 1625]], { supplierBillNo: "SB/4560" });

// Sales (from the sale register)
await inv("sale", cus.salim, d(34), [[prod.vpn47, 10, 1665]]);
await inv("sale", cus.javid, d(33), [[prod.rameshwar32, 32, 1570]]);
await inv("sale", cus.abid, d(31), [[prod.vpn47, 150, 1745]]);
await inv("sale", cus.gani, d(29), [[prod.divakar41, 22, 1612]]);
await inv("sale", cus.khalid, d(25), [[prod.amrut30, 40, 1258]]);
await inv("sale", cus.shoid, d(22), [[prod.gajraj30, 20, 1195]]);
await inv("sale", cus.nidhi, d(18), [[prod.silver58, 12, 238]]);
await inv("sale", cus.bhikku, d(15), [[prod.amrut30, 30, 1210]]);
await inv("sale", cus.yasin, d(9), [[prod.amrut30, 10, 1290]]);
await inv("sale", cus.habib, d(6), [[prod.amrut30, 30, 1262]]);
await inv("sale", cus.swastik, d(4), [[prod.gc30, 15, 1275]]);
await inv("sale", cus.master, d(2), [[prod.patiala30, 10, 1190]]);
await inv("sale", cus.abid, d(1), [[prod.vpn47, 150, 1750]]);
await inv("sale", cus.khalid, T, [[prod.rameshwar32, 20, 1575], [prod.shriniwas30, 25, 1330]]);

// Payments
const pay = (direction: "in" | "out", partyId: number, date: string, amount: number, mode: "cash" | "bank" | "upi" | "cheque", chequeNo = "") =>
  recordPayment(owner, { direction, partyId, accountId: mode === "cash" ? cash.id : bank.id, date, amount, mode, chequeNo, idempotencyKey: randomUUID() });
await pay("in", cus.salim, d(20), 209790, "bank");
await pay("in", cus.abid, d(10), 2000000, "bank");
await pay("in", cus.javid, d(8), 200000, "cheque", "004518");
await pay("in", cus.khalid, d(5), 300000, "cash");
await pay("in", cus.gani, d(3), 446846, "upi");
await pay("out", sup.shrenik, d(25), 2500000, "bank");
await pay("out", sup.suresh, d(15), 4082400, "bank");
await pay("out", sup.amish, d(10), 1000000, "bank");

await recordExpense(owner, { date: d(27), category: "Rent", amount: 45000, accountId: bank.id, paidTo: "Godown rent", idempotencyKey: randomUUID() });
await recordExpense(owner, { date: d(26), category: "Salary & wages", amount: 120000, accountId: bank.id, idempotencyKey: randomUUID() });
await recordExpense(owner, { date: d(3), category: "Transport & hamali", amount: 8600, accountId: cash.id, idempotencyKey: randomUUID() });

// Seeding shouldn't spam anyone: mark demo alerts as skipped.
await db.execute(sql`UPDATE notifications SET status = 'skipped', last_error = 'demo seed'`);
console.log("Seeded demo data. Sign in as owner / demo-owner-123 or staff / demo-staff-123");
await getPool().end();
