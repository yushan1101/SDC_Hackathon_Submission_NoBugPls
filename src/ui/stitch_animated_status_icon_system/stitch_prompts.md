# Google Stitch prompts — AiversePulse UI redesign

Two products, two design languages, one data model:
- **AiversePulse** (public users): calm, editorial, guided. Feels like a well-made personal finance or reading app.
- **AiversePulse Enterprise** (HR advisors): dense, fast, split-pane. Feels like Linear / Bloomberg-lite, not a marketing site.

How to use in Stitch: paste **one block per generation**. Pick "Mobile" or "Web" in Stitch to match the block
title. Start each product with its Design System prompt, then generate screens in the order listed, and keep
iterating inside the same project so the style carries over. All numbers below are real app data; keep them.

---

## 0. Anti-generic rules (append to ANY prompt if a result looks "AI-made")

```text
Hard constraints: no gradients, no glassmorphism, no glow, no purple, no emoji, no stock illustrations or 3D blobs,
no "hero + three feature cards" layout, no pill-shaped everything. Corner radius 0-2px only. Use 1px hairline
rules instead of drop shadows. Strict 8px grid, left-aligned text, tabular numbers for all figures. One accent
color only, used for the single primary action and for data highlights. Real labels, no lorem ipsum, no
placeholder avatars. Icons: thin 1.5px outline, used sparingly, never decorative.
```

---

## A. AiversePulse — public users

### A0. Design system (generate first)

```text
Design system for "AiversePulse", a free career reskilling tool for the general public. Mood: editorial,
trustworthy, quietly confident — like a printed field guide, not a tech startup.
Colors: paper background #F4F1EA, ink text #14130F, secondary text #5C5A52, hairline rules #D9D4C7,
single accent "signal vermilion" #D9481C (primary buttons, key numbers only), success #2E6B3F, warning #A86A00.
Type: headings in "Fraunces" (opsz high, weight 600, tight tracking -1%), body and UI in "Public Sans" 15/24,
numbers in "IBM Plex Mono" with tabular figures. Big type contrast: page titles 44px desktop / 30px mobile.
Shapes: 0px radius on cards, 2px on inputs and buttons, 1px #D9D4C7 rules, no shadows.
Components to show on one sheet: primary button (solid vermilion, ink text on hover underline), secondary
button (1px ink outline), text input, 0-5 proficiency segmented control (six square cells labelled 0..5),
hours-per-week stepper, chip for a skill ("SQL ×"), evidence citation row (small mono source tag like
[data_jobs] + publisher + date), status tags DRAFT / APPROVED / FLAGGED as small caps text with a 1px border.
```

### A1. Landing + sign in — Web

```text
Desktop web page for AiversePulse (use the design system: paper #F4F1EA, ink, one vermilion accent, Fraunces +
Public Sans, 0-2px radius, hairline rules). Asymmetric 12-column layout, NOT a centered hero.
Left 7 columns: a large Fraunces headline "Know which skills the job market actually asks for." Below it a
short paragraph: "Free, evidence-based 90-day learning plans. Every claim links to its source: 785,741 job ads
from 2023 and the O*NET 31.0 occupational database." Under that, a thin ruled "specimen" table showing real
data for Data Analyst job ads: SQL 58.0%, Excel 41.9%, Python 35.9%, Tableau 29.1%, Power BI 24.7% — mono
numbers right-aligned, a 2px vermilion bar after each number proportional to the value.
Right 5 columns: a sign-in panel separated by a vertical 1px rule: Username, Password, "Sign in" primary button,
small text "Accounts are issued by your administrator." Footer strip: "Decision support only. Plans stay drafts
until you approve them." No images, no illustrations.
```

### A2. Landing + sign in — Mobile

```text
Mobile screen (390px) for AiversePulse, same design system. Top: small wordmark "AiversePulse" in Fraunces.
Headline 30px "Know which skills the job market actually asks for." One sentence of body text. Then the
specimen list (SQL 58.0%, Excel 41.9%, Python 35.9%) as full-width rows with mono numbers and thin vermilion
bars. Sign-in fields stacked below, full-width "Sign in" button pinned above the safe area. Hairline dividers,
no cards, no shadows.
```

### A3. Build my plan (intake) — Web

```text
Desktop "Build my plan" screen for AiversePulse. Layout: left fixed 280px step rail with numbered steps
(01 Target role, 02 Your skills, 03 Time, 04 AI scenario) — current step in ink, done steps with a small check,
upcoming in grey; a 1px vertical rule separates the rail. Main column max 720px:
Step 02 "Your skills" is active: a list of skill rows, each row = skill name + a 0-5 segmented control of six
square cells (selected cell filled ink) + remove "×". Rows: Python 3, SQL 2. An "Add a skill" input with
autocomplete suggestions (excel, tableau, power bi, r, aws). Helper text: "0 = never used, 5 = could teach it."
Under it a compact preview for Step 03: "Hours per week: 6" stepper, and Step 04 as two large text-only radio
blocks: "Assistive AI — AI helps you do today's work" and "Agentic AI — AI agents take over routine tool
work" with the note "Agentic levels are a stated assumption, not evidence." Bottom right: vermilion
"Analyse my skills" button. Generous white space, no cards.
```

### A4. Build my plan — Mobile

```text
Mobile version of the AiversePulse intake as a 4-step flow. Top: thin progress bar split into 4 segments
(2 of 4 filled vermilion) and "Step 2 of 4 · Your skills". Each skill is a full-width row with the name on the
left and a compact 0-5 segmented control below it (thumb-sized 44px cells). Sticky bottom bar with "Back"
(text) and "Continue" (vermilion). No sidebar. Same paper/ink style, hairline separators.
```

### A5. My results — Web

```text
Desktop results screen for AiversePulse, editorial report layout (like a printed briefing), not a dashboard.
Top: kicker "Target: Data Analyst · Assistive AI" in small caps, Fraunces headline "Three skills will move you
furthest." A 3-line summary paragraph with inline mono citation tags: "Prioritise Excel (level 0 → 3; in 41.9%
of 2023 Data Analyst ads [data_jobs]), SQL (2 → 4; 58.0% [data_jobs]) and Tableau (0 → 2; 29.1%), all O*NET
Hot Technologies [O*NET 31.0]."
Main column: "Skill gaps" as a ruled table — columns Skill, You, Needed, Gap, Seen in ads; gap shown as
filled/empty squares (■■□); rows Excel 0/3/3/41.9%, SQL 2/4/2/58.0%, Tableau 0/2/2/29.1%, Power BI 0/2/2/24.7%.
Below: "Assistive vs Agentic" mini comparison — two columns of required levels (Excel 3 vs 2, SQL 4 vs 4,
Tableau 2 vs 1) with the changed values highlighted.
Right margin column (sidenotes style, 300px): "Sources" list — each entry: source tag, title, publisher,
published date, accessed date, external link icon. e.g. "O*NET 31.0 · Business Intelligence Analysts ·
USDOL/ETA · Aug 2026".
Bottom: "Experimental: SQL demand, historical 2023 backtest" line chart — 12 weeks observed (ink line), 4 weeks
forecast (vermilion dashed) with a pale band ±1.7 pp, label "STF-KAN ensemble · not a 2026 prediction".
```

### A6. My results — Mobile

```text
Mobile results for AiversePulse. Headline "Three skills will move you furthest." then the summary paragraph.
Skill gaps as stacked rows: skill name + "0 → 3" + ■■■ squares + "41.9% of ads" in mono. Sources collapse into
a "Sources (12)" disclosure row that opens a bottom sheet listing each citation with publisher and date.
Forecast chart full width with the "historical 2023 backtest" caption above it. Sticky bottom button
"See my 90-day plan".
```

### A7. 90-day plan + approve — Web

```text
Desktop 30/60/90-day plan for AiversePulse. Three equal columns titled "Days 1-30", "Days 31-60",
"Days 61-90", each with its hour budget at the top in mono ("25.7 h of 25.7 h"). Each activity is a ruled entry,
not a card: skill tag, activity text ("Foundations course + guided exercises: Excel (level 0 → 3) using Excel
help & learning — Microsoft Support"), hours, editable via an inline pencil. Badges SDG4 · SDG8 as tiny
outlined text. A muted line under the columns: "Not fully covered by 6 h/week: Power BI, R, SAS."
Status header: "DRAFT · v1" tag. Right side approval box with a checkbox "I have reviewed this plan and
approve it" and a vermilion "Approve plan" button that stays disabled until checked. Below: "History" timeline
with small mono timestamps: generated by system → edited → approved by you.
```

### A8. 90-day plan — Mobile

```text
Mobile 90-day plan: a horizontal segmented switch "1-30 | 31-60 | 61-90" at the top, activities for the chosen
phase as full-width ruled rows with hours on the right. Hour budget bar under the switch. Approval lives in a
bottom sheet: checkbox + "Approve plan" vermilion button. Status tag DRAFT in the header.
```

### A9. My plans — Mobile

```text
Mobile "My plans" list for AiversePulse: rows with role, scenario, version and a status tag (DRAFT / APPROVED /
FLAGGED). Plans prepared by HR show a small "From HR" label and an "Acknowledge" text button. Empty state is a
single sentence: "No plans yet. Build your first one in about two minutes." Bottom tab bar with 3 items:
Build, Plans, Account (thin outline icons + labels).
```

---

## B. AiversePulse Enterprise — HR advisors

### B0. Design system (generate first)

```text
Design system for "AiversePulse Enterprise", an internal HR workforce-planning console. Mood: precise,
high-density, operational — like Linear or a trading terminal, calm not flashy. Different product from the
public app: no serif, no paper texture.
Colors (light): canvas #F6F7F9, surface #FFFFFF, text #0E1116, secondary #5B6472, rules #E3E6EB, single accent
"cobalt" #2448E8 for primary actions/selection, status: approved #1F7A4D, draft #5B6472, flagged #C2410C.
Optional dark theme: canvas #0B0D10, surface #12151A, text #E8EBF0, rules #232831, same cobalt.
Type: "IBM Plex Sans" 13/20 for UI, "IBM Plex Mono" for IDs, numbers, timestamps (tabular). Headings 18px
semibold, no display type. Shapes: 2px radius, 1px rules, no shadows except a 1px rule under the sticky header.
Components sheet: compact table (32px rows, zebra off, hover row tint), status pills as 1px-bordered small caps
text, segmented control, command bar input with "⌘K" hint, toast, confirm dialog, file dropzone with
validation error list, keyboard-shortcut hints in mono.
```

### B1. Team overview — Web

```text
Desktop HR console screen "Team overview" (design system above). App shell: 56px left icon rail (Overview,
Upload, Review queue, Plans, Audit), top bar with breadcrumb "Data team · Assistive AI" and a command input
"Search employees or skills ⌘K". Content in a 12-column grid, no hero.
Row 1: four compact KPI cells separated by vertical rules (not cards): Employees analysed 4 · Drafts awaiting
review 4 · Flagged 0 · Est. training hours 300 h.
Row 2 left (8 cols): "Team training priorities" horizontal bar chart — skills sorted by employees with a gap:
Excel 3, SQL 3, Tableau 2, Power BI 2, Python 1; bars in cobalt, values in mono at the bar end. Caption:
"Aggregated. Individuals are never ranked."
Row 2 right (4 cols): "Scenario" segmented control Assistive | Agentic and a small diff list showing which
required levels change under Agentic.
Row 3: dense table of employees — ID (mono, pseudonymous E-001…), Target role, Hours/week, Top gaps (skill
tags), Plan status pill, Last action (mono timestamp). Sticky header, sortable columns.
```

### B2. Upload team CSV — Web

```text
Desktop HR screen "Upload team". Left: dropzone with 1px dashed rule, text "Drop a CSV — employee_id,
target_role, weekly_hours, skill, level". Right: a schema checklist with each required column ticked or
crossed. Below: validation result panel listing real errors in mono, e.g. "row 1 · employee_id must be
pseudonymous [A-Za-z0-9_-]{1,32}: 'jane.doe@corp.com'", "row 2 · level must be 0-5: 9". Primary button
"Run analysis for 4 employees" disabled while errors exist. Note: "Max 5,000 rows · 500 employees · no names or
emails". Dense, utilitarian, no illustration.
```

### B3. Review queue (split pane) — Web

```text
Desktop HR "Review queue" in a three-pane layout. Left pane 280px: queue list of employee drafts (E-001 Data
Analyst DRAFT, E-002 Data Analyst DRAFT, E-003 Data Engineer DRAFT, E-004 Data Scientist DRAFT) with keyboard
hint "J/K to move". Middle pane: selected employee E-001 — summary paragraph with mono citation tags, skill gap
table (Skill, Current, Required, Gap, Ads %, O*NET Hot), and the 30/60/90 plan as an editable grid (phase,
skill, activity, hours). Right pane 320px: "Evidence" list (source, publisher, date, link) and "Audit" timeline
(generated by system 02:03 → edited by demo_hr → approved). Footer action bar pinned to the middle pane:
"Save as new draft" (secondary), checkbox "I have reviewed this plan", "Approve" (cobalt). A small banner on
flagged items: "Flagged — fix issues and save a new draft before approval."
```

### B4. Plans & audit — Web

```text
Desktop HR "Plans" register: full-width dense table with filters row (status, role, scenario, date range).
Columns: Plan ID (mono), Employee, Role, Scenario, Version, Status, Approved by, Updated (mono). Selecting a row
opens a right drawer with the version history: v1 generated · v2 edited · v3 approved, each with actor, role,
UTC timestamp and a "view snapshot" link. Header note: "Versions are immutable. Editing an approved plan
creates a new draft."
```

### B5. HR — Mobile (approvals on the go)

```text
Mobile HR app (390px), same Enterprise design system — but task-focused, not a shrunken dashboard.
Screen: "Review queue" list with segmented filter Drafts | Flagged | Approved, each row: E-001 · Data Analyst ·
DRAFT pill · "3 gaps". Tapping opens detail: top gaps as compact rows, plan collapsed by phase, evidence
behind a "Sources (12)" row. Sticky bottom action bar: "Approve" (cobalt) opens a confirm bottom sheet with the
checkbox "I have reviewed this plan". Bottom tab bar: Queue, Team, Plans. Team tab shows only the aggregated
priority bars, never individual rankings.
```

---

## C. Notes for implementing the design back in Streamlit
- Keep labels exactly: DRAFT / APPROVED / FLAGGED, "historical 2023 backtest", "Individuals are never ranked".
- Public app = `ui/profile.py`, `ui/results.py`, `ui/forecast.py`, `ui/review.py`; HR = `ui/team.py` + review.
- Fonts via Google Fonts in `st.markdown("<style>…</style>")`; theme colors in `.streamlit/config.toml`.
