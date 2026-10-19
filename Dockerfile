# CPU image: app + in-process FastMCP + Chroma + STF-KAN inference. No GPU needed to serve.
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/app/.hf
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
EXPOSE 8501
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8501/_stcore/health')"
CMD ["streamlit", "run", "app.py", "--server.port=8501", "--server.address=0.0.0.0", "--server.maxUploadSize=5", "--server.enableXsrfProtection=true", "--browser.gatherUsageStats=false"]
