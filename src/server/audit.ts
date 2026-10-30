import { auditLog } from "@/db/schema";
import type { DbOrTx } from "@/db";

export async function audit(
  tx: DbOrTx,
  e: { businessId: number; userId: number | null; action: string; entity: string; entityId?: string | number; summary: string; data?: unknown },
) {
  await tx.insert(auditLog).values({
    businessId: e.businessId,
    userId: e.userId,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId === undefined ? "" : String(e.entityId),
    summary: e.summary,
    data: e.data === undefined ? null : (JSON.parse(JSON.stringify(e.data)) as object),
  });
}
