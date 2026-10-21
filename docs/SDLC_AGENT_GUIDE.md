---
project: AiversePulse Enterprise
document_type: agent-readable SDLC and implementation contract
version: "1.1"
status: planned MVP; codebase is a scaffold, NOT a completed product
last_updated: "2026-10-20"
delivery_window: "2026-10-20/2026-10-24"
methodology: 5-day hackathon incremental delivery
primary_language: Python 3.11+
frontend: Streamlit
orchestration: LangGraph
knowledge: FastMCP + ChromaDB + local JSON fallback
forecast_model: STF-KAN (experimental) with baseline fallback
training_budget_usd: 25
human_approval_required: true
---

# AiversePulse Enterprise — Agent-Readable SDLC & Build Contract

> **Purpose:** This is the single implementation-oriented specification for coding agents and teammates. Read this file before editing the project. Follow the stated contracts and acceptance gates; do not assume TODO modules are implemented. Companion documents: `README.md`, `docs/api_contracts.md`, and the full human-readable SDLC (DOCX/PDF).
>
> **Status:** The repository ZIP is a *starter scaffold* with limited smoke tests. LangGraph orchestration, production retrieval, STF-KAN training, revision repair, and persistent approvals are **not yet complete**. An agent must implement and test them rather than claim they exist.

## 0. Agent operating instructions (READ FIRST)

### Non-negotiable rules

1. **MUST preserve user control.** Generated pathways remain `draft` or `flagged` until a real user explicitly approves; editing an approved plan creates a new draft version.
2. **MUST use public or otherwise authorized data only.** Do not commit resumes, tokens, private documents, raw confidential data, or sensitive logs to GitHub.
3. **MUST separate verified evidence from extrapolations.** Every externally sourced claim must carry a source ID, title, publication date, URL, and excerpt or clear provenance. No invented citations.
4. **MUST respect historical cutoff times.** A 2025 report may support current RAG results but MUST NOT be a feature in a forecast/backtest of 2023 observations.
5. **MUST NOT present synthetic or 2023-only backtest results as validated 2026 skill-demand predictions.** Name forecasts precisely: historical job-ad skill-mention indicators with limitations.
6. **MUST constrain the Revision Layer** to at most two targeted repair attempts. Never silently turn a failing result into a passing one; unresolved issues create a `flagged` draft for human inspection.
7. **MUST measure token savings before claiming them.** Record actual provider token counts when available; distinguish measured values from estimates. Never hardcode unverified "60% savings" or "zero hallucinations."
8. **MUST favor deterministic, cheap functions** for math, routing heuristics, schema validation, time estimation and evidence checking. Use LLMs only when needed for semantic tasks.
9. **MUST stay within the team's US$25 RunPod credit.** GPU usage is opt-in, with a US$14 compute envelope, US$3 storage allowance and US$8 contingency. Confirm current rates before starting a Pod.
10. **MUST keep a working offline demo** (sample profile + local dated evidence + baseline/no-forecast fallback) even if GPU training or external APIs fail.
11. **MUST not invent the six official hackathon Must-Haves.** Their exact wording is not provided in this handoff; cross-check the official organizer brief before declaring compliance.
12. **MUST run relevant tests** after modifications. If dependencies/credentials are unavailable, report which checks were not executed and why.

### Agent execution protocol

When assigned a task, follow this sequence:

1. Read this document, `README.md`, `docs/api_contracts.md`, and the relevant modules.
2. Report **scope, files you intend to change, tests, and any blocked dependencies** in a short implementation plan.
3. Inspect existing code before rewriting. Reuse defined Pydantic contracts where practical.
4. Implement the *smallest complete vertical slice* that satisfies an acceptance criterion.
5. Add/update focused unit tests and validate input/output schemas.
6. Run `pytest -q` and any relevant type/format/integration checks available.
7. Update the affected documentation, assumptions and known limitations.
8. Report changed files, measured outcomes, tests, remaining TODOs and cost incurred (if any).

### Work ownership and conflict avoidance

| Owner | Main directories | Interfaces that require coordination |
|---|---|---|
| **A — Orchestration** | `core/`, `agents/`, `tools/`, `src/validation/revision.py` | Shared state, LangGraph edges, router, usage metrics |
| **B — Forecasting/ML** | `forecasting/`, `src/scripts/prepare_jobs.py`, training/evaluation | Forecast schema, inference adapter, checkpoint metadata |
| **C — Knowledge/Governance** | `mcp_server/`, `governance/`, `src/validation/evidence.py` | MCP tool signatures, evidence model, approval status |
| **D — UI/QA/Pitch** | `app.py`, `ui/`, E2E test fixtures, screenshots | User-facing schemas, review/approval events |

**Branch convention:** `feature/router`, `feature/forecast`, `feature/mcp-governance`, `feature/ui`. No schema-breaking shared-state change without updating `docs/api_contracts.md` and alerting all owners. Use one daily integration/merge checkpoint.

---

## 1. Product charter, stakeholders and scope (SDLC Phase 1)

### 1.1 Problem and users

Enterprise HR teams and employees need a transparent, affordable way to understand AI-driven changes to job skills, compare plausible Assistive vs Agentic AI work scenarios, and plan upskilling. The MVP is a **decision-support tool**, not an automated employment decision maker.

**Primary actors:** employee/learner, HR advisor, administrator/demo operator. All plans are advisory; final control remains with the human reviewer.

**Typical user journey:** enter skills and proficiency -> pick target job role -> choose AI scenario -> route request -> retrieve dated evidence -> compute skill gaps -> optionally view historical forecast -> generate a 30/60/90 plan -> verify/revise -> human edit/approve -> persist an auditable version.

### 1.2 Functional requirements (traceable IDs)

| ID | Requirement | Acceptance criterion | Priority |
|---|---|---|---|
| FR-01 | Employee skill/proficiency intake, target role, weekly hours | Validated editable profile, missing-field errors | P0 |
| FR-02 | Normalize skills and map roles | Required/current skill matrix and traceable calculation | P0 |
| FR-03 | Retrieve dated public labor evidence | Real title, date, URL, snippet shown for each claim | P0 |
| FR-04 | Compare Assistive and Agentic AI scenarios | Different documented assumptions and recalculated gaps | P0 |
| FR-05 | Personalized 30-60-90 learning pathway | Activities, workload, checkpoints, SDG 4/8 connections | P0 |
| FR-06 | Intent/domain filtering and cheap-vs-complex routing | `unsupported`, `simple`, `complex` routes demonstrable | P0 |
| FR-07 | Historical weekly job-skill forecast | 12-week input/4-week output, quality flags, baselines | P1; optional for P0 plan |
| FR-08 | Bounded output revision and evidence checks | Rejected/flagged invalid outputs; <=2 repairs | P0 |
| FR-09 | Human edit, explicit approval, immutable audit version | Draft cannot auto-approve | P0 |
| FR-10 | Token/latency and cost dashboard | Actual usage where available; baseline comparison | P0 |

**Compliance:** Rule 01 Public Data; Rule 02 Transparent AI; Rule 03 Human in Charge. Cross-map official **six Must-Haves** to these FR IDs once the organizer's full requirement list is supplied.

### 1.3 Out of scope for the 5-day MVP

Enterprise SSO, production-scale HRIS integration, processing 10,000 employees, clinical-level or legal employment advice, real-time live-market ground-truth 2026 prediction from 2023-only data, LLM fine-tuning, multi-GPU training and hiring/firing automation.

### 1.4 Definition of Done

A new teammate can clone the repo, install dependencies, run a sample profile end-to-end (without renting a GPU), inspect reliable citations and limitations, compare scenarios, edit a draft, explicitly approve it, and view an audit event. All P0 tests pass; docs identify exact model versions and data limitations.

---

## 2. Target technology and project layout (SDLC Phase 2)

### 2.1 Stack

- **Python 3.11+**; Pydantic v2 for typed contracts.
- **Streamlit** for the 5-day frontend and demo.
- **LangGraph `StateGraph`** with explicit, conditional edges and bounded retry.
- **FastMCP** as local tool server; **ChromaDB** for indexed public passages; static dated JSON for fallback.
- **Gemini Flash-class or other affordable model** for ambiguous routing and drafted explanations; configurable stronger model only when necessary. Actual model IDs and provider must be disclosed after selection.
- **PyTorch + SentenceTransformers** for experimental STF-KAN; freeze and cache `all-MiniLM-L6-v2` sentence embeddings (384-d).
- **SQLite** for local plan versioning/audit; **pytest** for verification.
- **RunPod single GPU Pod** for optional ML training, not needed to serve the MVP.

### 2.2 System execution diagram

```mermaid
flowchart TD
    U[Employee profile / target role / scenario] --> V[Input validation + intent-domain filter]
    V -->|Unsupported| X[Safe domain-specific rejection]
    V -->|Simple| S[Deterministic lookup / cached facts]
    V -->|Complex| G[LangGraph shared state]
    G --> P[Profiler Agent]
    P --> K[FastMCP Knowledge Agent]
    K --> R[Chroma retrieval or dated local snapshot]
    R --> A[Deterministic Skill Gap Analyst]
    A --> F{Enough historical data?}
    F -->|Yes| M[STF-KAN or validated baseline]
    F -->|No| W[Skip forecast + show limitation]
    M --> L[SDG Pathway Agent]
    W --> L
    L --> Q[Revision & Verification Gate]
    Q -->|Pass| D[Reviewable draft]
    Q -->|Repairable; under 2 attempts| T[Targeted field repair]
    T --> Q
    Q -->|Unresolved| Z[Flagged draft + manual review]
    D --> H[User edits and explicitly approves]
    Z --> H
    H --> DB[(Immutable approval/audit record)]
```

**Design clarification:** the forecast supports a plan; it must never be a mandatory blocker for P0 reskilling, and no model runs on simple/unsupported queries unless truly required.

### 2.3 Repository structure (matches companion scaffold)

```text
AiversePulse_Enterprise_Project_Scaffold/
├── AGENTS.md                    # Short agent entrypoint (added in refreshed ZIP)
├── README.md                    # Human quickstart
├── CONTRIBUTING.md              # Collaboration practices
├── app.py                       # Streamlit entrypoint
├── src/pyproject.toml               # Base + optional AI dependencies
├── .env.example                 # Non-secret configuration template
├── .gitignore
├── .github/workflows/ci.yml
├── docs/
│   ├── SDLC_AGENT_GUIDE.md      # This complete agent-readable SDLC
│   ├── architecture.md
│   ├── api_contracts.md
│   ├── data_sources.md
│   ├── experiment_log.md
│   └── team_assignments.md
├── config/
│   └── settings.py
├── core/
│   ├── state.py                 # Pydantic models / shared graph contracts
│   ├── router.py                # Domain/intent/complexity selection
│   ├── graph.py                 # LangGraph assembly (TODO)
│   └── usage.py                 # Provider tokens + latency + estimated costs
├── agents/
│   ├── profiler.py
│   ├── knowledge.py
│   ├── gap_analyst.py
│   └── pathway.py
├── tools/
│   ├── skill_lookup.py
│   └── training_time.py
├── mcp_server/
│   ├── server.py                # FastMCP handlers (TODO)
│   ├── retrieval.py
│   └── ingest.py
├── forecasting/
│   ├── datasets.py
│   ├── features.py
│   ├── temporal.py
│   ├── frequency.py
│   ├── kan.py
│   ├── prompt_encoder.py
│   ├── fusion.py
│   ├── heads.py
│   ├── model.py                 # STF-KAN composition (TODO)
│   ├── train.py                 # Training CLI (TODO)
│   ├── evaluate.py
│   └── inference.py             # CPU / checkpoint / baseline fallback
├── validation/
│   ├── schemas.py
│   ├── evidence.py
│   ├── math_checks.py
│   ├── forecast_checks.py
│   └── revision.py              # <=2 targeted repairs (TODO)
├── governance/
│   ├── approval.py              # Explicit approval transitions (TODO)
│   └── audit.py
├── ui/
│   ├── profile.py
│   ├── results.py
│   ├── forecast.py
│   └── review.py
├── src/data/
│   ├── samples/sample_profile.json
│   ├── metadata/README.md
│   └── snapshots/README.md
├── src/scripts/
│   ├── prepare_jobs.py
│   ├── build_index.py
│   └── run_training.sh
└── tests/
    ├── test_router.py
    ├── test_graph.py
    ├── test_retrieval.py
    ├── test_forecasting.py
    ├── test_revision.py
    ├── test_approval.py
    └── test_training_time.py
```

> *Directory ownership is a convention, not a deployment boundary.* Add modules only when justified; avoid parallel duplicate schemas and new frameworks.

---

## 3. Shared data contracts and execution decisions

### 3.1 Existing scaffold types

`src/core/state.py` already defines `Skill`, `Profile`, `Request`, `Evidence`, `ValidationIssue`. **Extend, do not silently replace** these classes. In the scaffold `Skill.level` is an integer from **0 to 5**, and `Profile.weekly_learning_hours` is **>0 to <=80**.

Proposed validated extension:

```python
# Illustrative target interface, NOT implemented in the scaffold
class Gap(BaseModel):
    skill_id: str
    current_level: int   # 0..5
    required_level: int  # 0..5
    gap: int              # max(0, required-current)
    rationale_source_ids: list[str] = []

class Forecast(BaseModel):
    role_id: str
    skill_id: str
    granularity: Literal["weekly"]
    horizon_weeks: int
    predicted_percent: list[float]
    as_of_date: str
    training_data_end: str
    model_id: str
    data_quality: Literal["sufficient", "limited", "unavailable"]
    is_historical_backtest: bool
    warnings: list[str] = []

class PathwayActivity(BaseModel):
    day_range: Literal["1-30", "31-60", "61-90"]
    skill_id: str
    activity: str
    estimated_hours: float
    evidence_ids: list[str] = []
    sdg_links: list[Literal["SDG4", "SDG8"]] = []

class Pathway(BaseModel):
    target_role: str
    scenario: Literal["assistive", "agentic"]
    activities: list[PathwayActivity]
    status: Literal["draft", "flagged", "approved"] = "draft"
```

**Graph state keys** (TypedDict, Pydantic state wrapper, or clear reducers): `request_id`, `profile`, `target_role`, `scenario`, `intent`, `route`, `evidence`, `skill_gaps`, `forecast`, `draft_pathway`, `validation_issues`, `revision_count`, `usage`, `status`.

### 3.2 Example request contract

```json
{
  "request_id": "demo-001",
  "profile": {
    "skills": [{"name": "Python", "level": 3}, {"name": "SQL", "level": 2}],
    "weekly_learning_hours": 6
  },
  "target_role": "Data Analyst",
  "scenario": "assistive",
  "query": "Analyze my skill gaps and create a 30-60-90 day learning plan"
}
```

This is a sample request for testing; it is not an employee profile or a claim about labor-market demands.

### 3.3 Router policy and edge cases

**Classes:** `unsupported` | `simple` | `complex`.

1. Validate and normalize input. Unsupported: clearly outside workforce/skills/reskilling, e.g. "write a poem". Do not use an LLM just to reject an obvious domain mismatch.
2. Simple: definition, role-skill lookup, common skill explanation, cached O*NET fact. Prefer deterministic retrieval, low-token summary if needed.
3. Complex: personalized skill gaps, scenario comparisons, multi-source synthesis, forecasts, 30/60/90 plans. Invoke the multi-agent pipeline.
4. Ambiguous: optionally use a cheap model with structured three-class output; cache repeated normalized intents and log usage.
5. **Never use number of listed skills alone** as complexity classifier; one-skill users may request complex analysis.
6. For every branch, provide route trace and an appropriate outcome (or explicit error).

### 3.4 LangGraph node specification

| Node | Input | Output | Behavior on failure |
|---|---|---|---|
| `router` | request/query | route + reason | `unsupported` or clear error |
| `simple_lookup` | simple query | short answer + evidence | cached/local definitions |
| `profiler` | profile + role | normalized skill IDs | ask user to fix ambiguous skill |
| `knowledge_search` | role/scenario/as-of | evidence array | dated local snapshot, mark stale |
| `gap_analysis` | skills + role requirements | deterministic Gap[] | return known limitations |
| `forecast_skill` | historical window + eligible evidence | Forecast? | skip/fallback and flag |
| `pathway` | gap, time, scenario, evidence | draft structured Pathway | return validation issue |
| `revision` | draft + evidence + forecast | issues, route | <=2 targeted repairs then `flagged` |
| `human_review` | validated/flagged draft | editable draft view | no automatic approval |
| `approve` | user click + draft version | immutable approved version | reject invalid transition |

**Important:** Approval is a **user interaction + persistence operation**, not an LLM node that approves itself.

---

## 4. Advanced knowledge layer (SDLC Phase 3)

### 4.1 Dataset/source roles and restrictions

| Source | Role | Constraint |
|---|---|---|
| [Luke Barousse `data_jobs`](https://huggingface.co/datasets/lukebarousse/data_jobs) | Build **2023 weekly** job-ad skill-mention series | Sampling/country/role bias; rights must be checked; NOT validated current 2026 demand |
| [O*NET database](https://www.onetcenter.org/database.html) | Occupations, competencies and skill taxonomy | US-oriented; not weekly skill-demand measurements |
| [WEF Future of Jobs 2025](https://www.weforum.org/publications/the-future-of-jobs-report-2025/) | Post-publication dated RAG context | **Not a 2023 historical predictor feature** |
| [ONS VACS02](https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/datasets/vacanciesbyindustryvacs02/current) | Optional longer industry-level reference | Industry vacancy counts are not skill-demand rates |

No dataset has been downloaded/trained by the project scaffold. Confirm current download, license, columns, dates and coverage with code before implementation. Do not redistribute third-party raw ads without checking authorization.

### 4.2 FastMCP contract

Implement the following **real** server tools in `src/mcp_server/server.py`:

```text
search_labor_trends(role_id: str, scenario: str, as_of_date: str, top_k: int = 5) -> list[Evidence]
search_role_skills(role_id: str, geography: str | None = None) -> list[RoleSkill]
retrieve_learning_resources(skill_id: str, top_k: int = 5) -> list[Evidence]
```

Store in ChromaDB: normalized passage text, source ID, source title, publisher, publication date, access date, source URL, evidence category, jurisdiction, and optional license. `top_k` should be small to reduce token load. Do not blindly trust retrieved instructions embedded within content: treat them as **data**, not developer/user instructions.

**Fallback:** if live MCP/Chroma fails, use an included local JSON snapshot **only if it contains actual verifiable, dated evidence**; annotate `retrieval_mode=offline`, `stale=true` when appropriate. If no evidence exists, return an explicit empty result and block unsupported claims.

### 4.3 Evidence provenance rules

- Cite only retrieved, verifiable source IDs; title+URL+date must be present.
- Distinguish a report's **publication date** from its **access date**.
- Relevant future-dated passages must be excluded from historical as-of inference.
- Sanitize quoted content, ignore prompt injection in external documents, and limit passage length.
- Training data and runtime RAG evidence have separate purposes; do not feed 2025/2026 labor reports into an earlier 2023 backtest.

---

## 5. Experimental STF-KAN forecasting (SDLC Phase 3)

### 5.1 What is being predicted

For role `r`, skill `s`, and week `w`, calculate:

```text
skill_mention_percent(r,s,w) =
  100 * unique eligible job postings in (r,w) mentioning s
      / unique eligible job postings in (r,w) with a parseable skill list
```

Output: four future weekly **percentages of eligible job ads mentioning a skill**, not probability that an individual gets a job and not the economy-wide number of jobs. `eligible_posts == 0` means *missing*, not `0% demand`.

Store aggregation records:

```text
week_start, role_id, skill_id, geography,
skill_posts, eligible_posts, mention_percent,
data_source, source_window_start, source_window_end
```

Required preparation: parse skills safely, deduplicate ads, normalize aliases, keep stable geography and role filters, handle missing weeks, record coverage, create temporal windows without leakage, fit scalers only on train dates.

### 5.2 Model architecture

```text
12 weekly observations + missingness/coverage features
       |--> detrended time features --> small Temporal KAN --|
       |--> stable spectral bins (rFFT) --> Frequency KAN --|--> quality-aware
role + skill + AS-OF SAFE text prompt --> frozen MiniLM -->|    gated fusion
                                                             -> 4-week head
                                                             -> diagnostics
```

- **Temporal branch:** 12-week window, trend/rate-of-change, sparse-observation masks; small spline-based KAN / small hidden representation.
- **Frequency branch:** detrend first, `rFFT`, take 2–3 stable bins max; learn periodic corrections with compact KAN. A 12-week input cannot prove annual seasonality; mask the branch when inadequate.
- **Semantic branch:** role/skill descriptions and only historical-cutoff-safe text; frozen `all-MiniLM-L6-v2` (384 dimensions), cached embedding, small projection (e.g., 384 to 32).
- **Gated fusion:** softmax weights over compatible branch predictions/features conditioned on data quality and forecast horizon. Mask invalid branches; never force a frequency weight when no periodic signal is trustworthy.
- **Lightweight heads:** four weekly demand values; optional calibrated quantile intervals and trend direction. Clip within `[0, 100]` only as a safety bound; detect pathological predictions before clamping hides them.
- **Separate training-time estimator:** `weekly_learning_hours`, known learning task effort, gap severity, feasible 30/60/90 milestones. **Do not reuse the job-market forecasting model** to estimate course completion time.

### 5.3 Temporal/spectral equations

For evenly spaced weekly values: `x_t = trend_t + seasonal_t + residual_t`. FFT on detrended observed residuals produces frequency coefficients. For bin `k` and a window with `N` points, the nominal period is `N/k` weeks (nonzero `k`), assuming even sampling. A harmonic may be represented by `A_k * cos(2*pi*h/P_k + phi_k)`, but extrapolate only if stable across available history.

Fusion for aligned scalar branch predictions:

```text
alpha = softmax(gate([h_time, h_freq, h_sem, quality, horizon]))
forecast(h) = alpha_time * y_time(h)
            + alpha_freq * y_freq(h)
            + alpha_sem  * y_sem(h)
```

Do not double-count a shared base trend if branch predictions each already include it.

### 5.4 Proposed initial hyperparameters (tune only on validation)

| Parameter | Default candidate |
|---|---|
| Input window | 12 weekly observations |
| Forecast horizon | 4 weekly values |
| Coverage | 20–40 adequately represented skills, 3–5 related roles |
| Embeddings | Frozen 384-d MiniLM, projected to 32-d |
| Time/Frequency features | ~16-d branch outputs; <=3 eligible spectral bins |
| Batch size | 64 |
| Training epochs | Up to 30, patience 5 |
| Optimizer | AdamW, initial LR 1e-3 |
| Data splits | Chronological train/validation/untouched test |
| Metrics | MAE and RMSE in percentage points; coverage, latency, seed variance |

Suggested chronological split within the 2023 dataset: **Jan–Aug train, Sep–Oct validation, Nov–Dec held-out test**, adjusted to ensure each 12-week history/4-week target lies within appropriate dates. Evaluation windows must respect the time cutoffs; do not randomly shuffle samples across dates.

### 5.5 Required baselines and go/no-go decision

Train/evaluate in this order:

1. Last-observed value and trailing moving average.
2. Simple linear model.
3. Temporal-KAN alone.
4. Temporal-KAN + semantic features.
5. Full semantic time/frequency gated STF-KAN.

**Go/no-go:** Deploy the simplest checkpoint that matches or beats baselines on untouched test data. If full STF-KAN is weaker or lacks sufficient history, use the baseline in the MVP while displaying the advanced model as an experimental comparison. NEVER fabricate trained weights, error scores or uncertainty intervals.

### 5.6 Model artifact contract

```text
models/stf_kan_best.pt            # or selected_baseline artifact
models/scaler.json               # fitted train-only normalization
models/feature_schema.json       # order/types/window/horizon/role-skill schema
models/model_card.md             # date range, sources, metrics, known limits
models/training_manifest.json    # model ID, seed, config, data hashes, split dates
```

The model files above are planned outputs; they are not present in the starter ZIP. Inference must work on CPU if possible and fall back to baseline/unavailable with warnings when a checkpoint cannot load.

---

## 6. Revision, audit and token efficiency (SDLC Phases 3 + 5)

### 6.1 Validation sequence

1. **Schema:** typed JSON, required fields, permitted statuses, bounded proficiency levels.
2. **Evidence:** every material external claim maps to real retrieved source IDs; no non-existent citation/date.
3. **Math:** gaps = `max(0, required-current)`; task hours add up; no negative estimates.
4. **Forecast:** prediction horizon, percentage bounds, as-of cutoff, frequency-data sufficiency, ordered uncertainty intervals.
5. **Pathway:** 30/60/90 day phases are ordered, activities address documented gaps, expected hours compatible with weekly availability.
6. **Governance:** generated result is not `approved`; approval requires explicit actor and approved version.
7. **Semantics:** optionally request a cheap-model consistency review **only for fields that cannot be checked deterministically**.

**Revision algorithm:** `validate -> pass -> draft` OR `issues -> repair only affected fields -> validate`. Set `revision_count` from 0 to at most 2. Unresolved errors -> `flagged`, with visible issue reasons; no covert regeneration loops.

**Severity:** `error` blocks verified completion; `warning` permits a caveated draft (depending on policy). A flagged draft may be edited but never silently promoted to verified/approved.

### 6.2 Human governance

Expected lifecycle:

```text
GENERATED -> draft -> user_edit -> draft_version_N+1
                 -> explicit_approve -> approved_version_N
ANY unresolved blocker -> flagged -> manual_correction -> draft_version_N+1
APPROVED + subsequent edit -> NEW DRAFT, never overwrite old approval
```

SQLite tables (minimum): `plans`, `plan_versions`, `approval_events`, `validation_events` (plus optional source references). Store `plan_id`, `version`, actor identifier, time (UTC), action, previous/new status, hash or snapshot, and evidence references. Do not claim approval merely because a UI button was clicked: persist successfully first.

### 6.3 Cost/token instrumentation

Track for each pipeline stage: route, model/provider/version, input/output tokens (if exposed), estimated token counts (clearly marked otherwise), number of calls, wall time, estimated USD cost based on verified rates, cache hits and error counts. Compare identical test cases against a baseline that always executes the complex pipeline. Report computed savings; no preset headline number.

---

## 7. Streamlit frontend contract (SDLC Phase 4)

### Screens and minimal fields

| Screen | Input / display | Responsible module |
|---|---|---|
| Employee Profile | skills, 0–5 levels, target role, hours/week | `src/ui/profile.py` |
| Scenario Selector | Assistive AI vs Agentic AI with documented assumptions | `app.py` / `src/ui/profile.py` |
| Results | normalized skill matrix, gaps, sources with dates and URLs | `src/ui/results.py` |
| Forecast (experimental) | selected skill, 12-week history, 4-week output, model name, uncertainty/data-quality caveat | `src/ui/forecast.py` |
| Plan Review | 30/60/90 cards, edit controls, flags, approval confirmation, audit event | `src/ui/review.py` |
| Efficiency Sidebar | route, actual measured model calls/tokens, baseline comparison | `app.py` |

**UI invariants:** source link opens actual URL; warnings are not hidden; forecast display says "historical backtest" when relevant; synthetic previews carry an explicit synthetic label; there is no auto-approval on page reload.

### Offline demo fixture

Use `src/data/samples/sample_profile.json` plus a **real-attributed** local evidence snapshot, deterministic skill-gap mapping, and a baseline forecasting fallback. If not enough evidence is available, demonstrate with an explicitly incomplete/flagged draft instead of inventing citations.

---

## 8. RunPod GPU training and US$25 policy (SDLC Phase 3)

### 8.1 Hard budget envelope

| Bucket | Maximum | How to control |
|---|---:|---|
| GPU compute | US$14 | One Pod, <=14 active hours at a verified <=US$1/h reference, stop checks per session |
| Disk/storage | US$3 | Export models, delete unused volumes and track prorated charges |
| Reserve | US$8 | Unexpected rate, restart or emergency retrain |
| **Total** | **US$25** | **Never exceed team credit** |

**Rate verification:** A previously checked RunPod pricing page displayed RTX 4090 Secure Cloud near US$0.89/hr. This is a planning reference, **not a guaranteed checkout rate**. Community Cloud may differ. Confirm instance pricing, storage and billable stopped resources in the actual console. Do not keep a Pod idle.

### 8.2 Four GPU sessions and stop rules

| Session | Maximum GPU time | Exit condition |
|---|---:|---|
| S1 — CUDA smoke test | 2 h | One batch trains; checkpoint saves/reloads |
| S2 — baselines + Temporal-KAN | 5 h | Validation metrics logged, baseline available |
| S3 — semantic/frequency ablations | 4 h | Full/ablated configurations compared |
| S4 — final candidate | 3 h | Best validated artifact exported + CPU load test |

Total: **14 hours maximum allocated training time** (not a guaranteed required runtime). Do cleaning, deduplication, source validation, prompt authoring and most coding locally before paying for GPU. Cache frozen text embeddings. Use a single 24 GB GPU such as RTX 4090/A5000/3090 if cost and availability allow.

### 8.3 Proposed commands (NOT guaranteed to run until implemented)

```bash
# local workstation / prep
python src/scripts/prepare_jobs.py --input src/data/raw/data_jobs.csv
pytest -q

# RunPod GPU Pod, once Owner B implements the training CLI
python src/forecasting/train.py \
  --model stf_kan --window 12 --horizon 4 \
  --batch-size 64 --epochs 30 --device cuda \
  --save-dir /workspace/checkpoints

# evaluation and checkpoint export, after interfaces exist
python src/forecasting/evaluate.py --checkpoint /workspace/checkpoints/best.pt
```

**Training integrity:** store training cutoffs, feature order, fitted scaler, tokenizer/embedding model revision, seed, data hash, source/license notes and eval metrics with the model. Checkpoints and downloaded data must be backed up before deleting the Pod.

---

## 9. Five-day execution plan (SDLC Phases 1–6)

**Dates:** 20–24 October 2026. **Daily policy:** one integrated demo checkpoint, one test run, one owner/status update. The P0 reskilling flow takes precedence over optional forecasting polish.

### Day 1 — Tue 20 Oct: Requirements, contracts, data

| Owner | Tasks | Deliverable |
|---|---|---|
| A | finalize state schemas/router taxonomy; create graph nodes/interfaces | request/response examples + route tests |
| B | download/inspect eligible 2023 public job data, check license/columns, aggregate weekly series and missingness | `weekly_skill_demand` sample + coverage report |
| C | collect attributed public sources; define FastMCP tool schemas and Chroma metadata | source manifest + 1 verified retrieval fixture |
| D | Streamlit shell, five screen wireframes, QA E2E script | form fields + review layout + task board |

**Gate:** scaffold works, schemas are agreed, no secrets committed, no GPU Pod rented. **BLOCKER if:** raw data rights, geographic scope, or six official Must-Haves remain unresolved; document decision.

### Day 2 — Wed 21 Oct: Core functional slice

| Owner | Tasks | Deliverable |
|---|---|---|
| A | deterministic routing, profiler, gap calculations, conditional graph edges | mock complex flow reaches valid draft |
| B | rolling windows, time KAN, FFT features, small KAN unit tests | one-batch shape/gradient test |
| C | FastMCP + Chroma ingestion and local fallback; implement real dated references | search tool returns source IDs/dates/URLs |
| D | profile + scenario UI and results skeleton | app maps to Pydantic request |

**Gate:** end-to-end draft with mocked safe responses; no invented verification claims.

### Day 3 — Thu 22 Oct: Retrieval + measured training

| Owner | Tasks | Deliverable |
|---|---|---|
| A | integrate retrieval node, route metrics, provider usage counters | complex flow trace + cost log |
| B | RunPod S1–S3 subject to spend cap; baseline then ablations | candidate artifacts + validation metrics |
| C | citation verifier + draft/version SQLite storage | source-grounded citations and schema |
| D | display real citations, gaps and fallback messages | visible evidence/results page |

**Gate:** dated MCP evidence and working complex pathway; forecast checkpoint **or explicitly declared baseline fallback**.

### Day 4 — Fri 23 Oct: Revision and complete UI

| Owner | Tasks | Deliverable |
|---|---|---|
| A | <=2 targeted revision attempts; scenario recomputation; caching | bounded repair passes/tests |
| B | unseen-period test, compare to baselines; artifact export + CPU inference | `best.pt` or baseline + model card |
| C | approval transition, immutable audit history; outage fallback | review/approve persistence tests |
| D | charts, plan editing, token panel, approval interaction, E2E testing | judge-ready Streamlit journey |

**Gate:** user can complete profile -> evidence -> pathway -> revision -> edit -> explicit approval in UI.

### Day 5 — Sat 24 Oct: Freeze, prove, ship

| Owner | Tasks | Deliverable |
|---|---|---|
| A | route benchmarks; graph integration fixes; freeze interfaces | measured results, tests green |
| B | finalize forecast limitations and backtest plots; CPU smoke | reproducible model report |
| C | source/privacy/licensing audit; model-provider disclosure | complete README provenance |
| D | failure drill, demo recording/screenshots, 3-minute pitch, GitHub release | demo assets + public repository |

**Gate:** P0 acceptance passes, no broken offline demo, exact six Must-Haves checked with organizer's original text, claims are evidence-based.

---

## 10. Test matrix and acceptance gates (SDLC Phase 5)

| Test ID | Scenario | Expected behavior |
|---|---|---|
| T-01 | "Write a poem" | `unsupported`; no full agent workflow |
| T-02 | "Define SQL" | `simple`; cached/local answer and route trace |
| T-03 | Full skills + target role | `complex`; gap matrix and draft pathway |
| T-04 | Assistive -> Agentic | scenario assumptions recalculated; results differ for grounded reasons |
| T-05 | MCP connection broken | valid offline snapshot with `stale` marker, or explicit empty evidence |
| T-06 | Forged citation or fake date | claim rejected/flagged; no fabricated source shown |
| T-07 | Too-short/noisy historical series | frequency gate masked; quality warning |
| T-08 | Forecast beyond as-of cutoff | forecast rejected or marked invalid |
| T-09 | Impossible weekly learning workload | warnings and revised feasible schedule |
| T-10 | Deliberate invalid JSON/pathway fields | targeted <=2 repair attempts, then `flagged` |
| T-11 | No approval click | plan remains `draft` or `flagged` |
| T-12 | Edit approved pathway | new draft version; original approval audit immutable |
| T-13 | CPU-only + no pretrained checkpoint | app loads and baseline/no-forecast path works |
| T-14 | Token-optimization evaluation | report actual counts on same queries vs always-complex |
| T-15 | Source contains prompt injection | external text treated only as data; system not redirected |
| T-16 | Fresh install | `pip install -e .` and `pytest -q` succeed (and optional deps documented) |

**Release checklist:** all P0 test IDs verified; baseline and forecasting numbers reproducible; `README.md` lists all exact model names/vendors and source URLs; `.env.example` contains no real keys; GitHub commit excludes raw private data; governance audit trace shown in demo.

---

## 11. Launch, documentation and pitch (SDLC Phase 6)

### 11.1 Local setup (scaffold state)

```bash
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -e .
# Optional once dependencies/versions are checked: pip install -e '.[ai]'
pytest -q
streamlit run src/app.py
```

**Known state:** the existing `app.py` is a scaffold UI; `src/forecasting/train.py` intentionally exits with a TODO message and many agent/MCP/governance modules are placeholders. Passing starter smoke tests **does not imply end-to-end implementation**.

### 11.2 Three-minute pitch order

| Segment | Timing | Show |
|---|---|---|
| Problem + user input | 0:00–0:25 | target role, weekly hours, skill profile |
| Cost-aware reasoning | 0:25–1:05 | route decision + dated FastMCP knowledge + gap matrix |
| Scenario + optional forecast | 1:05–1:40 | clearly labeled backtest/uncertainty and scenario difference |
| SDG pathway + Revision Gate | 1:40–2:30 | 30-60-90 plan, verified claims and editable draft |
| Human approval + measured efficiency | 2:30–3:00 | saved audit event, actual token measurements |

Do not promise arbitrary 60% savings or "zero hallucinations". State measured numbers and remaining limitations.

### 11.3 Documented sources

- Luke Barousse, data_jobs: https://huggingface.co/datasets/lukebarousse/data_jobs
- O*NET occupational database: https://www.onetcenter.org/database.html
- World Economic Forum, Future of Jobs Report 2025: https://www.weforum.org/publications/the-future-of-jobs-report-2025/
- TimeKAN research reference: https://github.com/huangst21/TimeKAN
- SentenceTransformer MiniLM model: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
- RunPod pricing: https://www.runpod.io/pricing
- RunPod billing guidance: https://docs.runpod.io/get-started/billing-information

**Source hygiene:** treat these as starting references. Validate their license/access conditions and record exact snapshot dates before using them for training or presentation.

---

## 12. Team kickoff / decisions requiring confirmation

- [ ] Official organizer six Must-Haves supplied and FR-01…FR-10 coverage mapped line-by-line.
- [ ] Team member A assigned (Graph/Agent integration): ____________________.
- [ ] Team member B assigned (Forecast/RunPod): ____________________.
- [ ] Team member C assigned (FastMCP/Governance): ____________________.
- [ ] Team member D assigned (Streamlit/QA): ____________________.
- [ ] Target demo geography, occupations and skill normalization rules chosen.
- [ ] Job-posting dataset rights and historical coverage verified.
- [ ] Exact LLM provider/model IDs selected and `.env.example` prepared.
- [ ] GPU budget owner assigned; actual RunPod hourly rates/charges checked.
- [ ] Sample employee profile, expected output and offline demo story agreed.
- [ ] Cutoff policy for retrieved evidence in historical forecasts documented.

## 13. Ready-to-copy coding-agent instruction

> Read `AGENTS.md`, `docs/SDLC_AGENT_GUIDE.md` and `docs/api_contracts.md`. Implement the feature assigned to me, preserving the documented Pydantic contracts, time-cutoff policy, revision retry limit, human-approval invariant and US$25 training budget. Before coding, list files to change and exact acceptance tests. Do not invent completed models, dataset measurements, cited evidence, token savings or benchmark scores. After coding, run the relevant tests and report changed files, verified results, blockers and remaining TODOs.

---

**End of agent-readable SDLC v1.1.** This contract supersedes informal architectural sketches where it provides stricter requirements; any new change in assumptions should be recorded in `docs/architecture.md` and `docs/api_contracts.md`.
