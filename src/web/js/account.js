// Accounts and billing pages: sign-up (with the emailed code), plans, Stripe Elements checkout, and the account page
// with payment history. Card details go from the browser straight to Stripe; the server only sees Stripe's ids.
import { api, apiBlobUrl, h, icon, toast, fmtTime, upload } from "./lib.js";
import { Owl } from "./owl.js";
import { watchForm, pageSignals, deviceId } from "./risk.js";

const money = (cents, cur) => new Intl.NumberFormat(undefined, { style: "currency", currency: (cur || "myr").toUpperCase() }).format(cents / 100);
const PLAN_NAME = { free: "Free", pro: "Pro", team: "Team", org: "Organisation" };
export const planName = (p) => PLAN_NAME[p] || p;

// The browser that starts a sign-up or password reset keeps a token. When the email link is opened here (any tab),
// the server sees it and carries on in this browser; opened anywhere else, it shows a code to type here instead.
const flow = {
  key: (purpose) => `ap.flow.${purpose}`,
  set(purpose, token) { try { localStorage.setItem(this.key(purpose), token); } catch { /* private mode: the code path still works */ } },
  get(purpose) { try { return localStorage.getItem(this.key(purpose)) || ""; } catch { return ""; } },
  clear(purpose) { try { localStorage.removeItem(this.key(purpose)); } catch { /* nothing kept */ } },
};

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
  flow.set("signup", waitToken);
  owl.set("update");
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
    h("p", { class: "signin-next" }, `We sent a link to ${email}. Open it in this browser and you're in. Opened on another device, it shows a 6-digit code: type it below.`),
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
    flow.clear("signup");
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
    h("label", { class: "field" }, h("span", {}, "Password"), pwd, h("small", { class: "field-hint" }, "At least 10 characters, including a capital letter and a number")),
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
      h("span", { class: "wordmark" }, hr ? "Thanks, almost there" : "We need to check a few details"),
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
  const { plans, enabled, publishable_key: pk } = await api("/api/billing/plans");
  const mine = me?.effective_plan;
  const hr = me?.role === "hr_advisor";
  const shown = plans.filter((p) => (me ? (hr ? p.for === "hr" || p.id === "free" : p.for === "individual") : true));
  const action = (p) => {
    if (!me) return h("a", { class: "btn primary", href: p.id === "free" ? "#/register" : "#/signin/pricing" }, p.id === "free" ? "Create a free account" : "Sign in to upgrade");
    if (mine === p.id || (mine === "org")) return h("span", { class: "tag approved" }, mine === "org" ? "Included with your organisation" : "Your plan");
    if (p.id === "free") return null;
    return h("button", { class: "btn primary", type: "button", disabled: enabled ? null : true, onclick: () => checkout(p, me) },
      enabled ? `Upgrade for ${money(p.price_cents, p.currency)}` : "Unavailable");
  };
  main.replaceChildren(
    h("h1", { class: "page-title" }, "Plans"),
    h("p", { class: "lede" }, "Start free. Pro lasts 30 days and doesn't renew on its own; Enterprise is a monthly subscription that renews until you stop it."),
    enabled ? null : h("div", { class: "banner" }, icon("info"), "Upgrades are temporarily unavailable."),
    h("div", { class: "plan-grid" }, shown.map((p) => h("article", { class: `plan-card${p.id === "pro" ? " plan-featured" : ""}${mine === p.id ? " plan-current" : ""}` },
      h("h2", {}, p.name),
      h("p", { class: "plan-price" }, p.price_cents ? [h("b", {}, money(p.price_cents, p.currency)), h("span", {}, p.monthly ? " / month, renews automatically" : ` / ${p.days} days`)] : h("b", {}, "Free")),
      h("ul", {}, p.features.map((f) => h("li", {}, icon("check"), f))),
      action(p)))),
    pk?.startsWith("pk_test_") ? h("p", { class: "muted plan-fine" }, "Test mode: use Stripe's test card 4242 4242 4242 4242, any future date and any CVC.") : null);
}

async function checkout(plan, me) {
  const dlg = h("dialog", { class: "checkout" });
  const err = h("p", { class: "error", role: "alert" });
  const host = h("div", { class: "pay-element" }, h("p", { class: "muted" }, "Loading the secure card form…"));
  const pay = h("button", { class: "btn primary", type: "submit", disabled: true }, `Pay ${money(plan.price_cents, plan.currency)}`);
  dlg.append(h("form", { onsubmit: (e) => { e.preventDefault(); submit(); } },
    h("div", { class: "checkout-head" }, h("h2", {}, plan.monthly ? `${plan.name} · monthly` : `${plan.name} · 30 days`), h("button", { class: "btn ghost sm", type: "button", onclick: () => dlg.close() }, "Cancel")),
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
// ---------------------------------------------------------------- profile: details, photo, email change
const PROFILE_LABELS = { display_name: "Name", email: "Email", phone: "Phone", title: "Job title", department: "Department" };

function profileSection(me, reload) {
  const p = me.profile || {};
  const ent = p.enterprise;
  const school = ent?.kind === "school";
  const field = (key, label, attrs = {}) => {
    const input = h("input", { class: "input", name: key, value: p[key] || "", maxlength: attrs.maxlength || 80, ...attrs });
    return [input, h("label", { class: "field" }, h("span", {}, label), input)];
  };
  const [name, nameF] = field("display_name", "Name", { required: true, autocomplete: "name" });
  const [phone, phoneF] = field("phone", "Phone", { type: "tel", autocomplete: "tel", maxlength: 30, placeholder: "+60 12-345 6789" });
  const [title, titleF] = field("title", school && me.role === "employee" ? "Programme / year" : "Job title");
  const [dept, deptF] = field("department", school ? "Faculty" : "Department");
  const isHr = me.role === "hr_advisor";
  const orgName = isHr ? h("input", { class: "input", maxlength: 100, value: ent?.name && ent.name !== me.username ? ent.name : "" }) : null;
  const orgKind = isHr ? h("select", { class: "input" }, [["company", "Company: members are employees"], ["school", "School: members are students"]]
    .map(([v, t]) => h("option", { value: v, selected: ent?.kind === v ? true : null }, t))) : null;
  const photo = h("div", { class: "avatar-lg", "aria-hidden": "true" }, (me.display_name || me.username || "?").slice(0, 1).toUpperCase());
  if (p.avatar_url) apiBlobUrl(p.avatar_url).then((u) => { if (u) photo.replaceChildren(h("img", { src: u, alt: "" })); });
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true, onchange: async () => {
    if (!file.files[0]) return;
    const form = new FormData(); form.append("file", file.files[0]);
    try { await upload("/api/profile/avatar", form); toast("Photo updated"); reload(); }
    catch (e) { toast(e.message, "err"); }
  } });
  const save = async (e) => {
    e.preventDefault();
    const body = { display_name: name.value, phone: phone.value, title: title.value, department: dept.value,
      ...(isHr ? { org_name: orgName.value, org_kind: orgKind.value } : {}) };
    try { await api("/api/profile", { method: "POST", body }); toast("Profile saved"); reload(); }
    catch (ex) { toast(ex.message, "err"); }
  };
  const newEmail = h("input", { class: "input", type: "email", autocomplete: "email", maxlength: 254, placeholder: "new@company.com", required: true });
  const emailForm = h("form", { class: "email-change", hidden: true, onsubmit: async (e) => {
    e.preventDefault();
    try { const r = await api("/api/profile/email", { method: "POST", body: { email: newEmail.value } });
      toast(r.sent ? `We sent a link to ${r.pending}` : "Saved; the email could not be sent, try again later"); reload(); }
    catch (ex) { toast(ex.message, "err"); }
  } }, newEmail, h("button", { class: "btn primary sm", type: "submit" }, "Send confirmation link"));
  const missing = (p.missing || []).filter((k) => k !== "email" || !me.email).map((k) => PROFILE_LABELS[k]);
  return h("section", { class: "block profile-block" },
    h("div", { class: "profile-head" }, h("h2", {}, "Profile"),
      ent ? h("span", { class: "tag" }, isHr ? (school ? "School" : "Company") : `${ent.member_label} · ${ent.name}`) : null),
    missing.length ? h("p", { class: "issue warning", role: "note" }, `Complete your profile: ${missing.join(", ")}.`) : null,
    h("div", { class: "profile-grid" },
      h("div", { class: "profile-photo" }, photo, file,
        h("button", { class: "btn sm", type: "button", onclick: () => file.click() }, icon("upload"), p.avatar_url ? "Change photo" : "Add photo"),
        h("small", { class: "muted" }, "PNG, JPEG or WebP, up to 2 MB")),
      h("form", { class: "profile-form", onsubmit: save },
        nameF,
        h("div", { class: "field" }, h("span", {}, "Email"),
          h("div", { class: "email-row" }, h("b", {}, me.email || "No email yet"),
            h("button", { class: "btn ghost sm", type: "button", onclick: () => { emailForm.hidden = !emailForm.hidden; if (!emailForm.hidden) newEmail.focus(); } }, me.email ? "Change" : "Add")),
          p.email_pending ? h("small", { class: "muted" }, `Waiting for you to open the link sent to ${p.email_pending}.`) : null,
          emailForm),
        phoneF, titleF, deptF,
        isHr ? h("label", { class: "field" }, h("span", {}, "Organisation name"), orgName) : null,
        isHr ? h("label", { class: "field" }, h("span", {}, "Organisation type"), orgKind) : null,
        h("div", { class: "profile-actions" }, h("button", { class: "btn primary", type: "submit" }, "Save profile")))));
}

// ---------------------------------------------------------------- enterprise monthly subscription (HR)
function subscriptionSection(reload) {
  const box = h("section", { class: "block sub-block" }, h("h2", {}, "Enterprise subscription"), h("p", { class: "muted" }, "Loading…"));
  api("/api/billing/subscription").then((d) => {
    const s = d.subscription;
    const live = s && ["active", "trialing"].includes(s.status);
    const renews = s?.current_period_end ? new Date(s.current_period_end).toLocaleDateString() : null;
    const toggle = async (renew) => {
      try { await api("/api/billing/subscription/renewal", { method: "POST", body: { renew } }); toast(renew ? "Renewal turned back on" : "It will end at the close of this month"); reload(); }
      catch (e) { toast(e.message, "err"); }
    };
    box.replaceChildren(h("h2", {}, "Enterprise subscription"),
      h("p", {}, h("b", {}, `${money(d.price_cents, d.currency)} / month`), " · renews automatically until you stop it."),
      live ? h("p", {}, h("span", { class: "tag approved" }, s.cancel_at_period_end ? "ends soon" : "active"), " ",
        s.cancel_at_period_end ? `Access continues until ${renews}.` : `Next payment on ${renews}.`)
        : h("p", { class: "muted" }, s ? `Status: ${s.status.replaceAll("_", " ")}.` : "Not subscribed yet."),
      h("div", { class: "profile-actions" },
        live ? h("button", { class: "btn", type: "button", onclick: () => toggle(!!s.cancel_at_period_end) }, s.cancel_at_period_end ? "Keep renewing" : "Stop renewing")
          : h("a", { class: "btn primary", href: "#/pricing" }, d.enabled ? "Subscribe monthly" : "Payments are not set up yet")));
  }).catch((e) => box.replaceChildren(h("h2", {}, "Enterprise subscription"), h("p", { class: "issue error" }, e.message)));
  return box;
}

export async function accountView(main, { refreshMe, hrLayout = false, tab = null }) {
  const render = (...all) => { const children = all.filter(Boolean);  // optional sections pass null
    main.replaceChildren(...(hrLayout ? [h("div", { class: "view hr-account-view" }, ...children)] : children)); };
  render(h("h1", { class: "page-title" }, hrLayout ? "Settings" : "Your account"), h("p", { class: "muted" }, "Loading…"));
  // back from a 3-D Secure redirect: Stripe adds ?payment_intent=pi_... to the return URL
  const back = new URLSearchParams(location.search).get("payment_intent");
  if (back) {
    try { await api("/api/billing/confirm", { method: "POST", body: { intent_id: back } }); } catch { /* shown below as the payment's status */ }
    history.replaceState(null, "", `${location.pathname}#/account`);
  }
  const me = await refreshMe();
  const pays = await api("/api/billing/payments");
  if (hrLayout) return settingsView(main, me, pays, tab, () => accountView(main, { refreshMe, hrLayout, tab }));
  const until = me.plan_until && ["pro", "team"].includes(me.effective_plan) ? new Date(me.plan_until).toLocaleDateString() : null;
  render(
    h("h1", { class: "page-title" }, "Your account"),
    h("section", { class: "account-card" },
      h("div", {}, h("p", { class: "muted" }, "Signed in as"), h("b", {}, me.display_name || me.username), me.email ? h("p", { class: "muted" }, me.email) : null),
      h("div", {}, h("p", { class: "muted" }, "Plan"), h("b", { class: "plan-badge" }, planName(me.effective_plan)),
        until ? h("p", { class: "muted" }, `Active until ${until}`) : null),
      me.effective_plan !== "org" ? h("a", { class: "btn primary", href: "#/pricing" }, me.effective_plan === "free" ? "Upgrade" : "Extend or change plan") : null),
    profileSection(me, () => accountView(main, { refreshMe, hrLayout })),
    me.role === "hr_advisor" ? subscriptionSection(() => accountView(main, { refreshMe, hrLayout })) : null,
    h("section", { class: "block" }, h("h2", {}, "Payment history"),
      pays.length ? h("table", { class: "data pay-table" },
        h("thead", {}, h("tr", {}, ["Date", "Plan", "Amount", "Status", "Receipt"].map((t) => h("th", {}, t)))),
        h("tbody", {}, pays.map((p) => h("tr", {},
          h("td", {}, fmtTime(p.created_utc)), h("td", {}, planName(p.plan)), h("td", {}, money(p.amount_cents, p.currency)),
          h("td", {}, h("span", { class: `tag ${p.status === "succeeded" ? "approved" : p.status === "requires_payment_method" ? "flagged" : "draft"}` },
            p.status === "succeeded" ? "paid" : p.status.replaceAll("_", " "))),
          h("td", {}, p.receipt_url ? h("a", { href: p.receipt_url, target: "_blank", rel: "noopener noreferrer" }, "Receipt") : "–")))))
        : h("p", { class: "muted" }, "No payments yet.")),
    memorySection(),
    h("section", { class: "block privacy-block" }, h("h2", {}, "Your data"),
      h("p", {}, "See what we collect and why in the ", h("a", { href: "#/privacy" }, "Privacy Policy"), ", and the rules in the ",
        h("a", { href: "#/terms" }, "Terms of Use"), "."),
      me.terms_version ? h("p", { class: "muted" }, `You accepted the terms of ${me.terms_version}.`) : null),
    h("section", { class: "block danger-zone" }, h("h2", {}, "Delete account"),
      h("p", {}, "Deletes your login and your own plans, conversations, progress and interviews. Payment records are kept for accounting, without your name. This can't be undone."),
      me.role === "admin" ? h("p", { class: "muted" }, "Admin accounts are removed from the command line.")
        : h("button", { class: "btn danger", type: "button", onclick: () => deleteDialog() }, "Delete my account")));
}

/** What the agent remembers about this person across chats; they can remove any fact or all of them. */
function memorySection() {
  const list = h("div", { class: "memory-list" }, h("p", { class: "muted" }, "Loading…"));
  const box = h("section", { class: "block memory-block" }, h("h2", {}, "Memory"),
    h("p", { class: "muted" }, "Facts the agent learned about you in your chats, so every new chat picks up where you left off. Only you and your agent see them."),
    list);
  const draw = () => api("/api/memory").then(({ facts }) => {
    list.replaceChildren(...(facts.length ? [
      ...facts.map((f) => h("div", { class: "set-row memory-row" },
        h("div", {}, h("span", { class: "set-label" }, f.fact), h("p", { class: "set-sub" }, `Learned ${f.since}`)),
        h("div", { class: "set-ctl" }, h("button", { class: "btn sm", type: "button", "aria-label": `Forget: ${f.fact}`, onclick: async () => {
          try { await api(`/api/memory/${f.id}`, { method: "DELETE" }); toast("Forgotten"); draw(); } catch (e) { toast(e.message, "err"); }
        } }, "Forget")))),
      h("div", { class: "set-row" }, h("span", { class: "set-label" }, "Forget everything"),
        h("div", { class: "set-ctl" }, h("button", { class: "btn sm danger", type: "button", onclick: async () => {
          if (!confirm("Clear everything the agent remembers about you?")) return;
          try { await api("/api/memory", { method: "DELETE" }); toast("Memory cleared"); draw(); } catch (e) { toast(e.message, "err"); }
        } }, "Clear memory")))]
      : [h("p", { class: "muted" }, "Nothing yet. Tell the agent about your goals, background and how you like to learn, and it will remember.")]));
  }).catch((e) => list.replaceChildren(h("p", { class: "issue error" }, e.message)));
  draw();
  return box;
}

// HR console settings: a section list on the left, label-left / control-right rows on the right (#/account/<tab>).
const SETTINGS_TABS = [["profile", "Profile", "user"], ["memory", "Memory", "history"], ["billing", "Plan & billing", "nav-payments"], ["privacy", "Privacy", "info"], ["account", "Account", "sliders"]];

function payTable(pays) {
  return pays.length ? h("div", { class: "table-wrap" }, h("table", { class: "data pay-table" },
    h("thead", {}, h("tr", {}, ["Date", "Plan", "Amount", "Status", "Receipt"].map((t) => h("th", {}, t)))),
    h("tbody", {}, pays.map((p) => h("tr", {},
      h("td", {}, fmtTime(p.created_utc)), h("td", {}, planName(p.plan)), h("td", {}, money(p.amount_cents, p.currency)),
      h("td", {}, h("span", { class: `tag ${p.status === "succeeded" ? "approved" : p.status === "requires_payment_method" ? "flagged" : "draft"}` },
        p.status === "succeeded" ? "paid" : p.status.replaceAll("_", " "))),
      h("td", {}, p.receipt_url ? h("a", { href: p.receipt_url, target: "_blank", rel: "noopener noreferrer" }, "Receipt") : "–"))))))
    : h("p", { class: "muted" }, "No payments yet.");
}

function settingsView(main, me, pays, tab, reload) {
  const cur = SETTINGS_TABS.some(([k]) => k === tab) ? tab : "profile";
  const row = (label, sub, control) => h("div", { class: "set-row" },
    h("div", {}, h("span", { class: "set-label" }, label), sub ? h("p", { class: "set-sub" }, sub) : null), h("div", { class: "set-ctl" }, control));
  const group = (title, ...rows) => h("section", { class: "set-group" }, title ? h("h2", {}, title) : null, ...rows.filter(Boolean));
  const signOut = async () => { await api("/api/logout", { method: "POST" }).catch(() => {}); location.reload(); };
  const body = {
    profile: () => [profileSection(me, reload)],
    memory: () => [memorySection()],
    billing: () => [
      group("Plan", row("Current plan", null, h("span", { class: "set-pill" }, planName(me.effective_plan)))),
      me.role === "hr_advisor" ? subscriptionSection(reload) : null,
      group("Payment history", payTable(pays))],
    privacy: () => [group("Your data",
      row("Privacy Policy", "What we collect and why.", h("a", { class: "btn sm", href: "#/privacy" }, "Read")),
      row("Terms of Use", me.terms_version ? `You accepted the terms of ${me.terms_version}.` : null, h("a", { class: "btn sm", href: "#/terms" }, "Read")))],
    account: () => [group("Account",
      row("Log out", "End this session on this device.", h("button", { class: "btn sm", type: "button", onclick: signOut }, "Log out")),
      row("Delete account", "Deletes your login and your own plans, conversations, progress and interviews. Payment records are kept for accounting, without your name.",
        me.role === "admin" ? h("span", { class: "muted" }, "Removed from the command line.")
          : h("button", { class: "btn sm danger", type: "button", onclick: () => deleteDialog() }, "Delete")),
      row("Your role", null, h("span", { class: "set-pill" }, me.role === "hr_advisor" ? "HR advisor" : me.role)),
      me.enterprise?.name ? row("Organisation", null, h("span", {}, me.enterprise.name)) : null,
      row("Username", null, h("code", { class: "set-pill mono" }, me.username)))],
  }[cur]().filter(Boolean);
  main.replaceChildren(h("div", { class: "view settings-view" },
    h("h1", { class: "page-title" }, "Settings"),
    h("div", { class: "settings-shell" },
      h("nav", { class: "settings-nav", "aria-label": "Settings sections" }, SETTINGS_TABS.map(([k, label, ic]) =>
        h("a", { href: `#/account/${k}`, "aria-current": k === cur ? "page" : null }, icon(ic), h("span", {}, label)))),
      h("div", { class: "settings-body" }, ...body))));
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

// ---------------------------------------------------------------- the links from the emails
/** Opened on a device that didn't start the flow: show the code to type in the browser that did. */
function showCode(panel, owl, code, where) {
  owl.set("update");
  panel.replaceChildren(h("div", { class: "signin-form" },
    h("span", { class: "wordmark" }, "Your code"),
    h("p", { class: "signin-next" }, `This browser didn't start ${where}. Type this code in the browser where you did:`),
    h("p", { class: "code-show num", "aria-label": `Code ${code.split("").join(" ")}` }, code),
    h("p", { class: "signin-next" }, "It works once and expires in 10 minutes. Nothing was signed in on this device."),
    h("a", { class: "btn ghost sm", href: "#/start" }, icon("back"), "Back to home")));
}

function linkPage(app, owlState, title) {
  const owl = new Owl({ size: 200, state: owlState });
  const panel = h("div", { class: "signin-form-host" }, h("div", { class: "signin-form" }, h("span", { class: "wordmark" }, "AiversePulse"),
    h("p", { class: "signin-next" }, "One moment…")));
  app.replaceChildren(h("main", { class: "signin" }, h("section", { class: "signin-story" }, owl.el, h("h1", {}, title)), panel));
  return { owl, panel };
}

function linkFailed(panel, owl, message) {
  owl.set("confused");
  panel.replaceChildren(h("div", { class: "signin-form" }, h("span", { class: "wordmark" }, "Link not valid"),
    h("p", { class: "error", role: "alert" }, message), h("a", { class: "btn", href: "#/signin" }, "Go to sign in")));
}

export async function verifyLinkView(app, { username, token, onSignedIn }) {
  const { owl, panel } = linkPage(app, "searching", "Checking your email link.");
  try {
    const r = await api("/api/email/open", { method: "POST", body: { purpose: "signup", username, token, wait_token: flow.get("signup") } });
    if (!r.same_browser) { showCode(panel, owl, r.code, "this sign-up"); return; }
    flow.clear("signup");
    owl.set("celebrating");
    if (r.status === "active") { onSignedIn(); return; }
    panel.replaceChildren(h("div", { class: "signin-form" }, h("span", { class: "wordmark" }, "Email verified"),
      h("p", { class: "signin-next" }, "An administrator reviews new HR accounts. You can sign in once yours is approved."),
      h("a", { class: "btn", href: "#/signin" }, "Go to sign in")));
  } catch (e) { linkFailed(panel, owl, e.message); }
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
      const r = await api("/api/password/forgot", { method: "POST", body: { login: login.value, challenge_token: pass, risk: signals() } });
      flow.set("reset", r.wait_token);
      owl.set("reminder");
      step2();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  } },
    h("a", { class: "signin-back", href: "#/signin" }, icon("back"), "Back to sign in"),
    h("span", { class: "wordmark" }, "Forgot your password?"),
    h("p", { class: "signin-next" }, "Enter your username or email. If there's an account, we'll email you a reset link."),
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
      try { await api("/api/password/reset", { method: "POST", body: { login: login.value, code: boxes.value(), password: pwd.value } }); flow.clear("reset"); owl.set("celebrating"); done(panel); }
      catch (ex) { e2.textContent = ex.message; save.disabled = false; }
    } },
      h("a", { class: "signin-back", href: "#/signin" }, icon("back"), "Back to sign in"),
      h("span", { class: "wordmark" }, "Check your email"),
      h("p", { class: "signin-next" }, "If that account exists, we sent a reset link. Open it in this browser to choose a new password. Opened on another device, it shows a 6-digit code: type it here with a new password."),
      inbox ? h("a", { class: "btn inbox-btn", href: inbox[1], target: "_blank", rel: "noopener noreferrer" }, icon("ext"), inbox[0]) : null,
      h("div", { class: "field" }, h("span", {}, "Code"), boxes.el),
      h("label", { class: "field" }, h("span", {}, "New password"), pwd, h("small", { class: "field-hint" }, "At least 10 characters, including a capital letter and a number")),
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

/** The "Reset password" link from the email. */
export async function resetLinkView(app, { username, token }) {
  const { owl, panel } = linkPage(app, "reminder", "Almost done.");
  const wait = flow.get("reset");
  try {
    const r = await api("/api/email/open", { method: "POST", body: { purpose: "reset", username, token, wait_token: wait } });
    if (!r.same_browser) { showCode(panel, owl, r.code, "this password reset"); return; }
  } catch (e) { linkFailed(panel, owl, e.message); return; }
  owl.set("idle");
  const err = h("p", { class: "error", role: "alert" });
  const pwd = h("input", { class: "input", type: "password", autocomplete: "new-password", required: true, minlength: 10, maxlength: 200 });
  const btn = h("button", { class: "btn primary", type: "submit" }, "Set new password");
  panel.replaceChildren(h("form", { class: "signin-form", onsubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; err.textContent = "";
    try {
      await api("/api/password/reset", { method: "POST", body: { username, token, wait_token: wait, password: pwd.value } });
      flow.clear("reset"); owl.set("celebrating"); done(panel);
    } catch (ex) { err.textContent = ex.message; owl.set("confused"); btn.disabled = false; }
  } },
    h("a", { class: "signin-back", href: "#/signin" }, icon("back"), "Back to sign in"),
    h("span", { class: "wordmark" }, "Choose a new password"),
    h("label", { class: "field" }, h("span", {}, "New password"), pwd, h("small", { class: "field-hint" }, "At least 10 characters, including a capital letter and a number")),
    err, btn));
  pwd.focus();
}

// ---------------------------------------------------------------- invite from an HR advisor (no sign-up page)
export async function inviteView(app, { username, token, onSignedIn }) {
  const { owl, panel } = linkPage(app, "greeting", "Welcome to the team.");
  let inv;
  try { inv = await api("/api/invite/check", { method: "POST", body: { username, token } }); }
  catch (e) { linkFailed(panel, owl, e.message); return; }
  const err = h("p", { class: "error", role: "alert" });
  const pwd = h("input", { class: "input", type: "password", autocomplete: "new-password", required: true, minlength: 10, maxlength: 200 });
  const agree = h("input", { type: "checkbox", required: true, "aria-label": "I agree to the Terms of Use and the Privacy Policy" });
  const btn = h("button", { class: "btn primary", type: "submit" }, "Join and sign in");
  panel.replaceChildren(h("form", { class: "signin-form", onsubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; err.textContent = "";
    try {
      await api("/api/invite/accept", { method: "POST", body: { username, token, password: pwd.value, accept_terms: agree.checked } });
      owl.set("celebrating"); onSignedIn();
    } catch (ex) { err.textContent = ex.message; owl.set("confused"); btn.disabled = false; }
  } },
    h("span", { class: "wordmark" }, "Accept your invite"),
    h("p", { class: "signin-next" }, `${inv.invited_by} invited ${inv.email}. Choose a password to finish.`),
    h("label", { class: "field" }, h("span", {}, "Username"), h("input", { class: "input", value: inv.username, readonly: true, autocomplete: "username" })),
    h("label", { class: "field" }, h("span", {}, "Password"), pwd, h("small", { class: "field-hint" }, "At least 10 characters, including a capital letter and a number")),
    h("label", { class: "agree" }, agree, h("span", {}, "I agree to the ",
      h("a", { href: "#/terms", target: "_blank", rel: "noopener" }, "Terms of Use"), " and the ",
      h("a", { href: "#/privacy", target: "_blank", rel: "noopener" }, "Privacy Policy"), ".")),
    err, btn));
  pwd.focus();
}
