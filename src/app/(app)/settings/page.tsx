import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requirePage } from "@/server/auth";
import { getBusiness } from "@/server/settings";
import { GST_STATES } from "@/server/masters";
import { accountBalances } from "@/server/queries";
import { AccountsEditor, BusinessSettings, UsersEditor } from "@/components/client/Settings";
import { PageHeader, Panel } from "@/components/ui";
import { accounts as accountsTable } from "@/db/schema";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const s = await requirePage("manage_settings");
  const b = await getBusiness(db, s.ctx.businessId);
  const [bals, accts, us] = await Promise.all([
    accountBalances(s.ctx.businessId),
    db.select().from(accountsTable).where(eq(accountsTable.businessId, s.ctx.businessId)),
    db.select().from(users).where(eq(users.businessId, s.ctx.businessId)).orderBy(asc(users.id)),
  ]);
  const balMap = new Map(bals.map((a) => [a.id, a.balance]));
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <BusinessSettings
          states={GST_STATES}
          telegramConfigured={Boolean(process.env.TELEGRAM_BOT_TOKEN)}
          initial={{
            name: b.name, gstin: b.gstin, stateCode: b.stateCode, address: b.address, phone: b.phone,
            bankDetails: b.resolved.bankDetails, invoiceTerms: b.resolved.invoiceTerms,
            majorTxnThreshold: String(b.resolved.majorTxnThreshold), backdateAlertDays: String(b.resolved.backdateAlertDays),
            telegramChatIds: b.resolved.telegramChatIds.join(", "), alerts: b.resolved.alerts,
          }}
        />
        <div className="space-y-4">
          <Panel title="Cash & bank accounts">
            <AccountsEditor accounts={accts.map((a) => ({ id: a.id, name: a.name, type: a.type, openingBalance: a.openingBalance, active: a.active, balance: balMap.get(a.id) ?? "0" }))} />
          </Panel>
          <Panel title="Users">
            <UsersEditor meId={s.user.id} users={us.map((u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, active: u.active, lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null }))} />
          </Panel>
          <Panel title="Backups">
            <p className="text-sm text-muted">Backups run outside the app (database snapshots). See <b>Backups</b> in the README: a daily <code>npm run db:backup</code> keeps 30 days of compressed copies, and Supabase/Neon also keep automatic daily backups.</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
