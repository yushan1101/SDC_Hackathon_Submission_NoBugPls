# CPU image: app + in-process FastMCP + Chroma + STF-KAN inference. No GPU needed to serve.
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/app/.hf PYTHONPATH=/app/src
WORKDIR /app
RUN pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.4"
COPY . .
RUN pip install -e ".[ai]" \
 && python -c "from mcp_server.retrieval import _encoder; _encoder()" \
 && python -m mcp_server.ingest --index-only \
 && useradd --create-home app && chown -R app /app
USER app
# data/ holds the SQLite audit DB: mount a volume so approvals survive restarts
VOLUME ["/app/data"]
EXPOSE 8600
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8600/healthz')"
# Web app (public: /  ·  enterprise: /enterprise). Put TLS in front (Secure cookies are set automatically on https).
CMD ["uvicorn", "server.api:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8600", "--proxy-headers"]
