"""
Central configuration, loaded once from environment variables / .env.

Every other module imports from here so there is exactly one place where
settings are read and validated.
"""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def _require(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(
            f"Missing required environment variable {name}. "
            f"Copy .env.example to .env and fill it in."
        )
    return value


# --- Kite Connect app credentials -------------------------------------------
# These belong to the Kite Connect *app* registered at developers.kite.trade.
# Individual accounts may override them with their own api_key/api_secret in
# the DB (see db.py) because Zerodha only lets a client log in to an app they
# are authorised for.
KITE_API_KEY = _require("KITE_API_KEY")
KITE_API_SECRET = _require("KITE_API_SECRET")

# Fernet key used to encrypt access tokens and per-account API secrets at rest.
# Generate one with:  python manage.py gen-key
TOKEN_ENCRYPTION_KEY = _require("TOKEN_ENCRYPTION_KEY")

# --- Storage -----------------------------------------------------------------
DB_PATH = Path(os.getenv("DB_PATH", BASE_DIR / "accounts.db"))

# --- Execution engine ----------------------------------------------------------
# Upper bound on simultaneous child order requests. Kite allows ~10 order
# requests/second per API key, so keep this <= 10 when children share a key.
MAX_WORKERS = int(os.getenv("MAX_WORKERS", "10"))

# Tag attached to every child order (Kite limit: 20 alphanumeric chars). Makes
# copied orders easy to spot in the order book and in postbacks.
COPY_ORDER_TAG = os.getenv("COPY_ORDER_TAG", "COPYTRADE")[:20]

# If true, LIMIT/SL master orders are copied as MARKET orders. The master
# order is already COMPLETE when we see it, so the market may have moved past
# the master's limit price and a LIMIT child order might never fill.
FORCE_MARKET_ORDERS = os.getenv("FORCE_MARKET_ORDERS", "false").lower() == "true"

# Set to true to log what would be placed without sending orders to Kite.
DRY_RUN = os.getenv("DRY_RUN", "false").lower() == "true"

# --- Web server ------------------------------------------------------------------
# Optional shared secret required as ?admin_token=... on /login and /accounts.
# Leave empty only when the server is bound to localhost.
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "").strip()

# Admin UI (frontend/). After a Kite login the callback sends the browser back
# here; set it to an empty string to show a plain confirmation page instead.
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")

# Browser origins allowed to call the JSON API (comma-separated).
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", FRONTEND_URL).split(",") if o.strip()]

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()


def setup_logging() -> None:
    logging.basicConfig(
        level=LOG_LEVEL,
        format="%(asctime)s %(levelname)-7s [%(threadName)s] %(name)s: %(message)s",
    )
