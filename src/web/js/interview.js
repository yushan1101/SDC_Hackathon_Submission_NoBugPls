import { api, h, icon, toast, fmtTime, ApiError } from "./lib.js";

const LABELS = {
  knowledge: "Job-relevant knowledge", relevance: "Answer relevance & completeness",
  problem_solving: "Problem-solving & reasoning", communication: "Communication & clarity",
  practical_evidence: "Practical examples & evidence",
};
const TYPES = { behavioral: "HR / behavioral", technical: "Technical", situational: "Situational",
  problem_solving: "Problem-solving", workplace_scenario: "Workplace scenario" };
const pct = (n) => `${Math.max(0, Math.min(100, Math.round(Number(n) || 0)))}%`;
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
  const empty = h("section", { class: "interview-empty interview-card" },
    h("div", { class: "interview-empty-icon", "aria-hidden": "true" }, icon("spark")),
    h("div", {}, h("h2", {}, "No practice interviews yet"),
      h("p", {}, "Discover your career matches by uploading your resume or completing our career game. Once you've found your recommended roles, you can unlock personalized AI mock interviews to prepare for your future career.")),
    h("div", { class: "interview-report-actions" },
      h("a", { class: "btn primary", href: "#/resume" }, "Upload resume"),
      h("a", { class: "btn", href: "#/quiz" }, "Take Quick Match")));
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
          resumable ? h("small", { class: "muted" }, `Question ${item.question_number || 1} · Stage ${Math.min((item.stage_index || 0) + 1, item.total_stages || 5)} of ${item.total_stages || 5}`) : null),
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
  main.replaceChildren(
    h("div", { class: "interview-page" },
      h("div", { class: "interview-heading" }, h("div", {}, h("p", { class: "eyebrow" }, "MOCK INTERVIEWS"),
        h("h1", { class: "page-title" }, "Interview history"),
        h("p", { class: "lede" }, "Review your practice sessions and track your preparation for recommended roles."))),
      history.length ? list : empty));
}

function renderLaunch(main, recommendation, plans) {
  const skills = recommendation.profile || [];
  const difficulty = h("select", { class: "input", "aria-label": "Interview difficulty" },
    h("option", { value: "foundational" }, "Foundational"), h("option", { value: "intermediate", selected: true }, "Intermediate"),
    h("option", { value: "advanced" }, "Advanced"));
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
  main.replaceChildren(
    h("div", { class: "interview-page" },
      h("div", { class: "interview-heading" }, h("div", {}, h("p", { class: "eyebrow" }, "RECOMMENDED ROLE · PRACTICE"),
        h("h1", { class: "page-title" }, recommendation.role_title),
        h("p", { class: "lede" }, recommendation.source === "resume"
          ? "This role came from your completed resume analysis." : "This role came from your Quick Match results."))),
      h("section", { class: "interview-card" }, h("h2", {}, "Prepare for your interview"),
        h("p", { class: "muted" }, `Recommended role · ESCO ${recommendation.role_id}`),
        h("div", { class: "interview-skills" }, skills.map((s) => h("span", { class: "chip-static" }, `${s.name} · ${s.level}/5`))),
        h("label", { class: "field" }, h("span", {}, "Difficulty"), difficulty),
        h("label", { class: "field" }, h("span", {}, "Link a learning plan (optional)"), plan),
        h("div", { class: "interview-consent" }, h("label", {}, consent,
          h("span", {}, "I agree to save my answer transcripts and have them processed by AI for interview feedback. No audio is stored.")),
        h("p", { class: "fine" }, "Voice input uses your browser’s speech recognition when available. Browser speech services may process audio; text entry is always available.")),
        error, start),
      h("a", { class: "btn ghost", href: "#/interview" }, "Back to interview history")));
}

function renderRoom(main, detail, initial = null, callbacks = {}) {
  const sessionId = detail.interview_id;
  let current = initial?.question || detail.question;
  let source = initial?.source || detail.source;
  let number = initial?.question_number || detail.question_number || 1;
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
  const voicePanel = h("div", { class: "interview-voice-panel", dataset: { state: "off" } },
    h("div", { class: "interview-voice-summary" }, meter,
      h("div", { class: "interview-voice-copy" }, h("b", {}, "Voice answer"), status), duration),
    h("details", { class: "interview-voice-settings" }, h("summary", {}, "Microphone & language"),
      h("label", { class: "interview-voice-field" }, h("span", {}, "Microphone"), deviceSelect),
      h("label", { class: "interview-voice-field" }, h("span", {}, "Transcription language"), languageSelect)),
    h("div", { class: "interview-voice-controls" }, startBtn, stopBtn, retryBtn, muteBtn));
  const livePreview = h("p", { class: "interview-live-preview", "aria-live": "polite", hidden: true });
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechAvailable = Boolean(Speech);
  const recognizer = speechAvailable ? new Speech() : null;
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
  let microphoneLevel = 0, speechCue = null, lastAvatarSignalAt = 0;
  let officeDisposer = null;
  const updateAvatarPresentation = () => {
    const micState = voicePanel.dataset.state;
    const state = interviewerSpeaking ? "speaking"
      : ["ready", "listening", "speaking", "captured"].includes(micState) ? "listening" : "idle";
    window.dispatchEvent(new CustomEvent("aiversepulse:interview-avatar-state", { detail: {
      state, microphoneLevel, speechCue,
    } }));
  };
  const setMicState = (state, message) => {
    voicePanel.dataset.state = state;
    status.className = `interview-status is-${state}`;
    status.textContent = message;
    updateAvatarPresentation();
  };
  const updateControls = () => {
    startBtn.disabled = recording || starting || Boolean(finishPromise) || paused || interviewerSpeaking;
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
    muteBtn.textContent = "Mute";
    muteBtn.setAttribute("aria-label", "Mute microphone");
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
        if (volume > 0.025) setMicState("speaking", "Speaking detected · keep answering");
        else setMicState("listening", speechAvailable ? "Listening · speak your answer" : "Listening · browser transcription unavailable; type your answer");
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
      recording = false; muted = false; pauseDuration();
      releaseAudio(); interimText = ""; livePreview.textContent = ""; livePreview.hidden = true;
      if (announce) {
        const hasAnswer = Boolean(transcript.value.trim());
        setMicState(hasAnswer ? "captured" : "error", hasAnswer
          ? "Answer captured · review or edit the transcript before sending"
          : speechAvailable ? "No speech was transcribed · check the language, retry, or type your answer"
            : "Speech recognition is unavailable in this browser · type your answer instead");
      }
    })().finally(() => { finishPromise = null; updateControls(); });
    updateControls();
    return finishPromise;
  };
  const startRecording = async () => {
    if (recording || starting || paused || interviewerSpeaking) return;
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
      starting = false; recording = true; muted = false; muteBtn.textContent = "Mute"; muteBtn.setAttribute("aria-label", "Mute microphone"); startDuration(); updateControls();
      if (recognizer) {
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
      pauseDuration(); await stopRecognition(); muteBtn.textContent = "Unmute"; muteBtn.setAttribute("aria-label", "Unmute microphone");
      setMicState("off", "Microphone muted · unmute to continue recording");
    } else {
      muteBtn.textContent = "Mute"; muteBtn.setAttribute("aria-label", "Mute microphone"); startDuration();
      if (recognizer && recording) {
        try { recognitionRequested = true; recognizer.start(); setMicState("listening", "Listening · speak your answer"); }
        catch { recognitionRequested = false; setMicState("error", "Could not resume speech recognition. Stop and retry, or type your answer."); }
      } else setMicState("ready", "Microphone active · type your answer");
    }
    updateControls();
  });
  const playQuestion = async () => {
    if (!window.speechSynthesis) { setMicState("ready", "Ready to answer · microphone off"); toast("Speech playback is unavailable in this browser."); return; }
    interviewerSpeaking = true; updateControls(); setMicState("processing", "Preparing interviewer question…");
    if (recording || micStream) await finishRecording(false, false);
    const utterance = new SpeechSynthesisUtterance(qText.textContent); currentUtterance = utterance;
    window.speechSynthesis.cancel();
    utterance.onstart = () => {
      if (currentUtterance !== utterance) return;
      speechCue = { word: utterance.text, startedAt: performance.now(), secondsPerCharacter: 0.095 / Math.max(0.5, utterance.rate || 1) };
      interviewerSpeaking = true; updateControls(); setMicState("processing", "Interviewer speaking · microphone capture is off");
    };
    utterance.onboundary = (event) => {
      if (currentUtterance !== utterance || !interviewerSpeaking) return;
      const remaining = utterance.text.slice(Math.max(0, event.charIndex || 0));
      const word = remaining.match(/^[\p{L}\p{N}'’\-]+/u)?.[0];
      if (!word) return;
      speechCue = { word, startedAt: performance.now(), secondsPerCharacter: 0.105 / Math.max(0.5, utterance.rate || 1) };
      updateAvatarPresentation();
    };
    utterance.onend = () => {
      if (currentUtterance !== utterance) return;
      currentUtterance = null; interviewerSpeaking = false; speechCue = null; updateControls();
      setMicState(paused ? "off" : "ready", paused ? "Paused · microphone off" : "Ready to answer · microphone off");
    };
    utterance.onerror = () => {
      if (currentUtterance !== utterance) return;
      currentUtterance = null; interviewerSpeaking = false; speechCue = null; updateControls();
      setMicState("ready", "Ready to answer · microphone off");
    };
    window.speechSynthesis.speak(utterance);
  };
  const dispose = () => {
    discarded = true; recording = false; muted = false; pauseDuration();
    try { recognizer?.abort(); } catch { /* already stopped */ }
    recognitionActive = false; recognitionRequested = false; releaseAudio(); window.speechSynthesis?.cancel();
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
  const counter = h("span", { class: "interview-counter" }, `Question ${number} of ${total}`);
  const setQuestion = (q, n, src) => {
    current = q; number = n; source = src || source;
    counter.textContent = `Question ${number} of ${total}`;
    qText.textContent = q.text || q.question_text || "";
    qText.animate?.([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 420, easing: "ease-out" });
    stageText.textContent = TYPES[q.type || q.question_type] || String(q.stage || "Interview").replaceAll("_", " ");
    questionStage.textContent = stageText.textContent;
    skillChips.replaceChildren(...(q.target_skills || []).map((s) => h("span", { class: "chip-static" }, s)));
    const step = Math.min(total, stageIndex + 1);
    progress.setAttribute("aria-valuenow", String(step));
    progress.querySelector("i").style.width = `${Math.min(100, step / total * 100)}%`;
    setMicState("off", "Microphone off");
    if (qText.textContent) void playQuestion();
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
      setQuestion(result.question, result.question_number, result.source);
    } catch (e) { setMicState("captured", "Answer captured · review or edit before sending"); toast(e.message, "err"); }
    answerBtn.disabled = false; pause.disabled = false; updateControls();
  } }, h("label", { class: "field" }, h("span", {}, "Your answer"), transcript),
    voicePanel, livePreview, h("div", { class: "row-actions interview-submit-row" }, answerBtn));
  const repeat = h("button", { class: "btn sm", type: "button", onclick: () => { void playQuestion(); } }, "Replay question");
  const pause = h("button", { class: "btn sm", type: "button", onclick: () => {
    paused = !paused;
    if (paused) {
      if (recording || micStream) void finishRecording();
      window.speechSynthesis?.pause();
      if (!interviewerSpeaking) setMicState("off", "Paused · microphone off");
    } else {
      window.speechSynthesis?.resume();
      if (!interviewerSpeaking) setMicState("off", "Microphone off");
    }
    pause.textContent = paused ? "Resume" : "Pause";
    answerBtn.disabled = paused; updateControls();
  } }, "Pause");
  repeat.textContent = "Replay question";
  voicePanel.querySelector(".interview-voice-controls").append(repeat, pause);
  const end = h("button", { class: "interview-exit-button", type: "button", onclick: async () => {
    end.disabled = true; end.textContent = "Saving…";
    try {
      const pendingTranscript = interimText.trim();
      if (recording || micStream) await finishRecording(false, false);
      if (pendingTranscript && !transcript.value.toLocaleLowerCase().includes(pendingTranscript.toLocaleLowerCase())) {
        transcript.value = [transcript.value.trim(), pendingTranscript].filter(Boolean).join(" ").slice(0, 4000);
      }
      window.speechSynthesis?.cancel(); currentUtterance = null; interviewerSpeaking = false; speechCue = null;
      await api(`/api/interviews/${sessionId}/pause`, { method: "POST", body: { draft_answer: transcript.value.slice(0, 4000) } });
      const destination = detail.assessment_source === "questionnaire" ? "#/quiz" : "#/resume";
      dispose(); location.hash = destination;
      toast("Progress saved. Resume this interview from Interview History when you’re ready.");
    } catch (e) {
      end.disabled = false; end.textContent = "Exit";
      toast(`Could not save your interview progress. You are still in the interview. ${e.message}`, "err");
    }
  } }, "Exit");
  const onEscape = (event) => { if (event.key === "Escape") { event.preventDefault(); end.click(); } };
  document.addEventListener("keydown", onEscape);
  setQuestion(current, number, source);
  const officeEnabled = window.AP_CONFIG?.VIRTUAL_INTERVIEW_3D === true;
  const officeHost = officeEnabled ? h("div", { class: "interview-office-host", role: "group",
    "aria-label": "First-person view of a modern interview office, seated across the desk" },
    h("span", { class: "interview-office-label", "aria-hidden": "true" }, "VIRTUAL INTERVIEW OFFICE"),
    h("span", { class: "interview-office-loading", role: "status" }, "Preparing your interview room…")) : null;
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
      h("p", { class: "interview-question-label" }, "QUESTION · ", questionStage), qText, skillChips));
  const topbar = h("header", { class: "interview-topbar" },
    h("div", { class: "interview-role-name" }, detail.role_title),
    h("div", { class: "interview-topbar-progress" }, counter, progress), end);
  const room = h("section", { class: `interview-takeover${officeEnabled ? " interview-room-office-pending" : ""}`, "aria-label": "Live mock interview" },
    officeHost, topbar, questionOverlay, responseFeedback, form,
    h("p", { class: "interview-room-disclaimer" }, "Only your reviewed transcript is sent to AiversePulse and saved with this interview. Browser speech recognition may process microphone audio; AiversePulse does not store audio."));
  main.replaceChildren(room);
  if (officeHost) {
    const fallbackOffice = (error) => {
      officeHost.remove(); room.classList.remove("interview-room-office-pending", "interview-room-virtual");
      officeDisposer?.(); officeDisposer = null;
      console.warn("Virtual interview office unavailable; using the standard interview room.", error);
    };
    import("./virtual-office.js").then(({ mountVirtualOffice }) => mountVirtualOffice(officeHost, { onFailure: fallbackOffice })).then((unmount) => {
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

async function renderReport(main, report, callbacks = {}) {
  const history = (await api("/api/interviews").catch(() => ({ interviews: [] }))).interviews || [];
  const currentAttempt = history.find((x) => x.interview_id === report.interview_id);
  const assessmentSource = report.assessment_source || currentAttempt?.assessment_source;
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
  } }, "Yes, Plan for This Role");
  const resultsRoute = assessmentSource === "questionnaire" ? "#/quiz" : "#/resume";
  const nextSteps = h("section", { class: "interview-card interview-next-steps" },
    h("h2", {}, "Ready to Improve Your Skills?"),
    h("p", { class: "muted" }, "Based on your interview performance, we've identified areas you can improve. Would you like to create a personalized learning plan for this role?"),
    h("div", { class: "interview-report-actions" }, planForRole,
      h("a", { class: "btn ghost", href: resultsRoute }, "No, Back to My Career Results")), planStatus);
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
    nextSteps,
    h("div", { class: "interview-report-actions" },
      h("a", { class: "btn primary", href: "#/quiz" }, "Retake Quick Match"),
      h("a", { class: "btn", href: "#/resume" }, "Upload resume"),
      h("a", { class: "btn ghost", href: "#/interview" }, "Interview history")), sources));
}

function renderEnded(main) {
  main.replaceChildren(h("div", { class: "interview-page" }, h("h1", { class: "page-title" }, "Interview ended"),
    h("p", { class: "lede" }, "There were not enough completed answers to create an assessment. Find a recommended role from your career results to practice again."),
    h("div", { class: "interview-report-actions" },
      h("a", { class: "btn primary", href: "#/quiz" }, "Take Quick Match"),
      h("a", { class: "btn", href: "#/resume" }, "Upload resume"),
      h("a", { class: "btn ghost", href: "#/interview" }, "Interview history"))));
}
