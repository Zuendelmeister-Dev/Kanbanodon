const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const trackSource = appSource.match(/function applyGanttTrackSizes\([^]*?\n\}/)[0];
const applyGanttTrackSizes = vm.runInNewContext('(' + trackSource + ')');

test('Timeline sizing uses trusted DOM properties under the restrictive server style policy', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'cmd', 'server', 'http.go'), 'utf8');
  assert.match(server, /style-src 'self';/);
  assert.doesNotMatch(server, /style-src[^;]*'unsafe-inline'/);
  const properties = new Map();
  const root = {style: {setProperty(name, value) {properties.set(name, value);}}};
  for (const [rowHeight, rowCount] of [[120, 10], [156, 10], [188, 10], [120, 0]]) {
    applyGanttTrackSizes(root, rowHeight, rowCount, 56, 62);
    assert.equal(properties.get('--gantt-row-height'), rowHeight + 'px');
    assert.equal(properties.get('--gantt-row-count'), String(rowCount));
    assert.equal(properties.get('--gantt-head-height'), '56px');
    assert.equal(properties.get('--gantt-axis-height'), '62px');
    assert.equal(properties.get('--gantt-chart-height'), (56 + rowHeight * rowCount + 62) + 'px');
  }
  const renderSource = appSource.match(/function renderGanttContent\([^]*?\n\}/)[0];
  const labelSource = appSource.match(/function ganttTaskLabel\([^]*?\n\}/)[0];
  assert.match(renderSource, /applyGanttTrackSizes\(root, rowHeight, tasks\.length, headHeight, axisHeight\)/);
  assert.doesNotMatch(renderSource + labelSource, /style="/);
});

test('Timeline labels and SVG viewport retain identical fixed CSS pixel tracks', () => {
  const css = fs.readFileSync(path.join(__dirname, 'task-tools.css'), 'utf8');
  const rowRule = [...css.matchAll(/\.ganttTaskItem\{([^}]*)\}/g)].at(-1)[1];
  for (const property of ['height', 'min-height', 'max-height']) {
    assert.match(rowRule, new RegExp('(?:^|;)' + property + ':var\\(--gantt-row-height\\)(?:;|$)'));
  }
  assert.match(css, /\.ganttTaskRows\{[^}]*grid-auto-rows:var\(--gantt-row-height\);[^}]*gap:0/);
  assert.match(css, /\.ganttTaskPane\{[^}]*height:var\(--gantt-chart-height\)/);
  assert.match(css, /\.ganttSvg\{[^}]*min-width:0;[^}]*max-width:none;[^}]*height:var\(--gantt-chart-height\)/);
});
