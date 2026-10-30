import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  bigserial,
  integer,
  text,
  boolean,
  numeric,
  date,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 16, scale: 2 });
const qty = (name: string) => numeric(name, { precision: 16, scale: 3 });

/** One row per business. v1 runs a single business, but every table carries business_id
 *  so the app can become multi-tenant later without a data migration. */
export const businesses = pgTable("businesses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  gstin: text("gstin").notNull().default(""),
  stateCode: text("state_code").notNull().default("27"),
  address: text("address").notNull().default(""),
  phone: text("phone").notNull().default(""),
  settings: jsonb("settings").$type<BusinessSettings>().notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
});

export type BusinessSettings = {
  telegramChatIds?: string[];
  majorTxnThreshold?: number;
  backdateAlertDays?: number;
  alerts?: {
    majorTxn?: boolean;
    overdue?: boolean;
    lowStock?: boolean;
    unusual?: boolean;
    dailySummary?: boolean;
  };
  bankDetails?: string;
  invoiceTerms?: string;
};

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").notNull().references(() => businesses.id),
    name: text("name").notNull(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").$type<"owner" | "staff">().notNull(),
    active: boolean("active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_username_uq").on(sql`lower(${t.username})`)],
);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie token; raw token never stored
  userId: integer("user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull().references(() => businesses.id),
  name: text("name").notNull(),
  type: text("type").$type<"cash" | "bank">().notNull(),
  openingBalance: money("opening_balance").notNull().default("0"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export type RateBasis = "per_5kg" | "per_kg" | "per_bag" | "per_lb";

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").notNull().references(() => businesses.id),
    count: text("count").notNull(), // e.g. "30", "2/40"
    brand: text("brand").notNull(), // mill / brand, e.g. "Amrut"
    quality: text("quality").notNull().default(""), // optional: combed, PC, cone…
    name: text("name").notNull(), // display name, e.g. "30 Amrut"
    hsn: text("hsn").notNull().default("5205"),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull().default("5"),
    bagWeightKg: numeric("bag_weight_kg", { precision: 10, scale: 3 }).notNull(),
    rateBasis: text("rate_basis").$type<RateBasis>().notNull().default("per_5kg"),
    conesPerBag: integer("cones_per_bag"),
    lowStockBags: qty("low_stock_bags").notNull().default("0"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("products_name_uq").on(t.businessId, sql`lower(${t.name})`)],
);

/** Running stock balance per product (weighted average cost lives here as value/kg). */
export const productStock = pgTable("product_stock", {
  productId: integer("product_id").primaryKey().references(() => products.id),
  businessId: integer("business_id").notNull().references(() => businesses.id),
  bags: qty("bags").notNull().default("0"),
  kg: qty("kg").notNull().default("0"),
  value: money("value").notNull().default("0"),
  lowStockAlerted: boolean("low_stock_alerted").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MovementType =
  | "opening"
  | "purchase"
  | "sale"
  | "sale_return"
  | "purchase_return"
  | "adjustment"
  | "reversal";

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    businessId: integer("business_id").notNull().references(() => businesses.id),
    productId: integer("product_id").notNull().references(() => products.id),
    lotNo: text("lot_no").notNull().default(""),
    date: date("date").notNull(),
    type: text("type").$type<MovementType>().notNull(),
    bags: qty("bags").notNull(), // signed: + in, - out
    kg: qty("kg").notNull(), // signed
    unitCostPerKg: numeric("unit_cost_per_kg", { precision: 16, scale: 4 }).notNull(),
    value: money("value").notNull(), // signed
    invoiceId: integer("invoice_id"),
    invoiceLineId: integer("invoice_line_id"),
    note: text("note").notNull().default(""),
    createdBy: integer("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("stock_mov_product_idx").on(t.productId, t.date)],
);

export const parties = pgTable(
  "parties",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").notNull().references(() => businesses.id),
    name: text("name").notNull(),
    type: text("type").$type<"customer" | "supplier" | "both">().notNull(),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    gstin: text("gstin").notNull().default(""),
    stateCode: text("state_code").notNull().default("27"),
    address: text("address").notNull().default(""),
    city: text("city").notNull().default(""),
    creditDays: integer("credit_days").notNull().default(30),
    creditLimit: money("credit_limit"),
    /** Signed: positive = party owes us (receivable), negative = we owe party (payable). */
    openingBalance: money("opening_balance").notNull().default("0"),
    notes: text("notes").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("parties_name_uq").on(t.businessId, sql`lower(${t.name})`)],
);

export type InvoiceKind = "sale" | "purchase" | "sale_return" | "purchase_return";

export const invoices = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").notNull().references(() => businesses.id),
    kind: text("kind").$type<InvoiceKind>().notNull(),
    number: text("number").notNull(), // our series number, e.g. S/2026-27/0001
    supplierBillNo: text("supplier_bill_no").notNull().default(""),
    partyId: integer("party_id").notNull().references(() => parties.id),
    date: date("date").notNull(),
    dueDate: date("due_date"),
    isInterstate: boolean("is_interstate").notNull().default(false),
    linesAmount: money("lines_amount").notNull(),
    freight: money("freight").notNull().default("0"),
    discount: money("discount").notNull().default("0"),
    taxable: money("taxable").notNull(),
    cgst: money("cgst").notNull().default("0"),
    sgst: money("sgst").notNull().default("0"),
    igst: money("igst").notNull().default("0"),
    roundOff: money("round_off").notNull().default("0"),
    total: money("total").notNull(),
    /** Cost of goods (weighted average) — sales and sale returns. */
    cogs: money("cogs").notNull().default("0"),
    status: text("status").$type<"posted" | "cancelled">().notNull().default("posted"),
    refInvoiceId: integer("ref_invoice_id"),
    agent: text("agent").notNull().default(""),
    notes: text("notes").notNull().default(""),
    source: text("source").$type<"manual" | "import" | "ocr">().notNull().default("manual"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdBy: integer("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    cancelledBy: integer("cancelled_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    uniqueIndex("invoices_idem_uq").on(t.businessId, t.idempotencyKey),
    uniqueIndex("invoices_number_uq").on(t.businessId, t.kind, t.number),
    uniqueIndex("invoices_supplier_bill_uq")
      .on(t.businessId, t.partyId, sql`lower(${t.supplierBillNo})`)
      .where(sql`${t.supplierBillNo} <> '' and ${t.kind} = 'purchase' and ${t.status} = 'posted'`),
    index("invoices_party_idx").on(t.partyId, t.date),
    index("invoices_date_idx").on(t.businessId, t.date),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id").notNull().references(() => invoices.id),
    lineNo: integer("line_no").notNull(),
    productId: integer("product_id").notNull().references(() => products.id),
    lotNo: text("lot_no").notNull().default(""),
    bags: qty("bags").notNull(),
    kg: qty("kg").notNull(),
    rate: numeric("rate", { precision: 14, scale: 2 }).notNull(),
    rateBasis: text("rate_basis").$type<RateBasis>().notNull(),
    amount: money("amount").notNull(), // bags/kg × rate, before invoice-level freight/discount
    taxable: money("taxable").notNull(), // amount ± share of freight/discount
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull(),
    cgst: money("cgst").notNull().default("0"),
    sgst: money("sgst").notNull().default("0"),
    igst: money("igst").notNull().default("0"),
    costPerKg: numeric("cost_per_kg", { precision: 16, scale: 4 }).notNull().default("0"),
    cogs: money("cogs").notNull().default("0"),
    refLineId: integer("ref_line_id"),
  },
  (t) => [index("invoice_lines_invoice_idx").on(t.invoiceId), index("invoice_lines_product_idx").on(t.productId)],
);

export const invoiceCounters = pgTable(
  "invoice_counters",
  {
    businessId: integer("business_id").notNull(),
    series: text("series").notNull(),
    next: integer("next").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.series] })],
);

export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").notNull().references(() => businesses.id),
    direction: text("direction").$type<"in" | "out">().notNull(),
    partyId: integer("party_id").notNull().references(() => parties.id),
    accountId: integer("account_id").notNull().references(() => accounts.id),
    date: date("date").notNull(),
    amount: money("amount").notNull(),
    mode: text("mode").$type<"cash" | "bank" | "upi" | "cheque">().notNull(),
    reference: text("reference").notNull().default(""),
    chequeNo: text("cheque_no").notNull().default(""),
    chequeStatus: text("cheque_status").$type<"na" | "pending" | "cleared" | "bounced">().notNull().default("na"),
    notes: text("notes").notNull().default(""),
    status: text("status").$type<"posted" | "cancelled">().notNull().default("posted"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdBy: integer("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    cancelledBy: integer("cancelled_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    uniqueIndex("payments_idem_uq").on(t.businessId, t.idempotencyKey),
    index("payments_party_idx").on(t.partyId, t.date),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").notNull().references(() => businesses.id),
    date: date("date").notNull(),
    category: text("category").notNull(),
    amount: money("amount").notNull(),
    accountId: integer("account_id").notNull().references(() => accounts.id),
    paidTo: text("paid_to").notNull().default(""),
    notes: text("notes").notNull().default(""),
    status: text("status").$type<"posted" | "cancelled">().notNull().default("posted"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdBy: integer("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    cancelledBy: integer("cancelled_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
  },
  (t) => [uniqueIndex("expenses_idem_uq").on(t.businessId, t.idempotencyKey)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    businessId: integer("business_id").notNull(),
    userId: integer("user_id"),
    action: text("action").notNull(), // create | cancel | update | login | …
    entity: text("entity").notNull(), // invoice | payment | party | …
    entityId: text("entity_id").notNull().default(""),
    summary: text("summary").notNull(),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_business_idx").on(t.businessId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    businessId: integer("business_id").notNull(),
    type: text("type").notNull(),
    message: text("message").notNull(),
    status: text("status").$type<"pending" | "sent" | "failed" | "skipped">().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("notifications_dedupe_uq").on(t.businessId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
    index("notifications_status_idx").on(t.status),
  ],
);

export const importBatches = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull().references(() => businesses.id),
  source: text("source").$type<"csv" | "xlsx" | "ocr">().notNull(),
  kind: text("kind").$type<"sale" | "purchase" | "parties" | "products" | "opening_stock">().notNull(),
  fileName: text("file_name").notNull().default(""),
  status: text("status").$type<"review" | "done">().notNull().default("review"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const importRows = pgTable(
  "import_rows",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id").notNull().references(() => importBatches.id),
    rowNo: integer("row_no").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"pending" | "posted" | "rejected" | "error">().notNull().default("pending"),
    error: text("error"),
    resultId: integer("result_id"),
  },
  (t) => [index("import_rows_batch_idx").on(t.batchId)],
);
