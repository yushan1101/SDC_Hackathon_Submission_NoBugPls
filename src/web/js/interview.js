import { api, h, icon, toast, fmtTime, ApiError, upload } from "./lib.js";
import { preloadSpeech, speak, toWav } from "./voice.js";
import { Owl } from "./owl.js";

const LABELS = {
  knowledge: "Job-relevant knowledge", relevance: "Answer relevance & completeness",
  problem_solving: "Problem-solving & reasoning", communication: "Communication & clarity",
  practical_evidence: "Practical examples & evidence",
};
const TYPES = { behavioral: "HR / behavioral", technical: "Technical", situational: "Situational",
  problem_solving: "Problem-solving", workplace_scenario: "Workplace scenario" };
const STAGE_ORDER = ["behavioral", "technical", "situational", "problem_solving", "workplace_scenario"];
const pct = (n) => `${Math.max(0, Math.min(100, Math.round(Number(n) || 0)))}%`;
const OFFICE = () => window.AP_CONFIG?.VIRTUAL_INTERVIEW_3D === true;
/** Resolves once `el` has a size (a just-inserted room can measure 0 for a frame or two); gives up after ~1 s. */
const sized = (el) => new Promise((resolve) => {
  let frames = 0;
  const check = () => ((el.clientWidth && el.clientHeight) || ++frames > 60 ? resolve() : requestAnimationFrame(check));
  check();
});

/** The interviewer, waiting in the 3D office (the same scene as the live room), with the page's heading and next
 *  step over it. Call mountStage() once the stage is on the page. Without WebGL or the 3D flag the owl stands in. */
function interviewerStage({ eyebrow, title, text, greeting, actions = [] }) {
  const scene = h("div", { class: "interview-stage-scene" },
    greeting ? h("p", { class: "interview-stage-bubble", "aria-hidden": "true" }, greeting) : null);
  const stage = h("section", { class: "interview-stage" }, scene,
    h("div", { class: "interview-stage-copy" }, h("p", { class: "eyebrow" }, eyebrow), h("h1", { class: "page-title" }, title),
      h("p", { class: "lede" }, text), actions.length ? h("div", { class: "interview-stage-actions" }, actions) : null));
  stage.mount = () => {
    const owl = () => { scene.querySelector("canvas")?.remove(); scene.append(new Owl({ size: 168, state: "greeting" }).el); stage.classList.add("is-owl"); };
    if (!OFFICE()) { owl(); return; }
    import("./virtual-office.js").then(async ({ mountVirtualOffice }) => {
      await sized(scene);
      if (!scene.isConnected) return;
      // wide: look left of the interviewer so they sit on the right, clear of the heading; phones: centred
      const unmount = mountVirtualOffice(scene, { onFailure: owl, aimX: (w) => (w > 760 ? -1 : 0.12) });
      const leave = () => { removeEventListener("hashchange", leave); unmount(); };  // the page is replaced on any route
      addEventListener("hashchange", leave);
    }).catch(owl);
  };
  return stage;
}
export async function interviewView(main, interviewId, recommendationId = null, callbacks = {}) {
  main.replaceChildren(h("div", { class: "interview-loading", role: "status" }, "Preparing your interview workspace…"));
  try {
    if (recommendationId) {
      const [recommendation, plans] = await Promise.all([
        api(`/api/interview-recommendations/${encodeURIComponent(recommendationId)}`),
        api("/api/plans").catch(() => ({ plans: [] })),
      ]);
      renderLaunch(main, recommendation, plans.plans || plans || []);
      return;
    }
    if (interviewId) {
      const detail = await api(`/api/interviews/${encodeURIComponent(interviewId)}`);
      if (["in_progress", "paused"].includes(detail.status) && detail.question) {
        if (detail.status === "paused") {
          await api(`/api/interviews/${encodeURIComponent(interviewId)}/resume`, { method: "POST", body: {} });
          detail.status = "in_progress";
        }
        renderRoom(main, detail, null, callbacks); return;
      }
      if (detail.report) { await renderReport(main, detail.report, callbacks); return; }
      renderEnded(main, detail); return;
    }
    const history = await api("/api/interviews");
    renderHistory(main, history.interviews || []);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const next = recommendationId ? `interview/start/${encodeURIComponent(recommendationId)}`
        : interviewId ? `interview/${encodeURIComponent(interviewId)}` : "interview";
      location.hash = `#/signin/${next}`; return;
    }
    main.replaceChildren(h("h1", { class: "page-title" }, "Mock interview"), h("div", { class: "issue error" }, e.message));
  }
}

function renderHistory(main, history) {
  const step = (n, title, text) => h("li", {}, h("span", { class: "num" }, n), h("b", {}, title), h("span", {}, text));
  const empty = h("ol", { class: "interview-steps", "aria-label": "How a mock interview works" },
    step(1, "Pick a role", "Quick Match or your resume suggests roles you could grow into."),
    step(2, "Talk it through", "Five questions, by voice or text, with follow-ups on what you say."),
    step(3, "Get your report", "Scores, job readiness and a plan for what to practise next."));
  const list = h("section", { class: "interview-card" },
    h("div", { class: "section-head" }, h("h2", {}, "Interview history"),
      h("span", { class: "muted" }, `${history.length} ${history.length === 1 ? "session" : "sessions"}`)),
    h("ul", { class: "interview-history" }, history.map((item) => {
      const completed = item.status === "completed";
      const source = item.assessment_source === "resume" ? "Resume recommendation"
        : item.assessment_source === "questionnaire" ? "Quick Match" : "Earlier session";
      const resumable = ["in_progress", "paused"].includes(item.status);
      const statusLabel = item.status === "in_progress" ? "In progress" : item.status.replaceAll("_", " ");
      return h("li", { class: "interview-history-item" },
        h("div", { class: "interview-history-role" }, h("b", {}, item.role_title),
          h("span", {}, `${item.interview_type || "AI mock interview"} · ${source} · ${fmtTime(item.created_utc)} · ${item.difficulty}`),
          resumable ? h("small", { class: "muted" }, item.is_follow_up
            ? `Follow-up to Question ${item.question_number || 1}`
            : `Main Question ${item.question_number || 1} of ${item.total_stages || 5}`) : null),
        h("div", { class: "interview-history-scores" },
          h("span", {}, h("small", {}, "Performance"), h("b", { class: "num" }, item.performance == null ? "—" : pct(item.performance))),
          h("span", {}, h("small", {}, "Job readiness"), h("b", { class: "num" }, item.readiness == null ? "—" : pct(item.readiness)))),
        h("span", { class: `tag interview-history-status ${completed ? "" : "pending"}` }, statusLabel),
        h("div", { class: "interview-history-actions" },
          h("a", { class: "btn ghost sm", href: `#/interview/${item.interview_id}` }, completed ? "View report" : resumable ? "Resume interview" : "View details"),
          h("button", { class: "btn ghost sm", type: "button", "aria-label": `Delete attempt for ${item.role_title}`,
            onclick: async () => { if (!confirm("Delete this interview and its saved transcript?")) return;
              try { await api(`/api/interviews/${item.interview_id}`, { method: "DELETE" }); location.reload(); }
              catch (e) { toast(e.message, "err"); } } }, "Delete")));
    })));
  const open = history.find((item) => ["in_progress", "paused"].includes(item.status));
  const stage = interviewerStage({
    eyebrow: "MOCK INTERVIEW", title: open ? `Ready to pick up ${open.role_title}?` : "Practise with your AI interviewer",
    text: open ? `You stopped at question ${open.question_number || 1} of ${open.total_stages || 5}. Your answers so far are saved.`
      : "A friendly interviewer asks about a role you're aiming for, listens to your answers and tells you what to work on.",
    greeting: open ? "Welcome back! Shall we continue?" : "Hi, I'm your interviewer. Which role shall we practise?",
    actions: open ? [h("a", { class: "btn primary", href: `#/interview/${open.interview_id}` }, icon("quiz"), "Resume interview")]
      : [h("a", { class: "btn primary", href: "#/quiz" }, icon("spark"), "Find a role to practise"),
        h("a", { class: "btn", href: "#/resume" }, icon("file"), "Use my resume")] });
  main.replaceChildren(h("div", { class: "interview-page" }, stage, history.length ? list : empty));
  stage.mount();
}

function renderLaunch(main, recommendation, plans) {
  const skills = recommendation.profile || [];
  const difficulty = h("select", { class: "input", "aria-label": "Interview difficulty" },
    h("option", { value: "foundational" }, "Foundational"), h("option", { value: "intermediate", selected: true }, "Intermediate"),
    h("option", { value: "advanced" }, "Advanced"));
  // The agent starts writing the first question now, so Start opens the room almost at once.
  const prepare = () => api("/api/interviews/prefetch", { method: "POST",
    body: { recommendation_id: recommendation.recommendation_id, difficulty: difficulty.value } }).catch(() => {});
  difficulty.addEventListener("change", prepare);
  void prepare();
  const planOptions = [h("option", { value: "" }, "No plan selected"), ...plans
    .filter((x) => x.audience === "individual" && x.target_role === recommendation.role_id)
    .map((x) => h("option", { value: x.plan_id }, `${x.target_role || "Role plan"} · ${x.status} · ${fmtTime(x.created_utc)}`))];
  const plan = h("select", { class: "input", "aria-label": "Link a learning plan" }, planOptions);
  const consent = h("input", { type: "checkbox" });
  const error = h("p", { class: "error", role: "alert" });
  const start = h("button", { class: "btn primary", type: "button", onclick: async () => {
    error.textContent = "";
    if (!consent.checked) { error.textContent = "Please agree to the transcript and AI processing notice to continue."; consent.focus(); return; }
    start.disabled = true; start.textContent = "Building your first question…";
    const payload = { recommendation_id: recommendation.recommendation_id, difficulty: difficulty.value,
      plan_id: plan.value || null, transcript_consent: true };
    try {
      const session = await api("/api/interviews", { method: "POST", body: payload });
      location.hash = `#/interview/${session.interview_id}`;
    } catch (e) { error.textContent = e.message; start.disabled = false; start.textContent = "Start mock interview"; }
  } }, "Start mock interview");
  const stage = interviewerStage({
    eyebrow: `MOCK INTERVIEW · ${recommendation.source === "resume" ? "FROM YOUR RESUME" : "FROM QUICK MATCH"}`,
    title: recommendation.role_title,
    text: "Five questions: behavioural, technical, situational, problem-solving and a workplace scenario, with follow-ups on your answers.",
    greeting: `Hello! Ready to talk about the ${recommendation.role_title} role?` });
  main.replaceChildren(
    h("div", { class: "interview-page" }, stage,
      h("section", { class: "interview-card" }, h("h2", {}, "Set up your interview"),
        h("p", { class: "muted" }, `Recommended role · ESCO ${recommendation.role_id}`),
        h("div", { class: "interview-skills" }, skills.map((s) => h("span", { class: "chip-static" }, `${s.name} · ${s.level}/5`))),
        h("label", { class: "field" }, h("span", {}, "Difficulty"), difficulty),
        h("label", { class: "field" }, h("span", {}, "Link a learning plan (optional)"), plan),
        h("div", { class: "interview-consent" }, h("label", {}, consent,
          h("span", {}, "I agree to save my answer transcripts and have them processed by AI for interview feedback. No audio is stored.")),
        h("p", { class: "fine" }, "Voice input uses your browser’s speech recognition when available. Browser speech services may process audio; text entry is always available.")),
        error, start),
      h("a", { class: "btn ghost", href: "#/interview" }, "Back to interview history")));
  stage.mount();
}

function renderRoom(main, detail, initial = null, callbacks = {}) {
  const sessionId = detail.interview_id;
  let current = initial?.question || detail.question;
  let source = initial?.source || detail.source;
  let stageIndex = initial?.stage_index ?? detail.stage_index ?? 0;
  const total = initial?.total_stages || 5;
  const previousBodyOverflow = document.body.style.overflow;
  const alreadyInInterviewRoom = document.body.classList.contains("interview-takeover-active");
  document.body.classList.add("interview-takeover-active");
  document.body.style.overflow = "hidden";
  const status = h("span", { class: "interview-status is-off", role: "status", "aria-live": "polite" }, "Microphone off");
  const qText = h("p", { class: "interview-question" });
  const skillChips = h("div", { class: "chips" });
  const transcript = h("textarea", { class: "input interview-answer", rows: 5, maxlength: 4000,
    placeholder: "Type your answer here, or record an answer and review the transcript.", "aria-label": "Your answer" });
  transcript.value = detail.draft_answer || "";
  const responseFeedback = h("div", { class: "interview-answer-feedback", hidden: true });
  const answerBtn = h("button", { class: "btn primary", type: "submit", "aria-label": "Confirm and send answer" }, "Send answer");
  const startBtn = h("button", { class: "btn primary", type: "button", "aria-label": "Start answer recording" }, "Start");
  const stopBtn = h("button", { class: "btn", type: "button", disabled: true, "aria-label": "Stop recording" }, "Stop");
  const retryBtn = h("button", { class: "btn sm", type: "button", disabled: true, "aria-label": "Retry recording" }, "Retry");
  const muteBtn = h("button", { class: "btn sm", type: "button", disabled: true, "aria-label": "Mute microphone" }, "Mute");
  const duration = h("span", { class: "interview-recording-time num", "aria-label": "Recording duration" }, "00:00");
  const deviceSelect = h("select", { class: "interview-mic-select", "aria-label": "Microphone device" },
    h("option", { value: "" }, "System default microphone"));
  const languageSelect = h("select", { class: "interview-mic-select", "aria-label": "Speech recognition language" },
    h("option", { value: "en-US" }, "English (US)"), h("option", { value: "en-GB" }, "English (UK)"),
    h("option", { value: "en-AU" }, "English (Australia)"), h("option", { value: "ms-MY" }, "Malay"),
    h("option", { value: "zh-CN" }, "Chinese (Simplified)"));
  const micBars = Array.from({ length: 7 }, () => h("i", { "aria-hidden": "true" }));
  const meter = h("div", { class: "interview-mic-meter", role: "img", "aria-label": "Live microphone sound level" }, micBars);
  // Tesla-style room: the interviewer fills the screen; one status line and an icon dock carry everything else.
  const voicePanel = h("div", { class: "interview-voice-panel", dataset: { state: "off" } }, meter, status, duration);
  const dockIcon = (btn, name, label, extra = "") => {
    btn.className = `dock-btn ${extra}`.trim(); btn.replaceChildren(icon(name));
    btn.setAttribute("aria-label", label); btn.title = label;
    return btn;
  };
  dockIcon(startBtn, "mic", "Start answering", "dock-mic is-start");
  dockIcon(stopBtn, "stop", "Stop recording", "dock-mic is-stop");
  dockIcon(retryBtn, "replay", "Record again");
  dockIcon(muteBtn, "micOff", "Mute microphone"); muteBtn.setAttribute("aria-pressed", "false");
  dockIcon(answerBtn, "send", "Send answer", "dock-send");
  const settings = h("div", { id: "interview-settings", class: "interview-settings", popover: "auto", "aria-label": "Microphone and language" },
    h("label", { class: "interview-voice-field" }, h("span", {}, "Microphone"), deviceSelect),
    h("label", { class: "interview-voice-field" }, h("span", {}, "Language"), languageSelect),
    h("p", { class: "fine" }, "Only your reviewed transcript is saved. Browser speech recognition may process microphone audio; AiversePulse does not store audio."));
  const settingsBtn = dockIcon(h("button", { type: "button", popovertarget: "interview-settings" }), "sliders", "Microphone, language and privacy");
  // Voice | Type, like a car's view switch: talking shows the live caption, typing shows the answer box.
  let view = "voice";
  const viewSwitch = h("div", { class: "dock-view", role: "group", "aria-label": "Answer by" },
    h("span", { class: "dock-view-thumb", "aria-hidden": "true" }),
    ...[["voice", "mic", "Voice"], ["type", "keyboard", "Type"]].map(([key, ic, label]) => h("button", { type: "button", "data-view": key,
      "aria-label": `Answer by ${label.toLowerCase()}`, title: label, onclick: () => setView(key) }, icon(ic))));
  const setView = (next) => {
    view = next; form.dataset.view = next;
    viewSwitch.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === next)));
    if (next === "type") requestAnimationFrame(() => transcript.focus({ preventScroll: true }));
  };
  const livePreview = h("p", { class: "interview-live-preview", "aria-live": "polite", hidden: true });
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  // Server ASR (the configured speech model, MiMo) whenever the interview offers it: the answer is recorded here and
  // transcribed when you stop. The browser's own recogniser is only the fallback.
  const asr = Boolean(detail.asr) && typeof MediaRecorder !== "undefined";
  const speechAvailable = asr || Boolean(Speech);
  const recognizer = Speech && !asr ? new Speech() : null;
  let recorder = null, chunks = [];
  const stopRecorder = () => new Promise((resolve) => {
    if (!recorder || recorder.state === "inactive") { resolve(null); return; }
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    recorder.stop();
  });
  const transcribe = async (blob) => {
    if (!blob || blob.size < 2000) return;
    const form = new FormData();
    form.append("file", await toWav(blob), "answer.wav"); form.append("lang", languageSelect.value);
    const { text } = await upload(`/api/interviews/${encodeURIComponent(sessionId)}/transcribe`, form);
    const piece = (text || "").trim();
    if (!piece) return;
    recordedText = piece;
    const base = transcript.value.trimEnd(); transcript.value = `${base}${base ? " " : ""}${piece}`.slice(0, 4000);
  };
  if (recognizer) {
    recognizer.lang = languageSelect.value;
    recognizer.continuous = true;
    recognizer.interimResults = true;
  }
  let micStream = null, audioContext = null, analyser = null, audioSource = null, meterFrame = 0;
  let recording = false, starting = false, recognitionActive = false, recognitionRequested = false, recognitionStopResolve = null;
  let finishPromise = null;
  let recognitionStopTimer = null, intentionalStop = false, discarded = false, muted = false;
  let recordingAttempted = false, recordedText = "", interimText = "", speechError = null;
  let elapsedMs = 0, timerStartedAt = null, durationTimer = null;
  let deviceEnumeration = 0;
  let interviewerSpeaking = false, currentUtterance = null, paused = false;
  let microphoneLevel = 0, speechCue = null, speechLevel = 0, speechBands = null, lastAvatarSignalAt = 0;
  let officeDisposer = null;
  // The interviewer speaks (and the microphone opens) only once Mina is fully in the room, so there is no voice from an
  // empty chair and no half-loaded model on screen. Without the 3D office there is nothing to wait for.
  const officeEnabled = window.AP_CONFIG?.VIRTUAL_INTERVIEW_3D === true;
  let officeReady = !officeEnabled, markOfficeReady = () => {};
  const officeArrived = officeEnabled ? new Promise((resolve) => {
    markOfficeReady = () => { if (officeReady) return; officeReady = true; resolve(); room.classList.add("is-office-ready"); updateControls(); };
  }) : Promise.resolve();
  // Mina only "speaks" (lips, gestures) while her voice is actually playing: while the clip is still on its way she
  // waits, calm and attentive, so sound and movement start together.
  let voicePlaying = false;
  const updateAvatarPresentation = () => {
    const micState = voicePanel.dataset.state;
    const state = voicePlaying ? "speaking" : interviewerSpeaking ? "idle"
      : ["ready", "listening", "speaking", "captured"].includes(micState) ? "listening" : "idle";
    window.dispatchEvent(new CustomEvent("aiversepulse:interview-avatar-state", { detail: {
      state, microphoneLevel, speechCue, speechLevel, speechBands,
    } }));
  };
  const setMicState = (state, message, present = true) => {
    voicePanel.dataset.state = state;
    status.className = `interview-status is-${state}`;
    status.textContent = message;
    if (present) updateAvatarPresentation();
  };
  const updateControls = () => {
    startBtn.disabled = recording || starting || Boolean(finishPromise) || paused || interviewerSpeaking || !officeReady;
    stopBtn.disabled = !recording || Boolean(finishPromise);
    retryBtn.disabled = !recordingAttempted || recording || starting || Boolean(finishPromise) || paused || interviewerSpeaking;
    muteBtn.disabled = !micStream || Boolean(finishPromise) || interviewerSpeaking || paused;
    deviceSelect.disabled = recording || starting || Boolean(finishPromise) || paused || interviewerSpeaking;
    languageSelect.disabled = recording || starting || Boolean(finishPromise) || paused || interviewerSpeaking;
  };
  const updateDuration = () => {
    const ms = elapsedMs + (timerStartedAt == null ? 0 : Date.now() - timerStartedAt);
    const seconds = Math.floor(ms / 1000);
    duration.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };
  const startDuration = () => {
    if (timerStartedAt != null) return;
    timerStartedAt = Date.now(); durationTimer = setInterval(updateDuration, 250);
  };
  const pauseDuration = () => {
    if (timerStartedAt != null) elapsedMs += Date.now() - timerStartedAt;
    timerStartedAt = null; clearInterval(durationTimer); durationTimer = null; updateDuration();
  };
  const resetDuration = () => { pauseDuration(); elapsedMs = 0; updateDuration(); };
  const refreshMicrophones = async (selectedId = "") => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const requestId = ++deviceEnumeration;
    try {
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
      if (requestId !== deviceEnumeration) return;
      deviceSelect.replaceChildren(h("option", { value: "" }, "System default microphone"), ...inputs.map((device, index) =>
        h("option", { value: device.deviceId }, device.label || `Microphone ${index + 1}`)));
      if (selectedId && inputs.some((device) => device.deviceId === selectedId)) deviceSelect.value = selectedId;
    } catch { /* the browser may not expose device details */ }
  };
  void refreshMicrophones();
  languageSelect.addEventListener("change", () => { if (recognizer) recognizer.lang = languageSelect.value; });
  const releaseAudio = () => {
    cancelAnimationFrame(meterFrame); meterFrame = 0;
    try { audioSource?.disconnect(); } catch { /* already disconnected */ }
    audioSource = null; analyser = null;
    micStream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    micStream = null; audioContext?.close().catch(() => {}); audioContext = null;
    micBars.forEach((bar) => { bar.style.height = "5px"; });
    microphoneLevel = 0;
    updateAvatarPresentation();
    muteBtn.setAttribute("aria-pressed", "false"); muteBtn.setAttribute("aria-label", "Mute microphone");
  };
  const watchAudio = () => {
    if (!analyser) return;
    const waveform = new Uint8Array(analyser.fftSize), spectrum = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!analyser || !micStream) return;
      analyser.getByteTimeDomainData(waveform); analyser.getByteFrequencyData(spectrum);
      let squares = 0;
      for (const sample of waveform) { const amplitude = (sample - 128) / 128; squares += amplitude * amplitude; }
      const volume = Math.sqrt(squares / waveform.length), bandSize = Math.max(1, Math.floor(spectrum.length / micBars.length));
      microphoneLevel = recording && !muted && !interviewerSpeaking
        ? Math.max(0, Math.min(1, (volume - 0.008) / 0.12)) : 0;
      micBars.forEach((bar, index) => {
        const start = index * bandSize, end = Math.min(spectrum.length, start + bandSize);
        let sum = 0; for (let i = start; i < end; i++) sum += spectrum[i];
        bar.style.height = `${5 + Math.round((end > start ? sum / (end - start) / 255 : 0) * 24)}px`;
      });
      if (recording && !muted && !interviewerSpeaking && !speechError) {
        // Touch the DOM only on a change; the throttled branch below tells the avatar.
        const [state, message] = volume > 0.025 ? ["speaking", "Speaking"]
          : ["listening", speechAvailable ? "Listening" : "Listening · no transcription here; type your answer"];
        if (voicePanel.dataset.state !== state || status.textContent !== message) setMicState(state, message, false);
      }
      // The avatar uses the same measured input as the visible microphone meter.
      // Limit presentation events to the room's 30 fps render rate.
      const now = performance.now();
      if (now - lastAvatarSignalAt >= 33) {
        lastAvatarSignalAt = now;
        updateAvatarPresentation();
      }
      meterFrame = requestAnimationFrame(tick);
    };
    meterFrame = requestAnimationFrame(tick);
  };
  const stopRecognition = () => new Promise((resolve) => {
    if (!recognizer || (!recognitionActive && !recognitionRequested)) { resolve(); return; }
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true; clearTimeout(recognitionStopTimer); recognitionStopTimer = null;
      recognitionStopResolve = null; intentionalStop = false; recognitionRequested = false; resolve();
    };
    recognitionStopResolve = settle; recognitionStopTimer = setTimeout(() => {
      try { recognizer.abort(); } catch { /* recognizer already ended */ }
      settle();
    }, 1800); intentionalStop = true;
    try { recognizer.stop(); } catch { settle(); }
  });
  if (recognizer) {
    recognizer.onstart = () => {
      recognitionActive = true;
      if ((!recording && !starting) || muted || interviewerSpeaking || discarded) { void stopRecognition(); return; }
      if (recording && !muted && !interviewerSpeaking && !speechError) setMicState("listening", "Listening · speak your answer");
    };
    recognizer.onresult = (event) => {
      // Playback starts only after capture has stopped, so accept the final
      // recognition event while stop() drains its last transcript.
      if ((!recording && !starting) || muted) return;
      let finalText = ""; interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript.trim() + " ";
        else interimText += event.results[i][0].transcript;
      }
      if (finalText) {
        const piece = finalText.trim();
        speechError = null;
        recordedText += `${recordedText && !recordedText.endsWith(" ") ? " " : ""}${piece} `;
        const base = transcript.value.trimEnd(); transcript.value = `${base}${base ? " " : ""}${piece}`;
        setMicState("speaking", "Speech detected · transcript captured");
      }
      livePreview.textContent = interimText ? `Live transcript: ${interimText}` : ""; livePreview.hidden = !interimText;
    };
    recognizer.onerror = (event) => {
      recognitionRequested = false;
      if (discarded || (event.error === "aborted" && intentionalStop)) return;
      const messages = {
        "not-allowed": "Microphone access is blocked. Allow it in your browser settings, then try again.",
        "service-not-allowed": "The browser speech service is unavailable. Type your answer instead.",
        "audio-capture": "No microphone input was detected. Check the selected microphone and retry.",
        "no-speech": "No speech detected. Retry recording or type your answer.",
        network: "Browser transcription is unavailable right now. You can type your answer.",
      };
      speechError = messages[event.error] || `Speech recognition failed (${event.error}). Retry or type your answer.`;
      if (starting) return;
      recording = false; muted = false; pauseDuration(); releaseAudio(); updateControls();
      setMicState("error", speechError);
    };
    recognizer.onend = () => {
      const endedIntentionally = intentionalStop;
      recognitionActive = false; recognitionRequested = false; recognitionStopResolve?.();
      if (endedIntentionally && !recognitionStopResolve) intentionalStop = false;
      if (recording && !endedIntentionally && !muted && !interviewerSpeaking && !discarded) setTimeout(() => {
        if (!recording || muted || interviewerSpeaking || discarded || recognitionActive) return;
        try { recognitionRequested = true; recognizer.start(); } catch { recognitionRequested = false; void finishRecording(true); }
      }, 250);
    };
  }
  const finishRecording = (fromRecognizer = false, announce = true) => {
    if (finishPromise) return finishPromise;
    if (!recording && !micStream) return Promise.resolve();
    finishPromise = (async () => {
      if (announce) setMicState("processing", "Transcribing your answer…");
      if (!fromRecognizer) await stopRecognition();
      const audio = await stopRecorder(); recorder = null;
      recording = false; muted = false; pauseDuration();
      releaseAudio(); interimText = ""; livePreview.textContent = ""; livePreview.hidden = true;
      if (audio) {
        setMicState("processing", "Transcribing…");
        try { await transcribe(audio); } catch (e) { speechError = e.message; }
      }
      if (announce) {
        const hasAnswer = Boolean(transcript.value.trim());
        if (hasAnswer) setView("type");
        setMicState(hasAnswer ? "captured" : "error", hasAnswer
          ? "Captured · review, then send"
          : speechError || speechAvailable ? speechError || "No speech was transcribed · check the language, retry, or type your answer"
            : "Speech recognition is unavailable in this browser · type your answer instead");
      }
    })().finally(() => { finishPromise = null; updateControls(); });
    updateControls();
    return finishPromise;
  };
  const startRecording = async () => {
    if (recording || starting || paused || interviewerSpeaking) return;
    setMode("focus");  // like shifting into Drive: answering switches to the focused view
    starting = true;
    speechError = null;
    recordingAttempted = true; updateControls(); setMicState("processing", "Requesting microphone access…");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      starting = false; setMicState("error", "Voice answers aren't available in this browser. Type your answer instead."); updateControls(); return;
    }
    try {
      const selectedDevice = deviceSelect.value;
      const capture = navigator.mediaDevices.getUserMedia({ audio: {
        ...(selectedDevice ? { deviceId: { exact: selectedDevice } } : {}),
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      } });
      // Start STT synchronously from the user's click, before waiting for the
      // permission prompt. Some browsers drop user activation after an await.
      if (recognizer) {
        try { recognitionRequested = true; recognizer.start(); }
        catch (error) {
          recognitionRequested = false;
          speechError = error.name === "InvalidStateError"
            ? "Speech recognition is already active. Stop it and retry."
            : "The browser could not start speech recognition. Retry or type your answer.";
        }
      }
      micStream = await capture;
      const track = micStream.getAudioTracks().find((candidate) => candidate.readyState === "live");
      if (!track || !track.enabled) throw new Error("The selected microphone track is not active.");
      await refreshMicrophones(track.getSettings?.().deviceId || "");
      if (paused || interviewerSpeaking || discarded) {
        await stopRecognition(); starting = false; releaseAudio(); updateControls();
        if (!discarded) setMicState(paused ? "off" : "ready", paused ? "Paused · microphone off" : "Ready to answer · microphone off");
        return;
      }
      track.onended = () => {
        if (!recording || discarded) return;
        recording = false; pauseDuration(); releaseAudio(); updateControls();
        setMicState("error", "Microphone disconnected. Reconnect it and retry recording.");
      };
      const AudioContextType = window.AudioContext || window.webkitAudioContext;
      if (AudioContextType) {
        audioContext = new AudioContextType(); await audioContext.resume();
        analyser = audioContext.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.75;
        audioSource = audioContext.createMediaStreamSource(micStream); audioSource.connect(analyser); watchAudio();
      }
      if (asr) {
        chunks = []; recorder = new MediaRecorder(micStream);
        recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        recorder.start(1000);
      }
      starting = false; recording = true; muted = false; muteBtn.setAttribute("aria-pressed", "false"); muteBtn.setAttribute("aria-label", "Mute microphone"); startDuration(); updateControls();
      if (asr) setMicState("listening", "Listening");
      else if (recognizer) {
        if (speechError) setMicState("error", speechError);
        else if (recognitionActive) setMicState("listening", "Listening · speak your answer");
        else setMicState("processing", "Starting speech recognition…");
      } else setMicState("ready", "Microphone active · speech recognition unavailable; type your answer");
    } catch (error) {
      if (recognizer && (recognitionActive || recognitionRequested)) {
        intentionalStop = true;
        try { recognizer.abort(); } catch { intentionalStop = false; }
      }
      starting = false; recording = false; pauseDuration(); releaseAudio(); updateControls();
      const messages = {
        NotAllowedError: "Microphone access is blocked. Allow it in your browser settings, then try again.",
        NotFoundError: "No microphone was found. Connect a microphone and retry.",
        NotReadableError: "The microphone is busy in another app. Close that app or choose another input.",
        SecurityError: "Voice answers aren't available in this browser. Type your answer instead.",
      };
      setMicState("error", messages[error.name] || error.message || "Could not start microphone capture. Retry or type your answer.");
    }
  };
  startBtn.addEventListener("click", startRecording);
  stopBtn.addEventListener("click", () => { void finishRecording(); });
  retryBtn.addEventListener("click", () => {
    if (recordedText) {
      const value = transcript.value, suffix = recordedText.trimEnd();
      if (value.trimEnd().endsWith(suffix)) transcript.value = value.trimEnd().slice(0, -suffix.length).trimEnd();
    }
    recordedText = ""; resetDuration(); livePreview.hidden = true; livePreview.textContent = ""; void startRecording();
  });
  muteBtn.addEventListener("click", async () => {
    if (!micStream) return;
    muted = !muted; micStream.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    if (muted) {
      pauseDuration(); await stopRecognition(); muteBtn.setAttribute("aria-pressed", "true"); muteBtn.setAttribute("aria-label", "Unmute microphone");
      setMicState("off", "Microphone muted · unmute to continue recording");
    } else {
      muteBtn.setAttribute("aria-pressed", "false"); muteBtn.setAttribute("aria-label", "Mute microphone"); startDuration();
      if (recognizer && recording) {
        try { recognitionRequested = true; recognizer.start(); setMicState("listening", "Listening · speak your answer"); }
        catch { recognitionRequested = false; setMicState("error", "Could not resume speech recognition. Stop and retry, or type your answer."); }
      } else setMicState(asr ? "listening" : "ready", asr ? "Listening" : "Microphone active · type your answer");
    }
    updateControls();
  });
  // The interviewer reads each question in the app's own voice (the same as Read aloud in chat), whatever voices the
  // browser has. Her lips follow the loudness of that audio.
  const playQuestion = async () => {
    const text = qText.textContent;
    if (!text) return;
    interviewerSpeaking = true; voicePlaying = false; updateControls(); setMicState("processing", "Getting ready to ask…");
    if (recording || micStream) await finishRecording(false, false);
    let lips = 0;
    const voice = currentUtterance = speak(text, { onStart: () => {
      if (currentUtterance !== voice) return;
      speechCue = { word: text, startedAt: performance.now(), secondsPerCharacter: 0.095 };
      interviewerSpeaking = true; voicePlaying = true; updateControls(); setMicState("processing", "Interviewer speaking");
      const follow = () => {
        if (currentUtterance !== voice) { speechLevel = 0; return; }
        speechLevel = voice.level(); speechBands = voice.bands(); updateAvatarPresentation();
        lips = requestAnimationFrame(follow);
      };
      follow();
    } });
    await voice.done;
    cancelAnimationFrame(lips);
    if (currentUtterance !== voice) return;
    currentUtterance = null; interviewerSpeaking = false; voicePlaying = false; speechCue = null; speechLevel = 0; updateControls();
    setMicState(paused ? "off" : "ready", paused ? "Paused · microphone off" : "Ready to answer · microphone off");
  };
  const dispose = () => {
    discarded = true; recording = false; muted = false; pauseDuration();
    try { recognizer?.abort(); } catch { /* already stopped */ }
    recognitionActive = false; recognitionRequested = false; releaseAudio(); currentUtterance?.stop(); currentUtterance = null;
    officeDisposer?.(); officeDisposer = null;
    if (!alreadyInInterviewRoom) document.body.classList.remove("interview-takeover-active");
    document.body.style.overflow = previousBodyOverflow;
    document.removeEventListener("keydown", onEscape);
  };
  window.addEventListener("hashchange", () => { if (location.hash !== `#/interview/${sessionId}`) dispose(); });
  window.addEventListener("pagehide", dispose, { once: true });
  const progress = h("div", { class: "interview-progress", role: "progressbar", "aria-label": "Interview progress", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": "1" }, h("i"));
  const stageText = h("span");
  const questionStage = h("span");
  const questionLabel = (question) => {
    const mainNumber = Math.min(total, Math.max(1, stageIndex + 1));
    return question?.is_follow_up || question?.parent_question_id ? `Q${mainNumber} · follow-up` : `Q${mainNumber} / ${total}`;
  };
  const counter = h("span", { class: "interview-counter", role: "status", "aria-live": "polite" }, questionLabel(current));
  const setQuestion = (q, src) => {
    current = q; source = src || source;
    counter.textContent = questionLabel(q);
    qText.textContent = q.text || q.question_text || "";
    qText.animate?.([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 420, easing: "ease-out" });
    stageText.textContent = TYPES[q.type || q.question_type] || String(q.stage || "Interview").replaceAll("_", " ");
    questionStage.textContent = stageText.textContent;
    skillChips.replaceChildren(...(q.target_skills || []).map((s) => h("span", { class: "chip-static" }, s)));
    const step = Math.min(total, Math.max(1, stageIndex + 1));
    progress.setAttribute("aria-valuenow", String(step));
    progress.querySelector("i").style.width = `${Math.min(100, step / total * 100)}%`;
    setMicState("off", "Microphone off");
    if (qText.textContent) { void preloadSpeech(qText.textContent); void officeArrived.then(playQuestion); }
  };
  const form = h("form", { class: "interview-answer-form", onsubmit: async (e) => {
    e.preventDefault();
    if (recording || micStream) await finishRecording();
    const answer = transcript.value.trim();
    if (!answer) { toast("Add an answer before continuing.", "err"); transcript.focus(); return; }
    answerBtn.disabled = true; pause.disabled = true; setMicState("processing", "Submitting answer for feedback…");
    try {
      const result = await api(`/api/interviews/${sessionId}/answer`, { method: "POST", body: { question_id: current.question_id, answer } });
      showEvaluation(responseFeedback, result.evaluation);
      transcript.value = "";
      recordedText = ""; recordingAttempted = false; resetDuration();
      if (result.status === "completed") { dispose(); await renderReport(main, result.report, callbacks); return; }
      stageIndex = result.stage_index;
      setQuestion(result.question, result.source);
    } catch (e) { setMicState("captured", "Answer captured · review or edit before sending"); toast(e.message, "err"); }
    answerBtn.disabled = false; pause.disabled = false; updateControls();
  } }, h("label", { class: "field interview-type-sheet" }, h("span", { class: "sr-only" }, "Your answer"), transcript),
    livePreview, voicePanel);
  const repeat = dockIcon(h("button", { type: "button", onclick: () => { void playQuestion(); } }), "volume", "Replay question");
  const pause = h("button", { class: "btn sm", type: "button", onclick: () => {
    paused = !paused;
    if (paused) {
      if (recording || micStream) void finishRecording();
      currentUtterance?.pause(); voicePlaying = false; updateAvatarPresentation();  // she pauses with her voice
      if (!interviewerSpeaking) setMicState("off", "Paused · microphone off");
    } else {
      currentUtterance?.resume(); voicePlaying = Boolean(currentUtterance && speechCue); updateAvatarPresentation();
      if (!interviewerSpeaking) setMicState("off", "Microphone off");
    }
    pause.replaceChildren(icon(paused ? "play" : "pause"));
    pause.setAttribute("aria-label", paused ? "Resume interview" : "Pause interview"); pause.title = pause.getAttribute("aria-label");
    answerBtn.disabled = paused; updateControls();
  } });
  dockIcon(pause, "pause", "Pause interview");
  form.append(h("nav", { class: "interview-dock", "aria-label": "Interview controls" }, viewSwitch,
    h("span", { class: "dock-gap" }), repeat, pause, retryBtn, muteBtn, startBtn, stopBtn, answerBtn,
    h("span", { class: "dock-gap" }), settingsBtn), settings);
  setView(transcript.value || !speechAvailable ? "type" : "voice");
  const end = h("button", { class: "interview-exit-button", type: "button", onclick: async () => {
    end.disabled = true; end.setAttribute("aria-busy", "true");
    try {
      const pendingTranscript = interimText.trim();
      if (recording || micStream) await finishRecording(false, false);
      if (pendingTranscript && !transcript.value.toLocaleLowerCase().includes(pendingTranscript.toLocaleLowerCase())) {
        transcript.value = [transcript.value.trim(), pendingTranscript].filter(Boolean).join(" ").slice(0, 4000);
      }
      currentUtterance?.stop(); currentUtterance = null; interviewerSpeaking = false; voicePlaying = false; speechCue = null;
      await api(`/api/interviews/${sessionId}/pause`, { method: "POST", body: { draft_answer: transcript.value.slice(0, 4000) } });
      const destination = detail.assessment_source === "questionnaire" ? "#/quiz" : "#/resume";
      dispose(); location.hash = destination;
      toast("Progress saved. Resume this interview from Interview History when you’re ready.");
    } catch (e) {
      end.disabled = false; end.removeAttribute("aria-busy");
      toast(`Could not save your interview progress. You are still in the interview. ${e.message}`, "err");
    }
  } }, icon("close"));
  end.setAttribute("aria-label", "Save and exit"); end.title = "Save and exit";
  const onEscape = (event) => { if (event.key === "Escape") { event.preventDefault(); end.click(); } };
  document.addEventListener("keydown", onEscape);
  setQuestion(current, source);
  const officeHost = officeEnabled ? h("div", { class: "interview-office-host", role: "group",
    "aria-label": "First-person view of a modern interview office, seated across the desk" },
    h("span", { class: "interview-office-label", "aria-hidden": "true" }, "VIRTUAL INTERVIEW OFFICE"),
    h("span", { class: "interview-office-loading", role: "status" }, "Preparing your interview room…")) : null;
  const loadPct = h("b", {}, "0%");
  const loadRing = h("span", { class: "room-loading-ring", "aria-hidden": "true" });
  const roomLoading = officeEnabled ? h("div", { class: "room-loading", role: "status", "aria-live": "polite" },
    loadRing, h("p", {}, "Your interviewer is joining", h("br"), loadPct)) : null;
  const showProgress = (p) => {
    const pct = Math.round(Math.min(1, Math.max(0, p)) * 100);
    loadPct.textContent = `${pct}%`; loadRing.style.setProperty("--p", pct);
  };
  const questionToggle = h("button", { class: "interview-question-toggle", type: "button", "aria-expanded": "true",
    "aria-label": "Hide interview question", onclick: (event) => {
      const expanded = event.currentTarget.getAttribute("aria-expanded") === "true";
      event.currentTarget.setAttribute("aria-expanded", String(!expanded));
      event.currentTarget.setAttribute("aria-label", expanded ? "Show interview question" : "Hide interview question");
      event.currentTarget.textContent = expanded ? "+" : "−";
      questionOverlay.classList.toggle("is-collapsed", expanded);
    } }, "−");
  const questionOverlay = h("aside", { class: "interview-question-overlay", "aria-label": "Current interview question" },
    questionToggle, h("div", { class: "interview-question-copy" },
      h("p", { class: "interview-question-label" }, questionStage), qText, skillChips));
  qText.title = "Tap to show the whole question";
  qText.addEventListener("click", () => questionOverlay.classList.toggle("is-open"));
  // Two views, like a car's parked and driving screens: Card shows the interviewer in a card beside the question and
  // your answer; Focus fills the screen with the interviewer and keeps only a caption and the answer bar.
  const modeSwitch = h("div", { class: "room-mode", role: "group", "aria-label": "View" },
    h("span", { class: "room-mode-thumb", "aria-hidden": "true" }),
    ...[["card", "Card"], ["focus", "Focus"]].map(([key, label]) => h("button", { type: "button", "data-mode": key, onclick: () => setMode(key) }, label)));
  function setMode(next) {
    room.dataset.mode = next;
    modeSwitch.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === next)));
  }
  const topbar = h("header", { class: "interview-topbar" },
    h("div", { class: "interview-role-name" }, detail.role_title),
    h("div", { class: "interview-topbar-progress" }, counter, progress), modeSwitch, end);
  const room = h("section", { class: `interview-takeover${officeEnabled ? " interview-room-office-pending" : ""}`, "aria-label": "Live mock interview" },
    officeHost, topbar, questionOverlay, responseFeedback, form, roomLoading);
  setMode(officeEnabled ? "card" : "focus");
  updateControls();  // the record button stays off until the interviewer is in the room
  main.replaceChildren(room);
  if (officeHost) {
    const fallbackOffice = (error) => {
      officeHost.remove(); room.classList.remove("interview-room-office-pending", "interview-room-virtual"); setMode("focus");
      officeDisposer?.(); officeDisposer = null; roomLoading?.remove(); markOfficeReady();
      console.warn("Virtual interview office unavailable; using the standard interview room.", error);
    };
    // a minute is long enough on a slow connection; after that the plain room is the better experience
    const giveUp = setTimeout(() => { if (!officeReady && !discarded) fallbackOffice(new Error("The interviewer took too long to load.")); }, 60_000);
    import("./virtual-office.js").then(async ({ mountVirtualOffice }) => (await sized(officeHost), mountVirtualOffice(officeHost, { onFailure: fallbackOffice,
      onProgress: showProgress, onReady: () => { clearTimeout(giveUp); showProgress(1); markOfficeReady(); } }))).then((unmount) => {
      if (discarded || !officeHost.isConnected) { unmount(); return; }
      officeDisposer = unmount;
      room.classList.remove("interview-room-office-pending"); room.classList.add("interview-room-virtual");
      updateAvatarPresentation();
    }).catch(fallbackOffice);
  }
}

function showEvaluation(host, evaluation) {
  if (!evaluation) return;
  host.hidden = false;
  host.replaceChildren(h("h3", {}, "Answer feedback"),
    h("ul", { class: "interview-dimension-list" }, Object.entries(evaluation.scores || {}).map(([key, score]) =>
      h("li", {}, h("div", {}, h("b", {}, LABELS[key] || key), h("p", {}, evaluation.rationale?.[key] || "Not enough evidence in this answer.")),
        h("span", { class: "num" }, score == null ? "Not assessed" : `${score}/4`)))));
}

function reportDisclosure(key, title, description, content) {
  const panelId = `interview-report-${key}`;
  const summary = h("summary", { class: "interview-disclosure-summary", "aria-controls": panelId, "aria-expanded": "false" },
    h("span", { class: "interview-disclosure-icon", "aria-hidden": "true" }, icon("spark")),
    h("span", { class: "interview-disclosure-copy" }, h("b", {}, title), h("small", {}, description)),
    h("span", { class: "interview-disclosure-chevron", "aria-hidden": "true" }, "⌄"));
  const disclosure = h("details", { class: "interview-disclosure" }, summary,
    h("div", { id: panelId, class: "interview-disclosure-panel" }, content));
  disclosure.addEventListener("toggle", () => summary.setAttribute("aria-expanded", String(disclosure.open)));
  return disclosure;
}

async function renderReport(main, report, callbacks = {}) {
  const history = (await api("/api/interviews").catch(() => ({ interviews: [] }))).interviews || [];
  const currentAttempt = history.find((x) => x.interview_id === report.interview_id);
  const assessmentSource = report.assessment_source || currentAttempt?.assessment_source;
  const comparable = history.filter((x) => x.status === "completed" && x.role_id === report.role_id && x.interview_id !== report.interview_id)
    .sort((a, b) => String(a.created_utc).localeCompare(String(b.created_utc)));
  const previous = comparable.at(-1);
  const delta = (current, prior) => prior == null ? "First completed attempt" : `${Number(current) - Number(prior) >= 0 ? "+" : ""}${Number(current) - Number(prior)} points vs previous attempt`;
  const scoreCard = (label, key, note) => {
    const score = Math.max(0, Math.min(100, Math.round(Number(report[key]) || 0)));
    return h("section", { class: "interview-score-card" },
      h("span", { class: "interview-score-label" }, label),
      h("b", { class: "interview-big-score num" }, pct(score)),
      h("div", { class: "interview-meter", role: "progressbar", "aria-label": label,
        "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(score) },
        h("i", { style: { width: pct(score) } })),
      h("p", { class: "interview-score-note" }, note));
  };
  const dimensions = h("ul", { class: "interview-dimension-list" }, Object.entries(report.dimensions || {}).map(([key, item]) =>
    h("li", {}, h("div", {}, h("b", {}, LABELS[key] || key), h("p", {}, item.reason || "No explanation was recorded for this criterion."),
      h("small", { class: "muted" }, `${item.weight}% rubric weight · ${item.evidence_count} answer${item.evidence_count === 1 ? "" : "s"} scored`)),
      h("span", { class: "num" }, item.score == null ? "Not assessed" : pct(item.score)))));
  const competencies = report.competencies || [];
  const assessedCompetencies = competencies.filter((c) => c.interview_score != null);
  const unassessedCompetencies = competencies.filter((c) => c.interview_score == null);
  const competencyGroup = (title, entries, assessed) => h("section", { class: "interview-competency-group" },
    h("h3", {}, title, h("span", { class: "muted" }, ` · ${entries.length}`)),
    entries.length ? h("div", { class: "interview-competencies" }, entries.map((c) =>
      h("article", { class: "interview-competency" },
        h("div", { class: "interview-competency-heading" }, h("b", {}, c.name),
          h("span", { class: assessed ? "tag hot" : "tag" }, assessed ? pct(c.interview_score) : "Not assessed")),
        assessed ? h("div", { class: "interview-meter", role: "img", "aria-label": `${c.name}: ${pct(c.interview_score)}` },
          h("i", { style: { width: pct(c.interview_score) } })) : null,
        h("small", { class: "muted" }, `Profile ${c.profile_level}/5 · role level ${c.required_level}/5`),
        c.evidence?.length ? h("ul", { class: "interview-evidence-list" }, c.evidence.map((quote) => h("li", {}, h("q", {}, quote)))) : null)))
      : h("p", { class: "muted" }, assessed ? "No competencies were assessed in the interview."
        : competencies.length ? "All listed competencies have interview evidence." : "No competency data was available for this report."));
  const competencyContent = h("div", { class: "interview-report-scroll interview-competency-scroll" },
    competencyGroup("Assessed competencies", assessedCompetencies, true),
    competencyGroup("Not assessed", unassessedCompetencies, false));
  const list = (rows, empty, kind) => rows?.length ? h("ul", { class: "interview-list" }, rows.map((x) =>
    h("li", {}, h("div", { class: "interview-list-heading" }, h("b", {}, x.name || x.skill),
      x.interview_score != null ? h("span", { class: "tag hot" }, pct(x.interview_score)) : null),
      h("span", {}, x.reason || x.evidence?.[0] || (x.interview_score == null
        ? "This competency was not directly assessed in your answers."
        : kind === "strength" ? "No supporting quote was stored for this competency." : "No answer-specific explanation was stored.")))))
    : h("p", { class: "muted" }, empty);
  const strengthsAndGaps = h("div", { class: "interview-two-col interview-strengths-grid" },
    h("section", { class: "interview-feedback-group" }, h("h3", {}, "Your Strengths"),
      list(report.strengths, "No specific strengths were recorded for this attempt.", "strength")),
    h("section", { class: "interview-feedback-group" }, h("h3", {}, "Areas for Improvement"),
      list(report.gaps, "No specific skill gaps were identified from this attempt.", "gap")));
  const recommendations = report.recommendations?.length ? h("ol", { class: "interview-recommendations" }, report.recommendations.map((x) => {
    const competency = competencies.find((c) => c.name?.toLowerCase() === String(x.skill || "").toLowerCase());
    return h("li", {}, h("div", { class: "interview-recommendation-heading" }, h("b", {}, x.skill),
      x.priority ? h("span", { class: "tag" }, `${x.priority} priority`) : null),
      h("p", {}, x.reason),
      competency ? h("small", { class: "muted" }, `Profile ${competency.profile_level}/5 · role level ${competency.required_level}/5`) : null,
      h("p", {}, h("b", {}, "Practice: "), x.exercise),
      x.resources?.length ? h("div", { class: "interview-resource-links" }, x.resources.map((r) => h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, r.title)))
        : h("small", { class: "muted" }, "No curated learning link is currently indexed for this skill."));
  })) : h("p", { class: "muted" }, "Keep practicing with new role-specific questions.");
  const seenStages = new Set();
  const questionFeedback = report.question_feedback?.length ? h("div", { class: "interview-question-review" }, report.question_feedback.map((item, i) => {
    const stage = String(item.stage || "");
    const followUp = item.is_follow_up ?? seenStages.has(stage);
    seenStages.add(stage);
    const inferredNumber = STAGE_ORDER.indexOf(stage) + 1;
    const mainNumber = item.question_number || (inferredNumber > 0 ? inferredNumber : i + 1);
    const evaluation = item.evaluation || {};
    const scores = Object.entries(evaluation.scores || {});
    const assessedScores = scores.filter(([, value]) => value != null);
    const improve = assessedScores.filter(([, value]) => Number(value) < 3);
    const strengths = evaluation.demonstrated_skills || [];
    const answerReview = h("div", { class: "interview-question-review-body" },
      h("p", { class: "interview-question-review-q" }, item.question || "Question text was not saved."),
      h("div", { class: "interview-answer-transcript" }, h("b", {}, "Your answer"), h("p", {}, item.answer || "No confirmed transcript was saved.")),
      h("p", { class: "fine" }, "Grounded in role requirements: ", (item.source_refs || []).join(" · "),
        report.source?.url ? [" ", h("a", { href: report.source.url, target: "_blank", rel: "noopener noreferrer" }, "Open source")] : null),
      h("h4", {}, "AI feedback"),
      scores.length ? h("ul", { class: "interview-dimension-list" }, scores.map(([key, value]) =>
        h("li", {}, h("div", {}, h("b", {}, LABELS[key] || key), h("p", {}, evaluation.rationale?.[key] || "No explanation was recorded."),
          evaluation.evidence?.[key] ? h("small", { class: "muted" }, `Evidence: “${evaluation.evidence[key]}”`) : null),
          h("span", { class: "num" }, value == null ? "Not assessed" : `${value}/4`))))
        : h("p", { class: "muted" }, "No rubric feedback was saved for this answer."),
      h("div", { class: "interview-two-col interview-answer-insights" },
        h("section", {}, h("h4", {}, "Strengths shown"), strengths.length
          ? h("ul", { class: "interview-compact-list" }, strengths.map((s) => h("li", {}, h("b", {}, s.name), s.evidence ? ` · “${s.evidence}”` : "")))
          : h("p", { class: "muted" }, "No specific competency strength was recorded for this answer.")),
        h("section", {}, h("h4", {}, "Areas to strengthen"), improve.length
          ? h("ul", { class: "interview-compact-list" }, improve.map(([key]) => h("li", {}, h("b", {}, LABELS[key] || key), ` · ${evaluation.rationale?.[key] || "This rubric dimension scored below 3/4."}`)))
          : h("p", { class: "muted" }, assessedScores.length ? "No assessed rubric dimension scored below 3/4." : "There is not enough assessment data to identify an answer-specific improvement."))),
      item.suggested_improved_answer || item.suggested_answer
        ? h("section", { class: "interview-suggested-answer" }, h("h4", {}, "Suggested stronger answer"), h("p", {}, item.suggested_improved_answer || item.suggested_answer)) : null);
    return h("details", { class: "interview-question-review-card" },
      h("summary", {}, h("span", { class: "interview-question-review-number" }, followUp ? `Follow-up to Question ${mainNumber}` : `Main Question ${mainNumber}`),
        h("span", {}, `${TYPES[item.type] || TYPES[stage] || "Interview"} · ${(item.target_skills || []).join(", ") || "Role skills"}`)),
      answerReview);
  })) : h("p", { class: "muted" }, "No question-by-question feedback was saved for this attempt.");
  let planPanel = h("p", { class: "muted" }, "No plan was linked to this interview.");
  if (report.plan_id) {
    planPanel = h("a", { class: "btn sm", href: `#/plans/${report.plan_id}` }, "Open your learning plan");
    try {
      const plan = await api(`/api/plans/${report.plan_id}`);
      const activities = (plan.plan?.activities || []).filter((a) => (report.gaps || []).some((g) => g.name.toLowerCase() === String(a.skill_id).toLowerCase()));
      if (activities.length) planPanel = h("div", {}, h("a", { class: "btn sm", href: `#/plans/${report.plan_id}` }, "Open your learning plan"),
        h("p", { class: "muted" }, `Related plan activities: ${activities.map((a) => `${a.skill_id} (${a.day_range})`).join(" · ")}`));
    } catch { /* preserve the link if the saved plan is temporarily unavailable */ }
  }
  const planStatus = h("p", { class: "fine", role: "status", "aria-live": "polite" });
  const planForRole = h("button", { class: "btn primary", type: "button", onclick: async () => {
    planForRole.disabled = true;
    planStatus.textContent = "Checking for an existing plan for this role…";
    try {
      if (!report.role_id) throw new Error("This interview report is missing its role ID, so a role-specific plan cannot be opened.");
      const plans = await api("/api/plans");
      const existing = (Array.isArray(plans) ? plans : []).find((p) => p.plan_id === report.plan_id)
        || (Array.isArray(plans) ? plans : []).find((p) => p.audience === "individual" && p.target_role === report.role_id);
      if (existing) { location.hash = `#/plans/${encodeURIComponent(existing.plan_id)}`; return; }
      if (!callbacks.onPlan) throw new Error("The learning-plan workflow is unavailable. Please try again from your career results.");
      const priorities = [...(report.gaps || []).map((x) => x.name || x.skill), ...(report.recommendations || []).map((x) => x.skill)]
        .filter(Boolean).filter((name, index, all) => all.findIndex((x) => String(x).toLowerCase() === String(name).toLowerCase()) === index).slice(0, 8);
      const query = priorities.length
        ? `Create a personalized learning plan for ${report.role_title}. Prioritize these interview-identified improvement areas: ${priorities.join(", ")}.`
        : `Create a personalized learning plan for ${report.role_title} based on the employee's demonstrated interview performance and role profile.`;
      planStatus.textContent = "Opening the personalized plan workflow…";
      callbacks.onPlan({ role_id: report.role_id, role_title: report.role_title }, report.profile || [], query);
    } catch (e) {
      planStatus.textContent = e.message || "Could not open the learning plan. Please retry.";
      planForRole.disabled = false;
    }
  } }, "Plan for This Role");
  const resultsRoute = assessmentSource === "questionnaire" ? "#/quiz" : "#/resume";
  const nextSteps = h("section", { class: "interview-card interview-next-steps" },
    h("h2", {}, "Ready to Improve Your Skills?"),
    h("p", { class: "muted" }, "Based on your interview performance, we've identified areas you can improve. Would you like to create a personalized learning plan for this role?"),
    h("div", { class: "interview-report-actions" }, planForRole,
      h("a", { class: "btn ghost", href: resultsRoute }, "Back to Career Results")), planStatus);
  const compare = previous ? h("section", { class: "interview-card" }, h("h2", {}, "Progress since your last attempt"),
    h("p", { class: "muted" }, `${previous.role_title} · ${fmtTime(previous.created_utc)} · ${previous.difficulty} difficulty`),
    h("div", { class: "interview-compare" }, [["Interview performance", report.performance, previous.performance],
      ["Job readiness", report.readiness, previous.readiness], ["Hiring Competitiveness Index", report.competitiveness, previous.competitiveness]].map(([label, now, before]) =>
      h("div", {}, h("b", {}, label), h("span", { class: "num" }, `${pct(now)} · ${delta(now, before)}`),
        h("div", { class: "interview-meter" }, h("i", { style: { width: pct(now) } }))))))
    : h("section", { class: "interview-card" }, h("h2", {}, "Progress comparison"),
      h("p", { class: "muted" }, "This is your first completed interview for this role. Complete another attempt to compare scores."));
  const sources = report.source ? h("div", { class: "fine" }, "Question context: ", h("a", { href: report.source.url, target: "_blank", rel: "noopener noreferrer" }, report.source.title),
    ` · ${report.source.publisher} · retrieved ${report.source.access_date}`) : h("p", { class: "muted" }, "No external question source was recorded.");
  main.replaceChildren(h("div", { class: "interview-page interview-report-page" },
    h("div", { class: "interview-heading" }, h("div", {}, h("p", { class: "eyebrow" }, "YOUR PRACTICE REPORT"),
      h("h1", { class: "page-title" }, `${report.role_title} interview assessment`),
      h("p", { class: "lede" }, `Completed ${fmtTime(report.completed_utc)} · ${report.difficulty} difficulty`))),
    h("div", { class: "interview-score-grid" },
      scoreCard("Interview Performance", "performance", `Weighted rubric score. Evidence covered ${pct(report.evidence_coverage)} of rubric weight.`),
      scoreCard("Job Readiness", "readiness", `65% interview performance + 35% profile-to-role skill coverage (${pct(report.profile_coverage)}).`),
      scoreCard("Hiring Competitiveness Index", "competitiveness", `Simulated alignment: 70% demonstrated role competency (${pct(report.demonstrated_fit)}) + 30% profile coverage (${pct(report.profile_coverage)}).`)),
    h("p", { class: "interview-disclaimer" }, report.disclaimer || "Simulated coaching assessment, not a verified probability of receiving a job offer. Actual outcomes depend on employer requirements, other applicants, experience, interviewers, and market conditions."),
    reportDisclosure("competencies", "Performance by Competency", "See how well your interview answers demonstrated the skills required for this role.",
      h("div", {}, competencyContent,
        h("p", { class: "fine" }, "Role skill levels are AiversePulse estimates derived from an O*NET-trained model; they are not ESCO ratings."))),
    reportDisclosure("strengths", "Strengths & Areas for Improvement", "Discover what you did well and which skills need more practice.", strengthsAndGaps),
    reportDisclosure("answers", "Interview Answer Review", "Review your answers, AI feedback, and suggestions for stronger responses.",
      h("div", { class: "interview-report-scroll interview-question-scroll" }, questionFeedback)),
    reportDisclosure("recommendations", "Recommended Improvements", "Explore the skills and actions that can help you prepare for this role.",
      h("div", { class: "interview-recommendation-content" }, recommendations, planPanel)),
    reportDisclosure("rubric", "Scoring Rubric", "See the weighted assessment criteria and the evidence behind each score.", dimensions),
    reportDisclosure("comparison", "Previous Interview Performance", "Compare this attempt with your earlier completed interview for the same role.", compare),
    reportDisclosure("sources", "Question Sources & Method", "Review the role source and score interpretation notes.",
      h("div", {}, sources,
        h("p", { class: "fine" }, "Unassessed competencies are excluded from demonstrated-skill averages. Hiring Competitiveness Index is simulated and is not a verified probability of an offer."))),
    nextSteps,
    h("div", { class: "interview-report-actions" },
      h("a", { class: "btn primary", href: "#/quiz" }, "Retake Quick Match"),
      h("a", { class: "btn", href: "#/resume" }, "Upload resume"),
      h("a", { class: "btn ghost", href: "#/interview" }, "Interview history"))));
}

function renderEnded(main) {
  main.replaceChildren(h("div", { class: "interview-page" }, h("h1", { class: "page-title" }, "Interview ended"),
    h("p", { class: "lede" }, "There were not enough completed answers to create an assessment. Find a recommended role from your career results to practice again."),
    h("div", { class: "interview-report-actions" },
      h("a", { class: "btn primary", href: "#/quiz" }, "Take Quick Match"),
      h("a", { class: "btn", href: "#/resume" }, "Upload resume"),
      h("a", { class: "btn ghost", href: "#/interview" }, "Interview history"))));
}
