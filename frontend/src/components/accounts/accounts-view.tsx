"use client"

import { AccountsTable } from "@/components/accounts/accounts-table"
import { AddAccountDialog } from "@/components/accounts/add-account-dialog"
import { QueryError } from "@/components/query-error"
import { useAccounts } from "@/hooks/use-api"

export function AccountsView() {
  const { data, isPending, error, refetch } = useAccounts()
  const children = data?.filter((a) => a.role === "child")
  const expired = children?.filter((a) => a.is_active && !a.token_fresh).length ?? 0

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Child accounts</h2>
          <p className="text-sm text-muted-foreground">
            Accounts that mirror the master&apos;s trades. Each one needs a Kite login every day after 6 AM IST.
          </p>
        </div>
        <AddAccountDialog />
      </div>

      {expired > 0 && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          {expired} active {expired === 1 ? "account has" : "accounts have"} an expired token and will not receive
          copies until logged in. Use <span className="font-medium">Login to Kite</span> from the row menu.
        </p>
      )}

      {error ? <QueryError error={error} onRetry={() => refetch()} /> : <AccountsTable data={children} loading={isPending} />}
    </>
  )
}
