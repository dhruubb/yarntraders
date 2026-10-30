/** Errors shown to the user as-is. Anything else is logged and shown as a generic failure. */
export class AppError extends Error {
  constructor(message: string, public code: string = "invalid", public details?: unknown) {
    super(message);
    this.name = "AppError";
  }
}

export class PermissionError extends AppError {
  constructor(message = "You don't have permission to do this. Ask the owner.") {
    super(message, "forbidden");
  }
}

/** A likely duplicate: the caller can resubmit with confirmDuplicate=true to post anyway. */
export class DuplicateWarning extends AppError {
  constructor(message: string, public existingId: number) {
    super(message, "possible_duplicate", { existingId });
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T; warnings?: string[] }
  | { ok: false; error: string; code?: string; details?: unknown; fieldErrors?: Record<string, string> };

export function toActionError(e: unknown): Extract<ActionResult, { ok: false }> {
  if (e instanceof AppError) return { ok: false, error: e.message, code: e.code, details: e.details };
  // Postgres errors raised by our immutability triggers are user-meaningful
  // Drizzle wraps driver errors; the Postgres error is in .cause
  const raw = e as { cause?: unknown };
  const pg = ((raw?.cause && typeof raw.cause === "object" ? raw.cause : e) ?? {}) as { code?: string; message?: string; constraint?: string };
  if (pg?.code === "P0001" && pg.message) return { ok: false, error: pg.message, code: "blocked" };
  if (pg?.code === "23505") {
    const map: Record<string, string> = {
      parties_name_uq: "A party with this name already exists.",
      products_name_uq: "A product with this name already exists.",
      users_username_uq: "That username is taken.",
      invoices_idem_uq: "This entry was already saved. Refresh the list to see it.",
      payments_idem_uq: "This payment was already saved.",
      invoices_supplier_bill_uq: "This supplier bill number is already entered for this party.",
    };
    return { ok: false, error: map[pg.constraint ?? ""] ?? "This record already exists.", code: "duplicate" };
  }
  if (pg?.code === "23514" && pg.constraint === "stock_nonneg") {
    return { ok: false, error: "Not enough stock for this entry.", code: "stock" };
  }
  console.error(e);
  return { ok: false, error: "Something went wrong while saving. Nothing was posted. Try again.", code: "server" };
}
