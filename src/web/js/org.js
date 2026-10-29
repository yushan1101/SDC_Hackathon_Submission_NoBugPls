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
          progress: d.progress, evidence: d.report?.evidence, title: "90-day plan", readOnly: true, startDate: d.created_utc }))));
  } catch (e) { drawer.replaceChildren(h("p", { class: "pad error" }, e.message)); }
}

// The people page is a list; each person's details (plans, AI models, account actions) live on their own subpage,
// #/people/<username>, which slides in from the right and slides back out to the list.
let lastPeopleView = null;  // "list" | "person": which way the next view slides
const slide = (el, to) => {
  const dir = lastPeopleView && lastPeopleView !== to ? (to === "person" ? "forward" : "back") : null;
  lastPeopleView = to;
  if (dir) el.classList.add(`slide-${dir}`);
  return el;
};

export async function peopleView(main, status, username = null) {
  const [people, me] = await Promise.all([api("/api/org/users"), api("/api/me")]);
  // a school's members are students, a company's are employees (set on the account page)
  const membersLabel = me.enterprise?.members_label || "Team members", orgName = me.enterprise?.name || "Your organisation";
  if (username) {
    const person = people.find((p) => p.username === username);
    if (person) return personView(main, status, person, { membersLabel, member: me.enterprise?.member_label || "Member" });
    toast("That person isn't in your organisation", "err");
    history.replaceState(null, "", "#/people");
  }
  const err = h("p", { class: "error", role: "alert" });
  const email = h("input", { class: "input", type: "email", required: true, maxlength: 254, placeholder: "name@company.com", autocomplete: "off" });
  const name = h("input", { class: "input", maxlength: 60, placeholder: "Display name (optional)" });
  const send = h("button", { class: "btn primary", type: "submit" }, icon("mail"), "Send invite");
  const open = (p) => { location.hash = `#/people/${encodeURIComponent(p.username)}`; };
  const row = (p) => h("tr", { class: "person-row", tabindex: "0", role: "link", "aria-label": `Open ${p.display_name}`,
      onclick: () => open(p), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(p); } } },
    h("td", {}, h("b", {}, p.display_name), h("div", { class: "muted person-sub" }, p.email || p.username)),
    h("td", {}, h("span", { class: `tag ${STATUS_TAG[p.status] || "draft"}` }, p.status === "invited" ? "invite sent" : p.status)),
    h("td", { class: "hide-sm" }, p.plans?.length ? `${p.plans.length} plan${p.plans.length === 1 ? "" : "s"}` : h("span", { class: "muted" }, "—")),
    h("td", { class: "mono hide-sm" }, fmtTime(p.created_utc)),
    h("td", { class: "row-go", "aria-hidden": "true" }, icon("chevron")));
  main.replaceChildren(slide(h("div", { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, membersLabel),
      h("span", { class: "muted", style: { "font-size": "14px" } }, "People join by your email invite, not the sign-up page.")),
    h("div", { class: "overview" },
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, orgName), h("span", { class: "muted num", style: { "font-size": "14px" } }, `${people.length}`)),
        people.length ? h("div", { class: "table-wrap" }, h("table", { class: "data people-table" },
          h("thead", {}, h("tr", {}, h("th", {}, "Person"), h("th", {}, "Status"), h("th", { class: "hide-sm" }, "Plans"), h("th", { class: "hide-sm" }, "Added"), h("th", {}, ""))),
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
          h("p", { class: "note" }, "They get an email with a link (valid 7 days) to choose a password. Their account is on your organisation's plan. You can disable or remove it at any time. You can see the learning plans they make for themselves, read-only."))))), "list"));
}

/** One person's subpage: who they are, their account actions, their learning plans and the AI model they use per task. */
function personView(main, status, p, { membersLabel, member }) {
  const fromList = lastPeopleView === "list";  // came here from the list: Back returns there, keeping browser history in step
  const back = () => { if (fromList) history.back(); else location.hash = "#/people"; };
  const done = (msg, gone = false) => { toast(msg); if (gone) location.hash = "#/people"; else peopleView(main, status, p.username); };
  const act = (fn, msg, gone) => async () => { try { await fn(); done(msg, gone); } catch (e) { toast(e.message, "err"); } };
  const drawer = h("dialog", { class: "drawer", "aria-label": "Plan" });
  const actions = h("div", { class: "row-actions person-actions" },
    p.status === "invited"
      ? h("button", { class: "btn sm", type: "button", onclick: act(() => api(`/api/org/users/${p.username}/resend`, { method: "POST" }), `New invite sent to ${p.email}`) }, "Resend invite")
      : h("button", { class: "btn sm", type: "button", onclick: act(() => api(`/api/org/users/${p.username}/status`, { method: "POST", body: { status: p.status === "active" ? "disabled" : "active" } }),
        `${p.display_name} ${p.status === "active" ? "disabled" : "enabled"}`) }, p.status === "active" ? "Disable account" : "Enable account"),
    h("button", { class: "btn sm ghost", type: "button", onclick: () => {
      const what = p.status === "invited" ? `Withdraw the invite for ${p.email}?` : `Remove ${p.display_name}? Their account and personal data are deleted.`;
      if (confirm(what)) act(() => api(`/api/org/users/${p.username}`, { method: "DELETE" }), p.status === "invited" ? "Invite withdrawn" : "Removed", true)();
    } }, p.status === "invited" ? "Withdraw invite" : "Remove"));
  const plans = p.plans?.length
    ? h("div", { class: "own-plans" }, p.plans.map((pl) => h("button", { class: "own-plan-chip", type: "button",
        title: `Open ${p.display_name}'s plan for ${pl.target_role} (read-only)`, onclick: () => openOwnPlan(drawer, p.display_name, pl.plan_id) },
        icon("history"), h("span", {}, pl.target_role), h("span", { class: "num" }, `${pl.progress?.pct ?? 0}%`))))
    : h("p", { class: "muted" }, "No learning plans yet.");
  main.replaceChildren(slide(h("div", { class: "view person-view" },
    h("button", { class: "btn ghost sm person-back", type: "button", onclick: back }, icon("back"), membersLabel),
    h("div", { class: "view-head" }, h("h1", {}, p.display_name), h("span", { class: `tag ${STATUS_TAG[p.status] || "draft"}` }, p.status === "invited" ? "invite sent" : p.status)),
    h("div", { class: "person-grid" },
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Profile")),
        h("dl", { class: "pad person-facts" },
          h("dt", {}, "Role"), h("dd", {}, member),
          h("dt", {}, "Username"), h("dd", { class: "mono" }, p.username),
          h("dt", {}, "Email"), h("dd", {}, p.email || "—"),
          h("dt", {}, "Added"), h("dd", {}, fmtTime(p.created_utc))),
        h("div", { class: "pad" }, actions)),
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Learning plans"), h("span", { class: "muted num" }, `${p.plans?.length || 0}`)),
        h("div", { class: "pad" }, plans))),
    personModels(p.username), drawer), "person"));
}

/** The AI model this person uses for each task (HR's choice), from the admin's catalog; "Enterprise" follows the organisation. */
function personModels(username) {
  const box = h("section", { class: "panel member-models" }, h("header", {}, h("h2", {}, "AI models")), h("div", { class: "pad" }, h("p", { class: "muted" }, "Loading…")));
  api("/api/org/members/models").then((d) => {
    const m = d.members.find((x) => x.username === username);
    if (!m) { box.lastElementChild.replaceChildren(h("p", { class: "muted" }, "AI models can be chosen once they've accepted the invite.")); return; }
    const short = (spec) => (spec || "").replace(/^(openai|gemini):/, "") || "rule-based";
    box.lastElementChild.replaceChildren(
      h("p", { class: "muted" }, `Which model ${m.name} uses for each task. "Enterprise" follows your organisation's setting.`),
      h("div", { class: "person-models" }, Object.entries(d.tasks).map(([task, label]) => {
        const sel = h("select", { class: "input", onchange: async () => {
          try { const r = await api(`/api/org/members/${encodeURIComponent(username)}/models`, { method: "POST", body: { task, spec: sel.value } });
            m.models = r.models; toast(`${SHORT_TASK[task] || label}: ${sel.value ? short(sel.value) : "enterprise default"}`); }
          catch (e) { toast(e.message, "err"); sel.value = m.models[task] || ""; }
        } }, h("option", { value: "" }, `Enterprise (${short(d.enterprise[task])})`),
          d.options.map((o) => h("option", { value: o.spec, selected: m.models[task] === o.spec ? true : null }, o.label || short(o.spec))));
        return h("label", { class: "field" }, h("span", {}, SHORT_TASK[task] || label, h("small", { class: "muted" }, label)), sel);
      })),
      d.options.length ? null : h("p", { class: "note" }, "Your administrator hasn't added any models to the catalog yet, so everyone uses the enterprise default."));
  }).catch((e) => box.lastElementChild.replaceChildren(h("p", { class: "issue error" }, e.message)));
  return box;
}

const SHORT_TASK = { coach: "Coach & interviews", resume: "Resumes", recruiter: "Hiring & team questions" };


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
/** Read-only: the models the administrator set for this enterprise. HR's own choice is per person (on their page). */
export async function modelsView(main, status) {
  const d = await api("/api/org/models");
  const name = (spec) => (spec ? (d.catalog.find((m) => m.spec === spec)?.label || spec.split(":")[1]) : null);
  main.replaceChildren(h("div", { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "AI models"),
      h("span", { class: "muted", style: { "font-size": "14px" } }, "Your administrator sets these for your organisation.")),
    h("section", { class: "panel" }, h("div", { class: "pad model-list" }, d.tasks.map((t) => h("div", { class: "model-row" },
      h("div", {}, h("b", {}, t.label)),
      h("span", { class: t.chosen ? "tag approved" : "tag" }, name(t.chosen) || `Default${t.default ? ` (${t.default.split(":")[1]})` : ""}`))))),
    h("p", { class: "note" }, "To give one person a different model, open them under ", h("a", { href: "#/people" }, "Team members"), " and change it in their AI models.")));
}
