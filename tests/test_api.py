import json
import os

import pytest

PW = "Correct-Horse9"


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    os.environ["DATABASE_PATH"] = str(tmp_path_factory.mktemp("db") / "audit.sqlite3")
    os.environ["SIGNALS_DAILY"] = "0"  # no network fetches in tests
    from config.settings import get_settings
    get_settings.cache_clear()
    from fastapi.testclient import TestClient
    import server.api as api
    from governance import accounts
    accounts.create_user(api.db, "ana", PW, "employee", "E-001")
    accounts.create_user(api.db, "hr1", PW, "hr_advisor")
    yield TestClient(api.app)
    os.environ.pop("DATABASE_PATH", None)
    get_settings.cache_clear()


def login(c, user):
    c.cookies.clear()
    r = c.post("/api/login", json={"username": user, "password": PW}, headers={"X-AP": "1"})
    assert r.status_code == 200
    return r


def events(resp):
    return [json.loads(line[6:]) for line in resp.text.splitlines() if line.startswith("data: ")]


def test_auth_csrf_and_headers(client):
    assert client.get("/api/me").status_code == 401
    assert client.post("/api/login", json={"username": "ana", "password": PW}).status_code == 403  # no X-AP header
    assert client.post("/api/login", json={"username": "ana", "password": "nope"}, headers={"X-AP": "1"}).status_code == 401
    r = login(client, "ana")
    assert "httponly" in r.headers["set-cookie"].lower() and "samesite=strict" in r.headers["set-cookie"].lower()
    assert client.get("/api/me").json()["employee_id"] == "E-001"
    assert "frame-ancestors 'none'" in client.get("/").headers["content-security-policy"]


def test_public_stream_and_approval(client):
    login(client, "ana")
    body = {"target_role": "29-1141.00", "scenario": "assistive", "weekly_learning_hours": 6,
            "skills": [{"name": "communication", "level": 3}, {"name": "Critical Thinking", "level": 2}]}
    assert client.post("/api/analyze", json={**body, "target_role": "Astronaut chef"}, headers={"X-AP": "1"}).status_code == 422
    ev = events(client.post("/api/analyze", json=body, headers={"X-AP": "1"}))
    kinds = [e["t"] for e in ev]
    agents = [e["node"] for e in ev if e["t"] == "agent"]
    assert {"supervisor", "profiler", "knowledge_search", "market_analyst", "gap_analysis", "pathway", "coach", "reviewer"} <= set(agents)
    # verified text streams only after every agent finished; sections follow the text
    assert kinds.index("meta") > max(i for i, k in enumerate(kinds) if k == "agent")
    assert kinds.index("text") > kinds.index("meta") and kinds[-1] == "done"
    text = "".join(e["delta"] for e in ev if e["t"] == "text")
    known = {x["id"] for x in next(e for e in ev if e["t"] == "meta")["evidence"]}
    import re
    assert all(c in known for c in re.findall(r"\[([^\[\]]{3,120})\]", text))
    meta_ev = next(e for e in ev if e["t"] == "meta")["evidence"]
    assert all(e["id"].split(":")[0] in ("onet", "learn", "stfkan", "signal", "sdg") for e in meta_ev)  # no 2023 job-ad evidence
    pid = ev[-1]["plan_id"]
    assert client.post(f"/api/plans/{pid}/approve", json={"version": 1, "confirmed": False}, headers={"X-AP": "1"}).status_code == 409
    assert client.post(f"/api/plans/{pid}/approve", json={"version": 1, "confirmed": True}, headers={"X-AP": "1"}).json()["status"] == "approved"
    # HR can never open an employee's private plan
    login(client, "hr1")
    assert client.get(f"/api/plans/{pid}").status_code == 404
    assert client.post("/api/analyze", json=body, headers={"X-AP": "1"}).status_code == 403


def test_team_stream_ticks_and_validation(client):
    login(client, "hr1")
    bad = client.post("/api/team", json={"csv": "employee_id,target_role\nx@y.com,Data Analyst", "scenario": "assistive"},
                      headers={"X-AP": "1"})
    assert bad.status_code == 422 and bad.json()["errors"]
    csv = client.get("/api/sample-team").json()["csv"]
    ev = events(client.post("/api/team", json={"csv": csv, "scenario": "agentic"}, headers={"X-AP": "1"}))
    roster = next(e for e in ev if e["t"] == "roster")["ids"]
    done = [e for e in ev if e["t"] == "employee"]
    assert sorted(e["id"] for e in done) == sorted(roster)
    for eid in roster:  # every employee ticked through the reviewer before its result
        ticks = [e["node"] for e in ev if e["t"] == "tick" and e["id"] == eid]
        assert "reviewer" in ticks
    assert ev[-1]["t"] == "done"
    pid = done[0]["plan_id"]
    d = client.get(f"/api/plans/{pid}").json()
    assert d["audience"] == "hr" and d["report"]["gaps"]
    login(client, "ana")  # E-001 sees the HR plan made for them, not the others
    mine = {p["subject_id"] for p in client.get("/api/plans").json()}
    assert mine == {"E-001"}


H = {"X-AP": "1"}
RESUME = open("data/samples/sample_resume_nurse.md", "rb").read()


def test_quiz_resume_and_match(client):
    login(client, "ana")
    q = client.get("/api/quiz").json()
    assert len(q["questions"]) >= 10 and any(f["id"] == "health" for f in q["fields"])
    answers = {x["id"]: 2 for x in q["questions"]}
    r = client.post("/api/quiz/score", json={"answers": answers, "fields": ["health"]}, headers=H).json()
    assert r["matches"] and all(m["soc"][:2] in ("29", "31", "21") for m in r["matches"])
    assert all(1 <= m["sdgs"][0]["goal"] <= 17 for m in r["matches"] if m["sdgs"])
    r = client.post("/api/resume/analyze", files={"file": ("cv.md", RESUME, "text/markdown")}, headers=H).json()
    assert "## Summary" in r["markdown"] and all(s["evidence"] for s in r["skills"])
    assert any("Nurse" in m["title"] for m in r["matches"][:4])
    big = client.post("/api/resume/analyze", files={"file": ("cv.txt", b"x" * 2_100_000)}, headers=H)
    assert big.status_code == 413
    assert client.get("/api/signals/today").status_code == 200  # empty board is a valid, labelled state


def test_recruiting_flow_blind_review_and_human_decision(client):
    login(client, "ana")
    assert client.post("/api/openings", json={"soc": "29-1141.00"}, headers=H).status_code == 403  # HR only
    login(client, "hr1")
    bad = client.post("/api/openings", json={"soc": "29-1141.00", "criteria_text": "young women only"}, headers=H)
    assert bad.status_code == 422  # protected characteristics refused
    p = client.post("/api/criteria/parse", json={"text": "top 1, must know Epic, 3+ years"}, headers=H).json()
    assert p["criteria"]["top_k"] == 1 and p["criteria"]["min_years"] == 3
    o = client.post("/api/openings", json={"soc": "29-1141.00", "criteria_text": "top 1, must know Epic, 3+ years"},
                    headers=H).json()
    client.cookies.clear()
    info = client.get(f"/api/apply/{o['token']}").json()
    assert info["occupation"] == "Registered Nurses"
    form = {"name": "Test Person", "email": "t@example.com", "consent": "true"}
    nope = client.post(f"/api/apply/{o['token']}", data=form | {"consent": "false"},
                       files={"file": ("cv.md", RESUME)}, headers=H)
    assert nope.status_code == 422
    ok = client.post(f"/api/apply/{o['token']}", data=form, files={"file": ("cv.md", RESUME)}, headers=H)
    assert ok.status_code == 200
    weak = b"# Sam\n\nRetail assistant. Customer service, cash handling."
    client.post(f"/api/apply/{o['token']}", data=form, files={"file": ("cv.md", weak)}, headers=H)
    login(client, "hr1")
    d = client.get(f"/api/openings/{o['id']}").json()
    top, other = d["candidates"]
    assert top["recommended"] and top["rank"] == 1 and not other["recommended"] and "misses" in other["reason"]
    assert "contact" not in top and "Test Person" not in top["redacted_md"]  # blind until a human shortlists
    assert client.post(f"/api/applications/{top['id']}/decision", json={"decision": "shortlisted"}, headers=H).status_code == 200
    d = client.get(f"/api/openings/{o['id']}").json()
    assert d["candidates"][0]["contact"]["email"] == "t@example.com"
    assert any(e["action"] == "human_shortlisted" and e["actor"] == "hr1" for e in d["events"])
    r = client.post(f"/api/openings/{o['id']}/criteria", json={"text": "top 2, match above 99%"}, headers=H).json()
    assert r["rescreened"] == 2
    assert not any(c["recommended"] for c in client.get(f"/api/openings/{o['id']}").json()["candidates"])
