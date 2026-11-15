'use strict';
// Test calculations (METHOD §13): sway-test fit and acceptance, kinematic gauge test plan.
var assert = require('assert');
var M = require('../js/model.js'), E = require('../js/engine.js');
var SAMPLE = require('../samples/sample-project.json');
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= (tol || 1e-9), (msg || '') + ' ' + a + ' vs ' + b); }
function sample() { return M.normalizeProject(JSON.parse(JSON.stringify(SAMPLE))); }
function rnd(seed) { var x = seed; return function () { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }

test('Sway fit recovers s and hc exactly from noise-free readings; one height is refused', function () {
  var R = rnd(5), worst = 0, k;
  for (k = 0; k < 200; k++) {
    var s = 0.1 + R() * 0.4, hc = 200 + R() * 900, L = 1500, pts = [];
    [40, 80, 120].forEach(function (D) { [900 + R() * 300, 2200 + R() * 400, 3400 + R() * 300].forEach(function (h) { pts.push({ D: D, h: h, y: s * D / L * (h - hc) }); }); });
    var f = E.swayFit(pts, L);
    worst = Math.max(worst, Math.abs(f.s - s) / s, Math.abs(f.hc - hc) / 1000, f.rms);
  }
  assert.ok(worst < 1e-9, 'worst ' + worst);
  assert.strictEqual(E.swayFit([{ D: 50, h: 2000, y: 5 }, { D: 100, h: 2000, y: 10 }], 1500), null);
  return 'worst relative error ' + worst.toExponential(1);
});

test('Sway evaluation: roll displacement per 100 mm cant measured vs used at h1, h2 and the profile top', function () {
  var p = sample(), r = E.swayEval(p, p.settings['static']), dmc = r[0];
  assert.strictEqual(r.length, 3); assert.ok(r.every(function (x) { return x.ok; }), 'sample passes');
  near(dmc.s, 0.27, 0.002, 's'); near(dmc.hc, 600, 3, 'hc'); assert.ok(dmc.rms < 0.3);
  assert.ok(dmc.sides.L && dmc.sides.R, 'both sides fitted');
  var c = dmc.checks[1];   // h2 = 3000: 100·0,3·(3000 − 550)/1500 = 49,0
  near(c.used, 49, 1e-9); near(c.measured, 100 * dmc.s * (3000 - dmc.hc) / 1500, 1e-9);
  // a softer vehicle (bigger roll) fails
  p.tests.sway.forEach(function (x) { if (x.car === 'DMC' && x.load === 'tare') { ['y1_mm', 'y2_mm', 'y3_mm'].forEach(function (k) { x[k] = x[k] * 1.3; }); } });
  var bad = E.swayEval(p, p.settings['static'])[0];
  assert.ok(!bad.ok && bad.checks.some(function (x) { return !x.ok; }));
  // theoretical source: used values follow the option
  p.settings['static'].flex = 'theoretical';
  var th = E.swayEval(p, p.settings['static'])[0];
  near(th.used.s, th.theoretical.s, 1e-12); near(th.used.hc, th.theoretical.hc, 1e-9);
  // unknown car type is reported, not thrown
  p.tests.sway[0].car = 'XX';
  assert.ok(E.swayEval(p, p.settings['static']).some(function (x) { return x.error; }));
});

test('Gauge test plan: expected test margins equal the static run (linear and RSS); shims = cant + wind', function () {
  var p = sample(), worst = 0;
  ['linear', 'rss'].forEach(function (comb) {
    var o = JSON.parse(JSON.stringify(p.settings['static'])); o.comb = comb; o.align = 'yes'; o.tilt = 'yes'; o.up_roll = 'yes';
    var s = E.staticRun(p, o), plan = E.gaugeTestPlan(p, s, []);
    plan.forEach(function (c, i) {
      assert.strictEqual(c.cases.length, 6, 'tare and crush cases only (METHOD §13.2)');
      c.cases.forEach(function (k) {
        var cs = s.cars[i].cases.filter(function (x) { return x.id === k.id; })[0];
        near(k.D, cs.params.cant + cs.params.wind, 1e-12); near(k.Rlat, cs.params.play + cs.params.q + cs.params.w, 1e-12);
        k.points.forEach(function (q, m) { var o2 = cs.points[m]; worst = Math.max(worst, Math.abs(q.dX - o2.dX), Math.abs(q.dH - o2.dH), Math.abs(q.c - o2.c)); });
        near(k.min.c, cs.min.c, 1e-9);
      });
    });
  });
  assert.ok(worst < 1e-9, 'worst ' + worst);
  return 'max difference ' + worst.toExponential(1) + ' mm';
});

test('Gauge test plan with a sway test: measured s, hc equal to the used ones give the same positions', function () {
  var p = sample(), s = E.staticRun(p, p.settings['static']);
  var c = s.cars[0], k = c.cases[0], cp = k.params;
  var plan = E.gaugeTestPlan(p, s, [{ car: c.car, load: k.role, s: cp.s, hc: cp.hc * 1000 }]);
  plan[0].cases[0].points.forEach(function (q) { near(q.xm, q.xt, 1e-9); near(q.hm, q.ht, 1e-9); near(q.cm, q.c, 1e-9); });
  var sw = E.swayEval(p, p.settings['static']), plan2 = E.gaugeTestPlan(p, s, sw), dmcT = plan2[0].cases[0];
  assert.ok(dmcT.sway && dmcT.minMeasured, 'DMC tare uses the measured sway values');
  var tcExt = plan2[1].cases.filter(function (k) { return k.id === 'ext_t'; })[0];
  assert.ok(tcExt.D > 120 && tcExt.beyondSway, 'shims above the largest tested shim are flagged');
  assert.ok(!plan2[2].cases.some(function (k) { return k.beyondSway; }), 'no sway test for MC: nothing flagged');
  // stiffer measured roll: points above both roll centres move less towards the low side; roof corners drop less
  var hcU = dmcT.hc * 1000, hcM = dmcT.sway.hc;
  dmcT.points.forEach(function (q) { if (q.h0 > Math.max(hcU, hcM) + 1) { assert.ok(q.xm < q.xt, q.pt + ' moves less laterally'); } if (q.x0 > 0) { assert.ok(q.hm > q.ht, q.pt + ' drops less'); } });
});

test('Input checks: sway rows with an unknown car type, no shim or one height are errors on the Tests tab', function () {
  var p = sample();
  p.tests.sway[0].car = 'XX'; p.tests.sway[1].D_mm = 0; p.tests.sway[2].h2_mm = null; p.tests.sway[2].y2_mm = null; p.tests.sway[2].h3_mm = null; p.tests.sway[2].y3_mm = null;
  var ms = M.validate(p).messages.filter(function (m) { return m.tab === 'tests' && m.level === 'err'; }).map(function (m) { return m.text; }).join(' | ');
  assert.ok(/row 1: car type "XX"/.test(ms) && /row 2: shim height/.test(ms) && /row 3: at least two heights/.test(ms), ms);
  assert.strictEqual(M.validate(sample()).messages.filter(function (m) { return m.tab === 'tests'; }).length, 0);
});

test('Tests export: sway evaluation, test set-up (6 cases per car type) and every point', function () {
  global.XLSX = global.XLSX || require('../vendor/xlsx.full.min.js');
  var IO = require('../js/io.js'), p = sample(), s = E.staticRun(p, p.settings['static']), sw = E.swayEval(p, p.settings['static']), plan = E.gaugeTestPlan(p, s, sw);
  var wb = IO.readWorkbookBytes(new Uint8Array(IO.workbookBytes(IO.testsWorkbook(sw, plan, p, { stale: false }))));
  assert.deepStrictEqual(wb.SheetNames, ['Sway_Evaluation', 'Gauge_Test_Setup', 'Gauge_Test_Points']);
  var setup = global.XLSX.utils.sheet_to_json(wb.Sheets.Gauge_Test_Setup, { header: 1 }), pts = global.XLSX.utils.sheet_to_json(wb.Sheets.Gauge_Test_Points, { header: 1 });
  assert.strictEqual(setup.length - 5, s.cars.length * 6);
  assert.strictEqual(pts.length - 1, s.cars.reduce(function (n, c) { return n + c.cases.filter(function (k) { return k.role !== 'other'; }).reduce(function (m, k) { return m + k.points.length; }, 0); }, 0));
});

module.exports = tests;
