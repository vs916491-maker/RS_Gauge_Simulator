'use strict';
// EN 15273-2:2009 A.3.9 with w varying with the radius, motor-coach formulae and variable stops (METHOD §10.4–10.6).
// The standard's formulae are typed in LITERALLY with the G1 numbers and compared with the engine's general form.
// Subscripts as in the standard: i = the bogie away from the section (factor n/a), a = the bogie at the section's end
// ((n + a)/a); for motor coaches: unprimed = motor bogie, primed = carrying bogie. All vehicles random / fictional.
var assert = require('assert');
var E = require('../js/engine.js');
var tests = [];
function pos(v) { return v > 0 ? v : 0; }
var G1 = E.enRules({ ke: { en: {} } });
function rnd(seed) { var x = seed; return function () { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }

// ---- traction units, A.27–A.32 (w∞ common, w(250), w(150) per bogie)
function trI(low, n, a, p, d, q, z, winf, wi250, wi150) {
  var D = a * n - n * n + p * p / 4;
  if (D - 500 * (winf - wi250) <= (low ? 5 : 7.5)) { return (1.465 - d) / 2 + q + winf + z - 0.015; }
  var x = (D - 100) / 750 + wi150 - wi250;
  return D / 500 + (1.465 - d) / 2 + q + wi250 + z + pos(x) - (low ? 0.025 : 0.030);
}
function trA(low, n, a, p, d, q, z, winf, wi250, wi150, wa250, wa150) {
  var D = a * n + n * n - p * p / 4;
  if (D - 500 * ((winf - wi250) * n / a + (winf - wa250) * (n + a) / a) <= (low ? 5 : 7.5)) { return ((1.465 - d) / 2 + q + winf) * (2 * n + a) / a + z - 0.015; }
  var x = (D - 120) / 750 + (wi150 - wi250) * n / a + (wa150 - wa250) * (n + a) / a;
  return D / 500 + ((1.465 - d) / 2 + q) * (2 * n + a) / a + wi250 * n / a + wa250 * (n + a) / a + z + pos(x) - (low ? 0.025 : 0.030);
}
// ---- coaches, A.46–A.51
function coI(low, n, a, p, d, q, z, winf, wi250, wi150) {
  var D = a * n - n * n + p * p / 4;
  if (D - 500 * (winf - wi250) <= 250 * (1.465 - d) - (low ? 2.5 : 0)) { return (1.465 - d) / 2 + q + winf + z - 0.015; }
  var x = (D - 100) / 750 + wi150 - wi250;
  return D / 500 + q + wi250 + z + pos(x) - (low ? 0.010 : 0.015);
}
function coA(low, n, a, p, d, q, z, winf, wi250, wi150, wa250, wa150) {
  var D = a * n + n * n - p * p / 4;
  if (D - 500 * ((winf - wi250) * n / a + (winf - wa250) * (n + a) / a) <= 250 * (1.465 - d) * n / a + (low ? 5 : 7.5)) { return ((1.465 - d) / 2 + q + winf) * (2 * n + a) / a + z - 0.015; }
  var x = (D - 120) / 750 + (wi150 - wi250) * n / a + (wa150 - wa250) * (n + a) / a;
  return D / 500 + (1.465 - d) / 2 * (n + a) / a + q * (2 * n + a) / a + wi250 * n / a + wa250 * (n + a) / a + z + pos(x) - (low ? 0.025 : 0.030);
}
// ---- motor coaches, A.37–A.45 (m = motor bogie: p, w; c = carrying bogie: p', w')
function mcI(low, nu, a, m, c, d, q, z) {
  var fm = (a - nu) / a, fc = nu / a;
  var e37 = (1.465 - d) / 2 + q + m.winf * fm + c.winf * fc + z - 0.015;
  var D = a * nu - nu * nu + m.p * m.p / 4 * fm + c.p * c.p / 4 * fc;
  var x = (D - 100) / 750 + (m.w150 - m.w250) * fm + (c.w150 - c.w250) * fc;
  var e38 = D / 500 + (1.465 - d) / 2 * fm + q + m.w250 * fm + c.w250 * fc + z + pos(x) - (low ? 0.010 : 0.015) - 0.015 * fm;
  return Math.max(e37, e38);
}
function mcA(low, n, a, m, c, d, q, z) {
  var fn = (n + a) / a, ff = n / a, A = (2 * n + a) / a;
  var e40 = ((1.465 - d) / 2 + q) * A + m.winf * fn + c.winf * ff + z - 0.015;
  var D1 = a * n + n * n - m.p * m.p / 4 * fn + c.p * c.p / 4 * ff;
  var x1 = (D1 - 120) / 750 + (c.w150 - c.w250) * ff + (m.w150 - m.w250) * fn;
  var e41 = D1 / 500 + (1.465 - d) / 2 * fn + q * A + c.w250 * ff + m.w250 * fn + z + pos(x1) - (low ? 0.025 : 0.030);
  var e43 = ((1.465 - d) / 2 + q) * A + m.winf * ff + c.winf * fn + z - 0.015;
  var D2 = a * n + n * n + m.p * m.p / 4 * ff - c.p * c.p / 4 * fn;
  var x2 = (D2 - 120) / 750 + (m.w150 - m.w250) * ff + (c.w150 - c.w250) * fn;
  var e44 = D2 / 500 + ((1.465 - d) / 2 + q) * A + m.w250 * ff + c.w250 * fn + z + pos(x2) - (low ? 0.025 : 0.030);
  return Math.max(e40, e41, e43, e44);
}
function bog(R, winf) { var w250 = winf + R() * 0.02, w150 = w250 + R() * 0.02; return { p: 1.8 + R() * 1.2, winf: winf, w250: w250, w150: w150 }; }

tests.push({ name: 'EN 15273-2 – w varying with the radius: traction units A.27–A.32 and coaches A.46–A.51 (literal)', fn: function () {
  var R = rnd(21), worst = 0, k, br = {};
  for (k = 0; k < 30000; k++) {
    var a = 6 + R() * 14, d = 1.405 + R() * 0.03, q = R() * 0.01, z = R() * 0.03, low = R() < 0.3, winf = R() * 0.05;
    var bi = bog(R, winf), ba = bog(R, winf), p = 1.8 + R() * 1.2; bi.p = p; ba.p = p;
    var nI = R() * a, nA = R() * 5;
    ['traction', 'coach'].forEach(function (set) {
      var eI = E.enE(G1, { set: set, side: 'i', low: low, n: nI, a: a, d: d, q: q, z: z, near: bi, far: ba });
      var eA = E.enE(G1, { set: set, side: 'a', low: low, n: nA, a: a, d: d, q: q, z: z, near: ba, far: bi });
      var lI = set === 'traction' ? trI(low, nI, a, p, d, q, z, winf, bi.w250, bi.w150) : coI(low, nI, a, p, d, q, z, winf, bi.w250, bi.w150);
      var lA = set === 'traction' ? trA(low, nA, a, p, d, q, z, winf, bi.w250, bi.w150, ba.w250, ba.w150) : coA(low, nA, a, p, d, q, z, winf, bi.w250, bi.w150, ba.w250, ba.w150);
      worst = Math.max(worst, Math.abs(eI.E - lI), Math.abs(eA.E - lA)); br[eI.branch] = 1; br[eA.branch] = 1;
    });
  }
  assert.ok(worst < 1e-12, 'max difference ' + worst);
  assert.ok(br.straight && br.curve, 'both branches exercised');
  return 'max diff ' + worst.toExponential(1) + ' m';
} });

tests.push({ name: 'EN 15273-2 – motor coaches A.37–A.45 (literal): Ei at both n_mu, Ea largest of motor-side and carrying-side', fn: function () {
  var R = rnd(33), worst = 0, k;
  for (k = 0; k < 30000; k++) {
    var a = 6 + R() * 14, d = 1.405 + R() * 0.03, q = R() * 0.01, z = R() * 0.03, low = R() < 0.3;
    var m = bog(R, R() * 0.05), c = bog(R, R() * 0.05), nI = R() * a, nA = R() * 5;
    var eI = Math.max(E.enE(G1, { set: 'motor', side: 'i', low: low, n: nI, a: a, d: d, q: q, z: z, near: m, far: c }).E,
      E.enE(G1, { set: 'motor', side: 'i', low: low, n: a - nI, a: a, d: d, q: q, z: z, near: m, far: c }).E);
    var eA = Math.max(E.enE(G1, { set: 'motor', side: 'a', low: low, n: nA, a: a, d: d, q: q, z: z, near: m, far: c, motorNear: true }).E,
      E.enE(G1, { set: 'motor', side: 'a', low: low, n: nA, a: a, d: d, q: q, z: z, near: c, far: m, motorNear: false }).E);
    worst = Math.max(worst, Math.abs(eI - Math.max(mcI(low, nI, a, m, c, d, q, z), mcI(low, a - nI, a, m, c, d, q, z))), Math.abs(eA - mcA(low, nA, a, m, c, d, q, z)));
  }
  assert.ok(worst < 1e-12, 'max difference ' + worst);
  return 'max diff ' + worst.toExponential(1) + ' m';
} });

tests.push({ name: 'EN 15273-2 – variable stops: bracket formulae A.33 / A.35 / A.52 / A.54 at the radius where the stops start', fn: function () {
  var R = rnd(45), worst = 0, k, used = 0;
  for (k = 0; k < 20000; k++) {
    var a = 6 + R() * 14, d = 1.405 + R() * 0.03, q = R() * 0.01, z = R() * 0.03, low = R() < 0.3, T = low ? 5 : 7.5;
    var w = R() * 0.04, Rv = 260 + R() * 600, wv = w + R() * 0.04, p = 1.8 + R() * 1.2, b = { p: p, winf: w, w250: w, w150: w, Rv: Rv, wv: wv };
    var nI = R() * a, nA = R() * 5, Di = a * nI - nI * nI + p * p / 4, Da = a * nA + nA * nA - p * p / 4;
    ['traction', 'coach'].forEach(function (set) {
      var lin = { p: p, winf: w, w250: w, w150: w };
      var eI = E.enE(G1, { set: set, side: 'i', low: low, n: nI, a: a, d: d, q: q, z: z, near: b, far: b });
      var eA = E.enE(G1, { set: set, side: 'a', low: low, n: nA, a: a, d: d, q: q, z: z, near: b, far: b });
      var linI = E.enE(G1, { set: set, side: 'i', low: low, n: nI, a: a, d: d, q: q, z: z, near: lin, far: lin }).E;
      var linA = E.enE(G1, { set: set, side: 'a', low: low, n: nA, a: a, d: d, q: q, z: z, near: lin, far: lin }).E;
      var bI = (Di - T) / (2 * Rv) + wv, bA = (Da - T) / (2 * Rv) + wv * nA / a + wv * (nA + a) / a;
      var vI = set === 'traction' ? bI + (1.465 - d) / 2 + q + z - 0.015 : bI + q + z;                                  // A.33 / A.52
      var vA = set === 'traction' ? bA + ((1.465 - d) / 2 + q) * (2 * nA + a) / a + z - 0.015                           // A.35
        : bA + (1.465 - d) / 2 * (nA + a) / a + q * (2 * nA + a) / a + z - 0.015;                                       // A.54
      if (vI > linI || vA > linA) { used++; }
      worst = Math.max(worst, Math.abs(eI.E - Math.max(linI, vI)), Math.abs(eA.E - Math.max(linA, vA)));
    });
  }
  assert.ok(worst < 1e-12 && used > 1000, 'max difference ' + worst + ', governing ' + used);
  return 'max diff ' + worst.toExponential(1) + ' m (' + used + ' cases governed by the variable stops)';
} });

tests.push({ name: 'EN 15273-2 – formula set per car type: Table A.4 note a by default, motor-coach option, coach without motor bogie', fn: function () {
  var M = require('../js/model.js'), p = M.normalizeProject(JSON.parse(JSON.stringify(require('../samples/sample-project.json'))));
  var o = JSON.parse(JSON.stringify(p.settings['static'])); o.en_check = 'yes';
  var sets = E.staticRun(p, o).cars.map(function (c) { return c.car + ':' + c.en.set; }).join(' ');
  assert.strictEqual(sets, 'DMC:traction TC:coach MC:traction');
  o.en_mc = 'motor';
  var r = E.staticRun(p, o), dmc = r.cars[0];
  assert.strictEqual(r.cars.map(function (c) { return c.en.set; }).join(' '), 'motor coach traction');
  assert.strictEqual(dmc.en.clause, 'A.3.9.2');
  // the note a says the two sets differ by 0 to 12,5 mm on the half-width
  var t = E.staticRun(p, (o.en_mc = 'traction', o)).cars[0];
  var diff = {};
  ['int', 'ext', 'end'].forEach(function (k) { diff[k] = Math.max.apply(null, dmc.en.rows.map(function (x, i) { return Math.abs(x['max_' + k] - t.en.rows[i]['max_' + k]); })); });
  assert.ok(diff.int > 0 && Math.max(diff.int, diff.ext, diff.end) <= 12.5 + 1e-9, JSON.stringify(diff));
  return 'traction vs motor coach, largest difference: interior ' + diff.int.toFixed(2) + ', exterior ' + diff.ext.toFixed(2) + ', car end ' + diff.end.toFixed(2) + ' mm';
} });

module.exports = tests;
