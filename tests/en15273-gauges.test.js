'use strict';
// EN 15273-2:2009 other reference gauges (METHOD §10.12): GA / GB height law (B.1–B.10, B.21–B.26, Tables B.1–B.3) and
// the DE2 roll band (L.2.2) typed in LITERALLY with the printed numbers, compared with the engine's general form.
var assert = require('assert');
var E = require('../js/engine.js');
var S = require('../js/schema.js');
var M = require('../js/model.js');
var tests = [];
function rnd(seed) { var x = seed; return function () { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }
function pos(v) { return v > 0 ? v : 0; }
function rulesOf(g) { var en = S.enGaugeValues(g); en.en_gauge = g; return E.enRules({ ke: { en: en } }); }
function kGA(h) { return h >= 3.88 ? 1 : (h - 3.25) / 0.63; }          // Table B.2 / B.3, gauge GA
function kGBs(h) { return h >= 4.08 ? 1 : (h - 3.22) / 0.86; }         // Table B.1, gauge GB (static)

// ---- B.5 / B.6 traction units, between, w constant or linear (k from Table B.2)
function B5_6(n, a, p, d, q, z, winf, w250, w150, k) {
  var D = a * n - n * n + p * p / 4;
  if (D - 500 * (winf - w250) <= 7.5 + 32.5 * k) { return (1.465 - d) / 2 + q + winf + z - 0.015; }
  var x = (D - 100) / 750 + w150 - w250;
  return D / 500 + (1.465 - d) / 2 + q + w250 + z + pos(x) - 0.030 - 0.065 * k;
}
// ---- B.8 / B.9 / B.10 traction units, beyond
function B8_10(n, a, p, d, q, z, winf, wi250, wi150, wa250, wa150, k) {
  var D = a * n + n * n - p * p / 4;
  if (D - 500 * ((winf - wi250) * n / a + (winf - wa250) * (n + a) / a) <= 7.5 + 32.5 * k) { return ((1.465 - d) / 2 + q) * (2 * n + a) / a + winf * n / a + winf * (n + a) / a + z - 0.015; }
  var x = (D - (120 - 20 * k)) / 750 + (wi150 - wi250) * n / a + (wa150 - wa250) * (n + a) / a;
  return D / 500 + ((1.465 - d) / 2 + q) * (2 * n + a) / a + wi250 * n / a + wa250 * (n + a) / a + z + pos(x) - 0.030 - 0.065 * k;
}
// ---- B.21 / B.22 coaches, between
function B21_22(n, a, p, d, q, z, winf, w250, w150, k) {
  var D = a * n - n * n + p * p / 4;
  if (D - 500 * (winf - w250) <= 250 * (1.465 - d) + 32.5 * k) { return (1.465 - d) / 2 + q + winf + z - 0.015; }
  var x = (D - 100) / 750 + w150 - w250;
  return D / 500 + q + w250 + z + pos(x) - 0.015 - 0.065 * k;
}
// ---- B.24 / B.25 / B.26 coaches, beyond
function B24_26(n, a, p, d, q, z, winf, wi250, wi150, wa250, wa150, k) {
  var D = a * n + n * n - p * p / 4;
  if (D - 500 * ((winf - wi250) * n / a + (winf - wa250) * (n + a) / a) <= 250 * (1.465 - d) * n / a + (7.5 + 32.5 * k)) {
    return ((1.465 - d) / 2 + q) * (2 * n + a) / a + winf * n / a + winf * (n + a) / a + z - 0.015;
  }
  var x = (D - (120 - 20 * k)) / 750 + (wi150 - wi250) * n / a + (wa150 - wa250) * (n + a) / a;
  return D / 500 + (1.465 - d) / 2 * (n + a) / a + q * (2 * n + a) / a + wi250 * n / a + wa250 * (n + a) / a + z + pos(x) - 0.030 - 0.065 * k;
}
// ---- z_kin of Table B.2 (η0 ≤ 1°), for s above the reference s0 = 0,4 − 0,1k
function zB2(s, h, hc, k) { return s / 30 * pos(h - hc) + pos(s / 10 * pos(h - hc) - (0.04 - 0.01 * k) * pos(h - 0.5)); }

tests.push({ name: 'GA kinematic above 3,25 m: engine equals B.5–B.10, B.21–B.26 and Table B.2 (40 000 random vehicles)', fn: function () {
  var r0 = rulesOf('GA'), rnd1 = rnd(2009), worst = 0, k, curve = 0;
  for (k = 0; k < 40000; k++) {
    var set = k % 2 ? 'coach' : 'traction', side = (k >> 1) % 2 ? 'a' : 'i', h = 3.3 + 1.2 * rnd1(), kk = kGA(h);
    var a = 8 + 16 * rnd1(), n = (side === 'i' ? a : 5) * rnd1(), p = 1.8 + 1.2 * rnd1(), d = 1.40 + 0.03 * rnd1(), q = 0.01 * rnd1();
    var winf = 0.05 * rnd1(), w250 = winf + 0.02 * rnd1(), w150 = w250 + 0.02 * rnd1(), wa250 = winf + 0.02 * rnd1(), wa150 = wa250 + 0.02 * rnd1();
    var s = 0.4 + 0.3 * rnd1(), hc = 0.3 + 0.6 * rnd1(), r = E.enRulesAt(r0, h, false);
    var z = E.enZ(r, h, s, hc, r.I0, 0);
    if (Math.abs(z - zB2(s, h, hc, kk)) > 1e-12) { throw new Error('z differs at h ' + h + ': ' + z + ' / ' + zB2(s, h, hc, kk)); }
    var o = { set: set, side: side, low: false, n: n, a: a, d: d, q: q, z: z, near: { p: p, winf: winf, w250: side === 'i' ? w250 : wa250, w150: side === 'i' ? w150 : wa150 }, far: { p: p, winf: winf, w250: w250, w150: w150 } };
    var e = E.enE(r, o), lit;
    if (set === 'traction') { lit = side === 'i' ? B5_6(n, a, p, d, q, z, winf, w250, w150, kk) : B8_10(n, a, p, d, q, z, winf, w250, w150, wa250, wa150, kk); }
    else { lit = side === 'i' ? B21_22(n, a, p, d, q, z, winf, w250, w150, kk) : B24_26(n, a, p, d, q, z, winf, w250, w150, wa250, wa150, kk); }
    if (e.branch === 'curve') { curve++; }
    worst = Math.max(worst, Math.abs(e.E - lit));
  }
  assert.ok(worst < 1e-12, 'largest difference ' + worst);
  assert.ok(curve > 4000 && curve < 36000, curve);
  return 'largest difference ' + worst.toExponential(1) + ' m, ' + curve + ' on the curve branch';
} });

tests.push({ name: 'GB static above 3,22 m: engine equals B.1–B.4 with Table B.1; below 3,22 m the G1 static formulae', fn: function () {
  var r0 = rulesOf('GB'), rnd1 = rnd(81), worst = 0, k;
  function B1(n, a, p, d, q, w, kk) { var v = a * n - n * n + p * p / 4, D = v <= 7.5 + 32.5 * kk ? 7.5 + 32.5 * kk : v; return pos(D / 500 + (1.465 - d) / 2 + q + w + pos((v - 100) / 750) - 0.075 - 0.065 * kk); }
  function B3(n, a, p, d, q, w, kk) { var v = a * n + n * n - p * p / 4, D = v <= 7.5 + 32.5 * kk ? 7.5 + 32.5 * kk : v; return pos(D / 500 + ((1.465 - d) / 2 + q + w) * (2 * n + a) / a + pos((v - 100) / 750) - 0.075 - 0.065 * kk); }
  for (k = 0; k < 20000; k++) {
    var side = k % 2 ? 'a' : 'i', h = 3.23 + 1.2 * rnd1(), kk = kGBs(h), a = 5 + 20 * rnd1(), n = (side === 'i' ? a : 6) * rnd1(), p = 1.8 + 1.5 * rnd1(), d = 1.40 + 0.03 * rnd1(), q = 0.01 * rnd1(), w = 0.05 * rnd1();
    var e = E.enStaticE(E.enStaticRulesAt(r0, h), { side: side, n: n, a: a, p: p, d: d, q: q, w: w });
    worst = Math.max(worst, Math.abs(e.E - (side === 'i' ? B1(n, a, p, d, q, w, kk) : B3(n, a, p, d, q, w, kk))));
  }
  assert.ok(worst < 1e-12, 'largest difference ' + worst);
  var below = E.enStaticRulesAt(r0, 3.0), g1 = E.enRules({ ke: { en: {} } });
  assert.ok(below.st_Dmin === g1.st_Dmin && below.st_allow === g1.st_allow && below.Xa === g1.Xa && r0.st_smax === 0.3);
  return 'largest difference ' + worst.toExponential(1) + ' m';
} });

tests.push({ name: 'Height-law spans of GA, GB, GB1, GB2; motor coaches keep A.3.9.2 as it is; G2, GC, DE3 = G1', fn: function () {
  [['GA', 3.88], ['GB', 4.11], ['GB1', 4.21], ['GB2', 4.35]].forEach(function (x) {
    var r = rulesOf(x[0]);
    assert.ok(Math.abs(E.enRulesAt(r, x[1], false).k - 1) < 1e-9 && E.enRulesAt(r, 3.25, false).k === 0, x[0]);
    assert.strictEqual(E.enRulesAt(r, 4.5, true).k, 0);
  });
  var g1 = E.enRules({ ke: { en: {} } });
  ['G2', 'GC', 'DE3'].forEach(function (g) { var r = rulesOf(g); assert.ok(r.Ck_up === g1.Ck_up && r.s0 === g1.s0 && r.kin_span === 0 && r.zb_from === null, g); });
  return 'ok';
} });

tests.push({ name: 'DE2 roll band 3,765–4,335 m: engine equals the printed Δz_kin added to the base term', fn: function () {
  var r0 = rulesOf('DE2'), rnd1 = rnd(42), worst = 0, k;
  for (k = 0; k < 20000; k++) {
    var h = 3.765 + 0.57 * rnd1(), s = 0.19 + 0.3 * rnd1(), hc = 0.3 + 0.6 * rnd1(), r = E.enRulesAt(r0, h, false);
    var lit = s * 0.05 / 1.5 * pos(h - hc) + pos(s / 1.5 * (0.150 - 0.05 + 0.015 + 0.039) * (h - hc) - 0.19 / 1.5 * (0.150 - 0.05 + 0.015 + 0.039) * (h - 0.695));
    worst = Math.max(worst, Math.abs(E.enZ(r, h, s, hc, r.D0, 0) - lit));
  }
  assert.ok(worst < 1e-12, 'largest difference ' + worst);
  assert.ok(!E.enRulesAt(r0, 3.5, false).zband && E.enRulesAt(r0, 4.0, false).zband);
  return 'largest difference ' + worst.toExponential(1) + ' m';
} });

tests.push({ name: 'Gauge choice on the sample: rules loaded, results change only above the height-law start; warnings', fn: function () {
  var p = M.normalizeProject(JSON.parse(JSON.stringify(require('../samples/sample-project.json'))));
  var base = E.staticRun(p, p.settings['static']).cars[0].en;
  var v = S.enGaugeValues('GA'); Object.keys(v).forEach(function (k) { p.ke.en[k] = v[k]; }); p.ke.en.en_gauge = 'GA';
  var ga = E.staticRun(p, p.settings['static']).cars[0].en;
  assert.strictEqual(ga.gauge, 'GA');
  ga.rows.forEach(function (x, i) { if (x.h <= 3250) { assert.ok(Math.abs(x.E_int - base.rows[i].E_int) < 1e-9, 'h ' + x.h); } });
  assert.ok(ga.rows.some(function (x, i) { return x.h > 3300 && x.E_int !== base.rows[i].E_int; }));
  p.ke.en.Ck_up_m2 = 4;
  assert.ok(M.validate(p).messages.some(function (m) { return m.level === 'warn' && /differ from the rules of gauge GA/.test(m.text); }));
  v = S.enGaugeValues('DE1'); Object.keys(v).forEach(function (k) { p.ke.en[k] = v[k]; }); p.ke.en.en_gauge = 'DE1';
  assert.ok(E.staticRun(p, p.settings['static']).warnings.some(function (w) { return /DE1/.test(w); }));
  return 'ok';
} });

module.exports = tests;
