// Accounts and billing pages: sign-up (with the emailed code), plans, Stripe Elements checkout, and the account page
// with payment history. Card details go from the browser straight to Stripe; the server only sees Stripe's ids.
import { api, h, icon, toast, fmtTime } from "./lib.js";
import { Owl } from "./owl.js";
import { watchForm, pageSignals } from "./risk.js";

const money = (cents, cur) => new Intl.NumberFormat(undefined, { style: "currency", currency: (cur || "myr").toUpperCase() }).format(cents / 100);
const PLAN_NAME = { free: "Free", pro: "Pro", team: "Team", org: "Organisation" };
export const planName = (p) => PLAN_NAME[p] || p;

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
  const pass = h("input", { class: "input", name: "password", type: "password", autocomplete: "new-password", required: true, minlength: 10, maxlength: 200 });
  const btn = h("button", { class: "btn primary", type: "submit" }, "Create account");
  const form = h("form", { class: "signin-form", onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; err.textContent = "";
    try {
      const r = await api("/api/register", { method: "POST", body: { username: user.value, email: email.value, password: pass.value, account_type: type, risk: signals() } });
      after(r);
    } catch (ex) { err.textContent = ex.message; owl.set("confused"); btn.disabled = false; }
  } },
    h("a", { class: "signin-back", href: "#/start" }, icon("back"), "Back to home"),
    h("span", { class: "wordmark" }, "Create your account"),
    seg, hint,
    h("label", { class: "field" }, h("span", {}, "Username"), user),
    h("label", { class: "field" }, h("span", {}, "Email"), email),
    h("label", { class: "field" }, h("span", {}, "Password"), pass, h("small", { class: "field-hint" }, "10+ characters with a capital letter and a digit")),
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
      h("p", { class: "signin-next" }, `We sent a 6-digit code to ${email.value}. It expires in 10 minutes.`),
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
