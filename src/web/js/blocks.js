// Report building blocks shared by the public report and the Enterprise review pane.
import { api, h, icon, toast, fmtTime, ApiError, reveal, RISE, DROP, GROW } from "./lib.js";
import { jobIcon } from "./jobicons.js";

const PHASES = ["1-30", "31-60", "61-90"];
const CITE = /\[([^\[\]]{3,120})\]/g;

/** Short readable label for an evidence id, e.g. "esco:2221.1:skill:Listen actively" -> "ESCO · Listen actively". */
export function citeLabel(id) {
  const p = id.split(":");
  if (p[0] === "esco") return p[2] === "skill" || p[2] === "tool" ? `ESCO · ${p.slice(3).join(":")}` : `ESCO · ${p[2] || p[1]}`;
  if (p[0] === "stfkan") return `STF-KAN · ${p.slice(2).join(":")}`;
  if (p[0] === "learn") return `learn · ${p.slice(1).join(":")}`;
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
      note: "Bars: dark = your level, blue = level this job needs (0-5). Arrows: STF-KAN outlook. Skills are this job's ESCO skills; needed levels are predicted by a model trained on O*NET ratings, not ESCO ratings. Hover a skill for its importance." },
    h("ol", { class: "gap-list" }, top.map(row)),
    rest.length ? h("details", { class: "more" }, h("summary", {}, `Show ${rest.length} more`), h("ol", { class: "gap-list" }, rest.map(row))) : null);
}

export function comparisonBlock(cmp, scenario) {
  const changed = cmp.filter((c) => c.assistive_required !== c.agentic_required);
  const shown = (changed.length ? changed : cmp).slice(0, 5);
  const side = (name, key, note) => {
    const current = scenario === key.split("_")[0];
    return h("div", { class: `cmp-side ${current ? "current" : ""}` },
      h("span", { class: "cmp-tag" }, icon(current ? "check" : "flat"), current ? "Your scenario" : "Compare"),
      h("b", { class: "cmp-name" }, name), h("p", {}, note),
      h("ul", {}, shown.map((c) => h("li", {}, h("span", {}, c.skill_id), h("b", { class: "num" }, `level ${c[key]}`)))));
  };
  return card("Assistive versus agentic AI", "spark", "Assistive vs agentic AI",
    { figure: changed.length, unit: changed.length === 1 ? "skill changes" : "skills change",
      note: "The agentic levels are a stated team assumption, not evidence. Assistive = predicted levels as they are." },
    h("div", { class: "cmp-sides" },
      side("Assistive AI", "assistive_required", "AI helps you do today's work."),
      side("Agentic AI", "agentic_required", "AI agents take over routine tool work.")));
}

export function outlookBlock(o) {
  if (!o) return null;
  const m = o.model;
  if (!m) return card("Skill outlook", "up", "Rising skills", {}, h("p", { class: "bc-line" }, "No outlook model installed."));
  const rf = m.rising_flag || {};
  const rising = o.items.filter((x) => x.direction === "rising");
  return card("Skill outlook", "up", "Rising skills",
    { figure: rising.length || "None", unit: rising.length ? "likely to grow" : "flagged; requirements look stable",
      note: `Flagged when STF-KAN ranks a skill in the top ${rf.top_percent}% of forecast increases; on held-out releases these flags were ${Number(rf.test_lift).toFixed(2)}x more likely than average to rise (base rate ${(rf.test_base_rate * 100).toFixed(1)}%). Raises priority in your plan, never the required level. ${m.name}, trained on the ${m.trained_on}. ${forecastMode(o.forecast)}Falling-skill and tool flags are off.` },
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

/** Editable 30/60/90 plan with approval. Talks to /api/plans/:id. Calls onChange(status) after saves. */
export function planBlock({ planId, plan, version, status, weeklyHours, onChange, approverLabel = "I have reviewed this plan and approve it", title = "Your 90-day plan" }) {
  const cap = weeklyHours ? Math.round((weeklyHours * 30) / 7 * 10) / 10 : null;
  const acts = plan.activities.map((a) => ({ ...a }));
  const tagEl = h("span", { class: `tag ${status}` }, status);
  const verEl = h("span", { class: "num muted" }, `v${version}`);
  const phases = PHASES.map((p) => {
    const mine = acts.filter((a) => a.day_range === p);
    const used = mine.reduce((s, a) => s + a.estimated_hours, 0);
    return h("div", { class: "phase" },
      h("h4", {}, `Days ${p}`, h("span", { class: "hours" }, icon("clock"), cap ? `${Math.round(used)} of ${Math.round(cap)} h` : `${Math.round(used)} h`)),
      h("div", { class: "budget", "aria-hidden": "true" }, h("div", { style: { transform: `scaleX(${cap ? Math.min(1, used / cap) : 1})`, "transform-origin": "left", height: "100%" } },
        reveal(h("i"), GROW, { duration: 700 }))),
      mine.length ? mine.map((a, i) => reveal(h("div", { class: "act" },
        h("div", { class: "top" }, h("b", {}, a.skill_id),
          h("label", {}, h("span", { class: "sr-only" }, `Hours for ${a.skill_id}, days ${p}`),
            h("input", { class: "input hrs", type: "number", min: "0.5", max: "200", step: "0.5", value: a.estimated_hours,
              disabled: status === "approved" ? true : null,
              oninput: (e) => { a.estimated_hours = Number(e.target.value); saveBtn.disabled = false; } }))),
        h("span", {}, a.activity),
        (a.sdg_links || []).length ? h("span", { class: "sdg-nums" }, a.sdg_links.map((s) => { const n = String(s).replace(/\D/g, "");
          return h("span", { class: "sdg-n", style: { "--sdg": SDG_COLORS[n] || "#888" }, title: `UN SDG ${n}`, "aria-label": `UN SDG ${n}` }, n); })) : null), DROP, { delay: i * 60 })) : h("p", { class: "note" }, "No activities in this phase."));
  });
  const planEl = h("div", { class: "plan", "data-tab": "0" }, phases);
  const sdgGuide = h("p", { class: "note sdg-guide" },
    "Goal tags on each activity show its connection: SDG 4 for learning, SDG 8 for decent work, and (when mapped) one additional goal matched to that skill. These are evidence-linked suggestions, not official UN classifications.");
  const tabs = h("div", { class: "seg phase-tabs", role: "group", "aria-label": "Plan phase" },
    PHASES.map((p, i) => h("button", { type: "button", "aria-pressed": String(i === 0),
      onclick: (e) => { planEl.dataset.tab = String(i); tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); } }, p)));
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
  return block("30, 60, 90 day plan",
    h("h3", {}, title),
    plan.deferred_skills?.length ? h("details", { class: "note deferred" },
      h("summary", {}, `${plan.deferred_skills.length} more skills don't fit in ${weeklyHours ? weeklyHours + " h/week" : "the weekly hours"}; the plan covers the highest-priority gaps first.`),
      h("p", {}, plan.deferred_skills.join(", "))) : null,
    tabs, sdgGuide, planEl, errBox, bar);
}

export function historyBlock(hist) {
  return h("ol", { class: "history" }, hist.map((e) => h("li", {},
    h("time", { datetime: e.at_utc }, fmtTime(e.at_utc)),
    h("span", {}, `${e.action} by ${e.actor}`, e.actor_role !== "system" ? h("span", { class: "muted" }, ` (${e.actor_role.replace("_", " ")})`) : null,
      " → ", h("b", {}, e.new_status), h("span", { class: "muted num" }, ` v${e.version}`)))));
}

export function sourceItem(e) {
  return h("a", { class: "src", id: `src-${e.id}`, href: e.url, target: "_blank", rel: "noopener noreferrer" },
    h("span", { class: "id" }, citeLabel(e.id)),
    h("span", { class: "t" }, e.title),
    h("span", { class: "m" }, [e.publisher, e.publication_date && `published ${e.publication_date}`, e.access_date && `accessed ${e.access_date}`].filter(Boolean).join(" · ")));
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
      ? (rep.risk?.hold ? "Held from AI recommendation until you review it. Hidden content was removed before screening; the agents only saw visible text." :
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

/** Ranked future roles. onPlan(match) builds a full plan for one of them. */
export function matchesBlock(matches, { onPlan, title = "Roles you could grow into", note } = {}) {
  if (!matches?.length) return block("Role matches", h("h3", {}, title), h("p", { class: "note" }, "No matches yet. Add a few more skills."));
  return block("Role matches",
    h("h3", {}, title),
    h("ol", { class: "matches" }, matches.map((m, i) => reveal(h("li", {},
      h("span", { class: "rank num" }, i + 1),
      h("div", { class: "who" },
        h("div", { class: "job-line", title: `ESCO ${m.soc}` }, jobIcon(m.soc, { size: 44, labelled: true }), h("b", {}, m.title), momentum(m)),
        h("span", { class: "gaps" }, m.top_gaps?.length ? [icon("target"), `To learn: ${m.top_gaps.slice(0, 2).join(", ")}`,
          m.top_gaps.length > 2 ? h("span", { class: "more", title: m.top_gaps.slice(2).join(", ") }, ` +${m.top_gaps.length - 2}`) : null] : [icon("check"), "No skill gaps"]),
        m.sdgs?.length ? [
          h("span", { class: "sdg-nums" }, m.sdgs.map((g) => sdgChip(g, { compact: true }))),
          h("details", { class: "sdg-match-detail" }, h("summary", {}, "How this role connects to the goals"),
            h("ul", {}, m.sdgs.map((g) => h("li", {},
              h("b", {}, `SDG ${g.goal} · ${g.short}`),
              h("span", {}, g.target && g.target_text
                ? `ESCO role description matched to UN target ${g.target}: ${g.target_text}`
                : `ESCO role description semantically matched to ${g.short}.`)))))
        ] : null),
      h("div", { class: "fit" },
        h("span", { class: "num" }, pct(m.fit)), h("span", { class: "note" }, "match"),
        h("span", { class: "fitbar", "aria-hidden": "true" }, reveal(h("i", { style: { width: pct(Math.min(1, m.fit)) } }), GROW, { duration: 700, delay: i * 50 }))),
      onPlan ? h("button", { class: "btn sm", type: "button", onclick: () => onPlan(m) }, "Plan for this role") : null),
      DROP, { delay: Math.min(i, 8) * 45 }))),
    h("p", { class: "note" }, note || "Match = the share of each role's ESCO skills you already have. Trend arrows come from today's AI-trend board; they reorder roles, never change the match."));
}

export function sdgBlock(sdgs) {
  if (!sdgs?.length) return null;
  return card("UN Sustainable Development Goals", "target", "UN goals served",
    { figure: sdgs.length, unit: sdgs.length === 1 ? "goal" : "goals",
      note: "Matched by meaning between the ESCO occupation description and the 169 official UN SDG targets (MiniLM similarity). An evidence-linked suggestion, not an official UN classification. Every plan activity also serves SDG 4 and SDG 8." },
    h("div", { class: "sdg-nums" }, sdgs.map((g) => h("a", { class: "sdg-n big", href: `https://sdgs.un.org/goals/goal${g.goal}`, target: "_blank", rel: "noopener noreferrer",
      style: { "--sdg": g.color }, title: `SDG ${g.goal}: ${g.short}. Target ${g.target}: ${g.target_text}`, "aria-label": `UN SDG ${g.goal}: ${g.short}` }, String(g.goal)))),
    h("p", { class: "bc-line" }, "How this career connects to the goals"),
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
export function boardView(b, { onRefresh } = {}) {
  if (!b?.available) return h("div", { class: "empty" }, h("h2", {}, "No trend board yet"),
    h("p", { class: "muted" }, b?.message || "The board is built once a day from public news, research and job-posting signals."),
    onRefresh ? h("button", { class: "btn primary", onclick: onRefresh }, "Build today's board") : null);
  const evid = new Map(b.evidence.map((e) => [e.id, e]));
  const label = (id) => b.topics.find((t) => t.id === id)?.label;
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
    return reveal(h("article", { class: "topic-card" },
      h("div", { class: "tc-top" }, h("h4", {}, t.label),
        h("span", { class: `trend ${t.direction}`, title: `Trend strength z = ${t.z.toFixed(1)} (rising at z ≥ 2, falling at z ≤ −2); confidence ${t.confidence}` }, dir(t))),
      h("div", { class: "tc-figure" },
        growth ? h("div", { title: "Weekly growth of Hacker News stories on this topic over 8 weeks" }, h("b", {}, growth), h("span", {}, "per week on HN")) : h("div", {}, h("b", {}, t.z > 0 ? `+${t.z.toFixed(1)}` : t.z.toFixed(1)), h("span", {}, "trend strength")),
        hn ? spark(hn.weekly) : null),
      h("div", { class: "tc-foot" },
        jobs ? h("span", { class: "tc-jobs", title: `${jobs.mentions} of ${jobs.postings} live postings` }, icon("search"), `${jobs.mentions} job posts`) : h("span"),
        t.kind === "automation" ? h("span", { class: "tc-kind", title: "Automation topic: adds pressure to the roles it touches" }, icon("flag"), "automation") : null,
        links.length ? h("details", { class: "tc-src" }, h("summary", {}, icon("sources"), `${links.length} sources`),
          h("ul", {}, links.map((e) => h("li", {}, h("a", { href: e.url, target: "_blank", rel: "noopener noreferrer" }, e.title))))) : null)),
      DROP, { delay: Math.min(i, 12) * 30 });
  };
  const topics = [...b.topics].sort((a, z) => Math.abs(z.z) - Math.abs(a.z));
  const roleList = (rows, key, cls) => h("ol", { class: "role-list" }, rows.slice(0, 8).map((r) => h("li", {},
    jobIcon(r.soc, { size: 40, labelled: true }),
    h("span", { class: "rl-t" }, h("b", { title: `ESCO ${r.soc}` }, r.title), h("span", {}, r.drivers.map(label).filter(Boolean).slice(0, 2).join(" · "))),
    h("span", { class: `rl-score trend ${cls}`, title: key === "score" ? "AI-driven growth score" : "Automation pressure score" }, icon(cls === "rising" ? "up" : "down"), r[key].toFixed(1)))));
  return h("div", { class: "board" }, meta,
    h("section", { class: "board-section", "aria-labelledby": "bt" },
      h("div", { class: "board-head" }, h("h2", { id: "bt" }, "AI topics today"),
        h("span", { class: "info", role: "img", title: "Weekly change = growth of Hacker News stories per week over 8 weeks. Trend direction uses the combined trend strength (z) across sources: rising at z ≥ 2, falling at z ≤ −2.",
          "aria-label": "How trends are measured" }, icon("info"))),
      h("div", { class: "topic-grid" }, topics.map(card))),
    h("div", { class: "board-roles" },
      h("section", { class: "role-card" }, h("h3", {}, icon("up"), "Roles AI is pulling forward"), roleList(b.emerging_roles, "score", "rising")),
      h("section", { class: "role-card" }, h("h3", {}, icon("down"), "Roles under automation pressure"), roleList(b.declining_roles, "pressure", "falling"))),
    h("details", { class: "hint board-method" }, h("summary", {}, icon("info"), "How this board is built"),
      h("p", {}, b.method, " The AI agents read it through the trend_signals MCP tool; it reorders role matches and adds dated evidence to every report.")));
}
