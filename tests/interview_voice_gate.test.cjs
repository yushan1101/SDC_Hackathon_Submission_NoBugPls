// Hands-free turns: the talking/quiet decision adapts to the room, so steady background noise doesn't keep a turn
// open (the candidate never has to press stop) and speech over that noise still counts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/web/js/interview.js'), 'utf8');
const start = source.indexOf('export function voiceGate()');
const end = start + source.slice(start).search(/\r?\n\}\r?\n/);
const gateSource = source.slice(start, source.indexOf('}', end + 1) + 1).replace('export ', '');
const context = vm.createContext({ Math });
vm.runInContext(`${gateSource}\nglobalThis.voiceGate = voiceGate;`, context);
const frames = (gate, volume, n) => { let last; for (let i = 0; i < n; i++) last = gate(volume); return last; };

test('a quiet room: speech counts, silence does not', () => {
  const gate = context.voiceGate();
  assert.equal(frames(gate, 0.004, 60), false);
  assert.equal(gate(0.08), true);
  assert.equal(frames(gate, 0.004, 5), false);
});

test('steady noise louder than the old fixed bar stops counting as speech, so the turn can end', () => {
  const gate = context.voiceGate();
  assert.equal(gate(0.03), true);  // at first it looks like a voice (the old fixed 0.025 bar never stopped saying so)
  assert.equal(frames(gate, 0.03, 60 * 20), false);  // after ~20 s at 60 fps the fan is just the room
  assert.equal(gate(0.12), true);  // and you talking over it still counts
});

test('a turn is sent as one 16 kHz mono 16-bit WAV, whatever rate the microphone runs at', async () => {
  const start = source.indexOf('export function speechWav(');
  const end = start + source.slice(start).search(/\r?\n\}\r?\n/);
  const ctx = vm.createContext({ Math, Float32Array, ArrayBuffer, DataView, Blob });
  vm.runInContext(`${source.slice(start, source.indexOf('}', end + 1) + 1).replace('export ', '')}\nglobalThis.speechWav = speechWav;`, ctx);
  const second = new Float32Array(48000).map((_, i) => 0.5 * Math.sin(i / 10));  // one second at 48 kHz
  const wav = Buffer.from(await ctx.speechWav(second, 48000).arrayBuffer());
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 16000);  // sample rate
  assert.equal(wav.readUInt16LE(22), 1);  // mono
  assert.equal(wav.length, 44 + 16000 * 2);  // one second of 16-bit samples
});

test('the recorded turn has one variable: no local "capture" shadows it (that threw "Assignment to constant variable")', () => {
  const declarations = source.match(/\b(?:const|let|var)\s+capture\b/g) || [];
  assert.deepEqual(declarations, ['let capture']);
});
