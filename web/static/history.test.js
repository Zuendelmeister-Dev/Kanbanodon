const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const history = require('./history.js');

function localTime(year, month, day, hours = 12, minutes = 0, seconds = 0, milliseconds = 0) {
  return new Date(year, month - 1, day, hours, minutes, seconds, milliseconds).toISOString();
}

function item(overrides = {}) {
  return { id: 10, ticketId: 6, ref: '6', title: 'Teach the dinosaur to close tickets', type: 'task', startedAt: '', completedAt: localTime(2026, 10, 9), plannedDueDate: '2026-10-08', source: 'recorded', epicId: 1, epicRef: 'E1', epicTitle: 'The dinosaur training academy', ...overrides };
}

function fakeNode(dataset = {}) {
  let html = '', buttons = null, scroller = null;
  return {
    dataset, value: '', onclick: null, oninput: null, onchange: null,
    scrollTop: 0, scrollLeft: 0,
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; buttons = null; scroller = null; },
    querySelectorAll(selector) {
      if (!buttons) buttons = [...html.matchAll(/data-history-ticket="(\d+)"/g)].map(match => fakeNode({ historyTicket: match[1] }));
      if (selector === '[data-history-ticket]') return buttons;
      if (selector === 'button') return [...buttons, ...(this.more ? [this.more] : [])];
      return [];
    },
    querySelector(selector) {
      if (selector === '.historyScroll') return html.includes('class="historyScroll"') ? scroller || (scroller = fakeNode()) : null;
      if (selector === '[data-history-more]') {
        this.more = html.includes('data-history-more') ? this.more || fakeNode() : null;
        return this.more;
      }
      return null;
    },
  };
}

function containerFixture() {
  const controls = ['query', 'epic', 'type', 'from', 'through'].map(key => fakeNode({ historyFilter: key }));
  const metrics = fakeNode(), results = fakeNode(), reset = fakeNode(), retry = fakeNode();
  const container = fakeNode();
  container.querySelectorAll = selector => selector === '[data-history-filter]' ? controls : [];
  container.querySelector = selector => ({ '[data-history-metrics]': metrics, '[data-history-results]': results, '[data-history-reset]': reset, '[data-history-retry]': retry })[selector] || null;
  return { container, metrics, results, reset, retry, controls, field: key => controls.find(control => control.dataset.historyFilter === key) };
}

test('completion is on time throughout its due day and late only after local midnight', () => {
  const onTime = history.completionDelay(item({ completedAt: localTime(2026, 10, 8, 23, 59, 59, 999) }));
  const late = history.completionDelay(item({ completedAt: localTime(2026, 10, 9, 0, 0, 0) }));
  assert.equal(onTime.days, 0);
  assert.equal(onTime.late, false);
  assert.equal(late.days, 1);
  assert.equal(late.late, true);
  assert.equal(late.deadline, new Date(2026, 9, 9).getTime());
});

test('missing or invalid deadlines remain unknown instead of zero-delay claims', () => {
  ['', '2026-02-30', '2026-13-01', '8 October 2026', '2026-10-08T00:00:00Z'].forEach(plannedDueDate => {
    assert.deepEqual(history.completionDelay(item({ plannedDueDate })), { days: null, deadline: null, late: false });
  });
});

test('calendar delay and date filters work across a local daylight-saving transition', () => {
  const file = path.join(__dirname, 'history.js');
  const script = `const h=require(${JSON.stringify(file)}); const raw={id:1,ticketId:1,completedAt:'2026-03-29T22:30:00Z',plannedDueDate:'2026-03-28'}; const delay=h.completionDelay(raw); const entries=h.normalizeItems([raw]); console.log(JSON.stringify({days:delay.days,deadline:delay.deadline,inDay:h.filterItems(entries,{from:'2026-03-30',through:'2026-03-30'}).length}));`;
  const actual = JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, TZ: 'Europe/Berlin' } }));
  assert.deepEqual(actual, { days: 2, deadline: Date.parse('2026-03-28T23:00:00Z'), inDay: 1 });
});

test('normalization ignores invalid completion timestamps and never invents actual starts', () => {
  const raw = item({ plannedStartDate: '2026-09-01', duration: 10 });
  const before = JSON.stringify(raw);
  const entries = history.normalizeItems([raw, item({ id: 11, completedAt: '2026-02-30T12:00:00Z' }), item({ id: 12, completedAt: '' }), item({ id: 13, completedAt: '2026-10-09' }), null]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].started, null);
  assert.equal(entries[0].startedAt, '');
  assert.equal(JSON.stringify(raw), before);
  assert.equal(history.normalizeItems([item({ startedAt: localTime(2026, 10, 10) })])[0].started, null);
});

test('recorded actual dates define work bars while only late deadlines extend the history range', () => {
  const unknown = history.normalizeItems([item({ plannedStartDate: '1999-01-01', duration: 365 })]);
  const unknownLayout = history.timelineLayout(unknown);
  assert.equal(unknownLayout.rows[0].startX, null);
  assert.equal(new Date(unknownLayout.start).getFullYear(), 2026);
  const known = history.normalizeItems([item({ startedAt: localTime(2026, 10, 2), plannedStartDate: '1999-01-01' })]);
  const knownLayout = history.timelineLayout(known);
  assert.ok(knownLayout.rows[0].startX < knownLayout.rows[0].finishX);
  const early = history.normalizeItems([item({ plannedDueDate: '2040-01-01' })]);
  const earlyLayout = history.timelineLayout(early);
  assert.equal(new Date(earlyLayout.end).getFullYear(), 2026);
  assert.equal(earlyLayout.rows[0].dueX, null);
  assert.ok(knownLayout.ticks.length <= 11);
  assert.ok(knownLayout.rows[0].finishX > 32 && knownLayout.rows[0].finishX < 968);
});

test('filters use containing Epic for nested work and include the whole completion end day', () => {
  const entries = history.normalizeItems([
    item({ id: 1, ticketId: 1, ref: 'E1', type: 'epic', title: 'Epic', completedAt: localTime(2026, 10, 9, 23, 59, 59) }),
    item({ id: 2, ticketId: 7, title: 'Nested bug', type: 'bug', completedAt: localTime(2026, 10, 9, 0), parentId: 5 }),
    item({ id: 3, ticketId: 8, title: 'Another Epic', epicId: 2, epicRef: 'E2', completedAt: localTime(2026, 10, 10, 0) }),
  ]);
  assert.deepEqual(history.filterItems(entries, { epic: '1' }).map(entry => entry.ticketId), [1, 7]);
  assert.deepEqual(history.filterItems(entries, { type: 'bug', query: 'nEsTeD', from: '2026-10-09', through: '2026-10-09' }).map(entry => entry.ticketId), [7]);
  assert.equal(history.filterItems(entries, { through: '2026-10-09' }).length, 2);
  assert.equal(history.filterItems(entries, { query: '#E2' }).length, 1);
});

test('history preserves reopened/recompleted entries and marks archived, imported and demo completions', () => {
  const fixture = containerFixture();
  history.render(fixture.container, { items: [item({ id: 1, completedAt: localTime(2026, 10, 8), archivedAt: '2026-10-09T10:00:00Z' }), item({ id: 2, source: 'import' }), item({ id: 3, ticketId: 9, source: 'demo' })] });
  assert.match(fixture.results.innerHTML, /Completion 2/);
  assert.match(fixture.results.innerHTML, /Archived/);
  assert.match(fixture.results.innerHTML, /Imported/);
  assert.match(fixture.results.innerHTML, /Demo/);
  assert.equal(fixture.results.querySelectorAll('[data-history-ticket]').length, 3);
  assert.match(fixture.metrics.innerHTML, /<strong>3<\/strong><span>Completions/);
});

test('rendering keeps completion markers without fake work bars and adds red bands for delay', () => {
  const fixture = containerFixture();
  history.render(fixture.container, { items: [item({ plannedStartDate: '2026-10-01' })] });
  assert.match(fixture.results.innerHTML, /historyCompletionPoint/);
  assert.match(fixture.results.innerHTML, /Actual start not recorded/);
  assert.match(fixture.results.innerHTML, /historyDelayBar/);
  assert.doesNotMatch(fixture.results.innerHTML, /class="historyActualBar/);
  const known = containerFixture();
  history.render(known.container, { items: [item({ startedAt: localTime(2026, 10, 7), type: 'epic', ref: 'E6' })] });
  assert.match(known.results.innerHTML, /historyActualBar historyEpicBar/);
  assert.match(known.results.innerHTML, /historyEpicEntry/);
});

test('API-controlled titles, references, date values and errors are escaped, without inline styles or handlers', () => {
  const fixture = containerFixture();
  history.render(fixture.container, { items: [item({ title: '<img src=x onerror=alert(1)>', ref: '6" onclick="alert(1)', epicTitle: '</option><script>alert(1)</script>', epicRef: 'E1&', type: '" style="position:fixed', archivedAt: true })] });
  const output = fixture.container.innerHTML + fixture.results.innerHTML;
  assert.doesNotMatch(output, /<img|<script|<\/option><script|\sstyle="|\sonclick="/);
  assert.match(output, /&lt;img/);
  assert.match(output, /&quot;/);
  history.renderError(fixture.container, '<script>error</script>');
  assert.doesNotMatch(fixture.container.innerHTML, /<script/);
  assert.match(fixture.container.innerHTML, /&lt;script&gt;/);
});

test('controller supports local filters, range validation, reset and safe task callbacks after cleanup', () => {
  const fixture = containerFixture();
  const opened = [];
  const cleanup = history.render(fixture.container, { items: [item(), item({ id: 11, ticketId: 7, type: 'bug', title: 'A lost fern' })], onOpenTicket: id => opened.push(id) });
  const first = fixture.results.querySelectorAll('[data-history-ticket]')[0];
  first.onclick();
  assert.deepEqual(opened, [7]);
  fixture.field('type').value = 'bug';
  fixture.field('type').onchange();
  assert.equal(fixture.results.querySelectorAll('[data-history-ticket]').length, 1);
  fixture.field('from').value = '2026-10-10';
  fixture.field('through').value = '2026-10-09';
  fixture.field('through').oninput();
  assert.match(fixture.results.innerHTML, /end date on or after/);
  fixture.reset.onclick();
  assert.equal(fixture.results.querySelectorAll('[data-history-ticket]').length, 2);
  const previousCallback = first.onclick;
  cleanup();
  assert.equal(fixture.field('type').oninput, null);
  assert.equal(fixture.reset.onclick, null);
  previousCallback();
  assert.deepEqual(opened, [7]);
});

test('large histories page newest entries and can show older completions without losing filters', () => {
  const fixture = containerFixture();
  const entries = Array.from({ length: 65 }, (_, index) => item({ id: index + 1, ticketId: index + 1, completedAt: localTime(2026, 10, 9, 12, index) }));
  history.render(fixture.container, { items: entries });
  assert.equal(fixture.results.querySelectorAll('[data-history-ticket]').length, 50);
  assert.match(fixture.results.innerHTML, /Newest 50 of 65/);
  fixture.results.querySelector('.historyScroll').scrollTop = 800;
  fixture.results.querySelector('.historyScroll').scrollLeft = 100;
  fixture.results.querySelector('[data-history-more]').onclick();
  assert.equal(fixture.results.querySelectorAll('[data-history-ticket]').length, 65);
  assert.equal(fixture.results.querySelector('[data-history-more]'), null);
  assert.equal(fixture.results.querySelector('.historyScroll').scrollTop, 800);
  assert.equal(fixture.results.querySelector('.historyScroll').scrollLeft, 100);
});

test('loading, empty and filtered-empty states explain their state without making up dates', () => {
  const fixture = containerFixture();
  history.renderLoading(fixture.container);
  assert.match(fixture.container.innerHTML, /role="status"/);
  history.render(fixture.container, { items: [] });
  assert.match(fixture.results.innerHTML, /No completed work yet/);
  history.render(fixture.container, { items: [item()] });
  fixture.field('query').value = 'no dinosaur called this';
  fixture.field('query').oninput();
  assert.match(fixture.results.innerHTML, /No completions match/);
  let retries = 0;
  history.renderError(fixture.container, 'Unavailable', () => retries++);
  fixture.retry.onclick();
  assert.equal(retries, 1);
});

test('standalone browser export does not need app globals and rows share the same height as their chart', () => {
  const vm = require('node:vm');
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'history.js'), 'utf8'), { window, Intl, Date });
  assert.equal(typeof window.KanbanodonHistory.render, 'function');
  const fixture = containerFixture();
  history.render(fixture.container, { items: [item()] });
  const css = fs.readFileSync(path.join(__dirname, 'history.css'), 'utf8');
  assert.match(css, /\.historyEntry\{height:142px/);
  assert.match(css, /\.historyEntryChart\{min-width:0;height:142px/);
  assert.match(fixture.results.innerHTML, /viewBox="0 0 1000 142"/);
});
