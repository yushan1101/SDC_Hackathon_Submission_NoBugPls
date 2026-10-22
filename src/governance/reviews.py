"""HR-only review metadata. AI snapshots/reports and subject access IDs are never edited here."""
import json

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
        allowed = set(FIELDS[:5])
        if set(changes) - allowed or changes.get("review_status") not in {"pending", "approved", "rejected"}:
            raise approval.TransitionError("Invalid review fields or status")
        return _save(con, pid, user, "edited", before, before | changes)


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
