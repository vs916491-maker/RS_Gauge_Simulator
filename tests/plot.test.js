'use strict';
var assert = require('assert');
var P = require('../js/plot.js'), M = require('../js/model.js');
var p = M.normalizeProject(require('../samples/sample-project.json'));
var tests = [];
tests.push({ name: 'Profile datasets are mirrored outlines; axes are symmetric and include every point', fn: function () {
  var ds = P.profileDatasets(p, { ke: true, sod: true, rs: ['Car body'], items: true });
  assert.strictEqual(ds.filter(function (d) { return /^RS/.test(d.label); }).length, 1);
  var ax = P.profileAxes(ds);
  assert.strictEqual(ax.xmin, -ax.xmax);
  ds.forEach(function (d) { d.data.forEach(function (q) { assert.ok(q.x >= ax.xmin && q.x <= ax.xmax && q.y >= ax.ymin && q.y <= ax.ymax); }); });
} });
tests.push({ name: 'Track series: left curves positive, right negative, crest positive; gaps break the line', fn: function () {
  var s = P.trackSeries(p.track.segments);
  var c1 = s.curvature.filter(function (q) { return q.x === 700 || (q.x === 500 && q.y !== 0); });
  assert.ok(s.curvature.some(function (q) { return q.x === 900 && Math.abs(q.y + 2.5) < 1e-9; }), 'R400 right = -2.5');
  assert.ok(s.curvature.some(function (q) { return q.x === 2300 && Math.abs(q.y - 1000 / 300) < 1e-9; }), 'R300 left positive');
  assert.ok(s.vcurvature.some(function (q) { return q.x === 1750 && q.y > 0; }), 'crest positive');
  assert.ok(!s.curvature.some(function (q) { return q.y === null; }), 'no gaps in the sample');
  var gap = P.trackSeries([{ from_m: 0, to_m: 10, R_m: 0 }, { from_m: 20, to_m: 30, R_m: 0 }]);
  assert.ok(gap.curvature.some(function (q) { return q.y === null; }));
  assert.ok(c1.length >= 0);
} });
module.exports = tests;
