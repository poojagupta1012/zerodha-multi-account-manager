"use client"

import { Loader2Icon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useDeleteAccount } from "@/hooks/use-api"
import type { Account } from "@/lib/schemas"

type Props = { account: Account; open: boolean; onOpenChange: (open: boolean) => void }

export function DeleteAccountDialog({ account, open, onOpenChange }: Props) {
  const remove = useDeleteAccount()

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Remove <span className="font-mono">{account.client_id}</span>?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This account stops receiving copies and its stored access token is deleted. Its copy history stays in
            the activity log. Open positions in the account are not touched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate(account.client_id, { onSuccess: () => onOpenChange(false) })}
          >
            {remove.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
            Remove account
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
