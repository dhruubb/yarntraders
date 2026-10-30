import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, parties, payments, users } from "@/db/schema";
import { requirePage } from "@/server/auth";
import { can } from "@/lib/permissions";
import { cancelPaymentAction } from "@/app/actions";
import { CancelButton } from "@/components/client/CancelButton";
import { ChequeButtons } from "@/components/client/ChequeButtons";
import { Badge, Money, Panel, fmtDate, fmtDateTime } from "@/components/ui";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage();
  const { id } = await params;
  const [p] = await db.select().from(payments).where(and(eq(payments.id, Number(id)), eq(payments.businessId, s.ctx.businessId)));
  if (!p) notFound();
  const [party] = await db.select().from(parties).where(eq(parties.id, p.partyId));
  const [acct] = await db.select().from(accounts).where(eq(accounts.id, p.accountId));
  const [by] = await db.select({ name: users.name }).from(users).where(eq(users.id, p.createdBy));
  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={p.direction === "in" ? "/sales?view=payments" : "/purchases?view=payments"} className="text-sm text-muted hover:text-text">← {p.direction === "in" ? "Money received" : "Payments made"}</Link>
          <h1 className="mt-1 text-[22px] font-semibold">
            {p.direction === "in" ? "Received from" : "Paid to"} <Link className="text-ink hover:underline" href={`/parties/${party.id}`}>{party.name}</Link>
          </h1>
          <p className="text-sm text-muted">{fmtDate(p.date)} · entered by {by?.name} on {fmtDateTime(p.createdAt)}</p>
        </div>
        {p.status === "posted" && can(s.ctx.role, "cancel_posted") && <CancelButton what="payment" action={cancelPaymentAction.bind(null, p.id)} />}
      </div>
      {p.status === "cancelled" && <div className="rounded-md bg-madder-tint px-4 py-3 text-sm text-madder"><b>Cancelled.</b> {p.cancelReason}</div>}
      <Panel>
        <dl className="grid grid-cols-2 gap-y-3 text-sm">
          <dt className="text-muted">Amount</dt><dd className="text-xl font-semibold"><Money v={p.amount} decimals={2} /></dd>
          <dt className="text-muted">Mode</dt><dd className="capitalize">{p.mode}{p.chequeNo && ` #${p.chequeNo}`}</dd>
          <dt className="text-muted">Account</dt><dd>{acct.name}</dd>
          {p.mode === "cheque" && (<><dt className="text-muted">Cheque</dt><dd>{p.chequeStatus === "pending" && p.status === "posted" ? <ChequeButtons id={p.id} /> : <Badge tone={p.chequeStatus === "bounced" ? "due" : "ok"}>{p.chequeStatus}</Badge>}</dd></>)}
          {p.reference && (<><dt className="text-muted">Reference</dt><dd>{p.reference}</dd></>)}
          {p.notes && (<><dt className="text-muted">Notes</dt><dd>{p.notes}</dd></>)}
        </dl>
      </Panel>
    </div>
  );
}
