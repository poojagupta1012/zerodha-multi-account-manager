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

// Kite Connect app credentials. Mirrors API_KEY_PATTERN in main.py.
const apiKey = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{6,64}$/, "Enter the API key shown on the Kite developer console")
const apiSecret = z.string().trim().max(128, "Too long")

// --- forms -------------------------------------------------------------------------

// Kite only lets the client ID an app is registered to log in through it, so
// every child brings its own Kite Connect app.
export const addAccountSchema = z.object({
  client_id: clientId,
  multiplier,
  api_key: apiKey,
  api_secret: apiSecret.min(6, "Enter the API secret"),
})
export type AddAccountValues = z.infer<typeof addAccountSchema>

// A blank secret keeps the stored one; the API rejects that if the key changed.
export const editAccountSchema = z.object({ multiplier, api_key: apiKey, api_secret: apiSecret })
export type EditAccountValues = z.infer<typeof editAccountSchema>

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

// An order for the master account. Mirrors OrderCreate in main.py.
export const EXCHANGES = ["NSE", "BSE", "NFO", "BFO", "MCX", "CDS", "BCD"] as const
export const PRODUCTS = ["CNC", "MIS", "NRML"] as const
export const ORDER_TYPES = ["MARKET", "LIMIT", "SL", "SL-M"] as const
export type OrderType = (typeof ORDER_TYPES)[number]

export const needsPrice = (t: OrderType) => t === "LIMIT" || t === "SL"
export const needsTrigger = (t: OrderType) => t === "SL" || t === "SL-M"

const optionalPrice = z.number({ error: "Enter a price" }).positive("Must be greater than 0").optional()

export const placeOrderSchema = z
  .object({
    exchange: z.enum(EXCHANGES),
    tradingsymbol: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9&_.-]{1,40}$/, "Enter a trading symbol such as INFY or NIFTY25NOV24000CE"),
    transaction_type: z.enum(["BUY", "SELL"]),
    quantity: z
      .number({ error: "Enter a quantity" })
      .int("Enter a whole number")
      .min(1, "Must be at least 1")
      .max(1_000_000, "Must be 1,000,000 or less"),
    product: z.enum(PRODUCTS),
    order_type: z.enum(ORDER_TYPES),
    variety: z.enum(["regular", "amo"]),
    price: optionalPrice,
    trigger_price: optionalPrice,
  })
  .superRefine((v, ctx) => {
    if (needsPrice(v.order_type) && v.price === undefined)
      ctx.addIssue({ code: "custom", path: ["price"], message: `${v.order_type} orders need a price` })
    if (needsTrigger(v.order_type) && v.trigger_price === undefined)
      ctx.addIssue({ code: "custom", path: ["trigger_price"], message: `${v.order_type} orders need a trigger price` })
  })
export type PlaceOrderValues = z.infer<typeof placeOrderSchema>

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
  // The account's own Kite app; false means it would use the backend .env app.
  has_own_app: boolean
  api_key: string | null
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

// A row of the master's Kite order book (GET /api/orders).
export type MasterOrder = {
  order_id: string
  order_timestamp: string | null // IST, "YYYY-MM-DD HH:MM:SS"
  exchange: string
  tradingsymbol: string
  transaction_type: "BUY" | "SELL"
  order_type: string
  product: string
  variety: string
  quantity: number
  filled_quantity: number
  price: number
  trigger_price: number
  average_price: number
  status: string // COMPLETE, OPEN, REJECTED, CANCELLED, TRIGGER PENDING, ...
  status_message: string | null
  tag: string | null
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
