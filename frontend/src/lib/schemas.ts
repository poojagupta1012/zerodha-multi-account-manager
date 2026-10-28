import { z } from "zod"

// Zerodha client IDs look like AB1234 (2-4 letters, 3-6 digits). Mirrors
// CLIENT_ID_PATTERN in main.py so the form rejects what the API would.
const clientId = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2,4}[0-9]{3,6}$/, "Enter a Zerodha client ID such as AB1234")

const multiplier = z
  .number({ error: "Enter a number" })
  .gt(0, "Must be greater than 0")
  .max(100, "Must be 100 or less")

// --- forms -------------------------------------------------------------------------

export const addAccountSchema = z.object({ client_id: clientId, multiplier })
export type AddAccountValues = z.infer<typeof addAccountSchema>

export const editMultiplierSchema = z.object({ multiplier })
export type EditMultiplierValues = z.infer<typeof editMultiplierSchema>

export const masterSettingsSchema = z.object({
  client_id: clientId,
  // Blank key = use KITE_API_KEY from the backend .env.
  api_key: z.string().trim().max(64, "Too long"),
  // Write-only: blank keeps the secret already stored on the server.
  api_secret: z.string().trim().max(128, "Too long"),
})
export type MasterSettingsValues = z.infer<typeof masterSettingsSchema>

export const safetySettingsSchema = z.object({
  copy_enabled: z.boolean(),
  max_quantity_per_trade: z
    .number({ error: "Enter a whole number" })
    .int("Enter a whole number")
    .min(0, "Must be 0 or more")
    .max(1_000_000, "Must be 1,000,000 or less"),
})
export type SafetySettingsValues = z.infer<typeof safetySettingsSchema>

export const adminTokenSchema = z.object({ token: z.string().trim().max(256) })
export type AdminTokenValues = z.infer<typeof adminTokenSchema>

// --- API responses -----------------------------------------------------------------

export type Account = {
  client_id: string
  role: "master" | "child"
  multiplier: number
  is_active: boolean
  token_fresh: boolean
  token_updated_at: string | null
}

export type CopyStatus = "PENDING" | "PLACED" | "FAILED" | "SKIPPED"

export type CopyRow = {
  id: number
  master_order_id: string
  client_id: string
  tradingsymbol: string | null
  transaction_type: "BUY" | "SELL" | null
  quantity: number | null
  status: CopyStatus
  child_order_id: string | null
  error: string | null
  created_at: string
}

export type TickerState = "running" | "disconnected" | "stopped"

export type SafetySettings = SafetySettingsValues

export type Dashboard = {
  master: Account | null
  children: { total: number; active: number; active_with_token: number }
  today: { master_trades: number; placed: number; failed: number; skipped: number; pending: number }
  ticker: { state: TickerState; last_heartbeat: string | null }
  safety: SafetySettings
  dry_run: boolean
}

export type Settings = {
  master: {
    client_id: string
    api_key: string
    api_key_from_env: boolean
    api_secret_from_env: boolean
  } | null
  safety: SafetySettings
}
