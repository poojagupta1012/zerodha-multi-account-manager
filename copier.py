"""
Execution engine: fan a completed master order out to every child account.

Flow for one master order:
  1. MasterOrder.from_order_update() parses the raw Kite order-update dict.
  2. CopyEngine.copy() loads active children, works out each child's quantity,
     and reserves a row in copy_log (idempotency guard).
  3. All child orders are submitted to a ThreadPoolExecutor at the same time.
     Each place_order call is a blocking HTTPS request (~50-200 ms), so doing
     them one after another would make the last child's fill noticeably worse
     than the first's. Running them in parallel keeps every child close to the
     master's fill time.
  4. Each child call is isolated in its own try/except, so an insufficient
     margin error (or any other rejection) on one account never prevents the
     others from being placed.
"""

import logging
import threading
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date
from typing import Optional

from kiteconnect import KiteConnect

import config
import db

log = logging.getLogger("copier")

# Exchanges where the order quantity is expressed in units and must be a
# multiple of the contract's lot size (e.g. NIFTY options: lot of 75 units).
# On MCX and CDS, Kite quantities are already in lots, so no rounding is needed.
LOT_SIZED_EXCHANGES = {"NFO", "BFO"}

# Kite varieties we can safely replicate as-is. Cover orders and iceberg orders
# need extra legs/params, so they are copied as plain "regular" orders.
COPYABLE_VARIETIES = {KiteConnect.VARIETY_REGULAR, KiteConnect.VARIETY_AMO}


@dataclass(frozen=True)
class MasterOrder:
    order_id: str
    exchange: str
    tradingsymbol: str
    transaction_type: str   # BUY / SELL
    order_type: str         # MARKET / LIMIT / SL / SL-M
    product: str            # CNC / MIS / NRML
    variety: str            # regular / amo / co / iceberg
    validity: str           # DAY / IOC / TTL
    quantity: int           # executed (filled) quantity
    price: float            # limit price (0 for MARKET)
    average_price: float    # actual average fill price

    @classmethod
    def from_order_update(cls, data: dict) -> "MasterOrder":
        """
        Build from a KiteTicker on_order_update payload. Relevant fields:

          order_id, status, exchange, tradingsymbol, transaction_type,
          order_type, product, variety, validity, quantity, filled_quantity,
          price, trigger_price, average_price, tag, user_id/account_id

        `quantity` is what was *requested*; `filled_quantity` is what was
        actually executed. For a COMPLETE order they are equal, but we use
        filled_quantity so the child mirrors the real exposure.
        """
        filled = int(data.get("filled_quantity") or 0) or int(data.get("quantity") or 0)
        return cls(
            order_id=str(data["order_id"]),
            exchange=data["exchange"],
            tradingsymbol=data["tradingsymbol"],
            transaction_type=data["transaction_type"],
            order_type=data.get("order_type") or KiteConnect.ORDER_TYPE_MARKET,
            product=data["product"],
            variety=data.get("variety") or KiteConnect.VARIETY_REGULAR,
            validity=data.get("validity") or KiteConnect.VALIDITY_DAY,
            quantity=filled,
            price=float(data.get("price") or 0),
            average_price=float(data.get("average_price") or 0),
        )


def compute_child_quantity(master_qty: int, multiplier: float, lot_size: int = 1) -> int:
    """
    child_quantity = int(master_quantity * multiplier), rounded down to a whole
    number of lots for lot-sized instruments. Returns 0 when the result is
    below one unit / one lot, which means "skip this child".

    A tiny epsilon guards against float artefacts such as 100 * 0.29 being
    28.999999999999996 instead of 29.
    """
    qty = int(master_qty * multiplier + 1e-9)
    if lot_size > 1:
        qty = (qty // lot_size) * lot_size
    return max(qty, 0)


def build_order_params(order: MasterOrder, quantity: int) -> dict:
    """
    Translate the master order into kite.place_order() kwargs for a child.

    The master order is already COMPLETE when we see it, which affects how
    each order type should be copied:
      * MARKET -> MARKET.
      * LIMIT  -> LIMIT at the master's limit price (or MARKET if
                  FORCE_MARKET_ORDERS is set, to guarantee a fill).
      * SL-M   -> MARKET. The trigger has already been hit, so placing a new
                  SL-M with the same trigger would be rejected by Kite
                  ("trigger price must be above/below LTP").
      * SL     -> LIMIT at the master's limit price, for the same reason.
    """
    order_type = order.order_type
    if order_type == KiteConnect.ORDER_TYPE_SLM:
        order_type = KiteConnect.ORDER_TYPE_MARKET
    elif order_type == KiteConnect.ORDER_TYPE_SL:
        order_type = KiteConnect.ORDER_TYPE_LIMIT
    if config.FORCE_MARKET_ORDERS:
        order_type = KiteConnect.ORDER_TYPE_MARKET

    params = {
        "variety": order.variety if order.variety in COPYABLE_VARIETIES else KiteConnect.VARIETY_REGULAR,
        "exchange": order.exchange,
        "tradingsymbol": order.tradingsymbol,
        "transaction_type": order.transaction_type,
        "quantity": quantity,
        "product": order.product,
        "order_type": order_type,
        # TTL validity needs an extra validity_ttl param; fall back to DAY.
        "validity": order.validity if order.validity in ("DAY", "IOC") else KiteConnect.VALIDITY_DAY,
        "tag": config.COPY_ORDER_TAG,
    }
    if order_type == KiteConnect.ORDER_TYPE_LIMIT:
        # Fall back to the average fill price if the limit price is missing.
        params["price"] = order.price or order.average_price
    return params


class LotSizeCache:
    """
    Lazily downloads the instrument master for NFO/BFO (once per exchange per
    day) to look up lot sizes. The instruments dump is a few MB of CSV, so it
    must not be fetched on every order.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sizes: dict[str, dict[str, int]] = {}
        self._loaded_on: dict[str, date] = {}

    def get(self, exchange: str, tradingsymbol: str, kite: Optional[KiteConnect]) -> int:
        if exchange not in LOT_SIZED_EXCHANGES:
            return 1
        with self._lock:
            if self._loaded_on.get(exchange) != date.today():
                if kite is None:
                    raise RuntimeError("No Kite client available to fetch lot sizes")
                log.info("Downloading %s instrument list for lot sizes", exchange)
                self._sizes[exchange] = {
                    i["tradingsymbol"]: int(i["lot_size"]) for i in kite.instruments(exchange)
                }
                self._loaded_on[exchange] = date.today()
            lot = self._sizes[exchange].get(tradingsymbol)
        if lot is None:
            raise LookupError(f"Lot size for {exchange}:{tradingsymbol} not found")
        return lot


class CopyEngine:
    def __init__(self, max_workers: int = config.MAX_WORKERS) -> None:
        # Long-lived pool: threads are already warm when an order arrives.
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="child")
        self._lot_sizes = LotSizeCache()
        # KiteConnect wraps a requests.Session. Reusing one per account keeps
        # the TLS connection to api.kite.trade alive, which saves a handshake
        # (~100 ms) on every order. Keyed by token so a re-login replaces it.
        self._clients: dict[tuple[str, str], KiteConnect] = {}
        self._clients_lock = threading.Lock()

    def _client(self, account: db.Account) -> KiteConnect:
        key = (account.client_id, account.access_token)
        with self._clients_lock:
            kite = self._clients.get(key)
            if kite is None:
                # Drop clients holding yesterday's token for this account.
                for k in [k for k in self._clients if k[0] == account.client_id]:
                    del self._clients[k]
                kite = KiteConnect(api_key=account.api_key, access_token=account.access_token)
                self._clients[key] = kite
            return kite

    def copy(self, order: MasterOrder) -> list[dict]:
        """Replicate `order` into every eligible child. Blocks until all child
        requests have returned; returns one result dict per child."""
        children = db.get_active_children()
        if not children:
            log.warning("No active child accounts; nothing to copy for %s", order.order_id)
            return []

        lot_size = self._lot_size_for(order)
        if lot_size is None:
            return []

        log.info(
            "Copying master order %s: %s %d %s:%s (%s/%s) to %d children",
            order.order_id, order.transaction_type, order.quantity, order.exchange,
            order.tradingsymbol, order.order_type, order.product, len(children),
        )

        results: list[dict] = []
        futures: dict[Future, db.Account] = {}
        for child in children:
            qty = compute_child_quantity(order.quantity, child.multiplier, lot_size)
            if not db.claim_copy(order.order_id, child.client_id, order.tradingsymbol,
                                 order.transaction_type, qty):
                log.info("[%s] already handled master order %s; skipping duplicate",
                         child.client_id, order.order_id)
                continue
            if qty < 1:
                reason = f"quantity {order.quantity} x {child.multiplier} < 1 (lot size {lot_size})"
                log.info("[%s] SKIPPED: %s", child.client_id, reason)
                results.append(self._record(order, child, "SKIPPED", error=reason))
                continue
            if not child.has_fresh_token:
                reason = "access token missing or expired; log in via /login"
                log.error("[%s] FAILED: %s", child.client_id, reason)
                results.append(self._record(order, child, "FAILED", error=reason))
                continue
            # Submit everything first, then wait: this is what makes the
            # orders go out simultaneously rather than one after another.
            futures[self._pool.submit(self._place_child_order, child, order, qty)] = child

        for fut in as_completed(futures):
            results.append(fut.result())  # _place_child_order never raises

        placed = sum(r["status"] == "PLACED" for r in results)
        log.info("Master order %s: %d/%d child orders placed",
                 order.order_id, placed, len(results))
        return results

    def _lot_size_for(self, order: MasterOrder) -> Optional[int]:
        try:
            master = db.get_master()
            kite = self._client(master) if master and master.has_fresh_token else None
            return self._lot_sizes.get(order.exchange, order.tradingsymbol, kite)
        except Exception as exc:
            log.error("Cannot determine lot size for %s:%s, not copying: %s",
                      order.exchange, order.tradingsymbol, exc)
            return None

    def _place_child_order(self, child: db.Account, order: MasterOrder, qty: int) -> dict:
        """Runs inside a worker thread. Must never raise: every failure is
        caught, logged, and recorded so other children are unaffected."""
        try:
            params = build_order_params(order, qty)
            if config.DRY_RUN:
                log.info("[%s] DRY RUN, would place: %s", child.client_id, params)
                child_order_id = "DRY_RUN"
            else:
                child_order_id = self._client(child).place_order(**params)
            log.info("[%s] PLACED %s %d %s -> order_id %s", child.client_id,
                     order.transaction_type, qty, order.tradingsymbol, child_order_id)
            return self._record(order, child, "PLACED", child_order_id=str(child_order_id))
        except Exception as exc:
            # Typical Kite errors here: InputException (bad params / margin
            # shortfall shows up as an RMS rejection), TokenException (expired
            # session), NetworkException (timeout), PermissionException.
            err = f"{type(exc).__name__}: {exc}"
            log.error("[%s] FAILED %s %d %s: %s", child.client_id,
                      order.transaction_type, qty, order.tradingsymbol, err)
            return self._record(order, child, "FAILED", error=err)

    @staticmethod
    def _record(order: MasterOrder, child: db.Account, status: str,
                child_order_id: Optional[str] = None, error: Optional[str] = None) -> dict:
        try:
            db.finish_copy(order.order_id, child.client_id, status, child_order_id, error)
        except Exception:
            log.exception("[%s] could not write copy_log row", child.client_id)
        return {"client_id": child.client_id, "status": status,
                "child_order_id": child_order_id, "error": error}

    def shutdown(self) -> None:
        self._pool.shutdown(wait=True)
