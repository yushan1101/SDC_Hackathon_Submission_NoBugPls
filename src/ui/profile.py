"""Employee self-service intake -> validated Request."""
import uuid

import pandas as pd
import streamlit as st
from pydantic import ValidationError

from core.state import Profile, Request, Skill


def intake(roles: list[str], scenario: str, employee_id: str) -> Request | None:
    role = st.selectbox("Target occupation (O*NET)", roles, index=roles.index("Registered Nurses") if "Registered Nurses" in roles else 0)
    st.caption("Skills: rate yourself 0 (none) to 5 (expert).")
    skills = st.data_editor(pd.DataFrame([{"name": "Critical Thinking", "level": 2}, {"name": "Speaking", "level": 3}]),
                            num_rows="dynamic", key="skills",
                            column_config={"level": st.column_config.NumberColumn(min_value=0, max_value=5, step=1)})
    hours = st.number_input("Hours per week for learning", 0.5, 80.0, 6.0)
    query = st.text_input("What do you need?", "Analyze my skill gaps and create a 30-60-90 day plan")
    if not st.button("Run analysis", type="primary"):
        return None
    try:
        rows = [r for r in skills.dropna().to_dict("records") if str(r["name"]).strip()]
        return Request(request_id=uuid.uuid4().hex[:8], audience="individual", employee_id=employee_id,
                       profile=Profile(skills=[Skill(name=str(r["name"])[:60], level=int(r["level"])) for r in rows],
                                       weekly_learning_hours=hours),
                       target_role=role, scenario=scenario, query=query[:500])
    except (ValidationError, ValueError) as e:
        st.error(f"Please fix the profile: {e}")
        return None
