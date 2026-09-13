const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadRouter(hash = '') {
  const calls = [];
  const window = {
    location: { hash },
    history: {
      pushState(_state, _title, next) { calls.push(['push', next]); window.location.hash = next; },
      replaceState(_state, _title, next) { calls.push(['replace', next]); window.location.hash = next; },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'route.js'), 'utf8'), { window });
  return { router: window.KanbanodonRoute, window, calls };
}

test('route parsing accepts known views and positive ids', () => {
  const { router } = loadRouter('#/timeline/42/ticket/7');
  assert.deepEqual({ ...router.parseRoute() }, { view: 'timeline', boardId: 42, ticketId: 7 });
  assert.deepEqual({ ...router.parseRoute('#/unknown/-2/ticket/nope') }, { view: 'board', boardId: 0, ticketId: 0 });
  assert.deepEqual({ ...router.parseRoute('#/ideas/3') }, { view: 'ideas', boardId: 3, ticketId: 0 });
});

test('route building normalizes invalid route values', () => {
  const { router } = loadRouter();
  assert.equal(router.buildRoute('overview', 5, 9), '#/overview/5/ticket/9');
  assert.equal(router.buildRoute('invalid', -1, Number.NaN), '#/board');
  assert.equal(router.buildRoute('board', 1.5, Number.MAX_SAFE_INTEGER + 1), '#/board');
});

test('route writing pushes, replaces, and skips the current hash', () => {
  const { router, calls } = loadRouter('#/board/2');
  router.writeRoute('push', 'board', 2, 0);
  assert.deepEqual(calls, []);
  router.writeRoute('push', 'overview', 2, 0);
  router.writeRoute('replace', 'timeline', 2, 4);
  assert.deepEqual(calls, [
    ['push', '#/overview/2'],
    ['replace', '#/timeline/2/ticket/4'],
  ]);
});
