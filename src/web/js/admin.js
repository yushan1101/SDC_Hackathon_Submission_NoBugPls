// AiversePulse Admin: approve HR accounts, enable/disable accounts, token use, fraud monitoring (Sift-style risk
// events) and payments. Admin-only API (/api/admin/*); everyone else is sent to their own app.
import "./motion.js";
import { api, h, $, icon, toast, fmtTime, ApiError } from "./lib.js";
import { Owl } from "./owl.js";

const app = $("#app");
const S = { me: null };
const money = (cents, cur) => new Intl.NumberFormat(undefined, { style: "currency", currency: (cur || "myr").toUpperCase() }).format((cents || 0) / 100);
const num = (n) => (n || 0).toLocaleString();
const PLAN = { free: "Free", pro: "Pro", team: "Team", org: "Organisation" };
const STATUS = { active: "active", pending_approval: "waiting for approval", pending_email: "email not verified", disabled: "disabled" };
const SIDEBAR_EXPANDED_KEY = "ap.admin.sidebar.expanded";
const LEGACY_SIDEBAR_PIN_KEY = "ap.admin.sidebar.pinned";

function storedSidebarExpanded() {
  try {
    const saved = localStorage.getItem(SIDEBAR_EXPANDED_KEY) ?? localStorage.getItem(LEGACY_SIDEBAR_PIN_KEY);
    return saved == null ? true : saved === "true";
  } catch { return true; }
}

async function boot() {
  try { S.me = await api("/api/me"); } catch (e) {
    if (e instanceof ApiError && e.status === 401) { location.replace("./#/signin"); return; }
    throw e;
  }
  if (S.me.role !== "admin") { location.replace(S.me.role === "hr_advisor" ? "enterprise.html" : "./"); return; }
  shell();
  addEventListener("hashchange", route);
  route();
}

function shell() {
  let sidebarExpanded = storedSidebarExpanded(), mobileOpen = false;
  let shellEl, sidebar, sidebarToggle, mobileToggle, closeButton;
  const isMobile = () => matchMedia("(max-width: 767px)").matches;
  const link = (href, label, ic) => h("a", { class: "admin-nav-link", href, "data-route": href, "aria-label": label, title: label },
    icon(ic), h("span", { class: "lbl" }, label), h("span", { class: "tip", "aria-hidden": "true" }, label));
  const updateSidebar = () => {
    if (!shellEl) return;
    const small = isMobile();
    shellEl.classList.toggle("is-sidebar-expanded", sidebarExpanded);
    shellEl.classList.toggle("is-sidebar-collapsed", !sidebarExpanded);
    shellEl.classList.toggle("is-mobile-nav-open", small && mobileOpen);
    sidebarToggle.setAttribute("aria-expanded", String(sidebarExpanded));
    sidebarToggle.setAttribute("aria-label", sidebarExpanded ? "Collapse sidebar" : "Expand sidebar");
    sidebarToggle.title = sidebarExpanded ? "Collapse sidebar" : "Expand sidebar";
    mobileToggle.setAttribute("aria-expanded", String(small && mobileOpen));
    mobileToggle.setAttribute("aria-label", small && mobileOpen ? "Close navigation" : "Open navigation");
    mobileToggle.title = small && mobileOpen ? "Close navigation" : "Open navigation";
    mobileToggle.classList.toggle("is-open", small && mobileOpen);
  };
  const closeMobile = (restoreFocus = false) => {
    mobileOpen = false; updateSidebar();
    if (restoreFocus) mobileToggle.focus();
  };
  const brand = h("a", { class: "logo", href: "#/overview", "aria-label": "AiversePulse Admin home" },
    new Owl({ size: 32, state: "idle" }).el, h("span", { class: "lbl wordmark" }, "Admin"));
  sidebarToggle = h("button", { class: "admin-sidebar-toggle", type: "button", "aria-expanded": String(sidebarExpanded),
    onclick: () => {
      sidebarExpanded = !sidebarExpanded;
      try { localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(sidebarExpanded)); } catch { /* keep the preference for this page */ }
      updateSidebar();
    } }, icon("chevron"));
  closeButton = h("button", { class: "admin-mobile-close", type: "button", "aria-label": "Close navigation", title: "Close navigation",
    onclick: () => closeMobile(true) }, icon("close"));
  mobileToggle = h("button", { class: "admin-menu-toggle", type: "button", "aria-controls": "admin-sidebar", "aria-expanded": "false",
    onclick: () => {
      mobileOpen = !mobileOpen; updateSidebar();
      if (mobileOpen) sidebar.querySelector("a")?.focus();
      else mobileToggle.focus();
    } }, h("span", { class: "admin-menu-glyph", "aria-hidden": "true" }, h("i"), h("i"), h("i")));
  sidebar = h("nav", { id: "admin-sidebar", class: "rail admin-rail", "aria-label": "Admin navigation",
    onclick: (event) => { if (isMobile() && event.target.closest("a")) closeMobile(true); } },
    h("div", { class: "admin-rail-head" }, brand, sidebarToggle, closeButton),
    link("#/overview", "Overview", "nav-overview"), link("#/enterprises", "Enterprises", "nav-hiring"), link("#/accounts", "Accounts", "nav-team"), link("#/usage", "Token use", "nav-tokens"),
    link("#/fraud", "Fraud monitoring", "nav-fraud"), link("#/payments", "Payments", "nav-payments"),
    link("#/models", "AI models", "nav-models"), link("#/sites", "Frontend sites", "nav-sites"),
    h("div", { class: "admin-rail-spacer" }),
    h("a", { class: "admin-nav-link admin-signout", href: "#", "aria-label": "Sign out", title: "Sign out", onclick: (e) => { e.preventDefault(); signOut(); } },
      icon("nav-signout"), h("span", { class: "lbl" }, "Sign out"), h("span", { class: "tip", "aria-hidden": "true" }, "Sign out")));
  let wasMobile = isMobile();
  addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mobileOpen) { event.preventDefault(); closeMobile(true); }
    if (event.key === "Tab" && mobileOpen) {
      const focusable = [...sidebar.querySelectorAll('a[href], button:not([disabled])')].filter((el) => el.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
  });
  addEventListener("resize", () => {
    const nowMobile = isMobile();
    if (nowMobile !== wasMobile) { mobileOpen = false; wasMobile = nowMobile; }
    updateSidebar();
  });
  const tab = (href, label, ic) => h("a", { href, "data-route": href }, icon(ic), label);
  const scrim = h("button", { class: "admin-nav-scrim", type: "button", "aria-label": "Close navigation", onclick: () => closeMobile(true) });
  shellEl = h("div", { class: "hr-shell admin-shell" }, sidebar, scrim,
    h("header", { class: "hr-top admin-top" }, mobileToggle, S.crumb = h("div", { class: "crumb" }),
      h("div", { class: "who" }, h("div", {}, S.me.display_name || S.me.username), h("div", { class: "muted" }, "Administrator"))),
    h("main", { id: "main", class: "hr-main", tabindex: "-1" }),
    h("nav", { class: "hr-tabbar", "aria-label": "Primary" }, tab("#/overview", "Overview", "grid"), tab("#/enterprises", "Enterprises", "job"), tab("#/accounts", "Accounts", "people"),
      tab("#/usage", "Tokens", "pulse"), tab("#/fraud", "Fraud", "flag"), tab("#/payments", "Payments", "file"),
      tab("#/models", "Models", "model"), tab("#/sites", "Sites", "globe")));
  app.replaceChildren(shellEl);
  updateSidebar();
}

async function signOut() { await api("/api/logout", { method: "POST" }).catch(() => {}); location.replace("./"); }

function route() {
  const page = (location.hash.slice(2) || "overview").split("/")[0];
  const views = { overview, enterprises, accounts, usage, fraud, payments, models, sites };
  if (!views[page]) { location.replace("#/overview"); return; }
  const names = { overview: "Overview", enterprises: "Enterprises", accounts: "Accounts", usage: "Token use", fraud: "Fraud monitoring", payments: "Payments", models: "AI models", sites: "Frontend sites" };
  S.crumb.textContent = names[page];
  document.querySelectorAll("[data-route]").forEach((a) => {
    if (a.dataset.route === `#/${page}`) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  const main = $("#main");
  main.replaceChildren(h("div", { class: "view" }, h("p", { class: "muted" }, "Loading…")));
  views[page](main).catch((e) => main.replaceChildren(h("div", { class: "view" }, h("div", { class: "issue error", role: "alert" }, e.message))));
}

const view = (title, ...kids) => h("div", { class: "view" }, h("div", { class: "view-head" }, h("h1", {}, title)), ...kids);
const stat = (ic, value, label, tone = "") => h("div", { class: `stat ${tone}` }, h("span", { class: "stat-ic" }, icon(ic)), h("b", {}, value), h("span", {}, label));
const table = (cols, rows, empty = "Nothing here yet.") => rows.length
  ? h("div", { class: "table-wrap" }, h("table", { class: "data" }, h("thead", {}, h("tr", {}, cols.map((c) => h("th", {}, c)))), h("tbody", {}, rows)))
  : h("p", { class: "muted" }, empty);

async function setStatus(username, status, after) {
  await api(`/api/admin/users/${encodeURIComponent(username)}/status`, { method: "POST", body: { status } });
  toast(status === "active" ? `${username} is active` : status === "disabled" ? `${username} is disabled and signed out` : `${username} is on hold`);
  after();
}

// ---------------------------------------------------------------- overview: numbers + HR accounts to approve
async function overview(main) {
  const [s, pending] = await Promise.all([api("/api/admin/summary"), api("/api/admin/users?status=pending_approval")]);
  main.replaceChildren(view("Overview",
    h("div", { class: "stats" },
      stat("people", num(s.users), "accounts"), stat("clock", num(s.pending_approval), "waiting for approval", s.pending_approval ? "warn" : ""),
      stat("check", num(s.paid), "on a paid plan"), stat("file", money(s.revenue_30d_cents, s.currency), "revenue, 30 days"),
      stat("pulse", num(s.tokens_30d), `tokens, 30 days (${num(s.llm_calls_30d)} LLM calls)`),
      stat("flag", `${num(s.risk_blocked_7d)} / ${num(s.risk_review_7d)}`, "blocked / flagged, 7 days", s.risk_blocked_7d ? "warn" : "")),
    h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Waiting for approval")),
      h("div", { class: "pad" }, table(["Account", "Type", "Email", "Signed up", "Risk", ""], pending.map((u) => h("tr", {},
        h("td", {}, h("b", {}, u.display_name || u.username), h("div", { class: "muted" }, u.username)),
        h("td", {}, u.role === "hr_advisor" ? "HR advisor" : "Individual"), h("td", {}, u.email || "–"), h("td", {}, fmtTime(u.created_utc)),
        h("td", {}, riskTag(u.risk)),
        h("td", { class: "row-actions" },
          h("button", { class: "btn sm primary", onclick: () => setStatus(u.username, "active", () => overview(main)) }, icon("check"), "Approve"),
          h("button", { class: "btn sm", onclick: () => setStatus(u.username, "disabled", () => overview(main)) }, "Reject")))),
        "No accounts are waiting. New HR sign-ups and flagged sign-ups appear here.")))));
}

const riskTag = (score) => h("span", { class: `tag ${score >= 70 ? "flagged" : score >= 40 ? "draft" : "approved"}`, title: "Highest risk score in the last 30 days" }, String(score ?? 0));

// ---------------------------------------------------------------- accounts: search, approve, enable/disable, trust
async function accounts(main) {
  const q = h("input", { class: "input", type: "search", placeholder: "Search username, email or name", "aria-label": "Search accounts" });
  const st = h("select", { class: "input", "aria-label": "Status" },
    [["", "All statuses"], ...Object.entries(STATUS)].map(([v, l]) => h("option", { value: v }, l)));
  const host = h("div");
  const draw = async () => {
    const rows = await api(`/api/admin/users?q=${encodeURIComponent(q.value.trim())}&status=${st.value}`);
    host.replaceChildren(table(["Account", "Role", "Plan", "Status", "Risk", "Signed up", ""], rows.map((u) => h("tr", {},
      h("td", {}, h("b", {}, u.display_name || u.username), h("div", { class: "muted" }, `${u.username}${u.email ? ` · ${u.email}` : ""}`)),
      h("td", {}, u.role === "hr_advisor" ? "HR advisor" : "Individual"),
      h("td", {}, PLAN[u.effective_plan] || u.effective_plan, u.plan_until && ["pro", "team"].includes(u.effective_plan) ? h("div", { class: "muted" }, `until ${new Date(u.plan_until).toLocaleDateString()}`) : null),
      h("td", {}, h("span", { class: `tag ${u.status === "active" ? "approved" : u.status === "disabled" ? "flagged" : "draft"}` }, STATUS[u.status] || u.status)),
      h("td", {}, riskTag(u.risk), u.trusted ? h("span", { class: "tag approved", title: "Trusted: always allowed by the risk checks" }, "trusted") : null),
      h("td", {}, fmtTime(u.created_utc)),
      h("td", { class: "row-actions" },
        u.status !== "active" ? h("button", { class: "btn sm primary", onclick: () => setStatus(u.username, "active", draw) }, u.status === "disabled" ? "Enable" : "Approve") : null,
        u.status !== "disabled" ? h("button", { class: "btn sm", onclick: () => setStatus(u.username, "disabled", draw) }, "Disable") : null,
        h("button", { class: "btn sm ghost", onclick: async () => {
          await api(`/api/admin/users/${encodeURIComponent(u.username)}/trust`, { method: "POST", body: { trusted: !u.trusted } });
          toast(u.trusted ? "No longer trusted" : "Marked as trusted"); draw(); } }, u.trusted ? "Untrust" : "Trust"))))));
  };
  let t;
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(draw, 250); });
  st.addEventListener("change", draw);
  main.replaceChildren(view("Accounts", h("div", { class: "admin-filters" }, q, st), host));
  await draw();
}

// ---------------------------------------------------------------- token use: per day, user, model, agent, feature
async function usage(main) {
  let days = 30;
  const host = h("div", { class: "admin-usage-layout" });
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Period" }, [7, 30, 90].map((d) => h("button", { type: "button", "aria-pressed": String(d === days),
    onclick: (e) => { days = d; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); draw(); } }, `${d} days`)));
  const draw = async () => {
    const u = await api(`/api/admin/usage?days=${days}`);
    const total = (rows) => rows.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0);
    const max = Math.max(1, ...u.by_day.map((r) => r.input_tokens + r.output_tokens));
    const byDay = [...u.by_day].sort((a, b) => a.key.localeCompare(b.key));
    const group = (title, rows, label = (k) => k) => h("section", { class: "panel" }, h("header", {}, h("h2", {}, title)),
      h("div", { class: "pad" }, table(["", "LLM calls", "Input tokens", "Output tokens", "Est. cost (USD)"], rows.map((r) => h("tr", {},
        h("td", {}, h("b", {}, label(r.key) || "–")), h("td", { class: "n" }, num(r.calls)), h("td", { class: "n" }, num(r.input_tokens)),
        h("td", { class: "n" }, num(r.output_tokens)), h("td", { class: "n" }, r.est_usd ? r.est_usd.toFixed(4) : "–"))))));
    host.replaceChildren(
      h("div", { class: "stats admin-usage-stats" }, stat("pulse", num(total(u.by_day)), `tokens in ${days} days`),
        stat("people", num(u.by_user.length), "accounts using AI"), stat("spark", num(u.by_model.length), "models")),
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Tokens per day")),
        h("div", { class: "pad" }, byDay.length ? h("ol", { class: "day-bars", "aria-label": "Tokens per day" }, byDay.map((r) => {
          const n = r.input_tokens + r.output_tokens;
          return h("li", { title: `${r.key}: ${num(n)} tokens, ${num(r.calls)} calls` }, h("i", { style: { height: `${Math.max(2, (100 * n) / max)}%` } }), h("span", {}, r.key.slice(5)));
        })) : h("p", { class: "muted" }, "No LLM calls in this period."))),
      group("By account", u.by_user), group("By model", u.by_model), group("By agent", u.by_agent), group("By feature", u.by_feature));
  };
  main.replaceChildren(view("Token use", h("div", { class: "admin-filters" }, seg), host));
  await draw();
}

// ---------------------------------------------------------------- fraud monitoring: Sift-style risk events
async function fraud(main) {
  let decision = "";
  const host = h("div");
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Decision" },
    [["", "All"], ["block", "Blocked"], ["review", "Flagged"], ["allow", "Allowed"]].map(([k, l]) => h("button", { type: "button", "aria-pressed": String(k === decision),
      onclick: (e) => { decision = k; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); draw(); } }, l)));
  const draw = async () => {
    const rows = await api(`/api/admin/risk?days=7&decision=${decision}`);
    const tone = { block: "flagged", review: "draft", allow: "approved" };
    host.replaceChildren(table(["When", "Event", "Account", "Score", "Decision", "Why", "Device", ""], rows.map((r) => h("tr", {},
      h("td", {}, fmtTime(r.at_utc)), h("td", {}, r.event.replace("_", " ")), h("td", {}, r.username || "–"),
      h("td", { class: "n" }, String(r.score)), h("td", {}, h("span", { class: `tag ${tone[r.decision]}` }, r.decision)),
      h("td", {}, r.reasons.length ? h("ul", { class: "risk-reasons" }, r.reasons.map((x) => h("li", {}, x))) : h("span", { class: "muted" }, "no signals")),
      h("td", { class: "muted", title: JSON.stringify(r.signals) }, r.device_id ? r.device_id.slice(0, 8) : "–", r.signals?.tz ? ` · ${r.signals.tz}` : ""),
      h("td", { class: "row-actions" }, r.username && r.event !== "login_failed" ? h("button", { class: "btn sm", onclick: () => setStatus(r.username, "disabled", draw) }, "Disable account") : null))),
      "No risk events in the last 7 days for this filter."));
  };
  main.replaceChildren(view("Fraud monitoring",
    h("p", { class: "muted" }, "Every sign-up, login and payment is scored from device and behaviour signals and recent activity: 40+ is flagged for review, 70+ is blocked. IP addresses are stored only as salted hashes."),
    h("div", { class: "admin-filters" }, seg), host));
  await draw();
}

// ---------------------------------------------------------------- payments
async function payments(main) {
  const rows = await api("/api/admin/payments");
  const tone = (s) => (s === "succeeded" ? "approved" : s === "requires_payment_method" || s === "canceled" ? "flagged" : "draft");
  main.replaceChildren(view("Payments",
    table(["Date", "Account", "Plan", "Amount", "Status", "Stripe", "Receipt"], rows.map((p) => h("tr", {},
      h("td", {}, fmtTime(p.created_utc)), h("td", {}, p.username), h("td", {}, PLAN[p.plan] || p.plan), h("td", { class: "n" }, money(p.amount_cents, p.currency)),
      h("td", {}, h("span", { class: `tag ${tone(p.status)}`, title: p.failure || "" }, p.status === "succeeded" ? "paid" : p.status.replaceAll("_", " "))),
      h("td", { class: "mono muted" }, p.intent_id), h("td", {}, p.receipt_url ? h("a", { href: p.receipt_url, target: "_blank", rel: "noopener noreferrer" }, "Receipt") : "–"))),
      "No payments yet.")));
}

// ---------------------------------------------------------------- enterprises: each one's monthly bill and AI models
async function enterprises(main, month = "") {
  const [d, cat] = await Promise.all([api(`/api/admin/enterprises${month ? `?month=${month}` : ""}`), api("/api/admin/models")]);
  const ready = cat.catalog.filter((m) => m.ready);
  const usd = (n) => `$${Number(n || 0).toFixed(n && n < 1 ? 4 : 2)}`;
  const monthPick = h("input", { class: "input admin-month", type: "month", value: d.month, "aria-label": "Billing month",
    onchange: () => monthPick.value && enterprises(main, monthPick.value) });
  const kindTag = (k) => h("span", { class: "tag" }, k === "school" ? "School" : "Company");
  const planCell = (e) => {
    const live = e.plan === "team";
    const s = e.subscription;
    return h("div", { class: "ent-plan" }, h("span", { class: `tag ${live ? "approved" : "draft"}` }, live ? "Enterprise" : "Not paid"),
      h("small", { class: "muted" }, s ? (s.cancelling ? `ends ${fmtTime(s.renews)}` : s.renews ? `renews ${fmtTime(s.renews)}` : s.status) : "no subscription"));
  };
  const manage = (e) => {
    const dlg = h("dialog", { class: "drawer ent-drawer", "aria-label": `${e.name} details`, onclose: () => dlg.remove() });
    const body = h("div", { class: "pad" }, h("p", { class: "muted" }, "Loading…"));
    dlg.append(h("header", {}, h("h2", {}, e.name), h("button", { class: "btn sm", type: "button", onclick: () => dlg.close() }, "Close")), body);
    document.body.append(dlg); dlg.showModal();
    api(`/api/admin/enterprises/${encodeURIComponent(e.owner)}/bill?month=${d.month}`).then((b) => {
      const models = { ...e.models };
      const picks = Object.entries(d.tasks).map(([task, label]) => {
        const sel = h("select", { class: "input", "aria-label": `${label} model`, onchange: async () => {
          try { const r = await api(`/api/admin/enterprises/${encodeURIComponent(e.owner)}/models`, { method: "POST", body: { task, spec: sel.value } });
            Object.assign(models, r.models); toast(`${label}: ${sel.value || "default"}`); }
          catch (ex) { toast(ex.message, "err"); sel.value = models[task] || ""; }
        } }, h("option", { value: "" }, `Default (${cat.defaults[task] || "rule-based"})`),
          ready.map((m) => h("option", { value: m.spec, selected: models[task] === m.spec ? true : null }, m.label || m.spec)));
        return h("label", { class: "field" }, h("span", {}, label), sel);
      });
      body.replaceChildren(
        h("p", { class: "muted" }, `${e.kind === "school" ? "School" : "Company"} · ${e.members} ${e.members_label.toLowerCase()} · ${e.email || "no email"}`),
        h("h3", {}, "AI model for each task"),
        h("p", { class: "muted" }, "Everyone in this enterprise uses these; Default follows the server's .env."),
        h("div", { class: "ent-models" }, picks),
        h("h3", {}, `Bill for ${b.month}`),
        h("div", { class: "stats ent-bill" },
          h("div", { class: "stat" }, h("b", {}, money(b.subscription_paid_cents, b.currency)), h("span", {}, "subscription paid")),
          h("div", { class: "stat" }, h("b", {}, usd(b.ai_usd)), h("span", {}, `AI usage · ${b.ai_calls} calls`))),
        h("h3", {}, "Subscription payments"),
        table(["Date", "Amount", "Status", "Receipt"], b.payments.map((p) => h("tr", {}, h("td", {}, fmtTime(p.date)), h("td", { class: "n" }, money(p.amount_cents, p.currency)),
          h("td", {}, h("span", { class: `tag ${p.status === "succeeded" ? "approved" : "draft"}` }, p.status === "succeeded" ? "paid" : p.status)),
          h("td", {}, p.receipt_url ? h("a", { href: p.receipt_url, target: "_blank", rel: "noopener noreferrer" }, "Invoice") : "–"))), "No subscription payments this month."),
        h("h3", {}, "AI usage by person"),
        table(["Account", "Calls", "Tokens", "Est. cost"], b.usage.map((u) => h("tr", {}, h("td", {}, u.username), h("td", { class: "n" }, num(u.calls)),
          h("td", { class: "n" }, num(u.tokens)), h("td", { class: "n" }, usd(u.usd)))), "No AI usage this month."));
    }).catch((ex) => body.replaceChildren(h("p", { class: "issue error" }, ex.message)));
  };
  const rows = d.enterprises.map((e) => h("tr", {},
    h("td", {}, h("div", { class: "who" }, h("b", {}, e.name), h("span", { class: "muted" }, e.email || e.owner))),
    h("td", {}, kindTag(e.kind), h("small", { class: "muted ent-members" }, `${e.members} ${e.members_label.toLowerCase()}`)),
    h("td", {}, planCell(e)),
    h("td", { class: "n" }, money(e.paid_cents, e.currency), h("small", { class: "muted" }, ` of ${money(e.monthly_fee_cents, e.currency)}`)),
    h("td", { class: "n" }, usd(e.ai_usd), h("small", { class: "muted" }, ` · ${num(e.ai_calls)} calls`)),
    h("td", {}, Object.keys(e.models).length ? `${Object.keys(e.models).length} custom` : h("span", { class: "muted" }, "defaults")),
    h("td", {}, h("button", { class: "btn sm", type: "button", onclick: () => manage(e) }, "Manage"))));
  main.replaceChildren(view("Enterprises",
    h("div", { class: "admin-filters" }, h("label", { class: "field" }, h("span", {}, "Month"), monthPick),
      h("p", { class: "muted" }, "Each enterprise pays a monthly subscription; AI usage is the estimated model cost of everyone in it.")),
    table(["Enterprise", "Type", "Plan", "Subscription", "AI usage", "Models", ""], rows, "No enterprises yet: HR accounts appear here.")));
}

/** Models the OpenAI-compatible gateway offers (GET /v1/models), each one click from the catalog. */
function gatewayPanel(main) {
  const box = h("section", { class: "gateway-models" }, h("h2", {}, "Models on your gateway"), h("p", { class: "muted" }, "Asking the gateway…"));
  const draw = (refresh) => api(`/api/admin/models/gateway${refresh ? "?refresh=true" : ""}`).then((g) => {
    const head = h("div", { class: "gateway-head" }, h("h2", {}, "Models on your gateway"),
      g.configured ? h("button", { class: "btn sm", type: "button", onclick: () => draw(true) }, icon("replay"), "Refresh") : null);
    if (!g.configured) { box.replaceChildren(head, h("p", { class: "muted" }, "No OpenAI-compatible gateway is set up (LLM_BASE_URL and LLM_API_KEY in .env).")); return; }
    if (!g.reachable) { box.replaceChildren(head, h("p", { class: "issue warning" }, "The gateway didn't answer its /models list. Check LLM_BASE_URL and the key, then Refresh.")); return; }
    box.replaceChildren(head, h("p", { class: "muted" }, `${g.models.length} models available. Add the ones HR advisors and enterprises may use.`),
      h("ul", { class: "gateway-list" }, g.models.map((m) => h("li", {},
        h("code", { class: "mono" }, m.id),
        m.in_catalog ? h("span", { class: "tag approved" }, "in catalog")
          : h("button", { class: "btn sm", type: "button", onclick: async () => {
            try { await api("/api/admin/models", { method: "POST", body: { spec: m.spec, label: m.id } }); toast(`${m.id} added`); models(main); }
            catch (ex) { toast(ex.message, "err"); }
          } }, "Add")))));
  }).catch((e) => box.replaceChildren(h("h2", {}, "Models on your gateway"), h("p", { class: "issue error" }, e.message)));
  draw(false);
  return box;
}

async function models(main) {
  const d = await api("/api/admin/models");
  const spec = h("input", { class: "input", required: true, maxlength: 90, placeholder: "gemini:gemini-3.1-flash  or  openai:gpt-5.6-luna" });  // checked on the server
  const label = h("input", { class: "input", maxlength: 60, placeholder: "Name HR advisors see, e.g. Gemini Flash (fast)" });
  const speechDescription = d.speech
    ? (/^openai:(?:whisper|.*transcrib)/i.test(d.speech)
      ? "Dedicated speech-to-text model"
      : "Audio-capable model used with a transcription prompt")
    : "Browser speech recognition (no server model configured)";
  const defaults = Object.entries(d.tasks).map(([task, description]) => h("tr", {},
    h("td", {}, description), h("td", { class: "mono" }, d.defaults[task] || "none (rule-based)")));
  defaults.push(h("tr", {}, h("td", {}, "Voice transcription"),
    h("td", {}, d.speech
      ? h("div", { class: "admin-speech-model" }, h("code", { class: "mono" }, d.speech), h("span", { class: "muted" }, speechDescription))
      : h("span", { class: "muted" }, speechDescription))));
  main.replaceChildren(view("AI models",
    h("p", { class: "muted" }, "HR advisors can choose any of these for each task. Providers set up: ",
      Object.entries(d.providers).map(([k, v], i) => [i ? ", " : "", `${k === "openai" ? "OpenAI-compatible gateway" : "Gemini"} ${v ? "✓" : "(no key)"}`]), "."),
    table(["Model", "Shown as", "Ready", ""], d.catalog.map((m) => h("tr", {}, h("td", { class: "mono" }, m.spec), h("td", {}, m.label),
      h("td", {}, m.ready ? h("span", { class: "tag approved" }, "ready") : h("span", { class: "tag flagged", title: "Its provider has no API key" }, "no key")),
      h("td", {}, h("button", { class: "btn sm ghost", type: "button", onclick: async () => {
        await api(`/api/admin/models?spec=${encodeURIComponent(m.spec)}`, { method: "DELETE" }); toast("Removed"); models(main);
      } }, "Remove")))), "No extra models yet: everyone uses the defaults below."),
    h("form", { class: "inline-form", onsubmit: async (e) => {
      e.preventDefault();
      try { await api("/api/admin/models", { method: "POST", body: { spec: spec.value.trim(), label: label.value.trim() } }); toast("Added"); models(main); }
      catch (ex) { toast(ex.message, "err"); }
    } }, spec, label, h("button", { class: "btn primary", type: "submit" }, "Add model")),
    gatewayPanel(main),
    h("h2", {}, "Defaults (from .env)"),
    table(["Task", "Default model"], defaults)));
}

async function sites(main) {
  const d = await api("/api/admin/sites");
  const origin = h("input", { class: "input", required: true, type: "url", maxlength: 200, placeholder: "https://jobs.example.com" });
  const label = h("input", { class: "input", maxlength: 60, placeholder: "Name, e.g. Careers site" });
  main.replaceChildren(view("Frontend sites",
    h("p", { class: "muted" }, "Websites allowed to use this backend. Each one serves the same web app with config.js pointing at ",
      h("code", {}, d.backend), ". Sign-in, emails and plugins work from every site."),
    table(["Site", "Name", "Added", ""], [
      ...d.from_env.map((o) => h("tr", {}, h("td", { class: "mono" }, o), h("td", {}, "from .env"), h("td", {}, "–"), h("td", {}))),
      ...d.sites.map((x) => h("tr", {}, h("td", { class: "mono" }, x.origin), h("td", {}, x.label), h("td", {}, fmtTime(x.created_utc)),
        h("td", {}, h("button", { class: "btn sm ghost", type: "button", onclick: async () => {
          if (!confirm(`Stop ${x.origin} from using this backend?`)) return;
          await api(`/api/admin/sites?origin=${encodeURIComponent(x.origin)}`, { method: "DELETE" }); toast("Removed"); sites(main);
        } }, "Remove"))))], "Only this backend's own address can use it."),
    h("form", { class: "inline-form", onsubmit: async (e) => {
      e.preventDefault();
      try { await api("/api/admin/sites", { method: "POST", body: { origin: origin.value.trim(), label: label.value.trim() } }); toast("Site added"); sites(main); }
      catch (ex) { toast(ex.message, "err"); }
    } }, origin, label, h("button", { class: "btn primary", type: "submit" }, "Add site")),
    h("h2", {}, "Hiring plugin apps"),
    h("p", { class: "muted" }, "Create an app on each platform's developer site, register its redirect URL below, then put its keys in .env (see .env.example)."),
    table(["Platform", "Redirect URL", "Keys"], Object.entries(d.plugin_redirects).map(([p, url]) => h("tr", {}, h("td", {}, { linkedin: "LinkedIn", facebook: "Facebook", x: "X" }[p]),
      h("td", { class: "mono" }, url), h("td", {}, d.plugins_ready[p] ? h("span", { class: "tag approved" }, "set") : h("span", { class: "tag draft" }, "not set"))))),
    h("h2", {}, "Deploy a site"),
    h("pre", { class: "md" }, `# any static host (nginx, Cloudflare Pages, Netlify, S3...)
sh src/deploy/build-frontend.sh ${d.backend} dist-web
# upload dist-web/, then add the site's address above`)));
}

boot().catch((e) => app.replaceChildren(h("main", { class: "view" }, h("div", { class: "issue error" }, `Could not start: ${e.message}`))));
