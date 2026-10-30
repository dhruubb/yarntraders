"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Home, ArrowUpRight, ArrowDownLeft, Users, Boxes, MoreHorizontal } from "lucide-react";
import { Menu, type MenuItem } from "./Menu";

export const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/sales", label: "Sales", icon: ArrowUpRight },
  { href: "/purchases", label: "Purchases", icon: ArrowDownLeft },
  { href: "/parties", label: "Parties", icon: Users },
  { href: "/stock", label: "Stock", icon: Boxes },
] as const;

/** Which main tab a page belongs to, including pages reached from inside a tab. */
function useActiveTab(): string {
  const path = usePathname();
  const sp = useSearchParams();
  if (path === "/") return "/";
  if (path.startsWith("/sales")) return "/sales";
  if (path.startsWith("/purchases") || path.startsWith("/expenses")) return "/purchases";
  if (path.startsWith("/payments")) return sp.get("direction") === "out" || sp.get("tab") === "purchases" ? "/purchases" : "/sales";
  if (path.startsWith("/invoices")) return sp.get("tab") === "purchases" ? "/purchases" : "/sales";
  if (path.startsWith("/parties")) return "/parties";
  if (path.startsWith("/stock")) return "/stock";
  return "";
}

export function TopTabs() {
  const active = useActiveTab();
  return (
    <ul className="flex gap-1">
      {TABS.map((t) => {
        const on = active === t.href;
        return (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={`relative block px-3 py-3 text-sm transition-colors ${on ? "font-semibold text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-ink" : "text-muted hover:text-text"}`}
            >
              {t.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function BottomTabs() {
  const active = useActiveTab();
  return (
    <ul className="grid grid-cols-5">
      {TABS.map((t) => {
        const on = active === t.href;
        const Icon = t.icon;
        return (
          <li key={t.href}>
            <Link href={t.href} aria-current={on ? "page" : undefined} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${on ? "font-semibold text-ink" : "text-muted"}`}>
              <Icon size={20} strokeWidth={on ? 2.3 : 1.8} aria-hidden />
              {t.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function MoreMenu({ name, role, links, signOut }: { name: string; role: string; links: { href: string; label: string }[]; signOut: () => Promise<void> }) {
  const items: MenuItem[] = [
    { kind: "heading", label: name, sub: role },
    ...links.map((l) => ({ kind: "link" as const, ...l })),
    { kind: "form", label: "Sign out", action: signOut },
  ];
  return (
    <Menu
      triggerClass="inline-flex items-center gap-1.5 rounded-md border border-rule bg-surface px-2.5 py-2 text-sm font-medium hover:bg-ink-tint"
      trigger={<><MoreHorizontal size={16} aria-hidden /><span>More</span></>}
      items={items}
    />
  );
}
