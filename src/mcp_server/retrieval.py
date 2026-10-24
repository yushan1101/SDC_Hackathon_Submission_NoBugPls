"""Vector lookup (MiniLM embeddings) with metadata filters; offline JSON fallback.

Store: Chroma on disk (default), or pgvector in the shared Postgres database when DATABASE_URL is set, so every app
node searches the same passages and sees a new day's live set at the same moment (it is replaced in one transaction).

Retrieved text is DATA: it is never used as instructions, only displayed/cited.
"""
import json
from pathlib import Path
import logging
import re
import threading
from functools import lru_cache

from mcp_server.ingest import PASSAGES

log = logging.getLogger(__name__)
COLLECTION = "aiversepulse_passages"
LIVE = "aiversepulse_live"
LIVE_MIN_SCORE = 0.5  # cosine; below this a posting/story is not about the occupation  # today's job postings + HN stories, rebuilt on each daily trend refresh
_LOCK = threading.RLock()  # model + Chroma client are shared across agent threads; not safe to init/encode concurrently
READY = threading.Event()  # set once MiniLM is loaded; until then queries use the offline snapshot instead of blocking
BUILDING = threading.Event()  # set while ensure_index() fills the collection, so nobody searches a half-built index
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
        out = _encoder().encode(list(texts), normalize_embeddings=True).tolist()
    READY.set()
    return out


_STARTED = threading.Event()


def warm():
    """Load the encoder (slow first import) off the request path."""
    _STARTED.set()
    _embed(["warm up"])


AUTO_WARM = True  # the API sets this from WARM_ON_START; off = never load the encoder behind a request


def warm_in_background():
    if AUTO_WARM and not _STARTED.is_set():
        _STARTED.set()
        threading.Thread(target=lambda: _safe(warm), daemon=True).start()


def _safe(fn):
    try:
        fn()
    except Exception as e:  # no model / no network: stay on the offline snapshot
        log.warning("encoder warm-up failed (%s); offline retrieval only", type(e).__name__)


# --- pgvector (DATABASE_URL set) ---------------------------------------------------------------------------
VEC_TABLE = """CREATE TABLE IF NOT EXISTS vec_passages(collection TEXT NOT NULL, id TEXT NOT NULL, document TEXT NOT NULL,
    meta JSONB NOT NULL, embedding vector(384) NOT NULL, PRIMARY KEY(collection, id));"""
# ponytail: exact search, no HNSW index: ~20 ms over 20k rows and never misses a match; add
# `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)` (+ hnsw.iterative_scan for filters) past ~200k rows


def _pg():
    """The shared Postgres connection, or None when the app runs on SQLite (then Chroma is the store)."""
    from config.settings import get_settings
    return _pg_con() if get_settings().database_url else None


@lru_cache
def _pg_con():
    from governance.db import connect
    con = connect()
    try:
        con.execute("CREATE EXTENSION IF NOT EXISTS vector")
    except Exception:  # not allowed for this role: fine if an admin already installed it
        log.info("pgvector: CREATE EXTENSION skipped (needs an admin); assuming it is installed")
    con.executescript(VEC_TABLE)
    return con


def _vec(e) -> str:
    return "[" + ",".join(repr(float(x)) for x in e) + "]"


def _pg_count(name: str) -> int:
    with _LOCK:
        return _pg().execute("SELECT count(*) FROM vec_passages WHERE collection=?", (name,)).fetchone()[0]


def _pg_replace(name: str, passages: list[dict]) -> int:
    """Swap a collection's rows in one transaction: other nodes see the old set or the new one, never half."""
    rows = []
    for i in range(0, len(passages), 256):  # embed first, outside the transaction (the slow part)
        part = passages[i:i + 256]
        rows += [(name, p["id"], p["text"], json.dumps({k: p.get(k, "") for k in META_KEYS}), _vec(e))
                 for p, e in zip(part, _embed(p["title"] + ". " + p["text"] for p in part))]
    con = _pg()
    with _LOCK, con:
        con.execute("DELETE FROM vec_passages WHERE collection=?", (name,))
        con.executemany("INSERT INTO vec_passages(collection, id, document, meta, embedding) VALUES(?,?,?,?::jsonb,?::vector) "
                        "ON CONFLICT(collection, id) DO UPDATE SET document=excluded.document, meta=excluded.meta, "
                        "embedding=excluded.embedding", rows)  # upsert: another node may be rebuilding the same set
    return len(rows)


def _pg_query(name: str, query: str, top_k: int, where: dict | None = None) -> list[dict]:
    emb = _vec(_embed([query])[0])
    sql = "SELECT id, document, meta, embedding <=> ?::vector AS dist FROM vec_passages WHERE collection=?"
    args: list = [emb, name]
    if where:
        sql += " AND meta @> ?::jsonb"
        args.append(json.dumps(where))
    with _LOCK:
        rows = _pg().execute(sql + " ORDER BY dist, id LIMIT ?", (*args, top_k)).fetchall()
    return [m | {"id": i, "text": d, "score": round(1 - dist, 4)} for i, d, m, dist in rows]


# --- Chroma (SQLite mode) -------------------------------------------------------------------------------------
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


def ensure_index() -> int:
    """Build the passage index once if it is missing (fresh volume / first container start); else reuse it."""
    try:
        n = _pg_count(COLLECTION) if _pg() else _collection().count()
        if n:
            return n
    except Exception:
        pass
    BUILDING.set()
    try:
        return build_index(offline_passages())
    finally:
        BUILDING.clear()


def build_index(passages: list[dict]) -> int:
    if _pg():
        return _pg_replace(COLLECTION, passages)
    col = _collection(create=True)
    for i in range(0, len(passages), 256):
        part = passages[i:i + 256]
        col.add(ids=[p["id"] for p in part], documents=[p["text"] for p in part],
                embeddings=_embed(p["title"] + ". " + p["text"] for p in part),
                metadatas=[{k: p.get(k, "") for k in META_KEYS} for p in part])
    return col.count()


def live_file() -> Path:
    """Today's live passages, saved beside the database (the persistent volume in Docker) so a restart can re-index them."""
    from config.settings import get_settings
    return Path(get_settings().database_path).parent / "live_passages.json"


def restore_live() -> int:
    """On startup: rebuild the live collection from the saved copy when it is missing (e.g. after a container restart)."""
    if _pg():  # shared database: the set is already there unless this is the first start after moving to Postgres
        n = _pg_count(LIVE)
        return n or (index_live(_live_file_copy()) if _live_file_copy() else 0)
    try:
        with _LOCK:
            return _client().get_collection(LIVE).count()
    except Exception:
        return index_live(live_offline()) if live_offline() else 0


def index_live(passages: list[dict]) -> int:
    """Replace the live collection with today's passages (and keep a JSON copy for the offline fallback)."""
    if _pg():  # the database rows are the copy every node reads, offline fallback included
        return _pg_replace(LIVE, passages)
    live_file().write_text(json.dumps(passages), encoding="utf-8")
    _live_file_copy.cache_clear()
    with _LOCK:
        client = _client()
        try:
            client.delete_collection(LIVE)
        except Exception:
            pass
        col = client.create_collection(LIVE, metadata={"hnsw:space": "cosine"})
    for i in range(0, len(passages), 256):
        part = passages[i:i + 256]
        emb = _embed(p["title"] + ". " + p["text"] for p in part)
        with _LOCK:
            col.add(ids=[p["id"] for p in part], documents=[p["text"] for p in part], embeddings=emb,
                    metadatas=[{k: p.get(k, "") for k in META_KEYS} for p in part])
    return len(passages)


def live_offline() -> list[dict]:
    """Today's live passages without vectors (keyword fallback): from the shared database, else the JSON copy."""
    if _pg():
        with _LOCK:
            rows = _pg().execute("SELECT id, document, meta FROM vec_passages WHERE collection=? ORDER BY id", (LIVE,)).fetchall()
        return [m | {"id": i, "text": d} for i, d, m in rows]
    return _live_file_copy()


@lru_cache
def _live_file_copy() -> list[dict]:
    f = live_file()
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else []


def search_live(query: str, top_k: int = 3) -> tuple[list[dict], str]:
    """Today's postings/stories most similar to the query: vector search, else keyword match on the saved copy."""
    try:
        if not READY.is_set():
            warm_in_background()
            raise RuntimeError("encoder still loading")
        if _pg():
            hits = _pg_query(LIVE, query, max(1, min(top_k, 10)))
        else:
            with _LOCK:
                col = _client().get_collection(LIVE)
            emb = _embed([query])
            with _LOCK:
                r = col.query(query_embeddings=emb, n_results=max(1, min(top_k, 10)))
            hits = [m | {"id": i, "text": d, "score": round(1 - dist, 4)}
                    for i, d, m, dist in zip(r["ids"][0], r["documents"][0], r["metadatas"][0], r["distances"][0])]
        return [h for h in hits if h["score"] >= LIVE_MIN_SCORE], "vector"  # weak matches would mislead as evidence
    except Exception as e:
        log.info("live vector search unavailable (%s); keyword match on today's copy", type(e).__name__)
        words = set(re.findall(r"[a-z0-9]+", query.lower()))
        overlap = lambda p: len(words & set(re.findall(r"[a-z0-9]+", (p["title"] + " " + p["text"]).lower())))
        scored = sorted((p for p in live_offline() if overlap(p) >= 2), key=lambda p: -overlap(p))
        return [p | {"score": None} for p in scored[:top_k]], "offline"


@lru_cache
def offline_passages() -> list[dict]:
    return json.loads(PASSAGES.read_text(encoding="utf-8")) if PASSAGES.exists() else []


def _match(p, where):
    return all(p.get(k) == v for k, v in (where or {}).items())


def search(query: str, where: dict | None = None, top_k: int = 5) -> tuple[list[dict], str]:
    """-> (passages with 'score', retrieval_mode 'vector'|'offline')."""
    top_k = max(1, min(int(top_k), 20))
    try:
        if not READY.is_set():
            warm_in_background()
            raise RuntimeError("encoder still loading")
        if BUILDING.is_set():
            raise RuntimeError("index still building")
        if _pg():
            return _pg_query(COLLECTION, query, top_k, where), "vector"
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
