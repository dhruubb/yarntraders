import { addDays, financialYear } from "./calc";
import type { PeriodKey } from "@/components/ui";

const iso = /^\d{4}-\d{2}-\d{2}$/;

export function resolvePeriod(sp: { p?: string; from?: string; to?: string }, today: string, fallback: PeriodKey = "month") {
  // Old links with only from/to still work
  const key = (["today", "7d", "month", "fy", "custom"].includes(sp.p ?? "") ? sp.p : sp.from || sp.to ? "custom" : fallback) as PeriodKey;
  switch (key) {
    case "today":
      return { key, from: today, to: today };
    case "7d":
      return { key, from: addDays(today, -6), to: today };
    case "fy":
      return { key, from: `${financialYear(today).slice(0, 4)}-04-01`, to: today };
    case "custom": {
      const to = iso.test(sp.to ?? "") ? sp.to! : today;
      const from = iso.test(sp.from ?? "") ? sp.from! : addDays(to, -30);
      return { key, from: from <= to ? from : to, to };
    }
    default:
      return { key: "month" as PeriodKey, from: `${today.slice(0, 7)}-01`, to: today };
  }
}
