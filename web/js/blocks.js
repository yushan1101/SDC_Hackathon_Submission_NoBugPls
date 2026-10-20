// Report building blocks shared by the public report and the Enterprise review pane.
import { api, h, toast, fmtTime, ApiError, reveal, RISE, DROP, GROW } from "./lib.js";

const PHASES = ["1-30", "31-60", "61-90"];
const CITE = /\[([^\[\]]{3,120})\]/g;

/** Short readable label for an evidence id, e.g. "data_jobs:Data Analyst:sql" -> "data_jobs · sql". */
export function citeLabel(id) {
  const p = id.split(":");
  if (p[0] === "onet") return `O*NET · ${p[3] && p[2] === "sw" ? p[3] : p[1]}`;
  if (p[0] === "learn") return `learn · ${p[1]}`;
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

export function gapsBlock(gaps) {
  const rows = gaps.filter((g) => g.required_level > 0).slice(0, 12);
  const meter = (g) => h("span", { class: "meter", "aria-hidden": "true" },
    Array.from({ length: 5 }, (_, i) => h("i", { class: i < g.current_level ? "have" : i < g.required_level ? "on" : "" })));
  return block("Skill gaps",
    h("h3", {}, "Skill gaps"),
    h("div", { class: "table-wrap" }, h("table", { class: "data" },
      h("thead", {}, h("tr", {}, h("th", {}, "Skill"), h("th", { class: "n hide-sm" }, "You"), h("th", { class: "n hide-sm" }, "Needed"),
        h("th", {}, "Level"), h("th", { class: "n" }, "In ads"))),
      h("tbody", {}, rows.map((g, i) => reveal(h("tr", {},
        h("td", {}, g.skill_id, " ", g.onet_hot ? h("span", { class: "tag hot", title: "O*NET 31.0 Hot Technology" }, "hot") : null),
        h("td", { class: "n hide-sm" }, g.current_level), h("td", { class: "n hide-sm" }, g.required_level),
        h("td", {}, meter(g), h("span", { class: "sr-only" }, `level ${g.current_level} of ${g.required_level} needed`)),
        h("td", { class: "n" }, `${g.mention_percent.toFixed(1)}%`)), DROP, { delay: Math.min(i, 8) * 45 }))))),
    h("p", { class: "note" }, "Filled squares: your level. Vermilion: the gap to close. Needed levels come from how often each skill appears in 2023 job ads."));
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
      col("Assistive AI", "assistive_required", "AI helps you do today's work: levels as seen in 2023 ads."),
      col("Agentic AI", "agentic_required", "AI agents take over routine tool work.")),
    h("p", { class: "note" }, `${changed.length} skills change between scenarios. The agentic levels are a stated team assumption, not evidence.`));
}

export function forecastBlock(f) {
  if (!f || !f.predicted_percent) {
    return f ? h("section", { class: "block" }, h("h3", {}, "Demand forecast"), (f.warnings || []).map((w) => h("p", { class: "note" }, w))) : null;
  }
  const hist = f.history.map((v) => (v == null ? null : v));
  const all = [...hist, ...f.actual, ...f.predicted_percent, ...(f.lower_percent || []), ...(f.upper_percent || [])].filter((v) => v != null);
  const lo = Math.floor(Math.min(...all) - 1), hi = Math.ceil(Math.max(...all) + 1);
  const W = 640, H = 220, L = 40, R = 12, T = 12, B = 28, n = hist.length + 4;
  const x = (i) => L + (i * (W - L - R)) / (n - 1), y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const line = (pts) => pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const obs = hist.map((v, i) => [i, v]).filter(([, v]) => v != null);
  const last = obs[obs.length - 1];
  const fc = [last, ...f.predicted_percent.map((v, k) => [hist.length + k, v])];
  const act = [last, ...f.actual.map((v, k) => [hist.length + k, v]).filter(([, v]) => v != null)];
  const ns = "http://www.w3.org/2000/svg";
  const s = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img",
    "aria-label": `${f.skill_id}: last observed ${last[1].toFixed(1)}%, forecast ${f.predicted_percent.join(", ")}% over 4 weeks` });
  const grid = s("g", { class: "grid" });
  for (let k = 0; k <= 3; k++) {
    const v = lo + ((hi - lo) * k) / 3;
    grid.append(s("line", { x1: L, x2: W - R, y1: y(v), y2: y(v) }));
    const t = s("text", { x: 0, y: y(v) + 4 }); t.textContent = `${v.toFixed(0)}%`; grid.append(t);
  }
  svg.append(grid);
  if (f.lower_percent) {
    const up = f.upper_percent.map((v, k) => [hist.length + k, v]), dn = f.lower_percent.map((v, k) => [hist.length + k, v]).reverse();
    svg.append(s("path", { class: "band", d: `${line([last, ...up])} ${dn.map(([i, v]) => `L${x(i)},${y(v)}`).join(" ")} Z` }));
  }
  svg.append(s("line", { class: "cut", x1: x(last[0]), x2: x(last[0]), y1: T, y2: H - B }));
  const o = s("path", { class: "obs", d: line(obs) });
  svg.append(o, s("path", { class: "act", d: line(act) }), s("path", { class: "fc", d: line(fc) }));
  [[0, f.history_weeks[0]], [last[0], f.as_of_date], [n - 1, f.target_weeks[3]]].forEach(([i, wk]) => {
    const t = s("text", { x: x(i), y: H - 8, "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle" }); t.textContent = wk; svg.append(t);
  });
  requestAnimationFrame(() => {
    const len = o.getTotalLength?.() || 1000;
    reveal(o, [{ strokeDasharray: len, strokeDashoffset: len }, { strokeDasharray: len, strokeDashoffset: 0 }], { duration: 900 });
    svg.querySelectorAll(".band").forEach((e) => reveal(e, [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { duration: 600, delay: 700 }));
    svg.querySelectorAll(".fc, .act").forEach((e, k) => reveal(e, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 850 + k * 200 }));
  });
  return block("Demand forecast",
    h("h3", {}, `${f.skill_id} in ${f.role_id} ads: historical 2023 backtest`),
    h("div", { class: "legend" }, h("span", {}, h("i"), "12 weeks observed"), h("span", {}, h("i", { class: "fc" }), "4-week forecast"),
      f.lower_percent ? h("span", {}, h("i", { class: "band" }), "80% band (validation error)") : null, h("span", {}, "dotted: what actually happened")),
    svg,
    h("p", { class: "note" }, `${f.model_id} · direction ${f.direction} · as of ${f.as_of_date}. Not a 2026 prediction.`));
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
    plan.deferred_skills?.length ? h("p", { class: "note" }, `Not fully covered by your weekly hours: ${plan.deferred_skills.join(", ")}.`) : null,
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
