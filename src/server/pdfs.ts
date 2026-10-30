import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceLines, invoices, parties, products } from "@/db/schema";
import { D, RATE_BASIS_LABEL, amountInWords, formatIndian, formatQty } from "@/lib/calc";
import { GST_STATES } from "./masters";
import { getBusiness } from "./settings";
import { partyLedger } from "./queries";
import { pdfBuffer } from "./export";

const rs = (v: string | number | ReturnType<typeof D>, dec = 2) => `Rs. ${formatIndian(String(v), dec)}`;
const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join("-") : "");

const TITLES = { sale: "TAX INVOICE", purchase: "PURCHASE VOUCHER", sale_return: "CREDIT NOTE (SALE RETURN)", purchase_return: "DEBIT NOTE (PURCHASE RETURN)" } as const;

export async function invoicePdf(businessId: number, invoiceId: number): Promise<{ buffer: Buffer; filename: string } | null> {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId)));
  if (!inv) return null;
  const b = await getBusiness(db, businessId);
  const [party] = await db.select().from(parties).where(eq(parties.id, inv.partyId));
  const lines = await db.select({ l: invoiceLines, name: products.name, hsn: products.hsn }).from(invoiceLines).innerJoin(products, eq(products.id, invoiceLines.productId)).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.lineNo));
  const ref = inv.refInvoiceId ? (await db.select({ number: invoices.number, date: invoices.date }).from(invoices).where(eq(invoices.id, inv.refInvoiceId)))[0] : null;

  const buffer = await pdfBuffer(
    (doc) => {
      const L = 36;
      const W = doc.page.width - 72;
      if (inv.status === "cancelled") {
        doc.save().rotate(-30, { origin: [300, 400] }).font("Helvetica-Bold").fontSize(80).fillColor("#a3302a").opacity(0.15).text("CANCELLED", 60, 360).restore();
        doc.opacity(1);
      }
      // Business header
      doc.font("Helvetica-Bold").fontSize(16).fillColor("#1e2650").text(b.name, L, 36);
      doc.font("Helvetica").fontSize(9).fillColor("#333");
      if (b.address) doc.text(b.address, { width: W * 0.6 });
      doc.text([b.gstin && `GSTIN: ${b.gstin}`, `State: ${GST_STATES[b.stateCode] ?? ""} (${b.stateCode})`, b.phone && `Ph: ${b.phone}`].filter(Boolean).join("   "));
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#111").text(TITLES[inv.kind], L, 36, { width: W, align: "right" });
      doc.font("Helvetica").fontSize(9).text(`No. ${inv.number}`, { width: W, align: "right" }).text(`Date ${dmy(inv.date)}`, { width: W, align: "right" });
      if (inv.dueDate) doc.text(`Due ${dmy(inv.dueDate)}`, { width: W, align: "right" });
      if (inv.supplierBillNo) doc.text(`Supplier bill ${inv.supplierBillNo}`, { width: W, align: "right" });
      if (ref) doc.text(`Against ${ref.number} dt ${dmy(ref.date)}`, { width: W, align: "right" });
      doc.moveDown(1);
      const y0 = Math.max(doc.y, 110);
      doc.moveTo(L, y0).lineTo(L + W, y0).strokeColor("#1e2650").lineWidth(1).stroke();

      // Party block
      const partyLabel = inv.kind === "sale" || inv.kind === "sale_return" ? "Bill to" : "Supplier";
      doc.font("Helvetica").fontSize(8).fillColor("#5f6880").text(partyLabel, L, y0 + 8);
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#111").text(party.name);
      doc.font("Helvetica").fontSize(9);
      if (party.address) doc.text(party.address, { width: W * 0.55 });
      doc.text([party.city, `${GST_STATES[party.stateCode] ?? ""} (${party.stateCode})`].filter(Boolean).join(", "));
      if (party.gstin) doc.text(`GSTIN: ${party.gstin}`);
      if (party.phone) doc.text(`Ph: ${party.phone}`);
      doc.fontSize(9).text(`Place of supply: ${GST_STATES[party.stateCode] ?? party.stateCode}`, L, y0 + 8, { width: W, align: "right" });
      doc.text(inv.isInterstate ? "Interstate — IGST" : "Intrastate — CGST + SGST", { width: W, align: "right" });
      doc.y = Math.max(doc.y, y0 + 80);
      doc.moveDown(0.5);

      // Lines table
      const cols = [
        { t: "#", w: 18, a: "left" }, { t: "Description", w: 120, a: "left" }, { t: "HSN", w: 38, a: "left" }, { t: "Bags", w: 36, a: "right" },
        { t: "Weight kg", w: 54, a: "right" }, { t: "Rate", w: 70, a: "right" }, { t: "Taxable", w: 70, a: "right" }, { t: "GST", w: 30, a: "right" }, { t: "Tax", w: 0, a: "right" },
      ] as { t: string; w: number; a: "left" | "right" }[];
      cols[cols.length - 1].w = W - cols.slice(0, -1).reduce((a, c) => a + c.w, 0);
      const row = (cells: string[], bold = false, fill?: string) => {
        const y = doc.y;
        const h = 16;
        if (fill) doc.rect(L, y - 3, W, h).fill(fill);
        let x = L;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor("#111");
        cells.forEach((c, i) => {
          doc.text(c, x + 2, y, { width: cols[i].w - 4, align: cols[i].a, lineBreak: false, ellipsis: true });
          x += cols[i].w;
        });
        doc.y = y + h;
      };
      row(cols.map((c) => c.t), true, "#e8ebf6");
      for (const { l, name, hsn } of lines) {
        const tax = D(l.cgst).add(l.sgst).add(l.igst);
        row([String(l.lineNo), `${name}${l.lotNo ? ` (Lot ${l.lotNo})` : ""}`, hsn, formatQty(l.bags), formatQty(l.kg), `${formatIndian(l.rate)} ${RATE_BASIS_LABEL[l.rateBasis].replace("per ", "/")}`, formatIndian(l.taxable), `${D(l.gstRate)}%`, formatIndian(tax)]);
        doc.moveTo(L, doc.y - 3).lineTo(L + W, doc.y - 3).lineWidth(0.3).strokeColor("#dfe2ea").stroke();
      }
      const totBags = lines.reduce((a, x) => a.add(x.l.bags), D(0));
      const totKg = lines.reduce((a, x) => a.add(x.l.kg), D(0));
      row(["", "Total", "", formatQty(totBags), formatQty(totKg), "", formatIndian(inv.taxable), "", formatIndian(D(inv.cgst).add(inv.sgst).add(inv.igst))], true);
      doc.moveDown(0.8);

      // Totals
      const ty = doc.y;
      const tl = (k: string, v: string, bold = false) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9).fillColor("#111");
        const y = doc.y;
        doc.text(k, L + W - 220, y, { width: 110 });
        doc.text(v, L + W - 110, y, { width: 110, align: "right" });
        doc.y = y + (bold ? 16 : 13);
      };
      tl("Value of goods", rs(inv.linesAmount));
      if (!D(inv.freight).isZero()) tl("Freight / other charges", rs(inv.freight));
      if (!D(inv.discount).isZero()) tl("Discount", `- ${rs(inv.discount)}`);
      tl("Taxable value", rs(inv.taxable));
      if (inv.isInterstate) tl("IGST", rs(inv.igst));
      else {
        tl("CGST", rs(inv.cgst));
        tl("SGST", rs(inv.sgst));
      }
      if (!D(inv.roundOff).isZero()) tl("Round off", rs(inv.roundOff));
      doc.moveTo(L + W - 220, doc.y).lineTo(L + W, doc.y).strokeColor("#1e2650").lineWidth(0.8).stroke();
      doc.y += 4;
      tl("Total", rs(inv.total, 0), true);
      const after = doc.y;

      doc.font("Helvetica").fontSize(8).fillColor("#5f6880").text("Amount in words", L, ty, { width: W - 240 });
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#111").text(amountInWords(inv.total), { width: W - 240 });
      if (inv.notes) doc.font("Helvetica").fontSize(8.5).fillColor("#333").moveDown(0.5).text(`Notes: ${inv.notes}`, { width: W - 240 });
      if (inv.agent) doc.font("Helvetica").fontSize(8.5).text(`Agent: ${inv.agent}`, { width: W - 240 });
      if (inv.kind === "sale" && b.resolved.bankDetails) doc.moveDown(0.5).font("Helvetica-Bold").fontSize(8.5).text("Bank details").font("Helvetica").text(b.resolved.bankDetails, { width: W - 240 });
      doc.y = Math.max(doc.y, after) + 20;

      if (inv.kind === "sale" && b.resolved.invoiceTerms) doc.font("Helvetica").fontSize(7.5).fillColor("#5f6880").text(`Terms: ${b.resolved.invoiceTerms}`, L, doc.y, { width: W * 0.6 });
      const sy = doc.y + 30;
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#111").text(`For ${b.name}`, L, sy, { width: W, align: "right" });
      doc.font("Helvetica").fontSize(8).text("Authorised signatory", L, sy + 36, { width: W, align: "right" });
    },
    { size: "A4" },
  );
  return { buffer, filename: `${inv.number.replace(/\//g, "-")}.pdf` };
}

export async function statementPdf(businessId: number, partyId: number, from: string, to: string) {
  const [party] = await db.select().from(parties).where(and(eq(parties.id, partyId), eq(parties.businessId, businessId)));
  if (!party) return null;
  const b = await getBusiness(db, businessId);
  const ledger = (await partyLedger(businessId, partyId, from, to))!;
  const bal = (v: string) => (D(v).isZero() ? "Nil" : `${formatIndian(D(v).abs())} ${D(v).gt(0) ? "Dr" : "Cr"}`);
  const buffer = await pdfBuffer(
    (doc) => {
      const L = 36;
      const W = doc.page.width - 72;
      doc.font("Helvetica-Bold").fontSize(15).fillColor("#1e2650").text(b.name, L, 36);
      doc.font("Helvetica").fontSize(9).fillColor("#333").text([b.address, b.gstin && `GSTIN ${b.gstin}`].filter(Boolean).join("  ·  "));
      doc.moveDown(0.8);
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#111").text(`Account statement — ${party.name}`);
      doc.font("Helvetica").fontSize(9).text(`${dmy(from)} to ${dmy(to)}${party.city ? `  ·  ${party.city}` : ""}${party.gstin ? `  ·  GSTIN ${party.gstin}` : ""}`);
      doc.moveDown(0.6);
      const cols = [{ t: "Date", w: 60 }, { t: "Particulars", w: 0 }, { t: "Debit", w: 85 }, { t: "Credit", w: 85 }, { t: "Balance", w: 95 }];
      cols[1].w = W - 60 - 85 - 85 - 95;
      const row = (cells: string[], bold = false, fill?: string) => {
        if (doc.y > doc.page.height - 60) doc.addPage();
        const y = doc.y;
        if (fill) doc.rect(L, y - 3, W, 15).fill(fill);
        let x = L;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor("#111");
        cells.forEach((c, i) => {
          doc.text(c, x + 2, y, { width: cols[i].w - 4, align: i >= 2 ? "right" : "left", lineBreak: false, ellipsis: true });
          x += cols[i].w;
        });
        doc.y = y + 15;
      };
      row(cols.map((c) => c.t), true, "#e8ebf6");
      row([dmy(from), "Opening balance", "", "", bal(ledger.opening)], true);
      for (const e of ledger.entries)
        row([dmy(e.date), `${e.kind} ${e.ref.startsWith("#") ? "" : e.ref} ${e.description}`.trim(), D(e.debit).isZero() ? "" : formatIndian(e.debit), D(e.credit).isZero() ? "" : formatIndian(e.credit), bal(e.balance)]);
      const dr = ledger.entries.reduce((a, e) => a.add(e.debit), D(0));
      const cr = ledger.entries.reduce((a, e) => a.add(e.credit), D(0));
      row(["", "Total / closing balance", formatIndian(dr), formatIndian(cr), bal(ledger.closing)], true, "#f4f5f8");
      doc.moveDown(1);
      doc.font("Helvetica").fontSize(8).fillColor("#5f6880").text("Dr = amount receivable from you. Cr = amount payable to you. Please report any difference within 7 days.", L, doc.y, { width: W });
    },
    { size: "A4" },
  );
  return { buffer, filename: `Statement-${party.name.replace(/[^\w]+/g, "-")}-${to}.pdf` };
}
