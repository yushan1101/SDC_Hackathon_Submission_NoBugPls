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
