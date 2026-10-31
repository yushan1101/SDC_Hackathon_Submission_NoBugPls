const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/web/js/voice.js'), 'utf8');
// the browser-voice path of speak(): the server voice (Pocket TTS) is switched off for these tests
const speaking = source.slice(source.indexOf('let serverVoice = true;'), source.indexOf('/** "Read aloud"'))
  .replace('export function speak', 'function speak').replace('export function preloadSpeech', 'function preloadSpeech')
  .replace('let serverVoice = true;', 'let serverVoice = false;');

function setup({ failToSpeak = false } = {}) {
  const utterances = [];
  const synth = {
    speaking: false, paused: false, cancellations: 0,
    cancel() { this.speaking = false; this.cancellations++; },
    getVoices() { return []; },
    resume() { this.paused = false; },
    pause() { this.paused = true; },
    speak(utterance) {
      if (failToSpeak) throw new Error('TTS unavailable');
      utterances.push(utterance);
      this.speaking = true;
    },
  };
  class Utterance { constructor(text) { this.text = text; } }
  const context = vm.createContext({
    window: { speechSynthesis: synth }, speechSynthesis: synth, SpeechSynthesisUtterance: Utterance,
    lang: () => 'en-US', performance: { now: () => 100 }, Math, addEventListener() {}, postForBlob() {}, ApiError: class {},
  });
  vm.runInContext(`${speaking}\nglobalThis.speak = speak;`, context);
  return { speak: context.speak, synth, utterances };
}

test('manual stop settles immediately even when cancel emits no end event', async () => {
  const { speak, synth, utterances } = setup();
  let starts = 0;
  const voice = speak('A long interview question', { onStart: () => starts++ });
  const lateStart = utterances[0].onstart;
  voice.stop();
  await voice.done;
  lateStart();
  assert.equal(starts, 0);
  assert.equal(voice.level(), 0);
  assert.equal(utterances[0].onstart, null);
  assert.equal(utterances[0].onend, null);
  assert.equal(synth.speaking, false);
  const cancellations = synth.cancellations;
  voice.stop();
  assert.equal(synth.cancellations, cancellations);
});

test('stopping mid-question does not cancel or restart the next question', async () => {
  const { speak, synth, utterances } = setup();
  let starts = 0;
  const first = speak('Question one', { onStart: () => starts++ });
  utterances[0].onstart();
  assert.equal(starts, 1);
  first.stop();
  await first.done;

  const second = speak('Question two', { onStart: () => starts++ });
  const cancellations = synth.cancellations;
  first.stop();
  assert.equal(synth.cancellations, cancellations);
  utterances[1].onstart();
  assert.equal(starts, 2);
  assert.equal(synth.speaking, true);
  utterances[1].onend();
  await second.done;
});

test('natural end and TTS failure both settle without stopping a later question', async () => {
  const natural = setup();
  const voice = natural.speak('Question');
  natural.utterances[0].onend();
  await voice.done;
  assert.equal(natural.utterances[0].text, 'Question');

  const unavailable = setup({ failToSpeak: true });
  await unavailable.speak('Question').done;
  assert.equal(unavailable.synth.speaking, false);
});
