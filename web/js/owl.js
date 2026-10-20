// JobSmart owl companion. The state always mirrors what the agents are really doing.
import { h } from "./lib.js";

export const OWL_STATES = ["idle", "greeting", "listening", "thinking", "searching", "analyzing",
  "matched", "update", "reminder", "confused", "celebrating", "sleeping"];
const ALT = {
  idle: "Owl companion, ready", greeting: "Owl companion waving hello", listening: "Owl companion listening",
  thinking: "Owl companion thinking", searching: "Owl companion searching sources", analyzing: "Owl companion analysing data",
  matched: "Owl companion with a verified check", update: "Owl companion writing an update", reminder: "Owl companion ringing a reminder",
  confused: "Owl companion puzzled: needs review", celebrating: "Owl companion celebrating", sleeping: "Owl companion asleep",
};
const BUSY = new Set(["thinking", "searching", "analyzing", "update"]);
const SETTLE = { greeting: 2700, matched: 1600 }; // one-shot moods fall back to idle
const SLEEP_AFTER = 120_000;

// preload once so state swaps never flash
for (const s of OWL_STATES) { const i = new Image(); i.src = `/static/owl/${s}.webp`; }

const all = new Set();

export class Owl {
  constructor({ size = 40, state = "idle" } = {}) {
    this.el = h("div", { class: "owl", style: { "--owl": `${size}px` }, "data-state": state });
    this.img = h("img", { class: "in", src: `/static/owl/${state}.webp`, alt: ALT[state], width: size, height: size, decoding: "async" });
    this.el.append(this.img);
    this.state = state;
    all.add(this);
  }

  set(state) {
    if (!OWL_STATES.includes(state) || state === this.state) return;
    clearTimeout(this._settle);
    const next = h("img", { class: "in out", src: `/static/owl/${state}.webp`, alt: ALT[state], decoding: "async" });
    const prev = this.img;
    prev.classList.remove("in");
    this.el.append(next);
    this.el.dataset.state = state;
    requestAnimationFrame(() => { next.classList.remove("out"); prev.classList.add("out"); });
    setTimeout(() => prev.remove(), 300);
    this.img = next;
    this.state = state;
    if (SETTLE[state]) this._settle = setTimeout(() => this.set("idle"), SETTLE[state]);
  }
}

/** Owl + one line of status text, announced politely to screen readers. */
export class OwlStatus {
  constructor({ size = 32, say = "Ready" } = {}) {
    this.owl = new Owl({ size });
    this.text = h("span", { class: "say", role: "status", "aria-live": "polite" }, say);
    this.el = h("div", { class: "owl-status" }, this.owl.el, this.text);
  }
  set(state, say) {
    this.owl.set(state);
    if (say) this.text.textContent = say;
    this.el.dataset.busy = String(BUSY.has(state));
  }
}

// Inactivity -> sleeping; any interaction wakes with a greeting. Loops pause when the tab is hidden.
let idleTimer;
function wake() {
  clearTimeout(idleTimer);
  for (const o of all) if (o.state === "sleeping") o.set("greeting");
  idleTimer = setTimeout(() => { for (const o of all) if (o.state === "idle") o.set("sleeping"); }, SLEEP_AFTER);
}
["pointerdown", "keydown", "scroll"].forEach((e) => addEventListener(e, wake, { passive: true }));
document.addEventListener("visibilitychange", () => {
  for (const o of all) o.el.classList.toggle("paused", document.hidden);
});
wake();
