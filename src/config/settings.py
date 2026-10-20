"""Validated environment settings (.env supported). No secrets in code; key is never logged."""
import logging
from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


SRC = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(str(SRC.parent / ".env"), ".env"), extra="ignore")  # repo-root .env

    gemini_api_key: SecretStr | None = None
    llm_fast_model: str = ""  # e.g. a Gemini Flash-class id; empty = LLM agents disabled (deterministic)
    llm_complex_model: str = ""
    llm_usd_per_1m_input: float = 0.0   # set from the provider's current price sheet; 0 = cost not estimated
    llm_usd_per_1m_output: float = 0.0
    database_path: str = str(SRC / "data" / "audit.sqlite3")   # defaults live under src/ wherever you run from
    chroma_path: str = str(SRC / "data" / "chroma")
    forecast_model_path: str = str(SRC / "artifacts" / "stf_kan_best.pt")
    mcp_url: str = ""  # empty = in-process FastMCP server; else e.g. http://localhost:8765/mcp
    max_upload_rows: int = Field(5000, gt=0)
    max_team_size: int = Field(500, gt=0)
    login_max_failures: int = 5
    login_lock_minutes: int = 5
    log_level: str = "INFO"
    signals_daily: bool = True  # refresh the AI-trend board (HN, arXiv, job boards) once per UTC day
    # separate frontend deploy: comma-separated origins allowed to call the API with credentials, e.g.
    # "https://app.example.com,http://localhost:5173". Empty = same-origin only (frontend served by this API).
    cors_origins: str = ""
    # session cookie SameSite: "strict" (same site), "lax", or "none" (frontend on another site; forces Secure/https)
    cookie_samesite: str = Field("strict", pattern="^(strict|lax|none)$")

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    @property
    def llm_enabled(self) -> bool:
        return bool(self.gemini_api_key and self.gemini_api_key.get_secret_value() and self.llm_fast_model)


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    logging.basicConfig(level=s.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    return s
