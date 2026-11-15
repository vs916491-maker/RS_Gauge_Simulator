'use strict';
// EN 15273-2:2009 A.3.4 heights above the running surface (METHOD §10.7). Table A.1 (locomotives, coaches, motor
// coaches) and the gradient-transition formulae A.16–A.19 are typed in LITERALLY below and compared with the engine;
// then hand checks on the fictional sample.
var assert = require('assert');
var E = require('../js/engine.js');
var M = require('../js/model.js');
var tests = [];
function rnd(seed) { var x = seed; return function () { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }
function sample() { return M.normalizeProject(JSON.parse(JSON.stringify(require('../samples/sample-project.json')))); }
function opts(p) { var o = JSON.parse(JSON.stringify(p.settings['static'])); o.en_check = 'yes'; return o; }

// ---- Table A.1, column "Locomotives, coaches, motor coaches" (suspension + wheel wear; side bearers "-----", body sag 0)
function tableA1(zone, Aff, dAff, s, b, b2, Usr, dUsr, n, a) {
  if (zone === 'A') { return Aff + Usr; }
  if (zone === 'B') { return Aff + 0.1 * s * (b - b2) + Usr; }
  if (zone === 'C') { return Aff + dAff * n / a + 0.1 * s * (b - b2) + Usr + dUsr * n / a; }
  return Aff + dAff * n / a + Usr + dUsr * n / a;                       // zone D
}
// ---- A.16 / A.18 (between) and A.17 / A.19 (beyond), normal values in m
function A16(a, n, p) { var v = (a * n - n * n + p * p / 4) / 1000 - 0.08; return v > 0 ? v : 0; }
function A17(a, n, p) { var v = (a * n + n * n - p * p / 4) / 1000 - 0.08; return v > 0 ? v : 0; }

tests.push({ name: 'Table A.1 zones A–D: engine equals the literal table (20 000 random parts)', fn: function () {
  var r = rnd(4711), worst = 0, k, zones = ['A', 'B', 'C', 'D'];
  for (k = 0; k < 20000; k++) {
    var zone = zones[k % 4], o = { Aff: 20 + 100 * r(), dAff: 10 * r(), s: 0.5 * r(), b: 1600 * r(), b2: 700 + 400 * r(), Usr: 40 * r(), dUsr: 5 * r(), n: 6 * r(), a: 8 + 12 * r() };
    var got = E.enTableA1(zone, o).total, lit = tableA1(zone, o.Aff, o.dAff, o.s, o.b, o.b2, o.Usr, o.dUsr, o.n, o.a);
    worst = Math.max(worst, Math.abs(got - lit));
  }
  assert.ok(worst < 1e-9, 'largest difference ' + worst);
  return 'largest difference ' + worst.toExponential(1) + ' mm';
} });

tests.push({ name: 'Gradient transitions A.16–A.19: engine equals the literal formulae; hand value of a 19 m coach', fn: function () {
  var r = rnd(99), worst = 0, k;
  for (k = 0; k < 20000; k++) {
    var a = 5 + 20 * r(), n = 8 * r(), p = 1.5 + 2 * r();
    worst = Math.max(worst, Math.abs(E.enGradient(a, p, n, false) - A16(a, n, p)), Math.abs(E.enGradient(a, p, n, true) - A17(a, n, p)));
  }
  assert.ok(worst < 1e-15, 'largest difference ' + worst);
  // a = 19 m, n = 9,5 m (mid-car), p = 2,5 m: (180,5 − 90,25 + 1,5625)/1000 − 0,08 = 0,0118125 m
  assert.ok(Math.abs(E.enGradient(19, 2.5, 9.5, false) - 0.0118125) < 1e-12);
  // a metro car of a = 14,8 m stays below the 80 mm already in the reference profile
  assert.strictEqual(E.enGradient(14.8, 2.3, 7.4, false), 0);
  return 'largest difference ' + worst.toExponential(1) + ' m; 19 m coach mid-car 11,81 mm';
} });

tests.push({ name: 'Sample DMC lower parts: zones, Table A.1 displacement, limits and margins by hand', fn: function () {
  var p = sample(), v = E.staticRun(p, opts(p)).cars[0].en.vertical;
  assert.strictEqual(v.src, 'table');
  assert.strictEqual(v.Aff, 38 + 50);                      // dp + dsd (deflated)
  assert.strictEqual(v.Usr, 20);                           // min((860 − 780)/2, 20)
  var a = 21.6 - 2 * 3.4, defl = v.lower[0], box = v.lower[1], guard = v.lower[2];
  // obstacle deflector: beyond, n = overhang 3,4 m, b = 700 ≤ b2 = 950 → zone D
  assert.strictEqual(defl.zone, 'D');
  var dD = 88 + 6 * 3.4 / a + 20 + 2 * 3.4 / a;
  assert.ok(Math.abs(defl.disp - dD) < 1e-9 && Math.abs(defl.margin - (240 - dD - 100)) < 1e-9, JSON.stringify(defl));
  // underframe box: between, b = 1300 > 950 → zone B with s = 0
  assert.strictEqual(box.zone, 'B'); assert.strictEqual(box.margin, 330 - 108 - 100);
  // bogie life guard: primary + wheel wear, own limit 80 mm, gradient over p = 2,3 m is 0
  assert.strictEqual(guard.zone, 'bogie'); assert.strictEqual(guard.grad, 0); assert.strictEqual(guard.margin, 140 - 38 - 20 - 80);
  assert.ok(v.ok);
  return 'deflector margin ' + defl.margin.toFixed(2) + ' mm (zone D), box ' + box.margin + ' mm (zone B), life guard ' + guard.margin + ' mm';
} });

tests.push({ name: 'Car without lower-part rows uses the car body inputs; zone B roll term with s', fn: function () {
  var p = sample(); p.bodies[1].en_s_v = 0.4;              // TC
  var v = E.staticRun(p, opts(p)).cars[1].en.vertical, body = v.lower[0];
  assert.strictEqual(v.src, 'body'); assert.strictEqual(v.lower.length, 2);
  assert.strictEqual(body.zone, 'B');                      // yu = 1200 > b2 = 950
  assert.ok(Math.abs(body.susp - (88 + 0.1 * 0.4 * (1200 - 950))) < 1e-9, body.susp);
  return 'TC body part suspension ' + body.susp.toFixed(1) + ' mm';
} });

tests.push({ name: 'Maximum height: 10 mm per suspension level and A.18 on a long car; failures enter the verdict', fn: function () {
  var p = sample(); p.train.carTypes[0].length_m = 30;      // a = 23,2 m, ni = 11,6 m
  var c = E.staticRun(p, opts(p)).cars[0], up = c.en.vertical.upper[0];
  var g = A16(23.2, 11.6, 2.3) * 1000;
  assert.ok(g > 0);
  assert.ok(Math.abs(up.value - (3780 + 20 + g)) < 1e-9, JSON.stringify(up));
  assert.ok(Math.abs(up.margin - (3930 - 3780 - 20 - g)) < 1e-9);
  p = sample(); p.lowerParts[0].hlim_mm = 200;              // deflector now below its limit
  var r = E.staticRun(p, opts(p)), d = r.cars[0];
  assert.ok(!d.en.vertical.ok && !d.en.ok && !d.ok && !r.ok);
  return 'interior gradient ' + g.toFixed(2) + ' mm, margin ' + up.margin.toFixed(2) + ' mm';
} });

tests.push({ name: 'Lower-part rows: validation of car type and height; export / import sheet EN_Lower_Parts', fn: function () {
  var p = sample(); p.lowerParts.push({ car: 'XX', name: 'Bad', mount: 'body', pos: 'between', n_m: null, y_mm: 0, h_mm: null, hlim_mm: null, note: '' });
  var msgs = M.validate(p).messages.filter(function (m) { return m.tab === 'bogie' && m.level === 'err'; }).map(function (m) { return m.text; });
  assert.ok(msgs.some(function (t) { return /car type "XX"/.test(t); }), msgs.join(' | '));
  assert.ok(msgs.some(function (t) { return /Height above rail .* is missing/.test(t); }), msgs.join(' | '));
  return msgs.length + ' errors';
} });

module.exports = tests;
