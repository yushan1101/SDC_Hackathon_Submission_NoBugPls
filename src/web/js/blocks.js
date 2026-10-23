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
  if (activity.day_range === "61-90") return [
    `Weeks 9-10: Build a portfolio piece that demonstrates ${skill}, with a short write-up and relevant files or screenshots.`,
    "Week 11: Ask your manager or a peer to review the work and give specific feedback.",
    "Week 12: Apply the feedback and write down how you will keep using this skill after the 90 days.",
  ];
  if (activity.day_range === "31-60") return [
    `Week 5: Choose a practical task where you can use ${skill} and agree on it with your manager.`,
    `Weeks 6-7: Complete the task and note the results, challenges, and what you would improve.`,
    "Week 8: Share the result with a colleague and ask for one concrete suggestion.",
  ];
  return [
    `Weeks 1-2: Study a guide or tutorial for ${skill} and note three ideas you can use at work.`,
    `Weeks 3-4: Complete practice exercises and apply ${skill} to one small, suitable work task.`,
    "End of month: Review what you learned with your manager and agree on a practical next step.",
  ];
}

function planActivityOutcome(activity) {
  if (activity.outcome) return activity.outcome;
  const skill = activity.skill_id || "the skill";
  if (activity.day_range === "61-90") return `A reviewed portfolio piece demonstrating ${skill}.`;
  if (activity.day_range === "31-60") return `A completed work task using ${skill}, with a short note about the result.`;
  return `A completed set of practice exercises and an explanation of the basics of ${skill}.`;
}

/** Editable 30/60/90 plan with approval. Talks to /api/plans/:id. Calls onChange(status) after saves. */
export function planBlock({ planId, planReference, plan, version, status, weeklyHours, onChange, approverLabel = "I have reviewed this plan and approve it", title = "Your 90-day plan",
  progress = [], evidence = null, readOnly = false }) {
  // readOnly: HR looking at a plan an employee made for themself: no hours, ticks, saving or approval
  // progress: activities ticked off as done ("<days>:<skill>", saved on the server); evidence: id -> {title, url} for course links
  const done = new Set(progress);
  const key = (a) => `${a.day_range}:${a.skill_id}`;
  const ev = evidence instanceof Map ? evidence : new Map((evidence || []).map((e) => [e.id, e]));
  const courses = (a) => (a.evidence_ids || []).map((id) => ev.get(id)).filter((e) => e?.url && e.id.startsWith("learn:")).slice(0, 2);
  const cap = weeklyHours ? Math.round((weeklyHours * 30) / 7 * 10) / 10 : null;
  const acts = plan.activities.map((a) => ({ ...a }));
  const tagEl = h("span", { class: `tag ${status}` }, status);
  const verEl = h("span", { class: "num muted" }, `v${version}`);
  const phaseNames = ["Foundation", "Practical application", "Portfolio & review"];
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
      const tick = planId && !readOnly ? h("label", { class: "act-done", title: "Mark this activity as done" },
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
    const activityList = mine.length ? h("div", { class: "phase-activities" }, activityCards)
      : h("p", { class: "note" }, "No activities in this phase.");
    const phaseSummary = h("summary", { class: "phase-toggle" },
      h("span", { class: "phase-step", "aria-hidden": "true" }, phaseIndex + 1),
      h("div", { class: "phase-intro" }, heading, h("p", { class: "phase-summary" }, summary)),
      icon("chevron"));
    const content = h("div", { class: "phase-content" }, budget, activityList);
    return h("details", { class: "phase", "data-phase": p }, phaseSummary, content);
  });
  const progressEl = h("div", { class: "plan-progress" });
  function drawProgress() {
    const total = acts.length, n = acts.filter((a) => done.has(key(a))).length;
    const hrs = (xs) => Math.round(xs.reduce((s, a) => s + a.estimated_hours, 0) * 10) / 10;
    const ms = PHASES.map((p, i) => { const xs = acts.filter((a) => a.day_range === p); return [p, ["Foundation", "Practice", "Portfolio"][i], xs.length && xs.every((a) => done.has(key(a)))]; });
    progressEl.replaceChildren(
      h("div", { class: "pp-head" }, h("b", {}, `${n} of ${total} activities done`), h("span", { class: "muted" }, `${hrs(acts.filter((a) => done.has(key(a))))} of ${hrs(acts)} hours`)),
      h("div", { class: "pp-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(n), "aria-label": "Plan progress" },
        h("i", { style: { width: `${total ? (100 * n) / total : 0}%` } })),
      h("ol", { class: "milestones", "aria-label": "Milestones" }, ms.map(([p, name, ok]) =>
        h("li", { class: ok ? "ok" : null }, icon(ok ? "check" : "target"), h("span", {}, `Day ${p.split("-")[1]}: ${name}`), ok ? h("span", { class: "sr-only" }, " reached") : null))));
  }
  async function mark(a, value, box) {
    value ? done.add(key(a)) : done.delete(key(a));
    box.closest(".act")?.classList.toggle("is-done", value);
    drawProgress();
    try { await api(`/api/plans/${planId}/progress`, { method: "POST", body: { item: key(a), done: value } }); }
    catch (e) { value ? done.delete(key(a)) : done.add(key(a)); box.checked = !value; box.closest(".act")?.classList.toggle("is-done", !value); drawProgress(); toast(e.message, "err"); }
  }
  if (planId) drawProgress();
  const planEl = h("div", { class: "plan" }, planId ? progressEl : null, phases,
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
  return reveal(h("section", { class: "block plan-block", "aria-label": "30, 60, 90 day plan" },
    h("h3", {}, title),
    planId ? h("p", { class: "muted mono" }, `Plan ID: ${planReference || planId}`) : null,
    plan.deferred_skills?.length ? h("details", { class: "note deferred" },
      h("summary", {}, `${plan.deferred_skills.length} more skills don't fit in ${weeklyHours ? weeklyHours + " h/week" : "the weekly hours"}; the plan covers the highest-priority gaps first.`),
      h("p", {}, plan.deferred_skills.join(", "))) : null,
    sdgGuide, planEl, errBox, readOnly ? null : bar), RISE, { duration: 420 });
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

export function matchesBlock(matches, { onPlan, onInterview, title = "Roles you could grow into", note, scenario, onScenario } = {}) {
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
            h("span", { class: "match-badges" }, momentum(m), h("span", { class: `tag effort ${effort(m)[1]}`, title: "Effort to switch, from the share of this role you already cover" }, effort(m)[0])))),
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
  api("/api/signals/history").then(({ days }) => {
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
    }
    if (days.length >= 3) grid.querySelectorAll(".topic-card").forEach((el) => {
      const vals = days.map((d) => d.z[el.dataset.topic]).filter((v) => v != null);
      if (vals.length >= 3) el.querySelector(".tc-charts").append(h("div", { class: "tc-chart-item tc-history", title: `Trend strength over the last ${vals.length} boards` },
        zLine(vals), h("span", { class: "tc-chart-caption" }, `${vals.length}-day strength`)));
    });
  }).catch(() => { /* history is optional: the board stands on its own */ });
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
