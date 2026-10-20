"""HR team analysis (Streamlit): aggregated needs view. Parsing lives in core/team_import.py."""
import json

import pandas as pd
import streamlit as st

from core.team_import import COLUMNS, EMP_ID, parse_team  # noqa: F401  (re-exported for app.py/tests)


def show_team(t: dict):
    st.subheader("Team training priorities (aggregated; people are not ranked)")
    need = pd.DataFrame(t["team_skill_needs"])
    if need.empty:
        st.info("No gaps found for this team.")
        return
    st.bar_chart(need.set_index("skill_id")["employees_with_gap"])
    st.dataframe(need, hide_index=True)
    if t["flagged"]:
        st.warning(f"Flagged drafts needing manual review: {', '.join(t['flagged'])}")
    st.download_button("Download team summary (JSON)", json.dumps(t["team_skill_needs"], indent=1),
                       "team_skill_needs.json", mime="application/json")
