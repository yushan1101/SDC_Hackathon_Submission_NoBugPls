// Motion layer (GSAP, vendored in /vendor): entrances, scroll-in, chart draw-ins, count-ups and press feedback, applied
// to whatever the app renders, so page code stays free of animation details. Off for prefers-reduced-motion.
// Nothing here scrolls the page or moves an element under the pointer (both made pages shake), and a CSS transition is
// paused while GSAP animates the same element, so the two never fight.
const gsap = window.gsap;
const ST = window.ScrollTrigger;
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const done = new WeakSet();  // each element is animated once
const once = (el) => (done.has(el) ? false : (done.add(el), true));
const EASE = "power3.out";

let triggersAdded = false;
/** Animate when the element scrolls into view (at once if it already is). */
const onView = (el, vars) => {
  triggersAdded = true;
  gsap.set(el, { transition: "none" });
  return gsap.from(el, { ...vars, clearProps: vars.clearProps ?? "transform,opacity,transition",
    scrollTrigger: ST ? { trigger: el, start: "top 94%", once: true } : undefined });
};

// cards and sections that the app does not animate itself (reveal() handles the rest)
const CARDS = ".way, .entry-card, .role-card, .sdg-library > li, .plan-item, .home-today, .radar-row, .board-meta, .sdg-mine, .plan-progress, .compare-wrap, .why-rows li";

function hero(el) {
  const tl = gsap.timeline({ defaults: { ease: EASE } });
  const owl = el.querySelector(".owl");
  if (owl) tl.from(owl, { y: -24, scale: 0.85, opacity: 0, duration: 0.7, clearProps: "transform,opacity" });
  tl.from(el.querySelectorAll("h1, p"), { y: 26, opacity: 0, duration: 0.6, stagger: 0.08, clearProps: "transform,opacity" }, owl ? "-=0.4" : 0);
  if (owl) gsap.to(owl, { y: -6, duration: 2.4, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 1 });  // gentle float
}

/** Draw a line chart from left to right. */
function drawLine(pl) {
  const len = pl.getTotalLength?.() || 0;
  if (!len) return;
  gsap.fromTo(pl, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.1, ease: "power2.out",
    clearProps: "strokeDasharray,strokeDashoffset", scrollTrigger: ST ? { trigger: pl.ownerSVGElement, start: "top 96%", once: true } : undefined });
}

/** Count a figure up from zero, keeping its format (+5.1%, 31%, 1,210). */
function countUp(el) {
  const m = el.textContent.trim().match(/^([+−-]?)(\d[\d,]*\.?\d*)(.*)$/);
  if (!m) return;
  const [, sign, num, rest] = m, target = parseFloat(num.replace(/,/g, "")), dp = (num.split(".")[1] || "").length;
  const o = { v: 0 }, final = el.textContent;
  gsap.to(o, { v: target, duration: 1, ease: "power2.out", scrollTrigger: ST ? { trigger: el, start: "top 96%", once: true } : undefined,
    onUpdate: () => { el.textContent = sign + o.v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }) + rest; },
    onComplete: () => { el.textContent = final; } });
}

function enhance(root) {
  const all = (sel) => [...(root.matches?.(sel) ? [root] : []), ...root.querySelectorAll(sel)].filter(once);
  all(".home-hero, .intro-hero").forEach(hero);
  // groups of siblings come in with a short stagger
  all(CARDS).forEach((el) => onView(el, { y: 28, opacity: 0, duration: 0.6, ease: EASE,
    delay: Math.min([...el.parentElement.children].indexOf(el), 6) * 0.06 }));
  all(".radar .rd-now").forEach((p) => gsap.from(p, { scale: 0, svgOrigin: "160 160", duration: 1, ease: "back.out(1.4)",
    scrollTrigger: ST ? { trigger: p.ownerSVGElement, start: "top 90%", once: true } : undefined }));
  all(".radar .rd-prev, .radar .rd-label").forEach((p) => gsap.from(p, { opacity: 0, duration: 0.6, delay: 0.5 }));
  all(".spark polyline, .zline polyline").forEach(drawLine);
  all(".pp-bar i, .sb-track i").forEach((i) => onView(i, { width: 0, duration: 0.9, ease: "power2.out", clearProps: "" }));
  all(".tc-figure b, .stat b, .fit .num, .bc-figure b").forEach(countUp);
  all(".btn, .chip").forEach((b) => {  // press feedback (scales in place, so it never moves from under the pointer)
    b.addEventListener("pointerdown", () => gsap.to(b, { scale: 0.96, duration: 0.12, overwrite: true }));
    const up = () => gsap.to(b, { scale: 1, duration: 0.25, ease: "back.out(2)", overwrite: true, clearProps: "transform" });
    b.addEventListener("pointerup", up); b.addEventListener("pointerleave", up);
  });
}

if (gsap && !calm) {
  if (ST) gsap.registerPlugin(ST);
  let queued = [], frame = 0, refresh = 0;  // new nodes are enhanced once per frame
  const flush = () => {
    frame = 0; const batch = queued; queued = [];
    batch.forEach((n) => n.isConnected && enhance(n));
    // re-measure scroll positions only when new scroll animations exist, at most every 200 ms (a full re-layout)
    if (triggersAdded && ST) { triggersAdded = false; clearTimeout(refresh); refresh = setTimeout(() => ST.refresh(), 200); }
  };
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes)
      if (n.nodeType === 1 && !n.closest(".prose, .trace")) queued.push(n);  // a streaming answer is not animated piece by piece
    if (queued.length && !frame) frame = requestAnimationFrame(flush);
  }).observe(document.body, { childList: true, subtree: true });
}
