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
  all(".lp").forEach(landing);
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

// ---------------------------------------------------------------- the guest landing page: one authored moment per section
/** Split a heading into masked words that can rise in; screen readers keep the whole heading (aria-label). */
function words(h) {
  const text = h.textContent;
  h.setAttribute("aria-label", text);
  h.replaceChildren(...text.split(/(\s+)/).map((w) => {
    if (/^\s+$/.test(w)) return document.createTextNode(w);
    const outer = document.createElement("span"), inner = document.createElement("span");
    outer.className = "w"; inner.className = "wi"; inner.textContent = w; outer.setAttribute("aria-hidden", "true");
    outer.append(inner);
    return outer;
  }));
  return h.querySelectorAll(".wi");
}

const view = (el, start = "top 82%") => (ST ? { trigger: el, start, once: true } : undefined);

function landing(lp) {
  const $ = (sel) => lp.querySelector(sel), $$ = (sel) => [...lp.querySelectorAll(sel)];

  // hero: words rise out of a mask, the button pops, the product window lifts in and fills itself
  const hero = $(".lp-hero");
  if (hero) {
    const tl = gsap.timeline({ defaults: { ease: EASE } });
    tl.from(words(hero.querySelector("h1")), { yPercent: 110, duration: 0.9, stagger: 0.07, ease: "power4.out" })
      .from(hero.querySelectorAll(":scope > p"), { y: 18, opacity: 0, duration: 0.6, stagger: 0.08, clearProps: "transform,opacity" }, "-=0.5")
      .from(hero.querySelector(".lp-cta"), { scale: 0.86, opacity: 0, duration: 0.6, ease: "back.out(2)", clearProps: "transform,opacity" }, "-=0.45")
      .from(hero.querySelector(".lp-window"), { y: 90, rotateX: 14, opacity: 0, transformPerspective: 1200, transformOrigin: "50% 100%",
        duration: 1.1, ease: "power3.out", clearProps: "transform,opacity" }, "-=0.35")
      .from(hero.querySelector(".lp-pill"), { y: -24, opacity: 0, duration: 0.6, ease: "back.out(1.8)", clearProps: "opacity" }, "-=0.7")
      .from(hero.querySelectorAll(".lp-ask, .lp-answer > p"), { y: 12, opacity: 0, duration: 0.5, stagger: 0.12, clearProps: "transform,opacity" }, "-=0.5")
      .from(hero.querySelectorAll(".lp-track i"), { width: 0, duration: 0.9, stagger: 0.1, ease: "power2.out" }, "-=0.2")
      .from(hero.querySelectorAll(".lp-track b"), { scaleY: 0, duration: 0.4, stagger: 0.1, ease: "back.out(3)", clearProps: "transform" }, "<0.3")
      .from(hero.querySelectorAll(".lp-cite"), { scale: 0, duration: 0.4, stagger: 0.12, ease: "back.out(3)", clearProps: "transform" }, "<")
      .from(hero.querySelectorAll(".lp-phases > div"), { y: 14, opacity: 0, duration: 0.5, stagger: 0.12, clearProps: "transform,opacity" }, "-=0.3");
    // the sky drifts a little as the page scrolls (the background only: nothing moves under the pointer)
    if (ST) gsap.fromTo(hero, { backgroundPosition: "0% 0%, 50% 100%" }, { backgroundPosition: "0% 0%, 50% 70%", ease: "none",
      scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.6 } });
  }

  // three steps: the copy comes in from its side while its piece of UI unwipes, then the UI acts itself out
  $$(".lp-step").forEach((step) => {
    const flip = step.classList.contains("flip");
    const ui = step.querySelector(".lp-step-ui");
    const tl = gsap.timeline({ scrollTrigger: view(step), defaults: { ease: EASE } });
    tl.from(step.querySelector(".lp-step-copy"), { x: flip ? 40 : -40, opacity: 0, duration: 0.8, clearProps: "transform,opacity" })
      .from(ui, { clipPath: flip ? "inset(0 100% 0 0 round 28px)" : "inset(0 0 0 100% round 28px)", duration: 0.9, ease: "power3.inOut",
        clearProps: "clipPath" }, "<0.1");
    const opts = ui.querySelectorAll(".demo-opt");
    if (opts.length) tl.from(ui.querySelector(".demo-q"), { y: 14, opacity: 0, duration: 0.5, clearProps: "transform,opacity" }, "-=0.3")
      .from(opts, { x: 24, opacity: 0, duration: 0.45, stagger: 0.12, clearProps: "transform,opacity" }, "-=0.2")
      .to(ui.querySelector(".demo-opt.on"), { scale: 1.035, duration: 0.25, yoyo: true, repeat: 1, ease: "power1.inOut", clearProps: "transform" });  // the chosen answer
    const mark = ui.querySelector(".demo-line mark");
    if (mark) tl.from(ui.querySelector(".demo-line"), { y: 16, opacity: 0, duration: 0.5, clearProps: "transform,opacity" }, "-=0.3")
      .fromTo(mark, { backgroundSize: "0% 100%" }, { backgroundSize: "100% 100%", duration: 0.7, ease: "power2.inOut", clearProps: "backgroundSize" })
      .from(ui.querySelector(".demo-skill"), { scale: 0.7, opacity: 0, duration: 0.5, ease: "back.out(2.2)", clearProps: "transform,opacity" }, "-=0.1");
    const phases = ui.querySelectorAll(".demo-phases > div");
    if (phases.length) tl.from(phases, { y: 20, opacity: 0, duration: 0.55, stagger: 0.16, clearProps: "transform,opacity" }, "-=0.3");
  });

  // feature tiles: a staggered rise, then each tile's own detail
  const tiles = $$(".lp-tile");
  if (tiles.length) gsap.from(tiles, { y: 36, opacity: 0, scale: 0.97, duration: 0.7, stagger: 0.09, ease: EASE, clearProps: "transform,opacity",
    scrollTrigger: view($(".lp-bento"), "top 78%") });
  const brands = $$(".lp-brands .plugin-mark");
  if (brands.length) gsap.from(brands, { scale: 0, rotate: -20, duration: 0.5, stagger: 0.07, ease: "back.out(2.4)", delay: 0.4,
    clearProps: "transform", scrollTrigger: view($(".lp-brands")) });
  const ask = $(".lp-ask-ui");
  if (ask) gsap.timeline({ scrollTrigger: view(ask), delay: 0.4 })
    .from(ask.children[0], { x: 20, opacity: 0, duration: 0.45, ease: EASE, clearProps: "transform,opacity" })
    .from(ask.children[1], { y: 10, opacity: 0, duration: 0.5, ease: EASE, clearProps: "transform,opacity" }, "+=0.35");
  const src = $$(".lp-sources li");
  if (src.length) gsap.from(src, { x: -18, opacity: 0, duration: 0.5, stagger: 0.12, delay: 0.3, ease: EASE, clearProps: "transform,opacity",
    scrollTrigger: view($(".lp-sources")) });
  // the voice tile listens only while it is on screen; the recording clock counts up once
  const bars = $$(".lp-wave i");
  if (bars.length) {
    gsap.set(bars, { transformOrigin: "50% 50%" });
    const wave = gsap.to(bars, { scaleY: () => gsap.utils.random(0.35, 1.25), duration: 0.32, ease: "sine.inOut",
      stagger: { each: 0.03, repeat: -1, yoyo: true }, repeatRefresh: true, paused: true });
    if (ST) ST.create({ trigger: $(".lp-voice"), start: "top bottom", end: "bottom top", onToggle: (s) => (s.isActive ? wave.play() : wave.pause()) });
    const rec = $(".lp-rec"), label = rec?.lastChild;
    if (label?.nodeType === 3) {
      const t = { s: 0 };
      gsap.to(t, { s: 42, duration: 2.4, ease: "none", scrollTrigger: view(rec),
        onUpdate: () => { label.textContent = `Recording · 0:${String(Math.round(t.s)).padStart(2, "0")}`; } });
    }
  }
  $$(".lp-num").forEach(countUp);

  // FAQ answers open smoothly (the native <details> keeps working without script)
  $$(".lp-faq").forEach((d) => d.addEventListener("toggle", () => {
    if (d.open) gsap.from(d.querySelector("p"), { height: 0, opacity: 0, y: -6, duration: 0.4, ease: EASE, clearProps: "height,opacity,transform" });
  }));

  // closing band: the line rises word by word, then the button pops
  const close = $(".lp-close");
  if (close) gsap.timeline({ scrollTrigger: view(close, "top 75%") })
    .from(words(close.querySelector("h2")), { yPercent: 110, duration: 0.8, stagger: 0.05, ease: "power4.out" })
    .from(close.querySelector(".lp-cta"), { scale: 0.86, opacity: 0, duration: 0.6, ease: "back.out(2)", clearProps: "transform,opacity" }, "-=0.35");
  triggersAdded = true;
}

if (gsap && !calm) {
  if (ST) gsap.registerPlugin(ST);
  document.documentElement.classList.add("motion");  // lets CSS hold a heading until it is split into words
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
