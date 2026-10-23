// HR console: the organisation's people (invited by email; they never use the sign-up page) and the hiring
// plugins (company accounts the posting agent sends openings to).
import { api, h, icon, toast, fmtTime } from "./lib.js";
import { Owl } from "./owl.js";
import { brandMark as mark } from "./brands.js";
import { planBlock } from "./blocks.js";

const STATUS_TAG = { active: "approved", invited: "draft", disabled: "flagged" };


// ---------------------------------------------------------------- team members
const PACE = { done: "Completed", ahead: "Ahead", on_track: "On track", behind: "Behind", not_started: "Not started" };

/** A plan an employee made for themself, opened read-only in a side panel: HR sees it and the progress, never edits. */
async function openOwnPlan(drawer, person, planId) {
  drawer.replaceChildren(h("p", { class: "pad muted" }, "Loading…"));
  drawer.showModal();
  try {
    const d = await api(`/api/plans/${planId}`);
    const s = d.progress_summary || {};
    drawer.replaceChildren(h("div", { class: "panel own-plan" },
      h("header", {}, h("h2", {}, `${person} · ${d.plan.target_role}`), h("button", { class: "btn sm", type: "button", onclick: () => drawer.close() }, "Close")),
      h("div", { class: "pad own-plan-body" },
        h("p", { class: "note" }, icon("user"), `${person} made this plan for themself. You can see it and their progress; only they can change it.`),
        h("p", {}, h("b", {}, `${s.done || 0} of ${s.total || 0} activities done`), ` · ${PACE[s.pace] || ""}${s.day ? ` · day ${s.day} of 90` : ""}`),
        planBlock({ planId, planReference: d.plan_reference, plan: d.plan, version: d.version, status: d.status, weeklyHours: null,
          progress: d.progress, evidence: d.report?.evidence, title: "90-day plan", readOnly: true }))));
  } catch (e) { drawer.replaceChildren(h("p", { class: "pad error" }, e.message)); }
}

export async function peopleView(main, status) {
  const people = await api("/api/org/users");
  const err = h("p", { class: "error", role: "alert" });
  const email = h("input", { class: "input", type: "email", required: true, maxlength: 254, placeholder: "name@company.com", autocomplete: "off" });
  const name = h("input", { class: "input", maxlength: 60, placeholder: "Display name (optional)" });
  const send = h("button", { class: "btn primary", type: "submit" }, icon("mail"), "Send invite");
  const act = (fn, done) => async () => { try { await fn(); toast(done); peopleView(main, status); } catch (e) { toast(e.message, "err"); } };
  const drawer = h("dialog", { class: "drawer", "aria-label": "Employee plan" });
  const plansOf = (p) => p.plans?.length ? h("div", { class: "own-plans" }, p.plans.map((pl) => h("button", { class: "own-plan-chip", type: "button",
    title: `Open ${p.display_name}'s plan for ${pl.target_role} (read-only)`, onclick: () => openOwnPlan(drawer, p.display_name, pl.plan_id) },
    icon("history"), h("span", {}, pl.target_role), h("span", { class: "num" }, `${pl.progress?.pct ?? 0}%`)))) : null;
  const row = (p) => h("tr", {},
    h("td", {}, h("b", {}, p.display_name), h("div", { class: "muted mono" }, p.username), plansOf(p)),
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
          h("p", { class: "note" }, "They get an email with a link (valid 7 days) to choose a password. Their account is on your organisation's plan. You can disable or remove it at any time. You can see the learning plans they make for themselves, read-only.")))),
    drawer));
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
