# API contracts

Shared state is in `src/core/state.py`. No schema-breaking change without team notification.

Career matching endpoints return HTTP 503 with a setup message if the local embedding
runtime cannot be imported. The quiz keeps answers in the current page and offers retry.

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
- Approval (`src/governance/approval.py`): `create / edit / approve(..., actor, actor_role, confirmed)`;
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
- MCP tools (`src/mcp_server/server.py`): `search_labor_trends(role_id, scenario, as_of_date, top_k)`,
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

## 2026-10-20 v0.4 changes
- Live occupation/skill source is **ESCO v1.2**; occupation ids are ESCO codes (e.g. `2221.2`), field filters
  are ISCO-08 prefixes, `job_zone` holds the ISCO-08 skill level (1-4). Requirement importance/level are
  predictions of a model trained on O*NET (training only). Evidence ids: `esco:{code}:{skill|tool}:{label}`.
- Requirements carry `essential` and `agentic` (+1/0/-1). Graph state adds `level_sources`
  {requirement: the person's skill it was credited from}.
- Resume endpoints and screening return `integrity` {findings[{technique, severity, description, evidence,
  location}], risk{score, level, hold}, removed{hidden_chars, invisible_chars, injection_lines}, sha256};
  screening adds `held`. `POST /api/apply/{token}` accepts the honeypot field `website` (must be empty) and
  is rate-limited (429).
- `POST /api/quiz/score` blends a text profile of the chosen answers; `zone` is the ISCO skill level.

## 2026-10-20 v0.4.1 (frontend/backend split)
- `GET /api/signals/today` is public (read-only). Everything else is unchanged.
- `apply_path` is now relative: `apply.html#<token>`; `/apply/{token}` redirects (308) there.
- Settings: `CORS_ORIGINS` (comma-separated allowlist for a separately hosted frontend), `COOKIE_SAMESITE`
  (`strict`|`lax`|`none`). POST/PUT/DELETE from a foreign `Origin` are rejected (403).
- Frontend reads `window.AP_CONFIG.apiBase` from `src/web/config.js` ("" = same origin).

## 2026-10-22 mock interview module (additive)
- Interview routes are employee-only and use the existing session cookie and `X-AP: 1` write protection. Each interview ID is owner-scoped; missing and foreign IDs both return 404.
- `POST /api/interviews` `{target_role, skills:[{name,level}], difficulty:foundational|intermediate|advanced, plan_id?, transcript_consent:true}` resolves an ESCO role, builds source-tagged context from the local verified ESCO snapshot and the submitted skill profile, then uses the configured single `coach` LLM to generate the first question. No multi-agent graph is called. The response contains `interview_id`, question metadata, and ESCO source details.
- `POST /api/interviews/{id}/answer` `{question_id, answer}` evaluates the answer and generates either one adaptive follow-up or the next stage question in one model call. At most one follow-up is allowed per stage; five stages and ten total questions are the cap. Answer evaluation is structured on the 0-4 rubric scale and validated before persistence.
- `GET /api/interviews` returns the caller's history and scores. `GET /api/interviews/{id}` returns the active question and owner session metadata. `GET /api/interviews/{id}/report` returns a completed report. `POST /api/interviews/{id}/end` ends an unfinished session. `DELETE /api/interviews/{id}` removes its report, transcript, questions, and session.
- Additive SQLite tables: `interview_sessions`, `interview_questions`, `interview_responses`, `interview_reports`. They store rubric version, difficulty, question type/stage, competency labels, ESCO source IDs, expected criteria, answer, evidence-linked evaluation, and aggregate report. No audio or raw CV file is stored.
- Rubric v1.0 weights: knowledge 30%, relevance/completeness 25%, problem-solving 20%, communication 15%, practical evidence 10%. Each dimension is scored 0-4 by the model; weighted calculations are deterministic backend logic. Readiness = 65% interview performance + 35% profile-to-role coverage. Hiring Competitiveness Index = 70% demonstrated role-competency alignment + 30% profile coverage. It is a simulated assessment index, never an offer probability.
- The browser may use SpeechRecognition and speechSynthesis; text input remains available. The microphone permissions policy allows the same origin only. Users explicitly consent before transcripts are persisted and sent to the configured LLM provider. Browser speech recognition may be processed by the browser's speech service.
- The existing ESCO snapshot is the runtime source. O*NET remains training-only; no new O*NET API key or provider is required for this feature. ESCO requirement levels are AiversePulse predictions trained on O*NET, not ratings published by ESCO.
- Without a configured usable LLM, interview creation returns 503 with setup guidance rather than silently claiming an AI interview was generated.
