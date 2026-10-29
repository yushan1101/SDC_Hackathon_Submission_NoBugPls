const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag, attrs, children) {
    this.tag = tag; this.attrs = attrs || {}; this.children = []; this.disabled = !!attrs?.disabled;
    this.isConnected = true;
    this.append(...children.flat(Infinity).filter(x => x != null && x !== false));
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; }
  get textContent() { return this.children.map(c => c instanceof Element ? c.textContent : String(c)).join(''); }
  set textContent(value) { this.children = [value]; }
  all() { return [this, ...this.children.flatMap(c => c instanceof Element ? c.all() : [])]; }
}
const read = file => fs.readFileSync(path.join(__dirname, '../src/web/js', file), 'utf8');
const role = (scenario, skill) => ({ soc: '2511.2', title: 'Data analyst', scenario, fit: .6, top_gaps: [skill] });

function setup() {
  const pending = [], errors = [], plans = [], out = new Element('div', {}, []);
  const context = vm.createContext({
    h: (tag, attrs, ...children) => new Element(tag, attrs, children), out,
    owl: { set() {} }, matchMedia: () => ({ matches: false }), icon: () => null, jobIcon: () => null,
    integrityBlock: () => null,
    matchesBlock: (matches, options) => {
      const el = new Element('matches', {}, []); el.matches = matches; el.options = options;
      el.update = (next, state) => { el.matches = next; Object.assign(el.options, state); };
      el.setPending = () => {}; el.setError = () => {};
      return el;
    },
    api: (url, request) => new Promise((resolve, reject) => pending.push({ url, request, resolve, reject })),
    toast: message => errors.push(message), ctx: { planFor: (...args) => plans.push(args) },
    input: { skills: [{ name: 'Python', level: 2 }], markdown: 'Python work',
      matches: [role('assistive', 'Process records')], assessment_id: 'original',
      insight: { headline: 'Your profile', strengths: [], advice: [{ action: 'Original advice', role: 'Data analyst' }] } },
    lastResumeAnalysis: null,
  });
  const source = read('explore.js');
  vm.runInContext(read('ranking-state.js').replace(/export /g, ''), context);
  vm.runInContext(source.slice(source.indexOf('  function render(r) {'), source.indexOf('  if (lastResumeAnalysis) {')) + '\nrender(input);', context);
  return { context, pending, errors, plans, out, matches: () => out.all().find(e => e.tag === 'matches') };
}

test('switch refreshes matches, advice and plan actions together and persists the selected scenario', async () => {
  const s = setup();
  const task = s.matches().options.onScenario('agentic');
  assert.equal(s.pending[0].request.body.scenario, 'agentic');
  assert.equal(s.pending[0].request.body.assessment_id, 'original');
  s.pending[0].resolve({ matches: [role('agentic', 'Judge results')], assessment_id: 'updated',
    suggestions: [{ action: 'Practice judging results', role: 'Data analyst', soc: '2511.2', why: 'Agentic priority' }] });
  await task;
  assert.equal(s.matches().options.scenario, 'agentic');
  assert.equal(s.context.lastResumeAnalysis.scenario, 'agentic');
  assert.equal(s.context.lastResumeAnalysis.assessment_id, 'updated');
  assert.match(s.out.textContent, /Practice judging results/);
  assert.doesNotMatch(s.out.textContent, /Original advice/);
  s.out.all().find(e => e.tag === 'button' && e.textContent === 'Plan for this role').attrs.onclick();
  assert.equal(s.plans[0][0].scenario, 'agentic');
});

test('failed scenario request keeps the last successful results and reports the failure', async () => {
  const s = setup();
  const task = s.matches().options.onScenario('agentic');
  s.pending[0].reject(new Error('Server unavailable'));
  await task;
  assert.equal(s.matches().options.scenario, 'assistive');
  assert.equal(s.context.lastResumeAnalysis.scenario, 'assistive');
  assert.match(s.out.textContent, /Original advice/);
  assert.match(s.errors[0], /Server unavailable/);
});

test('a late rematch response cannot overwrite the newest selected scenario', async () => {
  const s = setup();
  const old = s.matches().options.onScenario('agentic');
  const latest = s.matches().options.onScenario('assistive');
  await latest;
  assert.equal(s.pending.length, 1); // returning to the original scenario reuses valid results
  s.pending[0].resolve({ matches: [role('agentic', 'Old result')], assessment_id: 'old' });
  await old;
  assert.equal(s.matches().options.scenario, 'assistive');
  assert.equal(s.matches().matches[0].top_gaps[0], 'Process records');
  assert.equal(s.context.lastResumeAnalysis.assessment_id, 'original');
});

test('editing skills invalidates cached matches and ignores an in-flight result for the old skills', async () => {
  const s = setup();
  const task = s.matches().options.onScenario('agentic');
  const add = s.out.all().find(e => e.tag === 'input' && e.attrs.placeholder?.startsWith('Add a skill'));
  add.value = 'SQL';
  s.out.all().find(e => e.tag === 'button' && e.textContent === 'Add').attrs.onclick();
  s.pending[0].resolve({ matches: [role('agentic', 'Outdated result')], assessment_id: 'outdated' });
  await task;
  assert.equal(s.matches().options.scenario, 'assistive');
  const updated = s.matches().options.onScenario('agentic');
  assert.equal(s.pending.length, 2);
  assert.equal(s.pending[1].request.body.skills[0].name, 'SQL');
  s.pending[1].resolve({ matches: [role('agentic', 'Updated result')], assessment_id: 'updated' });
  await updated;
  assert.equal(s.matches().matches[0].top_gaps[0], 'Updated result');
});

test('Plan for this role carries the match scenario into the analysis request', () => {
  const profile = { scenario: 'assistive' }, starts = [];
  const context = vm.createContext({ S: { profile }, saveProfile() {}, start: query => starts.push({ ...profile, query }) });
  const source = read('public.js');
  vm.runInContext(source.slice(source.indexOf('function planFor('), source.indexOf('function startInterview(')), context);
  context.planFor(role('agentic', 'Judge results'), [{ name: 'Python', level: 2 }]);
  assert.equal(starts[0].scenario, 'agentic');
  assert.equal(starts[0].target_role, '2511.2');
  context.planFor(role('assistive', 'Process records'), [{ name: 'Python', level: 2 }]);
  assert.equal(starts[1].scenario, 'assistive');
});
