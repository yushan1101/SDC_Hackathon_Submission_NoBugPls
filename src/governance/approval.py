"""Explicit human approval. Generated -> draft/flagged; edits always create a new draft version.

Dual use: the subject approves their own plan (actor_role='employee'); in HR mode an HR advisor
approves a pseudonymous employee's plan (actor_role='hr_advisor'). Plans are advisory only.
"""
import json
import uuid

from governance.audit import connect, now, snapshot

ACTOR_ROLES = {"employee", "hr_advisor"}


class TransitionError(ValueError):
    pass


def _latest(con, plan_id):
    row = con.execute("SELECT version, status, snapshot FROM plan_versions WHERE plan_id=? "
                      "ORDER BY version DESC LIMIT 1", (plan_id,)).fetchone()
    if not row:
        raise TransitionError(f"unknown plan {plan_id}")
    return row


def _add_version(con, plan_id, version, status, plan: dict):
    snap, sha = snapshot(plan | {"status": status})
    con.execute("INSERT INTO plan_versions VALUES(?,?,?,?,?,?)", (plan_id, version, status, snap, sha, now()))


def _event(con, plan_id, version, actor, role, action, prev, new):
    con.execute("INSERT INTO approval_events(plan_id,version,actor,actor_role,action,prev_status,new_status,at_utc) "
                "VALUES(?,?,?,?,?,?,?,?)", (plan_id, version, actor, role, action, prev, new, now()))


def create(con, plan: dict, subject_id: str, audience: str, issues: list | None = None) -> str:
    status = plan.get("status", "draft")
    if status not in ("draft", "flagged"):
        raise TransitionError("generated plans start as draft or flagged")
    pid = uuid.uuid4().hex[:12]
    with con:
        con.execute("INSERT INTO plans VALUES(?,?,?,?)", (pid, subject_id, audience, now()))
        number = con.execute("SELECT max(number) FROM plan_references").fetchone()[0] or 0
        while con.execute("SELECT 1 FROM plan_reference_overrides o JOIN plans p ON p.plan_id=o.plan_id "
                          "WHERE o.number=? AND NOT EXISTS (SELECT 1 FROM hr_reviews h "
                          "WHERE h.plan_id=p.plan_id AND h.deleted_utc IS NOT NULL)", (number + 1,)).fetchone():
            number += 1
        if number >= 999999:
            raise TransitionError("No six-digit plan IDs are available")
        con.execute("INSERT INTO plan_references(number, plan_id) VALUES(?,?)", (number + 1, pid))
        _add_version(con, pid, 1, status, plan)
        con.execute("INSERT INTO validation_events(plan_id,version,issues,at_utc) VALUES(?,?,?,?)",
                    (pid, 1, json.dumps(issues or [], default=str), now()))
        _event(con, pid, 1, "system", "system", "generated", None, status)
    return pid


def edit(con, plan_id: str, new_plan: dict, actor: str, actor_role: str) -> int:
    """Any edit (including of an approved plan) -> new draft version; old versions untouched."""
    _check_actor(actor, actor_role)
    v, prev, _ = _latest(con, plan_id)
    with con:
        _add_version(con, plan_id, v + 1, "draft", new_plan)
        _event(con, plan_id, v + 1, actor, actor_role, "edited", prev, "draft")
    return v + 1


def approve(con, plan_id: str, version: int, actor: str, actor_role: str, confirmed: bool) -> int:
    """Approve exactly the latest *draft* version. Flagged plans must be edited first."""
    _check_actor(actor, actor_role)
    if confirmed is not True:
        raise TransitionError("approval requires explicit confirmation")
    v, status, snap = _latest(con, plan_id)
    if version != v:
        raise TransitionError(f"stale version {version}; latest is {v}")
    if status != "draft":
        raise TransitionError(f"cannot approve a {status} plan")
    with con:
        _add_version(con, plan_id, v + 1, "approved", json.loads(snap))
        _event(con, plan_id, v + 1, actor, actor_role, "approved", status, "approved")
    return v + 1


def status(con, plan_id: str) -> str:
    return _latest(con, plan_id)[1]


def change_status(con, plan_id: str, user: dict, target: str, version: int, confirmed: bool):
    """Explicit HR transition; retain previous snapshots and the original AI report."""
    if user.get("role") != "hr_advisor":
        raise TransitionError("HR authorization required")
    require(con, plan_id, user)
    if confirmed is not True:
        raise TransitionError("status changes require explicit confirmation")
    if target not in {"draft", "flagged", "approved"}:
        raise TransitionError("invalid plan status")
    v, previous, snap = _latest(con, plan_id)
    if version != v:
        raise TransitionError("Plan changed. Reload before changing its status.")
    if target == previous:
        raise TransitionError("plan already has this status")
    if target == "approved":
        return approve(con, plan_id, version, user["username"], "hr_advisor", confirmed)
    with con:
        _add_version(con, plan_id, v + 1, target, json.loads(snap))
        _event(con, plan_id, v + 1, user["username"], "hr_advisor", "status_changed", previous, target)
    return v + 1


def history(con, plan_id: str) -> list[dict]:
    cols = ["version", "actor", "actor_role", "action", "prev_status", "new_status", "at_utc"]
    rows = con.execute(f"SELECT {','.join(cols)} FROM approval_events WHERE plan_id=? ORDER BY id", (plan_id,))
    return [dict(zip(cols, r)) for r in rows]


def _check_actor(actor, role):
    if not actor or not actor.strip() or role not in ACTOR_ROLES:
        raise TransitionError("a named human actor with role employee|hr_advisor is required")


# --- authorization (enforced here, not only in the UI) ---------------------------------------
def can_act(con, plan_id: str, user: dict) -> bool:
    """employee: only plans about their own employee_id; hr_advisor: only HR-created plans
    (an employee's private self-service plans are never visible to HR)."""
    row = con.execute("SELECT subject_id, audience FROM plans WHERE plan_id=? AND NOT EXISTS "
                      "(SELECT 1 FROM hr_reviews r WHERE r.plan_id=plans.plan_id AND r.deleted_utc IS NOT NULL)",
                      (plan_id,)).fetchone()
    if not row:
        return False
    subject, audience = row
    if user["role"] == "employee":
        return subject == user.get("employee_id")
    return user["role"] == "hr_advisor" and audience == "hr"


def can_view(con, plan_id: str, user: dict) -> bool:
    """can_act, plus read-only for HR: the plans an employee of their organisation (someone they invited) made for
    themself. Every change still goes through can_act, so HR can look at those plans but never edit or approve them."""
    if can_act(con, plan_id, user):
        return True
    return user["role"] == "hr_advisor" and bool(con.execute(
        "SELECT 1 FROM plans p JOIN users u ON u.employee_id=p.subject_id WHERE p.plan_id=? AND p.audience='individual' "
        "AND u.role='employee' AND u.invited_by=?", (plan_id, user["username"])).fetchone())


def require(con, plan_id: str, user: dict):
    if not can_act(con, plan_id, user):
        raise TransitionError("not authorised for this plan")


def list_plans(con, user: dict) -> list[dict]:
    if user["role"] == "employee":
        q, arg = "p.subject_id=?", user.get("employee_id")
    elif user["role"] == "hr_advisor":
        q, arg = "p.audience=?", "hr"
    else:
        return []
    from governance.db import json_text
    rows = con.execute(f"""SELECT p.plan_id, p.subject_id, p.audience, p.created_utc, v.version, v.status,
                               {json_text(con, 'v.snapshot', 'target_role')}, {json_text(con, 'v.snapshot', 'scenario')},
                               (SELECT coalesce(o.number, r.number) FROM plan_references r
                                LEFT JOIN plan_reference_overrides o ON o.plan_id=r.plan_id WHERE r.plan_id=p.plan_id)
                           FROM plans p JOIN plan_versions v ON v.plan_id=p.plan_id
                           WHERE {q} AND NOT EXISTS (SELECT 1 FROM hr_reviews r WHERE r.plan_id=p.plan_id
                               AND r.deleted_utc IS NOT NULL)
                           AND v.version=(SELECT max(version) FROM plan_versions WHERE plan_id=p.plan_id)
                           ORDER BY p.created_utc DESC""", (arg,))
    cols = ["plan_id", "subject_id", "audience", "created_utc", "version", "status", "target_role", "scenario", "plan_reference"]
    return [dict(zip(cols, (*r[:-1], f"P{r[-1]:06d}" if r[-1] is not None else None))) for r in rows]


def delete_employee_plans(con, plan_ids: list[str], user: dict) -> list[str]:
    """Delete selected self-service plans owned by the signed-in employee.

    HR-prepared plans and another employee's plans are intentionally not deletable
    from the employee My plans page. Interview records are retained and detached.
    """
    if user.get("role") != "employee" or not user.get("employee_id"):
        raise TransitionError("only employees can delete their own plans")
    ids = list(dict.fromkeys(plan_ids))
    if not ids or len(ids) > 50:
        raise TransitionError("select between 1 and 50 plans")
    marks = ",".join("?" for _ in ids)
    rows = con.execute(f"SELECT plan_id, subject_id, audience FROM plans WHERE plan_id IN ({marks})", ids).fetchall()
    if len(rows) != len(ids) or any(subject != user["employee_id"] or audience != "individual"
                                    for _, subject, audience in rows):
        raise TransitionError("one or more selected plans cannot be deleted")
    with con:
        # Preserve interview history while removing its optional link to a deleted plan.
        con.execute(f"UPDATE interview_sessions SET plan_id=NULL WHERE plan_id IN ({marks})", ids)
        for table in ("plan_progress", "plan_reports", "plan_versions", "approval_events", "validation_events"):
            con.execute(f"DELETE FROM {table} WHERE plan_id IN ({marks})", ids)
        con.execute(f"DELETE FROM plans WHERE plan_id IN ({marks})", ids)
    return ids


def reference(con, plan_id: str) -> str:
    row = con.execute("SELECT coalesce(o.number, r.number) FROM plan_references r "
                      "LEFT JOIN plan_reference_overrides o ON o.plan_id=r.plan_id WHERE r.plan_id=?", (plan_id,)).fetchone()
    if not row:
        raise TransitionError(f"unknown plan {plan_id}")
    return f"P{row[0]:06d}"


def latest(con, plan_id: str) -> dict:
    v, st, snap = _latest(con, plan_id)
    return {"version": v, "status": st, "plan": json.loads(snap), "plan_reference": reference(con, plan_id)}


def acknowledge(con, plan_id: str, user: dict) -> None:
    """Employee confirms they have seen an HR-approved plan (event only; status unchanged)."""
    require(con, plan_id, user)
    v, st, _ = _latest(con, plan_id)
    if st != "approved":
        raise TransitionError("only approved plans can be acknowledged")
    with con:
        _event(con, plan_id, v, user["username"], "employee", "acknowledged", st, st)
