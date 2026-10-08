const assert = require('node:assert/strict');
const test = require('node:test');
const hover = require('./dependency-hover.js');

const rect = (left, top, right, bottom) => ({ left, top, right, bottom });

test('hover edges contain only immediate prerequisites and dependents, preserving direction', () => {
  const edges = [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 4, to: 2 }, { from: 3, to: 5 }, { from: 6, to: 1 }, { from: 2, to: 3 }, { from: 2, to: 2 }];
  assert.deepEqual(hover.directEdges(edges, 2), [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 4, to: 2 }]);
  assert.deepEqual(hover.directEdges(edges, 0), []);
  assert.deepEqual(hover.directEdges(edges, 99), []);
});

function assertSafeRoute(path, obstacles) {
  assert.ok(path.length >= 2, 'a visible route exists');
  path.slice(1).forEach((point, index) => {
    assert.ok(point.x === path[index].x || point.y === path[index].y, 'segments are orthogonal');
    assert.equal(hover.segmentBlocked(path[index], point, obstacles), false, 'segments never cross card/row interiors');
  });
}

test('arrows connect task boundaries and route around an intervening card', () => {
  const source = rect(20, 30, 110, 90);
  const target = rect(320, 30, 410, 90);
  const obstacle = rect(160, 10, 270, 120);
  const path = hover.routeConnection(source, target, [source, obstacle, target], rect(0, 0, 440, 150));
  assertSafeRoute(path, [source, obstacle, target]);
  assert.ok(path[0].x === source.left || path[0].x === source.right || path[0].y === source.top || path[0].y === source.bottom);
  const end = path.at(-1);
  assert.ok(end.x === target.left || end.x === target.right || end.y === target.top || end.y === target.bottom);
  assert.ok(path.some(point => point.y <= obstacle.top - 4 || point.y >= obstacle.bottom + 4));
});

test('adjacent overview rows use their outer gutter without crossing table text', () => {
  const rows = [rect(14, 40, 600, 100), rect(14, 100, 600, 160), rect(14, 160, 600, 220), rect(14, 220, 600, 280)];
  const path = hover.routeConnection(rows[0], rows[3], rows, rect(1, 1, 613, 299));
  assertSafeRoute(path, rows);
  assert.ok(path.slice(1, -1).every(point => point.x <= 10 || point.x >= 604));
});

test('Timeline connections avoid due-date badges between aligned short bars', () => {
  const source = rect(100, 84, 142, 112);
  const target = rect(105, 168, 147, 196);
  const dueBadge = rect(117, 144, 199, 164);
  const bounds = rect(1, 1, 640, 300);
  const obstacles = [source, target, dueBadge];
  const route = hover.routeConnections([{ from: 1, to: 2 }], new Map([[1, source], [2, target]]), obstacles, bounds, { layout: 'timeline', gutterWidth: 100 })[0];
  assertSafeRoute(route.points, obstacles);
  assert.equal(route.points[0].x, source.left);
  assert.equal(route.points.at(-1).x, target.left);
  assert.ok(route.points.slice(1, -1).every(point => point.x < 100), 'all trunk segments stay in the dedicated cable gutter');
});

test('a complex obstacle layout remains safe and an enclosed task has no text-crossing fallback', () => {
  const source = rect(20, 20, 70, 70);
  const target = rect(330, 210, 380, 260);
  const obstacles = [source, target, rect(90, 0, 140, 210), rect(165, 90, 220, 300), rect(250, 0, 300, 205)];
  assertSafeRoute(hover.routeConnection(source, target, obstacles, rect(0, 0, 410, 310)), obstacles);
  const enclosed = rect(0, 0, 100, 100);
  assert.deepEqual(hover.routeConnection(rect(30, 30, 60, 60), target, [enclosed, target], rect(0, 0, 410, 310)), []);
});

function uiFixture() {
  const frames = new Map();
  let frameSequence = 0;
  const window = eventTarget({
    requestAnimationFrame(callback) { const id = ++frameSequence; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  const document = { defaultView: window, createElementNS() { return element(); } };
  function eventTarget(extra = {}) {
    const events = new Map();
    return Object.assign({
      addEventListener(name, listener) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(listener); },
      removeEventListener(name, listener) { events.get(name)?.delete(listener); },
      fire(name, event = {}) { [...(events.get(name) || [])].forEach(listener => listener(event)); },
      listenerCount(name) { return events.get(name)?.size || 0; },
    }, extra);
  }
  function element(id, bounds = rect(0, 0, 640, 300)) {
    const attrs = new Map();
    if (id) attrs.set('data-work-id', String(id));
    const classes = new Set();
    const node = eventTarget({
      ownerDocument: document,
      children: [],
      isConnected: true,
      clientLeft: 0, clientTop: 0, scrollLeft: 0, scrollTop: 0,
      clientWidth: bounds.right - bounds.left, scrollWidth: bounds.right - bounds.left,
      clientHeight: bounds.bottom - bounds.top, scrollHeight: bounds.bottom - bounds.top,
      innerHTML: '',
      bounds,
      classList: {
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
        contains(name) { return classes.has(name); },
        toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      },
      setAttribute(name, value) { attrs.set(name, value); },
      removeAttribute(name) { attrs.delete(name); },
      getAttribute(name) { return attrs.get(name); },
      append(child) { child.parent = node; node.children.push(child); },
      remove() { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node); node.isConnected = false; },
      contains(child) { return child === node || node.children.some(item => item.contains(child)); },
      querySelector() { return null; },
      querySelectorAll() { return node.children.filter(child => +child.getAttribute('data-work-id') > 0); },
      getBoundingClientRect() { return { ...node.bounds, width: node.bounds.right - node.bounds.left, height: node.bounds.bottom - node.bounds.top }; },
      focus() { assert.fail('hover must not move keyboard focus'); },
      scrollIntoView() { assert.fail('hover must not scroll the page'); },
    });
    return node;
  }
  const root = element();
  const nodes = [element(1, rect(20, 20, 130, 80)), element(2, rect(240, 20, 350, 80)), element(3, rect(240, 140, 350, 200)), element(4, rect(460, 140, 570, 200))];
  nodes.forEach(node => root.append(node));
  const edges = [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }];
  return { root, nodes, window, edges, element, flush() { [...frames.values()].forEach(callback => callback()); frames.clear(); }, overlay() { return root.children.find(child => child.getAttribute('class') === 'dependencyHoverOverlay'); } };
}

test('hover keeps only the selected task and direct neighbors bright and clears on leave', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges });
  assert.equal(ui.overlay().innerHTML, '');
  ui.nodes.forEach(node => assert.equal(node.classList.contains('dependencyHoverDimmed'), false));
  ui.nodes[1].fire('pointerenter', { pointerType: 'mouse' });
  assert.match(ui.overlay().innerHTML, /data-dependency-from="1" data-dependency-to="2"/);
  assert.match(ui.overlay().innerHTML, /data-dependency-from="2" data-dependency-to="3"/);
  assert.doesNotMatch(ui.overlay().innerHTML, /data-dependency-from="3" data-dependency-to="4"/);
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverActive'), true);
  assert.equal(ui.nodes[0].classList.contains('dependencyHoverRelated'), true);
  assert.equal(ui.nodes[0].classList.contains('dependencyHoverPrerequisite'), true);
  assert.equal(ui.nodes[0].classList.contains('dependencyHoverDependent'), false);
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverPrerequisite'), false);
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverDependent'), false);
  assert.equal(ui.nodes[2].classList.contains('dependencyHoverPrerequisite'), false);
  assert.equal(ui.nodes[2].classList.contains('dependencyHoverDependent'), true);
  assert.equal(ui.nodes[3].classList.contains('dependencyHoverRelated'), false);
  assert.equal(ui.nodes[3].classList.contains('dependencyHoverPrerequisite'), false);
  assert.equal(ui.nodes[3].classList.contains('dependencyHoverDependent'), false);
  assert.equal(ui.nodes[0].classList.contains('dependencyHoverDimmed'), false);
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverDimmed'), false);
  assert.equal(ui.nodes[2].classList.contains('dependencyHoverDimmed'), false);
  assert.equal(ui.nodes[3].classList.contains('dependencyHoverDimmed'), true, 'a transitive dependent remains dimmed');
  assert.equal(ui.root.scrollLeft, 0);
  assert.equal(ui.root.scrollTop, 0);
  ui.nodes[1].fire('pointerleave');
  assert.equal(ui.overlay().innerHTML, '');
  ui.nodes.forEach(node => {
    assert.equal(node.classList.contains('dependencyHoverActive'), false);
    assert.equal(node.classList.contains('dependencyHoverRelated'), false);
    assert.equal(node.classList.contains('dependencyHoverPrerequisite'), false);
    assert.equal(node.classList.contains('dependencyHoverDependent'), false);
    assert.equal(node.classList.contains('dependencyHoverDimmed'), false);
  });
  controller.destroy();
});

test('incoming and outgoing arrow parts use separate role markers for the blue-yellow-teal sequence', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges });
  ui.nodes[1].fire('pointerenter', { pointerType: 'mouse' });
  const drawing = ui.overlay().innerHTML;
  assert.match(drawing, /class="dependencyHoverLine dependencyHoverPrerequisite" data-dependency-from="1" data-dependency-to="2"/);
  assert.match(drawing, /class="dependencyHoverLine dependencyHoverDependent" data-dependency-from="2" data-dependency-to="3"/);
  ['Prerequisite', 'Dependent'].forEach(role => {
    const marker = drawing.match(new RegExp('<marker id="([^"]+)" class="dependencyHover' + role + '"[^>]+>'));
    assert.ok(marker, 'each role has its own marker');
    assert.match(drawing, new RegExp('class="dependencyHoverDot dependencyHover' + role + '"'));
    const head = drawing.match(new RegExp('class="dependencyHoverArrowHead dependencyHover' + role + '"[^>]+marker-end="url\\(#' + marker[1] + '\\)"'));
    assert.ok(head, 'the head uses the matching role marker');
    assert.ok(drawing.lastIndexOf('dependencyHoverLine') < drawing.indexOf(head[0]));
    assert.ok(drawing.lastIndexOf('dependencyHoverDot') < drawing.indexOf(head[0]));
  });
  controller.destroy();
});

test('multiple prerequisites and dependents retain roles without revealing their other relationships', () => {
  const ui = uiFixture();
  const extra = ui.element(5, rect(460, 20, 570, 80));
  ui.root.append(extra);
  const edges = [{ from: 1, to: 2 }, { from: 4, to: 2 }, { from: 2, to: 3 }, { from: 2, to: 5 }, { from: 1, to: 5 }, { from: 3, to: 4 }];
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges });
  ui.nodes[1].fire('focusin');
  [ui.nodes[0], ui.nodes[3]].forEach(node => {
    assert.equal(node.classList.contains('dependencyHoverPrerequisite'), true);
    assert.equal(node.classList.contains('dependencyHoverDependent'), false);
    assert.equal(node.classList.contains('dependencyHoverDimmed'), false);
  });
  [ui.nodes[2], extra].forEach(node => {
    assert.equal(node.classList.contains('dependencyHoverDependent'), true);
    assert.equal(node.classList.contains('dependencyHoverPrerequisite'), false);
    assert.equal(node.classList.contains('dependencyHoverDimmed'), false);
  });
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverActive'), true);
  const drawing = ui.overlay().innerHTML;
  assert.match(drawing, /dependencyHoverPrerequisite" data-dependency-from="1" data-dependency-to="2"/);
  assert.match(drawing, /dependencyHoverPrerequisite" data-dependency-from="4" data-dependency-to="2"/);
  assert.match(drawing, /dependencyHoverDependent" data-dependency-from="2" data-dependency-to="3"/);
  assert.match(drawing, /dependencyHoverDependent" data-dependency-from="2" data-dependency-to="5"/);
  assert.doesNotMatch(drawing, /data-dependency-from="1" data-dependency-to="5"/);
  assert.doesNotMatch(drawing, /data-dependency-from="3" data-dependency-to="4"/);
  controller.destroy();
});

test('moving hover updates directional roles and leaving falls back to keyboard focus', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges });
  ui.nodes[1].fire('focusin');
  ui.nodes[2].fire('pointerenter', { pointerType: 'mouse' });
  assert.equal(ui.nodes[0].classList.contains('dependencyHoverPrerequisite'), false);
  assert.equal(ui.nodes[0].classList.contains('dependencyHoverDimmed'), true);
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverActive'), false);
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverPrerequisite'), true);
  assert.equal(ui.nodes[2].classList.contains('dependencyHoverActive'), true);
  assert.equal(ui.nodes[2].classList.contains('dependencyHoverDependent'), false);
  assert.equal(ui.nodes[3].classList.contains('dependencyHoverDependent'), true);
  ui.nodes[2].fire('pointerleave');
  assert.equal(ui.nodes[0].classList.contains('dependencyHoverPrerequisite'), true);
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverActive'), true);
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverPrerequisite'), false);
  assert.equal(ui.nodes[2].classList.contains('dependencyHoverDependent'), true);
  assert.equal(ui.nodes[3].classList.contains('dependencyHoverDependent'), false);
  ui.nodes[1].fire('focusout', { relatedTarget: null });
  ui.nodes.forEach(node => {
    assert.equal(node.classList.contains('dependencyHoverPrerequisite'), false);
    assert.equal(node.classList.contains('dependencyHoverDependent'), false);
  });
  controller.destroy();
});

test('keyboard focus shows the same relationships and clears without moving focus', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges });
  ui.nodes[1].fire('focusin');
  assert.match(ui.overlay().innerHTML, /data-dependency-from="1" data-dependency-to="2"/);
  ui.nodes[1].fire('focusout', { relatedTarget: null });
  assert.equal(ui.overlay().innerHTML, '');
  ui.nodes[1].fire('pointerenter', { pointerType: 'touch' });
  assert.equal(ui.overlay().innerHTML, '');
  controller.destroy();
});

test('Timeline labels trigger arrows between main bars, without using the wider delay groups', () => {
  const ui = uiFixture();
  const eventRoot = ui.element();
  eventRoot.append(ui.root);
  const label = ui.element(2, rect(-200, 20, -10, 80));
  const directLabel = ui.element(1, rect(-200, 100, -10, 160));
  const unrelatedLabel = ui.element(4, rect(-200, 180, -10, 240));
  eventRoot.append(label);
  eventRoot.append(directLabel);
  eventRoot.append(unrelatedLabel);
  eventRoot.querySelectorAll = () => [...ui.nodes, label, directLabel, unrelatedLabel];
  const bars = ui.nodes.map(node => ui.element(null, node.bounds));
  ui.nodes.forEach((node, index) => {
    node.bounds = rect(0, 0, 640, 300);
    node.append(bars[index]);
    node.querySelector = () => bars[index];
  });
  const controller = hover.wire(eventRoot, { layerRoot: ui.root, edges: ui.edges, anchorSelector: '.ganttSvgBar' });
  label.fire('pointerenter', { pointerType: 'mouse' });
  assert.match(ui.overlay().innerHTML, /data-dependency-from="1" data-dependency-to="2"/);
  assert.match(ui.overlay().innerHTML, /data-dependency-from="2" data-dependency-to="3"/);
  assert.equal(label.classList.contains('dependencyHoverActive'), true);
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverActive'), true);
  assert.equal(directLabel.classList.contains('dependencyHoverRelated'), true);
  assert.equal(directLabel.classList.contains('dependencyHoverPrerequisite'), true);
  assert.equal(ui.nodes[0].classList.contains('dependencyHoverPrerequisite'), true);
  assert.equal(ui.nodes[2].classList.contains('dependencyHoverDependent'), true);
  assert.equal(directLabel.classList.contains('dependencyHoverDimmed'), false);
  assert.equal(unrelatedLabel.classList.contains('dependencyHoverDimmed'), true);
  assert.equal(ui.nodes[3].classList.contains('dependencyHoverDimmed'), true);
  assert.equal(ui.root.scrollLeft, 0);
  label.fire('pointerleave');
  assert.equal(ui.overlay().innerHTML, '');
  assert.equal(unrelatedLabel.classList.contains('dependencyHoverDimmed'), false);
  assert.equal(ui.nodes[3].classList.contains('dependencyHoverDimmed'), false);
  controller.destroy();
});

test('an isolated hovered task stays bright while all other tasks and Epic labels dim', () => {
  const ui = uiFixture();
  const epic = ui.element(90, rect(20, 220, 130, 280));
  ui.root.append(epic);
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: [] });
  ui.nodes[1].fire('pointerenter', { pointerType: 'mouse' });
  assert.equal(ui.overlay().innerHTML, '');
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverActive'), true);
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverDimmed'), false);
  [ui.nodes[0], ui.nodes[2], ui.nodes[3], epic].forEach(node => assert.equal(node.classList.contains('dependencyHoverDimmed'), true));
  ui.nodes[1].fire('pointerleave');
  [...ui.nodes, epic].forEach(node => assert.equal(node.classList.contains('dependencyHoverDimmed'), false));
  controller.destroy();
});

test('focus exit, window blur, drag and destroy restore every task brightness', () => {
  ['focusout', 'blur', 'dragstart', 'destroy'].forEach(exit => {
    const ui = uiFixture();
    const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges });
    if (exit === 'focusout') ui.nodes[1].fire('focusin');
    else ui.nodes[1].fire('pointerenter', { pointerType: 'mouse' });
    assert.equal(ui.nodes[3].classList.contains('dependencyHoverDimmed'), true);
    if (exit === 'focusout') ui.nodes[1].fire('focusout', { relatedTarget: null });
    if (exit === 'blur') ui.window.fire('blur');
    if (exit === 'dragstart') ui.root.fire('dragstart');
    if (exit === 'destroy') controller.destroy();
    ui.nodes.forEach(node => {
      assert.equal(node.classList.contains('dependencyHoverActive'), false, exit);
      assert.equal(node.classList.contains('dependencyHoverRelated'), false, exit);
      assert.equal(node.classList.contains('dependencyHoverPrerequisite'), false, exit);
      assert.equal(node.classList.contains('dependencyHoverDependent'), false, exit);
      assert.equal(node.classList.contains('dependencyHoverDimmed'), false, exit);
    });
    if (exit !== 'destroy') assert.equal(ui.overlay().innerHTML, '');
    controller.destroy();
  });
});

test('wide arrowheads remain visible after all lines and fit a ten-pixel card gap', () => {
  const ui = uiFixture();
  ui.nodes[1].bounds = rect(140, 20, 250, 80);
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: [{ from: 1, to: 2 }] });
  ui.nodes[0].fire('pointerenter', { pointerType: 'mouse' });
  const drawing = ui.overlay().innerHTML;
  assert.match(drawing, /markerWidth="16" markerHeight="18"/);
  assert.match(drawing, /refX="15" refY="9"/);
  assert.match(drawing, /d="M5 1 L15 9 L5 17 Z"/);
  assert.match(drawing, /class="dependencyHoverArrowHead dependencyHoverDependent" d="M130\.0 50\.0 L140\.0 50\.0"/);
  assert.ok(drawing.lastIndexOf('dependencyHoverLine') < drawing.indexOf('dependencyHoverArrowHead'));
  assert.ok(drawing.lastIndexOf('dependencyHoverDot') < drawing.indexOf('dependencyHoverArrowHead'));
  controller.destroy();
});

test('same-column routes use centred cable channels with stable right-output and left-input ports', () => {
  const positions = new Map([[1, rect(96, 30, 296, 130)], [2, rect(96, 220, 296, 320)], [3, rect(96, 410, 296, 510)]]);
  const obstacles = [...positions.values()];
  const routes = hover.routeConnections([{ from: 1, to: 2 }, { from: 2, to: 3 }], positions, obstacles, rect(1, 1, 410, 550),
    { layout: 'board', clearance: 12, selectedId: 2 });
  assert.equal(routes.length, 2);
  routes.forEach(route => {
    const source = positions.get(route.from);
    const target = positions.get(route.to);
    assertSafeRoute(route.points, obstacles);
    assert.equal(route.points[0].x, source.right, 'all outputs use the right side');
    assert.equal(route.points.at(-1).x, target.left, 'all inputs use the left side');
    assert.equal(route.points[0].y, (source.top + source.bottom) / 2);
    assert.ok(route.points.some(point => point.x > source.right + 25), 'the output trunk is clear of the card edge');
    assert.ok(route.points.some(point => point.x < target.left - 25), 'the input trunk is clear of the card edge');
    assert.equal(route.points.at(-2).y, route.points.at(-1).y, 'the arrow enters horizontally');
  });
  assert.equal(routes[0].sourceStep, 1);
  assert.equal(routes[1].sourceStep, 2);
  assert.equal(hover.sharesTrack(routes[1].points[1], routes[1].points[2], [routes[0].points]), false);
});

test('filtered-out relationships produce no dangling line or detached focus target', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: [{ from: 99, to: 2 }] });
  ui.nodes[1].fire('pointerenter', { pointerType: 'mouse' });
  assert.equal(ui.overlay().innerHTML, '');
  assert.equal(ui.root.children.length, 5, 'only the pointer-transparent overlay is added');
  controller.destroy();
});

test('scroll/resize refresh only geometry, and rewiring removes old listeners and overlays', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges });
  ui.nodes[1].fire('pointerenter', { pointerType: 'mouse' });
  const before = ui.overlay().innerHTML;
  ui.root.scrollLeft = 17;
  ui.window.fire('scroll');
  ui.flush();
  assert.notEqual(ui.overlay().innerHTML, before);
  assert.equal(ui.root.scrollLeft, 17);
  ui.window.fire('resize');
  ui.flush();
  assert.equal(ui.root.scrollLeft, 17);
  const replacement = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges });
  assert.equal(ui.root.children.filter(child => child.getAttribute('class') === 'dependencyHoverOverlay').length, 1);
  assert.equal(ui.nodes[1].listenerCount('pointerenter'), 1);
  assert.equal(ui.overlay().innerHTML, '');
  ui.nodes.forEach(node => {
    assert.equal(node.classList.contains('dependencyHoverPrerequisite'), false);
    assert.equal(node.classList.contains('dependencyHoverDependent'), false);
  });
  ui.nodes[1].fire('pointerenter', { pointerType: 'mouse' });
  ui.root.fire('dragstart');
  assert.equal(ui.overlay().innerHTML, '');
  replacement.destroy();
  assert.equal(ui.window.listenerCount('scroll'), 0);
  assert.equal(ui.nodes[1].listenerCount('pointerenter'), 0);
  assert.equal(ui.overlay(), undefined);
  assert.equal(ui.root.classList.contains('dependencyHoverSurface'), false);
  // Destroying an obsolete controller is harmless.
  controller.destroy();
});

test('shrinking content discards the previous SVG extent instead of retaining artificial overflow', () => {
  const ui = uiFixture();
  let contentWidth = 640;
  let contentHeight = 300;
  Object.defineProperties(ui.root, {
    scrollWidth: { get() { return Math.max(contentWidth, +(ui.overlay()?.getAttribute('width') || 0)); } },
    scrollHeight: { get() { return Math.max(contentHeight, +(ui.overlay()?.getAttribute('height') || 0)); } },
  });
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges });
  ui.nodes[1].fire('pointerenter', { pointerType: 'mouse' });
  assert.equal(ui.overlay().getAttribute('width'), '640');
  assert.equal(ui.overlay().getAttribute('height'), '300');

  contentWidth = ui.root.clientWidth = 430;
  contentHeight = ui.root.clientHeight = 240;
  ui.root.bounds = rect(0, 0, 430, 240);
  ui.nodes[0].bounds = rect(20, 20, 80, 80);
  ui.nodes[1].bounds = rect(120, 20, 180, 80);
  ui.nodes[2].bounds = rect(120, 140, 180, 200);
  ui.nodes[3].bounds = rect(240, 140, 300, 200);
  ui.window.fire('resize');
  ui.flush();
  assert.match(ui.overlay().innerHTML, /data-dependency-from="1" data-dependency-to="2"/);
  assert.equal(ui.overlay().getAttribute('width'), '430');
  assert.equal(ui.overlay().getAttribute('height'), '240');
  assert.equal(ui.root.scrollWidth, 430);
  assert.equal(ui.root.scrollHeight, 240);

  ui.nodes[1].fire('pointerleave');
  assert.equal(ui.overlay().getAttribute('width'), '1');
  assert.equal(ui.overlay().getAttribute('height'), '1');
  contentWidth = ui.root.clientWidth = 200;
  contentHeight = ui.root.clientHeight = 150;
  assert.equal(ui.root.scrollWidth, 200, 'an inactive overlay adds no stale horizontal overflow');
  assert.equal(ui.root.scrollHeight, 150, 'an inactive overlay adds no stale vertical overflow');
  controller.destroy();
});

test('board branch routing centres trunks in gaps and separates every incoming arrowhead', () => {
  const positions = new Map([
    [1, rect(96, 30, 296, 130)], [2, rect(396, 200, 596, 300)],
    [3, rect(96, 380, 296, 480)], [4, rect(396, 380, 596, 480)], [5, rect(96, 200, 296, 300)],
  ]);
  const edges = [{ from: 1, to: 2 }, { from: 5, to: 2 }, { from: 2, to: 3 }, { from: 2, to: 4 }];
  const obstacles = [...positions.values()];
  const options = { layout: 'board', clearance: 12, selectedId: 2 };
  const bounds = rect(1, 1, 700, 520);
  const routes = hover.routeConnections(edges, positions, obstacles, bounds, options);
  assert.equal(routes.length, 4);
  assert.deepEqual(hover.routeConnections(edges.slice().reverse(), positions, obstacles, bounds, options), routes, 'API ordering does not move ports or cables');
  routes.forEach(route => assertSafeRoute(route.points, obstacles));
  const incoming = routes.filter(route => route.role === 'prerequisite');
  assert.equal(new Set(incoming.map(route => route.points.at(-1).y)).size, 2, 'fan-in heads have distinct input slots');
  assert.ok(incoming[0].points.some(point => Math.abs(point.x - 346) <= 20), 'the gap centre is used instead of hugging x=296 or x=396');
  routes.filter(route => route.role === 'dependent').forEach(route => route.points.slice(1).forEach((point, index) => {
    assert.equal(hover.sharesTrack(route.points[index], point, incoming.map(edge => edge.points)), false, 'a teal trunk never covers a blue trunk');
  }));
});

test('short Timeline bars use separate cable lanes and nonoverlapping input/output slots', () => {
  const positions = new Map([
    [1, rect(100, 28, 106, 56)], [2, rect(105, 84, 111, 112)], [3, rect(101, 140, 107, 168)],
    [4, rect(115, 196, 121, 224)], [5, rect(100, 252, 106, 280)],
  ]);
  const edges = [{ from: 1, to: 3 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 3, to: 5 }];
  const obstacles = [...positions.values(), rect(130, 60, 220, 80), rect(120, 172, 220, 192)];
  const routes = hover.routeConnections(edges, positions, obstacles, rect(1, 1, 340, 300),
    { layout: 'timeline', gutterWidth: 100, clearance: 4, selectedId: 3 });
  assert.equal(routes.length, 4, 'a six-pixel bar still has a visible dependency arrow');
  const incoming = routes.filter(route => route.role === 'prerequisite');
  const outgoing = routes.filter(route => route.role === 'dependent');
  const centre = 154;
  assert.ok(incoming.every(route => route.points.at(-1).y < centre));
  assert.ok(outgoing.every(route => route.points[0].y > centre));
  routes.forEach(route => {
    assertSafeRoute(route.points, obstacles);
    assert.equal(route.points[0].x, positions.get(route.from).left);
    assert.equal(route.points.at(-1).x, positions.get(route.to).left);
    assert.ok(route.points.slice(1, -1).every(point => point.x < 85));
  });
  outgoing.forEach(route => route.points.slice(1).forEach((point, index) =>
    assert.equal(hover.sharesTrack(route.points[index], point, incoming.map(edge => edge.points)), false)));
});

test('clipped tasks produce no dangling arrow while visible relationships continue to draw', () => {
  const positions = new Map([[1, rect(-200, 30, -120, 58)], [2, rect(100, 90, 130, 118)], [3, rect(100, 150, 130, 178)]]);
  const routes = hover.routeConnections([{ from: 1, to: 2 }, { from: 2, to: 3 }], positions, [...positions.values()], rect(1, 1, 350, 250),
    { layout: 'timeline', gutterWidth: 100, selectedId: 2 });
  assert.deepEqual(routes.map(route => [route.from, route.to]), [[2, 3]]);
  assert.ok(routes[0].points.every(point => point.x >= 1 && point.x <= 350 && point.y >= 1 && point.y <= 250));
});

test('source number badges identify incoming step one and outgoing step two without duplicate source labels', () => {
  const ui = uiFixture();
  const extra = ui.element(5, rect(460, 20, 570, 80));
  ui.root.append(extra);
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 2, to: 5 }], selectedId: 2 });
  const drawing = ui.overlay().innerHTML;
  assert.match(drawing, /dependencyHoverSequence dependencyHoverPrerequisite" data-dependency-source="1" data-dependency-step="1"/);
  assert.match(drawing, /dependencyHoverSequence dependencyHoverDependent" data-dependency-source="2" data-dependency-step="2"/);
  assert.equal((drawing.match(/data-dependency-source="2"/g) || []).length, 1);
  assert.equal(ui.nodes[0].getAttribute('data-dependency-step'), '1');
  assert.equal(ui.nodes[1].getAttribute('data-dependency-step'), '2');
  assert.equal(ui.nodes[2].getAttribute('data-dependency-step'), '3');
  controller.destroy();
  [...ui.nodes, extra].forEach(node => assert.equal(node.getAttribute('data-dependency-step'), undefined));
});

test('pinned click focus survives pointer leave and blur without changing selection or scrolling', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2 });
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverActive'), true, 'the persistent selection draws immediately');
  ui.nodes[2].fire('pointerenter', { pointerType: 'mouse' });
  ui.nodes[2].fire('pointerleave');
  ui.window.fire('blur');
  ui.root.fire('dragstart');
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverActive'), true);
  assert.equal(ui.nodes[2].classList.contains('dependencyHoverDependent'), true);
  assert.equal(ui.nodes[3].classList.contains('dependencyHoverDimmed'), true);
  assert.equal(ui.root.scrollLeft, 0);
  assert.equal(ui.root.scrollTop, 0);
  controller.setSelected(0);
  assert.equal(ui.overlay().innerHTML, '');
  ui.nodes.forEach(node => assert.equal(node.classList.contains('dependencyHoverDimmed'), false));
  controller.destroy();
});

test('Epic hover highlights its descendants without fabricated arrows or an empty isolated Epic focus', () => {
  [new Map([[90, [1, 2, 3]]]), { 90: [1, 2, 3] }].forEach(relatedById => {
    const ui = uiFixture();
    const epic = ui.element(90, rect(20, 220, 130, 280));
    ui.root.append(epic);
    const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, relatedById });
    epic.fire('pointerenter', { pointerType: 'mouse' });
    assert.equal(ui.overlay().innerHTML, '');
    assert.equal(epic.classList.contains('dependencyHoverActive'), true);
    ui.nodes.slice(0, 3).forEach(node => {
      assert.equal(node.classList.contains('dependencyHoverRelated'), true);
      assert.equal(node.classList.contains('dependencyHoverDependent'), false, 'Epic membership is not a dependency');
      assert.equal(node.getAttribute('data-dependency-step'), undefined);
      assert.equal(node.classList.contains('dependencyHoverDimmed'), false);
    });
    assert.equal(ui.nodes[3].classList.contains('dependencyHoverDimmed'), true);
    epic.fire('pointerleave');
    ui.nodes.forEach(node => assert.equal(node.classList.contains('dependencyHoverDimmed'), false));
    controller.destroy();
  });
});
