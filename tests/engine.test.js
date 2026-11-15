'use strict';
var assert = require('assert');
var E = require('../js/engine.js'), M = require('../js/model.js');
var sample = require('../samples/sample-project.json');
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function copy(o) { return JSON.parse(JSON.stringify(o)); }
function near(a, b, tol, what) { assert.ok(Math.abs(a - b) <= (tol || 1e-9), (what || '') + ' ' + a + ' vs ' + b); }

test('KE lookups: half-width at a height and top height at a half-width (piece-wise linear, upper envelope only)', function () {
  var o = E.outline([{ y: 0, z: 4000 }, { y: 1000, z: 4000 }, { y: 1600, z: 3400 }, { y: 1600, z: 1000 }, { y: 1400, z: 500 }, { y: 1400, z: 100 }, { y: 0, z: 100 }], 4);
  near(E.keWidth(o, 3.7), 1.3, 1e-12, 'W at 3.7 m'); near(E.keWidth(o, 2.0), 1.6, 1e-12, 'W at 2 m');
  near(E.keWidth(o, 0.8), 0, 0, 'below the upper envelope'); near(E.keTop(o, 0.5), 4.0, 1e-12, 'top at 0.5 m'); near(E.keTop(o, 1.3), 3.7, 1e-12, 'top at 1.3 m');
  near(E.keTop(o, 1.7), 0, 0, 'beyond the widest point');
  near(o.hUpBottom, 1.0, 0, 'bottom of the upper envelope');
});

test('Clearance formula: both positive → ΔX·ΔH/√(ΔX²+ΔH²); mixed → minimum; both negative → negative', function () {
  near(E.clearance(30, 40), 24, 1e-12); near(E.clearance(30, -5), -5, 0); near(E.clearance(-30, -40), -24, 1e-12); near(E.clearance(0, 50), 0, 0);
});

test('No movement on tangent: the generated KE is the static profile and the clearance is the plain gap', function () {
  var p = M.normalizeProject(sample), o = copy(p.settings['static']);
  p.bogies.forEach(function (b) { b.play_ld_mm = b.q_mm = b.w_mm = b.w_defl_mm = 0; });
  p.bodies.forEach(function (b) { b.s_tare = b.s_crush = b.s_defl = 0; });
  ['g_tol_mm', 'fw_mm', 'cl_err_mm'].forEach(function (k) { p.track.params[k] = 0; });
  p.train.carTypes.forEach(function (c) { c.drop_crush_mm = 0; });
  var r = E.staticRun(p, o), k = r.cars[0].cases[0];
  k.points.forEach(function (q) { near(q.x, q.x0, 1e-9, 'x'); near(q.h, q.h0, 1e-9, 'h'); });
  // centre-top point (0, 3780): KE roof flat at 3930 to 560, then sloping to (1360, 3500)
  var top = k.points[0], W = 560 + 150 * 800 / 430;
  near(top.dX, W, 1e-9, 'ΔX'); near(top.dH, 150, 1e-9, 'ΔH'); near(top.c, W * 150 / Math.sqrt(W * W + 150 * 150), 1e-9, 'c');
});

test('Derived values: pivots, yaw factors and wind constant follow the closed forms', function () {
  var p = M.normalizeProject(sample), c = p.train.carTypes[0], d = E.deriveCar(p, c, p.settings['static']);
  near(d.geo.a, 21.6 - 2 * 3.4, 1e-12, 'a'); near(d.geo.A_end, (d.geo.a + 2 * 3.4) / d.geo.a, 1e-12, 'A end'); near(d.geo.ni, d.geo.a / 2, 1e-12, 'ni = a/2');
  var Aw = 21.6 * (3.3 - 0.85), Cw = 0.5 * 1.2 * 1 * Aw * 1510 / (25500 * 9.81) / (3.6 * 3.6);
  near(d.wind.Cw_t, Cw, 1e-12, 'Cw tare'); near(d.wind.Dw_t, Cw * 120 * 120, 1e-9, 'Dw tare');
  near(d.dn_total, 20 + 38 + 50, 1e-12, 'Σd deflated'); near(d.up_total, 30, 1e-12, 'Σu');
});

test('Shared ends change the pivot distance, roll share and axle load as the statics say', function () {
  var p = M.normalizeProject(sample), c = p.train.carTypes[1];
  c.end2 = 'shared'; c.n_art_m = 0;
  var d = E.deriveCar(p, c, p.settings['static']);
  near(d.geo.a, 21.0 - 3.2, 1e-12, 'a'); near(d.theoretical.roll_share, 1.5, 0, 'share');
  var m = 42.5e3, R2 = m * (21.0 / 2 - 3.2) / d.geo.a, R1 = m - R2, Q2 = 2 * R2 + 5800;
  near(d.shared.Q2, Q2, 1e-6, 'Q2'); near(d.shared.axle_t, Math.max(R1 + 5800, Q2) / 2 / 1000, 1e-9, 'axle load');
});

test('Two different bogies: the larger play and travel are used', function () {
  var p = M.normalizeProject(sample);
  p.bogies[0].q_mm = 9; p.bogies[1].dn_prim_mm = 45;
  var d = E.deriveCar(p, p.train.carTypes[0], p.settings['static']);   // DMC: T + M
  assert.strictEqual(d.bogie.q, 9); assert.strictEqual(d.bogie.dn_prim, 45);
});

test('Engine never mutates the project and is deterministic', function () {
  var p = M.normalizeProject(sample), before = JSON.stringify(p);
  var a = JSON.stringify(E.staticRun(p, p.settings['static'])), b = JSON.stringify(E.staticRun(p, p.settings['static']));
  assert.strictEqual(JSON.stringify(p), before); assert.strictEqual(a, b);
});

test('Car-type selection and governing case over all car types', function () {
  var p = M.normalizeProject(sample), o = copy(p.settings['static']);
  var all = E.staticRun(p, o);
  assert.strictEqual(all.cars.length, 3);
  var min = Math.min.apply(null, all.cars.map(function (c) { return c.governing.c; }));
  near(all.governing.c, min, 0, 'governing = minimum'); assert.strictEqual(all.governing.car, 'TC');
  o.cars = 'DMC,MC';
  assert.deepStrictEqual(E.staticRun(p, o).cars.map(function (c) { return c.car; }), ['DMC', 'MC']);
});

test('Play calculator: l = gauge + tolerance, d = BB + 2·ef', function () {
  var p = M.normalizeProject(sample), r = E.playCalc(p, p.bogies[0]);
  near(r.l, 1441, 0); near(r.d_worn, 1412, 0); near(r.half_worn, 14.5, 1e-12); near(r.half_new, 8, 1e-12);
});

module.exports = tests;
