// Mina's voice (voice.js speak): stopping her settles at once and never disturbs the next question, and she only ever
// speaks in her own server voice (Pocket TTS) - the browser's system speech is never used, not even as a fallback.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/web/js/voice.js'), 'utf8');
const speaking = source.slice(source.indexOf('let serverVoice = true;'), source.indexOf('/** "Read aloud"'))
  .replace(/^export /gm, '');

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup({ failServer = false, locked = false } = {}) {
  const sources = [];
  const systemSpeech = { calls: 0 };
  const synth = new Proxy({}, { get() { systemSpeech.calls++; return () => {}; } });  // any touch is counted
  const listeners = {};
  class Ctx {
    constructor() { this.state = locked ? 'suspended' : 'running'; this.destination = {}; this.sampleRate = 24000; }
    resume() { if (!locked) this.state = 'running'; return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    decodeAudioData(buf) { return Promise.resolve({ length: buf.byteLength }); }
    createAnalyser() { return { fftSize: 0, frequencyBinCount: 8, connect() {}, getByteTimeDomainData() {}, getByteFrequencyData() {} }; }
    createBufferSource() {
      const s = { connect() {}, playbackRate: { value: 1 }, started: false, start() { this.started = true; }, stop() { this.onended?.(); } };
      sources.push(s);
      return s;
    }
  }
  const context = vm.createContext({
    window: { AudioContext: Ctx, speechSynthesis: synth }, speechSynthesis: synth,
    SpeechSynthesisUtterance: class { constructor() { systemSpeech.calls++; } },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, removeEventListener() {},
    postForBlob: () => failServer ? Promise.reject(new Error('voice down')) : Promise.resolve({ arrayBuffer: async () => new ArrayBuffer(8) }),
    ApiError: class extends Error {}, lang: () => 'en-US', performance: { now: () => 100 }, Math, Promise, Uint8Array,
  });
  vm.runInContext(`${speaking}\nglobalThis.speak = speak;`, context);
  return { speak: context.speak, sources, systemSpeech, listeners };
}

test('manual stop settles immediately and a stopped voice never reports a late start', async () => {
  const { speak, sources, systemSpeech } = setup();
  let starts = 0;
  const voice = speak('A long interview question.', { onStart: () => starts++ });
  voice.stop();
  await voice.done;
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(starts, 0);
  assert.equal(voice.level(), 0);
  assert.equal(sources.length, 0);  // nothing played after stop
  voice.stop();  // a second stop is a no-op
  assert.equal(systemSpeech.calls, 0);
});

test('stopping mid-question does not cancel or restart the next question', async () => {
  const { speak, sources, systemSpeech } = setup();
  let starts = 0;
  const first = speak('Question one.', { onStart: () => starts++ });
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(starts, 1);
  first.stop();
  await first.done;
  const second = speak('Question two.', { onStart: () => starts++ });
  for (let i = 0; i < 5; i++) await tick();
  first.stop();  // the old handle no longer touches anything
  assert.equal(starts, 2);
  assert.equal(sources.at(-1).started, true);
  sources.at(-1).onended();
  await second.done;
  assert.equal(systemSpeech.calls, 0);
});

test('when her voice is unavailable she stays silent: never the system voice', async () => {
  const down = setup({ failServer: true });
  let starts = 0;
  await down.speak('Question.', { onStart: () => starts++ }).done;
  assert.equal(starts, 0);
  assert.equal(down.systemSpeech.calls, 0);

  const locked = setup({ locked: true });  // the page may not play sound yet: wait for a tap, don't switch voices
  const voice = locked.speak('Question.');
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(locked.sources.length, 0);
  assert.ok(locked.listeners.pointerdown?.length);  // waiting for the tap that unlocks audio
  voice.stop();
  await voice.done;
  assert.equal(locked.systemSpeech.calls, 0);
});
