// Public entry paths: quick-match MCQ game, resume deep analysis, and the daily AI-trend board.
import { api, upload, h, icon, toast, ApiError, reveal, RISE, DROP } from "./lib.js";
import { Owl } from "./owl.js";
import { matchesBlock, boardView, integrityBlock } from "./blocks.js";

const KEYS = ["A", "B", "C", "D"];

// ---------------------------------------------------------------- start: choose a path
export function startView(main, { name } = {}) {
  const path = (href, ic, title, time, text) => reveal(h("a", { class: "path", href },
    h("span", { class: "path-ic" }, icon(ic)),
    h("span", { class: "path-t" }, h("b", {}, title), h("span", { class: "note" }, time)),
    h("span", { class: "path-d" }, text),
    h("span", { class: "path-go", "aria-hidden": "true" }, icon("send"))), RISE, { delay: 80 });
  const owl = new Owl({ size: 132, state: "greeting" });
  main.replaceChildren(h("div", { class: "start" },
    h("div", { class: "start-head" },
      h("div", {},
        h("h1", { class: "page-title" }, name ? `Where next, ${name}?` : "Where could your skills take you?"),
        h("p", { class: "lede" }, "AI is changing every job, unevenly. Find the roles you could grow into, see which skills are rising today, " +
          "and get a 90-day plan you approve. Every claim cites a dated source.")),
      owl.el),
    h("nav", { class: "paths", "aria-label": "Ways to start" },
      path("#/quiz", "quiz", "Quick match game", "About 2 minutes · 13 questions",
        "Answer everyday work scenarios. We estimate your skill levels and rank the roles you fit today."),
      path("#/resume", "file", "Upload your resume", "PDF, Word or text · deep analysis",
        "We convert it to Markdown, pull out skills with the exact lines that prove them, and match you across all ESCO occupations."),
      path("#/build", "build", "Pick a job and rate yourself", "You choose the target",
        "Already know the role you want? Rate the skills it needs and go straight to your plan.")),
    h("p", { class: "note start-today" }, icon("pulse"), " ", h("a", { href: "#/today" }, "See today's AI-trend board"),
      ": which AI topics are moving and which roles they pull forward or put under pressure.")));
  setTimeout(() => owl.set("idle"), 2400);
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
      h("p", { class: "note" }, `Measures: ${item.skills.join(", ")}`),
      h("h2", {}, item.prompt),
      h("div", { class: "opts", role: "group", "aria-label": "Answers" }, opts),
      h("p", { class: "note" }, "Pick the answer closest to what you actually do.", h("span", { class: "kbd-hint" }, " Keys 1 to 4 work too."))),
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
      const r = await api("/api/quiz/score", { method: "POST", body: { answers: st.answers, fields: [...st.fields], zone: st.zone } });
      owl.set("celebrating");
      ctx.status?.set("matched", "Matches ready");
      stage.replaceChildren(reveal(h("div", { class: "q result" },
        h("h2", {}, "Your quick match"),
        h("p", { class: "muted" }, "A fast estimate from 13 answers. For an evidence-backed analysis, ", h("a", { href: "#/resume" }, "upload your resume"), "."),
        h("ul", { class: "skill-chips" }, r.skills.sort((a, b) => b.level - a.level).map((s) => h("li", {}, s.name, h("b", { class: "num" }, ` ${s.level}/5`)))),
        matchesBlock(r.matches, { onPlan: (m) => ctx.planFor(m, r.skills) }),
        h("div", { class: "row-actions" }, h("button", { class: "btn", type: "button", onclick: () => { st.answers = {}; go(-1); } }, "Play again"))), RISE));
    } catch (e) {
      owl.set("confused");
      stage.replaceChildren(h("div", { class: "issue error" }, e.message));
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
      h("p", { class: "lede" }, "Converted to Markdown in memory, never stored. Every skill we find quotes the line that proves it; edit anything we got wrong.")), owl.el),
    drop, out);

  async function send(file) {
    if (file.size > 2_000_000) { toast("That file is over 2 MB.", "err"); return; }
    owl.set("analyzing"); ctx.status?.set("analyzing", "Reading your resume");
    out.replaceChildren(h("p", { class: "muted" }, `Reading ${file.name}…`));
    const fd = new FormData(); fd.append("file", file);
    try {
      const r = await upload("/api/resume/analyze", fd);
      owl.set(r.skills.length ? "matched" : "confused");
      ctx.status?.set("matched", `${r.skills.length} skills found`);
      render(r);
    } catch (e) {
      owl.set("confused");
      if (e instanceof ApiError && e.status === 401) location.replace("/");
      out.replaceChildren(h("div", { class: "issue error" }, e.message));
    }
  }

  function render(r) {
    const skills = r.skills.map((s) => ({ ...s }));
    const matchHost = h("div");
    const lv = (s) => h("div", { class: "seg levels", role: "group", "aria-label": `${s.name} level` },
      [1, 2, 3, 4, 5].map((n) => h("button", { type: "button", "aria-pressed": String(s.level === n), "aria-label": `level ${n}`,
        onclick: (e) => { s.level = n; e.currentTarget.parentElement.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(i + 1 === n))); rematch.disabled = false; } }, n)));
    const rematch = h("button", { class: "btn", type: "button", disabled: true, onclick: async () => {
      rematch.disabled = true; owl.set("analyzing");
      const m = await api("/api/match", { method: "POST", body: { skills: skills.map(({ name, level }) => ({ name, level })), text: r.markdown.slice(0, 20000) } });
      owl.set("matched"); drawMatches(m.matches);
    } }, "Re-match with my edits");
    const drawMatches = (m) => matchHost.replaceChildren(matchesBlock(m, { onPlan: (x) => ctx.planFor(x, skills.map(({ name, level }) => ({ name, level }))) }));
    out.replaceChildren(
      integrityBlock(r.integrity, "self"),
      h("div", { class: "cv-grid" },
        h("details", { class: "cv-md", open: matchMedia("(min-width: 900px)").matches || null },
          h("summary", {}, h("b", {}, "Your resume as Markdown"), h("span", { class: "note" }, ` · ${r.markdown.length.toLocaleString()} characters`)),
          h("pre", { tabindex: "0" }, r.markdown)),
        h("section", { class: "block cv-skills", "aria-label": "Skills found" },
          h("h3", {}, `${skills.length} skills found`, r.years_experience ? h("span", { class: "note" }, ` · about ${r.years_experience} years of experience`) : null),
          skills.length ? h("ul", {}, skills.map((s, i) => reveal(h("li", {},
            h("div", { class: "top" }, h("b", {}, s.name), s.kind === "tool" ? h("span", { class: "tag" }, "tool") : null, lv(s)),
            s.evidence?.[0] ? h("q", {}, s.evidence[0]) : null), DROP, { delay: Math.min(i, 10) * 35 })))
            : h("p", { class: "note" }, "No ESCO skills or tools found. Try a resume with a skills or experience section."),
          h("div", { class: "row-actions" }, rematch))),
      matchHost);
    drawMatches(r.matches);
  }
}

// ---------------------------------------------------------------- today: daily AI-trend board
export async function todayView(main, { onRefresh } = {}) {
  main.replaceChildren(h("h1", { class: "page-title" }, "Today's AI-trend board"),
    h("p", { class: "lede" }, "Built once a day from public signals: Hacker News story counts, arXiv papers and live job postings. " +
      "The AI agents use it to predict which roles are emerging or under automation pressure."),
    h("p", { class: "muted" }, "Loading…"));
  const b = await api("/api/signals/today");
  main.lastChild.replaceWith(boardView(b, { onRefresh }));
}
