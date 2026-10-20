// Report building blocks shared by the public report and the Enterprise review pane.
import { api, h, toast, fmtTime, ApiError, reveal, RISE, DROP, GROW } from "./lib.js";

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

const ARROW = { rising: ["↑", "forecast rising"], falling: ["↓", "forecast falling"] };

export function gapsBlock(gaps) {
  const rows = gaps.filter((g) => g.required_level > 0).slice(0, 14);
  const meter = (g) => h("span", { class: "meter", "aria-hidden": "true" },
    Array.from({ length: 5 }, (_, i) => h("i", { class: i < g.current_level ? "have" : i < g.required_level ? "on" : "" })));
  return block("Skill gaps",
    h("h3", {}, "Skill gaps"),
    h("div", { class: "table-wrap" }, h("table", { class: "data" },
      h("thead", {}, h("tr", {}, h("th", {}, "Skill or tool"), h("th", { class: "n hide-sm" }, "You"), h("th", { class: "n hide-sm" }, "Needed"),
        h("th", {}, "Level"), h("th", { class: "n" }, "Importance"))),
      h("tbody", {}, rows.map((g, i) => reveal(h("tr", {},
        h("td", {}, g.skill_id, " ",
          g.kind === "tool" ? h("span", { class: `tag ${g.hot ? "hot" : ""}`, title: "Tool or system listed by ESCO" }, g.hot ? "hot tool" : "tool") : null,
          ARROW[g.outlook] ? h("span", { class: `trend ${g.outlook}`, title: ARROW[g.outlook][1] }, ARROW[g.outlook][0],
            h("span", { class: "sr-only" }, ARROW[g.outlook][1])) : null),
        h("td", { class: "n hide-sm" }, g.current_level), h("td", { class: "n hide-sm" }, g.required_level),
        h("td", {}, meter(g), h("span", { class: "sr-only" }, `level ${g.current_level} of ${g.required_level} needed`)),
        h("td", { class: "n" }, g.importance != null ? `${g.importance.toFixed(1)} / 5` : "—")), DROP, { delay: Math.min(i, 8) * 45 }))))),
    h("p", { class: "note" }, "Filled squares: your level. Vermilion: the gap to close. Skills are ESCO's essential and optional skills for this occupation; needed levels and importance are predictions from a model trained on O*NET ratings, not ESCO ratings. ↑/↓: STF-KAN outlook."));
}

export function comparisonBlock(cmp, scenario) {
  const changed = cmp.filter((c) => c.assistive_required !== c.agentic_required);
  const col = (name, key, note) => h("div", {},
    h("b", {}, name, scenario === key.split("_")[0] ? h("span", { class: "muted" }, " · current") : null),
    h("span", { class: "note" }, note),
    cmp.slice(0, 8).map((c) => h("div", { class: `row ${c.assistive_required !== c.agentic_required ? "changed" : ""}` },
      h("span", {}, c.skill_id), h("b", { class: "num" }, `level ${c[key]}`))));
  return block("Assistive versus agentic AI",
    h("h3", {}, "Assistive vs agentic AI"),
    h("div", { class: "cmp" },
      col("Assistive AI", "assistive_required", "AI helps you do today's work: predicted levels as they are."),
      col("Agentic AI", "agentic_required", "AI agents take over routine tool work.")),
    h("p", { class: "note" }, `${changed.length} skills change between scenarios. The agentic levels are a stated team assumption, not evidence.`));
}

export function outlookBlock(o) {
  if (!o) return null;
  const m = o.model;
  if (!m) return block("Skill outlook", h("h3", {}, "Skill outlook"), h("p", { class: "note" }, "No trained STF-KAN outlook asset is installed."));
  const rf = m.rising_flag || {};
  const rising = o.items.filter((x) => x.direction === "rising");
  return block("Skill outlook",
    h("h3", {}, "Skill outlook"),
    rising.length
      ? [h("p", {}, "Likely to grow in importance for this job: ",
          rising.map((x, i) => [i ? ", " : "", h("b", {}, x.skill_id), h("span", { class: "trend rising", "aria-hidden": "true" }, "↑")]), "."),
         h("p", { class: "note" }, `Flagged when STF-KAN ranks a skill in the top ${rf.top_percent}% of forecast increases. On held-out releases of its training data these flags were `,
           h("b", {}, `${Number(rf.test_lift).toFixed(2)}×`), ` more likely than average to rise (base rate ${(rf.test_base_rate * 100).toFixed(1)}%). It raises their priority in your plan; it never changes the required level.`)]
      : h("p", {}, "No skill for this job is flagged as rising: its requirements look stable."),
    h("p", { class: "note" }, `${m.name}, trained on the ${m.trained_on}. Falling-skill and tool flags are off: the model did not beat simple heuristics on validation.`));
}

export function issuesBlock(issues) {
  if (!issues.length) return null;
  return h("div", { class: "issues", role: "note" }, issues.map((i) => h("div", { class: `issue ${i.severity}` }, i.message)));
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
      h("h4", {}, `Days ${p}`, h("span", { class: "num muted" }, cap ? `${used.toFixed(1)} / ${cap} h` : `${used.toFixed(1)} h`)),
      h("div", { class: "budget", "aria-hidden": "true" }, h("div", { style: { transform: `scaleX(${cap ? Math.min(1, used / cap) : 1})`, "transform-origin": "left", height: "100%" } },
        reveal(h("i"), GROW, { duration: 700 }))),
      mine.length ? mine.map((a, i) => reveal(h("div", { class: "act" },
        h("div", { class: "top" }, h("b", {}, a.skill_id),
          h("label", {}, h("span", { class: "sr-only" }, `Hours for ${a.skill_id}, days ${p}`),
            h("input", { class: "input hrs", type: "number", min: "0.5", max: "200", step: "0.5", value: a.estimated_hours,
              disabled: status === "approved" ? true : null,
              oninput: (e) => { a.estimated_hours = Number(e.target.value); saveBtn.disabled = false; } }))),
        h("span", {}, a.activity),
        h("span", { class: "note" }, (a.sdg_links || []).join(" · "))), DROP, { delay: i * 60 })) : h("p", { class: "note" }, "No activities in this phase."));
  });
  const planEl = h("div", { class: "plan", "data-tab": "0" }, phases);
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
    tabs, planEl, errBox, bar);
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

export function sdgChip(g) {
  return h("a", { class: "sdg", href: `https://sdgs.un.org/goals/goal${g.goal}`, target: "_blank", rel: "noopener noreferrer",
    style: { "--sdg": g.color }, title: `UN Sustainable Development Goal ${g.goal}: ${g.short}` },
    h("b", {}, g.goal), g.short);
}

function momentum(m) {
  const out = [];
  if (m.emerging ?? m.emergence >= 1) out.push(h("span", { class: "trend rising", title: "Top 10% of roles for AI-driven growth on today's trend board" }, "↑ emerging"));
  if (m.stretch) out.push(h("span", { class: "tag", title: "Needs one more ISCO-08 skill level than you have" }, "stretch"));
  if (m.under_pressure ?? m.pressure >= 2) out.push(h("span", { class: "trend falling", title: "Top 10% of roles for automation pressure on today's trend board" }, "↓ automation pressure"));
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
        h("div", {}, h("b", {}, m.title), h("span", { class: "mono muted" }, ` ${m.soc}`), momentum(m)),
        h("span", { class: "note" }, m.top_gaps?.length ? `Closest gaps: ${m.top_gaps.join(", ")}` : "No skill gaps against ESCO requirements"),
        m.sdgs?.length ? h("span", { class: "sdgs" }, m.sdgs.map(sdgChip)) : null),
      h("div", { class: "fit" },
        h("span", { class: "num" }, pct(m.fit)), h("span", { class: "note" }, "match"),
        h("span", { class: "fitbar", "aria-hidden": "true" }, reveal(h("i", { style: { width: pct(Math.min(1, m.fit)) } }), GROW, { duration: 700, delay: i * 50 }))),
      onPlan ? h("button", { class: "btn sm", type: "button", onclick: () => onPlan(m) }, "Plan for this role") : null),
      DROP, { delay: Math.min(i, 8) * 45 }))),
    h("p", { class: "note" }, note || "Match = how much of each role's ESCO skill requirements you meet, weighted by predicted importance. " +
      "↑/↓ come from today's AI-trend board (news, research and job-posting signals); they reorder roles, never change the match."));
}

export function sdgBlock(sdgs) {
  if (!sdgs?.length) return null;
  return block("UN Sustainable Development Goals",
    h("h3", {}, "How this role serves the UN SDGs"),
    h("ul", { class: "sdg-list" }, sdgs.map((g) => h("li", {}, sdgChip(g),
      h("span", {}, h("b", {}, `Target ${g.target}`), " ", g.target_text)))),
    h("p", { class: "note" }, "Matched by meaning between the ESCO occupation description and the 169 official UN SDG targets " +
      "(MiniLM similarity). An evidence-linked suggestion, not an official UN classification. Every plan activity also serves SDG 4 (education) and SDG 8 (decent work)."));
}

/** Report section: what today's AI-trend board says about this occupation. */
export function signalsBlock(sig) {
  if (!sig) return block("AI-trend signals", h("h3", {}, "AI-trend signals"), h("p", { class: "note" }, "No daily trend board has been built yet."));
  const em = sig.emergence ?? 0, pr = sig.pressure ?? 0;
  const arrow = (d) => (d === "rising" ? "↑" : d === "falling" ? "↓" : "→");
  return block("AI-trend signals",
    h("h3", {}, `AI-trend signals · ${sig.day}`),
    h("p", {}, em >= 0.5 ? "Today's signals point toward growth for this role" : em <= -0.5 ? "Today's signals lean against this role" : "Today's signals are neutral for this role",
      pr >= 1 ? ", with automation pressure on its routine tasks." : "."),
    sig.topics?.length ? h("ul", { class: "topic-list" }, sig.topics.map((t) => h("li", {},
      h("b", {}, t.label), h("span", { class: `trend ${t.direction}` }, arrow(t.direction)),
      h("span", { class: "note" }, ` z ${t.z > 0 ? "+" : ""}${t.z} · ${t.confidence} confidence · skills ${t.skills.join(", ")}`)))) : null,
    h("p", { class: "note" }, `Emergence ${em.toFixed(2)}, pressure ${pr.toFixed(2)} (exposure-weighted topic momentum). Sources: ` +
      [sig.sources?.hn && "Hacker News", sig.sources?.arxiv && "arXiv", ...(sig.sources?.jobs || [])].filter(Boolean).join(", ") + ". Signals, not certainties."));
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
  const src = [b.sources.hn && "Hacker News (8 weekly counts)", b.sources.arxiv && "arXiv (14 vs 42 days)",
    b.sources.jobs?.length && `${b.sources.postings} live postings (${b.sources.jobs.join(", ")})`].filter(Boolean);
  const evid = new Map(b.evidence.map((e) => [e.id, e]));
  const label = (id) => b.topics.find((t) => t.id === id)?.label;
  const roleList = (rows, key, cls) => h("ol", { class: "role-list" }, rows.slice(0, 8).map((r) => h("li", {},
    h("b", {}, r.title), h("span", { class: `num trend ${cls}` }, (r[key] > 0 ? "+" : "") + r[key].toFixed(2)),
    h("span", { class: "note" }, r.drivers.map(label).filter(Boolean).join(" · ")))));
  const dir = (t) => (t.direction === "rising" ? "↑ rising" : t.direction === "falling" ? "↓ falling" : "→ stable");
  return h("div", { class: "board" },
    h("p", { class: "board-meta" }, h("b", {}, `Board for ${b.day}`), ` · built ${fmtTime(b.created_utc)} · `, src.join(" · "),
      onRefresh ? h("button", { class: "btn sm", onclick: onRefresh }, "Refresh now") : null),
    block("AI topics today", h("h3", {}, "AI topics today"),
      h("div", { class: "table-wrap" }, h("table", { class: "data topics" },
        h("thead", {}, h("tr", {}, h("th", {}, "Topic"), h("th", {}, "Signal"), h("th", { class: "n" }, "z"),
          h("th", { class: "hide-sm" }, "8 weeks"), h("th", { class: "n hide-sm" }, "Postings"), h("th", { class: "hide-sm" }, "Sources"))),
        h("tbody", {}, b.topics.map((t, i) => reveal(h("tr", {},
          h("td", {}, h("b", {}, t.label), t.kind === "automation" ? h("span", { class: "note" }, " · automation") : null),
          h("td", {}, h("span", { class: `trend ${t.direction}` }, dir(t)), h("span", { class: "note" }, ` ${t.confidence}`)),
          h("td", { class: "n num" }, (t.z > 0 ? "+" : "") + t.z.toFixed(1)),
          h("td", { class: "hide-sm" }, t.sources.hn ? spark(t.sources.hn.weekly) : "—"),
          h("td", { class: "n hide-sm num" }, t.sources.jobs ? `${t.sources.jobs.mentions}` : "—"),
          h("td", { class: "hide-sm" }, t.evidence_ids.filter((id) => evid.has(id)).map((id) => h("a", { class: "cite", href: evid.get(id).url,
            target: "_blank", rel: "noopener noreferrer", title: evid.get(id).excerpt }, h("b", {}, id.split(":").pop()))))),
        DROP, { delay: Math.min(i, 10) * 30 }))))),
      h("p", { class: "note" }, "z: trend strength (log-linear weekly growth over its standard error, averaged across sources). Rising at z ≥ 2, falling at z ≤ −2. Hover a source for its counts.")),
    h("div", { class: "board-roles" },
      block("Emerging roles", h("h3", {}, "Roles AI is pulling forward"), roleList(b.emerging_roles, "score", "rising")),
      block("Roles under pressure", h("h3", {}, "Roles with automation pressure"), roleList(b.declining_roles, "pressure", "falling"))),
    h("p", { class: "note" }, b.method, " The AI agents read this board through the trend_signals MCP tool; it reorders role matches and adds dated evidence to every report."));
}
