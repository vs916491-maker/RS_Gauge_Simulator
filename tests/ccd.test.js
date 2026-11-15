'use strict';
// Third-rail current collector (METHOD §14): movements, reach, overlap, envelope and clearances by hand; static situations
// and the line sweep on the fictional sample.
var assert = require('assert');
var E = require('../js/engine.js');
var M = require('../js/model.js');
var tests = [];
function sample() { return M.normalizeProject(JSON.parse(JSON.stringify(require('../samples/sample-project.json')))); }
function near(a, b, t) { return Math.abs(a - b) < (t || 1e-9); }

tests.push({ name: 'Movement of a CCD point by hand (frame, R 150 m, rail outside, roll, vertical curve)', fn: function () {
  var p = sample(), b = p.bogies.filter(function (x) { return x.name === 'M'; })[0], bb = E.ccdBogie(p, b, p.settings['static']), c = p.ccds[0];
  var tp = p.track.params, sit = { kAbs: 1 / 150, outside: true, Dt: 100, Da: 120, vc: [-0.26, 0.26] }, y = 1720, z = 160;
  var m = E.ccdMove(bb, c, sit, y, z);
  var rand = b.play_ld_mm + b.q_mm + tp.fw_mm + tp.widen_mm / 2;                         // 150 m < widening radius
  var O = (1.45 * 1.45 - 2.3 * 2.3 / 4) / 2 / 150 * 1000;
  var tt = 0.05 * 100 / 1500, ta = 0.05 * 120 / 1500;
  assert.ok(near(m.ylo, O - rand + Math.min(0, tt * (z - 400), -ta * (z - 400))) && near(m.yhi, O + rand + Math.max(0, tt * (z - 400), -ta * (z - 400))), JSON.stringify(m));
  assert.ok(near(m.zlo, -20 - 38 - tt * y - 0.26) && near(m.zhi, 15 + ta * y + 0.26), JSON.stringify(m));
  // axle-mounted: no primary play, travel or roll
  var ma = E.ccdMove(bb, { mount: 'axle', x_m: 1.45 }, sit, y, z);
  assert.ok(near(ma.yhi - ma.ylo, 2 * (b.play_ld_mm + tp.fw_mm + tp.widen_mm / 2)) && near(ma.zlo, -20 - 0.26) && near(ma.zhi, 0.26));
  return 'lateral ' + m.ylo.toFixed(2) + ' … ' + m.yhi.toFixed(2) + ', vertical ' + m.zlo.toFixed(2) + ' … ' + m.zhi.toFixed(2) + ' mm';
} });

// a plain bogie: wheel–rail play 10, wear 5, primary travel 20 / 10, no roll, no curve
var BB = { name: 'X', p: 2, play: 10, q: 0, wear: 5, dp: 20, up: 10, s: 0, hc: 0, fw: 0, gtol: 0, align: 0, widen: 0, widenR: 0, G: 1500 };
var TAN = { kAbs: 0, outside: true, Dt: 0, Da: 0, vc: [0, 0] };

tests.push({ name: 'Reach and overlap by hand: bottom, top and side contact', fn: function () {
  var c = { mount: 'frame', x_m: 1.5, c_min_mm: 120, c_max_mm: 220, o_min_mm: 1650, o_max_mm: 1790 };
  // bottom: rail underside 160 ± 10, wear 5 upwards → 150 … 175; shoe frame moves −25 … +10 → relative 140 … 200
  var rl = E.ccdRail({ tr_contact: 'bottom', tr_c_mm: 160, tr_o_min_mm: 1690, tr_o_max_mm: 1750, tr_tol_y_mm: 10, tr_tol_z_mm: 10, tr_wear_mm: 5, tr_overlap_mm: 20 });
  var k = E.ccdContact(BB, c, TAN, rl);
  assert.ok(near(k.relLo, 150 - 10) && near(k.relHi, 175 + 25) && near(k.mLo, 20) && near(k.mHi, 20), JSON.stringify(k));
  // overlap: δ = ±(10 + 10) → face 1630…1770 against 1690…1750 = 60; 1670…1810 = 60
  assert.ok(near(k.overlap, 60) && near(k.mOv, 40));
  // top: wear lowers the top face: 160 − 10 − 5 … 160 + 10
  var kt = E.ccdContact(BB, c, TAN, E.ccdRail({ tr_contact: 'top', tr_c_mm: 160, tr_o_min_mm: 1690, tr_o_max_mm: 1750, tr_tol_y_mm: 10, tr_tol_z_mm: 10, tr_wear_mm: 5, tr_overlap_mm: 20 }));
  assert.ok(near(kt.relLo, 145 - 10) && near(kt.relHi, 170 + 25));
  // side: contact axis lateral (face at 1700 from the centre, ±10, wear 5 outwards); the shoe moves ±10 laterally
  var cs = { mount: 'frame', x_m: 1.5, c_min_mm: 1660, c_max_mm: 1760, o_min_mm: 100, o_max_mm: 200 };
  var ks = E.ccdContact(BB, cs, TAN, E.ccdRail({ tr_contact: 'side', tr_c_mm: 1700, tr_o_min_mm: 120, tr_o_max_mm: 180, tr_tol_y_mm: 10, tr_tol_z_mm: 10, tr_wear_mm: 5, tr_overlap_mm: 20 }));
  assert.ok(near(ks.relLo, 1690 - 10) && near(ks.relHi, 1715 + 10), JSON.stringify(ks));
  // overlap on the height axis: δ = −25 − 10 … +10 + 10; face 65…165 against 120…180 → 45; 120…220 → 60
  assert.ok(near(ks.overlap, 45), ks.overlap);
  return 'bottom reach margin ' + k.reach + ' mm, overlap ' + k.overlap + ' mm';
} });

tests.push({ name: 'Rectangle distance; sample static CCD by situation; failures enter the verdict', fn: function () {
  assert.strictEqual(E.rectDist({ y0: 0, y1: 10, z0: 0, z1: 10 }, { y0: 13, y1: 20, z0: 14, z1: 20 }), 5);
  assert.strictEqual(E.rectDist({ y0: 0, y1: 10, z0: 0, z1: 10 }, { y0: 5, y1: 20, z0: 5, z1: 20 }), 0);
  var p = sample(), r = E.staticRun(p, p.settings['static']), cc = r.ccd, c = cc.ccds[0];
  assert.strictEqual(cc.ke, 'KE CCD zone'); assert.strictEqual(c.cases.length, 3);
  assert.ok(cc.ok && r.ok, JSON.stringify({ ke: c.ke, reach: c.reach, overlap: c.overlap, clear: c.clear }));
  // working shoe S1 (1650, 160) follows the rail: z 150 … 175; shroud point (1665, 235) ± 10 → gap 225 − 175 = 50, required 30
  var tan = c.cases[0];
  assert.ok(near(tan.clear.dist, 50) && near(tan.clear.margin, 20) && tan.clear.pt === 'S1', JSON.stringify(tan.clear));
  p.ccds[0].c_max_mm = 200;
  r = E.staticRun(p, p.settings['static']);
  assert.ok(!r.ccd.ok && !r.ok && r.ccd.ccds[0].reach.v < 0);
  return 'smallest: envelope ' + c.ke.v.toFixed(2) + ', reach ' + c.reach.v.toFixed(2) + ', overlap ' + c.overlap.v.toFixed(2) + ', clearance ' + c.clear.v.toFixed(2) + ' mm';
} });

tests.push({ name: 'Along the line: rail side and range from the SOD third-rail item; curve side; verdict', fn: function () {
  var p = sample(), d = E.dynamicRun(p, p.settings['static'], p.settings.dynamic), cc = d.ccd;
  assert.ok(cc.n > 0 && cc.rows.every(function (r) { return r.side === 'R' && r.ch <= 4200 + 1e-9; }));
  // the sample's right-hand curves put the right-side rail inside, the left-hand ones outside
  assert.ok(cc.rows.some(function (r) { return r.pos === 'inside'; }) && cc.rows.some(function (r) { return r.pos === 'outside'; }));
  assert.ok(cc.ok && d.summary.ccd.check_n === 0);
  // without third-rail items the rail is taken on both sides everywhere
  p.sod.items = p.sod.items.filter(function (it) { return it.type !== 'third_rail'; });
  var d2 = E.dynamicRun(p, p.settings['static'], p.settings.dynamic);
  assert.ok(d2.ccd.n > cc.n);
  p.thirdRail.parts[0].clear_mm = 80;
  d2 = E.dynamicRun(p, p.settings['static'], p.settings.dynamic);
  assert.ok(!d2.ccd.ok && !d2.ok && d2.summary.ccd.check_n > 0);
  return cc.n + ' chainages with a rail; smallest reach margin ' + cc.reach.v.toFixed(2) + ' mm at ' + cc.reach.ch + ' m';
} });

tests.push({ name: 'CCD inputs: unknown bogie, reversed range, points of an unknown CCD', fn: function () {
  var p = sample(); p.ccds[0].bogie = 'Z'; p.ccds[0].c_max_mm = 100; p.ccdPoints.push({ ccd: 'Nope', state: 'working', part: 'gear', pt: 'X', y_mm: 1, z_mm: 1 });
  var e = M.validate(p).messages.filter(function (m) { return m.level === 'err' && m.tab === 'bogie'; }).map(function (m) { return m.text; }).join(' | ');
  assert.ok(/bogie type "Z"/.test(e) && /working range/.test(e) && /CCD "Nope"/.test(e), e);
  return 'ok';
} });

module.exports = tests;
