# Data sources

| Source | Use | License / terms | Snapshot |
|---|---|---|---|
| data_jobs (Luke Barousse), HF mirror `Ashy24/data_jobs` | forecasting series + role skill rates | Apache-2.0 (card) | rev `ae47402`, lastModified 2026-09-17; ads 2023-01-01..2023-12-31 |
| O*NET 31.0 Database (USDOL/ETA) | occupation descriptions, core tasks, software skills (Hot Technology / In Demand), essential-skill importance | CC BY 4.0 | August 2026 release, `db_31_0_text.zip` |
| Official vendor/project docs (python.org, Microsoft Learn, AWS, Apache, ...) | learning resources | link only | URLs checked live at ingest |
| sentence-transformers/all-MiniLM-L6-v2 | embeddings | Apache-2.0 | rev `1110a24` |

Derived, committed: `data/snapshots/weekly_skill_demand.csv` (aggregates only: 2,610 series = global + country
series for role-country pairs averaging >=30 ads/week, x 30 skills x 53 weeks), `role_skills.json`,
`knowledge_passages.json` (580 attributed passages). Raw files stay in `data/raw/` (gitignored).

Known data caveats: Google-Jobs scrape, data roles only; country parsing in data_jobs is imperfect
(e.g. "Sudan" appears as a high-volume country); weeks with <30 eligible ads are missing, not 0%.

## Evaluated and NOT used for training (2026-10-20)
No public dataset extends data_jobs' history with comparable structured skill lists. Five HF repos are
exact mirrors. `ryang2/linkedin-job-scrape` (2023-2025, gaps) is research-only/no-redistribution and
free-text only; `futureproofds/ai-ds-job-market` has no license and its raw files contain an exposed
third-party API key; LinkedIn/Kaggle mirrors cover ~1 month. Mixing them would make skill rates
non-comparable without calibration.

Do not use post-2023 sources as features for the 2023 backtest (enforced: `search_labor_trends(as_of_date=...)`).
