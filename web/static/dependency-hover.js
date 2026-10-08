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
      if (before && ((before.x === last.x && last.x === point.x && overlapLength(before.y, point.y, last.y, last.y) >= 0) ||
        (before.y === last.y && last.y === point.y && overlapLength(before.x, point.x, last.x, last.x) >= 0))) result.pop();
      result.push(point);
    });
    return result;
  }

  function pathLength(points) {
    return points.slice(1).reduce((length, point, index) => length + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0);
  }

  function inBounds(point, bounds) {
    return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
  }

  function sameRect(a, b) {
    return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
  }

  function overlapLength(a, b, c, d) {
    return Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d));
  }

  // A different colour may cross a wire, but cannot hide underneath its trunk.
  function sharesTrack(a, b, routes) {
    return routes.some(route => route.slice(1).some((d, index) => {
      const c = route[index];
      return Math.abs(a.x - b.x) < 0.01 && Math.abs(c.x - d.x) < 0.01 && Math.abs(a.x - c.x) < 0.01 && overlapLength(a.y, b.y, c.y, d.y) > 0.01 ||
        Math.abs(a.y - b.y) < 0.01 && Math.abs(c.y - d.y) < 0.01 && Math.abs(a.y - c.y) < 0.01 && overlapLength(a.x, b.x, c.x, d.x) > 0.01;
    }));
  }

  function mergedBands(intervals) {
    const bands = [];
    intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]).forEach(interval => {
      const previous = bands[bands.length - 1];
      if (previous && interval[0] < previous[1] - 0.01) previous[1] = Math.max(previous[1], interval[1]);
      else bands.push(interval.slice());
    });
    return bands;
  }

  // Every branch has a stable PLC-like input/output port. Board outputs are
  // always on the right and inputs on the left. List/chart rows use a dedicated
  // left cable channel, with output below input, regardless of bar length.
  function circuitPort(rect, output, slot, count, layout, clearance) {
    const cy = (rect.top + rect.bottom) / 2;
    const list = layout !== 'board';
    const offset = Math.min(10, (rect.bottom - rect.top) / 4);
    const spacing = list ? Math.min(12, 2 * Math.max(0, offset - 3) / Math.max(1, count - 1)) :
      Math.min(18, Math.max(0, (rect.bottom - rect.top - 20) / Math.max(1, count - 1)));
    const fan = (slot - (count - 1) / 2) * spacing;
    const y = cy + fan + (list ? (output ? offset : -offset) : 0);
    const x = output && !list ? rect.right : rect.left;
    const direction = output && !list ? 1 : -1;
    return { edge: { x, y }, outer: { x: x + direction * clearance, y }, direction };
  }

  function extendPort(port, ownRect, obstacles, bounds, clearance, desired) {
    for (const lead of [...new Set([desired, 20, 12, clearance])].filter(value => value >= clearance)) {
      const outer = { x: port.edge.x + port.direction * lead, y: port.edge.y };
      const others = obstacles.filter(rect => !sameRect(rect, ownRect));
      if (inBounds(outer, bounds) && !segmentBlocked(port.edge, outer, others) &&
          !others.some(rect => inside(outer, { left: rect.left - clearance, top: rect.top - clearance, right: rect.right + clearance, bottom: rect.bottom + clearance }))) {
        port.outer = outer;
        return;
      }
    }
  }

  // Prefer the middle of the physical gaps, with separate halves for incoming
  // and outgoing cables. Expanded obstacle edges remain an emergency channel,
  // never the first choice that made the former arrows cling to card borders.
  function boardChannels(obstacles, bounds, clearance, role, lane) {
    const bands = mergedBands(obstacles.map(rect => [rect.left, rect.right]));
    const channels = [];
    const gaps = [];
    let previous = bounds.left;
    bands.forEach(band => {
      if (band[0] > previous) gaps.push([previous, band[0]]);
      previous = Math.max(previous, band[1]);
    });
    if (previous < bounds.right) gaps.push([previous, bounds.right]);
    gaps.forEach(([left, right]) => {
      const low = left + clearance;
      const high = right - clearance;
      if (high < low) return;
      const middle = (left + right) / 2;
      const separation = Math.min(12, Math.max(0, (high - low) / 4));
      const fan = Math.min(lane * 7, Math.max(0, separation - 3));
      channels.push(middle + (role === 'prerequisite' ? -1 : 1) * (separation + fan));
    });
    return channels;
  }

  function circuitPath(source, target, obstacles, bounds, start, end, channels, reserved, clearance) {
    const expanded = obstacles.map(rect => ({ left: rect.left - clearance, top: rect.top - clearance, right: rect.right + clearance, bottom: rect.bottom + clearance }));
    if (![start.edge, start.outer, end.edge, end.outer].every(point => inBounds(point, bounds))) return [];
    if (segmentBlocked(start.edge, start.outer, obstacles.filter(rect => !sameRect(rect, source))) ||
        segmentBlocked(end.edge, end.outer, obstacles.filter(rect => !sameRect(rect, target)))) return [];
    if ([start.outer, end.outer].some(point => expanded.some(rect => inside(point, rect)))) return [];
    const xs = [...new Set([start.outer.x, end.outer.x, ...channels, bounds.left, bounds.right,
      ...expanded.flatMap(rect => [rect.left, rect.right])])].filter(x => x >= bounds.left && x <= bounds.right).sort((a, b) => a - b);
    const horizontalChannels = [];
    // A card gap can be free in one column even when another column has a card
    // at the same height. Per-column pairs retain these useful central turns.
    const bands = mergedBands(obstacles.map(rect => [rect.left, rect.right]));
    bands.forEach(([left, right]) => {
      const rows = mergedBands(obstacles.filter(rect => rect.left < right && rect.right > left).map(rect => [rect.top, rect.bottom]));
      let bottom = bounds.top;
      rows.forEach(row => {
        if (row[0] - bottom >= clearance * 2) horizontalChannels.push((bottom + row[0]) / 2);
        bottom = Math.max(bottom, row[1]);
      });
      if (bounds.bottom - bottom >= clearance * 2) horizontalChannels.push((bottom + bounds.bottom) / 2);
    });
    const ys = [...new Set([start.outer.y, end.outer.y, ...horizontalChannels, bounds.top, bounds.bottom,
      ...expanded.flatMap(rect => [rect.top, rect.bottom])])].filter(y => y >= bounds.top && y <= bounds.bottom).sort((a, b) => a - b);
    const pointAt = index => ({ x: xs[index % xs.length], y: ys[Math.floor(index / xs.length)] });
    const indexOf = point => ys.indexOf(point.y) * xs.length + xs.indexOf(point.x);
    const startIndex = indexOf(start.outer);
    const endIndex = indexOf(end.outer);
    const distances = new Map();
    const previous = new Map();
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
    const firstKey = startIndex * 3 + 1;
    distances.set(firstKey, 0);
    push({ key: firstKey, score: 0 });
    const pointCache = new Map();
    const edgeCache = new Map();
    while (queue.length) {
      const current = pop();
      if (current.score !== distances.get(current.key)) continue;
      const index = Math.floor(current.key / 3);
      const direction = current.key % 3;
      const point = pointAt(index);
      if (index === endIndex) {
        const middle = [point];
        let key = current.key;
        while (previous.has(key)) { key = previous.get(key); middle.unshift(pointAt(Math.floor(key / 3))); }
        const path = compactPath([start.edge, ...middle, end.edge]);
        // The final entry must be horizontal and have room for the arrowhead.
        // Retaining the fixed input stub also prevents a last-second side flip.
        if (path.length > 1 && path.at(-2).y === end.edge.y) return path;
      }
      const x = index % xs.length;
      const y = Math.floor(index / xs.length);
      const neighbors = [];
      if (x > 0) neighbors.push([index - 1, 1]);
      if (x + 1 < xs.length) neighbors.push([index + 1, 1]);
      if (y > 0) neighbors.push([index - xs.length, 2]);
      if (y + 1 < ys.length) neighbors.push([index + xs.length, 2]);
      neighbors.forEach(([next, nextDirection]) => {
        if (!pointCache.has(next)) pointCache.set(next, !expanded.some(rect => inside(pointAt(next), rect)));
        if (!pointCache.get(next)) return;
        const nextPoint = pointAt(next);
        if (index === startIndex && nextDirection === 1 && (nextPoint.x - point.x) * start.direction < 0) return;
        const edgeKey = Math.min(index, next) + ':' + Math.max(index, next);
        if (!edgeCache.has(edgeKey)) edgeCache.set(edgeKey, !segmentBlocked(point, nextPoint, expanded) && !sharesTrack(point, nextPoint, reserved));
        if (!edgeCache.get(edgeKey)) return;
        // Vertical trunks belong to physical cable channels. The penalty is
        // per segment, so a central rail wins over a marginally shorter edge.
        const central = nextDirection === 2 ? channels.some(channel => Math.abs(channel - point.x) < 0.01) :
          Math.abs(point.y - start.outer.y) < 0.01 || Math.abs(point.y - end.outer.y) < 0.01 ||
          horizontalChannels.some(channel => Math.abs(channel - point.y) < 0.01);
        const backtrack = nextPoint.y < Math.min(start.outer.y, end.outer.y) - 0.01 ||
          nextPoint.y > Math.max(start.outer.y, end.outer.y) + 0.01;
        const score = current.score + pathLength([point, nextPoint]) +
          (direction !== nextDirection ? 24 : 0) + (central ? 0 : 120) + (backtrack ? 140 : 0);
        const nextKey = next * 3 + nextDirection;
        if (score >= (distances.get(nextKey) ?? Infinity)) return;
        distances.set(nextKey, score);
        previous.set(nextKey, current.key);
        push({ key: nextKey, score });
      });
    }
    return [];
  }

  // Route the complete one-hop circuit together, rather than independently
  // selecting the shortest port for every edge. Stable sorting and fan slots
  // make the same graph draw identically after resize or a different API order.
  function routeConnections(edgeValues, positionValues, obstacleValues, boundsValue, options = {}) {
    const positions = positionValues instanceof Map ? positionValues : new Map(Object.entries(positionValues || {}).map(([id, rect]) => [+id, rect]));
    const bounds = normalizeRect(boundsValue);
    const obstacles = (obstacleValues || []).map(normalizeRect).filter(rect => [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite));
    if (![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite)) return [];
    const layout = ['overview', 'timeline'].includes(options.layout) ? options.layout : 'board';
    const clearance = Number.isFinite(+options.clearance) && +options.clearance > 0 ? +options.clearance : 6;
    const selected = +options.selectedId;
    const edges = (edgeValues || []).map(edge => ({ from: +edge.from, to: +edge.to, role: +edge.to === selected ? 'prerequisite' : 'dependent' }))
      .filter(edge => edge.from > 0 && edge.to > 0 && edge.from !== edge.to && positions.has(edge.from) && positions.has(edge.to))
      .sort((a, b) => (a.role === b.role ? 0 : a.role === 'prerequisite' ? -1 : 1) || a.from - b.from || a.to - b.to);
    const rectangles = new Map();
    edges.forEach(edge => [edge.from, edge.to].forEach(id => {
      const rect = normalizeRect(positions.get(id));
      if ([rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) && rect.right > rect.left && rect.bottom > rect.top) {
        rectangles.set(id, rect);
        if (!obstacles.some(other => sameRect(other, rect))) obstacles.push(rect);
      }
    }));
    const outgoing = new Map();
    const incoming = new Map();
    edges.forEach(edge => {
      if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
      if (!incoming.has(edge.to)) incoming.set(edge.to, []);
      outgoing.get(edge.from).push(edge);
      incoming.get(edge.to).push(edge);
    });
    const orderPorts = (map, otherId) => map.forEach(group => group.sort((a, b) => {
      const first = rectangles.get(otherId(a));
      const second = rectangles.get(otherId(b));
      return (first?.top || 0) - (second?.top || 0) || (first?.left || 0) - (second?.left || 0) || otherId(a) - otherId(b);
    }));
    orderPorts(outgoing, edge => edge.to);
    orderPorts(incoming, edge => edge.from);
    const routes = [];
    const lanes = { prerequisite: 0, dependent: 0 };
    edges.forEach(edge => {
      const source = rectangles.get(edge.from);
      const target = rectangles.get(edge.to);
      if (!source || !target) return;
      const startGroup = outgoing.get(edge.from);
      const endGroup = incoming.get(edge.to);
      const start = circuitPort(source, true, startGroup.indexOf(edge), startGroup.length, layout, clearance);
      const end = circuitPort(target, false, endGroup.indexOf(edge), endGroup.length, layout, clearance);
      extendPort(start, source, obstacles, bounds, clearance, 28);
      extendPort(end, target, obstacles, bounds, clearance, 16);
      const lane = lanes[edge.role]++;
      let channels;
      if (layout === 'board') channels = boardChannels(obstacles, bounds, clearance, edge.role, lane);
      else {
        const nearest = Math.min(...[...rectangles.values()].map(rect => rect.left));
        const gutterRight = Math.min(nearest, bounds.left + Math.max(36, +options.gutterWidth || 88));
        const gutterLeft = bounds.left + clearance;
        const middle = (gutterLeft + gutterRight) / 2;
        const half = Math.max(0, (gutterRight - gutterLeft) / 2 - clearance);
        const separation = Math.min(16, half);
        const fan = Math.min(lane * 8, Math.max(0, half - separation));
        channels = [middle + (edge.role === 'prerequisite' ? -1 : 1) * (separation + fan)];
      }
      const reserved = routes.filter(route => route.role !== edge.role).map(route => route.points);
      let points = [];
      if (layout !== 'board') {
        const channel = channels[0];
        const direct = compactPath([start.edge, { x: channel, y: start.edge.y }, { x: channel, y: end.edge.y }, end.edge]);
        if (direct.every(point => inBounds(point, bounds)) && direct.slice(1).every((point, index) =>
          !segmentBlocked(direct[index], point, obstacles) && !sharesTrack(direct[index], point, reserved))) points = direct;
      }
      if (!points.length) points = circuitPath(source, target, obstacles, bounds, start, end, channels, reserved, clearance);
      if (points.length) routes.push({ ...edge, points, sourceStep: edge.role === 'prerequisite' ? 1 : 2, sourceDirection: start.direction,
        sourceLead: Math.abs(start.outer.x - start.edge.x) });
    });
    return routes;
  }

  function routeConnection(sourceValue, targetValue, obstacleValues, boundsValue, clearance = 6) {
    return routeConnections([{ from: 1, to: 2 }], new Map([[1, sourceValue], [2, targetValue]]),
      obstacleValues, boundsValue, { clearance }).at(0)?.points || [];
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
    const routeClearance = Number.isFinite(+options.routeClearance) && +options.routeClearance > 0 ? +options.routeClearance : 4;
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
    const roleClasses = { prerequisite: 'dependencyHoverPrerequisite', dependent: 'dependencyHoverDependent' };
    const definitions = '<defs>' + Object.keys(roleClasses).map(role => '<marker id="' + markerId + role + '" class="' + roleClasses[role] + '" viewBox="0 0 16 18" refX="15" refY="9" markerWidth="16" markerHeight="18" orient="auto" markerUnits="userSpaceOnUse" overflow="visible"><path d="M5 1 L15 9 L5 17 Z"></path></marker>').join('') + '</defs>';
    let hovered = 0;
    let focused = 0;
    let pinned = +options.selectedId || 0;
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
      const selected = pinned || hovered || focused;
      const edges = directEdges(options.edges, selected);
      const related = new Set(edges.flatMap(edge => [edge.from, edge.to]));
      const prerequisites = new Set(edges.filter(edge => edge.to === selected).map(edge => edge.from));
      const dependents = new Set(edges.filter(edge => edge.from === selected).map(edge => edge.to));
      const group = options.relatedById instanceof Map ? options.relatedById.get(selected) : options.relatedById?.[selected];
      if (group && !edges.length) [...group].forEach(id => { related.add(+id); });
      nodes.forEach(node => {
        const id = idOf(node);
        node.classList.toggle('dependencyHoverActive', selected > 0 && id === selected);
        node.classList.toggle('dependencyHoverRelated', id !== selected && related.has(id));
        node.classList.toggle(roleClasses.prerequisite, prerequisites.has(id));
        node.classList.toggle(roleClasses.dependent, dependents.has(id));
        node.classList.toggle('dependencyHoverDimmed', selected > 0 && id !== selected && !related.has(id));
        const step = id === selected ? 2 : prerequisites.has(id) ? 1 : dependents.has(id) ? 3 : 0;
        if (selected > 0 && step) node.setAttribute('data-dependency-step', String(step));
        else node.removeAttribute?.('data-dependency-step');
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
      let sequences = '';
      const numberedSources = new Set();
      const routes = routeConnections(edges, positions, obstacles, { left: 1, top: 1, right: width - 1, bottom: height - 1 },
        { layout: options.layout, clearance: routeClearance, gutterWidth: options.gutterWidth, selectedId: selected });
      routes.forEach(edge => {
        const route = edge.points;
        const path = pathData(route);
        const role = edge.role;
        const roleClass = roleClasses[role];
        outlines += '<path class="dependencyHoverOutline" d="' + path + '"></path>';
        lines += '<path class="dependencyHoverLine ' + roleClass + '" data-dependency-from="' + edge.from + '" data-dependency-to="' + edge.to + '" d="' + path + '"></path>';
        dots += '<circle class="dependencyHoverDot ' + roleClass + '" cx="' + route[0].x + '" cy="' + route[0].y + '" r="3"></circle>';
        // The head stays wide enough to show direction even when the last bend
        // is only a few pixels away in a table gutter or between short bars.
        heads += '<path class="dependencyHoverArrowHead ' + roleClass + '" d="' + pathData(route.slice(-2)) + '" marker-end="url(#' + markerId + role + ')"></path>';
        const key = edge.from + ':' + role;
        if (!numberedSources.has(key) && edge.sourceLead >= 25) {
          numberedSources.add(key);
          // List/chart outputs share the left channel with upper input heads.
          // Keep the number wholly outside their ten-pixel arrowhead envelope.
          const badgeDistance = options.layout === 'timeline' || options.layout === 'overview' ? 25 : 15;
          const x = route[0].x + edge.sourceDirection * badgeDistance;
          const y = route[0].y;
          sequences += '<g class="dependencyHoverSequence ' + roleClass + '" data-dependency-source="' + edge.from + '" data-dependency-step="' + edge.sourceStep + '"><circle cx="' + x + '" cy="' + y + '" r="10"></circle><text x="' + x + '" y="' + y + '">' + edge.sourceStep + '</text></g>';
        }
      });
      // Incoming arrowheads remain visible where an outgoing line shares a port.
      overlay.innerHTML = lines ? definitions + outlines + lines + dots + heads + sequences : '';
    };
    const refresh = () => {
      if (!destroyed && !frame) frame = window.requestAnimationFrame(draw);
    };
    const cleanup = () => {
      hovered = focused = 0;
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      nodes.forEach(node => {
        node.classList.remove('dependencyHoverActive', 'dependencyHoverRelated', 'dependencyHoverDimmed', roleClasses.prerequisite, roleClasses.dependent);
        node.removeAttribute?.('data-dependency-step');
      });
      resetOverlay();
    };
    const clear = () => { cleanup(); if (pinned && !destroyed) draw(); };
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
      setSelected(id) { pinned = +id || 0; hovered = focused = 0; draw(); },
      destroy() {
        if (destroyed) return;
        cleanup();
        destroyed = true;
        observer?.disconnect();
        listeners.forEach(remove => remove());
        overlay.remove();
        layerRoot.classList.remove('dependencyHoverSurface');
        controllers.delete(root);
      },
    };
    controllers.set(root, controller);
    if (pinned) draw();
    return controller;
  }

  const api = { directEdges, routeConnection, routeConnections, segmentBlocked, sharesTrack, pathData, wire };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.KanbanodonDependencyHover = api;
})(typeof window === 'undefined' ? null : window);
