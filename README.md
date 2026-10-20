# AiversePulse Enterprise - Project Scaffold

This is an **implementation scaffold**, not the finished forecasting or multi-agent product. It accompanies the SDLC handoff document.

## Intended MVP
Profile intake -> cost-aware router -> LangGraph profiling / MCP retrieval / gap analysis -> optional STF-KAN -> SDG pathway -> bounded validation -> user approval/audit.

## First 4 workstreams
- Owner A: `core/`, `agents/`, `tools/`.
- Owner B: `forecasting/`, `scripts/prepare_jobs.py`, training/evaluation.
- Owner C: `mcp_server/`, `governance/`, retrieval + evidence validation.
- Owner D: `ui/`, `app.py`, E2E testing and demo.

## Getting started
1. Install Python 3.11+.
2. `pip install -e .`
3. Copy `.env.example` to `.env` (do not commit secrets).
4. `streamlit run app.py` (currently shows the scaffold, not results).
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
python scripts/prepare_jobs.py --input data/raw/data_jobs.csv        # needs the HF CSV in data/raw/
python -m mcp_server.ingest --onet data/raw/onet/db_31_0_text.zip     # or --index-only (committed passages)
python scripts/train_and_select.py --seeds 42 7 2026 --out artifacts  # ~6 min CPU for 3 seeds
python scripts/seed_demo_users.py                                     # demo accounts -> data/demo_users.local.txt
pytest -q
streamlit run app.py
python -m mcp_server.server --http                                    # optional standalone MCP server
docker build -t aiversepulse . && docker run -p 8501:8501 -v aiversepulse-data:/app/data aiversepulse
```

### Web app (recommended UI)
```bash
uvicorn server.api:app --port 8600     # public: http://localhost:8600   ·   HR: http://localhost:8600/enterprise
```
FastAPI + plain HTML/CSS/JS (`web/`), no build step. The report streams like a chat: each agent's progress
arrives live over Server-Sent Events, then the Reviewer-verified summary types out with citation chips and the
gap table, scenario comparison, skill outlook and editable 30/60/90 plan build in turn. The JobSmart owl is a
rigged SVG (`web/js/owl-art.js` + `web/css/owl.css`): 12 states with real actions (blink, wave, headphones,
magnifier sweep, tablet, bell, confetti, Zzz…), pointer-following eyes, and it always shows the real agent
state. Preview all states at `/static/owl/preview.html`. HR runs a
team and watches each employee's 8-agent trace fill live. Session cookies are HttpOnly + SameSite=Strict,
mutating calls need the `X-AP` header, strict CSP. Streamlit (`app.py`) stays as a fallback.

LLM agents are off unless `GEMINI_API_KEY` and `LLM_FAST_MODEL` are set (see `.env.example`); everything works
deterministically without them. GPU is not needed (training is CPU-minutes); RunPod remains optional.

### Hackathon must-haves (v0.3)
See [docs/requirements_trace.md](docs/requirements_trace.md) for the full mapping to code and tests.
- **Intake:** quick-match MCQ game (13 scenarios + field + training), resume upload auto-converted to Markdown
  with evidence-quoted skills, or manual rating.
- **AI-trend signals, daily:** `python -m mcp_server.signals --refresh` (also runs once a day inside the web
  server; `SIGNALS_DAILY=0` turns it off). Public "Today" page and HR "Signals" view; agents read it via the
  `trend_signals` MCP tool.
- **Future-role matching** across all 899 occupations, **SDG mapping** to all 17 goals
  (`python scripts/build_sdg_map.py` rebuilds it from the UN SDG API), two AI scenarios.
- **HR hiring:** openings with plain-language thresholds, a public apply link, AI screening agents, blind
  ranked review, human shortlist / hold / decline with an audit log. Sample resumes: `data/samples/sample_resume_*.md`.

### Works for any job (O*NET 31.0)
The live agents cover all 899 rated O*NET occupations (search ~45k job titles: "nurse", "electrician", …).
Required levels = O*NET importance >= 3/5 skills, level rescaled 0-7 -> 0-5; Hot/In-Demand tools at an assumed
level 2. **Training data is never read at runtime**: the 2023 job-ad dataset and the O*NET release history are
used only to train/evaluate STF-KAN (guarded by a test).

### STF-KAN skill outlook (asset tool for the agents)
Trained on the O*NET release history 25.0 (Aug 2020) -> 31.0 (Aug 2026): 47,780 series (every occupation x skill
importance / tool Hot flag), 25 quarterly releases, 484k training windows, 3-seed ensemble on an RTX 4060.
The Market Analyst agent reads only the exported asset `data/snapshots/onet_outlook.json` over MCP
(`skill_outlook`), and the Gap Analyst ranks gaps by need x importance x outlook (required levels stay O*NET).

| held-out test (O*NET 30.2-31.0) | value |
|---|---|
| skill importance MAE: last value / STF-KAN ensemble | 0.137 / 0.141 (98% of steps never change; persistence kept for levels) |
| rising-skill ranking AUC: STF-KAN / best heuristic | **0.568** / 0.528 (validated on 30.0-30.1 first) |
| lift of "rising" flags (top 5% chosen on validation) | **1.39x** the base rate (2.1%) |
| falling-skill and tool flags | off: STF-KAN did not beat heuristics on validation |

Reproduce: `python scripts/build_onet_history.py` -> `python scripts/train_and_select.py --dataset onet --seeds 42 7 2026
--out artifacts/onet -- --device cuda --batch-size 512 --lr 0.003` -> `python scripts/eval_direction.py --ckpt
artifacts/onet/stf_kan_best.pt` -> `python scripts/export_outlook.py --ckpt artifacts/onet/stf_kan_best.pt`.
The earlier 2023 job-ad experiment (`--dataset jobs`) remains reproducible as a training-only study.

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
