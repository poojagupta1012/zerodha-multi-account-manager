import { CircleAlertIcon } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api"

export function QueryError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const unauthorized = error instanceof ApiError && error.status === 401
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm sm:flex-row sm:items-center"
    >
      <CircleAlertIcon className="size-4 shrink-0 text-destructive" />
      <p className="flex-1">{error.message}</p>
      {unauthorized ? (
        <Button size="sm" variant="outline" render={<Link href="/settings" />} nativeButton={false}>
          Open settings
        </Button>
      ) : (
        onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        )
      )}
    </div>
  )
}
