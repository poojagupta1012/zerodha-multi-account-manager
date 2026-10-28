"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2Icon } from "lucide-react"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useSaveSafety } from "@/hooks/use-api"
import { safetySettingsSchema, type SafetySettings, type SafetySettingsValues } from "@/lib/schemas"

export function SafetySettingsForm({ safety, loading }: { safety?: SafetySettings; loading: boolean }) {
  const save = useSaveSafety()
  const form = useForm<SafetySettingsValues>({
    resolver: zodResolver(safetySettingsSchema),
    defaultValues: { copy_enabled: true, max_quantity_per_trade: 0 },
  })

  useEffect(() => {
    if (safety) form.reset(safety)
  }, [safety, form])

  return (
    <Card>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <CardHeader>
          <CardTitle>Safety limits</CardTitle>
          <CardDescription>
            Checked by the copier before every child order. Changes apply to the next master trade; no restart needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : (
            <FieldGroup>
              <Controller
                name="copy_enabled"
                control={form.control}
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel htmlFor="copy-enabled">Copy trading enabled</FieldLabel>
                      <FieldDescription>
                        Kill switch. When off, master trades are logged as skipped and no child orders are sent.
                      </FieldDescription>
                    </FieldContent>
                    <Switch
                      id="copy-enabled"
                      name={field.name}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </Field>
                )}
              />
              <Controller
                name="max_quantity_per_trade"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="max-qty">Max quantity per trade</FieldLabel>
                    <Input
                      {...field}
                      id="max-qty"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      className="max-w-48"
                      value={Number.isNaN(field.value) ? "" : field.value}
                      onChange={(e) => field.onChange(e.target.value === "" ? NaN : e.target.valueAsNumber)}
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldDescription>
                      A child order above this quantity (in units, after the multiplier) is blocked, not reduced.
                      0 means no limit.
                    </FieldDescription>
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
            Save limits
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
