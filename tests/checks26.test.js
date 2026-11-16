'use strict';
// Suspension travel with sag and roll (§5.3d), static / dynamic electrical clearance (§5.3e), static gauge measurement (§13.3).
var assert = require('assert');
global.XLSX = global.XLSX || require('../vendor/xlsx.full.min.js');
var M = require('../js/model.js'), E = require('../js/engine.js'), IO = require('../js/io.js');
var SAMPLE = require('../samples/sample-project.json');
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= (tol || 1e-9), (msg || '') + ' ' + a + ' vs ' + b); }
function sample() { return M.normalizeProject(JSON.parse(JSON.stringify(SAMPLE))); }

test('Suspension travel: secondary roll at the air spring against bump / rebound travel (hand values), in the verdict', function () {
  var p = sample(), o = p.settings['static'], r = E.staticRun(p, o), c = r.cars[1], d = c.derived, b = d.bogie.b1;
  assert.strictEqual(c.susp.length, 2 * d.loads.length);
  c.susp.filter(function (x) { return x.end === 1; }).forEach(function (x, i) {
    var ks = c.cases.filter(function (k) { return k.li === i; }), t = Math.max.apply(null, ks.map(function (k) { return k.params.thq + k.params.thr; }));
    var st = d.theoretical.loads[i], th2 = t * st.K / st.K2;
    near(x.theta, t); near(x.roll, th2 * b.b2_mm, 1e-9);
    near(x.mDn, b.bump_dn_mm - d.loads[i].dz - th2 * b.b2_mm, 1e-9); near(x.mUp, b.bump_up_mm + d.loads[i].dz - th2 * b.b2_mm, 1e-9);
  });
  assert.ok(r.ok, 'sample within travel');
  p.bogies.forEach(function (b2) { b2.bump_up_mm = 20; });
  var r2 = E.staticRun(p, o);
  assert.ok(!r2.ok && r2.cars.some(function (x) { return x.susp.some(function (q) { return !q.ok; }); }));
  var o3 = JSON.parse(JSON.stringify(o)); o3.lat_state = 'deflated';
  assert.strictEqual(E.staticRun(p, o3).cars[0].susp.length, 0, 'not checked deflated (emergency springs)');
});

test('Electrical clearance: static distance of "Overhead line" items to the profiles; dynamic requirement at least the dynamic value', function () {
  var p = sample(), o = p.settings['static'];
  p.sod.items.push({ name: 'Rigid catenary', type: 'ohe', y: 0, z: 4150, min_clear_mm: 50, side: 'both', ch_from_m: null, ch_to_m: null });
  var r = E.staticRun(p, o), c = r.cars[0], x = c.elStatic.filter(function (q) { return q.section === 'ext'; })[0];
  // HVAC section top H1 at z 3830, y 0..420: distance straight down from (0, 4150)
  near(x.dist, 4150 - 3830, 1e-9); near(x.req, 290); assert.ok(x.ok);
  p.sod.items[p.sod.items.length - 1].z = 4100;
  var r2 = E.staticRun(p, o);
  assert.ok(!r2.ok && r2.cars[0].elStatic.some(function (q) { return !q.ok; }), '270 mm < 290 mm');
  var sc = E.sodContext(p), it = sc.items.filter(function (q) { return q.type === 'ohe'; })[0];
  near(it.req, 190);
  assert.strictEqual(sc.items.filter(function (q) { return q.type === 'third_rail'; })[0].req, 50, 'other items unchanged');
});

test('Static gauge measurement: Method B on the measured points, deviation from the design profile, Excel sheet', function () {
  var p = sample(), o = p.settings['static'], r = E.staticRun(p, o), m = E.measuredEval(p, r, o);
  assert.strictEqual(m.length, 1);
  var g = m[0], c = r.cars[0], ks = c.cases.filter(function (k) { return k.section === 'int'; });
  // a measured point equal to a design vertex has the same clearance as that vertex in Method B
  var q = g.points.filter(function (x) { return x.pt === 'M-R3'; })[0], v = p.rs.profiles[0].points.filter(function (x) { return x.pt === 'R3'; })[0];
  near(q.y, v.y + 2); near(q.dev, 2, 1e-9);
  var pv = JSON.parse(JSON.stringify(p)); pv.tests.measured = [{ car: 'DMC', section: 'int', pt: 'X', y_mm: v.y, z_mm: v.z, note: '' }];
  var mv = E.measuredEval(pv, r, o)[0].points[0], cmin = Math.min.apply(null, ks.map(function (k) { return k.points.filter(function (x) { return x.pt === 'R3'; })[0].c; }));
  near(mv.c, cmin, 1e-9); near(mv.dev, 0, 1e-9);
  // too wide: infringes
  pv.tests.measured[0].y_mm = 1700; pv.tests.measured[0].z_mm = 2000;
  assert.ok(!E.measuredEval(pv, r, o)[0].ok);
  var wb = IO.readWorkbookBytes(new Uint8Array(IO.workbookBytes(IO.testsWorkbook(E.swayEval(p, o), E.gaugeTestPlan(p, r, E.swayEval(p, o)), p, { measured: m }))));
  assert.ok(wb.SheetNames.indexOf('Measured_Profile_Check') >= 0);
});

module.exports = tests;
