'use strict';
// EN 15273-2:2009 A.3.14 open doors / deployed steps and A.3.15.2 step position (METHOD §10.10). The allowances A.105 /
// A.106 and the rules a) / b) typed in LITERALLY with the G1 numbers; then hand checks on the fictional sample.
var assert = require('assert');
var E = require('../js/engine.js');
var M = require('../js/model.js');
var tests = [];
var G1 = E.enRules({ ke: { en: {} } });
function rnd(seed) { var x = seed; return function () { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }
function sample() { return M.normalizeProject(JSON.parse(JSON.stringify(require('../samples/sample-project.json')))); }

function literal(kind, pos, h, n, a, wi, wa) {
  if (kind === 'door' && h >= 1.05) { return 0.2; }                                      // a)
  if (pos === 'between') { return Math.min(wi, 0.035); }                                 // b) between / steps between
  if (kind === 'door') { return wi * n / a + Math.max(wa - 0.02, 0) * (n + a) / a; }      // A.105
  return wi * n / a + wa * (n + a) / a;                                                  // A.106
}

tests.push({ name: 'A.3.14 allowances: engine equals rules a), b), A.105 and A.106 (20 000 random cases)', fn: function () {
  var r = rnd(314), worst = 0, k, kinds = ['door', 'step'], poss = ['between', 'beyond'];
  for (k = 0; k < 20000; k++) {
    var kind = kinds[k % 2], pos = poss[(k >> 1) % 2], h = 0.5 + 2.5 * r(), a = 8 + 12 * r(), n = 4 * r(), wi = 0.06 * r(), wa = 0.06 * r();
    worst = Math.max(worst, Math.abs(E.enDoorAllowance(G1, kind, pos, h, n, a, wi, wa).v - literal(kind, pos, h, n, a, wi, wa)));
  }
  assert.ok(worst < 1e-15, 'largest difference ' + worst);
  assert.strictEqual(E.enDoorAllowance(G1, 'door', 'beyond', 1.0, 3, 15, 0.03, 0.015).v, 0.03 * 3 / 15);   // (w_a − X) < 0 → 0
  return 'largest difference ' + worst.toExponential(1) + ' m';
} });

tests.push({ name: 'Sample doors and step by hand: lowering, rule switch at 1,05 m, governing height', fn: function () {
  var p = sample(), r = E.staticRun(p, p.settings['static']), dmc = r.cars[0], rows = dmc.en.doors.rows;
  var drop = dmc.derived.dn_total;
  assert.strictEqual(rows.length, 2);
  var door = rows[0];
  assert.ok(Math.abs(door.lo - (1110 - drop)) < 1e-9 && Math.abs(door.hi - (3000 - drop)) < 1e-9);
  var below = door.points.filter(function (x) { return x.h < 1050; }), above = door.points.filter(function (x) { return x.h >= 1050 - 1e-9; });
  assert.ok(below.length && above.length);
  assert.ok(below.every(function (x) { return x.rule === 'b) between' && Math.abs(x.extra - 30) < 1e-9; }), 'w = 30 mm < 35 mm');
  assert.ok(above.every(function (x) { return x.rule.indexOf('a)') === 0 && Math.abs(x.extra - 200) < 1e-9; }));
  door.points.forEach(function (x) { assert.ok(Math.abs(x.allowed - (x.W - x.E + x.extra)) < 1e-9 && Math.abs(x.margin - (x.allowed - 1530)) < 1e-9); });
  // cab door beyond, n = overhang 3,4 m, a = 14,8 m: A.105 with w = 30 mm both bogies, X = 20 mm
  var cab = rows[1], bx = cab.points.filter(function (x) { return x.h < 1050; })[0];
  assert.ok(Math.abs(bx.extra - (30 * 3.4 / 14.8 + 10 * 18.2 / 14.8)) < 1e-9, bx.extra);
  assert.ok(dmc.en.doors.ok);
  return 'saloon door margin ' + door.min.margin.toFixed(2) + ' mm at h ' + door.min.h.toFixed(0) + ', cab door ' + cab.min.margin.toFixed(2) + ' mm';
} });

tests.push({ name: 'A.3.15.2 step position: platform gaps by hand; too large a gap fails', fn: function () {
  var p = sample(), r = E.staticRun(p, p.settings['static']), step = r.cars[1].en.doors.rows[0];
  // TC: a = 21 − 6,4 = 14,6 m, n = 3 m, p = 2,3 m, R = 1000 m: dg = (43,8 − 9 + 1,3225)/2000 m
  var dg = (14.6 * 3 - 9 + 2.3 * 2.3 / 4) / 2000 * 1000, ins = step.gap[0], out = step.gap[1];
  assert.ok(Math.abs(ins.dg - dg) < 1e-9 && ins.toward && !out.toward);
  assert.ok(Math.abs(ins.gapMax - 40) < 1e-9, 'inside: largest on straight track');
  assert.ok(Math.abs(out.gapMax - (40 + dg)) < 1e-9 && Math.abs(out.dgmax - (1520 + 75 - 1560)) < 1e-9, 'outside: the standard dg_imax');
  assert.ok(step.ok);
  p.ke.en.gap_R_m = 300;
  step = E.staticRun(p, p.settings['static']).cars[1].en.doors.rows[0];
  assert.ok(!step.ok && !step.gap[1].ok && step.gap[0].ok);
  return 'dg ' + dg.toFixed(2) + ' mm; outside gap ' + (40 + dg).toFixed(1) + ' mm ≤ 75 mm';
} });

module.exports = tests;
