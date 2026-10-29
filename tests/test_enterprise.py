"""Enterprises (company or school), full profiles, the monthly enterprise subscription, and the admin's per-enterprise
models and bills."""
import os

import pytest

PW = "Correct-Horse9"
H = {"X-AP": "1"}


@pytest.fixture(scope="module")
def env(tmp_path_factory):
    os.environ["DATABASE_PATH"] = str(tmp_path_factory.mktemp("db") / "audit.sqlite3")
    os.environ["SIGNALS_DAILY"] = "0"
    from config.settings import get_settings
    get_settings.cache_clear()
    from fastapi.testclient import TestClient
    import server.api as api
    from governance import accounts
    accounts.create_user(api.db, "school1", PW, "hr_advisor")
    accounts.create_user(api.db, "stud1", PW, "employee", "S-001")
    accounts.create_user(api.db, "boss", PW, "admin")
    with api.db:
        api.db.execute("UPDATE users SET invited_by='school1', email='stud1@uni.test' WHERE username='stud1'")
        api.db.execute("UPDATE users SET email='hr@uni.test' WHERE username='school1'")
    yield api, TestClient(api.app)
    os.environ.pop("DATABASE_PATH", None)
    get_settings.cache_clear()


def login(c, user):
    c.cookies.clear()
    assert c.post("/api/login", json={"username": user, "password": PW}, headers=H).status_code == 200


def test_school_members_are_students_and_profiles_save(env):
    api, c = env
    login(c, "school1")
    r = c.post("/api/profile", json={"org_name": "Uni Malaya", "org_kind": "school", "phone": "+60 12-345 6789", "title": "Career office"}, headers=H)
    assert r.status_code == 200 and r.json()["enterprise"]["members_label"] == "Students"
    assert c.post("/api/profile", json={"phone": "call me"}, headers=H).status_code == 422
    login(c, "stud1")
    me = c.get("/api/me").json()
    assert me["enterprise"]["name"] == "Uni Malaya" and me["enterprise"]["member_label"] == "Student"
    assert "phone" in me["profile"]["missing"] and not me["profile"]["complete"]
    assert c.post("/api/profile", json={"org_kind": "company"}, headers=H).json()["enterprise"]["kind"] == "school"  # members can't change it


def test_email_change_waits_for_the_link(env, monkeypatch):
    api, c = env
    from governance import otp
    sent = {}
    monkeypatch.setattr(otp.mailer, "send", lambda cfg, to, *a, **k: sent.update(to=to, link=a[4]) or True)
    login(c, "stud1")
    assert c.post("/api/profile/email", json={"email": "hr@uni.test"}, headers=H).status_code == 422  # taken
    assert c.post("/api/profile/email", json={"email": "new@uni.test"}, headers=H).json()["pending"] == "new@uni.test"
    assert sent["to"] == "new@uni.test" and c.get("/api/me").json()["email"] == "stud1@uni.test"  # unchanged until confirmed
    user, token = sent["link"].rsplit("/", 2)[-2:]
    assert c.post("/api/profile/email/verify", json={"username": user, "token": token}, headers=H).json()["email"] == "new@uni.test"
    assert c.post("/api/profile/email/verify", json={"username": user, "token": token}, headers=H).status_code == 400  # used up


def test_avatar_goes_to_r2_and_is_private(env, monkeypatch):
    api, c = env
    from governance import enterprise
    store = {}

    class R:
        def __init__(self, code, content=b"", ct="image/png"):
            self.status_code, self.content, self.headers = code, content, {"content-type": ct}

    def fake(cfg, method, key, body=b"", content_type=None):
        if method == "PUT":
            store[key] = body
            return R(200)
        if method == "GET":
            return R(200, store[key]) if key in store else R(404)
        store.pop(key, None)
        return R(204)
    monkeypatch.setattr(enterprise, "_r2", fake)
    monkeypatch.setattr(enterprise, "r2_configured", lambda cfg: True)
    login(c, "stud1")
    assert c.post("/api/profile/avatar", files={"file": ("x.png", b"not an image", "image/png")}, headers=H).status_code == 422
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    prof = c.post("/api/profile/avatar", files={"file": ("me.png", png, "image/png")}, headers=H).json()
    assert prof["avatar_url"] == "/api/avatar/stud1" and len(store) == 1 and next(iter(store)).startswith("aiversepulse/avatars/stud1-")
    assert c.get("/api/avatar/stud1").content == png
    login(c, "school1")
    assert c.get("/api/avatar/stud1").status_code == 200  # same enterprise
    api.accounts.create_user(api.db, "outsider", PW, "employee", "X-9")
    login(c, "outsider")
    assert c.get("/api/avatar/stud1").status_code == 404


def test_subscription_activates_the_month_and_records_the_payment(env):
    api, c = env
    from governance import accounts, billing
    sub = {"id": "sub_1", "customer": "cus_1", "status": "active", "current_period_end": 4102444800, "cancel_at_period_end": False,
           "currency": "myr", "metadata": {"username": "school1", "plan": "team"}, "items": {"data": [{"price": {"unit_amount": 9900}}]},
           "latest_invoice": {"id": "in_1", "status": "paid", "amount_paid": 9900, "currency": "myr", "created": int(__import__("time").time()),
                              "payment_intent": {"id": "pi_1"}}}
    with api.DB_LOCK:
        r = billing.sync_subscription(api.db, api.cfg, sub)
        billing.sync_subscription(api.db, api.cfg, sub)  # the webhook repeats it: still one payment row
    assert r["activated"] and accounts.account(api.db, "school1")["effective_plan"] == "team"
    assert [p["amount_cents"] for p in billing.payments(api.db, "school1")] == [9900]
    with pytest.raises(billing.BillingError):
        billing.sync_subscription(api.db, api.cfg, sub, expected_user="stud1")


def test_admin_sees_bills_and_sets_models_per_enterprise(env, monkeypatch):
    api, c = env
    with api.db:
        api.db.execute("INSERT INTO llm_usage(at_utc,username,feature,node,model,calls,input_tokens,output_tokens,est_usd) "
                       "VALUES(datetime('now'),'stud1','coach','n','m',3,100,50,0.02)")
        api.db.execute("INSERT INTO model_catalog(spec,label,created_utc) VALUES('openai:gpt-test','GPT test','now') ON CONFLICT DO NOTHING")
    login(c, "school1")
    assert c.get("/api/admin/enterprises").status_code == 403
    login(c, "boss")
    ent = next(e for e in c.get("/api/admin/enterprises").json()["enterprises"] if e["owner"] == "school1")
    assert (ent["kind"], ent["members"], ent["ai_calls"], ent["paid_cents"]) == ("school", 1, 3, 9900)
    bill = c.get("/api/admin/enterprises/school1/bill").json()
    assert bill["usage"][0]["username"] == "stud1" and bill["ai_usd"] == 0.02
    assert c.post("/api/admin/enterprises/school1/models", json={"task": "nope", "spec": ""}, headers=H).status_code == 422
    monkeypatch.setattr(api.llm, "usable", lambda spec: True)
    r = c.post("/api/admin/enterprises/school1/models", json={"task": "coach", "spec": "openai:gpt-test"}, headers=H)
    assert r.status_code == 200 and r.json()["models"] == {"coach": "openai:gpt-test"}
    assert c.post("/api/admin/enterprises/school1/models", json={"task": "coach", "spec": ""}, headers=H).json()["models"] == {}
