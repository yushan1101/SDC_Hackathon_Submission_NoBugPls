// Voice input and read-aloud, shared by every page.
// Mic: paid plans record in the browser and the server transcribes (works in every browser); otherwise the browser's
// own speech recognition where it has one (Chrome, Edge, Safari); with neither, no mic button is shown.
// Read aloud and the interviewer: one voice from the server (TTS_VOICE), so it sounds the same in every browser
// whatever voices or language the browser has; the browser's own voice only when the server has none.
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

// ---------------------------------------------------------------- speaking: the app's own voice
let serverVoice = true;  // false once the server says it has no voice: the browser's own is used from then on
const clips = new Map();  // text -> Promise<object URL>, so a question fetched early plays at once
/** Start fetching `text` in the server voice now (the interviewer asks for each question before it is read). */
export function preloadSpeech(text) {
  text = (text || "").trim().slice(0, 6000);
  if (!text || !serverVoice) return null;
  if (!clips.has(text)) {
    const job = postForBlob("/api/speech/say", { text }).then((blob) => URL.createObjectURL(blob));
    job.catch(() => clips.delete(text));
    clips.set(text, job);
    if (clips.size > 20) { const [old, url] = clips.entries().next().value; clips.delete(old); url.then(URL.revokeObjectURL, () => {}); }
  }
  return clips.get(text);
}

let current = null;
/** Read `text` aloud; one speaker at a time. -> { done: Promise, stop(), pause(), resume(), level(): 0..1 loudness now }.
 *  onStart fires when sound begins. */
export function speak(text, { onStart } = {}) {
  current?.stop();
  let audio = null, utter = null, stopped = false, ctx = null, analyser = null, samples = null;
  const browserVoice = () => new Promise((resolve) => {
    if (!("speechSynthesis" in window)) { resolve(); return; }
    utter = new SpeechSynthesisUtterance(text.slice(0, 6000)); utter.lang = lang();
    utter.onstart = () => onStart?.(); utter.onend = utter.onerror = () => resolve();
    speechSynthesis.cancel(); speechSynthesis.speak(utter);
  });
  const done = (async () => {
    if (serverVoice) {
      try {
        const url = await preloadSpeech(text);
        if (stopped) return;
        audio = new Audio(url);
        // loudness for the interviewer's lips. Only through a running audio graph: a suspended one (no click on the
        // page yet) would play the clip silently, so then the audio element plays on its own
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          ctx = new AC();
          await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))]);
          if (ctx.state === "running") {
            analyser = ctx.createAnalyser(); analyser.fftSize = 512; samples = new Uint8Array(analyser.fftSize);
            const source = ctx.createMediaElementSource(audio); source.connect(analyser); analyser.connect(ctx.destination);
          } else { ctx.close().catch(() => {}); ctx = null; }
        } catch { ctx = null; analyser = null; }
        await new Promise((resolve, reject) => {
          audio.onplaying = () => onStart?.(); audio.onended = resolve; audio.onerror = () => reject(new Error("playback failed"));
          audio.play().catch(reject);
        });
        return;
      } catch (e) {
        if (stopped) return;
        if (e instanceof ApiError && e.status === 503) serverVoice = false;  // no server voice: don't ask again
      }
    }
    if (!stopped) await browserVoice();
  })().finally(() => { ctx?.close().catch(() => {}); if (current === handle) current = null; });
  const handle = {
    done,
    stop() { stopped = true; audio?.pause(); if (utter) speechSynthesis.cancel(); },
    pause() { audio ? audio.pause() : speechSynthesis.pause(); },
    resume() { audio ? audio.play().catch(() => {}) : speechSynthesis.resume(); },
    level() {
      const playing = audio ? !audio.paused : Boolean(utter && speechSynthesis.speaking);
      if (!playing) return 0;
      if (!analyser) return 0.3 + 0.25 * Math.abs(Math.sin(performance.now() / 85));  // no measurement: a speaking rhythm
      analyser.getByteTimeDomainData(samples);
      let sum = 0; for (const s of samples) sum += ((s - 128) / 128) ** 2;
      return Math.min(1, Math.sqrt(sum / samples.length) * 4);
    },
  };
  current = handle;
  return handle;
}

/** "Read aloud" for some text (a function, so it reads what is there when pressed). */
export function readAloudButton(getText) {
  if (typeof Audio === "undefined" && !("speechSynthesis" in window)) return null;
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

