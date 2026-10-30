/**
 * The posting engine. Every financial event goes through here, inside one DB transaction:
 * invoice + lines + stock movements + stock balances + audit log + alert outbox commit together
 * or not at all. Posted rows are immutable (enforced by DB triggers); corrections are cancellations.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db";
import {
  expenses,
  invoiceLines,
  invoices,
  parties,
  payments,
  productStock,
  products,
  stockMovements,
  accounts,
  type InvoiceKind,
  type MovementType,
} from "@/db/schema";
import {
  D,
  addDays,
  computeInvoice,
  financialYear,
  formatQty,
  inr,
  round2,
  round3,
  round4,
  todayIST,
  daysBetween,
  type RateBasis,
} from "@/lib/calc";
import { can, type Permission, type Role } from "@/lib/permissions";
import { AppError, DuplicateWarning, PermissionError } from "./errors";
import { audit } from "./audit";
import { enqueue } from "./notify/outbox";
import { getBusiness } from "./settings";

export type Ctx = { userId: number; businessId: number; role: Role; name: string };

export function requirePerm(ctx: Ctx, perm: Permission) {
  if (!can(ctx.role, perm)) throw new PermissionError();
}

export function parseInput<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    const path = issue.path.join(".");
    throw new AppError(path ? `${path}: ${issue.message}` : issue.message, "validation", r.error.issues);
  }
  return r.data;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const optText = (max: number) => z.string().trim().max(max).optional().default("");
/** Optional number: "" / null / undefined mean "not given" (z.coerce would turn "" into 0). */
export const optNum = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), inner.optional());

function checkDate(d: string, label = "Date") {
  const days = daysBetween(todayIST(), d);
  if (Number.isNaN(days)) throw new AppError(`${label} is not a valid date`);
  if (days > 1) throw new AppError(`${label} can't be in the future`);
  if (d < "2000-01-01") throw new AppError(`${label} is too far in the past`);
}

export const KIND_LABEL: Record<InvoiceKind, string> = {
  sale: "Sale",
  purchase: "Purchase",
  sale_return: "Sale return",
  purchase_return: "Purchase return",
};
const SERIES_PREFIX: Record<InvoiceKind, string> = { sale: "S", purchase: "P", sale_return: "SR", purchase_return: "PR" };
const STOCK_DIRECTION: Record<InvoiceKind, 1 | -1> = { sale: -1, purchase: 1, sale_return: 1, purchase_return: -1 };

async function nextNumber(tx: Tx, businessId: number, kind: InvoiceKind, date: string) {
  const series = `${SERIES_PREFIX[kind]}/${financialYear(date)}`;
  const res = await tx.execute<{ n: number }>(sql`
    INSERT INTO invoice_counters (business_id, series, next) VALUES (${businessId}, ${series}, 2)
    ON CONFLICT (business_id, series) DO UPDATE SET next = invoice_counters.next + 1
    RETURNING next - 1 AS n`);
  return `${series}/${String(res.rows[0].n).padStart(4, "0")}`;
}

async function lockStock(tx: Tx, businessId: number, productIds: number[]) {
  const ids = [...new Set(productIds)].sort((a, b) => a - b);
  if (ids.length === 0) return new Map<number, { bags: string; kg: string; value: string; lowStockAlerted: boolean }>();
  await tx
    .insert(productStock)
    .values(ids.map((productId) => ({ productId, businessId })))
    .onConflictDoNothing();
  // Lock in id order so two concurrent postings can't deadlock.
  const rows = await tx.execute<{ product_id: number; bags: string; kg: string; value: string; low_stock_alerted: boolean }>(
    sql`SELECT product_id, bags, kg, value, low_stock_alerted FROM product_stock WHERE product_id IN (${sql.join(ids, sql`, `)}) ORDER BY product_id FOR UPDATE`,
  );
  return new Map(rows.rows.map((r) => [r.product_id, { bags: r.bags, kg: r.kg, value: r.value, lowStockAlerted: r.low_stock_alerted }]));
}

export async function partyBalance(tx: Tx | typeof db, partyId: number): Promise<string> {
  const r = await tx.execute<{ balance: string }>(sql`SELECT balance FROM party_balances WHERE party_id = ${partyId}`);
  return r.rows[0]?.balance ?? "0";
}

// ───────────────────────────────── Invoices ─────────────────────────────────

const lineSchema = z.object({
  productId: z.coerce.number().int().positive("Pick a product"),
  lotNo: optText(60),
  bags: z.coerce.number().positive("Bags must be more than 0").max(1_000_000),
  kg: optNum(z.coerce.number().positive("Weight must be more than 0")),
  rate: z.coerce.number().nonnegative("Rate can't be negative").max(100_000_000),
  refLineId: z.coerce.number().int().positive().optional().nullable(),
});

export const invoiceInput = z.object({
  kind: z.enum(["sale", "purchase", "sale_return", "purchase_return"]),
  partyId: z.coerce.number().int().positive("Pick a party"),
  date: isoDate,
  dueDate: isoDate.optional().or(z.literal("")),
  supplierBillNo: optText(60),
  freight: z.coerce.number().nonnegative().max(100_000_000).optional().default(0),
  discount: z.coerce.number().nonnegative().max(100_000_000).optional().default(0),
  agent: optText(120),
  notes: optText(1000),
  refInvoiceId: z.coerce.number().int().positive().optional().nullable(),
  idempotencyKey: z.string().min(8).max(100),
  confirmDuplicate: z.boolean().optional().default(false),
  source: z.enum(["manual", "import", "ocr"]).optional().default("manual"),
  lines: z.array(lineSchema).min(1, "Add at least one line").max(200),
});
export type InvoiceInput = z.input<typeof invoiceInput>;

export type PostResult = { invoiceId: number; number: string; total: string; warnings: string[]; alreadyPosted?: boolean };

export async function postInvoice(ctx: Ctx, raw: InvoiceInput): Promise<PostResult> {
  requirePerm(ctx, "create_transactions");
  const input = parseInput(invoiceInput, raw);
  checkDate(input.date);
  const isReturn = input.kind === "sale_return" || input.kind === "purchase_return";

  return db.transaction(async (tx) => {
    const [dupKey] = await tx
      .select({ id: invoices.id, number: invoices.number, total: invoices.total })
      .from(invoices)
      .where(and(eq(invoices.businessId, ctx.businessId), eq(invoices.idempotencyKey, input.idempotencyKey)));
    if (dupKey) return { invoiceId: dupKey.id, number: dupKey.number, total: dupKey.total, warnings: [], alreadyPosted: true };

    const business = await getBusiness(tx, ctx.businessId);
    const [party] = await tx
      .select()
      .from(parties)
      .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
      .for("update");
    if (!party || !party.active) throw new AppError("Party not found or inactive");
    const sellsTo = input.kind === "sale" || input.kind === "sale_return";
    if (sellsTo && party.type === "supplier")
      throw new AppError(`${party.name} is set up as a supplier only. Change the party type to "Customer & supplier" first.`);
    if (!sellsTo && party.type === "customer")
      throw new AppError(`${party.name} is set up as a customer only. Change the party type to "Customer & supplier" first.`);

    // ── Returns must point at a posted original and can't exceed what's left to return
    let ref: typeof invoices.$inferSelect | undefined;
    const refLines = new Map<number, typeof invoiceLines.$inferSelect & { returnedBags: string; returnedKg: string }>();
    if (isReturn) {
      if (!input.refInvoiceId) throw new AppError("A return must be made against an original invoice");
      [ref] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, input.refInvoiceId), eq(invoices.businessId, ctx.businessId)))
        .for("update");
      const expectedKind = input.kind === "sale_return" ? "sale" : "purchase";
      if (!ref || ref.kind !== expectedKind || ref.status !== "posted") throw new AppError("Original invoice not found or cancelled");
      if (ref.partyId !== party.id) throw new AppError("The return party must match the original invoice");
      if (input.date < ref.date) throw new AppError("Return date can't be before the original invoice date");
      const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, ref.id));
      const returned = await tx.execute<{ ref_line_id: number; bags: string; kg: string }>(sql`
        SELECT l.ref_line_id, SUM(l.bags) AS bags, SUM(l.kg) AS kg FROM invoice_lines l
        JOIN invoices i ON i.id = l.invoice_id
        WHERE i.ref_invoice_id = ${ref.id} AND i.status = 'posted' AND i.kind = ${input.kind}
        GROUP BY l.ref_line_id`);
      const retMap = new Map(returned.rows.map((r) => [r.ref_line_id, r]));
      for (const l of lines) refLines.set(l.id, { ...l, returnedBags: retMap.get(l.id)?.bags ?? "0", returnedKg: retMap.get(l.id)?.kg ?? "0" });
      if (input.freight || input.discount) throw new AppError("Freight and discount aren't used on returns");
    }

    // ── Products
    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const prodRows = await tx
      .select()
      .from(products)
      .where(and(inArray(products.id, productIds), eq(products.businessId, ctx.businessId)));
    const prodMap = new Map(prodRows.map((p) => [p.id, p]));
    for (const id of productIds) {
      const p = prodMap.get(id);
      if (!p) throw new AppError("A product on this bill was not found");
      if (!p.active && !isReturn) throw new AppError(`${p.name} is inactive`);
    }

    // ── Build calc lines
    const calcLines = input.lines.map((l, i) => {
      const p = prodMap.get(l.productId)!;
      if (isReturn) {
        const rl = l.refLineId ? refLines.get(l.refLineId) : undefined;
        if (!rl || rl.productId !== l.productId) throw new AppError(`Line ${i + 1}: pick a line from the original invoice`);
        const remainingBags = D(rl.bags).sub(rl.returnedBags);
        if (D(l.bags).gt(remainingBags))
          throw new AppError(`Line ${i + 1}: only ${formatQty(remainingBags)} bags of ${p.name} are left to return on this invoice`);
        // Weight follows the original line's kg per bag unless entered
        const kg = l.kg ? D(l.kg) : round3(D(rl.kg).div(rl.bags).mul(l.bags));
        const remainingKg = D(rl.kg).sub(rl.returnedKg);
        if (kg.gt(remainingKg.add("0.001"))) throw new AppError(`Line ${i + 1}: only ${formatQty(remainingKg)} kg left to return`);
        return { bags: l.bags, bagWeightKg: p.bagWeightKg, kgOverride: kg.toString(), rate: rl.rate, rateBasis: rl.rateBasis as RateBasis, gstRate: rl.gstRate };
      }
      return { bags: l.bags, bagWeightKg: p.bagWeightKg, kgOverride: l.kg ?? null, rate: l.rate, rateBasis: p.rateBasis as RateBasis, gstRate: p.gstRate };
    });

    const interstate = ref ? ref.isInterstate : party.stateCode !== business.stateCode;
    const calc = computeInvoice({ lines: calcLines, freight: input.freight, discount: input.discount, interstate });
    if (calc.total.lte(0)) throw new AppError("The bill total must be more than zero");

    // ── Duplicate protection: same party + date + total (or same supplier bill no.)
    if (!input.confirmDuplicate) {
      const [same] = await tx
        .select({ id: invoices.id, number: invoices.number })
        .from(invoices)
        .where(
          and(
            eq(invoices.businessId, ctx.businessId),
            eq(invoices.kind, input.kind),
            eq(invoices.partyId, party.id),
            eq(invoices.date, input.date),
            eq(invoices.total, calc.total.toFixed(2)),
            eq(invoices.status, "posted"),
          ),
        );
      if (same)
        throw new DuplicateWarning(
          `${KIND_LABEL[input.kind]} ${same.number} for ${party.name} on this date has the same total (${inr(calc.total, 0)}). Is this a duplicate?`,
          same.id,
        );
    }
    if (input.kind === "purchase" && input.supplierBillNo) {
      const [same] = await tx
        .select({ number: invoices.number })
        .from(invoices)
        .where(
          and(
            eq(invoices.businessId, ctx.businessId),
            eq(invoices.kind, "purchase"),
            eq(invoices.partyId, party.id),
            eq(invoices.status, "posted"),
            sql`lower(${invoices.supplierBillNo}) = lower(${input.supplierBillNo})`,
          ),
        );
      if (same) throw new AppError(`Supplier bill ${input.supplierBillNo} is already entered as ${same.number}`, "duplicate");
    }

    // ── Stock effects (computed in memory first: several lines may hit the same product)
    const stock = await lockStock(tx, ctx.businessId, productIds);
    const dir = STOCK_DIRECTION[input.kind];
    type Effect = { costPerKg: Decimal; value: Decimal };
    const effects: Effect[] = [];
    const warnings: string[] = [];
    const alerts: { type: "low_stock" | "unusual"; msg: string; key?: string }[] = [];
    for (let i = 0; i < calc.lines.length; i++) {
      const l = calc.lines[i];
      const inLine = input.lines[i];
      const p = prodMap.get(inLine.productId)!;
      const s = stock.get(p.id)!;
      const rl = inLine.refLineId ? refLines.get(inLine.refLineId) : undefined;
      let costPerKg: Decimal;
      let value: Decimal;
      if (dir === -1) {
        if (D(s.kg).lt(l.kg) || D(s.bags).lt(l.bags))
          throw new AppError(
            `Not enough stock of ${p.name}: ${formatQty(s.bags)} bags (${formatQty(s.kg)} kg) available, ${formatQty(l.bags)} bags needed. Enter the purchase first.`,
            "stock",
          );
        costPerKg = input.kind === "sale" ? (D(s.kg).isZero() ? D(0) : D(s.value).div(s.kg)) : D(rl!.costPerKg);
        value = round2(l.kg.mul(costPerKg));
        const newKg = D(s.kg).sub(l.kg);
        let newValue = newKg.isZero() ? D(0) : D(s.value).sub(value);
        if (newValue.isNeg()) newValue = D(0);
        s.bags = D(s.bags).sub(l.bags).toString();
        s.kg = newKg.toString();
        s.value = newValue.toFixed(2);
        if (input.kind === "sale") {
          const salePerKg = l.taxable.div(l.kg);
          if (salePerKg.lt(costPerKg)) {
            const msg = `${p.name} sold at ${inr(salePerKg)}/kg, below average cost ${inr(costPerKg)}/kg`;
            alerts.push({ type: "unusual", msg: `Sale below cost — ${party.name}: ${msg}` });
            if (can(ctx.role, "view_cost_profit")) warnings.push(msg);
          }
        }
        if (D(p.lowStockBags).gt(0) && D(s.bags).lt(p.lowStockBags) && !s.lowStockAlerted) {
          alerts.push({ type: "low_stock", msg: `Low stock: ${p.name} — ${formatQty(s.bags)} bags left (alert level ${formatQty(p.lowStockBags)})` });
          s.lowStockAlerted = true;
        }
      } else {
        costPerKg = input.kind === "purchase" ? l.taxable.div(l.kg) : D(rl!.costPerKg);
        value = input.kind === "purchase" ? l.taxable : round2(l.kg.mul(costPerKg));
        s.bags = D(s.bags).add(l.bags).toString();
        s.kg = D(s.kg).add(l.kg).toString();
        s.value = D(s.value).add(value).toFixed(2);
        if (s.lowStockAlerted && D(s.bags).gte(p.lowStockBags)) s.lowStockAlerted = false;
      }
      effects.push({ costPerKg: round4(costPerKg), value });
    }
    const cogs =
      input.kind === "sale" || input.kind === "sale_return" ? effects.reduce((a, e) => a.add(e.value), D(0)) : D(0);

    // ── Insert invoice
    const number = await nextNumber(tx, ctx.businessId, input.kind, input.date);
    const dueDate =
      input.dueDate || (input.kind === "sale" || input.kind === "purchase" ? addDays(input.date, party.creditDays) : null);
    const [inv] = await tx
      .insert(invoices)
      .values({
        businessId: ctx.businessId,
        kind: input.kind,
        number,
        supplierBillNo: input.kind === "purchase" ? input.supplierBillNo : "",
        partyId: party.id,
        date: input.date,
        dueDate: dueDate || null,
        isInterstate: interstate,
        linesAmount: calc.linesAmount.toFixed(2),
        freight: calc.freight.toFixed(2),
        discount: calc.discount.toFixed(2),
        taxable: calc.taxable.toFixed(2),
        cgst: calc.cgst.toFixed(2),
        sgst: calc.sgst.toFixed(2),
        igst: calc.igst.toFixed(2),
        roundOff: calc.roundOff.toFixed(2),
        total: calc.total.toFixed(2),
        cogs: cogs.toFixed(2),
        refInvoiceId: ref?.id ?? null,
        agent: input.agent,
        notes: input.notes,
        source: input.source,
        idempotencyKey: input.idempotencyKey,
        createdBy: ctx.userId,
      })
      .returning();

    for (let i = 0; i < calc.lines.length; i++) {
      const l = calc.lines[i];
      const inLine = input.lines[i];
      const cl = calcLines[i];
      const e = effects[i];
      const [line] = await tx
        .insert(invoiceLines)
        .values({
          invoiceId: inv.id,
          lineNo: i + 1,
          productId: inLine.productId,
          lotNo: inLine.lotNo,
          bags: l.bags.toString(),
          kg: l.kg.toString(),
          rate: D(cl.rate).toFixed(2),
          rateBasis: cl.rateBasis,
          amount: l.amount.toFixed(2),
          taxable: l.taxable.toFixed(2),
          gstRate: D(cl.gstRate).toFixed(2),
          cgst: l.cgst.toFixed(2),
          sgst: l.sgst.toFixed(2),
          igst: l.igst.toFixed(2),
          costPerKg: e.costPerKg.toString(),
          cogs: input.kind === "sale" || input.kind === "sale_return" ? e.value.toFixed(2) : "0",
          refLineId: inLine.refLineId ?? null,
        })
        .returning({ id: invoiceLines.id });
      await tx.insert(stockMovements).values({
        businessId: ctx.businessId,
        productId: inLine.productId,
        lotNo: inLine.lotNo,
        date: input.date,
        type: input.kind as MovementType,
        bags: l.bags.mul(dir).toString(),
        kg: l.kg.mul(dir).toString(),
        unitCostPerKg: e.costPerKg.toString(),
        value: e.value.mul(dir).toFixed(2),
        invoiceId: inv.id,
        invoiceLineId: line.id,
        createdBy: ctx.userId,
      });
    }
    for (const [productId, s] of stock) {
      await tx
        .update(productStock)
        .set({ bags: s.bags, kg: s.kg, value: s.value, lowStockAlerted: s.lowStockAlerted, updatedAt: new Date() })
        .where(eq(productStock.productId, productId));
    }

    // ── Checks that warn but don't block
    const s = business.resolved;
    if (input.kind === "sale" && party.creditLimit) {
      const bal = D(await partyBalance(tx, party.id));
      if (bal.gt(party.creditLimit)) {
        const msg = `${party.name} is over the credit limit: owes ${inr(bal, 0)} (limit ${inr(party.creditLimit, 0)})`;
        warnings.push(msg);
        alerts.push({ type: "unusual", msg: `Credit limit crossed — ${msg}` });
      }
    }
    const backDays = daysBetween(input.date, todayIST());
    if (backDays > s.backdateAlertDays)
      alerts.push({ type: "unusual", msg: `Back-dated entry: ${KIND_LABEL[input.kind]} ${number} dated ${input.date} (${backDays} days ago) entered by ${ctx.name}` });

    const itemsText = calc.lines
      .map((l, i) => `${formatQty(l.bags)} bags ${prodMap.get(input.lines[i].productId)!.name}`)
      .join(", ");
    const summary = `${KIND_LABEL[input.kind]} ${number} — ${party.name} — ${inr(calc.total, 0)} (${itemsText})`;
    await audit(tx, {
      businessId: ctx.businessId,
      userId: ctx.userId,
      action: "create",
      entity: "invoice",
      entityId: inv.id,
      summary,
      data: { input: { ...input, idempotencyKey: undefined }, total: calc.total.toFixed(2) },
    });
    if (calc.total.gte(s.majorTxnThreshold)) await enqueue(tx, ctx.businessId, "major_txn", `Large ${summary}. Entered by ${ctx.name}.`);
    for (const a of alerts) await enqueue(tx, ctx.businessId, a.type, a.msg);

    return { invoiceId: inv.id, number, total: calc.total.toFixed(2), warnings };
  });
}

type Decimal = ReturnType<typeof D>;

export async function cancelInvoice(ctx: Ctx, invoiceId: number, reason: string) {
  requirePerm(ctx, "cancel_posted");
  const why = reason.trim();
  if (why.length < 3) throw new AppError("Write a short reason for cancelling");
  return db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, ctx.businessId)))
      .for("update");
    if (!inv) throw new AppError("Invoice not found");
    if (inv.status !== "posted") throw new AppError("This invoice is already cancelled");
    const [ret] = await tx
      .select({ number: invoices.number })
      .from(invoices)
      .where(and(eq(invoices.refInvoiceId, inv.id), eq(invoices.status, "posted")));
    if (ret) throw new AppError(`Cancel return ${ret.number} first — it was made against this invoice`);

    const moves = await tx
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.invoiceId, inv.id), ne(stockMovements.type, "reversal")));
    const stock = await lockStock(tx, ctx.businessId, moves.map((m) => m.productId));
    const names = new Map(
      (await tx.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, moves.map((m) => m.productId).concat(0)))).map((p) => [p.id, p.name]),
    );
    for (const m of moves) {
      const s = stock.get(m.productId)!;
      const bags = D(s.bags).sub(m.bags);
      const kg = D(s.kg).sub(m.kg);
      if (bags.isNeg() || kg.isNeg())
        throw new AppError(
          `Can't cancel: ${names.get(m.productId)} from this bill has already been sold. Make a ${inv.kind === "purchase" ? "purchase return" : "correction"} instead.`,
          "stock",
        );
      let value = kg.isZero() ? D(0) : D(s.value).sub(m.value);
      if (value.isNeg()) value = D(0);
      s.bags = bags.toString();
      s.kg = kg.toString();
      s.value = value.toFixed(2);
      await tx.insert(stockMovements).values({
        businessId: ctx.businessId,
        productId: m.productId,
        lotNo: m.lotNo,
        date: todayIST(),
        type: "reversal",
        bags: D(m.bags).neg().toString(),
        kg: D(m.kg).neg().toString(),
        unitCostPerKg: m.unitCostPerKg,
        value: D(m.value).neg().toFixed(2),
        invoiceId: inv.id,
        invoiceLineId: m.invoiceLineId,
        note: `Cancelled ${inv.number}: ${why}`,
        createdBy: ctx.userId,
      });
    }
    for (const [productId, s] of stock)
      await tx.update(productStock).set({ bags: s.bags, kg: s.kg, value: s.value, updatedAt: new Date() }).where(eq(productStock.productId, productId));

    await tx
      .update(invoices)
      .set({ status: "cancelled", cancelledBy: ctx.userId, cancelledAt: new Date(), cancelReason: why })
      .where(eq(invoices.id, inv.id));
    const [party] = await tx.select({ name: parties.name }).from(parties).where(eq(parties.id, inv.partyId));
    const summary = `Cancelled ${KIND_LABEL[inv.kind]} ${inv.number} — ${party.name} — ${inr(inv.total, 0)}. Reason: ${why}`;
    await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "cancel", entity: "invoice", entityId: inv.id, summary });
    await enqueue(tx, ctx.businessId, "unusual", `${summary} (by ${ctx.name})`);
    return { ok: true };
  });
}

// ───────────────────────────────── Payments ─────────────────────────────────

export const paymentInput = z.object({
  direction: z.enum(["in", "out"]),
  partyId: z.coerce.number().int().positive("Pick a party"),
  accountId: z.coerce.number().int().positive("Pick a cash or bank account"),
  date: isoDate,
  amount: z.coerce.number().positive("Amount must be more than 0").max(10_000_000_000),
  mode: z.enum(["cash", "bank", "upi", "cheque"]),
  reference: optText(120),
  chequeNo: optText(40),
  notes: optText(500),
  idempotencyKey: z.string().min(8).max(100),
  confirmDuplicate: z.boolean().optional().default(false),
});
export type PaymentInput = z.input<typeof paymentInput>;

export async function recordPayment(ctx: Ctx, raw: PaymentInput) {
  requirePerm(ctx, "create_transactions");
  const input = parseInput(paymentInput, raw);
  checkDate(input.date);
  if (input.mode === "cheque" && !input.chequeNo) throw new AppError("Enter the cheque number");
  return db.transaction(async (tx) => {
    const [dupKey] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.businessId, ctx.businessId), eq(payments.idempotencyKey, input.idempotencyKey)));
    if (dupKey) return { paymentId: dupKey.id, warnings: [] as string[], alreadyPosted: true };

    const [party] = await tx
      .select()
      .from(parties)
      .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
      .for("update");
    if (!party) throw new AppError("Party not found");
    const [acct] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, input.accountId), eq(accounts.businessId, ctx.businessId)));
    if (!acct || !acct.active) throw new AppError("Account not found");
    if (input.mode === "cash" && acct.type !== "cash") throw new AppError("Cash payments go to a cash account");
    if (input.mode !== "cash" && acct.type !== "bank") throw new AppError("Bank, UPI and cheque payments go to a bank account");

    const amount = round2(String(input.amount));
    if (!input.confirmDuplicate) {
      const [same] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.businessId, ctx.businessId),
            eq(payments.partyId, party.id),
            eq(payments.direction, input.direction),
            eq(payments.date, input.date),
            eq(payments.amount, amount.toFixed(2)),
            eq(payments.status, "posted"),
          ),
        );
      if (same) throw new DuplicateWarning(`A ${inr(amount, 0)} payment ${input.direction === "in" ? "from" : "to"} ${party.name} on this date is already entered. Is this a duplicate?`, same.id);
    }

    const before = D(await partyBalance(tx, party.id));
    const [p] = await tx
      .insert(payments)
      .values({
        businessId: ctx.businessId,
        direction: input.direction,
        partyId: party.id,
        accountId: acct.id,
        date: input.date,
        amount: amount.toFixed(2),
        mode: input.mode,
        reference: input.reference,
        chequeNo: input.chequeNo,
        chequeStatus: input.mode === "cheque" ? "pending" : "na",
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
        createdBy: ctx.userId,
      })
      .returning();

    const warnings: string[] = [];
    const after = D(await partyBalance(tx, party.id));
    if (input.direction === "in" && before.gt(0) && after.isNeg()) warnings.push(`${party.name} has now paid ${inr(after.neg(), 0)} more than owed (kept as advance)`);
    if (input.direction === "out" && before.isNeg() && after.gt(0)) warnings.push(`You have now paid ${party.name} ${inr(after, 0)} more than owed (kept as advance)`);

    const summary = `${input.direction === "in" ? "Received" : "Paid"} ${inr(amount, 0)} ${input.direction === "in" ? "from" : "to"} ${party.name} by ${input.mode}${input.chequeNo ? ` #${input.chequeNo}` : ""}`;
    await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "create", entity: "payment", entityId: p.id, summary });
    const b = await getBusiness(tx, ctx.businessId);
    if (amount.gte(b.resolved.majorTxnThreshold)) await enqueue(tx, ctx.businessId, "major_txn", `Large payment: ${summary}. Entered by ${ctx.name}.`);
    const backDays = daysBetween(input.date, todayIST());
    if (backDays > b.resolved.backdateAlertDays) await enqueue(tx, ctx.businessId, "unusual", `Back-dated payment (${backDays} days): ${summary}, entered by ${ctx.name}`);
    return { paymentId: p.id, warnings, alreadyPosted: false };
  });
}

export async function cancelPayment(ctx: Ctx, paymentId: number, reason: string) {
  requirePerm(ctx, "cancel_posted");
  const why = reason.trim();
  if (why.length < 3) throw new AppError("Write a short reason for cancelling");
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.businessId, ctx.businessId)))
      .for("update");
    if (!p) throw new AppError("Payment not found");
    if (p.status !== "posted") throw new AppError("This payment is already cancelled");
    await tx.update(payments).set({ status: "cancelled", cancelledBy: ctx.userId, cancelledAt: new Date(), cancelReason: why }).where(eq(payments.id, p.id));
    const [party] = await tx.select({ name: parties.name }).from(parties).where(eq(parties.id, p.partyId));
    const summary = `Cancelled payment of ${inr(p.amount, 0)} ${p.direction === "in" ? "from" : "to"} ${party.name}. Reason: ${why}`;
    await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "cancel", entity: "payment", entityId: p.id, summary });
    await enqueue(tx, ctx.businessId, "unusual", `${summary} (by ${ctx.name})`);
  });
}

export async function setChequeStatus(ctx: Ctx, paymentId: number, status: "cleared" | "bounced") {
  requirePerm(ctx, "update_cheque");
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.businessId, ctx.businessId)))
      .for("update");
    if (!p || p.mode !== "cheque") throw new AppError("Cheque not found");
    if (p.status !== "posted") throw new AppError("This payment is cancelled");
    if (p.chequeStatus !== "pending") throw new AppError(`This cheque is already marked ${p.chequeStatus}`);
    await tx.update(payments).set({ chequeStatus: status }).where(eq(payments.id, p.id));
    const [party] = await tx.select({ name: parties.name }).from(parties).where(eq(parties.id, p.partyId));
    const summary = `Cheque #${p.chequeNo} ${p.direction === "in" ? "from" : "to"} ${party.name} for ${inr(p.amount, 0)} marked ${status}`;
    await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "update", entity: "payment", entityId: p.id, summary });
    if (status === "bounced") await enqueue(tx, ctx.businessId, "unusual", `${summary}. The amount is back in their balance.`);
  });
}

// ───────────────────────────────── Expenses ─────────────────────────────────

export const EXPENSE_CATEGORIES = ["Salary & wages", "Rent", "Electricity", "Transport & hamali", "Brokerage", "Bank charges", "Office", "Repairs", "Telephone & internet", "Other"];

export const expenseInput = z.object({
  date: isoDate,
  category: z.string().trim().min(1, "Pick a category").max(60),
  amount: z.coerce.number().positive("Amount must be more than 0").max(1_000_000_000),
  accountId: z.coerce.number().int().positive("Pick the account it was paid from"),
  paidTo: optText(120),
  notes: optText(500),
  idempotencyKey: z.string().min(8).max(100),
});

export async function recordExpense(ctx: Ctx, raw: z.input<typeof expenseInput>) {
  requirePerm(ctx, "create_transactions");
  const input = parseInput(expenseInput, raw);
  checkDate(input.date);
  return db.transaction(async (tx) => {
    const [dupKey] = await tx
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.businessId, ctx.businessId), eq(expenses.idempotencyKey, input.idempotencyKey)));
    if (dupKey) return { expenseId: dupKey.id };
    const [acct] = await tx.select().from(accounts).where(and(eq(accounts.id, input.accountId), eq(accounts.businessId, ctx.businessId)));
    if (!acct) throw new AppError("Account not found");
    const amount = round2(String(input.amount));
    const [e] = await tx
      .insert(expenses)
      .values({ businessId: ctx.businessId, date: input.date, category: input.category, amount: amount.toFixed(2), accountId: acct.id, paidTo: input.paidTo, notes: input.notes, idempotencyKey: input.idempotencyKey, createdBy: ctx.userId })
      .returning();
    await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "create", entity: "expense", entityId: e.id, summary: `Expense ${inr(amount, 0)} — ${input.category}${input.paidTo ? ` to ${input.paidTo}` : ""} from ${acct.name}` });
    return { expenseId: e.id };
  });
}

export async function cancelExpense(ctx: Ctx, id: number, reason: string) {
  requirePerm(ctx, "cancel_posted");
  const why = reason.trim();
  if (why.length < 3) throw new AppError("Write a short reason for cancelling");
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(expenses).where(and(eq(expenses.id, id), eq(expenses.businessId, ctx.businessId))).for("update");
    if (!e) throw new AppError("Expense not found");
    if (e.status !== "posted") throw new AppError("Already cancelled");
    await tx.update(expenses).set({ status: "cancelled", cancelledBy: ctx.userId, cancelledAt: new Date(), cancelReason: why }).where(eq(expenses.id, id));
    await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "cancel", entity: "expense", entityId: id, summary: `Cancelled expense ${inr(e.amount, 0)} — ${e.category}. Reason: ${why}` });
  });
}

// ───────────────────────────────── Stock adjustments ─────────────────────────────────

export const stockAdjustInput = z.object({
  productId: z.coerce.number().int().positive(),
  type: z.enum(["opening", "adjustment"]),
  date: isoDate,
  bags: z.coerce.number().refine((n) => n !== 0, "Bags can't be 0"),
  kg: optNum(z.coerce.number()),
  costPerKg: optNum(z.coerce.number().nonnegative()),
  lotNo: optText(60),
  note: z.string().trim().min(3, "Write a short note (e.g. physical count on 31 Mar)").max(300),
});

/** Opening stock and physical-count corrections. Additions use the given cost (or current average). */
export async function adjustStock(ctx: Ctx, raw: z.input<typeof stockAdjustInput>) {
  requirePerm(ctx, "adjust_stock");
  const input = parseInput(stockAdjustInput, raw);
  checkDate(input.date);
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(products).where(and(eq(products.id, input.productId), eq(products.businessId, ctx.businessId)));
    if (!p) throw new AppError("Product not found");
    const stock = await lockStock(tx, ctx.businessId, [p.id]);
    const s = stock.get(p.id)!;
    const bags = round3(String(input.bags));
    const kg = input.kg !== undefined ? round3(String(input.kg)) : round3(bags.mul(p.bagWeightKg));
    if (bags.isNeg() !== kg.isNeg()) throw new AppError("Bags and kg must both be additions or both be removals");
    const avg = D(s.kg).isZero() ? D(0) : D(s.value).div(s.kg);
    let costPerKg: Decimal;
    if (bags.gt(0)) {
      if (input.costPerKg === undefined) {
        if (avg.isZero()) throw new AppError("Enter the cost per kg (there is no average cost yet for this product)");
        costPerKg = avg;
      } else costPerKg = D(String(input.costPerKg));
    } else costPerKg = avg;
    const value = round2(kg.mul(costPerKg));
    const newBags = D(s.bags).add(bags);
    const newKg = D(s.kg).add(kg);
    if (newBags.isNeg() || newKg.isNeg()) throw new AppError(`Only ${formatQty(s.bags)} bags in stock`);
    let newValue = newKg.isZero() ? D(0) : D(s.value).add(value);
    if (newValue.isNeg()) newValue = D(0);
    await tx.insert(stockMovements).values({
      businessId: ctx.businessId,
      productId: p.id,
      lotNo: input.lotNo,
      date: input.date,
      type: input.type,
      bags: bags.toString(),
      kg: kg.toString(),
      unitCostPerKg: round4(costPerKg).toString(),
      value: value.toFixed(2),
      note: input.note,
      createdBy: ctx.userId,
    });
    await tx.update(productStock).set({ bags: newBags.toString(), kg: newKg.toString(), value: newValue.toFixed(2), lowStockAlerted: newBags.lt(p.lowStockBags) ? s.lowStockAlerted : false, updatedAt: new Date() }).where(eq(productStock.productId, p.id));
    await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "create", entity: "stock", entityId: p.id, summary: `${input.type === "opening" ? "Opening stock" : "Stock adjustment"}: ${p.name} ${bags.gt(0) ? "+" : ""}${formatQty(bags)} bags (${formatQty(kg)} kg). ${input.note}` });
    if (input.type === "adjustment" && bags.isNeg()) await enqueue(tx, ctx.businessId, "unusual", `Stock reduced by adjustment: ${p.name} ${formatQty(bags)} bags by ${ctx.name}. Note: ${input.note}`);
  });
}
