'use strict';
// EN 15273-2:2009 A.2 static gauge method (METHOD §10.9): formulae A.2–A.5 typed in LITERALLY with the G1 numbers and
// compared with the engine; then hand checks on the fictional sample.
var assert = require('assert');
var E = require('../js/engine.js');
var M = require('../js/model.js');
var tests = [];
var G1 = E.enRules({ ke: { en: {} } });
function rnd(seed) { var x = seed; return function () { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }
function pos(v) { return v > 0 ? v : 0; }
function sample() { return M.normalizeProject(JSON.parse(JSON.stringify(require('../samples/sample-project.json')))); }
function opts(p) { var o = JSON.parse(JSON.stringify(p.settings['static'])); o.en_static = 'yes'; return o; }

// A.2 with A.3 (between the end axles or bogie centres) and A.4 with A.5 (beyond)
function A2(n, a, p, d, q, w) {
  var v = a * n - n * n + p * p / 4, D = v <= 7.5 ? 7.5 : v, x = (v - 100) / 750;
  return pos(D / 500 + (1.465 - d) / 2 + q + w + pos(x) - 0.075);
}
function A4(n, a, p, d, q, w) {
  var v = a * n + n * n - p * p / 4, D = v <= 7.5 ? 7.5 : v, x = (v - 120) / 750;
  return pos(D / 500 + ((1.465 - d) / 2 + q + w) * (2 * n + a) / a + pos(x) - 0.075);
}

tests.push({ name: 'A.2–A.5: engine equals the literal formulae (40 000 random vehicles, Δ minimum and x-term reached)', fn: function () {
  var r = rnd(1511), worst = 0, k, dmin = 0, xpos = 0;
  for (k = 0; k < 40000; k++) {
    var side = k % 2 ? 'a' : 'i', a = 3 + 22 * r(), n = (side === 'i' ? a : 6) * r(), p = 1.8 + 1.5 * r(), d = 1.40 + 0.03 * r(), q = 0.012 * r(), w = 0.06 * r();
    var e = E.enStaticE(G1, { side: side, n: n, a: a, p: p, d: d, q: q, w: w });
    var lit = side === 'i' ? A2(n, a, p, d, q, w) : A4(n, a, p, d, q, w);
    if (e.raw <= 7.5) { dmin++; } if (e.x > 0) { xpos++; }
    worst = Math.max(worst, Math.abs(e.E - lit));
  }
  assert.ok(worst < 1e-12, 'largest difference ' + worst);
  assert.ok(dmin > 1000 && xpos > 1000, dmin + ' / ' + xpos);
  return 'largest difference ' + worst.toExponential(1) + ' m; Δ minimum in ' + dmin + ', x-term in ' + xpos + ' cases';
} });

tests.push({ name: 'Sample DMC by hand; s = 0,3 above s_max 0,2 fails, s_max 0,3 passes', fn: function () {
  var p = sample(), r = E.staticRun(p, opts(p)), st = r.cars[0].enStatic;
  // interior: a = 14,8, n = 7,4, p = 2,3 → Δ = 56,0825; P = (1,465 − 1,412)/2; q 5, w 30 mm
  var Ei = 56.0825 / 500 + 0.0265 + 0.005 + 0.030 - 0.075;
  assert.ok(Math.abs(st.sections.int.E - Ei * 1000) < 1e-9, st.sections.int.E);
  assert.ok(!st.sOk && !st.ok && !r.cars[0].ok && !r.enStatic.ok, 's limit enters the verdict');
  p.ke.en.st_smax = 0.3;
  r = E.staticRun(p, opts(p)); st = r.cars[0].enStatic;
  assert.ok(st.sOk && st.ok && r.enStatic.ok, JSON.stringify(r.enStatic));
  // lower parts up to 0,43 m: wheel wear 20 + dp 38 + dsd 50 (body) / 20 + 38 (bogie)
  assert.strictEqual(st.lower.length, 3);
  assert.strictEqual(st.lower[0].hmin, 240 - 108); assert.strictEqual(st.lower[2].hmin, 140 - 58);
  return 'Ei interior ' + st.sections.int.E.toFixed(3) + ' mm; governing ' + r.enStatic.governing.car + ' ' + r.enStatic.governing.section + ' ' + r.enStatic.governing.margin.toFixed(2) + ' mm';
} });

tests.push({ name: 'Static reference profile option and top check; unknown reference is an error', fn: function () {
  var p = sample(), o = opts(p); p.ke.en.st_smax = 0.3; o.en_static_ref = 'KE Ballasted';
  var r = E.staticRun(p, o);
  assert.strictEqual(r.enStatic.ref, 'KE Ballasted'); assert.strictEqual(r.cars[0].enStatic.checks.int.refTop, 3945);
  p.ke.profiles[1].points[0].z = 3800; p.ke.profiles[1].points[1].z = 3800;   // reference top below the HVAC top 3830
  r = E.staticRun(p, o);
  assert.ok(!r.cars[0].enStatic.checks.ext.topOk && !r.cars[0].enStatic.ok);
  p.settings['static'].en_static = 'yes'; p.settings['static'].en_static_ref = 'Nope';
  assert.ok(M.validate(p).messages.some(function (m) { return m.tab === 'ssim' && m.level === 'err' && /Nope/.test(m.text); }));
  return 'ok';
} });

module.exports = tests;
