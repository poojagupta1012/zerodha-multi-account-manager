"use client"

import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
  type SortingState,
} from "@tanstack/react-table"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, SearchIcon, UsersIcon } from "lucide-react"
import { useState } from "react"

import { AccountRowActions } from "@/components/accounts/account-row-actions"
import { NoAppBadge, TokenBadge } from "@/components/status-badges"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime, formatMultiplier } from "@/lib/format"
import type { Account } from "@/lib/schemas"

// Table v9 registers only the features used, at module scope so the
// references stay stable across renders.
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
})

const helper = createColumnHelper<typeof features, Account>()

const columns = helper.columns([
  helper.accessor("client_id", {
    header: "Client ID",
    sortFn: "alphanumeric",
    cell: (info) => <span className="font-mono font-medium">{info.getValue()}</span>,
  }),
  helper.accessor("token_fresh", {
    id: "status",
    header: "Status",
    sortFn: "basic",
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.role === "child" && !row.original.has_own_app ? (
          <NoAppBadge />
        ) : (
          <TokenBadge fresh={row.original.token_fresh} />
        )}
        {!row.original.is_active && (
          <Badge variant="outline" className="text-muted-foreground">
            Paused
          </Badge>
        )}
      </div>
    ),
  }),
  helper.accessor("multiplier", {
    header: "Multiplier",
    sortFn: "basic",
    cell: (info) => <span className="tabular-nums">{formatMultiplier(info.getValue())}</span>,
  }),
  helper.accessor("token_updated_at", {
    header: "Last login",
    sortFn: "alphanumeric",
    sortUndefined: "last",
    cell: (info) => <span className="text-muted-foreground">{formatDateTime(info.getValue())}</span>,
  }),
  helper.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="text-right">
        <AccountRowActions account={row.original} />
      </div>
    ),
  }),
])

const EMPTY: Account[] = []

export function AccountsTable({ data, loading }: { data?: Account[]; loading: boolean }) {
  // The table instance is mutable and stable, so React Compiler memoization
  // would keep rendering a stale row model. Opt this component out.
  "use no memo"
  const [sorting, setSorting] = useState<SortingState>([{ id: "client_id", desc: false }])
  const [globalFilter, setGlobalFilter] = useState("")

  const table = useTable({
    features,
    columns,
    data: data ?? EMPTY,
    getRowId: (row) => row.client_id,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: "includesString",
    getColumnCanGlobalFilter: (column) => column.id === "client_id",
  })

  const rows = table.getRowModel().rows

  return (
    <div className="space-y-3">
      <div className="relative max-w-xs">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search client ID"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="pl-8"
          aria-label="Search client ID"
        />
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted()
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="-ml-2.5"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          {sorted === "asc" ? (
                            <ArrowUpIcon />
                          ) : sorted === "desc" ? (
                            <ArrowDownIcon />
                          ) : (
                            <ArrowUpDownIcon className="opacity-40" />
                          )}
                        </Button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }, (_, i) => (
                <TableRow key={i}>
                  {[20, 28, 12, 32, 8].map((w, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5" style={{ width: `${w * 4}px` }} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">
                  <UsersIcon className="mx-auto mb-2 size-5" />
                  {globalFilter ? `No account matches "${globalFilter}".` : "No child accounts yet. Add one to start copying."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} className={row.original.is_active ? undefined : "opacity-60"}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
