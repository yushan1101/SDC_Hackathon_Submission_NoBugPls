// Focused interaction checks for the report renderer without a browser dependency.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag; this.attrs = {}; this.children = []; this.handlers = {};
    this.className = ''; this.hidden = false; this.disabled = false; this.open = false; this.tabIndex = 0;
    this._text = '';
    this.style = { setProperty: (key, value) => { this.style[key] = value; } };
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === 'class') this.className = value;
      else if (key === 'style') for (const [name, item] of Object.entries(value)) this.style.setProperty(name, item);
      else if (key.startsWith('on')) this.addEventListener(key.slice(2), value);
      else if (key === 'hidden') this.hidden = Boolean(value);
      else if (key === 'disabled') this.disabled = Boolean(value);
      else if (key === 'tabindex') this.tabIndex = Number(value);
      else this.attrs[key] = String(value);
    }
    for (const child of children.flat(Infinity)) if (child != null && child !== false) this.append(child);
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = []; this._text = ''; this.append(...children); }
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
  async fire(type) { for (const handler of this.handlers[type] || []) await handler({ currentTarget: this, target: this, preventDefault() {} }); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  removeAttribute(key) { delete this.attrs[key]; }
  getAttribute(key) { return this.attrs[key] ?? null; }
  get firstElementChild() { return this.children.find((child) => child instanceof Element) || null; }
  get textContent() { return this._text + this.children.map((child) => child instanceof Element ? child.textContent : String(child)).join(''); }
  set textContent(value) { this.children = []; this._text = String(value); }
  focus() { globalThis.__reportDocument.activeElement = this; }
  scrollIntoView() {}
  matches(selector) {
    const tag = selector.match(/^[a-z]+/i)?.[0];
    if (tag && this.tag !== tag.toLowerCase()) return false;
    for (const cls of [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1])) if (!this.className.split(/\s+/).includes(cls)) return false;
    for (const [, key, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      if (key === 'open') { if (!this.open) return false; }
      else if (key === 'hidden') { if (!this.hidden) return false; }
      else if (!(key in this.attrs) || (value != null && this.attrs[key] !== value)) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => { for (const child of node.children) if (child instanceof Element) {
      if (child.matches(selector)) found.push(child); visit(child);
    } };
    visit(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

const findText = (root, text) => [root, ...root.querySelectorAll('*')].find((node) => node.textContent === text);
const source = fs.readFileSync(path.join(__dirname, '../src/web/js/interview.js'), 'utf8');
const renderer = source.slice(source.indexOf('function reportDisclosure('), source.indexOf('function renderEnded('));
const LABELS = { knowledge: 'Job-relevant knowledge', relevance: 'Answer relevance & completeness',
  problem_solving: 'Problem-solving & reasoning', communication: 'Communication & clarity', practical_evidence: 'Practical examples & evidence' };
const TYPES = { behavioral: 'HR / behavioral', technical: 'Technical' };
const pct = (value) => `${Math.max(0, Math.min(100, Math.round(Number(value) || 0)))}%`;

function setup() {
  const requests = [], callbacks = [];
  const history = [
    { interview_id: 'current', role_id: 'role-1', role_title: 'Data Entry Supervisor', status: 'completed', created_utc: '2026-10-22T10:00:00Z', difficulty: 'intermediate', performance: 32, readiness: 21, competitiveness: 36 },
    { interview_id: 'previous', role_id: 'role-1', role_title: 'Data Entry Supervisor', status: 'completed', created_utc: '2026-10-01T10:00:00Z', difficulty: 'foundational', performance: 28, readiness: 19, competitiveness: 31 },
  ];
  const context = vm.createContext({
    h: (tag, attrs, ...children) => new Element(tag, attrs, children),
    icon: () => new Element('svg'),
    api: async (url) => { requests.push(url); return url === '/api/interviews' ? { interviews: history } : []; },
    fmtTime: (value) => value || 'Date not saved', LABELS, TYPES, pct,
    requestAnimationFrame: (callback) => callback(),
    document: { activeElement: null },
    location: { hash: '' },
  });
  context.globalThis = context;
  vm.runInContext(renderer, context);
  globalThis.__reportDocument = context.document;
  const main = new Element('main');
  const report = {
    interview_id: 'current', role_id: 'role-1', role_title: 'Data Entry Supervisor', completed_utc: '2026-10-22T10:00:00Z',
    difficulty: 'intermediate', performance: 32, readiness: 21, competitiveness: 36, profile_coverage: 40, demonstrated_fit: 34,
    evidence_coverage: 72, assessment_source: 'questionnaire',
    dimensions: { knowledge: { score: 31, weight: 30, evidence_count: 2, reason: 'Role knowledge feedback' } },
    competencies: [
      { name: 'Data entry', interview_score: 100, profile_level: 5, required_level: 4, reason: 'Accurate entry examples.', evidence: ['I checked each record before saving.'] },
      { name: 'Documentation', interview_score: 17, profile_level: 1, required_level: 4, reason: 'Process details were incomplete.', evidence: ['I updated the records.'] },
      { name: 'Confidentiality', interview_score: null, profile_level: null, required_level: 3, evidence: [] },
    ],
    strengths: [{ name: 'Data entry', interview_score: 100, reason: 'Careful record checking.' }],
    gaps: [{ name: 'Documentation', interview_score: 17, reason: 'Explain how records are checked.' }],
    recommendations: [{ skill: 'Documentation', reason: 'Describe the review process.', priority: 'high', exercise: 'Walk through a sample record.', resources: [] }],
    question_feedback: [
      { stage: 'behavioral', question: 'Tell me how you ensure accurate data entry.', answer: 'I checked each record before saving.', target_skills: ['Data entry'], evaluation: { scores: { knowledge: 3 }, rationale: { knowledge: 'Clear example.' }, demonstrated_skills: [{ name: 'Data entry', evidence: 'I checked each record.' }] }, suggested_improved_answer: 'I use a checklist and verify the saved record.' },
      { stage: 'technical', question: 'How do you document corrections?', answer: 'I add a note to the record.', target_skills: ['Documentation'], evaluation: { scores: { communication: 2 }, rationale: { communication: 'Add a clear audit trail.' } } },
    ],
    source: { title: 'Role source', url: 'https://example.test/role', publisher: 'Example', access_date: '2026-10-22' },
    disclaimer: 'Coaching assessment only.', role_title: 'Data Entry Supervisor', role_id: 'role-1', profile: [{ name: 'Data entry', level: 5 }],
  };
  return { context, main, report, requests, callbacks };
}

test('report uses four tabs, shows answers one at a time, and opens rubric/evidence from shortcuts', async () => {
  const { context, main, report } = setup();
  await context.renderReport(main, report, {});
  const root = main.firstElementChild;
  assert.deepEqual(root.querySelectorAll('[role="tab"]').map((tab) => tab.textContent), ['Overview', 'Skills', 'Answers', 'Details']);
  assert.equal(root.querySelector('[data-tab="overview"]').getAttribute('aria-selected'), 'true');
  assert.equal(root.querySelector('[data-tab="improve"]'), null);
  assert.ok(findText(root, 'Interview Performance') || root.querySelector('[aria-label="Interview performance 32%"]'));

  await findText(root, 'Understand My Scores →').fire('click');
  assert.equal(root.querySelector('[data-tab="details"]').getAttribute('aria-selected'), 'true');
  assert.equal(root.querySelector('.interview-disclosure[data-section="rubric"]').open, true);

  await root.querySelector('[data-tab="skills"]').fire('click');
  const skillRows = root.querySelectorAll('.ir-skill-card');
  assert.equal(skillRows.length, 2);
  assert.equal(skillRows.some((row) => row.open), false);
  assert.match(root.querySelector('.ir-unassessed').textContent, /Not Assessed/);
  await skillRows[0].fire('toggle'); skillRows[0].open = true; await skillRows[0].fire('toggle');
  assert.equal(skillRows.filter((row) => row.open).length, 1);
  await findText(root, 'View interview evidence').fire('click');
  assert.equal(root.querySelector('[data-tab="details"]').getAttribute('aria-selected'), 'true');
  assert.equal(root.querySelector('.interview-disclosure[data-section="competencies"]').open, true);
  assert.equal(root.querySelector('[id="ir-competency-evidence-0"]').open, true);

  await root.querySelector('[data-tab="answers"]').fire('click');
  assert.equal(findText(root, 'Question 1 of 2') != null, true);
  await findText(root, 'Next Question →').fire('click');
  assert.equal(findText(root, 'Question 2 of 2') != null, true);
  assert.equal(findText(root, 'Next Question →').disabled, true);
});

test('learning plan is optional and keeps the existing role callback', async () => {
  const { context, main, report, callbacks } = setup();
  await context.renderReport(main, report, { onPlan: (...args) => callbacks.push(args) });
  assert.equal(callbacks.length, 0);
  await findText(main, 'Plan for This Role').fire('click');
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0][0].role_id, 'role-1');
  assert.match(callbacks[0][2], /Documentation/);
  assert.equal(context.location.hash, '');
});

test('missing assessment values remain unavailable instead of becoming zero scores', async () => {
  const { context, main, report } = setup();
  report.performance = null; report.readiness = null; report.competitiveness = null;
  report.profile_coverage = null; report.demonstrated_fit = null; report.dimensions = {};
  report.competencies = [{ name: 'Confidentiality', interview_score: null, profile_level: null, required_level: 3, evidence: [] }];
  report.strengths = []; report.gaps = []; report.recommendations = []; report.question_feedback = [];
  await context.renderReport(main, report, {});
  const root = main.firstElementChild;
  assert.match(root.textContent, /Not available/);
  assert.match(root.textContent, /Not Assessed/);
  assert.doesNotMatch(root.querySelector('.ir-unassessed').textContent, /0%/);
  assert.equal(findText(root, 'No saved answers') != null, true);
  assert.equal(root.querySelectorAll('.interview-disclosure').every((section) => !section.open), true);
});

