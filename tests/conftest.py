"""Tests run from the repository root: put src/ on the import path and run from src/ (where data/ lives)."""
import os
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))
sys.path.insert(0, str(Path(__file__).resolve().parent))  # tests import helpers from each other (test_graph.req)
os.chdir(SRC)
# hermetic: a developer's .env must not switch on paid LLM calls or change behaviour under test (env beats .env)
os.environ.update(GEMINI_API_KEY="", LLM_API_KEY="", LLM_RESUME="false", MCP_URL="")
os.environ["DATABASE_BACKEND"] = "sqlite"
# session cookies are always Secure in the app; TestClient talks plain http://testserver, so allow them here only
os.environ.setdefault("AP_INSECURE_COOKIES", "1")
# the suite signs in far more than 20 times from one "IP"; tests of the limiter set api.LOGIN_LIMIT themselves
os.environ.setdefault("LOGIN_RATE_LIMIT", "100000")
# TEST_DATABASE_URL=postgresql://... runs the whole suite on Postgres instead of SQLite (governance/db.py); each
# temporary database path gets its own Postgres schema, so tests stay as isolated as separate SQLite files
if os.environ.get("TEST_DATABASE_URL"):
    os.environ.update(
        DATABASE_BACKEND="postgres",
        AIVERSEPULSE_DATABASE_URL=os.environ["TEST_DATABASE_URL"],
        AP_PG_SCHEMA_PER_PATH="1",
    )
