# API contracts

Shared state is in `core/state.py`. No schema-breaking change without team notification.

## 2026-10-20 additions (backward compatible)
- `Request.audience: "individual" | "hr"` (default `individual`) and `Request.employee_id: str | None`
  (pseudonymous ID, HR mode only).
- New models: `Gap`, `PathwayActivity`, `Pathway` (as SDLC 3.1, plus `Gap.mention_percent` and
  `Pathway.deferred_skills` for skills that did not fit the learner's weekly hours).
- `core.graph.run(Request) -> State` (keys: route, route_reason, evidence, skill_gaps, forecast,
  draft_pathway, validation_issues, revision_count, status, usage).
- `core.graph.run_team(list[Request]) -> {"employees": {id: State}, "team_skill_needs": [...]}`:
  aggregated counts only, no ranking of people.
- Approval (`governance/approval.py`): `create / edit / approve(..., actor, actor_role, confirmed)`;
  `actor_role` is `employee` (individual mode) or `hr_advisor` (HR mode). Edits always create a new draft.
- Forecast dict (`forecasting.inference.forecast`): SDLC `Forecast` fields + `history`, `actual`,
  `history_weeks`, `target_weeks`; `is_historical_backtest` is always true.

## 2026-10-20 v0.2 additions (backward compatible)
- `Evidence` gains optional `publisher`, `access_date`, `category`, `license`.
- Graph state adds `skill_flags` (O*NET hot/in-demand per skill), `trend_evidence`, `learning_evidence`,
  `scenario_comparison` [{skill_id, current, assistive_required, agentic_required}], `narrative`,
  `narrative_mode` (template|llm). `validation_issues` and `usage` are append-reduced (parallel agents).
- `usage[]` rows: node, ms, model, llm_calls, input_tokens, output_tokens, tokens_measured, est_usd, error.
- `run_team()` also returns `flagged: [employee_id]`.
- MCP tools (`mcp_server/server.py`): `search_labor_trends(role_id, scenario, as_of_date, top_k)`,
  `search_role_skills(role_id, geography)`, `retrieve_learning_resources(skill_id, top_k)`,
  `forecast_skill_demand(role_id, skill_id)`; all return JSON with Evidence-shaped items.
- Forecast: `forecast(role, skill, geography="global")`; adds `geography`, `direction`, `lower_percent`,
  `upper_percent`, `interval`. Checkpoint keys are `(role, skill, geography)`.
- Governance: `approval.can_act/require/list_plans/latest/acknowledge(user)`; `accounts.create_user/authenticate`.

## 2026-10-20 v0.3 additions (backward compatible)
- `PathwayActivity.sdg_links`: any of `SDG1`..`SDG17` (was only SDG4/SDG8). Activities get SDG4 + SDG8 + the
  skill's strongest mapped goal.
- Graph state adds `signals` (today's board for the occupation: day, sources, emergence, pressure, topics) and
  `sdgs` [{goal, score, z, target, target_text, baseline?}]. Report SSE gains `section` kinds `signals`, `sdgs`.
- Evidence id prefixes: `signal:{day}:{topic}:{hn|arxiv|jobs}`, `sdg:{soc}:{goal}`.
- MCP tools: `trend_signals(day?, role_id?)`, `sdg_for(role_id)`, `match_roles(skills, top_k)`.
- REST (session cookie; POST needs `X-AP: 1`):
  - `GET /api/signals/today?day=`, `GET /api/signals/history`, `POST /api/signals/refresh` (HR).
  - `GET /api/quiz`, `POST /api/quiz/score {answers{id: 0-3}, fields[], zone?}` -> {skills, matches}.
  - `POST /api/match {skills[], text?, fields[]}` -> {matches}.
  - `POST /api/resume/analyze` (multipart `file`, 2 MB) -> {markdown, skills[{name, kind, level, evidence[]}],
    years_experience, matches}. Nothing stored.
  - Match row: soc, title, fit, score, coverage, tools_matched, emergence, pressure, emerging, under_pressure,
    stretch, job_zone, top_gaps, gap_levels, sdgs[{goal, short, color}], drivers.
  - HR: `POST /api/criteria/parse {text, soc?}` -> {criteria, summary}; `POST/GET /api/openings`;
    `GET /api/openings/{id}` -> opening + summary + ranked candidates (redacted; contact only when shortlisted)
    + events; `POST /api/openings/{id}/criteria {text}` (re-screens all); `POST /api/openings/{id}/status
    {open|closed}`; `POST /api/applications/{id}/decision {shortlisted|declined|on_hold, note}`.
  - Public (no account): `GET /api/apply/{token}`; `POST /api/apply/{token}` multipart name, email,
    consent=true, file.
- Criteria dict: {top_k, min_fit, min_years, min_levels{skill: 1-5}, required_tools[], notes[], blocked[]}.
