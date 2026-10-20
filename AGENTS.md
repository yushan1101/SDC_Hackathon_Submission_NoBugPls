# AiversePulse Enterprise — Coding-Agent Entry Point

**Read `docs/SDLC_AGENT_GUIDE.md` before any implementation.** It is the authoritative, agent-readable SDLC and technical contract for this hackathon MVP. Also inspect `README.md`, `docs/api_contracts.md`, and the existing source code.

## Before editing

1. Identify which owner/workstream you are assigned: A (LangGraph), B (STF-KAN/RunPod), C (FastMCP/governance), or D (Streamlit/QA).
2. Inspect the existing files. This repository is a **scaffold**, not a fully implemented product.
3. State the files you will edit, integration dependencies, acceptance tests, and any blockers.
4. Preserve Pydantic request types and update `docs/api_contracts.md` on approved contract changes.

## Mandatory guarantees

- Public or authorized data only; never commit API keys, resumes or sensitive logs.
- No made-up citations, training accuracy, cost savings or model claims.
- No post-2023 publication as a feature in 2023 forecasting backtests.
- Deterministic checks first; expensive multi-agent pipeline only when justified.
- Revise only failing fields; **maximum two revision attempts**.
- Drafts require explicit human approval; editing an approved plan creates a new draft version.
- RunPod total credit <=**$25** (compute $14, storage $3, reserve $8); check rates before launching a GPU.
- Keep the app demo functional without a checkpoint/GPU, showing a baseline or a clearly labeled unavailable forecast.

## Completion report format

```text
Task / owner:
Files changed:
What was implemented:
Tests executed and results:
Observed token/GPU cost (if any):
Known limitations or unverified dependencies:
Next action:
```

Read [the complete SDLC](docs/SDLC_AGENT_GUIDE.md), especially Sections 0, 3, 8, 9, and 10.
