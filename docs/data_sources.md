# Data sources

**Runtime (live agents), public sources only:** ESCO v1.2 occupations and skills, the daily AI-trend board
(Hacker News, arXiv, Arbeitnow, Remotive), UN SDG goals and targets, official learning links, and the exported
model outputs (requirement levels for ESCO skills, STF-KAN outlook).
**Training only (never read at runtime; enforced by `tests/test_runtime_sources.py`):** O*NET 31.0 ratings, the
O*NET release history 25.0-31.0, and the 2023 data_jobs job ads. They live in `data/raw/`, `data/training/`
and `data/training_snapshots/`.

| Source | Use | License / terms | Snapshot |
|---|---|---|---|
| ESCO v1.2 (European Commission) | RUNTIME: 2,938 occupations, 12,569 skills, essential/optional links, ISCO-08 codes | Free reuse with attribution (Decision 2011/833/EU) | `data/snapshots/esco_raw.json`, fetched 2026-10-20 via the public ESCO API |
| UN Statistics Division SDG API | RUNTIME: 17 goals, 169 targets for SDG mapping | UN public information | `data/snapshots/sdg_map.json` |
| Hacker News (Algolia API), arXiv API, Arbeitnow, Remotive | RUNTIME: daily AI-trend signals | public APIs; counts and short excerpts only | SQLite `signal_counts`, `signal_boards` |
| O*NET 31.0 Database (USDOL/ETA) | TRAINING ONLY: 140,381 importance/level ratings train the ESCO requirement model | CC BY 4.0 | `db_31_0_text.zip` (gitignored) |
| O*NET releases 25.0 .. 30.3 (USDOL/ETA) | TRAINING ONLY: STF-KAN outlook (quarterly series Aug 2020 - Aug 2026) | CC BY 4.0 | rebuilt by `scripts/build_onet_history.py` |
| data_jobs (Luke Barousse), HF mirror `Ashy24/data_jobs` | TRAINING ONLY: 2023 job-ad forecasting experiment | Apache-2.0 (card) | rev `ae47402`; ads 2023-01-01..2023-12-31 |
| Official vendor/project docs (python.org, Microsoft Learn, AWS, Apache, ...) | learning resources | link only | URLs checked at ingest |
| sentence-transformers/all-MiniLM-L6-v2 | embeddings (matching, RAG, SDG mapping) | Apache-2.0 | rev `1110a24` |

Derived, committed: `data/snapshots/esco_occupations.json` (ESCO + predicted levels), `esco_outlook.json`,
`knowledge_passages.json` (18,444 attributed passages), `sdg_map.json`. Training-side aggregates are in
`data/training_snapshots/`.

Known data caveats: Google-Jobs scrape, data roles only; country parsing in data_jobs is imperfect
(e.g. "Sudan" appears as a high-volume country); weeks with <30 eligible ads are missing, not 0%.

## Evaluated and NOT used for training (2026-10-20)
No public dataset extends data_jobs' history with comparable structured skill lists. Five HF repos are
exact mirrors. `ryang2/linkedin-job-scrape` (2023-2025, gaps) is research-only/no-redistribution and
free-text only; `futureproofds/ai-ds-job-market` has no license and its raw files contain an exposed
third-party API key; LinkedIn/Kaggle mirrors cover ~1 month. Mixing them would make skill rates
non-comparable without calibration.

Do not use post-2023 sources as features for the 2023 backtest (enforced: `search_labor_trends(as_of_date=...)`).
