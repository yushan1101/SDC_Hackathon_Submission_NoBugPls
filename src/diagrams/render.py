"""Reports with the plan's diagrams: Markdown (```mermaid blocks, tables for the charts) and one self-contained HTML file."""
import html
import json

from diagrams import Diagram, ReskillPlan

MERMAID = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs"
CHARTJS = "https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"


def _chart_table(d: Diagram) -> str:
    cfg = json.loads(d.code)
    sets = cfg["data"]["datasets"]
    head = "| | " + " | ".join(s["label"] for s in sets) + " |"
    rows = [f"| {lab.replace('|', '/')} | " + " | ".join(f"{s['data'][i]:g}" for s in sets) + " |" for i, lab in enumerate(cfg["data"]["labels"])]
    if d.key == "effort":
        rows = [r + (" ⚠ over capacity" if over else "") for r, over in zip(rows, cfg["data"]["over"])]
    return "\n".join([head, "|" + "---|" * (len(sets) + 1), *rows])


def _summary(plan: ReskillPlan) -> str:
    return f"{len(plan.skills)} skills in the plan · {plan.learner.hours_per_week:g} hours a week · 90 days"


def _deferred(plan: ReskillPlan) -> str:
    return (f"{len(plan.deferred)} more skill gaps are deferred until after these 90 days: "
            f"{', '.join(plan.deferred[:5])}{' …' if len(plan.deferred) > 5 else ''}") if plan.deferred else ""


def markdown(plan: ReskillPlan, diagrams: list[Diagram], notes: list[str] = ()) -> str:
    out = [f"# Reskilling plan: {plan.learner.target_role}", "", _summary(plan), ""]
    notes = [*notes, _deferred(plan)]
    out += [f"> {n}" for n in notes if n] + ([""] if any(notes) else [])
    for d in diagrams:
        out += [f"## {d.title}", ""]
        if d.note:
            out += [f"> {d.note}", ""]
        if d.lang == "mermaid" and d.code:
            out += ["```mermaid", d.code, "```", ""]
        elif d.lang == "chartjs":
            out += [_chart_table(d), ""]
    out += ["## Skills and resources", ""]
    res = {}
    for r in plan.resources:
        res.setdefault(r.skill_id, []).append(r)
    for s in plan.skills:
        out.append(f"- **{s.name}** ({s.category}, {s.priority} priority): level {s.level_now} → {s.level_target}")
        for r in res.get(s.id, []):
            title = f"[{r.title}]({r.url})" if r.url else r.title
            out.append(f"  - {r.type}: {title}" + (f" · {r.est_hours:g} h" if r.est_hours else ""))
    return "\n".join(out) + "\n"


def page(plan: ReskillPlan, diagrams: list[Diagram], notes: list[str] = ()) -> str:
    data = json.dumps({"plan": plan.model_dump(mode="json"), "diagrams": [d.__dict__ for d in diagrams]}).replace("</", "<\\/")
    notes = [*notes, _deferred(plan)]
    tabs = "".join(f'<button role="tab" aria-selected="{str(i == 0).lower()}" data-tab="{d.key}">{html.escape(d.title)}</button>'
                   for i, d in enumerate(diagrams))
    panels = "".join(
        f'<section role="tabpanel" id="tab-{d.key}"{"" if i == 0 else " hidden"}>'
        f'<div class="bar"><h2>{html.escape(d.title)}</h2><span class="dl">'
        + ('<button data-svg>SVG</button>' if d.lang == "mermaid" else "") + '<button data-png>PNG</button></span></div>'
        + (f'<p class="note">{html.escape(d.note)}</p>' if d.note else "")
        + ('<div class="canvas-wrap"><canvas></canvas></div>' if d.lang == "chartjs" else '<div class="mm"></div>' if d.code else "")
        + "</section>" for i, d in enumerate(diagrams))
    banner = "".join(f'<p class="note">{html.escape(n)}</p>' for n in notes if n)
    title = html.escape(plan.learner.target_role)
    return TEMPLATE.replace("{{TITLE}}", title).replace("{{SUB}}", html.escape(_summary(plan))).replace("{{BANNER}}", banner) \
        .replace("{{TABS}}", tabs).replace("{{PANELS}}", panels).replace("{{DATA}}", data) \
        .replace("{{MERMAID}}", MERMAID).replace("{{CHARTJS}}", CHARTJS)


TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reskilling plan · {{TITLE}}</title>
<style>
:root{--bg:#f6f7fb;--card:#fff;--ink:#16203a;--ink2:#5a6378;--line:#dde2ee;--accent:#2a5bd7;--high:#c0392b;--med:#c98a10;--low:#3c8d52;color-scheme:light}
:root[data-theme=dark]{--bg:#0f1422;--card:#182036;--ink:#e8ecf6;--ink2:#a3adc4;--line:#2c3650;--accent:#7ea2ff;--high:#ff8a7a;--med:#f3bd4f;--low:#7ccf8f;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:20px 16px;max-width:1200px;margin:auto}
h1{margin:0;font-size:24px}h2{margin:0;font-size:18px}.sub{color:var(--ink2);margin:2px 0 0}
main{max-width:1200px;margin:auto;padding:0 16px 40px;display:grid;align-items:start;grid-template-columns:minmax(0,1fr) 300px;gap:16px}
@media (max-width:900px){main{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0}
[role=tablist]{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;padding:6px 14px;cursor:pointer}
button:hover{border-color:var(--accent)}[aria-selected=true]{background:var(--accent);border-color:var(--accent);color:#fff}
.bar{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}.dl{display:flex;gap:6px}
.note{background:color-mix(in srgb,var(--accent) 10%,transparent);border-radius:10px;padding:8px 12px;margin:0 0 10px;color:var(--ink)}
.mm{overflow:auto}.mm svg{max-width:none;height:auto}.canvas-wrap{position:relative;height:420px}
#skill h3{margin:0 0 4px}#skill .muted{color:var(--ink2)}#skill ul{padding-left:18px}
.chip{display:inline-block;border-radius:999px;padding:1px 8px;font-size:12px;color:#fff;margin-right:4px}
.high{background:var(--high)}.medium{background:var(--med)}.low{background:var(--low)}
.skills{list-style:none;padding:0;margin:8px 0 0;display:grid;gap:4px}.skills button{width:100%;text-align:left;border-radius:10px}
.err{color:var(--high)}
</style></head><body>
<header><div><h1>{{TITLE}}</h1><p class="sub">{{SUB}}</p></div><button id="theme" aria-pressed="false">Dark theme</button></header>
<main><div class="card">{{BANNER}}<div role="tablist" aria-label="Diagrams">{{TABS}}</div>{{PANELS}}</div>
<aside class="card" id="side"><div id="skill"><h3>Skills</h3><p class="muted">Click a skill (or a node in a diagram) to see its phase and resources.</p></div><ul class="skills" id="skills"></ul></aside></main>
<script id="data" type="application/json">{{DATA}}</script>
<script src="{{CHARTJS}}"></script>
<script type="module">
import mermaid from "{{MERMAID}}";
const D = JSON.parse(document.getElementById("data").textContent);
const plan = D.plan, byId = Object.fromEntries(plan.skills.map((s) => [s.id, s]));
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
window.showSkill = (id) => {
  const s = byId[id]; if (!s) return;
  const phases = plan.phases.filter((p) => p.skills.includes(id)).map((p) => p.name);
  const res = plan.resources.filter((r) => r.skill_id === id);
  const deps = s.depends_on.map((d) => byId[d]?.name || d);
  document.getElementById("skill").innerHTML = `<h3>${esc(s.name)}</h3>
    <p><span class="chip ${s.priority}">${s.priority} priority</span><span class="muted">${esc(s.category)}</span></p>
    <p>Level ${s.level_now} → ${s.level_target}</p>
    <p><b>Phase:</b> ${phases.length ? phases.map(esc).join(", ") : "not scheduled"}</p>
    ${deps.length ? `<p><b>Learn first:</b> ${deps.map(esc).join(", ")}</p>` : ""}
    <b>Resources</b>${res.length ? `<ul>${res.map((r) => `<li>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>` : esc(r.title)} <span class="muted">· ${r.type}${r.est_hours ? ` · ${r.est_hours} h` : ""}</span></li>`).join("")}</ul>` : `<p class="muted">No resources listed.</p>`}`;
};
document.getElementById("skills").innerHTML = plan.skills.map((s) => `<li><button data-skill="${s.id}"><span class="chip ${s.priority}">${s.priority[0].toUpperCase()}</span>${esc(s.name)}</button></li>`).join("");
document.getElementById("skills").addEventListener("click", (e) => { const b = e.target.closest("[data-skill]"); if (b) showSkill(b.dataset.skill); });

const charts = {};
async function draw() {
  const dark = document.documentElement.dataset.theme === "dark";
  mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: dark ? "dark" : "default", htmlLabels: false, flowchart: { htmlLabels: false }, gantt: { fontSize: 14, sectionFontSize: 14, barHeight: 26, barGap: 6, leftPadding: 170, useWidth: 1100 } });
  for (const d of D.diagrams) {
    const panel = document.getElementById(`tab-${d.key}`);
    if (d.lang === "mermaid" && d.code) {
      const host = panel.querySelector(".mm");
      try {
        await mermaid.parse(d.code);
        const { svg, bindFunctions } = await mermaid.render(`m-${d.key}`, d.code);
        host.innerHTML = svg; bindFunctions?.(host);
      } catch (e) { host.innerHTML = `<p class="err">This diagram could not be drawn: ${esc(e.message || e)}</p>`; }
    } else if (d.lang === "chartjs") {
      const cfg = JSON.parse(d.code), ink = css("--ink"), line = css("--line");
      const color = { now: css("--ink2"), target: css("--accent"), capacity: css("--high"), planned: css("--accent") };
      cfg.data.datasets.forEach((s) => {
        s.borderColor = color[s.role]; s.backgroundColor = s.role === "planned" ? cfg.data.over.map((o) => o ? css("--high") : css("--accent")) : color[s.role] + "55";
        if (s.role === "capacity") { s.borderDash = [6, 4]; s.pointRadius = 0; s.backgroundColor = "transparent"; }
      });
      Chart.defaults.color = ink; Chart.defaults.borderColor = line;
      cfg.options = { ...cfg.options, maintainAspectRatio: false, animation: { duration: 300 }, onClick: (e, els) => { const i = els[0]?.index; if (i != null && cfg.data.ids) showSkill(cfg.data.ids[i]); } };
      if (cfg.options.scales?.r) cfg.options.scales.r.grid = { color: line }, cfg.options.scales.r.angleLines = { color: line }, cfg.options.scales.r.pointLabels = { color: ink };
      charts[d.key]?.destroy(); charts[d.key] = new Chart(panel.querySelector("canvas"), cfg);
    }
  }
}
document.querySelector("[role=tablist]").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]"); if (!b) return;
  document.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  document.querySelectorAll("[role=tabpanel]").forEach((p) => { p.hidden = p.id !== `tab-${b.dataset.tab}`; });
  charts[b.dataset.tab]?.resize();
});
document.getElementById("theme").addEventListener("click", (e) => {
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  e.target.textContent = dark ? "Light theme" : "Dark theme"; e.target.setAttribute("aria-pressed", String(dark)); draw();
});
const save = (href, name) => { const a = document.createElement("a"); a.href = href; a.download = name; a.click(); };
document.addEventListener("click", (e) => {
  const panel = e.target.closest("[role=tabpanel]"); if (!panel) return;
  const key = panel.id.slice(4), svg = panel.querySelector(".mm svg");
  if (e.target.matches("[data-svg]") && svg) save(URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" })), `${key}.svg`);
  if (e.target.matches("[data-png]")) {
    if (charts[key]) return save(charts[key].toBase64Image("image/png", 1), `${key}.png`);
    if (!svg) return;
    const box = svg.getBoundingClientRect(), img = new Image(), scale = 2;
    img.onload = () => { const c = document.createElement("canvas"); c.width = box.width * scale; c.height = box.height * scale;
      const g = c.getContext("2d"); g.fillStyle = css("--card"); g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); save(c.toDataURL("image/png"), `${key}.png`); };
    const clone = svg.cloneNode(true); clone.setAttribute("width", box.width); clone.setAttribute("height", box.height);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  }
});
draw();
</script></body></html>
"""
