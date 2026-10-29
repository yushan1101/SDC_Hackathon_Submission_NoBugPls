"""Export a reskilling plan as a Markdown and/or HTML report with diagrams.

    python scripts/plan_report.py --plan-id 703f936fa962 --format both --out reports/
    python scripts/plan_report.py --input plan.json --diagrams timeline,deps --no-ai

--input takes either a ReskillPlan JSON (see diagrams.ReskillPlan) or a saved report (/api/plans/<id> "report").
"""
import argparse
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from diagrams import ALL, ReskillPlan, build, enrich, from_report  # noqa: E402
from diagrams.render import markdown, page  # noqa: E402


def load(args) -> ReskillPlan:
    if args.input:
        data = json.loads(Path(args.input).read_text(encoding="utf-8"))
        data = data.get("report", data) if "learner" not in data else data
        return ReskillPlan(**data) if "learner" in data else from_report(data)
    import os
    os.chdir(Path(__file__).resolve().parents[1])  # data/ paths are relative to src/
    from governance import approval
    from governance.audit import connect
    con = connect()
    row = con.execute("SELECT report FROM plan_reports WHERE plan_id=?", (args.plan_id,)).fetchone()
    created = con.execute("SELECT created_utc FROM plans WHERE plan_id=?", (args.plan_id,)).fetchone()
    if not row or not created:
        raise SystemExit(f"No saved report for plan {args.plan_id}.")
    latest = approval.latest(con, args.plan_id)["plan"]  # the edited/approved version, if any
    return from_report(json.loads(row[0]), latest, date.fromisoformat(created[0][:10]))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--plan-id", help="a saved plan in the app's database")
    src.add_argument("--input", help="a ReskillPlan or saved-report JSON file")
    ap.add_argument("--format", choices=("md", "html", "both"), default="both")
    ap.add_argument("--diagrams", default="all", help=f"all, or a comma list of: {','.join(ALL)}")
    ap.add_argument("--no-ai", action="store_true", help="skip the LLM call for skill categories and prerequisites")
    ap.add_argument("--out", default="reports", help="output folder")
    args = ap.parse_args(argv)
    which = None if args.diagrams == "all" else [d.strip() for d in args.diagrams.split(",") if d.strip()]
    if which and (bad := [d for d in which if d not in ALL]):
        ap.error(f"unknown diagram(s): {', '.join(bad)}")
    plan, note = load(args), ""
    if not args.no_ai:
        plan, note = enrich(plan)
    diagrams = build(plan, which)
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    name = "plan-" + "".join(c if c.isalnum() else "-" for c in (args.plan_id or Path(args.input).stem))
    for fmt in ("md", "html") if args.format == "both" else (args.format,):
        path = out / f"{name}.{fmt}"
        path.write_text(markdown(plan, diagrams, [note]) if fmt == "md" else page(plan, diagrams, [note]), encoding="utf-8")
        print(path)


if __name__ == "__main__":
    main()
