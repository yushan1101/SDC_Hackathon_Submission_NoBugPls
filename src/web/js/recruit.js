// Enterprise recruiting: openings with natural-language thresholds, AI screening agents, blind ranked review,
// human decisions. Plus the daily AI-trend board (Signals).
import { jobIcon } from "./jobicons.js";
import { api, h, icon, toast, fmtTime, reveal, DROP, sleep } from "./lib.js";
import { Owl } from "./owl.js";
import { boardView, integrityBlock } from "./blocks.js";

const SCREEN_AGENTS = [["parse_resume", "Parse"], ["extract_skills", "Extract"], ["assess_fit", "Fit"], ["judge_criteria", "Judge"]];
const EXAMPLE = "Top 5. Must know Epic and Microsoft Excel, critical thinking at least 3, 3+ years, match above 55%";

function criteriaEditor({ soc, text = "", onState }) {
  const box = h("textarea", { class: "input", rows: "3", maxlength: "1000", placeholder: EXAMPLE, "aria-label": "Screening thresholds in plain language" }, text);
  const out = h("ul", { class: "crit-echo", "aria-live": "polite" });
  let last = null;
  async function parse() {
    await null;  // callers finish wiring their buttons before the first echo
    const t = box.value.trim();
    if (!t) { out.replaceChildren(h("li", { class: "muted" }, "No thresholds: the agents rank every applicant by match.")); last = { criteria: {}, summary: [] }; onState?.(last); return; }
    last = await api("/api/criteria/parse", { method: "POST", body: { text: t, soc } }).catch((e) => ({ error: e.message }));
    if (last.error) { out.replaceChildren(h("li", { class: "bad" }, last.error)); return; }
    out.replaceChildren(...last.summary.map((l) => h("li", { class: /^Refused/.test(l) ? "bad" : /^Not understood/.test(l) ? "warn" : "ok" }, l)));
    onState?.(last);
  }
  box.addEventListener("input", () => { clearTimeout(box._t); box._t = setTimeout(parse, 300); });
  parse();
  return { el: h("div", { class: "crit" }, box,
    h("details", { class: "hint" }, h("summary", {}, icon("info"), "How to write"),
      h("p", {}, "The AI agents echo back exactly what they will apply; anything they cannot parse is shown, never silently dropped. " +
        "Criteria about age, gender, ethnicity or other protected characteristics are refused.")),
    out), get text() { return box.value.trim(); }, get parsed() { return last; } };
}

function occPicker(onPick) {
  const results = h("ul", { class: "occ-results", role: "listbox", id: "open-occ", hidden: true });
  const search = h("input", { class: "input", type: "search", role: "combobox", "aria-controls": "open-occ", "aria-expanded": "false",
    placeholder: "Occupation, e.g. registered nurse", maxlength: 80, autocomplete: "off",
    oninput: () => { clearTimeout(search._t); search._t = setTimeout(find, 160); } });
  async function find() {
    const q = search.value.trim();
    if (q.length < 2) { results.hidden = true; return; }
    const { results: r } = await api(`/api/occupations?q=${encodeURIComponent(q)}`);
    results.replaceChildren(...r.map((o) => h("li", { role: "option", onclick: () => { search.value = o.title; results.hidden = true; search.setAttribute("aria-expanded", "false"); onPick(o); } },
      jobIcon(o.soc, { size: 32, labelled: true }), h("b", { title: `ESCO ${o.soc}` }, o.title))));
    results.hidden = !r.length; search.setAttribute("aria-expanded", String(!!r.length));
  }
  return h("div", { class: "occ-search" }, search, results);
}

// ---------------------------------------------------------------- openings list + create
export async function openingsView(main, status) {
  const list = await api("/api/openings");
  let soc = null;
  const title = h("input", { class: "input", maxlength: 80, placeholder: "Job title shown to applicants (optional)" });
  const crit = criteriaEditor({ onState: (st) => { create.disabled = !soc || !!st.criteria?.blocked?.length; } });
  const create = h("button", { class: "btn primary", type: "button", disabled: true, onclick: async () => {
    create.disabled = true;
    try {
      const o = await api("/api/openings", { method: "POST", body: { soc, title: title.value.trim(), criteria_text: crit.text } });
      toast("Opening created. Share its application link.");
      location.hash = `#/openings/${o.id}`;
    } catch (e) { toast(e.message, "err"); create.disabled = false; }
  } }, "Create opening");
  const picker = occPicker((o) => { soc = o.soc; if (!title.value) title.placeholder = o.title; create.disabled = !!crit.parsed?.criteria?.blocked?.length; status.set("listening", o.title); });
  main.replaceChildren(h("div", { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "Openings"),
      h("span", { class: "muted", style: { "font-size": "13px" } }, "AI agents screen and rank. You decide.")),
    h("div", { class: "overview" },
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Open roles"), h("span", { class: "muted num", style: { "font-size": "12px" } }, `${list.length}`)),
        list.length ? h("div", { class: "table-wrap" }, h("table", { class: "data" },
          h("thead", {}, h("tr", {}, h("th", {}, "Role"), h("th", { class: "n" }, "Applicants"), h("th", { class: "n" }, "Recommended"), h("th", {}, "Status"), h("th", { class: "hide-sm" }, "Created"))),
          h("tbody", {}, list.map((o) => h("tr", { "data-href": "1", tabindex: "0", onclick: () => { location.hash = `#/openings/${o.id}`; },
            onkeydown: (e) => e.key === "Enter" && (location.hash = `#/openings/${o.id}`) },
            h("td", {}, h("span", { class: "job-line", title: `ESCO ${o.soc}` }, jobIcon(o.soc, { size: 32, labelled: true }), h("b", {}, o.title))), h("td", { class: "n" }, o.applications), h("td", { class: "n" }, o.recommended),
            h("td", {}, h("span", { class: `tag ${o.status === "open" ? "approved" : "draft"}` }, o.status)), h("td", { class: "mono hide-sm" }, fmtTime(o.created_utc)))))))
          : h("div", { class: "pad" }, h("p", { class: "muted" }, "No openings yet. Create one, then share its application link with candidates."))),
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, "New opening")),
        h("div", { class: "pad", style: { display: "grid", gap: "14px" } },
          h("label", { class: "field" }, h("span", {}, "Occupation (ESCO)"), picker),
          h("label", { class: "field" }, h("span", {}, "Title"), title),
          h("div", { class: "field" }, h("span", {}, "Screening thresholds"), crit.el),
          create)))));
}

// ---------------------------------------------------------------- one opening: criteria, ranked candidates, decisions
export async function openingDetail(main, id, status) {
  main.replaceChildren(h("div", { class: "view" }, h("p", { class: "muted" }, "Loading…")));
  const d = await api(`/api/openings/${id}`);
  const link = new URL(d.apply_path, location.href).href;
  const crit = criteriaEditor({ soc: d.soc, text: d.criteria_text, onState: (st) => { save.disabled = !!st.criteria?.blocked?.length || crit.text === d.criteria_text; } });
  const save = h("button", { class: "btn", type: "button", disabled: true, onclick: async () => {
    save.disabled = true; status.set("analyzing", "Re-screening every applicant");
    try {
      const r = await api(`/api/openings/${id}/criteria`, { method: "POST", body: { text: crit.text } });
      toast(`Thresholds saved; ${r.rescreened} applicants re-screened by the agents`);
      openingDetail(main, id, status);
    } catch (e) { toast(e.message, "err"); save.disabled = false; status.set("confused", "Not saved"); }
  } }, "Save and re-screen");
  const pane = h("section", { class: "cand-detail", "aria-label": "Candidate" });
  const rec = d.candidates.filter((c) => c.recommended);
  const row = (c) => h("tr", { "data-href": "1", tabindex: "0", class: c.recommended ? "rec" : "",
    onclick: (e) => { e.currentTarget.dataset.user = "1"; select(c, e.currentTarget); },
    onkeydown: (e) => e.key === "Enter" && select(c, e.currentTarget) },
    h("td", { class: "n" }, c.rank ? h("b", { class: "num" }, `#${c.rank}`) : h("span", { class: "muted" }, "–")),
    h("td", { class: "mono" }, c.ref),
    h("td", { class: "n num" }, `${Math.round(c.fit * 100)}%`),
    h("td", {}, checks(c.analysis.checks)),
    h("td", { class: "hide-sm" }, c.recommended ? h("span", { class: "tag approved" }, "recommended")
      : c.analysis.held ? h("span", { class: "tag flagged", title: "Document integrity findings: needs a human look" }, "held") : h("span", { class: "muted" }, "—")),
    h("td", {}, h("span", { class: `tag ${c.status === "shortlisted" ? "approved" : c.status === "declined" ? "flagged" : "draft"}` }, c.status.replace("_", " "))));
  const tbody = h("tbody", {}, d.candidates.map(row));

  function select(c, tr) {
    tbody.querySelectorAll("tr").forEach((r) => r.classList.toggle("sel", r === tr));
    const note = h("input", { class: "input", maxlength: 500, placeholder: "Reason (kept in the audit log)" });
    const decide = (decision) => async () => {
      try {
        await api(`/api/applications/${c.id}/decision`, { method: "POST", body: { decision, note: note.value.trim() } });
        toast(`${c.ref} ${decision.replace("_", " ")} by you`);
        status.set(decision === "shortlisted" ? "celebrating" : "idle", `${c.ref} ${decision.replace("_", " ")}`);
        openingDetail(main, id, status);
      } catch (e) { toast(e.message, "err"); }
    };
    const a = c.analysis;
    pane.replaceChildren(reveal(h("div", { class: "cand-body" },
      h("div", { class: "detail-head" }, h("h2", {}, h("span", { class: "id" }, c.ref), " · ", `${Math.round(c.fit * 100)}% match`),
        c.recommended ? h("span", { class: "tag approved" }, `recommended #${c.rank}`) : null),
      h("p", { class: "reason" }, c.reason),
      integrityBlock(a.integrity, "hr"),
      h("div", { class: "agent-run", "aria-label": "Screening agents" }, SCREEN_AGENTS.map(([k, l]) => {
        const u = a.usage?.find((x) => x.node === k);
        return h("span", {}, h("i", { class: "on" }), l, u ? h("span", { class: "num muted" }, ` ${Math.round(u.ms)} ms`) : null);
      })),
      a.checks.length ? h("section", { class: "block" }, h("h3", {}, "Thresholds"),
        h("ul", { class: "check-list" }, a.checks.map((k) => h("li", { class: k.pass ? "ok" : "bad" },
          h("b", {}, k.criterion), k.found != null ? h("span", { class: "muted num" }, ` found ${k.found}`) : null,
          k.evidence?.[0] ? h("q", {}, k.evidence[0]) : null)))) : null,
      h("section", { class: "block" }, h("h3", {}, `Skills with evidence (${a.skills.length})`),
        h("ul", { class: "skill-chips" }, a.skills.map((s) => h("li", { title: s.evidence?.[0] || "" }, s.name, h("b", { class: "num" }, ` ${s.level}`)))),
        a.top_gaps?.length ? h("p", { class: "note" }, `Main gaps for ${a.occupation}: ${a.top_gaps.join(", ")}`) : null),
      c.contact ? h("section", { class: "block contact" }, h("h3", {}, "Contact (unlocked after shortlisting)"),
        h("p", {}, c.contact.name, " · ", h("a", { href: `mailto:${c.contact.email}` }, c.contact.email))) : null,
      h("details", { class: "block" }, h("summary", {}, h("b", {}, "Blind resume (name and contact hidden)")), h("pre", { class: "md" }, c.redacted_md)),
      h("div", { class: "decide" }, note,
        h("div", { class: "row-actions" },
          h("button", { class: "btn primary", type: "button", onclick: decide("shortlisted") }, "Shortlist"),
          h("button", { class: "btn", type: "button", onclick: decide("on_hold") }, "Hold"),
          h("button", { class: "btn", type: "button", onclick: decide("declined") }, "Decline")),
        h("p", { class: "note" }, "Your decision is recorded with your name. The agents never contact or reject anyone."))), DROP));
    pane.classList.add("open");
    if (!matchMedia("(min-width: 1200px)").matches || tr.dataset.user) pane.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  main.replaceChildren(h("div", { class: "view" },
    h("a", { class: "btn ghost sm", href: "#/openings", style: { "justify-self": "start" } }, icon("back"), "All openings"),
    h("div", { class: "view-head" },
      h("h1", {}, d.title, h("span", { class: "mono muted", style: { "font-weight": 400 } }, ` ${d.soc}`)),
      h("div", { class: "row-actions" },
        h("span", { class: `tag ${d.status === "open" ? "approved" : "draft"}` }, d.status),
        h("button", { class: "btn sm", type: "button", onclick: async () => {
          await api(`/api/openings/${id}/status`, { method: "POST", body: { status: d.status === "open" ? "closed" : "open" } });
          openingDetail(main, id, status);
        } }, d.status === "open" ? "Close applications" : "Reopen"))),
    h("section", { class: "panel apply-link" }, h("div", { class: "pad" },
      h("span", { class: "muted" }, "Application link"), h("code", {}, link),
      h("button", { class: "btn sm", type: "button", onclick: () => navigator.clipboard?.writeText(link).then(() => toast("Link copied")) }, "Copy"),
      h("a", { class: "btn sm", href: d.apply_path, target: "_blank", rel: "noopener" }, icon("ext"), "Open"))),
    h("div", { class: "overview" },
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Candidates"),
        h("span", { class: "muted", style: { "font-size": "12px" } }, `${d.candidates.length} screened · ${rec.length} recommended by the ranking agent`)),
        d.candidates.length ? h("div", { class: "table-wrap" }, h("table", { class: "data" },
          h("thead", {}, h("tr", {}, h("th", { class: "n" }, "Rank"), h("th", {}, "Ref"), h("th", { class: "n" }, "Match"), h("th", {}, "Thresholds"), h("th", { class: "hide-sm" }, "Agent pick"), h("th", {}, "Decision"))),
          tbody))
          : h("div", { class: "pad empty" }, new Owl({ size: 64, state: "sleeping" }).el, h("p", { class: "muted" }, "No applications yet. Share the link above; each resume is screened by the AI agents as it arrives."))),
      h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Screening thresholds")),
        h("div", { class: "pad", style: { display: "grid", gap: "12px" } }, crit.el, save,
          h("p", { class: "note" }, "Pipeline per resume: parse to Markdown → extract skills with quotes → document guard (hidden text, prompt injection, fraud signals) → assess fit (ESCO requirements, resume text, today's trend board) → judge each threshold. A ranking agent then recommends the best matches that pass every threshold.")))),
    pane,
    h("section", { class: "panel" }, h("header", {}, h("h2", {}, "Activity"), h("span", { class: "muted", style: { "font-size": "12px" } }, "append-only · UTC")),
      h("ol", { class: "history pad" }, d.events.slice().reverse().map((e) => h("li", {},
        h("time", { datetime: e.at_utc }, fmtTime(e.at_utc)),
        h("span", {}, h("b", {}, e.action.replace(/_/g, " ")), ` by ${e.actor}`, e.detail ? h("span", { class: "muted" }, ` · ${e.detail.slice(0, 120)}`) : null)))))));
  const first = tbody.querySelector("tr");
  if (first && matchMedia("(min-width: 1200px)").matches) first.click();
}

function checks(list) {
  if (!list.length) return h("span", { class: "muted" }, "none set");
  const ok = list.filter((c) => c.pass).length;
  return h("span", { class: "checks", title: list.map((c) => `${c.pass ? "✓" : "✕"} ${c.criterion}`).join("\n") },
    list.map((c) => h("i", { class: c.pass ? "ok" : "bad" })), h("span", { class: "num" }, ` ${ok}/${list.length}`));
}

// ---------------------------------------------------------------- signals
export async function signalsView(main, status) {
  const host = h("div");
  main.replaceChildren(h("div", { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "AI-trend signals"),
      h("span", { class: "muted", style: { "font-size": "13px" } }, "Updated daily · read by the agents through MCP")), host));
  const draw = async () => host.replaceChildren(boardView(await api("/api/signals/today"), { onRefresh: refresh }));
  async function refresh() {
    const before = (await api("/api/signals/today")).created_utc;
    await api("/api/signals/refresh", { method: "POST" });
    status.set("searching", "Fetching today's signals");
    toast("Fetching news, research and job-posting signals. This takes about a minute.");
    for (let i = 0; i < 30; i++) {
      await sleep(8000);
      const b = await api("/api/signals/today");
      if (b.created_utc && b.created_utc !== before) { status.set("update", `Board ${b.day} ready`); return draw(); }
    }
    status.set("confused", "Refresh is taking longer than expected");
  }
  await draw();
}
