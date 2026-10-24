// The agent: one chat people talk to, shared by the public app and the HR console. Each message is handed to the
// right specialist on the server (agents/catalog.py route: coach, trends, interview / team, hiring, posts), which
// answers from the person's own context; the reply is labelled with who answered and drawn as the owl companion in
// that specialist's pose. The conversation stays in this tab (sessionStorage). The HR console also gets hrCapsule():
// a folded owl button that opens a bar to search everything, run console actions and ask the agent from any page.
import { api, h, icon, toast, ApiError, reveal, DROP } from "./lib.js";
import { Owl } from "./owl.js";
import { micButton, readAloudButton } from "./voice.js";

const POSE = { coach: "greeting", trends: "analyzing", interview: "listening", team: "analyzing", hiring: "reminder", posts: "update" };
/** Decorative owl avatar (the specialist's name is always printed beside it). */
const owl = (id, size, state = POSE[id] || "idle") => {
  const o = new Owl({ size, state });
  o.el.removeAttribute("role"); o.el.setAttribute("aria-hidden", "true");
  return o;
};
const store = {
  get() { try { return JSON.parse(sessionStorage.getItem("ap.agent.auto")) || []; } catch { return []; } },
  set(msgs) { try { sessionStorage.setItem("ap.agent.auto", JSON.stringify(msgs.slice(-40))); } catch { /* private mode: this page only */ } },
};
let cache = null;
const load = async () => (cache ??= (await api("/api/agents")).agents);
const say = (msgs, profile) => api("/api/agents/auto/chat", { method: "POST",
  body: { messages: msgs.slice(-24).map(({ role, content }) => ({ role, content })), profile } });

/** An action the agent proposes (post an opening to connected accounts). Nothing is sent until the advisor clicks
 * Post, which calls the same publish endpoint as the Hiring page; the outcome is kept with the message. */
function actionCard(m, save) {
  const p = m.proposal;
  if (!p) return m.link ? h("a", { class: "btn sm", href: m.link.href }, m.link.label, icon("flat")) : null;
  const box = h("div", { class: "ag-action" });
  const draw = () => {
    if (p.results) {
      box.replaceChildren(...p.results.map((r) => h("p", { class: `ag-result ${r.status}` }, h("b", {}, `${r.platform_name} · ${r.label}: `),
        r.status === "posted" ? (r.url ? h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, "posted") : "posted") : r.error || "failed")));
      return;
    }
    if (p.cancelled) { box.replaceChildren(h("p", { class: "muted" }, "Cancelled. Nothing was posted.")); return; }
    const where = p.connections.length === 1 ? p.connections[0].platform_name : `${p.connections.length} accounts`;
    const go = h("button", { class: "btn primary sm", type: "button", onclick: async () => {
      go.disabled = true; go.textContent = "Posting…";
      try {
        p.results = (await api(`/api/openings/${p.opening.id}/publish`, { method: "POST", body: { connections: p.connections.map((c) => c.id) } })).results;
        save(); draw();
      } catch (e) { go.disabled = false; go.textContent = `Post to ${where}`; toast(e.message, "err"); }
    } }, `Post to ${where}`);
    box.replaceChildren(h("div", { class: "ag-action-what" }, h("b", {}, p.opening.title),
      h("span", { class: "muted" }, p.connections.map((c) => `${c.platform_name} · ${c.label}`).join(", "))),
      h("div", { class: "ag-action-btns" }, go, h("button", { class: "btn ghost sm", type: "button", onclick: () => { p.cancelled = true; save(); draw(); } }, "Cancel")));
  };
  draw();
  return box;
}

// ---------------------------------------------------------------- Chat | Interview pill (public app)
let pill = null;
let disposeSwitch = null;
/** Stop the one active switcher observer when its route is replaced. */
export function disposeAgentSwitch() { disposeSwitch?.(); disposeSwitch = null; }
/** One pill shared by the chat and the mock-interview pages, so its bubble slides between them. */
export function agentSwitch(mode) {
  pill ??= h("nav", { class: "ag-pill", "aria-label": "Agent mode" }, h("span", { class: "ag-pill-thumb", "aria-hidden": "true" }),
    h("a", { "data-mode": "chat", href: "#/agents", "aria-label": "Chat", title: "Chat" }, icon("ask"), h("span", { class: "ag-pill-label" }, "Chat")),
    h("a", { "data-mode": "interview", href: "#/interview", "aria-label": "Interview", title: "Interview" }, icon("quiz"), h("span", { class: "ag-pill-label" }, "Interview")));
  pill.querySelectorAll("a").forEach((a) => (a.dataset.mode === mode ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  // the caller inserts the pill first; reading its layout pins the old position so the move animates
  requestAnimationFrame(() => { void pill.offsetWidth; pill.dataset.at = mode; });
  disposeAgentSwitch();
  const sentinel = h("span", { class: "ag-switch-sentinel", "aria-hidden": "true" });
  const sticky = h("div", { class: "agent-switcher-wrapper" }, h("div", { class: "ag-modes" }, pill));
  const slot = h("div", { class: "ag-switch-slot" }, sentinel, sticky);
  const main = document.querySelector("#main");
  let observer = null, resize = null, fallbackScroll = null, active = true;
  const setScrolled = (value) => sticky.classList.toggle("is-scrolled", value);
  const clearScrollObserver = () => {
    observer?.disconnect(); observer = null;
    if (fallbackScroll) { removeEventListener("scroll", fallbackScroll); fallbackScroll = null; }
  };
  const measure = () => {
    if (!active) return;
    const nav = document.querySelector(".pub-top");
    const css = nav && getComputedStyle(nav);
    const stickyTop = (parseFloat(css?.top) || 0) + (nav?.getBoundingClientRect().height || 0) + 8;
    sticky.style.setProperty("--agent-switch-top", `${stickyTop}px`);
    clearScrollObserver();
    if (window.IntersectionObserver) {
      observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting), {
        rootMargin: `-${stickyTop}px 0px 0px 0px`, threshold: 0,
      });
      observer.observe(sentinel);
    } else {
      fallbackScroll = () => setScrolled(sentinel.getBoundingClientRect().top < stickyTop);
      addEventListener("scroll", fallbackScroll, { passive: true });
      fallbackScroll();
    }
  };
  measure();
  const nav = document.querySelector(".pub-top");
  if (nav && window.ResizeObserver) {
    resize = new ResizeObserver(measure);
    resize.observe(nav);
  }
  addEventListener("resize", measure);
  const onMainChange = new MutationObserver(() => { if (active && !slot.isConnected) cleanup(); });
  if (main) onMainChange.observe(main, { childList: true });
  function cleanup() {
    if (!active) return;
    active = false;
    clearScrollObserver();
    resize?.disconnect(); resize = null;
    onMainChange.disconnect();
    removeEventListener("resize", measure);
    sticky.classList.remove("is-scrolled");
    if (disposeSwitch === cleanup) disposeSwitch = null;
  }
  disposeSwitch = cleanup;
  return slot;
}

// ---------------------------------------------------------------- the chat
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

export async function agentView(main, { getProfile } = {}) {
  const agents = await load();
  const chats = agents.filter((a) => a.kind === "chat"), tools = agents.filter((a) => a.kind === "flow");
  const action = (id) => agents.find((a) => a.id === id)?.action;
  let msgs = store.get(), busy = false;

  const thread = h("div", { class: "ag-thread", "aria-live": "polite" });
  const input = h("textarea", { class: "ag-input", rows: 1, maxlength: 4000, placeholder: "Ask anything", "aria-label": "Message the agent" });
  const send = h("button", { class: "btn primary ag-send", type: "submit", "aria-label": "Send" }, icon("send"));
  const grow = () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 220)}px`; };
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  const form = h("form", { class: "ag-composer", onsubmit: (e) => { e.preventDefault(); ask(input.value); } },
    input, h("div", { class: "ag-tools" }, micButton(input), send));

  const bubble = (m) => {
    if (m.role === "user") return h("div", { class: "ag-msg me" }, h("p", {}, m.content));
    const next = action(m.agent?.id);  // e.g. the interview coach offers the voice mock interview
    return h("div", { class: "ag-msg them" }, owl(m.agent?.id, 36).el,
      h("div", { class: "ag-reply" }, m.agent ? h("span", { class: "ag-by" }, m.agent.name) : null, rich(m.content), actionCard(m, () => store.set(msgs)),
        h("div", { class: "ag-reply-tools" }, readAloudButton(() => m.content),
          h("button", { class: "btn ghost sm", type: "button", onclick: () => navigator.clipboard?.writeText(m.content).then(() => toast("Copied")) }, "Copy"),
          next ? h("a", { class: "btn sm", href: next.href }, next.label, icon("flat")) : null)));
  };
  // a starter from every specialist shows what the one chat can do; guided tools open their own screen
  const empty = () => h("div", { class: "ag-empty" }, owl("coach", 132).el,
    h("h1", {}, "How can I help?"),
    h("p", { class: "muted" }, chats.map((a) => a.name).join(" · ")),
    h("div", { class: "ag-starters" }, chats.map((a) => a.starters?.[0]).filter(Boolean).map((t) => h("button", { class: "ag-starter", type: "button", onclick: () => ask(t) }, t))),
    tools.length ? h("div", { class: "ag-flows" }, tools.map((t) => h("a", { class: "btn sm", href: t.href, title: t.tagline }, t.name, icon("flat")))) : null);
  const drawn = new WeakMap();  // one element (and one owl) per message, not per redraw
  const draw = () => {
    thread.replaceChildren(...(msgs.length ? msgs.map((m) => drawn.get(m) || drawn.set(m, bubble(m)).get(m)) : [empty()]));
    if (msgs.length) thread.lastElementChild?.scrollIntoView({ block: "end" });
  };

  async function ask(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true; send.disabled = true;
    msgs.push({ role: "user", content: text }); store.set(msgs);
    input.value = ""; grow(); draw();
    const typing = h("div", { class: "ag-msg them" }, owl(null, 36, "thinking").el, h("div", { class: "ag-typing", "aria-label": "The agent is writing" }, h("i"), h("i"), h("i")));
    thread.append(typing); typing.scrollIntoView({ block: "end" });
    try {
      const r = await say(msgs, getProfile?.() || null);
      msgs.push({ role: "assistant", content: r.reply, agent: r.agent, proposal: r.proposal, link: r.link }); store.set(msgs); draw();
    } catch (e) {
      typing.remove();
      msgs.pop(); store.set(msgs);  // not answered: put the question back to send again
      input.value = text; grow();
      thread.append(h("div", { class: "ag-error", role: "alert" }, e.message,
        e instanceof ApiError && e.status === 402 ? [" ", h("a", { href: "./#/pricing" }, "See plans")] : null));
    }
    busy = false; send.disabled = false; input.focus();
  }

  const modes = chats.some((a) => a.id === "interview") ? agentSwitch("chat") : null;  // individuals also have the mock interview
  main.replaceChildren(...[modes, h("section", { class: "ag-main", "aria-label": "Agent" },
    h("header", { class: "ag-head" }, h("button", { class: "btn sm", type: "button", onclick: () => { msgs = []; store.set(msgs); draw(); input.focus(); } }, icon("edit"), "New chat")),
    thread, form)].filter(Boolean));
  draw();
  input.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- HR: floating agent capsule
const askable = (q) => q.split(/\s+/).length >= 3 || /\?$|^(who|what|which|how|why|when|where|is|are|can|should|draft|write|summari[sz]e|list|compare)\b/i.test(q);

/** Folded to an owl button; opened (click, Ctrl/Cmd+K or /) it searches pages, plans and openings, runs console actions,
 *  or asks the agent, from any page. pages: [{label, href, icon, words}] and actions: [{label, icon, words, run}] from
 *  the console; plans(): its plan list; status: the top-bar owl, kept in step. */
function floatingCapsule({ pages = [], actions = [], plans = () => [], status, getProfile = null, employeeMode = false }) {
  const bird = owl(null, 30);
  const fab = h("button", { class: "cap-fab", type: "button", "aria-label": "Open the agent (Ctrl K)", "aria-expanded": "false",
    onclick: () => (el.classList.contains("folded") ? unfold() : fold()) }, bird.el);
  const q = h("input", { class: "cap-input", type: "search", placeholder: "Ask the agent or search…", autocomplete: "off", maxlength: 500,
    role: "combobox", "aria-expanded": "false", "aria-controls": "cap-list", "aria-label": "Ask the agent, search, or run an action" });
  const list = h("ul", { id: "cap-list", class: "cap-list", role: "listbox", "aria-label": "Results" });
  const answer = h("div", { class: "cap-answer", "aria-live": "polite", hidden: true });
  const panel = h("div", { class: "cap-panel" }, answer, list);
  const form = h("form", { class: "cap-bar", onsubmit: (e) => { e.preventDefault(); pick(sel); } },
    fab, q, micButton(q), h("kbd", { class: "cap-kbd", "aria-hidden": "true" }, /Mac/.test(navigator.platform) ? "⌘K" : "Ctrl K"));
  const el = h("div", { class: "hr-capsule folded" }, panel, form);
  let items = [], sel = 0, openings = null, busy = false;

  const index = () => [
    ...actions.map((a) => ({ ...a, kind: "Action" })),
    ...pages.map((p) => ({ ...p, kind: "Go to" })),
    ...plans().filter((p) => !employeeMode && p.audience === "hr" && !p.review?.archived).map((p) => ({ label: `${p.subject_id} · ${p.target_role}`,
      sub: `${p.plan_reference || ""} ${p.review?.candidate_name || ""} · ${p.status}`.trim(), href: `#/review/${p.plan_id}`, icon: "review", kind: "Plan" })),
    ...(!employeeMode ? (openings || []).map((o) => ({ label: o.title, sub: `${o.status} · ${o.applications} applications`, href: `#/openings/${o.id}`, icon: "people", kind: "Opening" })) : []),
  ];
  const draw = () => {
    const t = q.value.trim(), words = t.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = words.length ? index().filter((it) => words.every((w) => `${it.kind} ${it.label} ${it.sub || ""} ${it.words || ""}`.toLowerCase().includes(w))).slice(0, 7) : [];
    const ask = t.length >= 3 ? [{ ask: t, label: `Ask the agent: “${t}”`, icon: "spark", kind: "Ask" }] : [];
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
  function unfold() {
    el.classList.remove("folded"); fab.setAttribute("aria-expanded", "true"); fab.setAttribute("aria-label", "Fold the agent");
    if (!employeeMode && !openings) api("/api/openings").then((o) => { openings = o; if (q.value) draw(); }).catch(() => { openings = []; });
    q.focus(); q.select(); draw();
  }
  function fold() {
    if (busy) return;
    q.value = "";
    if (!employeeMode) answer.hidden = true;
    draw(); q.blur();
    el.classList.add("folded"); fab.setAttribute("aria-expanded", "false"); fab.setAttribute("aria-label", "Open the agent (Ctrl K)");
    // A preserved employee answer keeps `open` set for reopening. Folded must still mean launcher only.
    el.classList.remove("open");
  }
  function pick(i) {
    const it = items[i];
    if (!it) return;
    if (it.ask) { ask(it.ask); return; }
    fold();
    if (it.run) it.run(); else location.hash = it.href;
  }

  async function ask(text) {
    if (busy) return;
    busy = true; q.value = ""; list.replaceChildren(); bird.set("thinking"); status?.set("thinking", "The agent is working");
    answer.hidden = false; el.classList.add("open");
    answer.replaceChildren(h("p", { class: "cap-q" }, text), h("div", { class: "cap-who" }, owl(null, 24, "thinking").el, "Writing…"));
    const msgs = [...store.get(), { role: "user", content: text }];  // the same conversation as the Agent page
    try {
      const r = await say(msgs, getProfile?.() || null);
      const reply = { role: "assistant", content: r.reply, agent: r.agent, proposal: r.proposal, link: r.link };
      msgs.push(reply); store.set(msgs);
      // employee ids in the answer open their plan: the agent's answer becomes a way to drive the console
      const ids = [...new Set(r.reply.match(/\b[A-Z]{1,4}-\d{1,9}\b/g) || [])].map((sid) => plans().find((p) => p.subject_id === sid && p.audience === "hr")).filter(Boolean);
      answer.replaceChildren(h("p", { class: "cap-q" }, text),
        h("div", { class: "cap-who" }, owl(r.agent?.id, 24).el, r.agent?.name || "Agent"),
        h("div", { class: "ag-reply cap-reply" }, rich(r.reply), actionCard(reply, () => store.set(msgs))),
        h("div", { class: "cap-tools" }, ids.slice(0, 6).map((p) => h("a", { class: "btn sm", href: `#/review/${p.plan_id}`, onclick: fold }, icon("review"), p.subject_id)),
          readAloudButton(() => r.reply), h("a", { class: "btn sm ghost", href: "#/agents", onclick: fold }, "Continue in chat", icon("flat"))));
      bird.set("matched"); status?.set("matched", `${r.agent?.name || "The agent"} answered`);
    } catch (e) {
      answer.replaceChildren(h("p", { class: "cap-q" }, text), h("div", { class: "ag-error", role: "alert" }, e.message,
        e instanceof ApiError && e.status === 402 ? [" ", h("a", { href: "./#/pricing" }, "See plans")] : null));
      q.value = text; bird.set("confused"); status?.set("confused", "No answer");
    }
    reveal(answer, DROP);
    busy = false; q.focus();
  }

  q.addEventListener("input", draw);
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (items.length) mark(sel + (e.key === "ArrowDown" ? 1 : -1)); }
    else if (e.key === "Escape") { e.preventDefault(); fold(); fab.focus(); }
  });
  addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
      if (el.hidden || e.target.closest?.("dialog")) return;
      e.preventDefault(); unfold();
    }
  });
  // a click elsewhere folds it back, unless an answer is still being written
  addEventListener("pointerdown", (e) => { if (!el.contains(e.target) && !el.classList.contains("folded")) fold(); });
  return el;
}

/** HR console launcher; its organization search/actions remain confined to the HR experience. */
export function hrCapsule({ pages, actions, plans, status }) {
  return floatingCapsule({ pages, actions, plans, status });
}

/** Employee launcher with the same mascot, chat UI, voice input, and employee-scoped agent API. */
export function employeeCapsule({ pages, status, getProfile }) {
  return floatingCapsule({ pages, status, getProfile, employeeMode: true });
}
