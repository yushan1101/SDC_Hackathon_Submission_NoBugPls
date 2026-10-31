// The plan page's roadmap: weeks hold several steps (no Learn/Practice/Quiz chips on the map), and each step's lesson card holds all three as tabs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/web/js/blocks.js'), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
const code = [
  'const PHASES = ["1-30", "31-60", "61-90"];',
  slice('export const SDG_COLORS', 'const ARROW ='),
  slice('function planActivitySteps(', '// --- plan diagrams'),
  slice('function safeUrl(', 'const SEV ='),
].join('\n').replace(/export (function|const|class) /g, '$1 ');

function el(tag, attrs = {}, ...children) {
  const node = {
    tag, attrs, children: children.flat(Infinity).filter((c) => c != null && c !== false), hidden: attrs.hidden, textContent: '',
    get firstChild() { return this.children[0]; },
    replaceChildren(...kids) { this.children = kids.flat(Infinity).filter((c) => c != null && c !== false); },
    setAttribute(name, value) { this.attrs[name] = value; }, querySelector() { return null; }, closest() { return null; },
    showPopover() {}, hidePopover() {}, focus() {}, scrollIntoView() {}, classList: { toggle() {} },
  };
  return node;
}
const walk = (node) => (node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(walk)] : []);
const cls = (node) => String(node.attrs?.class || '').split(/\s+/);
const text = (node) => walk(node).flatMap((n) => n.children.filter((c) => typeof c === 'string' || typeof c === 'number')).join(' ');

function lesson(week, slot, overrides = {}) {
  const id = `week-${String(week).padStart(2, '0')}${slot ? `-${String(slot + 1).padStart(2, '0')}` : ''}`;
  return { id, week_number: week, content_source: 'guided_fallback', title: `Step ${id}`, type: week <= 2 ? 'learn' : 'practice', skills: ['SQL'],
    activity_keys: [], estimated_minutes: 40, learn_minutes: 14, practice_minutes: 20, quiz_minutes: 6, learning_objective: `Objective for ${id}`,
    topics: [`Topic ${id}`], learn: [`Explanation for ${id}`], instructions: ['First do this.', 'Then do that.'], resource_ids: [],
    exercise: `Exercise for ${id}`, deliverable: `Deliverable for ${id}`,
    quiz: { question: `Question for ${id}?`, options: ['Right', 'Wrong'], answer_index: 0, explanation: 'Because.' },
    completion_criteria: ['Saved the deliverable.'], expected_outcome: `Outcome for ${id}`, ...overrides };
}

function render(nodes, selectedNodeId = null) {
  const context = vm.createContext({
    h: el, icon: () => null, toast() {}, api: async () => ({}), fmtTime: (x) => x, ApiError: class extends Error {},
    reveal: (x) => x, RISE: {}, DROP: {}, GROW: {}, diagramsBlock: () => null, history: { replaceState() {}, state: null }, matchMedia: () => ({ matches: true }),
    requestAnimationFrame: () => 0, setTimeout: () => 0, location: { origin: 'http://localhost' }, URL, Date, Math, Map, Set, JSON,
  });
  vm.runInContext(code, context);
  const plan = { target_role: 'Data analyst', activities: [{ day_range: '1-30', skill_id: 'SQL', activity: 'Practise SQL', estimated_hours: 8, evidence_ids: [] }],
    learning_nodes: nodes };
  return context.planBlock({ planId: 'p1', plan, version: 1, status: 'draft', weeklyHours: 4, startDate: '2026-10-01T00:00:00Z',
    progress: [], evidence: [], selectedNodeId, readOnly: false });
}

test('every roadmap week has its steps on the map, without part chips', () => {
  const nodes = Array.from({ length: 13 }, (_, i) => lesson(i + 1, 0));
  const all = walk(render(nodes));
  const weeks = all.filter((n) => cls(n).includes('road-week'));
  assert.equal(weeks.length, 13);
  for (const week of weeks) {
    const steps = walk(week).filter((n) => cls(n).includes('road-node'));
    assert.ok(steps.length >= 1, `week ${week.attrs['data-week']} has a step`);
    for (const step of steps) assert.equal(walk(step).filter((n) => cls(n).includes('road-part')).length, 0, 'no chips under the node');
  }
});

test('the lesson card holds Learn, Practice and Quiz as tabs, one shown at a time', () => {
  const nodes = Array.from({ length: 13 }, (_, i) => lesson(i + 1, 0));
  const cards = walk(render(nodes, 'week-06')).filter((n) => cls(n).includes('learning-lesson') && !cls(n).includes('learning-lesson-empty'));
  assert.ok(cards.length >= 1);
  const card = cards.find((c) => text(c).includes('Step week-06'));
  assert.ok(card, 'the routed step opens its card');
  const parts = walk(card).filter((n) => cls(n).includes('learning-part')).map((n) => n.attrs['data-part']);
  assert.deepEqual(parts, ['learn', 'practice', 'quiz']);
  const shown = walk(card).filter((n) => cls(n).includes('learning-part') && !n.attrs.hidden).map((n) => n.attrs['data-part']);
  assert.deepEqual(shown, ['learn'], 'only the open tab (Learn by default) is visible');
  const body = text(card);
  for (const expected of ['Explanation for week-06', 'Exercise for week-06', 'Deliverable for week-06', 'Question for week-06?']) assert.ok(body.includes(expected), expected);
  const tabs = walk(card).find((n) => cls(n).includes('learning-lesson-tabs'));
  assert.equal(tabs.children.length, 3);
  assert.match(text(tabs), /Learn · 14 min.*Practice · 20 min.*Quiz · 6 min/);
});

test('a step saved without a quiz still shows its Quiz part', () => {
  const nodes = [lesson(1, 0, { quiz: null, quiz_minutes: 0, practice_minutes: 26 })];
  const card = walk(render(nodes, 'week-01')).find((n) => cls(n).includes('learning-lesson') && !cls(n).includes('learning-lesson-empty'));
  const parts = walk(card).filter((n) => cls(n).includes('learning-part')).map((n) => n.attrs['data-part']);
  assert.deepEqual(parts, ['learn', 'practice', 'quiz']);
});

test('two steps in one week each open a lesson with Learn, Practice and Quiz tabs', () => {
  const nodes = [lesson(1, 0), lesson(1, 1, { skills: ['Dashboards'] })];
  const week1 = walk(render(nodes)).find((n) => cls(n).includes('road-week') && n.attrs['data-week'] === '1');
  const steps = walk(week1).filter((n) => cls(n).includes('road-node'));
  assert.equal(steps.length, 2);
  for (const id of ['week-01', 'week-01-02']) {
    const card = walk(render(nodes, id)).find((n) => cls(n).includes('learning-lesson') && !cls(n).includes('learning-lesson-empty'));
    assert.deepEqual(walk(card).filter((n) => cls(n).includes('learning-part')).map((n) => n.attrs['data-part']), ['learn', 'practice', 'quiz'], id);
  }
});
