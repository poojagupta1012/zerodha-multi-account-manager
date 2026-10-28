"use client"

import { ActivityIcon } from "lucide-react"
import { useMemo, useState } from "react"

import { QueryError } from "@/components/query-error"
import { CopyStatusBadge, SideBadge } from "@/components/status-badges"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useCopies } from "@/hooks/use-api"
import { formatTime } from "@/lib/format"
import type { CopyRow } from "@/lib/schemas"

type MasterTrade = {
  masterOrderId: string
  createdAt: string
  tradingsymbol: string | null
  side: CopyRow["transaction_type"]
  children: CopyRow[]
}

/** copy_log has one row per (master order, child); show one line per master order. */
function groupByMasterOrder(rows: CopyRow[]): MasterTrade[] {
  const groups = new Map<string, MasterTrade>()
  for (const row of rows) {
    let g = groups.get(row.master_order_id)
    if (!g) {
      g = {
        masterOrderId: row.master_order_id,
        createdAt: row.created_at,
        tradingsymbol: row.tradingsymbol,
        side: row.transaction_type,
        children: [],
      }
      groups.set(row.master_order_id, g)
    }
    g.children.push(row)
    if (row.created_at < g.createdAt) g.createdAt = row.created_at
  }
  for (const g of groups.values()) g.children.sort((a, b) => a.client_id.localeCompare(b.client_id))
  return [...groups.values()] // rows arrive newest first, Map keeps that order
}

const FILTERS = {
  all: { label: "All", match: () => true },
  issues: {
    label: "Needs attention",
    match: (t: MasterTrade) => t.children.some((c) => c.status === "FAILED" || c.status === "SKIPPED"),
  },
} as const

export function RecentActivity() {
  const { data, isPending, error, refetch } = useCopies()
  const [filter, setFilter] = useState<keyof typeof FILTERS>("all")

  const trades = useMemo(() => groupByMasterOrder(data ?? []), [data])
  const visible = trades.filter(FILTERS[filter].match).slice(0, 25)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Master trades and what happened in each child account. Refreshes every 5s.</CardDescription>
        <CardAction className="flex gap-1">
          {Object.entries(FILTERS).map(([key, f]) => (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? "secondary" : "ghost"}
              onClick={() => setFilter(key as keyof typeof FILTERS)}
            >
              {f.label}
            </Button>
          ))}
        </CardAction>
      </CardHeader>
      <CardContent>
        {error ? (
          <QueryError error={error} onRetry={() => refetch()} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Time (IST)</TableHead>
                <TableHead>Master trade</TableHead>
                <TableHead>Child executions</TableHead>
                <TableHead className="w-20 text-right">Placed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                Array.from({ length: 5 }, (_, i) => (
                  <TableRow key={i}>
                    {[16, 40, 56, 10].map((w, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5" style={{ width: `${w * 4}px` }} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                    <ActivityIcon className="mx-auto mb-2 size-5" />
                    {filter === "all"
                      ? "No trades copied yet. They appear here as soon as the master's orders complete."
                      : "Nothing needs attention."}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((t) => <TradeRow key={t.masterOrderId} trade={t} />)
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function TradeRow({ trade }: { trade: MasterTrade }) {
  const placed = trade.children.filter((c) => c.status === "PLACED").length
  return (
    <TableRow>
      <TableCell className="font-mono text-xs tabular-nums">{formatTime(trade.createdAt)}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <SideBadge side={trade.side} />
          <span className="font-medium">{trade.tradingsymbol ?? "—"}</span>
        </div>
        <div className="font-mono text-xs text-muted-foreground">#{trade.masterOrderId}</div>
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex flex-wrap gap-1">
          {trade.children.map((c) => (
            <Tooltip key={c.client_id}>
              <TooltipTrigger render={<CopyStatusBadge status={c.status} />}>
                <span className="font-mono">{c.client_id}</span>
                {c.quantity ? <span className="opacity-70">×{c.quantity}</span> : null}
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="font-medium">{c.status}</p>
                <p>{c.error ?? (c.child_order_id ? `Order ${c.child_order_id}` : "In progress")}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {placed}/{trade.children.length}
      </TableCell>
    </TableRow>
  )
}
