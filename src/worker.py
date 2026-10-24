"""Worker node: serves the MCP tools (occupation search, embeddings, STF-KAN outlook) to the main node over HTTP.

    python src/worker.py        # Replit: add one Secret, NODE_TOKEN (same value as on the main node). Nothing else.

At boot it pulls its settings from the main node (GET /internal/node-config, see server/api.py WORKER_KEYS), then
answers only requests that carry the same NODE_TOKEN. On the main node, add this worker's URL + "/mcp" to MCP_URL
(comma-separated for several workers). If a worker is down, the main node runs the tool itself.
"""
import os
import secrets
import sys
from pathlib import Path

import httpx

SRC = Path(__file__).resolve().parent
MAIN_URL = "https://aiversepulse.olgtx.com"  # the main node; MAIN_URL in the environment overrides it
OPEN_PATHS = {"/", "/healthz"}  # host health checks (Replit probes "/"), no data


def pull_config(main_url: str, token: str) -> dict:
    r = httpx.get(f"{main_url.rstrip('/')}/internal/node-config", headers={"Authorization": f"Bearer {token}"},
                  timeout=20, follow_redirects=True)
    r.raise_for_status()  # 404 = wrong NODE_TOKEN or the main node has none set
    return r.json()


class RequireToken:
    """ASGI middleware: every request except the health check must send "Authorization: Bearer <NODE_TOKEN>"."""

    def __init__(self, app, token: str):
        self.app, self.expected = app, f"Bearer {token}".encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            if scope["path"] in OPEN_PATHS:
                return await _reply(send, 200, b"ok")
            sent = dict(scope["headers"]).get(b"authorization", b"")
            if not secrets.compare_digest(sent, self.expected):
                return await _reply(send, 401, b"unauthorized")
        await self.app(scope, receive, send)


async def _reply(send, status: int, body: bytes):
    await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"text/plain")]})
    await send({"type": "http.response.body", "body": body})


def main() -> None:
    os.chdir(SRC)
    sys.path.insert(0, str(SRC))
    from config.settings import Settings, get_settings
    boot = Settings()  # only NODE_TOKEN / MAIN_URL / PORT come from this machine
    if not boot.node_token:
        sys.exit("NODE_TOKEN is not set (Replit: Tools > Secrets)")
    token = boot.node_token.get_secret_value()
    for k, v in pull_config(boot.main_url or MAIN_URL, token).items():
        os.environ.setdefault(k, v)  # a value set on this machine still wins
    s = get_settings()

    import uvicorn
    from mcp_server.server import mcp
    # stateless: no MCP session pinned to this process, so a balancer can send each request to any worker
    app = RequireToken(mcp.http_app(path="/mcp", stateless_http=True), token)
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT") or s.mcp_port),
                proxy_headers=True, forwarded_allow_ips="*")


if __name__ == "__main__":
    main()
