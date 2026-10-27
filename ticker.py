"""
KiteTicker WebSocket listener for the master account's order updates.

Kite pushes order updates ("postbacks") over the same WebSocket used for
market data. Unlike ticks, order updates need no instrument subscription:
they arrive automatically for whichever user's access_token opened the
socket. So connecting with the master's token gives us the master's orders.

An order produces several updates as it moves through its lifecycle, e.g.
    PUT ORDER REQ RECEIVED -> VALIDATION PENDING -> OPEN PENDING -> OPEN
    -> COMPLETE                    (or CANCELLED / REJECTED)
and partially filled orders send OPEN updates with growing filled_quantity.
We act only on the terminal COMPLETE update, and Kite may deliver the same
update more than once (e.g. after a reconnect), so we de-duplicate.

Threading: KiteTicker runs on the Twisted reactor, and callbacks execute on
the reactor thread. Blocking that thread (e.g. with HTTP order calls) would
stall the socket and its heartbeats, so on_order_update only filters and
hands the order off to a dispatcher thread.

Run after the master has logged in for the day:  python ticker.py
"""

import logging
import sys
from concurrent.futures import ThreadPoolExecutor

from kiteconnect import KiteTicker

import config
import db
from copier import CopyEngine, MasterOrder

config.setup_logging()
log = logging.getLogger("ticker")

STATUS_COMPLETE = "COMPLETE"
IGNORED_STATUSES = {"CANCELLED", "REJECTED"}


def order_owner(data: dict) -> str:
    """
    Client ID the order belongs to. The WebSocket payload has used both
    `account_id` and `user_id` for this over time, and `placed_by` is the user
    who placed it, so check all three.
    """
    return str(data.get("user_id") or data.get("account_id") or data.get("placed_by") or "").upper()


def should_copy(data: dict, master_client_id: str) -> tuple[bool, str]:
    """Decide whether an order update should be copied; returns (ok, reason)."""
    owner = order_owner(data)
    if owner != master_client_id:
        return False, f"order belongs to {owner or 'unknown'}, not master {master_client_id}"

    status = (data.get("status") or "").upper()
    if status in IGNORED_STATUSES:
        return False, f"status {status}"
    if status != STATUS_COMPLETE:
        # Intermediate states (OPEN, TRIGGER PENDING, ...). Wait for COMPLETE.
        return False, f"status {status or 'missing'} is not terminal"

    if int(data.get("filled_quantity") or 0) <= 0:
        return False, "no filled quantity"

    # Never re-copy orders this system placed. Matters if a child account is
    # ever also configured as the master.
    if data.get("tag") == config.COPY_ORDER_TAG:
        return False, "order was placed by the copier"

    return True, "ok"


class MasterListener:
    def __init__(self, master: db.Account, engine: CopyEngine) -> None:
        self.master = master
        self.engine = engine
        # Single worker = master orders are copied strictly in the order they
        # completed (a BUY followed by its exit SELL must not be reordered).
        # Each copy still fans out to children in parallel inside CopyEngine.
        self.dispatcher = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dispatch")
        # Fast in-memory de-dup; copy_log's UNIQUE constraint is the durable one.
        self.seen_order_ids: set[str] = set()

        self.kws = KiteTicker(master.api_key, master.access_token)
        self.kws.on_connect = self.on_connect
        self.kws.on_close = self.on_close
        self.kws.on_error = self.on_error
        self.kws.on_reconnect = self.on_reconnect
        self.kws.on_noreconnect = self.on_noreconnect
        self.kws.on_order_update = self.on_order_update

    # --- KiteTicker callbacks (run on the Twisted reactor thread) --------------

    def on_connect(self, ws, response) -> None:
        # No subscribe() call needed: order updates flow without one.
        log.info("Connected to Kite WebSocket as master %s; listening for orders",
                 self.master.client_id)

    def on_order_update(self, ws, data: dict) -> None:
        order_id = str(data.get("order_id", ""))
        log.debug("Order update: %s", data)

        ok, reason = should_copy(data, self.master.client_id)
        if not ok:
            log.debug("Ignoring order %s (%s)", order_id, reason)
            return
        if order_id in self.seen_order_ids:
            log.info("Duplicate COMPLETE update for %s ignored", order_id)
            return
        self.seen_order_ids.add(order_id)

        try:
            order = MasterOrder.from_order_update(data)
        except (KeyError, ValueError, TypeError) as exc:
            log.error("Malformed order update %s: %s (%s)", order_id, exc, data)
            return

        log.info("Master order COMPLETE: %s %s %d %s:%s @ %.2f",
                 order.order_id, order.transaction_type, order.quantity,
                 order.exchange, order.tradingsymbol, order.average_price)
        self.dispatcher.submit(self._safe_copy, order)

    def on_close(self, ws, code, reason) -> None:
        # KiteTicker reconnects automatically after an unexpected close.
        log.warning("WebSocket closed: %s %s", code, reason)

    def on_error(self, ws, code, reason) -> None:
        # A 403 here almost always means the master's access token expired
        # (6 AM IST reset) or was invalidated by a fresh login elsewhere.
        log.error("WebSocket error: %s %s", code, reason)

    def on_reconnect(self, ws, attempts_count) -> None:
        log.warning("Reconnecting to Kite WebSocket (attempt %d)", attempts_count)

    def on_noreconnect(self, ws) -> None:
        log.critical("Gave up reconnecting to Kite WebSocket; stopping. "
                     "Log the master in again and restart the ticker.")
        self.stop()

    # --- internals -----------------------------------------------------------------

    def _safe_copy(self, order: MasterOrder) -> None:
        try:
            self.engine.copy(order)
        except Exception:
            # Keep the dispatcher alive for the next order no matter what.
            log.exception("Unexpected error while copying master order %s", order.order_id)

    def run(self) -> None:
        # threaded=False runs the Twisted reactor on this thread and blocks
        # until stop() or Ctrl+C.
        self.kws.connect(threaded=False)

    def stop(self) -> None:
        try:
            self.kws.stop()
        except Exception:
            pass


def main() -> int:
    db.init_db()
    master = db.get_master()
    if master is None:
        log.error("No master account registered. Run: python manage.py add <ID> --role master")
        return 1
    if not master.has_fresh_token:
        log.error("Master %s has no valid access token for today. Log in at /login?client_id=%s",
                  master.client_id, master.client_id)
        return 1

    children = db.get_active_children()
    stale = [c.client_id for c in children if not c.has_fresh_token]
    log.info("Master: %s | active children: %d", master.client_id, len(children))
    if stale:
        log.warning("Children without a fresh token (their copies will fail until they log in): %s",
                    ", ".join(stale))
    if config.DRY_RUN:
        log.warning("DRY_RUN is on: child orders will be logged, not placed")

    engine = CopyEngine()
    listener = MasterListener(master, engine)
    try:
        listener.run()
    finally:
        log.info("Shutting down: waiting for in-flight copies to finish")
        listener.dispatcher.shutdown(wait=True)
        engine.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
