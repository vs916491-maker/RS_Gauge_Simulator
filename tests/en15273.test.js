'use strict';
// EN 15273-2:2009 kinematic reductions (METHOD §10). The formulae of the standard are typed in below LITERALLY
// (G1 numbers, the "when … ≤ 5 | 7,5" conditions, w constant with the radius) and compared with the engine,
// which uses the general form with the rules as parameters. All vehicles are random / fictional.
var assert = require('assert');
var E = require('../js/engine.js'), M = require('../js/model.js');
var SAMPLE = require('../samples/sample-project.json');
var tests = [];

function pos(v) { return v > 0 ? v : 0; }
// A.24 with the special cases of A.3.8.1.1 (s/30, s/10, 0,04, 0,5 m, 1°)
function zLit(h, s, hc, eta) {
  var deg = Math.PI / 180;
  if (eta <= 1 * deg && h < 0.5) { return 0; }
  if (eta <= 1 * deg && s <= 0.4) { return s / 30 * pos(h - hc); }
  return s / 30 * pos(h - hc) + Math.tan(pos(eta - 1 * deg)) * Math.abs(h - hc) + pos(s / 10 * pos(h - hc) - 0.04 * pos(h - 0.5));
}
// Traction units, A.3.9.1.1: A.27–A.29 (between), A.30–A.32 (beyond)
function tractionLit(side, low, n, a, p, d, q, w, z) {
  var T = low ? 5 : 7.5, c = low ? 0.025 : 0.030;
  if (side === 'i') {
    var Di = a * n - n * n + p * p / 4;
    if (Di <= T) { return (1.465 - d) / 2 + q + w + z - 0.015; }
    return Di / 500 + (1.465 - d) / 2 + q + w + z + pos((Di - 100) / 750) - c;
  }
  var Da = a * n + n * n - p * p / 4, A = (2 * n + a) / a;
  if (Da <= T) { return ((1.465 - d) / 2 + q + w) * A + z - 0.015; }
  return Da / 500 + ((1.465 - d) / 2 + q) * A + w * n / a + w * (n + a) / a + z + pos((Da - 120) / 750) - c;
}
// Coaches, A.3.9.3.1: A.46–A.48 (between), A.49–A.51 (beyond)
function coachLit(side, low, n, a, p, d, q, w, z) {
  if (side === 'i') {
    var Di = a * n - n * n + p * p / 4;
    if (Di <= 250 * (1.465 - d) - (low ? 2.5 : 0)) { return (1.465 - d) / 2 + q + w + z - 0.015; }
    return Di / 500 + q + w + z + pos((Di - 100) / 750) - (low ? 0.010 : 0.015);
  }
  var Da = a * n + n * n - p * p / 4;
  if (Da <= 250 * (1.465 - d) * n / a + (low ? 5 : 7.5)) { return ((1.465 - d) / 2 + q + w) * (2 * n + a) / a + z - 0.015; }
  return Da / 500 + (1.465 - d) / 2 * (n + a) / a + q * (2 * n + a) / a + w * (2 * n + a) / a + w * 0 + z + pos((Da - 120) / 750) - (low ? 0.025 : 0.030);
}

var G1 = E.enRules({ ke: { en: {} } });
function rnd(seed) { var x = seed; return function () { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }

tests.push({ name: 'EN 15273-2 – default rules are the G1 values', fn: function () {
  var r = E.enRules(M.normalizeProject({}));
  assert.deepStrictEqual([r.lmax, r.e0, r.R1, r.R2, r.Ck_low, r.Ck_up, r.Xi, r.Xa, r.h_low, r.s0, r.hc0, r.I0, r.D0, r.Dlim, r.Lref],
    [1.465, 0.015, 250, 150, 2.5, 3.75, 100, 120, 0.4, 0.4, 0.5, 0.05, 0.05, 0.2, 1.5]);
  assert.ok(Math.abs(r.eta_lim - Math.PI / 180) < 1e-15);
  return 'G1';
} });

tests.push({ name: 'EN 15273-2 – z_kin equals A.24 and its special cases', fn: function () {
  var R = rnd(7), worst = 0, k;
  for (k = 0; k < 20000; k++) {
    var h = R() * 4.5, s = R() * 0.6, hc = 0.2 + R() * 1.2, eta = (R() < 0.6 ? 0 : R() * 3) * Math.PI / 180;
    var a = E.enZ(G1, h, s, hc, G1.I0, eta), b = zLit(h, s, hc, eta);
    worst = Math.max(worst, Math.abs(a - b));
  }
  assert.ok(worst < 1e-12, 'max difference ' + worst);
  return 'max diff ' + worst.toExponential(1) + ' m';
} });

tests.push({ name: 'EN 15273-2 – Ei / Ea equal A.27–A.31 (traction) and A.46–A.50 (coach) for G1', fn: function () {
  var R = rnd(11), worst = 0, k, cnt = { straight: 0, curve: 0 };
  for (k = 0; k < 40000; k++) {
    var a = 5 + R() * 15, p = 1.6 + R() * 1.4, d = 1.405 + R() * 0.03, q = R() * 0.01, w = R() * 0.06;
    var side = R() < 0.5 ? 'i' : 'a', n = side === 'i' ? R() * a : R() * 5, low = R() < 0.3, h = low ? R() * 0.4 : 0.41 + R() * 4;
    var z = zLit(h, R() * 0.5, 0.3 + R(), 0);
    ['traction', 'coach'].forEach(function (set) {
      var eng = E.enReduction(G1, set, side, h, n, a, p, d, q, w, z), lit = (set === 'traction' ? tractionLit : coachLit)(side, low, n, a, p, d, q, w, z);
      worst = Math.max(worst, Math.abs(eng.E - lit)); cnt[eng.branch]++;
    });
  }
  assert.ok(worst < 1e-12, 'max difference ' + worst);
  assert.ok(cnt.straight > 1000 && cnt.curve > 1000, 'both branches exercised');
  return 'max diff ' + worst.toExponential(1) + ' m (' + cnt.straight + ' straight, ' + cnt.curve + ' curve)';
} });

tests.push({ name: 'EN 15273-2 – hand check, coach mid-car at 3 m', fn: function () {
  // a = 15 m, n = 7,5 m, p = 2,5 m, d = 1,410 m, q = 5 mm, w = 30 mm, s = 0,3 ≤ s0, hc = 0,6 m, η0 = 0
  // z = 0,3/30 × 2,4 = 0,024; Δ = 112,5 − 56,25 + 1,5625 = 57,8125; 250 × 0,055 = 13,75 → curve branch
  // E = 57,8125/500 + 0,005 + 0,030 + 0,024 + 0 − 0,015 = 0,159625 m (x = (57,8125 − 100)/750 < 0)
  var z = E.enZ(G1, 3, 0.3, 0.6, G1.I0, 0), e = E.enReduction(G1, 'coach', 'i', 3, 7.5, 15, 2.5, 1.410, 0.005, 0.030, z);
  assert.ok(Math.abs(z - 0.024) < 1e-12); assert.strictEqual(e.branch, 'curve');
  assert.ok(Math.abs(e.E - 0.159625) < 1e-12, e.E);
  return 'E = ' + (e.E * 1000).toFixed(3) + ' mm';
} });

tests.push({ name: 'EN 15273-2 – static run on the sample project', fn: function () {
  var p = M.normalizeProject(JSON.parse(JSON.stringify(SAMPLE)));
  p.settings['static'].en_check = 'yes';
  var r = E.staticRun(p, p.settings['static']);
  assert.ok(r.en && r.en.governing, 'EN summary');
  r.cars.forEach(function (c) {
    assert.ok(c.en && c.en.rows.length === c.methodA.length, c.car + ' grid');
    assert.ok(c.en.set === (c.derived.bogie.b1.motor === 'yes' || c.derived.bogie.b2.motor === 'yes' ? 'traction' : 'coach'), c.car + ' formula set');
    ['int', 'ext', 'end'].forEach(function (sec) { assert.ok(c.en.checks[sec].points.length > 0, c.car + ' ' + sec + ' points'); });
  });
  p.settings['static'].en_check = 'no';
  assert.strictEqual(E.staticRun(p, p.settings['static']).en, null);
  return r.en.governing.car + ' ' + r.en.governing.section + ' ' + r.en.governing.margin.toFixed(1) + ' mm';
} });

module.exports = tests;
