# SDC Hackathon 2026: Phase 1 Preliminary Project Proposal (draft answers)

Draft answers for `Submission Template SDC Hackathon.pdf`, written from what the repository actually
implements. Fields marked **TODO** need the team's own details. Before submitting, copy the answers into the
PDF form and save it as `SDC2026_<TeamName>_Preliminary.pdf`. Word counts are given per answer.

## 1. Team & Project Overview

| Field | Answer |
|---|---|
| Team Name | **TODO** |
| Selected Domain | **TODO** (Domain 1 / Domain 2) |
| Selected SDG Track (1–17) | SDG 8: Decent Work and Economic Growth (secondary: SDG 4, Quality Education) |
| Project / Solution Name | AiversePulse Enterprise |
| Name (Leader) | **TODO** |
| Email & Phone (Leader) | **TODO** |
| University Affiliation(s) | **TODO** |
| Number of Team Members | **TODO** |

## 2. Executive Summary & Problem Statement

### 2.1 The Problem Context (≈ 185 words, limit 250)

Artificial intelligence is changing what jobs require faster than workers and employers can adapt. The World
Economic Forum's *Future of Jobs Report 2025* finds that employers expect 39% of the key skills required in the
job market to change by 2030. If the world's workforce were 100 people, 59 would need training by 2030, and 11
of them are unlikely to receive it. The same report projects 170 million jobs created and 92 million displaced
this decade.

The people most affected are mid-career and lower-skilled workers in routine roles, and the HR teams
responsible for them. Workers cannot see which of their skills are rising or fading, or which nearby roles they
could move into. HR teams plan training and screen candidates using job descriptions that lag behind the
technology. AI résumé screeners add a new risk: hidden text can manipulate them unseen ("prompt injection").

The economic cost is skills mismatch and avoidable displacement. The social cost falls hardest on workers
without access to career guidance. That widens inequality and works against decent work for all (SDG 8.5)
and relevant skills for employment (SDG 4.4).

*Source: World Economic Forum (2025), Future of Jobs Report 2025, https://www.weforum.org/publications/the-future-of-jobs-report-2025/*

### 2.2 The Proposed AI Solution (≈ 280 words, limit 300)

AiversePulse is a deployed web application with two faces: a free public site for individual workers and an
HR console for organisations. A team of AI agents, orchestrated with LangGraph and connected through a
Model Context Protocol (MCP) tool server, does the work:

1. **Skills intake.** A 13-question quick-match game, or a résumé upload that is converted to Markdown. A
   semantic classifier (MiniLM embeddings) maps each line to skills in ESCO, the European Commission's public
   taxonomy of about 3,000 occupations, and keeps the exact line as evidence.
2. **AI-trend signals, refreshed daily.** Public news (Hacker News), research (arXiv) and live job postings are
   scored into "emerging" and "automation pressure" for every occupation, with dated sources.
3. **Prediction.** Two models trained offline on O*NET supply the forecasts. One predicts how important each skill is and at what level. The other, a
   STF-KAN time-series forecaster, ranks skills likely to rise.
4. **Matching, gaps and pathway.** The agents rank future roles and compute skill gaps under *assistive* and
   *agentic* AI scenarios. They then write a cited 30/60/90-day plan that fits the learner's weekly hours.
5. **SDG mapping.** Every role and activity links to official UN SDG targets.
6. **Responsible hiring.** HR sets thresholds in plain English. Screening agents rank applicants blind,
   after a document guard strips hidden text and injected instructions. A human makes every decision.

Workshop skills used:
- **GenAI APIs:** optional Gemini for plain-language explanations; deterministic fallbacks keep it free to run.
- **Database architecture:** SQLite for accounts, versioned plans, audit log and trend history, plus a Chroma vector store for retrieval.
- **Cloud hosting:** Replit for the app, and RunPod GPUs for model training and batch embedding.

## 3. Technical Architecture & Implementation Plan

### 3.1 Conceptual Tech Stack

- **Frontend:** static HTML/CSS/JavaScript (no build step), deployable separately from the API.
- **Backend:** Python 3.11, FastAPI with Server-Sent Events streaming, a LangGraph multi-agent graph and a FastMCP tool server.
- **Data and AI:** Chroma vector database, sentence-transformers MiniLM, and PyTorch (STF-KAN forecaster, requirement model). SQLite stores accounts, approvals, audit and signals.
- **Public data:** ESCO v1.2, the UN SDG API, Hacker News, arXiv, Arbeitnow and Remotive. O*NET 31.0 is used for training only.
- **Hosting:** Replit for the web app, a RunPod Serverless GPU endpoint (`runpod/handler.py`) for training, and Docker.

Block diagram:

```
Browser (public site / HR console)
   │  HTTPS + SSE
   ▼
FastAPI on Replit ──► LangGraph agents ──► MCP tools ──► ESCO + RAG (Chroma) │ daily trend board │ SDG map │ STF-KAN asset
   │                                                       ▲
   ├─► SQLite (accounts, plans, approvals, recruiting, audit)│ daily refresh: HN · arXiv · job boards
   └─► Document guard → screening agents → human review
RunPod GPU (offline): O*NET ratings + release history → requirement model + STF-KAN → exported assets
```

**Sponsor-provided GenAI API or cloud platform:**
- **Replit:** hosting and development (`.replit`, `python src/main.py`).
- **RunPod:** GPU training and batch-embedding jobs through a serverless endpoint.
- **Gemini:** an optional GenAI API for narration.
**TODO:** confirm which of these were the official sponsor offers and attach the proof-of-use PDFs.

### 3.2 Design-Thinking & Deployment Strategy (≈ 170 words, limit 200)

- **Empathise:** we started from two users, an anxious worker asking "what next?" and an HR advisor under
  hiring and training pressure. Both need answers they can trust, so every claim cites a dated public source,
  and nothing is final until a person approves it.
- **Define:** we mapped the brief to six must-haves and traced each one to code and tests (`docs/requirements_trace.md`).
- **Ideate:** a quiz for speed and a résumé for depth, two AI scenarios instead of one prediction, and agents
  that recommend while humans decide.
- **Prototype:** a working end-to-end app, not mock-ups. Real data, streaming agent progress, an animated owl
  that shows what the agents are doing, and accessible layouts for desktop and mobile.
- **Test:** 74 automated tests run on every push. They include red-team PDFs with hidden injections, a guard
  that fails if live code reads training data, and honest model evaluation against baselines.

For Phase 2 deployment, the frontend and API deploy separately, run without a GPU or paid LLM, and refresh
their trend data daily.

## 4. Preliminary Environmental & SDG Impact Framework

| Metric Category | Response |
|---|---|
| **Target SDG Sub-Target(s)** | **Target 4.4:** "By 2030, substantially increase the number of youth and adults who have relevant skills, including technical and vocational skills, for employment, decent jobs and entrepreneurship." **Target 8.5:** "full and productive employment and decent work for all." |
| **Current Problem Baseline** | 59 of every 100 workers will need training by 2030, and 11 of them are unlikely to receive it (WEF Future of Jobs Report 2025). 39% of key skills are expected to change by 2030 (same source). Without a tool, a person must manually compare their skills against occupation requirements. **TODO:** measure the team's own baseline, e.g. minutes for a volunteer to produce a skills-gap list and plan with online search alone. |
| **Core Measurable KPI** | (1) Time from first visit to an approved, cited 90-day plan (minutes). (2) Share of plan recommendations backed by a verifiable source (%). (3) Share of hidden prompt-injection attacks removed before AI screening (%). (4) Error of predicted skill importance against held-out expert ratings (MAE). |
| **Phase 2 Impact Target** | (1) **≥ 80% less time** to a personalised plan than the manual baseline in a user test (target under 5 minutes). (2) **100%** of plan activities cite a source; the Reviewer agent blocks unsupported claims, already enforced in tests. (3) **100%** of the attacks in our red-team suite removed: currently 9 tests covering white text, micro fonts, off-page text, PDF metadata, DOCX hidden/white runs, zero-width characters and visible injection lines, all passing; the suite grows for Phase 2. (4) Importance error **≥ 25% below** a simple baseline on held-out occupations; currently 0.37 vs 0.50 MAE (26% lower; `data/snapshots/esco_requirements_card.json`). |

## 5. Eligibility & Readiness Checklist

- [ ] All team members completed the GenAI, Database and Cloud Deployment workshops (**TODO**: team to confirm)
- [x] The concept addresses a verified real-world problem mapped to UN SDGs (4.4, 8.5)
- [x] The solution is a functional, deployed application (web app + API; see README "How to Run")
- [ ] All fields completed within word limits (complete after filling the **TODO** fields)

## 6. IP & Originality Declaration

### 6.1 Pre-Existing / Prior-Owned Work
**TODO (team):** declare any work that existed before the hackathon. The git history of this repository
starts at the initial commit on 2026-10-19.

### 6.2 Third-Party Code, Datasets, or Models: Yes

| Name | Type | License |
|---|---|---|
| ESCO v1.2 (European Commission) | dataset | Free reuse with attribution (Commission Decision 2011/833/EU) |
| O*NET 31.0 Database and release history (USDOL/ETA) | dataset (training only) | CC BY 4.0 |
| data_jobs (Luke Barousse, HF `Ashy24/data_jobs`) | dataset (training only) | Apache-2.0 |
| UN SDG goals and targets (UN Statistics Division API) | dataset | UN public information |
| Hacker News (Algolia API), arXiv API, Arbeitnow, Remotive | data (counts and short excerpts) | public API terms |
| sentence-transformers/all-MiniLM-L6-v2 | pre-trained model | Apache-2.0 |
| FastAPI, LangGraph, FastMCP, Chroma, PyTorch, pandas, NumPy, scikit-learn | code | MIT / Apache-2.0 / BSD |
| pypdf, pdfplumber, pikepdf, PyMuPDF, python-docx | code | BSD / MIT / MPL-2.0 / AGPL-3.0 (PyMuPDF, used only in tests) |
| pdf-prompt-injection-toolkit (zhihuiyuze) | detection techniques referenced, no code copied | MIT |

### 6.3 Employment-Related IP Conflicts
**TODO (team):** Yes / No.

## 7. Declaration
Signature and date: **TODO** (team leader).
