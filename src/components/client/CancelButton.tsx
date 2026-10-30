"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/server/errors";
import { btn, input } from "@/components/ui";

/** Opens a small dialog asking for a reason. Nothing is deleted; the record is marked cancelled. */
export function CancelButton({ what, action, compact }: { what: string; action: (reason: string) => Promise<ActionResult<unknown>>; compact?: boolean }) {
  const router = useRouter();
  const dlg = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={compact ? "rounded px-2 py-1 text-xs font-medium text-muted hover:bg-madder-tint hover:text-madder" : btn.danger}
        onClick={() => { setError(null); dlg.current?.showModal(); }}
      >
        Cancel {compact ? "" : what}
      </button>
      <dialog ref={dlg} className="m-auto w-[min(92vw,26rem)] rounded-xl border border-rule p-0 shadow-2xl backdrop:bg-ink/40">
        <form
          method="dialog"
          className="space-y-3 p-5 text-left"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await action(reason);
            setBusy(false);
            if (r.ok) {
              dlg.current?.close();
              setReason("");
              router.refresh();
            } else setError(r.error);
          }}
        >
          <h2 className="text-base font-semibold">Cancel this {what}?</h2>
          <p className="text-sm text-muted">Stock and balances are reversed. The entry stays in history, marked cancelled, and the owner is alerted.</p>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-muted" htmlFor={`cancel-reason-${what}`}>Reason</label>
            <input id={`cancel-reason-${what}`} autoFocus required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} className={input} placeholder="e.g. wrong party, entered twice" />
          </div>
          {error && <p role="alert" className="rounded-md bg-madder-tint px-3 py-2 text-sm text-madder">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={btn.secondary} onClick={() => dlg.current?.close()}>Keep it</button>
            <button disabled={busy} className={`${btn.primary} bg-madder hover:bg-madder/90`}>{busy ? "Cancelling…" : `Cancel ${what}`}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
