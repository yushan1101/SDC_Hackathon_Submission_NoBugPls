// Design/QA sheet for the owl rig: every state live, plus one owl you can drive.
import { h } from "../js/lib.js";
import { Owl, OWL_STATES } from "../js/owl.js";

const grid = document.getElementById("grid");
grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px;margin-top:24px";
for (const s of OWL_STATES) {
  const o = new Owl({ size: 120, state: s });
  o.set = () => {}; // keep each sample in its state (no settle back to idle)
  grid.append(h("figure", { style: { margin: 0, padding: "12px", border: "1px solid var(--rule)", display: "grid", "justify-items": "center", gap: "8px" } },
    o.el, h("figcaption", { class: "mono muted" }, s)));
}
const big = new Owl({ size: 220, state: "idle" });
grid.after(h("section", { style: { "margin-top": "32px", display: "grid", gap: "12px", "justify-items": "start" } },
  h("h2", {}, "Drive one owl"), big.el,
  h("div", { class: "suggest" }, OWL_STATES.map((s) => h("button", { class: "chip", type: "button", onclick: () => big.set(s) }, s)))));
