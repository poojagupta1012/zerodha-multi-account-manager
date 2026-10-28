"use client"

import { LogInIcon, MoreHorizontalIcon, PauseIcon, PencilIcon, PlayIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { DeleteAccountDialog } from "@/components/accounts/delete-account-dialog"
import { EditMultiplierDialog } from "@/components/accounts/edit-multiplier-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useUpdateAccount } from "@/hooks/use-api"
import { kiteLoginUrl } from "@/lib/api"
import type { Account } from "@/lib/schemas"

export function AccountRowActions({ account }: { account: Account }) {
  // Dialogs live outside the menu so they stay mounted after it closes.
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null)
  const update = useUpdateAccount()

  function toggleActive() {
    const is_active = !account.is_active
    update.mutate(
      { clientId: account.client_id, is_active },
      { onSuccess: () => toast.success(`${account.client_id} ${is_active ? "resumed" : "paused"}`) },
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${account.client_id}`} />}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => window.location.assign(kiteLoginUrl(account.client_id))}>
            <LogInIcon />
            Login to Kite
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("edit")}>
            <PencilIcon />
            Edit multiplier
          </DropdownMenuItem>
          <DropdownMenuItem onClick={toggleActive} disabled={update.isPending}>
            {account.is_active ? <PauseIcon /> : <PlayIcon />}
            {account.is_active ? "Pause copying" : "Resume copying"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditMultiplierDialog
        account={account}
        open={dialog === "edit"}
        onOpenChange={(open) => setDialog(open ? "edit" : null)}
      />
      <DeleteAccountDialog
        account={account}
        open={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
      />
    </>
  )
}
