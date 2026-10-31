// Voice input and read-aloud, shared by every page.
// Mic: paid plans record in the browser and the server transcribes (works in every browser); otherwise the browser's
// own speech recognition where it has one (Chrome, Edge, Safari); with neither, no mic button is shown.
// Read aloud and the interviewer: one voice from the server (Pocket TTS), so the browser never switches to a system voice.
import { ApiError, h, icon, postForBlob, toast, upload } from "./lib.js";

const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
const canRecord = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
let server = false;  // set from /api/meta: this account may use server speech-to-text

/** Call once after sign-in with meta.voice. */
export function setVoice(serverVoice) { server = !!serverVoice && canRecord; }

/** The language speech is read in (and recognised in): the page's, so every spoken text sounds the same. */
export const lang = () => document.documentElement.lang || navigator.language || "en";

/** Any recording the browser made (WebM/Opus, MP4...) -> 16 kHz mono 16-bit WAV, a format every speech model takes.
 * Two minutes is about 3.8 MB. */
export async function toWav(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = await ctx.decodeAudioData(await blob.arrayBuffer());
  ctx.close();
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(src.duration * rate)), rate);  // 1 channel: downmixes to mono
  const node = off.createBufferSource();
  node.buffer = src; node.connect(off.destination); node.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const v = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const tag = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); tag(8, "WAVE"); tag(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); tag(36, "data"); v.setUint32(40, pcm.length * 2, true);
  pcm.forEach((x, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 0x7fff, true));
  return new Blob([v.buffer], { type: "audio/wav" });
}
const MAX_MS = 120_000;

/** A mic button that types what you say into `target` (an input or textarea). null when no voice input works here. */
export function micButton(target, { onText } = {}) {
  if (!server && !Speech) return null;
  let stop = null;
  const btn = h("button", { class: "btn icon mic-btn", type: "button", "aria-label": "Speak instead of typing", title: "Speak instead of typing",
    "aria-pressed": "false", onclick: () => (stop ? stop() : start()) }, icon("mic"));
  const put = (text) => {
    if (!text) return;
    const before = target.value && !/\s$/.test(target.value) ? target.value + " " : target.value;
    target.value = (before + text).slice(0, target.maxLength > 0 ? target.maxLength : 4000);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    onText?.(target.value);
    target.focus();
  };
  const busy = (on) => {
    btn.setAttribute("aria-pressed", String(on)); btn.classList.toggle("recording", on);
    btn.replaceChildren(icon(on ? "mic-off" : "mic"));
    btn.setAttribute("aria-label", on ? "Stop and use what I said" : "Speak instead of typing");
  };

  async function start() {
    if (server) {
      let rec, chunks = [], timer;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        rec = new MediaRecorder(stream);
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          clearTimeout(timer); busy(false); stop = null;
          btn.disabled = true;
          try {
            const form = new FormData();
            form.append("file", await toWav(new Blob(chunks, { type: rec.mimeType || "audio/webm" })), "speech.wav");
            form.append("lang", lang());
            put((await upload("/api/speech/transcribe", form)).text);
          } catch (e) { toast(e.message, "err"); }
          btn.disabled = false;
        };
        rec.start();
        busy(true);
        stop = () => rec.state !== "inactive" && rec.stop();
        timer = setTimeout(stop, MAX_MS);
      } catch { toast("Allow microphone access in your browser settings, then try again.", "err"); }
      return;
    }
    const r = new Speech();
    r.lang = lang(); r.interimResults = false; r.continuous = true;
    r.onresult = (e) => put(Array.from(e.results).slice(e.resultIndex).map((x) => x[0].transcript).join(" ").trim());
    r.onerror = (e) => { if (e.error === "not-allowed") toast("Allow microphone access in your browser settings, then try again.", "err"); };
    r.onend = () => { busy(false); stop = null; };
    r.start();
    busy(true);
    stop = () => r.stop();
  }
  return btn;
}

// ---------------------------------------------------------------- speaking: Mina's voice (Pocket TTS on the server)
// Like HoloHuman's pipeline: the text is cut into sentences, every sentence is fetched from the server voice at once,
// and they play one after another, so she starts after the first sentence rather than the whole reply. stop() cuts
// her off mid-word (the interview stops her the moment the candidate starts talking). If the server voice is down the
// browser's own female voice reads instead, so she is never silent.
let serverVoice = true;  // false once the server says it has no voice
const clips = new Map();  // sentence -> Promise<ArrayBuffer>, so a question fetched early plays at once
const sentences = (text) => (text.replace(/\s+/g, " ").trim().slice(0, 6000).match(/[^.!?。！？]+[.!?。！？]+["')\]]*|[^.!?。！？]+$/g) || [])
  .map((s) => s.trim()).filter(Boolean);
const fetchClip = (s) => {
  if (!clips.has(s)) {
    const job = postForBlob("/api/speech/say", { text: s }).then((blob) => blob.arrayBuffer());
    job.catch((e) => { clips.delete(s); if (e instanceof ApiError && e.status === 503) serverVoice = false; });
    clips.set(s, job);
    if (clips.size > 60) clips.delete(clips.keys().next().value);
  }
  return clips.get(s);
};
/** Start fetching `text` in the server voice now (the interviewer asks for each question before it is read). */
export function preloadSpeech(text) {
  if (!serverVoice || !text) return null;
  return Promise.all(sentences(text).map(fetchClip)).catch(() => null);
}

let ctx = null;  // one audio graph for every clip: it measures her loudness for the lips
const audioCtx = () => {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!ctx && AC) ctx = new AC();
  return ctx;
};
// the first tap anywhere lets audio play (browser autoplay rules)
addEventListener("pointerdown", () => { audioCtx()?.resume().catch(() => {}); }, { once: true, capture: true });

const femaleVoice = () => {
  const vs = "speechSynthesis" in window ? speechSynthesis.getVoices() : [];
  const en = vs.filter((v) => v.lang.startsWith(lang().slice(0, 2)));
  return en.find((v) => /female|aria|jenny|zira|samantha|sonia|libby|natasha|karen|moira|tessa|google uk english female/i.test(v.name)) || en[0] || null;
};

let current = null;
/** Read `text` aloud; one speaker at a time. -> { done, stop(), pause(), resume(), level(): 0..1 loudness now,
 *  bands(): { low, high } share of the voice in 100-600 Hz (rounded vowels) and 1.8-6 kHz (spread vowels, s/sh) }.
 *  onStart fires when sound begins. */
export function speak(text, { onStart } = {}) {
  current?.stop();
  let stopped = false, paused = false, source = null, analyser = null, samples = null, spectrum = null, utter = null, started = false;
  let resumeWait = null;
  const begin = () => { if (!started) { started = true; onStart?.(); } };
  const playBuffer = (buffer) => new Promise((resolve) => {
    const c = audioCtx();
    source = c.createBufferSource(); source.buffer = buffer;
    analyser ??= Object.assign(c.createAnalyser(), { fftSize: 1024, smoothingTimeConstant: 0.35 });
    samples ??= new Uint8Array(analyser.fftSize); spectrum ??= new Uint8Array(analyser.frequencyBinCount);
    source.connect(analyser); analyser.connect(c.destination);
    source.onended = () => { source = null; resolve(); };
    source.start(); begin();
  });
  const browserSay = (s) => new Promise((resolve) => {
    if (!("speechSynthesis" in window)) { resolve(); return; }
    utter = new SpeechSynthesisUtterance(s); utter.lang = lang(); utter.voice = femaleVoice(); utter.pitch = 1.1;
    utter.onstart = begin; utter.onend = utter.onerror = () => resolve();
    speechSynthesis.speak(utter);
  });
  const done = (async () => {
    const parts = sentences(text);
    const jobs = serverVoice ? parts.map(fetchClip) : [];
    for (let i = 0; i < parts.length && !stopped; i++) {
      if (paused) { await new Promise((r) => { resumeWait = r; }); resumeWait = null; }
      if (stopped) break;
      let buffer = null;
      if (serverVoice) {
        try {
          const c = audioCtx();
          if (c?.state === "suspended") await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 300))]);
          if (c?.state === "running") buffer = await c.decodeAudioData((await jobs[i]).slice(0));
        } catch { buffer = null; }
      }
      if (stopped) break;
      if (buffer) await playBuffer(buffer);
      else await browserSay(parts[i]);
    }
  })().finally(() => { if (current === handle) current = null; });
  const handle = {
    done,
    stop() {
      stopped = true;
      try { source?.stop(); } catch { /* already ended */ }
      if (utter) speechSynthesis.cancel();
      resumeWait?.();
    },
    pause() { paused = true; ctx?.suspend().catch(() => {}); if (utter) speechSynthesis.pause(); },
    resume() { paused = false; ctx?.resume().catch(() => {}); if (utter) speechSynthesis.resume(); resumeWait?.(); },
    level() {
      if (stopped || paused) return 0;
      if (source && analyser) {
        analyser.getByteTimeDomainData(samples);
        let sum = 0; for (const s of samples) sum += ((s - 128) / 128) ** 2;
        return Math.min(1, Math.sqrt(sum / samples.length) * 11);  // HoloHuman's lip envelope scale
      }
      return utter && speechSynthesis.speaking ? 0.3 + 0.25 * Math.abs(Math.sin(performance.now() / 85)) : 0;
    },
    bands() {
      if (!source || !analyser) {  // no measurement: a gentle, plausible drift
        const t = performance.now() / 1000;
        return { low: 0.3 + Math.sin(t * 3.1) * 0.15, high: 0.25 - Math.sin(t * 3.1 + 0.7) * 0.12 };
      }
      analyser.getByteFrequencyData(spectrum);
      const hz = ctx.sampleRate / 2 / spectrum.length;
      const band = (a, b) => { let s = 0; for (let i = Math.floor(a / hz); i < Math.min(spectrum.length, Math.ceil(b / hz)); i++) s += spectrum[i]; return s; };
      const total = band(100, 6000) + 1;
      return { low: band(100, 600) / total, high: band(1800, 6000) / total };
    },
  };
  current = handle;
  return handle;
}

/** "Read aloud" for some text (a function, so it reads what is there when pressed). */
export function readAloudButton(getText) {
  if (!("speechSynthesis" in window) && !(window.AudioContext || window.webkitAudioContext)) return null;
  const btn = h("button", { class: "btn ghost sm read-aloud", type: "button", "aria-pressed": "false" }, icon("volume"), "Read aloud");
  let speaking = null;
  const idle = () => { speaking = null; btn.setAttribute("aria-pressed", "false"); btn.lastChild.textContent = "Read aloud"; };
  btn.addEventListener("click", () => {
    if (speaking) { speaking.stop(); idle(); return; }
    const text = (getText() || "").trim();
    if (!text) return;
    btn.setAttribute("aria-pressed", "true"); btn.lastChild.textContent = "Stop reading";
    const me = speaking = speak(text);
    me.done.finally(() => { if (speaking === me) idle(); });
  });
  return btn;
}

