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
| `db.py` | SQLite: `accounts` (encrypted tokens, role, multiplier) and `copy_log` (idempotency + audit) |
| `main.py` | FastAPI: `/login`, `/api/callback`, plus `/accounts`, `/copies`, `/health` |
| `ticker.py` | KiteTicker listener for the master's order updates and filtering |
| `copier.py` | Quantity scaling and parallel child order placement |
| `manage.py` | CLI to add, list, and edit accounts |

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py gen-key        # paste into TOKEN_ENCRYPTION_KEY in .env
```

In your Kite Connect app on developers.kite.trade, set the **Redirect URL** to
`http://127.0.0.1:8000/api/callback`.

Register accounts:

```bash
python manage.py add AB1234 --role master
python manage.py add CD5678 --role child --multiplier 0.5
python manage.py add EF9012 --role child --multiplier 2
python manage.py list
```

## Daily routine (tokens expire at 6 AM IST)

1. `uvicorn main:app --host 127.0.0.1 --port 8000`
2. Each account holder opens `http://127.0.0.1:8000/login?client_id=<ID>` and logs in.
   (Add `&admin_token=...` if `ADMIN_TOKEN` is set.)
3. Check `python manage.py list`: every account should show `fresh`.
4. `python ticker.py`. Start it **after** the master logs in, and restart it each day.
5. Watch results with `python manage.py log` or `GET /copies`.

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

- **Kite app access:** a Kite Connect app only accepts logins from client IDs
  authorised for it. If a child can't log in with the shared app, give that account
  its own app with `manage.py add ID --role child --api-key K --api-secret S`.
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
