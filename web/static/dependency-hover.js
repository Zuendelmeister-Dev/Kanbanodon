(function (global) {
  'use strict';

  const controllers = new WeakMap();
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let nextOverlayId = 0;

  // A hover is a one-hop view: incoming and outgoing edges, never a traversal.
  function directEdges(edges, id) {
    const selected = +id;
    const seen = new Set();
    return (edges || []).filter(edge => {
      const from = +edge.from;
      const to = +edge.to;
      const key = from + '>' + to;
      if (!(from > 0 && to > 0) || from === to || (from !== selected && to !== selected) || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(edge => ({ from: +edge.from, to: +edge.to }));
  }

  function normalizeRect(rect) {
    const left = +rect.left;
    const top = +rect.top;
    const right = Number.isFinite(+rect.right) ? +rect.right : left + +rect.width;
    const bottom = Number.isFinite(+rect.bottom) ? +rect.bottom : top + +rect.height;
    return { left, top, right, bottom };
  }

  function inside(point, rect) {
    return point.x > rect.left + 0.01 && point.x < rect.right - 0.01 && point.y > rect.top + 0.01 && point.y < rect.bottom - 0.01;
  }

  // Touching an obstacle boundary is allowed; crossing its interior is not.
  function segmentBlocked(a, b, obstacles) {
    return obstacles.some(rect => {
      if (Math.abs(a.x - b.x) < 0.01) return a.x > rect.left + 0.01 && a.x < rect.right - 0.01 && Math.max(a.y, b.y) > rect.top + 0.01 && Math.min(a.y, b.y) < rect.bottom - 0.01;
      if (Math.abs(a.y - b.y) < 0.01) return a.y > rect.top + 0.01 && a.y < rect.bottom - 0.01 && Math.max(a.x, b.x) > rect.left + 0.01 && Math.min(a.x, b.x) < rect.right - 0.01;
      return true;
    });
  }

  function compactPath(points) {
    const result = [];
    points.forEach(point => {
      const last = result[result.length - 1];
      if (last && Math.abs(last.x - point.x) < 0.01 && Math.abs(last.y - point.y) < 0.01) return;
      const before = result[result.length - 2];
      if (before && ((before.x === last.x && last.x === point.x) || (before.y === last.y && last.y === point.y))) result.pop();
      result.push(point);
    });
    return result;
  }

  function pathLength(points) {
    return points.slice(1).reduce((length, point, index) => length + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0);
  }

  function ports(rect, clearance) {
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.top + rect.bottom) / 2;
    return [
      { edge: { x: rect.left, y: cy }, outer: { x: rect.left - clearance, y: cy } },
      { edge: { x: rect.right, y: cy }, outer: { x: rect.right + clearance, y: cy } },
      { edge: { x: cx, y: rect.top }, outer: { x: cx, y: rect.top - clearance } },
      { edge: { x: cx, y: rect.bottom }, outer: { x: cx, y: rect.bottom + clearance } },
    ];
  }

  function inBounds(point, bounds) {
    return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
  }

  function sameRect(a, b) {
    return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
  }

  // Route around cards/rows, with endpoints on their borders. No text-crossing
  // fallback is used when a clipped or tightly packed layout has no safe route.
  function routeConnection(sourceValue, targetValue, obstacleValues, boundsValue, clearance = 4) {
    const source = normalizeRect(sourceValue);
    const target = normalizeRect(targetValue);
    const bounds = normalizeRect(boundsValue);
    if (![source, target, bounds].every(rect => [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite))) return [];
    const raw = (obstacleValues || []).map(normalizeRect);
    if (!raw.some(rect => sameRect(rect, source))) raw.push(source);
    if (!raw.some(rect => sameRect(rect, target))) raw.push(target);
    const obstacles = raw.map(rect => ({ left: rect.left - clearance, top: rect.top - clearance, right: rect.right + clearance, bottom: rect.bottom + clearance }));
    const usablePorts = rect => ports(rect, clearance).filter(port => inBounds(port.outer, bounds) && !obstacles.some(obstacle => inside(port.outer, obstacle)) && !segmentBlocked(port.edge, port.outer, raw.filter(other => !sameRect(other, rect))));
    const starts = usablePorts(source);
    const ends = usablePorts(target);
    if (!starts.length || !ends.length) return [];
    const xs = [...new Set([bounds.left, bounds.right, ...obstacles.flatMap(rect => [rect.left, rect.right]), ...starts.concat(ends).map(port => port.outer.x)])].filter(x => x >= bounds.left && x <= bounds.right).sort((a, b) => a - b);
    const ys = [...new Set([bounds.top, bounds.bottom, ...obstacles.flatMap(rect => [rect.top, rect.bottom]), ...starts.concat(ends).map(port => port.outer.y)])].filter(y => y >= bounds.top && y <= bounds.bottom).sort((a, b) => a - b);
    let best = null;
    let bestScore = Infinity;
    const consider = (start, middle, end) => {
      const path = compactPath([start.edge, ...middle, end.edge]);
      const score = pathLength(path) + Math.max(0, path.length - 2) * 8;
      if (score >= bestScore || middle.some(point => !inBounds(point, bounds))) return;
      if (middle.slice(1).some((point, index) => segmentBlocked(middle[index], point, obstacles))) return;
      best = path;
      bestScore = score;
    };
    starts.forEach(start => ends.forEach(end => {
      const a = start.outer;
      const b = end.outer;
      consider(start, [a, { x: b.x, y: a.y }, b], end);
      consider(start, [a, { x: a.x, y: b.y }, b], end);
      xs.forEach(x => consider(start, [a, { x, y: a.y }, { x, y: b.y }, b], end));
      ys.forEach(y => consider(start, [a, { x: a.x, y }, { x: b.x, y }, b], end));
    }));
    if (best) return best;

    // More complex swimlanes can require several turns. Search only grid
    // channels defined by rectangle edges, rather than pixels in the viewport.
    const gridPoint = index => ({ x: xs[index % xs.length], y: ys[Math.floor(index / xs.length)] });
    const gridIndex = point => ys.indexOf(point.y) * xs.length + xs.indexOf(point.x);
    const targets = new Map(ends.map(port => [gridIndex(port.outer), port]));
    const distances = new Map();
    const previous = new Map();
    const origins = new Map();
    const queue = [];
    const push = item => {
      queue.push(item);
      let index = queue.length - 1;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (queue[parent].score <= item.score) break;
        queue[index] = queue[parent];
        index = parent;
      }
      queue[index] = item;
    };
    const pop = () => {
      const first = queue[0];
      const last = queue.pop();
      if (queue.length) {
        let index = 0;
        while (index * 2 + 1 < queue.length) {
          let child = index * 2 + 1;
          if (child + 1 < queue.length && queue[child + 1].score < queue[child].score) child++;
          if (queue[child].score >= last.score) break;
          queue[index] = queue[child];
          index = child;
        }
        queue[index] = last;
      }
      return first;
    };
    starts.forEach(port => {
      const key = gridIndex(port.outer) * 3;
      distances.set(key, 0);
      origins.set(key, port);
      push({ key, score: 0 });
    });
    const pointCache = new Map();
    const edgeCache = new Map();
    while (queue.length) {
      const current = pop();
      if (current.score !== distances.get(current.key)) continue;
      const index = Math.floor(current.key / 3);
      const direction = current.key % 3;
      const point = gridPoint(index);
      if (targets.has(index)) {
        const middle = [point];
        let key = current.key;
        while (previous.has(key)) { key = previous.get(key); middle.unshift(gridPoint(Math.floor(key / 3))); }
        return compactPath([origins.get(key).edge, ...middle, targets.get(index).edge]);
      }
      const x = index % xs.length;
      const y = Math.floor(index / xs.length);
      const neighbors = [];
      if (x > 0) neighbors.push([index - 1, 1]);
      if (x + 1 < xs.length) neighbors.push([index + 1, 1]);
      if (y > 0) neighbors.push([index - xs.length, 2]);
      if (y + 1 < ys.length) neighbors.push([index + xs.length, 2]);
      neighbors.forEach(([next, nextDirection]) => {
        if (!pointCache.has(next)) pointCache.set(next, !obstacles.some(rect => inside(gridPoint(next), rect)));
        if (!pointCache.get(next)) return;
        const edgeKey = Math.min(index, next) + ':' + Math.max(index, next);
        if (!edgeCache.has(edgeKey)) edgeCache.set(edgeKey, !segmentBlocked(point, gridPoint(next), obstacles));
        if (!edgeCache.get(edgeKey)) return;
        const nextKey = next * 3 + nextDirection;
        const score = current.score + pathLength([point, gridPoint(next)]) + (direction && direction !== nextDirection ? 8 : 0);
        if (score >= (distances.get(nextKey) ?? Infinity)) return;
        distances.set(nextKey, score);
        previous.set(nextKey, current.key);
        push({ key: nextKey, score });
      });
    }
    return [];
  }

  function pathData(points) {
    return points.map((point, index) => (index ? 'L' : 'M') + point.x.toFixed(1) + ' ' + point.y.toFixed(1)).join(' ');
  }

  function wire(root, options = {}) {
    if (!root) return null;
    controllers.get(root)?.destroy();
    const layerRoot = options.layerRoot;
    const nodes = [...root.querySelectorAll(options.nodesSelector || '[data-work-id]')];
    if (!layerRoot || !nodes.length) return null;
    const document = root.ownerDocument;
    const window = document.defaultView;
    const idAttribute = options.idAttribute || 'data-work-id';
    const idOf = node => +node.getAttribute(idAttribute);
    const anchors = nodes.filter(node => layerRoot.contains(node)).map(node => ({ node, anchor: options.anchorSelector ? node.querySelector(options.anchorSelector) : node, id: idOf(node) })).filter(item => item.anchor && item.id > 0);
    const overlay = document.createElementNS(SVG_NS, 'svg');
    overlay.setAttribute('class', 'dependencyHoverOverlay');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('focusable', 'false');
    overlay.setAttribute('width', '1');
    overlay.setAttribute('height', '1');
    layerRoot.classList.add('dependencyHoverSurface');
    layerRoot.append(overlay);
    const markerId = 'dependencyHoverArrow' + ++nextOverlayId;
    const definitions = '<defs><marker id="' + markerId + '" viewBox="0 0 16 18" refX="15" refY="9" markerWidth="16" markerHeight="18" orient="auto" markerUnits="userSpaceOnUse" overflow="visible"><path d="M5 1 L15 9 L5 17 Z"></path></marker></defs>';
    let hovered = 0;
    let focused = 0;
    let frame = 0;
    let destroyed = false;
    const listeners = [];
    const resetOverlay = () => {
      overlay.innerHTML = '';
      // Absolute SVG dimensions participate in scroll overflow. Discard the
      // previous drawing's extent before measuring the current content size.
      overlay.setAttribute('width', '1');
      overlay.setAttribute('height', '1');
      overlay.setAttribute('viewBox', '0 0 1 1');
    };
    const listen = (target, name, handler, capture = false) => {
      target.addEventListener(name, handler, capture);
      listeners.push(() => target.removeEventListener(name, handler, capture));
    };
    const draw = () => {
      frame = 0;
      if (destroyed) return;
      const selected = hovered || focused;
      const edges = directEdges(options.edges, selected);
      const related = new Set(edges.flatMap(edge => [edge.from, edge.to]));
      nodes.forEach(node => {
        node.classList.toggle('dependencyHoverActive', selected > 0 && idOf(node) === selected);
        node.classList.toggle('dependencyHoverRelated', idOf(node) !== selected && related.has(idOf(node)));
        node.classList.toggle('dependencyHoverDimmed', selected > 0 && idOf(node) !== selected && !related.has(idOf(node)));
      });
      resetOverlay();
      if (!selected || !edges.length || !layerRoot.isConnected) return;
      const surface = layerRoot.getBoundingClientRect();
      if (surface.width < 1 || surface.height < 1) return;
      const rectFor = element => {
        const rect = element.getBoundingClientRect();
        const left = rect.left - surface.left - layerRoot.clientLeft + layerRoot.scrollLeft;
        const top = rect.top - surface.top - layerRoot.clientTop + layerRoot.scrollTop;
        return { left, top, right: left + rect.width, bottom: top + rect.height };
      };
      const positions = new Map();
      anchors.forEach(item => {
        const rect = rectFor(item.anchor);
        if (rect.right > rect.left && rect.bottom > rect.top) positions.set(item.id, rect);
      });
      const obstacles = options.obstaclesSelector ? [...layerRoot.querySelectorAll(options.obstaclesSelector)].map(rectFor) : [...positions.values()];
      const width = Math.max(layerRoot.clientWidth, layerRoot.scrollWidth);
      const height = Math.max(layerRoot.clientHeight, layerRoot.scrollHeight);
      overlay.setAttribute('width', String(width));
      overlay.setAttribute('height', String(height));
      overlay.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      let outlines = '';
      let lines = '';
      let dots = '';
      let heads = '';
      edges.forEach(edge => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return;
        const route = routeConnection(from, to, obstacles, { left: 1, top: 1, right: width - 1, bottom: height - 1 });
        if (route.length < 2) return;
        const path = pathData(route);
        outlines += '<path class="dependencyHoverOutline" d="' + path + '"></path>';
        lines += '<path class="dependencyHoverLine" data-dependency-from="' + edge.from + '" data-dependency-to="' + edge.to + '" d="' + path + '"></path>';
        dots += '<circle class="dependencyHoverDot" cx="' + route[0].x + '" cy="' + route[0].y + '" r="3"></circle>';
        // The head stays wide enough to show direction even when the last bend
        // is only a few pixels away in a table gutter or between short bars.
        heads += '<path class="dependencyHoverArrowHead" d="' + pathData(route.slice(-2)) + '" marker-end="url(#' + markerId + ')"></path>';
      });
      // Incoming arrowheads remain visible where an outgoing line shares a port.
      overlay.innerHTML = lines ? definitions + outlines + lines + dots + heads : '';
    };
    const refresh = () => {
      if (!destroyed && !frame) frame = window.requestAnimationFrame(draw);
    };
    const clear = () => {
      hovered = focused = 0;
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      nodes.forEach(node => node.classList.remove('dependencyHoverActive', 'dependencyHoverRelated', 'dependencyHoverDimmed'));
      resetOverlay();
    };
    nodes.forEach(node => {
      listen(node, 'pointerenter', event => { if (event.pointerType === 'touch') return; hovered = idOf(node); draw(); });
      listen(node, 'pointerleave', () => { if (hovered === idOf(node)) hovered = 0; draw(); });
      listen(node, 'focusin', () => { focused = idOf(node); draw(); });
      listen(node, 'focusout', event => { if (!node.contains(event.relatedTarget) && focused === idOf(node)) { focused = 0; draw(); } });
    });
    listen(root, 'dragstart', clear);
    listen(window, 'blur', clear);
    listen(window, 'scroll', refresh, true);
    listen(window, 'resize', refresh);
    const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(refresh) : null;
    observer?.observe(layerRoot);
    anchors.forEach(item => observer?.observe(item.anchor));
    const controller = {
      clear,
      refresh,
      destroy() {
        if (destroyed) return;
        clear();
        destroyed = true;
        observer?.disconnect();
        listeners.forEach(remove => remove());
        overlay.remove();
        layerRoot.classList.remove('dependencyHoverSurface');
        controllers.delete(root);
      },
    };
    controllers.set(root, controller);
    return controller;
  }

  const api = { directEdges, routeConnection, segmentBlocked, pathData, wire };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.KanbanodonDependencyHover = api;
})(typeof window === 'undefined' ? null : window);
