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
      querySelectorAll(selector) { return node.children.filter(child => selector === '[data-dependency-wire]' ?
        child.getAttribute('data-dependency-wire') : +child.getAttribute('data-work-id') > 0); },
      closest(selector) { return selector === '[data-dependency-wire]' && attrs.has('data-dependency-wire') ? node : node.parent?.closest(selector); },
      getBoundingClientRect() { return { ...node.bounds, width: node.bounds.right - node.bounds.left, height: node.bounds.bottom - node.bounds.top }; },
      focus() { assert.fail('hover must not move keyboard focus'); },
      scrollIntoView() { assert.fail('hover must not scroll the page'); },
    });
    let markup = '';
    Object.defineProperty(node, 'innerHTML', {
      get() { return markup; },
      set(value) {
        markup = value;
        node.children = [];
        for (const match of value.matchAll(/<g class="dependencyHoverWire" data-dependency-wire="([^"]+)" data-dependency-from="(\d+)" data-dependency-to="(\d+)"/g)) {
          const group = element();
          group.setAttribute('data-dependency-wire', match[1]);
          group.setAttribute('data-dependency-from', match[2]);
          group.setAttribute('data-dependency-to', match[3]);
          node.append(group);
        }
      },
    });
    return node;
  }
  const root = element();
  const nodes = [element(1, rect(20, 20, 130, 80)), element(2, rect(240, 20, 350, 80)), element(3, rect(240, 140, 350, 200)), element(4, rect(460, 140, 570, 200))];
  nodes.forEach(node => root.append(node));
  const edges = [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }];
  return { root, nodes, window, edges, element, flush() { [...frames.values()].forEach(callback => callback()); frames.clear(); }, overlay() { return root.children.find(child => child.getAttribute('class') === 'dependencyHoverOverlay'); } };
}


test('normal task and Epic hover or keyboard focus do not open dependency previews', () => {
  const ui = uiFixture();
  const epic = ui.element(90, rect(20, 220, 130, 280));
  ui.root.append(epic);
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, relatedById: new Map([[90, [1, 2, 3]]]) });
  [...ui.nodes, epic].forEach(node => {
    node.fire('pointerenter', { pointerType: 'mouse' });
    node.fire('focusin');
    assert.equal(node.listenerCount('pointerenter'), 0);
    assert.equal(node.listenerCount('focusin'), 0);
  });
  assert.equal(ui.overlay().innerHTML, '');
  [...ui.nodes, epic].forEach(node => {
    assert.equal(node.classList.contains('dependencyHoverDimmed'), false);
    assert.equal(node.getAttribute('data-dependency-step'), undefined);
  });
  controller.destroy();
});

test('explicit selection shows only immediate relationships without revealing a transitive task', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2 });
  assert.match(ui.overlay().innerHTML, /data-dependency-from="1" data-dependency-to="2"/);
  assert.match(ui.overlay().innerHTML, /data-dependency-from="2" data-dependency-to="3"/);
  assert.doesNotMatch(ui.overlay().innerHTML, /data-dependency-from="3" data-dependency-to="4"/);
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverSelected'), true);
  assert.deepEqual(ui.nodes.map(node => node.getAttribute('data-dependency-step')), ['1', '2', '3', undefined]);
  assert.equal(ui.nodes[3].classList.contains('dependencyHoverDimmed'), true);
  assert.equal(ui.root.scrollLeft, 0);
  assert.equal(ui.root.scrollTop, 0);
  controller.destroy();
});

test('a selected root starts at blue one and its direct dependents are gold two', () => {
  const ui = uiFixture();
  const edges = [{ from: 2, to: 1 }, { from: 2, to: 3 }, { from: 3, to: 4 }];
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges, selectedId: 2 });
  assert.equal(ui.nodes[1].getAttribute('data-dependency-step'), '1');
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverPrerequisite'), true);
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverActive'), false);
  [ui.nodes[0], ui.nodes[2]].forEach(node => {
    assert.equal(node.getAttribute('data-dependency-step'), '2');
    assert.equal(node.classList.contains('dependencyHoverActive'), true);
    assert.equal(node.classList.contains('dependencyHoverDependent'), false);
  });
  assert.match(ui.overlay().innerHTML, /dependencyHoverLine dependencyHoverPrerequisite" data-dependency-from="2" data-dependency-to="1"/);
  assert.match(ui.overlay().innerHTML, /dependencyHoverLine dependencyHoverPrerequisite" data-dependency-from="2" data-dependency-to="3"/);
  assert.doesNotMatch(ui.overlay().innerHTML, /data-dependency-step="3"/);
  controller.destroy();
});

test('numbering follows the displayed DAG through branches and converging prerequisites', () => {
  const levels = hover.dependencySteps([{ from: 1, to: 3 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 1, to: 4 }], 3);
  assert.deepEqual([...levels].sort((a, b) => a[0] - b[0]), [[1, 1], [2, 1], [3, 2], [4, 3]]);
  assert.deepEqual([...hover.dependencySteps([], 7)], [[7, 1]]);
  assert.equal(hover.dependencySteps([{ from: 1, to: 2 }, { from: 2, to: 1 }], 1).size, 2, 'invalid imported cycles cannot make rendering hang');
});

test('each wire, arrowhead and source number uses its source task color and step', () => {
  const ui = uiFixture();
  const extra = ui.element(5, rect(460, 20, 570, 80));
  ui.root.append(extra);
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 2, to: 5 }], selectedId: 2 });
  const drawing = ui.overlay().innerHTML;
  assert.match(drawing, /dependencyHoverSequence dependencyHoverPrerequisite" data-dependency-source="1" data-dependency-step="1"/);
  assert.match(drawing, /dependencyHoverSequence dependencyHoverActive" data-dependency-source="2" data-dependency-step="2"/);
  assert.equal((drawing.match(/data-dependency-source="2"/g) || []).length, 1, 'a shared output terminal needs just one number');
  ['Prerequisite', 'Active'].forEach(role => {
    const marker = drawing.match(new RegExp('<marker id="([^"]+)" class="dependencyHover' + role + '"[^>]+>'));
    assert.ok(marker);
    assert.match(drawing, new RegExp('class="dependencyHoverDot dependencyHover' + role + '"'));
    assert.match(drawing, new RegExp('class="dependencyHoverArrowHead dependencyHover' + role + '"[^>]+marker-end="url\\(#' + marker[1] + '\\)"'));
  });
  controller.destroy();
});

test('hovering one wire dims all other wires and every task except its endpoints', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2 });
  const groups = ui.overlay().querySelectorAll('[data-dependency-wire]');
  assert.equal(groups.length, 2);
  ui.overlay().fire('pointerover', { target: groups[0], pointerType: 'mouse' });
  assert.deepEqual(ui.nodes.map(node => node.classList.contains('dependencyHoverDimmed')), [false, false, true, true]);
  assert.equal(groups[0].classList.contains('dependencyHoverWireDimmed'), false);
  assert.equal(groups[1].classList.contains('dependencyHoverWireDimmed'), true);
  ui.overlay().fire('pointerout', { target: groups[0], relatedTarget: null });
  assert.deepEqual(ui.nodes.map(node => node.classList.contains('dependencyHoverDimmed')), [false, false, false, true]);
  groups.forEach(group => assert.equal(group.classList.contains('dependencyHoverWireDimmed'), false));
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverSelected'), true);
  assert.equal(ui.root.scrollTop, 0);
  controller.destroy();
});

test('moving between path pieces retains wire focus while touch hover does not dim the preview', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2 });
  const group = ui.overlay().querySelectorAll('[data-dependency-wire]')[0];
  const path = ui.element();
  const badge = ui.element();
  group.append(path);
  group.append(badge);
  ui.overlay().fire('pointerover', { target: path, pointerType: 'touch' });
  assert.equal(ui.nodes[2].classList.contains('dependencyHoverDimmed'), false);
  ui.overlay().fire('pointerover', { target: path, pointerType: 'mouse' });
  ui.overlay().fire('pointerout', { target: path, relatedTarget: badge });
  assert.equal(ui.nodes[2].classList.contains('dependencyHoverDimmed'), true);
  ui.overlay().fire('pointerleave');
  assert.equal(ui.nodes[2].classList.contains('dependencyHoverDimmed'), false);
  controller.destroy();
});

test('wire hit areas are wider than visible strokes and remain outside task interiors', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2 });
  assert.equal((ui.overlay().innerHTML.match(/class="dependencyHoverHit"/g) || []).length, 2);
  assert.match(ui.overlay().innerHTML, /fill="none" stroke="transparent" stroke-width="18" pointer-events="stroke"/);
  assert.match(ui.overlay().innerHTML, /markerWidth="16" markerHeight="18"/);
  controller.destroy();
});

test('wire tooltips describe source and target names without interpolating HTML', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 1,
    labelsById: new Map([[1, 'Map <habitats>'], [2, 'Prepare & inspect']]) });
  assert.match(ui.overlay().innerHTML, /<title>Map &lt;habitats&gt; → Prepare &amp; inspect<\/title>/);
  assert.match(ui.overlay().innerHTML, /tabindex="0" role="img" aria-label="Dependency: Map &lt;habitats&gt; → Prepare &amp; inspect"/);
  assert.equal(ui.overlay().getAttribute('aria-hidden'), 'false');
  assert.doesNotMatch(ui.overlay().innerHTML, /<habitats>/);
  controller.destroy();
});

test('keyboard wire focus provides the same endpoint emphasis and Escape restores the preview', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2 });
  const groups = ui.overlay().querySelectorAll('[data-dependency-wire]');
  ui.overlay().fire('focusin', { target: groups[1] });
  assert.deepEqual(ui.nodes.map(node => node.classList.contains('dependencyHoverDimmed')), [true, false, false, true]);
  assert.equal(groups[0].classList.contains('dependencyHoverWireDimmed'), true);
  ui.overlay().fire('pointerleave');
  assert.equal(ui.nodes[0].classList.contains('dependencyHoverDimmed'), true, 'keyboard emphasis survives pointer leave');
  let prevented = false;
  ui.overlay().fire('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(ui.nodes.map(node => node.classList.contains('dependencyHoverDimmed')), [false, false, false, true]);
  ui.overlay().fire('focusin', { target: groups[0] });
  ui.overlay().fire('focusout', { target: groups[0], relatedTarget: null });
  assert.equal(ui.nodes[2].classList.contains('dependencyHoverDimmed'), false);
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverSelected'), true);
  controller.setSelected(0);
  assert.equal(ui.overlay().getAttribute('aria-hidden'), 'true');
  controller.destroy();
});

test('Timeline labels and main bars share explicit selection without using wider delay groups', () => {
  const ui = uiFixture();
  const eventRoot = ui.element();
  eventRoot.append(ui.root);
  const label = ui.element(2, rect(-200, 20, -10, 80));
  const unrelated = ui.element(4, rect(-200, 180, -10, 240));
  eventRoot.append(label);
  eventRoot.append(unrelated);
  eventRoot.querySelectorAll = () => [...ui.nodes, label, unrelated];
  const bars = ui.nodes.map(node => ui.element(null, node.bounds));
  ui.nodes.forEach((node, index) => {
    node.bounds = rect(0, 0, 640, 300);
    node.append(bars[index]);
    node.querySelector = () => bars[index];
  });
  const controller = hover.wire(eventRoot, { layerRoot: ui.root, edges: ui.edges, anchorSelector: '.ganttSvgBar', selectedId: 2 });
  assert.match(ui.overlay().innerHTML, /data-dependency-from="1" data-dependency-to="2"/);
  assert.equal(label.classList.contains('dependencyHoverSelected'), true);
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverSelected'), true);
  assert.equal(label.getAttribute('data-dependency-step'), '2');
  assert.equal(unrelated.classList.contains('dependencyHoverDimmed'), true);
  controller.destroy();
});

test('an isolated explicit selection stays bright and clearing it restores the complete view', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: [], selectedId: 2 });
  assert.equal(ui.overlay().innerHTML, '');
  assert.equal(ui.nodes[1].getAttribute('data-dependency-step'), '1');
  assert.deepEqual(ui.nodes.map(node => node.classList.contains('dependencyHoverDimmed')), [true, false, true, true]);
  controller.setSelected(0);
  ui.nodes.forEach(node => {
    assert.equal(node.classList.contains('dependencyHoverDimmed'), false);
    assert.equal(node.getAttribute('data-dependency-step'), undefined);
  });
  controller.destroy();
});

test('pointer leave, focus changes, blur and drag preserve explicit selection', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2 });
  ui.nodes[2].fire('pointerenter', { pointerType: 'mouse' });
  ui.nodes[2].fire('pointerleave');
  ui.nodes[2].fire('focusin');
  ui.nodes[1].fire('focusout', { relatedTarget: null });
  ui.window.fire('blur');
  ui.root.fire('dragstart');
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverSelected'), true);
  assert.equal(ui.nodes[2].classList.contains('dependencyHoverDependent'), true);
  assert.equal(ui.nodes[3].classList.contains('dependencyHoverDimmed'), true);
  assert.equal(ui.root.scrollLeft, 0);
  controller.destroy();
  ui.nodes.forEach(node => {
    assert.equal(node.classList.contains('dependencyHoverSelected'), false);
    assert.equal(node.classList.contains('dependencyHoverDimmed'), false);
    assert.equal(node.getAttribute('data-dependency-step'), undefined);
  });
});

test('hidden endpoints do not produce dangling arrows or shift a visible root to step two', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: [{ from: 99, to: 2 }, { from: 2, to: 3 }], selectedId: 2 });
  assert.doesNotMatch(ui.overlay().innerHTML, /data-dependency-from="99"/);
  assert.match(ui.overlay().innerHTML, /data-dependency-from="2" data-dependency-to="3"/);
  assert.equal(ui.nodes[1].getAttribute('data-dependency-step'), '1');
  assert.equal(ui.nodes[2].getAttribute('data-dependency-step'), '2');
  controller.destroy();
});

test('scroll and resize update geometry, and rewiring disposes every old overlay and listener', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2 });
  const before = ui.overlay().innerHTML;
  ui.root.scrollLeft = 17;
  ui.window.fire('scroll');
  ui.flush();
  assert.notEqual(ui.overlay().innerHTML, before);
  assert.equal(ui.root.scrollLeft, 17);
  const previousOverlay = ui.overlay();
  const replacement = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges });
  assert.equal(previousOverlay.listenerCount('pointerover'), 0);
  assert.equal(ui.nodes[1].listenerCount('pointerenter'), 0);
  assert.equal(ui.overlay().innerHTML, '');
  assert.equal(ui.root.children.filter(child => child.getAttribute('class') === 'dependencyHoverOverlay').length, 1);
  replacement.destroy();
  assert.equal(ui.window.listenerCount('scroll'), 0);
  assert.equal(ui.overlay(), undefined);
  assert.equal(ui.root.classList.contains('dependencyHoverSurface'), false);
  controller.destroy();
});

test('shrinking content discards the previous drawing extent before measuring overflow', () => {
  const ui = uiFixture();
  let contentWidth = 640;
  let contentHeight = 300;
  Object.defineProperties(ui.root, {
    scrollWidth: { get() { return Math.max(contentWidth, +(ui.overlay()?.getAttribute('width') || 0)); } },
    scrollHeight: { get() { return Math.max(contentHeight, +(ui.overlay()?.getAttribute('height') || 0)); } },
  });
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2 });
  assert.equal(ui.overlay().getAttribute('width'), '640');
  contentWidth = ui.root.clientWidth = 430;
  contentHeight = ui.root.clientHeight = 240;
  ui.root.bounds = rect(0, 0, 430, 240);
  ui.nodes[0].bounds = rect(20, 20, 80, 80);
  ui.nodes[1].bounds = rect(120, 20, 180, 80);
  ui.nodes[2].bounds = rect(120, 140, 180, 200);
  ui.nodes[3].bounds = rect(240, 140, 300, 200);
  ui.window.fire('resize');
  ui.flush();
  assert.equal(ui.overlay().getAttribute('width'), '430');
  assert.equal(ui.overlay().getAttribute('height'), '240');
  assert.equal(ui.root.scrollWidth, 430);
  controller.setSelected(0);
  assert.equal(ui.overlay().getAttribute('width'), '1');
  assert.equal(ui.overlay().getAttribute('height'), '1');
  controller.destroy();
});

test('a branching source uses one fixed output and uniform rails rather than increasing outer extents', () => {
  const positions = new Map([[1, rect(420, 30, 620, 130)], [2, rect(120, 220, 320, 320)], [3, rect(420, 220, 620, 320)]]);
  const edges = [{ from: 1, to: 2 }, { from: 1, to: 3 }];
  const routes = hover.routeConnections(edges, positions, [...positions.values()], rect(1, 1, 720, 360), { selectedId: 1, clearance: 12 });
  assert.equal(routes.length, 2);
  routes.forEach(route => {
    assertSafeRoute(route.points, [...positions.values()]);
    assert.deepEqual(route.points[0], { x: 620, y: 80 });
    assert.equal(route.sourceLead, route.targetLead);
    assert.equal(route.role, 'prerequisite');
    assert.equal(route.sourceStep, 1);
  });
  assert.equal(routes[0].points[1].x, routes[1].points[1].x, 'same-color branches use the same output rail');
  assert.equal(routes[0].points[1].x, 670, 'the output rail sits in the middle of the available gutter');
  assert.deepEqual(hover.routeConnections(edges.slice().reverse(), positions, [...positions.values()], rect(1, 1, 720, 360), { selectedId: 1, clearance: 12 }), routes);
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
  routes.filter(route => route.role === 'active').forEach(route => route.points.slice(1).forEach((point, index) => {
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
  const outgoing = routes.filter(route => route.role === 'active');
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
