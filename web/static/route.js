// Wraps route helpers in a small module and exposes them on window.KanbanodonRoute.
(function () {
  const views = new Set(['board', 'overview', 'timeline', 'ideas', 'admin', 'config']);

  // Hash routes keep deep links working without requiring server-side URL rewrites.
  function parseRoute(hash) {
    const raw = (hash || window.location.hash || '').replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean);
    const view = views.has(parts[0]) ? parts[0] : 'board';
    let boardId = 0;
    let ticketId = 0;
    for (let i = 1; i < parts.length; i++) {
      if (parts[i] === 'ticket') {
        ticketId = +(parts[i + 1] || 0);
        i++;
      } else if (!boardId) {
        boardId = +(parts[i] || 0);
      }
    }
    return { view, boardId, ticketId };
  }

  // Builds a hash route from view, board, and ticket ids.
  function buildRoute(view, boardId, ticketId) {
    const parts = [views.has(view) ? view : 'board'];
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
