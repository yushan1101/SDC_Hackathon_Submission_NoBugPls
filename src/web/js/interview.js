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
const HOLOGRAM = () => window.AP_CONFIG?.INTERVIEW_HOLOGRAM !== false;  // Mina projected as a hologram (set false for the office)
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
    if (HOLOGRAM()) stage.classList.add("is-holo");
    import("./virtual-office.js").then(async ({ mountVirtualOffice }) => {
      await sized(scene);
      if (!scene.isConnected) return;
      // wide: look left of the interviewer so they sit on the right, clear of the heading; phones: centred
      const unmount = mountVirtualOffice(scene, { onFailure: owl, hologram: HOLOGRAM(), aimX: (w) => (w > 760 ? -1 : 0.12) });
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
  const stopSpeechBtn = h("button", { class: "interview-speech-stop", type: "button", hidden: true,
    onclick: () => stopInterviewerSpeech() }, icon("stop"), "Stop AI Voice & Start Answering");
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
  // Conversation mode: like talking to a person. Her turn ends, the microphone opens; your pause ends your turn and
  // the answer goes. Off: record, review, send by hand.
  let conversation = true;
  try { conversation = localStorage.getItem("ap.interview.conversation") !== "false"; } catch { /* on */ }
  let micGranted = false, heardSpeech = false, lastVoiceAt = 0;
  const SILENCE_MS = 2200;
  const minaLine = h("p", { class: "interview-mina-line", "aria-live": "polite", hidden: true });
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
  let speechGeneration = 0, speechFrame = 0;
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
    stopSpeechBtn.hidden = !interviewerSpeaking || paused || discarded;
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
        if (volume > 0.025) { heardSpeech = true; lastVoiceAt = performance.now(); }
        else if (conversation && heardSpeech && !finishPromise && performance.now() - lastVoiceAt > SILENCE_MS) {
          heardSpeech = false;
          void finishRecording(false, false).then(() => { if (!transcript.value.trim()) listenAgain(); });
        }
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
      const hasAnswer = Boolean(transcript.value.trim());
      const autoSubmit = hasAnswer && view === "voice";
      if (announce) {
        if (hasAnswer && !autoSubmit) setView("type");
        setMicState(autoSubmit ? "processing" : hasAnswer ? "captured" : "error", hasAnswer
          ? autoSubmit ? "Submitting answer for feedback…" : "Captured · review, then send"
          : speechError || speechAvailable ? speechError || "No speech was transcribed · check the language, retry, or type your answer"
            : "Speech recognition is unavailable in this browser · type your answer instead");
      }
      if (autoSubmit) queueMicrotask(() => form.requestSubmit());
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
      micGranted = true; heardSpeech = false; lastVoiceAt = performance.now();
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
  const listenAgain = () => { if (conversation && micGranted && !paused && !discarded) void startRecording(); };
  const revealQuestion = () => {
    questionOverlay.classList.remove("is-collapsed");
    questionOverlay.classList.add("is-open");
    questionToggle.setAttribute("aria-expanded", "true");
    questionToggle.setAttribute("aria-label", "Hide interview question");
    questionToggle.textContent = "−";
  };
  const playQuestion = async (text = qText.textContent) => {
    if (!text) return;
    revealQuestion();
    const generation = ++speechGeneration;
    interviewerSpeaking = true; voicePlaying = false; updateControls(); setMicState("processing", "Getting ready to ask…");
    if (recording || micStream) await finishRecording(false, false);
    if (generation !== speechGeneration || discarded) return;
    let voice;
    voice = currentUtterance = speak(text, { onStart: () => {
      if (generation !== speechGeneration || currentUtterance !== voice) return;
      speechCue = { word: text, startedAt: performance.now(), secondsPerCharacter: 0.095 };
      interviewerSpeaking = true; voicePlaying = true; updateControls(); setMicState("processing", "Interviewer speaking");
      const follow = () => {
        if (generation !== speechGeneration || currentUtterance !== voice) return;
        speechLevel = voice.level(); speechBands = voice.bands(); updateAvatarPresentation();
        speechFrame = requestAnimationFrame(follow);
      };
      follow();
    } });
    await voice.done;
    if (generation !== speechGeneration || currentUtterance !== voice) return;
    haltInterviewerSpeech();
    setMicState(paused ? "off" : "ready", paused ? "Paused · microphone off" : conversation && micGranted ? "Your turn" : "Ready to answer · microphone off");
    listenAgain();
  };
  const haltInterviewerSpeech = () => {
    ++speechGeneration;
    const voice = currentUtterance;
    currentUtterance = null;
    voice?.stop();
    cancelAnimationFrame(speechFrame); speechFrame = 0;
    interviewerSpeaking = false; voicePlaying = false; speechCue = null; speechLevel = 0; speechBands = null;
    updateControls(); updateAvatarPresentation();
  };
  function stopInterviewerSpeech() {
    if (!interviewerSpeaking || discarded) return;
    haltInterviewerSpeech();
    revealQuestion();
    setMicState(paused ? "off" : "ready", paused ? "Paused · microphone off" : "Your Turn — You Can Answer Now");
    if (!paused) (view === "type" ? transcript : startBtn).focus({ preventScroll: true });
  }
  const dispose = () => {
    discarded = true; recording = false; muted = false; pauseDuration();
    try { recognizer?.abort(); } catch { /* already stopped */ }
    recognitionActive = false; recognitionRequested = false; releaseAudio(); haltInterviewerSpeech();
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
    haltInterviewerSpeech();
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
    if (qText.textContent) {
      const queuedGeneration = speechGeneration;
      void preloadSpeech(qText.textContent);
      void officeArrived.then(() => { if (queuedGeneration === speechGeneration && !discarded) return playQuestion(qText.textContent); });
    }
  };
  const form = h("form", { class: "interview-answer-form", onsubmit: async (e) => {
    e.preventDefault();
    if (recording || micStream) await finishRecording();
    const answer = transcript.value.trim();
    if (!answer) { toast("Add an answer before continuing.", "err"); transcript.focus(); return; }
    answerBtn.disabled = true; pause.disabled = true; setMicState("processing", "Submitting answer for feedback…");
    try {
      const result = await api(`/api/interviews/${sessionId}/answer`, { method: "POST", body: { question_id: current.question_id, answer } });
      transcript.value = "";
      recordedText = ""; resetDuration();
      if (result.reply) {
        minaLine.textContent = result.reply; minaLine.hidden = false;
        answerBtn.disabled = false; pause.disabled = false; updateControls();
        await playQuestion(result.reply);
        return;
      }
      minaLine.hidden = true;
      showEvaluation(responseFeedback, result.evaluation);
      recordedText = ""; recordingAttempted = false; resetDuration();
      if (result.status === "completed") { dispose(); await renderReport(main, result.report, callbacks); return; }
      stageIndex = result.stage_index;
      setQuestion(result.question, result.source);
    } catch (e) { setMicState("captured", "Answer captured · review or edit before sending"); toast(e.message, "err"); }
    answerBtn.disabled = false; pause.disabled = false; updateControls();
  } }, h("label", { class: "field interview-type-sheet" }, h("span", { class: "sr-only" }, "Your answer"), transcript),
    stopSpeechBtn,
    minaLine, livePreview, voicePanel);
  const repeat = dockIcon(h("button", { type: "button", onclick: () => { void playQuestion(); } }), "volume", "Replay question");
  const talkBtn = h("button", { type: "button", "aria-pressed": String(conversation), onclick: () => {
    conversation = !conversation; talkBtn.setAttribute("aria-pressed", String(conversation));
    talkBtn.title = conversation ? "Conversation mode on: speak, pause, and she replies" : "Conversation mode off: record, review, send";
    try { localStorage.setItem("ap.interview.conversation", String(conversation)); } catch { /* this visit */ }
    toast(conversation ? "Conversation mode: just talk. Pause when you're done and she'll reply." : "Manual mode: record, review, then send.");
    if (conversation && !recording && !interviewerSpeaking) listenAgain();
  } });
  dockIcon(talkBtn, "ask", "Conversation mode", "dock-talk");
  talkBtn.setAttribute("aria-pressed", String(conversation));
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
    h("span", { class: "dock-gap" }), talkBtn, repeat, pause, retryBtn, muteBtn, startBtn, stopBtn, answerBtn,
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
      haltInterviewerSpeech();
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
    import("./virtual-office.js").then(async ({ mountVirtualOffice }) => (await sized(officeHost), mountVirtualOffice(officeHost, { onFailure: fallbackOffice, hologram: HOLOGRAM(),
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

function reportDisclosure(key, title, description, content, ic = "spark") {
  const panelId = `interview-report-${key}`;
  const summary = h("summary", { class: "interview-disclosure-summary", "aria-controls": panelId, "aria-expanded": "false" },
    h("span", { class: "interview-disclosure-icon", "aria-hidden": "true" }, icon(ic)),
    h("span", { class: "interview-disclosure-copy" }, h("b", {}, title), h("small", {}, description)),
    h("span", { class: "interview-disclosure-chevron", "aria-hidden": "true" }, icon("chevron")));
  const disclosure = h("details", { class: "interview-disclosure", "data-section": key }, summary,
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
  const scoreText = (value) => value == null ? "Not available" : pct(value);
  const delta = (current, prior) => current == null ? "Score unavailable for comparison"
    : prior == null ? "No previous score available" : `${Number(current) - Number(prior) >= 0 ? "+" : ""}${Number(current) - Number(prior)} points vs previous attempt`;
  const competencies = report.competencies || [];
  const questionItems = report.question_feedback || [];
  const assessedCompetencies = competencies.filter((c) => c.interview_score != null);
  const unassessedCompetencies = competencies.filter((c) => c.interview_score == null);
  const rubricEntries = Object.entries(report.dimensions || {});
  const bySkill = (rows) => [...(rows || [])].sort((a, b) => Number(b.interview_score ?? -1) - Number(a.interview_score ?? -1));
  const byGap = (rows) => [...(rows || [])].sort((a, b) => Number(a.interview_score ?? Infinity) - Number(b.interview_score ?? Infinity));
  const assessmentSourceLabel = assessmentSource === "questionnaire" ? "Quick Match" : assessmentSource === "resume" ? "Resume assessment" : "Role recommendation";
  const band = (n) => n == null ? "na" : n >= 70 ? "good" : n >= 50 ? "mid" : "low";
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  const perf = report.performance == null ? null : clamp(report.performance);
  const verdict = perf == null ? ["Not available", "An overall performance score was not saved for this interview."]
    : perf >= 80 ? ["Interview-ready", "Strong answers across the rubric. Keep practising to stay sharp."]
    : perf >= 65 ? ["Nearly there", "Solid answers. A few focused improvements will lift your readiness."]
    : perf >= 50 ? ["Developing", "Good foundations. Work on the focus areas below before a real interview."]
    : ["Early stage", "Start with the focus areas below, then practise again."];
  const dimensions = rubricEntries.length ? h("ul", { class: "interview-dimension-list" }, rubricEntries.map(([key, item]) =>
    h("li", {}, h("div", {}, h("b", {}, LABELS[key] || key), h("p", {}, item.reason || "No explanation was recorded for this criterion."),
      h("small", { class: "muted" }, `${item.weight == null ? "Weight not recorded" : `${item.weight}% rubric weight`} · ${item.evidence_count == null ? "Answer count not recorded" : `${item.evidence_count} answer${item.evidence_count === 1 ? "" : "s"} scored`}`)),
      h("span", { class: "num" }, item.score == null ? "Not assessed" : pct(item.score)))))
    : h("p", { class: "muted" }, "No rubric details were saved for this interview.");
  const sideScore = (label, key, hint, prior) => {
    const rawScore = report[key], n = rawScore == null ? null : clamp(rawScore);
    const difference = n == null || prior == null ? null : n - clamp(prior);
    return h("div", { class: "ir-side-score", title: hint },
      h("div", { class: "ir-side-top" }, h("span", {}, label),
        h("b", { class: "num" }, n == null ? "Not available" : pct(n), difference == null ? null : h("small", { class: `ir-delta ${difference >= 0 ? "up" : "down"}` }, `${difference >= 0 ? "+" : ""}${difference}`))),
      h("div", { class: `ir-bar band-${band(n)}`, role: "progressbar", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": n == null ? "0" : String(n) },
        h("i", { style: { width: n == null ? "0" : pct(n) } })), h("small", { class: "muted" }, hint));
  };
  const hero = h("section", { class: "ir-hero", "aria-label": "Interview performance summary" },
    h("div", { class: "ir-hero-main" },
      h("div", { class: `ps-ring ir-ring band-${band(perf)}`, style: { "--pct": perf ?? 0 }, role: "img", "aria-label": `Interview performance ${perf == null ? "not available" : `${perf}%`}` },
        h("div", {}, h("b", { class: "num" }, perf == null ? "—" : `${perf}%`), h("small", {}, "Interview Performance"))),
      h("div", { class: "ir-verdict" }, h("span", { class: `ir-pill band-${band(perf)}` }, verdict[0]),
        h("p", {}, verdict[1]), h("small", { class: "muted" }, previous ? delta(report.performance, previous.performance) : "First completed attempt for this role"))),
    h("div", { class: "ir-hero-side" },
      sideScore("Job readiness", "readiness", "Interview performance plus how well your profile covers the role", previous?.readiness),
      sideScore("Role Alignment", "competitiveness", "Simulated index: 70% demonstrated role competency and 30% profile coverage; not a job-offer probability", previous?.competitiveness)));
  const strengths = bySkill(report.strengths).slice(0, 3);
  const gaps = byGap(report.gaps).slice(0, 3);
  const recommendationFor = (skill) => (report.recommendations || []).find((item) =>
    String(item.skill || "").toLowerCase() === String(skill || "").toLowerCase());
  const questionsForSkill = (skill) => questionItems.map((item, index) => ({ item, index })).filter(({ item }) =>
    (item.target_skills || []).some((name) => String(name).toLowerCase() === String(skill || "").toLowerCase())
    || (item.evaluation?.demonstrated_skills || []).some((entry) => String(entry.name || "").toLowerCase() === String(skill || "").toLowerCase()));
  const findingCards = (items, empty, kind) => items.length ? h("ul", { class: "ir-finding-list" }, items.map((item) => {
    const name = item.name || item.skill || "Competency";
    const recommendation = recommendationFor(name);
    const explanation = item.reason || item.evidence?.[0] || (kind === "strength"
      ? "No additional explanation was saved for this result."
      : recommendation?.reason || "No additional improvement guidance was saved for this result.");
    return h("li", {}, h("div", { class: "ir-finding-heading" }, h("b", {}, name),
      item.interview_score != null ? h("span", { class: `tag band-${band(item.interview_score)}` }, pct(item.interview_score)) : null),
      h("p", {}, explanation));
  })) : h("p", { class: "muted" }, empty);
  const overview = h("div", { class: "ir-tab-content ir-overview" },
    h("div", { class: "ir-glance" },
      h("section", { class: "ir-card" }, h("h3", {}, icon("check"), "What Went Well"),
        findingCards(strengths, "No meaningful strengths were recorded for this interview.", "strength")),
      h("section", { class: "ir-card" }, h("h3", {}, icon("target"), "Focus Next"),
        findingCards(gaps, "No specific improvement areas were recorded for this interview.", "gap"))),
    h("div", { class: "ir-overview-lower" },
      h("section", { class: "ir-card" }, h("h3", {}, icon("review"), "How Your Answers Scored"),
        rubricEntries.length ? h("ul", { class: "ir-rows ir-rows-rubric" }, rubricEntries.map(([key, item]) =>
          h("li", {}, h("span", { class: "ir-row-name" }, LABELS[key] || key),
            h("div", { class: `ir-bar band-${band(item.score)}`, role: "progressbar", "aria-label": LABELS[key] || key,
              "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": item.score == null ? "0" : String(clamp(item.score)) },
              h("i", { style: { width: item.score == null ? "0" : pct(item.score) } })),
            h("span", { class: "num ir-row-val" }, item.score == null ? "Not assessed" : pct(item.score)))))
          : h("p", { class: "muted" }, "No rubric scores were saved for this interview."),
        h("button", { class: "btn ghost sm", type: "button", onclick: () => activateTab("details", "rubric") }, "Understand My Scores →")),
      h("section", { class: "ir-card" }, h("h3", {}, icon("spark"), "Key Feedback"),
        report.recommendations?.length ? h("ul", { class: "ir-feedback-list" }, report.recommendations.slice(0, 2).map((item) =>
          h("li", {}, h("b", {}, item.skill), h("p", {}, item.reason || "No coaching explanation was saved."),
            item.exercise ? h("small", { class: "muted" }, `Practice: ${item.exercise}`) : null)))
          : gaps.length ? findingCards(gaps.slice(0, 2), "No specific feedback was saved.", "gap")
            : h("p", { class: "muted" }, "No additional coaching feedback was saved for this attempt."))));

  const levelSummary = (c) => h("small", { class: "muted" },
    c.profile_level == null && c.required_level == null ? "Profile and role levels were not saved."
      : `Profile ${c.profile_level == null ? "not available" : `${c.profile_level}/5`} · role level ${c.required_level == null ? "not available" : `${c.required_level}/5`}`);
  const skillCards = assessedCompetencies.length ? h("div", { class: "ir-skill-list" }, bySkill(assessedCompetencies).map((c) => {
    const evidenceId = `ir-competency-evidence-${competencies.indexOf(c)}`;
    const evidenceButton = h("button", { type: "button", class: "btn ghost sm", onclick: () => activateTab("details", evidenceId) }, "View interview evidence");
    const recommendation = recommendationFor(c.name);
    const relatedQuestions = questionsForSkill(c.name);
    const evidence = c.evidence?.length ? h("ul", { class: "interview-evidence-list" }, c.evidence.map((quote) => h("li", {}, h("q", {}, quote))))
      : h("p", { class: "muted" }, "No supporting interview quotation was saved for this competency.");
    const row = h("details", { class: "ir-skill-card" },
      h("summary", {}, h("span", {}, h("b", {}, c.name), levelSummary(c),
        h("span", { class: `ir-bar band-${band(c.interview_score)}`, role: "img", "aria-label": `${c.name} ${pct(c.interview_score)}` },
          h("i", { style: { width: pct(c.interview_score) } }))),
        h("span", { class: `ir-skill-score tag band-${band(c.interview_score)}` }, pct(c.interview_score))),
      h("div", { class: "ir-skill-body" }, c.reason || c.explanation ? h("p", {}, c.reason || c.explanation) : null,
        h("h4", {}, "Interview evidence"), evidence,
        relatedQuestions.length ? h("div", {}, h("h4", {}, "Related Questions"), h("ul", { class: "ir-related-questions" }, relatedQuestions.map(({ item, index }) =>
          h("li", {}, h("b", {}, `Question ${index + 1}`), ` · ${item.question || "Question text was not saved."}`)))) : null,
        recommendation?.reason ? h("div", {}, h("h4", {}, "Improvement guidance"), h("p", {}, recommendation.reason)) : null,
        recommendation?.exercise ? h("p", { class: "fine" }, h("b", {}, "Practice: "), recommendation.exercise) : null,
        evidenceButton));
    row.addEventListener("toggle", () => { if (row.open) skillsPanel.querySelectorAll(".ir-skill-card[open]").forEach((other) => { if (other !== row) other.open = false; }); });
    return row;
  })) : h("p", { class: "muted" }, "No competencies were assessed in this interview.");
  const unassessed = unassessedCompetencies.length ? h("details", { class: "ir-unassessed" },
    h("summary", {}, `Show Unassessed Skills · ${unassessedCompetencies.length}`),
    h("ul", { class: "ir-unassessed-list" }, unassessedCompetencies.map((c) =>
      h("li", {}, h("b", {}, c.name), h("span", { class: "tag" }, "Not Assessed"), levelSummary(c),
        c.evidence?.length ? h("ul", { class: "interview-evidence-list" }, c.evidence.map((quote) => h("li", {}, h("q", {}, quote)))) : null))))
    : h("p", { class: "muted" }, "There are no unassessed competencies in this report.");
  const skillsPanel = h("div", { class: "ir-tab-content ir-skills" },
    h("div", { class: "ir-section-heading" }, h("h2", {}, "Skills Shown in Your Answers"),
      h("p", { class: "muted" }, "Open a competency to review its score, evidence, profile levels, and saved guidance.")),
    skillCards, unassessed,
    report.recommendations?.length ? h("details", { class: "ir-all-recommendations" },
      h("summary", {}, `All Interview Recommendations · ${report.recommendations.length}`),
      h("ol", { class: "interview-recommendations" }, report.recommendations.map((item) => {
        const competency = competencies.find((c) => String(c.name || "").toLowerCase() === String(item.skill || "").toLowerCase());
        return h("li", {}, h("div", { class: "interview-recommendation-heading" }, h("b", {}, item.skill || "Skill recommendation"),
          item.priority ? h("span", { class: "tag" }, `${item.priority} priority`) : null),
          h("p", {}, item.reason || "No recommendation explanation was saved."),
          competency ? levelSummary(competency) : null,
          item.exercise ? h("p", {}, h("b", {}, "Practice: "), item.exercise) : null,
          item.resources?.length ? h("div", { class: "interview-resource-links" }, item.resources.map((resource) =>
            h("a", { href: resource.url, target: "_blank", rel: "noopener noreferrer" }, resource.title)))
            : h("small", { class: "muted" }, "No curated learning link is currently indexed for this skill."));
      }))) : null);

  let questionIndex = 0;
  const questionContent = h("div", { class: "ir-question-view" });
  const questionCounter = h("strong", { class: "ir-question-counter", "aria-live": "polite" });
  const questionProgress = h("div", { class: "ir-question-progress", role: "progressbar", "aria-label": "Question review progress",
    "aria-valuemin": "0", "aria-valuemax": String(questionItems.length), "aria-valuenow": "0" }, h("i", {}));
  const previousQuestion = h("button", { class: "btn", type: "button", onclick: () => showQuestion(questionIndex - 1) }, "← Previous Question");
  const nextQuestion = h("button", { class: "btn primary", type: "button", onclick: () => showQuestion(questionIndex + 1) }, "Next Question →");
  function showQuestion(index) {
    if (!questionItems.length) return;
    questionIndex = Math.max(0, Math.min(questionItems.length - 1, index));
    const item = questionItems[questionIndex], evaluation = item.evaluation || {};
    const stage = String(item.stage || "");
    const inferredFollowUp = questionItems.slice(0, questionIndex).some((previousItem) => String(previousItem.stage || "") === stage);
    const followUp = item.is_follow_up ?? inferredFollowUp;
    const questionType = TYPES[item.type] || TYPES[stage] || "Interview";
    const scoreRows = Object.entries(evaluation.scores || {});
    const demonstrated = evaluation.demonstrated_skills || [];
    const related = [...new Set([...(item.target_skills || []), ...demonstrated.map((skill) => skill.name).filter(Boolean)])];
    questionCounter.textContent = `Question ${questionIndex + 1} of ${questionItems.length}`;
    questionProgress.setAttribute("aria-valuenow", String(questionIndex + 1));
    questionProgress.firstElementChild.style.width = `${((questionIndex + 1) / questionItems.length) * 100}%`;
    previousQuestion.disabled = questionIndex === 0;
    nextQuestion.disabled = questionIndex === questionItems.length - 1;
    const evaluationList = scoreRows.length ? h("ul", { class: "interview-dimension-list" }, scoreRows.map(([key, score]) =>
      h("li", {}, h("div", {}, h("b", {}, LABELS[key] || key),
        h("p", {}, evaluation.rationale?.[key] || "No explanation was recorded for this scoring category."),
        evaluation.evidence?.[key] ? h("small", { class: "muted" }, `Evidence: “${evaluation.evidence[key]}”`) : null),
        h("span", { class: "num" }, score == null ? "Not assessed" : `${score}/4`))))
      : h("p", { class: "muted" }, "No AI rubric feedback was saved for this answer.");
    const answerCard = h("article", { class: "ir-answer-card" },
      h("section", {}, h("div", { class: "ir-question-heading" }, h("h3", {}, "Interview Question"),
        h("span", { class: "tag" }, followUp ? `Follow-up · ${questionType}` : questionType)),
        h("p", { class: "interview-question-review-q" }, item.question || "Question text was not saved.")),
      h("section", { class: "interview-answer-transcript" }, h("h3", {}, "Your Answer"),
        h("p", {}, item.answer || "No confirmed transcript was saved for this question.")),
      h("section", {}, h("h3", {}, "AI Feedback"), evaluationList),
      item.suggested_improved_answer || item.suggested_answer
        ? h("section", { class: "interview-suggested-answer" }, h("h3", {}, "Suggested Stronger Response"),
          h("p", {}, item.suggested_improved_answer || item.suggested_answer))
        : h("section", {}, h("h3", {}, "Suggested Stronger Response"), h("p", { class: "muted" }, "No example response was saved for this answer.")),
      h("section", {}, h("h3", {}, "Related Competencies"), related.length
        ? h("ul", { class: "ir-related-skills" }, related.map((skill) => h("li", {}, skill)))
        : h("p", { class: "muted" }, "No related competencies were recorded for this answer.")),
      item.source_refs?.length ? h("p", { class: "fine" }, "Grounded in role requirements: ", item.source_refs.join(" · "),
        report.source?.url ? [" ", h("a", { href: report.source.url, target: "_blank", rel: "noopener noreferrer" }, "Open source")] : null) : null);
    questionContent.replaceChildren(answerCard);
  }
  if (questionItems.length) showQuestion(0);
  else {
    questionCounter.textContent = "No saved answers";
    previousQuestion.disabled = true; nextQuestion.disabled = true;
    questionContent.replaceChildren(h("p", { class: "muted" }, "No question-by-question feedback was saved for this attempt."));
  }
  const answersPanel = h("div", { class: "ir-tab-content ir-answers" }, questionCounter, questionProgress, questionContent,
    h("div", { class: "ir-question-nav" }, previousQuestion, nextQuestion));

  const competencyEvidence = h("div", { class: "ir-evidence-list" }, competencies.length ? competencies.map((c, index) => {
    const relatedQuestions = questionsForSkill(c.name);
    const entry = h("details", { class: "ir-evidence-item", id: `ir-competency-evidence-${index}` },
      h("summary", {}, h("span", {}, h("b", {}, c.name), levelSummary(c)),
        h("span", { class: `tag ${c.interview_score == null ? "" : `band-${band(c.interview_score)}`}` },
          c.interview_score == null ? "Not Assessed" : pct(c.interview_score))),
      h("div", {}, c.reason || c.explanation ? h("p", {}, c.reason || c.explanation) : null,
        c.evidence?.length ? h("ul", { class: "interview-evidence-list" }, c.evidence.map((quote) => h("li", {}, h("q", {}, quote))))
          : h("p", { class: "muted" }, "No supporting quotation was saved for this competency."),
        relatedQuestions.length ? h("div", {}, h("h4", {}, "Related Questions"), h("ul", { class: "ir-related-questions" }, relatedQuestions.map(({ item, index: questionNumber }) =>
          h("li", {}, h("b", {}, `Question ${questionNumber + 1}`), ` · ${item.question || "Question text was not saved."}`)))) : null));
    entry.addEventListener("toggle", () => { if (entry.open) competencyEvidence.querySelectorAll(".ir-evidence-item[open]").forEach((other) => { if (other !== entry) other.open = false; }); });
    return entry;
  }) : h("p", { class: "muted" }, "No competency evidence was saved for this report."));
  const competencyDetails = h("div", {}, competencyEvidence,
    h("div", { class: "ir-details-subsection" }, h("h3", {}, "Strengths and Improvement Areas"),
      h("div", { class: "interview-two-col" },
        h("section", {}, h("h4", {}, "Strengths"), findingCards(bySkill(report.strengths), "No specific strengths were recorded.", "strength")),
        h("section", {}, h("h4", {}, "Areas for Improvement"), findingCards(byGap(report.gaps), "No specific gaps were recorded.", "gap")))));
  const historyPanel = h("div", {},
    previous ? h("section", { class: "ir-history-current" }, h("h3", {}, "Current Attempt"),
      h("p", {}, `${fmtTime(report.completed_utc)} · ${report.difficulty} difficulty`),
      h("div", { class: "interview-compare" }, [["Interview Performance", report.performance, previous.performance],
        ["Job Readiness", report.readiness, previous.readiness], ["Role Alignment", report.competitiveness, previous.competitiveness]].map(([label, now, before]) =>
        h("div", {}, h("b", {}, label), h("span", { class: "num" }, `${scoreText(now)} · ${delta(now, before)}`),
          h("div", { class: "interview-meter" }, h("i", { style: { width: now == null ? "0" : pct(now) } }))))))
      : h("p", { class: "muted" }, comparable.length ? "Previous completed attempts are listed below." : "This is your first completed interview for this role."),
    comparable.length ? h("ul", { class: "ir-attempt-list" }, [...comparable].reverse().map((attempt) =>
      h("li", {}, h("div", {}, h("b", {}, `${fmtTime(attempt.created_utc)} · ${attempt.difficulty || "Interview"}`),
        h("span", { class: "muted" }, `${attempt.performance == null ? "Performance not available" : `${scoreText(attempt.performance)} performance`} · ${attempt.readiness == null ? "Job readiness not available" : `${scoreText(attempt.readiness)} job readiness`}`)),
        h("a", { class: "btn ghost sm", href: `#/interview/${encodeURIComponent(attempt.interview_id)}` }, "Open report"))))
      : null);
  const sources = report.source ? h("div", { class: "ir-source-record" }, h("h3", {}, "Question Source"),
    h("p", {}, report.source.url ? h("a", { href: report.source.url, target: "_blank", rel: "noopener noreferrer" }, report.source.title || report.source.url)
      : report.source.title || "Source details were recorded without a URL.",
      report.source.publisher ? ` · ${report.source.publisher}` : "",
      report.source.access_date ? ` · retrieved ${report.source.access_date}` : ""))
    : h("p", { class: "muted" }, "No external question source was recorded.");
  const methodPanel = h("div", { class: "ir-method" }, sources,
    h("section", {}, h("h3", {}, "Scoring Method"),
      h("p", {}, `Interview performance is the weighted rubric score. Job readiness = 65% interview performance + 35% profile coverage (${report.profile_coverage == null ? "not available" : pct(report.profile_coverage)}). Role Alignment is the presentation label for the Hiring Competitiveness Index: 70% demonstrated role competency (${report.demonstrated_fit == null ? "not available" : pct(report.demonstrated_fit)}) + 30% profile coverage.`),
      h("p", {}, "Rubric weights: job-relevant knowledge 30%, answer relevance and completeness 25%, problem-solving and reasoning 20%, communication and clarity 15%, and practical examples and evidence 10%.")),
    h("section", {}, h("h3", {}, "Assessment Limitations"),
      h("p", {}, report.disclaimer || "Simulated coaching assessment, not a verified probability of receiving a job offer. Actual outcomes depend on employer requirements, other applicants, experience, interviewers, and market conditions."),
      h("p", {}, "Unassessed competencies are excluded from demonstrated-skill averages. Role skill levels are AiversePulse estimates derived from an O*NET-trained model; they are not ESCO ratings.")),
    h("section", {}, h("h3", {}, "Assessment Context"),
      h("p", {}, `Source: ${assessmentSourceLabel}. Difficulty: ${report.difficulty || "Not recorded"}. Completed: ${fmtTime(report.completed_utc)}.`)));
  const detailsPanel = h("div", { class: "ir-tab-content ir-details" },
    reportDisclosure("rubric", "Rubric Details", "Scores, weights, explanations, and answer counts.",
      h("div", {}, dimensions, rubricEntries.length ? h("p", { class: "fine" }, `Evidence covered ${report.evidence_coverage == null ? "not available" : pct(report.evidence_coverage)} of the rubric.`) : null), "review"),
    reportDisclosure("competencies", "Competency Evidence", "Saved scores and quotations from your interview answers.", competencyDetails, "grid"),
    reportDisclosure("comparison", "Previous Attempts", "Completed interviews for this role and score changes.", historyPanel, "history"),
    reportDisclosure("sources", "Sources & Method", "Question sources, scoring calculations, and assessment limitations.", methodPanel, "sources"));

  const tabs = [
    { id: "overview", label: "Overview", panel: overview },
    { id: "skills", label: "Skills", panel: skillsPanel },
    { id: "answers", label: "Answers", panel: answersPanel },
    { id: "details", label: "Details", panel: detailsPanel },
  ];
  const tabButtons = tabs.map(({ id, label }, index) => h("button", { type: "button", role: "tab", id: `ir-tab-${id}`,
    "aria-controls": `ir-panel-${id}`, "aria-selected": index === 0, tabindex: index === 0 ? "0" : "-1", "data-tab": id,
    onclick: () => activateTab(id) }, label));
  const tabContent = h("div", { class: "ir-tabpanels" }, ...tabs.map(({ id, panel }, index) => {
    panel.id = `ir-panel-${id}`; panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", `ir-tab-${id}`);
    if (index) panel.hidden = true;
    return panel;
  }));
  const tabNav = h("div", { class: "ir-tabs", role: "tablist", "aria-label": "Interview report sections" }, tabButtons);
  function activateTab(id, disclosureId = null) {
    const target = tabs.find((item) => item.id === id);
    if (!target) return;
    tabs.forEach((item, index) => {
      const button = tabNav.querySelector(`[data-tab="${item.id}"]`);
      button.setAttribute("aria-selected", String(item.id === id));
      button.tabIndex = item.id === id ? 0 : -1;
      item.panel.hidden = item.id !== id;
    });
    if (disclosureId) {
      const disclosure = id === "details" ? detailsPanel.querySelector(`.interview-disclosure[data-section="${disclosureId === "rubric" ? "rubric" : disclosureId === "competency-evidence" || disclosureId.startsWith("ir-competency-evidence-") ? "competencies" : disclosureId}"]`) : null;
      if (disclosure) disclosure.open = true;
      requestAnimationFrame(() => {
        const evidence = detailsPanel.querySelector(`[id="${disclosureId}"]`);
        const section = evidence || disclosure;
        if (evidence?.matches("details")) evidence.open = true;
        section?.scrollIntoView({ block: "start", behavior: "smooth" });
        if (evidence?.matches("details")) evidence.focus({ preventScroll: true });
        else disclosure?.querySelector("summary")?.focus({ preventScroll: true });
      });
    }
  }
  tabNav.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.findIndex((item) => tabNav.querySelector(`[data-tab="${item.id}"]`) === document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabButtons[next].focus(); activateTab(tabs[next].id);
  });

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
  const reportStatus = currentAttempt?.status
    ? currentAttempt.status.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()) : "Completed";
  const results = h("div", { class: "interview-page interview-report-page" },
    h("div", { class: "interview-heading" }, h("div", {},
      h("h1", { class: "page-title" }, report.role_title || "Interview assessment"),
      h("p", { class: "lede" }, `Completed ${fmtTime(report.completed_utc) || "Date not recorded"} · ${report.difficulty || "Difficulty not recorded"} difficulty`)),
      h("span", { class: "tag interview-report-status" }, reportStatus)),
    hero,
    h("p", { class: "interview-disclaimer" }, report.disclaimer || "Simulated coaching assessment, not a verified probability of receiving a job offer. Actual outcomes depend on employer requirements, other applicants, experience, interviewers, and market conditions."),
    tabNav, tabContent,
    h("section", { class: "interview-card interview-next-steps", id: "ir-whats-next" },
      h("h2", {}, "What's Next?"),
      h("p", { class: "muted" }, "You've completed your interview assessment. Would you like AiversePulse to help you improve the skills identified in your interview?"),
      h("div", { class: "ir-plan-card" }, h("div", {}, h("h3", {}, "Create Your Personalized Learning Plan"),
        h("p", { class: "muted" }, "Use your interview results and target role to generate a personalized 30/60/90-day reskilling plan."),
        h("div", { class: "ir-plan-tags" }, h("span", {}, "AI personalized"), h("span", {}, "Career-focused"), h("span", {}, "Optional"))),
        h("div", { class: "ir-plan-actions" }, planForRole, h("a", { class: "btn ghost", href: resultsRoute }, "Back to Career Results"))),
      planStatus, planPanel),
    h("div", { class: "interview-report-actions ir-secondary-actions", "aria-label": "More interview actions" },
      h("a", { class: "btn", href: "#/quiz" }, "Retake Quick Match"),
      h("a", { class: "btn ghost", href: "#/resume" }, "Upload Resume"),
      h("a", { class: "btn ghost", href: "#/interview" }, "Interview History")));
  main.replaceChildren(results);
}

function renderEnded(main) {
  main.replaceChildren(h("div", { class: "interview-page" }, h("h1", { class: "page-title" }, "Interview ended"),
    h("p", { class: "lede" }, "There were not enough completed answers to create an assessment. Find a recommended role from your career results to practice again."),
    h("div", { class: "interview-report-actions" },
      h("a", { class: "btn primary", href: "#/quiz" }, "Take Quick Match"),
      h("a", { class: "btn", href: "#/resume" }, "Upload resume"),
      h("a", { class: "btn ghost", href: "#/interview" }, "Interview history"))));
}
