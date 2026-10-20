// JobSmart owl companion: a rigged SVG whose state always mirrors what the agents are really doing.
// States switch poses + part animations (web/css/owl.css); in idle-like states the eyes follow the pointer.
import { h } from "./lib.js";
import { owlSVG } from "./owl-art.js";

export const OWL_STATES = ["idle", "greeting", "listening", "thinking", "searching", "analyzing",
  "matched", "update", "reminder", "confused", "celebrating", "sleeping"];
const LABEL = {
  idle: "Owl companion, ready", greeting: "Owl companion waving hello", listening: "Owl companion listening",
  thinking: "Owl companion thinking", searching: "Owl companion searching sources", analyzing: "Owl companion analysing data",
  matched: "Owl companion with a verified check", update: "Owl companion delivering an update", reminder: "Owl companion ringing a reminder",
  confused: "Owl companion puzzled: needs review", celebrating: "Owl companion celebrating", sleeping: "Owl companion asleep",
};
const BUSY = new Set(["thinking", "searching", "analyzing", "update"]);
const SETTLE = { greeting: 2700, matched: 1600 }; // one-shot moods fall back to idle
const LOOKS = new Set(["idle", "greeting", "reminder", "matched", "confused"]); // eyes free to follow the pointer
const SLEEP_AFTER = 120_000;
const all = new Set();
let uid = 0;

export class Owl {
  constructor({ size = 40, state = "idle" } = {}) {
    this.el = h("div", { class: "owl", role: "img", "aria-label": LABEL[state], "data-state": state, style: { "--owl": `${size}px` } });
    this.el.innerHTML = owlSVG(`owl${++uid}`); // authored static markup (owl-art.js), never data
    this.state = state;
    all.add(this);
  }

  set(state) {
    if (!OWL_STATES.includes(state) || state === this.state) return;
    clearTimeout(this._settle);
    this.state = state;
    this.el.dataset.state = state;
    this.el.setAttribute("aria-label", LABEL[state]);
    if (!LOOKS.has(state)) this.look(0, 0);
    if (SETTLE[state]) this._settle = setTimeout(() => this.set("idle"), SETTLE[state]);
  }

  look(x, y) {
    this.el.style.setProperty("--gx", x.toFixed(2));
    this.el.style.setProperty("--gy", y.toFixed(2));
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

// Eyes follow the pointer (max ~4 units), one update per frame; off under reduced motion.
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
let raf = 0, px = 0, py = 0;
addEventListener("pointermove", (e) => {
  px = e.clientX; py = e.clientY;
  if (raf || reduce.matches) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    for (const o of all) {
      if (!o.el.isConnected || !LOOKS.has(o.state)) continue;
      const r = o.el.getBoundingClientRect();
      const dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height * 0.45);
      const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 240) * 4;
      o.look((dx / d) * k, (dy / d) * k * 0.8);
    }
  });
}, { passive: true });

// Inactivity -> sleeping; any interaction wakes with a greeting. Animations pause when the tab is hidden.
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
