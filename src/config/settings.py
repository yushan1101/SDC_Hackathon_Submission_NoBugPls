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
    # OpenAI-compatible endpoint shared by every "openai:<model>" agent (e.g. GPT-5.6-Luna and Grok-4.7 on one gateway)
    llm_base_url: str = ""
    llm_api_key: SecretStr | None = None
    # per-agent model, "openai:<model>" or "gemini:<model>"; empty = LLM_FAST_MODEL on Gemini, else deterministic
    router_model: str = ""
    coach_model: str = ""
    resume_model: str = ""
    recruiter_model: str = ""  # job posts, "ask your data" and voice job drafts for HR
    # speech-to-text for voice input: "openai:<model>" on the gateway or "gemini:<model>"; if its provider has no key, the
    # Gemini fast model is used, else browsers fall back to their own speech recognition
    stt_model: str = "openai:mimo-v2.6-flash"  # an audio chat model on the gateway; whisper-style ids use /audio/transcriptions
    llm_resume: bool = False  # opt-in: send the REDACTED resume to the LLM to propose extra skills (quotes verified)
    llm_usd_per_1m_input: float = 0.0   # set from the provider's current price sheet; 0 = cost not estimated
    llm_usd_per_1m_output: float = 0.0
    llm_timeout_s: float = Field(30.0, gt=0)
    host: str = "0.0.0.0"   # web server bind (src/main.py)
    port: int = Field(8600, gt=0)
    database_path: str = str(SRC / "data" / "audit.sqlite3")   # defaults live under src/ wherever you run from
    chroma_path: str = str(SRC / "data" / "chroma")
    outlook_artifact_dir: str = str(SRC / "artifacts" / "onet")  # stf_kan_best.pt + artifact_manifest.json (live CPU outlook)
    outlook_history_path: str = str(SRC / "data" / "training" / "onet_history.csv")  # model input, checksum-checked
    mcp_url: str = ""  # empty = in-process FastMCP server; else e.g. http://localhost:8765/mcp
    mcp_host: str = "127.0.0.1"  # `python -m mcp_server.server --http` bind
    mcp_port: int = Field(8765, gt=0)
    mcp_timeout_s: float = Field(20.0, gt=0)
    model_card_url: str = "https://github.com/yushan1101/SDC_Hackathon_Submission_NoBugPls/blob/devby/docs/requirements_trace.md"
    max_upload_rows: int = Field(5000, gt=0)
    max_team_size: int = Field(500, gt=0)
    login_max_failures: int = 5
    login_lock_minutes: int = 5
    log_level: str = "INFO"
    signals_daily: bool = True  # refresh the AI-trend board (HN, arXiv, job boards) once per UTC day
    # load MiniLM and build/open the vector index in the background at start-up. CI sets WARM_ON_START=false: no index
    # there, and a model still loading in a thread when the test run exits aborts Python (exit 134)
    warm_on_start: bool = True
    # --- billing (Stripe, test mode first). Keys live in .env only; empty = payments switched off (503) ---
    stripe_secret_key: SecretStr | None = None       # sk_test_... (never logged)
    stripe_publishable_key: str = ""                 # pk_test_... (sent to the browser for Stripe Elements)
    stripe_webhook_secret: SecretStr | None = None   # whsec_... (verifies /api/billing/webhook)
    currency: str = "myr"
    price_pro_cents: int = Field(1900, gt=0)         # RM 19.00 for 30 days
    price_team_cents: int = Field(9900, gt=0)        # RM 99.00 for 30 days
    plan_days: int = Field(30, gt=0)
    free_monthly_briefings: int = Field(3, ge=0)     # new briefings per calendar month on the free plan
    # --- email one-time codes at sign-up; empty host = no email (the code is written to the server log instead) ---
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: SecretStr | None = None
    smtp_from: str = ""
    support_email: str = ""  # shown on the Terms and Privacy pages as the contact for questions and data requests
    # --- hiring plugins (governance/plugins.py): each platform's own developer app; empty = that platform is off ---
    linkedin_client_id: str = ""
    linkedin_client_secret: SecretStr | None = None
    linkedin_version: str = "202509"           # LinkedIn-Version header (YYYYMM; LinkedIn retires versions after ~1 year)
    facebook_app_id: str = ""
    facebook_app_secret: SecretStr | None = None
    facebook_graph_version: str = "v23.0"
    x_client_id: str = ""
    x_client_secret: SecretStr | None = None   # empty = public client (PKCE only)
    plugin_secret_key: SecretStr | None = None  # Fernet key for stored platform tokens; empty = key file beside the database
    public_url: str = ""  # e.g. https://sdc.olgtx.com: where links in emails point (empty = the address the request came in on)
    # separate frontend deploy: comma-separated origins allowed to call the API with credentials, e.g.
    # "https://app.example.com,http://localhost:5173". Empty = same-origin only (frontend served by this API).
    cors_origins: str = ""
    # session cookie SameSite: "strict" (same site), "lax", or "none" (frontend on another site; forces Secure/https)
    cookie_samesite: str = Field("strict", pattern="^(strict|lax|none)$")
    frame_ancestors: str = "'none'"  # explicit trusted embedding origins for development previews only

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    @property
    def llm_enabled(self) -> bool:
        from agents.llm import model_for
        return any(model_for(a) for a in ("router", "coach", "resume"))


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    logging.basicConfig(level=s.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    return s
