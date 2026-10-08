const assert = require('node:assert/strict');
const test = require('node:test');
const hover = require('./dependency-hover.js');
const rect = (left, top, right, bottom) => ({ left, top, right, bottom });

function assertSafeRoute(path, obstacles) {
  assert.ok(path.length >= 2, 'a visible route exists');
  path.slice(1).forEach((point, index) => {
    assert.ok(point.x === path[index].x || point.y === path[index].y, 'segments are orthogonal');
    assert.equal(hover.segmentBlocked(path[index], point, obstacles), false, 'segments never cross card/row interiors');
  });
}

function length(path) {
  return path.slice(1).reduce((total, point, index) => total + Math.abs(point.x - path[index].x) + Math.abs(point.y - path[index].y), 0);
}

function routed(edges, positions, options = {}, obstacles = [...positions.values()], bounds = rect(1, 1, 720, 600)) {
  return hover.routeConnections(edges, positions, obstacles, bounds, options);
}
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
    const styles = new Map();
    const node = eventTarget({
      ownerDocument: document,
      children: [],
      isConnected: true,
      clientLeft: 0, clientTop: 0, scrollLeft: 0, scrollTop: 0,
      clientWidth: bounds.right - bounds.left, scrollWidth: bounds.right - bounds.left,
      clientHeight: bounds.bottom - bounds.top, scrollHeight: bounds.bottom - bounds.top,
      bounds,
      style: {
        getPropertyValue(name) { return styles.get(name)?.value || ''; },
        getPropertyPriority(name) { return styles.get(name)?.priority || ''; },
        setProperty(name, value, priority = '') { styles.set(name, { value: String(value), priority }); },
        removeProperty(name) { const previous = styles.get(name)?.value || ''; styles.delete(name); return previous; },
      },
      classList: {
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
        contains(name) { return classes.has(name); },
        toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      },
      setAttribute(name, value) {
        attrs.set(name, value);
        if (name === 'class') { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(item => classes.add(item)); }
      },
      removeAttribute(name) { attrs.delete(name); },
      getAttribute(name) { return attrs.get(name); },
      append(child) { child.parent = node; node.children.push(child); },
      remove() { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node); node.isConnected = false; },
      contains(child) { return child === node || node.children.some(item => item.contains(child)); },
      querySelector(selector) { return node.querySelectorAll(selector)[0] || null; },
      querySelectorAll(selector) {
        const attribute = /^\[([\w-]+)\]$/.exec(selector)?.[1];
        const matches = child => attribute ? child.getAttribute(attribute) !== undefined : selector.startsWith('.') && child.classList.contains(selector.slice(1));
        const descendants = child => child.children.flatMap(item => [item, ...descendants(item)]);
        return descendants(node).filter(matches);
      },
      closest(selector) {
        const attribute = /^\[([\w-]+)\]$/.exec(selector)?.[1];
        return attribute && attrs.has(attribute) ? node : node.parent?.closest(selector);
      },
      getBoundingClientRect() { node.layoutReads = (node.layoutReads || 0) + 1; return { ...node.bounds, width: node.bounds.right - node.bounds.left, height: node.bounds.bottom - node.bounds.top }; },
      focus() { assert.fail('hover must not move keyboard focus'); },
      scrollIntoView() { assert.fail('hover must not scroll the page'); },
    });
    let markup = '';
    Object.defineProperty(node, 'innerHTML', {
      get() { return markup; },
      set(value) {
        markup = value;
        node.children = [];
        // Preserve SVG parent relationships for actual hit-path and numbered
        // badge targets, and inspect CSSOM paint instead of inline HTML style.
        const parents = [node];
        for (const match of value.matchAll(/<(\/)?([a-z]+)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/g)) {
          if (match[1]) { parents.pop(); continue; }
          const child = element();
          child.tagName = match[2];
          for (const attr of match[3].matchAll(/([\w-]+)="([^"]*)"/g)) child.setAttribute(attr[1], attr[2]);
          parents.at(-1).append(child);
          if (!match[3].endsWith('/')) parents.push(child);
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


test('direct links preserve direction and remove duplicate, invalid and self links', () => {
  const edges = [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 4, to: 2 }, { from: 3, to: 5 }, { from: 6, to: 1 }, { from: 2, to: 3 }, { from: 2, to: 2 }];
  assert.deepEqual(hover.directEdges(edges, 2), [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 4, to: 2 }]);
  assert.deepEqual(hover.directEdges(edges, 0), []);
});

test('connected links include every upstream, downstream and branching task without unrelated graphs', () => {
  const connected = [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 5, to: 3 }, { from: 5, to: 6 }];
  const edges = [...connected, { from: 10, to: 11 }, { from: 3, to: 4 }, { from: 0, to: 2 }, { from: 2, to: 2 }];
  assert.deepEqual(hover.connectedEdges(edges, 2), connected);
  assert.deepEqual(hover.connectedEdges(edges, 6), connected);
  assert.deepEqual(hover.connectedEdges(edges, 99), []);
  assert.deepEqual(hover.connectedEdges(edges, 0), []);
  assert.equal(hover.connectedEdges([{ from: 1, to: 2 }, { from: 2, to: 1 }], 1).length, 2, 'invalid imported cycles terminate');
});

test('topological numbering starts at actual roots and handles converging branches', () => {
  const levels = hover.dependencySteps([{ from: 1, to: 3 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 1, to: 4 }], 4);
  assert.deepEqual([...levels].sort((a, b) => a[0] - b[0]), [[1, 1], [2, 1], [3, 2], [4, 3]]);
  assert.deepEqual([...hover.dependencySteps([], 7)], [[7, 1]]);
  assert.equal(hover.dependencySteps([{ from: 1, to: 2 }, { from: 2, to: 1 }], 1).size, 2);
});

test('stage colors progress once from blue through an actual gold middle stage to teal', () => {
  assert.deepEqual(hover.stagePalette(1), [{ step: 1, color: '#60a5fa' }]);
  assert.deepEqual(hover.stagePalette(2), [{ step: 1, color: '#60a5fa' }, { step: 2, color: '#37c7ad' }]);
  assert.deepEqual(hover.stagePalette(3).map(stage => stage.color), ['#60a5fa', '#f4b83f', '#37c7ad']);
  assert.deepEqual(hover.stagePalette(4).map(stage => stage.color), ['#60a5fa', '#f4b83f', '#96c076', '#37c7ad']);
  assert.deepEqual(hover.stagePalette(5).map(stage => stage.color), ['#60a5fa', '#aaaf9d', '#f4b83f', '#96c076', '#37c7ad']);
  for (const count of [3, 4, 5, 6, 7, 10]) {
    assert.equal(hover.stageColor(1, count), '#60a5fa');
    assert.equal(hover.stageColor(Math.ceil(count / 2), count), '#f4b83f');
    assert.equal(hover.stageColor(count, count), '#37c7ad');
    assert.equal(new Set(hover.stagePalette(count).map(stage => stage.color)).size, count, 'later stages never reset to earlier colors');
  }
  assert.equal(hover.stageColor(0, 5), '#60a5fa');
  assert.equal(hover.stageColor(99, 5), '#37c7ad');
  assert.deepEqual(hover.stagePalette(Infinity), [{ step: 1, color: '#60a5fa' }]);
});

test('branching tasks share their stage color and selection cannot shift the component palette', () => {
  const edges = [{ from: 1, to: 3 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 3, to: 5 }, { from: 4, to: 6 }];
  const colorsFor = selected => {
    const levels = hover.dependencySteps(hover.connectedEdges(edges, selected), selected);
    const count = Math.max(...levels.values());
    return [...levels].sort((a, b) => a[0] - b[0]).map(([id, step]) => [id, step, hover.stageColor(step, count)]);
  };
  assert.deepEqual(colorsFor(1), colorsFor(6));
  const byId = new Map(colorsFor(3).map(([id, step, color]) => [id, { step, color }]));
  assert.deepEqual(byId.get(1), byId.get(2));
  assert.deepEqual(byId.get(4), byId.get(5));
  assert.equal(byId.get(3).color, '#f4b83f');
  assert.equal(byId.get(6).color, '#37c7ad');
});

test('a prerequisite on the right uses the facing left output and the middle gutter', () => {
  const positions = new Map([[1, rect(420, 30, 620, 130)], [2, rect(120, 220, 320, 320)]]);
  const route = routed([{ from: 1, to: 2 }], positions, { clearance: 12 })[0];
  assertSafeRoute(route.points, [...positions.values()]);
  assert.deepEqual(route.points[0], { x: 420, y: 80 });
  assert.deepEqual(route.points.at(-1), { x: 320, y: 270 });
  assert.deepEqual(route.points.slice(1, -1), [{ x: 370, y: 80 }, { x: 370, y: 270 }]);
  assert.equal(length(route.points), 290, 'the route uses only the direct horizontal and vertical distances');
});

test('a prerequisite on the left enters the facing left side of the dependent', () => {
  const positions = new Map([[1, rect(120, 30, 320, 130)], [2, rect(420, 220, 620, 320)]]);
  const route = routed([{ from: 1, to: 2 }], positions)[0];
  assertSafeRoute(route.points, [...positions.values()]);
  assert.equal(route.points[0].x, 320);
  assert.equal(route.points.at(-1).x, 420);
  assert.ok(route.points.slice(1, -1).every(point => point.x === 370));
});

test('aligned neighboring cards use a single straight arrow instead of a gutter detour', () => {
  const positions = new Map([[1, rect(120, 30, 320, 130)], [2, rect(420, 30, 620, 130)]]);
  const route = routed([{ from: 1, to: 2 }], positions)[0];
  assert.deepEqual(route.points, [{ x: 320, y: 80 }, { x: 420, y: 80 }]);
});

test('consecutive cards in one column connect bottom center to top center', () => {
  const positions = new Map([[1, rect(96, 30, 296, 130)], [2, rect(96, 160, 296, 260)], [3, rect(96, 290, 296, 390)]]);
  const routes = routed([{ from: 1, to: 2 }, { from: 2, to: 3 }], positions);
  assert.deepEqual(routes.map(route => route.points), [
    [{ x: 196, y: 130 }, { x: 196, y: 160 }],
    [{ x: 196, y: 260 }, { x: 196, y: 290 }],
  ]);
  routes.forEach(route => assertSafeRoute(route.points, [...positions.values()]));
});

test('an upward same-column dependency uses top center to bottom center', () => {
  const positions = new Map([[1, rect(96, 200, 296, 300)], [2, rect(96, 30, 296, 130)]]);
  assert.deepEqual(routed([{ from: 1, to: 2 }], positions)[0].points, [{ x: 196, y: 200 }, { x: 196, y: 130 }]);
});

test('branching sources choose a nearby port for each neighbor instead of sharing the farthest side', () => {
  const positions = new Map([[1, rect(420, 30, 620, 130)], [2, rect(120, 220, 320, 320)], [3, rect(420, 220, 620, 320)]]);
  const edges = [{ from: 1, to: 2 }, { from: 1, to: 3 }];
  const routes = routed(edges, positions, { clearance: 12 });
  assert.deepEqual(routes[0].points[0], { x: 420, y: 80 });
  assert.deepEqual(routes[1].points, [{ x: 520, y: 130 }, { x: 520, y: 220 }]);
  routes.forEach(route => assertSafeRoute(route.points, [...positions.values()]));
  assert.deepEqual(routed(edges.slice().reverse(), positions, { clearance: 12 }), routes);
});

test('an occupied input terminal moves the next output locally instead of surrounding the neighboring card', () => {
  const original = new Map([[1, rect(184, 1, 458, 94)], [2, rect(630, 100, 903, 392)],
    [3, rect(184, 126, 458, 436)], [4, rect(184, 467, 458, 690)]]);
  const edges = [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }];
  // This is the Prepare snack bar -> Order fern salad shape from the Board.
  // The first wire enters the side needed by the second wire's short output.
  for (const mirror of [false, true]) {
    const positions = new Map([...original].map(([id, box]) => [id, mirror ?
      rect(1174 - box.right, box.top, 1174 - box.left, box.bottom) : box]));
    const obstacles = [...positions.values()];
    const routes = routed(edges, positions, { clearance: 4 }, obstacles, rect(64, 1, 1110, 720));
    assert.equal(routes.length, edges.length);
    routes.forEach(route => assertSafeRoute(route.points, obstacles));
    const incoming = routes.find(route => route.from === 1);
    const outgoing = routes.find(route => route.from === 2);
    assert.equal(outgoing.points[0].x, incoming.points.at(-1).x, 'both terminals use the facing side');
    assert.ok(Math.abs(outgoing.points[0].y - incoming.points.at(-1).y) >= 18, 'terminals stay visibly separated');
    assert.ok(Math.abs(outgoing.points[0].y - incoming.points.at(-1).y) <= 36, 'the output only moves a short distance');
    assert.ok(length(outgoing.points) <= 200, 'the old bottom-to-top loop was over 800 px');
    assert.ok(outgoing.points.every(point => point.x >= (mirror ? 544 : 458) && point.x <= (mirror ? 716 : 630)), 'the arrow remains in the shared column gap');
    assert.ok(outgoing.points.every(point => point.y >= 246 && point.y <= 282), 'no segment circles above or below the target card');
    outgoing.points.slice(1).forEach((point, index) => assert.equal(hover.sharesTrack(outgoing.points[index], point, [incoming.points]), false));
    assert.deepEqual(routed(edges.slice().reverse(), positions, { clearance: 4 }, obstacles, rect(64, 1, 1110, 720)), routes,
      'input edge order cannot change the route');
  }
});

test('a full branching Board circuit retains all arrows and keeps the snack-bar output inside the column gap', () => {
  const positions = new Map([[2, rect(184, 30, 458, 234)], [5, rect(184, 264, 458, 468)],
    [7, rect(184, 498, 458, 702)], [8, rect(184, 732, 458, 936)], [9, rect(184, 966, 458, 1170)],
    [10, rect(184, 1200, 458, 1404)], [1, rect(630, 30, 903, 234)], [3, rect(630, 264, 903, 468)],
    [4, rect(630, 498, 903, 702)], [6, rect(630, 732, 903, 936)]]);
  const edges = [{ from: 1, to: 3 }, { from: 1, to: 5 }, { from: 2, to: 4 }, { from: 3, to: 6 },
    { from: 4, to: 9 }, { from: 5, to: 10 }, { from: 6, to: 7 }, { from: 7, to: 8 },
    { from: 8, to: 10 }, { from: 9, to: 10 }];
  const obstacles = [...positions.values()];
  const routes = routed(edges, positions, { clearance: 4 }, obstacles, rect(64, 1, 1110, 1430));
  assert.equal(routes.length, edges.length, 'shortening a branch never removes another arrow');
  routes.forEach((route, index) => {
    assertSafeRoute(route.points, obstacles);
    const reserved = routes.slice(0, index).filter(previous => previous.from !== route.from).map(previous => previous.points);
    route.points.slice(1).forEach((point, offset) => assert.equal(hover.sharesTrack(route.points[offset], point, reserved), false));
  });
  const snackBar = routes.find(route => route.from === 6 && route.to === 7);
  assert.ok(snackBar.points.every(point => point.x >= 458 && point.x <= 630), 'a free local gap beats going around either card');
  assert.ok(length(snackBar.points) < 450);
});

test('connections route around intervening cards without crossing text', () => {
  const source = rect(20, 30, 110, 90);
  const target = rect(320, 30, 410, 90);
  const obstacle = rect(160, 10, 270, 120);
  const path = hover.routeConnection(source, target, [source, obstacle, target], rect(0, 0, 440, 150));
  assertSafeRoute(path, [source, obstacle, target]);
  assert.ok(path.some(point => point.y <= obstacle.top - 4 || point.y >= obstacle.bottom + 4));
});

test('complex obstacles remain safe and an enclosed endpoint has no text-crossing fallback', () => {
  const source = rect(20, 20, 70, 70);
  const target = rect(330, 210, 380, 260);
  const obstacles = [source, target, rect(90, 0, 140, 210), rect(165, 90, 220, 300), rect(250, 0, 300, 205)];
  assertSafeRoute(hover.routeConnection(source, target, obstacles, rect(0, 0, 410, 310)), obstacles);
  assert.deepEqual(hover.routeConnection(rect(30, 30, 60, 60), target, [rect(0, 0, 100, 100), target], rect(0, 0, 410, 310)), []);
});

test('consecutive Overview rows reuse exactly the same gutter across different colors', () => {
  const positions = new Map([[1, rect(88, 30, 620, 110)], [2, rect(88, 110, 620, 190)], [3, rect(88, 190, 620, 270)]]);
  const routes = routed([{ from: 1, to: 2 }, { from: 2, to: 3 }], positions, { layout: 'overview', gutterWidth: 88 });
  assert.equal(routes.length, 2);
  assert.equal(routes[0].points[1].x, routes[1].points[1].x);
  assert.equal(routes[0].points[0].x - routes[0].points[1].x, routes[1].points[0].x - routes[1].points[1].x);
  routes.forEach(route => assertSafeRoute(route.points, [...positions.values()]));
  assert.deepEqual(routes.map(route => route.role), ['prerequisite', 'active']);
});

test('only overlapping Overview wires need neighboring free gutter lanes', () => {
  const positions = new Map([[1, rect(100, 30, 620, 110)], [2, rect(100, 110, 620, 190)], [3, rect(100, 190, 620, 270)]]);
  const routes = routed([{ from: 1, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 3 }], positions, { layout: 'overview', gutterWidth: 100 });
  assert.equal(routes.length, 3);
  const long = routes.find(route => route.from === 1 && route.to === 3);
  const short = routes.find(route => route.from === 2);
  assert.notEqual(long.points[1].x, short.points[1].x);
  short.points.slice(1).forEach((point, index) => assert.equal(hover.sharesTrack(short.points[index], point, [long.points]), false));
  routes.forEach(route => assertSafeRoute(route.points, [...positions.values()]));
});

test('Timeline arrows connect prerequisite finish to dependent start near the bars', () => {
  const positions = new Map([[1, rect(100, 84, 180, 112)], [2, rect(220, 204, 300, 232)], [3, rect(330, 324, 410, 352)]]);
  const routes = routed([{ from: 1, to: 2 }, { from: 2, to: 3 }], positions, { layout: 'timeline' });
  assert.equal(routes.length, 2);
  routes.forEach(route => {
    const source = positions.get(route.from);
    const target = positions.get(route.to);
    assertSafeRoute(route.points, [...positions.values()]);
    assert.equal(route.points[0].x, source.right);
    assert.equal(route.points.at(-1).x, target.left);
    assert.ok(route.points.every(point => point.x >= source.left && point.x <= target.right), 'no loop through the outer left chart gutter');
    assert.ok(length(route.points) < 230);
  });
});

test('Timeline overlapping bars avoid due-date badges without retreating to the outer gutter', () => {
  const source = rect(100, 84, 142, 112);
  const target = rect(105, 168, 147, 196);
  const dueBadge = rect(117, 144, 199, 164);
  const positions = new Map([[1, source], [2, target]]);
  const obstacles = [source, target, dueBadge];
  const route = routed([{ from: 1, to: 2 }], positions, { layout: 'timeline', gutterWidth: 100 }, obstacles)[0];
  assertSafeRoute(route.points, obstacles);
  assert.ok(route.points.every(point => point.x >= 85), 'routing remains near the task bars');
  assert.ok(length(route.points) < 170);
});

test('Timeline finish and start on the same date use one short vertical connection', () => {
  const positions = new Map([[1, rect(300, 170, 420, 198)], [2, rect(420, 290, 620, 318)]]);
  const route = routed([{ from: 1, to: 2 }], positions, { layout: 'timeline' })[0];
  assert.deepEqual(route.points, [{ x: 420, y: 198 }, { x: 420, y: 290 }]);
  assertSafeRoute(route.points, [...positions.values()]);
});

test('converging alternate Timeline ports have distinct input slots and do not share their final stems', () => {
  const positions = new Map([[1, rect(90, 80, 150, 108)], [2, rect(90, 170, 150, 198)], [3, rect(90, 300, 150, 328)]]);
  const routes = routed([{ from: 1, to: 3 }, { from: 2, to: 3 }], positions, { layout: 'timeline', clearance: 4 });
  assert.equal(routes.length, 2);
  assert.notDeepEqual(routes[0].points.at(-1), routes[1].points.at(-1));
  routes.forEach(route => assertSafeRoute(route.points, [...positions.values()]));
  routes[1].points.slice(1).forEach((point, index) =>
    assert.equal(hover.sharesTrack(routes[1].points[index], point, [routes[0].points]), false));
});

test('tiny Timeline bars still support distinct converging arrowheads and avoid badges', () => {
  const positions = new Map([[1, rect(100, 28, 106, 56)], [2, rect(105, 84, 111, 112)], [3, rect(101, 140, 107, 168)], [4, rect(115, 196, 121, 224)], [5, rect(100, 252, 106, 280)]]);
  const edges = [{ from: 1, to: 3 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 3, to: 5 }];
  const obstacles = [...positions.values(), rect(130, 60, 220, 80), rect(120, 172, 220, 192)];
  const routes = routed(edges, positions, { layout: 'timeline', clearance: 4 }, obstacles, rect(1, 1, 340, 300));
  assert.equal(routes.length, 4);
  routes.forEach(route => assertSafeRoute(route.points, obstacles));
  const incoming = routes.filter(route => route.to === 3);
  assert.equal(new Set(incoming.map(route => JSON.stringify(route.points.at(-1)))).size, 2);
});

test('clipped Timeline tasks produce no dangling arrow while visible relationships continue', () => {
  const positions = new Map([[1, rect(-200, 30, -120, 58)], [2, rect(100, 90, 130, 118)], [3, rect(100, 150, 130, 178)]]);
  const routes = routed([{ from: 1, to: 2 }, { from: 2, to: 3 }], positions, { layout: 'timeline' }, [...positions.values()], rect(1, 1, 350, 250));
  assert.deepEqual(routes.map(route => [route.from, route.to]), [[2, 3]]);
});

test('normal task and Epic hover do not open dependency previews', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges });
  ui.nodes.forEach(node => {
    node.fire('pointerenter', { pointerType: 'mouse' });
    node.fire('focusin');
    ui.root.fire('pointerover', { target: node, pointerType: 'mouse' });
    assert.equal(node.listenerCount('pointerenter'), 0);
    assert.equal(node.listenerCount('focusin'), 0);
    assert.equal(node.getAttribute('data-dependency-step'), undefined);
    assert.equal(node.classList.contains('dependencyHoverDimmed'), false);
  });
  assert.equal(ui.overlay().innerHTML, '');
  controller.destroy();
});

test('explicit selection reveals the complete chain and dims only disconnected tasks', () => {
  const ui = uiFixture();
  const unrelated = ui.element(10, rect(460, 220, 570, 280));
  ui.root.append(unrelated);
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2 });
  assert.match(ui.overlay().innerHTML, /data-dependency-from="3" data-dependency-to="4"/);
  assert.deepEqual(ui.nodes.map(node => node.getAttribute('data-dependency-step')), ['1', '2', '3', '4']);
  assert.equal(ui.nodes[3].classList.contains('dependencyHoverDependent'), true, 'the final stage is teal without cycling');
  const colors = ui.nodes.map(node => node.style.getPropertyValue('--dependency-color'));
  assert.deepEqual(colors, ['#60a5fa', '#f4b83f', '#96c076', '#37c7ad']);
  assert.equal(unrelated.classList.contains('dependencyHoverDimmed'), true);
  ui.nodes.forEach(node => assert.equal(node.classList.contains('dependencyHoverDimmed'), false));
  controller.setSelected(4);
  assert.deepEqual(ui.nodes.map(node => node.getAttribute('data-dependency-step')), ['1', '2', '3', '4']);
  assert.deepEqual(ui.nodes.map(node => node.style.getPropertyValue('--dependency-color')), colors);
  assert.equal(ui.nodes[3].classList.contains('dependencyHoverSelected'), true);
  controller.destroy();
});

test('each numbered wire, arrowhead and source badge matches the outgoing source frame', () => {
  const ui = uiFixture();
  const next = ui.element(5, rect(460, 230, 570, 290));
  ui.root.append(next);
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: [...ui.edges, { from: 4, to: 5 }], selectedId: 3 });
  assert.equal(next.getAttribute('data-dependency-step'), '5');
  assert.equal(next.classList.contains('dependencyHoverDependent'), true);
  const markup = ui.overlay().innerHTML;
  assert.doesNotMatch(markup, /\bstyle=/, 'dependency markup never relies on CSP-blocked inline styles');
  const coloredElements = ui.overlay().querySelectorAll('[data-dependency-color]');
  assert.ok(coloredElements.length > 0);
  coloredElements.forEach(element => {
    const color = element.getAttribute('data-dependency-color');
    assert.equal(element.style.getPropertyValue('--dependency-color'), color, 'stage color is applied using CSSOM');
    const paint = element.getAttribute('data-dependency-paint');
    if (paint) assert.equal(element.style.getPropertyValue(paint), color, 'actual stroke/fill is applied using CSSOM');
  });
  for (const [index, source] of ui.nodes.entries()) {
    const color = source.style.getPropertyValue('--dependency-color');
    assert.equal(color, hover.stageColor(index + 1, 5));
    const group = markup.match(new RegExp('<g class="dependencyHoverWire" data-dependency-wire="' + (index + 1) + '>' + (index + 2) + '"[\\s\\S]*?</g>'))?.[0];
    assert.ok(group, 'the source has a rendered wire');
    for (const className of ['Line', 'ArrowHead']) {
      assert.match(group, new RegExp('class="dependencyHover' + className + ' [^"]+" data-dependency-color="' + color + '"'));
    }
    const markerId = group.match(/marker-end="url\(#([^)]*)\)"/)[1];
    const marker = markup.match(new RegExp('<marker id="' + markerId + '"[\\s\\S]*?</marker>'))?.[0];
    assert.ok(marker, 'the wire references an existing stage marker');
    assert.match(marker, new RegExp('<path data-dependency-color="' + color + '" data-dependency-paint="fill"'), 'the arrowhead owns a concrete fill instead of relying on marker variable inheritance');
    const markerElement = coloredElements.find(element => element.getAttribute('id') === markerId);
    assert.equal(markerElement.style.getPropertyValue('--dependency-color'), color);
    const markerPath = coloredElements.find(element => element.tagName === 'path' && element.getAttribute('d') === 'M5 1 L15 9 L5 17 Z' && element.getAttribute('data-dependency-color') === color);
    assert.equal(markerPath.style.getPropertyValue('fill'), color, 'the marker path has the actual source color');
    assert.match(markup, new RegExp('class="dependencyHoverDot [^"]+" data-dependency-color="' + color + '" data-dependency-paint="stroke" data-dependency-source="' + (index + 1) + '"'));
    const sequence = markup.match(new RegExp('<g class="dependencyHoverSequence [^"]+"[^>]*data-dependency-source="' + (index + 1) + '"[\\s\\S]*?</g>'))?.[0];
    if (sequence) {
      assert.match(sequence, new RegExp('<circle data-dependency-color="' + color + '" data-dependency-paint="stroke"'), 'the source circle keeps the source frame color');
      assert.match(sequence, new RegExp('<text data-dependency-color="' + color + '" data-dependency-paint="fill"'), 'the source number keeps the source frame color');
    }
  }
  assert.equal(next.style.getPropertyValue('--dependency-color'), '#37c7ad');
  controller.destroy();
});

test('source circles and numbers are always painted above all Overview wire paths', () => {
  const ui = uiFixture();
  ui.nodes.forEach((node, index) => { node.bounds = rect(88, 20 + index * 60, 620, 80 + index * 60); });
  const controller = hover.wire(ui.root, { layerRoot: ui.root,
    edges: [{ from: 1, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 3 }, { from: 3, to: 4 }],
    selectedId: 2, layout: 'overview', gutterWidth: 88 });
  const markup = ui.overlay().innerHTML;
  const marksStart = markup.indexOf('<g class="dependencyHoverSourceMarks"');
  assert.ok(marksStart > markup.lastIndexOf('<path '), 'a later branch cannot paint over an earlier number');
  assert.ok(marksStart > markup.lastIndexOf('<g class="dependencyHoverWire"'));
  const marks = markup.slice(marksStart);
  assert.equal([...marks.matchAll(/class="dependencyHoverSequence /g)].length, 3, 'each outgoing source has one readable number');
  assert.equal([...marks.matchAll(/class="dependencyHoverDot /g)].length, 4, 'all source ports share the final decoration layer');
  assert.equal(markup.slice(0, marksStart).includes('class="dependencyHoverSequence '), false);
  assert.doesNotMatch(marks, /<path /);
  controller.destroy();
});

test('pointer hit targets isolate their wire and endpoint cards in every view without rerouting', () => {
  for (const layout of ['board', 'overview', 'timeline']) {
    const ui = uiFixture();
    if (layout === 'overview') ui.nodes.forEach((node, index) => { node.bounds = rect(88, 20 + index * 60, 620, 80 + index * 60); });
    const unrelated = ui.element(10, rect(460, 230, 570, 290));
    ui.root.append(unrelated);
    const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2, layout });
    const overlay = ui.overlay();
    const drawing = overlay.innerHTML;
    const groups = overlay.querySelectorAll('[data-dependency-wire]');
    const firstHit = groups[0].querySelector('.dependencyHoverHit');
    assert.ok(firstHit, layout + ' exposes a pointer hit area along the actual rendered route');
    assert.equal(firstHit.getAttribute('d'), groups[0].querySelector('.dependencyHoverLine').getAttribute('d'));
    const reads = ui.nodes.reduce((sum, node) => sum + node.layoutReads, ui.root.layoutReads);
    const opacity = [...ui.nodes, unrelated].map(node => node.classList.contains('dependencyHoverDimmed'));
    ui.root.scrollLeft = 17;
    ui.root.scrollTop = 40;
    overlay.fire('pointerover', { target: firstHit, pointerType: 'mouse' });
    assert.deepEqual(groups.map(group => group.classList.contains('dependencyHoverWireDimmed')), [false, true, true], layout);
    assert.deepEqual(ui.nodes.map(node => node.classList.contains('dependencyHoverDimmed')), [false, false, true, true]);
    const marks = overlay.querySelectorAll('[data-dependency-source]');
    marks.forEach(mark => assert.equal(mark.classList.contains('dependencyHoverWireDimmed'), mark.getAttribute('data-dependency-source') !== '1'));
    // Moving to another wire or a card changes opacity without a redraw,
    // selection change, scroll adjustment or geometry read.
    const secondHit = groups[1].querySelector('.dependencyHoverHit');
    overlay.fire('pointerout', { target: firstHit, relatedTarget: secondHit, pointerType: 'mouse' });
    assert.deepEqual(groups.map(group => group.classList.contains('dependencyHoverWireDimmed')), [true, false, true]);
    assert.deepEqual(ui.nodes.map(node => node.classList.contains('dependencyHoverDimmed')), [true, false, false, true]);
    overlay.fire('pointerout', { target: secondHit, relatedTarget: ui.nodes[0], pointerType: 'mouse' });
    assert.deepEqual(groups.map(group => group.classList.contains('dependencyHoverWireDimmed')), [false, true, true]);
    ui.root.fire('pointerout', { target: ui.nodes[0], relatedTarget: ui.root, pointerType: 'mouse' });
    groups.forEach(group => assert.equal(group.classList.contains('dependencyHoverWireDimmed'), false));
    marks.forEach(mark => assert.equal(mark.classList.contains('dependencyHoverWireDimmed'), false));
    ui.flush();
    assert.deepEqual([...ui.nodes, unrelated].map(node => node.classList.contains('dependencyHoverDimmed')), opacity);
    assert.equal(unrelated.classList.contains('dependencyHoverDimmed'), true);
    assert.equal(ui.nodes[1].classList.contains('dependencyHoverSelected'), true);
    assert.equal(overlay.innerHTML, drawing);
    assert.equal(ui.nodes.reduce((sum, node) => sum + node.layoutReads, ui.root.layoutReads), reads);
    assert.equal(ui.root.scrollLeft, 17);
    assert.equal(ui.root.scrollTop, 40);
    assert.doesNotMatch(drawing, /tabindex=|\bstyle=/);
    controller.destroy();
  }
});

test('card hover keeps every incoming and outgoing neighbor visible and restores the pinned circuit on leaving', () => {
  for (const layout of ['board', 'overview', 'timeline']) {
    const ui = uiFixture();
    if (layout === 'overview') ui.nodes.forEach((node, index) => { node.bounds = rect(88, 20 + index * 60, 620, 80 + index * 60); });
    const unrelated = ui.element(10, rect(460, 230, 570, 290));
    ui.root.append(unrelated);
    const tool = ui.element();
    ui.nodes[1].append(tool);
    const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 1, layout });
    const overlay = ui.overlay();
    const groups = overlay.querySelectorAll('[data-dependency-wire]');
    const markup = overlay.innerHTML;
    const reads = ui.nodes.reduce((sum, node) => sum + node.layoutReads, ui.root.layoutReads);
    const steps = ui.nodes.map(node => node.getAttribute('data-dependency-step'));
    ui.root.fire('pointerover', { target: tool, pointerType: 'mouse' });
    assert.deepEqual(groups.map(group => group.classList.contains('dependencyHoverWireDimmed')), [false, false, true], layout);
    assert.deepEqual(ui.nodes.map(node => node.classList.contains('dependencyHoverDimmed')), [false, false, false, true]);
    const sources = overlay.querySelectorAll('[data-dependency-source]');
    sources.forEach(mark => assert.equal(mark.classList.contains('dependencyHoverWireDimmed'), mark.getAttribute('data-dependency-source') === '3'));
    ui.root.fire('pointerout', { target: tool, relatedTarget: ui.nodes[1], pointerType: 'mouse' });
    assert.deepEqual(groups.map(group => group.classList.contains('dependencyHoverWireDimmed')), [false, false, true], 'moving inside a card keeps the same incident edges');
    ui.root.fire('pointerout', { target: ui.nodes[1], relatedTarget: ui.nodes[2], pointerType: 'mouse' });
    assert.deepEqual(groups.map(group => group.classList.contains('dependencyHoverWireDimmed')), [true, false, false]);
    assert.deepEqual(ui.nodes.map(node => node.classList.contains('dependencyHoverDimmed')), [true, false, false, false]);
    assert.equal(ui.nodes[0].classList.contains('dependencyHoverSelected'), true, 'hover never changes the pinned selection');
    ui.root.fire('pointerleave');
    assert.deepEqual(ui.nodes.map(node => node.classList.contains('dependencyHoverDimmed')), [false, false, false, false]);
    assert.equal(unrelated.classList.contains('dependencyHoverDimmed'), true);
    [...groups, ...sources].forEach(node => assert.equal(node.classList.contains('dependencyHoverWireDimmed'), false));
    ui.root.fire('pointerover', { target: tool, pointerType: 'touch' });
    assert.deepEqual(ui.nodes.map(node => node.classList.contains('dependencyHoverDimmed')), [false, false, false, false]);
    ui.flush();
    assert.equal(overlay.innerHTML, markup);
    assert.deepEqual(ui.nodes.map(node => node.getAttribute('data-dependency-step')), steps);
    assert.equal(ui.nodes.reduce((sum, node) => sum + node.layoutReads, ui.root.layoutReads), reads);
    controller.destroy();
    for (const event of ['pointerover', 'pointerout', 'pointerleave', 'pointercancel']) assert.equal(ui.root.listenerCount(event), 0);
  }
});

test('hovering a branching card includes both prerequisites and all direct dependents without later tasks', () => {
  const ui = uiFixture();
  const otherRoot = ui.element(5, rect(460, 230, 570, 290));
  ui.root.append(otherRoot);
  const edges = [{ from: 1, to: 2 }, { from: 5, to: 2 }, { from: 2, to: 3 }, { from: 2, to: 4 }, { from: 3, to: 4 }];
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges, selectedId: 3 });
  const overlay = ui.overlay();
  ui.root.fire('pointerover', { target: ui.nodes[1], pointerType: 'mouse' });
  overlay.querySelectorAll('[data-dependency-wire]').forEach(group => {
    assert.equal(group.classList.contains('dependencyHoverWireDimmed'), group.getAttribute('data-dependency-wire') === '3>4');
  });
  [...ui.nodes, otherRoot].forEach(node => assert.equal(node.classList.contains('dependencyHoverDimmed'), false));
  ui.window.fire('blur');
  overlay.querySelectorAll('[data-dependency-wire]').forEach(group => assert.equal(group.classList.contains('dependencyHoverWireDimmed'), false));
  controller.destroy();
});

test('source badge hover keeps its outgoing branches visible and leaving restores every arrow decoration', () => {
  const ui = uiFixture();
  ui.nodes.forEach((node, index) => { node.bounds = rect(88, 20 + index * 60, 620, 80 + index * 60); });
  const controller = hover.wire(ui.root, { layerRoot: ui.root,
    edges: [{ from: 1, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 3 }, { from: 3, to: 4 }],
    selectedId: 2, layout: 'overview', gutterWidth: 88 });
  const overlay = ui.overlay();
  const groups = overlay.querySelectorAll('[data-dependency-wire]');
  const marks = overlay.querySelectorAll('[data-dependency-source]');
  const badge = marks.find(mark => mark.classList.contains('dependencyHoverSequence') && mark.getAttribute('data-dependency-source') === '1');
  const badgeCircle = badge.querySelectorAll('[data-dependency-color]').find(child => child.tagName === 'circle');
  assert.ok(badgeCircle);
  overlay.fire('pointerover', { target: badgeCircle, pointerType: 'mouse' });
  groups.forEach(group => assert.equal(group.classList.contains('dependencyHoverWireDimmed'), group.getAttribute('data-dependency-from') !== '1'));
  marks.forEach(mark => assert.equal(mark.classList.contains('dependencyHoverWireDimmed'), mark.getAttribute('data-dependency-source') !== '1'));
  const sourceDot = marks.find(mark => mark.classList.contains('dependencyHoverDot') && mark.getAttribute('data-dependency-source') === '2');
  overlay.fire('pointerout', { target: badgeCircle, relatedTarget: sourceDot, pointerType: 'mouse' });
  groups.forEach(group => assert.equal(group.classList.contains('dependencyHoverWireDimmed'), group.getAttribute('data-dependency-from') !== '2'));
  for (const event of ['pointerleave', 'pointercancel']) {
    overlay.fire(event);
    [...groups, ...marks].forEach(node => assert.equal(node.classList.contains('dependencyHoverWireDimmed'), false));
    overlay.fire('pointerover', { target: badgeCircle, pointerType: 'mouse' });
  }
  ui.window.fire('blur');
  [...groups, ...marks].forEach(node => assert.equal(node.classList.contains('dependencyHoverWireDimmed'), false));
  controller.destroy();
});

test('touch, clearing, changing selection and disposal leave no lingering wire isolation or listeners', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2 });
  const overlay = ui.overlay();
  let groups = overlay.querySelectorAll('[data-dependency-wire]');
  overlay.fire('pointerover', { target: groups[0].querySelector('.dependencyHoverHit'), pointerType: 'touch' });
  groups.forEach(group => assert.equal(group.classList.contains('dependencyHoverWireDimmed'), false));
  overlay.fire('pointerover', { target: groups[0].querySelector('.dependencyHoverHit'), pointerType: 'mouse' });
  assert.equal(groups[1].classList.contains('dependencyHoverWireDimmed'), true);
  controller.clear();
  groups.forEach(group => assert.equal(group.classList.contains('dependencyHoverWireDimmed'), false));
  overlay.fire('pointerover', { target: groups[0].querySelector('.dependencyHoverHit'), pointerType: 'mouse' });
  controller.setSelected(3);
  groups = overlay.querySelectorAll('[data-dependency-wire]');
  groups.forEach(group => assert.equal(group.classList.contains('dependencyHoverWireDimmed'), false));
  overlay.fire('pointerover', { target: groups[0].querySelector('.dependencyHoverHit'), pointerType: 'mouse' });
  controller.setSelected(0);
  assert.equal(overlay.innerHTML, '');
  controller.destroy();
  for (const event of ['pointerover', 'pointerout', 'pointerleave', 'pointercancel']) assert.equal(overlay.listenerCount(event), 0);
  assert.equal(ui.window.listenerCount('blur'), 0);
  assert.equal(overlay.isConnected, false);
});

test('wire descriptions escape task names and remain accessible without keyboard tab stops', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 1,
    labelsById: new Map([[1, 'Map <habitats>'], [2, 'Prepare & inspect']]) });
  assert.match(ui.overlay().innerHTML, /<title>Map &lt;habitats&gt; → Prepare &amp; inspect<\/title>/);
  assert.match(ui.overlay().innerHTML, /role="img" aria-label="Dependency: Map &lt;habitats&gt; → Prepare &amp; inspect"/);
  assert.doesNotMatch(ui.overlay().innerHTML, /tabindex=|<habitats>/);
  controller.destroy();
});

test('Overview stage numbers mirror onto the first cell and are removed on clearing', () => {
  const ui = uiFixture();
  const cells = ui.nodes.map(() => ui.element());
  ui.nodes.forEach((node, index) => { node.querySelector = selector => selector === 'td:first-child' ? cells[index] : null; });
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2 });
  assert.deepEqual(cells.map(node => node.getAttribute('data-dependency-step')), ['1', '2', '3', '4']);
  assert.deepEqual(cells.map(node => node.style.getPropertyValue('--dependency-color')), ['#60a5fa', '#f4b83f', '#96c076', '#37c7ad']);
  controller.setSelected(0);
  cells.forEach(node => {
    assert.equal(node.getAttribute('data-dependency-step'), undefined);
    assert.equal(node.style.getPropertyValue('--dependency-color'), '');
  });
  controller.destroy();
});

test('clearing, switching components and destroying restore preexisting inline color values and priorities', () => {
  const ui = uiFixture();
  const cell = ui.element();
  ui.nodes[0].querySelector = selector => selector === 'td:first-child' ? cell : null;
  ui.nodes[0].style.setProperty('--dependency-color', 'rebeccapurple', 'important');
  ui.nodes[0].style.setProperty('--other-setting', '42');
  cell.style.setProperty('--dependency-color', '#123456');
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2 });
  assert.equal(ui.nodes[0].style.getPropertyValue('--dependency-color'), '#60a5fa');
  assert.equal(cell.style.getPropertyValue('--dependency-color'), '#60a5fa');
  controller.setSelected(0);
  assert.equal(ui.nodes[0].style.getPropertyValue('--dependency-color'), 'rebeccapurple');
  assert.equal(ui.nodes[0].style.getPropertyPriority('--dependency-color'), 'important');
  assert.equal(cell.style.getPropertyValue('--dependency-color'), '#123456');
  ui.nodes.slice(1).forEach(node => assert.equal(node.style.getPropertyValue('--dependency-color'), ''));
  controller.setSelected(3);
  assert.equal(ui.nodes[0].style.getPropertyValue('--dependency-color'), '#60a5fa');
  controller.setSelected(99);
  assert.equal(ui.nodes[0].style.getPropertyValue('--dependency-color'), 'rebeccapurple');
  controller.setSelected(4);
  controller.destroy();
  assert.equal(ui.nodes[0].style.getPropertyValue('--dependency-color'), 'rebeccapurple');
  assert.equal(ui.nodes[0].style.getPropertyPriority('--dependency-color'), 'important');
  assert.equal(cell.style.getPropertyValue('--dependency-color'), '#123456');
  assert.equal(ui.nodes[0].style.getPropertyValue('--other-setting'), '42');
  ui.nodes.slice(1).forEach(node => assert.equal(node.style.getPropertyValue('--dependency-color'), ''));
});

test('Timeline labels and bars share explicit selection using only main bars as anchors', () => {
  const ui = uiFixture();
  const eventRoot = ui.element();
  eventRoot.append(ui.root);
  const label = ui.element(2, rect(-200, 20, -10, 80));
  const unrelated = ui.element(10, rect(-200, 180, -10, 240));
  eventRoot.append(label);
  eventRoot.append(unrelated);
  eventRoot.querySelectorAll = () => [...ui.nodes, label, unrelated];
  const bars = ui.nodes.map(node => ui.element(null, node.bounds));
  ui.nodes.forEach((node, index) => {
    node.bounds = rect(0, 0, 640, 300);
    node.append(bars[index]);
    node.querySelector = selector => selector === '.ganttSvgBar' ? bars[index] : null;
  });
  const controller = hover.wire(eventRoot, { layerRoot: ui.root, edges: ui.edges, anchorSelector: '.ganttSvgBar', selectedId: 2, layout: 'timeline' });
  assert.match(ui.overlay().innerHTML, /data-dependency-from="1" data-dependency-to="2"/);
  assert.equal(label.classList.contains('dependencyHoverSelected'), true);
  assert.equal(ui.nodes[1].classList.contains('dependencyHoverSelected'), true);
  assert.equal(label.getAttribute('data-dependency-step'), '2');
  assert.equal(unrelated.classList.contains('dependencyHoverDimmed'), true);
  const drawing = ui.overlay().innerHTML;
  const reads = ui.root.layoutReads;
  eventRoot.fire('pointerover', { target: label, pointerType: 'mouse' });
  assert.deepEqual(ui.nodes.map(node => node.classList.contains('dependencyHoverDimmed')), [false, false, false, true]);
  assert.equal(label.classList.contains('dependencyHoverDimmed'), false, 'the text label and its bar share the same hover');
  assert.equal(ui.overlay().innerHTML, drawing);
  assert.equal(ui.root.layoutReads, reads);
  eventRoot.fire('pointerleave');
  ui.nodes.forEach(node => assert.equal(node.classList.contains('dependencyHoverDimmed'), false));
  controller.destroy();
});

test('an isolated selection stays bright and clearing restores every task', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: [], selectedId: 2 });
  assert.equal(ui.overlay().innerHTML, '');
  assert.deepEqual(ui.nodes.map(node => node.classList.contains('dependencyHoverDimmed')), [true, false, true, true]);
  controller.setSelected(0);
  ui.nodes.forEach(node => {
    assert.equal(node.classList.contains('dependencyHoverDimmed'), false);
    assert.equal(node.getAttribute('data-dependency-step'), undefined);
  });
  controller.destroy();
});

test('unavailable endpoints cannot shift a visible root to stage two', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: [{ from: 99, to: 2 }, { from: 2, to: 3 }], selectedId: 2 });
  assert.doesNotMatch(ui.overlay().innerHTML, /data-dependency-from="99"/);
  assert.equal(ui.nodes[1].getAttribute('data-dependency-step'), '1');
  assert.equal(ui.nodes[2].getAttribute('data-dependency-step'), '2');
  controller.destroy();
});

test('page and layer scrolling keep exactly the same arrow geometry without reading layout again', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2 });
  const before = ui.overlay().innerHTML;
  const reads = ui.nodes.reduce((sum, node) => sum + node.layoutReads, ui.root.layoutReads);
  ui.root.scrollLeft = 17;
  ui.root.scrollTop = 40;
  [ui.root, ...ui.nodes].forEach(node => {
    node.bounds = { left: node.bounds.left - 70, right: node.bounds.right - 70, top: node.bounds.top - 200, bottom: node.bounds.bottom - 200 };
  });
  ui.window.fire('scroll');
  ui.root.fire('scroll');
  ui.window.fire('blur');
  ui.root.fire('dragstart');
  ui.flush();
  assert.equal(ui.overlay().innerHTML, before);
  assert.equal(ui.nodes.reduce((sum, node) => sum + node.layoutReads, ui.root.layoutReads), reads);
  assert.equal(ui.window.listenerCount('scroll'), 0);
  assert.equal(ui.root.listenerCount('scroll'), 0);
  assert.equal(ui.root.scrollLeft, 17);
  assert.equal(ui.root.scrollTop, 40);
  controller.destroy();
});

test('actual resize recomputes geometry and rewiring disposes old overlays and listeners', () => {
  const ui = uiFixture();
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2 });
  const before = ui.overlay().innerHTML;
  ui.nodes[0].bounds = rect(20, 20, 150, 80);
  ui.window.fire('resize');
  ui.flush();
  assert.notEqual(ui.overlay().innerHTML, before);
  const previousOverlay = ui.overlay();
  const replacement = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges });
  assert.equal(previousOverlay.isConnected, false);
  assert.equal(ui.root.children.filter(child => child.getAttribute('class') === 'dependencyHoverOverlay').length, 1);
  assert.equal(ui.window.listenerCount('resize'), 1);
  replacement.destroy();
  assert.equal(ui.window.listenerCount('resize'), 0);
  assert.equal(ui.overlay(), undefined);
  assert.equal(ui.root.classList.contains('dependencyHoverSurface'), false);
  controller.destroy();
});

test('ResizeObserver ignores its initial notification and unchanged sizes after scroll', () => {
  const ui = uiFixture();
  let observer;
  ui.window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = []; observer = this; }
    observe(target) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }
    notify() { this.callback(this.targets.map(target => ({ target }))); }
  };
  const controller = hover.wire(ui.root, { layerRoot: ui.root, edges: ui.edges, selectedId: 2 });
  const before = ui.overlay().innerHTML;
  const reads = ui.root.layoutReads;
  observer.notify();
  ui.root.scrollLeft = 40;
  observer.notify();
  ui.flush();
  assert.equal(ui.overlay().innerHTML, before);
  assert.equal(ui.root.layoutReads, reads);
  ui.root.scrollLeft = 0;
  ui.nodes[0].clientWidth = 150;
  ui.nodes[0].bounds.right = 170;
  observer.notify();
  ui.flush();
  assert.notEqual(ui.overlay().innerHTML, before);
  controller.destroy();
  assert.equal(observer.disconnected, true);
});

test('shrinking content discards the previous SVG extent before measuring overflow', () => {
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
  controller.setSelected(0);
  assert.equal(ui.overlay().getAttribute('width'), '1');
  controller.destroy();
});
