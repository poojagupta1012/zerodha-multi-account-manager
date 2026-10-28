"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2Icon } from "lucide-react"
import { useEffect } from "react"
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
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useUpdateAccount } from "@/hooks/use-api"
import { editMultiplierSchema, type Account, type EditMultiplierValues } from "@/lib/schemas"

type Props = { account: Account; open: boolean; onOpenChange: (open: boolean) => void }

export function EditMultiplierDialog({ account, open, onOpenChange }: Props) {
  const update = useUpdateAccount()
  const form = useForm<EditMultiplierValues>({
    resolver: zodResolver(editMultiplierSchema),
    defaultValues: { multiplier: account.multiplier },
  })

  // Start from the current value each time the dialog opens.
  useEffect(() => {
    if (open) form.reset({ multiplier: account.multiplier })
  }, [open, account.multiplier, form])

  async function onSubmit({ multiplier }: EditMultiplierValues) {
    const ok = await update.mutateAsync({ clientId: account.client_id, multiplier }).then(
      () => true,
      () => false,
    )
    if (!ok) return
    toast.success(`${account.client_id} multiplier set to ${multiplier}x`)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>
              Edit multiplier · <span className="font-mono">{account.client_id}</span>
            </DialogTitle>
            <DialogDescription>Applies from the next master trade. Orders already placed are unchanged.</DialogDescription>
          </DialogHeader>

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
                  autoFocus
                  value={Number.isNaN(field.value) ? "" : field.value}
                  onChange={(e) => field.onChange(e.target.value === "" ? NaN : e.target.valueAsNumber)}
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

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
