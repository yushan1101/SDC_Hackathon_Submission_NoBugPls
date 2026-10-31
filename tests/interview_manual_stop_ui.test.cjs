const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/web/js/interview.js'), 'utf8');
const renderer = source.slice(source.indexOf('function renderRoom('), source.indexOf('function showEvaluation('));

class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag; this.children = []; this.handlers = {}; this.attributes = {};
    this.className = attrs.class || ''; this.dataset = { ...attrs.dataset }; this.hidden = Boolean(attrs.hidden);
    this.disabled = Boolean(attrs.disabled); this.value = ''; this._text = '';
    this.style = { setProperty(key, value) { this[key] = value; } };
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/), ...names])].filter(Boolean).join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(' '); },
      toggle: (name, force) => {
        const enabled = force ?? !this.classList.contains(name);
        this.classList[enabled ? 'add' : 'remove'](name); return enabled;
      },
    };
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('on')) this.addEventListener(key.slice(2), value);
      else if (!['class', 'dataset', 'hidden', 'disabled'].includes(key)) this.setAttribute(key, value);
    }
    this.append(...children.flat(Infinity));
  }
  append(...children) { this.children.push(...children.filter((child) => child != null)); }
  replaceChildren(...children) { this.children = []; this._text = ''; this.append(...children); }
  addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
  async fire(type) { for (const handler of this.handlers[type] || []) await handler({ currentTarget: this, preventDefault() {} }); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  get textContent() { return this._text + this.children.map((child) => child instanceof Element ? child.textContent : String(child)).join(''); }
  set textContent(value) { this.children = []; this._text = String(value); }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => { for (const child of node.children) if (child instanceof Element) {
      if (child.tag === selector || selector === '*') found.push(child);
      visit(child);
    } };
    visit(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { this.focused = true; }
}

async function setup({ answers = [] } = {}) {
  const voices = [], avatarStates = [], requests = [];
  const body = new Element('body'); body.style.overflow = '';
  const window = { AP_CONFIG: { VIRTUAL_INTERVIEW_3D: false },
    addEventListener() {}, dispatchEvent(event) { avatarStates.push(event.detail); } };
  const context = vm.createContext({
    window, navigator: {}, document: { body, addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: () => 'false', setItem() {} },
    h: (tag, attrs, ...children) => new Element(tag, attrs, children), icon: () => new Element('svg'),
    speak: (text, { onStart } = {}) => {
      let finish;
      const done = new Promise((resolve) => { finish = resolve; });
      const voice = { text, onStart, done, stops: 0, stop() { this.stops++; finish(); }, end() { finish(); },
        level: () => 0.5, bands: () => ({ low: 0.2, high: 0.2 }) };
      voices.push(voice); return voice;
    },
    preloadSpeech() {}, toWav() {}, showEvaluation() {}, api: async (url, options) => {
      requests.push({ url, options });
      return url.endsWith('/answer') ? answers.shift() : {};
    }, upload: async () => ({}), toast() {},
    performance: { now: () => 1 }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    location: { hash: '#/interview/session-1' }, setTimeout: () => 1, clearTimeout() {},
    setInterval: () => 1, clearInterval() {}, queueMicrotask, Blob, FormData,
    TYPES: { behavioral: 'HR / behavioral' }, HOLOGRAM: () => false,
  });
  vm.runInContext(`${renderer}\nglobalThis.renderRoom = renderRoom;`, context);
  const main = new Element('main');
  const question = 'Tell me how you solved a complex workplace problem, and what you learned afterward?';
  context.renderRoom(main, { interview_id: 'session-1', role_title: 'Analyst', stage_index: 0,
    question: { question_id: 'q1', type: 'behavioral', text: question } });
  await Promise.resolve();
  return { main, question, voices, avatarStates, requests };
}

test('manual stop keeps the question and immediately enables answering', async () => {
  const { main, question, voices, avatarStates } = await setup();
  assert.equal(voices.length, 1);
  const stop = main.querySelectorAll('button').find((button) => button.textContent.includes('Stop AI Voice & Start Answering'));
  const start = main.querySelectorAll('button').find((button) => button.getAttribute('aria-label') === 'Start answering');
  const text = main.querySelector('textarea');
  const questionText = main.querySelectorAll('p').find((node) => node.classList.contains('interview-question'));
  const questionOverlay = main.querySelectorAll('aside').find((node) => node.classList.contains('interview-question-overlay'));
  const status = main.querySelectorAll('span').find((node) => node.classList.contains('interview-status'));
  assert.equal(stop.hidden, false);
  assert.equal(start.disabled, true);
  assert.equal(questionOverlay.classList.contains('is-open'), true);
  voices[0].onStart();
  assert.equal(avatarStates.at(-1).state, 'speaking');

  await stop.fire('click');
  assert.equal(voices[0].stops, 1);
  assert.equal(stop.hidden, true);
  assert.equal(start.disabled, false);
  assert.equal(text.disabled, false);
  assert.equal(questionText.textContent, question);
  assert.equal(questionOverlay.classList.contains('is-open'), true);
  assert.equal(status.textContent, 'Your Turn — You Can Answer Now');
  assert.equal(avatarStates.at(-1).state, 'listening');
  assert.equal(avatarStates.at(-1).speechLevel, 0);

  await stop.fire('click');
  await voices[0].done;
  await Promise.resolve();
  assert.equal(voices[0].stops, 1);
  assert.equal(status.textContent, 'Your Turn — You Can Answer Now');
});

test('replay after interruption and natural completion restore the ordinary answer state', async () => {
  const { main, voices, avatarStates } = await setup();
  const buttons = main.querySelectorAll('button');
  const stop = buttons.find((button) => button.textContent.includes('Stop AI Voice & Start Answering'));
  const replay = buttons.find((button) => button.getAttribute('aria-label') === 'Replay question');
  const start = buttons.find((button) => button.getAttribute('aria-label') === 'Start answering');
  const status = main.querySelectorAll('span').find((node) => node.classList.contains('interview-status'));
  await stop.fire('click');
  await replay.fire('click');
  await Promise.resolve();
  assert.equal(voices.length, 2);
  assert.equal(stop.hidden, false);
  assert.equal(start.disabled, true);
  voices[1].onStart();
  voices[1].end();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(stop.hidden, true);
  assert.equal(start.disabled, false);
  assert.equal(avatarStates.at(-1).state, 'listening');
  assert.equal(status.textContent, 'Ready to answer · microphone off');
});

test('AI clarification replaces the old visible prompt, then the next question replaces it', async () => {
  const clarification = 'By teamwork, I mean how you coordinated with colleagues. What did you do?';
  const nextQuestion = 'What would you improve in that process next time?';
  const { main, voices, requests } = await setup({ answers: [
    { reply: clarification },
    { status: 'in_progress', stage_index: 1, question: { question_id: 'q2', type: 'behavioral', text: nextQuestion } },
  ] });
  const stop = main.querySelectorAll('button').find((button) => button.textContent.includes('Stop AI Voice & Start Answering'));
  const form = main.querySelector('form');
  const text = main.querySelector('textarea');
  const prompt = main.querySelectorAll('p').find((node) => node.classList.contains('interview-question'));
  const extraPrompt = main.querySelectorAll('p').find((node) => node.classList.contains('interview-mina-line'));
  await stop.fire('click');

  text.value = 'Could you clarify?';
  const firstSubmission = form.fire('submit');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prompt.textContent, clarification);
  assert.equal(extraPrompt.hidden, true);
  assert.equal(voices[1].text, clarification);
  assert.equal(requests[0].options.body.question_id, 'q1');
  await stop.fire('click');
  await firstSubmission;

  text.value = 'I coordinated tasks and checked each result.';
  await form.fire('submit');
  await Promise.resolve();
  assert.equal(prompt.textContent, nextQuestion);
  assert.equal(extraPrompt.hidden, true);
  assert.equal(voices[2].text, nextQuestion);
  assert.equal(requests[1].options.body.question_id, 'q1');
});
