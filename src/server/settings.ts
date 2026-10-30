import { eq } from "drizzle-orm";
import { businesses, type BusinessSettings } from "@/db/schema";
import type { DbOrTx } from "@/db";

export const DEFAULT_SETTINGS: Required<Omit<BusinessSettings, "alerts">> & { alerts: Required<NonNullable<BusinessSettings["alerts"]>> } = {
  telegramChatIds: [],
  majorTxnThreshold: 2500000,
  backdateAlertDays: 3,
  alerts: { majorTxn: true, overdue: true, lowStock: true, unusual: true, dailySummary: true },
  bankDetails: "",
  invoiceTerms: "Goods once sold will not be taken back without prior approval. Interest may be charged on overdue bills.",
};

export type ResolvedSettings = typeof DEFAULT_SETTINGS;

export function resolveSettings(s: BusinessSettings | null | undefined): ResolvedSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(s ?? {}),
    alerts: { ...DEFAULT_SETTINGS.alerts, ...(s?.alerts ?? {}) },
  } as ResolvedSettings;
}

export async function getBusiness(tx: DbOrTx, businessId: number) {
  const [b] = await tx.select().from(businesses).where(eq(businesses.id, businessId));
  if (!b) throw new Error(`Business ${businessId} not found`);
  return { ...b, resolved: resolveSettings(b.settings) };
}
