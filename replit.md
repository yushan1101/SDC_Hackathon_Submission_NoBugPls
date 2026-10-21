# Running AiversePulse on Replit

The existing FastAPI server serves both the API and the plain HTML/CSS/JavaScript
frontend. Keep the repository's Python stack and directory structure.

## Run

Use the **Start application** workflow (the Run button), which runs:

```sh
cd src && uv run uvicorn server.api:app --host 0.0.0.0 --port 5000 --proxy-headers --forwarded-allow-ips '*'
```

- Public app: `/`
- HR app: `/enterprise`
- Health check: `/healthz`
- Dependencies are declared in `src/pyproject.toml` and resolved in `src/uv.lock`.
  To restore the serving environment, run `cd src && uv sync --extra ai` (the `ai` extra adds the Chroma vector
  index and Gemini; without it the app still runs with keyword retrieval and template summaries).
- Tests: `cd src && uv run --no-sync pytest -q ../tests`

## Accounts and data

The existing demo account script creates employee and HR accounts:

```sh
uv run --no-sync python scripts/seed_demo_users.py
```

Their randomly generated login details are written to
`data/demo_users.local.txt`, which is gitignored. Open that file privately to
sign in; do not commit or share it. Rerunning the script skips existing accounts.
The app stores accounts, sessions and audit records in `data/audit.sqlite3`.
The imported ESCO snapshots are already included; no training or GPU is needed.

## Development-only preview configuration

Replit development environment settings allow framing only from Replit origins
(`FRAME_ANCESTORS`) and use `COOKIE_SAMESITE=none` for cross-site iframe login
over HTTPS. The server's defaults remain no embedding and strict cookies.
Proxy headers are trusted by the workflow because Replit terminates HTTPS
upstream; do not expose that command directly to untrusted client traffic.

## Optional capabilities

Gemini features remain disabled without `GEMINI_API_KEY` and `LLM_FAST_MODEL`.
The deterministic LangGraph/FastMCP pipeline runs without them.
Sentence-transformers and CPU-only PyTorch support semantic matching and
resume analysis; on first use, the public MiniLM encoder downloads into the
local model cache. Chroma (optional, not installed here) provides vector
retrieval when indexed; without it, retrieval uses the included offline
snapshot. The optional `ai` extra also includes the Gemini client; it is not
needed for this preview. Daily public trend refresh remains enabled and
depends on external source availability.

This setup is for the development preview, not a production deployment.
