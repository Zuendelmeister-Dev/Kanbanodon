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
    append() {}, before() {}, after() {}, insertAdjacentHTML() {},
    closest() { return this.parentElement; },
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
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'task-tools.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'route.js'), 'utf8'), context);
  let source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  source = source.replace(/\nload\(\);\s*$/, '\n');
  source += `\nwindow.__appTest = {
    load, resetClientState, renderView, boardBacklogPickerHtml, wireBoardBacklogPicker, overviewTable,
    applyRoute, openBacklogView, jumpToSprint, openTicket, closeDrawer, logout, saveDrawer, deleteTicket,
    addComment, taskDrawerAction, renderComments, renderDependencyOptions, importBoardFile, refreshNotifications,
    renderAdmin,
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
    boardDependencyHtml, workHoverRelatedIds, epicHoverRelatedIds, standaloneHoverRelatedIds, dependencyComponentIds,
    workDependencyEdges, workDependencyArrowGeometry,
    timelineRefParts, timelineDepth, topEpicFor, ganttBase, ganttTask, ganttEpicAggregate,
    timelineHighlight, timelineTaskHighlightClass, timelineHoverRelatedIds, timelineEpicHoverRelatedIds,
    ganttDelayText, ganttEstimateText, ganttSvgLate, ganttSvgEstimate, truncateSvgText, monthLabel, ganttPx,
    ganttCursorAtX, ganttCursorDateLabel, ganttSvgCursor, ganttArrowMidPoints, ganttSvgSprintBands,
    validDate, fmtIsoDate, addDays, addMonths, dayDiff, startOfDay, parseDate, dateFromCreated,
    boardSprintStartValue, boardSprintWeeks, validSprintWeeks, defaultSprintName, customSprintName, sprintRange, sprintByNumber, sprintWindow, sprintForDate, ticketPlannedFinish, ticketSprint,
    calculatedSprints, sprintName, sprintPreviewHtml, sprintPreviewCardHtml, shortRange,
    wireTimelinePan, timelineScrollForDate, timelineDateAtScrollCenter,
    fmtDate, shortDate, card, avatar, esc, escAttr,
    setState(value) { state = value; },
    setOverviewSort(value) { overviewSort = value; },
    setTimelineHighlightId(value) { timelineHighlightId = value; },
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

test('sprint preview validates editable cadence values independently from stored state', () => {
  const app = loadApp();
  const state = stateWithHierarchy();
  app.setState(state);

  assert.equal(app.validSprintWeeks(2), 2);
  assert.equal(app.validSprintWeeks(1.5), 0);
  assert.match(app.sprintPreviewHtml(app.workTickets(), '', 2), /Choose the first Sprint start date/);
  assert.match(app.sprintPreviewHtml(app.workTickets(), '2026-01-01', 0), /whole number from 1 to 52 weeks/);
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

test('timeline centering converts dates and scroll offsets symmetrically', () => {
  const app = loadApp();
  const rangeStart = app.parseDate('2026-01-01');
  const target = app.parseDate('2026-01-21');
  const scroll = app.timelineScrollForDate(target, rangeStart, 20, 400, 1000);
  assert.equal(scroll, 228);
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
