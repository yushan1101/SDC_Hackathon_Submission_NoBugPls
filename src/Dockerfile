# CPU image: app + in-process FastMCP + Chroma + STF-KAN inference. No GPU needed to serve.
# Build from src/:  docker build -t aiversepulse src
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/app/.hf PYTHONPATH=/app
WORKDIR /app
RUN pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.4"
COPY . .
RUN pip install -e ".[ai]" \
 && python -c "from mcp_server.retrieval import _encoder; _encoder()" \
 && python -m mcp_server.ingest --index-only \
 && useradd --create-home app && mkdir -p /app/state && chown -R app /app
USER app
# Only runtime state persists (accounts, plans, audit log, trend history, today's live passages). data/ stays part of the
# image, so a rebuild always ships fresh ESCO snapshots and search index instead of a stale copy kept in a volume.
ENV DATABASE_PATH=/app/state/audit.sqlite3
VOLUME ["/app/state"]
EXPOSE 8600
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8600/healthz')"
# Web app (public: /  ·  enterprise: /enterprise). Put TLS in front (Secure cookies are set automatically on https).
CMD ["uvicorn", "server.api:app", "--host", "0.0.0.0", "--port", "8600", "--proxy-headers"]
