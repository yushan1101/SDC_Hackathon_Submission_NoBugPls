import { h } from "./lib.js";
import { Owl } from "./owl.js";

/** Presentation only: the report DOM remains the source of conversation history. */
export function reportAssistant({ thread, composer, input, onCite }) {
  const owl = new Owl({ size: 52, state: "idle" });
  let open = false, stick = true, savedScroll = 0, frame = 0;
  const mirrors = new Map();
  const messages = h("div", { class: "report-assistant-messages" });
  const tools = h("div", { class: "report-assistant-tools" });
  const log = h("div", { class: "report-assistant-log", tabindex: "0", "aria-label": "Conversation history" }, messages, tools);
  const status = h("p", { class: "report-assistant-status", role: "status", "aria-live": "polite", hidden: true });
  const owlSlot = h("span", { class: "report-assistant-owl" });
  const trigger = h("button", { class: "report-assistant-trigger", type: "button", title: "Ask AiversePulse AI",
    "aria-label": "Ask AiversePulse AI", "aria-expanded": "false", "aria-controls": "report-assistant-panel",
    onclick: () => show() }, owl.el, h("span", {}, "Ask AI"));
  const panel = h("section", { id: "report-assistant-panel", class: "report-assistant-panel", role: "dialog",
    "aria-modal": "false", "aria-labelledby": "report-assistant-title", hidden: true },
    h("header", { class: "report-assistant-head" }, owlSlot,
      h("div", {}, h("h2", { id: "report-assistant-title" }, "AiversePulse AI Assistant"),
        h("p", {}, "Ask about your career plan")),
      h("button", { class: "btn icon", type: "button", title: "Minimize", "aria-label": "Minimize assistant", onclick: () => hide() }, "−"),
      h("button", { class: "btn icon", type: "button", title: "Close", "aria-label": "Close assistant", onclick: () => hide() }, "×")),
    h("p", { class: "report-assistant-greeting" }, "Hi! I'm your AiversePulse assistant. Need help understanding your report or adjusting your learning plan? Ask me anything!"),
    log, status, composer);
  const el = h("div", { class: "report-assistant no-print" }, trigger, panel);

  // Project existing messages into the panel; never create another conversation or request.
  function sync() {
    const sources = [...thread.querySelectorAll(".turn-user > .q, [data-assistant-reply], .issue.error, .issue.upsell, .turn-owl > .body > .body > .note")];
    for (const [source, entry] of mirrors) {
      if (!sources.includes(source)) { entry.node.remove(); mirrors.delete(source); }
    }
    for (const source of sources) {
      let entry = mirrors.get(source);
      if (!entry) {
        const user = source.matches(".turn-user > .q");
        const node = h("article", { class: `report-assistant-message ${user ? "is-user" : "is-assistant"}`, "aria-label": user ? "You" : "AiversePulse" });
        entry = { node, markup: null };
        mirrors.set(source, entry);
        messages.append(node);
      }
      if (entry.markup !== source.innerHTML) {
        entry.markup = source.innerHTML;
        const copy = source.cloneNode(true);
        copy.removeAttribute("id");
        copy.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
        entry.node.replaceChildren(...copy.childNodes);
        entry.node.hidden = !source.textContent.trim();
      }
    }
    if (stick) log.scrollTop = log.scrollHeight;
  }
  const observer = new MutationObserver(() => {
    if (!open || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; sync(); });
  });
  observer.observe(thread, { childList: true, subtree: true, characterData: true });
  messages.addEventListener("click", (event) => {
    const cite = event.target.closest(".cite");
    if (cite) { event.preventDefault(); hide(); onCite(cite.title); }
  });
  log.addEventListener("scroll", () => { stick = log.scrollHeight - log.clientHeight - log.scrollTop < 48; }, { passive: true });

  // Keep the sheet above the mobile keyboard and below the existing site navigation.
  function position() {
    if (!el.isConnected) return;
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0, height = viewport?.height || innerHeight;
    const navBottom = document.querySelector(".pub-top")?.getBoundingClientRect().bottom || 0;
    const tabs = document.querySelector(".tabbar")?.getBoundingClientRect();
    const keyboard = innerHeight - height > 150;
    const bottomGap = !keyboard && tabs?.height ? Math.max(12, innerHeight - tabs.top + 12) : 12;
    el.style.setProperty("--assistant-bottom", `${Math.max(0, innerHeight - top - height) + bottomGap}px`);
    el.style.setProperty("--assistant-height", `${Math.max(0, height - Math.max(0, navBottom - top) - bottomGap - 12)}px`);
  }
  function show() {
    open = true;
    trigger.hidden = true; panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    owlSlot.append(owl.el);
    position(); sync();
    log.scrollTop = stick ? log.scrollHeight : savedScroll;
    input.focus({ preventScroll: true });
  }
  function stopMic() {
    const mic = composer.querySelector('.mic-btn[aria-pressed="true"]');
    if (mic) mic.click();
  }
  function hide(restoreFocus = true) {
    savedScroll = log.scrollTop;
    open = false;
    stopMic();
    panel.hidden = true; trigger.hidden = false;
    trigger.setAttribute("aria-expanded", "false");
    trigger.prepend(owl.el);
    if (restoreFocus && el.isConnected) trigger.focus({ preventScroll: true });
  }
  // Permission may be granted after the panel closes: stop that capture too.
  new MutationObserver(() => { if (!open) stopMic(); })
    .observe(composer, { attributes: true, subtree: true, attributeFilter: ["aria-pressed"] });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open && !document.querySelector("dialog[open]")) { event.preventDefault(); hide(); }
  });
  window.addEventListener("hashchange", () => { if (open && !/^#\/report(?:\/|$)/.test(location.hash)) hide(false); });
  window.addEventListener("resize", position);
  window.visualViewport?.addEventListener("resize", position);
  window.visualViewport?.addEventListener("scroll", position);

  return { el, owl, hide, position,
    reset() { hide(false); tools.replaceChildren(); savedScroll = 0; stick = true; input.value = ""; },
    showTool(node) { tools.replaceChildren(node); show(); log.scrollTop = log.scrollHeight; node.querySelector("input")?.focus({ preventScroll: true }); },
    setStatus(text) { status.textContent = text; },
    setBusy(busy) {
      status.hidden = !busy;
      if (busy) { status.textContent = "Working on your request…"; stick = true; }
      composer.querySelectorAll(".quick button").forEach((button) => { button.disabled = busy; });
      if (!busy) owl.set("idle");
    },
  };
}
