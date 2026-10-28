"use client"

import { QueryError } from "@/components/query-error"
import { AdminTokenForm } from "@/components/settings/admin-token-form"
import { MasterSettingsForm } from "@/components/settings/master-settings-form"
import { SafetySettingsForm } from "@/components/settings/safety-settings-form"
import { useSettings } from "@/hooks/use-api"

export function SettingsView() {
  const { data, isPending, error, refetch } = useSettings()

  return (
    <>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">Master credentials and global copy-trading limits.</p>
      </div>

      {/* The token form stays usable on a 401, which is how you fix one. */}
      {error && <QueryError error={error} onRetry={() => refetch()} />}
      {!error && (
        <>
          <MasterSettingsForm settings={data} loading={isPending} />
          <SafetySettingsForm safety={data?.safety} loading={isPending} />
        </>
      )}
      <AdminTokenForm />
    </>
  )
}
