import json
import os

import pytest

PW = "Correct-Horse9"


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    os.environ["DATABASE_PATH"] = str(tmp_path_factory.mktemp("db") / "audit.sqlite3")
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
    assert all(e["id"].split(":")[0] in ("onet", "learn", "stfkan") for e in meta_ev)  # no 2023 job-ad evidence
    pid = ev[-1]["plan_id"]
    assert client.post(f"/api/plans/{pid}/approve", json={"version": 1, "confirmed": False}, headers={"X-AP": "1"}).status_code == 409
    assert client.post(f"/api/plans/{pid}/approve", json={"version": 1, "confirmed": True}, headers={"X-AP": "1"}).json()["status"] == "approved"
    import server.api as api
    before = client.get(f"/api/plans/{pid}").json()
    api.RESULTS.clear()  # simulate restart/cache eviction after approval
    reopened = client.get(f"/api/plans/{pid}").json()
    assert reopened["status"] == "approved"
    assert reopened["report"] == before["report"]
    assert reopened["report"]["narrative"] == text
    assert reopened["report"]["gaps"]
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
