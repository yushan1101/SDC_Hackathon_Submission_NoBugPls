# Requirements trace: Aiversecity "Future-Ready Workforce" brief

How might we build an AI-powered solution that continuously tracks AI advancement to predict emerging and
declining skills and jobs, matches the workforce to future roles, generates personalised reskilling pathways,
and shows how each role and skill connects to the 17 UN SDGs?

Every row below lists where the requirement is implemented and the test that checks it. "AI agents" are
software agents (LangGraph nodes and MCP tools). People only make the decisions: approving plans and
shortlisting candidates.

| # | Must-have | How it works | Code | Tests |
|---|---|---|---|---|
| 1 | **Skills profile intake** | Three ways in. (a) **Quick match game**: 13 multiple-choice work scenarios, each anchored to O*NET skill levels, plus field-of-interest and training questions. (b) **Resume upload** (PDF, DOCX, TXT or MD, 2 MB max): converted to Markdown in memory and never stored. Skills and tools are extracted with the verbatim line that proves each one, and the user can edit levels. (c) **Manual**: pick an occupation and rate its skills. HR can also upload a team CSV. | `agents/quiz.py`, `agents/resume.py`, `web/js/explore.js`, `core/team_import.py` | `test_quiz_scoring`, `test_resume_markdown_redaction_and_evidence`, `test_quiz_resume_and_match` |
| 2 | **AI-trend signal layer (updatable, dated source)** | A daily board built from Hacker News weekly story counts (log-linear trend with Poisson z and a Holt 4-week forecast), arXiv (recent-vs-prior rate test, skipped when rate-limited) and live job postings (Arbeitnow + Remotive keyword share against history). It covers 16 AI topics. MiniLM topic→occupation exposure turns these into **emergence** and **automation-pressure** scores for all 899 occupations. Each signal is evidence dated `signal:{day}:{topic}:{source}`. The board refreshes once per UTC day (in-process scheduler) or on demand from the HR console, and history is kept in SQLite. The AI agents read it through the `trend_signals` MCP tool. The **STF-KAN** forecaster is trained offline on the O*NET 25.0→31.0 release history and is served as an asset through the `skill_outlook` MCP tool; it ranks rising skills. | `mcp_server/signals.py`, `mcp_server/server.py` (`trend_signals`, `skill_outlook`), `server/api.py` (`/api/signals/*`, `_daily`) | `test_trend_model_detects_growth_and_stability`, `test_daily_board_is_dated_and_evidence_backed` |
| 3 | **Future-role matching + skills gap** | Every O*NET occupation is ranked. The skill fit is the F1 of coverage (importance-weighted share of the role's requirements met) and alignment (how much the role values the person's strongest skills), plus a small bonus for tool overlap. For resumes, MiniLM text similarity is blended in. Today's board reorders the ranking but never changes the fit. Filters: field of interest, and an O*NET Job Zone ceiling (roles one level above are marked "stretch"). Each match lists its top gaps. "Plan for this role" runs the full gap analysis under both AI scenarios. | `agents/matcher.py`, `agents/gap_analyst.py`, `core/graph.py` | `test_match_roles_field_filter_and_training_ceiling`, `test_public_stream_and_approval` |
| 4 | **Personalised reskilling pathway** | A 30/60/90-day plan capped to the learner's weekly hours. Gaps are prioritised by importance and STF-KAN outlook, and every activity cites evidence. The Reviewer repairs only the failing fields, at most twice. The plan stays a draft until a person approves it, and editing it creates a new version. | `agents/pathway.py`, `validation/revision.py`, `governance/approval.py` | `test_revision.py`, `test_approval.py`, `test_public_stream_and_approval` |
| 5 | **SDG mapping (all 17)** | MiniLM similarity between each occupation or skill and the 169 official UN SDG targets from the UN Statistics SDG API. Only confident matches are shown; otherwise the role falls back to SDG 8.5 (decent work), marked as a baseline. Every plan activity is tagged SDG 4 + SDG 8 plus the skill's strongest goal. Reports and role matches show goal chips in the official colours, with the matched target text as evidence. This is labelled a semantic suggestion, not an official UN classification. All 17 goals occur across occupations. | `scripts/build_sdg_map.py`, `agents/sdg.py`, `mcp_server/server.py` (`sdg_for`), `web/js/blocks.js` (`sdgBlock`, `sdgChip`) | `test_sdg_mapping_is_confident_or_baseline` |
| 6 | **More than one future scenario** | **Assistive AI**: O*NET levels as rated. **Agentic AI**: AI agents take over routine execution, so judgement and oversight skills weigh more and routine tool work weighs less (a stated assumption). Every report shows both side by side. The trend board adds a third, data-driven view (emerging vs. under-pressure roles). | `agents/gap_analyst.py`, `core/graph.py` (`scenario_comparison`), `web/js/blocks.js` (`comparisonBlock`) | `test_graph.py`, `test_agents.py` |

## HR: resume screening with natural-language thresholds

- **Set up submission.** HR creates an opening for any O*NET occupation and shares a public link
  (`/apply/{token}`). Applicants must give consent. Files are limited to 2 MB, and only Markdown is kept.
- **Natural-language thresholds.** HR writes, for example, "Top 5. Must know Epic, critical thinking at
  least 3, 3+ years, match above 60%". A deterministic parser (`agents/criteria.py`) shows HR exactly what it
  will apply and lists anything it did not understand. Criteria about protected characteristics are refused.
- **AI screening agents.** A LangGraph runs per resume: parse_resume → extract_skills (verbatim evidence) →
  assess_fit (O*NET requirements + resume text + today's board) → judge_criteria (pass or fail per
  threshold, with quotes). A ranking agent then recommends the top-k candidates that pass every threshold
  and explains each pick or rejection. Changing a threshold re-screens every applicant.
  Code: `core/screening.py`.
- **Blind review, human decision.** Reviewers see the redacted resume (name, contact details, links, age and
  pronouns removed). A named HR advisor makes each Shortlist, Hold or Decline decision, and it goes into an
  append-only log. Contact details unlock only after shortlisting. The agents never contact or reject anyone.
  Code: `governance/recruiting.py`. Tests: `test_recruiting_flow_blind_review_and_human_decision`,
  `test_screening_agents_and_ranking`, `test_criteria_parser_and_refusal`.

## Known limitations (honest)

- The quiz is a self-assessment and gives a coarse profile; the resume path is the evidence-backed analysis.
- Trend signals are noisy proxies, not ground truth. The job-posting trend needs at least 5 days of history
  before it contributes a z-score, and arXiv is optional because of rate limits.
- Matching on skills alone favours roles whose requirements are broad. The field and training filters, plus
  resume text similarity, mitigate this, but it is not validated against real hiring outcomes.
- SDG links are semantic suggestions, not an official UN mapping.
