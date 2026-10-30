import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { D, formatIndian, formatQty } from "@/lib/calc";
import type { Col, Report } from "./reports";

const fmtCell = (c: Col, v: unknown, rupee = "₹"): string => {
  if (v === null || v === undefined || v === "") return "";
  switch (c.type) {
    case "money":
      return `${rupee}${formatIndian(String(v), 2)}`;
    case "qty":
      return formatQty(String(v));
    case "pct":
      return `${v}%`;
    case "date": {
      const s = String(v).slice(0, 10);
      const [y, m, d] = s.split("-");
      return `${d}-${m}-${y}`;
    }
    default:
      return String(v);
  }
};

export function reportToCsv(r: Report): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  // Plain numbers in CSV so Excel can sum them
  const val = (c: Col, v: unknown) => (v === null || v === undefined ? "" : c.type === "money" || c.type === "qty" ? String(D(String(v))) : fmtCell(c, v));
  const lines = [r.columns.map((c) => esc(c.label || c.key)).join(",")];
  for (const row of r.rows) lines.push(r.columns.map((c) => esc(val(c, row[c.key]))).join(","));
  if (r.totals) lines.push(r.columns.map((c, i) => (i === 0 ? "Total" : esc(val(c, r.totals![c.key])))).join(","));
  return "﻿" + lines.join("\r\n");
}

export async function reportToXlsx(r: Report, businessName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Yarn Register";
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  ws.addRow([businessName]).font = { bold: true, size: 13 };
  ws.addRow([`${r.title}${r.subtitle ? ` — ${r.subtitle}` : ""}`]).font = { size: 11 };
  ws.addRow([]);
  const head = ws.addRow(r.columns.map((c) => c.label || c.key));
  head.font = { bold: true };
  head.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EBF6" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FF1E2650" } } };
  });
  const toCell = (c: Col, v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    if (c.type === "money" || c.type === "qty" || c.type === "pct") return Number(v);
    if (c.type === "date") return new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
    return String(v);
  };
  for (const row of r.rows) ws.addRow(r.columns.map((c) => toCell(c, row[c.key])));
  if (r.totals) {
    const t = ws.addRow(r.columns.map((c, i) => (i === 0 ? "Total" : toCell(c, r.totals![c.key]))));
    t.font = { bold: true };
  }
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.type === "text" ? 26 : c.type === "date" ? 12 : 15;
    if (c.type === "money") col.numFmt = "#,##,##0.00";
    if (c.type === "qty") col.numFmt = "#,##0.###";
    if (c.type === "date") col.numFmt = "dd-mm-yyyy";
  });
  if (r.note) {
    ws.addRow([]);
    ws.addRow([r.note]).font = { italic: true, color: { argb: "FF5F6880" } };
  }
  ws.views = [{ state: "frozen", ySplit: 4 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function pdfBuffer(build: (doc: PDFKit.PDFDocument) => void, opts: PDFKit.PDFDocumentOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, ...opts });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    build(doc);
    doc.end();
  });
}

/** Generic table PDF. Standard PDF fonts have no ₹ glyph, so amounts use "Rs.". */
export function reportToPdf(r: Report, businessName: string): Promise<Buffer> {
  const landscape = r.columns.length > 6;
  return pdfBuffer(
    (doc) => {
      const W = doc.page.width - 72;
      const header = () => {
        doc.font("Helvetica-Bold").fontSize(13).fillColor("#1e2650").text(businessName, 36, 36);
        doc.font("Helvetica").fontSize(10).fillColor("#333").text(`${r.title}${r.subtitle ? `  ·  ${r.subtitle}` : ""}`);
        doc.moveDown(0.6);
      };
      header();
      const weights = r.columns.map((c) => (c.type === "text" ? 2 : 1.2));
      const total = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map((w) => (w / total) * W);
      const rowH = 15;
      const drawRow = (cells: string[], bold = false, fill?: string) => {
        if (doc.y + rowH > doc.page.height - 40) {
          doc.addPage();
          header();
          drawRow(r.columns.map((c) => c.label), true, "#e8ebf6");
        }
        const y = doc.y;
        if (fill) doc.rect(36, y - 2, W, rowH).fill(fill);
        let x = 36;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8).fillColor("#111");
        cells.forEach((t, i) => {
          const right = ["money", "qty", "pct"].includes(r.columns[i].type);
          doc.text(t, x + 2, y + 1, { width: widths[i] - 4, align: right ? "right" : "left", lineBreak: false, ellipsis: true });
          x += widths[i];
        });
        doc.y = y + rowH;
        doc.moveTo(36, doc.y - 2).lineTo(36 + W, doc.y - 2).lineWidth(0.3).strokeColor("#dfe2ea").stroke();
      };
      drawRow(r.columns.map((c) => c.label), true, "#e8ebf6");
      for (const row of r.rows) drawRow(r.columns.map((c) => fmtCell(c, row[c.key], "Rs.")));
      if (r.totals) drawRow(r.columns.map((c, i) => (i === 0 ? "Total" : fmtCell(c, r.totals![c.key], "Rs."))), true, "#f4f5f8");
      if (r.note) {
        doc.moveDown(0.5);
        doc.font("Helvetica-Oblique").fontSize(8).fillColor("#5f6880").text(r.note, 36, doc.y, { width: W });
      }
      doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(7).fillColor("#999").text(`Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, 36, doc.page.height - 30, { lineBreak: false });
    },
    { size: "A4", layout: landscape ? "landscape" : "portrait" },
  );
}

export { pdfBuffer, fmtCell };
