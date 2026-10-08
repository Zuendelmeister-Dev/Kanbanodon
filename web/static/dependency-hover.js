(function (global) {
  'use strict';

  const controllers = new WeakMap();
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let nextOverlayId = 0;

  // Retained for consumers which need a single ticket's immediate links.
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

  // Traverse the undirected component so branches, prerequisites and later
  // dependents remain visible together. A visited set also protects imported
  // invalid graphs from hanging the renderer.
  function connectedEdges(edges, id) {
    const selected = +id;
    if (!(selected > 0)) return [];
    const seen = new Set();
    const valid = (edges || []).map(edge => ({ from: +edge.from, to: +edge.to })).filter(edge => {
      const key = edge.from + '>' + edge.to;
      if (!(edge.from > 0 && edge.to > 0) || edge.from === edge.to || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const neighbors = new Map();
    valid.forEach(({ from, to }) => {
      if (!neighbors.has(from)) neighbors.set(from, []);
      if (!neighbors.has(to)) neighbors.set(to, []);
      neighbors.get(from).push(to);
      neighbors.get(to).push(from);
    });
    const related = new Set([selected]);
    const queue = [selected];
    for (let index = 0; index < queue.length; index++) {
      (neighbors.get(queue[index]) || []).forEach(next => {
        if (related.has(next)) return;
        related.add(next);
        queue.push(next);
      });
    }
    return valid.filter(edge => related.has(edge.from) && related.has(edge.to));
  }

  // Number the displayed circuit from its roots, not from the selected card.
  // This also handles a prerequisite which is itself a root of a short branch.
  function dependencySteps(edges, selectedId) {
    const levels = new Map();
    const incoming = new Map();
    const outgoing = new Map();
    if (+selectedId > 0) levels.set(+selectedId, 1);
    (edges || []).forEach(edge => {
      const from = +edge.from;
      const to = +edge.to;
      if (!(from > 0 && to > 0) || from === to) return;
      if (!incoming.has(from)) incoming.set(from, 0);
      incoming.set(to, (incoming.get(to) || 0) + 1);
      if (!outgoing.has(from)) outgoing.set(from, []);
      outgoing.get(from).push(to);
      levels.set(from, 1);
      levels.set(to, 1);
    });
    const queue = [...incoming.keys()].filter(id => incoming.get(id) === 0).sort((a, b) => a - b);
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      (outgoing.get(id) || []).forEach(next => {
        levels.set(next, Math.max(levels.get(next), levels.get(id) + 1));
        incoming.set(next, incoming.get(next) - 1);
        if (incoming.get(next) === 0) queue.push(next);
      });
    }
    return levels;
  }

  const STAGE_BLUE = '#60a5fa';
  const STAGE_GOLD = '#f4b83f';
  const STAGE_TEAL = '#37c7ad';
  const stageCount = maxStep => Number.isFinite(+maxStep) ? Math.max(1, Math.floor(+maxStep || 1)) : 1;
  const stageNumber = (step, maxStep) => Math.max(1, Math.min(stageCount(maxStep), Math.floor(+step || 1)));

  function blendColors(first, last, fraction) {
    const components = [1, 3, 5].map(offset => {
      const start = parseInt(first.slice(offset, offset + 2), 16);
      const end = parseInt(last.slice(offset, offset + 2), 16);
      return Math.round(start + (end - start) * fraction).toString(16).padStart(2, '0');
    });
    return '#' + components.join('');
  }

  // A circuit progresses through the palette once. Its actual middle stage
  // is gold, even when the graph has an even number of stages. Two-stage
  // circuits use the start and finish colors without inventing a middle task.
  function stageColor(step, maxStep) {
    const count = stageCount(maxStep);
    const current = stageNumber(step, count);
    if (current === 1) return STAGE_BLUE;
    if (current === count) return STAGE_TEAL;
    const middle = Math.ceil(count / 2);
    if (current <= middle) return blendColors(STAGE_BLUE, STAGE_GOLD, (current - 1) / (middle - 1));
    return blendColors(STAGE_GOLD, STAGE_TEAL, (current - middle) / (count - middle));
  }

  function stagePalette(maxStep) {
    return Array.from({ length: stageCount(maxStep) }, (_, index) => ({ step: index + 1, color: stageColor(index + 1, maxStep) }));
  }

  function roleForStep(step, maxStep) {
    const count = stageCount(maxStep);
    const current = stageNumber(step, count);
    if (current === 1) return 'prerequisite';
    if (count > 2 && current === Math.ceil(count / 2)) return 'active';
    return current < Math.ceil(count / 2) ? 'prerequisite' : 'dependent';
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
      if (before && (before.x === last.x && last.x === point.x || before.y === last.y && last.y === point.y)) result.pop();
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

  // Wires may cross, but an unrelated source cannot hide underneath a trunk.
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

  // Choose the terminals facing the neighboring task. A vertical pair uses
  // card centers; only converging inputs need separate arrowhead slots.
  function circuitPort(rect, side, slot, count, clearance, list = false, output = false) {
    const horizontal = side === 'left' || side === 'right';
    const span = horizontal ? rect.bottom - rect.top : rect.right - rect.left;
    const spacing = Math.min(18, Math.max(0, (span - 20) / Math.max(1, count - 1)));
    const fan = output ? 0 : (slot - (count - 1) / 2) * spacing;
    const rowOffset = list ? Math.min(8, span / 4) * (output ? 1 : -1) : 0;
    const dx = side === 'left' ? -1 : side === 'right' ? 1 : 0;
    const dy = side === 'top' ? -1 : side === 'bottom' ? 1 : 0;
    const edge = horizontal ? { x: dx < 0 ? rect.left : rect.right, y: (rect.top + rect.bottom) / 2 + fan + rowOffset } :
      { x: (rect.left + rect.right) / 2 + fan, y: dy < 0 ? rect.top : rect.bottom };
    return { edge, outer: { x: edge.x + dx * clearance, y: edge.y + dy * clearance }, dx, dy, axis: horizontal ? 1 : 2, direction: dx || dy };
  }

  function extendPorts(start, source, end, target, obstacles, bounds, clearance) {
    const fits = (port, ownRect, lead) => {
      const outer = { x: port.edge.x + port.dx * lead, y: port.edge.y + port.dy * lead };
      const others = obstacles.filter(rect => !sameRect(rect, ownRect));
      return inBounds(outer, bounds) && !segmentBlocked(port.edge, outer, others) &&
        !others.some(rect => inside(outer, { left: rect.left - clearance, top: rect.top - clearance, right: rect.right + clearance, bottom: rect.bottom + clearance }));
    };
    const lead = [...new Set([32, 24, 16, clearance])].filter(value => value >= clearance)
      .find(value => fits(start, source, value) && fits(end, target, value)) || clearance;
    [start, end].forEach(port => { port.outer = { x: port.edge.x + port.dx * lead, y: port.edge.y + port.dy * lead }; });
  }
  // Prefer the middle of physical gaps. Neighboring lanes are available when
  // a span is occupied; expanded obstacle edges are emergency channels.
  function boardChannels(obstacles, bounds, clearance, offset) {
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
      channels.push(Math.max(low, Math.min(high, middle + offset)));
    });
    return channels;
  }

  // Try short orthogonal shapes through nearby physical gaps first. These
  // reusable rails are independent of color; another rail is only needed when
  // an already drawn connection occupies the same span.
  function boardCircuitPath(source, target, obstacles, bounds, start, end, channels, reserved, clearance) {
    const expanded = obstacles.map(rect => ({ left: rect.left - clearance, top: rect.top - clearance, right: rect.right + clearance, bottom: rect.bottom + clearance }));
    const candidates = [];
    const offer = middle => {
      const points = compactPath([start.edge, start.outer, ...middle, end.outer, end.edge]);
      if (points.length < 2 || !points.every(point => inBounds(point, bounds))) return;
      const first = points[1];
      const last = points.at(-2);
      if ((first.x - start.edge.x) * start.dx + (first.y - start.edge.y) * start.dy <= 0 ||
          (last.x - end.edge.x) * end.dx + (last.y - end.edge.y) * end.dy <= 0) return;
      if (!points.slice(1).every((point, index) => !segmentBlocked(points[index], point, obstacles) &&
          !sharesTrack(points[index], point, reserved))) return;
      // Middle segments keep space around cards, while the short terminal
      // stubs deliberately approach their own card boundary.
      const middlePoints = [start.outer, ...middle, end.outer];
      if (!middlePoints.slice(1).every((point, index) => !segmentBlocked(middlePoints[index], point, expanded))) return;
      candidates.push(points);
    };
    offer([]);
    offer([{ x: end.outer.x, y: start.outer.y }]);
    offer([{ x: start.outer.x, y: end.outer.y }]);
    const midX = (start.outer.x + end.outer.x) / 2;
    const verticalRails = [...new Set([midX, ...channels, start.outer.x, end.outer.x])];
    verticalRails.forEach(x => offer([{ x, y: start.outer.y }, { x, y: end.outer.y }]));
    const midY = (start.outer.y + end.outer.y) / 2;
    const horizontalRails = [midY];
    const bands = mergedBands(obstacles.filter(rect => rect.left < Math.max(start.outer.x, end.outer.x) + clearance &&
      rect.right > Math.min(start.outer.x, end.outer.x) - clearance).map(rect => [rect.top, rect.bottom]));
    let bottom = bounds.top;
    bands.forEach(([top, nextBottom]) => {
      if (top - bottom >= clearance * 2) horizontalRails.push((bottom + top) / 2);
      bottom = Math.max(bottom, nextBottom);
    });
    if (bounds.bottom - bottom >= clearance * 2) horizontalRails.push((bottom + bounds.bottom) / 2);
    horizontalRails.forEach(y => offer([{ x: start.outer.x, y }, { x: end.outer.x, y }]));
    const routeScore = points => pathLength(points) + (points.length - 2) * 12 +
      (start.axis === 1 && end.axis === 1 ? points.slice(1).reduce((value, point, index) =>
        value + (point.x === points[index].x ? Math.abs(point.x - midX) * 0.1 : 0), 0) : 0);
    candidates.sort((a, b) => routeScore(a) - routeScore(b) ||
      pathData(a).localeCompare(pathData(b)));
    return candidates[0] || [];
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
    const firstKey = startIndex * 3 + start.axis;
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
        const last = path.at(-2);
        if (last && (last.x - end.edge.x) * end.dx + (last.y - end.edge.y) * end.dy > 0 &&
            path.slice(1).every((point, i) => !sharesTrack(path[i], point, reserved))) return path;
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
        if (index === startIndex && (nextPoint.x - point.x) * start.dx + (nextPoint.y - point.y) * start.dy < 0) return;
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
          (direction !== nextDirection ? 12 : 0) + (central ? 0 : 2) + (backtrack ? 8 : 0);
        const nextKey = next * 3 + nextDirection;
        if (score >= (distances.get(nextKey) ?? Infinity)) return;
        distances.set(nextKey, score);
        previous.set(nextKey, current.key);
        push({ key: nextKey, score });
      });
    }
    return [];
  }

  // Ports follow the physical relationship between cards, not a fixed global
  // output side. Timeline finish-to-start connections keep their time meaning.
  function portPairs(source, target, layout) {
    if (layout === 'overview') return [['left', 'left']];
    if (layout === 'timeline') {
      const vertical = source.top <= target.top ? ['bottom', 'top'] : ['top', 'bottom'];
      return target.left - source.right >= 24 ? [['right', 'left'], vertical] : [vertical, ['right', 'left']];
    }
    if (source.right <= target.left) return [['right', 'left'], ['bottom', 'top'], ['top', 'bottom']];
    if (target.right <= source.left) return [['left', 'right'], ['bottom', 'top'], ['top', 'bottom']];
    if (source.bottom <= target.top) return [['bottom', 'top'], ['left', 'left'], ['right', 'right']];
    if (target.bottom <= source.top) return [['top', 'bottom'], ['left', 'left'], ['right', 'right']];
    return (source.left + source.right) <= (target.left + target.right) ?
      [['right', 'left'], ['bottom', 'top'], ['top', 'bottom']] : [['left', 'right'], ['bottom', 'top'], ['top', 'bottom']];
  }

  // Route a complete circuit together. Its absolute topological stages share
  // one blue-to-gold-to-teal progression across every branch.
  function routeConnections(edgeValues, positionValues, obstacleValues, boundsValue, options = {}) {
    const positions = positionValues instanceof Map ? positionValues : new Map(Object.entries(positionValues || {}).map(([id, rect]) => [+id, rect]));
    const bounds = normalizeRect(boundsValue);
    const obstacles = (obstacleValues || []).map(normalizeRect).filter(rect => [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite));
    if (![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite)) return [];
    const layout = ['overview', 'timeline'].includes(options.layout) ? options.layout : 'board';
    const clearance = Number.isFinite(+options.clearance) && +options.clearance > 0 ? +options.clearance : 6;
    const selected = +options.selectedId;
    const seen = new Set();
    const edgeCandidates = (edgeValues || []).map(edge => ({ from: +edge.from, to: +edge.to }))
      .filter(edge => {
        const key = edge.from + '>' + edge.to;
        if (!(edge.from > 0 && edge.to > 0) || edge.from === edge.to || !positions.has(edge.from) || !positions.has(edge.to) || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) => a.from - b.from || a.to - b.to);
    const steps = dependencySteps(edgeCandidates, selected);
    const maxStep = Math.max(1, ...steps.values());
    const edges = edgeCandidates.map(edge => ({ ...edge, sourceStep: steps.get(edge.from) || 1,
      role: roleForStep(steps.get(edge.from) || 1, maxStep), color: stageColor(steps.get(edge.from) || 1, maxStep) }))
      .sort((a, b) => a.sourceStep - b.sourceStep || a.from - b.from || a.to - b.to);
    const rectangles = new Map();
    edges.forEach(edge => [edge.from, edge.to].forEach(id => {
      const value = normalizeRect(positions.get(id));
      if ([value.left, value.top, value.right, value.bottom].every(Number.isFinite) && value.right > value.left && value.bottom > value.top) {
        rectangles.set(id, value);
        if (!obstacles.some(other => sameRect(other, value))) obstacles.push(value);
      }
    }));
    const incoming = new Map();
    edges.forEach(edge => {
      if (!incoming.has(edge.to)) incoming.set(edge.to, []);
      incoming.get(edge.to).push(edge);
    });
    incoming.forEach(group => group.sort((a, b) => {
      const first = rectangles.get(a.from);
      const second = rectangles.get(b.from);
      return (first?.top || 0) - (second?.top || 0) || (first?.left || 0) - (second?.left || 0) || a.from - b.from;
    }));
    const routes = [];
    edges.forEach(edge => {
      const source = rectangles.get(edge.from);
      const target = rectangles.get(edge.to);
      if (!source || !target) return;
      const endGroup = incoming.get(edge.to);
      // Only branches from the same source may share a trunk. Other wires get
      // a neighboring free lane when their actual vertical spans overlap.
      const reserved = routes.filter(route => route.from !== edge.from).map(route => route.points);
      const pairs = portPairs(source, target, layout);
      let chosen;
      pairs.forEach(([outputSide, preferredInputSide], pairIndex) => {
        const inputSide = layout === 'timeline' && endGroup.length > 1 && target.right - target.left < 20 &&
          (preferredInputSide === 'top' || preferredInputSide === 'bottom') ? 'left' : preferredInputSide;
        const start = circuitPort(source, outputSide, 0, 1, clearance, layout === 'overview', true);
        const slot = endGroup.indexOf(edge);
        const end = circuitPort(target, inputSide, slot, endGroup.length, clearance, layout === 'overview', false);
        if (layout === 'timeline') {
          // Vertical connectors still originate at the prerequisite's finish
          // and arrive near the dependent's start, preserving time semantics
          // without a wide U when those dates coincide or overlap.
          if (start.axis === 2) start.edge.x = source.right;
          if (end.axis === 2) {
            const fan = end.edge.x - (target.left + target.right) / 2;
            const inset = endGroup.length > 1 ? Math.min(18, (target.right - target.left) / 2) : 0;
            end.edge.x = Math.max(target.left, Math.min(target.right, target.left + inset + fan));
          }
        }
        extendPorts(start, source, end, target, obstacles, bounds, clearance);
        let channelBase;
        if (layout === 'overview') {
          const nearest = Math.min(source.left, target.left);
          const gutterLeft = bounds.left + clearance;
          const gutterRight = Math.min(nearest, bounds.left + Math.max(36, +options.gutterWidth || 88));
          channelBase = [(gutterLeft + gutterRight) / 2];
        } else channelBase = boardChannels(obstacles, bounds, clearance, 0);
        const channels = [...new Set(channelBase.flatMap(value => [value, value - 16, value + 16, value - 32, value + 32]))]
          .filter(value => value >= bounds.left + clearance && value <= bounds.right - clearance);
        let points;
        if (layout === 'overview') {
          for (const channel of channels) {
            const candidate = compactPath([start.edge, { x: channel, y: start.edge.y }, { x: channel, y: end.edge.y }, end.edge]);
            if (candidate.every(point => inBounds(point, bounds)) && candidate.slice(1).every((point, index) =>
              !segmentBlocked(candidate[index], point, obstacles) && !sharesTrack(candidate[index], point, reserved))) {
              points = candidate;
              break;
            }
          }
        } else points = boardCircuitPath(source, target, obstacles, bounds, start, end, channels, reserved, clearance);
        if (!points?.length) points = circuitPath(source, target, obstacles, bounds, start, end, channels, reserved, clearance);
        if (!points.length || !points.slice(1).every((point, index) => !sharesTrack(points[index], point, reserved))) return;
        const score = pathLength(points) + (points.length - 2) * 12 + pairIndex * (layout === 'timeline' ? 80 : 24);
        if (!chosen || score < chosen.score) chosen = { score, points, start, end };
      });
      if (chosen) routes.push({ ...edge, points: chosen.points, sourceDirection: chosen.start.direction, sourceAxis: chosen.start.axis,
        sourceLead: pathLength(chosen.points.slice(0, 2)), targetLead: pathLength(chosen.points.slice(-2)) });
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

  function escapedText(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
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
    overlay.setAttribute('role', 'group');
    overlay.setAttribute('aria-label', 'Task dependencies');
    overlay.setAttribute('focusable', 'false');
    overlay.setAttribute('width', '1');
    overlay.setAttribute('height', '1');
    layerRoot.classList.add('dependencyHoverSurface');
    layerRoot.append(overlay);
    const markerId = 'dependencyHoverArrow' + ++nextOverlayId;
    const roleClasses = { prerequisite: 'dependencyHoverPrerequisite', active: 'dependencyHoverActive', dependent: 'dependencyHoverDependent' };
    let pinned = +options.selectedId || 0;
    let visibleSteps = new Map();
    let visibleRelated = new Set();
    let maxStep = 1;
    const originalColors = new Map();
    let frame = 0;
    let destroyed = false;
    const listeners = [];
    const resetOverlay = () => {
      overlay.innerHTML = '';
      overlay.setAttribute('aria-hidden', 'true');
      // Absolute SVG dimensions participate in scroll overflow. Discard the
      // previous drawing's extent before measuring the current content size.
      overlay.setAttribute('width', '1');
      overlay.setAttribute('height', '1');
      overlay.setAttribute('viewBox', '0 0 1 1');
    };
    const listen = (target, name, handler) => {
      target.addEventListener(name, handler);
      listeners.push(() => target.removeEventListener(name, handler));
    };
    const pointerConnection = target => {
      if (!target || !overlay.contains(target)) return null;
      const wire = target.closest?.('[data-dependency-wire]');
      if (wire && overlay.contains(wire)) return {
        key: wire.getAttribute('data-dependency-wire'),
        source: wire.getAttribute('data-dependency-from'),
      };
      const mark = target.closest?.('[data-dependency-source]');
      return mark && overlay.contains(mark) ? { source: mark.getAttribute('data-dependency-source') } : null;
    };
    const isolateConnection = connection => {
      // Only presentation classes change. Pointer movement never reroutes the
      // circuit, reads card geometry or changes the pinned task's highlighting.
      overlay.querySelectorAll('[data-dependency-wire]').forEach(wire => {
        const related = connection && (connection.key ? wire.getAttribute('data-dependency-wire') === connection.key :
          wire.getAttribute('data-dependency-from') === connection.source);
        wire.classList.toggle('dependencyHoverWireDimmed', !!connection && !related);
      });
      overlay.querySelectorAll('[data-dependency-source]').forEach(mark => {
        mark.classList.toggle('dependencyHoverWireDimmed', !!connection && mark.getAttribute('data-dependency-source') !== connection.source);
      });
    };
    const onPointerConnection = event => {
      if (event.pointerType === 'touch') return;
      isolateConnection(pointerConnection(event.target));
    };
    const onPointerOut = event => {
      if (event.pointerType === 'touch') return;
      isolateConnection(pointerConnection(event.relatedTarget));
    };
    listen(overlay, 'pointerover', onPointerConnection);
    listen(overlay, 'pointerout', onPointerOut);
    listen(overlay, 'pointerleave', () => isolateConnection(null));
    listen(overlay, 'pointercancel', () => isolateConnection(null));
    listen(window, 'blur', () => isolateConnection(null));
    const setStep = (node, step) => {
      [node, node.querySelector('td:first-child')].filter(Boolean).forEach(target => {
        if (step) target.setAttribute('data-dependency-step', String(step));
        else target.removeAttribute?.('data-dependency-step');
      });
    };
    const restoreColor = target => {
      const previous = originalColors.get(target);
      if (!previous || !target.style) return;
      if (previous.value) target.style.setProperty('--dependency-color', previous.value, previous.priority);
      else target.style.removeProperty('--dependency-color');
    };
    const setColor = (node, color) => {
      [node, node.querySelector('td:first-child')].filter(Boolean).forEach(target => {
        if (!target.style) return;
        if (!color) { restoreColor(target); return; }
        if (!originalColors.has(target)) originalColors.set(target, {
          value: target.style.getPropertyValue('--dependency-color'),
          priority: target.style.getPropertyPriority('--dependency-color'),
        });
        target.style.setProperty('--dependency-color', color);
      });
    };
    const updateHighlight = () => {
      nodes.forEach(node => {
        const id = idOf(node);
        const step = visibleSteps.get(id) || 0;
        node.classList.toggle('dependencyHoverSelected', pinned > 0 && id === pinned);
        node.classList.toggle('dependencyHoverRelated', pinned > 0 && visibleRelated.has(id));
        Object.entries(roleClasses).forEach(([role, className]) => node.classList.toggle(className, pinned > 0 && step > 0 && roleForStep(step, maxStep) === role));
        node.classList.toggle('dependencyHoverDimmed', pinned > 0 && !visibleRelated.has(id));
        setStep(node, pinned > 0 ? step : 0);
        setColor(node, pinned > 0 && step > 0 ? stageColor(step, maxStep) : null);
      });
    };    const draw = () => {
      frame = 0;
      if (destroyed) return;
      const selected = pinned;
      const available = new Set(nodes.map(idOf));
      const edges = connectedEdges((options.edges || []).filter(edge => available.has(+edge.from) && available.has(+edge.to)), selected);
      visibleRelated = new Set(selected > 0 ? [selected, ...edges.flatMap(edge => [edge.from, edge.to])] : []);
      visibleSteps = dependencySteps(edges, selected);
      maxStep = Math.max(1, ...visibleSteps.values());
      resetOverlay();
      updateHighlight();
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
      let drawing = '';
      let sourceMarks = '';
      const numberedSources = new Set();
      const labelFor = id => options.labelsById instanceof Map ? options.labelsById.get(id) : options.labelsById?.[id];
      const routes = routeConnections(edges, positions, obstacles, { left: 1, top: 1, right: width - 1, bottom: height - 1 },
        { layout: options.layout, clearance: routeClearance, gutterWidth: options.gutterWidth, selectedId: selected });
      // Marker fills are applied through the DOM below. Serialized style
      // attributes are blocked by the application's Content Security Policy.
      const definitions = '<defs>' + stagePalette(maxStep).map(({ step, color }) => '<marker id="' + markerId + 'Stage' + step + '" data-dependency-color="' + color + '" viewBox="0 0 16 18" refX="15" refY="9" markerWidth="16" markerHeight="18" orient="auto" markerUnits="userSpaceOnUse" overflow="visible"><path data-dependency-color="' + color + '" data-dependency-paint="fill" d="M5 1 L15 9 L5 17 Z"></path></marker>').join('') + '</defs>';
      routes.forEach(edge => {
        const route = edge.points;
        const path = pathData(route);
        const sourceStep = visibleSteps.get(edge.from) || edge.sourceStep;
        const role = roleForStep(sourceStep, maxStep);
        const roleClass = roleClasses[role];
        const color = stageColor(sourceStep, maxStep);
        const colorData = ' data-dependency-color="' + color + '"';
        let sequence = '';
        const key = edge.from + ':' + role;
        if (!numberedSources.has(key) && edge.sourceLead >= 25) {
          numberedSources.add(key);
          const badgeDistance = options.layout === 'overview' ? 25 : 15;
          const x = route[0].x + (edge.sourceAxis === 1 ? edge.sourceDirection * badgeDistance : 0);
          const y = route[0].y + (edge.sourceAxis === 2 ? edge.sourceDirection * badgeDistance : 0);
          sequence = '<g class="dependencyHoverSequence ' + roleClass + '"' + colorData + ' data-dependency-source="' + edge.from + '" data-dependency-step="' + sourceStep + '"><circle' + colorData + ' data-dependency-paint="stroke" cx="' + x + '" cy="' + y + '" r="10"></circle><text' + colorData + ' data-dependency-paint="fill" x="' + x + '" y="' + y + '">' + sourceStep + '</text></g>';
        }
        const description = escapedText((labelFor(edge.from) || '#' + edge.from) + ' → ' + (labelFor(edge.to) || '#' + edge.to));
        drawing += '<g class="dependencyHoverWire" data-dependency-wire="' + edge.from + '>' + edge.to + '" data-dependency-from="' + edge.from + '" data-dependency-to="' + edge.to + '" role="img" aria-label="Dependency: ' + description + '">' +
          '<title>' + description + '</title>' +
          '<path class="dependencyHoverHit" d="' + path + '"></path>' +
          '<path class="dependencyHoverOutline" d="' + path + '"></path>' +
          '<path class="dependencyHoverLine ' + roleClass + '"' + colorData + ' data-dependency-paint="stroke" data-dependency-from="' + edge.from + '" data-dependency-to="' + edge.to + '" d="' + path + '"></path>' +
          '<path class="dependencyHoverArrowHead ' + roleClass + '"' + colorData + ' d="' + pathData(route.slice(-2)) + '" marker-end="url(#' + markerId + 'Stage' + sourceStep + ')"></path></g>';
        sourceMarks += '<circle class="dependencyHoverDot ' + roleClass + '"' + colorData + ' data-dependency-paint="stroke" data-dependency-source="' + edge.from + '" cx="' + route[0].x + '" cy="' + route[0].y + '" r="3"></circle>' + sequence;
      });
      // Keep every source number above every wire, including wires rendered
      // later in a branching circuit that cross an earlier source label.
      overlay.innerHTML = drawing ? definitions + drawing + '<g class="dependencyHoverSourceMarks" aria-hidden="true">' + sourceMarks + '</g>' : '';
      overlay.querySelectorAll('[data-dependency-color]').forEach(element => {
        const color = element.getAttribute('data-dependency-color');
        element.style.setProperty('--dependency-color', color);
        // A concrete marker path fill also avoids marker-instance inheritance
        // differences between browsers. CSSOM property changes obey the CSP.
        const paint = element.getAttribute('data-dependency-paint');
        if (paint === 'fill' || paint === 'stroke') element.style.setProperty(paint, color);
      });
      overlay.setAttribute('aria-hidden', drawing ? 'false' : 'true');
      updateHighlight();
    };
    const refresh = () => {
      if (!destroyed && !frame) frame = window.requestAnimationFrame(draw);
    };
    const cleanup = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      nodes.forEach(node => {
        node.classList.remove('dependencyHoverSelected', 'dependencyHoverRelated', 'dependencyHoverDimmed', ...Object.values(roleClasses));
        setStep(node, 0);
        setColor(node, null);
      });
      originalColors.forEach((previous, target) => restoreColor(target));
      resetOverlay();
    };
    const clear = () => { isolateConnection(null); updateHighlight(); };
    // The overlay belongs to the scrollable content. Scrolling translates it
    // together with the cards, so recomputing viewport rectangles on scroll
    // would only introduce sticky-position changes and visible route jumps.
    listen(window, 'resize', refresh);
    const observedSizes = new Map();
    const sizeOf = element => element.clientWidth + ':' + element.clientHeight;
    const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(entries => {
      let changed = false;
      (entries || []).forEach(entry => {
        const size = sizeOf(entry.target);
        if (observedSizes.get(entry.target) !== size) changed = true;
        observedSizes.set(entry.target, size);
      });
      if (changed) refresh();
    }) : null;
    [layerRoot, ...anchors.map(item => item.anchor)].forEach(element => {
      observedSizes.set(element, sizeOf(element));
      observer?.observe(element);
    });    const controller = {
      clear,
      refresh,
      setSelected(id) { pinned = +id || 0; draw(); },
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

  const api = { directEdges, connectedEdges, dependencySteps, stageColor, stagePalette, routeConnection, routeConnections, segmentBlocked, sharesTrack, pathData, wire };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.KanbanodonDependencyHover = api;
})(typeof window === 'undefined' ? null : window);
