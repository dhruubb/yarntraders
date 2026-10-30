import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { PartyOpt, ProductOpt } from "@/components/client/InvoiceForm";

export async function partyOptions(businessId: number, role: "customer" | "supplier" | "any"): Promise<PartyOpt[]> {
  const r = await db.execute<{ id: number; name: string; city: string; state_code: string; credit_days: number; balance: string }>(sql`
    SELECT p.id, p.name, p.city, p.state_code, p.credit_days, b.balance
    FROM parties p JOIN party_balances b ON b.party_id = p.id
    WHERE p.business_id = ${businessId} AND p.active
      ${role === "customer" ? sql`AND p.type IN ('customer','both')` : role === "supplier" ? sql`AND p.type IN ('supplier','both')` : sql``}
    ORDER BY p.name`);
  return r.rows.map((p) => ({ id: p.id, name: p.name, city: p.city, stateCode: p.state_code, creditDays: p.credit_days, balance: p.balance }));
}

export async function productOptions(businessId: number, kind: "sale" | "purchase"): Promise<ProductOpt[]> {
  const r = await db.execute<{ id: number; name: string; bag_weight_kg: string; rate_basis: ProductOpt["rateBasis"]; gst_rate: string; bags: string | null; last_rate: string | null }>(sql`
    SELECT p.id, p.name, p.bag_weight_kg, p.rate_basis, p.gst_rate, s.bags,
      (SELECT l.rate FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
        WHERE l.product_id = p.id AND i.kind = ${kind} AND i.status = 'posted' ORDER BY i.date DESC, i.id DESC LIMIT 1) AS last_rate
    FROM products p LEFT JOIN product_stock s ON s.product_id = p.id
    WHERE p.business_id = ${businessId} AND p.active ORDER BY p.count, p.brand`);
  return r.rows.map((p) => ({ id: p.id, name: p.name, bagWeightKg: p.bag_weight_kg, rateBasis: p.rate_basis, gstRate: p.gst_rate, stockBags: p.bags ?? "0", lastRate: p.last_rate }));
}

export async function accountOptions(businessId: number) {
  const r = await db.execute<{ id: number; name: string; type: "cash" | "bank" }>(sql`SELECT id, name, type FROM accounts WHERE business_id = ${businessId} AND active ORDER BY type, name`);
  return r.rows;
}
