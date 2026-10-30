"""Sign-in Bloom filter (governance/bloom.py): never a false negative, survives account changes, leaks nothing."""
import random
import string
import threading

import pytest

from governance import accounts, bloom
from governance.audit import connect

PW = "Correct-Horse9"


def _names(n, seed=1):
    rnd = random.Random(seed)
    return {"".join(rnd.choices(string.ascii_lowercase + string.digits, k=12)) for _ in range(n)}


def test_no_false_negatives_and_fp_rate_close_to_target():
    f = bloom.BloomFilter(capacity=5000, fp_rate=0.01)
    members = _names(5000, seed=1)
    for m in members:
        f.add(m)
    assert all(m in f for m in members)  # a Bloom filter never forgets a member
    others = _names(20000, seed=2) - members
    fp = sum(o in f for o in others) / len(others)
    assert fp < 0.03  # ~1 % target; generous bound so the test is not flaky


def test_sizing_and_validation():
    f = bloom.BloomFilter(capacity=10_000, fp_rate=0.001)
    assert f.m >= 140_000 and 8 <= f.k <= 12  # ~14.4 bits/key, ~10 hashes for 0.1 %
    with pytest.raises(ValueError):
        bloom.BloomFilter(capacity=0)
    with pytest.raises(ValueError):
        bloom.BloomFilter(fp_rate=1.5)


def test_keyed_hashing_and_repr_reveal_nothing():
    a, b = bloom.BloomFilter(1000, 0.01), bloom.BloomFilter(1000, 0.01)
    a.add("secret-user")
    b.add("secret-user")
    assert a._bits != b._bits  # random per-process key: positions cannot be precomputed
    assert "secret-user" not in repr(a)
    lf = bloom.LoginFilter(lambda: ["secret-user"])
    lf.rebuild()
    assert "secret-user" not in repr(lf)


def test_login_filter_add_rebuild_and_normalisation():
    store = {"ana", "ana@example.com"}
    lf = bloom.LoginFilter(lambda: list(store), capacity=100, fp_rate=0.001, rebuild_seconds=0)
    assert lf.might_exist("  ANA ") and lf.might_exist("Ana@Example.com")  # same normalisation as authenticate()
    assert not lf.might_exist("nobody-here-xyz")
    assert not lf.might_exist("")
    lf.add("Bob")  # created in-process: visible at once, before any rebuild
    assert lf.might_exist("bob")
    store.add("carol")
    assert not lf.might_exist("carol")  # out-of-band write, no stamp/confirm configured: only a rebuild sees it
    lf.rebuild()
    assert lf.might_exist("carol")
    store.discard("ana")  # deleted account: the next rebuild drops it (before that it is only a false positive)
    lf.rebuild()
    assert lf.might_exist("ana@example.com") and lf.might_exist("carol")


def test_rebuild_grows_with_the_store_without_losing_keys():
    store = set()
    lf = bloom.LoginFilter(lambda: list(store), capacity=10, fp_rate=0.001, rebuild_seconds=0)
    lf.rebuild()
    for i in range(500):
        store.add(f"user{i}")
        lf.add(f"user{i}")
    assert all(lf.might_exist(f"user{i}") for i in range(500))
    lf.rebuild()
    assert lf._filter.m >= bloom.BloomFilter(1000, 0.001).m  # resized for 2 x current keys
    assert all(lf.might_exist(f"user{i}") for i in range(500))


def test_keys_added_during_a_rebuild_are_not_lost():
    started, release = threading.Event(), threading.Event()

    def slow_loader():
        started.set()
        release.wait(5)
        return ["old-user"]  # snapshot taken before "new-user" was created

    lf = bloom.LoginFilter(slow_loader, capacity=100)
    t = threading.Thread(target=lf.rebuild)
    t.start()
    started.wait(5)
    lf.add("new-user")  # account created while the rebuild was loading
    release.set()
    t.join(5)
    assert lf.might_exist("new-user") and lf.might_exist("old-user")


def test_stamp_change_triggers_rebuild_before_saying_no():
    store, version = ["ana"], [1]
    lf = bloom.LoginFilter(lambda: list(store), stamp=lambda: version[0], rebuild_seconds=0)
    lf.rebuild()
    store.append("made-by-cli")
    version[0] += 1  # another process inserted an account
    assert lf.might_exist("made-by-cli")
    assert not lf.might_exist("still-nobody")


def test_confirm_is_asked_only_on_a_miss_and_failures_fail_open():
    calls = []
    lf = bloom.LoginFilter(lambda: ["ana"], confirm=lambda k: calls.append(k) or k == "other-node-user")
    assert lf.might_exist("ana") and calls == []
    assert lf.might_exist("other-node-user") and calls == ["other-node-user"]
    assert not lf.might_exist("nobody")

    def broken(_):
        raise RuntimeError("db down")
    assert bloom.LoginFilter(lambda: ["ana"], confirm=broken).might_exist("nobody")  # unsure -> let it through
    bad = bloom.LoginFilter(lambda: (_ for _ in ()).throw(RuntimeError("db down")))
    assert bad.might_exist("anyone")  # never built -> never rejects
    assert bloom.LoginFilter(lambda: [], enabled=False).might_exist("anyone")


def test_accounts_feed_the_filter_on_create_register_invite():
    con = accounts.init(connect(":memory:"))
    lf = bloom.LoginFilter(lambda: [r for row in con.execute("SELECT username, email FROM users") for r in row if r],
                           rebuild_seconds=0)
    lf.rebuild()
    accounts.on_login_keys(lf.add)
    try:
        accounts.create_user(con, "ana", PW, "employee", "E-001")
        accounts.register(con, "selfie1", "Selfie1@Example.com", PW, "individual")
        accounts.invite(con, "hr1", "joiner@example.com")
        accounts.note_login_keys("changed@example.com")  # e.g. a confirmed email change
        for login in ("ana", "selfie1", "selfie1@example.com", "joiner", "joiner@example.com", "changed@example.com"):
            assert lf.might_exist(login), login
    finally:
        accounts._LOGIN_KEY_LISTENERS.remove(lf.add)


def test_no_false_negatives_against_a_real_store():
    con = accounts.init(connect(":memory:"))
    with con:
        con.executemany("INSERT INTO users(username,email,status) VALUES(?,?,'active')",
                        [(f"u{i}", f"u{i}@example.com") for i in range(3000)])
    lf = bloom.LoginFilter(lambda: [r for row in con.execute("SELECT username, email FROM users") for r in row if r],
                           capacity=100, fp_rate=0.001)
    lf.rebuild()
    assert all(lf.might_exist(f"u{i}") and lf.might_exist(f"U{i}@Example.com") for i in range(3000))
