// AiversePulse (public users): sign-in, plan builder, chat-style streaming report, plans.
import "./motion.js";  // GSAP animations for whatever the app renders
import { jobIcon } from "./jobicons.js";
import { api, stream, h, $, icon, fmtTime, toast, ApiError, reveal, RISE, DROP, GROW } from "./lib.js";
import { Owl, OwlStatus } from "./owl.js";
import { changesBlock, StreamText, gapsBlock, comparisonBlock, outlookBlock, issuesBlock, planBlock, historyBlock,
  sourceItem, staticText, signalsBlock, sdgBlock } from "./blocks.js";
import { startView, quizView, resumeView, todayView, sdgsView } from "./explore.js";
import { interviewView } from "./interview.js";

const app = $("#app");
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: in-memory only */ } },
};
const S = {
  me: null, meta: null, status: null, sheet: null, sources: null, evidence: new Map(), busy: null,
  // saved profile over the defaults, so an older or partial save never drops a required field
  profile: { target_role: null, target_title: null, scenario: "assistive", weekly_learning_hours: 6, skills: [], ...store.get("ap.profile.v2", {}) },
  thread: [],
};
const saveProfile = () => store.set("ap.profile.v2", S.profile);

// ---------------------------------------------------------------- boot
const PUBLIC_PAGES = new Set(["", "start", "signin", "sdgs"]);  // everything else needs an account

async function boot() {
  try {
    S.me = await api("/api/me");
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) throw e;
    S.me = null;  // guest: public landing + Today; features ask to sign in
  }
  if (S.me && S.me.role !== "employee") { location.replace("enterprise.html"); return; }
  if (S.me) {
    const wait = new Owl({ size: 96, state: "searching" });
    app.replaceChildren(h("main", { class: "empty", style: { margin: "18vh auto 0", "justify-items": "center", "text-align": "center" }, "aria-busy": "true" },
      wait.el, h("p", { class: "muted" }, "Waking up the agents…")));
    S.meta = await api("/api/meta");
  }
  shell();
  addEventListener("hashchange", route);
  route();
}

// ---------------------------------------------------------------- sign in
const FEATURE = { quiz: "the quick match game", resume: "resume analysis", build: "the plan builder", report: "your briefing", plans: "your plans", interview: "mock interview" };

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
  const user = h("input", { class: "input", name: "username", autocomplete: "username", required: true, maxlength: 40 });
  const pass = h("input", { class: "input", name: "password", type: "password", autocomplete: "current-password", required: true, maxlength: 200 });
  const btn = h("button", { class: "btn primary", type: "submit" }, "Sign in");
  const specimen = h("table", { class: "specimen", "aria-label": "Most important skills for an example occupation (ESCO)" });
  app.replaceChildren(h("main", { class: "signin" },
    h("section", { class: "signin-story" },
      owl.el,
      h("h1", {}, "Know which skills the job market actually asks for."),
      h("p", { class: "lede" }, "Free, evidence-based 90-day learning plans for any job. Every claim links to its public source, starting with ESCO, the European Commission's skills and occupations classification."),
      specimen),
    h("form", { class: "signin-form", onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; err.textContent = "";
      try {
        const me = await api("/api/login", { method: "POST", body: { username: user.value, password: pass.value } });
        if (me.role !== "employee") { location.replace("enterprise.html"); return; }
        // switch to the signed-in app in place: a hash change + reload could show the guest page again
        S.me = me; S.meta = await api("/api/meta");
        shell();
        if (location.hash === `#/${next}`) route(); else location.hash = `#/${next}`;
      } catch (ex) { err.textContent = ex.message; owl.set("confused"); btn.disabled = false; pass.select(); }
    } },
      h("a", { class: "signin-back", href: "#/start" }, icon("back"), "Back to home"),
      h("span", { class: "wordmark" }, "AiversePulse"),
      FEATURE[next.split("/")[0]] ? h("p", { class: "signin-next" }, `Sign in to open ${FEATURE[next.split("/")[0]]}.`) : null,
      h("label", { class: "field" }, h("span", {}, "Username"), user),
      h("label", { class: "field" }, h("span", {}, "Password"), pass),
      err, btn,
      h("p", { class: "fine" }, "Accounts are issued by your administrator. Decision support only: plans stay drafts until you approve them."),
      h("p", { class: "fine" }, "Employees and HR advisors both sign in here; HR advisors go straight to the Enterprise console."))));
  user.focus();
  try {
    const sp = await api("/api/public/specimen");
    const max = 5;
    specimen.append(h("caption", { class: "sr-only" }, sp.source),
      h("tbody", {}, sp.skills.map(([k, v], i) => h("tr", {},
        h("td", {}, k), h("td", { class: "num" }, `${v.toFixed(2)}`),
        h("td", { style: { width: "55%" } }, reveal(h("div", { class: "bar", style: { width: `${(v / max) * 100}%`, "transform-origin": "left" } }), GROW, { duration: 900, delay: i * 90 }))))));
    specimen.after(h("p", { class: "muted", style: { "font-size": "13px" } }, `Most important skills for ${sp.role} (ESCO), predicted importance out of 5. Works the same for any of ~3,000 occupations.`));
  } catch { /* specimen is decorative context; the form works without it */ }
}

// ---------------------------------------------------------------- shell
function shell() {
  S.status = new OwlStatus({ size: 32, say: "Ready when you are" });
  S.sources = h("aside", { class: "sources", "aria-label": "Sources" }, h("h2", {}, "Sources"),
    h("p", { class: "muted" }, "Citations from your report appear here."));
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
      // guests get one page (the home, with today's board on it) and one action: sign in
      guest ? null : h("nav", { class: "pub-nav", "aria-label": "Primary" }, nav("#/start", "Home", "home"), nav("#/today", "AI trends", "pulse"),
        nav("#/report", "Chat", "report"), nav("#/interview", "Interview", "quiz"), nav("#/plans", "My plans", "plans")),
      guest ? null : S.status.el,
      guest
        ? h("div", { class: "top-actions" }, h("a", { class: "btn sm primary top-signin", href: "#/signin" }, icon("user"), "Sign in"))
        : h("button", { class: "btn sm signout", onclick: signOut }, icon("out"), "Sign out")),
    h("main", { id: "main", class: "pub-main", tabindex: "-1" }),
    guest ? null : h("nav", { class: "tabbar", "aria-label": "Primary" }, tab("#/start", "Home", "home"), tab("#/today", "AI trends", "pulse"), tab("#/interview", "Interview", "quiz"), tab("#/plans", "Plans", "plans")),
    S.sheet].filter(Boolean));  // replaceChildren would print a null as the text "null"
}

async function signOut() {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  location.replace("./");
}

let homeScrollTop = 0;
// Hash routes render their own content; restore after that content exists.
history.scrollRestoration = "manual";
function route() {
  const hash = location.hash || "#/start";
  const [requested = "start", id, ...rest] = hash.startsWith("#/") ? hash.slice(2).split("/") : [];
  const allowed = new Set(["start", "today", "signin", "quiz", "resume", "build", "report", "plans", "sdgs", "interview"]);
  const interviewStart = requested === "interview" && id === "start" && rest.length === 1 && /^[A-Za-z0-9_-]+$/.test(rest[0]);
  // Unknown routes and malformed nested routes return home instead of showing the wrong page.
  if (!allowed.has(requested) || (rest.length && requested !== "signin" && !interviewStart) ||
      (id && !["signin", "plans", "report", "interview"].includes(requested))) {
    location.replace("#/start");
    return;
  }
  // guests see today's board on the home page, not on a page of its own: show home and jump to the board
  S.jumpToday = !S.me && requested === "today";
  if (S.jumpToday) history.replaceState(null, "", "#/start");
  const page = S.jumpToday ? "start" : requested;
  if (!S.me && !PUBLIC_PAGES.has(page)) {
    location.replace(`#/signin/${hash.slice(2)}`);
    return;
  }
  if (page === "signin") {
    const next = hash.startsWith("#/signin/") ? hash.slice("#/signin/".length) : "start";
    if (S.me) { location.replace(`#/${cleanDestination(next)}`); return; }
    signIn(next);
    return;
  }
  if (!$("#main")) shell();
  const section = ["quiz", "resume", "build"].includes(page) ? "#/start" : `#/${page}`;  // the three starts live on Home
  document.querySelectorAll("[data-route]").forEach((a) => {
    const active = section === a.dataset.route || section.startsWith(a.dataset.route + "/");
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const main = $("#main");
  if (main.classList.contains("home-page")) homeScrollTop = window.scrollY;
  main._homeObserver?.disconnect();
  main.classList.toggle("home-page", page === "start");
  if (page === "report") reportView(main, id);
  else if (page === "plans" && id) planDetail(main, id);
  else if (page === "plans") plansView(main);
  else if (page === "build") buildView(main);
  else if (page === "interview") interviewView(main, interviewStart ? null : id, interviewStart ? rest[0] : null);
  else if (page === "quiz") quizView(main, { status: S.status, planFor, onInterview: startInterview });
  else if (page === "resume") resumeView(main, { status: S.status, planFor, onInterview: startInterview });
  else if (page === "sdgs") sdgsView(main).catch((e) => main.append(h("div", { class: "issue error" }, e.message)));
  else if (page === "today") todayView(main).catch((e) => main.append(h("div", { class: "issue error" }, e.message)));
  else startView(main, { name: S.me?.display_name?.match(/^(?!Demo\b)(\S+)/)?.[1], guest: !S.me, jumpToday: S.jumpToday });
  S.jumpToday = false;
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
      : [h("li", { class: "muted", role: "option", "aria-disabled": "true" }, "No ESCO occupation matches. Try a broader word.")]));
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
  const scen = (key, title, note) => h("label", {},
    h("input", { type: "radio", name: "scenario", value: key, checked: p.scenario === key ? true : null, onchange: () => { p.scenario = key; saveProfile(); steps[3].dataset.done = "true"; } }),
    h("b", {}, title), h("span", { class: "muted" }, note));

  main.replaceChildren(
    h("h1", { class: "page-title" }, "Build your plan"),
    h("p", { class: "lede" }, "Works for any job. The agents compare your skills with the ESCO requirements for the job you pick, then write a plan you can edit and approve."),
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
            scen("assistive", "Assistive AI", "AI helps you do today's work. Required levels are the model's predictions."),
            scen("agentic", "Agentic AI", "AI agents take over routine execution; judgement and oversight skills weigh more. A stated assumption."))),
        h("div", { class: "build-actions" }, h("button", { class: "btn primary", type: "submit" }, "Analyse my skills", icon("send"))))));
  drawRows();
  if (p.target_role) choose(p.target_role).catch(() => {});
  S.status.set("idle", "Ready when you are");
}

/** From a role match (quiz or resume): target that occupation with the skills we found, then run the agents. */
function planFor(m, skills) {
  Object.assign(S.profile, { target_role: m.soc, target_title: m.title,
    skills: skills.slice(0, 40).map(({ name, level }) => ({ name, level })) });
  saveProfile();
  start();
}

function startInterview(m) {
  if (!m?.recommendation_id) { toast("This role is not linked to a completed career recommendation yet.", "err"); return; }
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
    S.input = h("input", { class: "input", placeholder: "Ask for a change, e.g. “I only have 3 hours a week”", maxlength: 500, "aria-label": "Message" });
    S.sendBtn = h("button", { class: "btn primary", type: "submit", "aria-label": "Send" }, icon("send"));
    S.composer = h("form", { class: "composer", onsubmit: (e) => { e.preventDefault(); composerSend(); } },
      S.quick = h("div", { class: "quick", "aria-label": "Suggested next messages" }),
      h("div", { class: "row" }, S.input, S.sendBtn));
    // follow the answer as it streams, unless the reader scrolled up to read something
    S.stick = true;
    addEventListener("scroll", () => { S.stick = innerHeight + scrollY >= document.documentElement.scrollHeight - 160; }, { passive: true });
    new MutationObserver(() => { if (S.busy && S.stick && S.reportEl.isConnected) scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }); })
      .observe(S.threadEl, { childList: true, subtree: true, characterData: true });
    S.reportEl = h("div", { class: "report" },
      h("div", { class: "thread-col", style: { display: "grid", gap: "24px", "min-width": 0 } },
        h("div", { style: { display: "flex", "justify-content": "space-between", "align-items": "end", gap: "12px", "flex-wrap": "wrap" } },
          h("h1", { class: "page-title" }, "Chat"),
          h("div", { class: "row-actions" },
            h("button", { class: "btn sm", type: "button", onclick: newChat }, icon("spark"), "New chat"),
            h("button", { class: "btn sm", type: "button", popovertarget: "history-menu" }, icon("history"), "History"),
            h("button", { class: "btn sm only-narrow", type: "button", onclick: () => S.sheet.showModal() }, icon("sources"), "Sources"))),
        S.history = h("div", { id: "history-menu", popover: "auto", class: "core-menu history-menu", "aria-label": "Past briefings" }),
        S.threadEl, S.composer),
      S.sources);
  }
  main.replaceChildren(S.reportEl);
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
  S.history.replaceChildren(h("p", { class: "history-head" }, icon("history"), "Past briefings"),
    ...(plans.length ? plans.map((p) => h("a", { class: "core-item", href: `#/report/${p.plan_id}`, onclick: () => S.history.hidePopover?.() },
      h("span", { class: "core-ic" }, icon("report")),
      h("span", { class: "core-t" }, h("b", {}, p.target_role || "Plan"),
        h("span", {}, `${p.scenario === "agentic" ? "Agentic" : "Assistive"} AI · ${fmtTime(p.created_utc)} · v${p.version}`)),
      h("span", { class: `tag ${p.status}` }, p.status)))
      : [h("p", { class: "muted", style: { padding: "8px 12px" } }, "No briefings yet.")]));  // spread: replaceChildren does not flatten
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
      : [h("li", { class: "muted", role: "option", "aria-disabled": "true" }, "No job matches. Try a broader word.")]));
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
  const card = h("article", { class: "turn-owl" }, new Owl({ size: 44, state: "idle" }).el,
    h("div", { class: "body" }, h("div", { class: "who" }, "JobSmart"), h("p", {}, "Which job should I look at?"),
      jobPicker((o) => { card.remove(); pickJob(o); })));
  S.threadEl.append(card);
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.querySelector("input").focus({ preventScroll: true });
}

/** Empty chat: the owl asks which job. A saved target job runs in one click. */
function briefingStarter() {
  const p = S.profile;
  const ready = p.target_role && p.skills.length;
  return h("div", { class: "brief-start" }, new Owl({ size: 96, state: "idle" }).el,
    h("h2", {}, "Which job are you aiming for?"),
    h("p", { class: "muted" }, "Pick a job and the AI agents compare your skills with it, then write a 90-day plan here."),
    ready ? h("button", { type: "button", class: "btn primary brief-go", onclick: () => start() },
      jobIcon(p.target_role, { size: 28 }), `Continue with ${p.target_title || "my target job"}`) : null,
    jobPicker(pickJob),
    h("p", { class: "muted" }, "Prefer to enter all your skills yourself? ", h("a", { href: "#/build" }, "Use the skills form")));
}

function newChat() {
  if (S.busy) S.busy.abort();
  S.thread = []; S.lastPlanId = null; S.openId = null;
  S.threadEl.replaceChildren(briefingStarter());
  S.composer.hidden = true;
  if (location.hash !== "#/report") history.replaceState(null, "", "#/report");
}

/** Reopen a past conversation in the chat, every turn, with the latest plan; typing continues it. */
async function openConversation(id) {
  S.openId = id;
  S.threadEl.replaceChildren(h("p", { class: "muted" }, "Opening your conversation…"));
  let d;
  try { d = await api(`/api/plans/${id}`); } catch (e) { S.threadEl.replaceChildren(h("div", { class: "issue error" }, e.message)); return; }
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
    const body = h("div", { class: "body" }, t.a ? staticText(t.a, highlight) : null);
    if (i === turns.length - 1) {  // the latest turn carries the full analysis and the plan
      let insights = null;
      const add = (el, small) => { if (!el) return; if (small) (insights ??= body.appendChild(h("div", { class: "insights" }))).append(el); else body.append(el); };
      add(r.gaps?.length ? gapsBlock(r.gaps) : null);
      add(r.comparison?.length ? comparisonBlock(r.comparison, d.plan.scenario) : null);
      add(r.outlook ? outlookBlock(r.outlook) : null, true);
      add(r.signals ? signalsBlock(r.signals) : null, true);
      add(r.sdgs?.length ? sdgBlock(r.sdgs) : null, true);
      add(r.issues?.some((x) => x.severity === "error") ? issuesBlock(r.issues.filter((x) => x.severity === "error")) : null);
      body.append(planHolder(id, d.plan, r.request?.weekly_learning_hours ?? S.profile.weekly_learning_hours, d.status, d.progress));
    }
    return [h("div", { class: "turn-user" }, h("p", { class: "q" }, t.q || `Plan for ${t.title || title}`)),
      h("article", { class: "turn-owl" }, new Owl({ size: 44, state: "idle" }).el,
        h("div", { class: "body" }, h("div", { class: "who" }, "JobSmart", t.at ? h("span", { class: "muted" }, fmtTime(t.at)) : null), body))];
  }));
  S.ctx = { gaps: r.gaps, outlook: r.outlook };
  drawSuggestions();
  S.composer.hidden = false;
  S.threadEl.lastElementChild?.scrollIntoView({ block: "start" });
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
  const owl = new Owl({ size: 44, state: "thinking" });
  const say = h("span", { class: "muted" }, "Reading your request");
  const traceList = h("ol");
  const running = h("li", { class: "run" }, h("span", { class: "dot" }), h("span", {}, "Working"), h("span", { class: "ms" }));
  traceList.append(running);
  const sumText = h("span", {}, "Working through the agents…");
  const trace = h("details", { class: "trace", open: true }, h("summary", {}, h("span", { class: "spinner", "aria-hidden": "true" }), sumText), traceList);
  const prose = h("p", { class: "prose", "aria-live": "polite" });
  const body = h("div", { class: "body" }, trace, prose);
  const turn = h("article", { class: "turn-owl", "aria-label": "JobSmart briefing" }, owl.el,
    h("div", { class: "body" }, h("div", { class: "who" }, "JobSmart", say), body));
  S.threadEl.querySelector(".empty, .brief-start")?.remove();
  S.threadEl.append(reveal(userTurn, RISE), reveal(turn, RISE, { delay: 120 }));
  S.stick = true;  // a new message: follow it

  S.ctx = {};  // what this answer finds (gaps, outlook) shapes the suggested next messages
  S.quick.replaceChildren();
  const st = new StreamText(prose, highlight);
  const ctrl = new AbortController();
  setBusy(ctrl);
  let steps = 0, reused = 0, t0 = performance.now(), planId = null, meta = null, insights = null;
  const mood = (state, text) => { owl.set(state); S.status.set(state, text || say.textContent); if (text) say.textContent = text; };
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
        sumText.textContent = `Ran ${steps} agent steps${reused ? `, reused ${reused}` : ""} · ${(ev.usage.ms / 1000).toFixed(1)} s · ${ev.usage.llm_calls} LLM calls`;
        setTimeout(() => { trace.open = false; }, 700);
      } else if (ev.t === "text") st.push(ev.delta);
      else if (ev.t === "section") {
        const d = ev.data;
        if (ev.kind === "gaps" || ev.kind === "outlook") S.ctx[ev.kind] = d;
        const el = ev.kind === "changes" ? changesBlock(d) : ev.kind === "gaps" ? gapsBlock(d) : ev.kind === "comparison" ? comparisonBlock(d, p.scenario)
          : ev.kind === "outlook" ? outlookBlock(d) : ev.kind === "signals" ? signalsBlock(d) : ev.kind === "sdgs" ? sdgBlock(d)
          : ev.kind === "issues" ? issuesBlock(d.filter((i) => i.severity === "error"))
          : ev.kind === "plan" ? planHolder(planId, d, p.weekly_learning_hours, meta?.status || "draft") : null;
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
    else { mood("confused", "Something went wrong"); body.append(h("div", { class: "issue error" }, e.message)); }
  } finally {
    setBusy(null);
  }
}

function planHolder(planId, plan, hours, status, progress = []) {
  const holder = h("div");
  const render = async (st, version) => {
    holder.replaceChildren(planBlock({ planId, plan, version, status: st, weeklyHours: hours, progress, evidence: S.evidence, onChange: async (next) => {
      const fresh = await api(`/api/plans/${planId}`);
      plan = fresh.plan; progress = fresh.progress || [];
      render(fresh.status, fresh.version);
      if (next === "approved") {
        S.status.set("celebrating", "Plan approved — it's yours");
        location.hash = `#/plans/${planId}`;
      }
    } }));
  };
  render(status, 1);
  return holder;
}

// ---------------------------------------------------------------- plans
async function plansView(main) {
  main.replaceChildren(h("h1", { class: "page-title" }, "My plans"), h("p", { class: "lede" }, "Your own plans and any plan HR prepared for you."));
  const list = await api("/api/plans");
  if (!list.length) {
    main.append(h("div", { class: "empty" }, new Owl({ size: 96, state: "sleeping" }).el,
      h("p", {}, "No plans yet. Build your first one in about two minutes."), h("a", { class: "btn primary", href: "#/start" }, "Get started")));
    return;
  }
  main.append(h("div", { class: "plan-list", style: { "margin-top": "28px" } }, list.map((pl) => h("a", { class: "plan-item", href: `#/plans/${pl.plan_id}`, style: { color: "inherit", "text-decoration": "none" } },
    h("div", {}, h("div", { class: "t" }, pl.target_title || pl.target_role || "Plan", pl.audience === "hr" ? h("span", { class: "muted" }, " · from HR") : null),
      h("div", { class: "m" }, `${pl.scenario || ""} · v${pl.version} · ${new Date(pl.created_utc).toLocaleDateString()}`)),
    h("span", { class: `tag ${pl.status}` }, pl.status)))));
}

async function planDetail(main, id, focusPlan = false) {
  main.replaceChildren(h("p", { class: "muted" }, "Loading…"));
  let d;
  try { d = await api(`/api/plans/${id}`); } catch (e) { main.replaceChildren(h("div", { class: "issue error" }, e.message)); return; }
  const r = d.report;
  const approved = d.status === "approved";
  const totalHours = d.plan.activities.reduce((sum, activity) => sum + Number(activity.estimated_hours || 0), 0);
  setSources(r?.evidence || []);
  const reportContent = h("div", { class: "plan-report-content" },
    !r ? h("p", { class: "note" }, "This older plan has no saved report. Approval cannot restore it. Build a new plan to generate the full analysis; your saved 90-day plan is below.") : null,
    r?.narrative ? staticText(r.narrative, highlight) : null,
    r?.gaps?.length ? gapsBlock(r.gaps) : null,
    r?.comparison?.length ? comparisonBlock(r.comparison, d.plan.scenario) : null,
    r?.outlook ? outlookBlock(r.outlook) : null,
    r?.signals ? signalsBlock(r.signals) : null,
    r?.sdgs?.length ? sdgBlock(r.sdgs) : null,
    r?.issues?.length ? issuesBlock(r.issues) : null);
  const planFocus = h("section", { class: "plan-focus", tabindex: "-1", "aria-label": approved ? "Approved plan and implementation" : "Proposed plan" },
    h("div", { class: "plan-hero" },
      h("div", { class: "plan-hero-title" }, h("div", {}, h("p", { class: "eyebrow" }, "90-day learning roadmap"),
        h("h2", {}, "Your learning roadmap")), h("span", { class: `tag ${d.status}` }, d.status)),
      h("p", { class: "plan-hero-copy" }, approved ? "Your approved plan is ready. Follow the phases below to put it into action." : "Your learning plan, organized into three practical phases."),
      h("div", { class: "plan-hero-metrics" }, h("span", {}, icon("clock"), "90 days"), h("span", {}, icon("plans"), `${Math.round(totalHours * 10) / 10} estimated learning hours`))),
    planBlock({ planId: id, plan: d.plan, version: d.version, status: d.status, weeklyHours: null, progress: d.progress, evidence: r?.evidence,
      title: approved ? "Your approved 90-day plan" : "Your proposed 90-day plan",
      onChange: () => planDetail(main, id, true) }));
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
      toggle.textContent = expanded ? "Hide Report" : "View Report";
      if (!expanded) planFocus.focus({ preventScroll: true });
    } }, expanded ? "Hide Report" : "View Report");
  const disclosure = h("section", { class: "plan-report", "data-expanded": String(expanded), "aria-label": "Analysis report" },
    h("div", { class: "plan-report-heading" }, h("h2", {}, "Analysis report"), toggle), panel);
  const blocks = h("div", { class: "body", style: { "max-width": "760px" } },
    ...(approved ? [planFocus, disclosure] : [disclosure, planFocus]),
    d.audience === "hr" && d.status === "approved" ? h("div", { class: "approve-bar" }, h("span", {}, "HR approved this plan for you."),
      h("button", { class: "btn primary", onclick: async () => { await api(`/api/plans/${id}/acknowledge`, { method: "POST" }); toast("Acknowledged"); planDetail(main, id); } }, "Acknowledge")) : null,
    h("section", { class: "block" }, h("h3", {}, "History"), historyBlock(d.history)));
  const pdf = h("button", { class: "btn sm no-print", type: "button", onclick: () => {  // the browser's "Save as PDF", every section open
    main.querySelectorAll("details").forEach((x) => { x.open = true; });
    main.querySelectorAll(".plan-report-panel").forEach((x) => { x.inert = false; x.removeAttribute("aria-hidden"); });
    main.querySelector(".plan-report")?.setAttribute("data-expanded", "true");
    print();
  } }, icon("file"), "Download PDF");
  main.replaceChildren(h("div", { class: "plan-top-actions no-print" }, h("a", { href: "#/plans", class: "btn ghost sm" }, icon("back"), "All plans"), pdf),
    h("h1", { class: "page-title", style: { "margin-top": "12px" } }, r?.occupation?.title || d.plan.target_role), blocks);
  if (focusPlan) planFocus.focus({ preventScroll: true });
}

boot().catch((e) => { app.replaceChildren(h("main", { class: "pub-main" }, h("div", { class: "issue error" }, `Could not start: ${e.message}`))); });
