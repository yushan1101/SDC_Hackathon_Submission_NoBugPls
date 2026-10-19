"""Chroma vector lookup (MiniLM embeddings) with metadata filters; offline JSON fallback.

Retrieved text is DATA: it is never used as instructions, only displayed/cited.
"""
import json
import logging
import re
import threading
from functools import lru_cache

from mcp_server.ingest import PASSAGES

log = logging.getLogger(__name__)
COLLECTION = "aiversepulse_passages"
_LOCK = threading.RLock()  # model + Chroma client are shared across agent threads; not safe to init/encode concurrently
META_KEYS = ("source_id", "title", "publisher", "publication_date", "access_date", "url", "category",
             "jurisdiction", "license", "role_id", "skill_id")


@lru_cache
def _encoder():
    from sentence_transformers import SentenceTransformer
    from forecasting.prompt_encoder import MODEL_ID, MODEL_REVISION
    try:  # cached copy first: avoids slow hub round-trips on every start
        return SentenceTransformer(MODEL_ID, revision=MODEL_REVISION, device="cpu", local_files_only=True)
    except Exception:
        return SentenceTransformer(MODEL_ID, revision=MODEL_REVISION, device="cpu")


def _embed(texts):
    with _LOCK:
        return _encoder().encode(list(texts), normalize_embeddings=True).tolist()


@lru_cache
def _client():
    import chromadb
    from config.settings import get_settings
    return chromadb.PersistentClient(path=get_settings().chroma_path)


def _collection(create=False):
    with _LOCK:
        return _open(create)


def _open(create):
    client = _client()
    if create:
        try:
            client.delete_collection(COLLECTION)
        except Exception:
            pass
        return client.create_collection(COLLECTION, metadata={"hnsw:space": "cosine"})
    return client.get_collection(COLLECTION)


def build_index(passages: list[dict]) -> int:
    col = _collection(create=True)
    for i in range(0, len(passages), 256):
        part = passages[i:i + 256]
        col.add(ids=[p["id"] for p in part], documents=[p["text"] for p in part],
                embeddings=_embed(p["title"] + ". " + p["text"] for p in part),
                metadatas=[{k: p.get(k, "") for k in META_KEYS} for p in part])
    return col.count()


@lru_cache
def offline_passages() -> list[dict]:
    return json.loads(PASSAGES.read_text(encoding="utf-8")) if PASSAGES.exists() else []


def _match(p, where):
    return all(p.get(k) == v for k, v in (where or {}).items())


def search(query: str, where: dict | None = None, top_k: int = 5) -> tuple[list[dict], str]:
    """-> (passages with 'score', retrieval_mode 'vector'|'offline')."""
    top_k = max(1, min(int(top_k), 20))
    try:
        col = _collection()
        flt = None
        if where:
            flt = {"$and": [{k: v} for k, v in where.items()]} if len(where) > 1 else where
        emb = _embed([query])
        with _LOCK:
            r = col.query(query_embeddings=emb, n_results=top_k, where=flt)
        hits = [m | {"id": i, "text": d, "score": round(1 - dist, 4)}
                for i, d, m, dist in zip(r["ids"][0], r["documents"][0], r["metadatas"][0], r["distances"][0])]
        return hits, "vector"
    except Exception as e:  # missing chroma/index/model -> dated local snapshot
        log.warning("vector retrieval unavailable (%s); using offline snapshot", type(e).__name__)
        words = set(re.findall(r"[a-z0-9]+", query.lower()))
        cand = [p for p in offline_passages() if _match(p, where)]
        scored = sorted(cand, key=lambda p: -len(words & set(re.findall(r"[a-z0-9]+", (p["title"] + " " + p["text"]).lower()))))
        return [p | {"score": None} for p in scored[:top_k]], "offline"


def by_filter(where: dict) -> list[dict]:
    """Exact metadata lookup (deterministic; no embedding needed)."""
    return [p for p in offline_passages() if _match(p, where)]
