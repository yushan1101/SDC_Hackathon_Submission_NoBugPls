import { h, icon } from "./lib.js";
import { jobIcon } from "./jobicons.js";
import { rankMovements, rankScore, scenarioName } from "./ranking-state.js";

const RANK_HELP = "Used to order roles: scenario match × (1 + AI growth adjustment − automation pressure adjustment), then × 0.85 for a role one training level above yours. Native score, not a percentage or a score out of 100.";
const MATCH_HELP = "Estimated profile fit against this scenario's skill requirements: skill coverage, alignment and tool overlap, blended with résumé text similarity when supplied. AI trend weighting and the training penalty affect Rank Score separately.";
const matchScore = (value) => `${Math.round(value * 100)}%`;
let rankingInstance = 0;

export function roleRanking(initial, { title, note, scenario = "assistive", onScenario, renderDetails, compare } = {}) {
  let matches = [], active = scenario, requested = null, expanded = null, goal = null, rowId = 0;
  const id = ++rankingInstance, rows = new Map(), picked = new Set();
  const status = h("p", { class: "ranking-status", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  const explanation = h("p", { class: "ranking-scenario-note" });
  const error = h("div", { class: "issue error ranking-error", role: "alert", hidden: true });
  const compareHost = h("div"), filters = h("div", { class: "goal-filter" });
  const list = h("ol", { class: "ranking-list", "aria-label": "Roles ordered by Rank Score" });
  const scenSeg = onScenario ? h("div", { class: "seg", role: "group", "aria-label": "AI scenario for matches and suggestions" },
    ["assistive", "agentic"].map((key) => h("button", { type: "button", "data-scenario": key,
      "aria-pressed": String(active === key), onclick: () => {
        if (key !== (requested || active)) onScenario(key);
      } }, scenarioName(key)))) : null;
  const metricLabel = (label, help) => h("span", { class: "ranking-metric-label" }, label,
    h("span", { class: "ranking-info", "aria-hidden": "true", title: help }, icon("info")));
  const root = h("section", { class: "block ranking-block", "aria-label": "Career recommendations" },
    h("div", { class: "matches-head" }, h("h3", {}, title || "Career recommendations"), scenSeg),
    explanation, status, error,
    h("details", { class: "ranking-score-guide" }, h("summary", {}, "Why Rank Score and Match Score differ"),
      h("p", {}, RANK_HELP), h("p", {}, MATCH_HELP),
      h("p", {}, "A lower Match Score can rank higher when its AI outlook or training adjustment is more favourable. Equal ranking scores keep the order returned by the recommendation service.")),
    filters, compareHost,
    h("div", { class: "ranking-columns", "aria-hidden": "true" }, h("span", {}, "Rank"), h("span", {}, "Role · select to explore"),
      metricLabel("Rank Score", RANK_HELP), metricLabel("Match Score", MATCH_HELP), h("span")), list,
    h("p", { class: "note ranking-footnote" }, note || "Ordered by Rank Score. Scores use the existing model and scenario assumptions; they are estimates, not hiring probabilities. Select a role for its skills to learn, score explanation and next steps."));

  function drawSelector() {
    scenSeg?.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scenario === (requested || active))));
    explanation.textContent = active === "agentic"
      ? "Agentive AI: agents handle routine work; you guide them and check results. Assumed targets rise for judgement and oversight and fall for routine work; AI trends carry more weight."
      : "Assistive AI: you do the work with AI support. Uses baseline role skill targets and the existing AI trend weighting.";
  }
  function drawCompare() {
    const selected = matches.filter((m) => picked.has(m.soc));
    compareHost.replaceChildren(selected.length >= 2 ? compare(selected) : selected.length === 1
      ? h("p", { class: "note" }, "Select one more role to compare.") : "");
  }
  function filterRows() {
    for (const m of matches) rows.get(m.soc).el.hidden = !!goal && !(m.sdgs || []).some((g) => g.goal === goal);
    filters.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.goal || 0) === (goal || 0))));
  }
  function drawFilters() {
    const goals = [...new Map(matches.flatMap((m) => m.sdgs || []).map((g) => [g.goal, g])).values()].sort((a, b) => a.goal - b.goal);
    filters.hidden = goals.length <= 1 && !goal;
    filters.replaceChildren(h("span", { class: "muted" }, "UN goal:"),
      h("button", { class: "chip", type: "button", onclick: () => { goal = null; filterRows(); } }, "All"),
      ...goals.map((g) => h("button", { type: "button", class: "chip goal-chip", "data-goal": g.goal, style: { "--sdg": g.color },
        onclick: () => { goal = goal === g.goal ? null : g.goal; filterRows(); } }, `${g.goal} · ${g.short}`)));
  }
  function refreshDetails(row) {
    if (!row.dirty && row.details.childElementCount) return;
    const whyOpen = row.details.querySelector(".why-score")?.open;
    const sdgOpen = row.details.querySelector(".sdg-match-toggle")?.getAttribute("aria-expanded") === "true";
    const content = renderDetails(row.match);
    const pick = h("input", { type: "checkbox", checked: picked.has(row.match.soc), onchange: (e) => {
      if (e.target.checked && matches.filter((m) => picked.has(m.soc)).length >= 3) {
        e.target.checked = false; error.hidden = false; error.textContent = "Compare up to 3 roles at a time."; return;
      }
      e.target.checked ? picked.add(row.match.soc) : picked.delete(row.match.soc); drawCompare();
    } });
    row.details.replaceChildren(content, h("label", { class: "compare-pick" }, pick, "Compare this role"));
    if (whyOpen) row.details.querySelector(".why-score").open = true;
    if (sdgOpen) row.details.querySelector(".sdg-match-toggle")?.click();
    row.dirty = false;
  }
  function toggleRole(row) {
    expanded = expanded === row.match.soc ? null : row.match.soc;
    for (const [soc, item] of rows) {
      const open = soc === expanded;
      item.toggle.setAttribute("aria-expanded", String(open)); item.details.hidden = !open;
      item.el.classList.toggle("is-expanded", open);
      if (open) refreshDetails(item);
    }
  }
  function makeRow(m) {
    const rank = h("b", { class: "rank-position num" }), movement = h("span", { class: "rank-movement" });
    const name = h("b", { class: "ranking-title" }), badge = h("span", { class: "ranking-badge" });
    const rankValue = h("b", { class: "ranking-rank-value num" }), matchValue = h("span", { class: "ranking-match-value num" });
    const detailsId = `ranking-${id}-${++rowId}`;
    const details = h("div", { class: "ranking-details", id: detailsId, hidden: true });
    const row = { match: m, rank, movement, name, badge, rankValue, matchValue, details, dirty: true };
    row.toggle = h("button", { type: "button", class: "ranking-row-toggle", "aria-expanded": "false", "aria-controls": detailsId,
      onclick: () => toggleRole(row) },
      h("span", { class: "ranking-position" }, rank, movement),
      h("span", { class: "ranking-role" }, h("span", { class: "ranking-job-icon" }, jobIcon(m.soc, { size: 32 })), h("span", {}, name, badge)),
      h("span", { class: "ranking-metric rank-score" }, metricLabel("Rank Score", RANK_HELP), rankValue),
      h("span", { class: "ranking-metric match-score" }, metricLabel("Match Score", MATCH_HELP), matchValue),
      h("span", { class: "ranking-chevron", "aria-hidden": "true" }, icon("chevron")));
    row.el = h("li", { "data-role-id": m.soc }, row.toggle, details);
    return row;
  }
  root.setPending = (next) => {
    requested = next; list.setAttribute("aria-busy", "true"); error.hidden = true; drawSelector();
    status.textContent = `Updating ${scenarioName(next)}… Showing ${scenarioName(active)} until ready.`;
    status.classList.add("is-loading");
  };
  root.setError = (message) => {
    const failed = requested; requested = null; list.removeAttribute("aria-busy"); status.classList.remove("is-loading"); drawSelector();
    status.textContent = `Showing the last valid ${scenarioName(active)} ranking.`;
    error.hidden = false; error.replaceChildren(h("span", {}, message));
    if (failed) error.append(h("button", { type: "button", class: "btn sm", onclick: () => onScenario(failed) }, "Retry"));
  };
  root.update = (next, { scenario: nextScenario = active } = {}) => {
    const previous = matches, oldScenario = active, movements = rankMovements(previous, next);
    const before = new Map();
    for (const [soc, row] of rows) {
      before.set(soc, row.el.getBoundingClientRect().top);
      row.el.getAnimations?.().forEach((animation) => animation.cancel());
    }
    matches = next; active = nextScenario; requested = null; error.hidden = true;
    list.querySelector(".ranking-empty")?.remove();
    list.removeAttribute("aria-busy"); status.classList.remove("is-loading"); drawSelector();
    const present = new Set(next.map((m) => m.soc));
    for (const [soc, row] of rows) if (!present.has(soc)) { row.el.remove(); rows.delete(soc); }
    if (!present.has(expanded)) expanded = null;
    // Preserve comparison choices for roles that leave and later re-enter the top list.
    for (const m of next) {
      const row = rows.get(m.soc) || makeRow(m), move = movements.get(m.soc);
      rows.set(m.soc, row); row.match = m; row.dirty = true;
      row.rank.textContent = `#${move.to}`; row.name.textContent = m.title;
      row.rankValue.textContent = rankScore(m.score); row.matchValue.textContent = matchScore(m.fit);
      row.toggle.setAttribute("aria-label", `#${move.to} ${m.title}. Rank Score ${rankScore(m.score)}. Match Score ${matchScore(m.fit)}. ${move.kind === "new" ? "New in this ranking." : move.delta ? `Moved ${move.delta > 0 ? "up" : "down"} ${Math.abs(move.delta)} places.` : ""}`);
      row.badge.textContent = [m.emerging && "Emerging", m.under_pressure && "Automation pressure", m.stretch && "Stretch role"].filter(Boolean).join(" · ") || "ESCO occupation";
      row.movement.textContent = move.kind === "initial" ? "" : move.kind === "new" ? "New" : move.delta > 0 ? `↑ +${move.delta}` : move.delta < 0 ? `↓ −${-move.delta}` : "— 0";
      row.movement.setAttribute("aria-label", move.kind === "initial" ? "Initial ranking" : move.kind === "new" ? "New in this ranking"
        : move.delta === 0 ? "No ranking change" : `Moved ${move.delta > 0 ? "up" : "down"} ${Math.abs(move.delta)} places from number ${move.from}`);
      row.movement.className = `rank-movement movement-${move.kind}`;
      row.toggle.setAttribute("aria-expanded", String(expanded === m.soc)); row.details.hidden = expanded !== m.soc;
      if (expanded === m.soc) refreshDetails(row);
      list.append(row.el); // Stable DOM nodes move into the exact API order. Never sort by displayed scores.
    }
    drawFilters(); filterRows(); drawCompare();
    if (!next.length) list.append(h("li", { class: "ranking-empty" }, "No matches yet. Add a few more skills."));
    if (!previous.length) status.textContent = `${scenarioName(active)} · ${next.length} recommended roles. Select a role to explore.`;
    else {
      const moved = next.filter((m) => ["up", "down"].includes(movements.get(m.soc).kind));
      const entered = next.filter((m) => movements.get(m.soc).kind === "new").length;
      const left = previous.filter((m) => !present.has(m.soc)).length;
      const examples = moved.slice(0, 2).map((m) => `${m.title}: #${movements.get(m.soc).from} → #${movements.get(m.soc).to}`).join("; ");
      status.textContent = `${scenarioName(active)} · ${moved.length} ${moved.length === 1 ? "role changed position" : "roles changed positions"}${oldScenario !== active ? ` compared with ${scenarioName(oldScenario)}` : " since the last update"}. ${entered ? `${entered} new. ` : ""}${left ? `${left} left the top ${previous.length}. ` : ""}${examples || "The order of shared roles is unchanged; scores and skill gaps may still differ."}`;
    }
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches && previous.length) {
      for (const m of next) {
        const row = rows.get(m.soc), move = movements.get(m.soc);
        if (row.el.hidden) continue;
        const top = row.el.getBoundingClientRect().top, delta = before.has(m.soc) ? before.get(m.soc) - top : 0;
        if (move.kind !== "same" || delta) row.el.animate?.([
          { transform: `translateY(${delta}px)`, opacity: move.kind === "new" ? .4 : 1, backgroundColor: "var(--accent-soft)" },
          { transform: "translateY(0)", opacity: 1, backgroundColor: "var(--surface)" },
        ], { duration: 420, easing: "cubic-bezier(.2,.7,.2,1)" });
      }
    }
  };
  root.update(initial, { scenario });
  return root;
}
