# Requirements trace: Aiversecity "Future-Ready Workforce" brief

How might we build an AI-powered solution that continuously tracks AI advancement to predict emerging and
declining skills and jobs, matches the workforce to future roles, generates personalised reskilling pathways,
and shows how each role and skill connects to the 17 UN SDGs?

Every row below lists where the requirement is implemented and the test that checks it. "AI agents" are
software agents (LangGraph nodes and MCP tools). People only make the decisions: approving plans and
shortlisting candidates.

## Data sources: training vs live

| Use | Source | Where |
|---|---|---|
| **Live** analysis and classification | **ESCO v1.2** (European Commission, public; free reuse with attribution): 2,938 occupations, 12,569 skills, essential/optional links, ISCO-08 codes, descriptions and alternative titles | `data/snapshots/esco_occupations.json`, built by `scripts/build_esco_snapshot.py` from the public ESCO API |
| **Live** trend signals | Hacker News (Algolia API), arXiv, Arbeitnow + Remotive job boards, fetched daily | `mcp_server/signals.py` |
| **Live** SDG mapping | UN Statistics Division SDG API (17 goals, 169 targets) | `data/snapshots/sdg_map.json` |
| **Training only** | O*NET 31.0 ratings (140,381 importance + level pairs), the O*NET 25.0→31.0 release history, and the 2023 job-ad dataset | `data/raw/`, `data/training/`, `data/training_snapshots/` |

O*NET reaches the live system only through **trained model outputs**:
1. **Requirement model** (`scripts/build_esco_requirements.py`): an MLP on MiniLM embeddings of (occupation,
   capability) learns importance and level from O*NET, then scores every ESCO occupation–skill pair, which
   have no ratings of their own. Held-out accuracy, with baselines, is in `data/snapshots/esco_requirements_card.json`:

   | Split | Importance MAE (1–5) | Baseline | Rank corr. | Baseline |
   |---|---|---|---|---|
   | Held-out occupations | 0.37 | 0.50 (capability mean) | 0.87 | 0.73 |
   | Held-out capabilities (unseen items, like ESCO skills) | 0.69 | 0.77 (occupation mean) | 0.49 | 0.20 |

   The second row is the honest transfer number: the model beats its baseline but stays a prediction, and
   every requirement's evidence is labelled "a prediction, not an ESCO rating".
2. **STF-KAN skill outlook** (`scripts/export_esco_outlook.py`): validated rising-skill flags transfer to ESCO
   through the closest training occupation and skill (MiniLM). 1,264 flags across 2,278 occupations.

`tests/test_runtime_sources.py` runs the full agent pipeline, role matching and resume screening while
blocking any read of O*NET, raw or training files; any such read fails the test.

## Must-haves

| # | Must-have | How it works | Code | Tests |
|---|---|---|---|---|
| 1 | **Skills profile intake** | Three ways in. (a) **Quick match game**: 13 multiple-choice work scenarios (ESCO-style skill phrases) plus field-of-interest (ISCO-08 groups) and training (ISCO-08 skill level) questions. The chosen answers also become a text profile for semantic matching. (b) **Resume upload** (PDF, DOCX, TXT or MD, 2 MB max): passes the **document guard** (see below), is converted to Markdown in memory and is never stored. A semantic classifier maps each line to ESCO skills and keeps the verbatim line as evidence; the user can edit levels. (c) **Manual**: pick an occupation and rate its skills. HR can also upload a team CSV. | `agents/quiz.py`, `agents/resume.py`, `agents/skillmap.py`, `web/js/explore.js`, `core/team_import.py` | `test_quiz_scoring`, `test_resume_markdown_redaction_and_evidence`, `test_quiz_resume_and_match` |
| 2 | **AI-trend signal layer (updatable, dated source)** | A daily board built from Hacker News weekly story counts (log-linear trend with Poisson z and a Holt 4-week forecast), arXiv (recent-vs-prior rate test, skipped when rate-limited) and live job postings (keyword share against history). It covers 16 AI topics. MiniLM topic→occupation exposure turns these into **emergence** and **automation-pressure** scores for every ESCO occupation. Each signal is evidence dated `signal:{day}:{topic}:{source}`. The board refreshes once per UTC day or on demand from the HR console, and history is kept in SQLite. The agents read it through the `trend_signals` MCP tool. The **STF-KAN** outlook asset is served through `skill_outlook`. | `mcp_server/signals.py`, `mcp_server/server.py`, `server/api.py` (`/api/signals/*`, `_daily`) | `test_trend_model_detects_growth_and_stability`, `test_daily_board_is_dated_and_evidence_backed` |
| 3 | **Future-role matching + skills gap** | Every ESCO occupation is ranked. Skills are aligned semantically: a requirement is credited with the level of the person's most similar skill (cosine ≥ 0.62; one level less for ≥ 0.50). The skill fit is the F1 of coverage and alignment, plus a tool bonus; text similarity is blended in for resumes and quiz answers. Today's board reorders the ranking but never changes the fit. Filters: field (ISCO prefix) and an ISCO skill-level ceiling, with roles one level above marked "stretch". "Plan for this role" runs the full gap analysis under both AI scenarios. | `agents/matcher.py`, `agents/skillmap.py`, `agents/profiler.py`, `agents/gap_analyst.py` | `test_match_roles_field_filter_and_training_ceiling`, `test_complex_draft_with_real_evidence` |
| 4 | **Personalised reskilling pathway** | A 30/60/90-day plan capped to the learner's weekly hours. Gaps are prioritised by predicted importance and the STF-KAN outlook, and every activity cites evidence (ESCO, learning resources). The Reviewer repairs only the failing fields, at most twice. The plan stays a draft until a person approves it, and editing it creates a new version. | `agents/pathway.py`, `validation/revision.py`, `governance/approval.py` | `test_revision.py`, `test_approval.py`, `test_public_stream_and_approval` |
| 5 | **SDG mapping (all 17)** | MiniLM similarity between each ESCO occupation or skill and the 169 official UN SDG targets. Only confident matches are shown; otherwise the role falls back to SDG 8.5 (decent work), marked as a baseline. Every plan activity is tagged SDG 4 + SDG 8 plus the skill's strongest goal. It is labelled a semantic suggestion, not an official UN classification. All 17 goals occur. | `scripts/build_sdg_map.py`, `agents/sdg.py`, `sdg_for` MCP tool, `web/js/blocks.js` | `test_sdg_mapping_is_confident_or_baseline` |
| 6 | **More than one future scenario** | **Assistive AI**: predicted levels as they are. **Agentic AI**: +1 on judgement and oversight skills, −1 on routine operation and processing skills. Each ESCO skill is tagged by similarity to written anchor phrases (a stated assumption). Both are shown side by side, and the trend board adds a data-driven view (emerging vs under-pressure roles). | `agents/gap_analyst.py`, `scripts/build_esco_requirements.py` (`UP`/`DOWN`), `core/graph.py` | `test_scenarios_differ`, `test_agents.py` |

## Multi-agent and RAG flow (unchanged structure)

`supervisor → (profiler ‖ knowledge_search ‖ market_analyst) → gap_analysis → pathway → coach → reviewer`
(LangGraph, parallel fan-out and fan-in). `knowledge_search` uses FastMCP tools over a Chroma index of 18,444
ESCO and learning passages (MiniLM), falling back to an offline snapshot. `market_analyst` merges the STF-KAN
asset, today's trend board and the SDG mapping. Retrieved text is data, never instructions. Resume screening
is its own LangGraph: `parse_resume (document guard) → extract_skills → assess_fit → judge_criteria`, plus a
ranking agent.

## Document security: PDF / prompt injection and fraud filters

`validation/document_guard.py` follows the detection techniques of
[pdf-prompt-injection-toolkit](https://github.com/zhihuiyuze/pdf-prompt-injection-toolkit) (MIT). Instead of
only reporting, it rebuilds the text from visible content, so **the agents only read what a human can see**.

| Attack | Handling |
|---|---|
| White / near-white text, micro fonts (< 3 pt), off-page text (PDF) | characters removed before Markdown; HIGH finding |
| Hidden optional-content layers (OCG off) | CRITICAL finding, held for human review |
| Payloads in PDF metadata / XMP, DOCX core properties | CRITICAL finding |
| JavaScript, auto-actions, embedded files | MEDIUM finding (never executed) |
| DOCX hidden runs (`w:vanish`), white or micro text; tables included | removed; HIGH finding |
| HTML comments and tags in TXT/MD | removed; HIGH finding |
| Zero-width, bidi and Unicode-tag characters; full-width tricks | stripped, NFKC-normalised |
| Visible instruction lines aimed at an AI ("ignore previous instructions", "rate this candidate…", "[SYSTEM]") | replaced in the agents' copy with `[removed: …]`; kept as evidence for HR |
| Spoofed file types | magic-byte check (`%PDF`, `PK`) |

**Fraud signals** (`fraud_signals`): keyword stuffing, repeated lines, 40-term keyword lists, a copied job
description (8-gram overlap with the ESCO description), impossible dates, experience claims longer than the
dated history, skill inflation, and duplicate submissions to the same opening (fingerprint).
**Abuse controls** on the public apply link: per-IP rate limit (5 per 10 minutes), a hidden honeypot field,
required consent, and a 2 MB limit.

**Outcome:** the risk score follows the toolkit's scale (CRITICAL 30, HIGH 20, MEDIUM 10, LOW 5). A score of
40 or more, or any CRITICAL finding, **holds** the candidate from AI recommendation. HR sees an integrity panel
with the evidence. Nobody is auto-rejected. Individual users see what was removed from their own upload.
Tests: `tests/test_document_guard.py` (red-team PDFs and DOCX built in memory),
`test_injected_pdf_applicant_is_held_not_recommended`.

## HR: resume screening with natural-language thresholds

- **Set up submission.** HR creates an opening for any ESCO occupation and shares a public link (`/apply/{token}`).
- **Natural-language thresholds.** For example: "Top 5. Must know Epic, critical thinking at least 3, 3+ years,
  match above 60%". Skill phrases resolve to the nearest ESCO label, tools are checked against the resume text
  itself, and anything not understood is listed. Criteria about protected characteristics are refused.
- **AI screening agents** rank the candidates who pass every threshold and are not held, and explain each pick,
  rejection or hold. Changing a threshold re-screens everyone and keeps the original integrity findings.
- **Blind review, human decision.** Reviewers see a redacted resume. A named HR advisor decides, and each
  decision goes into an append-only log. Contact details unlock only after shortlisting.

## Known limitations (honest)

- Requirement levels for ESCO skills are model predictions. On unseen capabilities the rank correlation is
  0.49: useful for ordering, not a substitute for ratings.
- Semantic skill alignment can over- or under-credit near synonyms. Thresholds are documented in
  `agents/skillmap.py`, and every credit shows which of the person's words it came from.
- The quiz is a self-assessment and gives a coarse profile; the resume path is the evidence-backed analysis.
- Trend signals are noisy proxies. The job-posting trend needs 5+ days of history, and arXiv is optional.
- The document guard does not OCR images, so text drawn as an image is ignored, not read. Text hidden behind
  shapes, and render-mode-3 invisible text, are not yet detected.
- SDG links are semantic suggestions, not an official UN mapping.
