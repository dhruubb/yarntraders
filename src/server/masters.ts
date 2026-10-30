/** Master data: parties, products, accounts, users, business settings. */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { accounts, businesses, parties, productStock, products, users, invoices, payments } from "@/db/schema";
import { D, inr } from "@/lib/calc";
import { AppError } from "./errors";
import { audit } from "./audit";
import { optNum, parseInput, requirePerm, type Ctx } from "./posting";
import { resolveSettings } from "./settings";

const optText = (max: number) => z.string().trim().max(max).optional().default("");
const optMoney = optNum(z.coerce.number().nonnegative());

export const GST_STATES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};

const gstinRe = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const partyInput = z.object({
  name: z.string().trim().min(2, "Enter the party name").max(120),
  type: z.enum(["customer", "supplier", "both"]),
  phone: optText(40),
  email: z.union([z.string().trim().email("Enter a valid email"), z.literal("")]).optional().default(""),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .default("")
    .refine((v) => v === "" || gstinRe.test(v), "GSTIN should be 15 characters, like 27ABCDE1234F1Z5"),
  stateCode: z.string().refine((v) => v in GST_STATES, "Pick a state"),
  address: optText(500),
  city: optText(80),
  creditDays: z.coerce.number().int().min(0).max(365).default(30),
  creditLimit: optMoney,
  openingBalance: z.coerce.number().default(0),
  openingSide: z.enum(["receivable", "payable"]).default("receivable"),
  notes: optText(1000),
  active: z.boolean().optional().default(true),
});

export async function savePartyRecord(ctx: Ctx, raw: z.input<typeof partyInput>, id?: number) {
  requirePerm(ctx, "manage_parties");
  const input = parseInput(partyInput, raw);
  if (input.gstin && input.gstin.slice(0, 2) !== input.stateCode)
    throw new AppError(`GSTIN starts with ${input.gstin.slice(0, 2)} but the state is ${GST_STATES[input.stateCode]}. Check the state.`);
  const opening = D(Math.abs(input.openingBalance)).mul(input.openingSide === "payable" ? -1 : 1);
  const values = {
    name: input.name,
    type: input.type,
    phone: input.phone,
    email: input.email,
    gstin: input.gstin,
    stateCode: input.stateCode,
    address: input.address,
    city: input.city,
    creditDays: input.creditDays,
    creditLimit: !input.creditLimit ? null : D(input.creditLimit).toFixed(2),
    openingBalance: opening.toFixed(2),
    notes: input.notes,
    active: input.active,
  };
  return db.transaction(async (tx) => {
    if (id) {
      const [old] = await tx.select().from(parties).where(and(eq(parties.id, id), eq(parties.businessId, ctx.businessId))).for("update");
      if (!old) throw new AppError("Party not found");
      // Opening balance affects the whole ledger: only the owner may change it once set.
      if (!D(old.openingBalance).eq(opening) && ctx.role !== "owner") throw new AppError("Only the owner can change an opening balance");
      await tx.update(parties).set(values).where(eq(parties.id, id));
      const changed = Object.entries(values).filter(([k, v]) => String((old as Record<string, unknown>)[k] ?? "") !== String(v ?? "")).map(([k]) => k);
      await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "update", entity: "party", entityId: id, summary: `Updated party ${input.name}${changed.length ? ` (${changed.join(", ")})` : ""}`, data: { before: old, after: values } });
      return id;
    }
    const [p] = await tx.insert(parties).values({ ...values, businessId: ctx.businessId }).returning({ id: parties.id });
    await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "create", entity: "party", entityId: p.id, summary: `Added party ${input.name}${!opening.isZero() ? ` with opening balance ${inr(opening, 0)}` : ""}` });
    return p.id;
  });
}

export const productInput = z.object({
  count: z.string().trim().min(1, "Enter the count, e.g. 30 or 2/40").max(20),
  brand: z.string().trim().min(1, "Enter the brand or mill").max(60),
  quality: optText(60),
  hsn: z.string().trim().regex(/^\d{4,8}$/, "HSN should be 4–8 digits").default("5205"),
  gstRate: z.coerce.number().min(0).max(28).default(5),
  bagWeightKg: z.coerce.number().positive("Bag weight must be more than 0").max(500),
  rateBasis: z.enum(["per_5kg", "per_kg", "per_bag", "per_lb"]),
  conesPerBag: optNum(z.coerce.number().int().positive()),
  lowStockBags: z.coerce.number().min(0).default(0),
  active: z.boolean().optional().default(true),
});

export function productName(count: string, brand: string, quality?: string) {
  return [count, brand, quality].filter(Boolean).join(" ");
}

export async function saveProductRecord(ctx: Ctx, raw: z.input<typeof productInput>, id?: number) {
  requirePerm(ctx, "manage_products");
  const input = parseInput(productInput, raw);
  const values = {
    count: input.count,
    brand: input.brand,
    quality: input.quality,
    name: productName(input.count, input.brand, input.quality),
    hsn: input.hsn,
    gstRate: D(input.gstRate).toFixed(2),
    bagWeightKg: D(input.bagWeightKg).toFixed(3),
    rateBasis: input.rateBasis,
    conesPerBag: input.conesPerBag ?? null,
    lowStockBags: D(input.lowStockBags).toFixed(3),
    active: input.active,
  };
  return db.transaction(async (tx) => {
    if (id) {
      const [old] = await tx.select().from(products).where(and(eq(products.id, id), eq(products.businessId, ctx.businessId))).for("update");
      if (!old) throw new AppError("Product not found");
      await tx.update(products).set(values).where(eq(products.id, id));
      await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "update", entity: "product", entityId: id, summary: `Updated product ${values.name}`, data: { before: old, after: values } });
      return id;
    }
    const [p] = await tx.insert(products).values({ ...values, businessId: ctx.businessId }).returning({ id: products.id });
    await tx.insert(productStock).values({ productId: p.id, businessId: ctx.businessId }).onConflictDoNothing();
    await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "create", entity: "product", entityId: p.id, summary: `Added product ${values.name} (${input.bagWeightKg} kg bag, rate ${input.rateBasis.replace("_", " ")})` });
    return p.id;
  });
}

export const accountInput = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.enum(["cash", "bank"]),
  openingBalance: z.coerce.number().default(0),
  active: z.boolean().optional().default(true),
});

export async function saveAccountRecord(ctx: Ctx, raw: z.input<typeof accountInput>, id?: number) {
  requirePerm(ctx, "manage_settings");
  const input = parseInput(accountInput, raw);
  return db.transaction(async (tx) => {
    if (id) {
      const [old] = await tx.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.businessId, ctx.businessId)));
      if (!old) throw new AppError("Account not found");
      if (old.type !== input.type) {
        const [used] = await tx.select({ id: payments.id }).from(payments).where(eq(payments.accountId, id)).limit(1);
        if (used) throw new AppError("This account already has payments; its type can't change");
      }
      await tx.update(accounts).set({ name: input.name, type: input.type, openingBalance: D(input.openingBalance).toFixed(2), active: input.active }).where(eq(accounts.id, id));
      await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "update", entity: "account", entityId: id, summary: `Updated account ${input.name}`, data: { before: old } });
      return id;
    }
    const [a] = await tx.insert(accounts).values({ businessId: ctx.businessId, name: input.name, type: input.type, openingBalance: D(input.openingBalance).toFixed(2) }).returning({ id: accounts.id });
    await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "create", entity: "account", entityId: a.id, summary: `Added ${input.type} account ${input.name}` });
    return a.id;
  });
}

export const userInput = z.object({
  name: z.string().trim().min(2).max(80),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, "Username: 3–40 letters, numbers, dot, dash or underscore"),
  role: z.enum(["owner", "staff"]),
  password: z.union([z.string().min(8, "Password must be at least 8 characters").max(200), z.literal("")]).optional().default(""),
  active: z.boolean().optional().default(true),
});

export async function saveUserRecord(ctx: Ctx, raw: z.input<typeof userInput>, id?: number) {
  requirePerm(ctx, "manage_users");
  const input = parseInput(userInput, raw);
  return db.transaction(async (tx) => {
    if (id) {
      const [old] = await tx.select().from(users).where(and(eq(users.id, id), eq(users.businessId, ctx.businessId)));
      if (!old) throw new AppError("User not found");
      if (old.id === ctx.userId && (!input.active || input.role !== "owner")) throw new AppError("You can't remove your own owner access");
      const set: Partial<typeof users.$inferInsert> = { name: input.name, username: input.username, role: input.role, active: input.active };
      if (input.password) set.passwordHash = await bcrypt.hash(input.password, 12);
      await tx.update(users).set(set).where(eq(users.id, id));
      if (input.password || !input.active) await tx.execute(sql`DELETE FROM sessions WHERE user_id = ${id}`);
      await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "update", entity: "user", entityId: id, summary: `Updated user ${input.username} (${input.role}${input.active ? "" : ", deactivated"}${input.password ? ", password reset" : ""})` });
      return id;
    }
    if (!input.password) throw new AppError("Set a password for the new user");
    const [u] = await tx
      .insert(users)
      .values({ businessId: ctx.businessId, name: input.name, username: input.username, role: input.role, passwordHash: await bcrypt.hash(input.password, 12) })
      .returning({ id: users.id });
    await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "create", entity: "user", entityId: u.id, summary: `Added ${input.role} ${input.username}` });
    return u.id;
  });
}

export const businessInput = z.object({
  name: z.string().trim().min(2).max(120),
  gstin: z.string().trim().toUpperCase().optional().default("").refine((v) => v === "" || gstinRe.test(v), "Enter a valid GSTIN"),
  stateCode: z.string().refine((v) => v in GST_STATES, "Pick a state"),
  address: optText(500),
  phone: optText(60),
  bankDetails: optText(500),
  invoiceTerms: optText(1000),
  majorTxnThreshold: z.coerce.number().min(0),
  backdateAlertDays: z.coerce.number().int().min(0).max(365),
  telegramChatIds: z.string().optional().default(""),
  alerts: z.object({ majorTxn: z.boolean(), overdue: z.boolean(), lowStock: z.boolean(), unusual: z.boolean(), dailySummary: z.boolean() }),
});

export async function saveBusinessSettings(ctx: Ctx, raw: z.input<typeof businessInput>) {
  requirePerm(ctx, "manage_settings");
  const input = parseInput(businessInput, raw);
  const chatIds = input.telegramChatIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  for (const c of chatIds) if (!/^-?\d{3,20}$/.test(c)) throw new AppError(`"${c}" doesn't look like a Telegram chat ID (it's a number, e.g. 123456789)`);
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(businesses).where(eq(businesses.id, ctx.businessId));
    const settings = {
      ...resolveSettings(old.settings),
      telegramChatIds: chatIds,
      majorTxnThreshold: input.majorTxnThreshold,
      backdateAlertDays: input.backdateAlertDays,
      alerts: input.alerts,
      bankDetails: input.bankDetails,
      invoiceTerms: input.invoiceTerms,
    };
    await tx.update(businesses).set({ name: input.name, gstin: input.gstin, stateCode: input.stateCode, address: input.address, phone: input.phone, settings }).where(eq(businesses.id, ctx.businessId));
    await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "update", entity: "settings", summary: "Updated business settings", data: { before: { ...old, settings: old.settings }, after: settings } });
  });
}

/** Whether an invoice references a party (used to stop deleting parties; we only deactivate). */
export async function partyHasTransactions(partyId: number) {
  const [i] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.partyId, partyId)).limit(1);
  return Boolean(i);
}
