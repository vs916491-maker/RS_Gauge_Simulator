'use strict';
// js/engine.js against the reference gauging workbook: FICTIONAL inputs recalculated by the workbook itself
// (tests/fixtures/workbook-reference.json, built by tools/workbook-reference.py). Every option set must match.
var assert = require('assert');
var E = require('../js/engine.js'), M = require('../js/model.js');
var fx = require('./fixtures/workbook-reference.json');
var tests = [];
var TOL = 1e-6;   // mm (the workbook and the engine agree to ~1e-12)

function project(v) {
  var car = JSON.parse(JSON.stringify(fx.car));
  Object.keys(v.extra).forEach(function (k) { if (k in car) { car[k] = v.extra[k]; } });
  if (v.extra.arr === 'shared_one') { car.end1 = 'free'; car.end2 = 'shared'; }
  if (v.extra.arr === 'shared_both') { car.end1 = 'shared'; car.end2 = 'shared'; }
  car.count = 1; car.bogie1 = car.bogie2 = fx.bogie.name; car.prof_int = car.prof_end = fx.profiles[0].name; car.prof_ext = fx.profiles[1].name;
  var tp = JSON.parse(JSON.stringify(fx.track));
  Object.keys(v.extra).forEach(function (k) { if (k in tp) { tp[k] = v.extra[k]; } });
  var train = JSON.parse(JSON.stringify(fx.train)); train.carTypes = [car]; train.formation = car.name; train.n_cars = 1;
  return M.normalizeProject({ version: 2, train: train, bogies: [fx.bogie], bodies: [fx.body], ke: { limits: fx.limits, profiles: [fx.ke] },
    rs: { profiles: fx.profiles }, track: { params: tp, segments: [] }, settings: { 'static': v.options } });
}
function close(a, b, what) { assert.ok(Math.abs(a - b) <= TOL * Math.max(1, Math.abs(b)), what + ': engine ' + a + ' vs workbook ' + b); }

fx.variants.forEach(function (v) {
  tests.push({ name: 'Workbook reproduction – ' + v.name, fn: function () {
    var p = project(v), x = v.expected;
    assert.strictEqual(M.validate(p).errors, 0, JSON.stringify(M.validate(p).messages.filter(function (m) { return m.level === 'err'; })));
    var c = E.staticRun(p, p.settings['static']).cars[0];
    c.cases.forEach(function (k, i) {
      close(k.min.c, x.min[i], k.label + ' min clearance');
      assert.strictEqual(k.min.i, x.pt[i], k.label + ' governing point');
      close(k.params.T, x.T[i], k.label + ' T');
      close(k.params.thtot, x.thtot[i], k.label + ' total angle');
    });
    assert.strictEqual(c.methodA.length, x.methodA.length, 'Method A rows');
    c.methodA.forEach(function (r, i) {
      var e = x.methodA[i];
      [r.h / 1000, r.W / 1000, r.max_int / 1000, r.max_ext / 1000, r.max_end / 1000, r.margin_int, r.margin_ext, r.margin_end].forEach(function (val, k) {
        if (val === null || e[k] === null || e[k] === '') { assert.ok((val === null) === (e[k] === null || e[k] === ''), 'Method A blank margin at row ' + i); return; }
        close(val, e[k], 'Method A row ' + i + ' col ' + k);
      });
    });
    var vv = c.vertical;
    close(vv[0].margin, x.vertical[0], 'interior top margin'); close(vv[1].margin, x.vertical[1], 'exterior top margin'); close(vv[2].margin, x.vertical[2], 'car-end top margin');
    close(vv[3].value, x.vertical[3], 'vertical-curve lowering'); close(vv[4].value, x.vertical[4], 'roll lowering');
    close(vv[5].value, x.vertical[5], 'body equipment height'); close(vv[6].value, x.vertical[6], 'bogie equipment height');
    var d = c.derived, t = d.theoretical;
    [t.tare.hc, t.crush.hc, t.defl.hc].forEach(function (h, i) { close(h, x.theo_hc[i], 'theoretical hc ' + i); });
    [t.tare.s, t.crush.s, t.defl.s].forEach(function (s, i) { close(s, x.theo_s[i], 'theoretical s ' + i); });
    close(d.s_t, x.s_used[0], 's used tare'); close(d.s_c, x.s_used[1], 's used crush'); close(d.hc_t, x.hc_used[0], 'hc used tare'); close(d.hc_c, x.hc_used[1], 'hc used crush');
    close(d.wind.Cw_t, x.Cw[0], 'Cw tare'); close(d.wind.Cw_c, x.Cw[1], 'Cw crush');
    close(d.shared.axle_t, x.axle_t, 'axle load'); close(d.shared.width_loss, x.width_loss, 'width loss'); close(d.geo.a, x.a, 'pivot distance');
    return c.cases.map(function (k) { return k.min.c.toFixed(2); }).join(' ');
  } });
});

module.exports = tests;
