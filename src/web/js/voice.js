// Voice input and read-aloud, shared by every page.
// Mic: paid plans record in the browser and the server transcribes (works in every browser); otherwise the browser's
// own speech recognition where it has one (Chrome, Edge, Safari); with neither, no mic button is shown.
// Read aloud and the interviewer: one voice from the server (Pocket TTS), so the browser never switches to a system voice.
import { h, icon, toast, upload } from "./lib.js";

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

// ---------------------------------------------------------------- speaking: the browser's native voice
/** Server speech is intentionally disabled; interview questions use the browser's system TTS. */
export function preloadSpeech() { return null; }

let current = null;
export function speak(text, { onStart } = {}) {
  current?.stop();
  let utter = null, stopped = false;
  const done = new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    utter = new SpeechSynthesisUtterance(text.slice(0, 6000)); utter.lang = lang();
    utter.onstart = () => onStart?.(); utter.onend = utter.onerror = () => resolve();
    speechSynthesis.cancel(); speechSynthesis.speak(utter);
  }).finally(() => { if (current === handle) current = null; });
  const handle = {
    done,
    stop() { stopped = true; if (utter) speechSynthesis.cancel(); },
    pause() { speechSynthesis.pause(); },
    resume() { speechSynthesis.resume(); },
    level() { return !stopped && speechSynthesis.speaking ? 0.3 + 0.25 * Math.abs(Math.sin(performance.now() / 85)) : 0; },
    bands() {
      const t = performance.now() / 1000;
      return { low: 0.3 + Math.sin(t * 3.1) * 0.15, high: 0.25 - Math.sin(t * 3.1 + 0.7) * 0.12 };
    },
  };
  current = handle;
  return handle;
}

/** "Read aloud" for some text (a function, so it reads what is there when pressed). */
export function readAloudButton(getText) {
  if (!("speechSynthesis" in window)) return null;
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

