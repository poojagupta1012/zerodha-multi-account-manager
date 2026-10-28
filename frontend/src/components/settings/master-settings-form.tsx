"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2Icon } from "lucide-react"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useSaveMaster } from "@/hooks/use-api"
import { masterSettingsSchema, type MasterSettingsValues, type Settings } from "@/lib/schemas"

export function MasterSettingsForm({ settings, loading }: { settings?: Settings; loading: boolean }) {
  const save = useSaveMaster()
  const master = settings?.master
  const form = useForm<MasterSettingsValues>({
    resolver: zodResolver(masterSettingsSchema),
    defaultValues: { client_id: "", api_key: "", api_secret: "" },
  })

  // Load server values once they arrive (and after each save).
  useEffect(() => {
    if (!settings) return
    form.reset({
      client_id: master?.client_id ?? "",
      api_key: master && !master.api_key_from_env ? master.api_key : "",
      api_secret: "",
    })
  }, [settings, master, form])

  return (
    <Card>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <CardHeader>
          <CardTitle>Master account</CardTitle>
          <CardDescription>
            The account whose trades are copied, and the Kite Connect app it logs in through. Leave the key and
            secret blank to use <code className="font-mono">KITE_API_KEY</code> /{" "}
            <code className="font-mono">KITE_API_SECRET</code> from the backend <code className="font-mono">.env</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          {loading ? (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <FieldGroup>
              <Controller
                name="client_id"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="master-client-id">Client ID</FieldLabel>
                    <Input
                      {...field}
                      id="master-client-id"
                      placeholder="AB1234"
                      autoComplete="off"
                      className="font-mono uppercase"
                      readOnly={!!master}
                      aria-invalid={fieldState.invalid}
                    />
                    {master && (
                      <FieldDescription>
                        To switch masters, run <code className="font-mono">python manage.py remove {master.client_id}</code>{" "}
                        first.
                      </FieldDescription>
                    )}
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <Controller
                name="api_key"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="master-api-key">API key</FieldLabel>
                    <Input
                      {...field}
                      id="master-api-key"
                      autoComplete="off"
                      className="font-mono"
                      placeholder={master?.api_key_from_env ? `Using .env key (${master.api_key})` : "From developers.kite.trade"}
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <Controller
                name="api_secret"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="master-api-secret">API secret</FieldLabel>
                    <Input
                      {...field}
                      id="master-api-secret"
                      type="password"
                      autoComplete="new-password"
                      className="font-mono"
                      placeholder={
                        !master || master.api_secret_from_env
                          ? "Using .env secret"
                          : "Stored (encrypted). Leave blank to keep it"
                      }
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldDescription>Write-only. The server encrypts it and never sends it back.</FieldDescription>
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            </FieldGroup>
          )}
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={loading || save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
            {master ? "Save credentials" : "Register master"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
