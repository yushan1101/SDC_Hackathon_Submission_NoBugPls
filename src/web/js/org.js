// HR console: the organisation's people (invited by email; they never use the sign-up page) and the hiring
// plugins (company accounts the posting agent sends openings to).
import { api, h, icon, toast, fmtTime } from "./lib.js";
import { Owl } from "./owl.js";
import { micButton, readAloudButton } from "./voice.js";

const STATUS_TAG = { active: "approved", invited: "draft", disabled: "flagged" };

// Platform logos: Simple Icons (simpleicons.org, v13.21.0, CC0), copied in. Trademarks of their owners.
const BRANDS = {
  linkedin: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  facebook: "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
  x: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  telegram: "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
  discord: "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z",
  slack: "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z",
};
const mark = (id) => {
  const el = h("span", { class: `plugin-mark p-${id}`, "aria-hidden": "true" });
  el.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="${BRANDS[id]}"/></svg>`;  // static, authored above
  return el;
};


// ---------------------------------------------------------------- team members
export async function peopleView(main, status) {
  const people = await api("/api/org/users");
  const err = h("p", { class: "error", role: "alert" });
  const email = h("input", { class: "input", type: "email", required: true, maxlength: 254, placeholder: "name@company.com", autocomplete: "off" });
  const name = h("input", { class: "input", maxlength: 60, placeholder: "Display name (optional)" });
  const send = h("button", { class: "btn primary", type: "submit" }, icon("mail"), "Send invite");
  const act = (fn, done) => async () => { try { await fn(); toast(done); peopleView(main, status); } catch (e) { toast(e.message, "err"); } };
  const row = (p) => h("tr", {},
    h("td", {}, h("b", {}, p.display_name), h("div", { class: "muted mono" }, p.username)),
    h("td", { class: "hide-sm" }, p.email),
    h("td", {}, h("span", { class: `tag ${STATUS_TAG[p.status] || "draft"}` }, p.status === "invited" ? "invite sent" : p.status)),
    h("td", { class: "mono hide-sm" }, fmtTime(p.created_utc)),
    h("td", {}, h("div", { class: "row-actions" },
      p.status === "invited"
        ? h("button", { class: "btn sm", type: "button", onclick: act(() => api(`/api/org/users/${p.username}/resend`, { method: "POST" }), `New invite sent to ${p.email}`) }, "Resend")
        : h("button", { class: "btn sm", type: "button", onclick: act(() => api(`/api/org/users/${p.username}/status`, { method: "POST", body: { status: p.status === "active" ? "disabled" : "active" } }),
          `${p.display_name} ${p.status === "active" ? "disabled" : "enabled"}`) }, p.status === "active" ? "Disable" : "Enable"),
      h("button", { class: "btn sm ghost", type: "button", onclick: () => {
        const what = p.status === "invited" ? `Withdraw the invite for ${p.email}?` : `Remove ${p.display_name}? Their account and personal data are deleted.`;
        if (confirm(what)) act(() => api(`/api/org/users/${p.username}`, { method: "DELETE" }), p.status === "invited" ? "Invite withdrawn" : "Removed")();
      } }, p.status === "invited" ? "Withdraw" : "Remove"))));
  main.replaceChildren(h("div", { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "Team members"),
      h("span", { class: "muted", style: { "font-size": "14px" } }, "People join by your email invite, not the sign-up page.")),
    h("div", { class: "overview" },
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Your organisation"), h("span", { class: "muted num", style: { "font-size": "14px" } }, `${people.length}`)),
        people.length ? h("div", { class: "table-wrap" }, h("table", { class: "data" },
          h("thead", {}, h("tr", {}, h("th", {}, "Person"), h("th", { class: "hide-sm" }, "Email"), h("th", {}, "Status"), h("th", { class: "hide-sm" }, "Added"), h("th", {}, ""))),
          h("tbody", {}, people.map(row))))
          : h("div", { class: "pad empty" }, new Owl({ size: 64, state: "greeting" }).el, h("p", { class: "muted" }, "No one yet. Invite your first team member."))),
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Invite someone")),
        h("form", { class: "pad", style: { display: "grid", gap: "12px" }, onsubmit: async (e) => {
          e.preventDefault(); send.disabled = true; err.textContent = "";
          try {
            const r = await api("/api/org/invite", { method: "POST", body: { email: email.value, display_name: name.value } });
            status.set("update", `Invite sent to ${r.email}`);
            toast(r.emailed ? `Invite emailed to ${r.email}` : "Invite created, but the email couldn't be sent. Contact your administrator.");
            peopleView(main, status);
          } catch (ex) { err.textContent = ex.message; status.set("confused", "Invite not sent"); send.disabled = false; }
        } },
          h("label", { class: "field" }, h("span", {}, "Work email"), email),
          h("label", { class: "field" }, h("span", {}, "Name"), name),
          err, send,
          h("p", { class: "note" }, "They get an email with a link (valid 7 days) to choose a password. Their account is on your organisation's plan. You can disable or remove it at any time."))))));
}

// ---------------------------------------------------------------- hiring plugins
const HOW = {
  linkedin: "Posts to your company page. Needs the page's numeric id (in its admin URL: linkedin.com/company/<id>/admin).",
  facebook: "Posts to the Facebook Pages you pick when Facebook asks.",
  x: "Posts from the X account you sign in with.",
  telegram: "Create a bot with @BotFather, add it as an admin of your channel, then paste its token and the @channel.",
  discord: "Channel settings → Integrations → Webhooks → New webhook → Copy URL.",
  slack: "Create an Incoming Webhook for the channel (api.slack.com/messaging/webhooks) and paste its URL.",
};

export async function pluginsView(main, status, result) {
  if (result) {  // back from a platform's sign-in page
    toast({ connected: "Account connected", failed: "Couldn't connect the account. Try again.", cancelled: "Sign-in cancelled" }[result] || "", result === "connected" ? "" : "err");
    history.replaceState(null, "", "#/plugins");
  }
  const d = await api("/api/plugins");
  const conn = (c) => h("li", { class: "plugin-conn" },
    mark(c.platform),
    h("div", {}, h("b", {}, c.label), h("div", { class: "muted" }, c.platform_name, c.expired ? h("span", { class: "tag flagged" }, " sign-in expired: reconnect") : null)),
    h("label", { class: "switch" }, h("input", { type: "checkbox", checked: c.auto, onchange: async (e) => {
      try { await api(`/api/plugins/${c.id}/auto`, { method: "POST", body: { auto: e.target.checked } }); toast(e.target.checked ? "New openings post here automatically" : "Posts here only when you choose"); }
      catch (ex) { toast(ex.message, "err"); e.target.checked = !e.target.checked; }
    } }), h("span", {}, "Auto-post new openings")),
    h("button", { class: "btn sm ghost", type: "button", onclick: async () => {
      if (!confirm(`Disconnect ${c.label}?`)) return;
      await api(`/api/plugins/${c.id}`, { method: "DELETE" }); toast("Disconnected"); pluginsView(main, status);
    } }, "Disconnect"));
  const card = (p) => {
    const err = h("p", { class: "error", role: "alert" });
    const fields = p.id === "telegram" ? [["bot_token", "Bot token", "123456:ABC…"], ["chat_id", "Channel", "@yourchannel"]]
      : p.id === "linkedin" ? [["org_id", "Company page id", "12345678"]]
      : ["discord", "slack"].includes(p.id) ? [["webhook_url", "Webhook URL", "https://…"], ["label", "Name (optional)", "#jobs"]] : [];
    const inputs = Object.fromEntries(fields.map(([k, , ph]) => [k, h("input", { class: "input", maxlength: 300, placeholder: ph, autocomplete: "off",
      type: k === "bot_token" || k === "webhook_url" ? "password" : "text" })]));
    const go = h("button", { class: "btn primary sm", type: "submit", disabled: !p.available }, p.oauth ? `Sign in with ${p.name.split(" ")[0]}` : "Connect");
    return h("form", { class: "plugin-card", onsubmit: async (e) => {
      e.preventDefault(); go.disabled = true; err.textContent = "";
      const body = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim()]));
      try {
        if (p.oauth) { location.href = (await api(`/api/plugins/oauth/${p.id}/start`, { method: "POST", body })).url; return; }
        await api("/api/plugins/connect", { method: "POST", body: { platform: p.id, ...body } });
        toast(`${p.name} connected`); status.set("matched", `${p.name} connected`); pluginsView(main, status);
      } catch (ex) { err.textContent = ex.message; go.disabled = false; }
    } },
      h("header", {}, mark(p.id), h("h3", {}, p.name)),
      h("p", { class: "muted" }, HOW[p.id]),
      ...fields.map(([k, label]) => h("label", { class: "field" }, h("span", {}, label), inputs[k])),
      p.available ? null : h("p", { class: "note" }, "Not available yet. Ask your administrator to set this up."),
      err, go);
  };
  main.replaceChildren(h("div", { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "Hiring plugins"),
      h("span", { class: "muted", style: { "font-size": "14px" } }, "Connect company accounts to share new openings automatically. Each post is written for its platform.")),
    h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Connected accounts"), h("span", { class: "muted num", style: { "font-size": "14px" } }, `${d.connections.length}`)),
      d.connections.length ? h("ul", { class: "plugin-list pad" }, d.connections.map(conn))
        : h("div", { class: "pad empty" }, new Owl({ size: 64, state: "listening" }).el, h("p", { class: "muted" }, "Nothing connected yet. Add an account below."))),
    h("div", { class: "plugin-grid" }, d.platforms.map(card))));
}

/** On an opening: send it to every connected account now, and what was posted where. */
export async function publishPanel(id, status, isOpen) {
  const [d, posts] = await Promise.all([api("/api/plugins"), api(`/api/openings/${id}/posts`)]);
  const list = h("ul", { class: "post-log" });
  const draw = (rows) => list.replaceChildren(...rows.map((r) => h("li", { class: r.status === "posted" ? "ok" : "bad" },
    h("b", {}, r.platform_name), " · ", r.label, " · ",
    r.status === "posted" ? (r.url ? h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, "posted", icon("ext")) : "posted") : h("span", {}, r.error),
    r.at_utc ? h("span", { class: "muted mono" }, ` ${fmtTime(r.at_utc)}`) : null)));
  draw(posts);
  const go = h("button", { class: "btn primary", type: "button", disabled: !d.connections.length || !isOpen, onclick: async () => {
    go.disabled = true; status.set("update", "Posting…");
    try {
      const r = await api(`/api/openings/${id}/publish`, { method: "POST", body: {} });
      const ok = r.results.filter((x) => x.status === "posted").length;
      status.set(ok === r.results.length ? "celebrating" : "confused", `Posted to ${ok} of ${r.results.length}`);
      draw(await api(`/api/openings/${id}/posts`));
    } catch (e) { toast(e.message, "err"); status.set("confused", "Not posted"); }
    go.disabled = false;
  } }, icon("share"), `Post to ${d.connections.length} account${d.connections.length === 1 ? "" : "s"}`);
  return h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Share this opening")),
    h("div", { class: "pad", style: { display: "grid", gap: "12px" } },
      d.connections.length ? go : h("p", { class: "muted" }, "No accounts connected. ", h("a", { href: "#/plugins" }, "Add hiring plugins"), " to post openings to LinkedIn, Facebook, X, Telegram, Discord or Slack."),
      isOpen ? null : h("p", { class: "note" }, "Closed openings aren't posted."),
      list));
}

// ---------------------------------------------------------------- ask about your team (plain language, typed or spoken)
export function askPanel(status, plan) {
  const q = h("input", { class: "input", maxlength: 500, placeholder: "e.g. Who is closest to a data analyst role?", "aria-label": "Your question" });
  const out = h("div", { class: "ask-answer", "aria-live": "polite" });
  const go = h("button", { class: "btn primary", type: "submit" }, "Ask");
  const paid = ["team", "org"].includes(plan);
  const form = h("form", { class: "ask-row", onsubmit: async (e) => {
    e.preventDefault();
    if (q.value.trim().length < 3) return;
    go.disabled = true; status.set("thinking", "Looking through your team's data");
    try {
      const r = await api("/api/hr/ask", { method: "POST", body: { question: q.value.trim() } });
      out.replaceChildren(h("p", {}, r.answer), readAloudButton(() => r.answer),
        r.employees.length ? h("p", { class: "muted" }, "Based on: ", ...r.employees.map((id, i) => [i ? ", " : "", h("span", { class: "mono" }, id)])) : null);
      status.set("matched", "Answered");
    } catch (ex) { out.replaceChildren(h("p", { class: "error" }, ex.message)); status.set("confused", "No answer"); }
    go.disabled = false;
  } }, q, micButton(q), go);
  return h("section", { class: "panel ask-panel" }, h("header", {}, h("h2", {}, "Ask about your team")),
    h("div", { class: "pad", style: { display: "grid", gap: "10px" } },
      paid ? form : h("p", { class: "muted" }, "Ask questions about your team's plans and hiring in plain language. Part of the Team plan. ",
        h("a", { href: "./#/pricing" }, "See plans")),
      out));
}

// ---------------------------------------------------------------- AI models per task, for this organisation
export async function modelsView(main, status) {
  const d = await api("/api/org/models");
  const row = (t) => {
    const pick = h("select", { class: "input", "aria-label": `Model for ${t.label}`, onchange: async () => {
      try {
        await api("/api/org/models", { method: "POST", body: { task: t.id, spec: pick.value } });
        toast(pick.value ? `${t.label}: now using ${pick.selectedOptions[0].textContent}` : `${t.label}: back to the default`);
        status.set("matched", "Model saved");
      } catch (e) { toast(e.message, "err"); }
    } },
      h("option", { value: "" }, `Default${t.default ? ` (${t.default.split(":")[1]})` : ""}`),
      d.catalog.map((m) => h("option", { value: m.spec, selected: m.spec === t.chosen }, m.label)));
    return h("div", { class: "model-row" }, h("div", {}, h("b", {}, t.label), h("div", { class: "muted mono" }, t.id)), pick);
  };
  main.replaceChildren(h("div", { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "AI models"),
      h("span", { class: "muted", style: { "font-size": "14px" } }, "Choose the model for each task. Applies to you and the team members you invited.")),
    h("section", { class: "panel" }, h("div", { class: "pad model-list" }, d.tasks.map(row),
      d.catalog.length ? null : h("p", { class: "muted" }, "Only the default model is available. Your administrator can add more.")))));
}
