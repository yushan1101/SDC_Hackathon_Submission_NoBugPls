# Running AiversePulse on Replit

The existing FastAPI server serves both the API and the plain HTML/CSS/JavaScript
frontend. Keep the repository's Python stack and directory structure.

## Run

Use the configured **Python 3.11** module. The restored native dependencies
(including NumPy and PyTorch) were installed for Python 3.11; changing the
interpreter without reinstalling them causes startup import errors.

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

The existing demo account script creates local employee and HR accounts:

```sh
cd src && uv run --no-sync python scripts/seed_demo_users.py
```

Their randomly generated login details are written to
`data/demo_users.local.txt`, which is gitignored. Open that file privately to
sign in; do not commit or share it. Rerunning the script skips existing accounts.
The app stores accounts, sessions and audit records in `data/audit.sqlite3`.
The imported ESCO snapshots are already included; no training or GPU is needed.

For the published site, the one-time `/bootstrap-demo.html` page creates only
`demo2_employee`, `demo2_hr`, and `demo2_admin`. It requires a
`DEMO_BOOTSTRAP_TOKEN` Replit Secret of at least 32 characters, refuses to run
if any of those accounts already exist, and shows the generated passwords once.
Remove the temporary secret after saving the credentials.

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

## Running a worker node (multi-node)

A Repl can also run as a **worker node** for an existing main server. It serves the heavy tools (occupation search,
embeddings, STF-KAN outlook) and takes its settings from the main server, so it needs no `.env`.

1. On the **main server**, set `NODE_TOKEN` to a long random value (`python -c "import secrets; print(secrets.token_urlsafe(32))"`)
   and restart it.
2. In the worker Repl, add **one Secret**: `NODE_TOKEN` with the same value. If the main server isn't
   `https://sdc.olgtx.com`, change `MAIN_URL` in `src/worker.py`, or also add a `MAIN_URL` Secret.
3. Run: `cd src && uv run python worker.py`. Deploy it with that same command.
4. Add the worker's URL + `/mcp` to `WORKERS` in `src/deploy/mcp-balancer/wrangler.jsonc` (the Cloudflare balancer), and on the main
   server set `MCP_URL=https://mcp.olgtx.com/mcp` in `.env` and restart it. Without the balancer, `MCP_URL` can list the
   workers directly (comma-separated).

Accounts and all other data stay on the main server. If a worker is unreachable, the main server runs the tool itself.
