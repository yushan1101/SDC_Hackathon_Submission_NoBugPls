// AiversePulse Enterprise (HR advisors): overview, upload + live team run, review queue, plans register.
import "./motion.js";  // GSAP animations for whatever the app renders
import { jobIcon } from "./jobicons.js";
import { api, stream, h, $, icon, toast, fmtTime, ApiError, SCENARIO_HELP } from "./lib.js";
import { Owl, OwlStatus } from "./owl.js";
import { gapsBlock, comparisonBlock, outlookBlock, planBlock, historyBlock, sourceItem, staticText, signalsBlock, sdgBlock } from "./blocks.js";
import { openingsView, openingDetail, signalsView } from "./recruit.js";
import { askPanel, modelsView, peopleView, pluginsView } from "./org.js";
import { setVoice } from "./voice.js";

const app = $("#app");
const AGENTS = ["supervisor", "profiler", "knowledge_search", "gap_analysis", "market_analyst", "pathway", "coach", "reviewer"];
const S = { me: null, meta: null, scenario: "assistive", status: null, rows: new Map(), needs: [], csv: null, plans: [], sel: null };

// ---------------------------------------------------------------- boot / sign in
async function boot() {
  try { S.me = await api("/api/me"); } catch (e) {
    if (e instanceof ApiError && e.status === 401) return location.replace("./#/signin");  // one sign-in page for everyone; it sends HR advisors back here
    throw e;
  }
  if (S.me.role === "employee") { location.replace("./"); return; }
  if (S.me.role === "admin") { location.replace("admin.html"); return; }
  app.replaceChildren(h("main", { style: { display: "grid", "place-items": "center", "min-height": "100dvh", gap: "12px", "align-content": "center" }, "aria-busy": "true" },
    new Owl({ size: 72, state: "searching" }).el, h("p", { class: "muted" }, "Loading…")));
  S.meta = await api("/api/meta");
  setVoice(S.meta.voice);
  shell();
  addEventListener("hashchange", route);
  addEventListener("keydown", keys);
  route();
}


// ---------------------------------------------------------------- shell
function shell() {
  S.status = new OwlStatus({ size: 32, say: "Ready" });
  const link = (href, label, ic) => h("a", { href, "data-route": href, "aria-label": label, title: label }, icon(ic), h("span", { class: "lbl" }, label));
  const tab = (href, label, ic) => h("a", { href, "data-route": href }, icon(ic), label);
  S.badge = h("span", { class: "badge", hidden: true });
  S.seg = h("div", { class: "seg scenario-switch", role: "group", "aria-label": "AI scenario" },
    ["assistive", "agentic"].map((k) => h("button", { type: "button", "aria-pressed": String(S.scenario === k),
      title: SCENARIO_HELP[k], "aria-description": SCENARIO_HELP[k],
      onclick: (e) => { S.scenario = k; S.seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); S.onScenarioChange?.(); } },
      k === "assistive" ? "Assistive" : "Agentic")));
  S.crumb = h("div", { class: "crumb" });
  const review = link("#/review", "Review", "review"); review.append(S.badge);
  const more = h("div", { id: "hr-more", class: "hr-more", popover: "auto", "aria-label": "Additional pages" },
    h("a", { href: "#/openings", onclick: () => more.hidePopover?.() }, icon("people"), "Hiring"),
    h("a", { href: "#/plugins", onclick: () => more.hidePopover?.() }, icon("plug"), "Hiring plugins"),
    h("a", { href: "#/people", onclick: () => more.hidePopover?.() }, icon("user"), "Team members"),
    h("a", { href: "#/models", onclick: () => more.hidePopover?.() }, icon("model"), "AI models"),
    h("a", { href: "#/signals", onclick: () => more.hidePopover?.() }, icon("pulse"), "AI trends"),
    h("a", { href: "./#/account" }, icon("user"), "Plan & billing"),
    h("button", { type: "button", onclick: signOut }, icon("out"), "Sign out"));
  app.replaceChildren(h("div", { class: "hr-shell" },
    h("nav", { class: "rail", "aria-label": "Primary" },
      h("a", { class: "logo", href: "#/overview", "aria-label": "AiversePulse Enterprise home" }, S.logo = h("span", { class: "logo-owl" }), h("span", { class: "lbl wordmark" }, "AiversePulse")),
      link("#/overview", "Overview", "grid"), link("#/run", "Analyse team", "upload"), review, link("#/plans", "Plans", "history"),
      link("#/openings", "Hiring", "people"), link("#/plugins", "Hiring plugins", "plug"), link("#/people", "Team members", "user"), link("#/models", "AI models", "model"),
      link("#/signals", "AI trends", "pulse"),
      h("div", { style: { flex: 1 } }),
      h("a", { href: "./#/account", "aria-label": "Plan & billing", title: "Plan & billing" }, icon("user"), h("span", { class: "lbl" }, "Plan & billing")),
      h("a", { href: "#", onclick: (e) => { e.preventDefault(); signOut(); } }, icon("out"), h("span", { class: "lbl" }, "Sign out"))),
    h("header", { class: "hr-top" }, S.crumb, S.status.el,
      h("div", { class: "who" }, h("div", {}, S.me.display_name), h("div", { class: "muted" }, "HR advisor"))),
    h("main", { id: "main", class: "hr-main", tabindex: "-1" }),
    h("nav", { class: "hr-tabbar", "aria-label": "Primary" }, tab("#/overview", "Overview", "grid"), tab("#/run", "Analyse", "upload"),
      tab("#/review", "Review", "review"), tab("#/plans", "Plans", "history"),
      h("button", { type: "button", class: "hr-more-button", popovertarget: "hr-more", "data-route": "#/more",
        "aria-haspopup": "true", "aria-label": "More pages" }, icon("grid"), "More")),
    more));
  // the owl lives in the rail's logo spot; on phones (no rail) it moves back next to the status text
  const narrow = matchMedia("(max-width: 767px)");
  const place = () => (narrow.matches ? S.status.el.prepend(S.status.owl.el) : S.logo.append(S.status.owl.el));
  narrow.addEventListener("change", place);
  place();
  crumb();
  refreshPlans();
}

function crumb(page = (location.hash.split("/")[1] || "overview")) {
  const names = { overview: "Overview", run: "Analyse team", review: "Review queue", plans: "Plans register", openings: "Openings & screening", signals: "AI trends", plugins: "Hiring plugins", people: "Team members", models: "AI models" };
  S.crumb.replaceChildren(names[page] || "Overview");
}

async function signOut() { await api("/api/logout", { method: "POST" }).catch(() => {}); location.reload(); }

async function refreshPlans() {
  S.plans = await api("/api/plans");
  const open = S.plans.filter((p) => p.audience === "hr" && !p.review?.archived && p.review?.review_status === "pending").length;
  S.badge.hidden = !open; S.badge.textContent = open;
  return S.plans;
}

function route() {
  const hash = location.hash || "#/overview";
  const [page = "overview", id, ...extra] = hash.startsWith("#/") ? hash.slice(2).split("/") : [];
  const pages = new Set(["overview", "run", "review", "plans", "openings", "signals", "plugins", "people", "models"]);
  if (!pages.has(page) || extra.length || (id && !["review", "plans", "openings", "plugins"].includes(page))) {
    location.replace("#/overview");
    return;
  }
  document.querySelectorAll("[data-route]").forEach((a) => {
    const dest = a.dataset.route;
    const active = dest === "#/more" ? ["openings", "signals", "plugins", "people", "models"].includes(page) :
      hash === dest || hash.startsWith(dest + "/");
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  crumb(page);
  S.onScenarioChange = null;
  const main = $("#main");
  S.routeVersion = (S.routeVersion || 0) + 1;
  main.scrollTop = 0;
  const views = { run: runView, review: () => reviewView(main, id), plans: () => plansView(main, id),
    openings: () => (id ? openingDetail(main, id, S.status) : openingsView(main, S.status)), signals: () => signalsView(main, S.status),
    plugins: () => pluginsView(main, S.status, id), people: () => peopleView(main, S.status), models: () => modelsView(main, S.status) };
  Promise.resolve((views[page] || overview)(main)).catch((e) => {
    main.replaceChildren(h("div", { class: "view" }, h("div", { class: "issue error", role: "alert" }, e.message)));
  });
}

function keys(e) {
  if (!location.hash.startsWith("#/review") || e.target.closest("dialog") || /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.key !== "j" && e.key !== "k") return;
  const items = [...document.querySelectorAll(".queue-item")];
  const i = items.findIndex((x) => x.getAttribute("aria-current") === "true");
  items[Math.max(0, Math.min(items.length - 1, i + (e.key === "j" ? 1 : -1)))]?.click();
}

// ---------------------------------------------------------------- overview
function strip(row) {
  const done = row.status && row.status !== "running";
  return h("span", { class: `agents ${done ? (row.status === "flagged" ? "flag" : "done") : ""}`, role: "img",
    "aria-label": `${row.ticks.size} of 8 agents finished` }, AGENTS.map((a) => h("i", { class: row.ticks.has(a) ? "on" : "", title: a })));
}

function stats() {
  const latest = S.plans.filter((p) => p.audience === "hr" && !p.review?.archived);
  const cell = (n, label, ic, cls = "") => h("div", { class: `stat ${cls}` }, h("span", { class: "stat-ic" }, icon(ic)), h("b", {}, n), h("span", {}, label));
  return h("div", { class: "stats" },
    cell(new Set(latest.map((p) => p.subject_id)).size, "Employees", "people"),
    cell(latest.filter((p) => p.status === "draft").length, "To review", "clock"),
    cell(latest.filter((p) => p.status === "flagged").length, "Flagged", "flag", "flag"),
    cell(latest.filter((p) => p.status === "approved").length, "Approved", "check", "ok"));
}

function needsPanel() {
  const max = Math.max(1, ...S.needs.map((n) => n.employees_with_gap));
  return h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Team training priorities"), h("span", { class: "info", title: "Aggregated across the team; individuals are never ranked.", "aria-label": "Aggregated across the team; individuals are never ranked.", role: "img" }, icon("info"))),
    h("div", { class: "pad" }, S.needs.length ? h("div", { class: "bars" }, S.needs.slice(0, 10).map((n) => h("div", { class: "bar-row" },
      h("span", {}, n.skill_id), h("div", { class: "track" }, h("div", { class: "fill", style: { transform: `scaleX(${n.employees_with_gap / max})` } })),
      h("span", { class: "num" }, n.employees_with_gap))))
      : h("div", { class: "empty-state" }, h("span", { class: "stat-ic" }, icon("upload")), h("p", {}, "No team analysed yet. Select Analyse team to start."))));
}

function rosterTable() {
  const rows = [...S.rows.values()];
  if (!rows.length) return null;
  return h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Employees in this run"), h("span", { class: "muted num", style: { "font-size": "14px" } }, `${rows.filter((r) => r.status !== "running").length}/${rows.length} done`)),
    h("div", { class: "table-wrap" }, h("table", { class: "data" },
      h("thead", {}, h("tr", {}, h("th", {}, "Employee"), h("th", {}, "Target role"), h("th", { class: "n hide-sm" }, "h/week"), h("th", {}, "Agents"), h("th", { class: "hide-sm" }, "Top gaps"), h("th", {}, "Status"))),
      h("tbody", {}, rows.map((r) => h("tr", { "data-href": r.plan_id ? `#/review/${r.plan_id}` : null, onclick: () => r.plan_id && (location.hash = `#/review/${r.plan_id}`) },
        h("td", { class: "mono" }, r.id), h("td", {}, h("span", { class: "job-line" }, r.soc ? jobIcon(r.soc, { size: 28, labelled: true }) : null, r.role)), h("td", { class: "n hide-sm" }, r.hours ?? "–"), h("td", {}, strip(r)),
        h("td", { class: "hide-sm" }, r.top_gaps?.join(", ") || "–"),
        h("td", {}, r.status === "running" ? h("span", { class: "muted" }, "running") : h("span", { class: `tag ${r.status}` }, r.error ? "error" : r.status))))))));
}

// newest plan per employee, so a re-run doesn't list the same person twice
const latestPerEmployee = (plans) => [...plans.reduce((m, p) => (!m.has(p.subject_id) || m.get(p.subject_id).created_utc < p.created_utc ? m.set(p.subject_id, p) : m), new Map()).values()];

async function overview(main) {
  const version = S.routeVersion;
  await refreshPlans();
  if (version !== S.routeVersion) return;
  main.replaceChildren(h("div", { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "Overview"), h("a", { class: "btn primary sm", href: "#/run" }, icon("upload"), "Analyse team")),
    stats(), askPanel(S.status, S.me.effective_plan), h("div", { class: "overview" }, needsPanel(),
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Needs your review")),
        h("div", { class: "pad review-list" }, latestPerEmployee(S.plans.filter((p) => p.audience === "hr" && !p.review?.archived && p.review?.review_status === "pending")).slice(0, 6).map((p) =>
          h("a", { href: `#/review/${p.plan_id}`, class: "review-row" },
            h("span", { class: "who" }, h("b", {}, p.subject_id), h("span", { class: "muted" }, `${p.target_role} · v${p.version} · ${fmtTime(p.created_utc)}`)), h("span", { class: `tag ${p.status}` }, p.status))),
          S.plans.some((p) => p.audience === "hr" && p.status !== "approved") ? null : h("p", { class: "muted" }, "You're all caught up.")))),
    rosterTable()));
}

// ---------------------------------------------------------------- upload & run
function runView(main) {
  S.onScenarioChange = () => { if (S.csv) setCsv(S.csv, "current file"); };
  const preview = h("div");
  const schema = h("ul", { class: "schema", "aria-label": "Required columns" });
  const errors = h("ul", { class: "errors", role: "alert" });
  const runBtn = h("button", { class: "btn primary", type: "button", disabled: !S.csv || S.running ? true : null, onclick: run }, "Run analysis");
  const live = h("div", { style: { display: "grid", gap: "16px" } });
  const file = h("input", { type: "file", accept: ".csv,text/csv", class: "sr-only", onchange: (e) => load(e.target.files[0]) });
  const drop = h("label", { class: "drop", ondragover: (e) => { e.preventDefault(); drop.classList.add("over"); },
    ondragleave: () => drop.classList.remove("over"), ondrop: (e) => { e.preventDefault(); drop.classList.remove("over"); load(e.dataTransfer.files[0]); } },
    file, icon("upload"), h("strong", {}, "Drop a team CSV or choose a file"),
    h("span", { class: "muted mono", style: { "font-size": "14px" } }, "employee_id, target_role, weekly_hours, skill, level"),
    h("span", { class: "muted", style: { "font-size": "14px" } }, "target_role: any ESCO job title or code · max 5,000 rows · 500 employees · pseudonymous IDs only"));

  async function load(f) {
    if (!f) return;
    if (f.size > 2_000_000) { toast("File is larger than 2 MB.", "err"); return; }
    setCsv(await f.text(), f.name);
  }
  async function setCsv(text, name) {
    S.csv = text;
    const lines = text.trim().split(/\r?\n/);
    const head = lines[0].split(",").map((s) => s.trim());
    schema.replaceChildren(...["employee_id", "target_role", "weekly_hours", "skill", "level"].map((c) => h("li", { class: head.includes(c) ? "ok" : "bad" }, c)));
    preview.replaceChildren(h("p", { class: "muted", style: { "font-size": "14px" } }, `${name} · ${lines.length - 1} rows`),
      h("div", { class: "table-wrap", style: { "max-height": "220px" } }, h("table", { class: "data" },
        h("thead", {}, h("tr", {}, head.map((c) => h("th", {}, c)))),
        h("tbody", {}, lines.slice(1, 9).map((l) => h("tr", {}, l.split(",").map((c) => h("td", { class: "mono" }, c))))))));
    const v = await api("/api/team/validate", { method: "POST", body: { csv: text, scenario: S.scenario } }).catch((e) => ({ errors: [e.message] }));
    errors.replaceChildren(...(v.errors || []).map((e) => h("li", {}, e)));
    runBtn.disabled = !!v.errors?.length || S.running;
    runBtn.textContent = v.errors?.length ? "Fix the errors to run" : `Run analysis for ${v.employees} employees`;
    S.status.set(v.errors?.length ? "confused" : "idle", v.errors?.length ? `${v.errors.length} problems in the file` : `${v.employees} employees ready`);
  }
  async function run() {
    S.running = true; runBtn.disabled = true;
    S.rows = new Map(); S.needs = [];
    const redraw = () => live.replaceChildren(needsPanel(), rosterTable() || h("p", { class: "muted" }, "Starting…"));
    redraw();
    let raf = 0;
    const soon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(redraw); };
    try {
      await stream("/api/team", { csv: S.csv, scenario: S.scenario }, (ev) => {
        if (ev.t === "owl") S.status.set(ev.state, ev.say);
        else if (ev.t === "roster") ev.ids.forEach((id) => S.rows.set(id, { id, role: ev.roles[id], status: "running", ticks: new Set() }));
        else if (ev.t === "tick") S.rows.get(ev.id)?.ticks.add(ev.node);
        else if (ev.t === "employee") Object.assign(S.rows.get(ev.id), ev, { status: ev.error ? "flagged" : ev.status, ticks: new Set(AGENTS) });
        else if (ev.t === "needs") S.needs = ev.data;
        else if (ev.t === "done") toast(ev.flagged.length ? `${ev.flagged.length} drafts flagged for manual fixes` : "All drafts are ready for review");
        soon();
      });
      await refreshPlans();
      live.append(h("a", { class: "btn primary", href: "#/review" }, "Open review queue"));
    } catch (e) {
      S.status.set("confused", "Run failed");
      errors.replaceChildren(...(e.body?.errors || [e.message]).map((x) => h("li", {}, x)),
        ...(e.status === 402 ? [h("li", {}, h("a", { class: "btn sm primary", href: "./#/pricing" }, "See the Team plan"))] : []));
    } finally { S.running = false; }
  }

  main.replaceChildren(h("div", { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "Analyse your team"),
      h("div", { class: "run-actions" }, S.seg,
        h("button", { class: "btn sm", type: "button", onclick: async () => setCsv((await api("/api/sample-team")).csv, "sample_team.csv (fictional)") }, "Use sample CSV"))),
    h("div", { class: "overview" },
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Team file")), h("div", { class: "pad", style: { display: "grid", gap: "14px" } }, drop, preview)),
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Checks")),
        h("div", { class: "pad", style: { display: "grid", gap: "14px" } }, schema, errors,
          runBtn, h("p", { class: "muted", style: { "font-size": "14px" } }, "Employees are analysed in parallel. Plans stay drafts until you approve them.")))),
    live));
  if (S.csv) setCsv(S.csv, "current file");
}

// ---------------------------------------------------------------- review queue (three panes)
async function reviewView(main, id) {
  const version = S.routeVersion;
  const request = S.reviewRequest = (S.reviewRequest || 0) + 1;
  await refreshPlans();
  if (version !== S.routeVersion || request !== S.reviewRequest) return;
  let filter = S.reviewFilter || "active";
  const target = id && S.plans.find((p) => p.plan_id === id);
  if (id && !target) { location.replace("#/review"); return; }
  if (target && (target.review.archived ? !["all", "archived"].includes(filter) : !["active", "all", target.review.review_status].includes(filter))) filter = target.review.archived ? "archived" : "all";
  S.reviewFilter = filter;
  const shown = await api(`/api/reviews?status=${filter}&q=${encodeURIComponent(S.reviewSearch || "")}`);
  if (version !== S.routeVersion || request !== S.reviewRequest) return;
  id = id || shown[0]?.plan_id;
  const selected = new Set();
  const redraw = () => reviewView(main).catch((e) => toast(e.message, "err"));
  const navigate = () => { if (location.hash === "#/review") return redraw(); else location.hash = "#/review"; };
  const search = h("input", { class: "input", type: "search", value: S.reviewSearch || "", placeholder: "Search employees or roles", "aria-label": "Search reviews" });
  const seg = h("select", { class: "input", "aria-label": "Review status", onchange: (e) => { S.reviewFilter = e.target.value; navigate(); } },
    [["active", "All active"], ["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["archived", "Archived"], ["all", "All including archived"]].map(([k, l]) => h("option", { value: k, selected: k === filter }, l)));
  const count = h("span", { role: "status" }, "0 selected");
  const boxes = [];
  const bulkButtons = ["archive", "restore", "delete"].map((action) => h("button", { class: "btn sm", disabled: true,
    onclick: () => reviewAction(main, [...selected], action, navigate) }, action[0].toUpperCase() + action.slice(1)));
  function selection() { count.textContent = `${selected.size} selected`; bulkButtons.forEach((b) => b.disabled = !selected.size || selected.size > 50); }
  const all = h("input", { type: "checkbox", "aria-label": "Select visible reviews", onchange: (e) => { boxes.forEach(([box, pid]) => { box.checked = e.target.checked; if (box.checked) selected.add(pid); else selected.delete(pid); }); selection(); } });
  const queue = h("nav", { class: "queue", "aria-label": "Review queue" },
    h("header", {}, h("span", {}, `${shown.length} plans`), h("span", { class: "mono hide-sm" }, "J / K")),
    h("form", { class: "review-tools", onsubmit: (e) => { e.preventDefault(); S.reviewSearch = search.value; navigate(); } }, search, h("button", { class: "btn sm", type: "submit" }, "Search"), seg),
    h("div", { class: "review-tools" }, h("label", {}, all, " Select visible"), count, ...bulkButtons, h("small", { class: "muted" }, "Up to 50 per action")),
    shown.length ? shown.map((p) => {
      const box = h("input", { type: "checkbox", "aria-label": `Select ${p.review.candidate_name || p.subject_id}`, onchange: () => { if (box.checked) selected.add(p.plan_id); else selected.delete(p.plan_id); all.checked = selected.size === shown.length; all.indeterminate = selected.size > 0 && selected.size < shown.length; selection(); } });
      boxes.push([box, p.plan_id]);
      return h("div", { class: "review-entry" }, box, h("button", { class: "queue-item", "aria-current": String(p.plan_id === id),
      onclick: () => { location.hash = `#/review/${p.plan_id}`; } },
      h("span", { class: "l1" }, h("span", { class: "id" }, p.review.candidate_name || p.subject_id), reviewBadge(p.review)),
      h("span", { class: "l2" }, `${p.subject_id} · ${p.target_role} · v${p.version}`)),
      reviewMenu(main, p.plan_id, p.review, () => editReview(main, p.plan_id, p.review, navigate), navigate)); })
      : h("div", { class: "empty" }, h("p", { class: "muted" }, "No reviews match this search and status.")));
  const detail = h("section", { class: "detail", "aria-label": "Plan detail" });
  const aside = h("aside", { class: "aside", "aria-label": "Evidence and audit" });
  const wrap = h("div", { class: "review", "data-pane": location.hash.split("/")[2] ? "detail" : "list" }, queue, detail, aside);
  main.replaceChildren(wrap);
  if (id) loadDetail(id, detail, aside, wrap);
}

function reviewBadge(review) {
  const status = review.archived ? "archived" : review.review_status;
  return h("span", { class: `tag ${status}` }, status[0].toUpperCase() + status.slice(1));
}

function planStatusControl(main, plan, done) {
  const select = h("select", { class: "input", "aria-label": `Plan status for ${plan.subject_id}`,
    onclick: (e) => e.stopPropagation(), onkeydown: (e) => e.stopPropagation(),
    onchange: (e) => {
      const next = e.target.value;
      e.target.value = plan.status;
      if (next !== plan.status) confirmPlanStatus(main, plan, next, done);
    } }, ["draft", "flagged", "approved"].map((status) => h("option", {
      value: status, selected: status === plan.status, disabled: status === "approved" && plan.status === "flagged"
    }, status[0].toUpperCase() + status.slice(1))));
  return select;
}

function confirmPlanStatus(main, plan, next, done) {
  const dialog = reviewDialog(main, "Confirm plan status change");
  const label = (value) => value[0].toUpperCase() + value.slice(1);
  const submit = h("button", { class: "btn primary", type: "submit" }, "Confirm change");
  const cancel = h("button", { class: "btn", type: "button", onclick: () => dialog.close() }, "Cancel");
  let busy = false;
  dialog.addEventListener("cancel", (e) => { if (busy) e.preventDefault(); });
  dialog.append(h("form", { class: "review-form", onsubmit: async (e) => {
    e.preventDefault(); if (busy) return;
    busy = true; submit.disabled = cancel.disabled = true;
    try {
      await api(`/api/plans/${plan.plan_id}/status`, { method: "POST", body: { status: next, version: plan.version, confirmed: true } });
      dialog.close(); toast(`Plan status changed to ${label(next)}`); await done();
    } catch (err) { toast(err.message, "err"); }
    finally { busy = false; submit.disabled = cancel.disabled = false; }
  } }, h("h2", {}, "Change plan status?"),
    h("p", {}, `${plan.subject_id}: ${label(plan.status)} → ${label(next)}.`),
    h("p", { class: "muted" }, next === "approved" ? "Confirm that you have reviewed and approve this plan. This decision will be recorded in its audit history." : "This creates a new plan version and records your decision in the audit history. Previous versions and AI analysis are preserved."),
    h("div", { class: "filters" }, cancel, submit)));
  dialog.showModal();
}

function reviewMenu(main, pid, review, edit, done) {
  return h("details", { class: "review-menu" }, h("summary", { "aria-label": "Review actions", title: "Review actions" }, "⋯"),
    h("div", { class: "review-menu-items" }, h("button", { class: "btn sm", onclick: edit }, "Edit review"),
      ...[review.archived ? "restore" : "archive", "delete"].map((action) => h("button", { class: "btn sm", onclick: () => reviewAction(main, [pid], action, done) }, action[0].toUpperCase() + action.slice(1)))));
}

function reviewDialog(main, title) {
  const dialog = h("dialog", { class: "review-dialog", "aria-label": title });
  dialog.addEventListener("close", () => dialog.remove());
  main.append(dialog);
  return dialog;
}

function reviewAction(main, ids, action, done) {
  const title = `${action[0].toUpperCase() + action.slice(1)} ${ids.length} review${ids.length === 1 ? "" : "s"}?`;
  const dialog = reviewDialog(main, title);
  const submit = h("button", { class: "btn primary", type: "submit" }, "Confirm " + action);
  const cancel = h("button", { class: "btn", type: "button", onclick: () => dialog.close() }, "Cancel");
  let busy = false;
  dialog.addEventListener("cancel", (e) => { if (busy) e.preventDefault(); });
  dialog.append(h("form", { class: "review-form", onsubmit: async (e) => {
    e.preventDefault(); if (busy) return; busy = true; submit.disabled = cancel.disabled = true;
    try { await api("/api/reviews/bulk", { method: "POST", body: { plan_ids: ids, action, confirmed: true } });
      dialog.close(); toast(`${ids.length} review(s): ${action} completed`); await done();
    } catch (err) { toast(err.message, "err"); } finally { busy = false; submit.disabled = cancel.disabled = false; }
  } }, h("h2", {}, title), h("p", {}, action === "delete" ? "Reviews will be removed from normal views. AI analysis and audit history are retained. Deleted reviews cannot be restored from this queue; use Archive if you may need them again." : action === "archive" ? "Reviews will move to Archived. Their previous review status is preserved." : "Reviews will return to the active queue with their previous status."), h("div", { class: "filters" }, cancel, submit)));
  dialog.showModal();
}

function editReview(main, pid, review, done) {
  const dialog = reviewDialog(main, "Edit candidate review");
  const inputs = {};
  const fields = [["candidate_name", "Candidate name", "text", 120], ["candidate_email", "Email", "email", 254], ["candidate_phone", "Phone", "tel", 50], ["reviewer_notes", "Reviewer notes", "textarea", 10000]];
  const form = h("form", { class: "review-form" }, h("h2", {}, "Edit candidate review"),
    h("p", { class: "muted" }, "HR review details are saved separately from the original AI analysis and plan approval."),
    fields.map(([key, label, type, max]) => {
      inputs[key] = type === "textarea" ? h("textarea", { class: "input", rows: 5, maxlength: max }, review[key]) : h("input", { class: "input", type, maxlength: max, value: review[key] });
      return h("label", { class: "field" }, h("span", {}, label), inputs[key]);
    }));
  inputs.review_status = h("select", { class: "input" }, ["pending", "approved", "rejected"].map((s) => h("option", { value: s, selected: s === review.review_status }, s[0].toUpperCase() + s.slice(1))));
  const submit = h("button", { class: "btn primary", type: "submit" }, "Save review");
  form.append(h("label", { class: "field" }, h("span", {}, "Review status"), inputs.review_status),
    h("div", { class: "filters" }, h("button", { class: "btn", type: "button", onclick: () => dialog.close() }, "Cancel"), submit));
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); if (submit.disabled) return; submit.disabled = true;
    try { await api(`/api/reviews/${pid}/edit`, { method: "POST", body: { ...Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim()])), revision: review.revision } });
      dialog.close(); toast("Review saved"); await done();
    } catch (err) { toast(err.message, "err"); } finally { submit.disabled = false; }
  });
  dialog.append(form); dialog.showModal();
}

async function loadDetail(id, detail, aside, wrap) {
  detail.replaceChildren(h("div", { class: "detail-body" }, h("p", { class: "muted" }, "Loading…")));
  let d;
  try { d = await api(`/api/plans/${id}`); } catch (e) { detail.replaceChildren(h("div", { class: "detail-body" }, h("div", { class: "issue error" }, e.message))); return; }
  if (!detail.isConnected) return;
  const r = d.report;
  const toggleAside = h("button", { class: "btn sm ev-toggle", type: "button", "aria-expanded": "false", onclick: (e) => { e.currentTarget.setAttribute("aria-expanded", String(aside.classList.toggle("open"))); } }, icon("sources"), "Evidence");
  const body = h("div", { class: "detail-body" },
    h("a", { class: "btn ghost sm back", href: "#/review" }, icon("back"), "Queue"),
    h("section", { class: "block" }, h("div", { class: "detail-head" }, h("h2", {}, d.review.candidate_name || d.subject_id), reviewBadge(d.review),
      reviewMenu($("#main"), id, d.review, () => editReview($("#main"), id, d.review, () => reviewView($("#main"), id)), () => {
        if (location.hash === "#/review") return reviewView($("#main"));
        location.hash = "#/review";
      })),
      h("p", { class: "muted" }, [d.review.candidate_email, d.review.candidate_phone].filter(Boolean).join(" · ")),
      h("p", { class: "review-notes" }, d.review.reviewer_notes || "No reviewer notes yet.")),
    h("div", { class: "detail-head" }, h("h2", {}, h("span", { class: "id" }, d.subject_id), " / ", d.plan.target_role),
      h("span", { class: `tag ${d.status}` }, d.status), h("span", { class: "num muted" }, `v${d.version}`), h("span", { style: { flex: 1 } }), toggleAside),
    d.status === "flagged" ? h("div", { class: "banner flag", role: "alert" }, h("strong", {}, "Flagged."), h("span", {}, "Fix the issues below and save a new draft before approval.")) : null,
    r ? h("section", { class: "block" }, h("h3", {}, "Summary"), staticText(r.narrative, (cid) => { aside.classList.add("open"); document.getElementById(`src-${cid}`)?.scrollIntoView({ block: "nearest" }); })) : h("p", { class: "muted" }, "The full analysis isn't available for this plan. The plan and audit trail below are complete."),
    r?.issues?.filter((i) => i.severity === "error").map((i) => h("div", { class: "issue error" }, i.message)),
    r?.gaps?.length ? gapsBlock(r.gaps) : null,
    r?.comparison?.length ? comparisonBlock(r.comparison, d.plan.scenario) : null,
    r?.outlook ? outlookBlock(r.outlook) : null,
    r?.signals ? signalsBlock(r.signals) : null,
    r?.sdgs?.length ? sdgBlock(r.sdgs) : null,
    planBlock({ planId: id, plan: d.plan, version: d.version, status: d.status, weeklyHours: null, progress: d.progress, evidence: d.report?.evidence,
      approverLabel: "I have reviewed this plan", title: "90-day plan", onChange: async (next) => {
        if (next === "approved") S.status.set("celebrating", `${d.subject_id} approved`);
        await reviewView($("#main"), id);
      } }));
  detail.replaceChildren(body);
  aside.replaceChildren(
    h("header", {}, h("span", {}, "Evidence"), h("span", { class: "num" }, r ? r.evidence.length : 0)),
    h("section", {}, r ? r.evidence.map(sourceItem) : h("p", { class: "muted" }, "No sources available.")),
    h("header", {}, h("span", {}, "Audit trail"), h("span", {}, "UTC")),
    h("section", {}, historyBlock(d.history)),
    h("header", {}, h("span", {}, "HR review history")),
    h("section", {}, d.review_history.map((event) => h("details", {},
      h("summary", {}, `${event.action} by ${event.actor} · ${fmtTime(event.at_utc)}`),
      h("pre", { class: "review-notes" }, JSON.stringify({ before: event.before, after: event.after }, null, 2))))));
}

// ---------------------------------------------------------------- plans register
async function plansView(main, id) {
  const version = S.routeVersion;
  await refreshPlans();
  if (version !== S.routeVersion) return;
  const q = h("input", { class: "input", type: "search", placeholder: "Search employee or role", "aria-label": "Search plans", oninput: draw });
  const st = h("select", { class: "input", "aria-label": "Status", onchange: draw },
    ["all", "draft", "flagged", "approved"].map((s) => h("option", { value: s }, s === "all" ? "All statuses" : s)));
  const tbody = h("tbody");
  const drawer = h("dialog", { class: "drawer", "aria-label": "Plan history" });
  function draw() {
    const term = q.value.trim().toLowerCase();
    const rows = S.plans.filter((p) => p.audience === "hr" && (st.value === "all" || p.status === st.value)
      && (!term || `${p.subject_id} ${p.target_role}`.toLowerCase().includes(term)));
    tbody.replaceChildren(...rows.map((p) => h("tr", { "data-href": "1", tabindex: "0", onclick: () => { location.hash = `#/plans/${p.plan_id}`; }, onkeydown: (e) => e.key === "Enter" && (location.hash = `#/plans/${p.plan_id}`) },
      h("td", { class: "mono" }, p.plan_id), h("td", { class: "mono" }, p.subject_id), h("td", {}, p.target_role), h("td", { class: "hide-sm" }, p.scenario),
      h("td", { class: "n" }, `v${p.version}`), h("td", {}, h("div", { class: "plan-status-control" },
        h("span", { class: `tag ${p.status}` }, p.status), planStatusControl(main, p, async () => { await refreshPlans(); if (main.contains(tbody)) draw(); }))),
      h("td", { class: "mono hide-sm" }, fmtTime(p.created_utc)))));
  }
  async function open(p) {
    const d = await api(`/api/plans/${p.plan_id}`);
    if (!main.contains(drawer)) return;
    drawer.replaceChildren(h("div", { class: "panel", style: { border: 0, height: "100%", display: "grid", "grid-template-rows": "auto 1fr" } },
      h("header", {}, h("h2", {}, h("span", { class: "mono" }, d.subject_id), ` · ${d.plan.target_role}`), h("button", { class: "btn sm", onclick: () => drawer.close() }, "Close")),
      h("div", { class: "pad", style: { overflow: "auto", display: "grid", gap: "16px", "align-content": "start" } },
        h("p", { class: "muted" }, "Past versions can't be changed. Editing an approved plan creates a new draft."),
        historyBlock(d.history),
        h("a", { class: "btn primary", href: `#/review/${p.plan_id}`, onclick: () => drawer.close() }, "Open in review"))));
    drawer.showModal();
  }
  main.replaceChildren(h("div", { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "Plans register"), h("div", { class: "filters" }, q, st)),
    h("section", { class: "panel" }, h("div", { class: "table-wrap" }, h("table", { class: "data" },
      h("thead", {}, h("tr", {}, h("th", {}, "Plan"), h("th", {}, "Employee"), h("th", {}, "Role"), h("th", { class: "hide-sm" }, "Scenario"),
        h("th", { class: "n" }, "Version"), h("th", {}, "Plan status"), h("th", { class: "hide-sm" }, "Created"))), tbody))),
    drawer));
  drawer.addEventListener("close", () => {
    if (location.hash.startsWith("#/plans/")) location.hash = "#/plans";
  });
  draw();
  if (id) {
    const target = S.plans.find((p) => p.audience === "hr" && p.plan_id === id);
    if (target) open(target).catch((e) => toast(e.message, "err"));
    else location.replace("#/plans");
  }
}

boot().catch((e) => app.replaceChildren(h("main", { class: "view" }, h("div", { class: "issue error" }, `Could not start: ${e.message}`))));
