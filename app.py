"""AiversePulse Enterprise - multi-agent reskilling decision support for employees and HR advisors."""
import threading
import time

import pandas as pd
import streamlit as st

from agents.gap_analyst import SCENARIO_NOTES
from agents.knowledge import resolve_occupation, snapshot
from config.settings import get_settings
from core.graph import run, run_team
from governance import accounts, approval
from governance.audit import connect
from ui import profile, results, review, team

SESSION_IDLE_MINUTES = 30
st.set_page_config(page_title="AiversePulse Enterprise", layout="wide")
cfg = get_settings()


@st.cache_resource
def _db():
    return accounts.init(connect(cfg.database_path))


@st.cache_resource
def _warm():  # load MiniLM + Chroma once per server process, off the request path
    def go():
        try:
            from mcp_server.retrieval import warm
            warm()
        except Exception:
            pass
    threading.Thread(target=go, daemon=True).start()
    return True


db, _ = _db(), _warm()
ROLES = sorted(o["title"] for o in snapshot()["occupations"].values())  # every rated O*NET occupation


def login():
    st.title("AiversePulse Enterprise")
    st.caption("Sign in. Accounts are created by an administrator (`python -m governance.accounts create ...`).")
    with st.form("login"):
        u = st.text_input("Username")
        p = st.text_input("Password", type="password")
        if st.form_submit_button("Sign in", type="primary"):
            try:
                st.session_state.user = accounts.authenticate(db, u, p, cfg.login_max_failures, cfg.login_lock_minutes)
                st.session_state.seen = time.time()
                st.rerun()
            except accounts.AuthError as e:
                st.error(str(e))


user = st.session_state.get("user")
if user and time.time() - st.session_state.get("seen", 0) > SESSION_IDLE_MINUTES * 60:
    st.session_state.clear()
    user = None
if not user:
    login()
    st.stop()
st.session_state.seen = time.time()
st.session_state.setdefault("results", {})

with st.sidebar:
    st.markdown(f"**{user['display_name']}** · {user['role'].replace('_', ' ')}")
    if st.button("Sign out"):
        st.session_state.clear()
        st.rerun()
    scenario = st.radio("AI scenario", ["assistive", "agentic"], format_func=str.title)
    st.caption(SCENARIO_NOTES[scenario])
    st.caption(f"LLM agents: {'on (' + cfg.llm_fast_model + ')' if cfg.llm_enabled else 'off (deterministic)'}")
    st.divider()
    st.caption("Decision support only. Not for hiring, firing or performance decisions. "
               "Every plan stays a draft until a named human approves it.")


def keep(result, subject, audience):
    pid = review.save_draft(db, result, subject, audience)
    st.session_state.results[pid] = result
    return pid


def plan_list(title):
    plans = approval.list_plans(db, user)
    st.subheader(title)
    if not plans:
        st.info("No plans yet.")
        return
    st.dataframe(pd.DataFrame(plans), hide_index=True)
    pid = st.selectbox("Open plan", [p["plan_id"] for p in plans],
                       format_func=lambda k: next(f"{p['subject_id']} · {p['target_role']} · v{p['version']} {p['status']}"
                                                  for p in plans if p["plan_id"] == k))
    review.review(db, pid, user, st.session_state.results.get(pid), ns="list")


st.title("AiversePulse Enterprise")
if user["role"] == "employee":
    tab_new, tab_mine = st.tabs(["New analysis", "My plans"])
    with tab_new:
        req = profile.intake(ROLES, scenario, user["employee_id"])
        if req:
            with st.spinner("Agents working..."):
                s = run(req)
            st.session_state.last = s
            st.session_state.last_pid = keep(s, user["employee_id"], "individual") if s["route"] == "complex" else None
        if s := st.session_state.get("last"):
            results.show_result(s)
            if st.session_state.get("last_pid"):
                review.review(db, st.session_state.last_pid, user, s)
    with tab_mine:
        plan_list("My plans (self-service and plans HR prepared for you)")

elif user["role"] == "hr_advisor":
    tab_team, tab_plans = st.tabs(["Team analysis", "Team plans"])
    with tab_team:
        st.caption("Pseudonymous employee IDs only. CSV columns: " + ", ".join(team.COLUMNS))
        up = st.file_uploader("Team CSV", type="csv")
        df = pd.read_csv(up) if up else pd.read_csv("data/samples/sample_team.csv")
        if not up:
            st.caption("Showing the bundled fictional sample team.")
        st.dataframe(df.head(200), hide_index=True, height=180)
        if st.button("Analyze team", type="primary"):
            reqs, errs = team.parse_team(df, resolve_occupation, scenario, cfg.max_upload_rows, cfg.max_team_size)
            for e in errs:
                st.error(e)
            if reqs:
                with st.spinner(f"Running {len(reqs)} multi-agent analyses in parallel..."):
                    t = run_team(reqs)
                t["plan_ids"] = {eid: keep(s, eid, "hr") for eid, s in t["employees"].items()}
                st.session_state.team = t
        if t := st.session_state.get("team"):
            team.show_team(t)
            emp = st.selectbox("Review an employee's draft", list(t["employees"]))
            results.show_result(t["employees"][emp])
            review.review(db, t["plan_ids"][emp], user, t["employees"][emp])
    with tab_plans:
        plan_list("Plans prepared by HR")
else:
    st.info("Admin accounts manage users from the command line: `python -m governance.accounts create --help`.")
