# AiversePulse Enterprise

> An AI multi-agent workforce platform that tracks AI advancement daily, predicts which skills and roles are emerging or under pressure, matches people to future roles, and builds a personalised 90-day reskilling plan, for individual workers and for HR teams.

---

## Team Information

| Field                  | Details                                                        |
| ---------------------- | -------------------------------------------------------------- |
| **Team Name**          | _TODO_                                                         |
| **Team Domain**        | _TODO: Domain 1 / Domain 2_                                    |
| **SDG Track (1–17)**   | SDG 8 — Decent Work and Economic Growth (with SDG 4 — Quality Education) |
| **Team Leader**        | _TODO_                                                         |
| **University**         | _TODO_                                                         |
| **Number of Members**  | _TODO_                                                         |

## Links

| Resource          | Link                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| GitHub Repository | https://github.com/yushan1101/SDC_Hackathon_Submission_NoBugPls      |
| Replit Project    | _TODO_                                                               |
| Live Demo         | _TODO_                                                               |
| RunPod Endpoint   | _TODO: https://api.runpod.ai/v2/&lt;endpoint-id&gt;_                 |
| Slide Deck        | _TODO_                                                               |
| Demo Video        | _TODO_                                                               |

---

## Overview

### Problem

AI is reshaping work faster than people can re-skill. Employers expect **39% of key skills** to change by 2030,
and **59 of every 100 workers** will need training by then, with 11 of them unlikely to receive it
([WEF Future of Jobs Report 2025](https://www.weforum.org/publications/the-future-of-jobs-report-2025/)).
Workers don't know which of their skills are rising or fading, and HR teams screen and plan training without
current evidence. Meanwhile AI résumé screeners can be fooled by hidden "prompt injection" text.

### Solution

AiversePulse runs a team of AI agents (LangGraph + an MCP tool server):

- **Daily trend signals.** One agent reads a daily AI-trend board built from public news, research and job-posting signals.
- **Profile and matching.** Others profile the person from a quick quiz or a résumé and match them across ~3,000 occupations in ESCO, the European Commission's public skills taxonomy.
- **Plan with sources.** The rest predict skill gaps under two AI scenarios and write a cited 30/60/90-day plan.

A person approves every plan and every hiring decision.

Models trained offline on O*NET learn how important each skill is and forecast which skills are rising. Only their outputs are used live; O*NET itself is training data only.

### Key Features

- **Three ways in.** A 13-question quick-match game, a résumé upload converted to Markdown with an evidence quote for every skill, or picking a target job.
- **Daily AI-trend board.** Hacker News, arXiv and live job postings, scored into "emerging" and "automation pressure" for every occupation, with dated evidence.
- **Future-role matching and skill gaps** under *assistive* vs *agentic* AI scenarios, plus a STF-KAN skill-outlook forecast.
- **Personalised 90-day plan.** Fits the learner's weekly hours, cites its sources, and can be edited and approved by a person.
- **UN SDG mapping (all 17).** Every role and plan activity links to official SDG targets.
- **HR hiring.** Thresholds written in plain English, a public apply link, AI screening agents, blind ranked review, and human shortlist/hold/decline with an audit log.
- **Document guard.** Strips hidden PDF/Word text and prompt-injection lines, and flags fraud signals. Risky résumés are held for a human, never auto-rejected.

### Tech Stack

| Layer         | Technology                                                                 |
| ------------- | -------------------------------------------------------------------------- |
| Frontend      | Plain HTML/CSS/JavaScript ES modules (`web/`, no build step), rigged SVG owl companion |
| Backend       | Python 3.11, FastAPI (Server-Sent Events streaming), LangGraph multi-agent graph, FastMCP tool server |
| Database      | SQLite (accounts, sessions, immutable plan versions, audit log, trend history), Chroma vector store |
| AI / Compute  | MiniLM sentence embeddings, STF-KAN forecaster (PyTorch), requirement model (PyTorch); GPU training via RunPod (`runpod/handler.py`); optional Gemini LLM for narration |
| Hosting / Dev | Replit (`.replit`, `python src/main.py`); Docker; static frontend deployable separately (`deploy/`) |
| Data          | ESCO v1.2 (live), UN SDG API (live), HN / arXiv / Arbeitnow / Remotive (live, daily); O*NET 31.0 (training only) |

---

## Project Structure

```
.
├── docs/                    # Requirements trace, architecture, technical README, data sources, API contracts
├── runpod/
│   ├── handler.py           # RunPod serverless handler (GPU: STF-KAN training, requirement model, embeddings)
│   └── Dockerfile           # GPU worker image
├── src/
│   ├── main.py              # Application entry point (starts the web app + API)
│   ├── agents/              # Profiler, knowledge, gap analyst, pathway, coach, matcher, quiz, resume, SDG, criteria
│   ├── core/                # LangGraph pipelines (reskilling graph, resume screening), shared state
│   ├── mcp_server/          # FastMCP tools, RAG retrieval (Chroma), daily AI-trend signals
│   ├── server/              # FastAPI app (public + HR APIs, SSE streaming)
│   ├── validation/          # Reviewer repairs, document guard (prompt-injection / fraud filters)
│   ├── governance/          # Accounts, approval workflow, recruiting store, audit log
│   ├── forecasting/         # STF-KAN model, training and evaluation
│   ├── config/  tools/  ui/ # Settings, helpers, Streamlit fallback UI
│   └── app.py               # Streamlit fallback app
├── web/                     # Static frontend: public site, HR console (enterprise.html), apply page, config.js
├── data/
│   ├── snapshots/           # Live public snapshots (ESCO, SDG map, model outputs, RAG passages)
│   ├── training_snapshots/  # Training-only data (never read at runtime)
│   └── samples/             # Fictional sample team CSV and résumés
├── scripts/                 # Data builders, training, export (ESCO, SDG map, STF-KAN, requirement model)
├── deploy/                  # Separate frontend (nginx) + API docker-compose example
├── submission/              # Required submission documents
│   ├── REPLIT PROOF OF USE.pdf
│   ├── RUNPOD PROOF OF USE.pdf
│   ├── Submission Template SDC Hackathon.pdf
│   └── PROPOSAL_DRAFT.md    # Draft answers for the Phase 1 proposal form
├── tests/                   # 74 pytest tests (agents, API, security, runtime data isolation, RunPod handler)
├── .env.example             # Example environment variables
├── .gitignore
├── .replit                  # Replit run configuration
├── Dockerfile               # CPU image for the web app + API
├── LICENSE
├── pyproject.toml           # Package + dependencies
├── requirements.txt         # pip entry point (installs pyproject dependencies, CPU torch)
└── README.md
```

### Architecture

```
                         ┌──────────── daily refresh ────────────┐
                         │  HN · arXiv · Arbeitnow · Remotive    │
                         ▼                                        │
User ─► web/ (public site / HR console) ─► FastAPI (src/server) ──┤
        quiz · résumé · plan · hiring          │  SSE stream      │
                                               ▼                  │
                     LangGraph agents: supervisor → profiler ‖ knowledge ‖ market → gaps → pathway → coach → reviewer
                                               │                            │
                                FastMCP tools ─┤─ ESCO + RAG (Chroma, MiniLM)
                                               ├─ trend_signals (daily board)    ├─ sdg_for (UN SDG targets)
                                               └─ skill_outlook (STF-KAN asset)  └─ match_roles
                                               │
                     SQLite: accounts · plan versions · approvals · recruiting · audit log
Résumé ─► document guard (visible text only, injection/fraud) ─► screening agents ─► ranked, blind review ─► human decision
Offline / GPU (RunPod): O*NET ratings + release history ─► requirement model + STF-KAN ─► exported ESCO-keyed assets
```

Full requirement mapping: [`docs/requirements_trace.md`](docs/requirements_trace.md) · deep technical notes: [`docs/TECHNICAL.md`](docs/TECHNICAL.md).

---

## How to Run

### Option 1 — Run on Replit (Recommended)

1. Open the [Replit Project](#links), or import this repository via **Create Repl → Import from GitHub**.
2. Open the **Secrets** tab (🔒) and add the variables you need from `.env.example`:
   - `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID` (only for GPU jobs)
   - `GEMINI_API_KEY`, `LLM_FAST_MODEL` (optional; without them every agent runs deterministically)
3. In the Shell: `pip install -r requirements.txt` and `python scripts/seed_demo_users.py` (creates demo
   accounts; passwords are written to `data/demo_users.local.txt`, which is never committed).
4. Click **Run**. Replit uses the `.replit` file to start `python src/main.py`.
   - Public site: `/`
   - HR console: `/enterprise`

### Option 2 — Run Locally

```bash
# 1. Clone the repository
git clone https://github.com/yushan1101/SDC_Hackathon_Submission_NoBugPls.git
cd SDC_Hackathon_Submission_NoBugPls

# 2. Create and activate a virtual environment (Python 3.11+)
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment variables
cp .env.example .env            # then fill in your values (all optional for the demo)

# 5. Create demo accounts, then run the app
python scripts/seed_demo_users.py
python src/main.py              # http://localhost:8600  ·  HR: http://localhost:8600/enterprise
```

Optional: `python -m mcp_server.ingest --index-only` builds the Chroma vector index. Without it, retrieval
falls back to the committed offline snapshot. `python -m mcp_server.signals --refresh` builds today's
AI-trend board immediately; it otherwise refreshes once a day.

### Run Tests

```bash
python -m pytest -q
```

---

## How We Use Replit *(Required)*

- **Development and hosting:** the repo is Replit-ready. `.replit` starts `python src/main.py` on Replit's port, and the `[deployment]` section installs, seeds demo users and serves the app. _TODO: add the deployed URL to Live Demo._
- **Secrets:** API keys (RunPod, optional Gemini) live in Replit Secrets. `.env` and the demo-password file are git-ignored, and nothing secret is committed.
- **Collaboration:** _TODO: describe how the team used Replit (e.g. Multiplayer sessions, Deployments)._

📄 Proof of use: [`submission/REPLIT PROOF OF USE.pdf`](submission/REPLIT%20PROOF%20OF%20USE.pdf) _(TODO: replace the example PDF with real screenshots)_

## How We Use RunPod *(Required)*

- **Workload:** GPU training and batch inference, never the live request path, so the demo works without a GPU.
  `runpod/handler.py` exposes four tasks:
  - `train_stfkan`: trains the STF-KAN forecaster on the O*NET 25.0→31.0 release history.
  - `train_requirements`: trains the requirement model on 140k O*NET ratings and scores every ESCO skill.
  - `embed`: batch MiniLM embeddings for résumés and occupations.
  - `health`
- **Setup:** build `runpod/Dockerfile` and deploy it as a **RunPod Serverless Endpoint**. Mount a network volume at `/runpod-volume` for `data/` and `artifacts/`.
- **Budget:** the project rule is a $25 RunPod cap, with the per-second rate checked before each launch.
- **Status:** so far, model training was also reproduced on a local RTX 4060 (`docs/experiment_log.md`). _TODO: add the endpoint ID and proof of the RunPod runs._

Example request:

```bash
curl -X POST https://api.runpod.ai/v2/$RUNPOD_ENDPOINT_ID/runsync \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input": {"task": "train_stfkan", "seeds": [42, 7, 2026]}}'
```

📄 Proof of use: [`submission/RUNPOD PROOF OF USE.pdf`](submission/RUNPOD%20PROOF%20OF%20USE.pdf) _(TODO: replace the example PDF with real screenshots)_

---

## Challenges & Learnings

- **Forecasting honestly.** O*NET skill ratings barely change between releases (98% of steps are flat), so
  "no change" is a strong baseline. We report it, keep it for levels, and use STF-KAN only where it beats
  heuristics on held-out data: ranking rising skills (AUC 0.568 vs 0.528, 1.39× lift).
- **Training data vs live data.** We wanted public, current sources live and O*NET for training only. A model
  learns importance and level from O*NET and transfers them to ESCO skills. On unseen skills it beats the
  baseline (rank correlation 0.49 vs 0.20) but stays a labelled prediction. A test fails if the live app opens
  any training file.
- **Prompt injection is real.** White text, 1-pt fonts and metadata can hide instructions from human
  reviewers. Rebuilding text from what is visible, rather than only detecting, keeps the agents and the
  humans looking at the same document.
- **Humans stay in charge.** The AI agents recommend and explain. Plans and hiring decisions always need a
  named person, and protected characteristics are refused in hiring criteria.

## Future Improvements

- [ ] OCR for image-only résumés, and detection of text hidden behind shapes
- [ ] Validate role matching against real career-transition outcomes
- [ ] Multi-language ESCO labels (ESCO has 28 languages) for non-English users
- [ ] Per-agent model routing (small models for routing, larger for narration) with cost tracking
- [ ] Shared rate-limit store and job queue for multi-worker deployments

## Team

| Name         | Role                | GitHub                                       |
| ------------ | ------------------- | -------------------------------------------- |
| Tang Yu Shan | _TODO_              | [@yushan1101](https://github.com/yushan1101) |
| BOYU         | _TODO_              | _TODO_                                       |
| _TODO_       | _TODO_              | _TODO_                                       |

---

## Submission Checklist

- [ ] Team name, domain (Domain 1 / Domain 2) and SDG track filled in
- [ ] Slide deck link added
- [ ] Demo video link added
- [ ] Replit used, with proof of use in `submission/`
- [ ] RunPod used, with proof of use in `submission/`
- [ ] Submission template completed in `submission/` (draft answers: [`submission/PROPOSAL_DRAFT.md`](submission/PROPOSAL_DRAFT.md))
- [x] "How to Run" steps verified (fresh virtual environment + CI on every push)
- [x] No API keys or secrets committed to the repository

## License

This project is licensed under the [Apache License 2.0](LICENSE).

Third-party data and models keep their own licenses:
- ESCO © European Union, free reuse with attribution
- O*NET 31.0, CC BY 4.0, USDOL/ETA (training only)
- UN SDG content © United Nations
- all-MiniLM-L6-v2, Apache 2.0

See [`submission/PROPOSAL_DRAFT.md`](submission/PROPOSAL_DRAFT.md) §6.2.
