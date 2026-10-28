"""Calls the route functions directly, so no HTTP test client is needed."""

from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

import db
import main


@pytest.fixture(autouse=True)
def master():
    db.upsert_account("AB1234", "master")


def fake_session(user_id, secret="test_secret"):
    def generate_session(self, request_token, api_secret):
        assert request_token == "rt" and api_secret == secret
        return {"user_id": user_id, "access_token": "fresh-token"}
    return generate_session


def test_login_redirects_with_client_id_in_redirect_params():
    resp = main.login(client_id="ab1234", admin_token=None)
    qs = parse_qs(urlparse(resp.headers["location"]).query)
    assert qs["api_key"] == ["test_key"]
    assert parse_qs(qs["redirect_params"][0]) == {"client_id": ["AB1234"]}


def test_login_unknown_account():
    with pytest.raises(HTTPException) as e:
        main.login(client_id="XX0000", admin_token=None)
    assert e.value.status_code == 404


def test_callback_saves_token_and_returns_to_ui(monkeypatch):
    monkeypatch.setattr(main.KiteConnect, "generate_session", fake_session("AB1234"))
    resp = main.callback(request_token="rt", status="success", client_id="AB1234")
    assert resp.headers["location"] == f"{main.config.FRONTEND_URL}/?logged_in=AB1234"
    acct = db.get_account("AB1234")
    assert acct.access_token == "fresh-token" and acct.has_fresh_token


def test_callback_html_page_without_frontend(monkeypatch):
    monkeypatch.setattr(main.config, "FRONTEND_URL", "")
    monkeypatch.setattr(main.KiteConnect, "generate_session", fake_session("AB1234"))
    assert "AB1234" in main.callback(request_token="rt", status="success", client_id="AB1234")


def test_callback_rejects_token_for_wrong_user(monkeypatch):
    monkeypatch.setattr(main.KiteConnect, "generate_session", fake_session("ZZ9999"))
    with pytest.raises(HTTPException) as e:
        main.callback(request_token="rt", status="success", client_id="AB1234")
    assert e.value.status_code == 400
    assert db.get_account("AB1234").access_token is None


def test_callback_failed_login():
    with pytest.raises(HTTPException) as e:
        main.callback(request_token=None, status="error", client_id=None)
    assert e.value.status_code == 400


def test_admin_token_enforced(monkeypatch):
    monkeypatch.setattr(main.config, "ADMIN_TOKEN", "s3cret")
    with pytest.raises(HTTPException) as e:
        main.accounts(admin_token=None)
    assert e.value.status_code == 401
    assert main.accounts(admin_token="s3cret")[0]["client_id"] == "AB1234"


def test_require_admin_accepts_header(monkeypatch):
    monkeypatch.setattr(main.config, "ADMIN_TOKEN", "s3cret")
    main.require_admin(x_admin_token="s3cret", admin_token=None)
    with pytest.raises(HTTPException):
        main.require_admin(x_admin_token="nope", admin_token=None)


# --- admin UI API --------------------------------------------------------------------

def new_child(client_id="cd5678", multiplier=0.5, **kw):
    body = {"api_key": "childkey1", "api_secret": "childsecret1", **kw}
    return main.api_create_account(main.AccountCreate(client_id=client_id, multiplier=multiplier, **body))


def test_create_update_delete_child():
    created = new_child()
    assert created == {**created, "client_id": "CD5678", "role": "child", "token_fresh": False,
                       "has_own_app": True, "api_key": "childkey1"}
    assert "childsecret1" not in str(created)
    assert db.get_account("CD5678").api_secret == "childsecret1"

    with pytest.raises(HTTPException) as e:
        new_child("CD5678", 1)
    assert e.value.status_code == 409

    updated = main.api_update_account("CD5678", main.AccountUpdate(multiplier=2, is_active=False))
    assert updated["multiplier"] == 2 and updated["is_active"] is False

    main.api_delete_account("CD5678")
    assert db.get_account("CD5678") is None


def test_child_routes_refuse_master():
    with pytest.raises(HTTPException) as e:
        main.api_delete_account("AB1234")
    assert e.value.status_code == 409
    assert db.get_account("AB1234") is not None


def test_account_validation():
    keys = {"api_key": "childkey1", "api_secret": "childsecret1"}
    with pytest.raises(ValueError):
        main.AccountCreate(client_id="not an id", multiplier=1, **keys)
    with pytest.raises(ValueError):
        main.AccountCreate(client_id="CD5678", multiplier=0, **keys)
    with pytest.raises(ValueError):  # a child must bring its own Kite app
        main.AccountCreate(client_id="CD5678", multiplier=1)
    with pytest.raises(ValueError):
        main.AccountCreate(client_id="CD5678", multiplier=1, api_key="bad key!", api_secret="childsecret1")


def test_child_login_uses_its_own_app(monkeypatch):
    new_child()
    qs = parse_qs(urlparse(main.login(client_id="CD5678", admin_token=None).headers["location"]).query)
    assert qs["api_key"] == ["childkey1"]

    monkeypatch.setattr(main.KiteConnect, "generate_session", fake_session("CD5678", "childsecret1"))
    resp = main.callback(request_token="rt", status="success", client_id="CD5678")
    assert resp.headers["location"].endswith("/accounts?logged_in=CD5678")
    assert db.get_account("CD5678").has_fresh_token


def test_child_without_own_app_cannot_log_in():
    db.upsert_account("CD5678", "child", 1.0)  # e.g. added with manage.py, no keys
    with pytest.raises(HTTPException) as e:
        main.login(client_id="CD5678", admin_token=None)
    assert e.value.status_code == 409 and "API key" in e.value.detail


def test_update_child_credentials():
    new_child()
    db.save_access_token("CD5678", "t")

    # Same key, blank secret: keeps the secret and the login.
    main.api_update_account("CD5678", main.AccountUpdate(api_key="childkey1", api_secret=""))
    acct = db.get_account("CD5678")
    assert acct.api_secret == "childsecret1" and acct.has_fresh_token

    # A new key needs its secret...
    with pytest.raises(HTTPException) as e:
        main.api_update_account("CD5678", main.AccountUpdate(api_key="otherkey2", api_secret=""))
    assert e.value.status_code == 422
    assert db.get_account("CD5678").api_key == "childkey1"

    # ...and invalidates the token issued by the old app.
    updated = main.api_update_account("CD5678", main.AccountUpdate(api_key="otherkey2", api_secret="othersecret2"))
    assert updated["api_key"] == "otherkey2" and updated["token_fresh"] is False
    acct = db.get_account("CD5678")
    assert acct.api_secret == "othersecret2" and acct.access_token is None


def test_dashboard_counts():
    db.upsert_account("CD5678", "child", 1.0)
    db.save_access_token("CD5678", "t")
    db.claim_copy("M1", "CD5678", "INFY", "BUY", 5)
    db.finish_copy("M1", "CD5678", "PLACED", "C1")
    d = main.api_dashboard()
    assert d["master"]["client_id"] == "AB1234"
    assert d["children"] == {"total": 1, "active": 1, "active_with_token": 1}
    assert d["today"]["master_trades"] == 1 and d["today"]["placed"] == 1
    assert d["ticker"]["state"] == "stopped"


def test_ticker_status_from_heartbeat():
    db.record_ticker_heartbeat(True)
    assert db.ticker_status()["state"] == "running"
    db.record_ticker_heartbeat(False)
    assert db.ticker_status()["state"] == "disconnected"


def test_master_settings_keep_secret_when_blank():
    s = main.api_save_master(main.MasterSettings(client_id="AB1234", api_key="mykey", api_secret="mysecret"))
    assert s["master"]["api_key"] == "mykey" and not s["master"]["api_secret_from_env"]
    assert "mysecret" not in str(s)
    main.api_save_master(main.MasterSettings(client_id="AB1234", api_key="mykey", api_secret=""))
    assert db.get_master().api_secret == "mysecret"


def test_master_settings_refuse_second_master():
    with pytest.raises(HTTPException) as e:
        main.api_save_master(main.MasterSettings(client_id="ZZ9999"))
    assert e.value.status_code == 409


def test_safety_settings_roundtrip():
    assert main.api_save_safety(main.SafetySettings(copy_enabled=False, max_quantity_per_trade=500)) == {
        "copy_enabled": False, "max_quantity_per_trade": 500}
    assert main.api_get_settings()["safety"]["max_quantity_per_trade"] == 500


# --- master orders from the UI --------------------------------------------------------

def order(**kw):
    body = {"exchange": "NSE", "tradingsymbol": "infy", "transaction_type": "BUY",
            "quantity": 5, "product": "CNC", "order_type": "MARKET", **kw}
    return main.OrderCreate(**body)


def test_place_order_requires_master_login():
    with pytest.raises(HTTPException) as e:
        main.api_place_order(order())
    assert e.value.status_code == 409 and "not logged in" in e.value.detail


def test_place_order_sends_kite_params(monkeypatch):
    db.save_access_token("AB1234", "t")
    sent = {}

    def place_order(self, **params):
        sent.clear()
        sent.update(params)
        return "250101000000001"

    monkeypatch.setattr(main.KiteConnect, "place_order", place_order)
    assert main.api_place_order(order()) == {"order_id": "250101000000001"}
    assert sent == {"variety": "regular", "exchange": "NSE", "tradingsymbol": "INFY",
                    "transaction_type": "BUY", "quantity": 5, "product": "CNC",
                    "order_type": "MARKET", "validity": "DAY", "market_protection": -1}

    main.api_place_order(order(order_type="SL", price=1500, trigger_price=1495))
    assert sent["price"] == 1500 and sent["trigger_price"] == 1495
    assert "market_protection" not in sent


def test_place_order_passes_kite_rejection_through(monkeypatch):
    db.save_access_token("AB1234", "t")

    def place_order(self, **params):
        raise main.InputException("Insufficient funds. Required margin is 7500.00")

    monkeypatch.setattr(main.KiteConnect, "place_order", place_order)
    with pytest.raises(HTTPException) as e:
        main.api_place_order(order())
    assert e.value.status_code == 400 and "Insufficient funds" in e.value.detail


def test_order_validation():
    with pytest.raises(ValueError):
        order(order_type="LIMIT")  # no price
    with pytest.raises(ValueError):
        order(order_type="SL-M")  # no trigger price
    with pytest.raises(ValueError):
        order(quantity=0)
    with pytest.raises(ValueError):
        order(tradingsymbol="INFY; DROP")


def test_master_orders_newest_first(monkeypatch):
    db.save_access_token("AB1234", "t")
    book = [
        {"order_id": "1", "order_timestamp": "2026-10-28 09:20:00", "status": "COMPLETE", "secret": "x"},
        {"order_id": "2", "order_timestamp": "2026-10-28 10:05:00", "status": "REJECTED"},
    ]
    monkeypatch.setattr(main.KiteConnect, "orders", lambda self: book)
    rows = main.api_master_orders()
    assert [r["order_id"] for r in rows] == ["2", "1"]
    assert "secret" not in rows[0] and rows[0]["status_message"] is None
