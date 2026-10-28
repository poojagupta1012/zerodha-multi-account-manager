import type { LucideIcon } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

type StatCardProps = {
  title: string
  icon: LucideIcon
  value?: React.ReactNode
  detail?: React.ReactNode
  loading?: boolean
}

export function StatCard({ title, icon: Icon, value, detail, loading }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardDescription>{title}</CardDescription>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-1">
        {loading ? (
          <>
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-4 w-36" />
          </>
        ) : (
          <>
            <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
            {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
          </>
        )}
      </CardContent>
    </Card>
  )
}
