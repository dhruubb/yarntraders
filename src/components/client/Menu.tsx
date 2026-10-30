"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export type MenuItem =
  | { kind: "link"; href: string; label: string; external?: boolean }
  | { kind: "button"; label: string; onSelect: () => void; danger?: boolean }
  | { kind: "form"; label: string; action: () => void | Promise<void> }
  | { kind: "heading"; label: string; sub?: string };

/** Small dropdown menu: closes on outside click, Escape, or choosing an item. */
export function Menu({ trigger, items, align = "right", triggerClass }: { trigger: React.ReactNode; items: MenuItem[]; align?: "left" | "right"; triggerClass: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const itemCls = "block w-full rounded px-3 py-2 text-left text-sm hover:bg-ink-tint";
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={triggerClass}>
        {trigger}
      </button>
      {open && (
        <div role="menu" className={`absolute z-50 mt-1.5 min-w-52 rounded-lg border border-rule bg-surface p-1 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}>
          {items.map((i, n) =>
            i.kind === "heading" ? (
              <div key={n} className="border-b border-rule px-3 pb-2 pt-1.5 mb-1">
                <div className="text-sm font-semibold">{i.label}</div>
                {i.sub && <div className="text-xs capitalize text-muted">{i.sub}</div>}
              </div>
            ) : i.kind === "link" ? (
              <Link key={n} role="menuitem" href={i.href} target={i.external ? "_blank" : undefined} onClick={() => setOpen(false)} className={itemCls}>
                {i.label}
              </Link>
            ) : i.kind === "form" ? (
              <form key={n} action={i.action}>
                <button role="menuitem" className={itemCls}>{i.label}</button>
              </form>
            ) : (
              <button key={n} role="menuitem" type="button" onClick={() => { setOpen(false); i.onSelect(); }} className={`${itemCls} ${i.danger ? "text-madder hover:bg-madder-tint" : ""}`}>
                {i.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
