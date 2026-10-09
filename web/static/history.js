(function (root, factory) {
  const history = factory();
  if (typeof module === 'object' && module.exports) module.exports = history;
  else root.KanbanodonHistory = history;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  const DAY = 86400000;
  const WIDTH = 1000;
  const ROW_HEIGHT = 142;
  const TYPES = ['epic', 'story', 'task', 'bug', 'idea'];
  const SOURCES = ['recorded', 'legacy', 'import', 'demo'];

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function instant(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || /^0001-01-01T00:00:00/.test(value) || !calendarDate(value.slice(0, 10))) return null;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }

  // Due dates are local calendar days, whereas completion/start timestamps are instants.
  function calendarDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const year = +match[1], month = +match[2] - 1, day = +match[3];
    const date = new Date(0);
    date.setFullYear(year, month, day);
    date.setHours(0, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
    return date;
  }

  function isoDay(time) {
    const date = new Date(time);
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function nextDay(date, count = 1) {
    const next = new Date(date);
    next.setDate(next.getDate() + count);
    return next;
  }

  function dayNumber(date) {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
  }

  function completionDelay(item) {
    const completed = instant(item?.completedAt);
    const due = calendarDate(item?.plannedDueDate);
    if (completed === null || !due) return { days: null, deadline: null, late: false };
    // A task may finish throughout its due day. Delay begins at the next local midnight.
    const deadline = nextDay(due).getTime();
    return { days: Math.max(0, dayNumber(new Date(completed)) - dayNumber(due)), deadline, late: completed >= deadline };
  }

  function positiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : 0;
  }

  function reference(value, fallback) {
    const ref = String(value || fallback || '').replace(/^#/, '');
    return ref ? '#' + ref : '';
  }

  function normalizeItems(items) {
    if (!Array.isArray(items)) return [];
    return items.flatMap((raw, index) => {
      if (!raw || typeof raw !== 'object') return [];
      const completed = instant(raw.completedAt);
      if (completed === null) return [];
      const start = instant(raw.startedAt);
      const ticketId = positiveId(raw.ticketId);
      const type = TYPES.includes(raw.type) ? raw.type : 'task';
      const delay = completionDelay(raw);
      return [{
        id: positiveId(raw.id) || index + 1,
        ticketId,
        ref: reference(raw.ref, ticketId),
        title: String(raw.title || 'Untitled work item'),
        type,
        epicId: type === 'epic' ? ticketId : positiveId(raw.epicId),
        epicRef: type === 'epic' ? reference(raw.ref, ticketId) : reference(raw.epicRef, raw.epicId),
        epicTitle: String(type === 'epic' ? raw.title || 'Untitled Epic' : raw.epicTitle || ''),
        completedAt: String(raw.completedAt),
        completed,
        // Never substitute a planned date for an unknown or inconsistent actual start.
        startedAt: start !== null && start <= completed ? String(raw.startedAt) : '',
        started: start !== null && start <= completed ? start : null,
        plannedDueDate: calendarDate(raw.plannedDueDate) ? String(raw.plannedDueDate) : '',
        delay,
        source: SOURCES.includes(raw.source) ? raw.source : 'legacy',
        archived: !!raw.archivedAt,
      }];
    }).sort((left, right) => right.completed - left.completed || right.id - left.id);
  }

  function filterItems(items, filters = {}) {
    const from = calendarDate(filters.from);
    const through = calendarDate(filters.through);
    const end = through ? nextDay(through).getTime() : null;
    const query = String(filters.query || '').trim().toLocaleLowerCase();
    return items.filter(item => {
      if (filters.type && item.type !== filters.type) return false;
      if (filters.epic && String(item.epicId) !== String(filters.epic)) return false;
      if (from && item.completed < from.getTime()) return false;
      if (end !== null && item.completed >= end) return false;
      if (query && ![item.ref, item.title, item.epicRef, item.epicTitle].join(' ').toLocaleLowerCase().includes(query)) return false;
      return true;
    });
  }

  function formatDate(time, short = false) {
    return new Intl.DateTimeFormat(undefined, short ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(time));
  }

  function formatDateTime(time) {
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(new Date(time));
  }

  function timelineLayout(items) {
    if (!items.length) return null;
    const bounds = items.flatMap(item => [item.completed, ...(item.started === null ? [] : [item.started]), ...(item.delay.late ? [item.delay.deadline] : [])]);
    let start = calendarDate(isoDay(Math.min(...bounds)));
    let end = calendarDate(isoDay(Math.max(...bounds)));
    start = nextDay(start, -1);
    end = nextDay(end, 2);
    if (dayNumber(end) - dayNumber(start) < 7) {
      start = nextDay(start, -2);
      end = nextDay(start, 7);
    }
    const startTime = start.getTime(), endTime = end.getTime();
    const x = time => 32 + (Math.max(startTime, Math.min(endTime, time)) - startTime) / (endTime - startTime) * (WIDTH - 64);
    const days = dayNumber(end) - dayNumber(start);
    const step = [1, 2, 7, 14, 30, 60, 90, 180, 365].find(value => days / value <= 10) || Math.ceil(days / 10);
    const ticks = [];
    for (let date = new Date(start); date <= end; date = nextDay(date, step)) {
      ticks.push({ time: date.getTime(), x: x(date.getTime()), label: formatDate(date.getTime(), days < 365) });
    }
    return { start: startTime, end: endTime, ticks, x, rows: items.map(item => ({ item, finishX: x(item.completed), startX: item.started === null ? null : x(item.started), dueX: item.delay.deadline === null || item.delay.deadline < startTime || item.delay.deadline > endTime ? null : x(item.delay.deadline) })) };
  }

  function number(value) { return Number(value).toFixed(2); }

  function delayLabel(item) {
    if (item.delay.days === null) return 'No planned deadline';
    return item.delay.late ? item.delay.days + (item.delay.days === 1 ? ' day late' : ' days late') : 'On time';
  }

  function entryDescription(item) {
    return [item.ref + ' ' + item.title, 'Completed: ' + formatDateTime(item.completed), 'Actual start: ' + (item.started === null ? 'not recorded' : formatDateTime(item.started)), 'Planned due: ' + (item.plannedDueDate || 'not set'), delayLabel(item)].join('\n');
  }

  function rowSvg(row, layout) {
    const { item, finishX, startX, dueX } = row;
    const grid = layout.ticks.map(tick => '<line class="historyGridLine" x1="' + number(tick.x) + '" x2="' + number(tick.x) + '" y1="0" y2="' + ROW_HEIGHT + '"></line>').join('');
    const actual = startX === null ? '' : '<rect class="historyActualBar' + (item.type === 'epic' ? ' historyEpicBar' : '') + '" x="' + number(startX) + '" y="59" width="' + number(Math.max(2, finishX - startX)) + '" height="22" rx="5"></rect><circle class="historyStartPoint" cx="' + number(startX) + '" cy="70" r="3"></circle>';
    const due = dueX === null ? '' : '<line class="historyDueLine" x1="' + number(dueX) + '" x2="' + number(dueX) + '" y1="37" y2="112"></line>';
    const late = item.delay.late && dueX !== null ? '<rect class="historyDelayBar" x="' + number(dueX) + '" y="96" width="' + number(Math.max(2, finishX - dueX)) + '" height="12" rx="4"></rect><text class="historyDelayText" x="' + number(Math.max(84, Math.min(WIDTH - 84, (dueX + finishX) / 2))) + '" y="128">' + escape(delayLabel(item)) + '</text>' : '';
    const marker = '<circle class="historyCompletionPoint' + (item.type === 'epic' ? ' historyEpicPoint' : '') + '" cx="' + number(finishX) + '" cy="70" r="7"></circle><text class="historyCompletionCheck" x="' + number(finishX) + '" y="74">✓</text>';
    return '<svg class="historyRowSvg" viewBox="0 0 ' + WIDTH + ' ' + ROW_HEIGHT + '" width="100%" height="' + ROW_HEIGHT + '" preserveAspectRatio="none" role="img" aria-label="' + escape(entryDescription(item)) + '"><title>' + escape(entryDescription(item)) + '</title>' + grid + due + actual + late + marker + '</svg>';
  }

  function sourceLabel(item) {
    return ({ legacy: 'Saved completion', import: 'Imported', demo: 'Demo' })[item.source] || '';
  }

  function chartHtml(items, completionNumbers) {
    const layout = timelineLayout(items);
    const axis = layout.ticks.map(tick => '<line class="historyAxisTick" x1="' + number(tick.x) + '" x2="' + number(tick.x) + '" y1="27" y2="40"></line><text class="historyAxisText" x="' + number(tick.x) + '" y="20">' + escape(tick.label) + '</text>').join('');
    const rows = layout.rows.map(row => {
      const item = row.item;
      const source = sourceLabel(item);
      const repeat = completionNumbers.get(item.id) || 1;
      const parent = item.type !== 'epic' && item.epicId ? '<small class="historyEpicName">under ' + escape(item.epicRef + ' ' + item.epicTitle) + '</small>' : '';
      const title = item.ticketId ? '<button class="historyTicketLink" type="button" data-history-ticket="' + item.ticketId + '" aria-label="Open ' + escape(item.ref + ' ' + item.title) + '"><span>' + escape(item.ref) + '</span> ' + escape(item.title) + '</button>' : '<strong class="historyTicketTitle">' + escape(item.ref + ' ' + item.title) + '</strong>';
      const completedLabel = 'Completed ' + formatDateTime(item.completed);
      const startedLabel = item.started === null ? 'Actual start not recorded' : 'Started ' + formatDateTime(item.started);
      return '<article class="historyEntry' + (item.type === 'epic' ? ' historyEpicEntry' : '') + '" data-history-entry="' + item.id + '"><div class="historyEntryInfo">' + title + parent + '<time datetime="' + escape(item.completedAt) + '" title="' + escape(completedLabel) + '">' + escape(completedLabel) + '</time><small title="' + escape(startedLabel) + '">' + escape(startedLabel) + '</small><div class="historyEntryBadges"><span class="historyTypeBadge">' + escape(item.type) + '</span><span class="historyResultBadge' + (item.delay.late ? ' historyLateBadge' : '') + '" title="' + escape(item.plannedDueDate ? 'Planned due ' + item.plannedDueDate : 'No planned due date at completion') + '">' + escape(delayLabel(item)) + '</span>' + (item.archived ? '<span>Archived</span>' : '') + (source ? '<span>' + source + '</span>' : '') + (repeat > 1 ? '<span>Completion ' + repeat + '</span>' : '') + '</div></div><div class="historyEntryChart">' + rowSvg(row, layout) + '</div></article>';
    }).join('');
    return '<div class="historyDateRange">' + escape(formatDate(layout.start)) + ' – ' + escape(formatDate(layout.end)) + '</div><div class="historyScroll" tabindex="0" aria-label="Scroll actual completion timeline"><div class="historyTimeline"><div class="historyTimelineHead"><div class="historyEntryHeading">Completed work</div><svg class="historyAxis" viewBox="0 0 ' + WIDTH + ' 42" width="100%" height="42" preserveAspectRatio="none" role="img" aria-label="Completion date axis">' + axis + '</svg></div>' + rows + '</div></div>';
  }

  function completionSequence(items) {
    const result = new Map(), counts = new Map();
    [...items].sort((left, right) => left.completed - right.completed || left.id - right.id).forEach(item => {
      const key = item.ticketId || 'event-' + item.id;
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      result.set(item.id, count);
    });
    return result;
  }

  function renderLoading(container) {
    container.innerHTML = '<div class="historyNotice" role="status">Loading completion history…</div>';
  }

  function renderError(container, message, onRetry) {
    container.innerHTML = '<div class="historyNotice historyError" role="alert"><strong>Completion history could not be loaded.</strong><p>' + escape(message || 'Please try again.') + '</p>' + (onRetry ? '<button type="button" data-history-retry>Try again</button>' : '') + '</div>';
    const retry = container.querySelector('[data-history-retry]');
    if (retry) retry.onclick = onRetry;
  }

  function render(container, options = {}) {
    const items = normalizeItems(options.items);
    const numbers = completionSequence(items);
    const epicMap = new Map();
    items.forEach(item => { if (item.epicId && !epicMap.has(item.epicId)) epicMap.set(item.epicId, { id: item.epicId, label: item.epicRef + ' ' + item.epicTitle }); });
    const epics = [...epicMap.values()].sort((left, right) => left.label.localeCompare(right.label));
    container.innerHTML = '<section class="historyBoard"><p class="historyIntroduction">What actually finished, and when. Archived work stays in this history; each completion keeps the plan that was saved at that time.</p><div class="historyControls"><label>Find completed work<input type="search" data-history-filter="query" placeholder="Title or ticket number"></label><label>Epic<select data-history-filter="epic"><option value="">All Epics</option>' + epics.map(epic => '<option value="' + epic.id + '">' + escape(epic.label) + '</option>').join('') + '</select></label><label>Type<select data-history-filter="type"><option value="">All types</option>' + TYPES.filter(type => items.some(item => item.type === type)).map(type => '<option value="' + type + '">' + type + '</option>').join('') + '</select></label><label>Completed from<input type="date" data-history-filter="from"></label><label>Through<input type="date" data-history-filter="through"></label><button type="button" class="ghost" data-history-reset>Clear filters</button></div><div class="historyMetrics" data-history-metrics></div><div class="historyLegend"><span><b class="historyLegendActual"></b>Actual start → completion</span><span><b class="historyLegendEpic"></b>Epic start → completion</span><span><b class="historyLegendPoint">✓</b>Completed</span><span><b class="historyLegendDue"></b>Planned deadline</span><span><b class="historyLegendLate"></b>Late completion</span></div><p class="historyAccuracyNote">Bars show elapsed time, including waiting after work began. A completion marker is shown when the actual start was not recorded. Red bars show time past the planned due day.</p><div data-history-results aria-live="polite"></div></section>';
    const controls = [...container.querySelectorAll('[data-history-filter]')];
    const metrics = container.querySelector('[data-history-metrics]');
    const results = container.querySelector('[data-history-results]');
    const reset = container.querySelector('[data-history-reset]');
    let limit = 50;
    let disposed = false;
    function update(resetLimit = true) {
      if (disposed) return;
      const oldScroll = resetLimit ? null : results.querySelector('.historyScroll');
      const scrollPosition = oldScroll ? { top: oldScroll.scrollTop, left: oldScroll.scrollLeft } : null;
      if (resetLimit) limit = 50;
      const filters = Object.fromEntries(controls.map(control => [control.dataset.historyFilter, control.value]));
      const from = calendarDate(filters.from), through = calendarDate(filters.through);
      const invalidRange = from && through && from > through;
      const filtered = invalidRange ? [] : filterItems(items, filters);
      metrics.innerHTML = [['Completions', filtered.length], ['Task completions', filtered.filter(item => item.type !== 'epic').length], ['Epic completions', filtered.filter(item => item.type === 'epic').length], ['Late completions', filtered.filter(item => item.delay.late).length]].map(([name, value]) => '<div class="historyMetric"><strong>' + value + '</strong><span>' + name + '</span></div>').join('');
      const visible = filtered.slice(0, limit);
      results.innerHTML = invalidRange ? '<div class="historyNotice">Choose an end date on or after the start date.</div>' : visible.length ? '<p class="historyResultsSummary">' + (visible.length < filtered.length ? 'Newest ' + visible.length + ' of ' : '') + filtered.length + ' completion' + (filtered.length === 1 ? '' : 's') + ', newest first.</p>' + chartHtml(visible, numbers) + (visible.length < filtered.length ? '<button class="historyMore" type="button" data-history-more>Show older completions</button>' : '') : '<div class="historyNotice">' + (items.length ? 'No completions match these filters.' : 'No completed work yet. Finished tasks and Epics will appear here with their actual completion dates.') + '</div>';
      results.querySelectorAll('[data-history-ticket]').forEach(button => { button.onclick = () => { if (!disposed && options.onOpenTicket) options.onOpenTicket(+button.dataset.historyTicket); }; });
      const more = results.querySelector('[data-history-more]');
      if (more) more.onclick = () => { limit += 50; update(false); };
      const newScroll = scrollPosition ? results.querySelector('.historyScroll') : null;
      if (newScroll) { newScroll.scrollTop = scrollPosition.top; newScroll.scrollLeft = scrollPosition.left; }
    }
    controls.forEach(control => { control.oninput = () => update(); control.onchange = () => update(); });
    if (reset) reset.onclick = () => { controls.forEach(control => { control.value = ''; }); update(); };
    update();
    return function cleanup() {
      disposed = true;
      controls.forEach(control => { control.oninput = control.onchange = null; });
      if (reset) reset.onclick = null;
      results.querySelectorAll('button').forEach(button => { button.onclick = null; });
    };
  }

  return { normalizeItems, filterItems, completionDelay, timelineLayout, render, renderLoading, renderError };
});
