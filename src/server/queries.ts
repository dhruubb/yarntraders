/** Read-side queries: balances, ledgers, outstanding (FIFO), dashboard figures. */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { D, addDays, daysBetween, todayIST } from "@/lib/calc";

type Row = Record<string, unknown>;
async function q<T = Row>(query: ReturnType<typeof sql>): Promise<T[]> {
  const r = await db.execute(query);
  return r.rows as T[];
}

export const RECEIVABLE_KINDS = ["sale", "purchase_return"] as const;
export const PAYABLE_KINDS = ["purchase", "sale_return"] as const;

export async function accountBalances(businessId: number) {
  return q<{ id: number; name: string; type: "cash" | "bank"; balance: string; active: boolean }>(sql`
    SELECT a.id, a.name, a.type, a.active, b.balance FROM accounts a JOIN account_balances b ON b.account_id = a.id
    WHERE a.business_id = ${businessId} ORDER BY a.type, a.name`);
}

export async function partyList(businessId: number, opts: { search?: string; type?: string; balance?: string } = {}) {
  const search = opts.search?.trim() ? `%${opts.search.trim()}%` : null;
  return q<{ id: number; name: string; type: string; phone: string; city: string; gstin: string; credit_limit: string | null; credit_days: number; balance: string; active: boolean; last_txn: string | null }>(sql`
    SELECT p.id, p.name, p.type, p.phone, p.city, p.gstin, p.credit_limit, p.credit_days, p.active, b.balance,
      (SELECT MAX(i.date) FROM invoices i WHERE i.party_id = p.id AND i.status = 'posted') AS last_txn
    FROM parties p JOIN party_balances b ON b.party_id = p.id
    WHERE p.business_id = ${businessId}
      ${search ? sql`AND (p.name ILIKE ${search} OR p.phone ILIKE ${search} OR p.city ILIKE ${search} OR p.gstin ILIKE ${search})` : sql``}
      ${opts.type === "customer" ? sql`AND p.type IN ('customer','both')` : opts.type === "supplier" ? sql`AND p.type IN ('supplier','both')` : sql``}
      ${opts.balance === "receivable" ? sql`AND b.balance > 0` : opts.balance === "payable" ? sql`AND b.balance < 0` : sql``}
    ORDER BY p.active DESC, p.name`);
}

export type LedgerEntry = {
  date: string;
  kind: string;
  ref: string;
  link: string | null;
  description: string;
  debit: string; // increases what the party owes us
  credit: string; // decreases it
  balance: string;
};

/** Party statement with running balance. Positive balance = party owes us (Dr). */
export async function partyLedger(businessId: number, partyId: number, from?: string, to?: string) {
  const rows = await q<{ date: string; kind: string; ref: string; id: number; description: string; amount: string; sort: string }>(sql`
    SELECT i.date, i.kind, i.number AS ref, i.id,
      COALESCE(NULLIF(i.supplier_bill_no, ''), '') AS description,
      CASE WHEN i.kind IN ('sale','purchase_return') THEN i.total ELSE -i.total END AS amount,
      i.created_at::text AS sort
    FROM invoices i WHERE i.party_id = ${partyId} AND i.business_id = ${businessId} AND i.status = 'posted'
    UNION ALL
    SELECT y.date, CASE y.direction WHEN 'in' THEN 'receipt' ELSE 'payment' END, '#' || y.id, y.id,
      y.mode || CASE WHEN y.cheque_no <> '' THEN ' #' || y.cheque_no || ' (' || y.cheque_status || ')' ELSE '' END
        || CASE WHEN y.reference <> '' THEN ' · ' || y.reference ELSE '' END,
      CASE y.direction WHEN 'out' THEN y.amount ELSE -y.amount END,
      y.created_at::text
    FROM payments y WHERE y.party_id = ${partyId} AND y.business_id = ${businessId} AND y.status = 'posted' AND y.cheque_status <> 'bounced'
    ORDER BY date, sort`);
  const [party] = await q<{ opening_balance: string }>(sql`SELECT opening_balance FROM parties WHERE id = ${partyId} AND business_id = ${businessId}`);
  if (!party) return null;
  let bal = D(party.opening_balance);
  const entries: LedgerEntry[] = [];
  let openingForPeriod = bal;
  const labels: Record<string, string> = { sale: "Sale", purchase: "Purchase", sale_return: "Sale return", purchase_return: "Purchase return", receipt: "Received", payment: "Paid" };
  for (const r of rows) {
    const amt = D(r.amount);
    if (from && r.date < from) {
      bal = bal.add(amt);
      openingForPeriod = bal;
      continue;
    }
    if (to && r.date > to) continue;
    bal = bal.add(amt);
    const isInvoice = !["receipt", "payment"].includes(r.kind);
    entries.push({
      date: r.date,
      kind: labels[r.kind] ?? r.kind,
      ref: r.ref,
      link: isInvoice ? `/invoices/${r.id}` : `/payments/${r.id}`,
      description: r.description,
      debit: amt.gt(0) ? amt.toFixed(2) : "0",
      credit: amt.lt(0) ? amt.neg().toFixed(2) : "0",
      balance: bal.toFixed(2),
    });
  }
  return { opening: openingForPeriod.toFixed(2), entries, closing: bal.toFixed(2) };
}

export type OpenItem = {
  party_id: number;
  party_name: string;
  phone: string;
  invoice_id: number | null;
  number: string;
  kind: string;
  date: string;
  due_date: string | null;
  total: string;
  outstanding: string;
  days_overdue: number;
};

/**
 * Outstanding bills by FIFO (running-account method used in the trade):
 * a party's net balance is assumed to be made of their most recent bills, so older bills are
 * treated as paid first. Handles part-payments, advances, returns and opening balances without
 * manual payment-to-bill matching.
 */
export async function openItems(businessId: number, side: "receivable" | "payable", partyId?: number, asOf = todayIST()): Promise<OpenItem[]> {
  const kinds = side === "receivable" ? RECEIVABLE_KINDS : PAYABLE_KINDS;
  const sign = side === "receivable" ? 1 : -1;
  const rows = await q<Omit<OpenItem, "days_overdue">>(sql`
    WITH bal AS (
      SELECT party_id, balance * ${sign} AS due FROM party_balances WHERE business_id = ${businessId}
    ),
    docs AS (
      SELECT i.party_id, i.id AS invoice_id, i.number, i.kind, i.date, i.due_date, i.total
      FROM invoices i WHERE i.business_id = ${businessId} AND i.status = 'posted'
        AND i.kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
        ${partyId ? sql`AND i.party_id = ${partyId}` : sql``}
      UNION ALL
      SELECT p.id, NULL, 'Opening balance', 'opening', DATE '2000-01-01', DATE '2000-01-01', ABS(p.opening_balance)
      FROM parties p WHERE p.business_id = ${businessId} AND p.opening_balance * ${sign} > 0
        ${partyId ? sql`AND p.id = ${partyId}` : sql``}
    ),
    ranked AS (
      SELECT d.*, SUM(d.total) OVER (PARTITION BY d.party_id ORDER BY d.date DESC, d.invoice_id DESC NULLS LAST) AS cum FROM docs d
    )
    SELECT r.party_id, pa.name AS party_name, pa.phone, r.invoice_id, r.number, r.kind, r.date, r.due_date, r.total,
      LEAST(r.total, b.due - (r.cum - r.total)) AS outstanding
    FROM ranked r JOIN bal b ON b.party_id = r.party_id JOIN parties pa ON pa.id = r.party_id
    WHERE b.due > 0 AND r.cum - r.total < b.due
    ORDER BY r.date, r.invoice_id NULLS FIRST`);
  return rows.map((r) => ({
    ...r,
    outstanding: D(r.outstanding).toFixed(2),
    days_overdue: r.due_date && r.due_date < asOf ? daysBetween(r.due_date, asOf) : 0,
  }));
}

/** Paid / part-paid / unpaid status for one bill, derived from FIFO outstanding. */
export async function invoicePaymentStatus(businessId: number, inv: { id: number; partyId: number; kind: string; total: string; status: string }) {
  if (inv.status !== "posted" || !(inv.kind === "sale" || inv.kind === "purchase")) return null;
  const items = await openItems(businessId, inv.kind === "sale" ? "receivable" : "payable", inv.partyId);
  const item = items.find((i) => i.invoice_id === inv.id);
  const outstanding = item ? D(item.outstanding) : D(0);
  const status = outstanding.isZero() ? "paid" : outstanding.gte(inv.total) ? "unpaid" : "part-paid";
  return { outstanding: outstanding.toFixed(2), paid: D(inv.total).sub(outstanding).toFixed(2), status, daysOverdue: item?.days_overdue ?? 0 };
}

export async function partyBalance(partyId: number): Promise<string> {
  const [r] = await q<{ balance: string }>(sql`SELECT balance FROM party_balances WHERE party_id = ${partyId}`);
  return r?.balance ?? "0";
}

export async function stockSummary(businessId: number) {
  return q<{ id: number; name: string; count: string; brand: string; quality: string; bag_weight_kg: string; rate_basis: string; gst_rate: string; low_stock_bags: string; active: boolean; bags: string; kg: string; value: string; avg_cost_per_kg: string; last_sale_rate: string | null }>(sql`
    SELECT p.id, p.name, p.count, p.brand, p.quality, p.bag_weight_kg, p.rate_basis, p.gst_rate, p.low_stock_bags, p.active,
      COALESCE(s.bags, 0) AS bags, COALESCE(s.kg, 0) AS kg, COALESCE(s.value, 0) AS value,
      CASE WHEN COALESCE(s.kg, 0) > 0 THEN ROUND(s.value / s.kg, 4) ELSE 0 END AS avg_cost_per_kg,
      (SELECT l.rate FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
        WHERE l.product_id = p.id AND i.kind = 'sale' AND i.status = 'posted' ORDER BY i.date DESC, i.id DESC LIMIT 1) AS last_sale_rate
    FROM products p LEFT JOIN product_stock s ON s.product_id = p.id
    WHERE p.business_id = ${businessId}
    ORDER BY p.active DESC, p.count, p.brand`);
}

export async function lotStock(businessId: number, productId?: number) {
  return q<{ product_id: number; name: string; lot_no: string; bags: string; kg: string }>(sql`
    SELECT m.product_id, p.name, m.lot_no, SUM(m.bags) AS bags, SUM(m.kg) AS kg
    FROM stock_movements m JOIN products p ON p.id = m.product_id
    WHERE m.business_id = ${businessId} ${productId ? sql`AND m.product_id = ${productId}` : sql``}
    GROUP BY m.product_id, p.name, m.lot_no HAVING SUM(m.bags) <> 0
    ORDER BY p.name, m.lot_no`);
}

/** Revenue/COGS for a period. Revenue is taxable value (GST is not income). */
export async function tradingFigures(businessId: number, from: string, to: string) {
  const [r] = await q<{ sales: string; sale_returns: string; cogs: string; return_cogs: string; purchases: string; purchase_returns: string; sales_total: string; purchases_total: string }>(sql`
    SELECT
      COALESCE(SUM(taxable) FILTER (WHERE kind = 'sale'), 0) AS sales,
      COALESCE(SUM(total) FILTER (WHERE kind = 'sale'), 0) AS sales_total,
      COALESCE(SUM(taxable) FILTER (WHERE kind = 'sale_return'), 0) AS sale_returns,
      COALESCE(SUM(cogs) FILTER (WHERE kind = 'sale'), 0) AS cogs,
      COALESCE(SUM(cogs) FILTER (WHERE kind = 'sale_return'), 0) AS return_cogs,
      COALESCE(SUM(taxable) FILTER (WHERE kind = 'purchase'), 0) AS purchases,
      COALESCE(SUM(total) FILTER (WHERE kind = 'purchase'), 0) AS purchases_total,
      COALESCE(SUM(taxable) FILTER (WHERE kind = 'purchase_return'), 0) AS purchase_returns
    FROM invoices WHERE business_id = ${businessId} AND status = 'posted' AND date BETWEEN ${from} AND ${to}`);
  const [e] = await q<{ expenses: string }>(sql`
    SELECT COALESCE(SUM(amount), 0) AS expenses FROM expenses WHERE business_id = ${businessId} AND status = 'posted' AND date BETWEEN ${from} AND ${to}`);
  const netSales = D(r.sales).sub(r.sale_returns);
  const netCogs = D(r.cogs).sub(r.return_cogs);
  const gross = netSales.sub(netCogs);
  const net = gross.sub(e.expenses);
  return {
    sales: D(r.sales).toFixed(2),
    salesTotal: D(r.sales_total).toFixed(2),
    saleReturns: D(r.sale_returns).toFixed(2),
    netSales: netSales.toFixed(2),
    cogs: netCogs.toFixed(2),
    grossProfit: gross.toFixed(2),
    grossMarginPct: netSales.isZero() ? "0" : gross.div(netSales).mul(100).toFixed(1),
    purchases: D(r.purchases).sub(r.purchase_returns).toFixed(2),
    purchasesTotal: D(r.purchases_total).toFixed(2),
    expenses: D(e.expenses).toFixed(2),
    netProfit: net.toFixed(2),
  };
}

export async function cashFlow(businessId: number, from: string, to: string) {
  const [r] = await q<{ received: string; paid: string }>(sql`
    SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'in'), 0) AS received,
           COALESCE(SUM(amount) FILTER (WHERE direction = 'out'), 0) AS paid
    FROM payments WHERE business_id = ${businessId} AND status = 'posted' AND cheque_status <> 'bounced' AND date BETWEEN ${from} AND ${to}`);
  return { received: D(r.received).toFixed(2), paid: D(r.paid).toFixed(2) };
}

export async function dashboard(businessId: number, date = todayIST()) {
  const monthStart = `${date.slice(0, 7)}-01`;
  const [today, month, cashToday, accts, recv, pay, stock] = await Promise.all([
    tradingFigures(businessId, date, date),
    tradingFigures(businessId, monthStart, date),
    cashFlow(businessId, date, date),
    accountBalances(businessId),
    openItems(businessId, "receivable", undefined, date),
    openItems(businessId, "payable", undefined, date),
    stockSummary(businessId),
  ]);
  const series = await q<{ day: string; sales: string; purchases: string }>(sql`
    SELECT d::date::text AS day,
      COALESCE((SELECT SUM(taxable) FROM invoices WHERE business_id = ${businessId} AND status = 'posted' AND kind = 'sale' AND date = d::date), 0) AS sales,
      COALESCE((SELECT SUM(taxable) FROM invoices WHERE business_id = ${businessId} AND status = 'posted' AND kind = 'purchase' AND date = d::date), 0) AS purchases
    FROM generate_series(${addDays(date, -29)}::date, ${date}::date, interval '1 day') d ORDER BY d`);
  const recent = await q<{ id: number; summary: string; created_at: string; user_name: string | null; action: string; entity: string; entity_id: string }>(sql`
    SELECT a.id, a.summary, a.created_at::text, u.name AS user_name, a.action, a.entity, a.entity_id
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.business_id = ${businessId} AND a.entity IN ('invoice','payment','expense','stock')
    ORDER BY a.id DESC LIMIT 12`);
  const sumOut = (items: OpenItem[]) => items.reduce((s, i) => s.add(i.outstanding), D(0));
  const byParty = new Map<number, { name: string; amount: ReturnType<typeof D>; overdue: ReturnType<typeof D>; maxDays: number }>();
  for (const i of recv) {
    const e = byParty.get(i.party_id) ?? { name: i.party_name, amount: D(0), overdue: D(0), maxDays: 0 };
    e.amount = e.amount.add(i.outstanding);
    if (i.days_overdue > 0) e.overdue = e.overdue.add(i.outstanding);
    e.maxDays = Math.max(e.maxDays, i.days_overdue);
    byParty.set(i.party_id, e);
  }
  const topDebtors = [...byParty.entries()]
    .map(([id, e]) => ({ id, name: e.name, amount: e.amount.toFixed(2), overdue: e.overdue.toFixed(2), maxDays: e.maxDays }))
    .sort((a, b) => D(b.amount).cmp(a.amount))
    .slice(0, 6);
  return {
    date,
    today,
    month,
    cashToday,
    accounts: accts,
    cashTotal: accts.reduce((s, a) => s.add(a.balance), D(0)).toFixed(2),
    receivables: sumOut(recv).toFixed(2),
    overdueReceivables: sumOut(recv.filter((i) => i.days_overdue > 0)).toFixed(2),
    overdueCount: new Set(recv.filter((i) => i.days_overdue > 0).map((i) => i.party_id)).size,
    payables: sumOut(pay).toFixed(2),
    stockValue: stock.reduce((s, p) => s.add(p.value), D(0)).toFixed(2),
    stockBags: stock.reduce((s, p) => s.add(p.bags), D(0)).toString(),
    lowStock: stock.filter((p) => p.active && D(p.low_stock_bags).gt(0) && D(p.bags).lt(p.low_stock_bags)),
    series,
    recent,
    topDebtors,
  };
}
