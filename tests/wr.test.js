'use strict';
// Secondary clearance varying with the radius and the direction: w∞, w_i(R) towards the inside, w_a(R) towards the
// outside of the curve (METHOD §5.3a), in the workbook method (§6.1), the route sweep (§8.3) and EN 15273-2 (§10.4).
var assert = require('assert');
var M = require('../js/model.js'), E = require('../js/engine.js');
var SAMPLE = require('../samples/sample-project.json');
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= (tol || 1e-9), (msg || '') + ' ' + a + ' vs ' + b); }
function sample() { return M.normalizeProject(JSON.parse(JSON.stringify(SAMPLE))); }

test('w(R): linear in 1/R from w∞ to w(250 m) and w(150 m), held below 150 m (hand values)', function () {
  var pt = { inf: 30, r1: 20, r2: 10 };
  near(E.wCurve(pt, 0), 30); near(E.wCurve(pt, 500), 25); near(E.wCurve(pt, 250), 20);
  near(E.wCurve(pt, 200), 20 - 10 * (1 / 200 - 1 / 250) / (1 / 150 - 1 / 250)); near(E.wCurve(pt, 150), 10); near(E.wCurve(pt, 100), 10);
  // blanks: direction → both directions → w∞; deflated: constant
  var b = { w_mm: 30, w_defl_mm: 40, w250_mm: 20, w150_mm: null, wi250_mm: 15, wi150_mm: null, wa250_mm: null, wa150_mm: null };
  assert.deepStrictEqual(E.wPoints(b, 'i', false), { inf: 30, r1: 15, r2: 15 });
  assert.deepStrictEqual(E.wPoints(b, 'a', false), { inf: 30, r1: 20, r2: 20 });
  assert.deepStrictEqual(E.wPoints(b, 'a', true), { inf: 40, r1: 40, r2: 40 });
  b.w150_mm = 12;
  assert.deepStrictEqual(E.wPoints(b, 'i', false), { inf: 30, r1: 15, r2: 12 });
  assert.deepStrictEqual(E.wPoints({ w_mm: 30 }, 'i', false), { inf: 30, r1: 30, r2: 30 });
});

test('Workbook method on a curve: w_i between the pivots, w_i·n/a + w_a·(n + a)/a beyond; straight track and blank inputs unchanged', function () {
  var p = sample(), o = p.settings['static'], c = p.train.carTypes[1];
  p.track.params.R_static_m = 250;
  var d0 = E.deriveCar(p, c, o), base = E.carCases(d0, []).map(function (cs) { return E.caseParams(p, d0, cs, o).w; });
  base.forEach(function (w, i) { var cs = E.carCases(d0, [])[i]; near(w, d0.w_use * E.caseParams(p, d0, cs, o).A, 1e-12, 'blank inputs = w·A'); });
  p.bogies.forEach(function (b) { b.wi250_mm = 15; b.wa250_mm = 25; });
  var d = E.deriveCar(p, c, o), g = d.geo;
  near(d.wi(250), 15); near(d.wa(250), 25); near(d.wi(0), d.w_use);
  E.carCases(d, []).forEach(function (cs) {
    var cp = E.caseParams(p, d, cs, o);
    var exp = cs.section === 'int' ? 15 : 15 * cp.n / g.a + 25 * (cp.n + g.a) / g.a;
    near(cp.w, exp, 1e-9, cs.id);
  });
  p.track.params.R_static_m = 0;
  var d2 = E.deriveCar(p, c, o);
  E.carCases(d2, []).forEach(function (cs) { var cp = E.caseParams(p, d2, cs, o); near(cp.w, d2.w_use * cp.A, 1e-12, 'tangent ' + cs.id); });
});

test('Route sweep: dT at the governing radius uses w_i / w_a; equal directional values give the old result exactly', function () {
  var p = sample(), so = p.settings['static'], dOpt = p.settings.dynamic;
  var r0 = E.dynamicRun(p, so, dOpt);
  var q = sample(); q.bogies.forEach(function (b) { b.wi250_mm = b.w_mm; b.wa250_mm = b.w_mm; b.wi150_mm = b.w_mm; b.wa150_mm = b.w_mm; });
  var r1 = E.dynamicRun(q, so, dOpt);
  r0.cars.forEach(function (c, i) { c.rows.forEach(function (r, j) { near(r1.cars[i].rows[j].o2, r.o2, 1e-9); near(r1.cars[i].rows[j].i2, r.i2, 1e-9); }); });
  var s = sample(); s.bogies.forEach(function (b) { b.wi250_mm = 10; b.wa250_mm = 40; });
  var r2 = E.dynamicRun(s, so, dOpt), c2 = r2.cars[0], k = c2._k, d = c2.derived, g = d.geo, bg = d.bogie, n = 0;
  c2.rows.forEach(function (r) {
    if (!(r.Rg > 0)) { near(r.dTi, k.dT_in, 1e-12); return; }
    var base = bg.play + bg.q + s.track.params.fw_mm;
    near(r.dTi, base + d.wi(r.Rg), 1e-9);
    near(r.dTo, g.A_end * base + d.wi(r.Rg) * g.n_end / g.a + d.wa(r.Rg) * (g.n_end + g.a) / g.a, 1e-9);
    n++;
  });
  assert.ok(n > 10, n + ' curve rows');
  return n + ' curve rows checked';
});

test('EN 15273-2: Ei uses w_i of the bogie; Ea uses w_i of the far bogie and w_a of the bogie at the section end', function () {
  var p = sample(), r = E.enRules(p);
  function view(w250, w150) { return { p: 2.3, winf: 0.03, w250: w250, w150: w150 }; }
  var b = view(0.025, 0.02); b.i = view(0.015, 0.012); b.a = view(0.035, 0.03);
  var f = view(0.025, 0.02); f.i = view(0.018, 0.016); f.a = view(0.04, 0.038);
  var base = { set: 'traction', low: false, a: 14.6, d: 1.41, q: 0.005, z: 0.01 };
  function o(side, n, nr, fr) { var x = JSON.parse(JSON.stringify(base)); x.side = side; x.n = n; x.near = nr; x.far = fr; return x; }
  near(E.enE(r, o('i', 7.3, b, f)).E, E.enE(r, o('i', 7.3, b.i, f.i)).E);
  near(E.enE(r, o('a', 3.2, b, f)).E, E.enE(r, o('a', 3.2, b.a, f.i)).E);
  assert.ok(E.enE(r, o('a', 3.2, b, f)).E > E.enE(r, o('a', 3.2, view(0.025, 0.02), view(0.025, 0.02))).E, 'larger outside clearance → larger Ea');
  ['coach'].forEach(function (set) { base.set = set; near(E.enE(r, o('a', 3.2, b, f)).E, E.enE(r, o('a', 3.2, b.a, f.i)).E); });
});

module.exports = tests;
