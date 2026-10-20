# API contracts

Shared state is in `core/state.py`. No schema-breaking change without team notification.

Plan detail returns the persisted `report` before and after approval, including after cache
eviction or server restart. Older plans without a saved report return `report: null`;
approval cannot recreate analysis that was never persisted.

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
