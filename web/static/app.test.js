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
    removeAttribute(name) { delete this[name]; },
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
  const navButtons = ['board', 'overview', 'timeline', 'history', 'backlog'].map(view => {
    const button = fakeElement();
    button.dataset.view = view;
    return button;
  });
  const body = fakeElement(); body.children = [];
  body.append = node => { body.children.push(node); node.parentNode = body; };
  const document = {
    body,
    visibilityState: 'visible',
    createElement: () => fakeElement(),
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, fakeElement());
      return elements.get(selector);
    },
    querySelectorAll(selector) {
      if (selector === '.navButton') return navButtons;
      if (selector === '#board,#overview,#list,#timeline,#history,#admin,#config,#stash') {
        return selector.split(',').map(id => document.querySelector(id));
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
  if (options.hover) window.KanbanodonDependencyHover = {...require('./dependency-hover.js'), ...options.hover};
  if (options.history) window.KanbanodonHistory = options.history;
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
    load, resetClientState, renderView, renderBoard, renderOverview, renderHistory, clearHistoryView, changeEpicCompletion, epicCompletionState, epicCompletionActionHtml, boardBacklogPickerHtml, wireBoardBacklogPicker, backlogRowHtml, overviewTable,
    applyRoute, openBacklogView, jumpToSprint, selectedPlanningSprint, selectPlanningSprint, clearPlanningSprint, openTicket, closeDrawer, logout, saveDrawer, deleteTicket,
    addComment, taskDrawerAction, renderComments, renderDependencyOptions, importBoardFile, refreshNotifications,
    renderAdmin,
    GANTT_LEFT_PAD, GANTT_RIGHT_PAD, planningWork, dependencyViewIds, openDependencies, closeDependencies, showOtherTasks, dependencyFocusIds, toggleDependencyFocus, toggleEpic, buildGanttRows, dependencyTimelineRange, wirePlanningActions, planningFocusHtml, renderTaskTools, setDependencySort, wireOverviewControls,
    filteredWork, filteredBacklog, taskChecklist, checklistProgress, checklistRowHTML, canLeaveDrawer,
    resetTaskFilters, activeTaskFilters, activeTaskFiltersHtml, wireTaskFilterActions,
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
    blockingTicketIds, dependencyTickets, dependentTickets, unfinishedDependencies, columnRequiresCompletedDependencies, boardMoveBlockedTasks, boardMoveBlockedReason, ticketDuration, durationLabel,
    boardSwimlaneData, boardLaneColumnItems, boardNormalGroupSort, boardCardDepth, wireDnD, boardDropPlacement, moveBoardTicket, overviewRows, overviewGroupedRows, overviewHierarchyDepth, overviewSortValue,
    boardDependencyHtml, dependencyHoverEdges, wireWorkDependencies, wireTimelineDependencies,
    timelineRefParts, timelineDepth, topEpicFor, ganttBase, ganttTask, ganttEpicAggregate,
    renderGantt, ganttTaskLabel, timelineGeometry, timelineVisibleWork, timelineSprintRowsFiltered, toggleTimelineSprintTasks, timelineControlsHtml, boardSwimlanes,
    ganttDelayText, ganttEstimateText, ganttSvg, ganttSvgTask, ganttSvgBarLabel, ganttSvgLate, ganttSvgEstimate, truncateSvgText, monthLabel, ganttPx,
    ganttCursorAtX, ganttCursorDateLabel, ganttSvgCursor, ganttSvgSprintBands, ganttSvgToday, ganttSvgAxis,
    validDate, fmtIsoDate, addDays, addMonths, dayDiff, startOfDay, parseDate, dateFromCreated,
    boardSprintStartValue, boardSprintWeeks, validSprintWeeks, defaultSprintName, customSprintName, sprintRange, sprintByNumber, sprintWindow, sprintForDate, ticketPlannedFinish, ticketSprint,
    calculatedSprints, sprintName, sprintPlannerHtml, sprintNavigationHtml, wireSprintNavigation, sprintPreviewHtml, sprintPreviewCardHtml, sprintStripFirstNumber, pageSprintStrip, shortRange,
    wireSprintPlanner, wireSprintCards, saveSprintName, sprintCadenceDirty, currentSessionGuard,
    wireBoardPan, wireTimelinePan, timelineScrollForDate, timelineDateAtScrollCenter,
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

function boardDragFixture(app, tickets, column = 1, epic = 0) {
  const drop = fakeElement(); drop.dataset = {col: String(column), epic: String(epic)};
  const cell = fakeElement(); const header = app.document.querySelector('.boardLaneColumnHead[data-col="' + column + '"]');
  drop.closest = () => cell;
  drop.getBoundingClientRect = () => ({top: 80, bottom: 80 + tickets.length * 140, height: tickets.length * 140});
  drop.contains = node => cards.includes(node);
  const cards = tickets.map((ticket, index) => {
    const card = fakeElement(); card.dataset = {id: String(ticket.id)};
    card.closest = selector => selector === '.boardLaneCell' ? cell : null;
    card.getBoundingClientRect = () => ({top:100+index*140,bottom:220+index*140,height:120});
    return card;
  });
  drop.querySelectorAll = selector => selector === '.card' ? cards : [];
  const markers = [];
  app.document.createElement = () => {
    const marker = fakeElement(); marker.properties = new Map();
    marker.style = {setProperty:(name,value) => marker.properties.set(name,value)};
    marker.remove = () => { marker.removed = true; };
    markers.push(marker); return marker;
  };
  drop.append = marker => { drop.marker = marker; };
  const transfer = {data: {}, setData(type,value) { this.data[type]=value; }, getData(type) { return this.data[type] || ''; }};
  const event = (target, y) => ({target, clientY:y, dataTransfer:transfer, prevented:false, preventDefault() { this.prevented=true; }});
  return {drop,cell,header,cards,markers,transfer,event};
}

test('Board insertion preview chooses first, middle, last and filtered neighbor anchors', () => {
  const app = loadApp();
  const tickets = [1,2,3].map(id => ({id}));
  const fixture = boardDragFixture(app,tickets);
  assert.deepEqual(JSON.parse(JSON.stringify(app.boardDropPlacement(fixture.drop,90,9))), {beforeId:1,afterId:0,top:12});
  assert.equal(app.boardDropPlacement(fixture.drop,250,9).beforeId,2);
  assert.equal(app.boardDropPlacement(fixture.drop,600,9).afterId,3);
  assert.equal(app.boardDropPlacement(fixture.drop,250,2).beforeId,3, 'the dragged card is never its own anchor');
  fixture.drop.querySelectorAll = () => [fixture.cards[0],fixture.cards[2]];
  assert.equal(app.boardDropPlacement(fixture.drop,600,9).afterId,3, 'bottom of filtered view anchors after the last visible task');
  fixture.drop.querySelectorAll = () => [];
  assert.deepEqual(JSON.parse(JSON.stringify(app.boardDropPlacement(fixture.drop,90,9))), {beforeId:0,afterId:0,top:14});
});

test('Board reference ties use the same natural numeric runs as the atomic move endpoint', () => {
  const app=loadApp();
  const refs=['A10','A2','1.1','1.01','A0002','A90071992547409930','A90071992547409929','İ2','i2'];
  const tickets=refs.map((ref,index)=>({id:index+1,ref,type:'task',columnId:1,position:0}));
  assert.deepEqual(Array.from(app.boardLaneColumnItems({items:tickets},1),t=>t.id),[3,4,2,5,1,7,6,9,8]);
  tickets.find(t=>t.id===6).position=-1;
  assert.equal(app.boardLaneColumnItems({items:tickets},1)[0].id,6,'manual position still takes precedence over reference ties');
});

test('Board drag marks the exact target position and destination column without changing hierarchy', async () => {
  const requests = [];
  const state = stateWithHierarchy();
  state.tickets = [1,2,3,4].map((id,index) => ({id,title:'Task '+id,ref:String(10-id),type:'task',columnId:id<3?1:5,parentId:0,position:index%2+1,labels:[],links:[]}));
  const app = loadApp({fetch:async(url,options) => {
    requests.push({url,options});
    if (url.endsWith('/move')) {
      const moved = state.tickets.find(ticket => ticket.id === 2); moved.columnId=5; moved.position=2;
      state.tickets.find(ticket => ticket.id===4).position=3;
      return {ok:true,text:async()=>'{}'};
    }
    return {ok:true,text:async()=>JSON.stringify(state)};
  }});
  app.setState(state); app.selectBoard(1);
  const source = boardDragFixture(app,state.tickets.filter(t=>t.columnId===1));
  const destination = boardDragFixture(app,state.tickets.filter(t=>t.columnId===5),5);
  const originalQueryAll = app.document.querySelectorAll;
  app.document.querySelectorAll = selector => selector === '.card' ? [...source.cards,...destination.cards] : selector === '.drop' ? [source.drop,destination.drop] : selector === '.boardDropTarget' ? [source.drop,destination.drop,source.cell,destination.cell,source.header,destination.header] : originalQueryAll(selector);
  app.wireDnD();
  const selected = source.cards[1];
  selected.ondragstart(source.event(selected,280));
  assert.equal(source.transfer.effectAllowed,'move');
  const over = destination.event(destination.drop,250); over.dataTransfer = source.transfer;
  destination.drop.ondragover(over);
  assert.equal(over.prevented,true);
  assert.equal(destination.drop.classList.contains('boardDropTarget'),true);
  assert.equal(destination.cell.classList.contains('boardDropTarget'),true);
  assert.equal(destination.header.classList.contains('boardDropTarget'),true);
  assert.equal(destination.drop.marker.className,'boardDropMarker');
  assert.equal(destination.drop.marker.properties.get('top'),'150px');
  await destination.drop.ondrop(over);
  assert.equal(requests[0].url,'/api/tickets/2/move');
  assert.deepEqual(JSON.parse(requests[0].options.body), {ColumnID:5,BeforeID:4,AfterID:0});
  assert.equal(requests[0].options.method,'POST');
  assert.deepEqual(Object.keys(JSON.parse(requests[0].options.body)).sort(),['AfterID','BeforeID','ColumnID']);
  assert.equal(requests[1].url,'/api/state?boardId=1');
  const lane = app.boardSwimlaneData(app.workTickets())[0];
  assert.deepEqual(Array.from(app.boardLaneColumnItems(lane,5), ticket=>ticket.id),[3,2,4], 'reload obeys saved positions rather than the old ticket reference order');
  assert.equal(app.getState().tickets.find(t=>t.id===2).parentId,0);
  assert.equal(destination.header.classList.contains('boardDropTarget'),false);
  selected.ondragend();
  assert.equal(selected.classList.contains('boardDragging'),false);
});

test('Board drag cannot move tasks into another Epic lane and cancels its preview', () => {
  const app = loadApp(); const state=stateWithHierarchy(); app.setState(state);
  const task=state.tickets.find(t=>t.id===12);
  const source=boardDragFixture(app,[task],1,10);
  const invalid=boardDragFixture(app,[],5,0);
  const original=app.document.querySelectorAll;
  app.document.querySelectorAll=selector=>selector==='.card'?source.cards:selector==='.drop'?[source.drop,invalid.drop]:selector==='.boardDropTarget'?[source.drop,source.cell,source.header]:original(selector);
  app.wireDnD(); source.cards[0].ondragstart(source.event(source.cards[0],110));
  const over=invalid.event(invalid.drop,100); over.dataTransfer=source.transfer;
  invalid.drop.ondragover(over);
  assert.equal(over.prevented,false);
  assert.equal(source.transfer.dropEffect,'none');
  assert.equal(invalid.markers.length,0);
  assert.equal(task.parentId,11);
});

test('dependency Board sorting disables manual drag until Normal order is selected', () => {
  const app=loadApp({hover:{wire(){}}}); const state=stateWithHierarchy(); app.setState(state); app.selectBoard(1);
  app.openDependencies(12);
  assert.match(app.planningFocusHtml(),/Choose Normal order to drag cards/);
  assert.match(app.card(state.tickets.find(t=>t.id===12)),/draggable="false"/);
  app.setDependencySort('normal');
  assert.match(app.card(state.tickets.find(t=>t.id===12)),/draggable="true"/);
  assert.doesNotMatch(app.planningFocusHtml(),/Choose Normal order to drag cards/);
});

test('Board prerequisites permit starting work but guard Review, Done and subsequent custom columns', () => {
  const app=loadApp(); const state=stateWithHierarchy();
  state.columns=['To Do','Ready','In Progress','Review','Done'].map((name,position)=>({id:position+1,name,position}));
  const task=state.tickets.find(t=>t.id===12), prerequisite=state.tickets.find(t=>t.id===13);
  prerequisite.columnId=2; task.links=[13,13]; app.setState(state);
  for (const column of [1,2,3]) assert.equal(app.boardMoveBlockedTasks(task,column).length,0);
  for (const column of [4,5]) assert.deepEqual(Array.from(app.boardMoveBlockedTasks(task,column),t=>t.id),[13]);
  state.columns.push({id:6,name:'Testing',position:4},{id:7,name:'Preparation',position:2});
  assert.equal(app.boardMoveBlockedTasks(task,6).length,1);
  assert.equal(app.boardMoveBlockedTasks(task,7).length,0);
  state.columns=state.columns.filter(c=>c.name!=='Review');
  assert.equal(app.boardMoveBlockedTasks(task,6).length,1,'without Review, custom stages after In Progress remain guarded');
  assert.equal(app.boardMoveBlockedTasks(task,3).length,0);
  state.columns=state.columns.filter(c=>c.name!=='In Progress');
  assert.equal(app.boardMoveBlockedTasks(task,6).length,1,'fully custom workflows guard stages from position 3 onward');
  task.columnId=6;
  assert.equal(app.boardMoveBlockedTasks(task,6).length,0,'sorting an existing card within a guarded column is still allowed');
  task.columnId=1; prerequisite.columnId=5;
  assert.equal(app.boardMoveBlockedTasks(task,6).length,0,'completed prerequisites allow the later move');
});

test('blocked Board drag highlights Review red and immediately shows all unfinished prerequisites', async () => {
  let requests=0;
  const app=loadApp({fetch:()=>{requests++;return new Promise(()=>{});}}), state=stateWithHierarchy();
  state.columns=['To Do','Ready','In Progress','Review','Done'].map((name,position)=>({id:position+1,name,position}));
  const task=state.tickets.find(t=>t.id===12), prerequisite=state.tickets.find(t=>t.id===13);
  prerequisite.columnId=2; prerequisite.title='Fern check <script>example</script>';
  const other={...prerequisite,id:15,ref:'15',title:'Coffee calibration',columnId:1};
  const done={...prerequisite,id:16,ref:'16',title:'Already completed',columnId:5};
  state.tickets.push(other,done); task.links=[13,15,16,13];
  app.setState(state); app.selectBoard(1);
  const source=boardDragFixture(app,[task],1,10), review=boardDragFixture(app,[],4,10), progress=boardDragFixture(app,[],3,10);
  const fixtures=[source,review,progress]; const original=app.document.querySelectorAll;
  app.document.querySelectorAll=selector=>selector==='.card'?source.cards:selector==='.drop'?fixtures.map(f=>f.drop):selector==='.boardDropTarget'?fixtures.flatMap(f=>[f.drop,f.cell,f.header]):original(selector);
  review.header.setAttribute('aria-describedby','existing-description');
  app.wireDnD(); source.cards[0].ondragstart(source.event(source.cards[0],110));
  const over=review.event(review.drop,120); over.dataTransfer=source.transfer; over.clientX=700;
  review.drop.ondragover(over);
  assert.equal(source.transfer.dropEffect,'none');
  for (const node of [review.drop,review.cell,review.header]) assert.equal(node.classList.contains('boardDropBlocked'),true);
  const activeTooltip=()=>app.document.body.children.findLast(node=>node.className==='boardDropBlockedTooltip'&&!node.removed);
  const tooltip=activeTooltip();
  assert.equal(tooltip.className,'boardDropBlockedTooltip');
  assert.equal(tooltip.getAttribute('role'),'tooltip');
  assert.match(tooltip.textContent,/Cannot move to Review/);
  assert.match(tooltip.textContent,/#2 Fern check <script>example<\/script>/);
  assert.match(tooltip.textContent,/#15 Coffee calibration/);
  assert.doesNotMatch(tooltip.textContent,/Already completed/);
  assert.equal(tooltip.innerHTML,'','ticket titles are text, never injected HTML');
  assert.equal((tooltip.textContent.match(/Fern check/g)||[]).length,1);
  assert.equal(review.header.getAttribute('aria-describedby'),'existing-description boardDropBlockReason');
  review.drop.ondragover(over);
  assert.equal(activeTooltip(),tooltip,'repeated drag events reuse the visible tooltip');
  tooltip.getBoundingClientRect=()=>({width:420,height:600});
  over.clientY=400;
  review.drop.ondragover(over);
  assert.equal(tooltip.properties.get('top'),'12px','a long list near the lower viewport half must not be translated above the screen');
  assert.equal(tooltip.properties.get('left'),'592px');
  const allowed=progress.event(progress.drop,120); allowed.dataTransfer=source.transfer;
  progress.drop.ondragover(allowed);
  assert.equal(source.transfer.dropEffect,'move');
  assert.equal(progress.drop.classList.contains('boardDropTarget'),true);
  assert.equal(progress.drop.marker.className,'boardDropMarker');
  assert.equal(tooltip.removed,true);
  assert.equal(review.header.classList.contains('boardDropBlocked'),false);
  assert.equal(review.header.getAttribute('aria-describedby'),'existing-description');
  review.drop.ondragover(over);
  await review.drop.ondrop(over);
  assert.equal(requests,0,'a known blocked drop sends no mutation');
  assert.equal(task.columnId,1);
  assert.match(app.elements.get('#formError').textContent,/Coffee calibration/);
  for (const node of [review.drop,review.cell,review.header]) assert.equal(node.classList.contains('boardDropBlocked'),false);
  review.drop.ondragover(over); const lastTooltip=activeTooltip();
  source.cards[0].ondragend();
  assert.equal(lastTooltip.removed,true);
  assert.equal(review.drop.getAttribute('aria-describedby'),null);
});

test('blocked drag feedback stays above the compact preview and clears after its lifetime', async t => {
  const endings = {
    dragend: (app, source) => source.cards[0].ondragend(),
    drop: (app, source, review, event) => review.drop.ondrop(event),
    rerender: app => app.renderView(),
    'session reset': app => app.resetClientState(),
  };
  for (const [name, endDrag] of Object.entries(endings)) await t.test(name, async () => {
    const app=loadApp(), state=stateWithHierarchy();
    state.columns=['To Do','Ready','In Progress','Review','Done'].map((name,position)=>({id:position+1,name,position}));
    const task=state.tickets.find(ticket=>ticket.id===12);
    task.title='Task <img src=x onerror=example()>';
    state.tickets.find(ticket=>ticket.id===13).columnId=2;
    app.setState(state); app.selectBoard(1);
    const source=boardDragFixture(app,[task],1,10), review=boardDragFixture(app,[],4,10);
    const original=app.document.querySelectorAll.bind(app.document);
    app.document.querySelectorAll=selector=>selector==='.card'?source.cards:selector==='.drop'?[source.drop,review.drop]:selector==='.boardDropTarget'?[source.drop,source.cell,source.header,review.drop,review.cell,review.header]:original(selector);
    let nativeImage, topLayerShows=0;
    source.transfer.setDragImage=(...args)=>{nativeImage=args;};
    const createElement=app.document.createElement;
    app.document.createElement=tag=>{
      const element=createElement(tag);
      element.showPopover=()=>{topLayerShows++;};
      return element;
    };
    app.wireDnD();
    const start=source.event(source.cards[0],180); start.clientX=350;
    source.cards[0].ondragstart(start);
    const pixel=app.document.body.children.find(node=>node.className==='boardNativeDragImage');
    const preview=app.document.body.children.find(node=>node.className==='boardDragPreview');
    assert.deepEqual(nativeImage,[pixel,0,0],'the native drag image must not contain a card that covers the tooltip');
    assert.equal(pixel.width,1); assert.equal(pixel.height,1);
    assert.equal(preview.textContent,'#10.1.1 '+task.title);
    assert.equal(preview.innerHTML,'','the compact preview treats titles as plain text');
    assert.equal(preview.parentNode,app.document.body);
    assert.equal(preview.properties.get('left'),'366px');
    const over=review.event(review.drop,250); over.clientX=350; over.dataTransfer=source.transfer;
    review.drop.ondragover(over);
    const tooltip=app.document.body.children.find(node=>node.className==='boardDropBlockedTooltip');
    assert.equal(tooltip.parentNode,app.document.body,'tooltip must escape faded cards and column stacking contexts');
    assert.equal(tooltip.getAttribute('popover'),'manual');
    assert.equal(topLayerShows,1,'supported browsers place the tooltip in their top layer');
    assert.equal(tooltip.properties.get('top'),'268px');
    assert.equal(preview.properties.get('top'),'204px');
    assert.equal(review.drop.marker,undefined,'a blocked drop must not show an insertion line');
    await endDrag(app,source,review,over);
    for (const node of [pixel,preview,tooltip]) assert.equal(node.removed,true,name+' must remove every temporary layer');
    assert.equal(review.drop.classList.contains('boardDropBlocked'),false);
    assert.equal(review.header.getAttribute('aria-describedby'),null);
  });
});

test('failed Board move preserves order and editor discard Cancel sends no request', async () => {
  const requests=[];
  const app=loadApp({fetch:async(url,options)=>{requests.push({url,options});return {ok:false,status:409,text:async()=>'blocked by unfinished dependencies'};}});
  const state=stateWithHierarchy(); app.setState(state); app.selectBoard(1);
  const ticket=state.tickets.find(t=>t.id===12), before=JSON.stringify(state.tickets);
  await app.moveBoardTicket(ticket,5,{beforeId:0,afterId:13});
  assert.equal(JSON.stringify(state.tickets),before);
  assert.match(app.elements.get('#formError').textContent,/blocked by unfinished dependencies/);
  assert.equal(requests.length,1,'failed move needs no additional mutating request or optimistic rollback');
  app.setDraft(ticket,'different snapshot'); app.setConfirm(()=>false);
  await app.moveBoardTicket(ticket,5,{beforeId:0,afterId:13});
  assert.equal(requests.length,1);
  assert.equal(app.getEditing().id,12);
});

test('late Board move completion does not reload or show errors over another board or session', async () => {
  const pending=deferredResponseQueue(); const app=loadApp({fetch:pending.fetch}); const state=stateWithHierarchy(); app.setState(state); app.selectBoard(1);
  const promise=app.moveBoardTicket(state.tickets.find(t=>t.id===12),5,{beforeId:0,afterId:13});
  app.selectBoard(2);
  pending.respond(0,{});
  await promise;
  assert.equal(pending.pending.length,1,'an old board completion must not refresh the newly selected board');
  app.selectBoard(1);
  const rejected=app.moveBoardTicket(state.tickets.find(t=>t.id===12),5,{beforeId:0,afterId:13});
  app.resetClientState();
  pending.respond(1,'blocked by unfinished dependencies',409);
  await rejected;
  assert.equal(app.elements.get('#formError').textContent,'');
});

test('Board drag ignores external transfers and stale controls while another board is loading', async () => {
  let requests=0;
  const app=loadApp({fetch:()=>{requests++;return new Promise(()=>{});}});
  const state=stateWithHierarchy(); app.setState(state); app.selectBoard(1);
  const task=state.tickets.find(t=>t.id===12), fixture=boardDragFixture(app,[task],1,10);
  const original=app.document.querySelectorAll;
  app.document.querySelectorAll=selector=>selector==='.card'?fixture.cards:selector==='.drop'?[fixture.drop]:original(selector);
  app.wireDnD();
  fixture.transfer.setData('text/plain','12');
  await fixture.drop.ondrop(fixture.event(fixture.drop,110));
  assert.equal(requests,0,'an external text transfer is not a Board card drag');
  app.selectBoard(2);
  const start=fixture.event(fixture.cards[0],110);
  fixture.cards[0].ondragstart(start);
  assert.equal(start.prevented,true);
  await app.moveBoardTicket(task,5,{beforeId:0,afterId:13});
  assert.equal(requests,0,'the pending-board guard must run before editor closure or sending a move');
});

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
  app.openTicket(12);
  assert.match(app.elements.get('#drawer').innerHTML, /Review and completion require these tickets to be done/);
  assert.doesNotMatch(app.elements.get('#drawer').innerHTML, /Can start after/);
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
  assert.match(html,/<section class="panel sprintPlanner"[^>]*>/);
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
  assert.equal((bands.match(/<line class="ganttSvgSprintBoundary/g) || []).length, 3, 'both ends and the shared boundary are visible');
});

test('Sprint boundaries include the cadence start and appear once at shared dates with readable ranges', () => {
  const app = loadApp(); const state = stateWithHierarchy();
  state.board.sprint_start_date = '2026-10-05'; state.board.sprint_weeks = 2;
  state.sprintNames = [{boardId: 1, sprintNumber: 1, name: 'First <Sprint> & launch'}];
  app.setState(state);
  const start = app.parseDate('2026-10-01');
  const markup = app.ganttSvgSprintBands(start, 33, 10, 56, 240, 296, 62);
  const dates = [...markup.matchAll(/data-sprint-boundary-date="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(dates, ['2026-10-05', '2026-10-19', '2026-11-02']);
  assert.equal(new Set(dates).size, dates.length, 'adjacent Sprints share one boundary instead of two overlaid strokes');
  assert.match(markup, /<line class="ganttSvgSprintBoundary" x1="128" x2="128" y1="56" y2="358"/);
  assert.match(markup, /starts 2026-10-05/);
  assert.match(markup, /ends 2026-10-18/);
  assert.match(markup, /ganttSvgSprintRange[^>]*>05 Oct – 18 Oct/);
  assert.match(markup, /First &lt;Sprint&gt; &amp; launch/);
  assert.doesNotMatch(markup, /<Sprint>/);
  assert.doesNotMatch(markup, /\bstyle=/);
  const cut = app.ganttSvgSprintBands(app.parseDate('2026-10-08'), 20, 10, 56, 240, 296, 62);
  assert.deepEqual([...cut.matchAll(/data-sprint-boundary-date="([^"]+)"/g)].map(match => match[1]), ['2026-10-19'], 'a partial Sprint does not invent a boundary at the viewport edge');
  state.board.sprint_weeks = 0;
  assert.equal(app.ganttSvgSprintBands(start, 33, 10, 56, 240, 296, 62), '', 'an invalid cadence cannot hang the band loop');
});

test('a focused Sprint shows both exact boundary dates even in a narrow viewport', () => {
  const app = loadApp(); const state = stateWithHierarchy(); state.board.sprint_start_date = '2026-10-05';
  app.setState(state); app.selectBoard(1); app.applyRoute({view: 'timeline', boardId: 1, ticketId: 0, sprintNumber: 2});
  const start = app.parseDate('2026-10-19');
  const markup = app.ganttSvgSprintBands(start, 14, 4, 56, 240, 296, 62);
  assert.deepEqual([...markup.matchAll(/data-sprint-boundary-date="([^"]+)"/g)].map(match => match[1]), ['2026-10-19', '2026-11-02']);
  const lines = [...markup.matchAll(/<line class="ganttSvgSprintBoundary focused" x1="([^"]+)" x2="([^"]+)"/g)];
  assert.deepEqual(lines.map(match => +match[1]), [88, 144]);
  assert.equal(lines.every(match => match[1] === match[2]), true);
  assert.equal((markup.match(/class="ganttSvgSprintLabel focused"/g) || []).length, 1);
  assert.match(markup, /Sprint 2 · 2026-10-19 to 2026-11-01/, 'the complete inclusive range is available in a native tooltip when the short header cannot fit');
  assert.doesNotMatch(markup, /class="ganttSvgSprintRange/, 'narrow header text cannot run into the next Sprint');
});

test('Today is a fixed local-day line with a date label and is omitted outside the calendar interval', () => {
  const app = loadApp();
  const start = app.parseDate('2026-10-05');
  const today = new Date(2026, 9, 8, 23, 57);
  const markup = app.ganttSvgToday(start, 14, 20, 500, 56, 358, today);
  assert.match(markup, /data-today-date="2026-10-08"/);
  assert.match(markup, /aria-label="Today · 2026-10-08"/);
  assert.match(markup, /<line class="ganttSvgTodayLine" x1="148" x2="148" y1="56" y2="358"/);
  assert.match(markup, /ganttSvgTodayHalo/);
  assert.match(markup, /class="ganttSvgTodayText"[^>]*>Today · 2026-10-08<\/text>/);
  assert.doesNotMatch(markup, /ganttSvgCursor|\bstyle=|visible/);
  assert.equal(app.ganttSvgToday(start, 14, 20, 500, 56, 358, app.parseDate('2026-10-04')), '');
  assert.equal(app.ganttSvgToday(start, 14, 20, 500, 56, 358, app.parseDate('2026-10-19')), '', 'the end date belongs to the next Sprint');
  assert.match(app.ganttSvgToday(start, 14, 20, 500, 56, 358, start), /x1="88" x2="88"/);
  const narrow = app.ganttSvgToday(start, 14, 4, 160, 56, 358, today);
  const tag = /class="ganttSvgTodayTag" x="([^"]+)"[^>]*width="([^"]+)"/.exec(narrow);
  assert.ok(+tag[1] >= 4 && +tag[1] + +tag[2] <= 156, 'the permanent date label fits inside a narrow SVG');
  assert.match(narrow, />Today · 2026-10-08<\/text>/);
  const localToday = app.startOfDay(new Date());
  const current = app.ganttSvgToday(app.addDays(localToday, -1), 3, 20, 500, 56, 358);
  assert.match(current, new RegExp('data-today-date="' + app.fmtIsoDate(localToday) + '"'), 'the default marker uses the current local day');
});

test('calendar foreground marks stay above task bars without changing track dimensions or cursor behavior', () => {
  const app = loadApp(); const state = stateWithHierarchy();
  const today = app.startOfDay(new Date());
  state.board.sprint_start_date = app.fmtIsoDate(today);
  app.setState(state);
  const ticket = {id: 100, ref: '100', title: 'Current work', type: 'task', duration: 2, startDate: app.fmtIsoDate(today), dueDate: app.fmtIsoDate(app.addDays(today, 2)), links: []};
  const task = {...app.ganttTask(ticket), row: 0};
  const markup = app.ganttSvg([task], today, 14, 20, 500, 56, 120, 120, 62);
  const bar = markup.indexOf('class="ganttSvgBar ');
  assert.ok(markup.indexOf('class="ganttSvgSprintBand ') < bar, 'Sprint shading stays behind task colors');
  assert.ok(markup.indexOf('class="ganttSvgSprintBoundary"') > bar, 'task bars cannot cover Sprint boundaries');
  assert.ok(markup.indexOf('class="ganttSvgToday"') > bar, 'the Today line stays visible through task bars');
  assert.ok(markup.indexOf('class="ganttSvgToday"') < markup.indexOf('class="ganttSvgCursor"'), 'the existing pointer cursor remains independently rendered');
  assert.ok(markup.indexOf('class="ganttSvgAxisDay"') > markup.indexOf('class="ganttSvgToday"'), 'permanent calendar lines cannot paint over axis dates');
  assert.match(markup, /class="ganttSvgTodayLine"[^>]*y1="56" y2="238"/);
  assert.match(markup, /class="ganttSvgRow odd"[^>]*y="56"[^>]*height="120"/);
  assert.match(markup, /class="ganttSvgSprintLabel"[^>]*y="39"/);
  assert.match(markup, /class="ganttSvgSprintRange"[^>]*y="51"/);
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
  assert.ok(html.includes(savedPreview), 'Sprint cards continue to use the saved cadence');
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

for (const targetView of ['board', 'overview', 'timeline']) {
  test(targetView + ' explains the actual graduated stages and preserves their colors when focusing a different task', () => {
    const app = loadApp({hover: {wire() {}}}); const state = stateWithHierarchy();
    const task = {...state.tickets[3], parentId: 0, columnId: 1, completedAt: '', createdAt: '2026-10-01T10:00:00Z'};
    state.tickets = Array.from({length: 6}, (_, index) => ({...task, id: 41 + index, title: 'Chain task ' + (index + 1), links: index ? [40 + index] : []}));
    state.tickets.push({...task, id: 47, title: 'Parallel stage two', links: [41]});
    for (let index = 0; index < 10; index++) state.tickets.push({...task, id: 101 + index, title: 'Separate chain ' + index, links: index ? [100 + index] : []});
    app.setState(state); app.selectBoard(1); app.navButtons.find(button => button.dataset.view === targetView).onclick();
    app.openDependencies(43);
    const legend = app.planningFocusHtml();
    const stages = [...legend.matchAll(/class="dependencyStageKey" data-dependency-color="(#[0-9a-f]{6})" title="Stage (\d+)/g)].map(match => ({step: +match[2], color: match[1]}));
    assert.deepEqual(stages.map(item => item.step), [1,2,3,4,5,6]);
    assert.equal(stages[0].color, '#60a5fa'); assert.equal(stages[2].color, '#f4b83f'); assert.equal(stages[5].color, '#37c7ad');
    assert.equal(new Set(stages.map(item => item.color)).size, 6);
    assert.match(legend, /Stage 1 · start/); assert.match(legend, /Stage 3 · middle/); assert.match(legend, /Stage 6 · end/);
    assert.doesNotMatch(legend, /Stages 1, 4|Stages 2, 5|Stages 3, 6/);
    assert.ok(app.document.querySelector('#' + targetView).innerHTML.includes(legend));
    app.toggleDependencyFocus(46);
    assert.deepEqual([...app.planningFocusHtml().matchAll(/class="dependencyStageKey"[^>]+/g)].map(match => match[0]), [...legend.matchAll(/class="dependencyStageKey"[^>]+/g)].map(match => match[0]));
    app.showOtherTasks(); assert.deepEqual([...app.planningFocusHtml().matchAll(/class="dependencyStageKey"[^>]+/g)].map(match => match[0]), [...legend.matchAll(/class="dependencyStageKey"[^>]+/g)].map(match => match[0]));
    app.closeDependencies(); assert.equal(app.planningFocusHtml(), '');
  });
}

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
    assert.match(root.innerHTML,/dependencyFocusBar/);
    assert.match(root.innerHTML,/Back to normal view/);
    assert.doesNotMatch(root.innerHTML,/Show all tasks|Hover to preview/);
    focus.onclick(event);assert.deepEqual([...app.dependencyFocusIds()].sort(),[12,13]);assert.ok(!app.planningWork().some(t=>t.id===18));
    assert.match(root.innerHTML,/class="dependencyAction showOtherTasks" data-show-other-tasks>Show other tasks/);
    assert.match(root.innerHTML,/data-focus-related="13"/);
    if(targetView==='timeline') {assert.match(root.innerHTML,/data-range-start="2026-09-30"/);assert.match(root.innerHTML,/data-range-end="2026-10-06"/);assert.match(root.innerHTML,/data-row-height="120"/);}
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
  const sizes=new Map();root.style={setProperty(name,value){sizes.set(name,value);}};
  for(const [width,height] of [[500,188],[800,156],[1200,120]]) {
    root.clientWidth=width;app.renderGantt(root);
    const tasks=app.buildGanttRows();assert.equal((root.innerHTML.match(new RegExp('class="ganttTaskItem[^\"]*"[^>]*data-row-height="'+height+'"','g'))||[]).length,tasks.length);
    const svgHeights=[...root.innerHTML.matchAll(/<rect class="ganttSvgRow [^"]*"[^>]*height="(\d+)"/g)].map(match=>+match[1]);assert.equal(svgHeights.length,tasks.length);assert.ok(svgHeights.every(value=>value===height));
    const chartHeight=56+tasks.length*height+62;
    assert.ok(root.innerHTML.includes('class="ganttChart" data-row-height="'+height+'" data-row-count="'+tasks.length+'" data-chart-height="'+chartHeight+'"'));
    assert.equal(sizes.get('--gantt-row-height'),height+'px');
    assert.equal(sizes.get('--gantt-row-count'),String(tasks.length));
    assert.equal(sizes.get('--gantt-chart-height'),chartHeight+'px');
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
  assert.match(root.innerHTML,/data-row-height="120" data-row-count="0" data-chart-height="118"/);
  assert.match(root.innerHTML, /No work planned in Sprint 1/);
  assert.match(root.innerHTML,/<div class="ganttTaskRows"><\/div><div class="ganttTaskFoot">Timeline<\/div>/);
  assert.match(root.innerHTML,/<svg class="ganttSvg"[^>]*height="118"/);
  assert.doesNotMatch(root.innerHTML,/<rect class="ganttSvgRow /);
});

function stateWithSprintAssignments() {
  const state = stateWithHierarchy();
  const task = (id, title, extra = {}) => ({
    id, ref: String(id), title, body: '', type: 'task', columnId: 1,
    parentId: 10, position: id, duration: 0, labels: [], links: [],
    createdAt: '2026-01-01T10:00:00Z', ...extra,
  });
  state.tickets.forEach(ticket => { ticket.createdAt = '2026-01-01T10:00:00Z'; });
  Object.assign(state.tickets[0], {dueDate: '2026-02-02'});
  Object.assign(state.tickets[1], {dueDate: '2026-01-03'});
  Object.assign(state.tickets[2], {dueDate: '2026-01-20'});
  Object.assign(state.tickets[4], {dueDate: '2026-01-03'});
  state.tickets.push(
    task(15, 'Unscheduled work'),
    task(16, 'Before the first sprint', {dueDate: '2025-12-31'}),
    task(17, 'Derived finish date', {startDate: '2026-01-17', duration: 3}),
    task(18, 'Archived sprint task', {dueDate: '2026-01-20', archivedAt: '2026-01-21'}),
    task(19, 'Trashed sprint task', {dueDate: '2026-01-20', deletedAt: '2026-01-21'}),
    task(20, 'Backlog sprint task', {dueDate: '2026-01-20', isBacklog: true}),
    task(21, 'Empty dated epic', {type: 'epic', parentId: 0, dueDate: '2026-01-20'}),
    task(22, 'Epic scheduled in another sprint', {type: 'epic', parentId: 0, dueDate: '2026-01-03'}),
    task(23, 'Sprint two child', {parentId: 22, dueDate: '2026-01-15'}),
  );
  return state;
}

const planningIds = app => Array.from(app.planningWork(), ticket => ticket.id).sort((a, b) => a - b);

for (const targetView of ['board', 'overview']) {
  test(targetView + ' selects a Sprint locally and filters assigned tasks while preserving Epic context', () => {
    const app = loadApp(); const state = stateWithSprintAssignments();
    app.setState(state); app.selectBoard(1);
    app.navButtons.find(button => button.dataset.view === targetView).onclick();
    const all = planningIds(app);
    assert.equal(app.selectedPlanningSprint(), null, 'the current Sprint window does not implicitly filter tasks');
    assert.ok(all.includes(15) && all.includes(16), 'undated and pre-cadence work remains visible by default');
    app.selectPlanningSprint(2);
    assert.equal(app.getView(), targetView, 'Sprint selection must keep the current workspace');
    assert.equal(app.selectedPlanningSprint().number, 2);
    assert.equal(app.window.location.hash, '#/' + targetView + '/1/sprint/2');
    assert.deepEqual(planningIds(app), [10, 12, 17, 21, 22, 23]);
    const html = app.elements.get('#' + targetView).innerHTML;
    for (const id of [12, 17, 23]) assert.match(html, new RegExp('data-work-id="' + id + '"'));
    for (const id of [11, 13, 15, 16, 18, 19, 20]) assert.doesNotMatch(html, new RegExp('data-work-id="' + id + '"'));
    app.selectPlanningSprint(1);
    assert.deepEqual(planningIds(app), [10, 11, 13]);
    assert.ok(!planningIds(app).includes(22), 'an Epic date alone cannot bring in children from another Sprint');
    app.selectPlanningSprint(1);
    assert.equal(app.selectedPlanningSprint(), null, 'clicking the selected Sprint restores all Sprints');
    assert.deepEqual(planningIds(app), all);
    assert.equal(app.window.location.hash, '#/' + targetView + '/1');
  });

  test(targetView + ' keeps normal search filters and cannot leak other Sprints through dependencies', () => {
    const app = loadApp(); app.setState(stateWithSprintAssignments()); app.selectBoard(1);
    app.navButtons.find(button => button.dataset.view === targetView).onclick();
    app.openDependencies(12); app.toggleDependencyFocus(12);
    app.selectPlanningSprint(2);
    assert.equal(app.dependencyViewIds(), null);
    app.openDependencies(12); app.toggleDependencyFocus(12);
    assert.ok(planningIds(app).includes(12));
    assert.ok(!planningIds(app).includes(13), 'the prerequisite assigned to Sprint 1 stays outside the Sprint 2 filter');
    app.clearPlanningSprint();
    assert.equal(app.dependencyViewIds(), null, 'All sprints must also remove dependency isolation');
    assert.ok(planningIds(app).includes(15));
    app.document.querySelector('#search').value = 'Derived finish';
    app.selectPlanningSprint(2);
    assert.deepEqual(planningIds(app), [10, 17]);
    assert.equal(app.document.querySelector('#search').value, 'Derived finish');
    app.clearPlanningSprint();
    assert.equal(app.document.querySelector('#search').value, 'Derived finish');
  });
}

test('Sprint selection follows planning navigation and browser routes restore or clear the filter', () => {
  const app = loadApp(); app.setState(stateWithSprintAssignments()); app.selectBoard(1);
  app.selectPlanningSprint(2);
  app.navButtons.find(button => button.dataset.view === 'overview').onclick();
  assert.equal(app.selectedPlanningSprint().number, 2);
  assert.equal(app.window.location.hash, '#/overview/1/sprint/2');
  assert.deepEqual(planningIds(app), [10, 12, 17, 21, 22, 23]);
  app.navButtons.find(button => button.dataset.view === 'timeline').onclick();
  assert.equal(app.selectedPlanningSprint().number, 2);
  assert.equal(app.window.location.hash, '#/timeline/1/sprint/2');
  assert.ok(planningIds(app).includes(11) && planningIds(app).includes(15));
  app.navButtons.find(button => button.dataset.view === 'board').onclick();
  assert.deepEqual(planningIds(app), [10, 12, 17, 21, 22, 23]);
  app.applyRoute({view: 'overview', boardId: 1, ticketId: 0, sprintNumber: 1});
  assert.deepEqual(planningIds(app), [10, 11, 13]);
  app.applyRoute({view: 'board', boardId: 1, ticketId: 0, sprintNumber: 0});
  assert.equal(app.selectedPlanningSprint(), null);
  assert.ok(planningIds(app).includes(15) && planningIds(app).includes(16));
});

test('Sprint deep links remain bound to the requested board through loads and stale responses', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch: queue.fetch});
  app.setState(stateWithSprintAssignments()); app.selectBoard(1); app.selectPlanningSprint(2);
  const loading = app.applyRoute({view: 'board', boardId: 2, ticketId: 0, sprintNumber: 1});
  assert.equal(app.selectedPlanningSprint(), null, 'a pending board cannot use the old board cadence');
  app.navButtons.find(button => button.dataset.view === 'overview').onclick();
  assert.equal(app.window.location.hash, '#/overview/2/sprint/1');
  const second = stateWithSprintAssignments(); second.board.id = 2;
  queue.respond(0, second); await loading;
  assert.equal(app.getState().board.id, 2);
  assert.equal(app.selectedPlanningSprint().number, 1);
  assert.equal(app.window.location.hash, '#/overview/2/sprint/1');
  assert.deepEqual(planningIds(app), [10, 11, 13]);
  const stale = app.applyRoute({view: 'board', boardId: 3, ticketId: 0, sprintNumber: 2});
  app.applyRoute({view: 'board', boardId: 2, ticketId: 0, sprintNumber: 0});
  const third = stateWithSprintAssignments(); third.board.id = 3;
  queue.respond(1, third); await stale;
  assert.equal(app.getState().board.id, 2);
  assert.equal(app.selectedPlanningSprint(), null);
  assert.equal(app.window.location.hash, '#/board/2');
  assert.ok(planningIds(app).includes(15));
});

test('Timeline Sprint navigation fits saved dates and can switch from relevant work to all task rows', () => {
  const app = loadApp(); const state = stateWithSprintAssignments(); app.setState(state); app.selectBoard(1);
  const surface = timelineSurface(app, 720);
  app.navButtons.find(button => button.dataset.view === 'timeline').onclick();
  const allRows = Array.from(app.buildGanttRows(), row => row.ticket.id);
  app.setTimelineEpicFilter('22'); app.openDependencies(12); app.toggleDependencyFocus(12);
  app.selectPlanningSprint(1);
  assert.equal(app.getView(), 'timeline');
  assert.equal(app.dependencyViewIds(), null);
  const firstRows = Array.from(app.buildGanttRows(), row => row.ticket.id);
  assert.ok(firstRows.length < allRows.length);
  assert.ok(firstRows.includes(11) && !firstRows.includes(12));
  assert.match(surface.root.innerHTML, /id="timelineSprintTasks"[^>]*aria-pressed="true"[^>]*>Show all tasks/);
  assert.equal(surface.scroll.dataset.rangeStart, '2026-01-01');
  assert.equal(surface.scroll.dataset.rangeEnd, '2026-01-15');
  // A real innerHTML rerender creates new scroll and SVG nodes for the next Sprint.
  const secondSurface = timelineSurface(app, 720);
  app.selectPlanningSprint(2);
  assert.equal(secondSurface.scroll.dataset.rangeStart, '2026-01-15');
  assert.equal(secondSurface.scroll.dataset.rangeEnd, '2026-01-29');
  assert.match(secondSurface.root.innerHTML, /data-range-start="2026-01-15" data-range-end="2026-01-29"/);
  const secondRows = Array.from(app.buildGanttRows(), row => row.ticket.id);
  assert.ok(secondRows.includes(12) && !secondRows.includes(11));
  assert.equal((surface.root.innerHTML.match(/class="ganttTaskItem/g) || []).length, secondRows.length);
  app.document.querySelector('#timelineSprintTasks').onclick();
  assert.deepEqual(Array.from(app.buildGanttRows(), row => row.ticket.id), allRows);
  assert.equal(secondSurface.scroll.dataset.rangeStart, '2026-01-15');
  assert.equal(secondSurface.scroll.dataset.rangeEnd, '2026-01-29');
  assert.match(secondSurface.root.innerHTML, /id="timelineSprintTasks"[^>]*aria-pressed="false"[^>]*>Only tasks in this sprint/);
  app.clearPlanningSprint();
  assert.equal(app.window.location.hash, '#/timeline/1');
  assert.deepEqual(Array.from(app.buildGanttRows(), row => row.ticket.id), allRows);
  assert.doesNotMatch(surface.root.innerHTML, /timelineFocusBadge|ganttCalendarClip/);
});

test('invalid or missing saved cadence never activates a Sprint filter', () => {
  for (const cadence of [{sprint_start_date: ''}, {sprint_weeks: 0}]) {
    const app = loadApp(); const state = stateWithSprintAssignments(); Object.assign(state.board, cadence);
    app.setState(state); app.selectBoard(1); const all = planningIds(app);
    app.selectPlanningSprint(2);
    assert.equal(app.selectedPlanningSprint(), null);
    assert.deepEqual(planningIds(app), all);
    app.applyRoute({view: 'overview', boardId: 1, ticketId: 0, sprintNumber: 2});
    assert.equal(app.selectedPlanningSprint(), null);
    assert.deepEqual(planningIds(app), all);
  }
});

test('Sprint selections protect unsaved ticket edits and remain scoped to the active board', () => {
  const app = loadApp(); const state = stateWithSprintAssignments(); app.setState(state); app.selectBoard(1);
  app.selectPlanningSprint(2);
  const fields = openEditor(app, 12); fields.dTitle.value = 'Unsaved sprint title';
  const hash = app.window.location.hash;
  app.setConfirm(() => false); app.selectPlanningSprint(1); app.clearPlanningSprint();
  assert.equal(app.selectedPlanningSprint().number, 2);
  assert.equal(app.getEditing().id, 12);
  assert.equal(app.window.location.hash, hash);
  app.setConfirm(() => true); app.selectPlanningSprint(1);
  assert.equal(app.getEditing(), null);
  assert.equal(app.selectedPlanningSprint().number, 1);
  app.selectBoard(2); app.setState({...state, board: {...state.board, id: 2}});
  assert.equal(app.selectedPlanningSprint(), null, 'another board cannot inherit the previous board Sprint');
  assert.ok(planningIds(app).includes(15));
  app.resetClientState(); app.setState(state); app.selectBoard(1);
  assert.equal(app.selectedPlanningSprint(), null, 'a new session starts with all Sprints');
});

for (const targetView of ['board', 'overview', 'timeline']) {
  test(targetView + ' exposes selected Sprint and All sprints states without confusing Current with selection', () => {
    const app = loadApp(); app.setState(stateWithSprintAssignments()); app.selectBoard(1);
    app.navButtons.find(button => button.dataset.view === targetView).onclick();
    let html = targetView === 'board' ? app.sprintPlannerHtml(app.workTickets()) : app.sprintNavigationHtml(app.workTickets(), targetView);
    assert.equal((html.match(/data-sprint-card=/g) || []).length, 6);
    assert.match(html, /class="[^"]*sprintAll[^"]*"[^>]*data-sprint-all[^>]*aria-pressed="true"/);
    assert.doesNotMatch(html, /class="sprintCard [^"]*\bselected\b/);
    app.selectPlanningSprint(2);
    html = targetView === 'board' ? app.sprintPlannerHtml(app.workTickets()) : app.sprintNavigationHtml(app.workTickets(), targetView);
    assert.match(html, /<article class="sprintCard [^"]*\bselected\b[^>]*data-sprint-card="2"/);
    assert.match(html, /data-sprint-jump="2"[^>]*aria-pressed="true"/);
    assert.match(html, /class="sprintSelectedBadge">Selected/);
    assert.match(html, /data-sprint-all[^>]*aria-pressed="false"/);
    if (targetView !== 'board') {
      assert.doesNotMatch(html, /sprintNameInput|id="sprintStartDate"|id="sprintWeeks"|id="saveSprintSettings"/);
    }
    const selected = app.selectedPlanningSprint().number;
    const before = planningIds(app); app.pageSprintStrip(1);
    assert.equal(app.selectedPlanningSprint().number, selected, 'browsing the strip changes its window, not its selection');
    assert.deepEqual(planningIds(app), before);
    app.clearPlanningSprint();
    html = targetView === 'board' ? app.sprintPlannerHtml(app.workTickets()) : app.sprintNavigationHtml(app.workTickets(), targetView);
    assert.match(html, /data-sprint-all[^>]*aria-pressed="true"/);
  });
}

test('Overview and Timeline Sprint navigation use saved cadence and preserve a Board cadence draft', () => {
  const app = loadApp(); app.setState(stateWithSprintAssignments()); app.selectBoard(1);
  const planner = prepareSprintPlanner(app);
  planner.start.value = '2027-02-01'; planner.start.oninput();
  planner.weeks.value = '3'; planner.weeks.oninput();
  app.navButtons.find(button => button.dataset.view === 'overview').onclick();
  app.selectPlanningSprint(2);
  assert.equal(app.fmtIsoDate(app.selectedPlanningSprint().start), '2026-01-15');
  assert.deepEqual(planningIds(app), [10, 12, 17, 21, 22, 23]);
  app.navButtons.find(button => button.dataset.view === 'timeline').onclick();
  assert.equal(app.fmtIsoDate(app.selectedPlanningSprint().start), '2026-01-15');
  app.navButtons.find(button => button.dataset.view === 'board').onclick();
  const html = app.elements.get('#board').innerHTML;
  assert.match(html, /id="sprintStartDate"[^>]*value="2027-02-01"/);
  assert.match(html, /id="sprintWeeks"[^>]*value="3"/);
  assert.equal(app.getState().board.sprint_start_date, '2026-01-01');
  assert.equal(app.getState().board.sprint_weeks, 2);
});

test('readonly Sprint buttons act on their visible workspace and ignore stale controls', () => {
  const app = loadApp(); const state = stateWithSprintAssignments(); app.setState(state); app.selectBoard(1);
  const planner = prepareSprintPlanner(app);
  planner.start.value = '2027-02-01'; planner.start.oninput();
  const savedBoardPreview = planner.preview.innerHTML;
  app.navButtons.find(button => button.dataset.view === 'overview').onclick();
  const root = app.document.querySelector('#overview');
  const preview = fakeElement(); const jump = fakeElement(); const all = fakeElement(); const next = fakeElement();
  jump.dataset.sprintJump = '2'; next.dataset.sprintPage = '1';
  root.querySelector = selector => selector === '.sprintPreview' ? preview : null;
  root.querySelectorAll = selector => selector === '.sprintJump' ? [jump] : selector === '[data-sprint-all]' ? [all] : selector === '.sprintPageButton' ? [next] : [];
  app.wireSprintNavigation(root);
  assert.equal(jump.disabled, false, 'saved readonly Sprint selection is independent of hidden Board draft fields');
  jump.onclick();
  assert.equal(app.getView(), 'overview');
  assert.equal(app.selectedPlanningSprint().number, 2);
  next.onclick();
  assert.match(preview.innerHTML, /data-sprint-card="8"/);
  assert.equal(app.selectedPlanningSprint().number, 2);
  assert.equal(planner.preview.innerHTML, savedBoardPreview, 'paging Overview cannot redraw a hidden Board strip');
  all.onclick();
  assert.equal(app.selectedPlanningSprint(), null);
  app.navButtons.find(button => button.dataset.view === 'timeline').onclick();
  jump.onclick();
  assert.equal(app.selectedPlanningSprint(), null, 'a control retained from another view cannot change the current selection');
  app.selectPlanningSprint(1);
  app.selectBoard(2); app.setState({...state, board: {...state.board, id: 2}});
  jump.onclick(); all.onclick(); next.onclick();
  assert.equal(app.selectedPlanningSprint(), null, 'stale controls cannot apply or clear a Sprint on another board');
});

test('a pending Sprint name save refreshes the workspace reached through navigation', async () => {
  for (const targetView of ['overview', 'timeline']) {
    const queue = deferredResponseQueue(); const app = loadApp({fetch: queue.fetch});
    app.setState(stateWithSprintAssignments()); app.selectBoard(1); prepareSprintPlanner(app);
    app.selectPlanningSprint(1);
    const name = fakeElement();
    name.dataset = {sprintName: '1', originalDisplay: 'Sprint 1'};
    name.value = 'Jurassic Disco Sprint';
    const saving = app.saveSprintName(name);
    assert.equal(queue.pending[0].url, '/api/sprint-names?boardId=1');
    app.navButtons.find(button => button.dataset.view === targetView).onclick();
    const root = app.document.querySelector('#' + targetView);
    assert.doesNotMatch(root.innerHTML, /Jurassic Disco Sprint/);
    queue.respond(0, {}); await saving;
    assert.equal(app.getView(), targetView);
    assert.equal(app.selectedPlanningSprint().number, 1);
    assert.match(root.innerHTML, /Jurassic Disco Sprint/);
    assert.doesNotMatch(root.innerHTML, /sprintNameInput/);
    assert.equal(app.sprintName(app.selectedPlanningSprint()), 'Jurassic Disco Sprint');
  }
});

test('Reset filters clears Sprint isolation and preserves all filters when discarding an editor is canceled', () => {
  const app = loadApp(); app.setState(stateWithSprintAssignments()); app.selectBoard(1);
  const values = {search: 'Hidden work', typeFilter: 'task', labelFilter: 'blue', assigneeFilter: '3', dependencyFilter: 'waiting'};
  for (const [id, value] of Object.entries(values)) app.document.querySelector('#' + id).value = value;
  app.selectPlanningSprint(4);
  assert.deepEqual(planningIds(app), []);
  assert.match(app.elements.get('#board').innerHTML, /id="boardEmptyAction"[^>]*>Reset filters/);
  const fields = openEditor(app, 12); fields.dTitle.value = 'Unsaved sprint edit';
  let confirmations = 0;
  app.setConfirm(() => { confirmations++; return false; });
  app.document.querySelector('#boardEmptyAction').onclick();
  assert.equal(app.selectedPlanningSprint().number, 4);
  assert.equal(app.getEditing().id, 12);
  for (const [id, value] of Object.entries(values)) assert.equal(app.document.querySelector('#' + id).value, value);
  app.setConfirm(() => { confirmations++; return true; });
  app.document.querySelector('#boardEmptyAction').onclick();
  assert.equal(confirmations, 2, 'each reset asks once when the editor contains unsaved changes');
  assert.equal(app.selectedPlanningSprint(), null);
  assert.equal(app.getEditing(), null);
  assert.equal(app.window.location.hash, '#/board/1');
  for (const id of Object.keys(values)) assert.equal(app.document.querySelector('#' + id).value, '');
  assert.ok(planningIds(app).includes(15) && planningIds(app).includes(16));
});

test('All sprints keeps My tasks explicit and an empty Board can show everyone again without reload', () => {
  const app = loadApp(); app.setState(stateWithSprintAssignments()); app.selectBoard(1); app.renderView();
  const before = planningIds(app);
  app.document.querySelector('#myTasksBtn').onclick();
  assert.equal(app.document.querySelector('#assigneeFilter').value, '3');
  assert.equal(app.document.querySelector('#myTasksBtn').getAttribute('aria-pressed'), 'true');
  assert.equal(app.document.querySelector('#filtersTitle').textContent, 'Filters (1)');
  assert.deepEqual(planningIds(app), []);
  app.selectPlanningSprint(2); app.clearPlanningSprint();
  const html = app.elements.get('#board').innerHTML;
  assert.match(html, /All sprint dates · task filters still apply/);
  assert.match(html, /data-clear-task-filter="assigneeFilter"[^>]*>My tasks: Ada/);
  assert.match(html, /My tasks is active: only tasks assigned to you are shown/);
  assert.equal(app.document.querySelector('#assigneeFilter').value, '3', 'All sprints changes dates, not assignment intent');
  app.document.querySelector('#boardEmptyAction').onclick();
  assert.deepEqual(planningIds(app), before);
  assert.equal(app.document.querySelector('#assigneeFilter').value, '');
  assert.equal(app.document.querySelector('#myTasksBtn').getAttribute('aria-pressed'), 'false');
  assert.equal(app.document.querySelector('#filtersTitle').textContent, 'Filters');
  assert.doesNotMatch(app.elements.get('#board').innerHTML, /My tasks is active|activeTaskFilters"/);
});

for (const targetView of ['board', 'overview', 'timeline']) {
  test(targetView + ' exposes task filters and removes one without clearing the Sprint or other filters', () => {
    const app = loadApp(); const state = stateWithSprintAssignments(); state.tickets.find(ticket => ticket.id === 12).assigneeId = 3;
    app.setState(state); app.selectBoard(1);
    app.document.querySelector('#search').value = 'Task';
    app.document.querySelector('#assigneeFilter').value = '3';
    app.navButtons.find(button => button.dataset.view === targetView).onclick(); app.selectPlanningSprint(2);
    const root = app.elements.get('#' + targetView);
    assert.match(root.innerHTML, /aria-label="Active task filters"/);
    assert.match(root.innerHTML, /data-clear-task-filter="search"/);
    assert.match(root.innerHTML, /data-clear-task-filter="assigneeFilter"/);
    const remove = fakeElement(); remove.dataset.clearTaskFilter = 'assigneeFilter';
    const reset = fakeElement();
    root.querySelectorAll = selector => selector === '[data-clear-task-filter]' ? [remove] : selector === '[data-reset-task-filters]' ? [reset] : [];
    app.wireTaskFilterActions(root); remove.onclick();
    assert.equal(app.document.querySelector('#assigneeFilter').value, '');
    assert.equal(app.document.querySelector('#search').value, 'Task');
    assert.equal(app.selectedPlanningSprint().number, 2);
    assert.equal(app.document.querySelector('#myTasksBtn').getAttribute('aria-pressed'), 'false');
    const oldView = targetView === 'board' ? 'overview' : 'board';
    app.navButtons.find(button => button.dataset.view === oldView).onclick();
    app.document.querySelector('#assigneeFilter').value = '3';
    remove.onclick(); reset.onclick();
    assert.equal(app.document.querySelector('#assigneeFilter').value, '3', 'old workspace controls cannot remove a newer view filter');
    assert.equal(app.selectedPlanningSprint().number, 2);
  });
}

test('Reset filters removes dependency isolation even when All sprints is already selected and honors editor Cancel', () => {
  const app = loadApp(); app.setState(stateWithSprintAssignments()); app.selectBoard(1);
  const all = planningIds(app);
  app.openDependencies(12); app.toggleDependencyFocus(12);
  assert.equal(app.selectedPlanningSprint(), null);
  assert.ok(app.dependencyFocusIds());
  assert.ok(planningIds(app).length < all.length);
  app.document.querySelector('#search').value = 'Does not exist';
  const fields = openEditor(app, 12); fields.dTitle.value = 'Unsaved filter edit';
  app.setConfirm(() => false); app.resetTaskFilters();
  assert.equal(app.getEditing().id, 12);
  assert.equal(app.document.querySelector('#search').value, 'Does not exist');
  assert.ok(app.dependencyFocusIds());
  app.setConfirm(() => true); app.resetTaskFilters();
  assert.equal(app.dependencyViewIds(), null);
  assert.equal(app.getEditing(), null);
  assert.deepEqual(planningIds(app), all);
  assert.equal(app.document.querySelector('#dependencyExitBtn').classList.contains('hidden'), true);
});

test('each task filter chip clears only its own filter while retaining the selected Sprint', () => {
  const values = {search: 'Task', typeFilter: 'task', labelFilter: 'blue', assigneeFilter: '3', dependencyFilter: 'blocked'};
  for (const id of Object.keys(values)) {
    const app = loadApp(); app.setState(stateWithSprintAssignments()); app.selectBoard(1); app.selectPlanningSprint(2);
    for (const [key, value] of Object.entries(values)) app.document.querySelector('#' + key).value = value;
    app.renderView();
    const root = app.elements.get('#board'); const remove = fakeElement(); remove.dataset.clearTaskFilter = id;
    root.querySelectorAll = selector => selector === '[data-clear-task-filter]' ? [remove] : [];
    app.wireTaskFilterActions(root); remove.onclick();
    for (const [key, value] of Object.entries(values)) assert.equal(app.document.querySelector('#' + key).value, key === id ? '' : value);
    assert.equal(app.selectedPlanningSprint().number, 2);
    assert.equal(app.window.location.hash, '#/board/1/sprint/2');
  }
});

test('logout clears transient task filters and local Overview and Timeline filters before another login', async () => {
  const queue = deferredResponseQueue(); const app = loadApp({fetch:queue.fetch}); const state = stateWithSprintAssignments();
  app.setState(state); app.selectBoard(1); app.renderView();
  app.navButtons.find(button => button.dataset.view === 'overview').onclick();
  app.document.querySelector('#overviewSearch').value = 'Nothing matches this';
  app.document.querySelector('#overviewSearch').oninput();
  assert.equal(app.overviewRows(app.workTickets()).length, 0);
  const filters = ['search', 'typeFilter', 'labelFilter', 'assigneeFilter', 'dependencyFilter'];
  for (const id of filters) app.document.querySelector('#' + id).value = 'old session';
  app.setTimelineEpicFilter('22');
  const loggingOut = app.logout();
  for (const id of filters) assert.equal(app.document.querySelector('#' + id).value, '');
  queue.respond(0, {}); await loggingOut;
  state.me.id = 7; app.setState(state); app.selectBoard(1); app.renderView();
  assert.ok(planningIds(app).includes(12));
  assert.equal(app.document.querySelector('#myTasksBtn').getAttribute('aria-pressed'), 'false');
  assert.equal(app.document.querySelector('#filtersTitle').textContent, 'Filters');
  assert.ok(app.overviewRows(app.workTickets()).length > 0, 'the old Overview search does not survive logout');
  app.navButtons.find(button => button.dataset.view === 'timeline').onclick();
  assert.ok(Array.from(app.buildGanttRows(), row => row.ticket.id).includes(12), 'the old Epic filter does not hide work in the next session');
});

test('whitespace-only search cannot silently hide all tasks', () => {
  const app = loadApp(); app.setState(stateWithSprintAssignments()); app.selectBoard(1);
  const all = planningIds(app); app.document.querySelector('#search').value = '   ';
  app.renderView();
  assert.deepEqual(planningIds(app), all);
  assert.equal(app.activeTaskFiltersHtml(), '');
});

function dependencyOrderState() {
  const state = stateWithHierarchy();
  const task = {...state.tickets[3], parentId: 200, columnId: 1, completedAt: '', duration: 1, createdAt: '2026-01-01T10:00:00Z', startDate: '2026-01-01'};
  state.tickets = [
    {...state.tickets[0], id: 200, ref: 'E1', title: 'Planning Epic'},
    {...task, id: 90, ref: '1', title: 'Source task', position: 4, dueDate: '2026-01-05', links: []},
    {...task, id: 80, ref: '2', title: 'Second task', position: 3, dueDate: '2026-01-04', links: [90]},
    {...task, id: 70, ref: '3', title: 'Third task', position: 2, dueDate: '2026-01-03', links: [80]},
    {...task, id: 60, ref: '4', title: 'Final task', position: 1, dueDate: '2026-01-02', links: [70]},
    {...task, id: 75, ref: '5', title: 'Parallel task', position: 0, dueDate: '2026-01-01', links: [90]},
  ];
  return state;
}

function dependencyStageBoardState() {
  const state = dependencyOrderState();
  state.columns = [{id:1,name:'To Do'}, {id:2,name:'Ready'}, {id:3,name:'In Progress'}, {id:4,name:'Review'}, {id:5,name:'Done'}];
  const statuses = new Map([[90,5],[80,3],[75,2],[70,1],[60,1]]);
  state.tickets.forEach(ticket => { ticket.columnId = statuses.get(ticket.id) || 1; });
  state.tickets.find(ticket => ticket.id === 90).completedAt = '2026-01-03T12:00:00Z';
  return state;
}

function boardCardIds(html) {
  return [...html.matchAll(/class="card[^>]+data-work-id="(\d+)"/g)].map(match => +match[1]);
}

test('Board dependencies retain workflow columns and every ticket in its current status', () => {
  const app = loadApp({hover: {wire() {}}}); const state = dependencyStageBoardState();
  app.setState(state); app.selectBoard(1); app.renderBoard();
  const root = app.document.querySelector('#board'); const stored = JSON.stringify(state);
  for (const action of [() => app.openDependencies(70), () => app.toggleDependencyFocus(70), () => app.showOtherTasks(), () => app.closeDependencies()]) {
    action();
    assert.doesNotMatch(root.innerHTML, /boardDependencyStages|data-dependency-stage|boardDependencyContext/);
    for (const column of state.columns) assert.ok(root.innerHTML.includes('data-col="' + column.id + '">' + column.name));
    for (const ticket of state.tickets.filter(ticket => [90,80,75,70,60].includes(ticket.id))) {
      const start = root.innerHTML.indexOf('data-work-id="' + ticket.id + '"'); assert.ok(start > 0);
      const prefix = root.innerHTML.slice(0, start);
      assert.equal(+[...prefix.matchAll(/class="drop boardLaneDrop"[^>]*data-col="(\d+)"/g)].at(-1)[1], ticket.columnId);
    }
    assert.equal(JSON.stringify(state), stored);
  }
});

function visibleDependencyOrder(app, targetView, relatedIds) {
  if (targetView === 'board') {
    return [...app.document.querySelector('#board').innerHTML.matchAll(/class="card[^>]+data-work-id="(\d+)"/g)]
      .map(match => +match[1]).filter(id => relatedIds.has(id));
  }
  if (targetView === 'overview') return Array.from(app.overviewRows(app.planningWork()), row => row.ticket.id).filter(id => relatedIds.has(id));
  return Array.from(app.buildGanttRows(), row => row.ticket.id).filter(id => relatedIds.has(id));
}

for (const targetView of ['board', 'overview', 'timeline']) {
  test(targetView + ' orders a dependency chain by its stages and restores the chosen normal order on exit', () => {
    const app = loadApp({hover: {wire() {}}});
    const state = dependencyOrderState();
    state.tickets.push(...[50,55,58].map((id,index) => ({...state.tickets[1], id, ref: String(20 + index), title: 'Unrelated ' + id, links: [], dueDate: '2026-01-0' + (index + 1)})));
    app.setState(state); app.selectBoard(1);
    app.setOverviewSort({key: 'dueDate', dir: 'asc'});
    app.navButtons.find(button => button.dataset.view === targetView).onclick();
    const relatedIds = new Set([90,80,70,60,75]);
    const normalOrder = visibleDependencyOrder(app, targetView, relatedIds);
    const unrelatedIds = new Set([50,55,58]);
    const unrelatedNormal = visibleDependencyOrder(app, targetView, unrelatedIds);
    assert.equal(normalOrder.length, 5);
    assert.ok(normalOrder.indexOf(60) < normalOrder.indexOf(90), 'the initial normal sort opposes dependency order');
    app.openDependencies(70);
    const dependencyOrder = visibleDependencyOrder(app, targetView, relatedIds);
    assert.equal(dependencyOrder.length, 5);
    assert.deepEqual(visibleDependencyOrder(app, targetView, unrelatedIds), unrelatedNormal, 'independent work retains its normal relative order');
    const stageById = new Map([[90,1],[80,2],[75,2],[70,3],[60,4]]);
    assert.deepEqual(dependencyOrder.map(id => stageById.get(id)), [1,2,2,3,4]);
    for (const [source,target] of [[90,80],[90,75],[80,70],[70,60]]) assert.ok(dependencyOrder.indexOf(source) < dependencyOrder.indexOf(target));
    if (targetView === 'overview') {
      const rows = app.overviewRows(app.planningWork());
      assert.equal(rows[0].kind, 'epic'); assert.equal(rows[0].ticket.id, 200);
      assert.ok(rows.slice(1).every(row => row.depth === 1), 'dependency sorting retains the existing Epic hierarchy');
    }
    app.toggleDependencyFocus(75);
    assert.deepEqual(visibleDependencyOrder(app, targetView, relatedIds), dependencyOrder);
    app.showOtherTasks();
    assert.deepEqual(visibleDependencyOrder(app, targetView, relatedIds), dependencyOrder);
    app.closeDependencies();
    assert.deepEqual(visibleDependencyOrder(app, targetView, relatedIds), normalOrder);
  });
}

for (const targetView of ['board', 'overview', 'timeline']) {
  test(targetView + ' orders a focused chain that crosses Story parents while preserving its Epic context', () => {
    const app = loadApp({hover: {wire() {}}}); const state = dependencyOrderState();
    const template = {...state.tickets[1], type: 'story', parentId: 200, links: []};
    state.tickets.push({...template, id: 300, ref: 'E1.1', title: 'First Story'}, {...template, id: 301, ref: 'E1.2', title: 'Second Story'});
    state.tickets.find(ticket => ticket.id === 90).parentId = 300;
    state.tickets.find(ticket => ticket.id === 70).parentId = 300;
    state.tickets.find(ticket => ticket.id === 80).parentId = 301;
    state.tickets.find(ticket => ticket.id === 60).parentId = 301;
    state.tickets = state.tickets.filter(ticket => ticket.id !== 75);
    app.setState(state); app.selectBoard(1); app.navButtons.find(button => button.dataset.view === targetView).onclick();
    app.openDependencies(70); app.toggleDependencyFocus(70);
    const chain = visibleDependencyOrder(app, targetView, new Set([90,80,70,60]));
    assert.deepEqual(chain, [90,80,70,60], 'parent blocks must not interleave the dependency stages');
    assert.ok(app.planningWork().some(ticket => ticket.id === 200), 'the focused chain retains its Epic summary');
    assert.deepEqual(state.tickets.filter(ticket => [90,80,70,60].includes(ticket.id)).map(ticket => [ticket.id,ticket.parentId]), [[90,300],[80,301],[70,300],[60,301]], 'view order must never modify stored task parents');
  });
}

for (const targetView of ['board', 'overview', 'timeline']) {
  test(targetView + ' identifies the selected task and offers a persistent exit without fetching or reloading', () => {
    let requests = 0;
    const app = loadApp({fetch() { requests++; return new Promise(() => {}); }, hover: {wire() {}}});
    const state = dependencyOrderState();
    state.tickets.find(ticket => ticket.id === 70).title = 'Chosen <third> & task';
    app.setState(state); app.selectBoard(1);
    app.navButtons.find(button => button.dataset.view === targetView).onclick();
    assert.doesNotMatch(app.document.querySelector('#' + targetView).innerHTML, /dependencySelectedBadge|data-selected-dependency=/);
    const stateBefore = app.getState(); const hashBefore = app.window.location.hash;
    app.openDependencies(70);
    const root = app.document.querySelector('#' + targetView);
    assert.match(root.innerHTML, /dependencyFocusBar/);
    assert.equal((root.innerHTML.match(/class="dependencySelectedBadge"/g) || []).length, 1, 'only the explicitly selected task receives the high-contrast label');
    assert.match(root.innerHTML, /class="dependencySelectedBadge" data-selected-dependency="70" title="Selected dependency task #3" aria-label="Selected dependency task #3">Selected<\/span>/);
    assert.match(app.planningFocusHtml(), /Chosen &lt;third&gt; &amp; task/);
    assert.match(app.planningFocusHtml(), /#3/);
    assert.match(app.planningFocusHtml(), /data-dependencies-back/);
    assert.match(app.card(state.tickets.find(ticket => ticket.id === 70)), /class="dependencyAction dependenciesBack"/);
    assert.equal(app.document.querySelector('#dependencyExitBtn').classList.contains('hidden'), false);
    assert.match(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), /id="dependencyExitBtn"[^>]+class="dependenciesBack hidden"[^>]*>Close dependencies<\/button>/);
    assert.equal(app.getView(), targetView); assert.equal(app.getState(), stateBefore);
    assert.equal(app.window.location.hash, hashBefore); assert.equal(requests, 0);
    app.toggleDependencyFocus(70);
    assert.equal((root.innerHTML.match(/data-selected-dependency="70"/g) || []).length, 1, 'filtering the chain retains the selected task label');
    assert.equal(app.document.querySelector('#dependencyExitBtn').classList.contains('hidden'), false);
    app.document.querySelector('#dependencyExitBtn').onclick();
    assert.equal(app.dependencyViewIds(), null); assert.equal(app.dependencyFocusIds(), null);
    assert.equal(app.planningFocusHtml(), '');
    assert.doesNotMatch(root.innerHTML, /dependencySelectedBadge|data-selected-dependency=/);
    assert.equal(app.document.querySelector('#dependencyExitBtn').classList.contains('hidden'), true);
    assert.equal(app.getView(), targetView); assert.equal(requests, 0);
  });
}

for (const targetView of ['board', 'overview', 'timeline']) {
  test(targetView + ' moves the Selected label to a new task without confusing peers at the same dependency stage', () => {
    const app = loadApp({hover: {wire() {}}}); const state = dependencyOrderState();
    app.setState(state); app.selectBoard(1);
    app.navButtons.find(button => button.dataset.view === targetView).onclick();
    const root = app.document.querySelector('#' + targetView);
    app.openDependencies(80);
    const keys = [...app.planningFocusHtml().matchAll(/class="dependencyStageKey"[^>]+/g)].map(match => match[0]);
    assert.deepEqual([...root.innerHTML.matchAll(/data-selected-dependency="(\d+)"/g)].map(match => +match[1]), [80]);
    app.toggleDependencyFocus(75);
    assert.deepEqual([...root.innerHTML.matchAll(/data-selected-dependency="(\d+)"/g)].map(match => +match[1]), [75], 'the parallel task at the same stage has its own explicit selection');
    app.showOtherTasks();
    assert.deepEqual([...root.innerHTML.matchAll(/data-selected-dependency="(\d+)"/g)].map(match => +match[1]), [75]);
    assert.deepEqual([...app.planningFocusHtml().matchAll(/class="dependencyStageKey"[^>]+/g)].map(match => match[0]), keys, 'stronger selection never changes the stage palette');
    app.openDependencies(70);
    assert.deepEqual([...root.innerHTML.matchAll(/data-selected-dependency="(\d+)"/g)].map(match => +match[1]), [70]);
    app.closeDependencies();
    assert.doesNotMatch(root.innerHTML, /data-selected-dependency=/);
  });
}

test('leaving dependencies preserves an unsaved editor draft and opening another chain still honors Cancel', () => {
  const app = loadApp({hover: {wire() {}}});
  app.setState(stateWithHierarchy()); app.selectBoard(1); app.openDependencies(12);
  const fields = openEditor(app, 12); fields.dTitle.value = 'Keep this unsaved title';
  let prompts = 0; app.setConfirm(() => { prompts++; return false; });
  app.openDependencies(13);
  assert.equal(prompts, 1); assert.equal(app.getEditing().id, 12);
  assert.match(app.planningFocusHtml(), /Task/);
  app.document.querySelector('#dependencyExitBtn').onclick();
  assert.equal(app.dependencyViewIds(), null);
  assert.equal(app.getEditing().id, 12); assert.equal(fields.dTitle.value, 'Keep this unsaved title');
  assert.equal(prompts, 1, 'closing the display keeps the open draft and does not discard it');
  assert.equal(app.canLeaveDrawer(), false); assert.equal(prompts, 2);
});

for (const targetView of ['board', 'overview', 'timeline']) {
  test(targetView + ' keeps the clicked task at its visible position through dependency sorting, focusing and returning', () => {
    const app = loadApp({hover: {wire() {}}}); app.setState(dependencyOrderState()); app.selectBoard(1);
    app.navButtons.find(button => button.dataset.view === targetView).onclick();
    const root = app.document.querySelector('#' + targetView); const originalQuery = root.querySelector;
    let markup = root.innerHTML; let pageTop = 180; let chart = fakeElement(); chart.scrollTop = 240;
    const scrolling = [], focusing = [];
    app.window.scrollBy = options => { scrolling.push(options); pageTop += options.top; };
    const action = fakeElement(); action.focus = options => focusing.push(options);
    const selected = fakeElement(); selected.querySelector = () => action;
    selected.getBoundingClientRect = () => {
      const pattern = targetView === 'timeline' ? /class="ganttTaskItem[^>]+data-timeline-id="(\d+)"/g : targetView === 'overview' ? /class="ticketRow[^>]+data-work-id="(\d+)"/g : /class="card[^>]+data-work-id="(\d+)"/g;
      const index = [...markup.matchAll(pattern)].map(match => +match[1]).indexOf(70);
      assert.notEqual(index, -1);
      const top = 400 + index * 120 + (markup.includes('dependencyFocusBar') ? 80 : 0) - pageTop - (targetView === 'timeline' ? chart.scrollTop : 0);
      return {top, bottom: top + 100, height: 100, left: 100, right: 400, width: 300};
    };
    Object.defineProperty(root, 'innerHTML', {
      get() { return markup; },
      set(value) { markup = value; root.scrollLeft = 0; if (targetView === 'timeline') { chart = fakeElement(); chart.scrollTop = 0; } },
    });
    root.scrollLeft = 160;
    const selector = targetView === 'timeline' ? '.ganttTaskItem[data-timeline-id="70"]' : '[data-work-id="70"]';
    root.querySelector = query => query === selector ? selected : query === '.ganttChart' ? chart : query === '[data-dependency-stages]' && markup.includes('data-dependency-stages') ? fakeElement() : originalQuery(query);
    const before = selected.getBoundingClientRect().top;
    for (const transition of [() => app.openDependencies(70), () => app.setDependencySort('normal'), () => app.setDependencySort('dependencies'), () => app.toggleDependencyFocus(70), () => app.showOtherTasks(), () => app.closeDependencies()]) {
      transition();
      assert.equal(selected.getBoundingClientRect().top, before, 'replacing and reordering the rows retains the clicked task position');
      assert.equal(root.scrollLeft, 160, 'all workspaces keep their horizontal position');
    }
    assert.equal(focusing.length, 6);
    assert.ok(focusing.every(options => options.preventScroll === true), 'keyboard focus must not undo the retained scroll position');
    assert.ok(scrolling.every(options => options.behavior === 'instant' && options.left === 0));
    if (targetView === 'timeline') assert.ok(chart.scrollTop > 0, 'the recreated timeline chart retains its own vertical scroll');
    else assert.ok(scrolling.some(options => options.top !== 0), 'the test exercises a real positional correction after ordering changes');
  });
}

test('Overview retains its nested table horizontal position when dependency rows are recreated', () => {
  const app = loadApp({hover: {wire() {}}}); app.setState(dependencyOrderState()); app.selectBoard(1);
  app.navButtons.find(button => button.dataset.view === 'overview').onclick();
  const root = app.document.querySelector('#overview'); const originalQuery = root.querySelector;
  let markup = root.innerHTML; let table = fakeElement(); table.classList.add('showAllColumns');
  let columnsToggle = fakeElement(); columnsToggle.textContent = 'Show simple table';
  const newTableScroll = () => {
    const node = fakeElement(); let left = 0;
    Object.defineProperty(node, 'scrollLeft', {get() { return left; }, set(value) { left = table.classList.contains('showAllColumns') ? Math.max(0,value) : 0; }});
    node.before = button => { columnsToggle = button; };
    return node;
  };
  let tableScroll = newTableScroll(); tableScroll.scrollLeft = 420;
  const selected = fakeElement(); const action = fakeElement(); const focusCalls = [];
  selected.querySelector = () => action; action.focus = options => focusCalls.push(options);
  selected.getBoundingClientRect = () => ({top: 220, bottom: 320, left: 650 - tableScroll.scrollLeft, right: 1200 - tableScroll.scrollLeft, height: 100, width: 550});
  Object.defineProperty(root, 'innerHTML', {
    get() { return markup; },
    set(value) { markup = value; table = fakeElement(); tableScroll = newTableScroll(); root.scrollLeft = 0; },
  });
  root.scrollLeft = 35;
  root.querySelector = selector => selector === '[data-work-id="70"]' ? selected : selector === '.tableScroll' || selector === '.boardSwimlanes,.tableScroll' ? tableScroll : selector === '.ticketTable' ? table : selector === '.overviewColumnsToggle' ? columnsToggle : originalQuery(selector);
  for (const transition of [() => app.openDependencies(70), () => app.toggleDependencyFocus(70), () => app.showOtherTasks(), () => app.closeDependencies()]) {
    const previousTable = tableScroll; const previousLeft = selected.getBoundingClientRect().left;
    transition();
    assert.notEqual(tableScroll, previousTable, 'each transition replaces the table scroll node');
    assert.equal(tableScroll.scrollLeft, 420, 'the table keeps its own horizontal scroll rather than only the outer workspace scroll');
    assert.equal(table.classList.contains('showAllColumns'), true, 'the wide planning columns are restored before the browser clamps horizontal scroll');
    assert.equal(columnsToggle.textContent, 'Show simple table');
    assert.equal(selected.getBoundingClientRect().left, previousLeft);
    assert.equal(root.scrollLeft, 35);
  }
  assert.equal(focusCalls.length, 4);
  assert.ok(focusCalls.every(options => options.preventScroll));
});

for (const targetView of ['board', 'overview', 'timeline']) {
  test(targetView + ' recomputes its dependency chain and stages after the next state render', () => {
    const app = loadApp({hover: {wire() {}}}); const state = dependencyOrderState();
    app.setState(state); app.selectBoard(1); app.navButtons.find(button => button.dataset.view === targetView).onclick();
    app.openDependencies(70);
    assert.deepEqual([...app.dependencyViewIds()].sort((a,b) => a-b), [60,70,75,80,90]);
    assert.match(app.planningFocusHtml(), /title="Stage 4 · end"/);
    state.tickets.push({...state.tickets[1], id: 85, ref: '6', title: 'New final task', links: [60]});
    app.renderView();
    assert.deepEqual([...app.dependencyViewIds()].sort((a,b) => a-b), [60,70,75,80,85,90]);
    assert.match(app.planningFocusHtml(), /title="Stage 5 · end"/);
    state.tickets.find(ticket => ticket.id === 70).links = [];
    app.renderView();
    assert.deepEqual([...app.dependencyViewIds()].sort((a,b) => a-b), [60,70,85]);
    assert.match(app.planningFocusHtml(), /title="Stage 3 · end"/);
    assert.doesNotMatch(app.planningFocusHtml(), /title="Stage [45]/);
    app.toggleDependencyFocus(70);
    assert.deepEqual(visibleDependencyOrder(app, targetView, new Set([60,70,75,80,85,90])), [70,60,85]);
    assert.deepEqual(Array.from(app.planningWork(), ticket => ticket.id).sort((a,b) => a-b), [60,70,85,200]);
  });
}

for (const targetView of ['board', 'overview', 'timeline']) {
  test(targetView + ' lets users switch dependency display order without changing stage colors or saved task data', () => {
    let requests = 0;
    const app = loadApp({fetch() { requests++; return new Promise(() => {}); }, hover: {wire() {}}});
    const state = dependencyOrderState();
    app.setState(state); app.selectBoard(1);
    app.setOverviewSort({key: 'dueDate', dir: 'asc'});
    app.navButtons.find(button => button.dataset.view === targetView).onclick();
    const ids = new Set([90,80,70,60,75]);
    const normalOrder = visibleDependencyOrder(app, targetView, ids);
    const storedTasks = JSON.stringify(state.tickets);
    const hash = app.window.location.hash;
    app.openDependencies(70);
    const ordered = visibleDependencyOrder(app, targetView, ids);
    assert.notDeepEqual(ordered, normalOrder, 'the fixture must exercise a genuine choice between sorts');
    assert.match(app.planningFocusHtml(), /data-dependency-sort/);
    assert.match(app.planningFocusHtml(), /<option value="dependencies" selected>Dependency order<\/option>/);
    const stageKeys = html => [...html.matchAll(/<span class="dependencyStageKey"[^>]*>.*?<\/span>/g)].map(match => match[0]);
    const palette = stageKeys(app.planningFocusHtml());

    const root = app.document.querySelector('#' + targetView);
    const sort = fakeElement(); sort.value = 'normal';
    root.querySelectorAll = selector => selector === '[data-dependency-sort]' ? [sort] : [];
    const originalQuery = root.querySelector;
    root.querySelector = selector => selector === '[data-dependency-sort]' ? sort : originalQuery(selector);
    app.wirePlanningActions(root);
    assert.equal(typeof sort.onchange, 'function', 'the visible selector must be wired to the display choice');
    sort.onchange({stopPropagation() {}});
    assert.deepEqual(visibleDependencyOrder(app, targetView, ids), normalOrder);
    assert.match(app.planningFocusHtml(), /<option value="normal" selected>/);
    assert.deepEqual(stageKeys(app.planningFocusHtml()), palette, 'stage meaning and colors do not depend on visual row order');
    assert.deepEqual([...app.dependencyViewIds()].sort((a,b) => a-b), [60,70,75,80,90]);

    app.toggleDependencyFocus(75);
    assert.deepEqual(visibleDependencyOrder(app, targetView, ids), normalOrder);
    assert.match(app.planningFocusHtml(), /<option value="normal" selected>/);
    app.showOtherTasks();
    assert.deepEqual(visibleDependencyOrder(app, targetView, ids), normalOrder);
    app.openDependencies(80);
    assert.match(app.planningFocusHtml(), /<option value="normal" selected>/, 'choosing another task in the open display retains the chosen sort');

    app.setDependencySort('dependencies');
    assert.deepEqual(visibleDependencyOrder(app, targetView, ids), ordered);
    assert.deepEqual(stageKeys(app.planningFocusHtml()), palette);
    app.setDependencySort('normal');
    app.closeDependencies();
    assert.deepEqual(visibleDependencyOrder(app, targetView, ids), normalOrder);
    app.openDependencies(70);
    assert.match(app.planningFocusHtml(), /<option value="dependencies" selected>/, 'a new dependency display starts in dependency order');
    assert.equal(JSON.stringify(state.tickets), storedTasks, 'sort choices must never persist positions, priorities, parent changes or links');
    assert.equal(app.window.location.hash, hash);
    assert.equal(requests, 0);
  });
}

test('Overview column sorting takes effect immediately in an open dependency display', () => {
  let requests = 0;
  const app = loadApp({fetch() { requests++; return new Promise(() => {}); }, hover: {wire() {}}});
  const state = dependencyOrderState(); app.setState(state); app.selectBoard(1);
  app.setOverviewSort({key: 'dueDate', dir: 'asc'});
  app.navButtons.find(button => button.dataset.view === 'overview').onclick();
  app.openDependencies(70);
  const ids = new Set([90,80,70,60,75]);
  const palette = [...app.planningFocusHtml().matchAll(/class="dependencyStageKey"[^>]+/g)].map(match => match[0]);
  const storedTasks = JSON.stringify(state.tickets);
  const button = fakeElement(); button.dataset.sort = 'dueDate';
  const originalAll = app.document.querySelectorAll.bind(app.document);
  app.document.querySelectorAll = selector => selector === '.tableSort' ? [button] : originalAll(selector);
  app.wireOverviewControls(app.planningWork());
  button.onclick();
  assert.match(app.planningFocusHtml(), /<option value="normal" selected>/, 'a column click must not remain silently overridden by dependency order');
  assert.deepEqual(visibleDependencyOrder(app, 'overview', ids), [90,80,70,60,75], 'the selected Due column toggles to descending');
  assert.deepEqual([...app.planningFocusHtml().matchAll(/class="dependencyStageKey"[^>]+/g)].map(match => match[0]), palette);
  app.wireOverviewControls(app.planningWork());
  button.onclick();
  assert.deepEqual(visibleDependencyOrder(app, 'overview', ids), [75,60,70,80,90], 'the next column click toggles to ascending');
  app.closeDependencies();
  assert.deepEqual(visibleDependencyOrder(app, 'overview', ids), [75,60,70,80,90], 'the chosen column sort remains available after the overlay closes');
  assert.equal(JSON.stringify(state.tickets), storedTasks);
  assert.equal(requests, 0);
});

test('Board keeps empty, hidden-status and completed Epics in compact editable management instead of empty grids', () => {
  const app = loadApp(); const state = stateWithHierarchy();
  const ticket = {...state.tickets[0], parentId: 0, links: [], labels: []};
  state.tickets = [
    {...ticket, id: 40, title: 'Empty <Epic>'},
    {...ticket, id: 41, title: 'Completed Epic', columnId: 5, completedAt: '2026-01-06'},
    {...ticket, id: 42, type: 'task', title: 'Finished child', parentId: 41, columnId: 5},
    {...ticket, id: 43, title: 'Unknown status Epic'},
    {...ticket, id: 44, type: 'task', title: 'Hidden status child', parentId: 43, columnId: 99},
    {...ticket, id: 45, title: 'Active Epic'},
    {...ticket, id: 46, type: 'task', title: 'Active child', parentId: 45},
  ];
  app.setState(state); app.selectBoard(1); app.renderBoard();
  const html = app.document.querySelector('#board').innerHTML;
  const grid = html.slice(html.indexOf('<section class="boardSwimlanes'), html.indexOf('<details class="panel boardCompactEpics'));
  assert.match(grid, /data-work-id="45"/);
  assert.match(grid, /data-work-id="46"/);
  for (const id of [40, 41, 42, 43, 44]) assert.doesNotMatch(grid, new RegExp('data-work-id="' + id + '"'));
  assert.match(html, /Epics without visible tasks <span>3<\/span>/);
  assert.match(html, /Empty &lt;Epic&gt;/);
  assert.match(html, /No tasks planned yet/);
  assert.match(html, /Completed Epic · 1 child item/);
  assert.match(html, /No tasks match this view · 1 child item/);
  for (const id of [40, 41, 43]) assert.match(html, new RegExp('data-edit-ticket="' + id + '"'));
  assert.equal(state.tickets[0].parentId, 0, 'compact presentation must not move or archive an Epic');
});

test('Board retains unfinished work under a Done Epic and excludes unrelated compact management during dependency focus', () => {
  const app = loadApp({hover: {wire() {}}}); const state = stateWithHierarchy();
  state.tickets[0].columnId = 5;
  state.tickets.push({...state.tickets[0], id: 55, title: 'No planned children', columnId: 1});
  app.setState(state); app.selectBoard(1); app.renderBoard();
  let html = app.document.querySelector('#board').innerHTML;
  assert.match(html, /data-work-id="11"/);
  assert.match(html, /data-work-id="12"/);
  assert.match(html, /No planned children/);
  app.openDependencies(12); app.toggleDependencyFocus(12);
  html = app.document.querySelector('#board').innerHTML;
  assert.doesNotMatch(html, /boardCompactEpics|data-work-id="55"/);
  assert.match(html, /data-work-id="12"/);
});

test('Board explains Sprint-hidden Epics compactly and keeps an empty selected Sprint free of phantom lanes', () => {
  const app = loadApp(); app.setState(stateWithSprintAssignments()); app.selectBoard(1); app.selectPlanningSprint(8);
  const html = app.document.querySelector('#board').innerHTML;
  assert.doesNotMatch(html, /<section class="boardSwimlanes /);
  assert.match(html, /boardCompactEpics/);
  assert.match(html, /No visible tasks in Sprint 8/);
  assert.match(html, /data-edit-ticket="10"/);
  app.document.querySelector('#search').value = 'Empty dated epic'; app.renderBoard();
  const searched = app.document.querySelector('#board').innerHTML;
  assert.match(searched, /data-edit-ticket="21"/);
  assert.doesNotMatch(searched, /data-edit-ticket="10"|data-edit-ticket="22"/);
});

test('Timeline Sprint rows use overlapping planned dates, retain hierarchy and omit Epics with no matching children', () => {
  const app = loadApp(); const state = stateWithHierarchy();
  const seed = {...state.tickets[0], parentId: 0, links: [], labels: [], createdAt: '2025-12-01T00:00:00Z'};
  state.tickets = [
    {...seed, id: 50, title: 'Epic in other Sprint', startDate: '2026-01-15', dueDate: '2026-01-28'},
    {...seed, id: 51, type: 'task', parentId: 50, title: 'Old unfinished work', startDate: '2026-01-01', dueDate: '2026-01-05'},
    {...seed, id: 60, title: 'Epic spanning Sprints'},
    {...seed, id: 61, type: 'story', parentId: 60, title: 'Earlier Story', startDate: '2026-01-01', dueDate: '2026-01-03'},
    {...seed, id: 62, type: 'task', parentId: 61, title: 'Spanning task', startDate: '2026-01-12', dueDate: '2026-01-17'},
    {...seed, id: 63, type: 'task', parentId: 60, title: 'Task finishing before Sprint', startDate: '2026-01-10', dueDate: '2026-01-14'},
    {...seed, id: 64, type: 'task', parentId: 60, title: 'Task starting after Sprint', startDate: '2026-01-29', dueDate: '2026-01-30'},
    {...seed, id: 70, title: 'Standalone dated Epic', startDate: '2026-01-15', dueDate: '2026-01-16'},
  ];
  app.setState(state); app.selectBoard(1); app.navButtons.find(button => button.dataset.view === 'timeline').onclick();
  const saved = JSON.stringify(state.tickets);
  const all = Array.from(app.buildGanttRows(), task => task.ticket.id).sort((a, b) => a - b);
  app.selectPlanningSprint(2);
  let rows = app.buildGanttRows();
  assert.deepEqual(Array.from(rows, task => task.ticket.id).sort((a, b) => a - b), [60, 62, 70]);
  assert.equal(rows.find(row => row.ticket.id === 62).depth, 2, 'omitted Story row does not lose the child hierarchy');
  assert.equal(rows.find(row => row.ticket.id === 60).childCount, 1, 'Epic totals summarize the displayed Sprint work');
  app.toggleTimelineSprintTasks();
  assert.deepEqual(Array.from(app.buildGanttRows(), task => task.ticket.id).sort((a, b) => a - b), all);
  assert.equal(app.selectedPlanningSprint().number, 2, 'showing context does not lose the Sprint focus');
  app.selectPlanningSprint(3);
  assert.ok(app.timelineSprintRowsFiltered(), 'choosing a different Sprint starts with the useful rows again');
  assert.deepEqual(Array.from(app.buildGanttRows(), task => task.ticket.id).sort((a, b) => a - b), [60, 64]);
  app.clearPlanningSprint();
  assert.deepEqual(Array.from(app.buildGanttRows(), task => task.ticket.id).sort((a, b) => a - b), all);
  assert.equal(JSON.stringify(state.tickets), saved, 'Sprint display must never edit saved schedules or Sprint assignments');
});

test('Timeline Sprint row toggle honors unsaved editor Cancel and dependency focus keeps the full chain', () => {
  const app = loadApp({hover: {wire() {}}}); app.setState(stateWithSprintAssignments()); app.selectBoard(1);
  app.navButtons.find(button => button.dataset.view === 'timeline').onclick(); app.selectPlanningSprint(2);
  const before = Array.from(app.buildGanttRows(), task => task.ticket.id);
  const fields = openEditor(app, 12); fields.dTitle.value = 'Do not discard this plan';
  app.setConfirm(() => false); app.toggleTimelineSprintTasks();
  assert.ok(app.timelineSprintRowsFiltered());
  assert.deepEqual(Array.from(app.buildGanttRows(), task => task.ticket.id), before);
  assert.equal(app.getEditing().id, 12);
  assert.equal(fields.dTitle.value, 'Do not discard this plan');
  app.setConfirm(() => true); app.closeDrawer(); app.openDependencies(12); app.toggleDependencyFocus(12);
  assert.equal(app.selectedPlanningSprint(), null);
  assert.deepEqual([...app.dependencyViewIds()].sort((a, b) => a - b), [12, 13]);
  assert.ok(app.buildGanttRows().some(task => task.ticket.id === 13));
});

for (const targetView of ['board', 'overview', 'timeline']) {
  test(targetView + ' returns keyboard focus to the sort selector without falling back to the selected card Back button', () => {
    const app = loadApp({hover: {wire() {}}}); app.setState(dependencyOrderState()); app.selectBoard(1);
    app.navButtons.find(button => button.dataset.view === targetView).onclick();
    app.openDependencies(70);
    const root = app.document.querySelector('#' + targetView); const originalQuery = root.querySelector;
    const selector = targetView === 'timeline' ? '.ganttTaskItem[data-timeline-id="70"]' : '[data-work-id="70"]';
    const back = fakeElement(), sort = fakeElement(), selected = fakeElement();
    let sortFocused = 0, backFocused = 0;
    sort.focus = options => { assert.equal(options.preventScroll, true); sortFocused++; };
    back.focus = () => backFocused++;
    selected.querySelector = query => query === '[data-dependencies-back]' ? back : null;
    selected.getBoundingClientRect = () => ({top: 150, bottom: 250, height: 100, left: 0, right: 300, width: 300});
    root.querySelector = query => query === selector ? selected : query === '[data-dependency-sort]' ? sort : originalQuery(query);
    app.setDependencySort('normal');
    assert.equal(sortFocused, 1, 'the requested selector owns focus after rerendering');
    assert.equal(backFocused, 0);
    assert.match(app.planningFocusHtml(), /<option value="normal" selected>/);
  });
}

test('Epic completion checks every active planned descendant and keeps Backlog optional', () => {
  const app=loadApp(), state=stateWithHierarchy();
  const epic=state.tickets.find(ticket=>ticket.id===10);
  state.columns[1].name=' Done ';
  state.tickets.push(
    {...state.tickets[2],id:21,parentId:10,title:'Future active task',startDate:'2027-01-01',dueDate:'2027-01-05'},
    {...state.tickets[2],id:22,parentId:10,title:'Optional Backlog',isBacklog:true},
    {...state.tickets[2],id:23,parentId:10,title:'Archived task',archivedAt:'2026-01-03'},
    {...state.tickets[2],id:24,parentId:10,title:'Deleted task',deletedAt:'2026-01-03'}
  );
  app.setState(state); app.selectBoard(1);
  assert.deepEqual(Array.from(app.epicCompletionState(epic).unfinished,ticket=>ticket.id),[11,12,21]);
  assert.match(app.epicCompletionState(epic).reason,/Future active task/);
  assert.doesNotMatch(app.epicCompletionState(epic).reason,/Optional Backlog|Archived task|Deleted task/);
  assert.match(app.epicCompletionActionHtml(epic),/data-epic-status="10" disabled/);
  for (const id of [11,12,21]) state.tickets.find(ticket=>ticket.id===id).columnId=5;
  assert.equal(app.epicCompletionState(epic).reason,'');
  assert.doesNotMatch(app.epicCompletionActionHtml(epic),/ disabled/);
  epic.columnId=5;
  assert.match(app.epicCompletionActionHtml(epic),/Reopen Epic/);
  assert.equal(app.epicCompletionState(epic).target.id,1);
  state.columns[1].name='Not done yet'; epic.columnId=1;
  assert.match(app.epicCompletionState(epic).reason,/Add a Done workflow column/);
});

test('Epic Complete and Reopen use full ticket payloads once and preserve metadata', async () => {
  const queue=deferredResponseQueue(), app=loadApp({fetch:queue.fetch}), state=stateWithHierarchy();
  const epic=state.tickets.find(ticket=>ticket.id===10);
  Object.assign(epic,{body:'Keep description',dueDate:'2026-01-12',startDate:'2026-01-02',duration:10,assigneeId:3,labels:['launch'],extras:{Checklist:[{Text:'Check gates',Done:true}],RepeatDays:0}});
  state.tickets.filter(ticket=>[11,12].includes(ticket.id)).forEach(ticket=>ticket.columnId=5);
  app.setState(state); app.selectBoard(1);
  const before=JSON.stringify(state.tickets);
  const completing=app.changeEpicCompletion(10);
  await app.changeEpicCompletion(10);
  assert.equal(queue.pending.length,1,'double activation must send only one status mutation');
  assert.equal(queue.pending[0].url,'/api/tickets/10');
  assert.equal(queue.pending[0].options.method,'PUT');
  const payload=JSON.parse(queue.pending[0].options.body);
  assert.equal(payload.ColumnID,5);
  for (const [field,value] of Object.entries({Ref:'10',Body:epic.body,StartDate:epic.startDate,DueDate:epic.dueDate,Duration:10,AssigneeID:3,Position:1,Labels:['launch'],Extras:epic.extras})) assert.deepEqual(payload[field],value);
  assert.equal(JSON.stringify(state.tickets),before,'loaded state must not change before the server confirms');
  queue.respond(0,{});
  await new Promise(resolve=>setImmediate(resolve));
  const completed=JSON.parse(JSON.stringify(state));
  Object.assign(completed.tickets.find(ticket=>ticket.id===10),{columnId:5,completedAt:'2026-01-12T11:15:00Z'});
  queue.respond(1,completed); await completing;
  const action=app.epicCompletionActionHtml(app.getState().tickets.find(ticket=>ticket.id===10));
  assert.match(action,/Reopen Epic/); assert.doesNotMatch(action,/Saving| disabled/);
  const reopening=app.changeEpicCompletion(10);
  assert.equal(JSON.parse(queue.pending[2].options.body).ColumnID,1);
  queue.respond(2,{}); await new Promise(resolve=>setImmediate(resolve));
  const reopened=JSON.parse(JSON.stringify(completed));
  Object.assign(reopened.tickets.find(ticket=>ticket.id===10),{columnId:1,completedAt:''});
  queue.respond(3,reopened); await reopening;
  assert.match(app.epicCompletionActionHtml(app.getState().tickets.find(ticket=>ticket.id===10)),/Complete Epic/);
});

test('blocked Epic completion and discard cancellation send no status update', async () => {
  const queue=deferredResponseQueue(), app=loadApp({fetch:queue.fetch}), state=stateWithHierarchy();
  app.setState(state); app.selectBoard(1);
  await app.changeEpicCompletion(10);
  assert.equal(queue.pending.length,0);
  assert.match(app.elements.get('#epicStatusFeedback').textContent,/Finish these tasks/);
  state.tickets.filter(ticket=>[11,12].includes(ticket.id)).forEach(ticket=>ticket.columnId=5);
  app.setDraft(state.tickets.find(ticket=>ticket.id===12),'unsaved draft'); app.setConfirm(()=>false);
  await app.changeEpicCompletion(10);
  assert.equal(queue.pending.length,0);
  assert.equal(app.getEditing().id,12);
});

test('late Epic status responses cannot reload or report errors over another board', async () => {
  const queue=deferredResponseQueue(), app=loadApp({fetch:queue.fetch}), state=stateWithHierarchy();
  state.tickets.filter(ticket=>[11,12].includes(ticket.id)).forEach(ticket=>ticket.columnId=5);
  app.setState(state); app.selectBoard(1);
  const completing=app.changeEpicCompletion(10);
  app.selectBoard(2);
  queue.respond(0,'Epic now has unfinished work',409); await completing;
  assert.equal(queue.pending.length,1);
  assert.equal(app.elements.get('#epicStatusFeedback').textContent,'');
});

test('History navigation loads its own board endpoint and ignores obsolete responses', async () => {
  const queue=deferredResponseQueue(), renders=[], failures=[], history={
    renderLoading:root=>{root.innerHTML='Loading history';},
    render:(root,options)=>{renders.push({root,options});return ()=>{renders.at(-1).cleaned=true;};},
    renderError:(root,message,retry)=>{failures.push({root,message,retry});},
  };
  const app=loadApp({fetch:queue.fetch,history}); app.setState(stateWithHierarchy()); app.selectBoard(1);
  app.navButtons.find(button=>button.dataset.view==='history').onclick();
  assert.equal(queue.pending[0].url,'/api/history?boardId=1');
  assert.equal(app.window.location.hash,'#/history/1');
  assert.equal(app.elements.get('#board').classList.contains('hidden'),true);
  assert.equal(app.elements.get('#history').classList.contains('hidden'),false);
  const firstItem={ticketId:13,title:'Completed earlier',completedAt:'2026-01-03T08:00:00Z'};
  queue.respond(0,{items:[firstItem]}); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(renders.length,1); assert.deepEqual(JSON.parse(JSON.stringify(renders[0].options.items)),[firstItem]);
  renders[0].options.onOpenTicket(13); assert.equal(app.getEditing().id,13);
  app.closeDrawer();
  const obsolete=app.renderHistory();
  app.navButtons.find(button=>button.dataset.view==='board').onclick();
  assert.equal(renders[0].cleaned,true);
  queue.respond(1,{items:[{ticketId:12,title:'Obsolete'}]}); await obsolete;
  assert.equal(renders.length,1); assert.equal(failures.length,0);
  const next=app.navButtons.find(button=>button.dataset.view==='history'); next.onclick();
  app.selectBoard(2);
  queue.respond(2,'Not allowed',403); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(failures.length,0,'late errors from an old board must not cover the current view');
});

test('Board pans its background while preserving card drags, controls and cancellation', () => {
  const app=loadApp(), root=fakeElement(); root.scrollLeft=100;
  let listeners=0, click; root.addEventListener=(name,fn)=>{listeners++;click=fn;};
  const target={closest:selector=>selector==='.boardSwimlanes'?{}:null};
  app.wireBoardPan(root);app.wireBoardPan(root);assert.equal(listeners,1);
  root.onpointerdown({button:0,pointerId:1,clientX:400,target});
  root.onpointermove({pointerId:2,clientX:200,preventDefault(){throw Error('other pointer');}});
  assert.equal(root.scrollLeft,100);
  root.onpointermove({pointerId:1,clientX:200,preventDefault(){}});
  assert.equal(root.scrollLeft,300);assert.equal(root.classList.contains('isBoardPanning'),true);
  root.onpointerup({pointerId:1,type:'pointerup'});assert.equal(root.classList.contains('isBoardPanning'),false);
  let suppressed=false;click({preventDefault(){suppressed=true;},stopPropagation(){}});assert.equal(suppressed,true);
  for(const event of [{button:2,target},{button:0,pointerType:'touch',target},{button:0,target:{closest:()=>({})}}]) {
    root.onpointerdown({...event,pointerId:1,clientX:400});
    root.onpointermove({pointerId:1,clientX:100,preventDefault(){throw Error('native interaction');}});
    assert.equal(root.scrollLeft,300);
  }
  root.onpointerdown({button:0,pointerId:1,clientX:400,target});
  root.onpointercancel({pointerId:1,type:'pointercancel'});
  root.onpointermove({pointerId:1,clientX:100,preventDefault(){throw Error('cancelled');}});
  assert.equal(root.scrollLeft,300);
});
