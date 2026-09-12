// Wraps route helpers in a small module and exposes them on window.KanbanodonRoute.
(function () {
  const views = new Set(['board', 'overview', 'timeline', 'backlog', 'admin', 'config']);

  function positiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : 0;
  }

  // Hash routes keep deep links working without requiring server-side URL rewrites.
  function parseRoute(hash) {
    const raw = (hash || window.location.hash || '').replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean);
    const requestedView = parts[0] === 'ideas' ? 'backlog' : parts[0];
    const view = views.has(requestedView) ? requestedView : 'board';
    let boardId = 0;
    let ticketId = 0;
    for (let i = 1; i < parts.length; i++) {
      if (parts[i] === 'ticket') {
        ticketId = positiveId(parts[i + 1]);
        i++;
      } else if (!boardId) {
        boardId = positiveId(parts[i]);
      }
    }
    return { view, boardId, ticketId };
  }

  // Builds a hash route from view, board, and ticket ids.
  function buildRoute(view, boardId, ticketId) {
    const parts = [views.has(view) ? view : 'board'];
    boardId = positiveId(boardId);
    ticketId = positiveId(ticketId);
    if (boardId) parts.push(String(boardId));
    if (ticketId) parts.push('ticket', String(ticketId));
    return '#/' + parts.join('/');
  }

  // Writes a hash route using push or replace history.
  function writeRoute(mode, view, boardId, ticketId) {
    const next = buildRoute(view, boardId, ticketId);
    if (window.location.hash === next) return;
    if (mode === 'replace') window.history.replaceState(null, '', next);
    else window.history.pushState(null, '', next);
  }

  window.KanbanodonRoute = { parseRoute, buildRoute, writeRoute };
}());
