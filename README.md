# Zerodha Multi-Account Manager (Copy Trading)

Mirrors every completed order in a **master** Zerodha account into any number of
**child** accounts, scaled by a per-child multiplier, using Kite Connect.

```
 browser ──/login──▶ main.py (FastAPI) ──OAuth──▶ Kite ──access_token──▶ accounts.db
                                                                            │
 master places order ──▶ Kite WebSocket ──on_order_update──▶ ticker.py      │
                                                         │ COMPLETE only    │
                                                         ▼                  │
                                              copier.py ◀── children ───────┘
                                    ThreadPoolExecutor ──▶ place_order × N (parallel)
```

| File | Role |
|---|---|
| `config.py` | Loads `.env` settings |
| `db.py` | SQLite: `accounts` (encrypted tokens, role, multiplier), `copy_log` (idempotency + audit), `settings` (safety limits, ticker heartbeat) |
| `main.py` | FastAPI: `/login`, `/api/callback`, and the `/api/*` JSON API used by the admin UI |
| `ticker.py` | KiteTicker listener for the master's order updates and filtering |
| `copier.py` | Quantity scaling and parallel child order placement |
| `manage.py` | CLI to add, list, and edit accounts |
| `frontend/` | Admin UI (Next.js): dashboard, child accounts, settings. See [Admin UI](#admin-ui) |

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py gen-key        # paste into TOKEN_ENCRYPTION_KEY in .env
```

Kite only lets the client ID an app is registered to log in through it, so
**every account needs its own Kite Connect app** on developers.kite.trade:

- The master's app goes in `KITE_API_KEY` / `KITE_API_SECRET` in `.env`. It must be
  on the paid Connect plan, since the ticker uses Kite's WebSocket.
- Each child gets its own app, which can be created from the master's developer
  account: set the app's **Zerodha Client ID** to the child's ID. The free
  Personal plan is enough, since children only place orders. Its key and secret
  are entered when adding the child in the UI, and the secret is stored encrypted.

On every app, set the **Redirect URL** to `http://127.0.0.1:8000/api/callback`
and register your static public IP.

Register accounts from the UI, or with:

```bash
python manage.py add AB1234 --role master
python manage.py add CD5678 --role child --multiplier 0.5 --api-key K --api-secret S
python manage.py list
```

## Admin UI

```bash
cd frontend
npm install
cp .env.example .env.local      # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                     # http://localhost:3000
```

Requires Node 20.19+ (shadcn and ESLint warn on older 20.x). Built with Next.js 16
(App Router), React 19, Tailwind CSS v4, shadcn/ui on Base UI, React Hook Form + Zod,
TanStack Query and TanStack Table v9.

- **Dashboard:** master token status with a *Login to Kite* button, ticker status,
  today's counts, and a live feed (refreshes every 5s) of each master trade with
  the result in every child account. Hover a child badge to see its order ID or error.
- **Orders:** place an order in the master account (market, limit, SL, SL-M; CNC,
  MIS or NRML; optionally AMO) after a confirmation step, and follow today's master
  order book from Kite. Completed orders are copied like any other master trade.
  The master order is always real: `DRY_RUN` only affects the child copies.
  Market and SL-M orders use Kite's automatic market protection.
- **Child Accounts:** add (with the child's own Kite app key and secret, then
  straight into that client's Kite login), edit the multiplier or app credentials,
  pause/resume, log in again, delete.
- **Settings:** register the master and its own Kite app key/secret (the secret is
  write-only), the copy-trading kill switch, and **max quantity per trade**. A child
  order above the limit is blocked and logged as `SKIPPED`, not reduced.
  Limits apply from the next trade without restarting the ticker.

After a Kite login the backend redirects to `FRONTEND_URL` (default
`http://localhost:3000`). Set `FRONTEND_URL=` (empty) to get the plain confirmation
page instead. If `ADMIN_TOKEN` is set, enter it under *Settings → Backend access*;
it is kept in that browser's localStorage.

## Daily routine (tokens expire at 6 AM IST)

1. `uvicorn main:app --host 127.0.0.1 --port 8000` (and `npm run dev` in `frontend/`).
2. Each account holder logs in, via *Login to Kite* in the UI or by opening
   `http://127.0.0.1:8000/login?client_id=<ID>` (add `&admin_token=...` if
   `ADMIN_TOKEN` is set).
3. Check that every account shows *Token active* (or `python manage.py list`).
4. `python ticker.py`. Start it **after** the master logs in, and restart it each day.
   The dashboard shows *Ticker running* while its heartbeat is fresh.
5. Watch results on the dashboard, with `python manage.py log`, or `GET /copies`.

Try `DRY_RUN=true` first to see exactly what would be placed without sending orders.

## Copy rules

- Only master updates with status `COMPLETE` and filled quantity > 0 are copied.
  Duplicates are ignored, both in memory and via a unique `(master_order_id, client_id)` row.
- `child_qty = int(filled_qty × multiplier)`. Children with a result below 1 are skipped.
  On **NFO/BFO**, the quantity is rounded down to a whole lot, because Kite rejects
  non-lot-multiple quantities there.
- MARKET → MARKET. LIMIT → LIMIT at the master's price (or MARKET with
  `FORCE_MARKET_ORDERS=true`). SL-M → MARKET and SL → LIMIT, because the trigger has
  already fired. CO/iceberg orders → `regular`.
- Child orders carry the `COPY_ORDER_TAG` tag. Master orders are copied one at a time
  in sequence; within each one, the child orders go out in parallel.
- Each child order is isolated: a margin rejection on one account is logged as
  `FAILED` in `copy_log` and the others continue.

## Known limitations and things to check before going live

- **Kite app access:** a Kite Connect app only accepts logins from the client ID it
  is registered to ("The user is not enabled for the app"), so each child must have
  its own app. Changing a child's API key clears its login.
- **Regulation:** SEBI's retail algo framework and Zerodha's API rules (static-IP
  whitelisting for order APIs, order-rate limits, and restrictions on trading
  accounts that aren't yours or your family's) apply. Confirm compliance before
  running this on other people's accounts.
- **Rate limits:** Kite allows about 10 orders/sec per API key. Keep `MAX_WORKERS`
  at 10 or below when children share a key.
- An order that partially fills and is then **cancelled** never reaches `COMPLETE`, so
  it is not copied. Master exits are copied as plain orders, so children with failed
  entries can end up with a short or unintended position on exit.
- A LIMIT child order may not fill if the price has moved since the master's fill.
- If the master logs in again elsewhere, the ticker's token is invalidated. Re-login
  via `/login` and restart `ticker.py`.

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```
