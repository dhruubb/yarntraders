"use server";

import { revalidatePath } from "next/cache";
import { after as afterResponse } from "next/server";
import { redirect } from "next/navigation";
import { login, logout, sessionOrNull } from "@/server/auth";
import { toActionError, type ActionResult, AppError } from "@/server/errors";
import {
  adjustStock,
  cancelExpense,
  cancelInvoice,
  cancelPayment,
  postInvoice,
  recordExpense,
  recordPayment,
  setChequeStatus,
  requirePerm,
  type Ctx,
  type InvoiceInput,
  type PaymentInput,
} from "@/server/posting";
import { saveAccountRecord, saveBusinessSettings, savePartyRecord, saveProductRecord, saveUserRecord } from "@/server/masters";
import { dispatchPending, enqueue } from "@/server/notify/outbox";
import { telegramRecentChats } from "@/server/notify/channels";
import { db } from "@/db";
import { createBatch, parseSpreadsheet, postBatch, updateRow, type ImportKind } from "@/server/importer";
import { readRegisterPhoto } from "@/server/ocr";

async function run<T>(fn: (ctx: Ctx) => Promise<T>, after?: () => void): Promise<ActionResult<T>> {
  const s = await sessionOrNull();
  if (!s) return { ok: false, error: "Your session has ended. Sign in again.", code: "unauthenticated" };
  try {
    const data = await fn(s.ctx);
    after?.();
    // Send Telegram alerts after the response; Vercel keeps the function alive until this finishes.
    afterResponse(() => dispatchPending().then(() => undefined).catch((e) => console.error("alert dispatch failed", e)));
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

const refreshAll = () => revalidatePath("/", "layout");

export async function loginAction(_prev: { error?: string } | undefined, form: FormData) {
  const r = await login(String(form.get("username") ?? ""), String(form.get("password") ?? ""));
  if (!r.ok) return { error: r.error };
  redirect("/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

export async function postInvoiceAction(input: InvoiceInput) {
  return run(async (ctx) => {
    const r = await postInvoice(ctx, input);
    return { ...r, warnings: r.warnings };
  }, refreshAll);
}

export async function cancelInvoiceAction(id: number, reason: string) {
  return run((ctx) => cancelInvoice(ctx, id, reason), refreshAll);
}

export async function recordPaymentAction(input: PaymentInput) {
  return run((ctx) => recordPayment(ctx, input), refreshAll);
}

export async function cancelPaymentAction(id: number, reason: string) {
  return run((ctx) => cancelPayment(ctx, id, reason), refreshAll);
}

export async function chequeStatusAction(id: number, status: "cleared" | "bounced") {
  return run((ctx) => setChequeStatus(ctx, id, status), refreshAll);
}

export async function recordExpenseAction(input: Parameters<typeof recordExpense>[1]) {
  return run((ctx) => recordExpense(ctx, input), refreshAll);
}

export async function cancelExpenseAction(id: number, reason: string) {
  return run((ctx) => cancelExpense(ctx, id, reason), refreshAll);
}

export async function adjustStockAction(input: Parameters<typeof adjustStock>[1]) {
  return run((ctx) => adjustStock(ctx, input), refreshAll);
}

export async function savePartyAction(input: Parameters<typeof savePartyRecord>[1], id?: number) {
  return run((ctx) => savePartyRecord(ctx, input, id), refreshAll);
}

export async function saveProductAction(input: Parameters<typeof saveProductRecord>[1], id?: number) {
  return run((ctx) => saveProductRecord(ctx, input, id), refreshAll);
}

export async function saveAccountAction(input: Parameters<typeof saveAccountRecord>[1], id?: number) {
  return run((ctx) => saveAccountRecord(ctx, input, id), refreshAll);
}

export async function saveUserAction(input: Parameters<typeof saveUserRecord>[1], id?: number) {
  return run((ctx) => saveUserRecord(ctx, input, id), refreshAll);
}

export async function saveSettingsAction(input: Parameters<typeof saveBusinessSettings>[1]) {
  return run((ctx) => saveBusinessSettings(ctx, input), refreshAll);
}

export async function telegramTestAction() {
  return run(async (ctx) => {
    requirePerm(ctx, "manage_settings");
    if (!process.env.TELEGRAM_BOT_TOKEN) throw new AppError("TELEGRAM_BOT_TOKEN is not set on the server. Add it to the environment and restart.");
    await enqueue(db, ctx.businessId, "test", `Test alert sent by ${ctx.name}. Alerts are working.`);
    const r = await dispatchPending();
    if (r.failed) throw new AppError("Telegram rejected the message. Check the chat ID and that you've sent /start to the bot.");
    if (r.skipped && !r.sent) throw new AppError("No chat ID is saved yet. Add one and save settings first.");
    return r;
  });
}

export async function telegramChatsAction() {
  return run(async (ctx) => {
    requirePerm(ctx, "manage_settings");
    return telegramRecentChats();
  });
}

// ───────── Imports ─────────

export async function uploadImportAction(_prev: unknown, form: FormData): Promise<ActionResult<number> | undefined> {
  const r = await run(async (ctx) => {
    requirePerm(ctx, "import_data");
    const kind = String(form.get("kind")) as ImportKind;
    if (!["sale", "purchase", "parties", "products", "opening_stock"].includes(kind)) throw new AppError("Pick what you are importing");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("Choose a file to upload");
    if (file.size > 10 * 1024 * 1024) throw new AppError("File is larger than 10 MB");
    const buf = Buffer.from(await file.arrayBuffer());
    if (form.get("mode") === "ocr") {
      if (kind !== "sale" && kind !== "purchase") throw new AppError("Photo reading works for sale and purchase registers");
      const lines = await readRegisterPhoto(buf, file.type, kind);
      if (lines.length === 0) throw new AppError("No entries were found in the photo");
      return createBatch(ctx, kind, "ocr", file.name, lines.map((l) => ({ ...l, date: String(form.get("date") || "") })));
    }
    const rows = await parseSpreadsheet(file.name, buf, kind);
    return createBatch(ctx, kind, /\.xlsx$/i.test(file.name) ? "xlsx" : "csv", file.name, rows);
  });
  if (r.ok) redirect(`/import/${r.data}`);
  return r;
}

export async function updateImportRowAction(rowId: number, data: Record<string, unknown>, status?: "pending" | "rejected") {
  return run((ctx) => updateRow(ctx, rowId, data, status));
}

export async function postImportAction(batchId: number) {
  return run((ctx) => postBatch(ctx, batchId), refreshAll);
}
