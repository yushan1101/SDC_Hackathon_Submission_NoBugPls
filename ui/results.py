"""Results: route trace, Coach explanation, gap matrix, scenario comparison, cited evidence."""
import pandas as pd
import streamlit as st

from core.usage import summarize


def show_result(s: dict):
    u = summarize(s.get("usage", []))
    st.caption(f"Route **{s['route']}** ({s['route_reason']}) · agents {u['nodes']} · LLM calls {u['llm_calls']} · "
               f"tokens {u['input_tokens']}+{u['output_tokens']} · {u['ms']:.0f} ms")
    if s["route"] != "complex":
        st.info(s.get("answer", ""))
        for e in s.get("evidence", [])[:5]:
            st.markdown(f"- [{e.title}]({e.url}) · {e.publication_date}")
        return
    for i in s.get("validation_issues", []):
        (st.error if i.severity == "error" else st.warning)(f"{i.code}: {i.message}")
    if s.get("narrative"):
        st.markdown(f"**Summary** ({'AI-written, citations verified' if s.get('narrative_mode') == 'llm' else 'template'})")
        st.markdown(s["narrative"].replace("*", r"\*").replace("[", r"\["))

    c1, c2 = st.columns([3, 2])
    with c1:
        st.subheader("Skill gaps")
        flags = s.get("skill_flags", {})
        st.dataframe(pd.DataFrame([{**g.model_dump(include={"skill_id", "current_level", "required_level", "gap",
                                                            "mention_percent"}),
                                    "onet_hot": flags.get(g.skill_id, {}).get("onet_hot", False)}
                                   for g in s.get("skill_gaps", [])]), hide_index=True)
        st.subheader("Assistive vs Agentic AI")
        st.dataframe(pd.DataFrame(s.get("scenario_comparison", [])), hide_index=True)
        st.caption("Agentic levels are a documented team assumption, not evidence.")
    with c2:
        st.subheader("Evidence")
        for e in s.get("evidence", [])[:12]:
            st.markdown(f"- [{e.title}]({e.url})  \n  {e.publisher} · published {e.publication_date} · "
                        f"accessed {e.access_date or 'n/a'}  \n  _{e.excerpt[:220]}_")
        st.caption(f"Retrieval: {s.get('retrieval', {}).get('retrieval_mode', 'n/a')}")
