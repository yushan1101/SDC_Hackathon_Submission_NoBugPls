"""Application entry point: starts the AiversePulse web app (public site + HR console + API).

    python src/main.py                 # http://localhost:8600   (HR console: /enterprise)
    PORT=8080 python src/main.py       # Replit / any host that assigns a port

The multi-agent system lives in the packages next to this file (agents/, core/, mcp_server/, server/, ...);
the static frontend is web/ at the repository root.
"""
import os
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent
ROOT = SRC.parent


def main() -> None:
    os.chdir(ROOT)  # data/ and web/ are resolved from the repository root
    sys.path.insert(0, str(SRC))
    import uvicorn
    uvicorn.run("server.api:app", host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", "8600")),
                proxy_headers=True, forwarded_allow_ips="*")


if __name__ == "__main__":
    main()
