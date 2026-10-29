// Report building blocks shared by the public report and the Enterprise review pane.
import { api, h, icon, toast, fmtTime, ApiError, reveal, RISE, DROP, GROW } from "./lib.js";
import { jobIcon } from "./jobicons.js";

const PHASES = ["1-30", "31-60", "61-90"];
const CITE = /\[([^\[\]]{3,120})\]/g;

/** Short readable label for an evidence id, e.g. "esco:2221.1:skill:Listen actively" -> "ESCO · Listen actively". */
export function citeLabel(id) {
  const p = id.split(":");
  if (p[0] === "esco") return p[2] === "skill" || p[2] === "tool" ? `ESCO · ${p.slice(3).join(":")}` : `ESCO · ${p[2] || p[1]}`;
  if (p[0] === "stfkan") return `Forecast · ${p.slice(2).join(":")}`;
  if (p[0] === "learn") return `Course · ${p.slice(1).join(":")}`;
  if (p[0] === "signal") return `Signal · ${p[2]} (${p[3]}, ${p[1]})`;
  if (p[0] === "sdg") return `UN SDG · goal ${p[2]}`;
  return `${p[0]} · ${p[p.length - 1]}`;
}

export function citeChip(id, onCite) {
  const [src, ...rest] = citeLabel(id).split(" · ");
  return reveal(h("a", { class: "cite", href: `#src-${CSS.escape(id)}`, title: id,
    onclick: (e) => { e.preventDefault(); onCite?.(id); } }, h("b", {}, src), rest.join(" · ")),
    [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { duration: 420 });
}

/** Append streamed text into `el`, turning complete [citation] tokens into chips as they arrive. */
export class StreamText {
  constructor(el, onCite) { this.el = el; this.onCite = onCite; this.raw = ""; this.done = 0; this.caret = h("span", { class: "caret", "aria-hidden": "true" }); el.append(this.caret); }
  push(delta) {
    this.raw += delta;
    // render everything up to the last fully-closed token; keep an open "[" pending
    const open = this.raw.lastIndexOf("[");
    const safe = open > this.raw.lastIndexOf("]") ? open : this.raw.length;
    const chunk = this.raw.slice(this.done, safe);
    this.done = safe;
    let last = 0;
    for (const m of chunk.matchAll(CITE)) {
      this.caret.before(chunk.slice(last, m.index), citeChip(m[1], this.onCite));
      last = m.index + m[0].length;
    }
    this.caret.before(chunk.slice(last));
  }
  end() { this.push(""); this.caret.before(this.raw.slice(this.done)); this.caret.remove(); }
}

export function staticText(text, onCite) {
  const p = h("p", { class: "prose" });
  const s = new StreamText(p, onCite);
  s.push(text || "");
  s.end();
  return p;
}

const block = (label, ...kids) => reveal(h("section", { class: "block", "aria-label": label }, ...kids), RISE, { duration: 420 });

/** A briefing card: icon tile + title (+ info tooltip) + one big figure, then the content. */
const info = (text) => h("span", { class: "info", role: "img", title: text, "aria-label": text }, icon("info"));
const card = (label, ic, title, { figure, unit, note, cls = "" } = {}, ...kids) => reveal(h("section", { class: `block brief-card ${cls}`, "aria-label": label },
  h("header", { class: "bc-head" }, h("span", { class: "bc-ic" }, icon(ic)), h("h3", {}, title), note ? info(note) : null),
  figure != null ? h("p", { class: "bc-figure" }, h("b", {}, figure), unit ? h("span", {}, unit) : null) : null, ...kids), RISE, { duration: 420 });

// official UN SDG colours (sdgs.un.org brand guide), for number-only goal tiles
const SDG_COLORS = { 1: "#E5243B", 2: "#DDA63A", 3: "#4C9F38", 4: "#C5192D", 5: "#FF3A21", 6: "#26BDE2", 7: "#FCC30B", 8: "#A21942", 9: "#FD6925",
  10: "#DD1367", 11: "#FD9D24", 12: "#BF8B2E", 13: "#3F7E44", 14: "#0A97D9", 15: "#56C02B", 16: "#00689D", 17: "#19486A" };
const ARROW = { rising: ["up", "forecast rising"], falling: ["down", "forecast falling"] };

export function gapsBlock(gaps) {
  const rows = gaps.filter((g) => g.required_level > 0).slice(0, 14);
  const open = rows.filter((g) => g.required_level > g.current_level);
  const row = (g, i) => reveal(h("li", { class: "gap-row", title: g.importance != null ? `Importance ${g.importance.toFixed(1)} / 5` : null },
    h("span", { class: "gr-name" }, h("b", {}, g.skill_id),
      g.kind === "tool" ? h("span", { class: `tag ${g.hot ? "hot" : ""}`, title: "Tool or system listed by ESCO" }, g.hot ? "hot tool" : "tool") : null,
      ARROW[g.outlook] ? h("span", { class: `trend ${g.outlook}`, title: ARROW[g.outlook][1] }, icon(ARROW[g.outlook][0]), h("span", { class: "sr-only" }, ARROW[g.outlook][1])) : null),
    h("span", { class: "gr-bar", role: "img", "aria-label": `level ${g.current_level} of ${g.required_level} needed` },
      h("i", { class: "need", style: { width: `${g.required_level * 20}%` } }), h("i", { class: "have", style: { width: `${g.current_level * 20}%` } })),
    h("span", { class: "gr-lv num" }, `${g.current_level} → ${g.required_level}`)), DROP, { delay: Math.min(i, 8) * 45 });
  const top = rows.slice(0, 5), rest = rows.slice(5);
  return card("Skill gaps", "target", "Skill gaps",
    { figure: open.length, unit: open.length === 1 ? "skill to build" : "skills to build",
      note: "Dark bar: your level. Blue bar: the level this job needs (0–5). Arrows show the demand forecast. Required levels are estimates. Hover a skill to see how important it is." },
    h("ol", { class: "gap-list" }, top.map(row)),
    rest.length ? h("details", { class: "more" }, h("summary", {}, `Show ${rest.length} more`), h("ol", { class: "gap-list" }, rest.map(row))) : null);
}

export function comparisonBlock(cmp, scenario) {
  const level = (value) => value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  const rows = Array.isArray(cmp) ? cmp.filter((c) => c && c.skill_id).map((c) => ({ ...c,
    assistive_required: level(c.assistive_required), agentic_required: level(c.agentic_required) })) : [];
  const changed = rows.filter((c) => c.assistive_required !== null && c.agentic_required !== null
    && c.assistive_required !== c.agentic_required);
  const shown = (changed.length ? changed : rows).slice(0, 5);
  const activeScenario = String(scenario || "").toLowerCase().replace(/[_\s-]+ai$/, "");
  const th = (name, key) => h("th", { scope: "col", class: activeScenario === key ? "current" : null },
    name, activeScenario === key ? h("span", { class: "cmp-current" }, "Your scenario") : null);
  const body = shown.length ? shown.map((c) => h("tr", {},
    h("th", { scope: "row" }, c.skill_id),
    h("td", { class: activeScenario === "assistive" ? "current" : null }, c.assistive_required === null ? "Not available" : `Level ${c.assistive_required}`),
    h("td", { class: activeScenario === "agentic" ? "current" : null }, c.agentic_required === null ? "Not available" : `Level ${c.agentic_required}`)))
    : [h("tr", {}, h("td", { colspan: 3, class: "cmp-empty" }, "No skill comparison was saved in this report."))];
  return card("Assistive versus agentic AI", "spark", "Assistive vs agentic AI",
    { figure: changed.length, unit: changed.length === 1 ? "skill changes" : "skills change",
      note: "Agentic levels are our assumption, not measured data. Assistive levels are the model's estimates." },
    h("div", { class: "cmp-table-wrap" }, h("table", { class: "cmp-table" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Skill"), th("Assistive AI", "assistive"), th("Agentic AI", "agentic"))),
      h("tbody", {}, body))));
}

export function outlookBlock(o) {
  if (!o) return null;
  const m = o.model;
  if (!m) return card("Skill outlook", "up", "Rising skills", {}, h("p", { class: "bc-line" }, "Skill forecast unavailable."));
  const rf = m.rising_flag || {};
  const rising = o.items.filter((x) => x.direction === "rising");
  return card("Skill outlook", "up", "Rising skills",
    { figure: rising.length || "None", unit: rising.length ? "likely to grow" : "flagged; requirements look stable",
      note: `Flagged when our forecast model ranks a skill in the top ${rf.top_percent}% of forecast increases; on held-out releases these flags were ${Number(rf.test_lift).toFixed(2)}x more likely than average to rise (base rate ${(rf.test_base_rate * 100).toFixed(1)}%). Raises priority in your plan, never the required level. ${m.name}, trained on the ${m.trained_on}. ${forecastMode(o.forecast)}Falling-skill and tool flags are off.` },
    rising.length ? h("div", { class: "chips" }, rising.slice(0, 6).map((x) => h("span", { class: "chip-static" }, icon("up"), x.skill_id))) : null);
}

function forecastMode(f) {
  if (!f) return "";
  return f.mode === "live_cpu_inference" ? `Computed live on CPU (${f.model_version}, ${f.latency_ms} ms). `
    : `Served from the exported model output; live inference unavailable (${f.reason}). `;
}

/** Follow-up: before -> after for whatever this turn changed (computed by the graph, not written by the LLM). */
export function changesBlock(f) {
  const row = (ic, label, [a, b], fmt = (x) => x) => a === b ? null : h("li", {},
    h("span", { class: "ch-label" }, icon(ic), label), h("span", { class: "ch-val" }, h("s", {}, fmt(a)), icon("send"), h("b", {}, fmt(b))));
  const rows = [
    f.weekly_hours && row("clock", "Weekly time", f.weekly_hours, (x) => `${x} h`),
    f.scenario && row("spark", "AI scenario", f.scenario, (x) => (x === "agentic" ? "Agentic" : "Assistive")),
    f.plan_hours && row("plans", "Hours in plan", f.plan_hours, (x) => `${x} h`),
    f.activities && row("review", "Activities", f.activities),
    f.deferred && row("flag", "Skills waiting for time", f.deferred),
    f.open_gaps && row("target", "Open skill gaps", f.open_gaps),
  ].filter(Boolean);
  const moved = (f.required_changed || []).map(([skill, a, b]) => h("span", { class: "chip-static" }, icon(b > a ? "up" : "down"), `${skill}: ${a} → ${b}`));
  return card("What changed", "history", "What changed", { figure: rows.length + moved.length || "No", unit: rows.length + moved.length ? "updates in your plan" : "changes to your plan" },
    rows.length ? h("ul", { class: "changes" }, rows) : null,
    moved.length ? h("div", { class: "chips" }, moved) : null,
    f.gaps_narrowed?.length ? h("p", { class: "bc-line" }, `Gaps narrowed: ${f.gaps_narrowed.join(", ")}`) : null);
}

export function issuesBlock(issues) {
  if (!issues.length) return null;
  // one line per kind of finding: older saved plans carry one warning per unmatched skill
  const unknown = issues.filter((i) => i.code === "unknown_skill");
  const names = unknown.flatMap((i) => [...i.message.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const grouped = names.length > 1 ? [{ severity: "warning", message: `${names.length} of your skills aren't among this job's ESCO requirements, so they're kept but not scored: ${names.slice(0, 6).join(", ")}${names.length > 6 ? ` and ${names.length - 6} more` : ""}.` }]
    : unknown;
  const short = (i) => {  // older saved plans list every deferred skill in one sentence
    const m = i.code === "deferred" && i.message.match(/^Not fully covered by weekly hours: (.*)$/);
    if (!m) return i;
    const all = m[1].split(", ");
    return { ...i, message: `${all.length} skills don't fit your weekly hours yet: ${all.slice(0, 5).join(", ")}${all.length > 5 ? ` and ${all.length - 5} more` : ""}.` };
  };
  const rest = issues.filter((i) => i.code !== "unknown_skill").map(short);
  const list = [...rest.filter((i) => i.severity === "error"), ...grouped, ...rest.filter((i) => i.severity !== "error")];
  return h("div", { class: "issues", role: "note" }, list.map((i) => h("div", { class: `issue ${i.severity}` },
    icon(i.severity === "error" ? "flag" : "info"), h("span", {}, i.message))));
}

function planActivitySteps(activity) {
  if (activity.steps?.length) return activity.steps;
  const skill = activity.skill_id || "this skill";
  if (activity.day_range === "61-90") return [`Weeks 9-10: Write up your best ${skill} work as a portfolio piece.`, "Weeks 11-12: Get it reviewed; act on the feedback."];
  if (activity.day_range === "31-60") return [`Week 5: Pick one real task that uses ${skill}.`, "Weeks 6-8: Do it and get one piece of feedback."];
  return [`Weeks 1-2: Study a short guide or tutorial on ${skill}.`, "Weeks 3-4: Try it on one small work task."];
}

function planActivityOutcome(activity) {
  if (activity.outcome) return activity.outcome;
  const skill = activity.skill_id || "the skill";
  if (activity.day_range === "61-90") return `A reviewed portfolio piece demonstrating ${skill}.`;
  if (activity.day_range === "31-60") return `A completed work task using ${skill}, with a short note about the result.`;
  return `A completed set of practice exercises and an explanation of the basics of ${skill}.`;
}

const DAY_MS = 864e5;
// Weeks are dated inside their phase, like the plan schedules them: weeks 1-4 = days 1-30, 5-8 = 31-60, 9-13 = 61-90.
// A phase's last week takes its leftover days (week 4: days 22-30); week 13 is the short days 89-90.
const WEEK_PHASES = [[1, 4, 1, 30], [5, 8, 31, 60], [9, 13, 61, 90]];
function weekDays(week) {  // -> [first day, last day], 1-based
  const [lo, hi, from, to] = WEEK_PHASES.find(([lo, hi]) => week >= lo && week <= hi) || WEEK_PHASES[2];
  const first = from + (week - lo) * 7;
  return [first, week === hi ? to : first + 6];
}
const dayToWeek = (day) => { for (let w = 1; w <= 13; w++) if (day <= weekDays(w)[1]) return w; return 13; };
function weekRange(week, startDate) {
  const start = new Date(startDate || Date.now()); start.setHours(0, 0, 0, 0);
  const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const [a, b] = weekDays(week);
  return `${fmt(new Date(+start + (a - 1) * DAY_MS))} – ${fmt(new Date(+start + (b - 1) * DAY_MS))}`;
}
// this plan's current week (1-13), from its start date
const currentWeek = (startDate) => dayToWeek(Math.max(1, Math.floor((Date.now() - (Date.parse(startDate || "") || Date.now())) / DAY_MS) + 1));

/** Open the section subpage holding an activity card and scroll to the card. */
function jumpTo(k) {
  const el = document.querySelector(`.plan-block .act[data-key="${CSS.escape(k)}"]`);
  if (!el) return;
  el.closest(".plan-block").openPane(el.closest("[data-pane]").dataset.pane);
  setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
}
const PHASE_WEEK = { "1-30": 1, "31-60": 5, "61-90": 9 };

/** Week-by-week agenda of a plan: what to do each week, dated from startDate, with this week highlighted. */
function planCalendar(acts, startDate, done, key) {
  const weeks = Array.from({ length: 13 }, () => []);
  for (const a of acts) for (const step of planActivitySteps(a)) {
    const m = step.match(/^\s*weeks?\s+(\d+)(?:\s*[-–]\s*(\d+))?\s*:\s*/i);
    const end = /^\s*end of month/i.test(step);
    const from = m ? +m[1] : end ? PHASE_WEEK[a.day_range] + 3 : PHASE_WEEK[a.day_range] || 1;
    const to = m && m[2] ? +m[2] : from;
    const text = m ? step.slice(m[0].length) : step.replace(/^\s*end of month\s*:\s*/i, "");
    for (let w = Math.max(1, from); w <= Math.min(13, to); w++) weeks[w - 1].push({ a, text });
  }
  const now = currentWeek(startDate) - 1;  // 0-based index of this week
  const jump = (a) => jumpTo(key(a));
  const week = (items, i) => {
    return h("li", { class: `cal-week${i === now ? " is-now" : ""}${i < now ? " is-past" : ""}`, "aria-current": i === now ? "date" : null },
      h("div", { class: "cal-head" }, h("b", {}, `Week ${i + 1}`), h("span", {}, i === now ? "This week" : weekRange(i + 1, startDate))),
      items.length ? h("ul", {}, items.map(({ a, text }) => h("li", { class: done.has(key(a)) ? "is-done" : null },
        h("button", { type: "button", class: "cal-item", title: text, onclick: () => jump(a) }, h("span", { class: "cal-skill" }, a.skill_id), h("span", {}, text)))))
        : h("p", { class: "cal-free" }, i === 12 ? "Wrap-up week" : "Catch-up week"));
  };
  // one row per 30 days, the same split as the phases below: weeks 1-4, 5-8, 9-13
  return h("div", { class: "plan-cal", "aria-label": "Week-by-week calendar" }, [[0, 4, "Days 1-30 · Foundation"], [4, 8, "Days 31-60 · Practice"], [8, 13, "Days 61-90 · Portfolio"]]
    .map(([a, b, label]) => h("section", { class: "cal-block" }, h("h5", {}, label),
      h("ol", { class: "cal-grid" }, weeks.slice(a, b).map((items, j) => week(items, a + j))))));
}

/** Editable 30/60/90 plan with approval. Talks to /api/plans/:id. Calls onChange(status) after saves. */
export function planBlock({ planId, planReference, plan, version, status, weeklyHours, onChange, approverLabel = "I have reviewed this plan and approve it", title = "Your 90-day plan",
  progress = [], evidence = null, readOnly = false, startDate = null, sectionHref = null, selectedNodeId = null }) {
  // sectionHref(p | null) -> URL of a section subpage; when given, opening a section goes through the router (so Back works)
  // readOnly: HR looking at a plan an employee made for themself: no hours, ticks, saving or approval
  // progress: activities ticked off as done ("<days>:<skill>", saved on the server); evidence: id -> {title, url} for course links
  const done = new Set(progress);
  const key = (a) => `${a.day_range}:${a.skill_id}`;
  const ev = evidence instanceof Map ? evidence : new Map((evidence || []).map((e) => [e.id, e]));
  const learningNodes = Array.isArray(plan.learning_nodes) ? plan.learning_nodes : [];
  const phaseWeekRanges = { "1-30": [1, 4], "31-60": [5, 8], "61-90": [9, 13] };
  const selectedNodeByPhase = { "1-30": null, "31-60": null, "61-90": null };
  const selectedWeekByPhase = { "1-30": 1, "31-60": 5, "61-90": 9 };
  const quizState = new Map(), criteriaState = new Map(), lessonTabs = new Map();
  const journeyHosts = {};
  const nodeDone = (node) => done.has(`node:${node.id}`);
  const nodeStarted = (node) => criteriaState.has(node.id) || quizState.has(node.id);
  const courses = (a) => (a.evidence_ids || []).map((id) => ev.get(id)).filter((e) => e?.url && e.id.startsWith("learn:")).slice(0, 2);
  const cap = weeklyHours ? Math.round((weeklyHours * 30) / 7 * 10) / 10 : null;
  const acts = plan.activities.map((a) => ({ ...a }));
  const tagEl = h("span", { class: `tag ${status}` }, status);
  const verEl = h("span", { class: "num muted" }, `v${version}`);
  const phaseNames = ["Foundation", "Practical application", "Portfolio & review"];
  const tracks = {}, counts = {}, panes = {};
  let blockEl;
  function openPane(p, fromRoute = false, nodeId = null) {  // swap the journey overview for one section's subpage (null = back to the overview)
    if (sectionHref && !fromRoute) { location.hash = sectionHref(p, nodeId); return; }
    if (p && !PHASES.includes(p)) p = null;
    if (p && nodeId) {
      const node = learningNodes.find((item) => item.id === nodeId);
      if (node) { selectedNodeByPhase[p] = node.id; selectedWeekByPhase[p] = node.week_number; }
    }
    blockEl.toggleAttribute("data-view", !!p);
    PHASES.forEach((x) => { panes[x].hidden = x !== p; });
    if (p && nodeId) renderJourney(p);
    blockEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const phases = PHASES.map((p, phaseIndex) => {
    const mine = acts.filter((a) => a.day_range === p);
    const used = mine.reduce((s, a) => s + a.estimated_hours, 0);
    const activityCards = mine.map((a, i) => {
      const input = h("input", { class: "input hrs", type: "number", min: "0.5", max: "200", step: "0.5", value: a.estimated_hours,
        disabled: status === "approved" || readOnly ? true : null,
        oninput: (e) => { a.estimated_hours = Number(e.target.value); saveBtn.disabled = false; } });
      const description = a.activity.length > 150
        ? h("details", { class: "activity-details" }, h("summary", {}, `${a.activity.slice(0, 135).trimEnd()}… Show details`), h("p", {}, a.activity))
        : h("p", {}, a.activity);
      const goals = (a.sdg_links || []).map((s) => {
        const n = String(s).replace(/\D/g, "");
        return h("span", { class: "sdg-n", style: { "--sdg": SDG_COLORS[n] || "#888" }, title: `UN SDG ${n}`, "aria-label": `UN SDG ${n}` }, n);
      });
      const tick = planId && !readOnly && !learningNodes.length ? h("label", { class: "act-done", title: "Mark this activity as done" },
        h("input", { type: "checkbox", checked: done.has(key(a)) ? true : null, onchange: (e) => mark(a, e.target.checked, e.target) }), "Done") : null;
      const links = courses(a);
      const steps = planActivitySteps(a);
      const main = h("div", { class: "act-main" },
        h("div", { class: "top" }, h("b", {}, a.skill_id), tick,
          h("label", {}, h("span", { class: "sr-only" }, `Hours for ${a.skill_id}, days ${p}`), input)),
        h("div", { class: "act-description" }, description,
          h("ol", { class: "act-steps" }, steps.map((s) => h("li", {}, s))),
          h("p", { class: "act-outcome" }, h("b", {}, "You'll have: "), planActivityOutcome(a))),
        links.length ? h("div", { class: "act-links" }, links.map((e) => h("a", { href: currentSourceUrl(e.url), target: "_blank", rel: "noopener noreferrer" },
          icon("sources"), /esco\.ec\.europa\.eu/.test(e.url) ? "ESCO skill guide" : `Open course: ${e.title}`, h("span", { class: "tag free" }, "free")))) : null,
        goals.length ? h("span", { class: "sdg-nums", "aria-label": "Related Sustainable Development Goals" }, goals) : null);
      return reveal(h("article", { class: `act${done.has(key(a)) ? " is-done" : ""}`, "data-key": key(a) }, main,
        h("span", { class: "act-hours" }, icon("clock"), `${a.estimated_hours} h`)), DROP, { delay: i * 60 });
    });
    const heading = h("h4", {},
      h("span", { class: "phase-title" }, `Days ${p} — ${phaseNames[phaseIndex]}`),
      h("span", { class: "hours" }, icon("clock"), cap ? `${Number(used.toFixed(1))} of ${Number(cap.toFixed(1))} h` : `${Number(used.toFixed(1))} learning hours`));
    const summary = phaseIndex === 0 ? "Learn essential skills and build your foundation."
      : phaseIndex === 1 ? "Practice skills through real-world activities."
      : "Build evidence of your skills and review progress.";
    const budget = h("div", { class: "budget", "aria-hidden": "true" },
      h("div", { style: { transform: `scaleX(${cap ? Math.min(1, used / cap) : 1})`, "transform-origin": "left", height: "100%" } },
        reveal(h("i"), GROW, { duration: 700 })));
    const activityList = mine.length ? h("details", { class: "phase-activity-budget", open: !learningNodes.length },
      h("summary", {}, "Skill activities and learning hours"), h("div", { class: "phase-activities" }, activityCards))
      : h("p", { class: "note" }, "No activities in this phase.");
    journeyHosts[p] = h("div", { class: "learning-journey", hidden: !learningNodes.length });
    tracks[p] = h("ol", { class: "phase-track", "aria-label": `Days ${p} activities` });
    counts[p] = h("span", { class: "phase-count" });
    // overview row: heading, count and step track; the activity cards live on the section's own subpage
    panes[p] = h("section", { class: "phase phase-detail", "data-pane": p, hidden: true, "aria-label": `Days ${p} details` },
      h("div", { class: "phase-nav" },
        h("button", { class: "btn ghost sm phase-back", type: "button", onclick: () => openPane(null) }, icon("back"), "Back to journey"),
        h("div", { class: "phase-tabs-nav", role: "group", "aria-label": "Switch section" }, PHASES.map((x, i) =>
          h("button", { class: `btn sm${x === p ? " primary" : ""}`, type: "button", "aria-current": x === p ? "page" : null, onclick: () => openPane(x) },
            `Days ${x}`)))),
      h("div", { class: "phase-intro" }, heading.cloneNode(true), h("p", { class: "phase-summary" }, summary)),
      h("div", { class: "phase-content" }, budget, journeyHosts[p], activityList));
    return h("div", { class: "phase-row", "data-phase": p },
      h("span", { class: "phase-step", "aria-hidden": "true" }, phaseIndex + 1),
      h("div", { class: "phase" }, h("div", { class: "phase-toggle" },
        h("div", { class: "phase-intro" }, heading, h("p", { class: "phase-summary" }, summary, " ", counts[p]), tracks[p]),
        h("button", { class: "btn sm phase-open", type: "button", onclick: () => openPane(p) }, "View details", icon("chevron")))));
  });
  const phaseForWeek = (week) => week <= 4 ? "1-30" : week <= 8 ? "31-60" : "61-90";
  const weekBounds = (week) => weekRange(week, startDate);
  const scrollRoadTo = (phase, week) => setTimeout(() => journeyHosts[phase]?.querySelector(`.road-week[data-week="${week}"]`)?.scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest", inline: "center" }), 0);
  const renderJourney = (phase) => {
    const host = journeyHosts[phase];
    if (!host || !learningNodes.length) return;
    const [lo, hi] = phaseWeekRanges[phase];
    const nodes = learningNodes.filter((node) => node.week_number >= lo && node.week_number <= hi)
      .sort((a, b) => a.week_number - b.week_number ||
        ["learn", "practice", "project", "review", "quiz"].indexOf(a.type) - ["learn", "practice", "project", "review", "quiz"].indexOf(b.type));
    const selectedWeek = selectedWeekByPhase[phase];
    const selectedNode = learningNodes.find((node) => node.id === selectedNodeByPhase[phase]);
    const weekNodes = (week) => nodes.filter((node) => node.week_number === week);
    const stateForWeek = (week) => {
      const group = weekNodes(week);
      if (group.length && group.every(nodeDone)) return "Completed";
      if (group.some((node) => nodeDone(node) || nodeStarted(node))) return "In progress";
      return "Not started";
    };
    const weeks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    const calendar = h("div", { class: "learning-weeks", role: "group", "aria-label": `Weekly learning schedule for days ${phase}` },
      ...weeks.map((week) => {
        const weekly = weekNodes(week);
        const state = stateForWeek(week);
        const weeklyProgress = weekly.reduce((total, node) => total + (nodeDone(node) ? 1 : nodeStarted(node) ? 0.5 : 0), 0);
        return h("button", { type: "button", class: `learning-week${week === selectedWeek ? " is-selected" : ""}${week === nowWeek ? " is-current" : ""}`,
          "aria-pressed": String(week === selectedWeek), "data-week": String(week), onclick: () => {
            selectedWeekByPhase[phase] = week; renderAllJourneys();
            scrollRoadTo(phase, week);
          } }, h("span", { class: "learning-week-title" }, `Week ${week}`, week === nowWeek ? h("span", { class: "learning-current" }, "Current") : null),
          h("span", { class: "learning-week-date" }, weekBounds(week)),
          h("span", { class: "learning-week-focus" }, [...new Set(weekly.flatMap((node) => node.topics || node.skills))].join(" · ") || "Scheduled learning"),
          h("span", { class: "learning-week-skills" }, [...new Set(weekly.flatMap((node) => node.skills))].join(" · ")),
          week === selectedWeek ? h("span", { class: "learning-week-selected" }, "Selected") : null,
          h("span", { class: "learning-week-meta" }, `${weekly.length} step${weekly.length === 1 ? "" : "s"} · ${weekly.reduce((n, node) => n + node.estimated_minutes, 0)} min · ${state}`),
          h("span", { class: "learning-week-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(weekly.length),
            "aria-valuenow": String(weeklyProgress), "aria-label": `${stateForWeek(week)}: ${weeklyProgress} of ${weekly.length} step equivalents` },
            h("i", { style: { width: `${weekly.length ? weeklyProgress / weekly.length * 100 : 0}%` } })));
      }));
    const roadWeeks = weeks.map((week) => {
      const buttons = weekNodes(week).map((node) => {
          const complete = nodeDone(node), started = nodeStarted(node), active = node.id === selectedNodeByPhase[phase];
          return h("button", { type: "button", class: `road-node${complete ? " is-done" : ""}${started ? " is-started" : ""}${active ? " is-active" : ""}${week === selectedWeek ? " is-week-selected" : ""}`,
            "aria-pressed": String(active), "aria-label": `${node.title}, week ${week}, ${complete ? "completed" : started ? "in progress" : "not started"}`,
            onclick: () => selectNode(node) },
            h("span", { class: "road-node-icon", "aria-hidden": "true" }, icon(complete ? "check" : node.type === "learn" ? "sources" : node.type === "quiz" ? "target" : "edit")),
            h("span", { class: "road-node-title" }, node.title), h("span", { class: "road-node-type" }, node.type === "quiz" ? "Quiz" : node.type[0].toUpperCase() + node.type.slice(1)),
            h("span", { class: "sr-only" }, complete ? "Completed" : started ? "In progress" : "Not started"));
      });
      return h("div", { class: `road-week${week === selectedWeek ? " is-selected" : ""}${week === nowWeek ? " is-current" : ""}`,
        "data-week": String(week), style: { "--steps": Math.max(1, buttons.length) } },
        h("div", { class: "road-week-heading" }, h("h5", {}, `Week ${week}`), h("span", {}, `${buttons.length} learning steps`)), h("div", { class: "road-nodes" }, ...buttons));
    });
    const firstOpen = nodes.findIndex((node) => !nodeDone(node));
    const completedPrefix = firstOpen < 0 ? nodes.length : firstOpen;
    const road = h("div", { class: "learning-road-scroll", tabindex: "0", "aria-label": "Scrollable learning roadmap" },
      h("div", { class: "learning-road", style: { "--road-progress-number": String(nodes.length ? completedPrefix / nodes.length : 0) } }, ...roadWeeks));
    const controls = h("div", { class: "learning-road-controls" },
      h("span", { class: "muted" }, "Scroll to explore all steps. Selecting a week highlights it; selecting a node opens its lesson."),
      h("button", { class: "btn sm", type: "button", onclick: () => { const current = Math.max(lo, Math.min(hi, nowWeek)); selectedWeekByPhase[phase] = current; renderAllJourneys();
        scrollRoadTo(phase, current); } }, "Scroll to current week"));
    const lesson = selectedNode && phaseForWeek(selectedNode.week_number) === phase ? renderLearningLesson(selectedNode) :
      h("section", { class: "learning-lesson learning-lesson-empty" }, h("p", {}, "Select a learning step to open its mini-lesson."));
    host.replaceChildren(h("header", { class: "learning-journey-heading" }, h("h4", {}, `${phaseNames[PHASES.indexOf(phase)]} Learning Roadmap`),
      h("p", {}, `Days ${phase} · One continuous journey across ${weeks.length} weeks`)), calendar,
      h("div", { class: "learning-road-heading" }, h("h4", {}, "Connected learning path"), h("span", {}, "↔ Scroll sideways")), road, controls, lesson);
  };
  const renderLearningLesson = (node) => {
    const week = node.week_number;
    const state = quizState.get(node.id) || {};
    const criteria = criteriaState.get(node.id) || (nodeDone(node) ? node.completion_criteria.map(() => true) : node.completion_criteria.map(() => false));
    const quizOk = !node.quiz || state.correct === true || nodeDone(node);
    const criteriaOk = criteria.every(Boolean);
    const activeTab = lessonTabs.get(node.id) || (node.type === "quiz" ? "quiz" : ["practice", "project"].includes(node.type) ? "practice" : "learn");
    const tabs = h("nav", { class: "learning-lesson-tabs", "aria-label": "Lesson sections" },
      ...["learn", "practice", ...(node.quiz ? ["quiz"] : [])].map((tab) => h("button", {
        type: "button", class: activeTab === tab ? "is-active" : null, "aria-pressed": String(activeTab === tab),
        onclick: () => { lessonTabs.set(node.id, tab); renderAllJourneys(); }
      }, tab[0].toUpperCase() + tab.slice(1))));
    const refs = (node.resource_ids || []).map((id) => ev.get(id)).filter((e) => e?.url);
    const journeyIndex = learningNodes.findIndex((item) => item.id === node.id);
    const beforeNode = learningNodes[journeyIndex - 1], afterNode = learningNodes[journeyIndex + 1];
    const stepNav = h("nav", { class: "learning-step-nav", "aria-label": "Learning step navigation" },
      h("button", { class: "btn sm", type: "button", disabled: !beforeNode ? true : null, onclick: () => beforeNode && selectNode(beforeNode) }, "Previous step"),
      h("span", { class: "muted" }, `${journeyIndex + 1} of ${learningNodes.length}`),
      h("button", { class: "btn sm primary", type: "button", disabled: !afterNode ? true : null, onclick: () => afterNode && selectNode(afterNode) }, "Next step"));
    const quiz = node.quiz ? h("section", { class: "learning-section learning-quiz" }, h("h5", {}, "Quiz · check your understanding"),
      h("p", {}, node.quiz.question), h("div", { class: "learning-options", role: "group", "aria-label": node.quiz.question },
        ...node.quiz.options.map((option, index) => h("button", { type: "button", class: `learning-option${state.answer === index ? state.correct ? " is-correct" : " is-wrong" : ""}`,
          "aria-pressed": String(state.answer === index), onclick: () => { quizState.set(node.id, { answer: index, correct: index === node.quiz.answer_index }); renderAllJourneys(); } }, option))),
      state.answer != null ? h("p", { class: `learning-feedback${state.correct ? " is-correct" : " is-wrong"}`, role: "status" },
        state.correct ? `Correct. ${node.quiz.explanation}` : `Not quite. ${node.quiz.explanation}`,
        !state.correct ? h("button", { type: "button", class: "btn sm", onclick: () => { quizState.delete(node.id); renderAllJourneys(); } }, "Try again") : null) : null) : null;
    return h("section", { class: "learning-lesson", "aria-labelledby": `lesson-${node.id}` },
      h("header", { class: "learning-lesson-header" }, h("div", {}, h("p", { class: "eyebrow" }, `Week ${week} selected · ${learningNodes.filter((item) => item.week_number === week).length} learning steps`),
        h("h4", { id: `lesson-${node.id}` }, node.title), h("div", { class: "learning-skill-tags" }, ...node.skills.map((skill) => h("span", { class: "tag" }, skill)),
          h("span", { class: "tag learning-source" }, node.content_source === "ai" ? "Personalized lesson" : "Guided lesson"))),
        h("span", { class: `learning-node-status${nodeDone(node) ? " is-done" : ""}` }, nodeDone(node) ? "✓ Completed" : `${node.estimated_minutes} min`)),
      stepNav, tabs,
      h("section", { class: "learning-section" }, h("h5", {}, "Learning objective"), h("p", {}, node.learning_objective)),
      h("section", { class: "learning-section", hidden: activeTab !== "learn" }, h("h5", {}, "Learn"),
        node.topics?.length ? h("ul", { class: "learning-topics" }, ...node.topics.map((topic) => h("li", {}, topic))) : null,
        ...node.learn.map((part) => h("p", {}, part))),
      h("section", { class: "learning-section", hidden: activeTab !== "learn" }, h("h5", {}, "How to learn"), h("ol", {}, ...node.instructions.map((step) => h("li", {}, step)))),
      h("section", { class: "learning-section", hidden: activeTab !== "learn" }, h("h5", {}, "Resources"), refs.length ? h("ul", { class: "learning-resources" }, ...refs.map((resource) =>
        h("li", {}, h("a", { href: currentSourceUrl(resource.url), target: "_blank", rel: "noopener noreferrer" }, resource.title),
          h("span", { class: "muted" }, ` · ${resource.publisher || "Verified source"} · ${resource.category || "Learning resource"}${resource.id.startsWith("learn:") ? " · Free" : ""}`)))) :
        h("p", { class: "muted" }, "No verified resource link was retrieved for this step. Use the Learn and Practice instructions below.")),
      h("section", { class: "learning-section", hidden: activeTab !== "practice" }, h("h5", {}, "Practice"), h("p", {}, node.exercise), h("p", {}, h("b", {}, "Deliverable: "), node.deliverable)),
      node.quiz ? h("div", { hidden: activeTab !== "quiz" }, quiz) : null,
      h("section", { class: "learning-section learning-completion" }, h("h5", {}, "Completion criteria"),
        h("p", { class: "muted" }, "Check each item after doing the work. Completion records this activity; it does not change your verified skill level."),
        ...node.completion_criteria.map((criterion, index) => h("label", { class: "learning-criterion" },
          h("input", { type: "checkbox", checked: criteria[index] ? true : null, disabled: readOnly || nodeDone(node) ? true : null,
            onchange: (event) => { const next = [...criteria]; next[index] = event.target.checked; criteriaState.set(node.id, next); renderAllJourneys(); } }), criterion)),
        h("p", { class: "learning-outcome" }, h("b", {}, "Expected outcome: "), node.expected_outcome),
        planId && !readOnly ? h("button", { class: `btn ${nodeDone(node) ? "ghost" : "primary"}`, type: "button",
          disabled: !nodeDone(node) && (!criteriaOk || !quizOk) ? true : null, onclick: () => markNode(node, !nodeDone(node)) },
          nodeDone(node) ? "Mark as not completed" : "Mark learning step complete") : h("p", { class: "muted" }, nodeDone(node) ? "Completed" : "Progress is read-only")));
  };
  function renderAllJourneys() { PHASES.forEach(renderJourney); }
  function selectNode(node) {
    const phase = phaseForWeek(node.week_number);
    selectedWeekByPhase[phase] = node.week_number;
    selectedNodeByPhase[phase] = node.id;
    const activePhase = blockEl?.querySelector(".phase-detail:not([hidden])")?.dataset.pane;
    if (activePhase !== phase) openPane(phase, false, node.id);
    else { renderAllJourneys(); scrollRoadTo(phase, node.week_number); }
  }
  const nowWeek = currentWeek(startDate);
  PHASES.forEach((phase) => {
    const [lo, hi] = phaseWeekRanges[phase]; selectedWeekByPhase[phase] = Math.min(hi, Math.max(lo, nowWeek));
    const group = learningNodes.filter((node) => node.week_number === selectedWeekByPhase[phase]);
    selectedNodeByPhase[phase] = (group.find((node) => !nodeDone(node)) || group[0])?.id || null;
  });
  const routedNode = learningNodes.find((node) => node.id === selectedNodeId);
  if (routedNode) {
    const routedPhase = phaseForWeek(routedNode.week_number);
    selectedNodeByPhase[routedPhase] = routedNode.id;
    selectedWeekByPhase[routedPhase] = routedNode.week_number;
  }
  const progressEl = h("div", { class: "plan-progress plan-stats" });
  const asideEl = h("aside", { class: "plan-aside", "aria-label": "What's next" });
  const calEl = h("details", { class: "plan-cal-wrap", open: true, hidden: learningNodes.length ? true : null }, h("summary", {}, icon("grid"), "Calendar: what to do each week"));
  const startMs = Date.parse(startDate || "") || Date.now();
  function drawProgress() {
    calEl.replaceChildren(calEl.firstChild, planCalendar(acts, startDate, done, key));
    renderAllJourneys();
    const total = learningNodes.length || acts.length;
    const n = learningNodes.length ? learningNodes.filter(nodeDone).length : acts.filter((a) => done.has(key(a))).length;
    const pct = total ? Math.round((100 * n) / total) : 0;
    const hrs = (xs) => Math.round(xs.reduce((s, a) => s + a.estimated_hours, 0) * 10) / 10;
    const inPhase = (p) => acts.filter((a) => a.day_range === p);
    const phaseNodes = (p) => { const [lo, hi] = phaseWeekRanges[p]; return learningNodes.filter((node) => node.week_number >= lo && node.week_number <= hi); };
    const phaseDone = (p) => learningNodes.length ? phaseNodes(p).filter(nodeDone).length : inPhase(p).filter((a) => done.has(key(a))).length;
    const phaseTotal = (p) => learningNodes.length ? phaseNodes(p).length : inPhase(p).length;
    const reached = PHASES.filter((p) => phaseTotal(p) && phaseDone(p) === phaseTotal(p));
    const daysLeft = Math.max(0, 90 - Math.floor((Date.now() - startMs) / DAY_MS));
    const next = learningNodes.length ? learningNodes.find((node) => !nodeDone(node)) : acts.find((a) => !done.has(key(a)));
    progressEl.replaceChildren(
      h("div", { class: "ps-main" },
        h("div", { class: "ps-ring", style: { "--pct": pct }, role: "img", "aria-label": `${pct}% done` }, h("b", {}, `${pct}%`)),
        h("div", { class: "ps-text" }, h("b", {}, "Overall progress"), h("span", { class: "muted" }, learningNodes.length
          ? `${n} of ${total} learning steps complete · estimated activity budget ${hrs(acts)} h`
          : `${n} of ${total} activities done · ${hrs(acts.filter((a) => done.has(key(a))))} of ${hrs(acts)} h`),
          h("div", { class: "pp-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(n), "aria-label": "Plan progress" },
            h("i", { style: { width: `${pct}%` } })))),
      h("div", { class: "ps-stat" }, h("span", { class: "ps-icon" }, icon("target")), h("div", {}, h("b", {}, `${reached.length} of 3`), h("span", { class: "muted" }, "Milestones reached"))),
      h("div", { class: "ps-stat" }, h("span", { class: "ps-icon" }, icon("grid")), h("div", {}, h("b", {}, String(daysLeft)), h("span", { class: "muted" }, "Days remaining"))));
    PHASES.forEach((p) => {
      const xs = inPhase(p);
      counts[p].replaceChildren(icon(phaseTotal(p) && phaseDone(p) === phaseTotal(p) ? "check" : "target"), `${phaseDone(p)} of ${phaseTotal(p)} learning steps done`);
      tracks[p].replaceChildren(...xs.map((a) => {
        const linked = learningNodes.filter((node) => node.activity_keys?.includes(key(a)));
        const finished = done.has(key(a)) || (linked.length > 0 && linked.every(nodeDone));
        const st = finished ? "done" : !learningNodes.length && a === next || learningNodes.length && linked.some((node) => node.id === next?.id) ? "now" : "todo";
        return h("li", { class: `pt-${st}` }, h("button", { type: "button", "aria-current": st === "now" ? "step" : null,
          onclick: (e) => { e.preventDefault(); e.stopPropagation(); jumpTo(key(a)); } },
          h("span", { class: "pt-dot" }, st === "done" ? icon("check") : null),
          h("span", { class: "pt-label" }, a.skill_id), h("span", { class: "pt-tag" }, `${a.estimated_hours} h`)));
      }));
    });
    const nextPhase = PHASES.find((p) => !reached.includes(p) && phaseTotal(p));
    asideEl.replaceChildren(
      next ? h("section", { class: "aside-card" },
        h("div", { class: "aside-head" }, h("h4", {}, learningNodes.length ? "Your next learning step" : "Your next activity"),
          h("span", { class: "pt-tag" }, learningNodes.length ? `Week ${next.week_number}` : `Days ${next.day_range}`)),
        h("b", { class: "aside-skill" }, learningNodes.length ? next.title : next.skill_id),
        h("p", {}, learningNodes.length ? next.learning_objective : next.activity),
        h("p", { class: "muted aside-step" }, learningNodes.length ? next.instructions[0] : planActivitySteps(next)[0]),
        h("div", { class: "aside-meta" }, h("span", {}, icon("clock"), learningNodes.length ? `${next.estimated_minutes} min estimate` : `${next.estimated_hours} h`)),
        h("button", { class: "btn primary", type: "button", onclick: () => {
          if (!learningNodes.length) return jumpTo(key(next));
          const phase = phaseForWeek(next.week_number); selectedWeekByPhase[phase] = next.week_number; selectedNodeByPhase[phase] = next.id;
          openPane(phase, false, next.id); renderAllJourneys(); setTimeout(() => journeyHosts[phase]?.querySelector(`.road-week[data-week="${next.week_number}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }), 160);
        } }, "Continue learning"))
        : h("section", { class: "aside-card" }, h("h4", {}, "All activities done"), h("p", {}, "You've finished every activity in this plan.")),
      nextPhase ? h("section", { class: "aside-card" },
        h("h4", {}, `Next milestone · Day ${nextPhase.split("-")[1]}`),
        h("p", { class: "muted" }, `Finish ${phaseNames[PHASES.indexOf(nextPhase)].toLowerCase()} activities:`),
        h("ul", { class: "aside-list" }, learningNodes.length ? phaseNodes(nextPhase).map((node) => h("li", { class: nodeDone(node) ? "is-done" : null },
          icon(nodeDone(node) ? "check" : "target"), node.title)) : inPhase(nextPhase).map((a) => h("li", { class: done.has(key(a)) ? "is-done" : null },
          icon(done.has(key(a)) ? "check" : "target"), a.skill_id)))) : null);
  }
  async function mark(a, value, box) {
    value ? done.add(key(a)) : done.delete(key(a));
    box.closest(".act")?.classList.toggle("is-done", value);
    drawProgress();
    try { await api(`/api/plans/${planId}/progress`, { method: "POST", body: { item: key(a), done: value } }); }
    catch (e) { value ? done.delete(key(a)) : done.add(key(a)); box.checked = !value; box.closest(".act")?.classList.toggle("is-done", !value); drawProgress(); toast(e.message, "err"); }
  }
  async function markNode(node, value) {
    const item = `node:${node.id}`;
    value ? done.add(item) : done.delete(item);
    drawProgress();
    try { await api(`/api/plans/${planId}/progress`, { method: "POST", body: { item, done: value } }); }
    catch (e) { value ? done.delete(item) : done.add(item); drawProgress(); toast(e.message, "err"); }
  }
  drawProgress();
  const planEl = h("div", { class: "plan" }, phases,
    h("p", { class: "note plan-cost" }, icon("check"), "Cost: free. Every linked resource is official documentation, vendor training or the ESCO skill page."));
  const sdgGuide = h("details", { class: "note sdg-guide" }, h("summary", {}, "How activities connect to the SDGs"),
    h("p", {}, "Goal tags on each activity show its connection: SDG 4 for learning, SDG 8 for decent work, and (when mapped) one additional goal matched to that skill. These are evidence-linked suggestions, not official UN classifications."));
  const errBox = h("div", { class: "issues" });
  const saveBtn = h("button", { class: "btn", type: "button", disabled: true, onclick: save }, "Save as new draft");
  const confirm = h("input", { type: "checkbox", onchange: () => { approveBtn.disabled = !confirm.checked; } });
  const approveBtn = h("button", { class: "btn primary", type: "button", disabled: true, onclick: approve }, "Approve plan");
  const bar = h("div", { class: "approve-bar" },
    h("div", {}, tagEl, " ", verEl),
    h("div", { class: "right" }, saveBtn,
      status === "draft" ? [h("label", { class: "check" }, confirm, approverLabel), approveBtn] : null,
      status === "flagged" ? h("span", { class: "note" }, "Fix the flagged issues and save a new draft before approval.") : null));

  async function save() {
    saveBtn.disabled = true;
    errBox.replaceChildren();
    try {
      const r = await api(`/api/plans/${planId}/edit`, { method: "POST", body: { activities: acts } });
      toast(`Saved as draft v${r.version}`);
      onChange?.("draft");
    } catch (e) {
      const list = e instanceof ApiError && e.body?.issues;
      errBox.replaceChildren(...(list || [{ severity: "error", message: e.message }]).map((i) => h("div", { class: `issue ${i.severity}` }, i.message)));
      saveBtn.disabled = false;
    }
  }
  async function approve() {
    approveBtn.disabled = true;
    try {
      const r = await api(`/api/plans/${planId}/approve`, { method: "POST", body: { version, confirmed: confirm.checked } });
      toast(`Approved as v${r.version}`);
      onChange?.("approved");
    } catch (e) {
      toast(e.message, "err");
      approveBtn.disabled = false;
    }
  }
  blockEl = h("section", { class: "block plan-block", "aria-label": "30, 60, 90 day plan" },
    title ? h("h3", {}, title) : null,
    planId ? h("p", { class: "muted mono plan-ref" }, `Plan ID ${planReference || planId}`) : null,
    progressEl,
    plan.deferred_skills?.length ? h("details", { class: "note deferred" },
      h("summary", {}, `${plan.deferred_skills.length} more skills don't fit in ${weeklyHours ? weeklyHours + " h/week" : "the weekly hours"}; the plan covers the highest-priority gaps first.`),
      h("p", {}, plan.deferred_skills.join(", "))) : null,
    h("div", { class: "plan-layout" }, h("div", { class: "plan-main" }, h("div", { class: "plan-overview" }, planEl, calEl, sdgGuide), PHASES.map((p) => panes[p])), asideEl),
    planId ? diagramsBlock(planId, version) : null,
    errBox, readOnly ? null : bar);
  blockEl.openPane = openPane;
  return reveal(blockEl, RISE, { duration: 420 });
}

// --- plan diagrams: built on the server from the latest plan version (src/diagrams), drawn here with the vendored
// Mermaid and Chart.js, loaded only when the section scrolls into view
const scripts = {};
const loadScript = (name) => scripts[name] ||= new Promise((ok, fail) => document.head.append(
  h("script", { src: new URL(`../vendor/${name}`, import.meta.url).href, onload: ok, onerror: () => { delete scripts[name]; fail(new Error(`Could not load ${name}`)); } })));
let diagramSeq = 0;

function diagramsBlock(planId, version) {
  const tabs = h("div", { class: "seg pd-tabs", role: "tablist", "aria-label": "Plan diagrams" });
  const stage = h("div", { class: "pd-stage" }, h("p", { class: "muted" }, "Drawing your plan diagrams…"));
  const side = h("aside", { class: "pd-side", "aria-live": "polite" });
  const notes = h("div");
  const el = h("section", { class: "pd", "aria-label": "Plan diagrams" },
    h("header", { class: "pd-head" }, h("h4", {}, "Plan diagrams"), h("p", { class: "muted" }, "Generated from this plan version; they change when the plan changes.")),
    notes, tabs, h("div", { class: "pd-body" }, stage, side));
  let started = false;
  const start = () => { if (!started && el.isConnected) { started = true; seen.disconnect(); draw(); } };
  const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && start(), { rootMargin: "300px" });
  seen.observe(el);
  setTimeout(start, 2000);  // background tabs never report intersection

  async function draw() {
    let data;
    try {
      [data] = await Promise.all([api(`/api/plans/${planId}/diagrams?v=${version || ""}`), loadScript("mermaid.min.js"), loadScript("chart.umd.min.js")]);
    } catch (e) { stage.replaceChildren(h("p", { class: "issue error" }, `Diagrams unavailable: ${e.message}`)); return; }
    const { plan, diagrams } = data;
    const byId = Object.fromEntries(plan.skills.map((s) => [s.id, s]));
    notes.replaceChildren(...data.notes.map((n) => h("p", { class: "note" }, n)));
    const showSkill = (id) => {
      const s = byId[id]; if (!s) return;
      const res = plan.resources.filter((r) => r.skill_id === id);
      side.replaceChildren(h("h5", {}, s.name),
        h("p", {}, h("span", { class: `tag pd-${s.priority}` }, `${s.priority} priority`), " ", h("span", { class: "muted" }, s.category)),
        h("p", {}, `Level ${s.level_now} → ${s.level_target}`),
        h("p", {}, h("b", {}, "Phase: "), plan.phases.filter((p) => p.skills.includes(id)).map((p) => p.name).join(", ") || "not scheduled"),
        s.depends_on.length ? h("p", {}, h("b", {}, "Learn first: "), s.depends_on.map((d) => byId[d]?.name || d).join(", ")) : "",
        h("b", {}, "Resources"),
        res.length ? h("ul", {}, res.map((r) => h("li", {}, r.url ? h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, r.title) : r.title,
          h("span", { class: "muted" }, ` · ${r.type}${r.est_hours ? ` · ${r.est_hours} h` : ""}`)))) : h("p", { class: "muted" }, "No resources listed."),
        h("button", { class: "btn sm ghost", type: "button", onclick: skillList }, icon("back"), "All skills"));
    };
    const skillList = () => side.replaceChildren(h("h5", {}, "Skills"), h("p", { class: "muted" }, "Select a skill, or a skill in a diagram."),
      h("ul", { class: "pd-skills" }, plan.skills.map((s) => h("li", {}, h("button", { type: "button", class: "btn sm", onclick: () => showSkill(s.id) },
        h("span", { class: `tag pd-${s.priority}` }, s.priority[0].toUpperCase()), s.name)))));
    skillList();
    window.showSkill = showSkill;  // Mermaid "click ... call showSkill()" targets
    const dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";
    mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: dark ? "dark" : "default", htmlLabels: false, flowchart: { htmlLabels: false },
      gantt: { fontSize: 14, sectionFontSize: 14, barHeight: 26, barGap: 6, leftPadding: 170, useWidth: 1000 } });
    let chart = null;
    const save = (href, name) => h("a", { href, download: name }).click();
    async function open(d) {
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.key === d.key)));
      chart?.destroy(); chart = null;
      const canvas = d.lang === "chartjs" ? h("canvas", { "aria-label": d.title }) : null;
      const host = h("div", { class: "pd-mm" });
      const svgBtn = h("button", { class: "btn sm", type: "button", hidden: d.lang !== "mermaid" || !d.code }, "SVG");
      const pngBtn = h("button", { class: "btn sm", type: "button", hidden: !d.code }, "PNG");
      stage.replaceChildren(h("div", { class: "pd-bar" }, h("b", {}, d.title), h("span", { class: "pd-dl" }, svgBtn, pngBtn)),
        d.note ? h("p", { class: "note" }, d.note) : "", canvas ? h("div", { class: "pd-canvas" }, canvas) : host);
      if (d.lang === "mermaid" && d.code) {
        try {
          const { svg, bindFunctions } = await mermaid.render(`pd-${planId}-${d.key}-${++diagramSeq}`, d.code);
          host.innerHTML = svg; bindFunctions?.(host);
        } catch (e) { host.replaceChildren(h("p", { class: "issue error" }, `This diagram could not be drawn: ${e.message || e}`)); }
      } else if (canvas) {
        const cfg = JSON.parse(d.code), css = (v) => getComputedStyle(el).getPropertyValue(v).trim() || undefined;
        const accent = css("--accent") || "#2a5bd7", muted = css("--ink-2") || "#5a6378", danger = css("--danger") || "#c0392b";
        cfg.data.datasets.forEach((s) => {
          if (s.role === "now") Object.assign(s, { borderColor: muted, backgroundColor: "rgba(90,99,120,.25)" });
          if (s.role === "target") Object.assign(s, { borderColor: accent, backgroundColor: "rgba(42,91,215,.25)" });
          if (s.role === "planned") s.backgroundColor = cfg.data.over.map((o) => (o ? danger : accent));
          if (s.role === "capacity") Object.assign(s, { borderColor: danger, borderDash: [6, 4], pointRadius: 0, backgroundColor: "transparent" });
        });
        cfg.options = { ...cfg.options, maintainAspectRatio: false, animation: { duration: 300 },
          onClick: (_, els) => { const i = els[0]?.index; if (i != null && cfg.data.ids) showSkill(cfg.data.ids[i]); } };
        chart = new Chart(canvas, cfg);
      }
      svgBtn.onclick = () => { const svg = host.querySelector("svg"); if (svg) save(URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" })), `${d.key}.svg`); };
      pngBtn.onclick = () => {
        if (chart) return save(chart.toBase64Image("image/png", 1), `${d.key}.png`);
        const svg = host.querySelector("svg"); if (!svg) return;
        const box = svg.getBoundingClientRect(), img = new Image(), clone = svg.cloneNode(true);
        clone.setAttribute("width", box.width); clone.setAttribute("height", box.height);
        img.onload = () => { const c = h("canvas", { width: box.width * 2, height: box.height * 2 }), g = c.getContext("2d");
          g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); save(c.toDataURL("image/png"), `${d.key}.png`); };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
      };
    }
    tabs.replaceChildren(...diagrams.map((d) => h("button", { type: "button", role: "tab", "data-key": d.key, onclick: () => open(d) }, d.title)));
    open(diagrams[0]);
  }
  return el;
}

export function historyBlock(hist) {
  return h("ol", { class: "history" }, hist.map((e) => h("li", {},
    h("time", { datetime: e.at_utc }, fmtTime(e.at_utc)),
    h("span", {}, `${e.action} by ${e.actor}`, e.actor_role !== "system" ? h("span", { class: "muted" }, ` (${e.actor_role.replace("_", " ")})`) : null,
      " → ", h("b", {}, e.new_status), h("span", { class: "muted num" }, ` v${e.version}`)))));
}

export function sourceItem(e) {
  return h("a", { class: "src", id: `src-${e.id}`, href: currentSourceUrl(e.url), target: "_blank", rel: "noopener noreferrer" },
    h("span", { class: "id" }, citeLabel(e.id)),
    h("span", { class: "t" }, e.title),
    h("span", { class: "m" }, [e.publisher, e.publication_date && `published ${e.publication_date}`, e.access_date && `accessed ${e.access_date}`].filter(Boolean).join(" · ")));
}

function currentSourceUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname !== "esco.ec.europa.eu") return rawUrl;
    const conceptPages = new Set([
      "/en/classification/skill",
      "/en/classification/occupation",
    ]);
    if (!conceptPages.has(url.pathname)) return rawUrl;
    const uri = url.searchParams.get("uri");
    if (uri) url.searchParams.set("uri", uri);
    return url.href;
  } catch {
    return rawUrl;
  }
}

// ---------------------------------------------------------------- document integrity (hidden text, injection, fraud)
const SEV = { CRITICAL: "flagged", HIGH: "flagged", MEDIUM: "draft", LOW: "draft", INFO: "draft" };

/** Integrity report for an uploaded resume. audience "self" explains what was removed; "hr" shows the evidence. */
export function integrityBlock(rep, audience = "hr") {
  if (!rep) return null;
  const f = rep.findings || [];
  const level = rep.risk?.level || "CLEAN";
  if (!f.length) return audience === "hr" ? h("p", { class: "note integrity-ok" }, "Document integrity: clean. No hidden text, injected instructions or fraud signals found.") : null;
  return block("Document integrity",
    h("h3", {}, "Document integrity ", h("span", { class: `tag ${level === "CLEAN" ? "approved" : SEV[level] || "draft"}` }, level.toLowerCase())),
    h("p", { class: "note" }, audience === "hr"
      ? (rep.risk?.hold ? "Held for your review before it can be recommended. Hidden content was removed before screening." :
        "Signals for your judgement. Hidden content was removed before screening; the agents only saw visible text.")
      : "We only analyse what a person can see. These items were removed or flagged before the analysis:"),
    h("ul", { class: "check-list" }, f.map((x) => h("li", { class: x.severity === "CRITICAL" || x.severity === "HIGH" ? "bad" : "" },
      h("b", {}, x.technique), h("span", { class: "muted" }, ` · ${x.description}`),
      audience === "hr" && x.evidence ? h("q", {}, x.evidence) : null))));
}

// ---------------------------------------------------------------- future roles, SDGs, daily AI-trend signals
const pct = (x) => `${Math.round(x * 100)}%`;

export function sdgChip(g, { compact = false } = {}) {
  return h("a", { class: compact ? "sdg-n" : "sdg", href: `https://sdgs.un.org/goals/goal${g.goal}`, target: "_blank", rel: "noopener noreferrer",
    style: { "--sdg": g.color }, title: `UN Sustainable Development Goal ${g.goal}: ${g.short}`, "aria-label": compact ? `UN SDG ${g.goal}: ${g.short}` : null },
    compact ? String(g.goal) : [h("b", {}, g.goal), g.short]);
}

function momentum(m) {
  const out = [];
  if (m.emerging ?? m.emergence >= 1) out.push(h("span", { class: "trend rising", title: "Top 10% of roles for AI-driven growth on today's trend board" }, icon("up"), "emerging"));
  if (m.stretch) out.push(h("span", { class: "tag", title: "Needs one more ISCO-08 skill level than you have" }, "stretch"));
  if (m.under_pressure ?? m.pressure >= 2) out.push(h("span", { class: "trend falling", title: "Top 10% of roles for automation pressure on today's trend board" }, icon("down"), "automation pressure"));
  return out;
}

function sdgMatchDetails(sdgs) {
  const connections = sdgs.map((g) => {
    const heading = h("div", { class: "sdg-connection-head" },
      h("span", { class: "sdg-n", style: { "--sdg": g.color }, "aria-hidden": "true" }, g.goal),
      h("b", {}, `SDG ${g.goal} · ${g.short}`));
    const target = g.target
      ? h("p", { class: "sdg-target" }, h("b", {}, "Relevant target: "), g.target)
      : null;
    const explanation = g.target && g.target_text
      ? `ESCO role description matched to UN target ${g.target}: ${g.target_text}`
      : `ESCO role description semantically matched to ${g.short}.`;
    return h("li", { class: "sdg-connection-card" }, heading, target,
      h("p", { class: "sdg-connection-copy" }, h("b", {}, "Connection to this career: "), explanation));
  });
  const body = h("ul", { class: "sdg-connections" }, connections);
  const panel = h("div", { class: "sdg-expand-panel", "aria-hidden": "true", inert: true },
    h("div", { class: "sdg-expand-inner" }, body));
  const toggle = h("button", { type: "button", class: "sdg-match-toggle", "aria-expanded": "false",
    onclick: () => {
      const expanded = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(expanded));
      panel.classList.toggle("is-open", expanded);
      panel.setAttribute("aria-hidden", String(!expanded));
      if (expanded) panel.removeAttribute("inert"); else panel.setAttribute("inert", "");
    } }, "How this role connects to the goals", icon("chevron"));
  return [toggle, panel];
}

/** Ranked future roles. onPlan(match) builds a full plan for one of them. */
/** Relative effort to move into a role, from how much of it you already cover (and a training level up adds a step). */
const effort = (m) => { const c = m.coverage - (m.stretch ? 0.15 : 0);
  return c >= 0.5 ? ["Short step", "easy"] : c >= 0.25 ? ["Medium step", "mid"] : ["Big step", "hard"]; };
const signed = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(Math.round(x * 100))}%`;

/** Why a role scored what it did: each part of the score, the trend effect, the effort, and the role itself (ESCO). */
function whyScore(m) {
  const row = (label, value, hint) => h("li", {}, h("span", {}, label, hint ? h("small", {}, hint) : null), h("b", {}, value));
  const about = h("div", { class: "role-about" }, h("p", { class: "muted" }, "Loading the role description…"));
  const d = h("details", { class: "why-score" }, h("summary", {}, icon("info"), "Why this score"),
    h("ul", { class: "why-rows" },
      row("Skills you already have", pct(m.coverage), "share of this role's ESCO skills, weighted by importance"),
      m.alignment != null ? row("Fit with what the role values", pct(m.alignment), "how important your strongest skills are to this role") : null,
      m.text_fit != null ? row("Your résumé reads like this role", pct(m.text_fit), "meaning-based text similarity") : null,
      m.tools_matched ? row("Tools you use that it lists", String(m.tools_matched)) : null,
      m.trend_effect != null ? row(`Today's AI trends (${m.scenario === "agentic" ? "agentic" : "assistive"} AI)`, signed(m.trend_effect),
        "growth minus automation pressure; reorders roles, never changes the match") : null,
      row("Effort to switch", effort(m)[0],
        `from the share of the role you already cover${m.stretch ? "; one training level above yours" : ""}. Your 90-day plan starts with the most important gaps`)),
    about);
  d.addEventListener("toggle", async () => {
    if (!d.open || d.dataset.loaded) return;
    d.dataset.loaded = "1";
    try {
      const o = await api(`/api/occupations/${m.soc}`);
      about.replaceChildren(h("h5", {}, "About this role"),
        h("p", {}, o.description.length > 420 ? o.description.slice(0, 420) + "…" : o.description),
        o.skills?.length ? h("p", { class: "role-skills" }, h("b", {}, "Main skills: "), o.skills.slice(0, 6).map((s) => s.name).join(", ")) : null,
        h("a", { href: o.url, target: "_blank", rel: "noopener noreferrer" }, "Full ESCO occupation page"));
    } catch { about.replaceChildren(h("p", { class: "muted" }, "Role description unavailable right now.")); }
  });
  return d;
}

/** Side-by-side comparison of the roles ticked for comparison. */
function compareTable(rows) {
  const line = (label, f) => h("tr", {}, h("th", { scope: "row" }, label), rows.map((m) => h("td", {}, f(m))));
  return h("div", { class: "compare-wrap" }, h("table", { class: "compare" },
    h("thead", {}, h("tr", {}, h("td"), rows.map((m) => h("th", { scope: "col" }, jobIcon(m.soc, { size: 28 }), m.title)))),
    h("tbody", {},
      line("Match", (m) => pct(m.fit)),
      line("Skills you already have", (m) => pct(m.coverage)),
      line("AI trend effect", (m) => m.trend_effect != null ? signed(m.trend_effect) : "–"),
      line("Effort to switch", (m) => effort(m)[0]),
      line("Top skills to learn", (m) => (m.top_gaps || []).join(", ") || "none"),
      line("UN goals", (m) => (m.sdgs || []).map((g) => `SDG ${g.goal}`).join(", ") || "–"))));
}

// rank change since the other AI scenario (previous: that ranking's socs), and how today's trends move this role
function scenarioEffect(m, i, previous, scenario) {
  const out = [];
  if (previous) {
    const was = previous.indexOf(m.soc);
    if (was < 0) out.push(h("span", { class: "trend rising", title: "Not in the top roles under the other AI scenario" }, icon("up"), "new"));
    else if (was !== i) out.push(h("span", { class: `trend ${was > i ? "rising" : "falling"}`, title: `Was #${was + 1} under the other AI scenario` },
      icon(was > i ? "up" : "down"), String(Math.abs(was - i))));
  }
  const t = Math.round((m.trend_effect || 0) * 100);
  if (t) out.push(h("span", { class: `trend ${t > 0 ? "rising" : "falling"}`,
    title: `Under ${scenario === "agentic" ? "agentic" : "assistive"} AI, today's trends move this role's rank score by ${t > 0 ? "+" : ""}${t}%. The match % does not change.` },
    `AI outlook ${t > 0 ? "+" : ""}${t}%`));
  return out;
}

export function matchesBlock(matches, { onPlan, onInterview, title = "Roles you could grow into", note, scenario, onScenario, previous } = {}) {
  if (!matches?.length) return block("Role matches", h("h3", {}, title), h("p", { class: "note" }, "No matches yet. Add a few more skills."));
  const picked = new Set();
  const compareHost = h("div");
  const drawCompare = () => compareHost.replaceChildren(picked.size >= 2 ? compareTable(matches.filter((m) => picked.has(m.soc))) :
    picked.size === 1 ? h("p", { class: "note" }, "Tick one more role to compare.") : "");
  // filter by UN goal: only goals that appear in these matches
  const goals = [...new Map(matches.flatMap((m) => m.sdgs || []).map((g) => [g.goal, g])).values()].sort((a, b) => a.goal - b.goal);
  let goal = null;
  const list = h("ol", { class: "matches" }, matches.map((m, i) => reveal(h("li", { "data-goals": (m.sdgs || []).map((g) => g.goal).join(" ") },
    h("span", { class: "rank num" }, i + 1),
    h("div", { class: "match-content" },
      h("div", { class: "match-head" },
        h("div", { class: "who" },
          h("div", { class: "job-line", title: `ESCO ${m.soc}` },
            jobIcon(m.soc, { size: 44, labelled: true }), h("b", {}, m.title),
            h("span", { class: "match-badges" }, scenarioEffect(m, i, previous, scenario), momentum(m), h("span", { class: `tag effort ${effort(m)[1]}`, title: "Effort to switch, from the share of this role you already cover" }, effort(m)[0])))),
        h("div", { class: "fit" },
          h("span", { class: "num" }, pct(m.fit)), h("span", { class: "note" }, "match"),
          h("span", { class: "fitbar", "aria-hidden": "true" }, reveal(h("i", { style: { width: pct(Math.min(1, m.fit)) } }), GROW, { duration: 700, delay: i * 50 })))),
      h("div", { class: "gaps" }, m.top_gaps?.length
        ? [icon("target"), h("b", {}, "To learn"), h("span", { class: "gap-chips" }, m.top_gaps.slice(0, 3).map((gap) => h("span", { class: "gap-chip" }, gap))),
          m.top_gaps.length > 3 ? h("details", { class: "more-gaps" }, h("summary", {}, `+${m.top_gaps.length - 3} more`),
            h("ul", {}, m.top_gaps.slice(3).map((gap) => h("li", {}, gap)))) : null]
        : [icon("check"), h("b", {}, "To learn"), h("span", {}, "No skill gaps identified")]),
      m.sdgs?.length ? h("div", { class: "match-sdgs" },
        h("div", { class: "sdg-nums" }, m.sdgs.map((g) => sdgChip(g, { compact: true }))),
        sdgMatchDetails(m.sdgs)) : null,
      whyScore(m)),
    h("div", { class: "match-actions" },
      onPlan ? h("button", { class: "btn sm primary match-plan", type: "button", onclick: () => onPlan(m) }, "Plan for this role") : null,
      onInterview && m.recommendation_id ? h("button", { class: "btn sm", type: "button", onclick: () => onInterview(m) }, "Practice interview") : null,
      h("label", { class: "compare-pick" }, h("input", { type: "checkbox", onchange: (e) => {
        if (e.target.checked && picked.size >= 3) { e.target.checked = false; toast("Compare up to 3 roles at a time.", "err"); return; }
        e.target.checked ? picked.add(m.soc) : picked.delete(m.soc); drawCompare(); } }), "Compare"))),
    DROP, { delay: Math.min(i, 8) * 45 })));
  const filterGoal = (g) => {
    goal = g;
    goalBar.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.goal || 0) === (g || 0))));
    list.querySelectorAll(":scope > li").forEach((li) => { li.hidden = !!g && !li.dataset.goals.split(" ").includes(String(g)); });
  };
  const goalBar = goals.length > 1 ? h("div", { class: "goal-filter", role: "group", "aria-label": "Show roles serving a UN goal" },
    h("span", { class: "muted" }, "UN goal:"),
    h("button", { type: "button", class: "chip", "aria-pressed": "true", onclick: () => filterGoal(null) }, "All"),
    goals.map((g) => h("button", { type: "button", class: "chip goal-chip", "data-goal": g.goal, "aria-pressed": "false", style: { "--sdg": g.color },
      title: `SDG ${g.goal}: ${g.short}`, onclick: () => filterGoal(goal === g.goal ? null : g.goal) }, `${g.goal} · ${g.short}`))) : null;
  const scenSeg = onScenario ? h("div", { class: "seg", role: "group", "aria-label": "AI scenario for the ranking" },
    [["assistive", "Assistive AI"], ["agentic", "Agentic AI"]].map(([k, l]) => h("button", { type: "button", "aria-pressed": String((scenario || "assistive") === k),
      title: k === "agentic" ? "AI agents take over routine work: automation pressure and AI-driven growth weigh more" : "AI helps people do today's work",
      onclick: () => k !== (scenario || "assistive") && onScenario(k) }, l))) : null;
  return block("Role matches",
    h("div", { class: "matches-head" }, h("h3", {}, title), scenSeg),
    goalBar, compareHost, list,
    h("p", { class: "note" }, note || "Match combines how much of each role's ESCO skills you have, how well your skills fit what it values, and (with a résumé) how closely your experience reads like it. Today's AI trends reorder roles, never change the match. Open \"Why this score\" on any role."));
}

export function sdgBlock(sdgs) {
  if (!sdgs?.length) return null;
  return card("UN Sustainable Development Goals", "target", "UN goals served",
    { figure: sdgs.length, unit: sdgs.length === 1 ? "goal" : "goals",
      note: "Matched by comparing the job description with the 169 official UN SDG targets. A suggestion, not an official UN classification. Every plan activity also supports SDG 4 and SDG 8." },
    h("div", { class: "sdg-nums" }, sdgs.map((g) => h("a", { class: "sdg-n big", href: `https://sdgs.un.org/goals/goal${g.goal}`, target: "_blank", rel: "noopener noreferrer",
      style: { "--sdg": g.color }, title: `SDG ${g.goal}: ${g.short}. Target ${g.target}: ${g.target_text}`, "aria-label": `UN SDG ${g.goal}: ${g.short}` }, String(g.goal)))),
    h("p", { class: "bc-line" }, "How this career connects to the goals ", h("a", { href: "#/sdgs" }, "(all 17 goals)")),
    h("ul", { class: "sdg-connections" }, sdgs.map((g) => h("li", {},
      h("b", {}, `SDG ${g.goal} · ${g.short}`),
      h("span", {}, g.target && g.target_text
        ? `Role description matched to UN target ${g.target}: ${g.target_text}`
        : `The role description is semantically matched to ${g.short}.`)))),
    h("p", { class: "note" }, "Role matches come from comparing the ESCO occupation description with official UN targets. Each learning activity is also tagged to show how building that skill connects to the goals."));
}

/** Report section: what today's AI-trend board says about this occupation. */
export function signalsBlock(sig) {
  if (!sig) return card("AI-trend signals", "pulse", "Today's AI trend", {}, h("p", { class: "bc-line" }, "No daily trend board built yet."));
  const em = sig.emergence ?? 0, pr = sig.pressure ?? 0;
  const verdict = em >= 0.5 ? "Growing" : em <= -0.5 ? "Shrinking" : "Neutral";
  return card("AI-trend signals", "pulse", "Today's AI trend",
    { figure: verdict, unit: pr >= 1 ? "with automation pressure on routine tasks" : `for this role · ${sig.day}`,
      note: `Emergence ${em.toFixed(2)}, pressure ${pr.toFixed(2)} (exposure-weighted topic momentum) on ${sig.day}. Sources: ` +
        [sig.sources?.hn && "Hacker News", sig.sources?.arxiv && "arXiv", ...(sig.sources?.jobs || [])].filter(Boolean).join(", ") + ". Signals, not certainties." },
    sig.topics?.length ? h("div", { class: "chips" }, sig.topics.slice(0, 4).map((t) => h("span", { class: `chip-static trend-${t.direction}`,
      title: `z ${t.z > 0 ? "+" : ""}${t.z} · ${t.confidence} confidence · skills ${t.skills.join(", ")}` },
      icon(t.direction === "rising" ? "up" : t.direction === "falling" ? "down" : "flat"), t.label))) : null);
}

function spark(values) {
  const w = 72, ht = 20, max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${ht - (v / max) * ht}`).join(" ");
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", `0 -1 ${w} ${ht + 2}`); s.setAttribute("width", w); s.setAttribute("height", ht); s.setAttribute("aria-hidden", "true");
  s.classList.add("spark");
  const pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  pl.setAttribute("points", pts); s.append(pl);
  return s;
}

/** The daily AI-trend board (public "Today" and Enterprise "Signals"). */
const SVG = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

/** Future skills radar: one spoke per AI topic, distance = trend strength (z, clipped to ±3); dashed = the previous board. */
function radar(topics, prev, selected = "today") {
  const n = topics.length, R = 120, c = 160, r = (z) => R * (Math.max(-3, Math.min(3, z)) + 3) / 6;
  const pt = (i, z) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [c + r(z) * Math.cos(a), c + r(z) * Math.sin(a)]; };
  const strength = (t) => selected === "previous" ? (prev?.z?.[t.id] ?? 0) : t.z;
  const direction = (t) => selected === "previous"
    ? (prev?.direction?.[t.id] || (strength(t) >= 2 ? "rising" : strength(t) <= -2 ? "falling" : "stable")) : t.direction;
  const s = svg("svg", { viewBox: "-100 0 520 320", class: "radar", role: "img",
    "aria-label": `Future skills radar: ${topics.filter((t) => strength(t) >= 2).map((t) => t.label).join(", ") || "no topic"} rising${selected === "previous" ? " on the previous board" : " today"}` });
  for (const z of [-2, 0, 2]) s.append(svg("circle", { cx: c, cy: c, r: r(z), class: z === 0 ? "rd-zero" : "rd-ring" }));
  topics.forEach((t, i) => {
    const [x, y] = pt(i, 3);
    s.append(svg("line", { x1: c, y1: c, x2: x, y2: y, class: "rd-spoke" }));
    const lab = svg("text", { x: c + (x - c) * 1.07, y: c + (y - c) * 1.07, class: `rd-label ${direction(t)}`,
      "text-anchor": Math.abs(x - c) < 8 ? "middle" : x > c ? "start" : "end", "dominant-baseline": "middle" });
    lab.textContent = t.label.length > 18 ? t.label.slice(0, 17) + "…" : t.label;
    s.append(lab);
  });
  const poly = (zs, cls) => svg("polygon", { points: zs.map((z, i) => pt(i, z).join(",")).join(" "), class: cls });
  if (prev && selected === "previous") {
    s.append(poly(topics.map((t) => t.z), "rd-prev"));
    s.append(poly(topics.map((t) => prev.z[t.id] ?? 0), "rd-now"));
  } else {
    if (prev) s.append(poly(topics.map((t) => prev.z[t.id] ?? 0), "rd-prev"));
    s.append(poly(topics.map((t) => t.z), "rd-now"));
  }
  return s;
}

/** 30-day trend-strength line for one topic (z can be negative). */
function zLine(values) {
  const w = 120, ht = 28, lo = Math.min(-2, ...values), hi = Math.max(2, ...values);
  const y = (v) => ht - ((v - lo) / (hi - lo)) * ht;
  const s = svg("svg", { viewBox: `0 -1 ${w} ${ht + 2}`, width: w, height: ht, class: "zline", "aria-hidden": "true" });
  s.append(svg("line", { x1: 0, x2: w, y1: y(0), y2: y(0), class: "zl-zero" }));
  s.append(svg("polyline", { points: values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${y(v)}`).join(" ") }));
  return s;
}

/** The daily AI-trend board. preview: the leading topics only (the landing page links to the full board). */
export function boardView(b, { onRefresh, preview = false } = {}) {
  if (!b?.available) return h("div", { class: "empty" }, h("h2", {}, "No trend board yet"),
    h("p", { class: "muted" }, b?.message || "The board is built once a day from public news, research and job-posting signals."),
    onRefresh ? h("button", { class: "btn primary", onclick: onRefresh }, "Build today's board") : null);
  const topics = Array.isArray(b.topics) ? b.topics : [];
  const evidence = Array.isArray(b.evidence) ? b.evidence : [];
  const evid = new Map(evidence.map((e) => [e.id, e]));
  const label = (id) => topics.find((t) => t.id === id)?.label;
  const pill = (ic, text, title) => h("span", { class: "meta-pill", title }, icon(ic), text);
  const meta = h("div", { class: "board-meta" },
    pill("clock", fmtTime(b.created_utc), `Board for ${b.day}`),
    b.sources.hn ? pill("pulse", "Hacker News", "8 weekly story counts per topic") : null,
    b.sources.arxiv ? pill("file", "arXiv", "papers, last 14 vs 42 days") : null,
    b.sources.jobs?.length ? pill("search", `${b.sources.postings.toLocaleString()} job posts`, `live postings from ${b.sources.jobs.join(", ")}`) : null,
    onRefresh ? h("button", { class: "btn sm", onclick: onRefresh }, icon("history"), "Refresh") : null);
  const dir = (t) => [icon(t.direction === "rising" ? "up" : t.direction === "falling" ? "down" : "flat"), t.direction || "stable"];
  // one card per topic: the trend, its weekly change, its 8-week line, and one place for its sources
  const card = (t, i) => {
    const hn = t.sources.hn, jobs = t.sources.jobs;
    const growth = hn ? `${hn.weekly_growth_pct > 0 ? "+" : ""}${hn.weekly_growth_pct.toFixed(1)}%` : null;
    const links = t.evidence_ids.filter((id) => evid.has(id)).map((id) => evid.get(id));
    const charts = h("div", { class: "tc-charts", "aria-hidden": "true" }, hn
      ? h("div", { class: "tc-chart-item" }, spark(hn.weekly), h("span", { class: "tc-chart-caption" }, "8-week HN trend")) : null);
    const lead = i === 0;  // the biggest mover today leads the board
    // one photograph per topic (img/topics, generated to one style); a topic without one simply has no picture
    const media = h("div", { class: "tc-media" }, h("img", { src: `img/topics/${t.id}${lead ? "" : "-sm"}.jpg`, alt: "", loading: lead ? "eager" : "lazy",
      decoding: "async", width: lead ? 1200 : 600, height: lead ? 800 : 400, onerror: (e) => e.currentTarget.parentElement.remove() }));
    return reveal(h("article", { class: `topic-card${lead ? " lead" : ""}`, "data-topic": t.id, "data-kind": t.kind,
      "data-text": `${t.label} ${(t.skills || []).join(" ")}`.toLowerCase() },
      media,
      h("div", { class: "tc-top" }, h("h4", {}, t.label),
        h("span", { class: `trend ${t.direction}`, title: `Trend strength z = ${t.z.toFixed(1)} (rising at z ≥ 2, falling at z ≤ −2); confidence ${t.confidence}` }, dir(t))),
      h("div", { class: "tc-figure" },
        growth ? h("div", { class: "tc-growth", title: "Weekly growth of Hacker News stories on this topic over 8 weeks" }, h("b", {}, growth), h("span", {}, "per week on HN"))
          : h("div", { class: "tc-growth" }, h("b", {}, t.z > 0 ? `+${t.z.toFixed(1)}` : t.z.toFixed(1)), h("span", {}, "trend strength")),
        charts),
      lead && t.skills?.length ? h("div", { class: "tc-skills" }, h("span", {}, "Skills it touches"),
        h("ul", {}, t.skills.map((k) => h("li", {}, k)))) : null,
      h("div", { class: "tc-foot" },
        jobs ? h("span", { class: "tc-jobs", title: `${jobs.mentions} of ${jobs.postings} live postings` }, icon("search"), `${jobs.mentions} job posts`) : h("span"),
        t.kind === "automation" ? h("span", { class: "tc-kind", title: "Automation topic: adds pressure to the roles it touches" }, icon("flag"), "automation") : null,
        links.length ? h("details", { class: "tc-src", open: lead || null }, h("summary", {}, icon("sources"), `${links.length} sources`),
          h("ul", {}, links.map((e) => h("li", {}, h("a", { href: e.url, target: "_blank", rel: "noopener noreferrer" }, e.title))))) : null)),
      DROP, { delay: Math.min(i, 12) * 30 });
  };
  const orderedTopics = [...topics].sort((a, z) => Math.abs(z.z) - Math.abs(a.z));
  const grid = h("div", { class: "topic-grid" }, (preview ? orderedTopics.slice(0, 5) : orderedTopics).map(card));
  if (preview) return h("div", { class: "board board-preview" }, meta, grid);
  // filter by type of topic, or by a skill / topic word
  let kind = "all";
  const q = h("input", { class: "input sm", type: "search", placeholder: "Filter by skill, e.g. programming, writing", "aria-label": "Filter topics by skill", oninput: filter });
  const empty = h("p", { class: "muted", hidden: true }, "No trends match your current filters.");
  function filter() {
    const term = q.value.trim().toLowerCase();
    let shown = 0;
    grid.querySelectorAll(".topic-card").forEach((el) => {
      const ok = (kind === "all" || el.dataset.kind === kind || (kind === "moving" && !el.querySelector(".trend.stable"))) && (!term || el.dataset.text.includes(term));
      el.hidden = !ok; shown += ok;
    });
    empty.hidden = shown > 0;
  }
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Show topics" },
    [["all", "All"], ["moving", "Rising or falling"], ["capability", "New skills"], ["automation", "Automation"]].map(([k, l]) =>
      h("button", { type: "button", "aria-pressed": String(k === kind), onclick: (e) => {
        kind = k; seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === e.currentTarget))); filter(); } }, l)));
  filter();
  // radar + what changed since the previous board, once the history has loaded
  const radarHost = h("div", { class: "radar-host" }, radar(b.topics, null));
  const changes = h("div", { class: "trend-changes" });
  api("/api/signals/history").then(({ days = [] }) => {
    const prev = days.filter((d) => d.day < b.day).at(-1);
    let selectedBoard = "today";
    const todayButton = h("button", { class: "k-now", type: "button", "aria-pressed": "true", onclick: () => selectBoard("today") }, "Today");
    const previousButton = prev ? h("button", { class: "k-prev", type: "button", "aria-pressed": "false", onclick: () => selectBoard("previous") }, `Previous board (${prev.day})`) : null;
    const selectBoard = (board) => {
      selectedBoard = board;
      todayButton.setAttribute("aria-pressed", String(board === "today"));
      previousButton?.setAttribute("aria-pressed", String(board === "previous"));
      radarHost.replaceChildren(radar(b.topics, prev, board), key);
    };
    const key = h("div", { class: "radar-key", role: "group", "aria-label": "Select trend board" },
      todayButton, previousButton, h("span", {}, "Further out = stronger trend; the middle ring is no change."));
    radarHost.replaceChildren(radar(b.topics, prev), key);
    if (prev) {
      const moved = b.topics.map((t) => ({ t, was: prev.direction?.[t.id] ?? (prev.z[t.id] >= 2 ? "rising" : prev.z[t.id] <= -2 ? "falling" : "stable"), dz: t.z - (prev.z[t.id] ?? 0) }));
      const flips = moved.filter((m) => m.was !== m.t.direction);
      const big = moved.filter((m) => m.was === m.t.direction && Math.abs(m.dz) >= 1).sort((a, z) => Math.abs(z.dz) - Math.abs(a.dz)).slice(0, 3);
      changes.replaceChildren(h("h3", {}, icon("history"), `Since ${prev.day}`),
        flips.length || big.length ? h("ul", {},
          flips.map((m) => h("li", {}, h("b", {}, m.t.label), ` is now ${m.t.direction} (was ${m.was})`)),
          big.map((m) => h("li", {}, h("b", {}, m.t.label), ` ${m.dz > 0 ? "strengthened" : "weakened"} by ${Math.abs(m.dz).toFixed(1)}`)))
          : h("p", { class: "muted" }, "No topic changed direction."));
    } else changes.replaceChildren(h("h3", {}, icon("history"), "Trend comparison"),
      h("p", { class: "muted" }, "No previous trend board is available yet."));
    if (days.length >= 3) grid.querySelectorAll(".topic-card").forEach((el) => {
      const vals = days.map((d) => d.z[el.dataset.topic]).filter((v) => v != null);
      if (vals.length >= 3) el.querySelector(".tc-charts").append(h("div", { class: "tc-chart-item tc-history", title: `Trend strength over the last ${vals.length} boards` },
        zLine(vals), h("span", { class: "tc-chart-caption" }, `${vals.length}-day strength`)));
    });
  }).catch(() => changes.replaceChildren(h("h3", {}, icon("history"), "Trend comparison"),
    h("p", { class: "muted" }, "Trend history could not be loaded. The current board is still available.")));
  // the roles: a bar against the strongest score, the topics driving it (with their pictures), and a note when a role
  // is pulled both ways (growth already nets off half the automation pressure, so both can be true)
  const growing = new Set(b.emerging_roles.map((r) => r.soc)), pressed = new Set(b.declining_roles.map((r) => r.soc));
  const roleList = (rows, key, cls) => {
    const top = Math.max(...rows.slice(0, 8).map((r) => r[key]), 1);
    const other = key === "score" ? pressed : growing;
    return h("ol", { class: "role-list" }, rows.slice(0, 8).map((r) => h("li", {},
      jobIcon(r.soc, { size: 40, labelled: true }),
      h("div", { class: "rl-t" },
        h("b", { title: `ESCO ${r.soc}` }, r.title,
          other.has(r.soc) ? h("span", { class: "rl-both", title: "This role shows up on both lists: AI adds work here and automates part of it." },
            key === "score" ? "Also under pressure" : "Also growing") : null),
        ((ids) => h("span", { class: "rl-drivers", title: `Driven by: ${ids.map(label).join(", ")}` },
          h("span", { class: "rl-faces", "aria-hidden": "true" }, ids.map((id) => h("img", { src: `img/topics/${id}-sm.jpg`, alt: "", loading: "lazy",
            decoding: "async", width: 24, height: 24, onerror: (e) => e.currentTarget.remove() }))),
          h("span", { class: "rl-names" }, ids.map(label).join(" · "))))(r.drivers.filter(label).slice(0, 2))),
      h("div", { class: `rl-meter ${cls}`, title: key === "score" ? "AI-driven growth score" : "Automation pressure score" },
        h("span", { class: "rl-bar" }, h("i", { style: { width: `${Math.round((r[key] / top) * 100)}%` } })),
        h("b", { class: "num" }, r[key].toFixed(1))))));
  };
  return h("div", { class: "board" }, meta,
    h("section", { class: "board-section", "aria-labelledby": "bt" },
      h("div", { class: "board-head" }, h("h2", { id: "bt" }, "AI topics today"),
        h("span", { class: "info", role: "img", title: "Weekly change = growth of Hacker News stories per week over 8 weeks. Trend direction uses the combined trend strength (z) across sources: rising at z ≥ 2, falling at z ≤ −2.",
          "aria-label": "How trends are measured" }, icon("info"))),
      h("div", { class: "radar-row" }, radarHost, changes),
      h("div", { class: "board-filters" }, seg, q), empty, grid),
    h("div", { class: "board-roles" },
      h("section", { class: "role-card rising" }, h("h3", {}, icon("up"), "Roles AI is pulling forward"),
        h("p", { class: "rl-why" }, "How strongly today’s rising AI topics overlap with each role’s skills."), roleList(b.emerging_roles, "score", "rising")),
      h("section", { class: "role-card falling" }, h("h3", {}, icon("down"), "Roles under automation pressure"),
        h("p", { class: "rl-why" }, "How strongly today’s automation topics overlap with each role’s tasks."), roleList(b.declining_roles, "pressure", "falling"))),
    h("details", { class: "hint board-method" }, h("summary", {}, icon("info"), "How this board is built"),
      h("p", {}, b.method, " It reorders role matches and adds dated sources to every plan.")));
}
