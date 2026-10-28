"use client"

import { ArrowLeftRightIcon, ServerIcon, UsersIcon } from "lucide-react"

import { MasterStatusCard } from "@/components/dashboard/master-status-card"
import { RecentActivity } from "@/components/dashboard/recent-activity"
import { QueryError } from "@/components/query-error"
import { StatCard } from "@/components/stat-card"
import { useDashboard } from "@/hooks/use-api"
import { formatTime } from "@/lib/format"
import type { Dashboard } from "@/lib/schemas"

function systemStatus(d: Dashboard): { value: string; detail: string } {
  if (!d.safety.copy_enabled) return { value: "Paused", detail: "Copy trading is switched off in Settings" }
  if (!d.master?.token_fresh) return { value: "Offline", detail: "Master needs to log in to Kite" }
  if (d.ticker.state === "stopped") return { value: "Stopped", detail: "Ticker not running (python ticker.py)" }
  if (d.ticker.state === "disconnected") return { value: "Reconnecting", detail: "WebSocket is down; retrying" }
  return {
    value: d.dry_run ? "Live (dry run)" : "Live",
    detail: `Heartbeat ${formatTime(d.ticker.last_heartbeat)} IST`,
  }
}

export function DashboardView() {
  const { data, isPending, error, refetch } = useDashboard()

  return (
    <>
      {error && <QueryError error={error} onRetry={() => refetch()} />}

      <MasterStatusCard data={data} loading={isPending} />

      <section className="grid gap-4 md:grid-cols-3" aria-label="Today">
        <StatCard
          title="Active child accounts"
          icon={UsersIcon}
          loading={isPending}
          value={data?.children.active}
          detail={
            data &&
            `${data.children.active_with_token} with a valid token · ${data.children.total} registered`
          }
        />
        <StatCard
          title="Trades executed today"
          icon={ArrowLeftRightIcon}
          loading={isPending}
          value={data?.today.master_trades}
          detail={
            data &&
            `${data.today.placed} placed · ${data.today.failed} failed · ${data.today.skipped} skipped`
          }
        />
        <StatCard
          title="System status"
          icon={ServerIcon}
          loading={isPending}
          value={data && systemStatus(data).value}
          detail={data && systemStatus(data).detail}
        />
      </section>

      <RecentActivity />
    </>
  )
}
