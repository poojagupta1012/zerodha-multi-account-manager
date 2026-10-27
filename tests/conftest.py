import os
import sys
from pathlib import Path

from cryptography.fernet import Fernet

# Must be set before config.py is imported.
os.environ.setdefault("KITE_API_KEY", "test_key")
os.environ.setdefault("KITE_API_SECRET", "test_secret")
os.environ.setdefault("TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

import config  # noqa: E402
import db  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    db.init_db()
    yield
