// AiversePulse Enterprise (HR advisors): overview, upload + live team run, review queue, plans register.
import { jobIcon } from "./jobicons.js";
import { api, stream, h, $, icon, toast, fmtTime, ApiError } from "./lib.js";
import { Owl, OwlStatus } from "./owl.js";
import { gapsBlock, comparisonBlock, outlookBlock, planBlock, historyBlock, sourceItem, staticText, signalsBlock, sdgBlock } from "./blocks.js";
import { openingsView, openingDetail, signalsView } from "./recruit.js";

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
  if (S.me.role !== "hr_advisor") { app.replaceChildren(h("main", { class: "view" }, h("p", {}, "Admin accounts are managed from the command line."))); return; }
  app.replaceChildren(h("main", { style: { display: "grid", "place-items": "center", "min-height": "100dvh", gap: "12px", "align-content": "center" }, "aria-busy": "true" },
    new Owl({ size: 72, state: "searching" }).el, h("p", { class: "muted" }, "Loading the console…")));
  S.meta = await api("/api/meta");
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
      onclick: (e) => { S.scenario = k; S.seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); S.onScenarioChange?.(); } },
      k === "assistive" ? "Assistive" : "Agentic")));
  S.crumb = h("div", { class: "crumb" });
  const review = link("#/review", "Review", "review"); review.append(S.badge);
  const more = h("div", { id: "hr-more", class: "hr-more", popover: "auto", "aria-label": "Additional pages" },
    h("a", { href: "#/openings", onclick: () => more.hidePopover?.() }, icon("people"), "Hiring"),
    h("a", { href: "#/signals", onclick: () => more.hidePopover?.() }, icon("pulse"), "AI trends"),
    h("button", { type: "button", onclick: signOut }, icon("out"), "Sign out"));
  app.replaceChildren(h("div", { class: "hr-shell" },
    h("nav", { class: "rail", "aria-label": "Primary" },
      h("a", { class: "logo", href: "#/overview", "aria-label": "AiversePulse Enterprise home" }, S.logo = h("span", { class: "logo-owl" }), h("span", { class: "lbl wordmark" }, "AiversePulse")),
      link("#/overview", "Overview", "grid"), link("#/run", "Run team", "upload"), review, link("#/plans", "Plans", "history"),
      link("#/openings", "Hiring", "people"), link("#/signals", "Signals", "pulse"),
      h("div", { style: { flex: 1 } }),
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
  const names = { overview: "Overview", run: "Upload & run", review: "Review queue", plans: "Plans register", openings: "Openings & screening", signals: "AI-trend signals" };
  S.crumb.replaceChildren(names[page] || "Overview");
}

async function signOut() { await api("/api/logout", { method: "POST" }).catch(() => {}); location.reload(); }

async function refreshPlans() {
  S.plans = await api("/api/plans").catch(() => []);
  const open = S.plans.filter((p) => p.audience === "hr" && p.status !== "approved").length;
  S.badge.hidden = !open; S.badge.textContent = open;
  return S.plans;
}

function route() {
  const hash = location.hash || "#/overview";
  const [page = "overview", id, ...extra] = hash.startsWith("#/") ? hash.slice(2).split("/") : [];
  const pages = new Set(["overview", "run", "review", "plans", "openings", "signals"]);
  if (!pages.has(page) || extra.length || (id && !["review", "plans", "openings"].includes(page))) {
    location.replace("#/overview");
    return;
  }
  document.querySelectorAll("[data-route]").forEach((a) => {
    const dest = a.dataset.route;
    const active = dest === "#/more" ? ["openings", "signals"].includes(page) :
      hash === dest || hash.startsWith(dest + "/");
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  crumb(page);
  S.onScenarioChange = null;
  const main = $("#main");
  S.routeVersion = (S.routeVersion || 0) + 1;
  main.scrollTop = 0;
  const views = { run: runView, review: () => reviewView(main, id), plans: () => plansView(main, id),
    openings: () => (id ? openingDetail(main, id, S.status) : openingsView(main, S.status)), signals: () => signalsView(main, S.status) };
  Promise.resolve((views[page] || overview)(main)).catch((e) => {
    main.replaceChildren(h("div", { class: "view" }, h("div", { class: "issue error", role: "alert" }, e.message)));
  });
}

function keys(e) {
  if (!location.hash.startsWith("#/review") || /input|textarea|select/i.test(e.target.tagName)) return;
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
  const latest = S.plans.filter((p) => p.audience === "hr");
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
      : h("div", { class: "empty-state" }, h("span", { class: "stat-ic" }, icon("upload")), h("p", {}, "No team analysed yet."),
          h("a", { class: "btn primary sm", href: "#/run" }, icon("upload"), "Run analysis"))));
}

function rosterTable() {
  const rows = [...S.rows.values()];
  if (!rows.length) return null;
  return h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Employees in this run"), h("span", { class: "muted num", style: { "font-size": "12px" } }, `${rows.filter((r) => r.status !== "running").length}/${rows.length} done`)),
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
    h("div", { class: "view-head" }, h("h1", {}, "Overview"), h("a", { class: "btn primary sm", href: "#/run" }, icon("upload"), "Upload team")),
    stats(), h("div", { class: "overview" }, needsPanel(),
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Needs your review")),
        h("div", { class: "pad review-list" }, latestPerEmployee(S.plans.filter((p) => p.audience === "hr" && p.status !== "approved")).slice(0, 6).map((p) =>
          h("a", { href: `#/review/${p.plan_id}`, class: "review-row" },
            h("span", { class: "who" }, h("b", {}, p.subject_id), h("span", { class: "muted" }, `${p.target_role} · v${p.version} · ${fmtTime(p.created_utc)}`)), h("span", { class: `tag ${p.status}` }, p.status))),
          S.plans.some((p) => p.audience === "hr" && p.status !== "approved") ? null : h("p", { class: "muted" }, "Nothing waiting. Approved plans live in the register.")))),
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
    h("span", { class: "muted mono", style: { "font-size": "12px" } }, "employee_id, target_role, weekly_hours, skill, level"),
    h("span", { class: "muted", style: { "font-size": "12px" } }, "target_role: any ESCO job title or code · max 5,000 rows · 500 employees · pseudonymous IDs only"));

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
    preview.replaceChildren(h("p", { class: "muted", style: { "font-size": "12px" } }, `${name} · ${lines.length - 1} rows`),
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
      errors.replaceChildren(...(e.body?.errors || [e.message]).map((x) => h("li", {}, x)));
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
          runBtn, h("p", { class: "muted", style: { "font-size": "12px" } }, "Each employee runs the full 8-agent pipeline in parallel. Drafts are never approved automatically.")))),
    live));
  if (S.csv) setCsv(S.csv, "current file");
}

// ---------------------------------------------------------------- review queue (three panes)
async function reviewView(main, id) {
  const version = S.routeVersion;
  const request = S.reviewRequest = (S.reviewRequest || 0) + 1;
  await refreshPlans();
  if (version !== S.routeVersion || request !== S.reviewRequest) return;
  const items = S.plans.filter((p) => p.audience === "hr");
  if (id && !items.some((p) => p.plan_id === id)) { location.replace("#/review"); return; }
  let filter = S.reviewFilter || "open";
  // Direct links to an approved/flagged plan must not be hidden by a previous filter.
  if (id && !items.some((p) => p.plan_id === id &&
      (filter === "all" || (filter === "open" ? p.status !== "approved" : p.status === filter)))) filter = "all";
  S.reviewFilter = filter;
  const shown = items.filter((p) => filter === "all" || (filter === "open" ? p.status !== "approved" : p.status === filter));
  id = id || shown[0]?.plan_id;
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Filter" },
    [["open", "Open"], ["flagged", "Flagged"], ["approved", "Approved"], ["all", "All"]].map(([k, l]) =>
      h("button", { type: "button", "aria-pressed": String(k === filter), onclick: () => { S.reviewFilter = k; if (location.hash === "#/review") reviewView(main); else location.hash = "#/review"; } }, l)));
  const queue = h("nav", { class: "queue", "aria-label": "Review queue" },
    h("header", {}, h("span", {}, `${shown.length} plans`), h("span", { class: "mono hide-sm" }, "J / K")),
    h("div", { style: { padding: "10px 14px", "border-bottom": "1px solid var(--rule)" } }, seg),
    shown.length ? shown.map((p) => h("button", { class: "queue-item", "aria-current": String(p.plan_id === id),
      onclick: () => { location.hash = `#/review/${p.plan_id}`; } },
      h("span", { class: "l1" }, h("span", { class: "id" }, p.subject_id), h("span", { class: `tag ${p.status}` }, p.status)),
      h("span", { class: "l2" }, `${p.target_role} · v${p.version} · `, h("time", { datetime: p.created_utc }, fmtTime(p.created_utc)))))
      : h("div", { class: "empty", style: { padding: "24px 14px" } }, new Owl({ size: 64, state: "sleeping" }).el, h("p", { class: "muted" }, "Nothing here. Upload a team to create drafts."), h("a", { class: "btn sm", href: "#/run" }, "Upload team")));
  const detail = h("section", { class: "detail", "aria-label": "Plan detail" });
  const aside = h("aside", { class: "aside", "aria-label": "Evidence and audit" });
  const wrap = h("div", { class: "review", "data-pane": location.hash.split("/")[2] ? "detail" : "list" }, queue, detail, aside);
  main.replaceChildren(wrap);
  if (id) loadDetail(id, detail, aside, wrap);
}

async function loadDetail(id, detail, aside, wrap) {
  detail.replaceChildren(h("div", { class: "detail-body" }, h("p", { class: "muted" }, "Loading…")));
  let d;
  try { d = await api(`/api/plans/${id}`); } catch (e) { detail.replaceChildren(h("div", { class: "detail-body" }, h("div", { class: "issue error" }, e.message))); return; }
  const r = d.report;
  const toggleAside = h("button", { class: "btn sm ev-toggle", type: "button", "aria-expanded": "false", onclick: (e) => { e.currentTarget.setAttribute("aria-expanded", String(aside.classList.toggle("open"))); } }, icon("sources"), "Evidence");
  const body = h("div", { class: "detail-body" },
    h("a", { class: "btn ghost sm back", href: "#/review" }, icon("back"), "Queue"),
    h("div", { class: "detail-head" }, h("h2", {}, h("span", { class: "id" }, d.subject_id), " / ", d.plan.target_role),
      h("span", { class: `tag ${d.status}` }, d.status), h("span", { class: "num muted" }, `v${d.version}`), h("span", { style: { flex: 1 } }), toggleAside),
    d.status === "flagged" ? h("div", { class: "banner flag", role: "alert" }, h("strong", {}, "Flagged."), h("span", {}, "Fix the issues below and save a new draft before approval.")) : null,
    r ? h("section", { class: "block" }, h("h3", {}, "Summary"), staticText(r.narrative, (cid) => { aside.classList.add("open"); document.getElementById(`src-${cid}`)?.scrollIntoView({ block: "nearest" }); })) : h("p", { class: "muted" }, "The analysis report is not cached on this server (it restarted). The plan and audit trail below are complete."),
    r?.issues?.filter((i) => i.severity === "error").map((i) => h("div", { class: "issue error" }, i.message)),
    r?.gaps?.length ? gapsBlock(r.gaps) : null,
    r?.comparison?.length ? comparisonBlock(r.comparison, d.plan.scenario) : null,
    r?.outlook ? outlookBlock(r.outlook) : null,
    r?.signals ? signalsBlock(r.signals) : null,
    r?.sdgs?.length ? sdgBlock(r.sdgs) : null,
    planBlock({ planId: id, plan: d.plan, version: d.version, status: d.status, weeklyHours: null,
      approverLabel: "I have reviewed this plan", title: "90-day plan", onChange: async (next) => {
        if (next === "approved") S.status.set("celebrating", `${d.subject_id} approved`);
        await refreshPlans();
        loadDetail(id, detail, aside, wrap);
      } }));
  detail.replaceChildren(body);
  aside.replaceChildren(
    h("header", {}, h("span", {}, "Evidence"), h("span", { class: "num" }, r ? r.evidence.length : 0)),
    h("section", {}, r ? r.evidence.map(sourceItem) : h("p", { class: "muted" }, "Not cached.")),
    h("header", {}, h("span", {}, "Audit trail"), h("span", {}, "UTC")),
    h("section", {}, historyBlock(d.history)));
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
      h("td", { class: "n" }, `v${p.version}`), h("td", {}, h("span", { class: `tag ${p.status}` }, p.status)), h("td", { class: "mono hide-sm" }, fmtTime(p.created_utc)))));
  }
  async function open(p) {
    const d = await api(`/api/plans/${p.plan_id}`);
    if (!main.contains(drawer)) return;
    drawer.replaceChildren(h("div", { class: "panel", style: { border: 0, height: "100%", display: "grid", "grid-template-rows": "auto 1fr" } },
      h("header", {}, h("h2", {}, h("span", { class: "mono" }, d.subject_id), ` · ${d.plan.target_role}`), h("button", { class: "btn sm", onclick: () => drawer.close() }, "Close")),
      h("div", { class: "pad", style: { overflow: "auto", display: "grid", gap: "16px", "align-content": "start" } },
        h("p", { class: "muted" }, "Versions are immutable. Editing an approved plan creates a new draft."),
        historyBlock(d.history),
        h("a", { class: "btn primary", href: `#/review/${p.plan_id}`, onclick: () => drawer.close() }, "Open in review"))));
    drawer.showModal();
  }
  main.replaceChildren(h("div", { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "Plans register"), h("div", { class: "filters" }, q, st)),
    h("section", { class: "panel" }, h("div", { class: "table-wrap" }, h("table", { class: "data" },
      h("thead", {}, h("tr", {}, h("th", {}, "Plan"), h("th", {}, "Employee"), h("th", {}, "Role"), h("th", { class: "hide-sm" }, "Scenario"),
        h("th", { class: "n" }, "Version"), h("th", {}, "Status"), h("th", { class: "hide-sm" }, "Created"))), tbody))),
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
