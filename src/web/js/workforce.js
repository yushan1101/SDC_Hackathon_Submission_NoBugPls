// HR overview: cohort comparisons, sample preview, and separate team plans.
import { api, h, icon } from "./lib.js";

const SEVERITY = { low: ["Low", "0–24%"], moderate: ["Moderate", "25–49%"], high: ["High", "50–74%"], critical: ["Critical", "75–100%"] };
const SELECTED = new Set();
const cellKey = (c) => `${c.skill}\u001f${c.group}`;

export async function workforceView(root) {
  const selected = { skill: new Set(), category: "all", scenario: "assistive", department: "", role: "", samplePreview: false, sampleDismissed: false };
  let request = 0, data, plans = [];
  const output = h("div", { class: "wf-output", "aria-live": "polite" });
  const filters = h("div", { class: "wf-filters" });
  const status = h("p", { class: "muted", role: "status" });
  const refresh = h("button", { type: "button", class: "btn sm", onclick: load }, "Refresh data");
  const heading = h("div", { class: "wf-heading" }, h("div", {}, h("h2", {}, "Workforce skills gap heatmap"),
    h("p", { class: "muted" }, "Compare role-specific proficiency gaps across your workforce.")), refresh);
  const previewBanner = h("div", { class: "wf-sample-banner", role: "status", hidden: true });
  root.replaceChildren(heading, previewBanner, filters, status, output);

  function drawFilters() {
    const select = (label, key, options, resetOnChange = false) => h("label", { class: "wf-select" }, h("span", {}, label),
      h("select", { class: "input", onchange: (e) => {
        selected[key] = e.target.value;
        if (resetOnChange && !data.options.roles.includes(selected.role)) selected.role = "";
        SELECTED.clear(); load();
      } }, options.map(([value, text]) => h("option", { value, selected: selected[key] === value }, text))));
    const skillSummary = h("summary", {}, `Skills: ${selected.skill.size ? `${selected.skill.size} selected` : "All skills"}`);
    const skills = h("details", { class: "wf-filter" }, skillSummary,
      h("div", { class: "wf-filter-options" }, h("button", { type: "button", class: "btn sm", onclick: () => { selected.skill.clear(); SELECTED.clear(); drawFilters(); load(); } }, "All skills"),
        data.options.skills.map((s) => h("label", {}, h("input", { type: "checkbox", value: s.name, checked: selected.skill.has(s.name), onchange: (e) => {
          if (e.target.checked) selected.skill.add(s.name); else selected.skill.delete(s.name);
          skillSummary.textContent = `Skills: ${selected.skill.size ? `${selected.skill.size} selected` : "All skills"}`;
          SELECTED.clear(); load();
        } }), h("span", {}, s.name)))));
    const roleOptions = data.options.roles.filter((r) => !selected.department || data.cells.some((c) => c.department === selected.department && c.roles.includes(r)));
    filters.replaceChildren(select("Department", "department", [["", "All departments"], ...data.options.departments.map((v) => [v, v])], true),
      select("Job role", "role", [["", "All roles"], ...roleOptions.map((v) => [v, v])]), skills,
      select("Category", "category", [["all", "Skills & tools"], ["skill", "Skills"], ["tool", "Tools"]]),
      select("AI scenario", "scenario", [["assistive", "Assistive"], ["agentic", "Agentic"]]),
      h("button", { type: "button", class: "btn sm", onclick: () => { Object.assign(selected, { skill: new Set(), category: "all", scenario: "assistive", department: "", role: "" }); SELECTED.clear(); drawFilters(); load(); } }, "Reset filters"));
  }

  async function load() {
    const version = ++request;
    const params = new URLSearchParams({ scenario: selected.scenario, category: selected.category, department: selected.department, role: selected.role });
    if (selected.samplePreview) params.set("sample_preview", "true");
    selected.skill.forEach((value) => params.append("skill", value));
    status.textContent = "Loading workforce assessments…";
    output.setAttribute("aria-busy", "true"); refresh.disabled = true;
    try {
      const next = await api(`/api/hr/workforce?${params}`);
      if (version !== request || !root.isConnected) return;
      const hasHeatmap = next.cells?.some((c) => c.status === "ready");
      if (!selected.samplePreview && !selected.sampleDismissed && !hasHeatmap && next.sample_available) {
        selected.samplePreview = true; await load(); return;
      }
      const optionsChanged = !data || JSON.stringify(data.options) !== JSON.stringify(next.options);
      data = next;
      previewBanner.hidden = !next.policy.sample_preview && !selected.sampleDismissed;
      previewBanner.replaceChildren(...(next.policy.sample_preview ? [h("strong", {}, "SAMPLE DATA · PREVIEW ONLY"),
        h("span", {}, "40 fictional employees across five departments. Sample results are for demonstration and do not represent a real workforce."),
        h("button", { type: "button", class: "btn sm", onclick: () => { selected.samplePreview = false; selected.sampleDismissed = true; SELECTED.clear(); load(); } }, "View real assessments")]
        : selected.sampleDismissed ? [h("strong", {}, "REAL ASSESSMENTS"), h("span", {}, "Showing authorized stored workforce assessments for this organization."),
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
      card(common.length ? common.map((v) => v.skill).join(" · ") : "—", "Top shared gaps", common.map((v) => `${v.employees} below target`).join(" · ") || "No assessed gaps"));
    const matrix = data.groups.length && data.rows.length ? h("div", { class: "wf-matrix-grid", style: { "--wf-cols": data.groups.length } },
      h("div", { class: "wf-skill-head" }, "Required skill"),
      data.groups.map((g) => h("div", { class: "wf-group-head", title: g.label }, g.label)),
      data.rows.flatMap((row) => [h("div", { class: "wf-skill-name", title: row.skill }, row.skill), ...row.cells.map((c) => cellButton(c))]))
      : h("div", { class: "empty-state wf-empty" }, icon("upload"), h("h3", {}, "No assessments in this view"),
        h("p", {}, selected.samplePreview ? "The fictional preview has no matching assessed skills. Reset filters to see the full sample workforce." : "No authorized real assessments match these filters."),
        !selected.samplePreview ? h("a", { class: "btn primary sm", href: "#/run" }, "Analyse team") : null);
    const legend = h("div", { class: "wf-legend", "aria-label": "Skill gap severity legend" },
      Object.entries(SEVERITY).map(([key, [label, range]]) => h("span", {}, h("i", { class: `wf-${key}` }), `${label} · ${range}`)),
      h("span", {}, h("i", { class: "wf-unknown" }), "No assessment"));
    const teamButton = h("button", { type: "button", class: "btn primary", disabled: !SELECTED.size, onclick: createDialog },
      `Create team reskilling plan${SELECTED.size ? ` · ${SELECTED.size}` : ""}`);
    const heatmap = h("section", { class: "panel" }, h("header", { class: "wf-panel-header" }, h("div", {}, h("h2", {}, "Team skill gaps"),
      h("p", { class: "muted" }, "Each cell shows employees below their role’s target proficiency.")), teamButton),
      h("div", { class: "pad wf-matrix" }, matrix, legend,
        h("p", { class: "muted wf-policy" }, data.policy.sample_preview ? "Fictional data uses role-specific targets on a 0–5 scale. Select a cell to inspect it and add its gap to a draft team plan." : "Gap percentage is employees below their role-specific required proficiency divided by employees assessed for that skill. Missing assessments are excluded; assessed 0% is shown in green.")));
    const section = h("section", { class: "panel wf-team-plans" }, h("header", {}, h("h2", {}, "Team reskilling plans")),
      h("div", { class: "pad" }, plans.length ? plans.map((p) => h("article", { class: "wf-saved-plan" },
        h("div", {}, h("h3", {}, p.name), h("p", { class: "muted" }, `${p.cohort.employees} employees · ${p.cohort.department} · ${p.cohort.role}`),
          h("p", {}, `${p.skills.length} selected skill group${p.skills.length === 1 ? "" : "s"} · Draft for HR review${p.sample_preview ? " · Sample preview" : ""}`)),
        h("details", {}, h("summary", {}, "Review plan details"), h("ul", {}, p.skills.map((s) => h("li", {}, `${s.skill} · ${s.group}: ${s.affected}/${s.assessed} below target (${s.current}/5 → ${s.target}/5)`))),
          h("p", { class: "muted" }, "Learning action: guided applied practice and reassessment. Resource not configured.")))) : h("p", { class: "muted" }, "No team plans yet. Select heatmap gaps and create a draft for HR review.")));
    output.replaceChildren(stats, heatmap, section);
  }
  function cellButton(c) {
    const status = c.status === "ready" ? `${c.affected} of ${c.employees} employees` : "No assessment";
    return h("button", { type: "button", class: `wf-cell wf-${c.severity || "unknown"}${SELECTED.has(cellKey(c)) ? " is-selected" : ""}`,
      dataset: { group: c.group }, title: `${c.skill} · ${c.group}: ${status}`, "aria-label": `${c.skill}, ${c.group}: ${c.gap_percent ?? "No assessment"}${c.gap_percent != null ? `% · ${status}` : ""}`,
      onclick: () => detail(c) }, h("strong", {}, c.status === "ready" ? `${c.gap_percent}%` : "—"),
      h("span", {}, c.status === "ready" ? `${c.affected}/${c.employees} employees` : "No assessment"));
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
  function createDialog() {
    if (!SELECTED.size) return;
    const chosen = data.cells.filter((c) => SELECTED.has(cellKey(c)));
    const name = h("input", { class: "input", required: true, maxlength: "120", value: `${data.cohort.department} reskilling plan`, "aria-label": "Plan name" });
    let dialog;
    const save = h("button", { type: "button", class: "btn primary", onclick: async () => {
      if (!name.value.trim()) { name.focus(); return; }
      save.disabled = true;
      try {
        const result = await api("/api/hr/team-plans", { method: "POST", body: { name: name.value.trim(), scenario: selected.scenario, category: selected.category,
          department: selected.department, role: selected.role, gaps: chosen.map((c) => ({ skill: c.skill, group: c.group })), sample_preview: selected.samplePreview } });
        dialog.close(); SELECTED.clear(); await load();
      } catch (e) { error.textContent = `Could not save draft: ${e.message}`; save.disabled = false; }
    } }, "Confirm and save draft");
    const error = h("p", { class: "issue error", role: "alert" });
    dialog = h("dialog", { class: "wf-dialog", onclose: () => dialog.remove() }, h("div", { class: "wf-dialog-head" }, h("h2", {}, "Review team reskilling plan"),
      h("button", { type: "button", class: "btn sm", onclick: () => dialog.close() }, "Cancel")), h("div", { class: "wf-detail-body" },
      h("label", { class: "wf-select" }, h("span", {}, "Plan name"), name),
      h("p", {}, `Cohort: ${data.cohort.department} · ${data.cohort.role} · ${data.cohort.employees} employees`),
      h("h3", {}, "Selected gaps and target proficiency"), h("ul", {}, chosen.map((c) => h("li", {}, `${c.skill} · ${c.group}: ${c.current}/5 current → ${c.required}/5 target · ${c.affected}/${c.employees} below target`))),
      h("p", { class: "muted" }, "Each role gets a track for its gaps. Steps use guided applied practice and reassessment; no course resource is configured. Saving creates a draft for HR review, not an active assignment."),
      selected.samplePreview ? h("p", { class: "wf-sample-banner" }, "Sample preview only: do not assign this fictional plan to a real workforce.") : null,
      error, save));
    root.append(dialog); dialog.showModal();
  }
  async function loadPlans(version = request) {
    try { const result = await api("/api/hr/team-plans"); if (version !== request || !root.isConnected) return; plans = result; render(); }
    catch { /* Heatmap remains usable when plan listing is temporarily unavailable. */ }
  }
  await load();
}
