const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function fakeElement() {
  const classes = new Set(['hidden']);
  let parent;
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    options: [],
    disabled: false,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, force) => force === undefined ? (classes.has(name) ? !classes.delete(name) : !!classes.add(name)) : (force ? !!classes.add(name) : !classes.delete(name)),
    },
    addEventListener() {},
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return this[name] === undefined ? null : String(this[name]); },
    append() {}, before() {}, after() {}, insertAdjacentHTML() {},
    closest() { return this.parentElement; },
    matches(selector) { return selector.split(',').some(part => part.startsWith('.') && classes.has(part.slice(1))); },
    get parentElement() { return parent || (parent = fakeElement()); },
    querySelector: selector => selector === '.comments' ? fakeElement() : null,
    querySelectorAll: () => [],
    contains: () => false,
    focus() {},
  };
}

function loadApp(options = {}) {
  const elements = new Map();
  const navButtons = ['board', 'overview', 'timeline', 'backlog'].map(view => {
    const button = fakeElement();
    button.dataset.view = view;
    return button;
  });
  const document = {
    visibilityState: 'visible',
    createElement: () => fakeElement(),
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, fakeElement());
      return elements.get(selector);
    },
    querySelectorAll(selector) {
      if (selector === '.navButton') return navButtons;
      if (selector === '#board,#overview,#list,#timeline,#admin,#config,#stash') {
        return selector.split(',').map(id => this.querySelector(id));
      }
      return [];
    },
    addEventListener() {},
  };
  const storage = new Map();
  const historyCalls = [];
  const window = {
    addEventListener() {}, location: { hash: '' },
    history: {
      pushState(_state, _title, hash) { historyCalls.push(['push', hash]); window.location.hash = hash; },
      replaceState(_state, _title, hash) { historyCalls.push(['replace', hash]); window.location.hash = hash; },
    },
  };
  if (options.creator) window.KanbanodonDinoCreator = require('./dino-creator.js');
  if (options.hover) window.KanbanodonDependencyHover = options.hover;
  if (options.resizeObserver) window.ResizeObserver = options.resizeObserver;
  const context = {
    window,
    document,
    location: window.location,
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    fetch: options.fetch || (() => new Promise(() => {})),
    confirm: () => true,
    console: options.console || console,
    Date,
    Map,
    Set,
    setTimeout, clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'task-tools.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'route.js'), 'utf8'), context);
  let source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  source = source.replace(/\nload\(\);\s*$/, '\n');
  source += `\nwindow.__appTest = {
    load, resetClientState, renderView, renderBoard, renderOverview, boardBacklogPickerHtml, wireBoardBacklogPicker, backlogRowHtml, overviewTable,
    applyRoute, openBacklogView, jumpToSprint, openTicket, closeDrawer, logout, saveDrawer, deleteTicket,
    addComment, taskDrawerAction, renderComments, renderDependencyOptions, importBoardFile, refreshNotifications,
    renderAdmin,
    GANTT_LEFT_PAD, GANTT_RIGHT_PAD, planningWork, dependencyViewIds, openDependencies, closeDependencies, showOtherTasks, dependencyFocusIds, toggleDependencyFocus, toggleEpic, buildGanttRows, dependencyTimelineRange, wirePlanningActions,
    filteredWork, filteredBacklog, taskChecklist, checklistProgress, checklistRowHTML, canLeaveDrawer,
    setDraft(ticket,snapshot) { resetDrawer(); editing=cloneTicketForEditing(ticket); drawerDraftId=ticket.id; drawerSnapshot=snapshot; },
    captureDraftBaseline() { drawerSnapshot=currentDrawerSnapshot(); },
    getEditing() { return editing; }, getView() { return view; }, getSnapshot() { return drawerSnapshot; },
    setConfirm(callback) { confirm=callback; }, currentDrawerSnapshot,
    getState() { return state; },
    selectBoard(id) { selectedBoardId = id; },
    setPendingTicket(id) { pendingTicketId = id; },
    normalizeTicketType, normTicket, normSprintName, ticketRef, ticketLabel, isIdea, isBacklogTicket, workTickets, backlogTickets, ideaTickets,
    normalizePromotionType, backlogDescendants,
    childTickets, descendantTickets, parentTypeAllowed, parentCandidates, childCount, ticketOrder,
    blockingTicketIds, dependencyTickets, dependentTickets, unfinishedDependencies, ticketDuration, durationLabel,
    boardSwimlaneData, boardCardDepth, overviewGroupedRows, overviewHierarchyDepth, overviewSortValue,
    boardDependencyHtml, dependencyHoverEdges, wireWorkDependencies, wireTimelineDependencies,
    timelineRefParts, timelineDepth, topEpicFor, ganttBase, ganttTask, ganttEpicAggregate,
    renderGantt, ganttTaskLabel, timelineGeometry,
    ganttDelayText, ganttEstimateText, ganttSvg, ganttSvgTask, ganttSvgBarLabel, ganttSvgLate, ganttSvgEstimate, truncateSvgText, monthLabel, ganttPx,
    ganttCursorAtX, ganttCursorDateLabel, ganttSvgCursor, ganttSvgSprintBands, ganttSvgAxis,
    validDate, fmtIsoDate, addDays, addMonths, dayDiff, startOfDay, parseDate, dateFromCreated,
    boardSprintStartValue, boardSprintWeeks, validSprintWeeks, defaultSprintName, customSprintName, sprintRange, sprintByNumber, sprintWindow, sprintForDate, ticketPlannedFinish, ticketSprint,
    calculatedSprints, sprintName, sprintPlannerHtml, sprintPreviewHtml, sprintPreviewCardHtml, sprintStripFirstNumber, pageSprintStrip, shortRange,
    wireSprintPlanner, wireSprintCards, saveSprintName, sprintCadenceDirty, currentSessionGuard,
    wireTimelinePan, timelineScrollForDate, timelineDateAtScrollCenter,
    fmtDate, shortDate, card, avatar, esc, escAttr,
    setState(value) { state = value; },
    setOverviewSort(value) { overviewSort = value; },
    setTimelineEpicFilter(value) { timelineEpicFilter = value; },
  };`;
  vm.runInContext(source, context);
  Object.assign(window.__appTest, { elements, navButtons, historyCalls, document, window });
  return window.__appTest;
}

function stateWithHierarchy() {
  return {
    board: { id: 1, name: 'Board', sprint_start_date: '2026-01-01', sprint_weeks: 2 },
    sprintNames: [],
    boards: [{ id: 1, name: 'Board' }],
    columns: [{ id: 1, name: 'To Do' }, { id: 5, name: 'Done' }],
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

test('board and backlog navigation render immediately and preserve browser history', () => {
  const app = loadApp();
  app.setState(stateWithHierarchy());
  app.window.location.hash = '#/board/1';
  app.navButtons.find(button => button.dataset.view === 'backlog').onclick();
  assert.equal(app.elements.get('#list').classList.contains('hidden'), false);
  assert.equal(app.elements.get('#board').classList.contains('hidden'), true);
  assert.match(app.elements.get('#list').innerHTML, /Idea/);
  assert.deepEqual(app.historyCalls, [['push', '#/backlog/1']]);
  app.navButtons.find(button => button.dataset.view === 'board').onclick();
  assert.equal(app.elements.get('#board').classList.contains('hidden'), false);
  assert.equal(app.elements.get('#list').classList.contains('hidden'), true);
  assert.match(app.elements.get('#board').innerHTML, /Dependency/);
  assert.equal(app.historyCalls[1][0], 'push');
});

test('archived and trashed tasks disappear from delivery views while live tasks remain', () => {
  const app = loadApp(); const state = stateWithHierarchy();
  state.tickets.find(task => task.id === 12).archivedAt = '2026-10-04';
  state.tickets.find(task => task.id === 13).deletedAt = '2026-10-04';
  state.tickets.find(task => task.id === 14).deletedAt = '2026-10-04';
  app.setState(state);
  assert.deepEqual(Array.from(app.workTickets(), task => task.id), [10,11]);
  assert.deepEqual(Array.from(app.filteredWork(), task => task.id), [10,11]);
  assert.equal(app.backlogTickets().length, 0);
  assert.equal(app.filteredBacklog().length, 0);
  assert.equal(app.dependencyTickets(state.tickets.find(task => task.id === 12)).length,0);
});

test('board backlog action works with empty and populated backlogs under strict CSP', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  app.setState(state);
  for (const tickets of [state.tickets, []]) {
    state.tickets = tickets;
    const html = app.boardBacklogPickerHtml();
    assert.match(html, /id="boardBacklogOpen"/);
    assert.doesNotMatch(html, /onclick=/);
    app.wireBoardBacklogPicker();
    app.elements.get('#boardBacklogOpen').onclick();
    assert.equal(app.elements.get('#list').classList.contains('hidden'), false);
  }
  app.setState(stateWithHierarchy());
  assert.doesNotMatch(app.overviewTable(app.getState().tickets), /onclick=/);
});

function deferredResponseQueue() {
  const pending = [];
  return {
    pending,
    fetch: (url, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject })),
    respond(index, body, status = 200) {
      pending[index].resolve({ ok: status < 400, status, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });
    },
  };
}

test('a slower board response cannot overwrite the latest selected board', async () => {
  const queue = deferredResponseQueue();
  const app = loadApp({ fetch: queue.fetch });
  app.selectBoard(1);
  const first = app.load();
  app.selectBoard(2);
  const second = app.load();
  const secondState = stateWithHierarchy();
  secondState.board = { id: 2, name: 'Second' };
  queue.respond(1, secondState);
  await second;
  queue.respond(0, stateWithHierarchy());
  await first;
  assert.equal(app.getState().board.id, 2);
  assert.equal(app.window.location.hash, '#/board/2');
});

test('stale authentication errors cannot hide a newer successful load', async () => {
  const queue = deferredResponseQueue();
  const app = loadApp({ fetch: queue.fetch });
  const first = app.load();
  const second = app.load();
  queue.respond(1, stateWithHierarchy());
  await second;
  queue.respond(0, 'login required', 401);
  await first;
  assert.equal(app.getState().board.id, 1);
  assert.equal(app.elements.get('#app').classList.contains('hidden'), false);
});

test('logging out invalidates a pending state response', async () => {
  const queue = deferredResponseQueue();
  const app = loadApp({ fetch: queue.fetch });
  const pendingLoad = app.load();
  app.resetClientState(true);
  queue.respond(0, stateWithHierarchy());
  await pendingLoad;
  assert.equal(app.getState().me, null);
  assert.equal(app.getState().tickets.length, 0);
});

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

// Exercise the real editor lifecycle; only layout operations are stubbed by fakeElement.
function openEditor(app, id) {
  app.openTicket(id, false);
  const ticket = app.getEditing();
  assert.equal(ticket?.id, id);
  const values = {
    dTitle: ticket.title, dBody: ticket.body || '', dType: ticket.type,
    dDuration: String(ticket.duration || 0), dStart: ticket.startDate || '', dDue: ticket.dueDate || '',
    dAssignee: String(ticket.assigneeId || 0), dMilestone: String(ticket.milestoneId || 0),
    dParent: String(ticket.parentId || 0), dLabels: ticket.labels.join(', '),
    dStatus: String(ticket.columnId), dRepeatDays: String(ticket.extras?.RepeatDays || 0), commentBody: '',
  };
  const fields = Object.entries(values).map(([id, value]) => {
    const field = app.document.querySelector('#' + id);
    Object.assign(field, { id, value, type: 'text', disabled: false });
    return field;
  });
  const buttons = ['saveBtn','deleteBtn','duplicateTaskBtn','archiveTaskBtn','commentBtn','drawerCloseBtn','closeBtn'].map(id => {
    const button = app.document.querySelector('#' + id); button.id = id; button.disabled = false; return button;
  });
  app.document.querySelector('#drawer').querySelectorAll = selector => selector.includes('button') ? [...fields, ...buttons] : fields;
  app.captureDraftBaseline();
  return Object.fromEntries(fields.map(field => [field.id, field]));
}

test('returning to the loaded board cancels a pending board route and its ticket', async () => {
  const queue = deferredResponseQueue();
  const app = loadApp({ fetch: queue.fetch });
  app.setState(stateWithHierarchy()); app.selectBoard(1);
  app.window.location.hash = '#/board/1';
  const pending = app.applyRoute({view:'board', boardId:2, ticketId:99});
  app.applyRoute({view:'board', boardId:1, ticketId:0});
  const other = stateWithHierarchy(); other.board = {id:2,name:'Other'};
  queue.respond(0, other); await pending;
  assert.equal(app.getState().board.id, 1);
  assert.equal(app.window.location.hash, '#/board/1');
  assert.equal(app.getEditing(), null);
});

test('view navigation during a board load keeps the requested board route and hides old content', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); app.selectBoard(1);
  const loading = app.applyRoute({view:'board',boardId:2,ticketId:0});
  app.navButtons.find(button => button.dataset.view === 'backlog').onclick();
  assert.equal(app.window.location.hash,'#/backlog/2');
  assert.equal(app.document.querySelector('#viewTitle').textContent,'Loading board');
  assert.equal(app.document.querySelector('#list').classList.contains('hidden'),true);
  app.openTicket(12); assert.equal(app.getEditing(),null);
  const refreshed = stateWithHierarchy(); refreshed.board = {id:2,name:'Other'};
  queue.respond(0,refreshed); await loading;
  assert.equal(app.getState().board.id,2); assert.equal(app.getView(),'backlog');
  assert.equal(app.document.querySelector('#list').classList.contains('hidden'),false);
});

test('a failed board load restores the last confirmed board with a visible error', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch,console:{error(){},warn(){}}});
  app.setState(stateWithHierarchy()); app.selectBoard(1);
  const loading = app.applyRoute({view:'board',boardId:2,ticketId:99});
  queue.respond(0,'State unavailable',500); await loading;
  assert.equal(app.getState().board.id,1); assert.equal(app.window.location.hash,'#/board/1');
  assert.equal(app.document.querySelector('#board').classList.contains('hidden'),false);
  assert.match(app.document.querySelector('#viewSubtitle').textContent,/Something went wrong\. Please try again\./);
  assert.doesNotMatch(app.document.querySelector('#viewSubtitle').textContent,/State unavailable/);
});

test('explicitly opening an editor cancels a queued ticket during state refresh', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); app.selectBoard(1); app.setPendingTicket(12);
  const loading = app.load(); const fields = openEditor(app,13); fields.dTitle.value = 'Draft B';
  queue.respond(0,stateWithHierarchy()); await loading;
  assert.equal(app.getEditing().id,13); assert.equal(fields.dTitle.value,'Draft B');
  assert.equal(app.window.location.hash,'#/board/1/ticket/13');
});

test('Cancel keeps draft, view and route unchanged for backlog and sprint actions', () => {
  const app = loadApp(); app.setState(stateWithHierarchy()); app.selectBoard(1);
  app.window.location.hash = '#/board/1';
  const fields = openEditor(app,12); fields.dTitle.value = 'Draft';
  const snapshot = app.getSnapshot(); app.setConfirm(() => false);
  app.openBacklogView(); app.jumpToSprint(1);
  assert.equal(app.getView(),'board');
  assert.equal(app.window.location.hash,'#/board/1');
  assert.equal(app.getSnapshot(),snapshot);
  assert.equal(fields.dTitle.value,'Draft');
  assert.equal(app.getEditing().id,12);
});

test('discarding an editor leaves saved dependencies, labels and nested checklist intact', () => {
  const app = loadApp(); const state = stateWithHierarchy();
  const ticket = state.tickets.find(ticket => ticket.id === 12);
  ticket.labels = ['saved']; ticket.extras = {Checklist:[{Text:'Saved step',Done:false}],RepeatDays:7};
  app.setState(state); app.selectBoard(1); openEditor(app,12);
  const input = {value:'11',checked:true};
  const originalAll = app.document.querySelectorAll;
  app.document.querySelectorAll = selector => selector === '#dependencyOptions input[type="checkbox"]' ? [input] : originalAll(selector);
  app.renderDependencyOptions(); input.onchange();
  app.getEditing().labels.push('draft'); app.getEditing().extras.Checklist[0].Done = true;
  app.closeDrawer();
  assert.deepEqual(ticket.links,[13]); assert.deepEqual(ticket.labels,['saved']);
  assert.equal(ticket.extras.Checklist[0].Done,false);
  openEditor(app,12);
  assert.deepEqual(Array.from(app.getEditing().links),[13]);
});

for (const action of ['save','trash','archive','duplicate','comment']) {
  test('late ' + action + ' completion cannot close or overwrite a newer editor draft', async () => {
    const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
    app.setState(stateWithHierarchy()); app.selectBoard(1);
    const first = openEditor(app,12);
    if (action === 'save') first.dTitle.value = 'Saved A';
    if (action === 'comment') first.commentBody.value = 'Posted on A';
    const mutation = action === 'save' ? app.saveDrawer() : action === 'comment' ? app.addComment() : app.taskDrawerAction(action);
    assert.match(queue.pending[0].url, /^\/api\/tickets\/12(?:\/|$)/);
    assert.equal(first.dTitle.disabled,true);
    const second = openEditor(app,13); second.dTitle.value = 'Unsaved B'; second.commentBody.value = 'Comment draft B';
    const snapshot = app.getSnapshot();
    queue.respond(0, action === 'duplicate' ? {id:99} : {});
    await nextTurn();
    const refreshed = stateWithHierarchy(); refreshed.tickets.push({...refreshed.tickets[2],id:99,title:'Copy A'});
    queue.respond(1,refreshed); await mutation;
    assert.equal(app.getEditing().id,13);
    assert.equal(second.dTitle.value,'Unsaved B'); assert.equal(second.commentBody.value,'Comment draft B');
    assert.equal(app.getSnapshot(),snapshot);
    assert.equal(app.document.querySelector('#drawer').classList.contains('hidden'),false);
    assert.equal(second.dTitle.disabled,false);
  });
}

test('late editor errors do not replace a newer editor message', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); app.selectBoard(1);
  openEditor(app,12); const saving = app.saveDrawer();
  openEditor(app,13); app.document.querySelector('#drawerError').textContent = 'Message for B';
  queue.respond(0,'Save A failed',500); await saving;
  assert.equal(app.document.querySelector('#drawerError').textContent,'Message for B');
  assert.equal(app.getEditing().id,13);
});

for (const action of ['save','trash','archive','duplicate']) {
  test('successful ' + action + ' refreshes state and completes its original editor', async () => {
    const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
    app.setState(stateWithHierarchy()); app.selectBoard(1); const fields = openEditor(app,12);
    fields.dTitle.value = 'Saved A';
    const mutation = action === 'save' ? app.saveDrawer() : app.taskDrawerAction(action);
    queue.respond(0, action === 'duplicate' ? {id:99} : {}); await nextTurn();
    const refreshed = stateWithHierarchy();
    refreshed.tickets.find(ticket => ticket.id === 12).title = 'Saved A';
    if (action === 'duplicate') refreshed.tickets.push({...refreshed.tickets[2],id:99,title:'Copy A'});
    queue.respond(1,refreshed); await mutation;
    assert.equal(app.getState().tickets.find(ticket => ticket.id === 12).title,'Saved A');
    assert.equal(app.getEditing()?.id || 0, action === 'duplicate' ? 99 : 0);
  });
}

test('failed destructive action restores draft protection and original disabled fields', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); app.selectBoard(1); const fields = openEditor(app,12);
  fields.dTitle.value = 'Unsaved A'; fields.dParent.disabled = true;
  const deleting = app.deleteTicket();
  await app.deleteTicket(); // A second click during the request cannot create another mutation.
  assert.equal(queue.pending.length,1);
  queue.respond(0,'SQLite operation failed',500); await deleting;
  assert.equal(fields.dTitle.disabled,false); assert.equal(fields.dParent.disabled,true);
  assert.equal(app.document.querySelector('#drawerError').textContent,'Something went wrong. Please try again.');
  app.setConfirm(() => false); assert.equal(app.closeDrawer(),false);
});

test('an editor mutation finishing after session reset cannot reload another session', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); app.selectBoard(1); openEditor(app,12);
  const saving = app.saveDrawer(); app.resetClientState(true);
  const other = stateWithHierarchy(); other.me = {id:42}; app.setState(other);
  queue.respond(0,{}); await saving;
  assert.equal(queue.pending.length,1); assert.equal(app.getState().me.id,42); assert.equal(app.getEditing(),null);
});

test('the same task cannot reopen from stale state until its mutation and refresh complete', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); app.selectBoard(1); const fields = openEditor(app,12);
  fields.dTitle.value = 'Saved new title'; const saving = app.saveDrawer();
  app.closeDrawer(); app.openTicket(12,false);
  assert.equal(app.getEditing(),null);
  assert.match(app.document.querySelector('#viewSubtitle').textContent,/still being updated/);
  queue.respond(0,{}); await nextTurn();
  app.openTicket(12,false); assert.equal(app.getEditing(),null);
  const refreshed = stateWithHierarchy(); refreshed.tickets[2].title = 'Saved new title';
  queue.respond(1,refreshed); await saving;
  openEditor(app,12); assert.equal(app.getEditing().title,'Saved new title');
});

test('password session renewal does not leave an existing draft disabled after an old mutation', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); app.selectBoard(1); const fields = openEditor(app,12);
  fields.dTitle.value = 'Draft'; const saving = app.saveDrawer();
  app.document.querySelector('#newPassword').value = 'new-password';
  app.document.querySelector('#confirmPassword').value = 'new-password';
  const renewing = app.document.querySelector('#savePasswordBtn').onclick();
  queue.respond(1,{}); await nextTurn(); queue.respond(2,stateWithHierarchy()); await renewing;
  queue.respond(0,{}); await saving;
  assert.equal(app.getEditing().id,12); assert.equal(fields.dTitle.value,'Draft'); assert.equal(fields.dTitle.disabled,false);
  app.setConfirm(() => false); assert.equal(app.closeDrawer(),false);
});

test('saving a task keeps an unposted comment draft and its close protection', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); app.selectBoard(1);
  const fields = openEditor(app,12); fields.dTitle.value = 'Saved title'; fields.commentBody.value = 'Unposted comment';
  const saving = app.saveDrawer(); queue.respond(0,{}); await nextTurn();
  queue.respond(1,stateWithHierarchy()); await saving;
  assert.equal(app.getEditing().id,12); assert.equal(fields.commentBody.value,'Unposted comment');
  assert.equal(fields.commentBody.disabled,false);
  app.setConfirm(() => false); assert.equal(app.closeDrawer(),false);
});

test('posting a comment preserves unsaved task fields and refreshes only its original editor', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); app.selectBoard(1);
  const fields = openEditor(app,12); fields.dTitle.value = 'Unsaved title'; fields.commentBody.value = 'Posted';
  const posting = app.addComment(); queue.respond(0,{}); await nextTurn();
  const refreshed = stateWithHierarchy(); refreshed.comments = [{ticketId:12,userId:3,body:'Posted',createdAt:'2026-10-05'}];
  queue.respond(1,refreshed); await posting;
  assert.equal(fields.dTitle.value,'Unsaved title'); assert.equal(fields.commentBody.value,'');
  assert.match(app.document.querySelector('#commentList').innerHTML,/Posted/);
  app.setConfirm(() => false); assert.equal(app.closeDrawer(),false);
});

test('logout protects Cancel, then immediately clears editor DOM and blocks new login until complete', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); app.selectBoard(1);
  const fields = openEditor(app,12); fields.dTitle.value = 'Draft';
  app.setConfirm(() => false); await app.logout();
  assert.equal(queue.pending.length,0); assert.equal(app.getEditing().id,12);
  app.setConfirm(() => true); const loggingOut = app.logout();
  assert.equal(app.getEditing(),null); assert.equal(app.getState().me,null);
  assert.equal(app.document.querySelector('#drawer').innerHTML,'');
  assert.equal(app.document.querySelector('#drawer').classList.contains('hidden'),true);
  assert.equal(app.document.querySelector('#loginBtn').disabled,true);
  queue.respond(0,{}); await loggingOut;
  assert.equal(app.document.querySelector('#loginBtn').disabled,false);
});

test('session expiry removes old editor contents and explains why sign-in is needed', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); app.selectBoard(1); openEditor(app,12);
  const loading = app.load(); queue.respond(0,'login required',401); await loading;
  assert.equal(app.getEditing(),null); assert.equal(app.document.querySelector('#drawer').innerHTML,'');
  assert.match(app.document.querySelector('#loginError').textContent,/Session expired/);
});

for (const status of [200,401]) {
  test('an old notification response (' + status + ') cannot affect a same-user new login session', async () => {
    const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
    app.setState(stateWithHierarchy()); app.selectBoard(1);
    const oldPoll = app.refreshNotifications();
    const login = app.document.querySelector('#loginBtn').onclick();
    queue.respond(1,{}); await nextTurn(); queue.respond(2,stateWithHierarchy()); await login;
    queue.respond(0,status === 401 ? 'login required' : {notifications:[{id:99,title:'Old session'}]},status); await oldPoll;
    assert.equal(app.getState().me.id,3);
    assert.equal(app.document.querySelector('#app').classList.contains('hidden'),false);
    assert.equal((app.getState().notifications || []).length,0);
  });
}

test('sign-in restores a permitted ticket deep link using freshly loaded state', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
  app.window.location.hash = '#/backlog/1/ticket/12';
  const login = app.document.querySelector('#loginBtn').onclick();
  queue.respond(0,{}); await nextTurn();
  assert.equal(queue.pending[1].url,'/api/state?boardId=1');
  queue.respond(1,stateWithHierarchy()); await login;
  assert.equal(app.getEditing().id,12); assert.equal(app.getView(),'backlog');
  assert.equal(app.window.location.hash,'#/backlog/1/ticket/12');
});

test('Cancel prevents reading or importing a file while a task draft remains open', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); app.selectBoard(1);
  const fields = openEditor(app,12); fields.dTitle.value = 'Draft'; app.setConfirm(() => false);
  let reads = 0; const target = {value:'selected',files:[{text:async()=>{reads++;return '{}';}}]};
  await app.importBoardFile({target});
  assert.equal(reads,0); assert.equal(queue.pending.length,0); assert.equal(app.getEditing().id,12);
});

for (const status of [400,403,500]) {
  test('import HTTP ' + status + ' is displayed and does not reload unchanged state', async () => {
    const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch,console:{error(){},warn(){}}});
    const state = stateWithHierarchy(); app.setState(state); app.selectBoard(1);
    const target = {value:'selected',files:[{text:async()=>'{"tickets":[]}'}]};
    const importing = app.importBoardFile({target}); await nextTurn();
    queue.respond(0,status >= 500 ? 'UNIQUE constraint failed: tickets.id' : 'Import rejected',status); await importing;
    assert.equal(queue.pending.length,1); assert.equal(app.getState(),state);
    assert.equal(app.document.querySelector('#viewSubtitle').textContent,'Could not refresh data: ' + (status >= 500 ? 'Something went wrong. Please try again.' : 'Import rejected'));
    assert.equal(target.value,'');
  });
}

test('import does not start after logout while the file is being read', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); app.selectBoard(1);
  let finishRead; const target = {value:'selected',files:[{text:()=>new Promise(resolve=>finishRead=resolve)}]};
  const importing = app.importBoardFile({target}); app.resetClientState(true); finishRead('{}'); await importing;
  assert.equal(queue.pending.length,0); assert.equal(app.getState().me,null);
});

test('a successful import refreshes state and clears the file input for retry', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); app.selectBoard(1);
  const target = {value:'selected',files:[{text:async()=>'{}'}]};
  const importing = app.importBoardFile({target}); await nextTurn(); queue.respond(0,{ok:true}); await nextTurn();
  const refreshed = stateWithHierarchy(); refreshed.tickets[2].title = 'Imported';
  queue.respond(1,refreshed); await importing;
  assert.equal(app.getState().tickets[2].title,'Imported'); assert.equal(target.value,'');
});

test('a missing pending ticket is removed from the rendered route', () => {
  const app = loadApp(); app.setState(stateWithHierarchy()); app.selectBoard(1);
  app.applyRoute({view:'board',boardId:1,ticketId:999});
  assert.equal(app.window.location.hash,'#/board/1'); assert.equal(app.getEditing(),null);
});

test('portable comment authorship is rendered with escaping and an imported label', () => {
  const app = loadApp(); const state = stateWithHierarchy();
  state.comments = [{ticketId:12,userId:0,authorName:'<former>',body:'<comment>',createdAt:'<date>'}];
  app.setState(state); app.selectBoard(1); openEditor(app,12); app.renderComments();
  const html = app.document.querySelector('#commentList').innerHTML;
  assert.match(html,/&lt;former&gt; \(imported\)/); assert.match(html,/&lt;comment&gt;/); assert.match(html,/&lt;date&gt;/);
});

test('server-assigned avatars render consistently in user and assignee views', () => {
  const app = loadApp({ creator: true });
  const state = stateWithHierarchy();
  const value = 'dino-v2:pterosaur:1234abcd';
  state.users[0].avatar = value;
  state.tickets[2].assigneeId = 3;
  app.setState(state);
  const avatar = app.avatar(value, 'Ada');
  assert.match(avatar, /<svg /);
  assert.match(avatar, /Pterosaur avatar/);
  assert.equal(avatar, app.avatar(value, 'Ada'));
  assert.match(app.card(state.tickets[2]), /Pterosaur avatar/);
  assert.doesNotMatch(avatar, /<img /);
});

for (const flow of ['signup','admin']) {
  test(flow + ' account creation leaves avatar assignment to the server', async () => {
    const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch,creator:true});
    const state = stateWithHierarchy(); state.me.isAdmin = true; app.setState(state); app.selectBoard(1);
    let creating;
    if (flow === 'signup') {
      app.document.querySelector('#signupUsername').value = 'new-user';
      app.document.querySelector('#signupPassword').value = 'new-password';
      app.document.querySelector('#signupConfirmPassword').value = 'new-password';
      app.document.querySelector('#signupDinoCreator').dataset.avatar = 'dino-v2:trex:ffffffff';
      creating = app.document.querySelector('#signupBtn').onclick();
    } else {
      app.renderAdmin();
      app.document.querySelector('#createUsername').value = 'new-user';
      app.document.querySelector('#createPassword').value = 'new-password';
      app.document.querySelector('#createConfirmPassword').value = 'new-password';
      app.document.querySelector('#adminAvatarCreator').dataset.avatar = 'dino-v2:trex:ffffffff';
      creating = app.document.querySelector('#createUserBtn').onclick();
    }
    assert.equal(queue.pending[0].url, flow === 'signup' ? '/api/signup' : '/api/users');
    const payload = JSON.parse(queue.pending[0].options.body);
    assert.equal(payload.Username,'new-user'); assert.equal(Object.hasOwn(payload,'Avatar'),false);
    queue.respond(0,{ok:true}); await nextTurn();
    const refreshed = stateWithHierarchy(); refreshed.me.avatar = 'dino-v2:pterosaur:1234abcd';
    queue.respond(1,refreshed); await creating;
    assert.equal(app.getState().me.avatar,'dino-v2:pterosaur:1234abcd');
    assert.match(app.document.querySelector('#me').innerHTML,/Pterosaur avatar/);
  });
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
  assert.equal(app.normTicket({ ID: 5, Type: 'task', IsBacklog: true }).isBacklog, true);
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

test('backlog state is independent from work type and keeps valid Epic choices', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  state.tickets[0].isBacklog = true;
  state.tickets[1].isBacklog = true;
  app.setState(state);

  assert.deepEqual(app.backlogTickets().map(ticket => ticket.id), [10, 11, 14]);
  assert.deepEqual(app.workTickets().map(ticket => ticket.id), [12, 13]);
  assert.deepEqual(app.parentCandidates('story', 11).map(ticket => ticket.id), [10]);
  assert.equal(app.normalizePromotionType(state.tickets[4]), 'task');
  assert.deepEqual(app.backlogDescendants(10).map(ticket => ticket.id), [11]);
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

test('dependency summaries remain inline without buttons or a detached dependency panel', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  app.setState(state);
  assert.match(app.boardDependencyHtml(state.tickets[2]), /Prerequisites done/);
  assert.match(app.boardDependencyHtml(state.tickets[3]), /Required by 1 task/);
  assert.match(app.card(state.tickets[2]), /data-work-id="12"/);
  assert.match(app.overviewTable(state.tickets), /data-work-id="12"/);
  assert.doesNotMatch(app.card(state.tickets[2]) + app.overviewTable(state.tickets), /data-show-dependencies|Show dependencies|dependencySelection/);
  assert.doesNotMatch(app.boardDependencyHtml(state.tickets[2]), /&larr;|&rarr;|Enables #|Depends on #/);

  state.tickets[3].columnId = 1;
  assert.match(app.boardDependencyHtml(state.tickets[2]), /Waiting for 1 task/);
});

test('dependency hover edges preserve direction and omit filtered, deleted, archived and self links', () => {
  const app = loadApp(); const state = stateWithHierarchy();
  const task = (id, title, links = [], extra = {}) => ({ id, title, links, type:'task', columnId:1, labels:[], position:id, ...extra });
  state.tickets = [task(1,'Selected task',[2,1,99]), task(2,'Prerequisite',[4]), task(3,'Dependent',['1']), task(4,'Indirect prerequisite'), task(5,'Indirect dependent',[3]), task(6,'Unrelated'), task(7,'Archived dependent',[1],{archivedAt:'2026-10-06'}), task(8,'Deleted dependent',[1],{deletedAt:'2026-10-06'}), task(9,'Backlog dependent',[1],{isBacklog:true}), task(10,'Idea dependent',[1],{type:'idea'})];
  app.setState(state);
  const pairs = tickets => Array.from(app.dependencyHoverEdges(tickets), edge => edge.from + '>' + edge.to);
  assert.deepEqual(pairs(app.workTickets()), ['2>1','4>2','1>3','3>5']);
  assert.deepEqual(pairs([state.tickets[0],state.tickets[2]]), ['1>3']);
  assert.deepEqual(pairs([]), []);
});

function hoverApp() {
  const calls = [];
  const app = loadApp({hover: {wire(root, options) { calls.push({root, options}); }}});
  app.setState(stateWithHierarchy());
  return {app, calls};
}

test('Board rendering wires explicit dependencies to the card surface without changing view or route', () => {
  const {app, calls} = hoverApp(); const root = app.document.querySelector('#board'); const layer = fakeElement();
  layer.classList.add('boardSwimlanes');
  root.querySelector = selector => selector === '.boardSwimlanes,.tableScroll' ? layer : null;
  app.renderBoard();
  assert.equal(calls.length, 1); assert.equal(calls[0].root, root);
  const options = calls[0].options;
  assert.equal(options.layerRoot, layer); assert.equal(options.idAttribute, 'data-work-id');
  assert.equal(options.routeClearance, 12);
  assert.match(options.nodesSelector, /boardSwimlanes \[data-work-id\]/);
  assert.deepEqual(Array.from(options.edges, edge => edge.from + '>' + edge.to), ['13>12']);
  assert.doesNotMatch(root.innerHTML, /Show dependencies|dependencySelection|pathDimmed/);
  assert.equal(app.getView(), 'board'); assert.equal(app.getEditing(), null);
  assert.deepEqual(app.historyCalls, []);
});

test('Overview rendering wires explicit dependencies in the table and supports keyboard task editing', () => {
  const {app, calls} = hoverApp(); const root = app.document.querySelector('#overview');
  const table = fakeElement(); const layer = fakeElement(); const row = fakeElement();
  row.classList.add('ticketRow'); row.dataset.openTicket = '12';
  root.querySelector = selector => selector === '.ticketTable' ? table : selector === '.tableScroll' || selector === '.boardSwimlanes,.tableScroll' ? layer : null;
  root.querySelectorAll = selector => selector === '[data-open-ticket]' ? [row] : [];
  app.renderOverview();
  assert.equal(calls.length, 1); assert.equal(calls[0].root, root);
  assert.equal(calls[0].options.layerRoot, layer);
  assert.equal(calls[0].options.routeClearance, 4);
  assert.match(calls[0].options.nodesSelector, /ticketTable \[data-work-id\]/);
  assert.deepEqual(Array.from(calls[0].options.edges, edge => edge.from + '>' + edge.to), ['13>12']);
  assert.equal(row.tabIndex, 0); assert.equal(app.getEditing(), null);
  assert.doesNotMatch(root.innerHTML, /Show dependencies|dependencySelection|pathDimmed/);
  let prevented = false; row.onkeydown({target: row, key: 'Enter', preventDefault() { prevented = true; }});
  assert.equal(prevented, true); assert.equal(app.getEditing().id,12); assert.equal(app.dependencyFocusIds(),null);
});

test('Board shows full Sprint planning without a disclosure and keeps backlog promotion available', () => {
  const app=loadApp(); app.setState(stateWithHierarchy()); app.renderBoard();
  const html=app.elements.get('#board').innerHTML;
  assert.match(html,/<section class="panel sprintPlanner">/);
  assert.doesNotMatch(html,/<details class="panel sprintPlanner"|<summary>|workDependencyOverlay/);
  assert.match(html,/id="sprintStartDate"/); assert.match(html,/id="sprintWeeks"/);
  assert.match(html,/id="saveSprintSettings"/); assert.match(html,/data-sprint-name=/); assert.match(html,/data-sprint-jump=/);
  assert.equal((html.match(/data-sprint-card=/g)||[]).length,6);
  assert.match(html,/id="boardBacklogAdd"/);
});

test('promotion selectors do not offer deleted or archived Epics', () => {
  const app=loadApp(); const state=stateWithHierarchy();
  state.tickets.push({...state.tickets[0],id:20,title:'Archived Epic',archivedAt:'2026-10-06'},{...state.tickets[0],id:21,title:'Deleted Epic',deletedAt:'2026-10-06'});
  app.setState(state);
  assert.doesNotMatch(app.boardBacklogPickerHtml(),/Archived Epic|Deleted Epic/);
  assert.doesNotMatch(app.backlogRowHtml(state.tickets[4]),/Archived Epic|Deleted Epic/);
  assert.match(app.boardBacklogPickerHtml(),/value="10"/);
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

test('sprint helpers assign planned finishes and stop after the last scheduled ticket', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  state.tickets[1].startDate = '2026-01-02';
  state.tickets[1].dueDate = '2026-01-08';
  state.tickets[2].startDate = '2026-01-10';
  state.tickets[2].dueDate = '2026-01-15';
  app.setState(state);

  assert.equal(app.ticketSprint(state.tickets[1]).number, 1);
  assert.equal(app.ticketSprint(state.tickets[2]).number, 2);
  assert.equal(app.fmtIsoDate(app.ticketSprint(state.tickets[2]).start), '2026-01-15');
  assert.equal(app.calculatedSprints(app.workTickets()).length, 2);
  assert.equal(app.ticketSprint({ startDate: '', dueDate: '' }), null);
  const bands = app.ganttSvgSprintBands(app.parseDate('2026-01-01'), 28, 10, 50, 200, 250, 60);
  assert.equal((bands.match(/ganttSvgSprintBand/g) || []).length, 2);
  assert.equal((bands.match(/ganttSvgSprintBoundary/g) || []).length, 2);
});

test('sprint planning explains work before the cadence without hiding a valid saved plan', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  state.board.sprint_start_date = '2026-09-15';
  state.tickets[1].dueDate = '2026-07-01';
  state.tickets[2].dueDate = '2026-07-15';
  app.setState(state);

  const before = app.ticketSprint(state.tickets[2]);
  assert.equal(before.before, true);
  assert.equal(before.number, 0);
  assert.equal(app.sprintName(before), 'Before Sprint 1');
  assert.equal(app.calculatedSprints(app.workTickets()).length, 0);

  const preview = app.sprintPreviewHtml(app.workTickets(), '2026-09-15', 2);
  assert.match(preview, /Sprint 1/);
  assert.match(preview, /before Sprint 1/);
  assert.doesNotMatch(preview, /Choose the first Sprint start date/);
});

test('Sprint preview validates saved cadence values before rendering cards', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  app.setState(state);

  assert.equal(app.validSprintWeeks(2), 2);
  assert.equal(app.validSprintWeeks(1.5), 0);
  assert.match(app.sprintPreviewHtml(app.workTickets(), '', 2), /Choose the first Sprint start date/);
  assert.match(app.sprintPreviewHtml(app.workTickets(), '2026-01-01', 0), /whole number from 1 to 52 weeks/);
});

function prepareSprintPlanner(app) {
  app.renderBoard();
  const start = app.document.querySelector('#sprintStartDate');
  const weeks = app.document.querySelector('#sprintWeeks');
  const preview = app.document.querySelector('.sprintPreview');
  start.value = app.boardSprintStartValue();
  weeks.value = String(app.boardSprintWeeks());
  preview.innerHTML = app.sprintPreviewHtml(app.workTickets(), start.value, +weeks.value);
  app.wireSprintPlanner();
  return {start, weeks, preview, save: app.document.querySelector('#saveSprintSettings'), status: app.document.querySelector('#sprintSettingsStatus')};
}

test('a draft first Sprint date creates no cards or task Sprint assignments', () => {
  const app = loadApp(); const state = stateWithHierarchy(); state.board.sprint_start_date = '';
  app.setState(state);
  const planner = prepareSprintPlanner(app); const savedPreview = planner.preview.innerHTML;
  assert.doesNotMatch(app.elements.get('#board').innerHTML, /data-sprint-card=|data-sprint-name=|data-sprint-jump=/);
  planner.start.value = '2026-10-22'; planner.start.oninput();
  planner.weeks.value = '3'; planner.weeks.oninput();
  assert.equal(planner.preview.innerHTML, savedPreview);
  assert.doesNotMatch(planner.preview.innerHTML, /data-sprint-card=/);
  assert.equal(planner.status.textContent, 'Unsaved changes');
  assert.equal(planner.status.dataset.state, 'unsaved');
  assert.equal(app.ticketSprint(state.tickets[3]), null);
  assert.equal(app.calculatedSprints(app.workTickets()).length, 0);
  assert.equal(state.board.sprint_start_date, '');
  assert.equal(state.board.sprint_weeks, 2);
});

test('editing an existing Sprint cadence keeps saved cards and prevents draft name autosaves', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch: queue.fetch}); const state = stateWithHierarchy();
  app.setState(state);
  const name = fakeElement(); name.dataset = {sprintName: '1', originalDisplay: 'Sprint 1'}; name.value = 'Launch';
  const jump = fakeElement(); jump.dataset.sprintJump = '1';
  const original = app.document.querySelectorAll;
  app.document.querySelectorAll = selector => selector === '.sprintNameInput' ? [name] : selector === '.sprintJump' ? [jump] : original(selector);
  const planner = prepareSprintPlanner(app); const savedPreview = planner.preview.innerHTML;
  const savedSprintStart = app.fmtIsoDate(app.ticketSprint(state.tickets[3]).start);
  planner.start.value = '2026-10-22'; planner.start.oninput();
  planner.weeks.value = '3'; planner.weeks.oninput();
  assert.equal(planner.preview.innerHTML, savedPreview);
  assert.equal(app.fmtIsoDate(app.ticketSprint(state.tickets[3]).start), savedSprintStart);
  assert.equal(name.disabled, true); assert.equal(jump.disabled, true);
  name.onchange(); await app.saveSprintName(name);
  assert.equal(queue.pending.length, 0);
  planner.start.value = '2026-01-01'; planner.weeks.value = '2'; planner.weeks.oninput();
  assert.equal(planner.status.textContent, 'Cadence saved');
  assert.equal(planner.status.dataset.state, 'saved');
  assert.equal(name.disabled, false); assert.equal(jump.disabled, false);
});

test('same-board rerenders preserve cadence drafts while Sprint cards keep the saved dates', () => {
  const app = loadApp(); const state = stateWithHierarchy(); app.setState(state);
  const name = fakeElement(); name.dataset = {sprintName: '1', originalDisplay: 'Sprint 1'};
  const original = app.document.querySelectorAll;
  app.document.querySelectorAll = selector => selector === '.sprintNameInput' ? [name] : original(selector);
  const planner = prepareSprintPlanner(app);
  const savedPreview = app.sprintPreviewHtml(app.workTickets(), '2026-01-01', 2);
  planner.start.value = '2026-10-22'; planner.start.oninput();
  planner.weeks.value = '1.5'; planner.weeks.oninput();
  app.renderOverview(); app.renderBoard();
  const html = app.elements.get('#board').innerHTML;
  assert.match(html, /id="sprintStartDate"[^>]*value="2026-10-22"/);
  assert.match(html, /id="sprintWeeks"[^>]*value="1.5"/);
  assert.ok(html.includes('<div class="sprintPreview">' + savedPreview + '</div>'));
  assert.match(html, /data-state="unsaved">Unsaved changes/);
  assert.equal(planner.start.value, '2026-10-22'); assert.equal(planner.weeks.value, '1.5');
  assert.equal(name.disabled, true);
  assert.equal(state.board.sprint_start_date, '2026-01-01');
});

test('cadence drafts do not leak into another board or a new login session', () => {
  const app = loadApp(); const first = stateWithHierarchy(); app.setState(first);
  let planner = prepareSprintPlanner(app);
  planner.start.value = '2026-10-22'; planner.start.oninput();
  const second = {...stateWithHierarchy(), board: {id: 2, sprint_start_date: '2027-01-01', sprint_weeks: 1}};
  app.setState(second); app.selectBoard(2); app.renderBoard();
  let html = app.elements.get('#board').innerHTML;
  assert.match(html, /id="sprintStartDate"[^>]*value="2027-01-01"/);
  assert.match(html, /id="sprintWeeks"[^>]*value="1"/);
  assert.doesNotMatch(html, /Unsaved changes/);
  app.setState(first); app.selectBoard(1); planner = prepareSprintPlanner(app);
  assert.equal(planner.start.value, '2026-01-01');
  planner.start.value = '2026-10-22'; planner.start.oninput();
  app.resetClientState(); app.setState(first); app.renderBoard();
  html = app.elements.get('#board').innerHTML;
  assert.match(html, /id="sprintStartDate"[^>]*value="2026-01-01"/);
  assert.doesNotMatch(html, /Unsaved changes/);
});

test('the first Sprint cards appear only after Save succeeds and persisted state reloads', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch: queue.fetch}); const state = stateWithHierarchy();
  state.board.sprint_start_date = ''; app.setState(state);
  const planner = prepareSprintPlanner(app);
  planner.start.value = '2026-10-22'; planner.start.oninput();
  const saving = planner.save.onclick();
  assert.equal(planner.status.dataset.state, 'saving');
  assert.doesNotMatch(planner.preview.innerHTML, /data-sprint-card=/);
  assert.equal(state.board.sprint_start_date, '');
  queue.respond(0, {ok: true}); await nextTurn();
  assert.equal(queue.pending[1].url, '/api/state');
  assert.doesNotMatch(planner.preview.innerHTML, /data-sprint-card=/);
  const loaded = stateWithHierarchy(); loaded.board.sprint_start_date = '2026-10-22';
  queue.respond(1, loaded); await saving;
  const html = app.elements.get('#board').innerHTML;
  assert.equal(app.boardSprintStartValue(), '2026-10-22');
  assert.equal((html.match(/data-sprint-card=/g) || []).length, 6);
  assert.match(html, /data-state="saved">Cadence saved/);
  // An unrelated later refresh must use its persisted cadence, not resurrect the saved draft.
  const later = stateWithHierarchy(); later.board.sprint_start_date = '2027-02-01';
  app.setState(later); app.renderBoard();
  assert.match(app.elements.get('#board').innerHTML, /id="sprintStartDate"[^>]*value="2027-02-01"/);
  assert.doesNotMatch(app.elements.get('#board').innerHTML, /Unsaved changes/);
});

test('a failed first Sprint save leaves the draft without cards or saved assignments', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch: queue.fetch}); const state = stateWithHierarchy();
  state.board.sprint_start_date = ''; app.setState(state);
  const planner = prepareSprintPlanner(app);
  planner.start.value = '2026-10-22'; planner.start.oninput();
  const saving = planner.save.onclick(); queue.respond(0, 'Saving failed', 500); await saving;
  assert.doesNotMatch(planner.preview.innerHTML, /data-sprint-card=/);
  assert.equal(state.board.sprint_start_date, '');
  assert.equal(planner.start.value, '2026-10-22');
  assert.equal(planner.save.disabled, false);
  assert.equal(planner.start.disabled, false);
  assert.equal(planner.status.dataset.state, 'unsaved');
  assert.equal(app.elements.get('#sprintSettingsError').textContent, 'Something went wrong. Please try again.');
  assert.equal(queue.pending.length, 1);
});

test('a successful Sprint save with a failed reload does not render draft cards and allows retry', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch: queue.fetch, console: {error() {}}}); const state = stateWithHierarchy();
  state.board.sprint_start_date = ''; app.setState(state);
  const planner = prepareSprintPlanner(app);
  planner.start.value = '2026-10-22'; planner.start.oninput();
  const saving = planner.save.onclick(); queue.respond(0, {ok: true}); await nextTurn();
  queue.respond(1, 'Refresh failed', 500); await saving;
  assert.doesNotMatch(planner.preview.innerHTML, /data-sprint-card=/);
  assert.equal(state.board.sprint_start_date, '');
  assert.equal(planner.save.disabled, false);
  assert.equal(planner.status.dataset.state, 'unsaved');
  assert.match(app.elements.get('#sprintSettingsError').textContent, /saved, but could not be refreshed/);
});

test('Sprint window exposes current plus five successors and applies custom names safely', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  state.sprintNames = [app.normSprintName({ sprint_number: 2, name: 'Launch Prep' })];
  app.setState(state);

  const window = app.sprintWindow('2026-01-01', 2, app.parseDate('2026-01-20'), 6);
  assert.equal(window.length, 6);
  assert.equal(window[0].number, 2);
  assert.equal(window[0].current, true);
  assert.equal(window[5].number, 7);
  assert.equal(app.sprintName(window[0]), 'Launch Prep');
  assert.equal(app.sprintName(window[1]), 'Sprint 3');
  assert.match(app.sprintPreviewCardHtml(window[0]), /data-sprint-jump="2"/);

  const future = app.sprintWindow('2026-02-01', 2, app.parseDate('2026-01-20'), 6);
  assert.equal(future[0].number, 1);
  assert.equal(future[0].next, true);
});

test('browsing Sprint windows keeps Current on the actual Sprint and labels earlier Sprints Past', () => {
  const app = loadApp();
  const today = app.parseDate('2026-04-10');
  const earlier = app.sprintWindow('2026-01-01', 2, today, 6, 3);
  assert.deepEqual(Array.from(earlier, sprint => sprint.number), [3, 4, 5, 6, 7, 8]);
  assert.equal(earlier[0].past, true);
  assert.equal(earlier[5].current, true);
  assert.equal(earlier[5].past, false);
  assert.match(app.sprintPreviewCardHtml(earlier[0]), /<em>Past<\/em>/);
  const later = app.sprintWindow('2026-01-01', 2, today, 6, 9);
  assert.ok(later.every(sprint => !sprint.current && !sprint.past));
  assert.equal(app.sprintWindow('2026-01-01', 2, today, 6, Number.MAX_SAFE_INTEGER).length, 0);
});

test('the Sprint strip disables its previous arrow at Sprint 1 with an explanatory tooltip', () => {
  const app = loadApp(); app.setState(stateWithHierarchy());
  const html = app.sprintPreviewHtml([], '2026-02-01', 2, app.parseDate('2026-01-20'));
  assert.match(html, /title="No earlier sprints"><button[^>]*data-sprint-page="-1"[^>]*disabled/);
  assert.match(html, /title="Show later sprints"><button[^>]*data-sprint-page="1"/);
  assert.equal((html.match(/data-sprint-card=/g) || []).length, 6);
  assert.doesNotMatch(app.sprintPreviewHtml([], '', 2), /data-sprint-page=/);
});

test('Sprint arrows browse six saved cards and reset for a different board or login session', () => {
  const app = loadApp(); const state = stateWithHierarchy();
  state.board.sprint_start_date = app.fmtIsoDate(app.addDays(app.startOfDay(new Date()), -196));
  app.setState(state); const planner = prepareSprintPlanner(app);
  const current = app.sprintWindow()[0].number;
  assert.match(planner.preview.innerHTML, new RegExp('data-sprint-card="' + current + '"'));
  app.pageSprintStrip(1);
  assert.equal(app.sprintStripFirstNumber(), current + 6);
  assert.match(planner.preview.innerHTML, new RegExp('data-sprint-card="' + (current + 6) + '"'));
  app.renderBoard();
  assert.match(app.elements.get('#board').innerHTML, new RegExp('data-sprint-card="' + (current + 6) + '"'));
  app.pageSprintStrip(-1); app.pageSprintStrip(-1); app.pageSprintStrip(-1); app.pageSprintStrip(-1);
  assert.equal(app.sprintStripFirstNumber(), 1);
  app.pageSprintStrip(-1);
  assert.equal(app.sprintStripFirstNumber(), 1);
  assert.match(planner.preview.innerHTML, /title="No earlier sprints"/);
  app.setState({...state, board: {...state.board, id: 2}}); app.selectBoard(2);
  assert.equal(app.sprintStripFirstNumber(), 0);
  app.pageSprintStrip(1); assert.equal(app.sprintStripFirstNumber(), current + 6);
  app.resetClientState(); app.setState(state);
  assert.equal(app.sprintStripFirstNumber(), 0);
  app.pageSprintStrip(1); state.board.sprint_weeks = 1;
  assert.equal(app.sprintStripFirstNumber(), 0);
});

test('paging Sprint cards preserves unsaved cadence fields and keeps jump and naming disabled', () => {
  const app = loadApp(); const state = stateWithHierarchy(); app.setState(state);
  const name = fakeElement(); name.dataset = {sprintName: '1', originalDisplay: 'Sprint 1'};
  const jump = fakeElement(); jump.dataset.sprintJump = '1';
  const next = fakeElement(); next.dataset.sprintPage = '1';
  const original = app.document.querySelectorAll;
  app.document.querySelectorAll = selector => selector === '.sprintNameInput' ? [name] : selector === '.sprintJump' ? [jump] : selector === '.sprintPageButton' ? [next] : original(selector);
  const planner = prepareSprintPlanner(app);
  planner.start.value = '2027-02-01'; planner.start.oninput();
  planner.weeks.value = '1.5'; planner.weeks.oninput();
  next.onclick();
  assert.equal(planner.start.value, '2027-02-01');
  assert.equal(planner.weeks.value, '1.5');
  assert.equal(state.board.sprint_start_date, '2026-01-01');
  assert.equal(name.disabled, true); assert.equal(jump.disabled, true);
  assert.equal(planner.status.textContent, 'Unsaved changes');
  assert.equal((planner.preview.innerHTML.match(/data-sprint-card=/g) || []).length, 6);
  app.setState({...state, board: {...state.board, id: 2}}); app.selectBoard(2);
  const preview = planner.preview.innerHTML; next.onclick();
  assert.equal(planner.preview.innerHTML, preview, 'stale paging controls cannot affect another board');
});

function timelineSurface(app, viewportWidth) {
  const root = app.document.querySelector('#timeline'); root.clientWidth = viewportWidth + 352;
  const scroll = fakeElement(); Object.assign(scroll, {clientWidth: viewportWidth, scrollLeft: 0, isConnected: true});
  const svg = fakeElement();
  root.querySelector = selector => selector === '.ganttSvgScroll' ? scroll : selector === '.ganttSvg' ? svg : null;
  return {root, scroll, svg};
}

test('focused Sprint geometry uses only its exact bounds and fits short and long Sprints on narrow viewports', () => {
  const app = loadApp(); app.setState(stateWithHierarchy());
  const tasks = [{start: app.parseDate('2000-01-01'), end: app.parseDate('2030-01-01'), delayEnd: app.parseDate('2031-01-01')}];
  for (const weeks of [1, 2, 52]) {
    const sprint = app.sprintByNumber(2, '2026-10-05', weeks);
    for (const viewport of [160, 300, 720]) {
      const geometry = app.timelineGeometry(tasks, sprint, viewport, 1);
      assert.equal(app.fmtIsoDate(geometry.rangeStart), app.fmtIsoDate(sprint.start));
      assert.equal(app.fmtIsoDate(geometry.rangeEnd), app.fmtIsoDate(sprint.endExclusive));
      assert.equal(geometry.totalDays, weeks * 7);
      assert.equal(geometry.timelineWidth, viewport);
      assert.equal(app.ganttPx(sprint.start, geometry.rangeStart, geometry.dayWidth), app.GANTT_LEFT_PAD);
      assert.ok(Math.abs(app.ganttPx(sprint.endExclusive, geometry.rangeStart, geometry.dayWidth) - (viewport - app.GANTT_RIGHT_PAD)) < 1e-8);
    }
  }
  const long = app.timelineGeometry(tasks, app.sprintByNumber(1, '2026-10-05', 52), 160, 1);
  assert.ok(long.dayWidth < 1, 'the normal ten-pixel minimum never forces focused Sprint overflow');
});

test('opening a Sprint resets manual zoom and uses the rendered calendar viewport instead of a desktop minimum', () => {
  const app = loadApp(); const state = stateWithHierarchy(); state.board.sprint_start_date = '2027-03-01';
  app.setState(state); app.selectBoard(1); const surface = timelineSurface(app, 160);
  app.renderGantt(surface.root);
  app.elements.get('#timelineZoom').value = '3'; app.elements.get('#timelineZoom').oninput();
  app.jumpToSprint(2);
  assert.equal(app.getView(), 'timeline'); assert.equal(app.window.location.hash, '#/timeline/1/sprint/2');
  assert.equal(surface.scroll.dataset.rangeStart, '2027-03-15');
  assert.equal(surface.scroll.dataset.rangeEnd, '2027-03-29');
  assert.equal(+surface.svg.getAttribute('width'), 160);
  assert.equal(+surface.scroll.dataset.timelineWidth, 160);
  assert.ok(+surface.scroll.dataset.dayWidth < 10);
  assert.equal(surface.scroll.scrollLeft, 0);
  assert.match(surface.root.innerHTML, /id="timelineZoom"[^>]*value="1"/);
  assert.match(surface.root.innerHTML, /100%/);
  assert.equal((surface.svg.innerHTML.match(/class="ganttSvgSprintLabel focused"/g) || []).length, 1);
  assert.doesNotMatch(surface.svg.innerHTML, /ganttSvgSprintLabel[^>]*>Sprint [13]</);
  app.elements.get('#timelineClearFocus').onclick();
  assert.equal(app.window.location.hash, '#/timeline/1');
  assert.doesNotMatch(surface.root.innerHTML, /timelineFocusBadge|ganttCalendarClip/);
  assert.doesNotMatch(surface.root.innerHTML, /<svg class="ganttSvg"[^>]*overflow="hidden"/);
  assert.match(surface.root.innerHTML, /data-range-start="2026-/);
  assert.match(surface.root.innerHTML, /id="timelineZoom"[^>]*value="1"/);
});

test('a focused Sprint deep link fits at 100% and refits when the calendar viewport shrinks', () => {
  const observers = [];
  class ResizeObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  const app = loadApp({resizeObserver: ResizeObserver}); const state = stateWithHierarchy();
  state.board.sprint_start_date = '2026-10-05'; app.setState(state); app.selectBoard(1);
  const surface = timelineSurface(app, 720);
  app.applyRoute({view: 'timeline', boardId: 1, ticketId: 0, sprintNumber: 1});
  assert.equal(surface.scroll.dataset.rangeStart, '2026-10-05');
  assert.equal(surface.scroll.dataset.rangeEnd, '2026-10-19');
  assert.equal(+surface.svg.getAttribute('width'), 720);
  assert.equal(observers[0].target, surface.scroll);
  surface.scroll.clientWidth = 160; observers[0].callback();
  assert.equal(+surface.svg.getAttribute('width'), 160);
  assert.ok(Math.abs(+surface.scroll.dataset.dayWidth - 56 / 14) < 1e-8);
  assert.equal(surface.scroll.scrollLeft, 0);
  const days = [...surface.svg.innerHTML.matchAll(/class="ganttSvgAxisDay"[^>]*>(\d+)<\/text>/g)].map(match => +match[1]);
  assert.ok(days.every(day => day >= 5 && day <= 18));
  assert.equal((surface.svg.innerHTML.match(/class="ganttSvgSprintLabel focused"/g) || []).length, 1);
  const cursor = app.ganttCursorAtX(160, app.parseDate('2026-10-05'), 14, 56 / 14, 160, 0, 160, 13);
  assert.equal(app.fmtIsoDate(cursor.date), '2026-10-18');
  app.elements.get('#timelineClearFocus').onclick();
  assert.equal(observers[0].disconnected, true);
  assert.equal(app.window.location.hash, '#/timeline/1');
});

test('focused calendar clipping hides padding fragments and due tags from tasks outside the Sprint', () => {
  const app = loadApp(); const state = stateWithHierarchy(); state.board.sprint_start_date = '2026-10-05';
  app.setState(state); app.jumpToSprint(1);
  const sprint = app.sprintByNumber(1); const geometry = app.timelineGeometry([], sprint, 300, 1);
  const history = app.ganttTask({...state.tickets[3], id: 31, startDate: '2026-10-03', dueDate: '2026-10-04', completedAt: '2026-10-04', links: []}); history.row = 0;
  const future = app.ganttTask({...state.tickets[3], id: 32, startDate: '2026-10-20', dueDate: '2026-10-21', completedAt: '2026-10-21', links: []}); future.row = 1;
  const html = app.ganttSvg([history, future], geometry.rangeStart, geometry.totalDays, geometry.dayWidth, 300, 56, 84, 168, 62);
  const clip = /<clipPath id="ganttCalendarClip"><rect x="88" y="56" width="([^"]+)" height="168"/.exec(html);
  assert.ok(clip); assert.ok(Math.abs(+clip[1] - 196) < 1e-8);
  assert.match(html, /<g class="ganttCalendarTasks" clip-path="url\(#ganttCalendarClip\)">/);
  const bar = app.ganttSvgTask(history, sprint.start, geometry.dayWidth, 56, 84, sprint);
  const rect = /class="ganttSvgBar [^"]+" x="([^"]+)"[^>]*width="([^"]+)"/.exec(bar);
  assert.ok(+rect[1] < app.GANTT_LEFT_PAD);
  assert.ok(+rect[1] + +rect[2] > 0 && +rect[1] + +rect[2] < app.GANTT_LEFT_PAD, 'only the SVG padding would have shown a historical fragment without the calendar clip');
  assert.doesNotMatch(bar, /ganttSvgDueLine|ganttSvgDueTagBg|ganttSvgDueTag"/);
  assert.doesNotMatch(app.ganttSvgTask(future, sprint.start, geometry.dayWidth, 56, 84, sprint), /ganttSvgDueLine|ganttSvgDueTagBg|ganttSvgDueTag"/);
  assert.match(html, /ganttSvgAxisDay/);
});

test('focused last-day due and estimated-finish badges fit inside the calendar while their marker keeps its date', () => {
  const app = loadApp(); const state = stateWithHierarchy(); state.board.sprint_start_date = '2026-10-05'; app.setState(state);
  const sprint = app.sprintByNumber(1);
  for (const viewport of [160, 300, 614]) {
    const geometry = app.timelineGeometry([], sprint, viewport, 1);
    for (const explicitDeadline of [true, false]) {
      const base = app.ganttTask({...state.tickets[3], links: [], startDate: '2026-10-17', dueDate: '2026-10-18', completedAt: '2026-10-18'});
      const task = {...base, ticket: {...base.ticket, dueDate: explicitDeadline ? '2026-10-18' : ''}, row: 0};
      const html = app.ganttSvgTask(task, sprint.start, geometry.dayWidth, 56, 84, sprint);
      const badge = /class="ganttSvgDueTagBg" x="([^"]+)"[^>]*width="([^"]+)"/.exec(html);
      const text = /class="ganttSvgDueTag" x="([^"]+)"[^>]*>([^<]+)<\/text>/.exec(html);
      const line = /class="ganttSvgDueLine" x1="([^"]+)" x2="([^"]+)"/.exec(html);
      assert.ok(badge); assert.ok(text); assert.ok(line);
      assert.ok(+badge[1] >= app.GANTT_LEFT_PAD); assert.ok(+badge[1] + +badge[2] <= viewport - app.GANTT_RIGHT_PAD + 1e-8);
      assert.ok(+text[1] > +badge[1]); assert.ok(+text[1] + text[2].length * 7 <= +badge[1] + +badge[2]);
      assert.equal(+line[1], app.ganttPx(task.due, sprint.start, geometry.dayWidth)); assert.equal(line[1], line[2]);
      assert.match(text[2], viewport === 160 ? /18 Oct/ : /2026-10-18/);
      if (viewport >= 300) assert.match(text[2], explicitDeadline ? /^Due / : /^Est\. finish /);
      // Whole-Timeline geometry keeps its existing right-of-marker badge placement.
      const full = app.ganttSvgTask(task, sprint.start, geometry.dayWidth, 56, 84);
      const fullBadge = /class="ganttSvgDueTagBg" x="([^"]+)"/.exec(full);
      assert.equal(+fullBadge[1], +line[1] + 7);
    }
  }
});

test('timeline centering converts dates and scroll offsets symmetrically', () => {
  const app = loadApp();
  const rangeStart = app.parseDate('2026-01-01');
  const target = app.parseDate('2026-01-21');
  const scroll = app.timelineScrollForDate(target, rangeStart, 20, 400, 1000);
  assert.equal(scroll, 288);
  assert.equal(app.fmtIsoDate(app.timelineDateAtScrollCenter(scroll, 400, rangeStart, 20)), '2026-01-21');
  assert.equal(app.timelineScrollForDate(rangeStart, rangeStart, 20, 400, 1000), 0);
  assert.equal(app.timelineScrollForDate(app.parseDate('2026-03-01'), rangeStart, 20, 400, 1000), 600);
});

test('timeline pointer drag pans horizontally and suppresses the following task click', () => {
  const app = loadApp();
  const classes = new Set();
  let captureClick = null;
  let prevented = false;
  let stopped = false;
  const scroll = {
    scrollLeft: 400,
    clientWidth: 500,
    dataset: { rangeStart: '2026-01-01', dayWidth: '20' },
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
    },
    addEventListener(name, listener) { if (name === 'click') captureClick = listener; },
    setPointerCapture() {},
    hasPointerCapture() { return false; },
  };
  const root = { querySelector: selector => selector === '.ganttSvgScroll' ? scroll : null };

  app.wireTimelinePan(root);
  scroll.onpointerdown({ button: 0, pointerId: 9, clientX: 500 });
  assert.equal(classes.has('isPanning'), true);
  scroll.onpointermove({ pointerId: 9, clientX: 650, preventDefault() { prevented = true; } });
  assert.equal(scroll.scrollLeft, 250);
  assert.equal(prevented, true);
  scroll.onpointerup({ pointerId: 9 });
  assert.equal(classes.has('isPanning'), false);
  captureClick({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
});

test('Timeline scheduling still waits for dependencies while its label stays inline', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  const target = state.tickets[2];
  target.startDate = '2026-01-01';
  target.dueDate = '2026-01-06';
  app.setState(state);
  const task = app.ganttTask(target);
  assert.equal(app.fmtIsoDate(task.start), '2026-01-03');
  assert.equal(app.fmtIsoDate(task.due), '2026-01-06');
  const label = app.ganttTaskLabel(task, 84);
  assert.match(label, /data-timeline-id="12"/);
  assert.match(label, /data-open-ticket="12"/);
  assert.doesNotMatch(label, /Show dependencies|selectedPath|pathDimmed|dependencySelection/);
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

test('Timeline labels and main bars use the same dependency controller and visible directed edges', () => {
  const {app, calls} = hoverApp(); const state = stateWithHierarchy();
  state.tickets.find(ticket => ticket.id === 13).links = [11];
  state.tickets.push({...state.tickets[2], id:15, title:'Immediate dependent', links:[12], parentId:0});
  state.tickets.push({...state.tickets[2], id:16, title:'Indirect dependent', links:[15], parentId:0});
  app.setState(state);
  const tasks = app.workTickets().map(ticket => ({ticket}));
  const root = fakeElement(); const layer = fakeElement();
  root.querySelector = selector => selector === '.ganttSvgScroll' ? layer : null;
  app.wireTimelineDependencies(root, tasks);
  assert.equal(calls.length, 1); assert.equal(calls[0].root, root);
  const options = calls[0].options;
  assert.equal(options.layerRoot, layer); assert.equal(options.anchorSelector, '.ganttSvgBar');
  assert.equal(options.obstaclesSelector, '.ganttSvgBar,.ganttSvgDueTagBg');
  assert.equal(options.idAttribute, 'data-timeline-id');
  assert.match(options.nodesSelector, /ganttTaskItem\[data-timeline-id\]/);
  assert.match(options.nodesSelector, /ganttSvgTask\[data-timeline-id\]/);
  assert.deepEqual(Array.from(options.edges, edge => edge.from + '>' + edge.to).sort(), ['11>13','12>15','13>12','15>16']);
  const filteredTasks = tasks.filter(task => [12,15].includes(task.ticket.id));
  app.wireTimelineDependencies(root, filteredTasks);
  assert.deepEqual(Array.from(calls[1].options.edges, edge => edge.from + '>' + edge.to), ['12>15']);
  assert.equal(app.getEditing(), null); assert.deepEqual(app.historyCalls, []);
});

test('Sprint cadence saves remain bound to the original board and ignore late results', async () => {
  const queue=deferredResponseQueue(); const app=loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); app.wireSprintPlanner();
  app.elements.get('#sprintStartDate').value='2026-01-01';
  app.elements.get('#sprintWeeks').value='2';
  const pending=app.elements.get('#saveSprintSettings').onclick();
  assert.equal(queue.pending[0].url,'/api/board-settings?boardId=1');
  assert.equal(app.elements.get('#sprintStartDate').disabled,true);
  const original=app.getState();
  app.selectBoard(2); queue.respond(0,{ok:true}); await pending;
  assert.equal(queue.pending.length,1);
  assert.equal(app.getState(),original);
});

test('delayed Sprint name handlers cannot save to a different board', () => {
  const queue=deferredResponseQueue(); const app=loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); prepareSprintPlanner(app);
  const input=fakeElement(); input.dataset={sprintName:'1',originalDisplay:'Sprint 1'}; input.value='Launch';
  const original=app.document.querySelectorAll;
  app.document.querySelectorAll=selector => selector === '.sprintNameInput' ? [input] : original(selector);
  app.wireSprintCards(true);
  app.selectBoard(2);
  input.onchange();
  assert.equal(queue.pending.length,0);
});

test('late Sprint name success or authentication errors cannot affect another board or session', async () => {
  for (const status of [200,401]) {
    const queue=deferredResponseQueue(); const app=loadApp({fetch:queue.fetch});
    app.setState(stateWithHierarchy()); prepareSprintPlanner(app);
    const input=fakeElement(); input.dataset={sprintName:'1',originalDisplay:'Sprint 1'}; input.value='Launch';
    const pending=app.saveSprintName(input);
    assert.equal(queue.pending[0].url,'/api/sprint-names?boardId=1');
    app.resetClientState();
    const next={...stateWithHierarchy(),board:{id:2},me:{id:9},sprintNames:[{sprintNumber:1,name:'Other board'}]};
    app.setState(next); queue.respond(0,status === 200 ? {ok:true} : 'login required',status); await pending;
    assert.equal(app.getState(),next);
    assert.equal(app.getState().sprintNames[0].name,'Other board');
    assert.equal(queue.pending.length,1);
  }
});

test('a Sprint name response cannot redraw old work while the requested board is loading', async () => {
  const queue=deferredResponseQueue(); const app=loadApp({fetch:queue.fetch});
  app.setState(stateWithHierarchy()); prepareSprintPlanner(app);
  const input=fakeElement(); input.dataset={sprintName:'1',originalDisplay:'Sprint 1'}; input.value='Launch';
  const pending=app.saveSprintName(input);
  const original=app.getState(); app.selectBoard(2);
  app.document.querySelector('#board').innerHTML='Loading board';
  queue.respond(0,{ok:true}); await pending;
  assert.equal(app.getState(),original);
  assert.equal(app.getState().sprintNames.length,0);
  assert.equal(app.elements.get('#board').innerHTML,'Loading board');
});

test('an already pending Sprint name save cannot discard a newer cadence draft', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch: queue.fetch});
  app.setState(stateWithHierarchy()); const planner = prepareSprintPlanner(app);
  const savedPreview = planner.preview.innerHTML;
  const name = fakeElement(); name.dataset = {sprintName: '1', originalDisplay: 'Sprint 1'}; name.value = 'Launch';
  const pending = app.saveSprintName(name);
  planner.start.value = '2026-10-22'; planner.start.oninput();
  queue.respond(0, {ok: true}); await pending;
  assert.equal(planner.start.value, '2026-10-22');
  assert.equal(planner.preview.innerHTML, savedPreview);
  assert.equal(planner.status.textContent, 'Unsaved changes');
  assert.equal(planner.status.dataset.state, 'unsaved');
  assert.equal(app.getState().sprintNames[0].name, 'Launch');
  assert.equal(name.dataset.originalDisplay, 'Launch');
});

test('a failed pending Sprint name save keeps its input disabled while cadence is dirty', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch: queue.fetch}); app.setState(stateWithHierarchy());
  const name = fakeElement(); name.dataset = {sprintName: '1', originalDisplay: 'Sprint 1'}; name.value = 'Launch';
  const original = app.document.querySelectorAll;
  app.document.querySelectorAll = selector => selector === '.sprintNameInput' ? [name] : original(selector);
  const planner = prepareSprintPlanner(app); const pending = app.saveSprintName(name);
  planner.start.value = '2026-10-22'; planner.start.oninput();
  queue.respond(0, 'Name save failed', 500); await pending;
  assert.equal(name.disabled, true); assert.equal(name.value, 'Sprint 1');
  assert.equal(planner.status.dataset.state, 'unsaved');
  assert.equal(planner.start.value, '2026-10-22');
  planner.start.value = '2026-01-01'; planner.start.oninput();
  assert.equal(name.disabled, false);
});

test('changing boards clears an unavailable Epic filter before calculating Timeline rows', () => {
  const app=loadApp(); const first=stateWithHierarchy(); app.setState(first);
  app.setTimelineEpicFilter('10');
  const next={...stateWithHierarchy(),board:{id:2},tickets:[{...first.tickets[3],id:22,title:'Work on the new board',links:[]}]};
  app.setState(next); app.selectBoard(2);
  const root=app.document.querySelector('#timeline'); root.clientWidth=1000;
  app.renderGantt(root);
  assert.match(root.innerHTML,/Work on the new board/);
  assert.doesNotMatch(root.innerHTML,/No tickets with schedulable dates yet/);
  assert.match(root.innerHTML,/<option value="all">All epics<\/option>/);
});

test('Timeline keeps delay rails separate from clipped labels and draws dependency lines only through explicit inspection', () => {
  const {app, calls} = hoverApp(); const state = stateWithHierarchy(); app.setState(state);
  const ticket = {...state.tickets[2], title:'A long task title that must stay inside its planned bar', links:[], startDate:'2000-01-01',dueDate:'2000-01-03'};
  const task = app.ganttTask(ticket); task.row=0;
  const start=app.parseDate('1999-12-31');
  const svg=app.ganttSvg([task],start,10,10,400,56,98,98,62);
  assert.doesNotMatch(svg,/ganttSvgArrow/);
  assert.match(svg,/class="ganttSvgLate"[^>]*y="129"[^>]*height="7"/);
  assert.match(svg,/class="ganttSvgEstimate"[^>]*y="129"[^>]*height="7"/);
  assert.doesNotMatch(svg,/class="ganttSvgBarText"/);
  const wide=app.ganttSvgTask(task,start,100,56,98);
  assert.match(wide,/clip-path="url\(#ganttTaskClip12\)"/);
  assert.equal(app.ganttSvgBarLabel(task,42),'');
  assert.ok(app.ganttSvgBarLabel(task,120).length <= Math.floor((120-18)/7));
  assert.match(app.ganttTaskLabel(task,98),/A long task title that must stay inside its planned bar/);
  const root=app.document.querySelector('#timeline'); root.clientWidth=1000;
  const layer = fakeElement();
  root.querySelector = selector => selector === '.ganttSvgScroll' ? layer : null;
  app.renderGantt(root);
  assert.equal(calls.length,1); assert.equal(calls[0].options.layerRoot,layer);
  assert.match(root.innerHTML,/Open Dependencies to inspect connections/);
  assert.doesNotMatch(root.innerHTML,/Show dependencies|dependencySelection|ganttSvgArrow|pathDimmed|hoverDimmed/);
});

test('timeline cursor snaps to days and keeps its date label in view', () => {
  const app = loadApp();
  const rangeStart = app.parseDate('2026-08-01');
  const cursor = app.ganttCursorAtX(212, rangeStart, 31, 10, 400);

  assert.equal(cursor.day, 12);
  assert.equal(cursor.x, 208);
  assert.equal(app.fmtIsoDate(cursor.date), '2026-08-13');
  assert.equal(cursor.label, '13 August');
  assert.equal(app.ganttCursorDateLabel(app.parseDate('2026-10-06')), '6 October');
  const edgeCursor = app.ganttCursorAtX(296, rangeStart, 31, 10, 400, 100, 300);
  assert.equal(edgeCursor.tagX + edgeCursor.tagWidth <= 296, true);
  assert.match(app.ganttSvgCursor(300), /class="ganttSvgCursorLine"/);
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
  const dependencyMarkup = app.overviewTable(state.tickets);
  assert.equal(dependencyMarkup.includes('<img src=x onerror=alert(1)>'), false);
  assert.equal(dependencyMarkup.includes('&lt;img src=x onerror=alert(1)&gt;'), true);
  assert.equal(markup.includes('&lt;b&gt;Task&lt;/b&gt;'), true);
  assert.equal(app.escAttr('"<&'), '&quot;&lt;&amp;');
  assert.equal(app.avatar('<x').includes('&lt;X'), true);
});

test('task focus keeps the complete chain and Epic context, excludes inactive work, and restores on second click', () => {
  const app=loadApp(); const state=stateWithHierarchy();
  state.tickets.push({...state.tickets[3],id:15,title:'Later',links:[12],completedAt:''},{...state.tickets[3],id:16,title:'Transitive',links:[15]},{...state.tickets[3],id:17,title:'Archived',links:[12],archivedAt:'2026-10-08'});
  app.setState(state); app.selectBoard(1); app.toggleDependencyFocus(12);
  assert.deepEqual([...app.dependencyFocusIds()].sort((a,b)=>a-b),[12,13,15,16]);
  assert.deepEqual(Array.from(app.planningWork(),t=>t.id).sort((a,b)=>a-b),[10,12,13,15,16]);
  for(const view of ['overview','timeline','board']) {
    app.navButtons.find(b=>b.dataset.view===view).onclick();
    assert.deepEqual([...app.dependencyFocusIds()].sort((a,b)=>a-b),[12,13,15,16]);
  }
  app.toggleDependencyFocus(12); assert.equal(app.dependencyFocusIds(),null);
  assert.ok(app.planningWork().some(t=>t.id===16));
});

test('connected focus includes predecessors, successors and joined branches without crossing inactive work', () => {
  const app = loadApp(); const state = stateWithHierarchy();
  const task = (id, links, extra = {}) => ({...state.tickets[3], id, ref: String(id), title: 'Task ' + id, parentId: 0, links, ...extra});
  state.tickets.push(task(15, [12]), task(16, [15, 19]), task(19, []), task(20, [16]),
    task(21, []), task(22, [20], {archivedAt: '2026-10-08'}), task(23, [22]),
    task(24, [20], {isBacklog: true}), task(25, [24]));
  app.setState(state); app.selectBoard(1); app.openDependencies(15);
  assert.deepEqual([...app.dependencyViewIds()].sort((a,b) => a-b), [12,13,15,16,19,20]);
  app.toggleDependencyFocus(15);
  assert.deepEqual(Array.from(app.planningWork(), t => t.id).sort((a,b) => a-b), [10,12,13,15,16,19,20]);
  app.toggleDependencyFocus(20);
  assert.deepEqual([...app.dependencyFocusIds()].sort((a,b) => a-b), [12,13,15,16,19,20]);
  app.showOtherTasks();
  assert.equal(app.dependencyFocusIds(), null);
  assert.ok(app.planningWork().some(t => t.id === 21));
  assert.deepEqual([...app.dependencyViewIds()].sort((a,b) => a-b), [12,13,15,16,19,20]);
});

test('Timeline preserves a connected chain through an undated empty Epic without saving assumed dates', () => {
  const {app, calls} = hoverApp(); const state = stateWithHierarchy();
  const ticket = {...state.tickets[3], columnId: 1, parentId: 0, completedAt: '', createdAt: '2026-10-01T10:00:00Z'};
  state.tickets = [
    {...ticket, id: 30, type: 'epic', title: 'Undated Epic', links: [31], startDate: '', dueDate: ''},
    {...ticket, id: 31, title: 'Source', links: [], startDate: '2026-10-01', dueDate: '2026-10-02'},
    {...ticket, id: 32, title: 'Target', links: [30], startDate: '2026-10-02', dueDate: '2026-10-03'},
  ];
  app.setState(state); app.selectBoard(1);
  assert.deepEqual(Array.from(app.buildGanttRows(), t => t.ticket.id), [31,32]);
  app.openDependencies(32);
  let rows = app.buildGanttRows(); assert.deepEqual(Array.from(rows, t => t.ticket.id).sort(), [30,31,32]);
  const root = fakeElement(); const layer = fakeElement(); root.querySelector = selector => selector === '.ganttSvgScroll' ? layer : null;
  app.wireTimelineDependencies(root, rows);
  assert.deepEqual(Array.from(calls.at(-1).options.edges, edge => edge.from + '>' + edge.to).sort(), ['30>32','31>30']);
  app.toggleDependencyFocus(32); rows = app.buildGanttRows();
  const range = app.dependencyTimelineRange(rows); const epic = rows.find(t => t.ticket.id === 30);
  assert.ok(range.start <= epic.start && range.endExclusive > epic.due);
  assert.equal(state.tickets[0].startDate, ''); assert.equal(state.tickets[0].dueDate, '');
  app.closeDependencies(); assert.deepEqual(Array.from(app.buildGanttRows(), t => t.ticket.id), [31,32]);
});

test('connected traversal terminates defensively even if stale data contains a dependency cycle', () => {
  const app = loadApp(); const state = stateWithHierarchy();
  state.tickets[3].links = [12];
  state.tickets.push({...state.tickets[3], id: 15, links: [12]});
  app.setState(state); app.selectBoard(1); app.toggleDependencyFocus(12);
  assert.deepEqual([...app.dependencyFocusIds()].sort((a,b) => a-b), [12,13,15]);
});

for (const targetView of ['board', 'overview', 'timeline']) {
  test(targetView + ' keeps the whole chain when focusing another task and exposes a highlighted return on every task', () => {
    const calls = []; const app = loadApp({hover: {wire(root, options) { calls.push(options); }}});
    const state = stateWithHierarchy();
    state.tickets.forEach(t => {t.createdAt = '2026-10-01T10:00:00Z';t.startDate = '2026-10-01';t.dueDate = '2026-10-04';});
    state.tickets.push({...state.tickets[3], id: 15, title: 'Task after Task', links: [12]},
      {...state.tickets[3], id: 16, title: 'Final task', links: [15]},
      {...state.tickets[3], id: 18, title: 'Unrelated task', links: []});
    app.setState(state); app.selectBoard(1); app.navButtons.find(b => b.dataset.view === targetView).onclick();
    const root = app.document.querySelector('#' + targetView); const layer = fakeElement();
    root.querySelector = selector => selector === '.boardSwimlanes,.tableScroll' || selector === '.ganttSvgScroll' ? layer : null;
    app.openDependencies(12); app.toggleDependencyFocus(12);
    assert.deepEqual([...app.dependencyFocusIds()].sort((a,b) => a-b), [12,13,15,16]);
    for (const id of [13,15,16]) assert.match(root.innerHTML, new RegExp('data-focus-related="' + id + '"'));
    assert.equal((root.innerHTML.match(/class="dependencyAction showOtherTasks"/g) || []).length, 4);
    assert.doesNotMatch(root.innerHTML, /Unrelated task/);
    app.toggleDependencyFocus(16);
    assert.deepEqual([...app.dependencyFocusIds()].sort((a,b) => a-b), [12,13,15,16]);
    assert.equal(calls.at(-1).selectedId, 16);
    assert.deepEqual(Array.from(calls.at(-1).edges, edge => edge.from + '>' + edge.to).sort(), ['12>15','13>12','15>16']);
    const restore = fakeElement(); root.querySelectorAll = selector => selector === '[data-show-other-tasks]' ? [restore] : [];
    app.wirePlanningActions(root); let stopped = false;
    restore.onclick({stopPropagation() {stopped = true;}});
    assert.equal(stopped, true); assert.equal(app.dependencyFocusIds(), null);
    assert.match(root.innerHTML, /Unrelated task/); assert.equal(calls.at(-1).selectedId, 16);
    app.closeDependencies(); assert.equal(calls.at(-1).selectedId, 0);
  });
}

test('showing other tasks preserves an unsaved editor until discard is accepted', () => {
  const app = loadApp(); app.setState(stateWithHierarchy()); app.selectBoard(1); app.toggleDependencyFocus(12);
  const fields = openEditor(app, 12); fields.dTitle.value = 'Unsaved'; app.setConfirm(() => false);
  app.showOtherTasks(); assert.ok(app.dependencyFocusIds()); assert.equal(app.getEditing().id, 12);
  app.setConfirm(() => true); app.showOtherTasks(); assert.equal(app.dependencyFocusIds(), null); assert.equal(app.getEditing(), null);
});

test('independent task focus hides other tasks and never restores archived Epic parents', () => {
  const app=loadApp(); const state=stateWithHierarchy(); state.tickets[0].archivedAt='2026-10-08'; state.tickets[2].links=[];
  app.setState(state); app.selectBoard(1); app.toggleDependencyFocus(12);
  assert.deepEqual(Array.from(app.planningWork(),t=>t.id),[12]);
  assert.equal(app.topEpicFor(state.tickets[2]),null);
  state.board.id=2; app.selectBoard(2); assert.equal(app.dependencyFocusIds(),null);
  state.board.id=1; app.selectBoard(1); app.resetClientState(true); assert.equal(app.dependencyFocusIds(),null);
});

test('Epic collapse hides descendants across Board, Overview and Timeline and keeps the group summary', () => {
  const app=loadApp(); const state=stateWithHierarchy(); state.tickets[1].dueDate='2026-01-04'; state.tickets[2].dueDate='2026-01-05';
  app.setState(state); app.selectBoard(1); app.toggleEpic(10);
  app.renderBoard(); const html=app.elements.get('#board').innerHTML;
  assert.match(html,/epicCollapsed/); assert.match(html,/aria-expanded="false"/); assert.doesNotMatch(html,/class="card[^>]*data-id="12"/);
  assert.deepEqual(Array.from(app.overviewGroupedRows(app.workTickets()),row=>row.ticket.id),[10,13]);
  assert.deepEqual(Array.from(app.buildGanttRows(),row=>row.ticket.id),[10,13]);
  app.toggleEpic(10);
  assert.ok(app.overviewGroupedRows(app.workTickets()).some(row=>row.ticket.id===12));
  assert.ok(app.buildGanttRows().some(row=>row.ticket.id===12));
});

test('focused Timeline fits all connected planned dates without months of overdue rail', () => {
  const app=loadApp(); app.setState(stateWithHierarchy()); app.selectBoard(1); app.toggleDependencyFocus(12);
  const tasks=[{plannedStart:app.parseDate('2026-01-01'),due:app.parseDate('2026-01-05'),delayEnd:app.parseDate('2026-10-08')},{plannedStart:app.parseDate('2026-01-03'),due:app.parseDate('2026-01-09')}];
  const range=app.dependencyTimelineRange(tasks); assert.equal(app.fmtIsoDate(range.start),'2025-12-31'); assert.equal(app.fmtIsoDate(range.endExclusive),'2026-01-11');
  const geometry=app.timelineGeometry(tasks,range,720,1); assert.equal(geometry.timelineWidth,720); assert.equal(geometry.totalDays,11);
});

test('Edit button preserves task editing separately from focus and stops card click propagation', () => {
  const app=loadApp(); app.setState(stateWithHierarchy()); const root=fakeElement(); const button=fakeElement(); button.dataset.editTicket='12';
  root.querySelectorAll=selector=>selector==='[data-edit-ticket]'?[button]:[];
  app.wirePlanningActions(root); let stopped=false; button.onclick({stopPropagation(){stopped=true;}});
  assert.equal(stopped,true); assert.equal(app.getEditing().id,12); assert.equal(app.dependencyFocusIds(),null);
});

test('opening a Sprint clears a pinned dependency focus and fits the selected Sprint', () => {
  const app=loadApp(); const state=stateWithHierarchy(); state.board.sprint_start_date='2026-10-05'; app.setState(state); app.selectBoard(1);
  const surface=timelineSurface(app,720); app.toggleDependencyFocus(12); app.jumpToSprint(2);
  assert.equal(app.dependencyFocusIds(),null); assert.equal(surface.scroll.dataset.rangeStart,'2026-10-19'); assert.equal(surface.scroll.dataset.rangeEnd,'2026-11-02');
  app.toggleDependencyFocus(12); app.applyRoute({view:'timeline',boardId:1,sprintNumber:1,ticketId:0});
  assert.equal(app.dependencyFocusIds(),null); assert.equal(surface.scroll.dataset.rangeStart,'2026-10-05');
});

test('focusing a task protects an unsaved editor and closes it only after accepted discard', () => {
  const app=loadApp(); const state=stateWithHierarchy(); app.setState(state); app.selectBoard(1); const fields=openEditor(app,12);
  fields.dTitle.value='Unsaved title'; app.setConfirm(()=>false);
  app.toggleDependencyFocus(13); assert.equal(app.dependencyFocusIds(),null); assert.equal(app.getEditing().id,12);
  app.setConfirm(()=>true); app.toggleDependencyFocus(13); assert.equal(app.getEditing(),null); assert.deepEqual([...app.dependencyFocusIds()].sort(),[12,13]);
});

for (const targetView of ['board','overview','timeline']) {
  test(targetView + ' exposes Dependencies, Focus tasks and Back as separate intentional actions', () => {
    const calls=[]; const app=loadApp({hover:{wire(root,options){calls.push({root,options});}}}); const state=stateWithHierarchy();
    state.tickets.forEach(t=>{t.createdAt='2026-10-01T10:00:00Z';t.startDate='2026-10-01';t.dueDate='2026-10-04';t.completedAt=t.completedAt?'2026-10-03':'';});
    state.tickets.push({...state.tickets[3],id:18,title:'Unrelated task',links:[]});
    app.setState(state); app.selectBoard(1); app.navButtons.find(b=>b.dataset.view===targetView).onclick();
    const root=app.document.querySelector('#'+targetView); const layer=fakeElement();
    root.querySelector=selector=>selector==='.boardSwimlanes,.tableScroll'||selector==='.ganttSvgScroll'?layer:null;
    const dep=fakeElement(),focus=fakeElement(),back=fakeElement(); dep.dataset.dependencies='12'; focus.dataset.focusRelated='12';
    root.querySelectorAll=selector=>selector==='[data-dependencies]'?[dep]:selector==='[data-focus-related]'?[focus]:selector==='[data-dependencies-back]'?[back]:[];
    app.wirePlanningActions(root); let stopped=0;const event={stopPropagation(){stopped++;}};
    dep.onclick(event); assert.equal(app.dependencyFocusIds(),null); assert.deepEqual([...app.dependencyViewIds()].sort(),[12,13]);
    assert.ok(app.planningWork().some(t=>t.id===18)); assert.equal(calls.at(-1).options.selectedId,12);
    assert.match(root.innerHTML,/data-focus-related="12"/);assert.match(root.innerHTML,/>Focus tasks<|>Focus tasks<\/button>/);assert.match(root.innerHTML,/data-dependencies-back/);
    assert.doesNotMatch(root.innerHTML,/dependencyFocusBar|Show all tasks|Hover to preview/);
    focus.onclick(event);assert.deepEqual([...app.dependencyFocusIds()].sort(),[12,13]);assert.ok(!app.planningWork().some(t=>t.id===18));
    assert.match(root.innerHTML,/class="dependencyAction showOtherTasks" data-show-other-tasks>Show other tasks/);
    assert.match(root.innerHTML,/data-focus-related="13"/);
    if(targetView==='timeline') {assert.match(root.innerHTML,/data-range-start="2026-09-30"/);assert.match(root.innerHTML,/data-range-end="2026-10-06"/);assert.match(root.innerHTML,/height:120px/);}
    back.onclick(event);assert.equal(app.dependencyViewIds(),null);assert.equal(app.dependencyFocusIds(),null);assert.ok(app.planningWork().some(t=>t.id===18));
    assert.equal(calls.at(-1).options.selectedId,0);assert.equal(stopped,3);
  });
}

test('dependency preview retains its source controls and neighbors through global and local filters', () => {
  const app=loadApp();const state=stateWithHierarchy();state.tickets.push({...state.tickets[3],id:18,title:'Unrelated',links:[],parentId:0});app.setState(state);app.selectBoard(1);app.openDependencies(12);
  app.document.querySelector('#search').value='Unrelated';app.renderBoard();
  assert.deepEqual(Array.from(app.planningWork(),t=>t.id).sort((a,b)=>a-b),[10,12,13,18]);assert.match(app.elements.get('#board').innerHTML,/data-focus-related="12"/);
  app.renderOverview();app.document.querySelector('#overviewSearch').value='Unrelated';app.document.querySelector('#overviewSearch').oninput();assert.match(app.elements.get('#overview').innerHTML,/data-focus-related="12"/);
  app.setTimelineEpicFilter('999');assert.ok(app.buildGanttRows().some(row=>row.ticket.id===13));
});

test('dependency preview opens related Epics and closes before a related Epic is collapsed', () => {
  const app=loadApp();app.setState(stateWithHierarchy());app.selectBoard(1);app.toggleEpic(10);app.openDependencies(12);
  assert.ok(app.overviewGroupedRows(app.workTickets()).some(row=>row.ticket.id===12));assert.deepEqual([...app.dependencyViewIds()].sort(),[12,13]);
  app.toggleEpic(10);assert.equal(app.dependencyViewIds(),null);assert.equal(app.dependencyFocusIds(),null);
  assert.ok(!app.overviewGroupedRows(app.workTickets()).some(row=>row.ticket.id===12));
});

test('Timeline labels and SVG rows use uniform additional action space on narrow viewports', () => {
  const app=loadApp();const state=stateWithHierarchy();state.tickets.forEach(t=>{t.createdAt='2026-10-01T10:00:00Z';t.startDate='2026-10-01';t.dueDate='2026-10-04';});app.setState(state);app.selectBoard(1);
  const root=app.document.querySelector('#timeline');
  for(const [width,height] of [[500,188],[800,156],[1200,120]]) {
    root.clientWidth=width;app.renderGantt(root);
    const tasks=app.buildGanttRows();assert.equal((root.innerHTML.match(new RegExp('style="height:'+height+'px;min-height:'+height+'px;max-height:'+height+'px"','g'))||[]).length,tasks.length);
    const svgHeights=[...root.innerHTML.matchAll(/<rect class="ganttSvgRow [^"]*"[^>]*height="(\d+)"/g)].map(match=>+match[1]);assert.equal(svgHeights.length,tasks.length);assert.ok(svgHeights.every(value=>value===height));
    const chartHeight=56+tasks.length*height+62;
    assert.ok(root.innerHTML.includes('--gantt-row-height:'+height+'px;--gantt-row-count:'+tasks.length+';--gantt-head-height:56px;--gantt-axis-height:62px;--gantt-chart-height:'+chartHeight+'px'));
    const bars=[...root.innerHTML.matchAll(/<rect class="ganttSvgBar [^"]*"[^>]*y="(\d+)"[^>]*height="(\d+)"/g)];assert.equal(bars.length,tasks.length);
    bars.forEach((bar,index)=>assert.equal(+bar[1]+ +bar[2]/2,56+(index+.5)*height));
    const dueBadges=[...root.innerHTML.matchAll(/<rect class="ganttSvgDueTagBg"[^>]*y="(\d+)"[^>]*height="(\d+)"/g)];assert.equal(dueBadges.length,tasks.length);
    dueBadges.forEach((badge,index)=>{assert.ok(+badge[1]>56+index*height);assert.ok(+badge[1]+ +badge[2]<=+bars[index][1]);});
  }
});

test('Timeline text tracks keep the axis after the same task rows as the SVG', () => {
  const css=fs.readFileSync(path.join(__dirname,'task-tools.css'),'utf8');
  assert.match(css,/\.ganttTaskPane\{[^}]*display:grid;[^}]*grid-template-rows:var\(--gantt-head-height\) calc\(var\(--gantt-row-count\) \* var\(--gantt-row-height\)\) var\(--gantt-axis-height\)/);
  assert.match(css,/\.ganttTaskPane\{[^}]*height:var\(--gantt-chart-height\)/);
  assert.match(css,/\.ganttTaskRows\{[^}]*grid-auto-rows:var\(--gantt-row-height\)/);
});

test('an empty focused Sprint keeps matching timeline header and axis heights without a phantom task row', () => {
  const app=loadApp();const state=stateWithHierarchy();state.tickets=[];app.setState(state);app.selectBoard(1);
  app.applyRoute({view:'timeline',boardId:1,ticketId:0,sprintNumber:1});const root=app.document.querySelector('#timeline');root.clientWidth=1200;app.renderGantt(root);
  assert.match(root.innerHTML,/--gantt-row-count:0;--gantt-head-height:56px;--gantt-axis-height:62px;--gantt-chart-height:118px/);
  assert.match(root.innerHTML,/<div class="ganttTaskRows"><\/div><div class="ganttTaskFoot">Timeline<\/div>/);
  assert.match(root.innerHTML,/<svg class="ganttSvg"[^>]*height="118"/);
  assert.doesNotMatch(root.innerHTML,/<rect class="ganttSvgRow /);
});
