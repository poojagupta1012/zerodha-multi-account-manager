"""
FastAPI server handling the daily Kite Connect OAuth login for every account.

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

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from kiteconnect import KiteConnect
from kiteconnect.exceptions import KiteException

import config
import db

config.setup_logging()
log = logging.getLogger("auth")


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Zerodha Multi-Account Manager", lifespan=lifespan)


def _check_admin(admin_token: Optional[str]) -> None:
    """Protects the account-facing endpoints when ADMIN_TOKEN is configured."""
    if config.ADMIN_TOKEN and not hmac.compare_digest(admin_token or "", config.ADMIN_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing admin_token")


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


@app.get("/accounts")
def accounts(admin_token: Optional[str] = None):
    """Token status for every account, so you can see who still needs to log in."""
    _check_admin(admin_token)
    return [
        {
            "client_id": a.client_id,
            "role": a.role,
            "multiplier": a.multiplier,
            "is_active": a.is_active,
            "token_fresh": a.has_fresh_token,
            "token_updated_at": a.token_updated_at.isoformat() if a.token_updated_at else None,
        }
        for a in db.list_accounts()
    ]


@app.get("/copies")
def copies(limit: int = 50, admin_token: Optional[str] = None):
    """Most recent copy-trade results."""
    _check_admin(admin_token)
    return db.recent_copies(limit)


@app.get("/health")
def health():
    return {"ok": True}
