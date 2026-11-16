'use strict';
// Rotation stops (METHOD §5.3b): free rotation at R min, contact radius in service, limit on w(R).
var assert = require('assert');
var M = require('../js/model.js'), E = require('../js/engine.js');
var SAMPLE = require('../samples/sample-project.json');
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= (tol || 1e-9), (msg || '') + ' ' + a + ' vs ' + b); }
function sample() { return M.normalizeProject(JSON.parse(JSON.stringify(SAMPLE))); }

test('Free rotation and contact radius against a hand calculation', function () {
  var p = sample(), o = p.settings['static'], c = p.train.carTypes[2];   // MC: two motor bogies with stops
  var d = E.deriveCar(p, c, o), rows = E.rotStops(p, d, o), x = rows[0], b = d.bogie.b1, a = d.geo.a;
  assert.strictEqual(rows.length, 2);
  var Rmin = Math.min(p.track.params.R_min_m, E.lineCurvature(p).Rmin), psi = Math.asin(a / (2 * Rmin));
  near(x.Rmin, Rmin); near(x.psi, psi); near(x.closure, psi * b.rs_x_m * 1000, 1e-9);
  near(x.margin, b.rs_gap_mm - psi * b.rs_x_m * 1000, 1e-9);
  near(x.solid, b.rs_gap_mm + b.rs_comp_mm - psi * b.rs_x_m * 1000, 1e-9);
  var heavy = d.loads.reduce(function (m, L) { return !m || L.m > m.m ? L : m; }, null), tp = p.track.params;
  var aq = 9.81 * (tp.cantdef_max_mm + heavy.Cw * tp.wind_open_kmh * tp.wind_open_kmh) / p.train.L_mm;
  var yq = heavy.m / 2 * aq / (b.n_as * b.ky_sec) * 1000;
  near(x.yq, yq, 1e-9);
  near(x.Rrun, a / (2 * Math.sin((b.rs_gap_mm - yq) / 1000 / b.rs_x_m)), 1e-6);
  near(x.Rrot, a / (2 * Math.sin(b.rs_gap_mm / 1000 / b.rs_x_m)), 1e-6);
  assert.ok(x.ok && x.comfOk === null);
});

test('Blocked rotation and comfort radius enter the verdict; line share of curves below the contact radius', function () {
  var p = sample(), o = p.settings['static'];
  p.bogies.forEach(function (b) { if (b.name === 'M') { b.rs_x_m = 1.2; b.rs_gap_mm = 30; } });
  var r = E.staticRun(p, o), mc = r.cars.filter(function (c) { return c.car === 'MC'; })[0];
  assert.ok(!mc.rotStops[0].ok && !mc.ok && !r.ok, 'diagonal contact at R min → CHECK');
  var q = sample(); q.bogies.forEach(function (b) { if (b.name === 'M') { b.rs_x_m = 0.8; b.rs_gap_mm = 45; b.rs_Rcomf_m = 150; } });
  var r2 = E.staticRun(q, q.settings['static']), x = r2.cars[2].rotStops[0];
  assert.ok(x.ok && x.comfOk === false && !r2.cars[2].ok, 'contact above the comfort radius');
  near(x.lineLen, E.lineCurvature(q, 1 / x.Rrun).len, 1e-9);
  assert.ok(x.lineShare > 0 && x.lineShare <= 100);
  // hand line length: a single 300 m circular curve of R 200 m between tangents, contact radius 250 m
  var t = { track: { segments: [{ from_m: 0, to_m: 100, element: 'tangent', R_start_m: 0, R_end_m: 0, side: '' }, { from_m: 100, to_m: 200, element: 'transition', side: 'L', R_start_m: 0, R_end_m: 200 },
    { from_m: 200, to_m: 500, element: 'circular', side: 'L', R_start_m: 200, R_end_m: 200 }] } };
  var lc = E.lineCurvature(t, 1 / 250);
  near(lc.Rmin, 200); near(lc.total, 500); near(lc.len, 300 + 100 * (1 / 200 - 1 / 250) / (1 / 200));
});

test('Limit on w(R): min(entered, gap + travel − ψ·x) in every method when selected; warning otherwise', function () {
  var p = sample(), o = p.settings['static'], c = p.train.carTypes[2];
  p.bogies.forEach(function (b) { if (b.name === 'M') { b.rs_gap_mm = 30; b.rs_comp_mm = 2; b.rs_x_m = 0.4; } });
  var r0 = E.staticRun(p, o);
  assert.ok(r0.warnings.some(function (w) { return /larger than the rotation stops allow/.test(w); }));
  p.bogies.forEach(function (b) { if (b.name === 'M') { b.rs_limit_w = 'yes'; } });
  var d = E.deriveCar(p, c, o), a = d.geo.a;
  near(d.w_use, Math.min(30, 32));
  [250, 150, 400].forEach(function (R) { near(d.wi(R), Math.min(30, 32 - Math.asin(a / (2 * R)) * 400), 1e-9, 'R ' + R); near(d.wa(R), d.wi(R)); });
  p.track.params.R_static_m = 150;
  var cs = E.carCases(d, []).filter(function (k) { return k.section === 'int'; })[0];
  near(E.caseParams(p, d, cs, o).w, d.wi(150), 1e-9);
  var r = E.staticRun(p, o);
  assert.ok(!r.warnings.some(function (w) { return /MC bogie M: the entered w/.test(w); }));
  // the EN bogie views see the same limit at 250 m and 150 m
  o.en_check = 'yes';
  var en = E.staticRun(p, o).cars[2].en, bg = en.bogies[0];
  near(bg.i.w250 * 1000, Math.min(30, E.rsLimit(p.bogies.filter(function (b) { return b.name === 'M'; })[0], a, 250)), 1e-9);
});

module.exports = tests;
