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


def test_callback_saves_token(monkeypatch):
    monkeypatch.setattr(main.KiteConnect, "generate_session", fake_session("AB1234"))
    html = main.callback(request_token="rt", status="success", client_id="AB1234")
    assert "AB1234" in html
    acct = db.get_account("AB1234")
    assert acct.access_token == "fresh-token" and acct.has_fresh_token


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
