# CPU image: app + in-process FastMCP + Chroma + STF-KAN inference. No GPU needed to serve.
# Build from src/:  docker build -t aiversepulse src
# Layers go slowest-changing first, so a code-only change rebuilds in seconds: torch, the dependencies and MiniLM stay
# cached, and the search index is not built here at all (it is built once into the state volume on first start).
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/app/.hf PYTHONPATH=/app
WORKDIR /app
RUN pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.4"
# dependencies only, read from pyproject.toml: this layer is reused until the dependency list changes
COPY pyproject.toml .
RUN python -c "import tomllib; p = tomllib.load(open('pyproject.toml', 'rb'))['project']; print('\n'.join(p['dependencies'] + p['optional-dependencies']['ai']))" > /tmp/requirements.txt \
 && pip install -r /tmp/requirements.txt
# MiniLM sentence encoder at the pinned revision (forecasting/prompt_encoder.py)
RUN python -c "from sentence_transformers import SentenceTransformer as S; S('sentence-transformers/all-MiniLM-L6-v2', revision='1110a243fdf4706b3f48f1d95db1a4f5529b4d41', device='cpu')"
COPY . .
RUN pip install --no-deps -e . && useradd --create-home app && mkdir -p /app/state && chown -R app /app
USER app
# Only runtime state persists: accounts, plans, audit log, trend history, today's live passages and the vector index.
ENV DATABASE_PATH=/app/state/audit.sqlite3 CHROMA_PATH=/app/state/chroma
VOLUME ["/app/state"]
EXPOSE 8600
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8600/healthz')"
# Web app (public: /  ·  enterprise: /enterprise). Put TLS in front (Secure cookies are set automatically on https).
CMD ["uvicorn", "server.api:app", "--host", "0.0.0.0", "--port", "8600", "--proxy-headers"]
