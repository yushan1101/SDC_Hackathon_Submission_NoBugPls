import { api, h, icon, toast, fmtTime, ApiError } from "./lib.js";

const LABELS = {
  knowledge: "Job-relevant knowledge", relevance: "Answer relevance & completeness",
  problem_solving: "Problem-solving & reasoning", communication: "Communication & clarity",
  practical_evidence: "Practical examples & evidence",
};
const TYPES = { behavioral: "HR / behavioral", technical: "Technical", situational: "Situational",
  problem_solving: "Problem-solving", workplace_scenario: "Workplace scenario" };
const pct = (n) => `${Math.max(0, Math.min(100, Math.round(Number(n) || 0)))}%`;
const savedProfile = () => { try { return JSON.parse(localStorage.getItem("ap.profile.v2") || "{}"); } catch { return {}; } };

export async function interviewView(main, interviewId) {
  main.replaceChildren(h("div", { class: "interview-loading", role: "status" }, "Preparing your interview workspace…"));
  try {
    if (interviewId) {
      const detail = await api(`/api/interviews/${encodeURIComponent(interviewId)}`);
      if (detail.status === "in_progress" && detail.question) { renderRoom(main, detail); return; }
      if (detail.report) { await renderReport(main, detail.report); return; }
      renderEnded(main, detail); return;
    }
    const [history, plans] = await Promise.all([
      api("/api/interviews"), api("/api/plans").catch(() => ({ plans: [] })),
    ]);
    renderSetup(main, history.interviews || [], plans.plans || plans || []);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { location.hash = "#/signin/interview"; return; }
    main.replaceChildren(h("h1", { class: "page-title" }, "Mock interview"), h("div", { class: "issue error" }, e.message));
  }
}

function renderSetup(main, history, plans) {
  const p = savedProfile();
  let role = p.target_role && /^\d{4}(?:\.\d+)*$/.test(p.target_role)
    ? { soc: p.target_role, title: p.target_title || p.target_role } : null;
  let skills = Array.isArray(p.skills) ? p.skills.map((s) => ({ name: s.name, level: Number(s.level) || 0 })) : [];
  const query = h("input", { id: "interview-role", class: "input", type: "search", placeholder: "Search an ESCO job title", role: "combobox",
    "aria-label": "Target job", autocomplete: "off" });
  const results = h("ul", { class: "occ-results", role: "listbox", hidden: true });
  const picked = h("div", { class: "interview-picked muted" }, role ? `Selected: ${role.title}` : "Choose a job to personalize your questions.");
  const skillList = h("div", { class: "interview-skills" });
  const drawSkills = () => skillList.replaceChildren(...skills.map((s) => h("span", { class: "chip-static" }, `${s.name} · ${s.level}/5`)));
  drawSkills();
  let timer;
  query.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = query.value.trim();
      if (q.length < 2) { results.hidden = true; return; }
      try {
        const data = await api(`/api/occupations?q=${encodeURIComponent(q)}`);
        results.replaceChildren(...(data.results.length ? data.results.map((item) => h("li", { role: "option", onclick: async () => {
          role = { soc: item.soc, title: item.title };
          try {
            const detail = await api(`/api/occupations/${encodeURIComponent(item.soc)}`);
            const current = new Map(skills.map((s) => [s.name.toLowerCase(), s.level]));
            skills = detail.skills.slice(0, 12).map((s) => ({ name: s.name, level: current.get(s.name.toLowerCase()) ?? 0 }));
          } catch { /* selection still works with the existing profile */ }
          picked.textContent = `Selected: ${role.title} · ESCO ${role.soc}`;
          drawSkills(); results.hidden = true; query.value = role.title;
        } }, h("b", {}, item.title), h("span", { class: "muted" }, ` ESCO ${item.soc}`)))
          : [h("li", { class: "muted", role: "option", "aria-disabled": "true" }, "No matching ESCO role found.")]));
        results.hidden = false;
      } catch { results.hidden = true; }
    }, 220);
  });
  const difficulty = h("select", { class: "input", "aria-label": "Interview difficulty" },
    h("option", { value: "foundational" }, "Foundational"), h("option", { value: "intermediate", selected: true }, "Intermediate"),
    h("option", { value: "advanced" }, "Advanced"));
  const planOptions = [h("option", { value: "" }, "No plan selected"), ...plans
    .filter((x) => x.audience === "individual" && (!role || x.target_role === role.soc))
    .map((x) => h("option", { value: x.plan_id }, `${x.target_role || "Role plan"} · ${x.status} · ${fmtTime(x.created_utc)}`))];
  const plan = h("select", { class: "input", "aria-label": "Link a learning plan" }, planOptions);
  const consent = h("input", { type: "checkbox" });
  const error = h("p", { class: "error", role: "alert" });
  const start = h("button", { class: "btn primary", type: "button", onclick: async () => {
    error.textContent = "";
    if (!role) { error.textContent = "Choose a target job first."; query.focus(); return; }
    if (!consent.checked) { error.textContent = "Please agree to the transcript and AI processing notice to continue."; consent.focus(); return; }
    start.disabled = true; start.textContent = "Building your first question…";
    const payload = { target_role: role.soc, skills, difficulty: difficulty.value, plan_id: plan.value || null, transcript_consent: true };
    try {
      const session = await api("/api/interviews", { method: "POST", body: payload });
      location.hash = `#/interview/${session.interview_id}`;
    } catch (e) { error.textContent = e.message; start.disabled = false; start.textContent = "Start mock interview"; }
  } }, "Start mock interview");
  main.replaceChildren(
    h("div", { class: "interview-page" },
      h("div", { class: "interview-heading" }, h("div", {}, h("p", { class: "eyebrow" }, "PRACTICE · REFLECT · IMPROVE"),
        h("h1", { class: "page-title" }, "Mock interview"),
        h("p", { class: "lede" }, "Practice a role-specific interview, then see the evidence behind each score."))),
      h("section", { class: "interview-card" }, h("h2", {}, "Set up your interview"),
        h("div", { class: "field" }, h("label", { for: "interview-role" }, h("span", {}, "Target job")),
          query, results), picked,
        h("label", { class: "field" }, h("span", {}, "Difficulty"), difficulty),
        h("div", { class: "form-section" }, h("h3", {}, "Your skills and experience"),
          h("p", { class: "muted" }, "Only these skill names and levels are used to personalize questions. Your uploaded CV is not stored or sent from this screen."), skillList),
        h("label", { class: "field" }, h("span", {}, "Connect a reskilling plan (optional)"), plan),
        h("div", { class: "interview-consent" }, h("label", {}, consent,
          h("span", {}, "I agree to save my answer transcripts and send them to AiversePulse’s configured AI provider for interview feedback. No audio is stored.")),
        h("p", { class: "fine" }, "Voice input uses your browser’s speech recognition when available. Browser speech services may process audio; text entry is always available."),
        error, start)),
      historyBlock(history)));
}

function historyBlock(history) {
  const items = history;
  return h("section", { class: "interview-card" }, h("div", { class: "section-head" }, h("h2", {}, "Previous attempts"),
    h("span", { class: "muted" }, "Compare progress using the same rubric.")),
    items.length ? h("ul", { class: "interview-history" }, items.map((item) => h("li", {},
      h("a", { href: `#/interview/${item.interview_id}` }, h("b", {}, item.role_title),
        h("span", {}, `${fmtTime(item.created_utc)} · ${item.difficulty}`)),
      h("span", { class: "interview-history-score num" }, item.status !== "completed" ? item.status.replaceAll("_", " ") : `Readiness ${pct(item.readiness)}`),
      h("button", { class: "btn ghost sm", type: "button", "aria-label": `Delete attempt for ${item.role_title}`,
        onclick: async () => { if (!confirm("Delete this interview and its saved transcript?")) return;
          try { await api(`/api/interviews/${item.interview_id}`, { method: "DELETE" }); location.reload(); } catch (e) { toast(e.message, "err"); } } }, "Delete"))))
      : h("p", { class: "muted" }, "Completed interviews will appear here."));
}

function renderRoom(main, detail, initial = null) {
  const sessionId = detail.interview_id;
  let current = initial?.question || detail.question;
  let source = initial?.source || detail.source;
  let number = initial?.question_number || 1;
  let stageIndex = initial?.stage_index ?? detail.stage_index ?? 0;
  const total = initial?.total_stages || 5;
  const status = h("span", { class: "interview-status", role: "status" }, "Ready");
  const qText = h("p", { class: "interview-question" });
  const skillChips = h("div", { class: "chips" });
  const transcript = h("textarea", { class: "input interview-answer", rows: 5, maxlength: 4000,
    placeholder: "Type your answer here. You can also use voice input.", "aria-label": "Your answer" });
  const responseFeedback = h("div", { class: "interview-answer-feedback", hidden: true });
  const answerBtn = h("button", { class: "btn primary", type: "submit" }, "Send answer");
  const voiceBtn = h("button", { class: "btn", type: "button" }, "Use voice input");
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechAvailable = Boolean(Speech);
  voiceBtn.disabled = !speechAvailable;
  if (!speechAvailable) voiceBtn.title = "Speech recognition is not available in this browser. Type your answer instead.";
  let recognizer = null;
  if (speechAvailable) {
    recognizer = new Speech(); recognizer.lang = navigator.language || "en-US"; recognizer.continuous = true; recognizer.interimResults = true;
    recognizer.onresult = (event) => {
      let finalText = "", interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript + " "; else interim += event.results[i][0].transcript;
      }
      if (finalText) transcript.value = `${transcript.value}${transcript.value && !transcript.value.endsWith(" ") ? " " : ""}${finalText}`;
      status.textContent = interim ? `Listening · ${interim}` : "Listening";
    };
    recognizer.onerror = (event) => { status.textContent = event.error === "not-allowed" ? "Microphone permission denied" : "Voice input paused"; };
    recognizer.onend = () => { if (status.textContent === "Listening") status.textContent = "Ready"; voiceBtn.textContent = "Use voice input"; delete voiceBtn.dataset.listening; };
  }
  voiceBtn.addEventListener("click", () => {
    if (!recognizer) return;
    if (voiceBtn.dataset.listening) { recognizer.stop(); status.textContent = "Ready"; }
    else { try { recognizer.start(); voiceBtn.dataset.listening = "1"; voiceBtn.textContent = "Stop voice input"; status.textContent = "Listening"; }
      catch { status.textContent = "Voice input is already active"; } }
  });
  const progress = h("div", { class: "interview-progress", role: "progressbar", "aria-label": "Interview progress", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": "1" }, h("i"));
  const stageText = h("span");
  const questionStage = h("span");
  const setQuestion = (q, n, src) => {
    current = q; number = n; source = src || source;
    qText.textContent = q.text || q.question_text || "";
    stageText.textContent = TYPES[q.type || q.question_type] || String(q.stage || "Interview").replaceAll("_", " ");
    questionStage.textContent = stageText.textContent;
    skillChips.replaceChildren(...(q.target_skills || []).map((s) => h("span", { class: "chip-static" }, s)));
    const step = Math.min(total, stageIndex + 1);
    progress.setAttribute("aria-valuenow", String(step));
    progress.querySelector("i").style.width = `${Math.min(100, step / total * 100)}%`;
    status.textContent = "Ready";
    if (window.speechSynthesis && qText.textContent) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(qText.textContent);
      utterance.onstart = () => { status.textContent = "Speaking"; voiceBtn.disabled = true; };
      utterance.onend = () => { status.textContent = paused ? "Paused" : "Ready"; voiceBtn.disabled = paused || !speechAvailable; };
      window.speechSynthesis.speak(utterance);
    }
  };
  const form = h("form", { class: "interview-answer-form", onsubmit: async (e) => {
    e.preventDefault();
    const answer = transcript.value.trim();
    if (!answer) { toast("Add an answer before continuing.", "err"); transcript.focus(); return; }
    answerBtn.disabled = true; voiceBtn.disabled = true; pause.disabled = true; status.textContent = "Thinking";
    try {
      const result = await api(`/api/interviews/${sessionId}/answer`, { method: "POST", body: { question_id: current.question_id, answer } });
      showEvaluation(responseFeedback, result.evaluation);
      transcript.value = "";
      if (result.status === "completed") { recognizer?.stop(); window.speechSynthesis?.cancel(); await renderReport(main, result.report); return; }
      stageIndex = result.stage_index;
      setQuestion(result.question, result.question_number, result.source);
    } catch (e) { status.textContent = "Ready"; toast(e.message, "err"); }
    answerBtn.disabled = paused; voiceBtn.disabled = paused || !speechAvailable; pause.disabled = false;
  } }, h("label", { class: "field" }, h("span", {}, "Your answer"), transcript),
    h("div", { class: "row-actions" }, voiceBtn, answerBtn));
  const repeat = h("button", { class: "btn sm", type: "button", onclick: () => {
    if (!window.speechSynthesis) { toast("Speech playback is unavailable in this browser."); return; }
    recognizer?.stop();
    const u = new SpeechSynthesisUtterance(qText.textContent);
    u.onstart = () => { status.textContent = "Speaking"; voiceBtn.disabled = true; };
    u.onend = () => { status.textContent = paused ? "Paused" : "Ready"; voiceBtn.disabled = paused || !speechAvailable; };
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  } }, "Repeat question");
  let paused = false;
  const pause = h("button", { class: "btn sm", type: "button", onclick: () => {
    paused = !paused;
    if (paused) { recognizer?.stop(); window.speechSynthesis?.pause(); status.textContent = "Paused"; }
    else { window.speechSynthesis?.resume(); status.textContent = "Ready"; }
    pause.textContent = paused ? "Resume" : "Pause";
    answerBtn.disabled = paused; voiceBtn.disabled = paused || !speechAvailable;
  } }, "Pause");
  const end = h("button", { class: "btn sm ghost", type: "button", onclick: async () => {
    if (!confirm("End this interview now? Ending early saves your answers but does not create an assessment.")) return;
    try { await api(`/api/interviews/${sessionId}/end`, { method: "POST", body: {} }); recognizer?.stop(); window.speechSynthesis?.cancel(); location.hash = "#/interview"; }
    catch (e) { toast(e.message, "err"); }
  } }, "End interview");
  setQuestion(current, number, source);
  main.replaceChildren(h("div", { class: "interview-page" },
    h("div", { class: "section-head" }, h("div", {}, h("p", { class: "eyebrow" }, "LIVE PRACTICE"), h("h1", { class: "page-title" }, detail.role_title),
      h("p", { class: "muted" }, `${detail.difficulty || initial?.difficulty || "intermediate"} difficulty · `, stageText)),
      h("div", { class: "interview-room-actions" }, status, repeat, pause, end)),
    progress,
    h("section", { class: "interview-room" },
      h("div", { class: "interviewer-avatar", "aria-hidden": "true" }, h("span", {}, "AP")),
      h("div", { class: "interviewer-meta" }, h("b", {}, "AiversePulse interviewer"), h("span", { class: "muted" }, "AI practice session")),
      h("div", { class: "question-panel" }, h("p", { class: "eyebrow" }, "QUESTION · ", questionStage), qText, skillChips,
        source?.url ? h("a", { class: "cite", href: source.url, target: "_blank", rel: "noopener noreferrer" }, "Grounded in ESCO · source details") : null),
      responseFeedback, form,
      h("p", { class: "fine" }, "Your answer transcript is saved with this interview and sent to the configured AI provider for feedback. No audio is stored."))));
}

function showEvaluation(host, evaluation) {
  if (!evaluation) return;
  host.hidden = false;
  host.replaceChildren(h("h3", {}, "Answer feedback"),
    h("ul", { class: "interview-dimension-list" }, Object.entries(evaluation.scores || {}).map(([key, score]) =>
      h("li", {}, h("div", {}, h("b", {}, LABELS[key] || key), h("p", {}, evaluation.rationale?.[key] || "Not enough evidence in this answer.")),
        h("span", { class: "num" }, score == null ? "Not assessed" : `${score}/4`)))));
}

async function renderReport(main, report) {
  const history = (await api("/api/interviews").catch(() => ({ interviews: [] }))).interviews || [];
  const comparable = history.filter((x) => x.status === "completed" && x.role_id === report.role_id && x.interview_id !== report.interview_id)
    .sort((a, b) => String(a.created_utc).localeCompare(String(b.created_utc)));
  const previous = comparable.at(-1);
  const delta = (current, prior) => prior == null ? "First completed attempt" : `${Number(current) - Number(prior) >= 0 ? "+" : ""}${Number(current) - Number(prior)} points vs previous attempt`;
  const scoreCard = (label, key, note) => h("section", { class: "interview-score-card" }, h("span", { class: "muted" }, label),
    h("b", { class: "interview-big-score num" }, pct(report[key])),
    h("div", { class: "interview-meter", role: "progressbar", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(report[key]) },
      h("i", { style: { width: pct(report[key]) } })), h("span", { class: "fine" }, note));
  const dimensions = h("ul", { class: "interview-dimension-list" }, Object.entries(report.dimensions || {}).map(([key, item]) =>
    h("li", {}, h("div", {}, h("b", {}, LABELS[key] || key), h("p", {}, item.reason),
      h("small", { class: "muted" }, `${item.weight}% rubric weight · ${item.evidence_count} answer${item.evidence_count === 1 ? "" : "s"} scored`)),
      h("span", { class: "num" }, item.score == null ? "Not assessed" : pct(item.score)))));
  const competencies = h("div", { class: "interview-competencies" }, (report.competencies || []).map((c) =>
    h("div", { class: "interview-competency" }, h("div", { class: "section-head" }, h("b", {}, c.name),
      h("span", { class: "num" }, c.interview_score == null ? "Not assessed" : pct(c.interview_score))),
      h("div", { class: "interview-meter" }, h("i", { style: { width: pct(c.interview_score || 0) } })),
      h("small", { class: "muted" }, `Profile ${c.profile_level}/5 · role level ${c.required_level}/5`),
      c.evidence?.length ? h("q", {}, c.evidence[0]) : null)));
  const list = (rows, empty) => rows?.length ? h("ul", { class: "interview-list" }, rows.map((x) => h("li", {}, h("b", {}, x.name || x.skill),
    h("span", {}, x.reason || x.evidence?.[0] || "Demonstrated effectively in your answers.")))) : h("p", { class: "muted" }, empty);
  const recommendations = report.recommendations?.length ? h("ol", { class: "interview-recommendations" }, report.recommendations.map((x) =>
    h("li", {}, h("b", {}, x.skill), h("p", {}, x.reason), h("p", {}, x.exercise),
      x.resources?.length ? h("div", { class: "interview-resource-links" }, x.resources.map((r) => h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, r.title)))
        : h("small", { class: "muted" }, "No curated learning link is currently indexed for this skill.")))) : h("p", { class: "muted" }, "Keep practicing with new role-specific questions.");
  const questionFeedback = report.question_feedback?.length ? h("section", { class: "interview-card" }, h("h2", {}, "Question-by-question feedback"),
    h("div", { class: "interview-question-review" }, report.question_feedback.map((item, i) => h("details", {},
      h("summary", {}, `${i + 1}. ${TYPES[item.type] || item.stage.replaceAll("_", " ")} · ${(item.target_skills || []).join(", ")}`),
      h("p", { class: "interview-question-review-q" }, item.question),
      h("p", { class: "fine" }, "Grounded in ESCO requirements: ", (item.source_refs || []).join(" · "),
        report.source?.url ? [" ", h("a", { href: report.source.url, target: "_blank", rel: "noopener noreferrer" }, "Open source")] : null),
      h("p", {}, h("b", {}, "Your answer: "), item.answer),
      h("ul", { class: "interview-dimension-list" }, Object.entries(item.evaluation?.scores || {}).map(([key, value]) =>
        h("li", {}, h("div", {}, h("b", {}, LABELS[key] || key), h("p", {}, item.evaluation?.rationale?.[key] || "Not assessed.")),
          h("span", { class: "num" }, value == null ? "Not assessed" : `${value}/4`)))))))) : null;
  let planPanel = h("p", { class: "muted" }, "No plan was linked to this interview.");
  if (report.plan_id) {
    planPanel = h("a", { class: "btn sm", href: `#/plans/${report.plan_id}` }, "Open your reskilling plan");
    try {
      const plan = await api(`/api/plans/${report.plan_id}`);
      const activities = (plan.plan?.activities || []).filter((a) => (report.gaps || []).some((g) => g.name.toLowerCase() === String(a.skill_id).toLowerCase()));
      if (activities.length) planPanel = h("div", {}, h("a", { class: "btn sm", href: `#/plans/${report.plan_id}` }, "Open your reskilling plan"),
        h("p", { class: "muted" }, `Related plan activities: ${activities.map((a) => `${a.skill_id} (${a.day_range})`).join(" · ")}`));
    } catch { /* preserve the link if the saved plan is temporarily unavailable */ }
  }
  const compare = previous ? h("section", { class: "interview-card" }, h("h2", {}, "Progress since your last attempt"),
    h("p", { class: "muted" }, `${previous.role_title} · ${fmtTime(previous.created_utc)} · ${previous.difficulty} difficulty`),
    h("div", { class: "interview-compare" }, [["Interview performance", report.performance, previous.performance],
      ["Job readiness", report.readiness, previous.readiness], ["Hiring Competitiveness Index", report.competitiveness, previous.competitiveness]].map(([label, now, before]) =>
      h("div", {}, h("b", {}, label), h("span", { class: "num" }, `${pct(now)} · ${delta(now, before)}`),
        h("div", { class: "interview-meter" }, h("i", { style: { width: pct(now) } }))))))
    : h("section", { class: "interview-card" }, h("h2", {}, "Progress comparison"),
      h("p", { class: "muted" }, "This is your first completed interview for this role. Complete another attempt to compare scores."));
  const sources = report.source ? h("p", { class: "fine" }, "Question context: ", h("a", { href: report.source.url, target: "_blank", rel: "noopener noreferrer" }, report.source.title),
    ` · ${report.source.publisher} · retrieved ${report.source.access_date}`) : null;
  const retry = h("button", { class: "btn primary", type: "button", onclick: () => {
    const payload = { target_role: report.role_id, skills: report.profile || [], difficulty: report.difficulty,
      plan_id: report.plan_id || null, transcript_consent: true };
    api("/api/interviews", { method: "POST", body: payload }).then((session) => { location.hash = `#/interview/${session.interview_id}`; })
      .catch((e) => toast(e.message, "err"));
  } }, "Retry interview");
  main.replaceChildren(h("div", { class: "interview-page" },
    h("div", { class: "interview-heading" }, h("div", {}, h("p", { class: "eyebrow" }, "YOUR PRACTICE REPORT"),
      h("h1", { class: "page-title" }, `${report.role_title} interview assessment`),
      h("p", { class: "lede" }, `Completed ${fmtTime(report.completed_utc)} · ${report.difficulty} difficulty`))),
    h("div", { class: "interview-score-grid" },
      scoreCard("Interview performance", "performance", `Rubric evidence coverage ${pct(report.evidence_coverage)}.`),
      scoreCard("Job readiness", "readiness", `65% interview performance + 35% profile-to-role skill coverage (${pct(report.profile_coverage)}).`),
      scoreCard("Hiring Competitiveness Index", "competitiveness", `70% demonstrated role competency (${pct(report.demonstrated_fit)}) + 30% profile coverage (${pct(report.profile_coverage)}).`)),
    h("p", { class: "interview-disclaimer" }, report.disclaimer),
    h("section", { class: "interview-card" }, h("h2", {}, "Performance by competency"), competencies),
    h("p", { class: "fine" }, "Role skill levels are AiversePulse estimates derived from an O*NET-trained model; they are not ESCO ratings."),
    h("section", { class: "interview-card" }, h("h2", {}, "Interview rubric"), dimensions),
    questionFeedback,
    h("div", { class: "interview-two-col" },
      h("section", { class: "interview-card" }, h("h2", {}, "Strengths"), list(report.strengths, "Your next attempt can reveal more strengths.")),
      h("section", { class: "interview-card" }, h("h2", {}, "Areas to improve"), list(report.gaps, "No specific skill gaps were identified from this attempt."))),
    h("section", { class: "interview-card" }, h("h2", {}, "Recommended next steps"), recommendations, planPanel),
    compare,
    h("div", { class: "interview-report-actions" }, retry, h("a", { class: "btn", href: "#/interview" }, "Interview history")), sources));
}

function renderEnded(main) {
  main.replaceChildren(h("div", { class: "interview-page" }, h("h1", { class: "page-title" }, "Interview ended"),
    h("p", { class: "lede" }, "There were not enough completed answers to create an assessment. You can start another attempt when you are ready."),
    h("a", { class: "btn primary", href: "#/interview" }, "Return to interviews")));
}
