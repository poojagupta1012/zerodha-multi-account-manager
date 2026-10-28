"""
FastAPI server: daily Kite Connect OAuth login for every account, plus the
JSON API used by the admin UI in frontend/.

Kite login flow (https://kite.trade/docs/connect/v3/user/):
  1. Send the user to https://kite.zerodha.com/connect/login?v=3&api_key=...
  2. After they log in (password + TOTP), Kite redirects the browser to the
     app's registered "Redirect URL" with ?request_token=...&status=success.
  3. The server exchanges request_token + api_secret for an access_token
     (kite.generate_session). The request_token is single-use and short-lived.
  4. The access_token is valid until ~6 AM IST the next day.

Run:  uvicorn main:app --host 127.0.0.1 --port 8000
Set the app's Redirect URL on developers.kite.trade to
      http://127.0.0.1:8000/api/callback
"""

import hmac
import logging
from contextlib import asynccontextmanager
from typing import Optional
from urllib.parse import urlencode

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
from kiteconnect import KiteConnect
from kiteconnect.exceptions import KiteException
from pydantic import BaseModel, Field, field_validator

import config
import db

config.setup_logging()
log = logging.getLogger("auth")

CLIENT_ID_PATTERN = r"^[A-Za-z]{2,4}[0-9]{3,6}$"  # Zerodha IDs look like AB1234


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Zerodha Multi-Account Manager", lifespan=lifespan)

# The admin UI runs on its own origin (Next.js on :3000 in development).
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
    allow_headers=["Content-Type", "X-Admin-Token"],
)


def _check_admin(admin_token: Optional[str]) -> None:
    """Protects the account-facing endpoints when ADMIN_TOKEN is configured."""
    if config.ADMIN_TOKEN and not hmac.compare_digest(admin_token or "", config.ADMIN_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing admin_token")


def require_admin(
    x_admin_token: Optional[str] = Header(None),
    admin_token: Optional[str] = None,
) -> None:
    """API dependency: the UI sends the token as an X-Admin-Token header;
    ?admin_token= still works for curl."""
    _check_admin(x_admin_token or admin_token)


def _account_json(a: db.Account) -> dict:
    return {
        "client_id": a.client_id,
        "role": a.role,
        "multiplier": a.multiplier,
        "is_active": a.is_active,
        "token_fresh": a.has_fresh_token,
        "token_updated_at": a.token_updated_at.isoformat() if a.token_updated_at else None,
    }


# --- Kite login ------------------------------------------------------------------

@app.get("/login")
def login(
    client_id: str = Query(..., description="Zerodha client ID, e.g. AB1234"),
    admin_token: Optional[str] = None,
):
    """Redirects the browser to the Kite login page for `client_id`."""
    _check_admin(admin_token)
    account = db.get_account(client_id)
    if account is None:
        # Only pre-registered accounts may log in (see `python manage.py add`).
        raise HTTPException(status_code=404, detail=f"Account {client_id} is not registered")

    kite = KiteConnect(api_key=account.api_key)

    # Kite echoes back anything in `redirect_params` as extra query params on
    # the redirect URL. We use it to remember which client_id this login was
    # for, since the callback otherwise only receives the request_token.
    url = f"{kite.login_url()}&{urlencode({'redirect_params': urlencode({'client_id': account.client_id})})}"
    log.info("Redirecting %s to Kite login", account.client_id)
    return RedirectResponse(url)


@app.get("/api/callback", response_class=HTMLResponse)
def callback(
    request_token: Optional[str] = None,
    status: Optional[str] = None,
    client_id: Optional[str] = None,  # comes back via redirect_params
):
    """Kite redirect target: exchange request_token for an access_token."""
    if status != "success" or not request_token:
        raise HTTPException(status_code=400, detail=f"Kite login failed (status={status})")
    if not client_id:
        raise HTTPException(status_code=400, detail="Missing client_id; start from /login")

    account = db.get_account(client_id)
    if account is None:
        raise HTTPException(status_code=404, detail=f"Account {client_id} is not registered")

    kite = KiteConnect(api_key=account.api_key)
    try:
        # generate_session computes SHA-256(api_key + request_token + api_secret)
        # as the checksum and POSTs it to /session/token.
        session = kite.generate_session(request_token, api_secret=account.api_secret)
    except KiteException as exc:
        log.error("Token exchange failed for %s: %s", client_id, exc)
        raise HTTPException(status_code=502, detail=f"Kite token exchange failed: {exc}")

    # The session response says which Zerodha user actually logged in. If
    # someone opened /login?client_id=A but logged in as B, refuse to store
    # B's token under A, otherwise orders would go to the wrong account.
    logged_in_user = session.get("user_id", "").upper()
    if logged_in_user != account.client_id:
        log.warning("Login mismatch: expected %s, got %s", account.client_id, logged_in_user)
        raise HTTPException(
            status_code=400,
            detail=f"Logged in as {logged_in_user}, but this link was for {account.client_id}",
        )

    db.save_access_token(account.client_id, session["access_token"])
    log.info("Stored fresh access token for %s (%s)", account.client_id, account.role)

    if config.FRONTEND_URL:
        # Back to the admin UI, which shows a "logged in" toast.
        page = "/" if account.role == "master" else "/accounts"
        return RedirectResponse(f"{config.FRONTEND_URL}{page}?{urlencode({'logged_in': account.client_id})}")

    note = (
        "<p>This is the <b>master</b> account. Restart the ticker "
        "(<code>python ticker.py</code>) to pick up the new token.</p>"
        if account.role == "master" else ""
    )
    return f"""
        <html><body style="font-family: sans-serif; max-width: 40em; margin: 3em auto">
        <h2>Logged in: {account.client_id}</h2>
        <p>Access token saved. It is valid until 6 AM IST tomorrow.</p>{note}
        </body></html>
    """


# --- JSON API for the admin UI -----------------------------------------------------

class AccountCreate(BaseModel):
    client_id: str = Field(pattern=CLIENT_ID_PATTERN)
    multiplier: float = Field(gt=0, le=100)

    @field_validator("client_id")
    @classmethod
    def upper(cls, v: str) -> str:
        return v.strip().upper()


class AccountUpdate(BaseModel):
    multiplier: Optional[float] = Field(default=None, gt=0, le=100)
    is_active: Optional[bool] = None


class MasterSettings(BaseModel):
    client_id: str = Field(pattern=CLIENT_ID_PATTERN)
    api_key: Optional[str] = Field(default=None, max_length=64)
    api_secret: Optional[str] = Field(default=None, max_length=128)  # blank = keep current


class SafetySettings(BaseModel):
    copy_enabled: bool
    max_quantity_per_trade: int = Field(ge=0, le=1_000_000)


def _get_child(client_id: str) -> db.Account:
    account = db.get_account(client_id)
    if account is None:
        raise HTTPException(status_code=404, detail=f"Account {client_id} not found")
    if account.role != "child":
        raise HTTPException(status_code=409, detail=f"{account.client_id} is the master account")
    return account


@app.get("/api/dashboard", dependencies=[Depends(require_admin)])
def api_dashboard():
    master = db.get_master()
    children = [a for a in db.list_accounts() if a.role == "child"]
    active = [c for c in children if c.is_active and c.multiplier > 0]
    return {
        "master": _account_json(master) if master else None,
        "children": {
            "total": len(children),
            "active": len(active),
            "active_with_token": sum(c.has_fresh_token for c in active),
        },
        "today": db.copy_stats_today(),
        "ticker": db.ticker_status(),
        "safety": db.get_safety_settings(),
        "dry_run": config.DRY_RUN,
    }


@app.get("/api/accounts", dependencies=[Depends(require_admin)])
def api_list_accounts():
    return [_account_json(a) for a in db.list_accounts()]


@app.post("/api/accounts", status_code=201, dependencies=[Depends(require_admin)])
def api_create_account(body: AccountCreate):
    if db.get_account(body.client_id):
        raise HTTPException(status_code=409, detail=f"{body.client_id} is already registered")
    db.upsert_account(body.client_id, "child", body.multiplier)
    log.info("Added child %s (multiplier %g) via API", body.client_id, body.multiplier)
    return _account_json(db.get_account(body.client_id))


@app.patch("/api/accounts/{client_id}", dependencies=[Depends(require_admin)])
def api_update_account(client_id: str, body: AccountUpdate):
    account = _get_child(client_id)
    if body.multiplier is not None:
        db.set_multiplier(account.client_id, body.multiplier)
    if body.is_active is not None:
        db.set_active(account.client_id, body.is_active)
    return _account_json(db.get_account(account.client_id))


@app.delete("/api/accounts/{client_id}", status_code=204, dependencies=[Depends(require_admin)])
def api_delete_account(client_id: str):
    account = _get_child(client_id)
    db.delete_account(account.client_id)
    log.info("Removed child %s via API", account.client_id)


@app.get("/api/copies", dependencies=[Depends(require_admin)])
def api_copies(limit: int = Query(100, ge=1, le=1000)):
    return db.recent_copies(limit)


@app.get("/api/settings", dependencies=[Depends(require_admin)])
def api_get_settings():
    master = db.get_master()
    overridden = db.master_credentials_overridden()
    return {
        "master": {
            "client_id": master.client_id,
            # Only the key is shown; the secret is write-only.
            "api_key": master.api_key,
            "api_key_from_env": not overridden["api_key"],
            "api_secret_from_env": not overridden["api_secret"],
        } if master else None,
        "safety": db.get_safety_settings(),
    }


@app.put("/api/settings/master", dependencies=[Depends(require_admin)])
def api_save_master(body: MasterSettings):
    client_id = body.client_id.strip().upper()
    master = db.get_master()
    if master is None:
        existing = db.get_account(client_id)
        if existing is not None:
            raise HTTPException(status_code=409,
                                detail=f"{client_id} is registered as a child; remove it first")
        db.upsert_account(client_id, "master", 1.0)
        log.info("Registered master %s via API", client_id)
    elif master.client_id != client_id:
        raise HTTPException(
            status_code=409,
            detail=f"{master.client_id} is already the master. "
                   f"Change it with: python manage.py remove {master.client_id}",
        )
    db.set_master_credentials(body.api_key, body.api_secret)
    return api_get_settings()


@app.put("/api/settings/safety", dependencies=[Depends(require_admin)])
def api_save_safety(body: SafetySettings):
    db.save_safety_settings(body.copy_enabled, body.max_quantity_per_trade)
    log.info("Safety settings updated: %s", body.model_dump())
    return db.get_safety_settings()


# --- legacy endpoints (kept for curl / scripts) -----------------------------------------

@app.get("/accounts")
def accounts(admin_token: Optional[str] = None):
    """Token status for every account, so you can see who still needs to log in."""
    _check_admin(admin_token)
    return [_account_json(a) for a in db.list_accounts()]


@app.get("/copies")
def copies(limit: int = 50, admin_token: Optional[str] = None):
    """Most recent copy-trade results."""
    _check_admin(admin_token)
    return db.recent_copies(limit)


@app.get("/health")
def health():
    return {"ok": True}
