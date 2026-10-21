"""Plan review: edit (re-validated), explicit approval, acknowledgement, audit timeline."""
import pandas as pd
import streamlit as st

from core.state import Pathway
from governance import approval
from validation.revision import validate


def save_draft(db, result: dict, subject_id: str, audience: str) -> str:
    p = result["draft_pathway"]
    return approval.create(db, p.model_dump(), subject_id, audience, [i.model_dump() for i in result["validation_issues"]])


def review(db, plan_id: str, user: dict, result: dict | None = None, ns: str = "main"):
    """result (optional): the run that produced the plan, used to re-validate edits."""
    try:
        approval.require(db, plan_id, user)
    except approval.TransitionError as e:
        st.error(str(e))
        return
    cur = approval.latest(db, plan_id)
    plan = cur["plan"]
    st.subheader(f"30/60/90 plan · v{cur['version']} · {cur['status'].upper()}")
    if plan.get("deferred_skills"):
        st.caption("Not fully covered by available hours: " + ", ".join(plan["deferred_skills"]))
    role = "hr_advisor" if user["role"] == "hr_advisor" else "employee"
    edited = st.data_editor(pd.DataFrame(plan["activities"]), hide_index=True, key=f"{ns}-ed-{plan_id}-{cur['version']}",
                            disabled=["evidence_ids", "sdg_links", "skill_id"],
                            column_config={"day_range": st.column_config.SelectboxColumn(options=["1-30", "31-60", "61-90"]),
                                           "estimated_hours": st.column_config.NumberColumn(min_value=0.5, max_value=200)})
    c1, c2 = st.columns(2)
    if c1.button("Save edits as new draft", key=f"{ns}-save-{plan_id}"):
        new = Pathway(**{**plan, "activities": edited.to_dict("records"), "status": "draft"})
        if result:
            errs = [i for i in validate(new, result["skill_gaps"], {e.id for e in result["evidence"]},
                                        result["request"].profile.weekly_learning_hours) if i.severity == "error"]
            if errs:
                for i in errs:
                    st.error(f"{i.code}: {i.message}")
                st.stop()
        v = approval.edit(db, plan_id, new.model_dump(), user["username"], role)
        st.success(f"Saved draft v{v}")
        st.rerun()
    if cur["status"] == "draft":
        ok = c2.checkbox("I have reviewed this plan and approve it", key=f"{ns}-conf-{plan_id}")
        if c2.button("Approve", key=f"{ns}-appr-{plan_id}", disabled=not ok, type="primary"):
            try:
                v = approval.approve(db, plan_id, cur["version"], user["username"], role, ok)
                st.success(f"Approved as v{v}")
                st.rerun()
            except approval.TransitionError as e:
                st.error(str(e))
    elif cur["status"] == "flagged":
        c2.warning("Flagged: fix the issues and save a new draft before approval.")
    elif user["role"] == "employee" and plan_audience(db, plan_id) == "hr":
        if c2.button("Acknowledge this plan", key=f"{ns}-ack-{plan_id}"):
            approval.acknowledge(db, plan_id, user)
            st.success("Acknowledged")
    with st.expander("Audit history"):
        st.dataframe(pd.DataFrame(approval.history(db, plan_id)), hide_index=True)


def plan_audience(db, plan_id):
    return db.execute("SELECT audience FROM plans WHERE plan_id=?", (plan_id,)).fetchone()[0]
