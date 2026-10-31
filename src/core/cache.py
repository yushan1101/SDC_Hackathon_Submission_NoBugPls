"""A small JSON result cache: Redis when REDIS_URL is set (shared by every app node, survives restarts), else a dict in
this process. Used for results that are expensive to recompute and the same for the same input, such as a résumé
analysis keyed by the file's hash. A cache outage never breaks the caller: get() then misses and set() does nothing."""
import json
import logging
import threading
import time

log = logging.getLogger(__name__)
_client = None
_local: dict[str, tuple[float, str]] = {}  # ponytail: no eviction beyond expiry; fine for one process, use Redis to share
_lock = threading.Lock()


def _redis():
    global _client
    from config.settings import get_settings
    url = get_settings().redis_url
    if not url:
        return None
    if _client is None:
        import redis
        _client = redis.Redis.from_url(url, socket_timeout=2, socket_connect_timeout=2, decode_responses=True)
    return _client


def get(key: str):
    try:
        r = _redis()
        if r is not None:
            raw = r.get(key)
        else:
            with _lock:
                expires, raw = _local.get(key, (0.0, None))
            raw = raw if expires > time.time() else None
        return json.loads(raw) if raw else None
    except Exception as e:  # noqa: BLE001 - a cache outage is a miss, never an error for the person
        log.warning("cache get failed: %s", type(e).__name__)
        return None


def set(key: str, value, ttl_s: int = 7 * 24 * 3600) -> None:  # noqa: A001 - mirrors the Redis verb
    try:
        raw = json.dumps(value, default=str)
        r = _redis()
        if r is not None:
            r.set(key, raw, ex=ttl_s)
        else:
            with _lock:
                _local[key] = (time.time() + ttl_s, raw)
    except Exception as e:  # noqa: BLE001
        log.warning("cache set failed: %s", type(e).__name__)
