"""Account deletion (self-service). One transaction: personal data is deleted; records the service must keep
(payments for accounting, security and AI-cost totals) are kept but no longer linked to the person. The Privacy
Policy (web/js/legal.js) describes exactly this, so change both together.

Deleted:    login, email, password hash, sessions, pending email codes, the person's own plans (reports, chat
            conversations, versions, progress), interview sessions/answers/reports/access records, briefing count.
Anonymised: payments, risk/security events, sign-in events, AI token-use records, approval history entries.
Kept as-is: plans HR made about a pseudonymous employee id and job openings (the organisation's records; an
            HR advisor's openings lose their owner name).
"""
import hashlib


class DeletionError(ValueError):
    pass


def _tables(con) -> set:
    return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def delete_account(con, username: str) -> dict:
    row = con.execute("SELECT role, employee_id, account_type FROM users WHERE username=?", (username,)).fetchone()
    if not row:
        raise DeletionError("no such account")
    role, employee_id, _ = row
    if role == "admin":
        raise DeletionError("admin accounts are removed from the command line")
    alias = "deleted-" + hashlib.sha256(username.encode()).hexdigest()[:10]  # stable, not reversible
    have = _tables(con)
    counts: dict[str, int] = {}
    with con:
        # the person's own plans (never HR plans about a pseudonymous employee)
        own = [r[0] for r in con.execute("SELECT plan_id FROM plans WHERE subject_id=? AND audience='individual'", (employee_id,))] \
            if employee_id else []
        if own:
            marks = ",".join("?" * len(own))
            if "interview_sessions" in have:
                con.execute(f"UPDATE interview_sessions SET plan_id=NULL WHERE plan_id IN ({marks})", own)
            for t in ("plan_progress", "plan_reports", "plan_versions", "approval_events", "validation_events"):
                if t in have:
                    con.execute(f"DELETE FROM {t} WHERE plan_id IN ({marks})", own)
            counts["plans"] = con.execute(f"DELETE FROM plans WHERE plan_id IN ({marks})", own).rowcount
        # interviews belong to the employee id
        if employee_id and "interview_sessions" in have:
            ids = [r[0] for r in con.execute("SELECT interview_id FROM interview_sessions WHERE employee_id=?", (employee_id,))]
            if ids:
                marks = ",".join("?" * len(ids))
                for t in ("interview_questions", "interview_responses", "interview_reports"):
                    if t in have:
                        con.execute(f"DELETE FROM {t} WHERE interview_id IN ({marks})", ids)
            counts["interviews"] = con.execute("DELETE FROM interview_sessions WHERE employee_id=?", (employee_id,)).rowcount
            for t in ("interview_access_assessments", "interview_access_recommendations"):
                if t in have:
                    con.execute(f"DELETE FROM {t} WHERE employee_id=?", (employee_id,))
        # sign-in and verification state
        for t, col, val in (("sessions", "username", username), ("email_otp", "username", username),
                            ("email_otp", "username", "reset:" + username), ("signup_waits", "username", username),
                            ("briefing_log", "username", username)):
            if t in have:
                con.execute(f"DELETE FROM {t} WHERE {col}=?", (val,))
        # records kept for accounting, security and cost: no longer linked to the person
        for t, col in (("payments", "username"), ("risk_events", "username"), ("auth_events", "username"),
                       ("llm_usage", "username"), ("approval_events", "actor"), ("openings", "owner")):
            if t in have:
                counts[f"anonymised_{t}"] = con.execute(f"UPDATE {t} SET {col}=? WHERE {col}=?", (alias, username)).rowcount
        con.execute("DELETE FROM users WHERE username=?", (username,))
    return counts
