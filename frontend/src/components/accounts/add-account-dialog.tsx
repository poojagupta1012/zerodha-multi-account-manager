"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2Icon, PlusIcon } from "lucide-react"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
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
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useCreateAccount } from "@/hooks/use-api"
import { KITE_REDIRECT_URL, kiteLoginUrl } from "@/lib/api"
import { addAccountSchema, type AddAccountValues } from "@/lib/schemas"

export function AddAccountDialog() {
  const [open, setOpen] = useState(false)
  const create = useCreateAccount()
  const form = useForm<AddAccountValues>({
    resolver: zodResolver(addAccountSchema),
    defaultValues: { client_id: "", multiplier: 1, api_key: "", api_secret: "" },
  })

  async function onSubmit(values: AddAccountValues) {
    const account = await create.mutateAsync(values).catch(() => null) // error toast comes from the hook
    if (!account) return
    toast.success(`${account.client_id} added`, { description: "Redirecting to Kite to log in…" })
    // The account needs today's access token before it can receive copies.
    window.location.assign(kiteLoginUrl(account.client_id))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) form.reset()
      }}
    >
      <DialogTrigger render={<Button />}>
        <PlusIcon data-icon="inline-start" />
        Add child account
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Add child account</DialogTitle>
            <DialogDescription>
              Kite only lets an app&apos;s own client ID log in, so each child needs its own Kite Connect app. On
              developers.kite.trade, create an app with this client ID as its Zerodha Client ID and the redirect
              URL{" "}
              <code className="font-mono text-foreground break-all">{KITE_REDIRECT_URL}</code>, and paste its key
              and secret below. After saving you&apos;ll be sent to Kite to log in as this client.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Controller
              name="client_id"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="add-client-id">Client ID</FieldLabel>
                  <Input
                    {...field}
                    id="add-client-id"
                    placeholder="CD5678"
                    autoComplete="off"
                    autoCapitalize="characters"
                    className="font-mono uppercase"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              name="multiplier"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="add-multiplier">Multiplier</FieldLabel>
                  <Input
                    {...field}
                    id="add-multiplier"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min="0"
                    value={Number.isNaN(field.value) ? "" : field.value}
                    onChange={(e) => field.onChange(e.target.value === "" ? NaN : e.target.valueAsNumber)}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    Child quantity = master quantity × multiplier, rounded down (to whole lots for F&amp;O).
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              name="api_key"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="add-api-key">API key</FieldLabel>
                  <Input
                    {...field}
                    id="add-api-key"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
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
                  <FieldLabel htmlFor="add-api-secret">API secret</FieldLabel>
                  <Input
                    {...field}
                    id="add-api-secret"
                    type="password"
                    autoComplete="new-password"
                    className="font-mono"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>Stored encrypted on the server and never shown again.</FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </FieldGroup>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
              Save &amp; log in to Kite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
