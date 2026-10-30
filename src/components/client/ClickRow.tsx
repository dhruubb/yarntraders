"use client";

import { useRouter } from "next/navigation";

/** A table row that opens `href` when clicked anywhere, except on its own links and buttons. */
export function ClickRow({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <tr
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button,input,select,form")) return;
        if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
        else router.push(href);
      }}
      onMouseEnter={() => router.prefetch(href)}
      className={`cursor-pointer transition-colors hover:bg-ink-tint/40 ${className}`}
    >
      {children}
    </tr>
  );
}
