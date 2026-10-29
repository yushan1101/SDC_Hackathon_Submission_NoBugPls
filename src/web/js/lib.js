// Shared helpers: API, Server-Sent-Event streaming over fetch, safe DOM building, toasts.

// API origin: "" = same origin as the page; set in config.js when the frontend is deployed separately.
export const API_BASE = (globalThis.AP_CONFIG?.apiBase || "").replace(/\/+$/, "");
const CREDS = API_BASE ? "include" : "same-origin";  // cross-origin API needs credentials: include (+ CORS allowlist)
export const apiUrl = (path) => API_BASE + path;

// Shared explanations for the AI scenario selectors.
export const SCENARIO_HELP = {
  assistive: "You do the work, and AI helps with suggestions and drafts. Your learning plan focuses on the skills needed to do the job with AI support.",
  agentic: "AI handles routine tasks, and you guide it and check the results. Your learning plan focuses more on decision-making and reviewing AI's work. This is an assumed future scenario.",
};

export class ApiError extends Error {
  constructor(status, detail, body) {
    // FastAPI validation errors arrive as a list of {loc, msg}; show them as one readable sentence
    super(Array.isArray(detail) ? detail.map((d) => `${(d.loc || []).slice(-1)[0] ?? "input"}: ${d.msg}`).join("; ") : detail);
    this.status = status; this.body = body;
  }
}

// A frontend on another domain than the API: browsers may block the session cookie there (third-party cookie),
// so the API hands this site its session token and it is sent back as a Bearer header. Same-site: cookie only.
const TOKEN_KEY = "ap.session";
const auth = () => { try { const t = API_BASE && localStorage.getItem(TOKEN_KEY); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; } };
function keepSession(res, data) {
  try {
    if (data?.session_token) { localStorage.setItem(TOKEN_KEY, data.session_token); delete data.session_token; }
    if (res.status === 401 || (res.ok && /\/api\/logout$/.test(res.url))) localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked: cookie only */ }
}

export async function api(path, { method = "GET", body, signal } = {}) {
  const res = await fetch(apiUrl(path), {
    method, signal, credentials: CREDS,
    headers: { "X-AP": "1", ...auth(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  keepSession(res, data);
  if (!res.ok) throw new ApiError(res.status, data?.detail || res.statusText, data);
  return data;
}

/** POST multipart form data (file uploads). */
/** POST a JSON body and get a binary reply (audio) back as a Blob. */
export async function postForBlob(path, body, signal) {
  const res = await fetch(apiUrl(path), { method: "POST", body: JSON.stringify(body), signal, credentials: CREDS,
    headers: { "X-AP": "1", "Content-Type": "application/json", ...auth() } });
  if (!res.ok) {
    const data = res.headers.get("content-type")?.includes("json") ? await res.json().catch(() => null) : null;
    throw new ApiError(res.status, data?.detail || res.statusText, data);
  }
  return res.blob();
}

export async function upload(path, form, signal) {
  const res = await fetch(apiUrl(path), { method: "POST", body: form, signal, credentials: CREDS, headers: { "X-AP": "1", ...auth() } });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.detail || res.statusText, data);
  return data;
}

/** POST a JSON body and call onEvent(obj) for every `data:` line the server streams. */
export async function stream(path, body, onEvent, signal) {
  const form = body instanceof FormData;  // file uploads stream too (resume progress)
  const res = await fetch(apiUrl(path), {
    method: "POST", signal, credentials: CREDS,
    headers: { "X-AP": "1", ...auth(), Accept: "text/event-stream", ...(form ? {} : { "Content-Type": "application/json" }) },
    body: form ? body : JSON.stringify(body),
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

// Static SVG icons: Lucide (lucide.dev, v0.460.0, ISC licence), copied in so the site needs no icon CDN. Key -> Lucide name.
const ICONS = {
  // sidebar set: two-tone; the class "d" shape is a tint that fills in on the current page
  "nav-overview": '<rect class="d" x="3" y="3" width="7" height="9" rx="1.5"/><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  "nav-agent": '<path class="d" d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-4.8A8.5 8.5 0 1 1 21 11.5z"/><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-4.8A8.5 8.5 0 1 1 21 11.5z"/><path d="M12.5 7.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  "nav-team": '<circle class="d" cx="9" cy="8" r="4"/><circle cx="9" cy="8" r="4"/><path d="M2 21v-.5A5.5 5.5 0 0 1 7.5 15h3a5.5 5.5 0 0 1 5.5 5.5v.5"/><path d="M16 3.6a4 4 0 0 1 0 8.8"/><path d="M22 21v-.5a5.5 5.5 0 0 0-3.5-5.1"/>',
  "nav-analyse": '<path class="d" d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 17.5v-6"/><path d="m9.5 14 2.5-2.5 2.5 2.5"/>',
  "nav-review": '<path class="d" d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="m9 14 2 2 4-4"/>',
  "nav-member": '<circle class="d" cx="12" cy="8" r="4.5"/><circle cx="12" cy="8" r="4.5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  "nav-hiring": '<rect class="d" x="2.5" y="7" width="19" height="14" rx="2"/><rect x="2.5" y="7" width="19" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M2.5 13h19"/><path d="M11 13h2"/>',
  "nav-openings": '<path class="d" d="M3 10.5v3a1 1 0 0 0 1 1h2.5L12 19V5L6.5 9.5H4a1 1 0 0 0-1 1z"/><path d="M3 10.5v3a1 1 0 0 0 1 1h2.5L12 19V5L6.5 9.5H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  "nav-plugins": '<path class="d" d="M18 8v5a6 6 0 0 1-12 0V8z"/><path d="M18 8v5a6 6 0 0 1-12 0V8z"/><path d="M12 22v-3"/><path d="M9 8V2"/><path d="M15 8V2"/>',
  "nav-trends": '<path class="d" d="M7 15l4-4 3 3 6-6v12H7z"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m7 15 4-4 3 3 6-6"/><path d="M16 8h4v4"/>',
  "nav-market": '<path class="d" d="M6 22h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2z"/><path d="M4 22h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M17 14h-7"/><path d="M14 18h-4"/><rect x="10" y="6" width="7" height="4" rx="1"/>',
  "nav-heatmap": '<rect class="d" x="9.5" y="3" width="5" height="5" rx="1"/><rect class="d" x="3" y="9.5" width="5" height="5" rx="1"/><rect class="d" x="16" y="16" width="5" height="5" rx="1"/><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="9.5" y="3" width="5" height="5" rx="1"/><rect x="16" y="3" width="5" height="5" rx="1"/><rect x="3" y="9.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><rect x="16" y="9.5" width="5" height="5" rx="1"/><rect x="3" y="16" width="5" height="5" rx="1"/><rect x="9.5" y="16" width="5" height="5" rx="1"/><rect x="16" y="16" width="5" height="5" rx="1"/>',
  "nav-tokens": '<path class="d" d="M3.3 18.5A9.5 9.5 0 1 1 20.7 18.5z"/><path d="M3.3 18.5A9.5 9.5 0 1 1 20.7 18.5z"/><path d="m12 14 4.5-4.5"/><circle cx="12" cy="14" r="1.2"/>',
  "nav-fraud": '<path class="d" d="M12 22s8-3.5 8-10V5.2L12 2 4 5.2V12c0 6.5 8 10 8 10z"/><path d="M12 22s8-3.5 8-10V5.2L12 2 4 5.2V12c0 6.5 8 10 8 10z"/><path d="M12 8v4.5"/><path d="M12 16h.01"/>',
  "nav-payments": '<rect class="d" x="2" y="5" width="20" height="14" rx="2.5"/><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/><path d="M6 15h4"/>',
  "nav-models": '<rect class="d" x="5" y="5" width="14" height="14" rx="2.5"/><rect x="5" y="5" width="14" height="14" rx="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  "nav-sites": '<circle class="d" cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/><path d="M12 2.5a14.5 14.5 0 0 1 0 19 14.5 14.5 0 0 1 0-19z"/>',
  "nav-signout": '<path d="M15 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><path d="m10 17-5-5 5-5"/><path d="M5 12h11"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',  // info
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',  // flag
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',  // house
  spark: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',  // sparkles
  chevron: '<path d="m6 9 6 6 6-6"/>',  // chevron-down
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',  // target
  check: '<path d="M20 6 9 17l-5-5"/>',  // check
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',  // clock
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',  // user
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',  // search
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',  // arrow-up
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',  // arrow-down
  flat: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',  // arrow-right
  build: '<path d="M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13"/><path d="m8 6 2-2"/><path d="m18 16 2-2"/><path d="m17 11 4.3 4.3c.94.94.94 2.46 0 3.4l-2.6 2.6c-.94.94-2.46.94-3.4 0L11 17"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',  // pencil-ruler
  report: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',  // file-text
  plans: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',  // clipboard-list
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',  // layout-grid
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',  // upload
  review: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',  // list-checks
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',  // history
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',  // log-out
  ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',  // external-link
  back: '<path d="m15 18-6-6 6-6"/>',  // chevron-left
  stop: '<rect width="18" height="18" x="3" y="3" rx="2"/>',  // square
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',  // send
  quiz: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',  // circle-help
  pulse: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',  // activity
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',  // file
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',  // users
  sources: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',  // book-open
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',  // mail
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',  // share-2
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',  // plug
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',  // mic
  "mic-off": '<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/>',  // mic-off
  volume: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',  // volume-2
  model: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',  // cpu
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',  // globe
  ask: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',  // message-square
  edit: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',  // square-pen
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',  // trash-2
  job: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',  // briefcase
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',  // pause
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',  // play
  replay: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',  // rotate-ccw
  keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',  // keyboard
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',  // sliders-horizontal
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',  // x
  micOff: '<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/>',  // mic-off
};
export function icon(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", "20");
  s.setAttribute("height", "20");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.75");
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

  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
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
