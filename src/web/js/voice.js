// Voice input and read-aloud, shared by every page.
// Mic: paid plans record in the browser and the server transcribes (works in every browser); otherwise the browser's
// own speech recognition where it has one (Chrome, Edge, Safari); with neither, no mic button is shown.
// Read aloud: the browser's built-in speech synthesis (nothing leaves the device).
import { h, icon, toast, upload } from "./lib.js";

const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
const canRecord = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
let server = false;  // set from /api/meta: this account may use server speech-to-text

/** Call once after sign-in with meta.voice. */
export function setVoice(serverVoice) { server = !!serverVoice && canRecord; }

const lang = () => document.documentElement.lang || navigator.language || "en";

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

/** "Read aloud" for some text (a function, so it reads what is there when pressed). null where speech isn't supported. */
export function readAloudButton(getText) {
  if (!("speechSynthesis" in window)) return null;
  const btn = h("button", { class: "btn ghost sm read-aloud", type: "button", "aria-pressed": "false" }, icon("volume"), "Read aloud");
  btn.addEventListener("click", () => {
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
    const text = (getText() || "").trim();
    if (!text) return;
    const u = new SpeechSynthesisUtterance(text.slice(0, 6000));
    u.lang = lang();
    u.onstart = () => { btn.setAttribute("aria-pressed", "true"); btn.lastChild.textContent = "Stop reading"; };
    u.onend = u.onerror = () => { btn.setAttribute("aria-pressed", "false"); btn.lastChild.textContent = "Read aloud"; };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
  return btn;
}

// ---------------------------------------------------------------- the interviewer's voice
// Mina is a woman, but nothing chose a voice, so browsers read questions in their default, often a male one
// ("Microsoft David" in Chrome on Windows). Prefer natural female English voices, best first; the list is matched by
// name because browsers don't report a voice's gender.
const FEMALE = [/Aria.*Natural/i, /Jenny.*Natural/i, /(Sonia|Libby|Natasha|Emma|Ava).*Natural/i, /Google UK English Female/i,
  /Google US English/i, /Samantha/i, /Karen|Moira|Tessa|Serena|Victoria|Fiona/i, /Zira/i, /Hazel|Susan|Catherine|Heera/i, /female|woman/i];
const synth = typeof speechSynthesis !== "undefined" ? speechSynthesis : null;
let voices = synth?.getVoices() || [];
synth?.addEventListener?.("voiceschanged", () => { voices = synth.getVoices(); });  // most browsers list them late

// computers set up for another language may have no English voices at all: a woman's voice still beats a man's
const FEMALE_OTHER = /Xiaoxiao|Xiaoyi|Huihui|Yaoyao|Yating|HanHan|Tracy|Yasmin|Ting-Ting|Mei-Jia|Sin-ji/i;

/** The interviewer's voice: the best female English voice this browser has, else a female voice in another language,
 *  else null (the browser's default). */
export function interviewerVoice() {
  if (!voices.length && synth) voices = synth.getVoices();
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  for (const pattern of FEMALE) {
    const found = english.find((v) => pattern.test(v.name));
    if (found) return found;
  }
  return voices.find((v) => FEMALE_OTHER.test(v.name)) || null;
}
