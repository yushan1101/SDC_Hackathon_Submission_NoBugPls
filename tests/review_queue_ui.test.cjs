// Exercise the production dialog handlers without adding a browser runtime dependency.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/web/js/enterprise.js'), 'utf8');
const handlers = source.slice(source.indexOf('function reviewBadge('), source.indexOf('async function loadDetail('));

class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag; this.attrs = attrs; this.children = children.flat(Infinity).filter(Boolean);
    this.handlers = {}; this.disabled = !!attrs.disabled; this.value = attrs.value || '';
    if (tag === 'textarea') this.value = this.children.join('');
    if (tag === 'select') this.value = (this.children.find((c) => c.attrs.selected) || this.children[0]).value;
    for (const [key, handler] of Object.entries(attrs)) if (key.startsWith('on')) this.addEventListener(key.slice(2), handler);
  }
  append(...children) { this.children.push(...children); }
  addEventListener(event, handler) { (this.handlers[event] ||= []).push(handler); }
  async fire(event) { for (const handler of this.handlers[event] || []) await handler({ target: this, preventDefault() {}, stopPropagation() {} }); }
  showModal() { this.open = true; }
  close() { this.open = false; return this.fire('close'); }
  remove() { this.removed = true; }
}

function find(root, predicate) {
  if (root instanceof Element) {
    if (predicate(root)) return root;
    for (const child of root.children) { const found = find(child, predicate); if (found) return found; }
  }
}

function harness(fail = false) {
  const requests = [], notifications = [];
  const context = vm.createContext({ h: (tag, attrs, ...kids) => new Element(tag, attrs, kids),
    api: async (url, options) => { requests.push({ url, ...options }); if (fail) throw Error('Save failed'); return { count: 2 }; },
    toast: (...args) => notifications.push(args) });
  vm.runInContext(handlers, context);
  return { context, requests, notifications, main: new Element('main') };
}

test('bulk delete waits for confirmation, then sends the selected IDs and refreshes', async () => {
  const h = harness(); let refreshed = false;
  h.context.reviewAction(h.main, ['a', 'b'], 'delete', () => { refreshed = true; });
  assert.equal(h.requests.length, 0);
  const dialog = h.main.children[0]; assert.equal(dialog.open, true);
  await find(dialog, (e) => e.tag === 'form').fire('submit');
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests)), [{ url: '/api/reviews/bulk', method: 'POST', body: { plan_ids: ['a', 'b'], action: 'delete', confirmed: true } }]);
  assert.equal(refreshed, true); assert.equal(dialog.removed, true);
});

test('cancel does not mutate reviews and a failed bulk action leaves the dialog retryable', async () => {
  const h = harness(true);
  h.context.reviewAction(h.main, ['a'], 'archive', () => assert.fail('must not refresh'));
  const dialog = h.main.children[0];
  await find(dialog, (e) => e.tag === 'form').fire('submit');
  assert.equal(dialog.open, true);
  assert.equal(find(dialog, (e) => e.attrs.type === 'submit').disabled, false);
  assert.equal(h.notifications[0][0], 'Save failed');
  assert.equal(h.notifications[0][1], 'err');
  await find(dialog, (e) => e.tag === 'button' && e.children.includes('Cancel')).fire('click');
  assert.equal(h.requests.length, 1); assert.equal(dialog.removed, true);
});

test('candidate edits send review fields and revision without any AI analysis', async () => {
  const h = harness(); let refreshed = false;
  h.context.editReview(h.main, 'a', { candidate_name: 'Before', candidate_email: '', candidate_phone: '', reviewer_notes: 'Old', review_status: 'pending', revision: 3 }, () => { refreshed = true; });
  const dialog = h.main.children[0];
  find(dialog, (e) => e.attrs.type === 'text').value = ' Updated candidate ';
  find(dialog, (e) => e.tag === 'textarea').value = 'HR assessment';
  find(dialog, (e) => e.tag === 'select').value = 'rejected';
  await find(dialog, (e) => e.tag === 'form').fire('submit');
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0])), { url: '/api/reviews/a/edit', method: 'POST', body: {
    candidate_name: 'Updated candidate', candidate_email: '', candidate_phone: '', reviewer_notes: 'HR assessment', review_status: 'rejected', revision: 3 } });
  assert.equal(refreshed, true); assert.equal(dialog.removed, true);
});

test('register status selection waits for confirmation and cancel keeps the original status', async () => {
  const h = harness();
  const select = h.context.planStatusControl(h.main, { plan_id: 'a', subject_id: 'E1', status: 'draft', version: 1 }, () => assert.fail('cancel must not refresh'));
  select.value = 'approved';
  await select.fire('change');
  assert.equal(select.value, 'draft');
  assert.equal(h.requests.length, 0);
  const dialog = h.main.children[0];
  assert.equal(dialog.open, true);
  await find(dialog, (e) => e.tag === 'button' && e.children.includes('Cancel')).fire('click');
  assert.equal(h.requests.length, 0); assert.equal(dialog.removed, true);
});

test('confirmed register change sends the expected version and refreshes the table', async () => {
  const h = harness(); let refreshed = false;
  h.context.confirmPlanStatus(h.main, { plan_id: 'a', subject_id: 'E1', status: 'draft', version: 3 }, 'approved', () => { refreshed = true; });
  const dialog = h.main.children[0];
  await find(dialog, (e) => e.tag === 'form').fire('submit');
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0])), { url: '/api/plans/a/status', method: 'POST', body: { status: 'approved', version: 3, confirmed: true } });
  assert.equal(refreshed, true); assert.equal(dialog.removed, true);
});

test('failed register status change leaves confirmation open and shows an error', async () => {
  const h = harness(true);
  h.context.confirmPlanStatus(h.main, { plan_id: 'a', subject_id: 'E1', status: 'approved', version: 2 }, 'draft', () => assert.fail('must not refresh'));
  const dialog = h.main.children[0];
  await find(dialog, (e) => e.tag === 'form').fire('submit');
  assert.equal(dialog.open, true);
  assert.equal(find(dialog, (e) => e.attrs.type === 'submit').disabled, false);
  assert.deepEqual(h.notifications[0], ['Save failed', 'err']);
});
