import type { Metadata } from "next"

import { DashboardView } from "@/components/dashboard/dashboard-view"

// The layout's title template doesn't apply to a page in the same segment.
export const metadata: Metadata = { title: { absolute: "Dashboard · Copy Trader" } }

export default function DashboardPage() {
  return <DashboardView />
}
