import { Badge } from "@/components/ui/badge"
import type { CopyStatus, TickerState } from "@/lib/schemas"
import { cn } from "@/lib/utils"

// Semantic colours layered on the outline badge so they read in both themes.
const tone = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  muted: "text-muted-foreground",
} as const

function Dot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("size-1.5 rounded-full bg-current", className)} />
}

export function TokenBadge({ fresh }: { fresh: boolean }) {
  return (
    <Badge variant="outline" className={fresh ? tone.success : tone.danger}>
      <Dot />
      {fresh ? "Token active" : "Token expired"}
    </Badge>
  )
}

// A child without its own Kite app cannot log in (Kite rejects other client IDs).
export function NoAppBadge() {
  return (
    <Badge variant="outline" className={tone.warning}>
      <Dot />
      No API key
    </Badge>
  )
}

const copyTone: Record<CopyStatus, string> = {
  PLACED: tone.success,
  FAILED: tone.danger,
  SKIPPED: tone.warning,
  PENDING: tone.muted,
}

// Forwards props so it can be used as a tooltip trigger via `render`.
export function CopyStatusBadge({
  status,
  children,
  className,
  ...props
}: { status: CopyStatus } & Omit<React.ComponentProps<typeof Badge>, "variant">) {
  return (
    <Badge variant="outline" className={cn(copyTone[status], className)} {...props}>
      {children ?? status.toLowerCase()}
    </Badge>
  )
}

// Kite order book statuses. Anything not listed (OPEN, TRIGGER PENDING,
// AMO REQ RECEIVED, ...) is still working, so it reads as pending.
const orderTone: Record<string, string> = {
  COMPLETE: tone.success,
  REJECTED: tone.danger,
  CANCELLED: tone.muted,
}

export function OrderStatusBadge({
  status,
  className,
  ...props
}: { status: string } & Omit<React.ComponentProps<typeof Badge>, "variant">) {
  return (
    <Badge variant="outline" className={cn(orderTone[status] ?? tone.warning, className)} {...props}>
      {status.toLowerCase()}
    </Badge>
  )
}

const tickerLabel: Record<TickerState, { label: string; tone: string; pulse: boolean }> = {
  running: { label: "Ticker running", tone: tone.success, pulse: true },
  disconnected: { label: "Reconnecting", tone: tone.warning, pulse: true },
  stopped: { label: "Ticker stopped", tone: tone.danger, pulse: false },
}

export function TickerBadge({ state }: { state: TickerState }) {
  const t = tickerLabel[state]
  return (
    <Badge variant="outline" className={t.tone}>
      <Dot className={cn(t.pulse && "animate-pulse")} />
      {t.label}
    </Badge>
  )
}

export function SideBadge({ side }: { side: "BUY" | "SELL" | null }) {
  if (!side) return null
  return (
    <span
      className={cn(
        "font-mono text-xs font-semibold",
        side === "BUY" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
      )}
    >
      {side}
    </span>
  )
}
