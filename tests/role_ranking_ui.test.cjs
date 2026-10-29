const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '../src/web/js', name), 'utf8');

class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag; this.attrs = {}; this.dataset = {}; this.children = []; this.handlers = {}; this.parentElement = null;
    this.className = ''; this.hidden = false; this.open = false; this.checked = false; this.isConnected = true; this.animations = [];
    this.classList = { add: c => this.classList.toggle(c, true), remove: c => this.classList.toggle(c, false),
      toggle: (c, value) => { const set = new Set(this.className.split(/\s+/).filter(Boolean));
        if (value ?? !set.has(c)) set.add(c); else set.delete(c); this.className = [...set].join(' '); } };
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('on')) this.handlers[key.slice(2)] = value;
      else if (['hidden', 'open', 'checked'].includes(key)) this[key] = !!value;
      else this.setAttribute(key, value);
    }
    this.append(...children.flat(Infinity).filter(c => c != null && c !== false));
  }
  append(...children) { for (const child of children) {
    if (child instanceof Element) { child.remove(); child.parentElement = this; } this.children.push(child);
  } }
  replaceChildren(...children) { for (const c of this.children) if (c instanceof Element) c.parentElement = null;
    this.children = []; this.append(...children); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); this.parentElement = null; }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key === 'class') this.className = value;
    if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  get textContent() { return this.children.map(c => c instanceof Element ? c.textContent : String(c)).join(''); }
  set textContent(value) { this.replaceChildren(String(value)); }
  get childElementCount() { return this.children.filter(c => c instanceof Element).length; }
  all() { return [this, ...this.children.flatMap(c => c instanceof Element ? c.all() : [])]; }
  matches(selector) { return selector.startsWith('.') ? this.className.split(/\s+/).includes(selector.slice(1)) : this.tag === selector; }
  querySelectorAll(selector) { return this.all().slice(1).filter(e => e.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  async fire(event) { return this.handlers[event]?.({ target: this, currentTarget: this }); }
  click() { return this.fire('click'); }
  getBoundingClientRect() { return { top: (this.parentElement?.children.indexOf(this) || 0) * 82 }; }
  getAnimations() { return this.animations; }
  animate(frames, options) { const animation = { frames, options, cancel() { this.cancelled = true; } }; this.animations.push(animation); return animation; }
}
function setup(reduced = false) {
  const plans = [], interviews = [], requests = [];
  const context = vm.createContext({
    h: (tag, attrs, ...children) => new Element(tag, attrs, children), icon: () => new Element('svg'), jobIcon: () => new Element('svg'),
    matchMedia: () => ({ matches: reduced }),
    api: async url => { requests.push(url); return { description: 'Role description', skills: [{ name: 'Judge results' }], url: 'https://esco.ec.europa.eu' }; },
  });
  vm.runInContext(read('ranking-state.js').replace(/export /g, ''), context);
  vm.runInContext(read('role-ranking.js').replace(/^import .*\n/gm, '').replace(/export /g, ''), context);
  const blocks = read('blocks.js');
  vm.runInContext(blocks.slice(blocks.indexOf('const pct = (x)'), blocks.indexOf('export function sdgBlock(')).replace(/export /g, ''), context);
  const render = matches => context.matchesBlock(matches, { scenario: 'assistive',
    onPlan: m => plans.push(m), onInterview: m => interviews.push(m), onScenario() {} });
  return { context, render, plans, interviews, requests };
}
const role = (soc, fit, score, scenario = 'assistive') => ({ soc, title: `Role ${soc}`, fit, score, scenario, coverage: .5, alignment: .7,
  trend_effect: .1, top_gaps: [`Skill ${scenario}`], recommendation_id: `${scenario}-${soc}`,
  sdgs: [{ goal: 8, short: 'Decent work', color: '#123456', target: '8.2', target_text: 'Productivity' }] });
const initial = () => [role('a', .4, .9), role('b', .95, .8), role('c', .7, .7)];
const next = () => [role('c', .7, .91, 'agentic'), role('a', .4, .85, 'agentic'), role('b', .95, .8, 'agentic'), role('d', .5, .6, 'agentic')];
const rows = root => root.querySelector('.ranking-list').children;

test('renders backend order and native rank scores; does not sort by higher match percentages', () => {
  const s = setup(), root = s.render(initial());
  assert.deepEqual(rows(root).map(r => r.dataset.roleId), ['a', 'b', 'c']);
  assert.equal(rows(root)[0].querySelector('.ranking-rank-value').textContent, '0.900');
  assert.equal(rows(root)[1].querySelector('.ranking-match-value').textContent, '95%');
  assert.ok(rows(root).every(r => r.querySelector('.ranking-details').hidden));
  assert.match(root.textContent, /not a percentage or a score out of 100/);
});

test('moves the same role nodes, reports actual positions, preserves disclosures and compare selections', async () => {
  const s = setup(), root = s.render(initial()), originalRows = [...rows(root)];
  const guide = root.querySelector('.ranking-score-guide'); guide.open = true;
  await originalRows[0].querySelector('.ranking-row-toggle').click();
  const why = originalRows[0].querySelector('.why-score'); why.open = true;
  await originalRows[0].querySelector('.sdg-match-toggle').click();
  const checkbox = originalRows[0].querySelector('input'); checkbox.checked = true; await checkbox.fire('change');
  root.update(next(), { scenario: 'agentic' });
  assert.equal(rows(root)[0], originalRows[2]); assert.equal(rows(root)[1], originalRows[0]);
  assert.equal(rows(root)[0].querySelector('.rank-movement').textContent, '↑ +2');
  assert.equal(rows(root)[1].querySelector('.rank-movement').textContent, '↓ −1');
  assert.equal(rows(root)[3].querySelector('.rank-movement').textContent, 'New');
  assert.match(root.querySelector('.ranking-status').textContent, /3 roles changed positions compared with Assistive AI/);
  assert.equal(originalRows[0].querySelector('.ranking-details').hidden, false);
  assert.equal(originalRows[0].querySelector('.why-score').open, true);
  assert.equal(originalRows[0].querySelector('.sdg-match-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(originalRows[0].querySelector('input').checked, true);
  assert.equal(guide.open, true);
  assert.ok(originalRows[2].animations.some(a => a.options.duration === 420 && a.frames[0].transform !== 'translateY(0px)'));
  const buttons = originalRows[0].querySelectorAll('button');
  await buttons.find(b => b.textContent === 'Plan for this role').click();
  await buttons.find(b => b.textContent === 'Practice interview').click();
  assert.equal(s.plans[0].scenario, 'agentic'); assert.equal(s.interviews[0].recommendation_id, 'agentic-a');
  await rows(root)[0].querySelector('.ranking-row-toggle').click();
  assert.equal(originalRows[0].querySelector('.ranking-details').hidden, true);
  const pickC = rows(root)[0].querySelector('input'); pickC.checked = true; await pickC.fire('change');
  assert.match(root.textContent, /Rank Score/); assert.ok(root.querySelector('.compare-wrap'));
  await Promise.resolve();
  assert.equal(s.requests.filter(url => url === '/api/occupations/a').length, 1);
});

test('unchanged ranks show zero movement, ties retain API order, and reduced motion skips animations', () => {
  const s = setup(true), root = s.render(initial());
  const tied = [role('c', .2, .9), role('b', .9, .9), role('a', .5, .9)];
  root.update(tied, { scenario: 'agentic' });
  assert.deepEqual(rows(root).map(r => r.dataset.roleId), ['c', 'b', 'a']);
  assert.equal(rows(root)[1].querySelector('.rank-movement').textContent, '— 0');
  assert.ok(rows(root).every(r => r.animations.length === 0));
});

test('failed loads preserve the last valid rows and allow retry; empty results recover', () => {
  const s = setup(), root = s.render(initial()), first = rows(root)[0];
  root.setPending('agentic'); root.setError('Could not connect');
  assert.equal(rows(root)[0], first); assert.match(root.querySelector('.ranking-error').textContent, /Could not connectRetry/);
  assert.match(root.querySelector('.ranking-status').textContent, /last valid Assistive AI/);
  root.update([], { scenario: 'agentic' });
  assert.equal(root.querySelectorAll('.ranking-empty').length, 1);
  root.update(initial(), { scenario: 'assistive' });
  assert.equal(root.querySelectorAll('.ranking-empty').length, 0); assert.equal(rows(root).length, 3);
});

test('cache reuses loaded and in-flight results, expires, invalidates edited inputs and retries failures', async () => {
  const s = setup(); let clock = 0, calls = 0, resolve;
  const cache = s.context.createScenarioCache({ ttl: 20, now: () => clock });
  cache.seed('profile', 'assistive', initial());
  assert.equal((await cache.get('profile', 'assistive', () => { throw Error('unnecessary'); })).length, 3);
  const load = () => { calls++; return new Promise(r => { resolve = r; }); };
  const a = cache.get('profile', 'agentic', load), b = cache.get('profile', 'agentic', load);
  assert.equal(calls, 1); resolve(next()); await Promise.all([a, b]);
  await cache.get('profile', 'agentic', () => { throw Error('unnecessary'); });
  clock = 21;
  await cache.get('profile', 'agentic', () => { calls++; return next(); });
  await cache.get('edited profile', 'agentic', () => { calls++; return next(); });
  assert.equal(calls, 3);
  await assert.rejects(cache.get('failed', 'agentic', () => Promise.reject(Error('offline'))), /offline/);
  assert.equal(await cache.get('failed', 'agentic', () => 'recovered'), 'recovered');
});

test('Quick Match switches both ways in place, caches the original result and ignores late responses', async () => {
  const s = setup(), stage = new Element('div'), pending = [];
  Object.assign(s.context, { stage, st: { answers: { question: 2 }, fields: new Set(), zone: null, scenario: 'assistive' },
    ctx: { planFor() {} }, owl: { set() {} }, reveal: node => node, RISE: [],
    api: (url, request) => new Promise((resolve, reject) => pending.push({ url, request, resolve, reject })),
    lastQuickMatch: null,
  });
  const explore = read('explore.js');
  vm.runInContext(explore.slice(explore.indexOf('  function showResults(result)'), explore.indexOf('  async function finish()')), s.context);
  s.context.showResults({ matches: initial(), skills: [{ name: 'Python', level: 2 }], scenario: 'assistive' });
  const ranking = stage.querySelector('.ranking-block'), guide = ranking.querySelector('.ranking-score-guide');
  guide.open = true;
  const scenarioButtons = ranking.querySelectorAll('button').filter(b => b.dataset.scenario);
  scenarioButtons.find(b => b.dataset.scenario === 'agentic').click();
  assert.equal(pending.length, 1); assert.equal(pending[0].request.body.scenario, 'agentic');
  scenarioButtons.find(b => b.dataset.scenario === 'assistive').click();
  await new Promise(resolve => setImmediate(resolve));
  pending[0].resolve({ matches: next(), skills: [{ name: 'Python', level: 2 }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stage.querySelector('.ranking-block'), ranking);
  assert.equal(guide.open, true); assert.equal(s.context.lastQuickMatch.scenario, 'assistive');
  assert.deepEqual(rows(ranking).map(r => r.dataset.roleId), ['a', 'b', 'c']);
  scenarioButtons.find(b => b.dataset.scenario === 'agentic').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 1); assert.equal(s.context.lastQuickMatch.scenario, 'agentic');
  assert.deepEqual(rows(ranking).map(r => r.dataset.roleId), ['c', 'a', 'b', 'd']);
});
