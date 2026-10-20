// AiversePulse (public users): sign-in, plan builder, chat-style streaming report, plans.
import { api, stream, h, $, icon, toast, ApiError, reveal, RISE, DROP, GROW } from "./lib.js";
import { Owl, OwlStatus } from "./owl.js";
import { StreamText, gapsBlock, comparisonBlock, outlookBlock, issuesBlock, planBlock, historyBlock,
  sourceItem, staticText, signalsBlock, sdgBlock } from "./blocks.js";
import { startView, quizView, resumeView, todayView } from "./explore.js";

const app = $("#app");
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: in-memory only */ } },
};
const S = {
  me: null, meta: null, status: null, sheet: null, sources: null, evidence: new Map(), busy: null,
  profile: store.get("ap.profile.v2", { target_role: null, target_title: null, scenario: "assistive", weekly_learning_hours: 6,
    skills: [] }),
  thread: [],
};
const saveProfile = () => store.set("ap.profile.v2", S.profile);

// ---------------------------------------------------------------- boot
async function boot() {
  try {
    S.me = await api("/api/me");
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return signIn();
    throw e;
  }
  if (S.me.role !== "employee") { location.replace("/enterprise"); return; }
  const wait = new Owl({ size: 96, state: "searching" });
  app.replaceChildren(h("main", { class: "empty", style: { margin: "18vh auto 0", "justify-items": "center", "text-align": "center" }, "aria-busy": "true" },
    wait.el, h("p", { class: "muted" }, "Waking up the agents…")));
  S.meta = await api("/api/meta");
  shell();
  addEventListener("hashchange", route);
  route();
}

// ---------------------------------------------------------------- sign in
async function signIn() {
  const owl = new Owl({ size: 200, state: "greeting" });
  const err = h("p", { class: "error", role: "alert" });
  const user = h("input", { class: "input", name: "username", autocomplete: "username", required: true, maxlength: 40 });
  const pass = h("input", { class: "input", name: "password", type: "password", autocomplete: "current-password", required: true, maxlength: 200 });
  const btn = h("button", { class: "btn primary", type: "submit" }, "Sign in");
  const specimen = h("table", { class: "specimen", "aria-label": "Most important skills for an example occupation (O*NET 31.0)" });
  app.replaceChildren(h("main", { class: "signin" },
    h("section", { class: "signin-story" },
      owl.el,
      h("h1", {}, "Know which skills the job market actually asks for."),
      h("p", { class: "lede" }, "Free, evidence-based 90-day learning plans for any job. Every claim links to its source in the O*NET 31.0 occupational database."),
      specimen),
    h("form", { class: "signin-form", onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; err.textContent = "";
      try {
        const me = await api("/api/login", { method: "POST", body: { username: user.value, password: pass.value } });
        location.replace(me.role === "employee" ? "/#/start" : "/enterprise");
        if (me.role === "employee") location.reload();
      } catch (ex) { err.textContent = ex.message; owl.set("confused"); btn.disabled = false; pass.select(); }
    } },
      h("span", { class: "wordmark" }, "AiversePulse"),
      h("label", { class: "field" }, h("span", {}, "Username"), user),
      h("label", { class: "field" }, h("span", {}, "Password"), pass),
      err, btn,
      h("p", { class: "fine" }, "Accounts are issued by your administrator. Decision support only: plans stay drafts until you approve them."),
      h("p", { class: "fine" }, "HR advisor? ", h("a", { href: "/enterprise", style: { color: "inherit" } }, "Open AiversePulse Enterprise")))));
  user.focus();
  try {
    const sp = await fetch("/api/public/specimen").then((r) => r.json());
    const max = 5;
    specimen.append(h("caption", { class: "sr-only" }, sp.source),
      h("tbody", {}, sp.skills.map(([k, v], i) => h("tr", {},
        h("td", {}, k), h("td", { class: "num" }, `${v.toFixed(2)}`),
        h("td", { style: { width: "55%" } }, reveal(h("div", { class: "bar", style: { width: `${(v / max) * 100}%`, "transform-origin": "left" } }), GROW, { duration: 900, delay: i * 90 }))))));
    specimen.after(h("p", { class: "muted", style: { "font-size": "13px" } }, `Most important skills for ${sp.role}, O*NET importance out of 5 (O*NET 31.0). Works the same for any of ~900 occupations.`));
  } catch { /* specimen is decorative context; the form works without it */ }
}

// ---------------------------------------------------------------- shell
function shell() {
  S.status = new OwlStatus({ size: 32, say: "Ready when you are" });
  S.sources = h("aside", { class: "sources", "aria-label": "Sources" }, h("h2", {}, "Sources"),
    h("p", { class: "muted", style: { "font-size": "13px" } }, "Citations from your report appear here."));
  S.sheetBody = h("div", { class: "sheet-body" });
  S.sheet = h("dialog", { class: "sheet", "aria-label": "Sources" },
    h("div", { class: "sheet-head" }, h("strong", {}, "Sources"), h("button", { class: "btn sm", onclick: () => S.sheet.close() }, "Close")),
    S.sheetBody);
  const nav = (href, label) => h("a", { href, "data-route": href }, label);
  const tab = (href, label, ic) => h("a", { href, "data-route": href }, icon(ic), label);
  app.replaceChildren(
    h("a", { class: "sr-only", href: "#main" }, "Skip to content"),
    h("header", { class: "pub-top" },
      h("a", { class: "wordmark", href: "#/start" }, "AiversePulse"),
      h("nav", { class: "pub-nav", "aria-label": "Primary" }, nav("#/start", "Start"), nav("#/report", "Report"), nav("#/today", "Today"), nav("#/plans", "My plans")),
      S.status.el,
      h("button", { class: "btn sm signout", onclick: signOut }, "Sign out")),
    h("main", { id: "main", class: "pub-main", tabindex: "-1" }),
    h("nav", { class: "tabbar", "aria-label": "Primary" }, tab("#/start", "Start", "build"), tab("#/report", "Report", "report"), tab("#/today", "Today", "pulse"), tab("#/plans", "Plans", "plans")),
    S.sheet);
}

async function signOut() {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  location.replace("/");
}

function route() {
  const hash = location.hash || "#/start";
  const [, page, id] = hash.split("/");
  const section = ["quiz", "resume", "build"].includes(page) ? "#/start" : hash;
  document.querySelectorAll("[data-route]").forEach((a) => {
    if (section.startsWith(a.dataset.route)) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const main = $("#main");
  const go = () => {
    if (page === "report") reportView(main);
    else if (page === "plans" && id) planDetail(main, id);
    else if (page === "plans") plansView(main);
    else if (page === "build") buildView(main);
    else if (page === "quiz") quizView(main, { status: S.status, planFor });
    else if (page === "resume") resumeView(main, { status: S.status, planFor });
    else if (page === "today") todayView(main).catch((e) => main.append(h("div", { class: "issue error" }, e.message)));
    else startView(main, { name: S.me.display_name?.split(" ")[0] });
  };
  go();
  reveal(main, [{ opacity: 0.4 }, { opacity: 1 }], { duration: 200 });
  scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- build
function buildView(main) {
  const p = S.profile;
  if (p.target_role && !/^\d{2}-\d{4}\.\d{2}$/.test(p.target_role)) { p.target_role = null; p.target_title = null; }
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

  // occupation picker: combobox over all O*NET occupations and ~45k alternate titles
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
      h("b", {}, o.title), o.matched ? h("span", { class: "muted" }, ` · “${o.matched}”`) : null, h("span", { class: "mono muted" }, o.soc)))
      : [h("li", { class: "muted", role: "option", "aria-disabled": "true" }, "No O*NET occupation matches. Try a broader word.")]));
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
      h("div", {}, h("b", {}, occ.title), h("span", { class: "mono muted" }, ` ${occ.soc}`)),
      h("p", { class: "muted" }, occ.description.length > 220 ? occ.description.slice(0, 220) + "…" : occ.description),
      h("a", { href: occ.url, target: "_blank", rel: "noopener noreferrer" }, "O*NET OnLine profile")));
    steps[0].dataset.done = "true";
    drawRows(); drawSuggest();
  }

  const hoursIn = h("input", { type: "number", min: "0.5", max: "80", step: "0.5", value: p.weekly_learning_hours, "aria-label": "Hours per week",
    onchange: () => { p.weekly_learning_hours = Math.min(80, Math.max(0.5, Number(hoursIn.value) || 6)); hoursIn.value = p.weekly_learning_hours; saveProfile(); } });
  const bump = (d) => { hoursIn.value = Math.min(80, Math.max(0.5, Number(hoursIn.value) + d)); hoursIn.dispatchEvent(new Event("change")); };
  const scen = (key, title, note) => h("label", {},
    h("input", { type: "radio", name: "scenario", value: key, checked: p.scenario === key ? true : null, onchange: () => { p.scenario = key; saveProfile(); } }),
    h("b", {}, title), h("span", { class: "muted" }, note));
  steps[2].dataset.done = steps[3].dataset.done = "true";

  main.replaceChildren(
    h("h1", { class: "page-title" }, "Build your plan"),
    h("p", { class: "lede" }, "Works for any job. The agents compare your skills with the O*NET 31.0 requirements for the job you pick, then write a plan you can edit and approve."),
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
            scen("assistive", "Assistive AI", "AI helps you do today's work. Required levels follow O*NET ratings."),
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

function start(query) {
  if (!S.profile.skills.length) { toast("Add at least one skill first.", "err"); location.hash = "#/build"; return; }
  S.pending = { ...S.profile, skills: S.profile.skills.map((s) => ({ ...s })), query };
  location.hash = "#/report";
  if (location.hash === "#/report") reportView($("#main"));
}

// ---------------------------------------------------------------- report (chat)
function reportView(main) {
  if (!S.reportEl) {
    S.threadEl = h("div", { class: "thread", "aria-live": "off" });
    S.input = h("input", { class: "input", placeholder: "Ask for a change, e.g. “I only have 3 hours a week”", maxlength: 500, "aria-label": "Message" });
    S.sendBtn = h("button", { class: "btn primary", type: "submit", "aria-label": "Send" }, icon("send"));
    const quick = (label, fn) => h("button", { class: "chip", type: "button", onclick: fn }, label);
    S.composer = h("form", { class: "composer", onsubmit: (e) => { e.preventDefault(); composerSend(); } },
      h("div", { class: "quick" },
        quick("Compare with agentic AI", () => rerun({ scenario: S.profile.scenario === "agentic" ? "assistive" : "agentic" })),
        quick("I have more time: 10 h/week", () => rerun({ weekly_learning_hours: 10 })),
        quick("Edit my skills", () => { location.hash = "#/build"; }),
        quick("Try a different job", () => { location.hash = "#/start"; })),
      h("div", { class: "row" }, S.input, S.sendBtn));
    S.reportEl = h("div", { class: "report" },
      h("div", { class: "thread-col", style: { display: "grid", gap: "24px", "min-width": 0 } },
        h("div", { style: { display: "flex", "justify-content": "space-between", "align-items": "end", gap: "12px", "flex-wrap": "wrap" } },
          h("h1", { class: "page-title" }, "Your briefing"),
          h("button", { class: "btn sm only-narrow", type: "button", onclick: () => S.sheet.showModal() }, icon("sources"), "Sources")),
        S.threadEl, S.composer),
      S.sources);
  }
  main.replaceChildren(S.reportEl);
  if (S.pending) { const q = S.pending; S.pending = null; runTurn(q); }
  else if (!S.thread.length) {
    S.threadEl.replaceChildren(h("div", { class: "empty" }, new Owl({ size: 96, state: "idle" }).el,
      h("h2", {}, "No briefing yet"),
      h("p", { class: "muted" }, "Play the quick match game, upload your resume or pick a job, and the AI agents will write your briefing here."),
      h("a", { class: "btn primary", href: "#/start" }, "Get started")));
  }
}

function rerun(change) {
  Object.assign(S.profile, change); saveProfile();
  start();
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
  S.sources.replaceChildren(h("h2", {}, "Sources"), h("p", { class: "muted", style: { "font-size": "13px" } }, `${list.length} dated sources`), list.map(sourceItem));
  S.sheetBody.replaceChildren(...list.map((e) => { const el = sourceItem(e); el.removeAttribute("id"); el.dataset.id = e.id; return el; }));
}

async function runTurn(params) {
  const p = params;
  const label = p.query || `Plan for ${p.target_title || p.target_role}`;
  S.thread.push(p);
  const userTurn = h("div", { class: "turn-user" }, h("p", { class: "q" }, label),
    h("div", { class: "meta" }, [p.target_title || p.target_role, p.scenario === "agentic" ? "Agentic AI" : "Assistive AI", `${p.weekly_learning_hours} h/week`,
      ...p.skills.map((s) => `${s.name} ${s.level}`)].map((t) => h("span", {}, t))));
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
  S.threadEl.querySelector(".empty")?.remove();
  S.threadEl.append(reveal(userTurn, RISE), reveal(turn, RISE, { delay: 120 }));
  turn.scrollIntoView({ behavior: "smooth", block: "start" });

  const st = new StreamText(prose, highlight);
  const ctrl = new AbortController();
  setBusy(ctrl);
  let steps = 0, t0 = performance.now(), planId = null, meta = null;
  const mood = (state, text) => { owl.set(state); S.status.set(state, text || say.textContent); if (text) say.textContent = text; };
  try {
    await stream("/api/analyze", {
      target_role: p.target_role, scenario: p.scenario, weekly_learning_hours: p.weekly_learning_hours,
      skills: p.skills, ...(p.query ? { query: p.query } : {}),
    }, (ev) => {
      if (ev.t === "owl") mood(ev.state, ev.say);
      else if (ev.t === "agent") {
        steps++;
        running.before(reveal(h("li", {}, h("span", { class: "dot" }), h("span", {}, ev.label), h("span", { class: "ms" }, `${ev.ms} ms`)),
          [{ opacity: 0, clipPath: "inset(0 0 100% 0)" }, { opacity: 1, clipPath: "inset(0)" }], { duration: 240 }));
        mood(owl.state, ev.label);
      } else if (ev.t === "meta") {
        meta = ev; planId = ev.plan_id; setSources(ev.evidence || []);
        running.remove(); trace.querySelector(".spinner")?.remove();
        sumText.textContent = `Worked through ${steps} agent steps · ${(ev.usage.ms / 1000).toFixed(1)} s · ${ev.usage.llm_calls} LLM calls`;
        setTimeout(() => { trace.open = false; }, 700);
      } else if (ev.t === "text") st.push(ev.delta);
      else if (ev.t === "section") {
        const d = ev.data;
        const el = ev.kind === "gaps" ? gapsBlock(d) : ev.kind === "comparison" ? comparisonBlock(d, p.scenario)
          : ev.kind === "outlook" ? outlookBlock(d) : ev.kind === "signals" ? signalsBlock(d) : ev.kind === "sdgs" ? sdgBlock(d)
          : ev.kind === "issues" ? issuesBlock(d.filter((i) => i.severity === "error"))
          : ev.kind === "plan" ? planHolder(planId, d, p.weekly_learning_hours, meta?.status || "draft") : null;
        if (el) body.append(el);
      } else if (ev.t === "done") {
        st.end();
        if (ev.status === "flagged") body.append(h("p", { class: "note" }, "This draft is flagged. Edit the plan and save a new draft before approving."));
      } else if (ev.t === "error") { st.end(); body.append(h("div", { class: "issue error" }, ev.message)); }
    }, ctrl.signal);
  } catch (e) {
    st.end();
    if (e.name === "AbortError") { mood("idle", "Stopped"); body.append(h("p", { class: "note" }, "Stopped. Nothing was saved from this turn.")); }
    else if (e instanceof ApiError && e.status === 401) { location.replace("/"); }
    else { mood("confused", "Something went wrong"); body.append(h("div", { class: "issue error" }, e.message)); }
  } finally {
    setBusy(null);
  }
}

function planHolder(planId, plan, hours, status) {
  const holder = h("div");
  const render = async (st, version) => {
    holder.replaceChildren(planBlock({ planId, plan, version, status: st, weeklyHours: hours, onChange: async (next) => {
      const fresh = await api(`/api/plans/${planId}`);
      plan = fresh.plan;
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
    approved ? h("p", { class: "lede" }, "Your plan is approved. Follow the activities in each phase to put it into action.") : null,
    planBlock({ planId: id, plan: d.plan, version: d.version, status: d.status, weeklyHours: null,
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
  main.replaceChildren(h("a", { href: "#/plans", class: "btn ghost sm" }, icon("back"), "All plans"),
    h("h1", { class: "page-title", style: { "margin-top": "12px" } }, r?.occupation?.title || d.plan.target_role), blocks);
  if (focusPlan) planFocus.focus({ preventScroll: true });
}

boot().catch((e) => { app.replaceChildren(h("main", { class: "pub-main" }, h("div", { class: "issue error" }, `Could not start: ${e.message}`))); });
