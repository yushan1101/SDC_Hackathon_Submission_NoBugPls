"""HR review metadata and audited employee ID corrections; AI snapshots remain immutable."""
import json
import re

from governance import approval
from governance.audit import now

FIELDS = ("candidate_name", "candidate_email", "candidate_phone", "reviewer_notes", "review_status",
          "archived", "deleted_utc", "revision")


def get(con, pid):
    row = con.execute(f"SELECT {','.join(FIELDS)} FROM hr_reviews WHERE plan_id=?", (pid,)).fetchone()
    data = dict(zip(FIELDS, row)) if row else dict(zip(FIELDS, ("", "", "", "", None, 0, None, 0)))
    data["review_status"] = data["review_status"] or (
        "approved" if approval.status(con, pid) == "approved" else "pending")
    data["archived"] = bool(data["archived"])
    return data


def require(con, pid, user):
    if user.get("role") != "hr_advisor":
        raise approval.TransitionError("HR authorization required")
    approval.require(con, pid, user)


def history(con, pid):
    return [dict(actor=r[0], action=r[1], before=json.loads(r[2]), after=json.loads(r[3]), at_utc=r[4])
            for r in con.execute("SELECT actor,action,before_json,after_json,at_utc FROM hr_review_events "
                                 "WHERE plan_id=? ORDER BY id", (pid,))]


def _save(con, pid, user, action, before, after):
    after = after | {"revision": before["revision"] + 1}
    con.execute(f"INSERT OR REPLACE INTO hr_reviews(plan_id,{','.join(FIELDS)}) "
                f"VALUES({','.join('?' for _ in range(len(FIELDS) + 1))})",
                (pid, *(after[k] for k in FIELDS)))
    con.execute("INSERT INTO hr_review_events(plan_id,actor,action,before_json,after_json,at_utc) "
                "VALUES(?,?,?,?,?,?)", (pid, user["username"], action, json.dumps(before), json.dumps(after), now()))
    return after


def edit(con, pid, user, changes, revision):
    with con:
        require(con, pid, user)
        before = get(con, pid)
        if before["revision"] != revision:
            raise approval.TransitionError("Review changed. Reload before saving.")
        changes = dict(changes)
        employee_id = changes.pop("employee_id", None)
        plan_reference = changes.pop("plan_reference", None)
        allowed = set(FIELDS[:5])
        if set(changes) - allowed or changes.get("review_status") not in {"pending", "approved", "rejected"}:
            raise approval.TransitionError("Invalid review fields or status")
        after = before | changes
        if employee_id is not None:
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", employee_id):
                raise approval.TransitionError("Employee ID must contain 1–32 letters, numbers, hyphens or underscores")
            previous_id = con.execute("SELECT subject_id FROM plans WHERE plan_id=?", (pid,)).fetchone()[0]
            if employee_id != previous_id and con.execute(
                    "SELECT 1 FROM plans p WHERE subject_id=? AND plan_id<>? AND NOT EXISTS "
                    "(SELECT 1 FROM hr_reviews r WHERE r.plan_id=p.plan_id AND r.deleted_utc IS NOT NULL)",
                    (employee_id, pid)).fetchone():
                raise approval.TransitionError("Employee ID is already used by another current plan. Please choose a different ID.")
            before = before | {"employee_id": previous_id}
            after = after | {"employee_id": employee_id}
            con.execute("UPDATE plans SET subject_id=? WHERE plan_id=?", (employee_id, pid))
            # Reserve numeric IDs so a later analysis cannot reuse an edited ID.
            if match := re.fullmatch(r"E-(\d+)", employee_id):
                number = int(match.group(1))
                if number <= 9223372036854775806:
                    con.execute("INSERT OR IGNORE INTO analysis_employee_ids(number) VALUES(?)", (number,))
        if plan_reference is not None:
            if not re.fullmatch(r"P[0-9]{6}", plan_reference):
                raise approval.TransitionError("Plan ID must be P followed by six digits, for example P000123")
            number = int(plan_reference[1:])
            if con.execute(
                    "SELECT 1 FROM plans p JOIN plan_references r ON r.plan_id=p.plan_id "
                    "LEFT JOIN plan_reference_overrides o ON o.plan_id=p.plan_id "
                    "WHERE coalesce(o.number, r.number)=? AND p.plan_id<>? AND NOT EXISTS "
                    "(SELECT 1 FROM hr_reviews h WHERE h.plan_id=p.plan_id AND h.deleted_utc IS NOT NULL)",
                    (number, pid)).fetchone():
                raise approval.TransitionError("Plan ID is already used by another current plan. Please choose a different ID.")
            before = before | {"plan_reference": approval.reference(con, pid)}
            after = after | {"plan_reference": plan_reference}
            con.execute("INSERT OR REPLACE INTO plan_reference_overrides(plan_id, number) VALUES(?,?)", (pid, number))
        return _save(con, pid, user, "edited", before, after)


def bulk(con, ids, user, action, confirmed=False):
    ids = list(dict.fromkeys(ids))
    if not 1 <= len(ids) <= 50 or action not in {"archive", "restore", "delete"}:
        raise approval.TransitionError("Select 1–50 reviews and a valid action")
    if action == "delete" and confirmed is not True:
        raise approval.TransitionError("Deletion requires explicit confirmation")
    with con:
        # Authorize the entire selection before changing anything.
        for pid in ids:
            require(con, pid, user)
        for pid in ids:
            before = get(con, pid)
            changes = {"deleted_utc": now()} if action == "delete" else {"archived": action == "archive"}
            _save(con, pid, user, action, before, before | changes)
    return ids
