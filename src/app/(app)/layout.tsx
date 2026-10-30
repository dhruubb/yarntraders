import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePage } from "@/server/auth";
import { can } from "@/lib/permissions";
import { logoutAction } from "@/app/actions";
import { BottomTabs, MoreMenu, TopTabs } from "@/components/client/NavLinks";
import { btn } from "@/components/ui";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requirePage();
  const role = s.ctx.role;
  const more = [
    ...(can(role, "view_reports") ? [{ href: "/reports", label: "Reports" }] : []),
    ...(can(role, "import_data") ? [{ href: "/import", label: "Import data" }] : []),
    ...(can(role, "view_audit") ? [{ href: "/activity", label: "Activity log" }] : []),
    ...(can(role, "manage_settings") ? [{ href: "/settings", label: "Settings & users" }] : []),
  ];
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="no-print sticky top-0 z-30 border-b border-rule bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 lg:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2 py-3">
            <img src="/icon.svg" alt="" className="h-7 w-7" />
            <span className="max-w-44 truncate text-[15px] font-semibold">{s.business.name}</span>
          </Link>
          <nav aria-label="Main" className="ml-4 hidden md:block">
            <Suspense><TopTabs /></Suspense>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-2 lg:flex">
              <Link href="/payments/new?direction=in" className={btn.secondary}>Receive payment</Link>
              <Link href="/purchases/new" className={btn.secondary}><Plus size={16} aria-hidden /> New purchase</Link>
              <Link href="/sales/new" className={btn.primary}><Plus size={16} aria-hidden /> New sale</Link>
            </div>
            <MoreMenu name={s.user.name} role={role} links={more} signOut={logoutAction} />
          </div>
        </div>
        {/* Entry buttons for phones and tablets */}
        <div className="grid grid-cols-3 gap-2 border-t border-rule px-4 py-2 lg:hidden">
          <Link href="/payments/new?direction=in" className={`${btn.secondary} px-2`}>Receive</Link>
          <Link href="/purchases/new" className={`${btn.secondary} px-2`}>+ Purchase</Link>
          <Link href="/sales/new" className={`${btn.primary} px-2`}>+ Sale</Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-24 pt-5 md:pb-10 lg:px-6">{children}</main>
      <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        <Suspense><BottomTabs /></Suspense>
      </nav>
    </div>
  );
}
