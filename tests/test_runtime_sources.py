"""The live system reads public sources only: O*NET, its release history and the 2023 job ads are training data.

Every file opened while the agents run is checked; any training file fails the test."""
import builtins
import io
import pathlib
import zipfile

import pytest

TRAINING = ("onet", "data/raw", "data/training", "weekly_skill_demand", "db_31_0", "data_jobs")


@pytest.fixture
def no_training_reads(monkeypatch):
    seen = []

    def check(path):
        p = pathlib.Path(str(path)).as_posix().lower()
        seen.append(p)
        assert not any(t in p for t in TRAINING), f"live process opened training data: {p}"

    real_open, real_io_open, real_zip = builtins.open, io.open, zipfile.ZipFile.__init__

    def g_open(file, *a, **k):
        check(file)
        return real_open(file, *a, **k)

    def g_io(file, *a, **k):
        check(file)
        return real_io_open(file, *a, **k)

    def g_zip(self, file, *a, **k):
        check(file)
        return real_zip(self, file, *a, **k)
    monkeypatch.setattr(builtins, "open", g_open)
    monkeypatch.setattr(io, "open", g_io)
    monkeypatch.setattr(zipfile.ZipFile, "__init__", g_zip)
    real_read = pathlib.Path.read_text
    monkeypatch.setattr(pathlib.Path, "read_text", lambda self, *a, **k: (check(self), real_read(self, *a, **k))[1])
    return seen


def test_live_snapshot_is_esco():
    from mcp_server.ingest import SNAPSHOT
    from mcp_server.server import OUTLOOK
    assert "esco" in SNAPSHOT.name and "esco" in OUTLOOK.name


def test_agents_never_read_training_data(no_training_reads):
    from agents.knowledge import resolve_occupation
    from agents.matcher import match_roles
    from core.graph import run
    from core.screening import screen
    from core.state import Profile, Request, Skill
    soc = resolve_occupation("nurse responsible for general care")
    s = run(Request(request_id="t", target_role=soc, scenario="agentic", query="Analyze my skill gaps and create a plan",
                    profile=Profile(weekly_learning_hours=6, skills=[Skill(name="listen actively", level=3)])))
    assert s["skill_gaps"] and all(e.id.split(":")[0] in ("esco", "learn", "stfkan", "signal", "sdg") for e in s["evidence"])
    assert match_roles({"administer medication": 3, "listen actively": 3}, 3)
    screen("cv.md", b"# Sam\n\nNurse. Administered medication and monitored patients.", soc, {})
