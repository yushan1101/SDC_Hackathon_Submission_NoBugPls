"""Every ESCO occupation's ISCO sub-major group has a job-family icon (web/js/jobicons.js), and every icon is drawn."""
import json
import re
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "src" / "web" / "js" / "jobicons.js"
OCC = Path(__file__).resolve().parents[1] / "src" / "data" / "snapshots" / "esco_occupations.json"


def test_every_occupation_group_has_a_drawn_family_icon():
    js = WEB.read_text(encoding="utf-8")
    family = dict(re.findall(r'"(\d\d)": \["(\w+)"', js))
    drawn = set(re.findall(r"^\s+(\w+): \"M", js, re.M))
    groups = {code[:2] for code in json.loads(OCC.read_text(encoding="utf-8"))["occupations"]}
    assert groups <= set(family), f"no family for {sorted(groups - set(family))}"
    assert set(family.values()) <= drawn, f"icons not drawn: {set(family.values()) - drawn}"
