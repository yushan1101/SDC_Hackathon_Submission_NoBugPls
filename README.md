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

LLM agents are off unless `GEMINI_API_KEY` and `LLM_FAST_MODEL` are set (see `.env.example`); everything works
deterministically without them. GPU is not needed (training is CPU-minutes); RunPod remains optional.

### Forecast accuracy (held-out Nov-Dec 2023, 3 seeds, MAE in percentage points)
| model | all 2,610 series | 300 global series |
|---|---|---|
| last value | 3.125 | 1.373 |
| 4-week mean | 2.562 | 1.124 |
| exp. smoothing (a=0.2) | 2.445 | 1.089 |
| pooled ridge (own + global window) | 2.445 | 1.089 |
| **STF-KAN (served, chosen on validation)** | **2.437-2.439** | 1.092-1.095 |
| sampling-noise floor (perfect forecaster) | 1.89 | 0.84 |

STF-KAN beats every baseline on all series and on global *validation*, but ties/loses by ~0.005 pp on global test.
Most remaining error is binomial sampling noise in weekly ad counts; no public dataset was found that adds
comparable history (docs/data_sources.md). These are 2023 historical backtests, not 2026 predictions.
