"use client"

import { CrownIcon, LogInIcon } from "lucide-react"
import Link from "next/link"

import { TickerBadge, TokenBadge } from "@/components/status-badges"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { kiteLoginUrl } from "@/lib/api"
import { formatDateTime } from "@/lib/format"
import type { Dashboard } from "@/lib/schemas"

export function MasterStatusCard({ data, loading }: { data?: Dashboard; loading: boolean }) {
  if (loading || !data) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-36" />
        </CardContent>
      </Card>
    )
  }

  const { master, ticker } = data
  if (!master) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No master account</CardTitle>
          <CardDescription>Register the account whose trades should be copied.</CardDescription>
          <CardAction>
            <Button render={<Link href="/settings" />} nativeButton={false}>
              Set up master
            </Button>
          </CardAction>
        </CardHeader>
      </Card>
    )
  }

  const connected = master.token_fresh
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CrownIcon className="size-4 text-amber-500" />
          Master account
          <span className="font-mono">{master.client_id}</span>
        </CardTitle>
        <CardDescription>Last login: {formatDateTime(master.token_updated_at)}</CardDescription>
        <CardAction>
          {/* Full-page navigation: Kite's login page redirects back here. */}
          <Button
            variant={connected ? "outline" : "default"}
            onClick={() => window.location.assign(kiteLoginUrl(master.client_id))}
          >
            <LogInIcon data-icon="inline-start" />
            {connected ? "Log in again" : "Login to Kite"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{connected ? "Active" : "Disconnected"}</span>
        <TokenBadge fresh={connected} />
        <TickerBadge state={ticker.state} />
        {connected && ticker.state === "stopped" && (
          <span className="text-muted-foreground">
            Start the listener with <code className="font-mono">python ticker.py</code>
          </span>
        )}
        {!connected && (
          <span className="text-muted-foreground">Tokens reset at 6 AM IST. Log in to resume copying.</span>
        )}
      </CardContent>
    </Card>
  )
}
