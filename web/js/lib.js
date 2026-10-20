// Shared helpers: API, Server-Sent-Event streaming over fetch, safe DOM building, toasts.

export class ApiError extends Error {
  constructor(status, detail, body) { super(detail); this.status = status; this.body = body; }
}

export async function api(path, { method = "GET", body, signal } = {}) {
  const res = await fetch(path, {
    method, signal, credentials: "same-origin",
    headers: { "X-AP": "1", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.detail || res.statusText, data);
  return data;
}

/** POST a JSON body and call onEvent(obj) for every `data:` line the server streams. */
export async function stream(path, body, onEvent, signal) {
  const res = await fetch(path, {
    method: "POST", signal, credentials: "same-origin",
    headers: { "X-AP": "1", "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.detail || res.statusText, data);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)));
      }
    }
  }
}

/** Tiny element builder. Text children are always text nodes: data never becomes markup. */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Static SVG icons (trusted, authored here). */
const ICONS = {
  build: '<path d="M4 20h16M6 16l9-9 3 3-9 9H6v-3z"/>',
  report: '<path d="M5 4h10l4 4v12H5z M14 4v5h5 M8 13h8 M8 17h5"/>',
  plans: '<path d="M6 4h12v16H6z M9 8h6 M9 12h6 M9 16h4"/>',
  grid: '<path d="M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z"/>',
  upload: '<path d="M12 16V4 M7 9l5-5 5 5 M4 20h16"/>',
  review: '<path d="M4 6h10 M4 12h10 M4 18h6 M16 15l2 2 4-4"/>',
  history: '<path d="M12 7v5l3 2 M4 12a8 8 0 1 0 2.3-5.7 M4 4v4h4"/>',
  out: '<path d="M10 4H5v16h5 M14 8l4 4-4 4 M18 12H9"/>',
  ext: '<path d="M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  stop: '<path d="M7 7h10v10H7z"/>',
  send: '<path d="M4 12h14 M13 6l6 6-6 6"/>',
  sources: '<path d="M5 4h14v16H5z M9 4v16"/>',
};
export function icon(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", "20");
  s.setAttribute("height", "20");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.6");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONS[name] || "";
  return s;
}

let toastBox;
export function toast(msg, kind = "") {
  toastBox ??= document.body.appendChild(h("div", { class: "toasts", role: "status", "aria-live": "polite" }));
  const t = toastBox.appendChild(h("div", { class: `toast ${kind}` }, msg));
  setTimeout(() => t.remove(), 4200);
}

export const fmtTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Entrance motion that never hides content: runs only when the page is visible and motion is allowed.
 *  Without it (background tab, reduced motion, headless render) the element is simply shown. */
export function reveal(el, keyframes, { duration = 280, delay = 0, easing = "cubic-bezier(0.16, 1, 0.3, 1)" } = {}) {
  if (!el?.animate || document.hidden || reduceMotion()) return el;
  el.animate(keyframes, { duration, delay, easing, fill: "backwards" });
  return el;
}
export const RISE = [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }];
export const DROP = [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }];
export const GROW = [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
