// HR overview: cohort comparisons, sample preview, and separate team plans.
import { api, h, icon, stream } from "./lib.js";

const SEVERITY = { low: ["Low", "0–24%"], moderate: ["Moderate", "25–49%"], high: ["High", "50–74%"], critical: ["Critical", "75–100%"] };
const SELECTED = new Set();
const cellKey = (c) => `${c.skill}\u001f${c.group}`;

export async function workforceView(root) {
  const selected = { skill: new Set(), category: "all", scenario: "assistive", department: "", role: "", source: "", samplePreview: false, sampleDismissed: false, view: "bloom" };
  let request = 0, data, plans = [];
  const output = h("div", { class: "wf-output", "aria-live": "polite" });
  const filters = h("div", { class: "wf-filters" });
  const status = h("p", { class: "muted", role: "status" });
  const refresh = h("button", { type: "button", class: "btn sm wf-icon-btn", onclick: load, title: "Refresh data", "aria-label": "Refresh data" }, icon("replay"));
  const heading = h("div", { class: "wf-heading" }, h("div", {}, h("h2", {}, "Workforce skills gap heatmap"),
    h("p", { class: "muted" }, "Compare role-specific proficiency gaps across your workforce.")));
  const previewBanner = h("div", { class: "wf-sample-banner", role: "status", hidden: true });
  root.replaceChildren(heading, previewBanner, filters, status, output);

  // one toolbar: scenario toggle, three dropdowns, the rest under "More filters"; Reset only when something is filtered
  const DEFAULTS = { category: "all", scenario: "assistive", department: "", role: "", source: "" };
  const changed = () => { SELECTED.clear(); drawFilters(); load(); };
  function drawFilters() {
    const select = (label, key, options, resetOnChange = false) => h("select", { class: "input wf-select-sm", "aria-label": label,
      onchange: (e) => {
        selected[key] = e.target.value;
        if (resetOnChange && !data.options.roles.includes(selected.role)) selected.role = "";
        changed();
      } }, options.map(([value, text]) => h("option", { value, selected: selected[key] === value }, text)));
    const scenario = h("div", { class: "seg wf-seg", role: "group", "aria-label": "AI scenario" }, [["assistive", "Assistive"], ["agentic", "Agentic"]].map(([value, text]) =>
      h("button", { type: "button", "aria-pressed": String(selected.scenario === value), onclick: () => { if (selected.scenario !== value) { selected.scenario = value; changed(); } } }, text)));
    const roleOptions = data.options.roles.filter((r) => !selected.department || data.cells.some((c) => c.department === selected.department && c.roles.includes(r)));
    const more = (selected.category !== "all") + selected.skill.size;
    // skill ticks keep the menu open; the count and Reset catch up when it closes
    const moreMenu = h("details", { class: "wf-filter wf-more", ontoggle: (e) => { if (!e.target.open) drawFilters(); } },
      h("summary", {}, icon("sliders"), "More filters", more ? h("span", { class: "wf-count" }, String(more)) : null),
      h("div", { class: "wf-filter-options" },
        h("label", { class: "wf-select" }, h("span", {}, "Category"), select("Category", "category", [["all", "Skills & tools"], ["skill", "Skills"], ["tool", "Tools"]])),
        h("div", { class: "wf-more-head" }, h("span", {}, "Skills"), selected.skill.size ? h("button", { type: "button", class: "btn sm ghost", onclick: () => { selected.skill.clear(); changed(); } }, "Clear") : null),
        h("input", { class: "input wf-skill-search", type: "search", placeholder: "Search skills", "aria-label": "Search skills", oninput: (e) => {
          const q = e.target.value.trim().toLowerCase();
          e.target.parentElement.querySelectorAll("label[data-skill]").forEach((l) => { l.hidden = !!q && !l.dataset.skill.includes(q); });
        } }),
        data.options.skills.map((sk) => h("label", { dataset: { skill: sk.name.toLowerCase() } }, h("input", { type: "checkbox", value: sk.name, checked: selected.skill.has(sk.name), onchange: (e) => {
          if (e.target.checked) selected.skill.add(sk.name); else selected.skill.delete(sk.name);
          SELECTED.clear(); load();
        } }), h("span", {}, sk.name)))));
    const active = more || Object.entries(DEFAULTS).some(([k, v]) => k !== "category" && selected[k] !== v);
    filters.replaceChildren(...[scenario,
      select("Department", "department", [["", "All departments"], ...data.options.departments.map((v) => [v, v])], true),
      select("Job role", "role", [["", "All roles"], ...roleOptions.map((v) => [v, v])]),
      data.policy.sample_preview ? null : select("Source", "source", [["", "All sources"], ...(data.sources || []).map((x) => [x.key, `${x.label} (${x.employees})`])]),
      moreMenu, h("span", { class: "wf-spacer" }),
      active ? h("button", { type: "button", class: "btn sm ghost", onclick: () => { Object.assign(selected, DEFAULTS, { skill: new Set() }); changed(); } }, "Reset") : null,
      refresh].filter(Boolean));
  }

  async function load() {
    const version = ++request;
    const params = new URLSearchParams({ scenario: selected.scenario, category: selected.category, department: selected.department, role: selected.role });
    if (selected.samplePreview) params.set("sample_preview", "true");
    else if (selected.source) params.set("source", selected.source);
    selected.skill.forEach((value) => params.append("skill", value));
    status.textContent = "Loading workforce assessments…";
    output.setAttribute("aria-busy", "true"); refresh.disabled = true;
    try {
      const next = await api(`/api/hr/workforce?${params}`);
      if (version !== request || !root.isConnected) return;
      const hasHeatmap = next.cells?.some((c) => c.status === "ready");
      // the fictional preview only stands in when the organisation has no data at all, never for a filter that matches nothing
      const filtered = selected.skill.size || selected.department || selected.role || selected.source || selected.category !== "all";
      if (!selected.samplePreview && !selected.sampleDismissed && !filtered && !hasHeatmap && next.sample_available) {
        selected.samplePreview = true; await load(); return;
      }
      const optionsChanged = !data || JSON.stringify(data.options) !== JSON.stringify(next.options);
      data = next;
      previewBanner.hidden = !next.policy.sample_preview && !selected.sampleDismissed;
      previewBanner.replaceChildren(...(next.policy.sample_preview ? [h("strong", {}, "SAMPLE DATA · PREVIEW ONLY"),
        h("span", {}, "40 fictional employees across five departments. Sample results are for demonstration and do not represent a real workforce."),
        h("button", { type: "button", class: "btn sm", onclick: () => { selected.samplePreview = false; selected.sampleDismissed = true; SELECTED.clear(); load(); } }, "View real assessments")]
        : selected.sampleDismissed ? [h("strong", {}, "REAL ASSESSMENTS"), h("span", {}, `Your organisation's analyses: ${(next.sources || []).map((x) => `${x.employees} ${x.label.toLowerCase()}`).join(" · ")}.`),
          h("button", { type: "button", class: "btn sm", onclick: () => { selected.samplePreview = true; selected.sampleDismissed = false; SELECTED.clear(); load(); } }, "View sample preview")] : []));
      if (optionsChanged || !filters.childElementCount) drawFilters();
      status.textContent = "";
      render();
      await loadPlans(version);
    } catch (e) {
      if (version !== request || !root.isConnected) return;
      status.textContent = `Workforce analytics could not be loaded. ${e.message}`;
      output.replaceChildren(h("div", { class: "issue error", role: "alert" }, "Use Refresh data to try again."));
    } finally {
      if (version === request) { output.removeAttribute("aria-busy"); refresh.disabled = false; }
    }
  }

  function render() {
    const o = data.overview;
    const card = (value, label, note) => h("div", { class: "wf-stat" }, h("span", { class: "muted" }, label), h("strong", {}, value), h("span", { class: "muted" }, note));
    const common = o.common_missing.slice(0, 3);
    const stats = h("div", { class: "wf-stats" },
      card(o.employees, "Employees analyzed", "In the selected workforce group"),
      card(o.assessed_skills, "Skills assessed", "With assessment data"),
      card(o.critical, "Critical gaps", "Groups with gaps of 75% or higher"),
      h("div", { class: "wf-stat" }, h("span", { class: "muted" }, "Top shared gaps"),
        common.length ? h("ol", { class: "wf-top-gaps" }, common.map((v) => h("li", {}, h("b", {}, v.skill), h("span", { class: "muted" }, `${v.employees} below`))))
          : h("strong", {}, "—")));
    // worst skill first; the last column is the skill's average gap across the groups that have assessments
    const avg = (row) => { const xs = row.cells.filter((c) => c.status === "ready").map((c) => c.gap_percent); return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null; };
    const rows = [...data.rows].sort((a, b) => (avg(b) ?? -1) - (avg(a) ?? -1));
    const mean = (xs) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
    const colAvg = (i) => mean(rows.map((r) => r.cells[i]).filter((c) => c?.status === "ready").map((c) => c.gap_percent));
    const avgCell = (a, label, extra) => h("div", { class: `wf-cell wf-avg${a == null ? " wf-unknown" : " wf-heat"}`, style: a == null ? null : { "--g": a }, dataset: extra, role: "cell", "aria-label": `${label}: ${a ?? "no assessment"}${a == null ? "" : "%"}` },
      h("strong", {}, a == null ? "—" : `${a}%`), a == null ? null : h("i", { class: "wf-bar", "aria-hidden": "true" }));
    const allAvg = mean(rows.flatMap((r) => r.cells.filter((c) => c.status === "ready").map((c) => c.gap_percent)));
    const grid = data.groups.length && data.rows.length ? h("div", { class: "wf-matrix-grid", style: { "--wf-cols": data.groups.length + 1 },
      onmouseover: (e) => cross(e.target.closest("[data-r],[data-c]")), onmouseleave: () => cross(null), onfocusin: (e) => cross(e.target.closest("[data-r],[data-c]")) },
      h("div", { class: "wf-skill-head" }, "Required skill"),
      data.groups.map((g, i) => h("div", { class: "wf-group-head", title: g.label, dataset: { c: i } }, g.label)),
      h("div", { class: "wf-group-head wf-avg-head" }, "Skill average"),
      rows.flatMap((row, r) => [h("div", { class: "wf-skill-name", title: row.skill, dataset: { r } }, row.skill), ...row.cells.map((c, i) => cellButton(c, r, i)),
        avgCell(avg(row), `${row.skill} average gap`, { group: "Skill average", r })]),
      h("div", { class: "wf-skill-name wf-foot" }, "Department average"),
      data.groups.map((g, i) => avgCell(colAvg(i), `${g.label} average gap`, { group: g.label, c: i })),
      avgCell(allAvg, "Overall average gap", { group: "Overall" })) : null;
    function cross(el) {  // dim everything outside the hovered cell's row and column
      if (!grid) return;
      const { r, c } = el?.dataset || {};
      grid.toggleAttribute("data-cross", r != null || c != null);
      grid.querySelectorAll("[data-r],[data-c]").forEach((x) => x.classList.toggle("is-cross", (r != null && x.dataset.r === r) || (c != null && x.dataset.c === c)));
    }
    const matrix = grid ? h("div", { class: "wf-matrix-scroll" }, grid)
      : h("div", { class: "empty-state wf-empty" }, icon("upload"), h("h3", {}, "No assessments in this view"),
        h("p", {}, selected.samplePreview ? "The fictional preview has no matching assessed skills. Reset filters to see the full sample workforce." : "No authorized real assessments match these filters."),
        !selected.samplePreview ? h("a", { class: "btn primary sm", href: "#/run" }, "Analyse team") : null);
    const suggestions = data.priorities.length ? h("div", { class: "wf-suggestions" }, h("strong", {}, "Suggested priorities · highest gaps"),
      data.priorities.map((c) => h("button", { type: "button", class: `wf-suggestion${SELECTED.has(cellKey(c)) ? " is-selected" : ""}`,
        "aria-pressed": SELECTED.has(cellKey(c)), onclick: () => { if (SELECTED.has(cellKey(c))) SELECTED.delete(cellKey(c)); else SELECTED.add(cellKey(c)); render(); } },
        h("span", { class: "wf-sug-pct wf-heat", style: { "--g": c.gap_percent } }, `${c.gap_percent}%`),
        h("span", {}, h("b", {}, c.skill), ` · ${c.group}`), h("span", { class: "muted" }, `${c.affected}/${c.employees}`),
        SELECTED.has(cellKey(c)) ? icon("check") : h("span", { class: "wf-sug-add", "aria-hidden": "true" }, "+")))) : null;
    const legend = h("div", { class: "wf-legend", "aria-label": "Skill gap colour scale" },
      h("span", { class: "wf-scale" }, h("b", {}, "0%"), h("i", { class: "wf-ramp", "aria-hidden": "true" }), h("b", {}, "100% below target")),
      h("span", { class: "muted" }, Object.values(SEVERITY).map(([label, range]) => `${label} ${range}`).join(" · ")),
      h("span", {}, h("i", { class: "wf-unknown" }), "No assessment"));
    const teamButton = h("button", { type: "button", class: "btn primary", disabled: !SELECTED.size,
      "aria-describedby": !SELECTED.size ? "wf-team-action-hint" : null, onclick: startPlanGeneration },
      `Create team reskilling plan${SELECTED.size ? ` · ${SELECTED.size}` : ""}`);
    const teamAction = h("div", { class: "wf-team-action" }, teamButton,
      !SELECTED.size ? h("span", { id: "wf-team-action-hint", class: "wf-team-action-hint" }, "Select a suggested priority below to enable plan creation.") : null);
    const viewSwitch = h("div", { class: "seg wf-seg", role: "group", "aria-label": "Chart view" }, [["bloom", "Bloom"], ["matrix", "Matrix"]].map(([v, t]) =>
      h("button", { type: "button", "aria-pressed": String(selected.view === v), onclick: () => { if (selected.view !== v) { selected.view = v; render(); } } }, t)));
    const heatmap = h("section", { class: "panel" }, h("header", { class: "wf-panel-header" }, h("div", {}, h("h2", {}, "Team skill gaps"),
      h("p", { class: "muted" }, selected.view === "bloom" ? "The skills where most people sit below their role's target, largest gap first."
        : "Each cell shows employees below their role’s target proficiency.")), h("div", { class: "wf-head-actions" }, viewSwitch, teamAction)),
      h("div", { class: "pad wf-matrix" }, ...(selected.view === "bloom" ? [bloom(), suggestions] : [suggestions, matrix]),
        data.total_skills > data.rows.length && !selected.skill.size ? h("p", { class: "muted wf-policy" },
          `Showing the ${data.rows.length} most-assessed of ${data.total_skills} skills. Use the Skills filter to pick others.`) : null,
        selected.view === "bloom" ? null : legend,
        h("p", { class: "muted wf-policy" }, data.policy.sample_preview ? "Fictional data uses role-specific targets on a 0–5 scale. Select a cell to inspect it and add its gap to a draft team plan." : "Built from your organisation's analyses: resumes and quizzes your invited employees ran for themselves, and the team files you uploaded. Gap percentage is employees below their role's required proficiency divided by employees assessed for that skill; missing assessments are excluded.")));
    const savedPlan = (p) => {
      const gapCount = (p.gaps || p.skills || []).length;
      const priorityList = h("ul", {}, (p.priorities || p.skills || []).map((item) =>
        h("li", {}, `${item.skill} · ${item.group}: ${item.affected}/${item.assessed} below target (${item.current}/5 → ${item.target}/5)${item.reason ? ` — ${item.reason}` : ""}`)));
      const sharedSteps = (p.shared_steps || []).length
        ? [h("h4", {}, "Shared learning steps"), h("ol", {}, p.shared_steps.map((step) => h("li", {}, step)))]
        : null;
      const roleTracks = (p.role_tracks || []).map((track) =>
        h("div", {}, h("h4", {}, track.role), h("ol", {}, track.steps.map((step) => h("li", {}, step)))));
      return h("article", { class: "wf-saved-plan" },
        h("div", {},
          h("h3", {}, p.name),
          h("p", { class: "muted" }, `${p.cohort.employees} employees · ${p.cohort.department} · ${p.cohort.role}`),
          h("p", {}, `${gapCount} selected skill group${gapCount === 1 ? "" : "s"} · Draft for HR review${p.sample_preview ? " · Sample preview" : ""}`)),
        h("details", {},
          h("summary", {}, "Review AI draft"),
          h("p", {}, p.overview || ""), priorityList, sharedSteps, ...roleTracks,
          h("p", { class: "muted" }, "No verified learning resources configured.")));
    };
    const section = h("section", { class: "panel wf-team-plans" },
      h("header", {}, h("h2", {}, "Team reskilling plans")),
      h("div", { class: "pad" }, plans.length
        ? plans.map(savedPlan)
        : h("p", { class: "muted" }, "No team plans yet. Select heatmap gaps and create a draft for HR review.")));
    output.replaceChildren(stats, heatmap, section);
  }
  // Gap bloom: a radial view of the top skills. Petal length = share of assessed people below target (linear radius),
  // colour = the same share on a one-hue owl-blue ramp; the ranked list beside it carries the exact numbers, one dot
  // per assessed person. Petals and rows open the same detail as a matrix cell.
  function bloom() {
    const skills = data.rows.map((row) => {
      const ready = row.cells.filter((c) => c.status === "ready" && c.employees);
      const employees = ready.reduce((n, c) => n + c.employees, 0), affected = ready.reduce((n, c) => n + c.affected, 0);
      const worst = [...ready].sort((a, b) => (b.gap_percent - a.gap_percent) || (b.affected - a.affected))[0];
      return { skill: row.skill, employees, affected, pct: employees ? Math.round((100 * affected) / employees) : 0, worst,
        roles: ready.filter((c) => c.affected).map((c) => c.group) };
    }).filter((x) => x.employees).sort((a, b) => (b.affected - a.affected) || (b.pct - a.pct)).slice(0, 10);
    if (!skills.length) return h("div", { class: "empty-state wf-empty" }, h("h3", {}, "No assessed gaps in this view"),
      h("p", {}, "Try fewer filters, or analyse more of your team."));
    const step = (pct) => (pct >= 90 ? 5 : pct >= 70 ? 4 : pct >= 45 ? 3 : pct >= 20 ? 2 : 1);
    const NS = "http://www.w3.org/2000/svg", svg = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
    const C = 180, R0 = 46, R = 160, n = skills.length, slice = (2 * Math.PI) / Math.max(n, 3), gap = 0.06;
    const pt = (r, a) => `${(C + r * Math.sin(a)).toFixed(1)} ${(C - r * Math.cos(a)).toFixed(1)}`;
    const chart = svg("svg", { viewBox: "0 0 360 360", class: "wf-bloom", role: "img",
      "aria-label": `Gap bloom: ${skills.map((x, i) => `${i + 1}. ${x.skill} ${x.pct}%`).join(", ")}` });
    const defs = svg("defs", {});
    [1, 2, 3, 4, 5].forEach((k) => { const g = svg("radialGradient", { id: `wf-bl-${k}`, cx: C, cy: C, r: R, gradientUnits: "userSpaceOnUse" });
      g.append(svg("stop", { offset: "0.25", class: `wf-stop-a s${k}` }), svg("stop", { offset: "1", class: `wf-stop-b s${k}` })); defs.append(g); });
    chart.append(defs);
    [0.25, 0.5, 0.75, 1].forEach((f) => chart.append(svg("circle", { cx: C, cy: C, r: R0 + (R - R0) * f, class: "wf-bloom-ring" })));
    const tip = h("div", { class: "wf-tooltip wf-bloom-tip", hidden: true });
    skills.forEach((x, i) => {
      const r = R0 + (R - R0) * Math.max(x.pct, 4) / 100, a0 = i * slice + gap, a1 = (i + 1) * slice - gap, mid = (a0 + a1) / 2;
      // petal: straight flanks, a rounded tip (two curves meeting at the full length on the mid-line)
      const k = R0 + (r - R0) * 0.72;
      const d = `M ${pt(R0, a0)} L ${pt(k, a0)} Q ${pt(r * 1.02, a0)} ${pt(r, mid)} Q ${pt(r * 1.02, a1)} ${pt(k, a1)} L ${pt(R0, a1)} A ${R0} ${R0} 0 0 0 ${pt(R0, a0)} Z`;
      const g = svg("g", { class: `wf-petal s${step(x.pct)}`, tabindex: "0", role: "button", "aria-label": `${i + 1}. ${x.skill}: ${x.pct}% below target, ${x.affected} of ${x.employees}`,
        style: `--d:${i * 60}ms; transform-origin: ${C}px ${C}px` });
      g.append(svg("path", { d, fill: `url(#wf-bl-${step(x.pct)})` }), Object.assign(svg("text", { x: pt(r + 13, mid).split(" ")[0], y: +pt(r + 13, mid).split(" ")[1] + 4, class: "wf-petal-n" }), { textContent: String(i + 1) }));
      const show = (e) => { tip.hidden = false; tip.textContent = `${x.skill}\n${x.pct}% below target · ${x.affected} of ${x.employees} people${x.roles.length ? `\n${x.roles.join(", ")}` : ""}`;
        const b = (e.currentTarget || g).getBoundingClientRect(); tip.style.left = `${Math.min(innerWidth - 340, b.right + 8)}px`; tip.style.top = `${b.top}px`; list.querySelectorAll("li")[i]?.classList.add("is-hot"); };
      const hide = () => { tip.hidden = true; list.querySelectorAll("li")[i]?.classList.remove("is-hot"); };
      g.addEventListener("mouseenter", show); g.addEventListener("focus", show); g.addEventListener("mouseleave", hide); g.addEventListener("blur", hide);
      g.addEventListener("click", () => x.worst && detail(x.worst)); g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); x.worst && detail(x.worst); } });
      chart.append(g);
    });
    const people = data.overview.employees, avg = Math.round(skills.reduce((t, x) => t + x.pct, 0) / skills.length);
    chart.append(svg("circle", { cx: C, cy: C, r: R0 - 6, class: "wf-bloom-core" }),
      Object.assign(svg("text", { x: C, y: C + 4, class: "wf-bloom-num" }), { textContent: `${avg}%` }),
      Object.assign(svg("text", { x: C, y: C + 22, class: "wf-bloom-cap" }), { textContent: "avg gap" }));
    // one dot per person up to ten people; above that ten dots, each a tenth of the people assessed
    const dots = (x) => { const per = x.employees <= 10, n = per ? x.employees : 10, on = per ? x.affected : Math.round(x.pct / 10);
      return h("span", { class: "wf-dots", "aria-hidden": "true", title: per ? "One dot per person" : "Each dot is 10% of the people assessed" },
        Array.from({ length: n }, (_, k) => h("i", { class: k < on ? "on" : null }))); };
    const list = h("ol", { class: "wf-rank" }, skills.map((x, i) => h("li", {}, h("button", { type: "button", onclick: () => x.worst && detail(x.worst),
      onmouseenter: () => chart.querySelectorAll(".wf-petal")[i]?.classList.add("is-hot"), onmouseleave: () => chart.querySelectorAll(".wf-petal")[i]?.classList.remove("is-hot") },
      h("span", { class: `wf-rank-n s${step(x.pct)}` }, String(i + 1)),
      h("span", { class: "wf-rank-main" }, h("b", {}, x.skill), h("small", {}, x.roles.length ? x.roles.join(" · ") : "No one below target")),
      dots(x), h("span", { class: "wf-rank-pct" }, `${x.pct}%`, h("small", {}, `${x.affected}/${x.employees}`))))));
    const scale = h("div", { class: "wf-bloom-scale", "aria-hidden": "true" }, h("span", {}, "Smaller gap"), [1, 2, 3, 4, 5].map((k) => h("i", { class: `s${k}` })), h("span", {}, "Larger gap"));
    return h("div", { class: "wf-bloom-wrap" },
      h("figure", { class: "wf-bloom-fig" }, chart, h("figcaption", {}, scale, h("span", { class: "muted" }, `${people} people · petal length = share below target`))),
      list, tip);
  }

  function cellButton(c, r, i) {
    const status = c.status === "ready" ? `${c.affected} of ${c.employees} employees` : "No assessment";
    return h("button", { type: "button", class: `wf-cell ${c.status === "ready" ? "wf-heat" : "wf-unknown"}${SELECTED.has(cellKey(c)) ? " is-selected" : ""}`,
      style: c.status === "ready" ? { "--g": c.gap_percent } : null,
      dataset: { group: c.group, r, c: i }, title: `${c.skill} · ${c.group}: ${status}`, "aria-label": `${c.skill}, ${c.group}: ${c.gap_percent ?? "No assessment"}${c.gap_percent != null ? `% · ${status}` : ""}`,
      onclick: () => detail(c) }, h("strong", {}, c.status === "ready" ? `${c.gap_percent}%` : "—"),
      h("span", {}, c.status === "ready" ? `${c.affected} of ${c.employees}` : "No data"),
      c.status === "ready" ? h("i", { class: "wf-bar", "aria-hidden": "true" }) : null);
  }
  function detail(c) {
    let dialog;
    const selectedNow = SELECTED.has(cellKey(c));
    const toggle = h("button", { type: "button", class: "btn sm", onclick: () => { if (selectedNow) SELECTED.delete(cellKey(c)); else SELECTED.add(cellKey(c)); dialog.close(); render(); } }, selectedNow ? "Remove from plan" : "Add gap to plan");
    dialog = h("dialog", { class: "wf-dialog", onclose: () => dialog.remove() }, h("div", { class: "wf-dialog-head" }, h("h2", {}, `${c.skill} · ${c.group}`),
      h("button", { type: "button", class: "btn sm", autofocus: true, onclick: () => dialog.close() }, "Close")),
      h("div", { class: "wf-detail-body" }, h("span", { class: `wf-badge wf-${c.severity || "unknown"}` }, c.gap_percent == null ? "No assessment" : `${c.gap_percent}% below target · ${c.severity} gap`),
        h("p", {}, `${c.department || c.group}${c.role ? ` · ${c.role}` : ""}`),
        h("dl", { class: "wf-metrics" }, h("dt", {}, "Below target"), h("dd", {}, c.status === "ready" ? `${c.affected} employees` : "—"),
          h("dt", {}, "Assessed employees"), h("dd", {}, `${c.employees} of ${c.eligible}`),
          h("dt", {}, "Average current proficiency"), h("dd", {}, c.current == null ? "—" : `${c.current} / 5`),
          h("dt", {}, "Average role target"), h("dd", {}, c.required == null ? "—" : `${c.required} / 5`)),
        h("p", { class: "muted" }, "Employee identities are not shown. Learning resources: Resource not configured."), c.status === "ready" && c.affected ? toggle : null));
    root.append(dialog); dialog.showModal();
  }
  function startPlanGeneration() {
    if (!SELECTED.size) return;
    const chosen = data.cells.filter((c) => SELECTED.has(cellKey(c)) && c.status === "ready" && c.affected);
    if (!chosen.length) return;
    const payload = { scenario: selected.scenario, category: selected.category, department: selected.department, role: selected.role,
      gaps: chosen.map((c) => ({ skill: c.skill, group: c.group })), sample_preview: selected.samplePreview };
    const status = h("p", { class: "wf-generation-status", role: "status" }, "Analysing team skill gaps…");
    const editor = h("div", { class: "wf-plan-editor" });
    const error = h("p", { class: "issue error", role: "alert", hidden: true });
    const retry = h("button", { type: "button", class: "btn sm", hidden: true, onclick: generate }, "Retry AI generation");
    let dialog, controller, busy = false, currentDraft;
    const cancel = h("button", { type: "button", class: "btn sm", onclick: () => { controller?.abort(); dialog.close(); } }, "Cancel");
    const header = h("div", { class: "wf-dialog-head" }, h("div", {}, h("h2", {}, "AI team reskilling plan"),
      h("p", { class: "muted" }, `${data.cohort.department} · ${data.cohort.role} · ${data.cohort.employees} employees`)), cancel);
    dialog = h("dialog", { class: "wf-dialog wf-plan-dialog", onclose: () => { controller?.abort(); dialog.remove(); } },
      header, h("div", { class: "wf-detail-body" }, status,
        h("p", { class: "muted" }, "Your selected gaps and cohort filters stay in place while AI prepares an editable draft."),
        selected.samplePreview ? h("p", { class: "wf-sample-banner" }, "SAMPLE DATA · Fictional workforce. The draft is for demonstration only.") : null,
        editor, error, retry));
    root.append(dialog); dialog.showModal();

    function lineList(text) { return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 8); }
    function addListEditor(label, items) {
      const field = h("label", { class: "wf-plan-field" }, h("span", {}, label),
        h("textarea", { class: "input", rows: "4", maxlength: "4000", "aria-label": label }, (items || []).join("\n")));
      return field;
    }
    function showDraft(draft) {
      currentDraft = draft;
      status.textContent = "AI draft ready · Review and edit before saving.";
      error.hidden = true; retry.hidden = true;
      const name = h("input", { class: "input", value: draft.name, maxlength: "120", "aria-label": "Plan name" });
      const overview = h("textarea", { class: "input", rows: "4", maxlength: "1800", "aria-label": "Plan overview" }, draft.overview);
      const priorityRows = (draft.priorities || []).map((priority) => {
        const item = { ...(draft.gaps || []).find((gap) => gap.skill === priority.skill && gap.group === priority.group), ...priority };
        const include = h("input", { type: "checkbox", checked: true, "aria-label": `Include ${item.skill} for ${item.group}` });
        const reason = h("textarea", { class: "input", rows: "2", maxlength: "700", "aria-label": `Why prioritize ${item.skill} in ${item.group}` }, item.reason);
        return { item, include, reason, node: h("article", { class: "wf-priority-edit" },
          h("label", { class: "wf-priority-check" }, include, h("strong", {}, `${item.skill} · ${item.group}`),
            h("span", {}, `${item.affected} of ${item.assessed} below target · ${item.gap_percent}%`)), reason) };
      });
      const shared = addListEditor("Shared learning steps · one per line", draft.shared_steps);
      const trackEditors = (draft.role_tracks || []).map((track) => ({ role: track.role, field: addListEditor(`${track.role} learning track · one step per line`, track.steps) }));
      const checks = addListEditor("Progress checks · one per line", draft.progress_checks);
      const save = h("button", { type: "button", class: "btn primary", onclick: saveDraft }, "Save draft");
      const formError = h("p", { class: "issue error", role: "alert", hidden: true });
      editor.replaceChildren(h("label", { class: "wf-plan-field" }, h("span", {}, "Plan name"), name),
        h("label", { class: "wf-plan-field" }, h("span", {}, "AI overview · editable"), overview),
        h("h3", {}, "Selected priorities · uncheck to remove"), ...priorityRows.map((row) => row.node),
        shared, ...trackEditors.map((track) => track.field), checks,
        h("p", { class: "muted" }, `Cohort: ${draft.cohort.employees} employees · No verified learning resources configured. Suggested activities are general topics; choose resources during HR review.${draft.sample_preview ? " Fictional sample draft only." : ""}`),
        formError, h("div", { class: "wf-plan-actions" }, cancel, save));

      async function saveDraft() {
        const priorities = priorityRows.filter((row) => row.include.checked).map((row) => ({ ...row.item, reason: row.reason.value.trim() }));
        if (!name.value.trim() || !overview.value.trim() || !priorities.length || priorities.some((item) => !item.reason)) {
          formError.hidden = false; formError.textContent = "Add a plan name, overview, and at least one priority with its reason."; return;
        }
        save.disabled = true;
        formError.hidden = true;
        try {
          await api("/api/hr/team-plans", { method: "POST", body: { ...payload, name: name.value.trim(), overview: overview.value.trim(),
            gaps: priorities.map(({ skill, group }) => ({ skill, group })),
            priorities: priorities.map(({ skill, group, reason }) => ({ skill, group, reason })),
            shared_steps: lineList(shared.querySelector("textarea").value),
            role_tracks: trackEditors.map(({ role, field }) => ({ role, steps: lineList(field.querySelector("textarea").value) })),
            progress_checks: lineList(checks.querySelector("textarea").value) } });
          SELECTED.clear(); dialog.close(); await load(); status.textContent = "Team plan draft saved for HR review.";
        } catch (e) {
          formError.hidden = false; formError.textContent = `Could not save draft: ${e.message}`; save.disabled = false;
        }
      }
    }

    async function generate() {
      if (busy) return;
      busy = true; currentDraft = null; controller = new AbortController();
      status.textContent = "Analysing team skill gaps…"; error.hidden = true; retry.hidden = true;
      editor.replaceChildren(h("div", { class: "wf-loading", role: "status" }, h("span", { class: "wf-spinner", "aria-hidden": "true" }),
        h("strong", {}, "Analysing team skill gaps…"), h("span", {}, "Your filters and selected gaps are preserved.")));
      try {
        await stream("/api/hr/team-plans/generate", payload, (event) => {
          if (event.t === "status") {
            status.textContent = event.message;
            const message = editor.querySelector(".wf-loading strong");
            if (message) message.textContent = event.message;
          } else if (event.t === "draft") showDraft(event.draft);
          else if (event.t === "error") {
            error.hidden = false; error.textContent = event.message;
            retry.hidden = !event.retryable; editor.replaceChildren();
          }
        }, controller.signal);
        if (!currentDraft && error.hidden) {
          error.hidden = false; error.textContent = "AI generation ended without a draft. Your selections are preserved; retry."; retry.hidden = false;
          editor.replaceChildren();
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          error.hidden = false; error.textContent = `AI generation failed: ${e.message}. Your selections are preserved.`;
          retry.hidden = false; editor.replaceChildren();
        }
      } finally { busy = false; }
    }
    generate();
  }
  async function loadPlans(version = request) {
    try { const result = await api("/api/hr/team-plans"); if (version !== request || !root.isConnected) return; plans = result; render(); }
    catch { /* Heatmap remains usable when plan listing is temporarily unavailable. */ }
  }
  await load();
}
