"""Experimental forecast panel: always labeled a 2023 historical backtest."""
import pandas as pd
import streamlit as st


def show_forecast(f: dict | None):
    if not f:
        return
    st.subheader(f"Experimental forecast: {f.get('skill_id', '')}")
    for w in f.get("warnings", []):
        st.warning(w)
    if not f.get("predicted_percent"):
        return
    pad = [None] * len(f["history"])
    weeks = f["history_weeks"] + f["target_weeks"]
    st.line_chart(pd.DataFrame({"observed %": f["history"] + f["actual"],
                                "forecast %": pad + f["predicted_percent"],
                                "lower %": pad + (f["lower_percent"] or [None] * 4),
                                "upper %": pad + (f["upper_percent"] or [None] * 4)}, index=weeks))
    st.caption(f"Model {f['model_id']} · direction {f['direction']} · as-of {f['as_of_date']} · "
               f"quality {f['data_quality']} · band: {f['interval'] or 'unavailable'}")
