// AiversePulse (public users): sign-in, plan builder, chat-style streaming report, plans.
import { api, stream, h, $, icon, toast, ApiError, reveal, RISE, DROP, GROW } from "./lib.js";
import { Owl, OwlStatus } from "./owl.js";
import { StreamText, gapsBlock, comparisonBlock, forecastBlock, issuesBlock, planBlock, historyBlock,
  sourceItem, staticText } from "./blocks.js";

const app = $("#app");
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: in-memory only */ } },
};
const S = {
  me: null, meta: null, status: null, sheet: null, sources: null, evidence: new Map(), busy: null,
  profile: store.get("ap.profile", { target_role: "Data Analyst", scenario: "assistive", weekly_learning_hours: 6,
    skills: [{ name: "python", level: 3 }, { name: "sql", level: 2 }], forecast: true }),
  thread: [],
};
const saveProfile = () => store.set("ap.profile", S.profile);

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
  const specimen = h("table", { class: "specimen", "aria-label": "Top skills in 2023 Data Analyst job ads" });
  app.replaceChildren(h("main", { class: "signin" },
    h("section", { class: "signin-story" },
      owl.el,
      h("h1", {}, "Know which skills the job market actually asks for."),
      h("p", { class: "lede" }, "Free, evidence-based 90-day learning plans. Every claim links to its source: 2023 job ads and the O*NET 31.0 occupational database."),
      specimen),
    h("form", { class: "signin-form", onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; err.textContent = "";
      try {
        const me = await api("/api/login", { method: "POST", body: { username: user.value, password: pass.value } });
        location.replace(me.role === "employee" ? "/#/build" : "/enterprise");
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
    const max = Math.max(...sp.skills.map(([, v]) => v));
    specimen.append(h("caption", { class: "sr-only" }, sp.source),
      h("tbody", {}, sp.skills.map(([k, v], i) => h("tr", {},
        h("td", {}, k), h("td", { class: "num" }, `${v.toFixed(1)}%`),
        h("td", { style: { width: "55%" } }, reveal(h("div", { class: "bar", style: { width: `${(v / max) * 100}%`, "transform-origin": "left" } }), GROW, { duration: 900, delay: i * 90 }))))));
    specimen.after(h("p", { class: "muted", style: { "font-size": "13px" } }, `Share of ${sp.postings} deduplicated Data Analyst postings, 2023 (data_jobs).`));
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
      h("a", { class: "wordmark", href: "#/build" }, "AiversePulse"),
      h("nav", { class: "pub-nav", "aria-label": "Primary" }, nav("#/build", "Build plan"), nav("#/report", "Report"), nav("#/plans", "My plans")),
      S.status.el,
      h("button", { class: "btn sm signout", onclick: signOut }, "Sign out")),
    h("main", { id: "main", class: "pub-main", tabindex: "-1" }),
    h("nav", { class: "tabbar", "aria-label": "Primary" }, tab("#/build", "Build", "build"), tab("#/report", "Report", "report"), tab("#/plans", "Plans", "plans")),
    S.sheet);
}

async function signOut() {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  location.replace("/");
}

function route() {
  const hash = location.hash || "#/build";
  const [, page, id] = hash.split("/");
  document.querySelectorAll("[data-route]").forEach((a) => {
    if (hash.startsWith(a.dataset.route)) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const main = $("#main");
  const go = () => {
    if (page === "report") reportView(main);
    else if (page === "plans" && id) planDetail(main, id);
    else if (page === "plans") plansView(main);
    else buildView(main);
  };
  document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches ? document.startViewTransition(go) : go();
  scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- build
function buildView(main) {
  const p = S.profile;
  const known = new Set(S.meta.skills);
  const rows = h("div", { class: "skill-rows" });
  const steps = ["Target role", "Your skills", "Time", "AI scenario"].map((t) => h("li", { "data-done": "true" }, t));
  const levelSeg = (sk) => h("div", { class: "seg levels", role: "group", "aria-label": `${sk.name} proficiency, 0 to 5` },
    [0, 1, 2, 3, 4, 5].map((n) => h("button", { type: "button", "aria-pressed": String(sk.level === n), "aria-label": `level ${n}`,
      onclick: (e) => { sk.level = n; saveProfile(); e.currentTarget.parentElement.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === n))); } }, n)));
  const drawRows = () => {
    rows.replaceChildren(...p.skills.map((sk, i) => h("div", { class: "skill-row" },
      h("span", { class: "name" }, sk.name, known.has(sk.name) ? null : h("span", { class: "muted", style: { "font-weight": 400 } }, " · not in job-ad data")),
      levelSeg(sk),
      h("button", { class: "btn ghost sm", type: "button", "aria-label": `Remove ${sk.name}`, onclick: () => { p.skills.splice(i, 1); saveProfile(); drawRows(); drawSuggest(); } }, "×"))));
    steps[1].dataset.done = String(p.skills.length > 0);
  };
  const add = h("input", { class: "input", list: "skill-list", placeholder: "Add a skill, e.g. tableau", maxlength: 60, "aria-label": "Add a skill",
    onfocus: () => S.status.set("listening", "Listening"),
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(add.value); } } });
  const addSkill = (name) => {
    name = name.trim().toLowerCase();
    if (!name || p.skills.some((s) => s.name === name) || p.skills.length >= 40) return;
    p.skills.push({ name, level: 1 }); saveProfile(); add.value = ""; drawRows(); drawSuggest();
  };
  const suggest = h("div", { class: "suggest", "aria-label": "Suggested skills" });
  const drawSuggest = () => suggest.replaceChildren(...["excel", "sql", "python", "tableau", "power bi", "r", "aws", "spark"]
    .filter((k) => !p.skills.some((s) => s.name === k)).slice(0, 6)
    .map((k) => h("button", { class: "chip", type: "button", onclick: () => addSkill(k) }, "+ ", k)));
  const hoursIn = h("input", { type: "number", min: "0.5", max: "80", step: "0.5", value: p.weekly_learning_hours, "aria-label": "Hours per week",
    onchange: () => { p.weekly_learning_hours = Math.min(80, Math.max(0.5, Number(hoursIn.value) || 6)); hoursIn.value = p.weekly_learning_hours; saveProfile(); } });
  const bump = (d) => { hoursIn.value = Math.min(80, Math.max(0.5, Number(hoursIn.value) + d)); hoursIn.dispatchEvent(new Event("change")); };
  const role = h("select", { class: "input", "aria-label": "Target role", onchange: (e) => { p.target_role = e.target.value; saveProfile(); } },
    S.meta.roles.map((r) => h("option", { value: r, selected: r === p.target_role ? true : null }, r)));
  const scen = (key, title, note) => h("label", {},
    h("input", { type: "radio", name: "scenario", value: key, checked: p.scenario === key ? true : null, onchange: () => { p.scenario = key; saveProfile(); } }),
    h("b", {}, title), h("span", { class: "muted" }, note));
  const fc = h("input", { type: "checkbox", checked: p.forecast ? true : null, onchange: (e) => { p.forecast = e.target.checked; saveProfile(); } });

  main.replaceChildren(
    h("h1", { class: "page-title" }, "Build your plan"),
    h("p", { class: "lede" }, "Four short answers. The agents compare them with 2023 job ads and O*NET, then write a plan you can edit and approve."),
    h("div", { class: "build" },
      h("ol", { class: "steps", "aria-label": "Steps" }, steps),
      h("form", { onsubmit: (e) => { e.preventDefault(); start(); } },
        h("section", { class: "form-section" }, h("h2", {}, "Target role"), role),
        h("section", { class: "form-section" }, h("h2", {}, "Your skills"),
          h("p", { class: "muted" }, "0 = never used it, 5 = could teach it."), rows,
          h("div", { class: "add-skill" }, add, h("button", { class: "btn", type: "button", onclick: () => addSkill(add.value) }, "Add")),
          h("datalist", { id: "skill-list" }, S.meta.skills.map((k) => h("option", { value: k }))), suggest),
        h("section", { class: "form-section" }, h("h2", {}, "Time you can give each week"),
          h("div", { class: "hours" }, h("div", { class: "stepper" },
            h("button", { type: "button", "aria-label": "Fewer hours", onclick: () => bump(-1) }, "−"), hoursIn,
            h("button", { type: "button", "aria-label": "More hours", onclick: () => bump(1) }, "+")), h("span", { class: "muted" }, "hours / week"))),
        h("section", { class: "form-section" }, h("h2", {}, "How will AI change this job?"),
          h("div", { class: "scenario" },
            scen("assistive", "Assistive AI", "AI helps you do today's work. Required levels follow 2023 job ads."),
            scen("agentic", "Agentic AI", "AI agents take over routine tool work. Automation skills weigh more; this is a stated assumption.")),
          h("label", { class: "check" }, fc, "Include an experimental demand forecast (2023 backtest)")),
        h("div", { class: "build-actions" }, h("button", { class: "btn primary", type: "submit" }, "Analyse my skills", icon("send"))))));
  drawRows(); drawSuggest();
  S.status.set("idle", "Ready when you are");
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
        quick("Show demand forecast", () => rerun({ forecast: true })),
        quick("I have more time: 10 h/week", () => rerun({ weekly_learning_hours: 10 })),
        quick("Edit my skills", () => { location.hash = "#/build"; })),
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
      h("p", { class: "muted" }, "Build a plan first: tell us your target role, skills and time, and the agents will write your briefing here."),
      h("a", { class: "btn primary", href: "#/build" }, "Build my plan")));
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
  if (/forecast|trend|demand/i.test(q)) S.profile.forecast = true;
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
  const label = p.query || `Plan for ${p.target_role}`;
  S.thread.push(p);
  const userTurn = h("div", { class: "turn-user" }, h("p", { class: "q" }, label),
    h("div", { class: "meta" }, [p.target_role, p.scenario === "agentic" ? "Agentic AI" : "Assistive AI", `${p.weekly_learning_hours} h/week`,
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
      skills: p.skills, forecast: !!p.forecast, ...(p.query ? { query: p.query } : {}),
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
          : ev.kind === "forecast" ? forecastBlock(d) : ev.kind === "issues" ? issuesBlock(d.filter((i) => i.severity === "error" || i.code === "deferred"))
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
      if (next === "approved") S.status.set("celebrating", "Plan approved — it's yours");
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
      h("p", {}, "No plans yet. Build your first one in about two minutes."), h("a", { class: "btn primary", href: "#/build" }, "Build my plan")));
    return;
  }
  main.append(h("div", { class: "plan-list", style: { "margin-top": "28px" } }, list.map((pl) => h("a", { class: "plan-item", href: `#/plans/${pl.plan_id}`, style: { color: "inherit", "text-decoration": "none" } },
    h("div", {}, h("div", { class: "t" }, pl.target_role || "Plan", pl.audience === "hr" ? h("span", { class: "muted" }, " · from HR") : null),
      h("div", { class: "m" }, `${pl.scenario || ""} · v${pl.version} · ${new Date(pl.created_utc).toLocaleDateString()}`)),
    h("span", { class: `tag ${pl.status}` }, pl.status)))));
}

async function planDetail(main, id) {
  main.replaceChildren(h("p", { class: "muted" }, "Loading…"));
  let d;
  try { d = await api(`/api/plans/${id}`); } catch (e) { main.replaceChildren(h("div", { class: "issue error" }, e.message)); return; }
  const r = d.report;
  if (r) setSources(r.evidence || []);
  const blocks = h("div", { class: "body", style: { "max-width": "760px" } },
    r?.narrative ? staticText(r.narrative, highlight) : null,
    r?.gaps?.length ? gapsBlock(r.gaps) : null,
    planBlock({ planId: id, plan: d.plan, version: d.version, status: d.status, weeklyHours: null,
      onChange: () => planDetail(main, id) }),
    d.audience === "hr" && d.status === "approved" ? h("div", { class: "approve-bar" }, h("span", {}, "HR approved this plan for you."),
      h("button", { class: "btn primary", onclick: async () => { await api(`/api/plans/${id}/acknowledge`, { method: "POST" }); toast("Acknowledged"); planDetail(main, id); } }, "Acknowledge")) : null,
    h("section", { class: "block" }, h("h3", {}, "History"), historyBlock(d.history)));
  main.replaceChildren(h("a", { href: "#/plans", class: "btn ghost sm" }, icon("back"), "All plans"),
    h("h1", { class: "page-title", style: { "margin-top": "12px" } }, d.plan.target_role), blocks);
}

boot().catch((e) => { app.replaceChildren(h("main", { class: "pub-main" }, h("div", { class: "issue error" }, `Could not start: ${e.message}`))); });
