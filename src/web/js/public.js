// AiversePulse (public users): sign-in, plan builder, chat-style streaming report, plans.
import "./motion.js";  // GSAP animations for whatever the app renders
import { jobIcon } from "./jobicons.js";
import { api, stream, h, $, icon, fmtTime, toast, ApiError, reveal, RISE, DROP, SCENARIO_HELP } from "./lib.js";
import { Owl, OwlStatus } from "./owl.js";
import { changesBlock, StreamText, gapsBlock, comparisonBlock, outlookBlock, issuesBlock, planBlock, historyBlock,
  sourceItem, staticText, signalsBlock, sdgBlock } from "./blocks.js";
import { startView, quizView, resumeView, todayView, sdgsView } from "./explore.js";
import { interviewView } from "./interview.js";
import { registerView, pricingView, accountView, planName, verifyLinkView, forgotView, resetLinkView, emailCodeView, inviteView } from "./account.js";
import { termsView, privacyView } from "./legal.js";
import { watchForm } from "./risk.js";
import { micButton, readAloudButton, setVoice } from "./voice.js";
import { agentView, agentSwitch, disposeAgentSwitch, employeeCapsule } from "./agents.js";
import { reportAssistant } from "./report-assistant.js";

const app = $("#app");
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: in-memory only */ } },
};
const S = {
  me: null, meta: null, status: null, sheet: null, sources: null, evidence: new Map(), busy: null,
  // saved profile over the defaults, so an older or partial save never drops a required field
  profile: { target_role: null, target_title: null, scenario: "assistive", weekly_learning_hours: 6, skills: [], ...store.get("ap.profile.v2", {}) },
  thread: [], capsule: null,
};
const saveProfile = () => store.set("ap.profile.v2", S.profile);

// ---------------------------------------------------------------- boot
const PUBLIC_PAGES = new Set(["", "start", "today", "signin", "sdgs", "register", "pricing", "verify", "forgot", "reset", "invite", "terms", "privacy"]);  // everything else needs an account

async function boot() {
  try {
    S.me = await api("/api/me");
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) throw e;
    S.me = null;  // guest: public landing + Today; features ask to sign in
  }
  const emailLink = /^#\/(verify|reset|invite)\//.test(location.hash);  // links from emails open whoever is signed in here
  const billingPage = emailLink || /^#\/(pricing|account)\b/.test(location.hash);
  if (S.me?.role === "admin" && !emailLink) { location.replace("admin.html"); return; }
  if (S.me && S.me.role !== "employee" && !billingPage) { location.replace("enterprise.html"); return; }
  if (S.me) {
    const wait = new Owl({ size: 96, state: "searching" });
    app.replaceChildren(h("main", { class: "empty", style: { margin: "18vh auto 0", "justify-items": "center", "text-align": "center" }, "aria-busy": "true" },
      wait.el, h("p", { class: "muted" }, "Loading…")));
    S.meta = await api("/api/meta");
  }
  shell();
  addEventListener("hashchange", route);
  route();
}

// ---------------------------------------------------------------- sign in
const FEATURE = { quiz: "the quick match game", resume: "resume analysis", build: "the plan builder", report: "your report", plans: "your plans", interview: "mock interview" };

function cleanDestination(next) {
  return ["start", "today", "quiz", "resume", "build", "report", "plans", "interview"].includes(next) ||
    (/^(plans|report|interview)\/[A-Za-z0-9_-]+$/.test(next)) ||
    (/^interview\/start\/[A-Za-z0-9_-]+$/.test(next)) ? next : "start";
}
async function signIn(next = "start") {
  // Only internal hash routes can be used as post-login destinations.
  next = cleanDestination(next);
  const owl = new Owl({ size: 200, state: "greeting" });
  const err = h("p", { class: "error", role: "alert" });
  const user = h("input", { class: "input", name: "username", autocomplete: "username", required: true, maxlength: 254 });
  const pass = h("input", { class: "input", name: "password", type: "password", autocomplete: "current-password", required: true, maxlength: 200 });
  const btn = h("button", { class: "btn primary", type: "submit" }, "Sign in");
  app.replaceChildren(h("main", { class: "signin" },
    h("section", { class: "signin-story" },
      owl.el,
      h("h1", {}, "Know which skills the job market actually asks for.")),
    h("form", { class: "signin-form", onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; err.textContent = "";
      try {
        const me = await api("/api/login", { method: "POST", body: { username: user.value, password: pass.value, risk: signals() } });
        if (me.status === "pending_email") {  // email never verified: a new code was sent, so finish that here
          emailCodeView(app, { username: me.username, email: me.email, waitToken: me.wait_token, onSignedIn: async () => {
            S.me = await api("/api/me"); S.meta = await api("/api/meta"); shell();
            if (location.hash === `#/${next}`) route(); else location.hash = `#/${next}`;
          } });
          return;
        }
        if (me.role === "admin") { location.replace("admin.html"); return; }
        if (me.role !== "employee") { location.replace(next.startsWith("pricing") || next.startsWith("account") ? `./#/${next}` : "enterprise.html"); return; }
        // switch to the signed-in app in place: a hash change + reload could show the guest page again
        S.me = me; S.meta = await api("/api/meta");
        shell();
        if (location.hash === `#/${next}`) route(); else location.hash = `#/${next}`;
      } catch (ex) { err.textContent = ex.message; owl.set("confused"); btn.disabled = false; pass.select(); }
    } },
      h("a", { class: "signin-back", href: "#/start" }, icon("back"), "Back to home"),
      h("span", { class: "wordmark" }, "AiversePulse"),
      FEATURE[next.split("/")[0]] ? h("p", { class: "signin-next" }, `Sign in to open ${FEATURE[next.split("/")[0]]}.`) : null,
      h("label", { class: "field" }, h("span", {}, "Username or email"), user),
      h("label", { class: "field" }, h("span", {}, "Password"), pass),
      err, btn,
      h("p", { class: "fine" }, "Plans stay drafts until you approve them."),
      h("p", { class: "fine" }, "Employees and HR advisors use the same sign-in."),
      h("p", { class: "signin-switch" }, h("a", { href: "#/forgot" }, "Forgot password?")),
      h("p", { class: "signin-switch legal-links" }, h("a", { href: "#/terms" }, "Terms"), " · ", h("a", { href: "#/privacy" }, "Privacy")),
      h("p", { class: "signin-switch" }, "No account yet? ", h("a", { href: "#/register" }, "Create a free account")),
      h("p", { class: "fine" }, "Joining your company? Use the invite link in your email."))));
  const signals = watchForm(app.querySelector(".signin-form"));
  user.focus();
}

// ---------------------------------------------------------------- shell
function shell() {
  setVoice(S.meta?.voice);
  S.status = new OwlStatus({ size: 32, say: "Ready when you are" });
  S.sources = h("aside", { class: "sources", "aria-label": "Sources" }, h("h2", {}, "Sources"),
    h("p", { class: "muted" }, "Sources cited in your plan appear here."));
  S.sheetBody = h("div", { class: "sheet-body" });
  S.sheet = h("dialog", { class: "sheet", "aria-label": "Sources" },
    h("div", { class: "sheet-head" }, h("strong", {}, "Sources"), h("button", { class: "btn sm", onclick: () => S.sheet.close() }, "Close")),
    S.sheetBody);
  const nav = (href, label, ic) => h("a", { href, "data-route": href }, icon(ic), h("span", {}, label));
  const tab = (href, label, ic) => h("a", { href, "data-route": href }, icon(ic), label);
  const guest = !S.me;
  app.replaceChildren(...[
    h("button", { class: "sr-only skip-link", type: "button", onclick: () => $("#main")?.focus() }, "Skip to content"),
    h("header", { class: "pub-top" },
      h("a", { class: "wordmark", href: "#/start" }, "AiversePulse"),
      // guests: the home page and the AI-trends page, and one action: sign in
      guest ? null : S.me.role !== "employee" ? h("nav", { class: "pub-nav", "aria-label": "Primary" }, h("a", { href: "enterprise.html" }, icon("back"), h("span", {}, "Back to console")))
        : h("nav", { class: "pub-nav", "aria-label": "Primary" }, nav("#/start", "Home", "home"), nav("#/agents", "Agent", "ask"), nav("#/today", "AI trends", "pulse"),
          nav("#/report", "Report", "report"), nav("#/plans", "My plans", "plans")),
      guest ? null : S.status.el,
      guest
        ? h("div", { class: "top-actions" }, h("a", { class: "btn sm top-plans", href: "#/today" }, "AI trends"), h("a", { class: "btn sm top-plans", href: "#/pricing" }, "Plans"),
            h("a", { class: "btn sm primary top-signin", href: "#/signin" }, icon("user"), "Sign in"))
        : h("div", { class: "top-actions" }, h("a", { class: "btn sm plan-pill", href: "#/account", "data-route": "#/account", title: "Your plan and payments" },
            icon("user"), planName(S.me.effective_plan || "org")),
          h("button", { class: "btn sm signout", "aria-label": "Sign out", title: "Sign out", onclick: signOut }, icon("out"), h("span", { class: "lbl" }, "Sign out")))),
    h("main", { id: "main", class: "pub-main", tabindex: "-1" }),
    guest ? null : h("nav", { class: "tabbar", "aria-label": "Primary" }, tab("#/start", "Home", "home"), tab("#/agents", "Agent", "ask"), tab("#/today", "AI trends", "pulse"), tab("#/plans", "Plans", "plans")),
    S.me?.role === "employee" ? (S.capsule = employeeCapsule({
      status: S.status,
      getProfile: () => ({ target_title: S.profile.target_title, skills: S.profile.skills }),
      pages: [
        { label: "Home", href: "#/start", icon: "home", words: "dashboard career" },
        { label: "Career assistant", href: "#/agents", icon: "ask", words: "chat coach" },
        { label: "AI trends", href: "#/today", icon: "pulse", words: "skills market" },
        { label: "Career report", href: "#/report", icon: "report", words: "plan analysis" },
        { label: "My plans", href: "#/plans", icon: "plans", words: "learning pathway" },
        { label: "Account", href: "#/account", icon: "user", words: "profile settings" },
      ],
    })) : null,
    S.sheet].filter(Boolean));  // replaceChildren would print a null as the text "null"
}

/** Re-read the account (plan may have changed) and update the plan button in the top bar. */
async function refreshMe() {
  S.me = { ...S.me, ...(await api("/api/me")) };
  const pill = document.querySelector(".plan-pill");
  if (pill) pill.replaceChildren(icon("user"), planName(S.me.effective_plan || "org"));
  return S.me;
}

async function signOut() {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  location.replace("./");
}

let homeScrollTop = 0;
// Hash routes render their own content; restore after that content exists.
history.scrollRestoration = "manual";
function route() {
  disposeAgentSwitch();
  const hash = location.hash || "#/start";
  const [requested = "start", id, ...rest] = hash.startsWith("#/") ? hash.slice(2).split("/") : [];
  const allowed = new Set(["start", "today", "signin", "quiz", "resume", "build", "report", "plans", "sdgs", "interview", "agents", "register", "pricing", "account", "verify", "forgot", "reset", "invite", "terms", "privacy"]);
  const planSection = requested === "plans" && rest.length === 1 && ["1-30", "31-60", "61-90"].includes(rest[0]);
  const interviewStart = requested === "interview" && id === "start" && rest.length === 1 && /^[A-Za-z0-9_-]+$/.test(rest[0]);
  // Unknown routes and malformed nested routes return home instead of showing the wrong page.
  const verifyLink = ["verify", "reset", "invite"].includes(requested) && rest.length === 1 && /^[a-z0-9_.-]{3,40}$/.test(id || "") && /^[A-Za-z0-9_-]{20,80}$/.test(rest[0]);
  if (!allowed.has(requested) || (rest.length && requested !== "signin" && !interviewStart && !verifyLink && !planSection) || (["verify", "reset", "invite"].includes(requested) && !verifyLink) ||
      (id && !["signin", "plans", "report", "interview", "agents", "verify", "reset", "invite"].includes(requested)) || (requested === "agents" && id && !/^[a-z-]{2,20}$/.test(id))) {
    location.replace("#/start");
    return;
  }
  const page = requested;
  if (!S.me && !PUBLIC_PAGES.has(page)) {
    location.replace(`#/signin/${hash.slice(2)}`);
    return;
  }
  if (page === "verify") {  // the link from the sign-up email: confirm and sign in
    verifyLinkView(app, { username: id, token: rest[0], onSignedIn: async () => {
      S.me = await api("/api/me"); S.meta = await api("/api/meta");
      history.replaceState(null, "", "#/start"); shell(); toast("Email verified. Welcome!"); route();
    } });
    return;
  }
  if (page === "forgot") { if (S.me) { location.replace("#/account"); return; } forgotView(app); return; }
  if (page === "reset") { resetLinkView(app, { username: id, token: rest[0] }); return; }
  if (page === "invite") {  // an HR advisor's invite: choose a password, then straight in
    inviteView(app, { username: id, token: rest[0], onSignedIn: async () => {
      S.me = await api("/api/me"); S.meta = await api("/api/meta");
      history.replaceState(null, "", "#/start"); shell(); toast("Welcome! Your account is ready."); route();
    } });
    return;
  }
  if (page === "register") {
    if (S.me) { location.replace("#/account"); return; }
    registerView(app, { onSignedIn: async () => {
      S.me = await api("/api/me"); S.meta = await api("/api/meta");
      shell(); toast("Welcome! You're on the Free plan."); location.hash = "#/start";
    } });
    return;
  }
  if (S.me && S.me.role !== "employee" && !["pricing", "account"].includes(page)) { location.replace("enterprise.html"); return; }
  if (page === "signin") {
    const next = hash.startsWith("#/signin/") ? hash.slice("#/signin/".length) : "start";
    if (S.me) { location.replace(`#/${cleanDestination(next)}`); return; }
    signIn(next);
    return;
  }
  if (!$("#main")) shell();
  // the three starts live on Home; chat agents and the mock interview share the Agents page
  const section = ["quiz", "resume", "build"].includes(page) ? "#/start" : page === "interview" ? "#/agents" : `#/${page}`;
  document.querySelectorAll("[data-route]").forEach((a) => {
    const active = section === a.dataset.route || section.startsWith(a.dataset.route + "/");
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const main = $("#main");
  if (main.classList.contains("home-page")) homeScrollTop = window.scrollY;
  main.classList.toggle("home-page", page === "start");
  if (page === "report") reportView(main, id);
  else if (page === "plans" && id && main.dataset.plan === id && main.querySelector(".plan-block")) main.querySelector(".plan-block").openPane(rest[0] || null, true);  // section subpage of the open plan
  else if (page === "plans" && id) planDetail(main, id, false, rest[0]);
  else if (page === "plans") plansView(main);
  else if (page === "build") buildView(main);
  else if (page === "interview") {
    const pane = h("div");
    main.replaceChildren(agentSwitch("interview"), pane);
    interviewView(pane, interviewStart ? null : id, interviewStart ? rest[0] : null, {
      onPlan: (role, skills, query) => planFor({ soc: role.role_id, title: role.role_title }, skills, query),
    });
  }
  else if (page === "quiz") quizView(main, { status: S.status, planFor, onInterview: startInterview });
  else if (page === "resume") resumeView(main, { status: S.status, planFor, onInterview: startInterview });
  else if (page === "terms") termsView(main).catch((e) => main.append(h("div", { class: "issue error" }, e.message)));
  else if (page === "privacy") privacyView(main).catch((e) => main.append(h("div", { class: "issue error" }, e.message)));
  else if (page === "pricing") pricingView(main, { me: S.me }).catch((e) => main.append(h("div", { class: "issue error" }, e.message)));
  else if (page === "account") accountView(main, { refreshMe }).catch((e) => main.append(h("div", { class: "issue error" }, e.message)));
  else if (page === "sdgs") sdgsView(main).catch((e) => main.append(h("div", { class: "issue error" }, e.message)));
  else if (page === "agents" && id) location.replace("#/agents");  // older links to one specialist: it's all one agent now
  else if (page === "agents") agentView(main, { getProfile: () => ({ target_title: S.profile.target_title, skills: S.profile.skills }) })
    .catch((e) => main.append(h("div", { class: "issue error" }, e.message)));
  else if (page === "today") todayView(main, { guest: !S.me }).catch((e) => main.append(h("div", { class: "issue error" }, e.message)));
  else startView(main, { name: S.me?.display_name?.split(" ")[0], guest: !S.me });
  reveal(main, [{ opacity: 0.4 }, { opacity: 1 }], { duration: 200 });
  if (page !== "report") scrollTo({ top: page === "start" ? homeScrollTop : 0, behavior: "instant" });  // the chat manages its own scroll
}

// ---------------------------------------------------------------- build
function buildView(main) {
  const p = S.profile;
  if (p.target_role && !/^\d{4}(\.\d+)*$/.test(p.target_role)) { p.target_role = null; p.target_title = null; }
  const rows = h("div", { class: "skill-rows" });
  const steps = ["Target job", "Your skills", "Time", "AI scenario"].map((t) => h("li", { "data-done": "false" }, t));
  let occ = null; // {soc, title, description, skills, tools}
  const levelSeg = (sk) => h("div", { class: "seg levels", role: "group", "aria-label": `${sk.name} proficiency, 0 to 5` },
    [0, 1, 2, 3, 4, 5].map((n) => h("button", { type: "button", "aria-pressed": String(sk.level === n), "aria-label": `level ${n}`,
      onclick: (e) => { sk.level = n; saveProfile(); e.currentTarget.parentElement.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === n))); } }, n)));
  const needed = (name) => occ?.skills.find((s) => s.name === name);
  const drawRows = () => {
    rows.replaceChildren(...p.skills.map((sk, i) => {
      const nd = needed(sk.name);
      return h("div", { class: "skill-row" },
        h("span", { class: "name" }, sk.name,
          nd ? h("span", { class: "muted", style: { "font-weight": 400 } }, ` · needed at ${nd.required}/5`) : null),
        levelSeg(sk),
        h("button", { class: "btn ghost sm", type: "button", "aria-label": `Remove ${sk.name}`, onclick: () => { p.skills.splice(i, 1); saveProfile(); drawRows(); drawSuggest(); } }, "×"));
    }));
    steps[1].dataset.done = String(p.skills.length > 0);
  };
  const add = h("input", { class: "input", placeholder: "Add a skill or tool, e.g. Excel", maxlength: 60, "aria-label": "Add a skill or tool",
    onfocus: () => S.status.set("listening", "Listening"),
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(add.value); } } });
  const addSkill = (name, level = 1) => {
    name = name.trim();
    if (!name || p.skills.some((s) => s.name.toLowerCase() === name.toLowerCase()) || p.skills.length >= 40) return;
    p.skills.push({ name, level }); saveProfile(); add.value = ""; drawRows(); drawSuggest();
  };
  const suggest = h("div", { class: "suggest", "aria-label": "Suggested from this job" });
  const drawSuggest = () => {
    const pool = occ ? [...occ.skills.map((s) => s.name), ...occ.tools.map((t) => t.name)] : [];
    suggest.replaceChildren(...pool.filter((k) => !p.skills.some((s) => s.name.toLowerCase() === k.toLowerCase())).slice(0, 8)
      .map((k) => h("button", { class: "chip", type: "button", onclick: () => addSkill(k, 0) }, "+ ", k)));
  };

  // occupation picker: combobox over all ESCO occupations and their alternative labels
  const results = h("ul", { class: "occ-results", role: "listbox", id: "occ-list", hidden: true });
  const picked = h("div", { class: "occ-picked" });
  const search = h("input", { class: "input", type: "search", role: "combobox", "aria-expanded": "false", "aria-controls": "occ-list",
    "aria-autocomplete": "list", placeholder: "Search any job, e.g. nurse, electrician, accountant", maxlength: 80, autocomplete: "off",
    oninput: () => { clearTimeout(search._t); search._t = setTimeout(find, 160); },
    onkeydown: (e) => {
      const items = [...results.querySelectorAll("li")];
      const i = items.findIndex((x) => x.getAttribute("aria-selected") === "true");
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const j = Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
        items.forEach((x, k) => x.setAttribute("aria-selected", String(k === j)));
        search.setAttribute("aria-activedescendant", items[j]?.id || "");
      } else if (e.key === "Enter" && i >= 0) { e.preventDefault(); items[i].click(); }
      else if (e.key === "Escape") { results.hidden = true; search.setAttribute("aria-expanded", "false"); }
    } });
  async function find() {
    const q = search.value.trim();
    if (q.length < 2) { results.hidden = true; return; }
    const { results: r } = await api(`/api/occupations?q=${encodeURIComponent(q)}`);
    results.replaceChildren(...(r.length ? r.map((o, k) => h("li", { role: "option", id: `occ-${k}`, "aria-selected": "false", onclick: () => choose(o.soc) },
      jobIcon(o.soc, { size: 36, labelled: true }), h("b", { title: `ESCO ${o.soc}` }, o.title), o.matched ? h("span", { class: "muted" }, ` · “${o.matched}”`) : null))
      : [h("li", { class: "muted", role: "option", "aria-disabled": "true" }, "No matching jobs. Try a broader term.")]));
    results.hidden = false; search.setAttribute("aria-expanded", "true");
  }
  async function choose(soc) {
    occ = await api(`/api/occupations/${soc}`);
    const changed = p.target_role !== soc;
    p.target_role = soc; p.target_title = occ.title;
    if (changed) {  // start from what this job needs: rate each (0 = never used)
      const mine = new Map(p.skills.map((s) => [s.name.toLowerCase(), s.level]));
      p.skills = occ.skills.slice(0, 8).map((s) => ({ name: s.name, level: mine.get(s.name.toLowerCase()) ?? 0 }));
    }
    saveProfile();
    search.value = ""; results.hidden = true; search.setAttribute("aria-expanded", "false");
    picked.replaceChildren(h("div", { class: "occ-card" },
      h("div", { class: "job-line", title: `ESCO ${occ.soc}` }, jobIcon(occ.soc, { size: 48, labelled: true }), h("b", {}, occ.title)),
      h("p", { class: "muted" }, occ.description.length > 220 ? occ.description.slice(0, 220) + "…" : occ.description),
      h("a", { href: occ.url, target: "_blank", rel: "noopener noreferrer" }, "ESCO occupation page")));
    steps[0].dataset.done = "true";
    drawRows(); drawSuggest();
  }

  const hoursIn = h("input", { type: "number", min: "0.5", max: "80", step: "0.5", value: p.weekly_learning_hours, "aria-label": "Hours per week",
    onchange: () => { p.weekly_learning_hours = Math.min(80, Math.max(0.5, Number(hoursIn.value) || 6)); hoursIn.value = p.weekly_learning_hours; saveProfile(); steps[2].dataset.done = "true"; } });
  const bump = (d) => { hoursIn.value = Math.min(80, Math.max(0.5, Number(hoursIn.value) + d)); hoursIn.dispatchEvent(new Event("change")); };
  const scen = (key, title, note) => h("label", { title: SCENARIO_HELP[key] },
    h("input", { type: "radio", name: "scenario", value: key, "aria-description": SCENARIO_HELP[key], checked: p.scenario === key ? true : null, onchange: () => { p.scenario = key; saveProfile(); steps[3].dataset.done = "true"; } }),
    h("b", {}, title), h("span", { class: "muted" }, note));

  main.replaceChildren(
    h("h1", { class: "page-title" }, "Build your plan"),
    h("p", { class: "lede" }, "Pick any job. We compare your skills with what it requires, then draft a plan you can edit and approve."),
    h("div", { class: "build" },
      h("ol", { class: "steps", "aria-label": "Steps" }, steps),
      h("form", { onsubmit: (e) => { e.preventDefault(); if (!p.target_role) { toast("Pick a target job first.", "err"); search.focus(); return; } start(); } },
        h("section", { class: "form-section" }, h("h2", {}, "Target job"),
          h("div", { class: "occ-search" }, search, results), picked),
        h("section", { class: "form-section" }, h("h2", {}, "Your skills"),
          h("p", { class: "muted" }, "Rate each skill this job needs. 0 = never used it, 5 = could teach it."), rows,
          h("div", { class: "add-skill" }, add, h("button", { class: "btn", type: "button", onclick: () => addSkill(add.value) }, "Add")), suggest),
        h("section", { class: "form-section" }, h("h2", {}, "Time you can give each week"),
          h("div", { class: "hours" }, h("div", { class: "stepper" },
            h("button", { type: "button", "aria-label": "Fewer hours", onclick: () => bump(-1) }, "−"), hoursIn,
            h("button", { type: "button", "aria-label": "More hours", onclick: () => bump(1) }, "+")), h("span", { class: "muted" }, "hours / week"))),
        h("section", { class: "form-section" }, h("h2", {}, "How will AI change this job?"),
          h("div", { class: "scenario" },
            scen("assistive", "Assistive AI", "You do the work. AI helps you."),
            scen("agentic", "Agentic AI", "AI handles routine tasks. You guide it and check the results. Assumed future scenario."))),
        h("div", { class: "build-actions" }, h("button", { class: "btn primary", type: "submit" }, "Analyse my skills", icon("send"))))));
  drawRows();
  if (p.target_role) choose(p.target_role).catch(() => {});
  S.status.set("idle", "Ready when you are");
}

/** From a role match (quiz or resume): target that occupation with the skills we found, then run the agents. */
function planFor(m, skills, query) {
  Object.assign(S.profile, { target_role: m.soc, target_title: m.title,
    skills: skills.slice(0, 40).map(({ name, level }) => ({ name, level })) });
  saveProfile();
  start(query);
}

function startInterview(m) {
  if (!m?.recommendation_id) { toast("Practice interviews are available for roles from your Quick Match or resume results.", "err"); return; }
  location.hash = `#/interview/start/${encodeURIComponent(m.recommendation_id)}`;
}

function start(query) {
  if (!S.profile.skills.length) { toast("Add at least one skill first.", "err"); location.hash = "#/build"; return; }
  S.pending = { ...S.profile, skills: S.profile.skills.map((s) => ({ ...s })), query };
  if (location.hash === "#/report") reportView($("#main"));
  else location.hash = "#/report";
}

// ---------------------------------------------------------------- report (chat)
function reportView(main, openId) {
  if (!S.reportEl) {
    S.threadEl = h("div", { class: "thread", "aria-live": "off" });
    S.input = h("textarea", { class: "input", rows: 2, placeholder: "Ask about your report or request a plan update…", maxlength: 500, "aria-label": "Report update request",
      onkeydown: (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          if (!S.busy) composerSend();
        }
      } });
    S.sendBtn = h("button", { class: "btn primary", type: "submit", "aria-label": "Submit report request" }, icon("send"));
    S.composer = h("form", { class: "composer", onsubmit: (e) => { e.preventDefault(); composerSend(); } },
      S.quick = h("div", { class: "quick", "aria-label": "Suggested report updates" }),
      h("div", { class: "row" }, S.input, micButton(S.input), S.sendBtn));
    S.assistant = reportAssistant({ thread: S.threadEl, composer: S.composer, input: S.input, onCite: highlight, hideLauncher: true });
    S.reportEl = h("div", { class: "report" },
      h("div", { class: "thread-col", style: { display: "grid", gap: "24px", "min-width": 0 } },
        h("div", { class: "flow-back-row" },
          h("a", {
            href: "#/start",
            class: "btn ghost sm flow-back-btn"
          }, icon("back"), "Back to home")
        ),
        h("div", { style: { display: "flex", "justify-content": "space-between", "align-items": "end", gap: "12px", "flex-wrap": "wrap" } },
          h("h1", { class: "page-title" }, "Report"),
          h("div", { class: "row-actions" },
            h("button", { class: "btn sm", type: "button", onclick: newChat }, icon("spark"), "New report"),
            h("button", { class: "btn sm", type: "button", popovertarget: "history-menu" }, icon("history"), "Report history"),
            h("button", { class: "btn sm only-narrow", type: "button", onclick: () => S.sheet.showModal() }, icon("sources"), "Sources"))),
        S.history = h("div", { id: "history-menu", popover: "auto", class: "core-menu history-menu", "aria-label": "Past reports" }),
        S.threadEl),
      S.sources, S.assistant.el);
  }
  if (!S.reportEl.isConnected) S.assistant.hide(false);
  main.replaceChildren(S.reportEl);
  S.assistant.position();
  loadHistory();
  if (S.pending) { const q = S.pending; S.pending = null; runTurn(q); }
  else if (openId && openId !== S.openId) openConversation(openId);
  else if (!S.thread.length) {
    S.threadEl.replaceChildren(briefingStarter());
    S.composer.hidden = true;  // nothing to change until a briefing exists
  }
}

/** Past briefings for this person (newest first): each opens its saved report and plan. */
async function loadHistory() {
  if (!S.history) return;
  let plans = [];
  try { plans = (await api("/api/plans")).filter((p) => p.audience === "individual").slice(0, 12); } catch { /* history is optional */ }
  S.history.replaceChildren(h("p", { class: "history-head" }, icon("history"), "Past reports"),
    ...(plans.length ? plans.map((p) => h("a", { class: "core-item", href: `#/report/${p.plan_id}`, onclick: () => S.history.hidePopover?.() },
      h("span", { class: "core-ic" }, icon("report")),
      h("span", { class: "core-t" }, h("b", {}, p.target_role || "Plan"),
        h("span", {}, `${p.scenario === "agentic" ? "Agentic" : "Assistive"} AI · ${fmtTime(p.created_utc)} · v${p.version}`),
        h("span", { class: "mono" }, `Plan ID: ${p.plan_reference || p.plan_id}`)),
      h("span", { class: `tag ${p.status}` }, p.status)))
      : [h("p", { class: "muted", style: { padding: "8px 12px" } }, "No reports yet.")]));  // spread: replaceChildren does not flatten
}

/** Job search used inside the chat (empty chat, and "Try a different job"): pick any ESCO occupation. */
function jobPicker(onPick) {
  const search = h("input", { class: "input", type: "search", placeholder: "Search any job, e.g. nurse, electrician, accountant",
    "aria-label": "Job to plan for", role: "combobox", "aria-expanded": "false", autocomplete: "off" });
  const results = h("ul", { class: "occ-results", role: "listbox", hidden: true });
  let timer;
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(find, 200); });
  async function find() {
    const q = search.value.trim();
    if (q.length < 2) { results.hidden = true; return; }
    const { results: r } = await api(`/api/occupations?q=${encodeURIComponent(q)}`);
    results.replaceChildren(...(r.length ? r.map((o) => h("li", { role: "option", onclick: () => { results.hidden = true; onPick(o); } },
      jobIcon(o.soc, { size: 36, labelled: true }), h("b", { title: `ESCO ${o.soc}` }, o.title)))
      : [h("li", { class: "muted", role: "option", "aria-disabled": "true" }, "No matching jobs. Try a broader term.")]));
    results.hidden = false; search.setAttribute("aria-expanded", "true");
  }
  return h("div", { class: "occ-search brief-search" }, search, results);
}

/** Target a job: its top skills at your saved level, or 0 (never used) until you rate them; then the agents run. */
async function pickJob(o) {
  const p = S.profile;
  const occ = await api(`/api/occupations/${o.soc}`);
  const mine = new Map(p.skills.map((s) => [s.name.toLowerCase(), s.level]));
  Object.assign(p, { target_role: occ.soc, target_title: occ.title,
    skills: occ.skills.slice(0, 8).map((s) => ({ name: s.name, level: mine.get(s.name.toLowerCase()) ?? 0 })) });
  saveProfile();
  start();
}

/** An owl message in the thread with a job search: choosing a job continues this same conversation. */
function askForJob() {
  const card = h("article", { class: "report-assistant-job" },
    h("div", { class: "body" }, h("div", { class: "who" }, "AiversePulse"), h("p", {}, "Which job should I look at?"),
      jobPicker((o) => { card.remove(); pickJob(o); })));
  S.assistant.showTool(card);
}

/** Empty chat: the owl asks which job. A saved target job runs in one click. */
function briefingStarter() {
  const p = S.profile;
  const ready = p.target_role && p.skills.length;
  return h("div", { class: "brief-start" },
    h("h2", {}, "Which job are you aiming for?"),
    h("p", { class: "muted" }, "Pick a job. We'll compare it with your skills and draft a 90-day plan."),
    ready ? h("button", { type: "button", class: "btn primary brief-go", onclick: () => start() },
      jobIcon(p.target_role, { size: 28 }), `Continue with ${p.target_title || "my target job"}`) : null,
    jobPicker(pickJob),
    h("p", { class: "muted" }, "Prefer to enter all your skills yourself? ", h("a", { href: "#/build" }, "Use the skills form")));
}

function newChat() {
  if (S.busy) S.busy.abort();
  setBusy(null);
  S.assistant.reset();
  S.thread = []; S.lastPlanId = null; S.openId = null;
  S.threadEl.replaceChildren(briefingStarter());
  S.composer.hidden = true;
  if (location.hash !== "#/report") history.replaceState(null, "", "#/report");
}

/** Reopen a past conversation in the chat, every turn, with the latest plan; typing continues it. */
async function openConversation(id) {
  if (S.busy) S.busy.abort();
  setBusy(null);
  S.assistant.reset();
  S.composer.hidden = true;
  S.openId = id;
  S.threadEl.replaceChildren(h("p", { class: "muted" }, "Opening your conversation…"));
  let d;
  try { d = await api(`/api/plans/${id}`); } catch (e) {
    if (S.openId === id) S.threadEl.replaceChildren(h("div", { class: "issue error" }, e.message));
    return;
  }
  if (S.openId !== id) return;
  const r = d.report || {};
  const title = r.occupation?.title || d.plan.target_role;
  // older plans saved no conversation: show their briefing as one turn
  const turns = r.thread?.length ? r.thread : [{ q: null, a: r.narrative || "" }];
  if (r.request) {
    const { query, ...req } = r.request;
    Object.assign(S.profile, req, { target_title: title });
    saveProfile();
  }
  S.thread = turns.map((t) => ({ query: t.q }));
  S.lastPlanId = id;
  setSources(r.evidence || []);
  S.threadEl.replaceChildren(...turns.flatMap((t, i) => {
    const narrative = t.a ? staticText(t.a, highlight) : null;
    if (narrative) narrative.dataset.assistantReply = "true";
    const body = h("div", { class: "body" }, narrative);
    if (i === turns.length - 1) {  // the latest turn carries the full analysis and the plan
      let insights = null;
      const add = (el, small) => { if (!el) return; if (small) (insights ??= body.appendChild(h("div", { class: "insights" }))).append(el); else body.append(el); };
      add(r.gaps?.length ? gapsBlock(r.gaps) : null);
      add(r.comparison?.length ? comparisonBlock(r.comparison, d.plan.scenario) : null);
      add(r.outlook ? outlookBlock(r.outlook) : null, true);
      add(r.signals ? signalsBlock(r.signals) : null, true);
      add(r.sdgs?.length ? sdgBlock(r.sdgs) : null, true);
      add(r.issues?.some((x) => x.severity === "error") ? issuesBlock(r.issues.filter((x) => x.severity === "error")) : null);
      body.append(planHolder(id, d.plan, r.request?.weekly_learning_hours ?? S.profile.weekly_learning_hours, d.status, d.progress, d.plan_reference));
    }
    return [h("div", { class: "turn-user" }, h("p", { class: "q" }, t.q || `Plan for ${t.title || title}`)),
      h("article", { class: "turn-owl" },
        h("div", { class: "body" }, h("div", { class: "who" }, "AiversePulse", t.at ? h("span", { class: "muted" }, fmtTime(t.at)) : null), body))];
  }));
  S.ctx = { gaps: r.gaps, outlook: r.outlook };
  drawSuggestions();
  S.composer.hidden = false;
}

/** What this person would most likely ask next, from their latest answer: their biggest gap, a skill in rising
 * demand, their real weekly hours, the other AI scenario. Each is sent as a normal message, so it stays in the chat. */
function suggestions({ gaps = [], outlook } = {}) {
  const p = S.profile;
  const open = gaps.filter((g) => g.required_level > g.current_level)
    .sort((a, b) => (b.importance ?? 1) * (b.required_level - b.current_level) - (a.importance ?? 1) * (a.required_level - a.current_level));
  const asked = new Set(S.thread.map((t) => t.query).filter(Boolean));  // never offer what was already asked
  const top = open.find((g) => !asked.has(`How do I start with ${g.skill_id}?`));
  const rising = (outlook?.items || []).concat(open.filter((g) => g.outlook === "rising"))
    .find((x) => (x.direction ?? "rising") === "rising" && x.skill_id !== top?.skill_id && !asked.has(`Why is ${x.skill_id} rising?`));
  const hours = p.weekly_learning_hours;
  const fewer = Math.max(2, Math.round(hours / 2));
  return [
    top && `How do I start with ${top.skill_id}?`,
    rising && `Why is ${rising.skill_id} rising?`,
    hours >= 6 ? `I only have ${fewer} hours a week` : `I can give ${hours + 4} hours a week`,
    p.scenario === "agentic" ? "Compare with assistive AI" : "What changes with agentic AI?",
  ].filter((t) => t && !asked.has(t)).slice(0, 4);
}

function drawSuggestions() {
  const chip = (text, onclick) => h("button", { class: "chip", type: "button", onclick }, text);
  S.quick.replaceChildren(...suggestions(S.ctx).map((t) => chip(t, () => { S.input.value = t; composerSend(); })),
    chip("Try a different job", askForJob));
}

function composerSend() {
  if (S.busy) { S.busy.abort(); return; }
  const q = S.input.value.trim();
  if (!q) return;
  const m = q.match(/(\d+(?:\.\d+)?)\s*(?:h|hours?)\b/i);
  if (m) S.profile.weekly_learning_hours = Math.min(80, Math.max(0.5, Number(m[1])));
  if (/agentic/i.test(q)) S.profile.scenario = "agentic";
  if (/assistive/i.test(q)) S.profile.scenario = "assistive";
  saveProfile();
  S.input.value = "";
  start(q);
}

function setBusy(ctrl) {
  S.busy = ctrl;
  S.assistant.setBusy(!!ctrl);
  S.sendBtn.replaceChildren(icon(ctrl ? "stop" : "send"));
  S.sendBtn.setAttribute("aria-label", ctrl ? "Stop generating" : "Send");
}

function highlight(id) {
  const narrow = matchMedia("(max-width: 1099px)").matches;
  if (narrow) S.sheet.showModal();
  const el = document.getElementById(`src-${id}`) || S.sheet.querySelector(`[id="src-${CSS.escape(id)}"]`);
  const target = narrow ? S.sheetBody.querySelector(`[data-id="${CSS.escape(id)}"]`) : el;
  if (target) { target.scrollIntoView({ block: "nearest", behavior: "smooth" }); target.classList.remove("flash"); void target.offsetWidth; target.classList.add("flash"); }
}

function setSources(evidence) {
  evidence.forEach((e) => S.evidence.set(e.id, e));
  const list = [...S.evidence.values()];
  S.sources.replaceChildren(h("h2", {}, "Sources"), h("p", { class: "muted" }, `${list.length} dated sources`), ...list.map(sourceItem));  // spread: replaceChildren does not flatten arrays
  S.sheetBody.replaceChildren(...list.map((e) => { const el = sourceItem(e); el.removeAttribute("id"); el.dataset.id = e.id; return el; }));
}

async function runTurn(params) {
  S.composer.hidden = false;
  const p = params;
  const label = p.query || `Plan for ${p.target_title || p.target_role}`;
  S.thread.push(p);
  const userTurn = h("div", { class: "turn-user" }, h("p", { class: "q" }, label),
    h("div", { class: "req-pills" },
      h("span", { class: "meta-pill" }, p.target_role ? jobIcon(p.target_role, { size: 24 }) : null, p.target_title || p.target_role),
      h("span", { class: "meta-pill" }, icon("spark"), p.scenario === "agentic" ? "Agentic AI" : "Assistive AI"),
      h("span", { class: "meta-pill" }, icon("clock"), `${p.weekly_learning_hours} h/week`),
      h("span", { class: "meta-pill", title: p.skills.map((s) => `${s.name}: ${s.level}`).join("\n") }, icon("check"), `${p.skills.length} skills`)));
  const owl = S.assistant.owl;
  owl.set("thinking");
  const say = h("span", { class: "muted" }, "Reading your request");
  const traceList = h("ol");
  const running = h("li", { class: "run" }, h("span", { class: "dot" }), h("span", {}, "Working"), h("span", { class: "ms" }));
  traceList.append(running);
  const sumText = h("span", {}, "Analysing…");
  const trace = h("details", { class: "trace", open: true }, h("summary", {}, h("span", { class: "spinner", "aria-hidden": "true" }), sumText), traceList);
  const prose = h("p", { class: "prose", "aria-live": "polite", "data-assistant-reply": "true" });
  const body = h("div", { class: "body" }, trace, prose);
  const turn = h("article", { class: "turn-owl", "aria-label": "AiversePulse reply" },
    h("div", { class: "body" }, h("div", { class: "who" }, "AiversePulse", say, readAloudButton(() => prose.textContent)), body));
  S.threadEl.querySelector(".empty, .brief-start")?.remove();
  S.threadEl.append(reveal(userTurn, RISE), reveal(turn, RISE, { delay: 120 }));

  S.ctx = {};  // what this answer finds (gaps, outlook) shapes the suggested next messages
  S.quick.replaceChildren();
  const st = new StreamText(prose, highlight);
  const ctrl = new AbortController();
  setBusy(ctrl);
  let steps = 0, reused = 0, t0 = performance.now(), planId = null, meta = null, insights = null;
  const mood = (state, text) => { owl.set(state); S.status.set(state, text || say.textContent); if (text) { say.textContent = text; S.assistant.setStatus(text); } };
  try {
    await stream("/api/analyze", {
      target_role: p.target_role, scenario: p.scenario, weekly_learning_hours: p.weekly_learning_hours,
      skills: p.skills, ...(p.query ? { query: p.query } : {}), ...(S.lastPlanId ? { previous_plan_id: S.lastPlanId } : {}),
    }, (ev) => {
      if (ev.t === "owl") mood(ev.state, ev.say);
      else if (ev.t === "plan") {  // the router's decision for this follow-up
        running.before(h("li", { class: "plan-step" }, icon("spark"), h("span", {}, ev.label), h("span", { class: "ms" })));
        reused = ev.reused.length;
      } else if (ev.t === "agent") {
        if (!ev.reused) steps++;
        running.before(reveal(h("li", { class: ev.reused ? "reused" : null }, ev.reused ? icon("history") : h("span", { class: "dot" }), h("span", {}, ev.label), h("span", { class: "ms" }, ev.reused ? "" : `${ev.ms} ms`)),
          [{ opacity: 0, clipPath: "inset(0 0 100% 0)" }, { opacity: 1, clipPath: "inset(0)" }], { duration: 240 }));
        mood(owl.state, ev.label);
      } else if (ev.t === "meta") {
        meta = ev; planId = ev.plan_id; if (planId) S.lastPlanId = planId; setSources(ev.evidence || []); loadHistory();
        running.remove(); trace.querySelector(".spinner")?.remove();
        sumText.textContent = `Done in ${(ev.usage.ms / 1000).toFixed(1)} s · ${steps} steps${reused ? `, ${reused} reused` : ""}`;
        setTimeout(() => { trace.open = false; }, 700);
      } else if (ev.t === "text") st.push(ev.delta);
      else if (ev.t === "section") {
        const d = ev.data;
        if (ev.kind === "gaps" || ev.kind === "outlook") S.ctx[ev.kind] = d;
        const el = ev.kind === "changes" ? changesBlock(d) : ev.kind === "gaps" ? gapsBlock(d) : ev.kind === "comparison" ? comparisonBlock(d, p.scenario)
          : ev.kind === "outlook" ? outlookBlock(d) : ev.kind === "signals" ? signalsBlock(d) : ev.kind === "sdgs" ? sdgBlock(d)
          : ev.kind === "issues" ? issuesBlock(d.filter((i) => i.severity === "error"))
          : ev.kind === "plan" ? planHolder(planId, d, p.weekly_learning_hours, meta?.status || "draft", [], meta?.plan_reference) : null;
        if (el && ["outlook", "signals", "sdgs"].includes(ev.kind)) {  // three small insight cards share one row
          insights ??= body.appendChild(h("div", { class: "insights" }));
          insights.append(el);
        } else if (el) body.append(el);
      } else if (ev.t === "done") {
        drawSuggestions();
        st.end();
        if (ev.status === "flagged") body.append(h("p", { class: "note" }, "This draft is flagged. Edit the plan and save a new draft before approving."));
      } else if (ev.t === "error") { st.end(); body.append(h("div", { class: "issue error" }, ev.message)); }
    }, ctrl.signal);
  } catch (e) {
    st.end();
    if (e.name === "AbortError") { mood("idle", "Stopped"); body.append(h("p", { class: "note" }, "Stopped. Nothing was saved from this turn.")); }
    else if (e instanceof ApiError && e.status === 401) { location.replace("#/signin/report"); location.reload(); }
    else if (e instanceof ApiError && e.status === 402) {  // plan limit: say what to do, not "something went wrong"
      mood("idle", "Upgrade to keep going");
      body.append(h("div", { class: "issue upsell" }, e.message, " ", h("a", { class: "btn sm primary", href: "#/pricing" }, "See plans")));
    }
    else { mood("confused", "Something went wrong"); body.append(h("div", { class: "issue error" }, e.message)); }
  } finally {
    if (S.busy === ctrl) { drawSuggestions(); setBusy(null); }
  }
}

function planHolder(planId, plan, hours, status, progress = [], planReference) {
  const holder = h("div");
  const render = async (st, version) => {
    holder.replaceChildren(planBlock({ planId, planReference, plan, version, status: st, weeklyHours: hours, progress, evidence: S.evidence, onChange: async (next) => {
      const fresh = await api(`/api/plans/${planId}`);
      plan = fresh.plan; progress = fresh.progress || [];
      render(fresh.status, fresh.version);
      if (next === "approved") {
        S.status.set("celebrating", "Plan approved");
        location.hash = `#/plans/${planId}`;
      }
    } }));
  };
  render(status, 1);
  return holder;
}

// ---------------------------------------------------------------- plans
async function plansView(main) {
  main.replaceChildren(h("h1", { class: "page-title" }, "My plans"), h("p", { class: "lede" }, "Your plans, including any your HR advisor prepared for you."),
    ...(S.me?.hr_can_view ? [h("p", { class: "note" }, icon("user"), "Your HR advisor can see the plans you make here and how far you've got. Only you can change them.")] : []));
  const list = await api("/api/plans");
  if (!list.length) {
    main.append(h("div", { class: "empty" }, new Owl({ size: 96, state: "sleeping" }).el,
      h("p", {}, "No plans yet. Build your first one in about two minutes."), h("a", { class: "btn primary", href: "#/start" }, "Get started")));
    return;
  }
  const selected = new Set();
  const nameOf = (pl) => String(pl.target_title || pl.target_role || "Plan").trim();
  const idOf = (pl) => String(pl.plan_id || "");
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  const createdAt = (pl) => { const ts = Date.parse(pl.created_utc || ""); return Number.isFinite(ts) ? ts : 0; };
  let query = "", sortBy = "date-desc", visiblePlans = list.slice();
  const count = h("span", { class: "muted", "aria-live": "polite" }, "No plans selected");
  const search = h("input", { class: "plans-search-input", type: "search", autocomplete: "off", placeholder: "Search by job title or plan name",
    "aria-label": "Search plans by job title or plan name", oninput: () => { query = search.value.trim().toLocaleLowerCase(); clear.hidden = !query; draw(); } });
  const clear = h("button", { class: "plans-search-clear", type: "button", "aria-label": "Clear search", title: "Clear search", hidden: true,
    onclick: () => { search.value = ""; query = ""; clear.hidden = true; draw(); search.focus(); } }, "×");
  const searchControl = h("label", { class: "plans-search" }, icon("search"), search, clear);
  const sort = h("select", { class: "input plans-sort-select", "aria-label": "Sort plans", onchange: () => { sortBy = sort.value; draw(); } },
    h("option", { value: "name-asc" }, "Name (A–Z)"),
    h("option", { value: "name-desc" }, "Name (Z–A)"),
    h("option", { value: "date-desc", selected: true }, "Date (Newest First)"),
    h("option", { value: "date-asc" }, "Date (Oldest First)"));
  const sortControl = h("label", { class: "plans-sort" }, h("span", {}, "Sort by"), sort);
  const selectAllText = h("span", {}, "Select all your plans");
  const selectAll = h("input", { type: "checkbox", "aria-label": "Select all your plans", disabled: !list.some((pl) => pl.audience === "individual"),
    onchange: () => {
      visiblePlans.filter((pl) => pl.audience === "individual").forEach((pl) => selectAll.checked ? selected.add(pl.plan_id) : selected.delete(pl.plan_id));
      listEl.querySelectorAll(".plan-select").forEach((checkbox) => { checkbox.checked = selectAll.checked; });
      syncToolbar();
    } });
  const remove = h("button", { class: "btn sm plan-delete", type: "button", disabled: true, onclick: async () => {
    const ids = visiblePlans.filter((pl) => pl.audience === "individual" && selected.has(pl.plan_id)).map((pl) => pl.plan_id);
    if (!ids.length || !window.confirm(`Delete ${ids.length} selected plan${ids.length === 1 ? "" : "s"}? This permanently removes the plan and its learning progress. Related interview history will be kept.`)) return;
    remove.disabled = true;
    try {
      await api("/api/plans", { method: "DELETE", body: { plan_ids: ids } });
      toast(`${ids.length} plan${ids.length === 1 ? "" : "s"} deleted`);
      await plansView(main);
    } catch (e) { toast(e.message, "err"); remove.disabled = false; }
  } }, "Delete selected");
  const listEl = h("div", { class: "plan-list" });
  const noResults = h("div", { class: "empty plan-search-empty", hidden: true },
    h("p", {}, "No matching plans found. Try searching with a different job title."),
    h("button", { class: "btn sm", type: "button", onclick: () => { search.value = ""; query = ""; clear.hidden = true; draw(); search.focus(); } }, "Clear search"));
  const manage = h("div", { class: "plan-manage" }, h("label", { class: "plan-select-all" }, selectAll, selectAllText), count, remove,
    h("span", { class: "plan-delete-note" }, "Plans from your HR advisor can't be deleted."));
  function syncToolbar() {
    const visibleSelectable = visiblePlans.filter((pl) => pl.audience === "individual");
    const n = visibleSelectable.filter((pl) => selected.has(pl.plan_id)).length;
    count.textContent = n ? `${n} selected` : "No plans selected";
    remove.disabled = n === 0;
    selectAll.disabled = visibleSelectable.length === 0;
    selectAll.checked = visibleSelectable.length > 0 && n === visibleSelectable.length;
    selectAll.indeterminate = n > 0 && n < visibleSelectable.length;
  }
  function draw() {
    visiblePlans = list.filter((pl) => !query || [pl.target_title, pl.target_role].some((name) => String(name || "").toLocaleLowerCase().includes(query)));
    const compareName = (a, b) => collator.compare(nameOf(a), nameOf(b));
    visiblePlans.sort((a, b) => {
      if (sortBy === "name-asc" || sortBy === "name-desc") {
        const names = compareName(a, b) * (sortBy === "name-asc" ? 1 : -1);
        return names || createdAt(b) - createdAt(a) || idOf(a).localeCompare(idOf(b));
      }
      const dates = (createdAt(a) - createdAt(b)) * (sortBy === "date-asc" ? 1 : -1);
      return dates || compareName(a, b) || idOf(a).localeCompare(idOf(b));
    });
    selectAllText.textContent = query ? "Select all matching plans" : "Select all your plans";
    selectAll.setAttribute("aria-label", query ? "Select all matching plans" : "Select all your plans");
    noResults.hidden = visiblePlans.length > 0;
    listEl.hidden = visiblePlans.length === 0;
    listEl.replaceChildren(...visiblePlans.map((pl) => h("div", { class: "plan-item-row" },
      pl.audience === "individual" ? h("input", { class: "plan-select", type: "checkbox", checked: selected.has(pl.plan_id),
        "aria-label": `Select ${pl.target_title || pl.target_role || "plan"}, plan ID ${pl.plan_reference || pl.plan_id}`,
        onchange: (e) => { if (e.target.checked) selected.add(pl.plan_id); else selected.delete(pl.plan_id); syncToolbar(); } }) : h("span", { class: "plan-select-spacer", "aria-hidden": "true" }),
      h("a", { class: "plan-item-main", href: `#/plans/${pl.plan_id}` },
        h("div", {}, h("div", { class: "t" }, pl.target_title || pl.target_role || "Plan", pl.audience === "hr" ? h("span", { class: "muted" }, " · from HR") : null),
          h("div", { class: "m" }, `${pl.scenario || ""} · v${pl.version} · ${new Date(pl.created_utc).toLocaleDateString()}`),
          h("div", { class: "m" }, `Plan ID: ${pl.plan_reference || pl.plan_id}`)),
        h("span", { class: `tag ${pl.status}` }, pl.status)))));
    syncToolbar();
  }
  main.append(h("div", { class: "plans-tools" }, searchControl, sortControl), manage, noResults, listEl);
  draw();
}

async function planDetail(main, id, focusPlan = false, section = null) {
  delete main.dataset.plan;
  main.replaceChildren(h("p", { class: "muted" }, "Loading…"));
  let d;
  try { d = await api(`/api/plans/${id}`); } catch (e) { main.replaceChildren(h("div", { class: "issue error" }, e.message)); return; }
  const r = d.report;
  const approved = d.status === "approved";
  const totalHours = d.plan.activities.reduce((sum, activity) => sum + Number(activity.estimated_hours || 0), 0);
  setSources(r?.evidence || []);
  const reportContent = h("div", { class: "plan-report-content" },
    !r ? h("p", { class: "note" }, "This plan was created before analyses were saved. Your 90-day plan is below. Build a new plan to see the full analysis.") : null,
    r?.narrative ? staticText(r.narrative, highlight) : null,
    r?.gaps?.length ? gapsBlock(r.gaps) : null,
    r?.comparison?.length ? comparisonBlock(r.comparison, d.plan.scenario) : null,
    r?.outlook ? outlookBlock(r.outlook) : null,
    r?.signals ? signalsBlock(r.signals) : null,
    r?.sdgs?.length ? sdgBlock(r.sdgs) : null,
    r?.issues?.length ? issuesBlock(r.issues) : null);
  const planFocus = h("section", { class: "plan-focus", tabindex: "-1", "aria-label": approved ? "Approved plan and implementation" : "Proposed plan" },
    h("div", { class: "plan-hero" },
      h("div", { class: "plan-hero-title" }, h("div", {},
        h("h2", {}, "Become a ", h("span", { class: "plan-hero-role" }, r?.occupation?.title || d.plan.target_role))), h("span", { class: `tag ${d.status}` }, d.status)),
      h("p", { class: "plan-hero-copy" }, approved ? "Your personalised 90-day learning journey. Pick up where you left off on the right." : "Your personalised 90-day learning journey, in three 30-day sections."),
      h("div", { class: "plan-hero-metrics" }, h("span", {}, icon("clock"), "90 days"), h("span", {}, icon("plans"), `${Math.round(totalHours * 10) / 10} estimated learning hours`))),
    planBlock({ planId: id, planReference: d.plan_reference, plan: d.plan, version: d.version, status: d.status, weeklyHours: null, progress: d.progress, evidence: r?.evidence, startDate: d.created_utc,
      sectionHref: (p) => `#/plans/${id}${p ? `/${p}` : ""}`,
      title: null, onChange: () => planDetail(main, id, true) }));
  let expanded = !approved;
  const panel = h("div", { class: "plan-report-panel", id: "saved-plan-report", inert: approved ? true : null,
    "aria-hidden": String(approved) }, reportContent);
  const toggle = h("button", { class: "btn report-toggle", type: "button", "aria-controls": "saved-plan-report",
    "aria-expanded": String(expanded), onclick: () => {
      expanded = !expanded;
      disclosure.dataset.expanded = String(expanded);
      panel.inert = !expanded;
      panel.setAttribute("aria-hidden", String(!expanded));
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.textContent = expanded ? "Hide report" : "View report";
      if (!expanded) planFocus.focus({ preventScroll: true });
    } }, expanded ? "Hide report" : "View report");
  const disclosure = h("section", { class: "plan-report", "data-expanded": String(expanded), "aria-label": "Analysis report" },
    h("div", { class: "plan-report-heading" }, h("h2", {}, "Analysis report"), toggle), panel);
  const blocks = h("div", { class: "body plan-detail-body" },
    ...(approved ? [planFocus, disclosure] : [disclosure, planFocus]),
    d.audience === "hr" && d.status === "approved" ? h("div", { class: "approve-bar" }, h("span", {}, "Your HR advisor approved this plan."),
      h("button", { class: "btn primary", onclick: async () => { await api(`/api/plans/${id}/acknowledge`, { method: "POST" }); toast("Acknowledged"); planDetail(main, id); } }, "Acknowledge")) : null,
    h("section", { class: "block" }, h("h3", {}, "History"), historyBlock(d.history)));
  const pdf = h("button", { class: "btn sm no-print", type: "button", onclick: () => {  // the browser's "Save as PDF", every section open
    main.querySelectorAll("details").forEach((x) => { x.open = true; });
    main.querySelectorAll(".phase-detail").forEach((x) => { x.hidden = false; });
    main.querySelectorAll(".plan-report-panel").forEach((x) => { x.inert = false; x.removeAttribute("aria-hidden"); });
    main.querySelector(".plan-report")?.setAttribute("data-expanded", "true");
    print();
  } }, icon("file"), "Download PDF");
  main.replaceChildren(h("div", { class: "plan-top-actions no-print" }, h("a", { href: "#/plans", class: "btn ghost sm" }, icon("back"), "All plans"), pdf),
    h("h1", { class: "page-title plan-detail-title", style: { "margin-top": "12px" } }, r?.occupation?.title || d.plan.target_role), blocks);
  main.dataset.plan = id;
  if (section) main.querySelector(".plan-block")?.openPane(section, true);
  if (focusPlan) planFocus.focus({ preventScroll: true });
}

boot().catch((e) => { app.replaceChildren(h("main", { class: "pub-main" }, h("div", { class: "issue error" }, `Could not start: ${e.message}`))); });
