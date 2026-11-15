'use strict';
// EN 15273-2:2009 A.3.11 bogie parts (METHOD §10.8): the independent-axle formulae A.56–A.59 (w = 0) typed in
// LITERALLY with the G1 numbers, compared with the engine; then hand checks on the fictional sample.
var assert = require('assert');
var E = require('../js/engine.js');
var M = require('../js/model.js');
var tests = [];
var G1 = E.enRules({ ke: { en: {} } });
function rnd(seed) { var x = seed; return function () { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }
function sample() { return M.normalizeProject(JSON.parse(JSON.stringify(require('../samples/sample-project.json')))); }
function opts(p) { var o = JSON.parse(JSON.stringify(p.settings['static'])); o.en_check = 'yes'; return o; }

// A.56 / A.57 sections between the end axles; A.58 / A.59 beyond (low = lower parts: 5 and 0,025; upper: 7,5 and 0,030)
function A5657(low, n, a, d, q, z) {
  if (a * n - n * n <= (low ? 5 : 7.5)) { return (1.465 - d) / 2 + q + z - 0.015; }
  return (a * n - n * n) / 500 + (1.465 - d) / 2 + q + z - (low ? 0.025 : 0.030);
}
function A5859(low, n, a, d, q, z) {
  if (a * n + n * n <= (low ? 5 : 7.5)) { return ((1.465 - d) / 2 + q) * (2 * n + a) / a + z - 0.015; }
  return (a * n + n * n) / 500 + ((1.465 - d) / 2 + q) * (2 * n + a) / a + z - (low ? 0.025 : 0.030);
}

tests.push({ name: 'A.56–A.59: engine equals the literal formulae (40 000 random bogie parts, both branches)', fn: function () {
  var r = rnd(2026), worst = 0, k, curve = 0;
  for (k = 0; k < 40000; k++) {
    // a up to 12 m so that the curve branches are reached too (two-axle vehicles); bogies have a ≈ 2–3 m
    var low = k % 2 === 0, side = k % 4 < 2 ? 'i' : 'a', a = 1.8 + 10 * r(), n = (side === 'i' ? a : 4) * r(), d = 1.40 + 0.03 * r(), q = 0.012 * r(), z = 0.02 * r();
    var e = E.enBogieE(G1, { side: side, low: low, n: n, a: a, d: d, q: q, z: z });
    var lit = side === 'i' ? A5657(low, n, a, d, q, z) : A5859(low, n, a, d, q, z);
    if (e.branch === 'curve') { curve++; }
    worst = Math.max(worst, Math.abs(e.E - lit));
  }
  assert.ok(worst < 1e-12, 'largest difference ' + worst);
  assert.ok(curve > 5000 && curve < 35000, 'both branches reached: ' + curve);
  return 'largest difference ' + worst.toExponential(1) + ' m, ' + curve + ' on the curve branch';
} });

tests.push({ name: 'Sample bogie parts by hand: brake unit (between), life-guard bracket (beyond), sander (axle)', fn: function () {
  var p = sample(), bp = E.staticRun(p, opts(p)).en.bogieParts, rows = bp.rows;
  assert.strictEqual(rows.length, 3);
  var P = (1.465 - 1.412) / 2, q = 0.005;
  // brake unit, h 420 → frame moves 362…435 mm; KE edge K9 (1500, 350) – K8 (1630, 1000): x at 362 = 1502,4 mm
  assert.ok(Math.abs(rows[0].E - (P + q - 0.015) * 1000) < 1e-9 && rows[0].z === 0 && rows[0].branch === 'straight');
  assert.ok(Math.abs(rows[0].W - 1502.4) < 1e-9 && Math.abs(rows[0].margin - (1502.4 - 16.5 - 1350)) < 1e-9, JSON.stringify(rows[0]));
  // life-guard bracket beyond the end axle, n = 0,4: A = (0,8 + 2,3)/2,3; KE notch at 272…345 mm is 1390
  var A = 3.1 / 2.3;
  assert.ok(Math.abs(rows[1].E - ((P + q) * A - 0.015) * 1000) < 1e-9 && rows[1].W === 1390, JSON.stringify(rows[1]));
  // sander on the axlebox: unsprung, only wheel wear lowers it (90 → 70 mm)
  assert.ok(rows[2].z === 0 && Math.abs(rows[2].h_lo - 70) < 1e-9 && rows[2].h_hi === 90);
  assert.ok(bp.ok);
  return 'margins ' + rows.map(function (x) { return x.margin.toFixed(2); }).join(' / ') + ' mm';
} });

tests.push({ name: 'Frame roll z (A.24 special case s ≤ s0) above hc0; failure enters the verdicts', fn: function () {
  var p = sample(); p.bogieParts[0].h_mm = 800;            // M bogie: s = 0,05, hc = 0,4 m
  var row = E.staticRun(p, opts(p)).en.bogieParts.rows[0];
  assert.ok(Math.abs(row.z - 0.05 * 0.05 / 1.5 * (0.8 - 0.4) * 1000) < 1e-9, row.z);
  p = sample(); p.bogieParts[1].y_mm = 1380;               // bracket now outside the KE notch
  var r = E.staticRun(p, opts(p));
  assert.ok(!r.en.bogieParts.ok && !r.en.ok && !r.ok);
  p.settings['static'].en_check = 'no';
  assert.strictEqual(E.staticRun(p, p.settings['static']).en, null);
  return 'z at 800 mm = ' + row.z.toFixed(3) + ' mm';
} });

tests.push({ name: 'Bogie-part rows: unknown bogie type is an error', fn: function () {
  var p = sample(); p.bogieParts.push({ bogie: 'Z', name: 'X', mount: 'frame', pos: 'between', n_m: null, y_mm: 100, h_mm: 100, note: '' });
  var msgs = M.validate(p).messages.filter(function (m) { return m.tab === 'bogie' && m.level === 'err'; });
  assert.ok(msgs.some(function (m) { return /bogie type "Z"/.test(m.text); }));
  return msgs.length + ' error';
} });

module.exports = tests;
