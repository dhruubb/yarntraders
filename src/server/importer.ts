/**
 * Import pipeline: file/photo → staged rows (nothing posted) → human review → post.
 * Sales/purchases are posted through the same posting engine as manual entry, so stock,
 * balances, duplicate checks and the audit log behave exactly the same.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { db } from "@/db";
import { importBatches, importRows, parties, products } from "@/db/schema";
import { D, computeInvoice, todayIST, type RateBasis } from "@/lib/calc";
import { AppError } from "./errors";
import { audit } from "./audit";
import { adjustStock, postInvoice, requirePerm, type Ctx } from "./posting";
import { savePartyRecord, saveProductRecord } from "./masters";

export type ImportKind = "sale" | "purchase" | "parties" | "products" | "opening_stock";

export const TEMPLATES: Record<ImportKind, { headers: string[]; example: string[]; help: string }> = {
  sale: { headers: ["date", "party", "product", "bags", "rate", "kg", "lot", "register_amount"], example: ["2026-10-01", "Khalid B.R", "30 Amrut", "40", "1258", "", "", "503200"], help: "One row per bill line. Rows with the same date and party become one bill. Rate is before GST, in the product's rate unit. register_amount is optional and is checked against the calculated amount." },
  purchase: { headers: ["date", "party", "product", "bags", "rate", "kg", "lot", "bill_no", "register_amount"], example: ["2026-10-01", "Suresh Bucha", "47 VPN", "200", "1620", "", "", "SB/4471", "4082400"], help: "One row per bill line. Rows with the same date, party and bill_no become one bill. Rate is before GST." },
  parties: { headers: ["name", "type", "phone", "city", "gstin", "state_code", "credit_days", "credit_limit", "opening_balance"], example: ["Khalid B.R", "customer", "9800000000", "Malegaon", "", "27", "30", "1500000", "125000"], help: "type: customer, supplier or both. opening_balance: positive = they owe you, negative = you owe them." },
  products: { headers: ["count", "brand", "quality", "bag_weight_kg", "rate_basis", "hsn", "gst_rate", "low_stock_bags"], example: ["30", "Amrut", "", "50", "per_5kg", "5205", "5", "30"], help: "rate_basis: per_5kg, per_kg, per_bag or per_lb." },
  opening_stock: { headers: ["product", "bags", "kg", "cost_per_kg", "lot"], example: ["30 Amrut", "120", "", "236.50", ""], help: "cost_per_kg is before GST. Leave kg blank to use the standard bag weight." },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES: Record<string, string[]> = {
  date: ["date", "billdate", "dt"],
  party: ["party", "partyname", "customer", "supplier", "name"],
  product: ["product", "yarn", "item", "quality", "count"],
  bags: ["bags", "bag", "qty", "quantity"],
  rate: ["rate", "price"],
  kg: ["kg", "weight", "kgs", "weightkg"],
  lot: ["lot", "lotno", "batch"],
  bill_no: ["billno", "bill", "invoiceno", "invoice", "supplierbillno"],
  register_amount: ["registeramount", "amount", "total"],
};

function canonical(header: string, kind: ImportKind): string {
  const n = norm(header);
  if (kind === "sale" || kind === "purchase") {
    for (const [k, list] of Object.entries(ALIASES)) if (list.includes(n)) return k;
  }
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

export function parseDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

const num = (v: unknown) => {
  const s = String(v ?? "").replace(/[,₹\s]/g, "").replace(/^rs\.?/i, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

export async function parseSpreadsheet(fileName: string, buf: Buffer, kind: ImportKind): Promise<Record<string, unknown>[]> {
  let raw: Record<string, unknown>[];
  if (/\.xlsx$/i.test(fileName)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new AppError("The Excel file has no sheets");
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => (headers[i - 1] = String(c.value ?? "")));
    raw = [];
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const o: Record<string, unknown> = {};
      headers.forEach((h, j) => {
        const v = row.getCell(j + 1).value as unknown;
        o[h] = v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v;
      });
      if (Object.values(o).some((v) => v !== null && v !== undefined && String(v).trim() !== "")) raw.push(o);
    });
  } else if (/\.(csv|txt)$/i.test(fileName)) {
    const parsed = Papa.parse<Record<string, string>>(buf.toString("utf8").replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" });
    raw = parsed.data;
  } else throw new AppError("Upload a .csv or .xlsx file");
  if (raw.length > 5000) throw new AppError("Too many rows (max 5,000 per import). Split the file.");
  return raw.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [canonical(k, kind), v instanceof Date ? v : typeof v === "string" ? v.trim() : v])));
}

/** Best-effort name matching: exact (ignoring case/punctuation), then all-words-contained. */
function matcher<T extends { id: number; name: string }>(items: T[]) {
  const byNorm = new Map(items.map((i) => [norm(i.name), i]));
  return (name: string): T | undefined => {
    if (!name) return undefined;
    const exact = byNorm.get(norm(name));
    if (exact) return exact;
    const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const hits = items.filter((i) => words.every((w) => i.name.toLowerCase().includes(w)));
    return hits.length === 1 ? hits[0] : undefined;
  };
}

export async function createBatch(ctx: Ctx, kind: ImportKind, source: "csv" | "xlsx" | "ocr", fileName: string, rows: Record<string, unknown>[]) {
  requirePerm(ctx, "import_data");
  if (rows.length === 0) throw new AppError("No rows found in the file");
  let staged = rows;
  if (kind === "sale" || kind === "purchase") {
    const [ps, prs] = await Promise.all([
      db.select({ id: parties.id, name: parties.name }).from(parties).where(eq(parties.businessId, ctx.businessId)),
      db.select({ id: products.id, name: products.name }).from(products).where(eq(products.businessId, ctx.businessId)),
    ]);
    const mp = matcher(ps);
    const mpr = matcher(prs);
    staged = rows.map((r) => ({
      ...r,
      date: parseDate(r.date) ?? (source === "ocr" ? todayIST() : r.date),
      party_id: mp(String(r.party ?? ""))?.id ?? null,
      product_id: mpr(String(r.product ?? ""))?.id ?? null,
    }));
  }
  return db.transaction(async (tx) => {
    const [b] = await tx.insert(importBatches).values({ businessId: ctx.businessId, source, kind, fileName, createdBy: ctx.userId }).returning();
    await tx.insert(importRows).values(staged.map((data, i) => ({ batchId: b.id, rowNo: i + 1, data, status: data.struck_through ? ("rejected" as const) : ("pending" as const) })));
    await audit(tx, { businessId: ctx.businessId, userId: ctx.userId, action: "create", entity: "import", entityId: b.id, summary: `Started ${source.toUpperCase()} import of ${staged.length} ${kind.replace("_", " ")} rows from ${fileName || "photo"} (not posted yet)` });
    return b.id;
  });
}

export async function getBatch(businessId: number, batchId: number) {
  const [b] = await db.select().from(importBatches).where(and(eq(importBatches.id, batchId), eq(importBatches.businessId, businessId)));
  if (!b) return null;
  const rows = await db.select().from(importRows).where(eq(importRows.batchId, b.id)).orderBy(asc(importRows.rowNo));
  return { batch: b, rows };
}

export async function updateRow(ctx: Ctx, rowId: number, data: Record<string, unknown>, status?: "pending" | "rejected") {
  requirePerm(ctx, "import_data");
  const r = await db.execute<{ id: number; status: string }>(sql`
    SELECT r.id, r.status FROM import_rows r JOIN import_batches b ON b.id = r.batch_id WHERE r.id = ${rowId} AND b.business_id = ${ctx.businessId}`);
  const row = r.rows[0];
  if (!row) throw new AppError("Row not found");
  if (row.status === "posted") throw new AppError("This row is already posted");
  const allowed = ["date", "party_id", "product_id", "bags", "rate", "kg", "lot", "bill_no", "register_amount", "amount_ok"];
  const clean: Record<string, unknown> = Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
  // Changing any number means the amount must be re-confirmed
  if (["bags", "rate", "kg", "register_amount", "product_id"].some((k) => k in clean)) clean.amount_ok = false;
  await db.execute(sql`UPDATE import_rows SET data = data || ${JSON.stringify(clean)}::jsonb, status = ${status ?? "pending"}, error = NULL WHERE id = ${rowId}`);
}

/** Validates a sale/purchase line and computes its amount for the register check. */
export function checkLine(d: Record<string, unknown>, prod: { bagWeightKg: string; rateBasis: RateBasis; gstRate: string } | undefined, interstate: boolean) {
  const errors: string[] = [];
  const date = parseDate(d.date);
  if (!date) errors.push("date");
  if (!d.party_id) errors.push("party");
  if (!d.product_id || !prod) errors.push("yarn");
  const bags = num(d.bags);
  const rate = num(d.rate);
  if (!bags || bags <= 0 || Number.isNaN(bags)) errors.push("bags");
  if (rate === null || Number.isNaN(rate) || rate < 0) errors.push("rate");
  let taxable: string | null = null;
  let total: string | null = null;
  let match: "ok" | "mismatch" | "none" = "none";
  if (prod && bags && rate !== null && !Number.isNaN(rate) && !Number.isNaN(bags)) {
    const kg = num(d.kg);
    const c = computeInvoice({ lines: [{ bags, bagWeightKg: prod.bagWeightKg, kgOverride: kg && kg > 0 ? kg : null, rate, rateBasis: prod.rateBasis, gstRate: prod.gstRate }], interstate });
    taxable = c.lines[0].amount.toFixed(2);
    total = c.total.toFixed(2);
    const reg = num(d.register_amount);
    if (reg !== null && !Number.isNaN(reg)) match = D(reg).sub(taxable).abs().lte(1) || D(reg).sub(total).abs().lte(1) ? "ok" : "mismatch";
  }
  if (match === "mismatch" && !d.amount_ok) errors.push("amount");
  return { errors, date, taxable, total, match };
}

/** Posts all pending rows. Each bill is its own transaction; a failure marks that row and moves on. */
export async function postBatch(ctx: Ctx, batchId: number) {
  requirePerm(ctx, "import_data");
  const data = await getBatch(ctx.businessId, batchId);
  if (!data) throw new AppError("Import not found");
  const { batch, rows } = data;
  let pending = rows.filter((r) => r.status === "pending" || r.status === "error");
  if (batch.kind === "sale" || batch.kind === "purchase") {
    // Server-side guard: never post a row the review screen would block
    const [ps, prs] = await Promise.all([
      db.select({ id: parties.id, stateCode: parties.stateCode }).from(parties).where(eq(parties.businessId, ctx.businessId)),
      db.select().from(products).where(eq(products.businessId, ctx.businessId)),
    ]);
    const [biz] = await db.execute<{ state_code: string }>(sql`SELECT state_code FROM businesses WHERE id = ${ctx.businessId}`).then((r) => r.rows);
    const pm = new Map(ps.map((p) => [p.id, p]));
    const prm = new Map(prs.map((p) => [p.id, p]));
    pending = pending.filter((r) => {
      const pr = prm.get(Number(r.data.product_id));
      const pa = pm.get(Number(r.data.party_id));
      return checkLine(r.data, pr ? { bagWeightKg: pr.bagWeightKg, rateBasis: pr.rateBasis as RateBasis, gstRate: pr.gstRate } : undefined, pa ? pa.stateCode !== biz.state_code : false).errors.length === 0;
    });
  }
  let posted = 0;
  let failed = 0;
  const mark = async (ids: number[], status: "posted" | "error", error: string | null, resultId: number | null) => {
    for (const id of ids) await db.update(importRows).set({ status, error, resultId }).where(eq(importRows.id, id));
    if (status === "posted") posted += ids.length;
    else failed += ids.length;
  };
  const errMsg = (e: unknown) => (e instanceof AppError ? e.message : ((e as { cause?: { message?: string } })?.cause?.message ?? (e as Error).message ?? "Failed"));

  if (batch.kind === "sale" || batch.kind === "purchase") {
    const groups = new Map<string, typeof pending>();
    for (const r of pending) {
      const d = r.data;
      const k = [parseDate(d.date), d.party_id, batch.kind === "purchase" ? (d.bill_no ?? "") : ""].join("|");
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    for (const [, g] of groups) {
      const d0 = g[0].data;
      try {
        const res = await postInvoice(ctx, {
          kind: batch.kind,
          partyId: Number(d0.party_id),
          date: parseDate(d0.date) ?? "",
          supplierBillNo: batch.kind === "purchase" ? String(d0.bill_no ?? "") : "",
          idempotencyKey: `import-${batch.id}-${g.map((r) => r.id).join("-")}`,
          source: batch.source === "ocr" ? "ocr" : "import",
          notes: `Imported from ${batch.fileName || batch.source} (import #${batch.id})`,
          confirmDuplicate: true,
          lines: g.map((r) => ({ productId: Number(r.data.product_id), bags: Number(num(r.data.bags)), rate: Number(num(r.data.rate)), kg: num(r.data.kg) ?? "", lotNo: String(r.data.lot ?? "") })),
        });
        await mark(g.map((r) => r.id), "posted", null, res.invoiceId);
      } catch (e) {
        await mark(g.map((r) => r.id), "error", errMsg(e), null);
      }
    }
  } else {
    for (const r of pending) {
      const d = r.data;
      try {
        let id: number | null = null;
        if (batch.kind === "parties") {
          const ob = num(d.opening_balance) ?? 0;
          const t = String(d.type ?? "customer").toLowerCase();
          id = await savePartyRecord(ctx, {
            name: String(d.name ?? ""), type: (["customer", "supplier", "both"].includes(t) ? t : "customer") as "customer",
            phone: String(d.phone ?? ""), city: String(d.city ?? ""), gstin: String(d.gstin ?? ""),
            stateCode: String(d.state_code || String(d.gstin ?? "").slice(0, 2) || "27").padStart(2, "0"),
            creditDays: Number(num(d.credit_days) ?? 30), creditLimit: num(d.credit_limit) ?? "",
            openingBalance: Math.abs(ob), openingSide: ob < 0 ? "payable" : "receivable",
          });
        } else if (batch.kind === "products") {
          id = await saveProductRecord(ctx, {
            count: String(d.count ?? ""), brand: String(d.brand ?? ""), quality: String(d.quality ?? ""),
            bagWeightKg: Number(num(d.bag_weight_kg)), rateBasis: (String(d.rate_basis || "per_5kg") as RateBasis),
            hsn: String(d.hsn || "5205"), gstRate: Number(num(d.gst_rate) ?? 5), lowStockBags: Number(num(d.low_stock_bags) ?? 0),
          });
        } else if (batch.kind === "opening_stock") {
          const all = await db.select({ id: products.id, name: products.name }).from(products).where(eq(products.businessId, ctx.businessId));
          const p = matcher(all)(String(d.product ?? ""));
          if (!p) throw new AppError(`Product "${d.product}" not found — add it first`);
          await adjustStock(ctx, { productId: p.id, type: "opening", date: todayIST(), bags: Number(num(d.bags)), kg: num(d.kg) ?? "", costPerKg: num(d.cost_per_kg) ?? "", lotNo: String(d.lot ?? ""), note: `Opening stock import #${batch.id}` });
          id = p.id;
        }
        await mark([r.id], "posted", null, id);
      } catch (e) {
        await mark([r.id], "error", errMsg(e), null);
      }
    }
  }
  const left = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM import_rows WHERE batch_id = ${batch.id} AND status IN ('pending','error')`);
  if (left.rows[0].n === 0) await db.update(importBatches).set({ status: "done" }).where(eq(importBatches.id, batch.id));
  await audit(db, { businessId: ctx.businessId, userId: ctx.userId, action: "create", entity: "import", entityId: batch.id, summary: `Posted import #${batch.id}: ${posted} rows posted, ${failed} failed` });
  return { posted, failed };
}

export function templateCsv(kind: ImportKind) {
  const t = TEMPLATES[kind];
  return "﻿" + [t.headers.join(","), t.example.map((v) => (v.includes(",") ? `"${v}"` : v)).join(",")].join("\r\n");
}

