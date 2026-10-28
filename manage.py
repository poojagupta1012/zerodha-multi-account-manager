"""
Command-line account management.

  python manage.py gen-key                          # print a TOKEN_ENCRYPTION_KEY
  python manage.py init                             # create the database
  python manage.py add AB1234 --role master
  python manage.py add CD5678 --role child --multiplier 0.5
  python manage.py add EF9012 --role child --multiplier 2 --api-key K --api-secret S
  python manage.py list
  python manage.py set-multiplier CD5678 1.5
  python manage.py disable CD5678 / enable CD5678
  python manage.py remove CD5678
  python manage.py log                              # recent copy results
"""

import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage copy-trading accounts")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("gen-key", help="generate a Fernet key for TOKEN_ENCRYPTION_KEY")
    sub.add_parser("init", help="create database tables")

    add = sub.add_parser("add", help="register or update an account")
    add.add_argument("client_id")
    add.add_argument("--role", choices=["master", "child"], required=True)
    add.add_argument("--multiplier", type=float, default=1.0)
    add.add_argument("--api-key", help="per-account Kite app key (defaults to KITE_API_KEY; "
                     "children need their own, since Kite only lets an app's own client ID log in)")
    add.add_argument("--api-secret", help="per-account Kite app secret")

    sub.add_parser("list", help="show accounts and token status")

    sm = sub.add_parser("set-multiplier")
    sm.add_argument("client_id")
    sm.add_argument("multiplier", type=float)

    for name in ("enable", "disable", "remove"):
        sub.add_parser(name).add_argument("client_id")

    lg = sub.add_parser("log", help="show recent copy-trade results")
    lg.add_argument("-n", type=int, default=20)

    args = parser.parse_args()

    if args.cmd == "gen-key":
        # Imported here so gen-key works before .env exists.
        from cryptography.fernet import Fernet
        print(Fernet.generate_key().decode())
        return 0

    import db
    db.init_db()

    if args.cmd == "init":
        print("Database ready")
    elif args.cmd == "add":
        if args.role == "master":
            existing = db.get_master()
            if existing and existing.client_id != args.client_id.upper():
                print(f"{existing.client_id} is already the master; remove it first.")
                return 1
        db.upsert_account(args.client_id, args.role, args.multiplier,
                          args.api_key, args.api_secret)
        print(f"Saved {args.client_id.upper()} as {args.role} (multiplier {args.multiplier})")
        if args.role == "child" and not db.get_account(args.client_id).has_own_app:
            print("Note: this child has no Kite app of its own yet; add --api-key and "
                  "--api-secret before it can log in.")
    elif args.cmd == "list":
        print(f"{'CLIENT':<10} {'ROLE':<7} {'MULT':>6} {'ACTIVE':<7} {'TOKEN':<8} LAST LOGIN")
        for a in db.list_accounts():
            print(f"{a.client_id:<10} {a.role:<7} {a.multiplier:>6g} {str(a.is_active):<7} "
                  f"{'fresh' if a.has_fresh_token else 'EXPIRED':<8} "
                  f"{a.token_updated_at.strftime('%Y-%m-%d %H:%M') if a.token_updated_at else '-'}")
    elif args.cmd == "set-multiplier":
        db.set_multiplier(args.client_id, args.multiplier)
    elif args.cmd in ("enable", "disable"):
        db.set_active(args.client_id, args.cmd == "enable")
    elif args.cmd == "remove":
        db.delete_account(args.client_id)
    elif args.cmd == "log":
        for r in db.recent_copies(args.n):
            print(f"{r['created_at'][:19]} {r['master_order_id']:<18} {r['client_id']:<8} "
                  f"{r['transaction_type'] or '':<4} {r['quantity'] or 0:>6} "
                  f"{r['tradingsymbol'] or '':<20} {r['status']:<8} "
                  f"{r['child_order_id'] or r['error'] or ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
