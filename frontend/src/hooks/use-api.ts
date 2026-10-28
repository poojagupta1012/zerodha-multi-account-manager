"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { api, type AccountUpdate } from "@/lib/api"
import type { MasterSettingsValues, SafetySettingsValues } from "@/lib/schemas"

// Copies and the ticker heartbeat change while the market is open, so the
// status views poll. Account and settings data only change through this UI.
const LIVE_REFRESH_MS = 5_000

export const queryKeys = {
  dashboard: ["dashboard"] as const,
  accounts: ["accounts"] as const,
  copies: ["copies"] as const,
  masterOrders: ["master-orders"] as const,
  settings: ["settings"] as const,
}

export function useDashboard() {
  return useQuery({ queryKey: queryKeys.dashboard, queryFn: api.dashboard, refetchInterval: LIVE_REFRESH_MS })
}

export function useCopies() {
  return useQuery({ queryKey: queryKeys.copies, queryFn: () => api.copies(), refetchInterval: LIVE_REFRESH_MS })
}

// Today's master order book, straight from Kite. Only fetched while the master
// is logged in, since the call needs its access token.
export function useMasterOrders(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.masterOrders,
    queryFn: api.masterOrders,
    refetchInterval: LIVE_REFRESH_MS,
    enabled,
  })
}

export function usePlaceOrder() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: api.placeOrder, onSuccess: invalidate, onError })
}

export function useAccounts() {
  return useQuery({ queryKey: queryKeys.accounts, queryFn: api.accounts })
}

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: api.settings })
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries()
}

const onError = (err: Error) => toast.error(err.message)

export function useCreateAccount() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: api.createAccount, onSuccess: invalidate, onError })
}

export function useUpdateAccount() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ clientId, ...body }: { clientId: string } & AccountUpdate) =>
      api.updateAccount(clientId, body),
    onSuccess: invalidate,
    onError,
  })
}

export function useDeleteAccount() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: (_, clientId) => {
      toast.success(`Removed ${clientId}`)
      return invalidate()
    },
    onError,
  })
}

export function useSaveMaster() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (v: MasterSettingsValues) => api.saveMaster(v),
    onSuccess: () => {
      toast.success("Master account saved")
      return invalidate()
    },
    onError,
  })
}

export function useSaveSafety() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (v: SafetySettingsValues) => api.saveSafety(v),
    onSuccess: (s) => {
      toast.success(s.copy_enabled ? "Safety limits saved" : "Saved. Copy trading is paused.")
      return invalidate()
    },
    onError,
  })
}
