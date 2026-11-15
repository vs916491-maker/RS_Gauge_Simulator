'use strict';
// SOD outline and point items (METHOD §8.7): closed-form cases on a rectangular outline and a three-point profile.
var assert = require('assert');
var M = require('../js/model.js'), E = require('../js/engine.js');
var SAMPLE = require('../samples/sample-project.json');
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= (tol || 1e-9), (msg || '') + ' ' + a + ' vs ' + b); }

// Profile A (1.0, 3.0), B (1.4, 2.0), C (1.4, 1.0) m; no movements unless set; SOD half outline (0, 4), (2, 4), (2, 0) m.
var K = { G: 1500, s: 0, thr: 0, tht: 0, dT_out: 0, dT_in: 0, hc: 1, gtOut: 0, gt: 0, rnd: function () { return 0; },
  profile: { pts: [{ pt: 'A', x: 1.0, h: 3.0 }, { pt: 'B', x: 1.4, h: 2.0 }, { pt: 'C', x: 1.4, h: 1.0 }] } };
var G = { A_end: 1 };
function ctx(vertical, items) { return { sods: { S: [{ y: 0, z: 4 }, { y: 2, z: 4 }, { y: 2, z: 0 }] }, items: items || [], vertical: !!vertical, margin: 50 }; }
function row(o) {
  var r = { ch: 100, k: 0, cant: 0, def: 0, exc: 0, Dw: 0, dga: 0, dgi: 0, wd: 0, To: 0, Ti: 0, sodn: 'S', ok: 'OK' }, x;
  for (x in (o || {})) { if (Object.prototype.hasOwnProperty.call(o, x)) { r[x] = o[x]; } }
  return r;
}
function item(o) { var it = { name: 'I', y: 1.6, z: 2.0, req: 50, side: 'both', from: -Infinity, to: Infinity }, x; for (x in o) { if (Object.prototype.hasOwnProperty.call(o, x)) { it[x] = o[x]; } } return it; }

test('Signed distance to a polygon: inside +, outside −, true Euclidean distance', function () {
  var sq = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
  near(E.polySigned(1, 1, sq), 1); near(E.polySigned(1.5, 0.2, sq), 0.2); near(E.polySigned(3, 1, sq), -1); near(E.polySigned(3, 3, sq), -Math.SQRT2);
});

test('SOD outline on tangent: smallest clearance = 2,0 − 1,4 m = 600 mm at B/C; widening T_out / T_in per side', function () {
  var r = E.sodCheck(row(), K, G, ctx(false));
  near(r.sodc, 600, 1e-9); assert.strictEqual(r.sods, 'OK'); assert.ok(/^(B|C) /.test(r.sodp), r.sodp);
  r = E.sodCheck(row({ To: 100 }), K, G, ctx(false));
  near(r.sodc, 600, 1e-9); assert.ok(/inside/.test(r.sodp), 'outside widened: governing side is the inside');
  r = E.sodCheck(row({ To: 100, Ti: 100 }), K, G, ctx(false)); near(r.sodc, 700, 1e-9);
  r = E.sodCheck(row({ dga: 580 }), K, G, ctx(false)); near(r.sodc, 20, 1e-9); assert.strictEqual(r.sods, 'CHECK'); assert.strictEqual(r.ok, 'CHECK');
  r = E.sodCheck(row({ sodn: '' }), K, G, ctx(false)); assert.strictEqual(r.sodc, null); assert.strictEqual(r.sods, '');
});

test('Cant: vertical frame rotates the envelope by asin(E/G), track frame does not', function () {
  var cant = 150, phi = Math.asin(cant / 1500), cs = Math.cos(phi), sn = Math.sin(phi), exp = Infinity;
  [[1.0, 3.0], [1.4, 2.0], [1.4, 1.0], [-1.0, 3.0], [-1.4, 2.0], [-1.4, 1.0]].forEach(function (q) {
    var X = q[0] * cs - q[1] * sn, Z = q[0] * sn + q[1] * cs;
    exp = Math.min(exp, 2 - X, X + 2, 4 - Z, Z);
  });
  near(E.sodCheck(row({ cant: cant }), K, G, ctx(true)).sodc, exp * 1000, 1e-9);
  near(E.sodCheck(row({ cant: cant }), K, G, ctx(false)).sodc, 600, 1e-9);
  return 'vertical ' + (exp * 1000).toFixed(1) + ' mm';
});

test('Items: clearance to the envelope, inside = negative, chainage range, real side and curve hand', function () {
  var r = E.sodCheck(row(), K, G, ctx(false, [item({})]));
  near(r.itc, 200, 1e-9); near(r.itm, 150, 1e-9); assert.strictEqual(r.its, 'OK');
  // (1,2; 2,0) is inside; nearest edge A–B: 0,2 / √1,16 m
  r = E.sodCheck(row(), K, G, ctx(false, [item({ y: 1.2 })])); near(r.itc, -200 / Math.sqrt(1.16), 1e-9); assert.strictEqual(r.its, 'CHECK');
  r = E.sodCheck(row(), K, G, ctx(false, [item({ from: 200 })])); assert.strictEqual(r.itm, null);
  // outside movement 100 mm: left-hand curve (k > 0) puts a right-side item on the outside, a right-hand curve on the inside
  near(E.sodCheck(row({ k: 0.002, dga: 100 }), K, G, ctx(false, [item({ side: 'R' })])).itc, 100, 1e-9);
  near(E.sodCheck(row({ k: 0.002, dga: 100 }), K, G, ctx(false, [item({ side: 'L' })])).itc, 200, 1e-9);
  near(E.sodCheck(row({ k: -0.002, dga: 100 }), K, G, ctx(false, [item({ side: 'R' })])).itc, 200, 1e-9);
  // tangent: both hands are checked, so the outside movement governs either side
  near(E.sodCheck(row({ k: 0, dga: 100 }), K, G, ctx(false, [item({ side: 'L' })])).itc, 100, 1e-9);
});

test('Sample line: outline checked on SOD elements, items within their ranges, cross-section shows both', function () {
  var p = M.normalizeProject(JSON.parse(JSON.stringify(SAMPLE)));
  var d = E.dynamicRun(p, p.settings['static'], p.settings.dynamic), q = d.summary;
  assert.ok(q.sodo_pts > 0 && q.sodo_pts < q.points, 'outline evaluated only where an SOD is given');
  assert.ok(q.sodc && q.sodc.v > 0 && q.sodo_n === 0 && q.itm && q.it_n === 0 && d.ok);
  var rows = d.cars[0].rows.filter(function (r) { return r.valid; });
  assert.ok(rows.filter(function (r) { return r.ch > 4200; }).every(function (r) { return r.itm === null; }), 'no item beyond 4200 m');
  var xs = E.crossSection(p, d, 'DMC', 1990, p.settings['static']);
  assert.ok(xs.sod && xs.sod.name === 'Tunnel' && xs.sod.pts.length > 10 && xs.items.length === 2, 'tunnel outline + third rail and signal');
  return 'min outline ' + q.sodc.v.toFixed(1) + ' mm, min item margin ' + q.itm.v.toFixed(1) + ' mm';
});

test('Input checks: an item whose "to" chainage is not after its "from" chainage is an error', function () {
  var p = M.normalizeProject(JSON.parse(JSON.stringify(SAMPLE)));
  p.sod.items[1].ch_to_m = p.sod.items[1].ch_from_m;
  assert.ok(M.validate(p).messages.some(function (m) { return m.tab === 'ke' && m.level === 'err' && /"to" chainage/.test(m.text); }));
  assert.ok(!M.validate(M.normalizeProject(JSON.parse(JSON.stringify(SAMPLE)))).messages.some(function (m) { return /"to" chainage/.test(m.text); }));
});

module.exports = tests;
