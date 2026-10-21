"""Application entry point: starts the AiversePulse web app (public site + HR console + API).

    python src/main.py                 # http://localhost:8600   (HR console: /enterprise)
    PORT=8080 python src/main.py       # Replit / any host that assigns a port

Everything the app needs lives next to this file in src/: the agent packages (agents/, core/, mcp_server/,
server/, ...), the static frontend web/, data/ and scripts/.
"""
import os
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent


def main() -> None:
    os.chdir(SRC)  # data/ (database, snapshots) is resolved relative to src/
    sys.path.insert(0, str(SRC))
    import uvicorn
    from config.settings import get_settings
    s = get_settings()
    uvicorn.run("server.api:app", host=s.host, port=s.port,
                proxy_headers=True, forwarded_allow_ips="*")


if __name__ == "__main__":
    main()
