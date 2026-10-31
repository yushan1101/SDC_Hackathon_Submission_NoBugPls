// AiversePulse Enterprise (HR advisors): overview, upload + live team run, review queue, plans register.
import "./motion.js";  // GSAP animations for whatever the app renders
import { jobIcon } from "./jobicons.js";
import { api, apiBlobUrl, stream, h, $, icon, toast, fmtTime, ApiError, SCENARIO_HELP } from "./lib.js";
import { Owl, OwlStatus } from "./owl.js";
import { gapsBlock, comparisonBlock, outlookBlock, planBlock, historyBlock, sourceItem, staticText, signalsBlock, sdgBlock } from "./blocks.js";
import { openingsView, openingDetail, signalsView } from "./recruit.js";
import { modelsView, peopleView, pluginsView } from "./org.js";
import { agentView, hrCapsule } from "./agents.js";
import { setVoice } from "./voice.js";
import { accountView, pricingView } from "./account.js";
import { termsView, privacyView } from "./legal.js";
import { workforceView } from "./workforce.js";
import { floatingMenu } from "./floating-menu.js";

const app = $("#app");
const AGENTS = ["supervisor", "profiler", "knowledge_search", "gap_analysis", "market_analyst", "pathway", "coach", "reviewer"];
const HR_SIDEBAR_EXPANDED_KEY = "ap.hr.sidebar.expanded";
const S = { me: null, meta: null, scenario: "assistive", status: null, rows: new Map(), needs: [], csv: null, plans: [], sel: null };
let closeFloatingSidebarMenus = () => {};

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
  let sidebarExpanded = false;  // folded until the person opens it
  try { sidebarExpanded = localStorage.getItem(HR_SIDEBAR_EXPANDED_KEY) === "true"; } catch { /* folded by default */ }
  let shellEl, sidebar, sidebarToggle;
  let openMenu = null;
  closeFloatingSidebarMenus = () => {
    openMenu = null;
    sidebar?.querySelectorAll(".rail-group").forEach((group) => {
      group.classList.remove("open");
      group.querySelector(".rail-group-btn")?.setAttribute("aria-expanded", "false");
    });
  };
  const link = (href, label, ic) => h("a", { href, "data-route": href, "aria-label": label, title: label }, icon(ic),
    h("span", { class: "lbl" }, label), h("span", { class: "tip", "aria-hidden": "true" }, label));
  // A folder of related links: click to open; in the icon-only rail it pops out to the side.
  const group = (label, ic, ...links) => {
    const el = h("div", { class: "rail-group" });
    const btn = h("button", { type: "button", class: "rail-group-btn", "aria-expanded": "false", "aria-label": label, title: label,
      onclick: () => {
        if (sidebarExpanded) {
          const expanded = !el.classList.contains("open");
          el.classList.toggle("open", expanded);
          btn.setAttribute("aria-expanded", String(expanded));
          return;
        }
        if (openMenu === el) { closeFloatingSidebarMenus(); return; }
        closeFloatingSidebarMenus();
        openMenu = el;
        el.classList.add("open");
        btn.setAttribute("aria-expanded", "true");
      } },
      icon(ic), h("span", { class: "lbl" }, label), h("span", { class: "rail-caret", "aria-hidden": "true" }, icon("chevron")));
    links.forEach((item) => item.addEventListener("click", () => {
      if (sidebarExpanded) return;
      closeFloatingSidebarMenus();
    }));
    el.append(btn, h("div", { class: "rail-sub", role: "group", "aria-label": label }, ...links));
    return el;
  };
  const tab = (href, label, ic) => h("a", { href, "data-route": href }, icon(ic), label);
  S.badge = h("span", { class: "badge", hidden: true });
  S.seg = h("div", { class: "seg scenario-switch", role: "group", "aria-label": "AI scenario" },
    ["assistive", "agentic"].map((k) => h("button", { type: "button", "aria-pressed": String(S.scenario === k),
      title: SCENARIO_HELP[k], "aria-description": SCENARIO_HELP[k],
      onclick: (e) => { S.scenario = k; S.seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); S.onScenarioChange?.(); } },
      k === "assistive" ? "Assistive" : "Agentic")));
  const review = link("#/review", "Review", "nav-review"); review.append(S.badge);
  const more = h("div", { id: "hr-more", class: "hr-more", popover: "auto", "aria-label": "Additional pages" },
    h("a", { href: "#/agents", onclick: () => more.hidePopover?.() }, icon("ask"), "Agent"),
    h("a", { href: "#/openings", onclick: () => more.hidePopover?.() }, icon("people"), "Hiring"),
    h("a", { href: "#/plugins", onclick: () => more.hidePopover?.() }, icon("plug"), "Hiring plugins"),
    h("a", { href: "#/people", onclick: () => more.hidePopover?.() }, icon("user"), "Team members"),
    h("a", { href: "#/models", onclick: () => more.hidePopover?.() }, icon("model"), "AI models"),
    h("a", { href: "#/signals", onclick: () => more.hidePopover?.() }, icon("pulse"), "AI trends"),
    h("a", { href: "#/heatmap", onclick: () => more.hidePopover?.() }, icon("grid"), "Skills gap heatmap"),
    h("a", { href: "#/account", "data-route": "#/account" }, icon("user"), "Plan & billing"),
    h("button", { type: "button", onclick: signOut }, icon("nav-signout"), "Log out"));
  sidebarToggle = h("button", { class: "hr-sidebar-toggle", type: "button", "aria-expanded": String(sidebarExpanded),
    "aria-label": sidebarExpanded ? "Collapse sidebar" : "Expand sidebar", title: sidebarExpanded ? "Collapse sidebar" : "Expand sidebar",
    onclick: () => {
      sidebarExpanded = !sidebarExpanded;
      closeFloatingSidebarMenus();
      try { localStorage.setItem(HR_SIDEBAR_EXPANDED_KEY, String(sidebarExpanded)); } catch { /* keep the preference for this page */ }
      updateSidebar();
    } }, icon("chevron"));
  const updateSidebar = () => {
    if (!shellEl) return;
    S.sidebarExpanded = sidebarExpanded;
    shellEl.classList.toggle("is-sidebar-expanded", sidebarExpanded);
    shellEl.classList.toggle("is-sidebar-collapsed", !sidebarExpanded);
    sidebarToggle.setAttribute("aria-expanded", String(sidebarExpanded));
    sidebarToggle.setAttribute("aria-label", sidebarExpanded ? "Collapse sidebar" : "Expand sidebar");
    sidebarToggle.title = sidebarExpanded ? "Collapse sidebar" : "Expand sidebar";
  };
  // The person's menu, as on any dashboard: their photo and details on top, then settings, then sign out.
  const name = S.me.display_name || S.me.username || "Account";
  const ent = S.me.enterprise;
  const close = () => account.hidePopover?.();
  const avatar = (cls) => {  // photo when they have one, initials until it loads (or if they don't)
    const el = h("span", { class: `u-avatar ${cls}`, "aria-hidden": "true" }, name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase());
    const show = (url) => url && apiBlobUrl(url).then((u) => { if (u) el.replaceChildren(h("img", { src: u, alt: "" })); });
    show(S.me.avatar_url);
    addEventListener("ap:avatar", (e) => { S.me.avatar_url = e.detail; show(e.detail); });
    return el;
  };
  const item = (href, ic, label, keys) => h("a", { href, "data-route": href, onclick: close }, icon(ic), h("span", {}, label), keys ? h("kbd", {}, keys) : null);
  const account = h("div", { id: "hr-account", class: "hr-account-menu", popover: "auto", "aria-label": "Account" },
    h("div", { class: "hr-account-who" }, avatar("sm"), h("b", {}, name)),
    h("div", { class: "acct-sep", role: "separator" }),
    item("#/people", "nav-team", "Invite teammates"),
    item("#/account", "user", "Profile & settings"),
    item("#/account/billing", "nav-payments", "Plan & billing"),
    item("#/models", "nav-models", "AI models"),
    h("div", { class: "acct-sep", role: "separator" }),
    h("button", { type: "button", class: "acct-signout", onclick: () => { close(); signOut(); } }, icon("nav-signout"), h("span", {}, "Log out")));
  const accountBtn = h("button", { type: "button", class: "rail-group-btn hr-account-btn", popovertarget: "hr-account", "aria-haspopup": "true", title: name },
    avatar("sm"), h("span", { class: "lbl acct-lbl" }, h("b", {}, name), h("small", {}, ent && ent.name !== name ? ent.name : "HR advisor")),
    h("span", { class: "rail-caret", "aria-hidden": "true" }, icon("chevron")));

  // Usage ring: how much of this month's AI allowance the enterprise has left; opens the numbers behind it.
  const NS = "http://www.w3.org/2000/svg";
  const ring = document.createElementNS(NS, "svg");
  ring.setAttribute("viewBox", "0 0 24 24"); ring.setAttribute("class", "usage-ring"); ring.setAttribute("aria-hidden", "true");
  ring.innerHTML = '<circle cx="12" cy="12" r="9" class="track"/><circle cx="12" cy="12" r="9" class="used" pathLength="100" stroke-dasharray="0 100" transform="rotate(-90 12 12)"/>';
  const usagePop = h("div", { id: "hr-usage", class: "hr-account-menu usage-menu", popover: "auto", "aria-label": "Usage" });
  const usageBtn = h("button", { type: "button", class: "usage-btn", popovertarget: "hr-usage", "aria-haspopup": "true", title: "AI usage this month" }, ring);
  const row = (label, value, tone) => h("div", { class: "usage-row" }, h("span", {}, label), h("b", { class: tone || null }, value));
  const drawUsage = (u) => {
    const used = 100 - u.left_pct;
    ring.querySelector(".used").setAttribute("stroke-dasharray", `${used} 100`);
    ring.classList.toggle("low", u.left_pct <= 20);
    usageBtn.title = `AI budget: ${u.left_pct}% left this month`;
    const sub = u.subscription, live = sub && ["active", "trialing"].includes(sub.status);
    usagePop.replaceChildren(
      h("p", { class: "usage-src" }, `Usage source: ${ent?.name || "Your organisation"} · ${u.month}`),
      h("div", { class: "acct-sep", role: "separator" }),
      row("Monthly AI budget", `${u.left_pct}% left`, u.left_pct <= 20 ? "warn" : null),
      row("AI calls this month", u.calls.toLocaleString()),
      row("Resets in", `${u.resets_in_days} day${u.resets_in_days === 1 ? "" : "s"}`),
      row("Subscription", live ? (sub.cancelling ? "Ends soon" : "Active") : "Not subscribed", live ? null : "warn"),
      h("div", { class: "acct-sep", role: "separator" }),
      h("a", { href: "#/account", onclick: () => usagePop.hidePopover?.() }, h("span", {}, "Manage usage")));
  };
  const loadUsage = () => api("/api/org/usage").then(drawUsage).catch(() => { usagePop.replaceChildren(h("p", { class: "usage-src" }, "Usage could not be loaded.")); });
  loadUsage();
  usagePop.addEventListener("beforetoggle", (e) => {
    if (e.newState !== "open") return;
    loadUsage();
    const r = usageBtn.getBoundingClientRect(), side = shellEl.classList.contains("is-sidebar-collapsed");
    Object.assign(usagePop.style, side ? { left: `${r.right + 10}px`, bottom: `${innerHeight - r.bottom}px` } : { left: `${r.left}px`, bottom: `${innerHeight - r.top + 8}px` });
  });
  account.addEventListener("beforetoggle", (e) => {  // pop up above the button, or beside it when the rail is icon-only
    if (e.newState !== "open") return;
    const r = accountBtn.getBoundingClientRect(), side = shellEl.classList.contains("is-sidebar-collapsed");
    Object.assign(account.style, side ? { left: `${r.right + 10}px`, bottom: `${innerHeight - r.bottom}px` } : { left: `${r.left}px`, bottom: `${innerHeight - r.top + 8}px` });
  });
  sidebar = h("nav", { class: "rail hr-rail", "aria-label": "Primary" },
      h("div", { class: "hr-rail-head" },
        h("a", { class: "logo", href: "#/overview", "aria-label": "AiversePulse Enterprise home" }, S.logo = h("span", { class: "logo-owl" }), h("span", { class: "lbl wordmark" }, "AiversePulse")), sidebarToggle),
      link("#/overview", "Overview", "nav-overview"), link("#/agents", "Agent", "nav-agent"),
      group("Team", "nav-team", link("#/run", "Analyse team", "nav-analyse"), review, link("#/people", "Team members", "nav-member")),
      group("Hiring", "nav-hiring", link("#/openings", "Openings", "nav-openings"), link("#/plugins", "Hiring plugins", "nav-plugins")),
      group("AI trends", "nav-trends", link("#/signals", "Market trends", "nav-market"), link("#/heatmap", "Skills gap heatmap", "nav-heatmap")),
      h("div", { style: { flex: 1 } }),
      h("div", { class: "rail-foot" }, accountBtn, usageBtn), account, usagePop);
  shellEl = h("div", { class: "hr-shell" },
    sidebar,
    h("main", { id: "main", class: "hr-main", tabindex: "-1" }),
    h("nav", { class: "hr-tabbar", "aria-label": "Primary" }, tab("#/overview", "Overview", "grid"), tab("#/run", "Analyse", "upload"),
      tab("#/review", "Review", "review"),
      h("button", { type: "button", class: "hr-more-button", popovertarget: "hr-more", "data-route": "#/more",
        "aria-haspopup": "true", "aria-label": "More pages" }, icon("grid"), "More")),
    more, S.capsule = capsule());
  app.replaceChildren(shellEl);
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!sidebarExpanded && !(target instanceof Element && target.closest(".hr-rail .rail-group"))) closeFloatingSidebarMenus();
  });
  updateSidebar();
  // the owl lives in the rail's logo spot; on phones (no rail) it moves back next to the status text
  S.logo.append(S.status.owl.el);
  refreshPlans().catch((e) => toast(`Plans could not be loaded. ${e.message}`, "err"));
}

/** The floating agent capsule: every page and the console's main actions, searchable and runnable from anywhere. */
function capsule() {
  const page = (href, label, ic, words = "") => ({ href, label, icon: ic, words });
  const scenario = (k) => ({ label: `Switch to the ${k} AI scenario`, icon: "model", words: "scenario mode",
    run: () => { [...S.seg.querySelectorAll("button")].find((b) => b.textContent.toLowerCase() === k)?.click(); toast(`AI scenario: ${k}`); } });
  return hrCapsule({
    pages: [page("#/overview", "Overview", "grid", "home dashboard"), page("#/agents", "Agent", "ask", "chat assistant ai"),
      page("#/run", "Analyse team", "upload", "csv upload run"), page("#/review", "Review queue", "review", "approve pending flagged plans register"),
      page("#/openings", "Hiring", "people", "openings jobs applicants"),
      page("#/plugins", "Hiring plugins", "plug", "linkedin post share"), page("#/people", "Team members", "user", "invite users"),
      page("#/models", "AI models", "model", "llm settings"), page("#/signals", "AI trends", "pulse", "signals news"),
      page("#/heatmap", "Skills gap heatmap", "grid", "workforce skills gap team ai trends"),
      page("#/account", "Plan & billing", "user", "pricing subscription")],
    actions: [{ label: "Analyse a team CSV", icon: "upload", words: "start new run import", run: () => { location.hash = "#/run"; } },
      { label: "Review the next pending plan", icon: "review", words: "approve open next", run: () => {
        const p = S.plans.find((x) => x.audience === "hr" && !x.review?.archived && x.review?.review_status === "pending");
        location.hash = p ? `#/review/${p.plan_id}` : "#/review"; if (!p) toast("Nothing is waiting for review."); } },
      { label: "Create a job opening", icon: "people", words: "new hire post", run: () => { location.hash = "#/openings"; } },
      { label: "Invite a team member", icon: "user", words: "add people", run: () => { location.hash = "#/people"; } },
      scenario("assistive"), scenario("agentic"),
      { label: "Sign out", icon: "out", words: "log out", run: signOut }],
    plans: () => S.plans, status: S.status,
  });
}

async function signOut() { await api("/api/logout", { method: "POST" }).catch(() => {}); location.reload(); }

async function refreshPlans() {
  S.plans = await api("/api/plans");
  const open = S.plans.filter((p) => p.audience === "hr" && !p.review?.archived && p.review?.review_status === "pending").length;
  S.badge.hidden = !open; S.badge.textContent = open;
  return S.plans;
}

function route() {
  closeFloatingSidebarMenus();
  const hash = location.hash || "#/overview";
  const [page = "overview", id, ...extra] = hash.startsWith("#/") ? hash.slice(2).split("/") : [];
  if (page === "plans") { location.replace(`#/review${id ? `/${id}` : ""}`); return; }  // the plans register is part of the review page now
  const pages = new Set(["overview", "run", "review", "openings", "signals", "heatmap", "plugins", "people", "models", "agents", "account", "pricing", "privacy", "terms"]);
  if (!pages.has(page) || extra.length || (id && !["review", "openings", "plugins", "agents", "people", "account"].includes(page))) {
    location.replace("#/overview");
    return;
  }
  document.querySelectorAll("[data-route]").forEach((a) => {
    const dest = a.dataset.route;
    const active = dest === "#/more" ? ["openings", "signals", "heatmap", "plugins", "people", "models", "agents"].includes(page) :
      hash === dest || hash.startsWith(dest + "/");
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  document.querySelectorAll(".rail-group").forEach((g) => {  // only the folder holding this page stays open
    const here = !!g.querySelector('[aria-current="page"]');
    g.classList.toggle("has-current", here);
    const expanded = S.sidebarExpanded && here;
    g.classList.toggle("open", expanded);
    g.firstChild.setAttribute("aria-expanded", String(expanded));
  });
  document.querySelector(".hr-account-btn")?.classList.toggle("is-current", !!document.querySelector('#hr-account [aria-current="page"]'));
  S.capsule.hidden = page === "agents";  // the agent page is the same chat, full size
  S.onScenarioChange = null;
  const main = $("#main");
  S.routeVersion = (S.routeVersion || 0) + 1;
  if (page !== "review" || !main.querySelector(".review")) main.scrollTop = 0;
  const views = { run: runView, review: () => reviewView(main, id),
    openings: () => (id ? openingDetail(main, id, S.status) : openingsView(main, S.status)), signals: () => signalsView(main, S.status), heatmap: () => heatmapView(main),
    plugins: () => pluginsView(main, S.status, id), people: () => peopleView(main, S.status, id ? decodeURIComponent(id) : null), models: () => modelsView(main, S.status), agents: () => (id ? location.replace("#/agents") : agentView(main)),
    account: () => accountView(main, { refreshMe: async () => { S.me = await api("/api/me"); return S.me; }, hrLayout: true, tab: id }),
    pricing: () => pricingView(main, { me: S.me }),
    terms: () => termsView(main, { hrLayout: true }), privacy: () => privacyView(main, { hrLayout: true }) };
  Promise.resolve((views[page] || overview)(main)).catch((e) => {
    main.replaceChildren(h("div", { class: "view" }, h("div", { class: "issue error", role: "alert" }, e.message)));
  });
}

function keys(e) {
  if (!location.hash.startsWith("#/review") || e.target.closest("dialog") || /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.key === "Escape" && location.hash.startsWith("#/review/")) { location.hash = "#/review"; return; }
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
      : h("div", { class: "empty-state" }, h("span", { class: "stat-ic" }, icon("check")), h("p", {}, "No skill gaps identified in this run."))));
}

function rosterTable() {
  const rows = [...S.rows.values()];
  if (!rows.length) return null;
  return h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Employees in this run"), h("span", { class: "muted num", style: { "font-size": "14px" } }, `${rows.filter((r) => r.status !== "running").length}/${rows.length} done`)),
    h("div", { class: "table-wrap" }, h("table", { class: "data" },
      h("thead", {}, h("tr", {}, h("th", {}, "Employee"), h("th", {}, "Target role"), h("th", { class: "n hide-sm" }, "h/week"), h("th", {}, "Agents"), h("th", { class: "hide-sm" }, "Top gaps"), h("th", {}, "Status"))),
      h("tbody", {}, rows.map((r) => h("tr", { "data-href": r.plan_id ? `#/review/${r.plan_id}` : null, onclick: () => r.plan_id && (location.hash = `#/review/${r.plan_id}`) },
        h("td", { class: "mono" }, r.id, r.original && r.original !== r.id ? h("span", { class: "muted", title: "ID in the uploaded CSV" }, ` (CSV ${r.original})`) : null), h("td", {}, h("span", { class: "job-line" }, r.soc ? jobIcon(r.soc, { size: 28, labelled: true }) : null, r.role)), h("td", { class: "n hide-sm" }, r.hours ?? "–"), h("td", {}, strip(r)),
        h("td", { class: "hide-sm" }, r.top_gaps?.join(", ") || "–"),
        h("td", {}, r.status === "running" ? h("span", { class: "muted" }, "running") : h("span", { class: `tag ${r.status}` }, r.error ? "error" : r.status))))))));
}

// newest plan per employee, so a re-run doesn't list the same person twice
const latestPerEmployee = (plans) => [...plans.reduce((m, p) => (!m.has(p.subject_id) || m.get(p.subject_id).created_utc < p.created_utc ? m.set(p.subject_id, p) : m), new Map()).values()];

// AI trends > Skills gap heatmap: the Overview heatmap on a page of its own
function heatmapView(main) {
  const workforce = h("div", { class: "workforce" });
  main.replaceChildren(h("div", { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "AI trends"), h("a", { class: "btn sm", href: "#/signals" }, icon("pulse"), "Market trends")),
    workforce));
  workforceView(workforce);
}

// Overview: only what needs attention. The key numbers on top, the review queue beside the three biggest skill gaps,
// then the team. The full heatmap lives under AI trends > Skills gap heatmap.
async function overview(main) {
  const version = S.routeVersion;
  const top = h("div"), body = h("div");
  main.replaceChildren(h("div", { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "Overview"), h("a", { class: "btn primary sm", href: "#/run" }, icon("upload"), "Analyse team")),
    top, body));
  const gaps = h("section", { class: "panel overview-gaps" },
    h("header", {}, h("h2", {}, "Biggest skill gaps"), h("a", { class: "btn sm", href: "#/heatmap" }, "Open heatmap")),
    h("div", { class: "pad" }, h("p", { class: "muted" }, "Loading…")));
  api("/api/hr/workforce?scenario=assistive&category=all&department=&role=").then((d) => {
    if (version !== S.routeVersion) return;
    const list = (d.priorities || []).slice(0, 3);
    gaps.lastElementChild.replaceChildren(list.length
      ? h("ol", { class: "gap-top" }, list.map((c) => h("li", {},
          h("span", { class: "gap-pct" }, `${c.gap_percent}%`),
          h("span", { class: "gap-main" }, h("b", {}, c.skill), h("small", {}, `${c.group} · ${c.affected} of ${c.employees} below target`)))))
      : h("p", { class: "muted" }, "No assessed gaps yet. Analyse your team to see them here."));
  }).catch(() => { if (version === S.routeVersion) gaps.lastElementChild.replaceChildren(h("p", { class: "muted" }, "Skill gaps could not be loaded.")); });
  try { await refreshPlans(); } catch (e) {
    if (version === S.routeVersion) body.replaceChildren(h("p", { class: "issue error", role: "alert" }, `Review queue could not be loaded. ${e.message}`), gaps);
    return;
  }
  if (version !== S.routeVersion) return;
  top.replaceChildren(stats());
  body.replaceChildren(...[h("div", { class: "overview overview-main" },
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Needs your review")),
        h("div", { class: "pad review-list" }, latestPerEmployee(S.plans.filter((p) => p.audience === "hr" && !p.review?.archived && p.review?.review_status === "pending")).slice(0, 6).map((p) =>
          h("a", { href: `#/review/${p.plan_id}`, class: "review-row" },
            h("span", { class: "who" }, h("b", {}, p.subject_id), h("span", { class: "muted" }, `${p.target_role} · v${p.version} · ${fmtTime(p.created_utc)}`)), h("span", { class: `tag ${p.status}` }, p.status))),
          S.plans.some((p) => p.audience === "hr" && p.status !== "approved") ? null : h("p", { class: "muted" }, "You're all caught up."))),
      gaps),
    rosterTable()].filter(Boolean));  // no team table yet: nothing, not the text "null"
}

// ---------------------------------------------------------------- upload & run
function runView(main) {
  S.onScenarioChange = () => { if (S.csv) setCsv(S.csv, "current file", S.csvSample); };
  const preview = h("div");
  const schema = h("ul", { class: "schema", "aria-label": "Required columns" });
  const errors = h("ul", { class: "errors", role: "alert" });
  const notes = h("ul", { class: "import-notes" });
  // each upload is a named data set: your team, or an external group (a partner site, a cohort, applicants)
  const dataset = h("input", { class: "input", maxlength: 80, placeholder: "e.g. ICU nurses Q4, Partner clinic", value: S.dataset || "",
    oninput: () => { S.dataset = dataset.value; } });
  const who = h("select", { class: "input", onchange: () => { S.external = who.value === "external"; } },
    h("option", { value: "team", selected: !S.external ? true : null }, "My team or organisation"),
    h("option", { value: "external", selected: S.external ? true : null }, "External group (partner, cohort, applicants)"));
  const scale = h("select", { class: "input", onchange: () => { S.levelMax = Number(scale.value); if (S.csv) setCsv(S.csv, "current file", S.csvSample); } },
    [[5, "0 – 5"], [10, "0 – 10"], [100, "0 – 100 (percent)"]].map(([v, t]) => h("option", { value: v, selected: (S.levelMax || 5) === v ? true : null }, t)));
  const describe = h("div", { class: "dataset-fields" },
    h("label", { class: "field" }, h("span", {}, "Data set name"), dataset),
    h("label", { class: "field" }, h("span", {}, "Whose data"), who),
    h("label", { class: "field" }, h("span", {}, "Skill levels in the file"), scale));
  const runBtn = h("button", { class: "btn primary", type: "button", disabled: !S.csv || S.running ? true : null, onclick: run }, "Run analysis");
  const live = h("div", { style: { display: "grid", gap: "16px" } });
  const file = h("input", { type: "file", accept: ".csv,text/csv", class: "sr-only", onchange: (e) => load(e.target.files[0]) });
  const drop = h("label", { class: "drop", ondragover: (e) => { e.preventDefault(); drop.classList.add("over"); },
    ondragleave: () => drop.classList.remove("over"), ondrop: (e) => { e.preventDefault(); drop.classList.remove("over"); load(e.dataTransfer.files[0]); } },
    file, icon("upload"), h("strong", {}, "Drop a CSV from any HR system or choose a file"),
    h("span", { class: "muted", style: { "font-size": "14px" } }, "Needs an ID and a job title per person, and skill levels: one row per skill, or one column per skill."),
    h("span", { class: "muted", style: { "font-size": "14px" } }, "Optional: weekly hours, department, group (site, cohort, company). Comma, semicolon or tab separated."),
    h("span", { class: "muted", style: { "font-size": "14px" } }, "target_role: any ESCO job title or code · max 5,000 rows · 500 employees · pseudonymous IDs only"));

  async function load(f) {
    if (!f) return;
    if (f.size > 2_000_000) { toast("File is larger than 2 MB.", "err"); return; }
    setCsv(await f.text(), f.name);
  }
  async function setCsv(text, name, sample = false) {
    S.csv = text;
    S.csvSample = sample;
    const lines = text.trim().split(/\r?\n/);
    const sep = [",", ";", "\t"].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
    const head = lines[0].split(sep).map((s) => s.trim());
    schema.replaceChildren();
    preview.replaceChildren(h("p", { class: "muted", style: { "font-size": "14px" } }, `${name} · ${lines.length - 1} rows`),
      h("div", { class: "table-wrap", style: { "max-height": "220px" } }, h("table", { class: "data" },
        h("thead", {}, h("tr", {}, head.map((c) => h("th", {}, c)))),
        h("tbody", {}, lines.slice(1, 9).map((l) => h("tr", {}, l.split(sep).map((c) => h("td", { class: "mono" }, c))))))));
    const v = await api("/api/team/validate", { method: "POST", body: { csv: text, scenario: S.scenario, level_max: S.levelMax || 5 } }).catch((e) => ({ errors: [e.message] }));
    errors.replaceChildren(...(v.errors || []).map((e) => h("li", {}, e)));
    notes.replaceChildren(...(v.notes || []).map((n) => h("li", {}, icon("check"), n)),
      ...(v.departments?.length ? [h("li", {}, icon("check"), `Departments: ${v.departments.join(", ")}`)] : []),
      ...(v.groups?.length ? [h("li", {}, icon("check"), `Groups: ${v.groups.join(", ")}`)] : []));
    runBtn.disabled = !!v.errors?.length || S.running;
    runBtn.textContent = v.errors?.length ? "Fix the errors to run" : `Run analysis for ${v.employees} employees`;
    S.status.set(v.errors?.length ? "confused" : "idle", v.errors?.length ? `${v.errors.length} problems in the file` : `${v.employees} employees ready`);
  }
  async function run() {
    S.running = true; runBtn.disabled = true;
    presetBtn.disabled = true;
    S.rows = new Map(); S.needs = [];
    let prioritiesReady = false;
    const redraw = () => live.replaceChildren(...(prioritiesReady ? [needsPanel()] : []),
      rosterTable() || h("p", { class: "muted" }, "Starting…"));
    redraw();
    let raf = 0;
    const soon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(redraw); };
    try {
      await stream("/api/team", { csv: S.csv, scenario: S.scenario, sample: !!S.csvSample, dataset: dataset.value,
        external: who.value === "external", level_max: S.levelMax || 5 }, (ev) => {
        if (ev.t === "owl") S.status.set(ev.state, ev.say);
        else if (ev.t === "roster") { const orig = Object.fromEntries(Object.entries(ev.original_ids || {}).map(([o, id]) => [id, o])); ev.ids.forEach((id) => S.rows.set(id, { id, original: orig[id], role: ev.roles[id], status: "running", ticks: new Set() })); }
        else if (ev.t === "tick") S.rows.get(ev.id)?.ticks.add(ev.node);
        else if (ev.t === "employee") Object.assign(S.rows.get(ev.id), ev, { status: ev.error ? "flagged" : ev.status, ticks: new Set(AGENTS) });
        else if (ev.t === "needs") S.needs = ev.data;
        else if (ev.t === "done") {
          prioritiesReady = true;
          toast(ev.flagged.length ? `${ev.flagged.length} drafts flagged for manual fixes` : "All drafts are ready for review");
        }
        soon();
      });
      await refreshPlans();
      cancelAnimationFrame(raf);
      redraw();
      live.append(h("div", { class: "run-actions" }, h("a", { class: "btn primary", href: "#/review" }, "Open review queue"),
        h("a", { class: "btn", href: "#/heatmap" }, icon("nav-heatmap"), "See it on the heatmap")));
    } catch (e) {
      S.status.set("confused", "Run failed");
      errors.replaceChildren(...(e.body?.errors || [e.message]).map((x) => h("li", {}, x)),
        ...(e.status === 402 ? [h("li", {}, h("a", { class: "btn sm primary", href: "#/pricing" }, "See the Team plan"))] : []));
    } finally { S.running = false; presetBtn.disabled = false; }
  }

  const presetBtn = h("button", { class: "btn sm", type: "button", disabled: S.running ? true : null, onclick: async () => {
    presetBtn.disabled = true;
    try {
      const preset = await api("/api/sample-team");
      dataset.value = S.dataset = preset.dataset;
      scale.value = String(S.levelMax = preset.level_max);
      who.value = "team"; S.external = false;
      await setCsv(preset.csv, preset.filename, false);
    } catch (e) { toast(`Could not load CSV: ${e.message}`, "err"); }
    finally { presetBtn.disabled = S.running; }
  } }, "Use sample CSV");

  main.replaceChildren(h("div", { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "Analyse your team"),
      h("div", { class: "run-actions" }, S.seg, presetBtn)),
    h("div", { class: "overview" },
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Team file")), h("div", { class: "pad", style: { display: "grid", gap: "14px" } }, drop, describe, preview)),
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Checks")),
        h("div", { class: "pad", style: { display: "grid", gap: "14px" } }, schema, notes, errors,
          runBtn, h("p", { class: "muted", style: { "font-size": "14px" } }, "Each run assigns new employee IDs. You can change them later under Edit review. Plans stay drafts until you approve them.")))),
    live));
  if (S.csv) setCsv(S.csv, "current file", S.csvSample);
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
  const search = h("input", { class: "input rv-search", type: "search", value: S.reviewSearch || "", placeholder: "Search people, roles or plan IDs", "aria-label": "Search reviews",
    onsearch: () => clearReviewSearch(search, S.reviewSearch, () => { S.reviewSearch = ""; navigate(); }),
    oninput: () => {
      // The browser's native search-field X clears the visible value and fires input/search.
      // Clear the applied query too, while leaving the current status filter untouched.
      clearReviewSearch(search, S.reviewSearch, () => { S.reviewSearch = ""; navigate(); });
    } });
  const chips = h("div", { class: "rv-filters", role: "group", "aria-label": "Review status" },
    FILTERS.map(([k, l]) => h("button", { type: "button", class: "rv-chip", "aria-pressed": String(k === filter),
      onclick: () => { S.reviewFilter = k; navigate(); } }, l)));
  // bulk actions appear only once something is selected
  const count = h("b", { role: "status" }, "0");
  const boxes = [];
  const bulkButtons = ["archive", "restore", "delete"].map((action) => h("button", { class: "btn sm", disabled: true,
    onclick: () => reviewAction(main, [...selected], action, navigate) }, action[0].toUpperCase() + action.slice(1)));
  const bulk = h("div", { class: "rv-bulk", hidden: true }, count, " selected", ...bulkButtons);
  function selection() {
    count.textContent = String(selected.size); bulk.hidden = !selected.size;
    bulkButtons.forEach((b) => b.disabled = !selected.size || selected.size > 50);
  }
  const all = h("input", { type: "checkbox", "aria-label": "Select all shown", title: "Select all shown", onchange: (e) => { boxes.forEach(([box, pid]) => { box.checked = e.target.checked; if (box.checked) selected.add(pid); else selected.delete(pid); }); selection(); } });
  const queue = h("nav", { class: "queue", "aria-label": "Review queue" },
    h("header", { class: "rv-head" }, h("label", { class: "rv-all" }, all), h("strong", {}, "Reviews"), h("span", { class: "rv-count" }, String(shown.length)),
      h("kbd", { class: "hide-sm", title: "Move through the list with J and K" }, "J / K")),
    h("form", { class: "rv-tools", role: "search", onsubmit: (e) => { e.preventDefault(); S.reviewSearch = search.value; navigate(); } }, search),
    chips, bulk,
    shown.length ? shown.map((p) => {
      const name = p.review.candidate_name || p.subject_id;
      const box = h("input", { type: "checkbox", class: "rv-check", "aria-label": `Select ${name}`, onchange: () => { if (box.checked) selected.add(p.plan_id); else selected.delete(p.plan_id); all.checked = selected.size === shown.length; all.indeterminate = selected.size > 0 && selected.size < shown.length; selection(); } });
      boxes.push([box, p.plan_id]);
      return h("div", { class: "review-entry" }, box, h("button", { class: "queue-item", "aria-current": String(p.plan_id === id),
      onclick: () => { location.hash = `#/review/${p.plan_id}`; } },
      h("span", { class: "rv-avatar", "aria-hidden": "true" }, initials(name)),
      h("span", { class: "rv-main" },
        h("span", { class: "l1" }, h("span", { class: "id" }, name), reviewBadge(p.review)),
        h("span", { class: "l2" }, p.review.candidate_name ? `${p.subject_id} · ${sentence(p.target_role)}` : sentence(p.target_role)),
        progressBar(p.progress))),
      reviewMenu(main, p.plan_id, p.review, () => editReview(main, p.plan_id, p.review, navigate, p.subject_id, p.plan_reference), navigate, name)); })
      : h("div", { class: "empty" }, h("p", { class: "muted" }, "Nothing here yet.")));
  const detail = h("section", { class: "detail", "aria-label": "Plan detail" });
  // Each plan opens in a floating panel over the queue; the scrim (or Escape) closes it.
  const scrim = h("a", { class: "rv-scrim", href: "#/review", "aria-label": "Close plan", tabindex: "-1" });
  const wrap = h("div", { class: "review", "data-pane": location.hash.split("/")[2] ? "detail" : "list" }, queue, scrim, detail);
  // Keep the list's position when selecting a plan or returning from detail on phones.
  const previousQueue = main.querySelector(".queue");
  if (previousQueue?.getClientRects().length) S.reviewQueueScroll = previousQueue.scrollTop;
  main.replaceChildren(wrap);
  queue.scrollTop = S.reviewQueueScroll || 0;
  if (id) loadDetail(id, detail, wrap);
}

const FILTERS = [["active", "Active"], ["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["archived", "Archived"], ["all", "All"]];
const PACE = { done: ["Completed", "ok"], ahead: ["Ahead", "ok"], on_track: ["On track", "ok"], behind: ["Behind", "warn"], not_started: ["Not started", "idle"] };
// a person's initials; a pseudonymous ID (E-010) shows its last two characters instead
const initials = (name) => /\d/.test(name || "") && !/\s/.test(name) ? String(name).replace(/[^A-Za-z0-9]/g, "").slice(-2).toUpperCase()
  : (name || "?").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
const sentence = (text) => (text ? text[0].toUpperCase() + text.slice(1) : "");
/** A thin progress bar with its percentage: how much of the 90-day plan the employee has ticked off. */
const progressBar = (pr) => pr && pr.total ? h("span", { class: `rv-progress pace-${pr.pace}`, title: `${pr.done} of ${pr.total} steps · ${PACE[pr.pace]?.[0] || ""}` },
  h("i", { style: { width: `${pr.pct}%` } }), h("b", {}, `${pr.pct}%`)) : null;

function reviewBadge(review) {
  const status = review.archived ? "archived" : review.review_status;
  return h("span", { class: `tag ${status}` }, status[0].toUpperCase() + status.slice(1));
}

function clearReviewSearch(input, appliedQuery, clear) {
  if (input.value.trim() || !appliedQuery) return false;
  clear();
  return true;
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

function reviewMenu(main, pid, review, edit, done, name = pid) {
  const trigger = h("button", { type: "button", class: "review-menu-trigger", "aria-label": `Review actions for ${name}`, title: `Review actions for ${name}` }, "⋯");
  const panel = h("div", { class: "review-menu-items", role: "menu", "aria-label": `Review actions for ${name}` });
  const floating = floatingMenu(trigger, panel, { maxHeight: 240 });
  panel.replaceChildren(h("button", { type: "button", class: "btn sm", role: "menuitem", onclick: () => { floating.close(); edit(); } }, "Edit review"),
    ...[review.archived ? "restore" : "archive", "delete"].map((action) => h("button", { type: "button", class: "btn sm", role: "menuitem",
      onclick: () => { floating.close(); reviewAction(main, [pid], action, done); } }, action[0].toUpperCase() + action.slice(1))));
  return h("div", { class: "review-menu" }, trigger);
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

function editReview(main, pid, review, done, employeeId, planReference) {
  const dialog = reviewDialog(main, "Edit candidate review");
  const inputs = {};
  const fields = [["employee_id", "Employee ID", "text", 32], ["plan_reference", "Plan ID", "text", 7], ["candidate_name", "Candidate name", "text", 120], ["candidate_email", "Email", "email", 254], ["candidate_phone", "Phone", "tel", 50], ["reviewer_notes", "Reviewer notes", "textarea", 10000]];
  const form = h("form", { class: "review-form" }, h("h2", {}, "Edit candidate review"),
    h("p", { class: "muted" }, "HR review details are saved separately from the original AI analysis and plan approval."),
    fields.map(([key, label, type, max]) => {
      inputs[key] = type === "textarea" ? h("textarea", { class: "input", rows: 5, maxlength: max }, review[key]) : h("input", { class: "input", type, maxlength: max, value: key === "employee_id" ? employeeId : key === "plan_reference" ? planReference : review[key] });
      if (key === "employee_id") { inputs[key].required = true; inputs[key].pattern = "[A-Za-z0-9_-]{1,32}"; }
      if (key === "plan_reference") { inputs[key].required = true; inputs[key].pattern = "P[0-9]{6}"; inputs[key].placeholder = "P000123"; inputs[key].title = "P followed by six digits, for example P000123"; }
      return h("label", { class: "field" }, h("span", {}, label), inputs[key]);
    }));
  inputs.review_status = h("select", { class: "input" }, ["pending", "approved", "rejected"].map((s) => h("option", { value: s, selected: s === review.review_status }, s[0].toUpperCase() + s.slice(1))));
  const submit = h("button", { class: "btn primary", type: "submit" }, "Save review");
  const error = h("p", { class: "issue error", role: "alert", hidden: true });
  form.append(h("p", { class: "muted" }, "Previously generated IDs can be reused when no other current plan uses them. Plan IDs use P followed by six digits (P000123). Use an employee account's ID to share this plan with them."), error,
    h("label", { class: "field" }, h("span", {}, "Review status"), inputs.review_status),
    h("div", { class: "filters" }, h("button", { class: "btn", type: "button", onclick: () => dialog.close() }, "Cancel"), submit));
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); if (submit.disabled) return; submit.disabled = true; error.hidden = true;
    try { await api(`/api/reviews/${pid}/edit`, { method: "POST", body: { ...Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim()])), revision: review.revision } });
      dialog.close(); toast("Review saved"); await done();
    } catch (err) { error.textContent = err.message; error.hidden = false; toast(err.message, "err"); } finally { submit.disabled = false; }
  });
  dialog.append(form); dialog.showModal();
}

const ago = (utc) => {
  if (!utc) return "never";
  const days = Math.floor((Date.now() - new Date(utc).getTime()) / 864e5);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 30 ? `${days} days ago` : fmtTime(utc);
};

/** The employee's progress through their plan, for HR: a ring, pace, last activity and each 30-day phase. */
function progressCard(pr) {
  if (!pr?.total) return null;
  const [paceLabel, paceTone] = PACE[pr.pace] || ["", "idle"];
  return h("section", { class: "rv-card rv-progress-card", "aria-label": "Employee progress" },
    h("div", { class: "rv-ring", style: { "--p": pr.pct }, role: "img", "aria-label": `${pr.pct}% of the plan done` }, h("b", {}, `${pr.pct}%`)),
    h("div", { class: "rv-progress-facts" },
      h("div", { class: "rv-progress-top" }, h("strong", {}, `${pr.done} of ${pr.total} steps done`), h("span", { class: `rv-pace ${paceTone}` }, paceLabel)),
      h("p", { class: "muted" }, `Day ${pr.day} of 90 · expected ${pr.expected_pct}% by now · last activity ${ago(pr.last_utc)}`),
      h("ol", { class: "rv-phases" }, pr.phases.map((ph) => h("li", {},
        h("span", {}, `Days ${ph.days}`), h("span", { class: "rv-phase-bar" }, h("i", { style: { width: `${ph.total ? (100 * ph.done) / ph.total : 0}%` } })),
        h("span", { class: "num" }, `${ph.done}/${ph.total}`))))));
}

async function loadDetail(id, detail, wrap) {
  detail.replaceChildren(h("div", { class: "detail-body" }, h("p", { class: "muted" }, "Loading…")));
  let d;
  try { d = await api(`/api/plans/${id}`); } catch (e) { detail.replaceChildren(h("div", { class: "detail-body" }, h("div", { class: "issue error" }, e.message))); return; }
  if (!detail.isConnected) return;
  const r = d.report;
  const scenario = d.plan?.scenario || r?.request?.scenario;
  const name = d.review.candidate_name || d.subject_id;
  const cite = (cid) => { show("evidence"); document.getElementById(`src-${cid}`)?.scrollIntoView({ block: "nearest" }); };
  const contact = [[d.review.candidate_email, "mail"], [d.review.candidate_phone, "user"]].filter(([v]) => v);
  // Plan, the analysis behind it, HR's notes, the sources and the audit trail sit on tabs instead of one long page.
  const panes = {
    plan: () => planBlock({ planId: id, planReference: d.plan_reference, plan: d.plan, version: d.version, status: d.status, weeklyHours: null, progress: d.progress, evidence: d.report?.evidence, startDate: d.started_utc,
      approverLabel: "I have reviewed this plan", title: "90-day plan", onChange: async (next) => {
        if (next === "approved") S.status.set("celebrating", `${d.subject_id} approved`);
        await reviewView($("#main"), id);
      } }),
    analysis: () => r ? [h("section", { class: "block" }, h("h3", {}, "Summary"), staticText(r.narrative, cite)),
      r.gaps?.length ? gapsBlock(r.gaps) : null,
      r.comparison?.length ? comparisonBlock(r.comparison, scenario) : scenario ? h("section", { class: "block" },
        h("h3", {}, `${scenario === "agentic" ? "Agentic" : "Assistive"} AI comparison`),
        h("p", { class: "muted" }, "No Assistive versus Agentic comparison was saved for this report.")) : null,
      r.outlook ? outlookBlock(r.outlook) : null, r.signals ? signalsBlock(r.signals) : null, r.sdgs?.length ? sdgBlock(r.sdgs) : null]
      : h("p", { class: "muted" }, "No analysis was saved for this plan."),
    notes: () => h("section", { class: "block" }, h("h3", {}, "Reviewer notes"), h("p", { class: "review-notes" }, d.review.reviewer_notes || "No notes yet."),
      d.original_employee_id ? h("p", { class: "muted mono" }, `CSV ID ${d.original_employee_id}`) : null),
    evidence: () => h("section", { class: "block rv-sources" }, h("h3", {}, "Sources"),
      r?.evidence?.length ? r.evidence.map(sourceItem) : h("p", { class: "muted" }, "No sources available.")),
    history: () => [h("section", { class: "block" }, h("h3", {}, "Audit trail ", h("span", { class: "muted" }, "UTC")), historyBlock(d.history)),
      h("section", { class: "block" }, h("h3", {}, "HR review history"), d.review_history.length ? d.review_history.map((event) => h("details", {},
        h("summary", {}, `${event.action} by ${event.actor} · ${fmtTime(event.at_utc)}`),
        h("pre", { class: "review-notes" }, JSON.stringify({ before: event.before, after: event.after }, null, 2)))) : h("p", { class: "muted" }, "No review changes yet."))],
  };
  const paneHost = h("div", { class: "rv-pane" });
  const tabs = h("div", { class: "rv-tabs", role: "tablist", "aria-label": "Plan sections" },
    [["plan", "Plan"], ["analysis", "Analysis"], ["notes", "Notes"], ["evidence", "Evidence", r?.evidence?.length], ["history", "History"]].map(([key, label, n]) =>
      h("button", { type: "button", role: "tab", "data-tab": key, "aria-selected": String(key === (S.reviewTab || "plan")), onclick: () => show(key) },
        label, n ? h("span", { class: "rv-count" }, n) : null)));
  function show(key) {
    S.reviewTab = key;
    tabs.querySelectorAll("[role=tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === key)));
    paneHost.replaceChildren(...[panes[key]()].flat().filter(Boolean));
  }
  const body = h("div", { class: "detail-body" },
    h("a", { class: "btn ghost sm back", href: "#/review" }, icon("back"), "Back to queue"),
    h("header", { class: "rv-card rv-person" },
      h("span", { class: "rv-avatar lg", "aria-hidden": "true" }, initials(name)),
      h("div", { class: "rv-person-main" },
        h("div", { class: "rv-person-name" }, h("h2", {}, name), reviewBadge(d.review), h("span", { class: `tag ${d.status}` }, d.status)),
        h("p", { class: "muted" }, [d.subject_id, sentence(d.plan.target_role), scenario ? `${scenario === "agentic" ? "Agentic" : "Assistive"} AI` : null, d.plan_reference, `v${d.version}`].filter(Boolean).join(" · ")),
        contact.length ? h("p", { class: "rv-contact" }, contact.map(([v, ic]) => h("span", {}, icon(ic), v))) : null),
      h("div", { class: "rv-person-actions" }, planStatusControl($("#main"), d, () => reviewView($("#main"), id)),
        reviewMenu($("#main"), id, d.review, () => editReview($("#main"), id, d.review, () => reviewView($("#main"), id), d.subject_id, d.plan_reference), () => {
          if (location.hash === "#/review") return reviewView($("#main"));
          location.hash = "#/review";
        }, name))),
    d.status === "flagged" ? h("div", { class: "banner flag", role: "alert" }, h("strong", {}, "Flagged."), h("span", {}, "Fix the issues and save a new draft before approval.")) : null,
    r?.issues?.filter((i) => i.severity === "error").map((i) => h("div", { class: "issue error" }, i.message)),
    progressCard(d.progress_summary),
    tabs, paneHost);
  detail.replaceChildren(body);
  show(S.reviewTab || "plan");
}

boot().catch((e) => app.replaceChildren(h("main", { class: "view" }, h("div", { class: "issue error" }, `Could not start: ${e.message}`))));
