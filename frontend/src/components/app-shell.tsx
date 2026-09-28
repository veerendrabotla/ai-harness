"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Coins,
  LayoutDashboard,
  FolderKanban,
  Layers,
  LogOut,
  Menu,
  Settings,
  X,
  BookOpen,
  FlaskConical,
  GitBranch,
  Store,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/auth-store";

const PRIMARY_NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agent", label: "Agent", icon: Layers, accent: true },
  { href: "/sessions", label: "Sessions", icon: Layers },
  { href: "/projects", label: "Projects", icon: FolderKanban },
];

const SECONDARY_NAV = [
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/playground", label: "Playground", icon: FlaskConical },
  { href: "/pipeline", label: "Pipeline", icon: GitBranch },
  { href: "/models", label: "Models", icon: Store },
  { href: "/usage", label: "Usage", icon: Coins },
  { href: "/organizations", label: "Orgs", icon: Building2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const isActive = (href: string) => {
    if (href === "/agent") return pathname === "/agent" || pathname.startsWith("/agent?");
    if (href === "/sessions") return pathname === "/sessions" || pathname.startsWith("/sessions/");
    if (href === "/settings") return pathname.startsWith("/settings");
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const nav = (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {PRIMARY_NAV.map(({ href, label, icon: Icon, accent }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setDrawerOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-all",
              accent && !active
                ? "bg-brand/10 text-brand hover:bg-brand/15"
                : active
                  ? "bg-surface-3 text-text-primary"
                  : "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="hidden lg:inline">{label}</span>
          </Link>
        );
      })}
      <div className="my-2 h-px bg-border" />
      {SECONDARY_NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setDrawerOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors",
              active
                ? "bg-surface-3 text-text-primary"
                : "text-text-muted hover:bg-surface-2 hover:text-text-secondary",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="hidden lg:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const userBlock = (
    <div className="mt-auto border-t border-border pt-3">
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand">
          {user?.displayName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="hidden min-w-0 flex-1 lg:block">
          <p className="truncate text-[12px] font-medium text-text-primary">{user?.displayName ?? user?.email}</p>
          <p className="truncate text-[11px] text-text-muted">{user?.email}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          clearSession();
          router.push("/login");
        }}
        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12px] text-text-muted hover:bg-surface-2 hover:text-text-secondary transition-colors"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden lg:inline">Sign out</span>
      </button>
    </div>
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Skip to content link for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:inset-x-0 focus:top-0 focus:z-50 focus:bg-brand focus:py-3 focus:text-center focus:text-white focus:outline-none"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex shrink-0 flex-col border-r border-border bg-surface-1 p-3 md:w-[60px] lg:w-[220px]",
        )}
      >
        <Link href="/agent" className="mb-5 flex items-center gap-2 px-2 py-1">
          <FolderKanban className="h-5 w-5 text-brand shrink-0" aria-hidden />
          <span className="hidden text-[15px] font-bold tracking-tight text-text-primary lg:inline">AI Harness</span>
        </Link>
        {nav}
        {userBlock}
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-11 items-center justify-between border-b border-border bg-surface-1 px-3 md:hidden">
        <button
          type="button"
          aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setDrawerOpen((v) => !v)}
          className="rounded-md p-1.5 text-text-secondary hover:bg-surface-2"
        >
          {drawerOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
        <span className="text-[13px] font-semibold">AI Harness</span>
        <span className="w-7" />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-x-0 bottom-0 top-11 z-30 flex flex-col border-t border-border bg-surface-1 p-3 md:hidden">
          {nav}
          {userBlock}
        </div>
      )}

      <main id="main-content" className="flex-1 overflow-hidden md:pt-0 pt-11" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
