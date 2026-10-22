// Public entry paths: quick-match MCQ game, resume deep analysis, and the daily AI-trend board.
import { api, upload, stream, h, icon, toast, ApiError, reveal, RISE, DROP } from "./lib.js";
import { Owl } from "./owl.js";
import { jobIcon } from "./jobicons.js";
import { matchesBlock, boardView, integrityBlock } from "./blocks.js";

const KEYS = ["A", "B", "C", "D"];

// ---------------------------------------------------------------- start: choose a path
export function startView(main, { name, guest, jumpToday } = {}) {
  if (guest) return guestHome(main, { jumpToday });
  // One decision per card. The old hero buttons, repeated giant cards and demo
  // mockups offered the same choices three times and pushed the real actions down.
  const option = (href, ic, title, description, action, featured = false) =>
    h("a", { href, class: `entry-card${featured ? " entry-featured" : ""}` },
      h("span", { class: "entry-icon" }, icon(ic)),
      h("span", { class: "entry-copy" }, h("strong", {}, title), h("span", {}, description)),
      h("span", { class: "entry-action" }, action, icon("send")));
  main.replaceChildren(h("div", { class: "home home-simple" },
    h("section", { class: "home-hero intro-hero" },
      new Owl({ size: 112, state: "greeting" }).el,
      h("h1", {}, name ? `What would you like to do next, ${name}?` : "Find your next career step."),
      h("p", {}, "Discover your strengths, compare job skills and build a 90-day learning plan you control.")),
    h("section", { class: "entry-grid", "aria-label": "Choose how to begin" },
      option("#/quiz", "quiz", "Explore my strengths", "Answer 13 everyday work questions. About 2 minutes.", "Quick Match", true),
      option("#/report", "target", "I have a target job", "Compare your skills with the requirements for a job you choose.", "Build a plan"),
      option("#/resume", "file", "Use my résumé", "Upload PDF, Word or text to find skills supported by evidence.", "Upload résumé"))));  // today's signals are one tap away in the header (Today)
}

// The full landing page for visitors who are not signed in: the three ways in, each with a live-looking demo.
function guestHome(main, { jumpToday } = {}) {
  const go = (href, label, cls = "btn") => h("a", { class: cls, href }, label, icon("send"));
  const way = (id, cls, ic, heading, text, href, button, demo) =>
    h("section", { class: `way ${cls}`, "aria-labelledby": `way-${id}` },
      h("div", {}, h("span", { class: "core-ic way-ic" }, icon(ic)), h("h2", { id: `way-${id}` }, heading), h("p", {}, text)), demo, go(href, button));
  // demos show the real mechanism: a real quiz item, a resume line with its quoted skill, the 30/60/90 plan
  const quizDemo = h("div", { class: "demo", "aria-hidden": "true" },
    h("p", { class: "demo-q" }, "A spreadsheet total looks wrong. You…"),
    h("div", { class: "demo-opt" }, h("kbd", {}, "A"), "Flag it and move on"),
    h("div", { class: "demo-opt" }, h("kbd", {}, "B"), "Re-add the column by hand"),
    h("div", { class: "demo-opt on" }, h("kbd", {}, "C"), "Trace the formula and fix it"));
  const resumeDemo = h("div", { class: "demo", "aria-hidden": "true" },
    h("p", { class: "demo-line" }, "“Automated monthly reporting with ", h("mark", {}, "Python scripts"), " and SQL queries.”"),
    h("span", { class: "demo-skill" }, icon("sources"), "Python (computer programming)"));
  const planDemo = h("div", { class: "demo demo-phases", "aria-hidden": "true" },
    [["1–30", "Foundations"], ["31–60", "Apply it on real work"], ["61–90", "Show it, get it reviewed"]].map(([d, t]) =>
      h("div", {}, h("b", {}, `Days ${d}`), h("span", {}, t))));  // same phases as agents/pathway.py
  const owl = new Owl({ size: 168, state: "greeting" });
  const today = h("p", { class: "muted" }, "Loading today’s board…");
  main.replaceChildren(h("div", { class: "home" },
    h("section", { class: "home-hero" }, owl.el,
      h("h1", {}, "Where could your skills take you?"),
      h("p", {}, "Find roles you could grow into and get a 90-day plan you approve, every claim cited.")),
    h("div", { class: "home-ways" },
      way("quiz", "way-quiz", "quiz", "Discover what you’re good at", "13 everyday work questions, about 2 minutes. We estimate your skills and suggest roles.",
        "#/quiz", "Start Quick Match", quizDemo),
      way("resume", "way-resume", "file", "Let your résumé speak", "PDF, Word or text. Every skill we find quotes the line that proves it.",
        "#/resume", "Upload résumé", resumeDemo),
      way("plan", "way-plan", "target", "Already know where you’re headed?", "Pick any ESCO occupation, see the skills to build, and get a plan that fits your week.",
        "#/report", "Pick a job", planDemo)),
    h("section", { class: "home-today", "aria-labelledby": "home-today" },
      h("h2", { id: "home-today" }, "The world of work keeps moving."),
      h("p", {}, "Today’s AI topics and the roles they may affect, rebuilt every day."),
      today)));
  api("/api/signals/today").then((b) => today.replaceWith(boardView(b))).catch(() => today.remove())
    .finally(() => jumpToday && document.getElementById("home-today")?.scrollIntoView({ block: "start" }));  // after the board is in, so nothing scrolls over it
}

// ---------------------------------------------------------------- quiz game
export async function quizView(main, ctx) {
  const q = await api("/api/quiz");
  const st = { i: -1, answers: {}, fields: new Set(), zone: null };
  const owl = new Owl({ size: 120, state: "greeting" });
  const bar = h("i");
  const count = h("span", { class: "num" });
  const stage = h("div", { class: "quiz-stage", "aria-live": "polite" });
  const back = h("button", { class: "btn ghost sm", type: "button", onclick: () => go(st.i - 1) }, icon("back"), "Back");
  main.replaceChildren(h("div", { class: "quiz" },
    h("div", { class: "quiz-top" }, back, h("div", { class: "quiz-progress", role: "progressbar", "aria-label": "Quiz progress",
      "aria-valuemin": "0", "aria-valuemax": String(q.questions.length) }, bar), count),
    h("div", { class: "quiz-body" }, owl.el, stage)));

  const keyHandler = (e) => {
    if (!main.isConnected || !main.contains(stage)) { removeEventListener("keydown", keyHandler); return; }
    const n = Number(e.key);
    if (st.i >= 0 && st.i < q.questions.length && n >= 1 && n <= 4 && !e.target.closest?.("input, textarea")) pick(n - 1);
  };
  addEventListener("keydown", keyHandler);

  function progress() {
    const done = Math.max(0, st.i);
    bar.style.transform = `scaleX(${done / q.questions.length})`;
    bar.parentElement.setAttribute("aria-valuenow", String(done));
    count.textContent = st.i < 0 ? "" : `${Math.min(st.i + 1, q.questions.length)} / ${q.questions.length}`;
    back.hidden = st.i < 0;
  }

  function go(i) {
    st.i = Math.max(-1, i);
    progress();
    if (st.i < 0) return fields();
    if (st.i >= q.questions.length) return finish();
    const item = q.questions[st.i];
    owl.set("listening");
    const opts = item.options.map((o, k) => h("button", { class: "opt", type: "button", "aria-pressed": String(st.answers[item.id] === k),
      onclick: () => pick(k) }, h("kbd", {}, KEYS[k]), h("span", {}, o)));
    stage.replaceChildren(reveal(h("div", { class: "q" },
      h("h2", {}, item.prompt),
      h("div", { class: "opts", role: "group", "aria-label": "Answers" }, opts),
      h("p", { class: "note" }, `Pick what you actually do. This measures ${item.skills.join(", ")}.`, h("span", { class: "kbd-hint" }, " Keys 1 to 4 work too."))),
      [{ opacity: 0, transform: "translateX(24px)" }, { opacity: 1, transform: "none" }], { duration: 320 }));
    opts[st.answers[item.id] ?? 0]?.focus({ preventScroll: true });
  }

  function pick(k) {
    const item = q.questions[st.i];
    st.answers[item.id] = k;
    stage.querySelectorAll(".opt").forEach((b, j) => b.setAttribute("aria-pressed", String(j === k)));
    owl.set(k >= 2 ? "matched" : "thinking");
    setTimeout(() => go(st.i + 1), 280);
  }

  function fields() {
    owl.set("greeting");
    const chips = q.fields.map((f) => h("button", { class: "chip", type: "button", "aria-pressed": String(st.fields.has(f.id)),
      onclick: (e) => { st.fields.has(f.id) ? st.fields.delete(f.id) : st.fields.add(f.id);
        e.currentTarget.setAttribute("aria-pressed", String(st.fields.has(f.id))); owl.set("listening"); } }, f.label));
    stage.replaceChildren(reveal(h("div", { class: "q" },
      h("h2", {}, "Which kinds of work interest you?"),
      h("p", { class: "muted" }, "Pick any. We only rank roles in these fields; skip to search every ESCO occupation."),
      h("div", { class: "field-chips" }, chips),
      h("h2", { class: "sub" }, "How much training or education do you have?"),
      h("div", { class: "field-chips" }, q.training.map((t) => h("button", { class: "chip", type: "button", "aria-pressed": String(st.zone === t.zone),
        onclick: (e) => { st.zone = st.zone === t.zone ? null : t.zone;
          e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget && st.zone !== null))); } }, t.label))),
      h("p", { class: "note" }, "Used to suggest roles within reach: at most one ISCO-08 skill level above yours, shown as a stretch."),
      h("div", { class: "row-actions" },
        h("button", { class: "btn primary", type: "button", onclick: () => go(0) }, "Start the game", icon("send")),
        h("button", { class: "btn ghost", type: "button", onclick: () => { st.fields.clear(); go(0); } }, "Skip, search everything"))), RISE));
  }

  async function finish() {
    owl.set("analyzing");
    stage.replaceChildren(h("div", { class: "q" }, h("h2", {}, "Matching you against every occupation…"),
      h("p", { class: "muted" }, "Comparing your answers with ESCO requirements and today's AI-trend board.")));
    try {
      const r = await api("/api/quiz/score", { method: "POST", body: { answers: st.answers, fields: [...st.fields], zone: st.zone, scenario: st.scenario || "assistive" } });
      owl.set("celebrating");
      ctx.status?.set("matched", "Matches ready");
      stage.replaceChildren(reveal(h("div", { class: "q result" },
        h("h2", {}, "Your quick match"),
        h("p", { class: "muted" }, "A fast estimate from 13 answers. For an evidence-backed analysis, ", h("a", { href: "#/resume" }, "upload your resume"), "."),
        h("ul", { class: "skill-chips" }, r.skills.sort((a, b) => b.level - a.level).map((s) => h("li", {}, s.name, h("b", { class: "num" }, ` ${s.level}/5`)))),
        matchesBlock(r.matches, { onPlan: (m) => ctx.planFor(m, r.skills), onInterview: ctx.onInterview ? (m) => ctx.onInterview(m, r.skills) : null,
          scenario: st.scenario, onScenario: (k) => { st.scenario = k; finish(); } }),
        h("div", { class: "row-actions" }, h("button", { class: "btn", type: "button", onclick: () => { st.answers = {}; go(-1); } }, "Play again"))), RISE));
    } catch (e) {
      owl.set("confused");
      stage.replaceChildren(h("div", { class: "issue error", role: "alert" }, e.message),
        h("p", { class: "note" }, "Your answers are still here. You don't need to play again."),
        h("button", { class: "btn primary", type: "button", onclick: finish }, "Try again"));
    }
  }
  go(-1);
}

// ---------------------------------------------------------------- resume deep analysis
export function resumeView(main, ctx) {
  const owl = new Owl({ size: 96, state: "idle" });
  const input = h("input", { type: "file", accept: ".pdf,.docx,.txt,.md", class: "sr-only", id: "cv-file",
    onchange: () => input.files[0] && send(input.files[0]) });
  const drop = h("label", { class: "cv-drop", for: "cv-file",
    ondragover: (e) => { e.preventDefault(); drop.classList.add("over"); owl.set("listening"); },
    ondragleave: () => drop.classList.remove("over"),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) send(f); } },
    input, icon("upload"), h("b", {}, "Drop your resume here, or choose a file"), h("span", { class: "note" }, "PDF, Word (.docx), .txt or .md · up to 2 MB"));
  const out = h("div", { class: "cv-out" });
  main.replaceChildren(
    h("div", { class: "start-head" }, h("div", {},
      h("h1", { class: "page-title" }, "Deep analysis from your resume"),
      h("p", { class: "lede" }, "Read in memory, never stored. Every skill quotes the line that proves it, and you can edit any of them.")), owl.el),
    drop, out);

  async function send(file) {
    if (file.size > 2_000_000) { toast("That file is over 2 MB.", "err"); return; }
    // the drop zone becomes a live progress panel: real server stages, the owl acting each one out
    const bigOwl = new Owl({ size: 120, state: "searching" });
    const bar = h("i"), pct = h("b", { class: "num" }, "0%"), label = h("span", {}, "Uploading…");
    const steps = h("ol", { class: "cv-steps" });
    const panel = h("div", { class: "cv-progress", role: "status", "aria-live": "polite" }, bigOwl.el,
      h("div", { class: "cv-prog-body" }, h("p", { class: "cv-prog-file" }, icon("file"), file.name),
        h("div", { class: "cv-prog-top" }, label, pct),
        h("div", { class: "cv-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, bar), steps));
    drop.replaceWith(panel);
    out.replaceChildren();
    const setPct = (n) => { bar.style.transform = `scaleX(${n / 100})`; pct.textContent = `${n}%`; panel.querySelector(".cv-bar").setAttribute("aria-valuenow", String(n)); };
    let current = null;
    const restore = () => panel.replaceWith(drop);
    owl.set("analyzing"); ctx.status?.set("analyzing", "Reading your resume");
    const fd = new FormData(); fd.append("file", file);
    try {
      let result = null;
      await stream("/api/resume/analyze/stream", fd, (ev) => {
        if (ev.t === "stage") {
          current?.classList.replace("now", "done");
          current = h("li", { class: "now" }, icon("check"), ev.label);
          steps.append(current);
          label.textContent = ev.label; setPct(ev.pct); bigOwl.set(ev.owl); ctx.status?.set(ev.owl, ev.label);
        } else if (ev.t === "result") { current?.classList.replace("now", "done"); setPct(100); result = ev.data; }
        else if (ev.t === "error") throw new ApiError(422, ev.message);
      });
      if (!result) throw new Error("The analysis stopped before it finished. Please try again.");
      bigOwl.set(result.skills.length ? "celebrating" : "confused");
      owl.set(result.skills.length ? "matched" : "confused");
      ctx.status?.set("matched", `${result.skills.length} skills found`);
      label.textContent = `Done · ${result.skills.length} skills found`;
      setTimeout(() => { panel.classList.add("done"); render(result); }, 600);
    } catch (e) {
      owl.set("confused");
      if (e instanceof ApiError && e.status === 401) { location.replace("#/signin/resume"); location.reload(); return; }
      restore();
      out.replaceChildren(h("div", { class: `issue ${e.status === 402 ? "upsell" : "error"}` }, e.message,
        e.status === 402 ? [" ", h("a", { class: "btn sm primary", href: "#/pricing" }, "See plans")] : null));
    }
  }

  function render(r) {
    const skills = r.skills.map((s) => ({ ...s }));
    const markdown = typeof r.markdown === "string" ? r.markdown : "";
    const years = r.years_experience != null && Number.isFinite(Number(r.years_experience))
      ? Number(r.years_experience) : null;
    const matchHost = h("div");
    const lv = (s) => h("div", { class: "seg levels", role: "group", "aria-label": `${s.name} level` },
      [1, 2, 3, 4, 5].map((n) => h("button", { type: "button", "aria-pressed": String(s.level === n), "aria-label": `level ${n}`,
        onclick: (e) => { s.level = n; e.currentTarget.parentElement.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(i + 1 === n))); rematch.disabled = false; } }, n)));
    let scenario = "assistive";
    const remeasure = async () => {
      owl.set("analyzing");
      const m = await api("/api/match", { method: "POST", body: { skills: skills.map(({ name, level }) => ({ name, level })),
        text: markdown.slice(0, 20000), scenario, assessment_id: r.assessment_id || null } });
      r.assessment_id = m.assessment_id || r.assessment_id;
      owl.set("matched"); drawMatches(m.matches);
    };
    const rematch = h("button", { class: "btn", type: "button", disabled: true, onclick: () => { rematch.disabled = true; remeasure(); } }, "Re-match with my edits");
    const drawMatches = (m) => matchHost.replaceChildren(matchesBlock(m, { onPlan: (x) => ctx.planFor(x, skills.map(({ name, level }) => ({ name, level }))),
      onInterview: ctx.onInterview ? (x) => ctx.onInterview(x, skills.map(({ name, level }) => ({ name, level }))) : null,
      scenario, onScenario: (k) => { scenario = k; remeasure(); } }));
    // the person can correct what was found: change levels, remove a wrong skill, add a missing one
    const skillsUl = h("ul");
    const countEl = h("span");
    const drawSkills = () => {
      countEl.textContent = `${skills.length} skills found`;
      skillsUl.replaceChildren(...skills.map((s, i) => h("li", {},
        h("div", { class: "cv-skill-row" },
          h("div", { class: "cv-skill-title" }, h("b", {}, s.name), s.kind === "tool" ? h("span", { class: "tag" }, "tool") : null),
          h("div", { class: "cv-skill-controls" }, lv(s),
          h("button", { class: "btn ghost sm", type: "button", "aria-label": `Remove ${s.name}`, title: "Remove this skill",
            onclick: () => { skills.splice(i, 1); drawSkills(); rematch.disabled = false; } }, "×"))),
        s.evidence?.[0] ? h("q", { class: "cv-skill-evidence" }, s.evidence[0]) : null)));
    };
    const addIn = h("input", { class: "input", placeholder: "Add a skill we missed, e.g. Tableau", maxlength: 60, "aria-label": "Add a skill",
      onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } } });
    const addSkill = () => {
      const name = addIn.value.trim();
      if (!name || skills.some((x) => x.name.toLowerCase() === name.toLowerCase())) return;
      skills.unshift({ name, level: 2, kind: "skill", evidence: [] }); addIn.value = ""; drawSkills(); rematch.disabled = false;
    };
    drawSkills();
    const addSkillRow = h("div", { class: "add-skill" }, addIn, h("button", { class: "btn sm", type: "button", onclick: addSkill }, "Add"));
    const skillsList = h("div", { class: "cv-skill-edit" }, skillsUl);
    const skillsViewport = h("div", { class: "cv-skills-scroll", "aria-hidden": "true", inert: true }, skillsList);
    const skillsCollapse = h("div", { class: "cv-skills-collapse" }, skillsViewport, addSkillRow);
    const skillsToggle = h("button", { class: "btn sm cv-skills-toggle", type: "button", "aria-expanded": "false",
      "aria-controls": "cv-extracted-skills", onclick: () => {
        const expanded = skillsToggle.getAttribute("aria-expanded") !== "true";
        skillsToggle.setAttribute("aria-expanded", String(expanded));
        skillsToggle.textContent = expanded ? "Hide Skills" : "View & Edit Skills";
        skillsCollapse.classList.toggle("is-open", expanded);
        skillsViewport.setAttribute("aria-hidden", String(!expanded));
        if (expanded) skillsViewport.removeAttribute("inert"); else skillsViewport.setAttribute("inert", "");
      } }, "View & Edit Skills");
    skillsViewport.id = "cv-extracted-skills";
    const skillsControls = skills.length ? [skillsToggle,
      h("p", { class: "cv-skills-hint" }, icon("info"), "Want to improve your matches? Expand your skills, adjust your ratings, and click Rematch to discover updated career recommendations."),
      skillsCollapse] : [skillsList, addSkillRow];  // no skills found: the add box is shown straight away
    const ins = r.insight;
    const mine = () => skills.map(({ name, level }) => ({ name, level }));
    const insight = ins ? h("section", { class: "cv-insight" },
      h("div", { class: "brief-card cv-profile" },
        h("header", { class: "bc-head" }, h("span", { class: "bc-ic" }, icon("user")), h("h3", {}, "Your profile"),
          h("span", { class: "tag", title: ins.mode === "rules+llm" ? "Read by the résumé AI agent; every quote and role checked against your résumé" : "Rule-based reading" },
            ins.mode === "rules+llm" ? "AI-read" : "rules")),
        h("p", { class: "cv-headline" }, ins.headline),
        ins.strengths?.length ? h("ul", { class: "cv-strengths" }, ins.strengths.map((s) =>
          h("li", {}, icon("check"), h("span", {}, h("b", {}, s.skill), h("q", {}, s.quote))))) : null),
      ins.advice?.length ? h("div", { class: "cv-advice" }, ins.advice.map((a, i) => {
        const m = r.matches.find((x) => x.title === a.role);
        return h("article", { class: "brief-card advice-card" },
          h("header", { class: "bc-head" }, a.soc ? jobIcon(a.soc, { size: 40, labelled: true }) : h("span", { class: "bc-ic" }, icon("target")),
            h("span", { class: "adv-n" }, `Step ${i + 1}`)),
          h("h4", {}, a.action), a.why ? h("p", { class: "bc-line" }, a.why) : null,
          m ? h("button", { class: "btn sm primary", type: "button", onclick: () => ctx.planFor(m, mine()) }, icon("spark"), "Plan for this role") : null);
      })) : null) : null;
    out.replaceChildren(
      insight,
      integrityBlock(r.integrity, "self"),
      h("div", { class: "cv-grid" },
        h("details", { class: "cv-md", open: matchMedia("(min-width: 900px)").matches || null },
          h("summary", {}, h("b", {}, "Your resume as Markdown"), h("span", { class: "note" }, ` · ${markdown.length.toLocaleString()} characters`)),
          h("pre", { tabindex: "0" }, markdown)),
        h("section", { class: "block cv-skills", "aria-label": "Skills found" },
          h("h3", {}, countEl, years ? h("span", { class: "note" }, ` · about ${years} years of experience`) : null),
          r.education?.length ? h("div", { class: "cv-facts" }, h("h4", {}, icon("file"), "Education"), h("ul", {}, r.education.map((x) => h("li", {}, h("q", {}, x))))) : null,
          r.experience?.length ? h("div", { class: "cv-facts" }, h("h4", {}, icon("clock"), "Experience"), h("ul", {}, r.experience.map((x) => h("li", {}, h("q", {}, x))))) : null,
          skillsControls,
          h("div", { class: "row-actions cv-rematch-actions" }, rematch))),
      matchHost);
    drawMatches(r.matches);
  }
}

// ---------------------------------------------------------------- today: daily AI-trend board
export async function todayView(main, { onRefresh } = {}) {
  main.replaceChildren(h("h1", { class: "page-title today-title" }, "Today in AI"),
    h("p", { class: "lede today-lede" }, "Which AI topics are moving, and which jobs they pull forward or put under pressure. Rebuilt every day."),
    h("p", { class: "muted" }, "Loading…"));
  const b = await api("/api/signals/today");
  main.lastChild.replaceWith(boardView(b, { onRefresh }));
}

// ---------------------------------------------------------------- the 17 UN goals, and (signed in) how your plans map to them
export async function sdgsView(main) {
  main.replaceChildren(h("h1", { class: "page-title" }, "The 17 UN Sustainable Development Goals"),
    h("p", { class: "lede" }, "Roles and plans here are linked to these goals by meaning: the ESCO job description is matched to the 169 official UN targets. An evidence-linked suggestion, not an official UN classification."),
    h("p", { class: "muted" }, "Loading…"));
  const { goals, mine } = await api("/api/sdgs");
  const used = mine ? goals.filter((g) => mine[g.goal]?.length).sort((a, b) => mine[b.goal].length - mine[a.goal].length) : [];
  const max = Math.max(1, ...used.map((g) => mine[g.goal].length));
  const summary = mine ? h("section", { class: "block sdg-mine", "aria-labelledby": "sdg-mine" },
    h("h2", { id: "sdg-mine" }, "Your plans and the goals"),
    used.length ? [h("p", { class: "muted" }, `Your ${new Set(used.flatMap((g) => mine[g.goal])).size} planned roles serve ${used.length} of the 17 goals.`),
      h("ol", { class: "sdg-bars" }, used.map((g) => h("li", {},
        h("span", { class: "sdg-n", style: { "--sdg": g.color } }, String(g.goal)),
        h("span", { class: "sb-name" }, g.short),
        h("span", { class: "sb-track", "aria-hidden": "true" }, h("i", { style: { width: `${(100 * mine[g.goal].length) / max}%`, background: g.color } })),
        h("span", { class: "sb-n", title: mine[g.goal].join(", ") }, `${mine[g.goal].length} ${mine[g.goal].length === 1 ? "role" : "roles"}`))))]
      : h("p", { class: "muted" }, "None of your plans is linked to a goal yet. Build a plan and its goals appear here.")) : null;
  main.lastChild.replaceWith(h("div", { class: "sdg-page" }, summary,
    h("ol", { class: "sdg-library" }, goals.map((g) => h("li", { style: { "--sdg": g.color } },
      h("span", { class: "sl-n" }, String(g.goal)),
      h("div", {}, h("b", {}, g.short), h("p", {}, g.title || ""),
        mine?.[g.goal]?.length ? h("p", { class: "sl-mine" }, icon("check"), `In your plans: ${mine[g.goal].join(", ")}`) : null,
        h("a", { href: g.url || `https://sdgs.un.org/goals/goal${g.goal}`, target: "_blank", rel: "noopener noreferrer" }, "UN goal page")))))));
}
