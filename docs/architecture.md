# Architecture (v0.3, 2026-10-20)

> Current roles, features and system diagram: the Mermaid diagram in the [README](../README.md#architecture) (original PlantUML: [architecture.puml](architecture.puml)). The notes below record the v0.3 design history.

v0.3: every O*NET occupation; requirements from O*NET 31.0; no training data at runtime; STF-KAN (trained on the
O*NET release history) feeds the Market Analyst through an exported outlook asset (`skill_outlook` MCP tool);
graph = supervisor -> {profiler || knowledge_search || market_analyst} -> gap_analysis -> pathway -> coach -> reviewer.


```text
Streamlit (login, role-based: employee | hr_advisor)          FastMCP server (in-process or MCP_URL / --http)
   |  employee: self-service plan, my plans, acknowledge          search_labor_trends   search_role_skills
   |  hr:       team CSV -> parallel runs, team plans               retrieve_learning_resources   forecast_skill_demand
   v                                                                   |-> Chroma (MiniLM vectors) | offline JSON snapshot
LangGraph multi-agent graph (src/core/graph.py)                           |-> STF-KAN checkpoint | baseline
   supervisor --simple/unsupported--> simple_lookup
       | complex: fan-out
   profiler || knowledge_search(MCP) -> gap_analysis (both scenarios)
       -> market_analyst(MCP forecast) || pathway(+learning via MCP) -> coach (template | Gemini) -> reviewer
governance/: SQLite plans, immutable versions (trigger), approval/auth events, scrypt accounts, authorization
```

- **Agents are deterministic by default** (0 LLM calls). With `GEMINI_API_KEY` + `LLM_FAST_MODEL` set, the
  Coach rewrites the summary and the supervisor classifies ambiguous queries; tokens are provider-reported.
- **Reviewer** = schema/evidence/math/capacity/forecast checks, <=2 targeted repairs (pathway + narrative
  citations), unresolved -> `flagged`. An agent exception becomes an `agent_error` issue, never a crash.
- **Authorization** lives in `src/governance/approval.py` (`can_act`), not only in the UI: HR never sees an
  employee's self-service plans; employees only see plans for their own pseudonymous `employee_id`.
- **Forecasting**: STF-KAN = Time-KAN + parameter-free RFFT harmonic branch + MiniLM projection + linear AR
  anchor (ridge-initialised), quality-gated fusion, one head; interval = validation error quantiles.
  Inputs pool the matching global series and weekly ad counts. Served model chosen on validation only.

## Deviations from SDLC v1.1 (recorded here per section 13)
- Role->O*NET-SOC mapping (`src/mcp_server/ingest.py: ROLE_SOC`) is a team assumption.
- No WEF passages: no verifiable, licensable excerpts were ingested; nothing is cited from it.
- Additional job-posting datasets were evaluated (see data_sources.md) and rejected for training.
