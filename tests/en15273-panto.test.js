'use strict';
// EN 15273-2:2009 A.3.12 pantograph gauge (METHOD §10.11): formulae A.66–A.85 typed in LITERALLY (each set written out
// as printed), compared with the engine; then a hand check on a fictional pantograph added to the sample.
var assert = require('assert');
var E = require('../js/engine.js');
var M = require('../js/model.js');
var tests = [];
function rnd(seed) { var x = seed; return function () { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }
function pos(v) { return v > 0 ? v : 0; }
function sq(v) { return v * v; }

// ---- between, s ≤ 0,225: A.66–A.70
function A66_70(o) {
  var j = o.q + o.wi - 0.0375;
  var z1 = 0.066 * (6.5 - o.hc) / 1.5 * o.s + Math.sqrt(sq(o.t) + sq(o.tau) + sq(o.theta * (6.5 - o.hc))) - 0.1175;
  var z2 = 0.066 * (5 - o.hc) / 1.5 * o.s + Math.sqrt(sq(o.t * (5 - o.ht) / (6.5 - o.ht)) + sq(o.tau) + sq(o.theta * (5 - o.hc))) - 0.0925;
  var g = o.R === Infinity ? 0 : pos((o.a * o.n - o.n * o.n + o.p * o.p / 4 - 5) / (2 * o.R));
  return [g + j + z1, g + j + z2];
}
// ---- between, s > 0,225: A.71–A.75
function A71_75(o) {
  var j = o.q + o.wi - 0.0375;
  var z1 = 0.2 * (6.5 - o.hc) / 1.5 * o.s + Math.sqrt(sq(o.t) + sq(o.tau) + sq(o.theta * (6.5 - o.hc))) - 0.2375;
  var z2 = 0.2 * (5 - o.hc) / 1.5 * o.s + Math.sqrt(sq(o.t * (5 - o.ht) / (6.5 - o.ht)) + sq(o.tau) + sq(o.theta * (5 - o.hc))) - 0.1825;
  var g = o.R === Infinity ? 0 : pos((o.a * o.n - o.n * o.n + o.p * o.p / 4 - 5) / (2 * o.R));
  return [g + j + z1, g + j + z2];
}
// ---- beyond, s ≤ 0,225: A.76–A.80
function A76_80(o) {
  var j = o.q * (2 * o.n + o.a) / o.a + o.wa * (o.n + o.a) / o.a + o.wi * o.n / o.a - 0.0375;
  var z1 = 0.066 * (6.5 - o.hc) / 1.5 * o.s + Math.sqrt(sq(o.t) + sq(o.tau) + sq(o.theta * (6.5 - o.hc))) - 0.1175;
  var z2 = 0.066 * (5 - o.hc) / 1.5 * o.s + Math.sqrt(sq(o.t * (5 - o.ht) / (6.5 - o.ht)) + sq(o.tau) + sq(o.theta * (5 - o.hc))) - 0.0925;
  var g = o.R === Infinity ? 0 : pos((o.a * o.n + o.n * o.n - o.p * o.p / 4 - 5) / (2 * o.R));
  var pl = (1.465 - o.d) / 2 * 2 * o.n / o.a;
  return [g + pl + j + z1, g + pl + j + z2];
}
// ---- beyond, s > 0,225: A.81–A.85
function A81_85(o) {
  var j = o.q * (2 * o.n + o.a) / o.a + o.wa * (o.n + o.a) / o.a + o.wi * o.n / o.a - 0.0375;
  var z1 = 0.2 * (6.5 - o.hc) / 1.5 * o.s + Math.sqrt(sq(o.t) + sq(o.tau) + sq(o.theta * (6.5 - o.hc))) - 0.2375;
  var z2 = 0.2 * (5 - o.hc) / 1.5 * o.s + Math.sqrt(sq(o.t * (5 - o.ht) / (6.5 - o.ht)) + sq(o.tau) + sq(o.theta * (5 - o.hc))) - 0.1825;
  var g = o.R === Infinity ? 0 : pos((o.a * o.n + o.n * o.n - o.p * o.p / 4 - 5) / (2 * o.R));
  var pl = (1.465 - o.d) / 2 * 2 * o.n / o.a;
  return [g + pl + j + z1, g + pl + j + z2];
}

tests.push({ name: 'A.66–A.85: engine equals the four printed formula sets (40 000 random pantographs, straight and curved)', fn: function () {
  var r = rnd(6585), worst = 0, k, counts = [0, 0, 0, 0];
  for (k = 0; k < 40000; k++) {
    var side = k % 2 ? 'a' : 'i', o = { side: side, a: 8 + 12 * r(), p: 1.8 + 1.2 * r(), d: 1.40 + 0.03 * r(), q: 0.01 * r(), wi: 0.06 * r(), wa: 0.06 * r(),
      R: k % 3 === 0 ? Infinity : 150 + 1000 * r(), s: 0.45 * r(), hc: 0.3 + 0.6 * r(), ht: 3.5 + 1 * r(), t: 0.05 * r(), theta: 0.005 * r(), tau: 0.02 * r() };
    o.n = (side === 'i' ? o.a : 4) * r();
    var e = E.enPantoP(o), set = (side === 'a' ? 2 : 0) + (o.s > 0.225 ? 1 : 0), lit = [A66_70, A71_75, A76_80, A81_85][set](o);
    counts[set]++;
    worst = Math.max(worst, Math.abs(e.Po - lit[0]), Math.abs(e.Pu - lit[1]));
  }
  assert.ok(worst < 1e-12, 'largest difference ' + worst);
  return 'largest difference ' + worst.toExponential(1) + ' m; cases per set ' + counts.join(' / ');
} });

tests.push({ name: 'w at R: straight, 250 m, 150 m and variable stops', fn: function () {
  var G1 = E.enRules({ ke: { en: {} } }), b = { winf: 0.03, w250: 0.04, w150: 0.05, Rv: 0, wv: 0.03 };
  assert.strictEqual(E.wAtR(G1, b, Infinity), 0.03);
  assert.ok(Math.abs(E.wAtR(G1, b, 250) - 0.04) < 1e-15 && Math.abs(E.wAtR(G1, b, 150) - 0.05) < 1e-15);
  assert.ok(Math.abs(E.wAtR(G1, b, 500) - 0.035) < 1e-15);
  b.Rv = 400; b.wv = 0.045;
  assert.strictEqual(E.wAtR(G1, b, 400), 0.045);
  return 'ok';
} });

tests.push({ name: 'Sample MC with a fictional pantograph near the bogie centre: hand check, cases, verdict', fn: function () {
  var raw = JSON.parse(JSON.stringify(require('../samples/sample-project.json')));
  raw.pantographs = [{ car: 'MC', name: 'Pantograph 1', pos: 'between', n_m: 0.3, ht_mm: 3900, t_mm: 30, theta_mrad: 2.5, tau_mm: 10, bw_mm: 800, h_low_mm: null, ins_mm: 0, note: '' }];
  var p = M.normalizeProject(raw), mc = E.staticRun(p, p.settings['static']).cars[2], pg = mc.en.pantographs.rows[0];
  assert.strictEqual(pg.cases.length, 2 * 2 * 1);                 // straight + 150 m, tare + crush, one bogie type (M/M)
  // straight track, tare (s 0,3 > 0,225, hc 0,55 m): j' = 0,005 + 0,030 − 0,0375
  var hc = 0.55, s = 0.3, j = 0.005 + 0.030 - 0.0375;
  var zo = 0.2 * (6.5 - hc) / 1.5 * s + Math.sqrt(sq(0.03) + sq(0.01) + sq(0.0025 * (6.5 - hc))) - 0.2375;
  var st = pg.cases.filter(function (x) { return x.R === null && x.load === 'tare'; })[0];
  assert.ok(Math.abs(st.Po - (j + zo) * 1000) < 1e-9, st.Po);
  // 150 m: a = 14,6 m, n = 0,3 m, p = 2,3 m → (4,38 − 0,09 + 1,3225 − 5)/300
  var c150 = pg.cases.filter(function (x) { return x.R === 150 && x.load === 'tare'; })[0];
  assert.ok(Math.abs(c150.geo - (14.6 * 0.3 - 0.09 + 2.3 * 2.3 / 4 - 5) / 300 * 1000) < 1e-9);
  assert.strictEqual(pg.ok, pg.worstO.Po <= 1e-9 && pg.worstU.Pu <= 1e-9);
  // at mid-car the overthrow on 150 m is far too large: the check fails and enters the verdict
  raw.pantographs[0].n_m = null;
  p = M.normalizeProject(raw); mc = E.staticRun(p, p.settings['static']).cars[2];
  assert.ok(!mc.en.pantographs.ok && !mc.en.ok && !mc.ok);
  assert.ok(M.validate(p).messages.some(function (m) { return m.tab === 'rs' && m.level === 'warn' && /not overhead/.test(m.text); }));
  return 'n 0,3 m: worst Po ' + E.staticRun(M.normalizeProject((raw.pantographs[0].n_m = 0.3, raw)), p.settings['static']).cars[2].en.pantographs.rows[0].worstO.Po.toFixed(2) + ' mm';
} });

module.exports = tests;
