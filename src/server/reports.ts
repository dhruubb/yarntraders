/** Report definitions. Each returns a plain table so the page, CSV, Excel and PDF all show the same numbers. */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { D } from "@/lib/calc";
import { can, type Role } from "@/lib/permissions";
import { openItems, stockSummary, tradingFigures } from "./queries";

export type ColType = "text" | "money" | "qty" | "date" | "pct";
export type Col = { key: string; label: string; type: ColType };
export type Report = { title: string; subtitle?: string; columns: Col[]; rows: Record<string, string | number | null>[]; totals?: Record<string, string | number | null>; note?: string };

export const REPORTS: { key: string; label: string; description: string; ownerOnly?: boolean; noDates?: boolean }[] = [
  { key: "daybook", label: "Day book", description: "Every sale, purchase, return, payment and expense by date" },
  { key: "sales_register", label: "Sales register (GST)", description: "Bill-wise sales with taxable value, CGST, SGST and IGST" },
  { key: "purchase_register", label: "Purchase register (GST)", description: "Bill-wise purchases with input tax" },
  { key: "party_summary", label: "Party-wise", description: "Sales, purchases, payments and closing balance per party" },
  { key: "product_summary", label: "Yarn-wise", description: "Bags and value bought and sold per yarn, with margin" },
  { key: "ageing", label: "Receivables ageing", description: "Who owes what, grouped by how late", noDates: true },
  { key: "payables_ageing", label: "Payables ageing", description: "What you owe suppliers, by due date", noDates: true },
  { key: "stock", label: "Stock & valuation", description: "Current stock with weighted average cost", noDates: true },
  { key: "pnl", label: "Profit & loss", description: "Net sales, cost of goods, gross and net profit", ownerOnly: true },
  { key: "gst_summary", label: "GST summary", description: "Output tax on sales vs input tax on purchases, by month" },
  { key: "expenses", label: "Expenses", description: "Operating expenses by category" },
];

type Rows = Record<string, string | number | null>[];
async function rows(query: ReturnType<typeof sql>): Promise<Rows> {
  return (await db.execute(query)).rows as Rows;
}

const sumCols = (rs: Rows, keys: string[]) => Object.fromEntries(keys.map((k) => [k, rs.reduce((a, r) => a.add(D((r[k] as string) ?? 0)), D(0)).toFixed(2)]));

export async function runReport(key: string, businessId: number, role: Role, from: string, to: string): Promise<Report | null> {
  const meta = REPORTS.find((r) => r.key === key);
  if (!meta) return null;
  if (meta.ownerOnly && !can(role, "view_cost_profit")) return null;
  const showCost = can(role, "view_cost_profit");
  const period = `${from} to ${to}`;

  switch (key) {
    case "daybook": {
      const rs = await rows(sql`
        SELECT * FROM (
          SELECT i.date, CASE i.kind WHEN 'sale' THEN 'Sale' WHEN 'purchase' THEN 'Purchase' WHEN 'sale_return' THEN 'Sale return' ELSE 'Purchase return' END AS entry,
            i.number AS ref, p.name AS party,
            (SELECT SUM(l.bags) FROM invoice_lines l WHERE l.invoice_id = i.id) AS bags,
            CASE WHEN i.kind IN ('sale','purchase_return') THEN i.total END AS debit,
            CASE WHEN i.kind IN ('purchase','sale_return') THEN i.total END AS credit, i.created_at
          FROM invoices i JOIN parties p ON p.id = i.party_id
          WHERE i.business_id = ${businessId} AND i.status = 'posted' AND i.date BETWEEN ${from} AND ${to}
          UNION ALL
          SELECT y.date, CASE y.direction WHEN 'in' THEN 'Received' ELSE 'Paid' END, initcap(y.mode) || CASE WHEN y.cheque_no <> '' THEN ' #' || y.cheque_no ELSE '' END,
            p.name, NULL, CASE WHEN y.direction = 'out' THEN y.amount END, CASE WHEN y.direction = 'in' THEN y.amount END, y.created_at
          FROM payments y JOIN parties p ON p.id = y.party_id
          WHERE y.business_id = ${businessId} AND y.status = 'posted' AND y.cheque_status <> 'bounced' AND y.date BETWEEN ${from} AND ${to}
          UNION ALL
          SELECT e.date, 'Expense', e.category, e.paid_to, NULL, e.amount, NULL, e.created_at
          FROM expenses e WHERE e.business_id = ${businessId} AND e.status = 'posted' AND e.date BETWEEN ${from} AND ${to}
        ) x ORDER BY date, created_at`);
      for (const r of rs) delete r.created_at;
      return {
        title: "Day book",
        subtitle: period,
        columns: [
          { key: "date", label: "Date", type: "date" }, { key: "entry", label: "Entry", type: "text" }, { key: "ref", label: "Ref", type: "text" },
          { key: "party", label: "Party", type: "text" }, { key: "bags", label: "Bags", type: "qty" },
          { key: "debit", label: "Debit", type: "money" }, { key: "credit", label: "Credit", type: "money" },
        ],
        rows: rs,
        note: "Debit: sales, purchase returns, payments made, expenses. Credit: purchases, sale returns, money received.",
      };
    }
    case "sales_register":
    case "purchase_register": {
      const kinds = key === "sales_register" ? ["sale", "sale_return"] : ["purchase", "purchase_return"];
      const rs = await rows(sql`
        SELECT i.date, i.number, CASE WHEN i.kind LIKE '%return' THEN 'Return' ELSE 'Bill' END AS type, i.supplier_bill_no AS bill_no,
          p.name AS party, p.gstin, p.state_code AS state,
          (SELECT SUM(l.bags) FROM invoice_lines l WHERE l.invoice_id = i.id) AS bags,
          (SELECT SUM(l.kg) FROM invoice_lines l WHERE l.invoice_id = i.id) AS kg,
          CASE WHEN i.kind LIKE '%return' THEN -i.taxable ELSE i.taxable END AS taxable,
          CASE WHEN i.kind LIKE '%return' THEN -i.cgst ELSE i.cgst END AS cgst,
          CASE WHEN i.kind LIKE '%return' THEN -i.sgst ELSE i.sgst END AS sgst,
          CASE WHEN i.kind LIKE '%return' THEN -i.igst ELSE i.igst END AS igst,
          CASE WHEN i.kind LIKE '%return' THEN -i.total ELSE i.total END AS total
        FROM invoices i JOIN parties p ON p.id = i.party_id
        WHERE i.business_id = ${businessId} AND i.status = 'posted' AND i.kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
          AND i.date BETWEEN ${from} AND ${to}
        ORDER BY i.date, i.id`);
      const cols: Col[] = [
        { key: "date", label: "Date", type: "date" }, { key: "number", label: "No.", type: "text" }, { key: "type", label: "Type", type: "text" },
        ...(key === "purchase_register" ? [{ key: "bill_no", label: "Supplier bill", type: "text" as const }] : []),
        { key: "party", label: "Party", type: "text" }, { key: "gstin", label: "GSTIN", type: "text" }, { key: "state", label: "State", type: "text" },
        { key: "bags", label: "Bags", type: "qty" }, { key: "kg", label: "Kg", type: "qty" },
        { key: "taxable", label: "Taxable", type: "money" }, { key: "cgst", label: "CGST", type: "money" }, { key: "sgst", label: "SGST", type: "money" },
        { key: "igst", label: "IGST", type: "money" }, { key: "total", label: "Total", type: "money" },
      ];
      return { title: key === "sales_register" ? "Sales register" : "Purchase register", subtitle: period, columns: cols, rows: rs, totals: { ...sumCols(rs, ["taxable", "cgst", "sgst", "igst", "total"]), bags: sumCols(rs, ["bags"]).bags, kg: sumCols(rs, ["kg"]).kg } };
    }
    case "party_summary": {
      const rs = await rows(sql`
        WITH t AS (
          SELECT party_id,
            SUM(CASE kind WHEN 'sale' THEN total WHEN 'sale_return' THEN -total ELSE 0 END) AS sales,
            SUM(CASE kind WHEN 'purchase' THEN total WHEN 'purchase_return' THEN -total ELSE 0 END) AS purchases
          FROM invoices WHERE business_id = ${businessId} AND status = 'posted' AND date BETWEEN ${from} AND ${to} GROUP BY party_id),
        y AS (
          SELECT party_id, SUM(amount) FILTER (WHERE direction = 'in') AS received, SUM(amount) FILTER (WHERE direction = 'out') AS paid
          FROM payments WHERE business_id = ${businessId} AND status = 'posted' AND cheque_status <> 'bounced' AND date BETWEEN ${from} AND ${to} GROUP BY party_id)
        SELECT p.name AS party, p.city, COALESCE(t.sales, 0) AS sales, COALESCE(y.received, 0) AS received,
          COALESCE(t.purchases, 0) AS purchases, COALESCE(y.paid, 0) AS paid, b.balance
        FROM parties p JOIN party_balances b ON b.party_id = p.id LEFT JOIN t ON t.party_id = p.id LEFT JOIN y ON y.party_id = p.id
        WHERE p.business_id = ${businessId} AND (t.party_id IS NOT NULL OR y.party_id IS NOT NULL OR b.balance <> 0)
        ORDER BY p.name`);
      return {
        title: "Party-wise summary",
        subtitle: period,
        columns: [
          { key: "party", label: "Party", type: "text" }, { key: "city", label: "City", type: "text" },
          { key: "sales", label: "Sales (incl. GST)", type: "money" }, { key: "received", label: "Received", type: "money" },
          { key: "purchases", label: "Purchases (incl. GST)", type: "money" }, { key: "paid", label: "Paid", type: "money" },
          { key: "balance", label: "Balance today (+ they owe)", type: "money" },
        ],
        rows: rs,
        totals: sumCols(rs, ["sales", "received", "purchases", "paid", "balance"]),
      };
    }
    case "product_summary": {
      const rs = await rows(sql`
        SELECT pr.name AS yarn,
          COALESCE(SUM(l.bags) FILTER (WHERE i.kind = 'purchase'), 0) - COALESCE(SUM(l.bags) FILTER (WHERE i.kind = 'purchase_return'), 0) AS bags_bought,
          COALESCE(SUM(l.taxable) FILTER (WHERE i.kind = 'purchase'), 0) - COALESCE(SUM(l.taxable) FILTER (WHERE i.kind = 'purchase_return'), 0) AS purchase_value,
          COALESCE(SUM(l.bags) FILTER (WHERE i.kind = 'sale'), 0) - COALESCE(SUM(l.bags) FILTER (WHERE i.kind = 'sale_return'), 0) AS bags_sold,
          COALESCE(SUM(l.kg) FILTER (WHERE i.kind = 'sale'), 0) - COALESCE(SUM(l.kg) FILTER (WHERE i.kind = 'sale_return'), 0) AS kg_sold,
          COALESCE(SUM(l.taxable) FILTER (WHERE i.kind = 'sale'), 0) - COALESCE(SUM(l.taxable) FILTER (WHERE i.kind = 'sale_return'), 0) AS net_sales,
          COALESCE(SUM(l.cogs) FILTER (WHERE i.kind = 'sale'), 0) - COALESCE(SUM(l.cogs) FILTER (WHERE i.kind = 'sale_return'), 0) AS cogs
        FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN products pr ON pr.id = l.product_id
        WHERE i.business_id = ${businessId} AND i.status = 'posted' AND i.date BETWEEN ${from} AND ${to}
        GROUP BY pr.name ORDER BY net_sales DESC, pr.name`);
      for (const r of rs) {
        const ns = D(r.net_sales as string);
        const gp = ns.sub(r.cogs as string);
        r.gross_profit = gp.toFixed(2);
        r.margin = ns.isZero() ? null : gp.div(ns).mul(100).toFixed(1);
        r.avg_rate_kg = D(r.kg_sold as string).isZero() ? null : ns.div(r.kg_sold as string).toFixed(2);
        if (!showCost) delete r.cogs, delete r.gross_profit, delete r.margin;
      }
      const cols: Col[] = [
        { key: "yarn", label: "Yarn", type: "text" }, { key: "bags_bought", label: "Bags bought", type: "qty" }, { key: "purchase_value", label: "Purchase value", type: "money" },
        { key: "bags_sold", label: "Bags sold", type: "qty" }, { key: "kg_sold", label: "Kg sold", type: "qty" }, { key: "net_sales", label: "Net sales", type: "money" },
        { key: "avg_rate_kg", label: "Avg sale ₹/kg", type: "money" },
        ...(showCost ? ([{ key: "cogs", label: "Cost of goods", type: "money" }, { key: "gross_profit", label: "Gross profit", type: "money" }, { key: "margin", label: "Margin %", type: "pct" }] as Col[]) : []),
      ];
      return { title: "Yarn-wise summary", subtitle: period, columns: cols, rows: rs, totals: sumCols(rs, ["bags_bought", "purchase_value", "bags_sold", "kg_sold", "net_sales", ...(showCost ? ["cogs", "gross_profit"] : [])]), note: "Values before GST." };
    }
    case "ageing":
    case "payables_ageing": {
      const items = await openItems(businessId, key === "ageing" ? "receivable" : "payable", undefined, to);
      const byParty = new Map<number, Record<string, string | number | null>>();
      for (const i of items) {
        const r = byParty.get(i.party_id) ?? { party: i.party_name, phone: i.phone, not_due: "0", d1_30: "0", d31_60: "0", d61_90: "0", d90: "0", total: "0" };
        const bucket = i.days_overdue <= 0 ? "not_due" : i.days_overdue <= 30 ? "d1_30" : i.days_overdue <= 60 ? "d31_60" : i.days_overdue <= 90 ? "d61_90" : "d90";
        r[bucket] = D(r[bucket] as string).add(i.outstanding).toFixed(2);
        r.total = D(r.total as string).add(i.outstanding).toFixed(2);
        byParty.set(i.party_id, r);
      }
      const rs = [...byParty.values()].sort((a, b) => D(b.total as string).cmp(a.total as string));
      return {
        title: key === "ageing" ? "Receivables ageing" : "Payables ageing",
        subtitle: `As of ${to}, by days past due date`,
        columns: [
          { key: "party", label: "Party", type: "text" }, { key: "phone", label: "Phone", type: "text" },
          { key: "not_due", label: "Not due", type: "money" }, { key: "d1_30", label: "1–30 days", type: "money" }, { key: "d31_60", label: "31–60", type: "money" },
          { key: "d61_90", label: "61–90", type: "money" }, { key: "d90", label: "Over 90", type: "money" }, { key: "total", label: "Total", type: "money" },
        ],
        rows: rs,
        totals: sumCols(rs, ["not_due", "d1_30", "d31_60", "d61_90", "d90", "total"]),
        note: "Payments settle the oldest bills first (running account).",
      };
    }
    case "stock": {
      const st = await stockSummary(businessId);
      const rs: Rows = st.filter((r) => r.active || !D(r.bags).isZero()).map((r) => ({
        yarn: r.name, bag_kg: r.bag_weight_kg, bags: r.bags, kg: r.kg, low_stock_bags: r.low_stock_bags,
        ...(showCost ? { avg_cost_kg: r.avg_cost_per_kg, value: r.value } : {}),
      }));
      return {
        title: "Stock & valuation",
        subtitle: "Current stock",
        columns: [
          { key: "yarn", label: "Yarn", type: "text" }, { key: "bag_kg", label: "Bag kg", type: "qty" }, { key: "bags", label: "Bags", type: "qty" }, { key: "kg", label: "Kg", type: "qty" },
          { key: "low_stock_bags", label: "Alert below", type: "qty" },
          ...(showCost ? ([{ key: "avg_cost_kg", label: "Avg cost ₹/kg", type: "money" }, { key: "value", label: "Value", type: "money" }] as Col[]) : []),
        ],
        rows: rs,
        totals: sumCols(rs, ["bags", "kg", ...(showCost ? ["value"] : [])]),
        note: showCost ? "Valued at weighted average cost, excluding GST (input tax is claimed)." : undefined,
      };
    }
    case "pnl": {
      const t = await tradingFigures(businessId, from, to);
      const exp = await rows(sql`SELECT category, SUM(amount) AS amount FROM expenses WHERE business_id = ${businessId} AND status = 'posted' AND date BETWEEN ${from} AND ${to} GROUP BY category ORDER BY amount DESC`);
      const rs: Rows = [
        { item: "Sales (before GST)", amount: t.sales },
        { item: "Less: sale returns", amount: D(t.saleReturns).neg().toFixed(2) },
        { item: "Net sales", amount: t.netSales },
        { item: "Less: cost of goods sold (weighted average)", amount: D(t.cogs).neg().toFixed(2) },
        { item: "Gross profit", amount: t.grossProfit },
        ...exp.map((e) => ({ item: `Less: ${e.category}`, amount: D(e.amount as string).neg().toFixed(2) })),
        { item: "Net profit", amount: t.netProfit },
      ];
      return { title: "Profit & loss", subtitle: period, columns: [{ key: "item", label: "", type: "text" }, { key: "amount", label: "Amount", type: "money" }], rows: rs, note: `Gross margin ${t.grossMarginPct}%. Purchases in the period (before GST): ₹${D(t.purchases).toFixed(0)} — stock bought is an asset until sold.` };
    }
    case "gst_summary": {
      const rs = await rows(sql`
        SELECT to_char(date, 'YYYY-MM') AS month,
          SUM(CASE kind WHEN 'sale' THEN taxable WHEN 'sale_return' THEN -taxable ELSE 0 END) AS sales_taxable,
          SUM(CASE kind WHEN 'sale' THEN cgst + sgst + igst WHEN 'sale_return' THEN -(cgst + sgst + igst) ELSE 0 END) AS output_tax,
          SUM(CASE kind WHEN 'purchase' THEN taxable WHEN 'purchase_return' THEN -taxable ELSE 0 END) AS purchase_taxable,
          SUM(CASE kind WHEN 'purchase' THEN cgst + sgst + igst WHEN 'purchase_return' THEN -(cgst + sgst + igst) ELSE 0 END) AS input_tax
        FROM invoices WHERE business_id = ${businessId} AND status = 'posted' AND date BETWEEN ${from} AND ${to}
        GROUP BY 1 ORDER BY 1`);
      for (const r of rs) r.net = D(r.output_tax as string).sub(r.input_tax as string).toFixed(2);
      return {
        title: "GST summary",
        subtitle: period,
        columns: [
          { key: "month", label: "Month", type: "text" }, { key: "sales_taxable", label: "Sales taxable", type: "money" }, { key: "output_tax", label: "Output GST", type: "money" },
          { key: "purchase_taxable", label: "Purchase taxable", type: "money" }, { key: "input_tax", label: "Input GST", type: "money" }, { key: "net", label: "Net payable (before other ITC)", type: "money" },
        ],
        rows: rs,
        totals: sumCols(rs, ["sales_taxable", "output_tax", "purchase_taxable", "input_tax", "net"]),
        note: "For a quick check only. File returns from your accountant's GST software.",
      };
    }
    case "expenses": {
      const rs = await rows(sql`
        SELECT e.date, e.category, e.paid_to, a.name AS account, e.amount FROM expenses e JOIN accounts a ON a.id = e.account_id
        WHERE e.business_id = ${businessId} AND e.status = 'posted' AND e.date BETWEEN ${from} AND ${to} ORDER BY e.date, e.id`);
      return {
        title: "Expenses",
        subtitle: period,
        columns: [{ key: "date", label: "Date", type: "date" }, { key: "category", label: "Category", type: "text" }, { key: "paid_to", label: "Paid to", type: "text" }, { key: "account", label: "From", type: "text" }, { key: "amount", label: "Amount", type: "money" }],
        rows: rs,
        totals: sumCols(rs, ["amount"]),
      };
    }
  }
  return null;
}
