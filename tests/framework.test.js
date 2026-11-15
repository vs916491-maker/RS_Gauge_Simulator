'use strict';
// Applicable rules (framework) and BOStrab §34 public limits (METHOD §16). Fictional data only.
var assert = require('assert');
var E = require('../js/engine.js');
var M = require('../js/model.js');
var S = require('../js/schema.js');
var tests = [];
function sample() { return M.normalizeProject(JSON.parse(JSON.stringify(require('../samples/sample-project.json')))); }
function near(a, b, t) { return Math.abs(a - b) < (t || 1e-9); }

tests.push({ name: 'Framework defaults: checks per framework, EBO reference line from the vehicle use', fn: function () {
  var d = S.frameworkDefaults;
  assert.deepStrictEqual(Object.keys(d), ['customer', 'en', 'ebo', 'bostrab']);
  assert.ok(d.customer['static'].en_check === 'no' && d.en['static'].en_check === 'yes' && d.ebo['static'].en_check === 'yes' && d.bostrab['static'].bst_check === 'yes');
  assert.strictEqual(S.frameworkGauge({ framework: 'ebo', ebo_use: 'g1' }), 'G1');
  assert.strictEqual(S.frameworkGauge({ framework: 'ebo', ebo_use: 'g2' }), 'G2');
  assert.strictEqual(S.frameworkGauge({ framework: 'en' }), 'G1');
  assert.strictEqual(S.frameworkGauge({ framework: 'bostrab' }), null);
  var p = sample(); assert.strictEqual(p.train.framework, 'customer');
  return 'ok';
} });

tests.push({ name: 'BOStrab §34 by hand on the sample DMC (street-running); not applicable otherwise; warnings', fn: function () {
  var p = sample(), o = JSON.parse(JSON.stringify(p.settings['static']));
  o.bst_check = 'yes'; p.train.framework = 'bostrab'; p.train.bostrab_street = 'yes';
  var r = E.staticRun(p, o), b = r.cars[0].bostrab, by = {};
  b.rows.forEach(function (x) { by[x.id] = x; });
  assert.ok(near(by.w_low.value, 2880) && !by.w_low.ok, 'profile half-width 1440 → 2,88 m > 2,65 m');
  assert.ok(near(by.h.value, 3830) && by.h.ok, 'HVAC profile top 3830 mm');
  var a = 21.6 - 2 * 3.4, P = 2.3, R = 150, nE = 3.4;
  assert.ok(near(by.ov_in.value, (a * a + P * P) / (8 * R) * 1000) && near(by.ov_out.value, (a * nE + nE * nE - P * P / 4) / (2 * R) * 1000));
  assert.ok(!b.ok && !r.cars[0].ok && !r.ok);
  assert.ok(r.warnings.some(function (w) { return /Framework BOStrab/.test(w); }));
  // a lowered pantograph above 4,0 m governs the height
  p.pantographs = [{ car: 'DMC', name: 'P1', pos: 'between', n_m: 0.3, ht_mm: 3900, t_mm: 30, theta_mrad: 2.5, tau_mm: 10, bw_mm: 800, h_low_mm: 4100, ins_mm: 0, note: '' }];
  by = {}; E.staticRun(p, o).cars[0].bostrab.rows.forEach(function (x) { by[x.id] = x; });
  assert.ok(near(by.h.value, 4100) && !by.h.ok);
  p.train.bostrab_street = 'no'; p.pantographs = [];
  b = E.staticRun(p, o).cars[0].bostrab;
  assert.ok(b.ok && b.rows.every(function (x) { return !x.applies; }));
  p.train.framework = 'ebo';
  assert.ok(E.staticRun(p, o).warnings.some(function (w) { return /Framework EBO: .*G2/.test(w); }));
  return 'width ' + 2880 + ' mm > 2650 mm (street-running); curve throw inside ' + by.ov_in.value.toFixed(0) + ' mm';
} });

module.exports = tests;
