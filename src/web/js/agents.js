// Agents: a gallery to find them, and a chat to use them (like GPTs / Claude projects), shared by the public app and
// the HR console. Chat agents answer from the person's own context on the server (agents/catalog.py); guided tools
// open their own screen. Conversations stay in this tab (sessionStorage), one per agent.
// Every agent is drawn as the owl companion, each in its own pose. The HR console also gets hrCapsule(): a floating
// bar to search everything, run console actions and ask the agents from any page.
import { api, h, icon, toast, ApiError, reveal, DROP } from "./lib.js";
import { Owl } from "./owl.js";
import { micButton, readAloudButton } from "./voice.js";

const POSE = { coach: "greeting", trends: "analyzing", interview: "listening", planner: "update", match: "matched",
  resume: "searching", team: "analyzing", hiring: "reminder", posts: "update", run: "searching" };
/** Decorative owl avatar (the agent's name is always printed beside it). */
const owl = (a, cls, size, state = POSE[a.id] || "idle") => {
  const o = new Owl({ size, state });
  o.el.classList.add(cls); o.el.removeAttribute("role"); o.el.setAttribute("aria-hidden", "true");
  return o;
};
const photo = (a, cls, size) => owl(a, cls, { "ag-card-img": 112, "ag-hero": 132, "ag-avatar": 36, "ag-dot": 28 }[cls] || size || 36).el;
const store = {
  get(id) { try { return JSON.parse(sessionStorage.getItem(`ap.agent.${id}`)) || []; } catch { return []; } },
  set(id, msgs) { try { sessionStorage.setItem(`ap.agent.${id}`, JSON.stringify(msgs.slice(-40))); } catch { /* private mode: this page only */ } },
};
let cache = null;
const load = async () => (cache ??= (await api("/api/agents")).agents);
const lastChat = { get: () => { try { return sessionStorage.getItem("ap.agent.last") || "coach"; } catch { return "coach"; } },
  set: (id) => { try { sessionStorage.setItem("ap.agent.last", id); } catch { /* private mode */ } } };

// ---------------------------------------------------------------- Chat | Interview pill (public app)
let pill = null;
/** One pill shared by the chat and the mock-interview pages, so its bubble slides between them. */
export function agentSwitch(mode) {
  if (!pill) {
    pill = h("nav", { class: "ag-pill", "aria-label": "Agent mode" }, h("span", { class: "ag-pill-thumb", "aria-hidden": "true" }),
      h("a", { "data-mode": "chat" }, icon("ask"), "Chat"), h("a", { "data-mode": "interview", href: "#/interview" }, icon("quiz"), "Interview"));
  }
  pill.querySelector('[data-mode="chat"]').href = `#/agents/${lastChat.get()}`;
  pill.querySelectorAll("a").forEach((a) => (a.dataset.mode === mode ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  // the caller inserts the pill first; reading its layout pins the old position so the move animates
  requestAnimationFrame(() => { void pill.offsetWidth; pill.dataset.at = mode; });
  return h("div", { class: "ag-modes" }, pill);
}

// ---------------------------------------------------------------- gallery
export async function agentsView(main) {
  const agents = await load();
  const q = h("input", { class: "input ag-search", type: "search", placeholder: "Search agents", "aria-label": "Search agents", autocomplete: "off" });
  const card = (a) => h("a", { class: `ag-card ${a.kind}`, href: a.kind === "chat" ? `#/agents/${a.id}` : a.href, "data-text": `${a.name} ${a.tagline}`.toLowerCase() },
    h("div", { class: "ag-card-stage" }, photo(a, "ag-card-img")),
    h("div", { class: "ag-card-body" }, h("h3", {}, a.name), h("p", {}, a.tagline),
      h("span", { class: "ag-card-go" }, a.kind === "chat" ? "Chat" : "Open", icon("flat"))));
  const chat = agents.filter((a) => a.kind === "chat"), flow = agents.filter((a) => a.kind === "flow");
  const none = h("p", { class: "muted", hidden: true }, "No agent matches. Try another word.");
  q.addEventListener("input", () => {
    const t = q.value.trim().toLowerCase();
    let shown = 0;
    main.querySelectorAll(".ag-card").forEach((c) => { c.hidden = !!t && !c.dataset.text.includes(t); shown += !c.hidden; });
    main.querySelectorAll(".ag-group").forEach((g) => { g.hidden = !g.querySelector(".ag-card:not([hidden])"); });
    none.hidden = shown > 0;
  });
  main.replaceChildren(h("div", { class: "ag-gallery" },
    h("div", { class: "ag-gallery-head" }, h("h1", { class: "page-title" }, "Agents"),
      h("p", { class: "lede" }, "Specialists for each part of your work. Chat with one, or open a guided tool."), q),
    chat.length ? h("section", { class: "ag-group", "aria-labelledby": "ag-chat" }, h("h2", { id: "ag-chat" }, "Chat with an agent"),
      h("div", { class: "ag-grid" }, chat.map(card))) : null,
    flow.length ? h("section", { class: "ag-group", "aria-labelledby": "ag-flow" }, h("h2", { id: "ag-flow" }, "Guided tools"),
      h("div", { class: "ag-grid" }, flow.map(card))) : null,
    none));
  // "/" jumps to search, like most app galleries
  const slash = (e) => { if (!main.contains(q)) { removeEventListener("keydown", slash); return; }
    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) { e.preventDefault(); q.focus(); } };
  addEventListener("keydown", slash);
}

// ---------------------------------------------------------------- one agent's chat
/** Safe, small Markdown for replies: paragraphs, - and 1. lists, **bold**, `code`. Never innerHTML. */
function rich(text) {
  const inline = (line) => line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part) =>
    part.startsWith("**") ? h("b", {}, part.slice(2, -2)) : part.startsWith("`") ? h("code", {}, part.slice(1, -1)) : part);
  const out = [];
  let list = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^([-*•]|\d+[.)])\s+(.*)$/);
    if (m) {
      const kind = /\d/.test(m[1]) ? "ol" : "ul";
      if (!list || list.tagName.toLowerCase() !== kind) out.push(list = h(kind, {}));
      list.append(h("li", {}, inline(m[2])));
      continue;
    }
    list = null;
    if (line) out.push(h("p", {}, inline(line.replace(/^#+\s*/, ""))));
  }
  return out;
}

export async function agentChatView(main, id, { getProfile } = {}) {
  const agents = await load();
  const agent = agents.find((a) => a.id === id && a.kind === "chat");
  if (!agent) { location.replace("#/agents"); return; }
  lastChat.set(id);
  const chats = agents.filter((a) => a.kind === "chat");
  let msgs = store.get(id), busy = false;

  const thread = h("div", { class: "ag-thread", "aria-live": "polite" });
  const input = h("textarea", { class: "ag-input", rows: 1, maxlength: 4000, placeholder: `Message ${agent.name}`, "aria-label": `Message ${agent.name}` });
  const send = h("button", { class: "btn primary ag-send", type: "submit", "aria-label": "Send" }, icon("send"));
  const grow = () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 220)}px`; };
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  const form = h("form", { class: "ag-composer", onsubmit: (e) => { e.preventDefault(); ask(input.value); } },
    input, h("div", { class: "ag-tools" }, micButton(input), send));

  const bubble = (m) => m.role === "user"
    ? h("div", { class: "ag-msg me" }, h("p", {}, m.content))
    : h("div", { class: "ag-msg them" }, photo(agent, "ag-avatar"),
      h("div", { class: "ag-reply" }, rich(m.content), h("div", { class: "ag-reply-tools" }, readAloudButton(() => m.content),
        h("button", { class: "btn ghost sm", type: "button", onclick: () => navigator.clipboard?.writeText(m.content).then(() => toast("Copied")) }, "Copy"))));
  const empty = () => h("div", { class: "ag-empty" },
    photo(agent, "ag-hero", "lg"),
    h("h1", {}, agent.name), h("p", { class: "muted" }, agent.tagline),
    h("div", { class: "ag-starters" }, (agent.starters || []).map((s) => h("button", { class: "ag-starter", type: "button", onclick: () => ask(s) }, s))),
    agent.action ? h("a", { class: "btn ag-action", href: agent.action.href }, agent.action.label, icon("flat")) : null);
  const drawn = new WeakMap();  // one element (and one owl) per message, not per redraw
  const draw = () => {
    thread.replaceChildren(...(msgs.length ? msgs.map((m) => drawn.get(m) || drawn.set(m, bubble(m)).get(m)) : [empty()]));
    if (msgs.length) thread.lastElementChild?.scrollIntoView({ block: "end" });
  };

  async function ask(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true; send.disabled = true;
    msgs.push({ role: "user", content: text }); store.set(id, msgs);
    input.value = ""; grow(); draw();
    const typing = h("div", { class: "ag-msg them" }, owl(agent, "ag-avatar", 36, "thinking").el, h("div", { class: "ag-typing", "aria-label": `${agent.name} is writing` }, h("i"), h("i"), h("i")));
    thread.append(typing); typing.scrollIntoView({ block: "end" });
    try {
      const r = await api(`/api/agents/${id}/chat`, { method: "POST", body: { messages: msgs.slice(-24), profile: getProfile?.() || null } });
      msgs.push({ role: "assistant", content: r.reply }); store.set(id, msgs); draw();
    } catch (e) {
      typing.remove();
      msgs.pop(); store.set(id, msgs);  // not answered: put the question back to send again
      input.value = text; grow();
      thread.append(h("div", { class: "ag-error", role: "alert" }, e.message,
        e instanceof ApiError && e.status === 402 ? [" ", h("a", { href: "./#/pricing" }, "See plans")] : null));
    }
    busy = false; send.disabled = false; input.focus();
  }

  const side = h("nav", { class: "ag-side", "aria-label": "Agents" },
    h("button", { class: "btn ag-new", type: "button", onclick: () => { msgs = []; store.set(id, msgs); draw(); input.focus(); } }, icon("edit"), "New chat"),
    h("ul", {}, chats.map((a) => h("li", {}, h("a", { href: `#/agents/${a.id}`, "aria-current": a.id === id ? "page" : null }, photo(a, "ag-dot"), a.name)))),
    h("a", { class: "ag-all", href: "#/agents" }, icon("grid"), "All agents"));
  const switcher = h("select", { class: "input ag-switch", "aria-label": "Switch agent", onchange: (e) => { location.hash = `#/agents/${e.target.value}`; } },
    chats.map((a) => h("option", { value: a.id, selected: a.id === id }, a.name)));
  const modes = chats.some((a) => a.id === "interview") ? agentSwitch("chat") : null;  // individuals also have the mock interview
  main.replaceChildren(...[modes, h("div", { class: "ag" }, side,
    h("section", { class: "ag-main", "aria-label": agent.name },
      h("header", { class: "ag-head" }, switcher, msgs.length ? h("span", { class: "ag-head-name" }, photo(agent, "ag-dot"), agent.name) : null),
      thread, form))].filter(Boolean));
  draw();
  input.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- HR: floating agent capsule
const HR_ASK = [[/\b(post|linkedin|facebook|telegram|tweet|whatsapp)\b/i, "posts"],
  [/\b(hir\w*|opening|applicant|candidate|requirement|screen\w*|recruit\w*)\b/i, "hiring"]];
const askable = (q) => q.split(/\s+/).length >= 3 || /\?$|^(who|what|which|how|why|when|where|is|are|can|should|draft|write|summari[sz]e|list|compare)\b/i.test(q);

/** Search pages, plans, openings and agents; run console actions; or ask the right agent, from any page.
 *  pages: [{label, href, icon, words}] and actions: [{label, icon, words, run}] from the console;
 *  plans(): its plan list; status: the top-bar owl, kept in step. */
export function hrCapsule({ pages, actions, plans, status }) {
  const bird = new Owl({ size: 30, state: "idle" });
  bird.el.setAttribute("aria-hidden", "true"); bird.el.removeAttribute("role");
  const q = h("input", { class: "cap-input", type: "search", placeholder: "Ask the agents or search…", autocomplete: "off", maxlength: 500,
    role: "combobox", "aria-expanded": "false", "aria-controls": "cap-list", "aria-label": "Ask the agents, search, or run an action" });
  const list = h("ul", { id: "cap-list", class: "cap-list", role: "listbox", "aria-label": "Results" });
  const answer = h("div", { class: "cap-answer", "aria-live": "polite", hidden: true });
  const panel = h("div", { class: "cap-panel" }, answer, list);
  const form = h("form", { class: "cap-bar", onsubmit: (e) => { e.preventDefault(); pick(sel); } },
    bird.el, q, micButton(q), h("kbd", { class: "cap-kbd", "aria-hidden": "true" }, /Mac/.test(navigator.platform) ? "⌘K" : "Ctrl K"));
  const el = h("div", { class: "hr-capsule" }, panel, form);
  let items = [], sel = 0, openings = null, agents = [], busy = false;

  const index = () => [
    ...actions.map((a) => ({ ...a, kind: "Action" })),
    ...pages.map((p) => ({ ...p, kind: "Go to" })),
    ...agents.filter((a) => a.kind === "chat").map((a) => ({ label: a.name, sub: a.tagline, href: `#/agents/${a.id}`, icon: "ask", kind: "Agent" })),
    ...plans().filter((p) => p.audience === "hr" && !p.review?.archived).map((p) => ({ label: `${p.subject_id} · ${p.target_role}`,
      sub: `${p.plan_reference || ""} ${p.review?.candidate_name || ""} · ${p.status}`.trim(), href: `#/review/${p.plan_id}`, icon: "review", kind: "Plan" })),
    ...(openings || []).map((o) => ({ label: o.title, sub: `${o.status} · ${o.applications} applications`, href: `#/openings/${o.id}`, icon: "people", kind: "Opening" })),
  ];
  const draw = () => {
    const t = q.value.trim(), words = t.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = words.length ? index().filter((it) => words.every((w) => `${it.kind} ${it.label} ${it.sub || ""} ${it.words || ""}`.toLowerCase().includes(w))).slice(0, 7) : [];
    const ask = t.length >= 3 ? [{ ask: t, label: `Ask the agents: “${t}”`, icon: "spark", kind: "Ask" }] : [];
    items = askable(t) || !hits.length ? [...ask, ...hits] : [...hits, ...ask];
    sel = 0;
    list.replaceChildren(...items.map((it, i) => h("li", { id: `cap-${i}`, role: "option", class: "cap-item", "aria-selected": String(i === sel),
      onpointerdown: (e) => e.preventDefault(), onclick: () => pick(i), onpointermove: () => mark(i) },
      icon(it.icon), h("span", { class: "cap-label" }, it.label, it.sub ? h("small", {}, it.sub) : null), h("span", { class: "cap-kind" }, it.kind))));
    q.setAttribute("aria-expanded", String(!!items.length));
    q.setAttribute("aria-activedescendant", items.length ? "cap-0" : "");
    el.classList.toggle("open", !!items.length || !answer.hidden);
  };
  const mark = (i) => {
    sel = (i + items.length) % items.length;
    list.querySelectorAll(".cap-item").forEach((li, k) => li.setAttribute("aria-selected", String(k === sel)));
    q.setAttribute("aria-activedescendant", `cap-${sel}`);
    list.children[sel]?.scrollIntoView({ block: "nearest" });
  };
  const close = () => { q.value = ""; answer.hidden = true; draw(); q.blur(); };
  function pick(i) {
    const it = items[i];
    if (!it) return;
    if (it.ask) { ask(it.ask); return; }
    close();
    if (it.run) it.run(); else location.hash = it.href;
  }

  async function ask(text) {
    if (busy) return;
    const id = (HR_ASK.find(([re]) => re.test(text)) || [, "team"])[1];
    const agent = agents.find((a) => a.id === id) || { id, name: "Team Analyst" };
    busy = true; q.value = ""; list.replaceChildren(); bird.set("thinking"); status?.set("thinking", `${agent.name} is working`);
    answer.hidden = false; el.classList.add("open");
    answer.replaceChildren(h("p", { class: "cap-q" }, text), h("div", { class: "cap-who" }, owl(agent, "ag-dot", 24, "thinking").el, `${agent.name} is writing…`));
    const msgs = [...store.get(id), { role: "user", content: text }];  // the same thread as that agent's chat page
    try {
      const r = await api(`/api/agents/${id}/chat`, { method: "POST", body: { messages: msgs.slice(-24) } });
      msgs.push({ role: "assistant", content: r.reply }); store.set(id, msgs);
      // employee ids in the answer open their plan: the agent's answer becomes a way to drive the console
      const ids = [...new Set(r.reply.match(/\b[A-Z]{1,4}-\d{1,9}\b/g) || [])].map((sid) => plans().find((p) => p.subject_id === sid && p.audience === "hr")).filter(Boolean);
      answer.replaceChildren(h("p", { class: "cap-q" }, text),
        h("div", { class: "cap-who" }, owl(agent, "ag-dot", 24).el, agent.name),
        h("div", { class: "ag-reply cap-reply" }, rich(r.reply)),
        h("div", { class: "cap-tools" }, ids.slice(0, 6).map((p) => h("a", { class: "btn sm", href: `#/review/${p.plan_id}`, onclick: close }, icon("review"), p.subject_id)),
          readAloudButton(() => r.reply), h("a", { class: "btn sm ghost", href: `#/agents/${id}`, onclick: close }, "Continue in chat", icon("flat"))));
      bird.set("matched"); status?.set("matched", `${agent.name} answered`);
    } catch (e) {
      answer.replaceChildren(h("p", { class: "cap-q" }, text), h("div", { class: "ag-error", role: "alert" }, e.message,
        e instanceof ApiError && e.status === 402 ? [" ", h("a", { href: "./#/pricing" }, "See plans")] : null));
      q.value = text; bird.set("confused"); status?.set("confused", "No answer");
    }
    reveal(answer, DROP);
    busy = false; q.focus();
  }

  q.addEventListener("input", draw);
  q.addEventListener("focus", () => {
    el.classList.add("focus");
    load().then((a) => { agents = a; }).catch(() => {});
    if (!openings) api("/api/openings").then((o) => { openings = o; if (q.value) draw(); }).catch(() => { openings = []; });
    draw();
  });
  q.addEventListener("blur", () => el.classList.remove("focus"));
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (items.length) mark(sel + (e.key === "ArrowDown" ? 1 : -1)); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
      if (el.hidden || e.target.closest?.("dialog")) return;
      e.preventDefault(); q.focus(); q.select();
    }
  });
  addEventListener("pointerdown", (e) => { if (!el.contains(e.target) && !answer.hidden && !busy) { answer.hidden = true; draw(); } });
  return el;
}
