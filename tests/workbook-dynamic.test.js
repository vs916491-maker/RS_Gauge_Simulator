'use strict';
// js/engine.js dynamic run against the reference gauging workbook's Dynamic Calc / Dynamic Gauge Output, recalculated
// with FICTIONAL inputs (tests/fixtures/workbook-reference.json, built by tools/workbook-reference.py).
var assert = require('assert');
var E = require('../js/engine.js'), M = require('../js/model.js');
var fx = require('./fixtures/workbook-reference.json');
var tests = [];
var TOL = 1e-7;   // the fixture keeps 12 significant digits

function project(v) {
  var car = JSON.parse(JSON.stringify(fx.car));
  car.count = 1; car.bogie1 = car.bogie2 = fx.bogie.name; car.prof_int = car.prof_end = fx.profiles[0].name; car.prof_ext = fx.profiles[1].name;
  var train = JSON.parse(JSON.stringify(fx.train)); train.carTypes = [car]; train.formation = car.name; train.n_cars = 1;
  return M.normalizeProject({ version: 2, train: train, bogies: [fx.bogie], bodies: [fx.body], ke: { limits: fx.limits, profiles: [fx.ke, fx.ke2] },
    rs: { profiles: fx.profiles }, track: { params: fx.track, segments: fx.segments }, settings: { 'static': v.options, dynamic: v.dynamic } });
}
function close(a, b, what) {
  if (typeof b === 'string') { assert.strictEqual(a, b, what); return; }
  assert.ok(Math.abs(a - b) <= TOL * Math.max(1, Math.abs(b)), what + ': engine ' + a + ' vs workbook ' + b);
}
var MAP = { B: 'ch', C: 'el', F: 'k', I: 'cant', R: 'kg', T: 'Eeq', V: 'def', Y: 'Dw', Z: 'wd', AA: 'dgi', AB: 'dga', AC: 'o1', AD: 'o2', AE: 'i1', AF: 'i2',
  AG: 'kw1', AH: 'kw2', AI: 'xo', AJ: 'xi', AK: 'To', AL: 'Ti', AM: 'sod', AN: 'lean', AQ: 'sc', AS: 'vc', AT: 'uf', AW: 'gn', AX: 'gm', BB: 'ok', BC: 'valid' };

fx.dynamic.forEach(function (v) {
  tests.push({ name: 'Workbook dynamic reproduction – ' + v.name, fn: function () {
    var p = project(v), x = v.expected;
    var rd = M.readiness(M.validate(p), 'dynamic');
    assert.ok(rd.ok, JSON.stringify(rd.messages));
    var r = E.dynamicRun(p, p.settings['static'], p.settings.dynamic), c = r.cars[0];
    // every sweep row and column
    assert.strictEqual(c.rows.length, x.rows.length, 'number of sweep rows');
    x.rows.forEach(function (row, i) {
      x.cols.forEach(function (col, j) {
        var key = MAP[col], a = key === 'valid' ? (c.rows[i].valid ? 1 : 0) : c.rows[i][key], b = row[j];
        if (b === null || b === '') { assert.ok(a === null || a === '', 'row ' + i + ' ' + col + ' should be blank, is ' + a); return; }
        close(a, b, 'row ' + i + ' (ch ' + row[0] + ') col ' + col);
      });
    });
    // line summary
    var s = c.summary, xs = x.summary;
    close(s.length, xs[0], 'length'); assert.strictEqual(s.points + ' (every ' + s.step + ' m)', xs[1]);
    close(s.def.v, xs[2], 'max deficiency'); close(s.xo.v, xs[3], 'max outside excess'); close(s.xi.v, xs[4], 'max inside excess');
    close(s.sod_n, xs[5], 'SOD checks'); if (xs[6] === 'n/a') { assert.strictEqual(s.sc, null); } else { close(s.sc.v, xs[6], 'min structure clearance'); }
    close(s.uf.v, xs[7], 'min underframe'); close(s.gm.v, xs[8], 'min platform gap'); close(s.gn.v, xs[9], 'max nominal gap'); close(s.check_n, xs[10], 'points with CHECK');
    close(s.def.ch, xs[11], 'deficiency chainage'); close(s.xo.ch, xs[12], 'outside excess chainage'); close(s.xi.ch, xs[13], 'inside excess chainage');
    close(s.uf.ch, xs[16], 'underframe chainage'); close(s.gm.ch, xs[17], 'gap chainage'); close(s.gn.ch, xs[18], 'nominal gap chainage');
    // per-element summary
    x.elements.forEach(function (e, i) {
      var m = c.elements[i];
      [[m.no, e[0]], [m.s0, e[1]], [m.s1, e[2]], [m.V, e[7]], [m.def, e[8]], [m.o2, e[9]], [m.i2, e[10]], [m.xo, e[11]], [m.xi, e[12]], [m.uf, e[14]], [m.status, e[15]]].forEach(function (pr, k) { close(pr[0], pr[1], 'element ' + (i + 1) + ' field ' + k); });
      if (e[13] === null || e[13] === '') { assert.strictEqual(m.sc, null); } else { close(m.sc, e[13], 'element ' + (i + 1) + ' structure'); }
    });
    // speed-step study
    x.speedStep.forEach(function (e, i) {
      var m = c.speedStep.rows[i];
      ['V', 'Eeq', 'I', 'def', 'exc', 'Dw', 'wd', 'dgi', 'dga', 'o1', 'o2', 'i1', 'i2', 'kw1', 'kw2', 'excess'].forEach(function (k, j) { close(m[k], e[j], 'speed step ' + i + ' ' + k); });
    });
    // cross-section
    var xsr = E.crossSection(p, r, c.car, v.dynamic.xs_ch, p.settings['static']), X = x.xs;
    close(xsr.ch, X.ch, 'cross-section chainage'); close(xsr.phi, X.phi, 'cant angle'); close(xsr.tho, X.tho, 'roll outside'); close(xsr.thi, X.thi, 'roll inside');
    close(xsr.row.o2, X.o2, 'required OUT at h2'); close(xsr.row.i2, X.i2, 'required IN at h2');
    var n = xsr.right.length;
    X.outline.forEach(function (o) {
      var side = o[0], pt = Math.min(o[1], n), q = side === 1 ? xsr.right[pt - 1] : xsr.left[pt - 1];
      close(q.E, o[2], 'outline E side ' + side + ' pt ' + o[1]); close(q.th, o[3], 'outline θ');
      var rot = side === 1 ? xsr.envelope[pt - 1] : xsr.envelope[2 * n - pt];
      close(rot.x / 1000, o[4], 'envelope X side ' + side + ' pt ' + o[1]); close(rot.y / 1000, o[5], 'envelope Z side ' + side + ' pt ' + o[1]);
    });
    return 'max OUT excess ' + s.xo.v.toFixed(2) + ' mm at ' + s.xo.ch + ' m';
  } });
});

module.exports = tests;
