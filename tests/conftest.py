import os
import sys
from pathlib import Path

from cryptography.fernet import Fernet

# Must be set before config.py is imported.
os.environ.setdefault("KITE_API_KEY", "test_key")
os.environ.setdefault("KITE_API_SECRET", "test_secret")
os.environ.setdefault("TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
# Pin settings a developer's .env would otherwise leak into the tests
# (load_dotenv never overrides variables that are already set).
os.environ["DRY_RUN"] = "false"
os.environ["FORCE_MARKET_ORDERS"] = "false"
os.environ["ADMIN_TOKEN"] = ""
os.environ["FRONTEND_URL"] = "http://localhost:3000"
os.environ.pop("CORS_ORIGINS", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

import config  # noqa: E402
import db  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    db.init_db()
    yield
