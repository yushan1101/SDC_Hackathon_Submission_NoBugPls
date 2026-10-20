// Report building blocks shared by the public report and the Enterprise review pane.
import { api, h, toast, fmtTime, ApiError, reveal, RISE, DROP, GROW } from "./lib.js";

const PHASES = ["1-30", "31-60", "61-90"];
const CITE = /\[([^\[\]]{3,120})\]/g;

/** Short readable label for an evidence id, e.g. "onet:29-1141.00:skill:Speaking" -> "O*NET · Speaking". */
export function citeLabel(id) {
  const p = id.split(":");
  if (p[0] === "onet") return p[2] === "skill" || p[2] === "tech" ? `O*NET · ${p.slice(3).join(":")}` : `O*NET · ${p[2] || p[1]}`;
  if (p[0] === "stfkan") return `STF-KAN · ${p.slice(2).join(":")}`;
  if (p[0] === "learn") return `learn · ${p.slice(1).join(":")}`;
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
          g.kind === "tool" ? h("span", { class: `tag ${g.hot ? "hot" : ""}`, title: "O*NET Hot/In-Demand technology" }, g.hot ? "hot tool" : "tool") : null,
          ARROW[g.outlook] ? h("span", { class: `trend ${g.outlook}`, title: ARROW[g.outlook][1] }, ARROW[g.outlook][0],
            h("span", { class: "sr-only" }, ARROW[g.outlook][1])) : null),
        h("td", { class: "n hide-sm" }, g.current_level), h("td", { class: "n hide-sm" }, g.required_level),
        h("td", {}, meter(g), h("span", { class: "sr-only" }, `level ${g.current_level} of ${g.required_level} needed`)),
        h("td", { class: "n" }, g.importance != null ? `${g.importance.toFixed(1)} / 5` : "—")), DROP, { delay: Math.min(i, 8) * 45 }))))),
    h("p", { class: "note" }, "Filled squares: your level. Vermilion: the gap to close. Needed levels and importance come from O*NET 31.0 ratings for this occupation; tools at level 2 are an assumption. ↑/↓: STF-KAN outlook."));
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
      col("Assistive AI", "assistive_required", "AI helps you do today's work: levels as rated by O*NET."),
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
         h("p", { class: "note" }, `Flagged when STF-KAN ranks a skill in the top ${rf.top_percent}% of forecast increases. On held-out O*NET releases these flags were `,
           h("b", {}, `${Number(rf.test_lift).toFixed(2)}×`), ` more likely than average to rise (base rate ${(rf.test_base_rate * 100).toFixed(1)}%). It raises their priority in your plan; it never changes the required level.`)]
      : h("p", {}, "No skill for this job is flagged as rising: its O*NET requirements look stable."),
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
