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

/** The slider in a pop-up: resolves with the server's pass, rejects if the person closes it. */
function sliderDialog(title = "Quick check") {
  return new Promise((resolve, reject) => {
    let passed = false;
    const dlg = h("dialog", { class: "slider-dialog", "aria-label": title });
    const check = sliderCheck((token) => { passed = true; setTimeout(() => { dlg.close(); resolve(token); }, 450); });
    dlg.append(h("div", { class: "sd-head" }, h("h2", {}, title), h("button", { class: "btn ghost sm", type: "button", "aria-label": "Close", onclick: () => dlg.close() }, "✕")),
      h("p", { class: "muted" }, "Drag the piece into the gap (or use the arrow keys, then Enter)."), check.el);
    dlg.addEventListener("close", () => { dlg.remove(); if (!passed) reject(new Error("Complete the quick check to continue.")); });
    document.body.append(dlg); dlg.showModal();
    dlg.querySelector(".sc-knob")?.focus();
  });
}

/** Six one-digit boxes: typing moves on, Backspace goes back, a pasted or autofilled code fills all of them. */
function otpBoxes(onComplete) {
  // no maxlength: phone code autofill and paste put the whole code in one box at once; the input handler spreads it
  const boxes = Array.from({ length: 6 }, (_, i) => h("input", { class: "otp-box", inputmode: "numeric", pattern: "\\d",
    autocomplete: i === 0 ? "one-time-code" : "off", "aria-label": `Digit ${i + 1} of 6` }));
  const value = () => boxes.map((b) => b.value).join("");
  const fill = (digits, from = 0) => {
    digits.split("").forEach((d, k) => { if (boxes[from + k]) boxes[from + k].value = d; });
    boxes[Math.min(5, from + digits.length)].focus();
    if (value().length === 6) onComplete(value());
  };
  boxes.forEach((b, i) => {
    b.addEventListener("input", () => {
      const digits = b.value.replace(/\D/g, "");
      b.value = "";
      if (digits) fill(digits.slice(0, 6 - i), i);
    });
    b.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !b.value && i > 0) { boxes[i - 1].value = ""; boxes[i - 1].focus(); e.preventDefault(); }
      if (e.key === "ArrowLeft" && i > 0) boxes[i - 1].focus();
      if (e.key === "ArrowRight" && i < 5) boxes[i + 1].focus();
    });
    b.addEventListener("paste", (e) => { e.preventDefault(); fill((e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6), 0); });
  });
  return { el: h("div", { class: "otp-boxes", role: "group", "aria-label": "6-digit code" }, boxes), value,
    clear: () => { boxes.forEach((b) => { b.value = ""; }); boxes[0].focus(); }, focus: () => boxes[0].focus() };
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

// ---------------------------------------------------------------- check your email: code boxes, inbox button, live "Email verified"
function codePanel(panel, owl, { username, email, waitToken }, after) {
  const e2 = h("p", { class: "error", role: "alert" });
  const state = h("p", { class: "verify-state", role: "status", "aria-live": "polite" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Waiting for you to verify…");
  let stop = false;
  const boxes = otpBoxes(async (code) => {
    e2.textContent = "";
    try { finished(await api("/api/register/verify", { method: "POST", body: { username, code } })); }
    catch (ex) { e2.textContent = ex.message; boxes.clear(); }
  });
  const inbox = inboxLink(email);
  panel.replaceChildren(h("div", { class: "signin-form" },
    h("a", { class: "signin-back", href: "#/start" }, icon("back"), "Back to home"),
    h("span", { class: "wordmark" }, "Check your email"),
    h("p", { class: "signin-next" }, `We sent a link and a 6-digit code to ${email}. Click the link in the email (on any device), or type the code below.`),
    inbox ? h("a", { class: "btn inbox-btn", href: inbox[1], target: "_blank", rel: "noopener noreferrer" }, icon("ext"), inbox[0]) : null,
    h("div", { class: "field" }, h("span", {}, "Code"), boxes.el), e2, state,
    h("button", { class: "btn ghost sm", type: "button", onclick: async () => { await api("/api/register/resend", { method: "POST", body: { username } }); toast("A new email is on its way"); } }, "Send a new email")));
  boxes.focus();
  // the link may be opened anywhere (a phone, another tab): keep asking, and finish here as soon as it is
  (async function poll() {
    while (!stop) {
      await new Promise((r) => setTimeout(r, 3000));
      if (stop || !document.body.contains(state)) return;
      try { const r = await api("/api/register/poll", { method: "POST", body: { username, wait_token: waitToken } }); if (r.status !== "pending_email") finished(r); }
      catch { /* offline for a moment: try again */ }
    }
  })();
  function finished(r) {
    if (stop) return;
    stop = true;
    owl.set("celebrating");
    state.replaceChildren(icon("check"), "Email verified");
    state.classList.add("ok");
    setTimeout(() => after(r), 900);  // show the confirmation, then continue
  }
}

/** Full page for signing in to an account whose email was never verified (a new code was just sent). */
export function emailCodeView(app, { username, email, waitToken, onSignedIn }) {
  const owl = new Owl({ size: 200, state: "idle" });
  const panel = h("div", { class: "signin-form-host" });
  app.replaceChildren(h("main", { class: "signin" }, h("section", { class: "signin-story" }, owl.el, h("h1", {}, "One more step.")), panel));
  const after = (r) => {
    if (r.status === "active") { onSignedIn(); return; }
    panel.replaceChildren(h("div", { class: "signin-form" }, h("span", { class: "wordmark" }, "Email verified"),
      h("p", { class: "signin-next" }, "An administrator will review this account. You can sign in once it's approved."),
      h("a", { class: "btn", href: "#/signin" }, "Go to sign in")));
  };
  codePanel(panel, owl, { username, email, waitToken }, after);
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
  const btn = h("button", { class: "btn primary", type: "submit" }, "Create account");
  const agree = h("input", { type: "checkbox", required: true, name: "accept_terms", "aria-label": "I agree to the Terms of Use and the Privacy Policy" });
  const form = h("form", { class: "signin-form", onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; err.textContent = "";
    try {
      const pass = await sliderDialog();  // pops up now; the server requires its single-use pass
      const r = await api("/api/register", { method: "POST", body: { username: user.value, email: email.value, password: pwd.value, account_type: type, risk: signals(), challenge_token: pass, accept_terms: agree.checked } });
      after(r);
    } catch (ex) { err.textContent = ex.message; owl.set("confused"); btn.disabled = false; }
  } },
    h("a", { class: "signin-back", href: "#/start" }, icon("back"), "Back to home"),
    h("span", { class: "wordmark" }, "Create your account"),
    seg, hint,
    h("label", { class: "field" }, h("span", {}, "Username"), user),
    h("label", { class: "field" }, h("span", {}, "Email"), email),
    h("label", { class: "field" }, h("span", {}, "Password"), pwd, h("small", { class: "field-hint" }, "10+ characters with a capital letter and a digit")),
    h("label", { class: "agree" }, agree, h("span", {}, "I agree to the ",
      h("a", { href: "#/terms", target: "_blank", rel: "noopener" }, "Terms of Use"), " and the ",
      h("a", { href: "#/privacy", target: "_blank", rel: "noopener" }, "Privacy Policy"), ", including how my data is used.")),
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
    if (r.status === "pending_email") { codePanel(panel, owl, { username: r.username, email: email.value, waitToken: r.wait_token }, after); return; }
    const hr = type === "hr";
    owl.set("idle");
    panel.replaceChildren(h("div", { class: "signin-form" },
      h("a", { class: "signin-back", href: "#/start" }, icon("back"), "Back to home"),
      h("span", { class: "wordmark" }, hr ? "Thanks — almost there" : "We need to check a few details"),
      h("p", { class: "signin-next" }, hr ? "An administrator reviews new HR accounts. You can sign in as soon as yours is approved."
        : "For your account's safety, an administrator will review this sign-up. You can sign in once it's approved."),
      h("a", { class: "btn", href: "#/signin" }, "Go to sign in")));
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
        : h("p", { class: "muted" }, "No payments yet.")),
    h("section", { class: "block privacy-block" }, h("h2", {}, "Your data"),
      h("p", {}, "See what we collect and why in the ", h("a", { href: "#/privacy" }, "Privacy Policy"), ", and the rules in the ",
        h("a", { href: "#/terms" }, "Terms of Use"), "."),
      me.terms_version ? h("p", { class: "muted" }, `You accepted the terms of ${me.terms_version}.`) : null),
    h("section", { class: "block danger-zone" }, h("h2", {}, "Delete account"),
      h("p", {}, "Deletes your login and your own plans, conversations, progress and interviews. Payment records are kept for accounting, without your name. This can't be undone."),
      me.role === "admin" ? h("p", { class: "muted" }, "Admin accounts are removed from the command line.")
        : h("button", { class: "btn danger", type: "button", onclick: () => deleteDialog() }, "Delete my account")));
}

function deleteDialog() {
  const pwd = h("input", { class: "input", type: "password", autocomplete: "current-password", required: true, maxlength: 200 });
  const typed = h("input", { class: "input", required: true, maxlength: 20, autocomplete: "off", placeholder: "DELETE" });
  const err = h("p", { class: "error", role: "alert" });
  const go = h("button", { class: "btn danger", type: "submit" }, "Delete my account");
  const dlg = h("dialog", { class: "checkout delete-dialog" }, h("form", { onsubmit: async (e) => {
    e.preventDefault(); go.disabled = true; err.textContent = "";
    try {
      await api("/api/account/delete", { method: "POST", body: { password: pwd.value, confirm: typed.value } });
      dlg.close(); location.replace("/");  // a fresh start as a guest on the home page
    } catch (ex) { err.textContent = ex.message; go.disabled = false; }
  } },
    h("div", { class: "checkout-head" }, h("h2", {}, "Delete your account?"), h("button", { class: "btn ghost sm", type: "button", onclick: () => dlg.close() }, "Cancel")),
    h("p", {}, "This permanently deletes your account and your own data. You'll be signed out."),
    h("label", { class: "field" }, h("span", {}, "Your password"), pwd),
    h("label", { class: "field" }, h("span", {}, "Type DELETE to confirm"), typed),
    err, go));
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal(); pwd.focus();
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

// ---------------------------------------------------------------- forgot password
export function forgotView(app) {
  const owl = new Owl({ size: 200, state: "idle" });
  const err = h("p", { class: "error", role: "alert" });
  const login = h("input", { class: "input", name: "username", autocomplete: "username", required: true, maxlength: 254 });
  const btn = h("button", { class: "btn primary", type: "submit" }, "Send reset email");
  const form = h("form", { class: "signin-form", onsubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; err.textContent = "";
    try {
      const pass = await sliderDialog();
      await api("/api/password/forgot", { method: "POST", body: { login: login.value, challenge_token: pass, risk: signals() } });
      step2();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  } },
    h("a", { class: "signin-back", href: "#/signin" }, icon("back"), "Back to sign in"),
    h("span", { class: "wordmark" }, "Forgot your password?"),
    h("p", { class: "signin-next" }, "Enter your username or email. If there's an account, we'll email a reset link and code."),
    h("label", { class: "field" }, h("span", {}, "Username or email"), login), err, btn);
  const signals = watchForm(form);
  const panel = h("div", { class: "signin-form-host" }, form);
  app.replaceChildren(h("main", { class: "signin" }, h("section", { class: "signin-story" }, owl.el, h("h1", {}, "It happens. Let's get you back in.")), panel));
  login.focus();

  function step2() {
    const e2 = h("p", { class: "error", role: "alert" });
    const pwd = h("input", { class: "input", type: "password", autocomplete: "new-password", required: true, minlength: 10, maxlength: 200 });
    const save = h("button", { class: "btn primary", type: "submit" }, "Set new password");
    const boxes = otpBoxes(() => pwd.focus());
    const inbox = login.value.includes("@") ? inboxLink(login.value) : null;
    panel.replaceChildren(h("form", { class: "signin-form", onsubmit: async (e) => {
      e.preventDefault(); e2.textContent = "";
      if (boxes.value().length !== 6) { e2.textContent = "Enter the 6-digit code from the email."; return; }
      save.disabled = true;
      try { await api("/api/password/reset", { method: "POST", body: { login: login.value, code: boxes.value(), password: pwd.value } }); done(panel); }
      catch (ex) { e2.textContent = ex.message; save.disabled = false; }
    } },
      h("a", { class: "signin-back", href: "#/signin" }, icon("back"), "Back to sign in"),
      h("span", { class: "wordmark" }, "Check your email"),
      h("p", { class: "signin-next" }, "If that account exists, we sent a reset link and a 6-digit code. Click the link, or enter the code and a new password here."),
      inbox ? h("a", { class: "btn inbox-btn", href: inbox[1], target: "_blank", rel: "noopener noreferrer" }, icon("ext"), inbox[0]) : null,
      h("div", { class: "field" }, h("span", {}, "Code"), boxes.el),
      h("label", { class: "field" }, h("span", {}, "New password"), pwd, h("small", { class: "field-hint" }, "10+ characters with a capital letter and a digit")),
      e2, save));
    boxes.focus();
  }
}

/** Shown after a successful reset (code or link). */
function done(panel) {
  panel.replaceChildren(h("div", { class: "signin-form" },
    h("span", { class: "wordmark" }, "Password changed"),
    h("p", { class: "verify-state ok" }, icon("check"), "You've been signed out everywhere. Sign in with your new password."),
    h("a", { class: "btn primary", href: "#/signin" }, "Sign in")));
}

/** The "Choose a new password" link from the reset email. */
export function resetLinkView(app, { username, token }) {
  const owl = new Owl({ size: 200, state: "idle" });
  const err = h("p", { class: "error", role: "alert" });
  const pwd = h("input", { class: "input", type: "password", autocomplete: "new-password", required: true, minlength: 10, maxlength: 200 });
  const btn = h("button", { class: "btn primary", type: "submit" }, "Set new password");
  const panel = h("div", { class: "signin-form-host" });
  panel.append(h("form", { class: "signin-form", onsubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; err.textContent = "";
    try { await api("/api/password/reset", { method: "POST", body: { username, token, password: pwd.value } }); done(panel); }
    catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  } },
    h("a", { class: "signin-back", href: "#/signin" }, icon("back"), "Back to sign in"),
    h("span", { class: "wordmark" }, "Choose a new password"),
    h("label", { class: "field" }, h("span", {}, "New password"), pwd, h("small", { class: "field-hint" }, "10+ characters with a capital letter and a digit")),
    err, btn));
  app.replaceChildren(h("main", { class: "signin" }, h("section", { class: "signin-story" }, owl.el, h("h1", {}, "Almost done.")), panel));
  pwd.focus();
}
