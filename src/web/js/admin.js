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
  const link = (href, label, ic) => h("a", { href, "data-route": href, "aria-label": label, title: label }, icon(ic), h("span", { class: "lbl" }, label));
  const tab = (href, label, ic) => h("a", { href, "data-route": href }, icon(ic), label);
  app.replaceChildren(h("div", { class: "hr-shell" },
    h("nav", { class: "rail", "aria-label": "Primary" },
      h("a", { class: "logo", href: "#/overview", "aria-label": "AiversePulse Admin home" }, new Owl({ size: 32, state: "idle" }).el, h("span", { class: "lbl wordmark" }, "Admin")),
      link("#/overview", "Overview", "grid"), link("#/accounts", "Accounts", "people"), link("#/usage", "Token use", "pulse"),
      link("#/fraud", "Fraud monitoring", "flag"), link("#/payments", "Payments", "file"),
      link("#/models", "AI models", "model"), link("#/sites", "Frontend sites", "globe"),
      h("div", { style: { flex: 1 } }),
      h("a", { href: "#", onclick: (e) => { e.preventDefault(); signOut(); } }, icon("out"), h("span", { class: "lbl" }, "Sign out"))),
    h("header", { class: "hr-top" }, S.crumb = h("div", { class: "crumb" }),
      h("div", { class: "who" }, h("div", {}, S.me.display_name || S.me.username), h("div", { class: "muted" }, "Administrator"))),
    h("main", { id: "main", class: "hr-main", tabindex: "-1" }),
    h("nav", { class: "hr-tabbar", "aria-label": "Primary" }, tab("#/overview", "Overview", "grid"), tab("#/accounts", "Accounts", "people"),
      tab("#/usage", "Tokens", "pulse"), tab("#/fraud", "Fraud", "flag"), tab("#/payments", "Payments", "file"),
      tab("#/models", "Models", "model"), tab("#/sites", "Sites", "globe"))));
}

async function signOut() { await api("/api/logout", { method: "POST" }).catch(() => {}); location.replace("./"); }

function route() {
  const page = (location.hash.slice(2) || "overview").split("/")[0];
  const views = { overview, accounts, usage, fraud, payments, models, sites };
  if (!views[page]) { location.replace("#/overview"); return; }
  const names = { overview: "Overview", accounts: "Accounts", usage: "Token use", fraud: "Fraud monitoring", payments: "Payments", models: "AI models", sites: "Frontend sites" };
  S.crumb.textContent = names[page];
  document.querySelectorAll("[data-route]").forEach((a) => a.toggleAttribute("aria-current", a.dataset.route === `#/${page}`));
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
    h("div", { class: "admin-setup" },
      h("span", { class: `tag ${s.payments_enabled ? "approved" : "draft"}` }, s.payments_enabled ? "Payments on (Stripe)" : "Payments off: add Stripe keys to .env"),
      h("span", { class: `tag ${s.email_codes ? "approved" : "draft"}` }, s.email_codes ? "Email codes on" : "Email codes off: add SMTP settings to .env")),
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
  const host = h("div");
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
      h("div", { class: "stats" }, stat("pulse", num(total(u.by_day)), `tokens in ${days} days`),
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

async function models(main) {
  const d = await api("/api/admin/models");
  const spec = h("input", { class: "input", required: true, maxlength: 90, placeholder: "gemini:gemini-3.1-flash  or  openai:gpt-5.6-luna" });  // checked on the server
  const label = h("input", { class: "input", maxlength: 60, placeholder: "Name HR advisors see, e.g. Gemini Flash (fast)" });
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
    h("h2", {}, "Defaults (from .env)"),
    table(["Task", "Default model"], Object.entries(d.tasks).map(([t, what]) => h("tr", {}, h("td", {}, what), h("td", { class: "mono" }, d.defaults[t] || "none (rule-based)")))),
    h("p", { class: "muted" }, "Voice input: ", h("span", { class: "mono" }, d.speech || "browser only (no speech model set up)"))));
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
