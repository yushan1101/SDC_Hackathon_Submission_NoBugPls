// Accounts and billing pages: sign-up (with the emailed code), plans, Stripe Elements checkout, and the account page
// with payment history. Card details go from the browser straight to Stripe; the server only sees Stripe's ids.
import { api, h, icon, toast, fmtTime } from "./lib.js";
import { Owl } from "./owl.js";
import { watchForm, pageSignals, deviceId } from "./risk.js";

const money = (cents, cur) => new Intl.NumberFormat(undefined, { style: "currency", currency: (cur || "myr").toUpperCase() }).format(cents / 100);
const PLAN_NAME = { free: "Free", pro: "Pro", team: "Team", org: "Organisation" };
export const planName = (p) => PLAN_NAME[p] || p;

// ---------------------------------------------------------------- slider check (server-verified, single use)
/** Drag the piece into the gap. Calls onPass(token) once the server accepts the drag; onReset() when it is undone. */
function sliderCheck(onPass, onReset) {
  const stage = h("div", { class: "sc-stage" });
  const knob = h("button", { class: "sc-knob", type: "button", role: "slider", "aria-label": "Slide the piece into the gap",
    "aria-valuemin": "0", "aria-valuenow": "0" }, icon("send"));
  const label = h("span", { class: "sc-label" }, "Slide to fit the piece");
  const rail = h("div", { class: "sc-rail" }, h("i", { class: "sc-fill" }), knob, label);
  const note = h("p", { class: "sc-note", role: "status", "aria-live": "polite" });
  const again = h("button", { class: "btn ghost sm sc-new", type: "button", onclick: () => load() }, icon("history"), "New puzzle");
  const box = h("div", { class: "slider-check" }, stage, rail, h("div", { class: "sc-foot" }, note, again));
  let ch = null, piece = null, x = 0, max = 0, trail = [], t0 = 0, busy = false, done = false;

  const place = (nx) => {
    x = Math.max(0, Math.min(max, nx));
    piece.style.transform = `translateX(${x}px)`;
    const k = (x / max) * (rail.clientWidth - knob.offsetWidth);
    knob.style.transform = `translateX(${k}px)`;
    rail.querySelector(".sc-fill").style.width = `${k + knob.offsetWidth / 2}px`;
    knob.setAttribute("aria-valuenow", String(Math.round(x)));
  };
  async function load() {
    done = false; busy = false; onReset?.();
    box.classList.remove("ok", "bad");
    note.textContent = ""; label.textContent = "Slide to fit the piece";
    stage.replaceChildren(h("p", { class: "muted" }, "Loading the puzzle…"));
    ch = await api("/api/challenge", { method: "POST" });
    max = ch.width - ch.piece_size;
    piece = h("img", { class: "sc-piece", src: ch.piece, alt: "", style: { top: `${ch.piece_y}px` } });
    stage.style.width = `${ch.width}px`; stage.style.height = `${ch.height}px`;
    stage.replaceChildren(h("img", { class: "sc-track", src: ch.track, alt: "Puzzle: a picture with a gap" }), piece);
    knob.setAttribute("aria-valuemax", String(max));
    trail = []; place(0);
  }
  async function submit(keyboard) {
    if (busy || done || !trail.length) return;
    busy = true;
    try {
      const r = await api(`/api/challenge/${ch.id}/verify`, { method: "POST", body: { x, trail: trail.slice(-400), keyboard, device_id: deviceId() } });
      done = true; box.classList.add("ok"); label.textContent = "Verified"; note.textContent = "";
      onPass(r.token);
    } catch (e) {
      box.classList.add("bad"); note.textContent = e.message;
      setTimeout(() => { box.classList.remove("bad"); if (/Expired/.test(e.message)) load(); else { trail = []; place(0); } busy = false; }, 700);
    }
  }
  // pointer: mouse, pen or finger
  let startX = 0, startPos = 0;
  knob.addEventListener("pointerdown", (e) => {
    if (done || busy || !ch) return;
    knob.setPointerCapture(e.pointerId); startX = e.clientX; startPos = x; t0 = performance.now(); trail = [[0, x, e.clientY]];
  });
  knob.addEventListener("pointermove", (e) => {
    if (!knob.hasPointerCapture(e.pointerId)) return;
    const scale = max / (rail.clientWidth - knob.offsetWidth);  // the rail may be narrower or wider than the picture
    place(startPos + (e.clientX - startX) * scale);
    trail.push([Math.round(performance.now() - t0), Math.round(x * 10) / 10, e.clientY]);
  });
  knob.addEventListener("pointerup", (e) => { if (knob.hasPointerCapture(e.pointerId)) { knob.releasePointerCapture(e.pointerId); submit(false); } });
  // keyboard: arrows move it (Shift = bigger steps), Enter checks it
  knob.addEventListener("keydown", (e) => {
    if (done || !ch) return;
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (step) { e.preventDefault(); if (!trail.length) t0 = performance.now(); place(x + step * (e.shiftKey ? 10 : 2)); trail.push([Math.round(performance.now() - t0), x]); }
    if (e.key === "Enter") { e.preventDefault(); submit(true); }
  });
  load().catch((e) => { stage.replaceChildren(h("p", { class: "error" }, e.message)); });
  return { el: box, reset: load };
}

/** Webmail for an address, so the person can jump straight to the email with the code. */
function inboxLink(email) {
  const d = (email.split("@")[1] || "").toLowerCase();
  if (/^(gmail|googlemail)\.com$/.test(d)) return ["Open Gmail", "https://mail.google.com/mail/u/0/#search/AiversePulse"];
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(d)) return ["Open Outlook", "https://outlook.live.com/mail/0/"];
  if (/^yahoo\.[a-z.]+$/.test(d) || d === "ymail.com") return ["Open Yahoo Mail", "https://mail.yahoo.com/"];
  if (/^(icloud|me|mac)\.com$/.test(d)) return ["Open iCloud Mail", "https://www.icloud.com/mail"];
  return null;
}

// ---------------------------------------------------------------- sign up
export function registerView(app, { onSignedIn }) {
  const owl = new Owl({ size: 200, state: "greeting" });
  const err = h("p", { class: "error", role: "alert" });
  let type = "individual";
  const seg = h("div", { class: "seg account-type", role: "group", "aria-label": "Account type" },
    [["individual", "Individual"], ["hr", "HR advisor"]].map(([k, l]) => h("button", { type: "button", "aria-pressed": String(k === type),
      onclick: (e) => { type = k; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
        hint.textContent = k === "hr" ? "HR accounts are checked and approved by an administrator before first sign-in." : ""; } }, l)));
  const hint = h("p", { class: "signin-next" });
  const user = h("input", { class: "input", name: "username", autocomplete: "username", required: true, minlength: 3, maxlength: 40, pattern: "[a-zA-Z0-9_.\\-]{3,40}" });
  const email = h("input", { class: "input", name: "email", type: "email", autocomplete: "email", required: true, maxlength: 254 });
  const pwd = h("input", { class: "input", name: "password", type: "password", autocomplete: "new-password", required: true, minlength: 10, maxlength: 200 });
  const btn = h("button", { class: "btn primary", type: "submit", disabled: true }, "Create account");
  let pass = "";  // the slider pass (single use, required by the server)
  const slider = sliderCheck((t) => { pass = t; btn.disabled = false; }, () => { pass = ""; btn.disabled = true; });
  const form = h("form", { class: "signin-form", onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; err.textContent = "";
    try {
      const r = await api("/api/register", { method: "POST", body: { username: user.value, email: email.value, password: pwd.value, account_type: type, risk: signals(), challenge_token: pass } });
      after(r);
    } catch (ex) { err.textContent = ex.message; owl.set("confused"); slider.reset(); }  // a pass is single use: solve again
  } },
    h("a", { class: "signin-back", href: "#/start" }, icon("back"), "Back to home"),
    h("span", { class: "wordmark" }, "Create your account"),
    seg, hint,
    h("label", { class: "field" }, h("span", {}, "Username"), user),
    h("label", { class: "field" }, h("span", {}, "Email"), email),
    h("label", { class: "field" }, h("span", {}, "Password"), pwd, h("small", { class: "field-hint" }, "10+ characters with a capital letter and a digit")),
    h("div", { class: "field" }, h("span", {}, "Quick check"), slider.el),
    err, btn,
    h("p", { class: "signin-switch" }, "Already have an account? ", h("a", { href: "#/signin" }, "Sign in")));
  const signals = watchForm(form);
  const panel = h("div", { class: "signin-form-host" }, form);
  app.replaceChildren(h("main", { class: "signin" },
    h("section", { class: "signin-story" }, owl.el, h("h1", {}, "Start free. Upgrade when you need more.")), panel));
  user.focus();

  // the next step depends on what the server decided (email code, admin approval, or signed in)
  function after(r) {
    if (r.status === "active") { onSignedIn(); return; }
    if (r.status === "pending_email") { codeStep(r.username); return; }
    const hr = type === "hr";
    owl.set("idle");
    panel.replaceChildren(h("div", { class: "signin-form" },
      h("a", { class: "signin-back", href: "#/start" }, icon("back"), "Back to home"),
      h("span", { class: "wordmark" }, hr ? "Thanks — almost there" : "We need to check a few details"),
      h("p", { class: "signin-next" }, hr ? "An administrator reviews new HR accounts. You can sign in as soon as yours is approved."
        : "For your account's safety, an administrator will review this sign-up. You can sign in once it's approved."),
      h("a", { class: "btn", href: "#/signin" }, "Go to sign in")));
  }
  function codeStep(username) {
    const code = h("input", { class: "input code-input", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, pattern: "\\d{6}", required: true });
    const e2 = h("p", { class: "error", role: "alert" });
    const go = h("button", { class: "btn primary", type: "submit" }, "Verify");
    panel.replaceChildren(h("form", { class: "signin-form", onsubmit: async (ev) => {
      ev.preventDefault(); go.disabled = true; e2.textContent = "";
      try { after(await api("/api/register/verify", { method: "POST", body: { username, code: code.value } })); }
      catch (ex) { e2.textContent = ex.message; go.disabled = false; code.select(); }
    } },
      h("a", { class: "signin-back", href: "#/start" }, icon("back"), "Back to home"),
      h("span", { class: "wordmark" }, "Check your email"),
      h("p", { class: "signin-next" }, `We sent a sign-in link and a 6-digit code to ${email.value}. Click the link in the email, or enter the code here. Both expire in 10 minutes.`),
      inboxLink(email.value) ? h("a", { class: "btn inbox-btn", href: inboxLink(email.value)[1], target: "_blank", rel: "noopener noreferrer" },
        icon("ext"), inboxLink(email.value)[0]) : null,
      h("label", { class: "field" }, h("span", {}, "Code"), code), e2, go,
      h("button", { class: "btn ghost sm", type: "button", onclick: async () => { await api("/api/register/resend", { method: "POST", body: { username } }); toast("A new code is on its way"); } }, "Send a new code")));
    code.focus();
  }
}

// ---------------------------------------------------------------- plans and checkout
let stripeLoader = null;
const loadStripe = () => (stripeLoader ??= new Promise((ok, no) => {
  if (window.Stripe) return ok(window.Stripe);
  const s = h("script", { src: "https://js.stripe.com/v3/" });  // Stripe requires Stripe.js from its own domain
  s.onload = () => ok(window.Stripe); s.onerror = () => { stripeLoader = null; no(new Error("Could not load the payment form. Check your connection.")); };
  document.head.append(s);
}));

export async function pricingView(main, { me }) {
  main.replaceChildren(h("h1", { class: "page-title" }, "Plans"), h("p", { class: "muted" }, "Loading…"));
  const { plans, enabled } = await api("/api/billing/plans");
  const mine = me?.effective_plan;
  const hr = me?.role === "hr_advisor";
  const shown = plans.filter((p) => (me ? (hr ? p.for === "hr" || p.id === "free" : p.for === "individual") : true));
  const action = (p) => {
    if (!me) return h("a", { class: "btn primary", href: p.id === "free" ? "#/register" : "#/signin/pricing" }, p.id === "free" ? "Create a free account" : "Sign in to upgrade");
    if (mine === p.id || (mine === "org")) return h("span", { class: "tag approved" }, mine === "org" ? "Included with your organisation" : "Your plan");
    if (p.id === "free") return null;
    return h("button", { class: "btn primary", type: "button", disabled: enabled ? null : true, onclick: () => checkout(p, me) },
      enabled ? `Upgrade — ${money(p.price_cents, p.currency)}` : "Payments not set up yet");
  };
  main.replaceChildren(
    h("h1", { class: "page-title" }, "Plans"),
    h("p", { class: "lede" }, "Start free. Paid plans last 30 days and don't renew on their own."),
    enabled ? null : h("div", { class: "banner" }, icon("info"), "Payments are not set up on this server yet."),
    h("div", { class: "plan-grid" }, shown.map((p) => h("article", { class: `plan-card${p.id === "pro" ? " plan-featured" : ""}${mine === p.id ? " plan-current" : ""}` },
      h("h2", {}, p.name),
      h("p", { class: "plan-price" }, p.price_cents ? [h("b", {}, money(p.price_cents, p.currency)), h("span", {}, ` / ${p.days} days`)] : h("b", {}, "Free")),
      h("ul", {}, p.features.map((f) => h("li", {}, icon("check"), f))),
      action(p)))),
    h("p", { class: "muted plan-fine" }, "Test mode: use Stripe's test card 4242 4242 4242 4242, any future date and any CVC."));
}

async function checkout(plan, me) {
  const dlg = h("dialog", { class: "checkout" });
  const err = h("p", { class: "error", role: "alert" });
  const host = h("div", { class: "pay-element" }, h("p", { class: "muted" }, "Loading the secure card form…"));
  const pay = h("button", { class: "btn primary", type: "submit", disabled: true }, `Pay ${money(plan.price_cents, plan.currency)}`);
  dlg.append(h("form", { onsubmit: (e) => { e.preventDefault(); submit(); } },
    h("div", { class: "checkout-head" }, h("h2", {}, `${plan.name} · 30 days`), h("button", { class: "btn ghost sm", type: "button", onclick: () => dlg.close() }, "Cancel")),
    host, err, pay, h("p", { class: "muted checkout-fine" }, icon("check"), "Card details go straight to Stripe; AiversePulse never sees them.")));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
  let stripe, elements, intent;
  try {
    const [Stripe, i] = await Promise.all([loadStripe(), api("/api/billing/intent", { method: "POST", body: { plan: plan.id, risk: pageSignals() } })]);
    intent = i;
    stripe = Stripe(i.publishable_key);
    elements = stripe.elements({ clientSecret: i.client_secret, appearance: { theme: "stripe" } });
    host.replaceChildren();
    elements.create("payment").mount(host);
    pay.disabled = false;
  } catch (e) { err.textContent = e.message; return; }

  async function submit() {
    pay.disabled = true; err.textContent = "";
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required",
      confirmParams: { return_url: `${location.origin}${location.pathname}#/account` } });
    if (error) { err.textContent = error.message; pay.disabled = false; return; }
    try {
      const r = await api("/api/billing/confirm", { method: "POST", body: { intent_id: paymentIntent?.id || intent.intent_id } });
      if (!r.activated) { err.textContent = "The payment didn't go through. You weren't charged for the plan."; pay.disabled = false; return; }
      dlg.close(); toast(`You're on ${plan.name} until ${new Date(r.me.plan_until).toLocaleDateString()}`);
      location.hash = "#/account";
    } catch (e) { err.textContent = e.message; pay.disabled = false; }
  }
}

// ---------------------------------------------------------------- account: plan and payment history
export async function accountView(main, { refreshMe }) {
  main.replaceChildren(h("h1", { class: "page-title" }, "Your account"), h("p", { class: "muted" }, "Loading…"));
  // back from a 3-D Secure redirect: Stripe adds ?payment_intent=pi_... to the return URL
  const back = new URLSearchParams(location.search).get("payment_intent");
  if (back) {
    try { await api("/api/billing/confirm", { method: "POST", body: { intent_id: back } }); } catch { /* shown below as the payment's status */ }
    history.replaceState(null, "", `${location.pathname}#/account`);
  }
  const me = await refreshMe();
  const pays = await api("/api/billing/payments");
  const until = me.plan_until && ["pro", "team"].includes(me.effective_plan) ? new Date(me.plan_until).toLocaleDateString() : null;
  main.replaceChildren(
    h("h1", { class: "page-title" }, "Your account"),
    h("section", { class: "account-card" },
      h("div", {}, h("p", { class: "muted" }, "Signed in as"), h("b", {}, me.display_name || me.username), me.email ? h("p", { class: "muted" }, me.email) : null),
      h("div", {}, h("p", { class: "muted" }, "Plan"), h("b", { class: "plan-badge" }, planName(me.effective_plan)),
        until ? h("p", { class: "muted" }, `Active until ${until}`) : null),
      me.effective_plan !== "org" ? h("a", { class: "btn primary", href: "#/pricing" }, me.effective_plan === "free" ? "Upgrade" : "Extend or change plan") : null),
    h("section", { class: "block" }, h("h2", {}, "Payment history"),
      pays.length ? h("table", { class: "data pay-table" },
        h("thead", {}, h("tr", {}, ["Date", "Plan", "Amount", "Status", "Receipt"].map((t) => h("th", {}, t)))),
        h("tbody", {}, pays.map((p) => h("tr", {},
          h("td", {}, fmtTime(p.created_utc)), h("td", {}, planName(p.plan)), h("td", {}, money(p.amount_cents, p.currency)),
          h("td", {}, h("span", { class: `tag ${p.status === "succeeded" ? "approved" : p.status === "requires_payment_method" ? "flagged" : "draft"}` },
            p.status === "succeeded" ? "paid" : p.status.replaceAll("_", " "))),
          h("td", {}, p.receipt_url ? h("a", { href: p.receipt_url, target: "_blank", rel: "noopener noreferrer" }, "Receipt") : "–")))))
        : h("p", { class: "muted" }, "No payments yet.")));
}

// ---------------------------------------------------------------- the "Verify and sign in" link from the email
export async function verifyLinkView(app, { username, token, onSignedIn }) {
  const owl = new Owl({ size: 160, state: "searching" });
  const msg = h("p", { class: "signin-next" }, "Verifying your email…");
  app.replaceChildren(h("main", { class: "signin" }, h("section", { class: "signin-story" }, owl.el, h("h1", {}, "One moment.")),
    h("div", { class: "signin-form" }, h("span", { class: "wordmark" }, "AiversePulse"), msg)));
  try {
    const r = await api("/api/register/verify-link", { method: "POST", body: { username, token } });
    if (r.status === "active") { onSignedIn(); return; }
    owl.set("idle");
    msg.textContent = "Email verified. An administrator reviews new HR accounts; you can sign in once yours is approved.";
  } catch (e) {
    owl.set("confused");
    msg.replaceChildren(e.message, " ", h("a", { href: "#/signin" }, "Go to sign in"));
  }
}
