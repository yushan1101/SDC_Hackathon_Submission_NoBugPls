const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/web/js/public.js'), 'utf8');
const startDate = source.slice(source.indexOf('function planStartDate('), source.indexOf('/** The plan report as a PDF file'));
const detail = startDate + source.slice(source.indexOf('async function planDetail('), source.indexOf('\nboot().catch'));

async function render(startedUtc) {
  let roadmapStart;
  const response = {
    plan_id: 'old-plan', status: 'draft', version: 1, created_utc: '2026-10-20T10:00:00Z',
    plan: { activities: [], target_role: 'Software developer' }, progress: [], history: [],
  };
  if (startedUtc !== undefined) response.started_utc = startedUtc;
  const h = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter((child) => child != null),
    focus() {}, scrollIntoView() {}, setAttribute(name, value) { this.attrs[name] = value; } });
  const main = { dataset: {}, replaceChildren(...children) { this.children = children; } };
  const context = vm.createContext({
    h, api: async () => response, icon: () => null, toast() {}, setSources() {},
    planBlock: ({ startDate }) => { roadmapStart = startDate; return h('roadmap'); },
    hoursControl: () => null, historyBlock: () => null, lastChanges: null, planSection: 'plan',
  });
  vm.runInContext(detail, context);
  await context.planDetail(main, 'old-plan');
  const visit = (node) => [node, ...(node?.children || []).flatMap(visit)];
  const input = main.children.flatMap(visit).find((node) => node?.tag === 'input' && node.attrs.class === 'input plan-start');
  return { input, roadmapStart };
}

test('saved plan opens when an older API response lacks a start date', async () => {
  const page = await render(undefined);
  assert.equal(page.input.attrs.value, '2026-10-20');
  assert.equal(page.roadmapStart, '2026-10-20T10:00:00Z');
});

test('saved plan keeps an explicitly chosen start date', async () => {
  const page = await render('2026-10-25T00:00:00Z');
  assert.equal(page.input.attrs.value, '2026-10-25');
  assert.equal(page.roadmapStart, '2026-10-25T00:00:00Z');
});
