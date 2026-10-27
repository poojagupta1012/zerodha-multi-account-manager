"""
SQLite persistence for accounts, daily access tokens, and the copy-trade log.

Kite access tokens expire every day at ~6 AM IST, so the morning OAuth login
(main.py) writes a fresh token here and the ticker/copier read it back. Tokens
and per-account API secrets are encrypted at rest with Fernet so a leaked
.db file alone cannot be used to trade.

Raw sqlite3 is used with one short-lived connection per operation: the copier
runs in many threads, and sqlite3 connections must not be shared across
threads. WAL mode lets the web server, ticker, and copier threads read and
write concurrently without "database is locked" errors.
"""

import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from typing import Iterator, Optional

from cryptography.fernet import Fernet, InvalidToken

import config

IST = timezone(timedelta(hours=5, minutes=30))
# Kite invalidates every access token at roughly 06:00 IST each day.
TOKEN_EXPIRY_TIME_IST = time(6, 0)

_fernet = Fernet(config.TOKEN_ENCRYPTION_KEY.encode())

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    client_id        TEXT PRIMARY KEY,
    access_token     TEXT,                 -- Fernet-encrypted; NULL until first login
    role             TEXT NOT NULL CHECK (role IN ('master', 'child')),
    multiplier       REAL NOT NULL DEFAULT 1.0 CHECK (multiplier >= 0),
    is_active        INTEGER NOT NULL DEFAULT 1,
    api_key          TEXT,                 -- optional per-account Kite app key
    api_secret       TEXT,                 -- optional, Fernet-encrypted
    token_updated_at TEXT                  -- ISO timestamp (IST) of last login
);

-- Exactly one master account is allowed.
CREATE UNIQUE INDEX IF NOT EXISTS one_master
    ON accounts(role) WHERE role = 'master';

-- One row per (master order, child account). The UNIQUE constraint is the
-- idempotency guard: if the ticker reconnects and Kite replays an order
-- update, the second INSERT fails and the child order is not placed twice.
CREATE TABLE IF NOT EXISTS copy_log (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    master_order_id  TEXT NOT NULL,
    client_id        TEXT NOT NULL,
    tradingsymbol    TEXT,
    transaction_type TEXT,
    quantity         INTEGER,
    status           TEXT NOT NULL,       -- PENDING | PLACED | FAILED | SKIPPED
    child_order_id   TEXT,
    error            TEXT,
    created_at       TEXT NOT NULL,
    UNIQUE (master_order_id, client_id)
);
"""


@dataclass(frozen=True)
class Account:
    client_id: str
    role: str
    multiplier: float
    is_active: bool
    access_token: Optional[str]  # decrypted
    api_key: str                 # per-account key or the global default
    api_secret: str              # decrypted per-account secret or global default
    token_updated_at: Optional[datetime]

    @property
    def has_fresh_token(self) -> bool:
        return self.access_token is not None and is_token_fresh(self.token_updated_at)


# --- helpers -------------------------------------------------------------------

def _encrypt(value: Optional[str]) -> Optional[str]:
    return _fernet.encrypt(value.encode()).decode() if value else None


def _decrypt(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        return _fernet.decrypt(value.encode()).decode()
    except InvalidToken:
        # Encryption key was rotated; treat as missing so the user re-logs in.
        return None


def now_ist() -> datetime:
    return datetime.now(IST)


def last_token_expiry(now: Optional[datetime] = None) -> datetime:
    """Most recent 06:00 IST at or before `now`."""
    now = now or now_ist()
    expiry = now.replace(
        hour=TOKEN_EXPIRY_TIME_IST.hour, minute=0, second=0, microsecond=0
    )
    return expiry if now >= expiry else expiry - timedelta(days=1)


def is_token_fresh(updated_at: Optional[datetime], now: Optional[datetime] = None) -> bool:
    """A token is usable only if it was issued after the latest 6 AM reset."""
    return updated_at is not None and updated_at >= last_token_expiry(now)


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _row_to_account(row: sqlite3.Row) -> Account:
    updated = row["token_updated_at"]
    return Account(
        client_id=row["client_id"],
        role=row["role"],
        multiplier=row["multiplier"],
        is_active=bool(row["is_active"]),
        access_token=_decrypt(row["access_token"]),
        api_key=row["api_key"] or config.KITE_API_KEY,
        api_secret=_decrypt(row["api_secret"]) or config.KITE_API_SECRET,
        token_updated_at=datetime.fromisoformat(updated) if updated else None,
    )


# --- schema ------------------------------------------------------------------------

def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA)


# --- accounts ----------------------------------------------------------------------

def upsert_account(
    client_id: str,
    role: str,
    multiplier: float = 1.0,
    api_key: Optional[str] = None,
    api_secret: Optional[str] = None,
) -> None:
    """Register an account (or update its settings). Does not touch the token."""
    client_id = client_id.strip().upper()
    if role not in ("master", "child"):
        raise ValueError("role must be 'master' or 'child'")
    if multiplier < 0:
        raise ValueError("multiplier must be >= 0")
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO accounts (client_id, role, multiplier, api_key, api_secret)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(client_id) DO UPDATE SET
                role       = excluded.role,
                multiplier = excluded.multiplier,
                api_key    = COALESCE(excluded.api_key, accounts.api_key),
                api_secret = COALESCE(excluded.api_secret, accounts.api_secret)
            """,
            (client_id, role, multiplier, api_key, _encrypt(api_secret)),
        )


def get_account(client_id: str) -> Optional[Account]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM accounts WHERE client_id = ?", (client_id.strip().upper(),)
        ).fetchone()
    return _row_to_account(row) if row else None


def get_master() -> Optional[Account]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM accounts WHERE role = 'master'").fetchone()
    return _row_to_account(row) if row else None


def get_active_children() -> list[Account]:
    """Active child accounts with a positive multiplier (token freshness is
    checked by the caller so it can log which accounts were skipped)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM accounts WHERE role = 'child' AND is_active = 1 AND multiplier > 0"
        ).fetchall()
    return [_row_to_account(r) for r in rows]


def list_accounts() -> list[Account]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM accounts ORDER BY role DESC, client_id").fetchall()
    return [_row_to_account(r) for r in rows]


def save_access_token(client_id: str, access_token: str) -> None:
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE accounts SET access_token = ?, token_updated_at = ? WHERE client_id = ?",
            (_encrypt(access_token), now_ist().isoformat(), client_id.strip().upper()),
        )
        if cur.rowcount == 0:
            raise KeyError(f"Unknown client_id {client_id}")


def set_active(client_id: str, active: bool) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE accounts SET is_active = ? WHERE client_id = ?",
            (int(active), client_id.strip().upper()),
        )


def set_multiplier(client_id: str, multiplier: float) -> None:
    if multiplier < 0:
        raise ValueError("multiplier must be >= 0")
    with get_conn() as conn:
        conn.execute(
            "UPDATE accounts SET multiplier = ? WHERE client_id = ?",
            (multiplier, client_id.strip().upper()),
        )


def delete_account(client_id: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM accounts WHERE client_id = ?", (client_id.strip().upper(),))


# --- copy log ----------------------------------------------------------------------

def claim_copy(master_order_id: str, client_id: str, tradingsymbol: str,
               transaction_type: str, quantity: int) -> bool:
    """
    Atomically reserve the right to copy `master_order_id` into `client_id`.
    Returns False if this pair was already handled (duplicate order update).
    """
    try:
        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO copy_log (master_order_id, client_id, tradingsymbol,
                                      transaction_type, quantity, status, created_at)
                VALUES (?, ?, ?, ?, ?, 'PENDING', ?)
                """,
                (master_order_id, client_id, tradingsymbol, transaction_type,
                 quantity, now_ist().isoformat()),
            )
        return True
    except sqlite3.IntegrityError:
        return False


def finish_copy(master_order_id: str, client_id: str, status: str,
                child_order_id: Optional[str] = None, error: Optional[str] = None) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE copy_log SET status = ?, child_order_id = ?, error = ?
            WHERE master_order_id = ? AND client_id = ?
            """,
            (status, child_order_id, error, master_order_id, client_id),
        )


def recent_copies(limit: int = 50) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM copy_log ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]
