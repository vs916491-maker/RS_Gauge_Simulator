'use strict';
var assert = require('assert');
var P = require('../js/plot.js'), M = require('../js/model.js'), E = require('../js/engine.js');
var p = M.normalizeProject(require('../samples/sample-project.json'));
var tests = [];
tests.push({ name: 'Profile datasets are mirrored outlines; axes are symmetric and include every point', fn: function () {
  var ds = P.profileDatasets(p, { ke: true, sod: true, rs: ['Roof section'], items: true });
  assert.strictEqual(ds.filter(function (d) { return /^RS/.test(d.label); }).length, 1);
  var ax = P.profileAxes(ds);
  assert.strictEqual(ax.xmin, -ax.xmax);
  ds.forEach(function (d) { d.data.forEach(function (q) { assert.ok(q.x >= ax.xmin && q.x <= ax.xmax && q.y >= ax.ymin && q.y <= ax.ymax); }); });
} });
tests.push({ name: 'Track series: curvature linear in transitions (left +, right −), cant ramps, gaps break the line', fn: function () {
  var s = P.trackSeries(p.track.segments);
  assert.ok(s.curvature.some(function (q) { return q.x === 460 && Math.abs(q.y + 2) < 1e-9; }), 'R500 right = -2 at the end of the transition');
  assert.ok(s.curvature.some(function (q) { return q.x === 420 && q.y === 0; }), 'transition starts straight');
  assert.ok(s.curvature.some(function (q) { return q.x === 2150 && Math.abs(q.y - 1000 / 300) < 1e-9; }), 'R300 left positive');
  assert.ok(s.cant.some(function (q) { return q.x === 1830 && q.y === 100; }), 'cant ramp end');
  assert.ok(s.vcurvature.some(function (q) { return q.x === 1700 || (q.x === 1635 && q.y > 0); }), 'crest positive');
  assert.ok(!s.curvature.some(function (q) { return q.y === null; }), 'no gaps in the sample');
  var gap = P.trackSeries([{ from_m: 0, to_m: 10, R_start_m: 0, R_end_m: 0 }, { from_m: 20, to_m: 30, R_start_m: 0, R_end_m: 0 }]);
  assert.ok(gap.curvature.some(function (q) { return q.y === null; }));
} });
tests.push({ name: 'Static result datasets: KE, static profile, generated KE tare and crush, governing points; Method A lines', fn: function () {
  var r = E.staticRun(p, p.settings['static']), ds = P.sectionDatasets(r, 'TC', 'ext');
  assert.deepStrictEqual(ds.map(function (d) { return d.label.split(':')[0].split(' (')[0]; }), ['Customer KE', 'Static profile', 'Generated KE – AW0', 'Generated KE – AW2', 'Generated KE – AW3', 'Generated KE – AW4', 'Governing point – AW0', 'Governing point – AW2', 'Governing point – AW3', 'Governing point – AW4']);
  var gen = ds[2].data, ex = r.cars[1].cases.filter(function (k) { return k.section === 'ext'; })[0], n = ex.points.length;
  assert.strictEqual(gen.length, 2 * n + 1, 'right side + mirrored left side + closing point');
  assert.strictEqual(gen[0].x, ex.points[0].x); assert.strictEqual(gen[n].x, -ex.points[n - 1].x);
  assert.strictEqual(P.methodADatasets(r, 'TC').length, 7, '6 standard lines + the additional section Door 2');
} });
module.exports = tests;
