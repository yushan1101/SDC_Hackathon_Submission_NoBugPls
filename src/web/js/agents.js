// Agents: a gallery to find them, and a chat to use them (like GPTs / Claude projects), shared by the public app and
// the HR console. Chat agents answer from the person's own context on the server (agents/catalog.py); guided tools
// open their own screen. Conversations stay in this tab (sessionStorage), one per agent.
import { api, h, icon, toast, ApiError } from "./lib.js";
import { micButton, readAloudButton } from "./voice.js";

const pic = (id, size = "sm") => `img/agents/${id}${size === "sm" ? "-sm" : ""}.jpg`;
const photo = (a, cls, size) => h("img", { class: cls, src: pic(a.id, size), alt: "", loading: "lazy", decoding: "async",
  onerror: (e) => { e.currentTarget.replaceWith(h("span", { class: `${cls} ag-ph`, "aria-hidden": "true" }, a.name[0])); } });
const store = {
  get(id) { try { return JSON.parse(sessionStorage.getItem(`ap.agent.${id}`)) || []; } catch { return []; } },
  set(id, msgs) { try { sessionStorage.setItem(`ap.agent.${id}`, JSON.stringify(msgs.slice(-40))); } catch { /* private mode: this page only */ } },
};
let cache = null;
const load = async () => (cache ??= (await api("/api/agents")).agents);

// ---------------------------------------------------------------- gallery
export async function agentsView(main) {
  const agents = await load();
  const q = h("input", { class: "input ag-search", type: "search", placeholder: "Search agents", "aria-label": "Search agents", autocomplete: "off" });
  const card = (a) => h("a", { class: `ag-card ${a.kind}`, href: a.kind === "chat" ? `#/agents/${a.id}` : a.href, "data-text": `${a.name} ${a.tagline}`.toLowerCase() },
    photo(a, "ag-card-img"),
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
  const draw = () => {
    thread.replaceChildren(...(msgs.length ? msgs.map(bubble) : [empty()]));
    thread.lastElementChild?.scrollIntoView({ block: "end" });
  };

  async function ask(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true; send.disabled = true;
    msgs.push({ role: "user", content: text }); store.set(id, msgs);
    input.value = ""; grow(); draw();
    const typing = h("div", { class: "ag-msg them" }, photo(agent, "ag-avatar"), h("div", { class: "ag-typing", "aria-label": `${agent.name} is writing` }, h("i"), h("i"), h("i")));
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
  main.replaceChildren(h("div", { class: "ag" }, side,
    h("section", { class: "ag-main", "aria-label": agent.name },
      h("header", { class: "ag-head" }, switcher, msgs.length ? h("span", { class: "ag-head-name" }, photo(agent, "ag-dot"), agent.name) : null),
      thread, form)));
  draw();
  input.focus({ preventScroll: true });
}
