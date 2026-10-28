"use client"

import { usePathname } from "next/navigation"

import { TickerBadge } from "@/components/status-badges"
import { ThemeToggle } from "@/components/theme-toggle"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { useDashboard } from "@/hooks/use-api"

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/orders": "Orders",
  "/accounts": "Child Accounts",
  "/settings": "Settings",
}

export function Topbar() {
  const pathname = usePathname()
  // Shares the dashboard query (and its polling) with the dashboard page.
  const { data, isPending, isError } = useDashboard()

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4 data-vertical:self-auto" />
      <h1 className="text-sm font-medium">{TITLES[pathname] ?? "Copy Trader"}</h1>

      <div className="ml-auto flex items-center gap-2">
        {isPending ? (
          <Skeleton className="h-5 w-28" />
        ) : isError ? null : (
          <>
            {data.dry_run && (
              <span className="hidden text-xs font-medium text-amber-600 sm:inline dark:text-amber-400">
                DRY RUN
              </span>
            )}
            <TickerBadge state={data.ticker.state} />
          </>
        )}
        <ThemeToggle />
      </div>
    </header>
  )
}
