# AiversePulse Enterprise - Project Scaffold

This is an **implementation scaffold**, not the finished forecasting or multi-agent product. It accompanies the SDLC handoff document.

## Intended MVP
Profile intake -> cost-aware router -> LangGraph profiling / MCP retrieval / gap analysis -> optional STF-KAN -> SDG pathway -> bounded validation -> user approval/audit.

## First 4 workstreams
- Owner A: `core/`, `agents/`, `tools/`.
- Owner B: `forecasting/`, `src/scripts/prepare_jobs.py`, training/evaluation.
- Owner C: `mcp_server/`, `governance/`, retrieval + evidence validation.
- Owner D: `ui/`, `app.py`, E2E testing and demo.

## Getting started
1. Install Python 3.11+.
2. `pip install -e .`
3. Copy `.env.example` to `.env` (do not commit secrets).
4. `streamlit run src/app.py` (currently shows the scaffold, not results).
5. `pytest` (smoke tests only until features are implemented).

No private resumes, API secrets or third-party raw posting text should be committed.

## Coding-agent handoff (added 20 Oct 2026)
- Start with **`AGENTS.md`** at repository root.
- Full source of truth: **`docs/SDLC_AGENT_GUIDE.md`** (requirements, contracts, architecture, datasets, forecasting, $25 RunPod budget, 5-day plan and tests).
- This remains an implementation scaffold: many ML/agent modules are TODOs and training artifacts are not bundled.

## Status (v0.2, 20 Oct 2026)
Multi-agent LangGraph (supervisor -> Profiler || Knowledge[FastMCP] -> Gap Analyst -> Market Analyst[STF-KAN]
|| Pathway -> Coach -> Reviewer), O*NET 31.0 + job-ad evidence in Chroma, role-based Streamlit app with
accounts (employee / HR advisor), SQLite audit with immutable versions. See `docs/architecture.md`.

```bash
pip install -e ".[ai]"
python src/scripts/prepare_jobs.py --input src/data/raw/data_jobs.csv        # needs the HF CSV in src/data/raw/
python -m mcp_server.ingest --onet src/data/raw/onet/db_31_0_text.zip     # or --index-only (committed passages)
python src/scripts/train_and_select.py --seeds 42 7 2026 --out artifacts  # ~6 min CPU for 3 seeds
python src/scripts/seed_demo_users.py                                     # demo accounts -> src/data/demo_users.local.txt
pytest -q
streamlit run src/app.py
python -m mcp_server.server --http                                    # optional standalone MCP server
docker build -t aiversepulse . && docker run -p 8501:8501 -v aiversepulse-data:/app/data aiversepulse
```

### Web app (recommended UI)
```bash
uvicorn server.api:app --app-dir src --port 8600     # public: http://localhost:8600   ·   HR: http://localhost:8600/enterprise
```
FastAPI + plain HTML/CSS/JS (`src/web/`), no build step. The report streams like a chat: each agent's progress
arrives live over Server-Sent Events, then the Reviewer-verified summary types out with citation chips and the
gap table, scenario comparison, skill outlook and editable 30/60/90 plan build in turn. The JobSmart owl is a
rigged SVG (`src/web/js/owl-art.js` + `src/web/css/owl.css`): 12 states with real actions (blink, wave, headphones,
magnifier sweep, tablet, bell, confetti, Zzz…), pointer-following eyes, and it always shows the real agent
state. Preview all states at `/static/owl/preview.html`. HR runs a
team and watches each employee's 8-agent trace fill live. Session cookies are HttpOnly + SameSite=Strict,
mutating calls need the `X-AP` header, strict CSP. Streamlit (`app.py`) stays as a fallback.

LLM agents are off unless `GEMINI_API_KEY` and `LLM_FAST_MODEL` are set (see `.env.example`); everything works
deterministically without them. GPU is not needed (training is CPU-minutes); RunPod remains optional.

### Public landing, sign-in only for features
`/` is a public landing page (feature overview, "Start Quick Match", "Upload resume", "Pick a job") plus the
public "Today" trend board. Opening a feature as a guest goes to `#/signin/<feature>` and returns there after
sign-in. HR uses `/enterprise` (or `enterprise.html`).

### Deploy frontend and backend separately
`src/web/` is plain static files (relative paths, no build). The API also serves it, so one host works out of the box.
To split them:
1. **Backend** (`src/Dockerfile`, FastAPI): set `CORS_ORIGINS=https://app.example.com` (comma-separated) and
   `COOKIE_SAMESITE` (`lax`/`strict` when frontend and API share a site, e.g. `app.` and `api.example.com`;
   `none` across different sites, which requires HTTPS). Mutating calls also need the `X-AP` header and an allowed `Origin`.
2. **Frontend** (any static host: nginx, Netlify, S3, GitHub Pages): upload `src/web/` and overwrite `config.js` with
   `window.AP_CONFIG = { apiBase: "https://api.example.com" };`. Application links are `apply.html#<token>`,
   so no server rewrites are needed.
3. Example of both: `docker compose -f src/deploy/docker-compose.yml up --build` (frontend :8080, API :8600).

### Hackathon must-haves (v0.4)
See [docs/requirements_trace.md](docs/requirements_trace.md) for the full mapping to code and tests.
- **Intake:** quick-match MCQ game (13 scenarios + field + training), resume upload auto-converted to Markdown
  with evidence-quoted ESCO skills, or manual rating.
- **AI-trend signals, daily:** `python -m mcp_server.signals --refresh` (also runs once a day inside the web
  server; `SIGNALS_DAILY=0` turns it off). Public "Today" page and HR "Signals" view; agents read it via the
  `trend_signals` MCP tool.
- **Future-role matching** across all 2,938 ESCO occupations, **SDG mapping** to all 17 goals, two AI scenarios.
- **HR hiring:** openings with plain-language thresholds, a public apply link, AI screening agents, blind
  ranked review, human shortlist / hold / decline with an audit log. Sample resumes: `src/data/samples/sample_resume_*.md`.
- **Document guard:** hidden-text and prompt-injection filtering for PDF/DOCX/TXT/MD (after
  zhihuiyuze/pdf-prompt-injection-toolkit), fraud signals, honeypot + rate limit; risky files are held for a human.

### Data: public sources live, O*NET for training only
The live agents read public sources only: **ESCO v1.2** (European Commission) for occupations and skills, the
daily trend board, and the UN SDG API. **O*NET 31.0, its release history and the 2023 job ads are training
data**: they train the requirement model (importance/level for ESCO skills; held-out accuracy in
`src/data/snapshots/esco_requirements_card.json`) and STF-KAN, whose outputs are exported as ESCO-keyed assets.
`tests/test_runtime_sources.py` fails if the live process opens any training file.

```bash
python src/scripts/build_esco_snapshot.py          # public ESCO API -> src/data/snapshots/esco_raw.json (~10 min)
python src/scripts/build_esco_requirements.py      # train on O*NET (src/data/raw/onet/…zip), score ESCO -> esco_occupations.json
python src/scripts/export_esco_outlook.py          # STF-KAN outlook -> esco_outlook.json
python src/scripts/build_sdg_map.py                # UN SDG API -> sdg_map.json
python -m mcp_server.ingest                    # ESCO passages + Chroma index (RAG)
```

### STF-KAN skill outlook (live CPU inference for the agents)
Trained on the O*NET release history 25.0 (Aug 2020) -> 31.0 (Aug 2026): 47,780 series (every occupation x skill
importance / tool Hot flag), 25 quarterly releases, 484k training windows, 3-seed ensemble on an RTX 4060.
The Market Analyst calls the MCP `skill_outlook` tool, which runs the checkpoint live on CPU
(`src/forecasting/serving.py`), and the Gap Analyst ranks gaps by need x importance x outlook (required levels stay
ESCO). Gate, in order: `artifact_manifest.json` present -> checkpoint and input history match its SHA-256 -> series set
matches -> run. Any failure falls back to the exported model output (`esco_outlook.json`, labeled
`mode=precomputed_asset` with the reason), else `unavailable` with a reason; the reviewer adds a warning either way and
validates values (1-5 range, horizon, direction, model version) before the draft is shown. Every analysis carries
`forecast = {status, mode, device, model_version, latency_ms, reason}` and `POST /api/forecasts {role_id}` returns the
same for one occupation. Offline export and live serving share one code path; `tests/test_serving.py` checks that live
CPU output equals the exported asset record by record.

Deploying on a CPU-only server: copy `src/artifacts/onet/{stf_kan_best.pt, artifact_manifest.json,
direction_report.json}` and `src/data/training/onet_history.csv` (all gitignored, ~85 MB). Without them the app still
works and labels the outlook as precomputed. First call loads the model (~2 s on CPU); later calls are cached.

Coverage limit: ESCO skills are mapped to the closest O*NET item of the closest O*NET occupation (MiniLM, cosine >= 0.6,
`esco_onet_map.json`). Only 1,135 of 2,278 ESCO occupations get at least one mapped skill (2,651 skills in total), so
many roles show "outlook unavailable" rather than a guessed value.

| held-out test (O*NET 30.2-31.0) | value |
|---|---|
| skill importance MAE: last value / STF-KAN ensemble | 0.137 / 0.141 (98% of steps never change; persistence kept for levels) |
| rising-skill ranking AUC: STF-KAN / best heuristic | **0.568** / 0.528 (validated on 30.0-30.1 first) |
| lift of "rising" flags (top 5% chosen on validation) | **1.39x** the base rate (2.1%) |
| falling-skill and tool flags | off: STF-KAN did not beat heuristics on validation |

Reproduce: `python src/scripts/build_onet_history.py` -> `python src/scripts/train_and_select.py --dataset onet --seeds 42 7 2026
--out src/artifacts/onet -- --device cuda --batch-size 512 --lr 0.003` -> `python src/scripts/eval_direction.py --ckpt
src/artifacts/onet/stf_kan_best.pt` -> `python src/scripts/export_outlook.py --ckpt src/artifacts/onet/stf_kan_best.pt`.
The earlier 2023 job-ad experiment (`--dataset jobs`) remains reproducible as a training-only study.

Experiment, not shipped: XGBoost rising-skill ranker (`src/scripts/train_rising.py`, CUDA or `--device cpu`, ~1 min).
Adds cross-sectional features (how often a skill rose at past O*NET updates, overall and within its SOC group; years
since the occupation was last re-surveyed; distance from the cross-occupation mean). O*NET re-rates ~10% of
occupations once a year, so "overall" AUC includes the easy non-update quarters; "within update" is the honest number.

| rising skills, same event as above | STF-KAN | XGBoost |
|---|---|---|
| test overall AUC (31.0) | 0.568 | 0.851 |
| test within-update AUC (31.0) | 0.576 | 0.699 |
| validation within-update AUC (28.0 / 29.0 / 30.0) | - / - / 0.585 | 0.519 / 0.634 / 0.512 |
| validation lift of top-10% flags | - | 1.01x |

Validation did not confirm the test gain, so the app keeps the STF-KAN flags; choosing XGBoost on the test result
would be test-set selection.

### Earlier experiment: 2023 job-ad forecasting (training-only study, not used by the app)
Trained on an RTX 4060 Laptop GPU (CUDA 12.8): GPU sweep of 13 configs, then an 8-seed deep ensemble.
All choices (hyperparameters, variant, global-series loss weight 32, go/no-go) were made on validation only.

| model | test, all 2,610 series | test, 300 global series (shown in app) | validation, global |
|---|---|---|---|
| last value | 3.125 | 1.373 | 1.408 |
| 4-week mean | 2.562 | 1.124 | 1.132 |
| exp. smoothing (a=0.2) | 2.445 | 1.089 | 1.103 |
| pooled ridge (own + global window) | 2.445 | **1.089** | 1.104 |
| **STF-KAN 8-seed ensemble (served)** | **2.440** | 1.098 | **1.084** |
| sampling-noise floor (perfect forecaster) | 1.89 | 0.84 | 0.83 |

80% band (validation-error quantiles, separate for global/country): test coverage 80.2% global, 81.2% country.
STF-KAN beats every baseline on validation and on the all-series test, but on the global test weeks it is
0.009 pp behind the simple baselines (validation Sep-Oct vs test Nov-Dec behave differently). Remaining error
is dominated by binomial sampling noise. These are 2023 historical backtests, not 2026 predictions.
