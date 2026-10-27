import threading
import time
from datetime import datetime

import pytest

import config
import db
from kiteconnect import KiteConnect

from copier import CopyEngine, MasterOrder, build_order_params, compute_child_quantity
from ticker import should_copy

MASTER = "AB1234"


def order_update(**overrides):
    data = {
        "account_id": MASTER, "placed_by": MASTER, "order_id": "240101000000001",
        "status": "COMPLETE", "exchange": "NSE", "tradingsymbol": "INFY",
        "transaction_type": "BUY", "order_type": "MARKET", "product": "MIS",
        "variety": "regular", "validity": "DAY", "quantity": 10,
        "filled_quantity": 10, "price": 0, "trigger_price": 0,
        "average_price": 1500.5, "tag": None,
    }
    data.update(overrides)
    return data


# --- quantity math ---------------------------------------------------------------

@pytest.mark.parametrize("qty,mult,lot,expected", [
    (10, 1.0, 1, 10), (10, 0.5, 1, 5), (10, 2.0, 1, 20), (3, 0.3, 1, 0),
    (100, 0.29, 1, 29),            # float artefact guard
    (150, 0.5, 75, 75), (75, 0.5, 75, 0), (225, 2.0, 75, 450),
])
def test_compute_child_quantity(qty, mult, lot, expected):
    assert compute_child_quantity(qty, mult, lot) == expected


# --- websocket filter ---------------------------------------------------------------

def test_should_copy_accepts_complete_master_order():
    assert should_copy(order_update(), MASTER)[0]


def test_should_copy_accepts_user_id_field():
    data = order_update(account_id=None, placed_by=None, user_id=MASTER)
    assert should_copy(data, MASTER)[0]


@pytest.mark.parametrize("overrides", [
    {"status": "OPEN"}, {"status": "CANCELLED"}, {"status": "REJECTED"},
    {"status": "TRIGGER PENDING"}, {"filled_quantity": 0},
    {"account_id": "ZZ9999", "placed_by": "ZZ9999"},
    {"tag": "COPYTRADE"},
])
def test_should_copy_rejects(overrides):
    assert not should_copy(order_update(**overrides), MASTER)[0]


# --- order params ---------------------------------------------------------------------

def test_slm_copied_as_market_and_sl_as_limit():
    slm = MasterOrder.from_order_update(order_update(order_type="SL-M", trigger_price=1490))
    assert build_order_params(slm, 5)["order_type"] == "MARKET"
    sl = MasterOrder.from_order_update(order_update(order_type="SL", price=1495, trigger_price=1490))
    params = build_order_params(sl, 5)
    assert params["order_type"] == "LIMIT" and params["price"] == 1495


def test_cover_order_copied_as_regular():
    o = MasterOrder.from_order_update(order_update(variety="co"))
    assert build_order_params(o, 1)["variety"] == "regular"


# --- engine -----------------------------------------------------------------------------

class FakeKite(KiteConnect):
    """Stands in for KiteConnect; records calls and can fail per account."""
    calls = []
    fail_for = set()
    lock = threading.Lock()

    def __init__(self, api_key, access_token=None):
        self.access_token = access_token

    def place_order(self, **params):
        time.sleep(0.2)  # simulate network latency
        with self.lock:
            self.calls.append((self.access_token, params, time.monotonic()))
        if self.access_token in self.fail_for:
            raise Exception("Insufficient funds")
        return f"OID-{self.access_token}"


@pytest.fixture
def engine(monkeypatch):
    FakeKite.calls, FakeKite.fail_for = [], set()
    monkeypatch.setattr("copier.KiteConnect", FakeKite)
    db.upsert_account(MASTER, "master")
    db.save_access_token(MASTER, "tok-master")
    for cid, mult in [("C1", 1.0), ("C2", 0.5), ("C3", 2.0), ("C4", 0.05)]:
        db.upsert_account(cid, "child", mult)
        db.save_access_token(cid, f"tok-{cid}")
    eng = CopyEngine(max_workers=10)
    yield eng
    eng.shutdown()


def test_copy_places_parallel_orders_and_isolates_failures(engine):
    FakeKite.fail_for = {"tok-C2"}
    start = time.monotonic()
    results = {r["client_id"]: r for r in engine.copy(MasterOrder.from_order_update(order_update()))}
    elapsed = time.monotonic() - start

    assert results["C1"]["status"] == "PLACED"
    assert results["C2"]["status"] == "FAILED" and "Insufficient" in results["C2"]["error"]
    assert results["C3"]["status"] == "PLACED"
    assert results["C4"]["status"] == "SKIPPED"   # 10 * 0.05 < 1
    qty = {tok: p["quantity"] for tok, p, _ in FakeKite.calls}
    assert qty == {"tok-C1": 10, "tok-C2": 5, "tok-C3": 20}
    assert all(p["tag"] == config.COPY_ORDER_TAG for _, p, _ in FakeKite.calls)
    assert elapsed < 0.5, "orders should run concurrently, not sequentially"


def test_duplicate_master_order_is_not_copied_twice(engine):
    order = MasterOrder.from_order_update(order_update())
    engine.copy(order)
    assert engine.copy(order) == []
    assert len(FakeKite.calls) == 3


def test_stale_token_child_is_failed_without_api_call(engine, monkeypatch):
    with db.get_conn() as conn:
        conn.execute("UPDATE accounts SET token_updated_at = ? WHERE client_id = 'C1'",
                     (datetime(2020, 1, 1, tzinfo=db.IST).isoformat(),))
    results = {r["client_id"]: r for r in engine.copy(MasterOrder.from_order_update(order_update()))}
    assert results["C1"]["status"] == "FAILED" and "expired" in results["C1"]["error"]
    assert "tok-C1" not in {tok for tok, _, _ in FakeKite.calls}


# --- token expiry -----------------------------------------------------------------------

def test_token_freshness_around_6am():
    issued = datetime(2026, 10, 27, 8, 0, tzinfo=db.IST)
    assert db.is_token_fresh(issued, now=datetime(2026, 10, 28, 5, 59, tzinfo=db.IST))
    assert not db.is_token_fresh(issued, now=datetime(2026, 10, 28, 6, 0, tzinfo=db.IST))


def test_tokens_are_encrypted_at_rest():
    db.upsert_account("C9", "child")
    db.save_access_token("C9", "secret-token")
    with db.get_conn() as conn:
        raw = conn.execute("SELECT access_token FROM accounts WHERE client_id='C9'").fetchone()[0]
    assert "secret-token" not in raw
    assert db.get_account("C9").access_token == "secret-token"
