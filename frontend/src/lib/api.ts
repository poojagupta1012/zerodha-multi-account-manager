import type {
  Account,
  AddAccountValues,
  CopyRow,
  Dashboard,
  MasterSettingsValues,
  SafetySettings,
  SafetySettingsValues,
  Settings,
} from "@/lib/schemas"

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "")

// The backend's optional ADMIN_TOKEN, entered once on the Settings page and
// kept in this browser only. Storage can throw (private mode, blocked site
// data), so every access is guarded.
const ADMIN_TOKEN_KEY = "admin_token"

export function getAdminToken(): string {
  try {
    return window.localStorage.getItem(ADMIN_TOKEN_KEY) ?? ""
  } catch {
    return ""
  }
}

export function setAdminToken(token: string): void {
  try {
    if (token) window.localStorage.setItem(ADMIN_TOKEN_KEY, token)
    else window.localStorage.removeItem(ADMIN_TOKEN_KEY)
  } catch {
    // Not persisted; requests will go out without a token.
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set("Content-Type", "application/json")
  const token = getAdminToken()
  if (token) headers.set("X-Admin-Token", token)

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, `Cannot reach the backend at ${API_URL}. Is uvicorn running?`)
  }

  if (!res.ok) {
    // FastAPI errors are {"detail": "..."} or, for validation, {"detail": [{msg}]}.
    let message = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (typeof body.detail === "string") message = body.detail
      else if (Array.isArray(body.detail)) message = body.detail.map((d: { msg: string }) => d.msg).join("; ")
    } catch {
      // Non-JSON error body; keep the status line.
    }
    if (res.status === 401) message = "Admin token missing or wrong. Set it on the Settings page."
    throw new ApiError(res.status, message)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

export const api = {
  dashboard: () => request<Dashboard>("/api/dashboard"),
  accounts: () => request<Account[]>("/api/accounts"),
  createAccount: (body: AddAccountValues) => request<Account>("/api/accounts", json("POST", body)),
  updateAccount: (clientId: string, body: { multiplier?: number; is_active?: boolean }) =>
    request<Account>(`/api/accounts/${encodeURIComponent(clientId)}`, json("PATCH", body)),
  deleteAccount: (clientId: string) =>
    request<void>(`/api/accounts/${encodeURIComponent(clientId)}`, { method: "DELETE" }),
  copies: (limit = 200) => request<CopyRow[]>(`/api/copies?limit=${limit}`),
  settings: () => request<Settings>("/api/settings"),
  saveMaster: (body: MasterSettingsValues) =>
    request<Settings>("/api/settings/master", json("PUT", {
      client_id: body.client_id,
      api_key: body.api_key || null,
      api_secret: body.api_secret || null,
    })),
  saveSafety: (body: SafetySettingsValues) =>
    request<SafetySettings>("/api/settings/safety", json("PUT", body)),
}

/**
 * Backend URL that starts the Kite OAuth flow for `clientId`. This is a full
 * page navigation (Kite's login page can't be framed or fetched), so the admin
 * token has to travel as a query parameter rather than a header.
 */
export function kiteLoginUrl(clientId: string): string {
  const params = new URLSearchParams({ client_id: clientId })
  const token = getAdminToken()
  if (token) params.set("admin_token", token)
  return `${API_URL}/login?${params}`
}
