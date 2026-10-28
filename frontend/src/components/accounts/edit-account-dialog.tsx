"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2Icon } from "lucide-react"
import { useEffect } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useUpdateAccount } from "@/hooks/use-api"
import { editAccountSchema, type Account, type EditAccountValues } from "@/lib/schemas"

type Props = { account: Account; open: boolean; onOpenChange: (open: boolean) => void }

function initialValues(account: Account): EditAccountValues {
  return { multiplier: account.multiplier, api_key: account.api_key ?? "", api_secret: "" }
}

export function EditAccountDialog({ account, open, onOpenChange }: Props) {
  const update = useUpdateAccount()
  const form = useForm<EditAccountValues>({
    resolver: zodResolver(editAccountSchema),
    defaultValues: initialValues(account),
  })
  const apiKey = useWatch({ control: form.control, name: "api_key" })
  const keyChanged = apiKey.trim() !== (account.api_key ?? "")

  // Start from the current values each time the dialog opens.
  useEffect(() => {
    if (open) form.reset(initialValues(account))
  }, [open, account, form])

  async function onSubmit(values: EditAccountValues) {
    if (keyChanged && !values.api_secret) {
      form.setError("api_secret", { message: "Enter the API secret for this API key" })
      return
    }
    const ok = await update.mutateAsync({ clientId: account.client_id, ...values }).then(
      () => true,
      () => false,
    )
    if (!ok) return
    toast.success(
      `${account.client_id} updated`,
      keyChanged ? { description: "New Kite app saved. Log in to Kite again for this account." } : undefined,
    )
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>
              Edit account · <span className="font-mono">{account.client_id}</span>
            </DialogTitle>
            <DialogDescription>
              Multiplier changes apply from the next master trade. Orders already placed are unchanged.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Controller
              name="multiplier"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="edit-multiplier">Multiplier</FieldLabel>
                  <Input
                    {...field}
                    id="edit-multiplier"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min="0"
                    value={Number.isNaN(field.value) ? "" : field.value}
                    onChange={(e) => field.onChange(e.target.value === "" ? NaN : e.target.valueAsNumber)}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              name="api_key"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="edit-api-key">API key</FieldLabel>
                  <Input
                    {...field}
                    id="edit-api-key"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    From {account.client_id}&apos;s own Kite Connect app. Changing it signs this account out of
                    Kite.
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              name="api_secret"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="edit-api-secret">API secret</FieldLabel>
                  <Input
                    {...field}
                    id="edit-api-secret"
                    type="password"
                    autoComplete="new-password"
                    placeholder={keyChanged ? "" : "Unchanged"}
                    className="font-mono"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    {keyChanged ? "Required for a new API key." : "Leave blank to keep the stored secret."}
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </FieldGroup>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
