"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { chequeStatusAction } from "@/app/actions";
import { btn } from "@/components/ui";

export function ChequeButtons({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async (s: "cleared" | "bounced") => {
    if (s === "bounced" && !confirm("Mark this cheque as bounced? The amount goes back into the party's balance.")) return;
    setBusy(true);
    const r = await chequeStatusAction(id, s);
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error);
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button disabled={busy} onClick={() => go("cleared")} className={`${btn.secondary} px-2 py-1 text-xs`}>Cleared</button>
      <button disabled={busy} onClick={() => go("bounced")} className={`${btn.danger} px-2 py-1 text-xs`}>Bounced</button>
      {error && <span className="text-xs text-madder">{error}</span>}
    </span>
  );
}
