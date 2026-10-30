import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { accounts, businesses, users } from "@/db/schema";
import type { Ctx } from "@/server/posting";
import { saveProductRecord, savePartyRecord } from "@/server/masters";

export const key = () => randomUUID();

export async function resetDb() {
  const tables = await db.execute<{ tablename: string }>(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '__drizzle%'`);
  await db.execute(sql.raw(`TRUNCATE ${tables.rows.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`));
}

export async function fixture() {
  await resetDb();
  const [b] = await db.insert(businesses).values({ name: "Test Yarn Co", stateCode: "27", gstin: "27ABCDE1234F1Z5" }).returning();
  const [o] = await db.insert(users).values({ businessId: b.id, name: "Owner", username: "owner", passwordHash: "x", role: "owner" }).returning();
  const [s] = await db.insert(users).values({ businessId: b.id, name: "Staff", username: "staff", passwordHash: "x", role: "staff" }).returning();
  const owner: Ctx = { userId: o.id, businessId: b.id, role: "owner", name: "Owner" };
  const staff: Ctx = { userId: s.id, businessId: b.id, role: "staff", name: "Staff" };
  const [cash] = await db.insert(accounts).values({ businessId: b.id, name: "Cash", type: "cash", openingBalance: "10000" }).returning();
  const [bank] = await db.insert(accounts).values({ businessId: b.id, name: "HDFC", type: "bank", openingBalance: "500000" }).returning();
  const p = {
    amrut30: await saveProductRecord(owner, { count: "30", brand: "Amrut", bagWeightKg: 50, rateBasis: "per_5kg", lowStockBags: 20 }),
    vpn47: await saveProductRecord(owner, { count: "47", brand: "VPN", bagWeightKg: 60, rateBasis: "per_5kg" }),
    rameshwar32: await saveProductRecord(owner, { count: "32", brand: "Rameshwar", bagWeightKg: 45.36, rateBasis: "per_5kg" }),
    silver58: await saveProductRecord(owner, { count: "58", brand: "Silver", bagWeightKg: 64, rateBasis: "per_kg" }),
  };
  const party = {
    shrenik: await savePartyRecord(owner, { name: "Shrenik Shah", type: "supplier", stateCode: "27" }),
    suresh: await savePartyRecord(owner, { name: "Suresh Bucha", type: "supplier", stateCode: "33", creditDays: 45 }),
    khalid: await savePartyRecord(owner, { name: "Khalid B.R", type: "customer", stateCode: "27", creditDays: 30, creditLimit: 1000000 }),
    nidhi: await savePartyRecord(owner, { name: "Nidhi Traders", type: "both", stateCode: "27" }),
  };
  return { business: b, owner, staff, cash, bank, p, party };
}
