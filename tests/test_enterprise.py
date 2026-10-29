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


def test_stripe_webhook_needs_its_signature_not_the_csrf_header(env, monkeypatch):
    """Stripe can't send X-AP: the webhook is exempt from the CSRF header and is checked by its signature instead."""
    import hashlib, hmac, json, time
    from pydantic import SecretStr
    api, c = env
    monkeypatch.setattr(api.cfg, "stripe_webhook_secret", SecretStr("whsec_test"))
    body = json.dumps({"type": "ping.test", "data": {"object": {}}}).encode()
    t = str(int(time.time()))
    sig = hmac.new(b"whsec_test", f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    ok = c.post("/api/billing/webhook", content=body, headers={"stripe-signature": f"t={t},v1={sig}"})
    assert ok.status_code == 200 and ok.json() == {"received": True}
    assert c.post("/api/billing/webhook", content=body, headers={"stripe-signature": f"t={t},v1=deadbeef"}).status_code == 400
    assert c.post("/api/profile", json={"phone": "123456"}).status_code == 403  # every other POST still needs X-AP


def test_admin_lists_gateway_models_and_hr_assigns_one_per_person(env, monkeypatch):
    api, c = env
    monkeypatch.setattr(api.llm, "providers", lambda: {"openai": True, "gemini": False})
    monkeypatch.setattr(api.llm, "gateway_models", lambda refresh=False: ["gpt-test", "grok-mini"])
    monkeypatch.setattr(api.llm, "usable", lambda spec: True)
    login(c, "boss")
    g = c.get("/api/admin/models/gateway").json()
    assert g["reachable"] and {m["id"]: m["in_catalog"] for m in g["models"]} == {"gpt-test": True, "grok-mini": False}
    assert c.post("/api/admin/models", json={"spec": "openai:grok-mini", "label": "Grok mini"}, headers=H).status_code == 200
    with api.db:
        api.db.execute("INSERT INTO org_models(owner, task, spec) VALUES('school1','coach','openai:gpt-test') ON CONFLICT(owner, task) DO UPDATE SET spec=excluded.spec")

    login(c, "school1")
    d = c.get("/api/org/members/models").json()
    assert d["label"] == "Students" and [m["username"] for m in d["members"]] == ["stud1"]
    assert {o["spec"] for o in d["options"]} >= {"openai:gpt-test", "openai:grok-mini"}
    assert c.post("/api/org/members/stud1/models", json={"task": "coach", "spec": "openai:not-in-catalog"}, headers=H).status_code == 422
    assert c.post("/api/org/members/outsider/models", json={"task": "coach", "spec": "openai:grok-mini"}, headers=H).status_code == 404
    assert c.post("/api/org/members/stud1/models", json={"task": "coach", "spec": "openai:grok-mini"}, headers=H).json()["models"] == {"coach": "openai:grok-mini"}

    # the student's own model wins over the enterprise's; HR keeps the enterprise's
    login(c, "stud1")
    assert api._org_models(c.cookies.get(api.COOKIE))["coach"] == "openai:grok-mini"
    login(c, "school1")
    assert api._org_models(c.cookies.get(api.COOKIE))["coach"] == "openai:gpt-test"
    assert c.post("/api/org/members/stud1/models", json={"task": "coach", "spec": ""}, headers=H).json()["models"] == {}


def test_hr_usage_ring_counts_the_whole_enterprise_this_month(env, monkeypatch):
    api, c = env
    monkeypatch.setattr(api.cfg, "enterprise_ai_budget_usd", 0.10)
    login(c, "school1")
    u = c.get("/api/org/usage").json()
    assert u["calls"] >= 3 and u["ai_usd"] >= 0.02 and 0 <= u["left_pct"] <= 80 and u["budget_usd"] == 0.10
    assert u["subscription"]["status"] == "active" and u["resets_in_days"] >= 1
    login(c, "stud1")
    assert c.get("/api/org/usage").status_code == 403
