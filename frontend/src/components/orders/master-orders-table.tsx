"use client"

import { ReceiptTextIcon } from "lucide-react"

import { QueryError } from "@/components/query-error"
import { OrderStatusBadge, SideBadge } from "@/components/status-badges"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useMasterOrders } from "@/hooks/use-api"
import type { MasterOrder } from "@/lib/schemas"

const price = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function priceLabel(o: MasterOrder): string {
  if (o.average_price > 0) return price(o.average_price)
  if (o.price > 0) return price(o.price)
  return "Market"
}

export function MasterOrdersTable({ enabled, masterId }: { enabled: boolean; masterId: string | null }) {
  const { data, isPending, error, refetch } = useMasterOrders(enabled)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today&apos;s master orders</CardTitle>
        <CardDescription>
          {masterId ? `${masterId}'s order book from Kite. ` : ""}Refreshes every 5s. Completed orders are copied to
          the children; see the dashboard for each child&apos;s result.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!enabled ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Log the master in to Kite to see its orders.
          </p>
        ) : error ? (
          <QueryError error={error} onRetry={() => refetch()} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Time</TableHead>
                <TableHead>Order</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                Array.from({ length: 4 }, (_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }, (_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : data?.length ? (
                data.map((o) => (
                  <TableRow key={o.order_id}>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                      {o.order_timestamp?.slice(11, 19) ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <SideBadge side={o.transaction_type} />
                        <span className="font-mono font-medium">{o.tradingsymbol}</span>
                        <span className="text-xs text-muted-foreground">{o.exchange}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {o.order_type} · {o.product}
                        {o.variety !== "regular" && ` · ${o.variety.toUpperCase()}`}
                        {o.trigger_price > 0 && ` · trigger ${price(o.trigger_price)}`}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {o.filled_quantity}/{o.quantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{priceLabel(o)}</TableCell>
                    <TableCell className="text-right">
                      {o.status_message ? (
                        <Tooltip>
                          <TooltipTrigger render={<OrderStatusBadge status={o.status} className="cursor-help" />} />
                          <TooltipContent className="max-w-xs">{o.status_message}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <OrderStatusBadge status={o.status} />
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    <ReceiptTextIcon className="mx-auto mb-2 size-5" />
                    No orders in {masterId ?? "the master account"} today.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
