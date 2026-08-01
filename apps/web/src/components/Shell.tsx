import { Link, useRouterState } from "@tanstack/react-router";
import {
  BookMarked,
  Compass,
  Download,
  Search,
  Settings,
  UserRound,
} from "lucide-react";
import type { PropsWithChildren } from "react";

import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "探索", icon: Compass },
  { to: "/search", label: "搜索", icon: Search },
  { to: "/library", label: "书库", icon: BookMarked },
  { to: "/accounts", label: "账号", icon: UserRound },
  { to: "/downloads", label: "下载", icon: Download },
  { to: "/settings", label: "设置", icon: Settings },
] as const;

export function Shell({ children }: PropsWithChildren) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isReader = pathname.startsWith("/read/");

  if (isReader) {
    return (
      <div className="min-h-full min-w-0 w-full overflow-x-hidden bg-background pt-safe">
        {children}
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-w-0 w-full max-w-screen bg-background">
      {/* Desktop sidebar: fixed viewport height; only main column scrolls */}
      <aside className="hidden h-full w-56 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar px-3 pb-5 pt-[max(1.75rem,calc(var(--safe-top)+1rem))] md:flex">
        <div className="mb-8 shrink-0 px-3">
          <Brand />
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-1">
          {nav.map((item) => {
            const active =
              item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex min-h-touch items-center gap-2.5 rounded-md px-3 py-2.5 text-[0.95rem] transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="size-5 opacity-85" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Separator className="mb-3 shrink-0 bg-sidebar-border" />
        <div className="shrink-0 px-2 text-xs text-muted-foreground/80">v0.1</div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="z-20 flex min-w-0 shrink-0 items-center gap-3 border-b border-border bg-background/90 px-4 py-3.5 pt-[max(1rem,calc(var(--safe-top)+0.5rem))] backdrop-blur-md md:px-6 md:py-4">
          <Brand compact className="min-w-0 md:hidden" />
          <div className="min-w-0 flex-1" />
          <Button
            variant="outline"
            size="default"
            className="min-h-touch shrink-0 gap-2 px-4"
            asChild
          >
            <Link to="/search">
              <Search className="size-4 opacity-80" />
              搜索…
            </Link>
          </Button>
        </header>

        {/* Only main scrolls; bottom padding for mobile tab bar */}
        <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 pb-[calc(5.5rem+var(--safe-bottom))] md:px-6 md:py-6 md:pb-6">
          {children}
        </main>

        {/* Mobile bottom nav — larger touch targets + safe area */}
        <nav
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-border bg-background/95 backdrop-blur-md md:hidden"
          style={{ paddingBottom: "var(--safe-bottom)" }}
        >
          {nav.map((item) => {
            const active =
              item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex min-h-[3.5rem] flex-col items-center justify-center gap-0.5 px-0.5 py-2 text-[0.75rem] leading-tight sm:text-xs",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5 shrink-0" strokeWidth={active ? 2.25 : 1.75} />
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
