const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function fakeElement() {
  const classes = new Set(['hidden']);
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    options: [],
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, force) => force === undefined ? (classes.has(name) ? !classes.delete(name) : !!classes.add(name)) : (force ? !!classes.add(name) : !classes.delete(name)),
    },
    addEventListener() {},
    querySelectorAll: () => [],
    contains: () => false,
    focus() {},
  };
}

function loadApp() {
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, fakeElement());
      return elements.get(selector);
    },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const storage = new Map();
  const window = { addEventListener() {}, location: { hash: '' } };
  const context = {
    window,
    document,
    location: window.location,
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    fetch: () => new Promise(() => {}),
    confirm: () => true,
    console,
    Date,
    Map,
    Set,
  };
  vm.createContext(context);
  let source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  source = source.replace(/\nload\(\);\s*$/, '\n');
  source += `\nwindow.__appTest = {
    normalizeTicketType, normTicket, ticketRef, ticketLabel, isIdea, workTickets, ideaTickets,
    childTickets, descendantTickets, parentTypeAllowed, parentCandidates, childCount, ticketOrder,
    blockingTicketIds, dependencyTickets, dependentTickets, unfinishedDependencies, ticketDuration, durationLabel,
    boardSwimlaneData, boardCardDepth, overviewGroupedRows, overviewHierarchyDepth, overviewSortValue,
    boardDependencyHtml, workHoverRelatedIds, epicHoverRelatedIds, standaloneHoverRelatedIds, dependencyComponentIds,
    workDependencyEdges, workDependencyArrowGeometry,
    timelineRefParts, timelineDepth, topEpicFor, ganttBase, ganttTask, ganttEpicAggregate,
    timelineHighlight, timelineTaskHighlightClass, timelineHoverRelatedIds, timelineEpicHoverRelatedIds,
    ganttDelayText, ganttEstimateText, ganttSvgLate, ganttSvgEstimate, truncateSvgText, monthLabel, ganttPx,
    ganttCursorAtX, ganttCursorDateLabel, ganttSvgCursor, ganttArrowMidPoints,
    validDate, fmtIsoDate, addDays, addMonths, dayDiff, startOfDay, parseDate, dateFromCreated,
    fmtDate, shortDate, card, avatar, esc, escAttr,
    setState(value) { state = value; },
    setOverviewSort(value) { overviewSort = value; },
    setTimelineHighlightId(value) { timelineHighlightId = value; },
  };`;
  vm.runInContext(source, context);
  return window.__appTest;
}

function stateWithHierarchy() {
  return {
    board: { id: 1, name: 'Board' },
    boards: [{ id: 1, name: 'Board' }],
    columns: [{ id: 1, name: 'Backlog' }, { id: 5, name: 'Done' }],
    labels: [],
    milestones: [{ id: 8, name: 'Launch' }],
    users: [{ id: 3, name: 'Ada', username: 'ada' }],
    comments: [],
    me: { id: 3 },
    tickets: [
      { id: 10, ref: '10', title: 'Epic', body: '', type: 'epic', columnId: 1, parentId: 0, position: 1, duration: 0, labels: [], links: [] },
      { id: 11, ref: '10.1', title: 'Story', body: '', type: 'story', columnId: 1, parentId: 10, position: 2, duration: 2, labels: [], links: [] },
      { id: 12, ref: '10.1.1', title: 'Task', body: '', type: 'task', columnId: 1, parentId: 11, position: 3, duration: 3, labels: [], links: [13] },
      { id: 13, ref: '2', title: 'Dependency', body: '', type: 'task', columnId: 5, parentId: 0, position: 4, duration: 1, dueDate: '2026-01-04', completedAt: '2026-01-03', labels: [], links: [] },
      { id: 14, ref: '14', title: 'Idea', body: '', type: 'idea', columnId: 1, parentId: 0, position: 5, labels: [], links: [] },
    ],
  };
}

test('ticket normalization supports API casing and legacy types', () => {
  const app = loadApp();
  assert.equal(app.normalizeTicketType(' Problem '), 'bug');
  assert.equal(app.normalizeTicketType('unknown'), 'task');
  const ticket = app.normTicket({ ID: 4, BoardID: 2, Title: 'Legacy', Type: 'problem', Points: 5 });
  assert.equal(ticket.id, 4);
  assert.equal(ticket.boardId, 2);
  assert.equal(ticket.type, 'bug');
  assert.equal(ticket.duration, 5);
});

test('hierarchy helpers stay cycle-safe and enforce allowed parent types', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  app.setState(state);
  assert.equal(app.workTickets().length, 4);
  assert.equal(app.ideaTickets().length, 1);
  assert.deepEqual(app.descendantTickets(10).map(ticket => ticket.id), [11, 12]);
  assert.equal(app.parentTypeAllowed('epic', 'story'), true);
  assert.equal(app.parentTypeAllowed('task', 'bug'), false);
  assert.deepEqual(app.parentCandidates('task', 11).map(ticket => ticket.id), [10]);
  assert.equal(app.childCount(10), 1);
  assert.equal(app.topEpicFor(state.tickets[2]).id, 10);
  assert.equal(app.boardCardDepth(state.tickets[2]), 1);

  state.tickets[0].parentId = 12;
  assert.doesNotThrow(() => app.descendantTickets(10));
  assert.equal(app.topEpicFor(state.tickets[2]).id, 10);
});

test('dependency and duration helpers reflect workflow state', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  app.setState(state);
  assert.deepEqual([...app.blockingTicketIds()], [13]);
  assert.equal(app.dependencyTickets(state.tickets[2])[0].id, 13);
  assert.equal(app.dependentTickets(state.tickets[3])[0].id, 12);
  assert.equal(app.unfinishedDependencies(state.tickets[2]).length, 0);
  state.tickets[3].columnId = 1;
  assert.equal(app.unfinishedDependencies(state.tickets[2]).length, 1);
  assert.equal(app.ticketDuration({ duration: -2, points: 8 }), 0);
  assert.equal(app.ticketDuration({ points: 8 }), 8);
  assert.equal(app.durationLabel({ duration: 2 }), '2d');
});

test('board dependency hints and shared hover scopes expose useful context', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  app.setState(state);
  const work = state.tickets.filter(ticket => ticket.type !== 'idea');

  assert.deepEqual([...app.workHoverRelatedIds(work, [12])].sort((a, b) => a - b), [12, 13]);
  assert.deepEqual([...app.epicHoverRelatedIds(work, 10)].sort((a, b) => a - b), [10, 11, 12]);
  assert.deepEqual([...app.standaloneHoverRelatedIds(work)].sort((a, b) => a - b), [0, 13]);
  assert.deepEqual([...app.workDependencyEdges(work, new Set([12, 13])).map(edge => edge.from + '>' + edge.to)], ['13>12']);
  assert.match(app.boardDependencyHtml(state.tickets[2]), /Depends on #2/);
  assert.match(app.boardDependencyHtml(state.tickets[3]), /Enables #10\.1\.1/);
  assert.match(app.card(state.tickets[2]), /data-work-id="12"/);

  state.tickets[3].columnId = 1;
  assert.match(app.boardDependencyHtml(state.tickets[2]), /Waiting for #2/);

  const from = { left: 10, right: 110, top: 10, bottom: 60, width: 100, height: 50, centerX: 60, centerY: 35, anchorX: 70 };
  const to = { left: 220, right: 320, top: 90, bottom: 140, width: 100, height: 50, centerX: 270, centerY: 115, anchorX: 70 };
  assert.match(app.workDependencyArrowGeometry(from, to, 'board').path, /^M 110 35 C /);
  assert.equal(app.workDependencyArrowGeometry(from, to, 'overview').path, 'M 70 35 H 54 V 115 H 80');
});

test('date helpers reject rollover dates and calculate stable local days', () => {
  const app = loadApp();
  assert.equal(app.parseDate('2026-02-29'), null);
  assert.equal(app.parseDate('not-a-date'), null);
  const leapDay = app.parseDate('2028-02-29T15:30:00Z');
  assert.equal(app.fmtIsoDate(leapDay), '2028-02-29');
  assert.equal(app.dayDiff(app.parseDate('2026-03-28'), app.parseDate('2026-03-30')), 2);
  assert.equal(app.fmtIsoDate(app.addDays(app.parseDate('2026-12-31'), 1)), '2027-01-01');
  assert.equal(app.shortDate('2026-06-07T12:00:00Z'), '2026-06-07');
  assert.equal(app.fmtDate(app.parseDate('2026-06-07')), '06.07.');
});

test('timeline scheduling waits for dependencies and builds highlight paths', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  const target = state.tickets[2];
  target.startDate = '2026-01-01';
  target.dueDate = '2026-01-06';
  app.setState(state);
  const task = app.ganttTask(target);
  assert.equal(app.fmtIsoDate(task.start), '2026-01-03');
  assert.equal(app.fmtIsoDate(task.due), '2026-01-06');
  app.setTimelineHighlightId(12);
  const highlight = app.timelineHighlight([task]);
  assert.equal(highlight.ids.has(12), true);
  assert.equal(highlight.ids.has(13), true);
  assert.equal(highlight.direct.has('13>12'), true);
  assert.equal(highlight.ancestors.has(10), true);
  assert.equal(app.timelineTaskHighlightClass(task, highlight), ' selectedPath');
});

test('timeline shows live delay for overdue work and actual delay for late completion', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  app.setState(state);

  const overdue = { ...state.tickets[2], columnId: 1, links: [], duration: 5, startDate: '2000-01-01', dueDate: '2000-01-03' };
  const openTask = app.ganttTask(overdue);
  assert.equal(openTask.actualFinish, null);
  assert.equal(openTask.late, true);
  assert.equal(app.dayDiff(openTask.due, openTask.delayEnd) > 0, true);
  assert.match(app.ganttDelayText(openTask), /days overdue$/);
  assert.match(app.ganttSvgLate(openTask, app.parseDate('1999-12-31'), 10, 0, 10), /class="ganttSvgLate"/);
  assert.equal(openTask.estimateDays, 5);
  assert.equal(app.dayDiff(openTask.estimateStart, openTask.estimateEnd), 5);
  assert.match(app.ganttEstimateText(openTask), /^Best case \+5d to /);
  assert.match(app.ganttSvgEstimate(openTask, app.parseDate('1999-12-31'), 10, 0, 10), /class="ganttSvgEstimate"/);

  const completed = { ...overdue, columnId: 5, completedAt: '2000-01-08' };
  const completedTask = app.ganttTask(completed);
  assert.equal(app.fmtIsoDate(completedTask.delayEnd), '2000-01-08');
  assert.equal(app.ganttDelayText(completedTask), 'Finished 5 days late');
  assert.equal(completedTask.estimateEnd, null);

  const aggregate = app.ganttEpicAggregate(state.tickets[0], [openTask], null);
  assert.equal(app.fmtIsoDate(aggregate.estimateEnd), app.fmtIsoDate(openTask.estimateEnd));
  aggregate.due = app.parseDate('2000-01-04');
  aggregate.overrun = aggregate.overrunEnd > aggregate.due;
  assert.match(app.ganttDelayText(aggregate), /days over target$/);
});

test('timeline hover keeps dependency components visible in either direction', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  app.setState(state);
  const task1 = { ticket: { id: 1 }, deps: [{ id: 2 }] };
  const task2 = { ticket: { id: 2 }, deps: [] };
  const task3 = { ticket: { id: 3 }, deps: [] };
  const tasks = [task1, task2, task3];

  assert.deepEqual([...app.timelineHoverRelatedIds(tasks, [1])].sort(), [1, 2]);
  assert.deepEqual([...app.timelineHoverRelatedIds(tasks, [2])].sort(), [1, 2]);
  assert.deepEqual([...app.timelineHoverRelatedIds(tasks, [1, 2])].sort(), [1, 2]);
  assert.deepEqual([...app.timelineHoverRelatedIds(tasks, [3])], [3]);

  const epicTasks = state.tickets.slice(0, 4).map(ticket => ({ ticket, deps: [] }));
  assert.deepEqual([...app.timelineEpicHoverRelatedIds(epicTasks, 10)].sort((a, b) => a - b), [10, 11, 12]);
});

test('timeline cursor snaps to days and dependency midpoint arrows preserve direction', () => {
  const app = loadApp();
  const rangeStart = app.parseDate('2026-08-01');
  const cursor = app.ganttCursorAtX(152, rangeStart, 31, 10, 400);

  assert.equal(cursor.day, 12);
  assert.equal(cursor.x, 148);
  assert.equal(app.fmtIsoDate(cursor.date), '2026-08-13');
  assert.equal(cursor.label, '13. August');
  const edgeCursor = app.ganttCursorAtX(296, rangeStart, 31, 10, 400, 100, 300);
  assert.equal(edgeCursor.tagX + edgeCursor.tagWidth <= 296, true);
  assert.match(app.ganttSvgCursor(300), /class="ganttSvgCursorLine"/);
  assert.equal(app.ganttArrowMidPoints(20, 10, 50), '20,38 13,24 27,24');
  assert.equal(app.ganttArrowMidPoints(20, 50, 10), '20,22 13,36 27,36');
});

test('sorting, grouping, and labels remain deterministic', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  app.setState(state);
  assert.deepEqual(Array.from(app.timelineRefParts({ ref: 'E10.2.3' })), [10, 2, 3]);
  assert.equal(app.ticketOrder({ id: 2, ref: '10', position: 1 }, { id: 1, ref: '2', position: 1 }) > 0, true);
  assert.equal(app.overviewGroupedRows(state.tickets.slice(0, 3))[0].kind, 'epic');
  assert.equal(app.overviewHierarchyDepth(state.tickets[2], 10), 2);
  app.setOverviewSort({ key: 'duration', dir: 'asc' });
  assert.equal(app.overviewSortValue(state.tickets[2], 'duration'), 3);
  assert.equal(app.truncateSvgText('abcdefgh', 6), 'abc...');
  assert.equal(app.monthLabel(new Date(2027, 0, 1), new Date(2026, 11, 1)), 'January 2027');
});

test('HTML-producing helpers escape user-controlled text', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  state.tickets[2].title = '<b>Task</b>';
  state.tickets[3].title = '<img src=x onerror=alert(1)>';
  state.tickets[3].columnId = 1;
  app.setState(state);
  const markup = app.card(state.tickets[2]);
  assert.equal(markup.includes('<img src=x onerror=alert(1)>'), false);
  assert.equal(markup.includes('&lt;img src=x onerror=alert(1)&gt;'), true);
  assert.equal(markup.includes('&lt;b&gt;Task&lt;/b&gt;'), true);
  assert.equal(app.escAttr('"<&'), '&quot;&lt;&amp;');
  assert.equal(app.avatar('<x').includes('&lt;X'), true);
});
