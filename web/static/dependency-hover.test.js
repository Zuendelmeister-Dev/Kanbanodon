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
  const source = rect(28, 84, 70, 112);
  const target = rect(28, 168, 70, 196);
  const dueBadge = rect(45, 144, 127, 164);
  const bounds = rect(1, 1, 640, 300);
  const withoutBadge = hover.routeConnection(source, target, [source, target], bounds);
  assert.ok(withoutBadge.slice(1).some((point, index) => hover.segmentBlocked(withoutBadge[index], point, [dueBadge])), 'ignoring the badge would draw over its date text');
  const obstacles = [source, target, dueBadge];
  assertSafeRoute(hover.routeConnection(source, target, obstacles, bounds), obstacles);
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

test('hover is inline, one hop, leaves unrelated content readable, and clears on leave', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges });
  assert.equal(ui.overlay().innerHTML, '');
  ui.nodes[1].fire('pointerenter', { pointerType: 'mouse' });
  assert.match(ui.overlay().innerHTML, /data-dependency-from="1" data-dependency-to="2"/);
  assert.match(ui.overlay().innerHTML, /data-dependency-from="2" data-dependency-to="3"/);
  assert.doesNotMatch(ui.overlay().innerHTML, /data-dependency-from="3" data-dependency-to="4"/);
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverActive'), true);
  assert.equal(ui.nodes[0].classList.contains('dependencyHoverRelated'), true);
  assert.equal(ui.nodes[3].classList.contains('dependencyHoverRelated'), false);
  ui.nodes.forEach(node => assert.equal(node.classList.contains('pathDimmed'), false));
  assert.equal(ui.root.scrollLeft, 0);
  assert.equal(ui.root.scrollTop, 0);
  ui.nodes[1].fire('pointerleave');
  assert.equal(ui.overlay().innerHTML, '');
  ui.nodes.forEach(node => assert.equal(node.classList.contains('dependencyHoverActive'), false));
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
  eventRoot.append(label);
  eventRoot.querySelectorAll = () => [...ui.nodes, label];
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
  assert.equal(ui.root.scrollLeft, 0);
  label.fire('pointerleave');
  assert.equal(ui.overlay().innerHTML, '');
  controller.destroy();
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
