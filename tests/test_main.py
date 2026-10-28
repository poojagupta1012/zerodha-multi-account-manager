"""Calls the route functions directly, so no HTTP test client is needed."""

from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

import db
import main


@pytest.fixture(autouse=True)
def master():
    db.upsert_account("AB1234", "master")


def fake_session(user_id):
    def generate_session(self, request_token, api_secret):
        assert request_token == "rt" and api_secret == "test_secret"
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

def test_create_update_delete_child():
    created = main.api_create_account(main.AccountCreate(client_id="cd5678", multiplier=0.5))
    assert created == {**created, "client_id": "CD5678", "role": "child", "token_fresh": False}

    with pytest.raises(HTTPException) as e:
        main.api_create_account(main.AccountCreate(client_id="CD5678", multiplier=1))
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
    with pytest.raises(ValueError):
        main.AccountCreate(client_id="not an id", multiplier=1)
    with pytest.raises(ValueError):
        main.AccountCreate(client_id="CD5678", multiplier=0)


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
