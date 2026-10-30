"""Bloom filter in front of sign-in: a cheap "this login definitely does not exist" answer.

/api/login asks LoginFilter.might_exist() first. A "no" is certain (Bloom filters have no false negatives), so the
request is answered without the app-wide DB lock and without the real password hash: it burns the same scrypt work on
a dummy hash instead and gets exactly the same 401 as a wrong password, so neither the body, the status nor (as far
as practical) the timing tells an attacker which usernames or emails exist. A "maybe" goes through the normal path.

Correctness (no false negatives) as accounts change:
  - built at startup from the accounts store (usernames, emails and pending email changes);
  - every in-process write that adds a login key calls accounts.note_login_keys() (create / register / invite /
    demo bootstrap / confirmed email change), which adds it here at once;
  - deletes and renames only leave stale bits (= extra false positives), cleared by the periodic rebuild
    (LOGIN_BLOOM_REBUILD_SECONDS, default 300);
  - writes by another process (CLI, another app node on the shared Postgres) are caught before a "no" is given:
    `stamp` (SQLite: MAX(rowid) of users, read on a private connection) triggers a rebuild when it moved since the
    last build, and/or `confirm` (Postgres: an indexed existence lookup on a private connection) double-checks the
    miss. Neither takes the app-wide DB lock or hashes a password.
The filter is sized for max(2 x current keys, LOGIN_BLOOM_CAPACITY) at LOGIN_BLOOM_FP_RATE (default 0.1 %) and is
resized on rebuild. Positions come from a keyed BLAKE2b with a random per-process key, so nobody can precompute
colliding names. Contents are never logged; only counts and sizes are.
"""
from __future__ import annotations

import hashlib
import logging
import math
import os
import threading
import time
from typing import Callable, Iterable

log = logging.getLogger(__name__)


def normalize(login: str | None) -> str:
    """The same normalisation accounts.authenticate() applies: usernames are stored lower-case, emails compared lower()."""
    return (login or "").strip().lower()


class BloomFilter:
    """Plain Bloom filter over str keys (bytearray of bits, Kirsch-Mitzenmacher double hashing)."""

    __slots__ = ("m", "k", "_bits", "_key", "count")

    def __init__(self, capacity: int = 10_000, fp_rate: float = 0.001, key: bytes | None = None):
        if capacity < 1:
            raise ValueError("capacity must be >= 1")
        if not 0 < fp_rate < 1:
            raise ValueError("fp_rate must be between 0 and 1")
        self.m = max(64, int(math.ceil(-capacity * math.log(fp_rate) / (math.log(2) ** 2))))  # bits
        self.k = max(1, int(round(self.m / capacity * math.log(2))))  # hash functions
        self._bits = bytearray((self.m + 7) // 8)
        self._key = key or os.urandom(16)
        self.count = 0  # keys added (with repeats), for sizing only

    def _positions(self, item: str):
        d = hashlib.blake2b(item.encode("utf-8"), digest_size=16, key=self._key).digest()
        h1, h2 = int.from_bytes(d[:8], "little"), int.from_bytes(d[8:], "little") | 1
        return ((h1 + i * h2) % self.m for i in range(self.k))

    def add(self, item: str) -> None:
        for p in self._positions(item):
            self._bits[p >> 3] |= 1 << (p & 7)
        self.count += 1

    def __contains__(self, item: str) -> bool:
        return all(self._bits[p >> 3] & (1 << (p & 7)) for p in self._positions(item))

    def __repr__(self) -> str:  # never print the bits or keys
        return f"<BloomFilter m={self.m} k={self.k} n~{self.count}>"


class LoginFilter:
    """Thread-safe login-name filter that can be rebuilt from the accounts store while it is in use.

    loader()  -> iterable of login keys (usernames and emails) currently in the store.
    stamp()   -> cheap value that changes whenever another process may have added keys (checked on a miss only).
    confirm(key) -> True if the key may exist after all (called only on a filter miss); None = trust the filter.
    """

    def __init__(self, loader: Callable[[], Iterable[str]], capacity: int = 10_000, fp_rate: float = 0.001,
                 rebuild_seconds: float = 300.0, stamp: Callable[[], object] | None = None,
                 confirm: Callable[[str], bool] | None = None, enabled: bool = True):
        self.loader, self.capacity, self.fp_rate = loader, max(1, int(capacity)), float(fp_rate)
        self.rebuild_seconds, self.stamp, self.confirm, self.enabled = float(rebuild_seconds), stamp, confirm, enabled
        self._stamp: object = None
        self._lock = threading.Lock()  # guards _filter swaps and _pending; never held while loading or hashing
        self._filter: BloomFilter | None = None
        self._pending: list[str] | None = None  # keys added while a rebuild is loading, replayed into the new filter
        self._built_at = 0.0
        self._rebuilding = threading.Lock()

    @property
    def ready(self) -> bool:
        return self._filter is not None

    def rebuild(self, wait: bool = False) -> None:
        """Load all keys and atomically swap in a freshly sized filter. Keys added meanwhile are not lost.
        wait=False: return at once if another thread is already rebuilding (the current filter stays usable)."""
        if not self._rebuilding.acquire(blocking=wait):
            return
        try:
            with self._lock:
                self._pending = []
            try:
                stamp = self.stamp() if self.stamp else None  # read before loading: a write during the load moves it again
                keys = [k for k in (normalize(x) for x in self.loader()) if k]
            except Exception:
                with self._lock:
                    self._pending = None
                log.exception("login filter rebuild failed; keeping the previous filter")
                return
            new = BloomFilter(max(self.capacity, 2 * len(keys)), self.fp_rate)
            for k in keys:
                new.add(k)
            with self._lock:
                for k in self._pending or ():
                    new.add(k)
                self._filter, self._pending, self._built_at, self._stamp = new, None, time.monotonic(), stamp
            log.info("login filter rebuilt: %d keys, %d bits, %d hashes", len(keys), new.m, new.k)  # counts only
        finally:
            self._rebuilding.release()

    def add(self, *keys: str | None) -> None:
        with self._lock:
            for key in keys:
                k = normalize(key)
                if not k:
                    continue
                if self._filter is not None:
                    self._filter.add(k)
                if self._pending is not None:
                    self._pending.append(k)

    def _stale(self) -> bool:
        return self.rebuild_seconds > 0 and time.monotonic() - self._built_at > self.rebuild_seconds

    def might_exist(self, login: str | None) -> bool:
        """False only when the login certainly does not exist. Fails open (True) whenever unsure."""
        if not self.enabled:
            return True
        if self._filter is None or self._stale():
            self.rebuild()
        f = self._filter
        if f is None:  # never managed to build: do not reject anyone
            return True
        k = normalize(login)
        if not k:
            return False  # an empty login can never match an account
        if k in f:
            return True
        try:
            if self.stamp is not None and (seen := self.stamp()) != self._stamp:  # someone else added accounts: catch up
                self.rebuild(wait=True)
                if self._stamp != seen or k in self._filter:  # rebuild failed or raced with another write: fail open
                    return True
        except Exception:
            log.exception("login filter stamp check failed; failing open")
            return True
        if self.confirm is not None:
            try:
                return bool(self.confirm(k))
            except Exception:
                log.exception("login filter confirm failed; failing open")
                return True
        return False

    def __repr__(self) -> str:
        return f"<LoginFilter enabled={self.enabled} {self._filter!r}>"
