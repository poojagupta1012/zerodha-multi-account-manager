"use client"

import { CircleAlertIcon } from "lucide-react"
import Link from "next/link"

import { MasterOrdersTable } from "@/components/orders/master-orders-table"
import { PlaceOrderForm } from "@/components/orders/place-order-form"
import { QueryError } from "@/components/query-error"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/hooks/use-api"
import { useHydrated } from "@/hooks/use-hydrated"

export function OrdersView() {
  const dashboard = useDashboard()
  // The topbar may have fetched the dashboard before this page hydrates;
  // rendering it straight away would not match the server HTML.
  const hydrated = useHydrated()
  const data = hydrated ? dashboard.data : undefined
  const error = hydrated ? dashboard.error : null
  const refetch = dashboard.refetch
  const master = data?.master ?? null
  const canTrade = Boolean(master?.token_fresh)

  return (
    <>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Orders</h2>
        <p className="text-sm text-muted-foreground">
          Trade in the master account. Completed orders are copied to every active child.
        </p>
      </div>

      {error && <QueryError error={error} onRetry={() => refetch()} />}
      {data && !canTrade && (
        <div
          role="status"
          className="flex flex-col items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm sm:flex-row sm:items-center"
        >
          <CircleAlertIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="flex-1">
            {master
              ? `${master.client_id} is not logged in to Kite today, so orders can't be placed.`
              : "No master account is registered yet."}
          </p>
          <Button size="sm" variant="outline" render={<Link href={master ? "/" : "/settings"} />} nativeButton={false}>
            {master ? "Go to dashboard" : "Set up master"}
          </Button>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <PlaceOrderForm
          masterId={master?.client_id ?? null}
          canTrade={canTrade}
          dryRun={data?.dry_run ?? false}
          activeChildren={data?.children.active_with_token ?? 0}
        />
        <MasterOrdersTable enabled={canTrade} masterId={master?.client_id ?? null} />
      </div>
    </>
  )
}
