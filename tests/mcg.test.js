'use strict';
// Study direction and maximum construction gauge outline (METHOD §7.3): backward (customer KE → gauge), forward, both.
var assert = require('assert');
var M = require('../js/model.js'), E = require('../js/engine.js'), RPT = require('../js/report.js');
var SAMPLE = require('../samples/sample-project.json');
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function sample(study) { var p = M.normalizeProject(JSON.parse(JSON.stringify(SAMPLE))); p.train.study = study; return p; }
function errs(v, tab) { return v.messages.filter(function (m) { return m.level === 'err' && (!tab || m.tab === tab); }); }
var KEYS = ['int', 'ext', 'end', 'car'];

test('Backward study: no RS profile needed, the gauge closes with the KE at about 0 mm in every case', function () {
  var p = sample('backward');
  p.rs.profiles = [];
  p.train.carTypes.forEach(function (c) { c.prof_int = c.prof_ext = c.prof_end = ''; });
  p.sections.forEach(function (r) { r.profile = ''; });
  var v = M.validate(p);
  assert.strictEqual(errs(v, 'rs').length + errs(v, 'train').length, 0, JSON.stringify(errs(v)));
  var r = E.staticRun(p, p.settings['static']);
  assert.strictEqual(r.study, 'backward');
  r.cars.forEach(function (c) {
    assert.ok(c.mcg && c.mcg.ok, c.car + ' has a gauge');
    c.cases.forEach(function (k) {
      assert.ok(k.min.c >= 0 && k.min.c < 1.5, c.car + ' ' + k.id + ' closes: ' + k.min.c);
      assert.ok(/^MCG /.test(k.profile), k.profile);
    });
    c.vertical.filter(function (x) { return /^top_/.test(x.id); }).forEach(function (x) { assert.ok(Math.abs(x.margin) < 0.11, x.id + ' ' + x.margin); });
  });
  // closure is ~0 somewhere in every section: the gauge is the largest, not just a safe one
  var tight = r.cars[0].cases.filter(function (k) { return k.min.c < 0.05; });
  assert.ok(tight.length >= 3, 'tight cases ' + tight.length);
  return 'governing ' + r.governing.c.toFixed(3) + ' mm';
});

test('Gauge outline: every vertex inside the KE for every case, 0,5 mm wider is outside (largest half-width)', function () {
  var p = sample('both'), o = p.settings['static'], c = p.train.carTypes[1], d = E.deriveCar(p, c, o);
  var keP = p.ke.profiles.filter(function (x) { return x.name === o.ke; })[0], ke = E.outline(keP.points, keP.n_up);
  var m = E.mcgCar(p, d, [], ke, o), n = 0;
  var cases = E.carCases(d, []).map(function (cs) { return { cs: cs, cp: E.caseParams(p, d, cs, o) }; });
  KEYS.forEach(function (k) {
    var cps = cases.filter(function (x) { return k === 'car' || x.cs.section === k; }).map(function (x) { return x.cp; });
    var g = m[k];
    assert.ok(g.ok && g.points.length > 5, k);
    assert.strictEqual(g.points[0].y, 0); assert.strictEqual(g.points[g.points.length - 1].y, 0);
    g.points.forEach(function (q) { assert.ok(E.mcgClear(cps, ke, o, q.y / 1000, q.z / 1000) >= -1e-9, k + ' ' + q.pt + ' inside'); });
    // side vertices (not the top or the bottom line): a little wider is outside
    g.points.slice(2, -2).forEach(function (q) {
      if (q.y <= 0) { return; }
      assert.ok(E.mcgClear(cps, ke, o, (q.y + 0.5) / 1000, q.z / 1000) < 0, k + ' ' + q.pt + ' is the largest');
      n++;
    });
  });
  // whole car = the narrowest of the three sections at every height
  [1000, 2000, 3000].forEach(function (h) {
    var wc = E.profileWidth(m.car.o, h / 1000), ws = Math.min(E.profileWidth(m.int.o, h / 1000), E.profileWidth(m.ext.o, h / 1000), E.profileWidth(m.end.o, h / 1000));
    assert.ok(Math.abs(wc - ws) * 1000 < 0.6, 'h ' + h + ': ' + wc + ' vs ' + ws);
  });
  return n + ' side vertices checked';
});

test('Gauge outline, hand check: rectangular KE, no roll → half-width = W − T − gauge tolerance, top = KE top − Σu', function () {
  var p = sample('backward'), o = p.settings['static'];
  o.wind = 'no'; o.en_check = 'no'; p.track.params.cl_err_mm = 0; p.track.params.cantexc_max_mm = 0; p.track.params.cantdef_max_mm = 0;
  p.ke.profiles = [{ name: 'Box', n_up: 4, points: [{ pt: 'K1', y: 0, z: 4000 }, { pt: 'K2', y: 1600, z: 4000 }, { pt: 'K3', y: 1600, z: 100 }, { pt: 'K4', y: 0, z: 100 }] }];
  o.ke = 'Box'; p.track.segments.forEach(function (s) { s.ke = 'Box'; });
  p.ke.limits.uf_min_body_mm = 100;
  var r = E.staticRun(p, o), c = r.cars[0], d = c.derived, m = c.mcg;
  ['int', 'ext', 'end'].forEach(function (k) {
    var T = Math.max.apply(null, c.cases.filter(function (x) { return x.section === k; }).map(function (x) { return x.params.T + x.params.rnd_gauge + x.params.rnd_align; }));
    var exp = 1600 - T;
    assert.ok(Math.abs(m[k].maxWidth - exp) < 0.11, k + ': ' + m[k].maxWidth + ' vs ' + exp);
    // a flat wall: one side point at the top and one at the bottom
    assert.ok(m[k].points.length <= 5, k + ' ' + m[k].points.length + ' points');
  });
  assert.ok(Math.abs(m.car.top - (4000 - d.up_total)) < 0.11, 'top ' + m.car.top);
  var Rv = p.track.params.Rv_static_m, vc = Rv ? d.geo.a * d.geo.a / (8 * Rv) * 1000 : 0;
  assert.ok(Math.abs(m.car.bottom - (100 + d.dn_total + vc)) < 1e-9, 'bottom ' + m.car.bottom);
});

test('Forward: no gauge; both: gauge plus the RS margins equal to a hand calculation', function () {
  var pf = sample('forward'), rf = E.staticRun(pf, pf.settings['static']);
  assert.ok(rf.cars.every(function (c) { return c.mcg === null; }));
  var pb = sample('both'), rb = E.staticRun(pb, pb.settings['static']), c = rb.cars[0];
  // the forward results are unchanged by the study direction
  assert.deepStrictEqual(rb.cars.map(function (x) { return x.cases.map(function (k) { return k.min.c; }); }), rf.cars.map(function (x) { return x.cases.map(function (k) { return k.min.c; }); }));
  var m = c.mcg.int, pr = pb.rs.profiles.filter(function (x) { return x.name === pb.train.carTypes[0].prof_int; })[0], min = null;
  pr.points.forEach(function (q) {
    if (q.z > m.top || q.z < m.bottom) { return; }
    var mg = E.profileWidth(m.o, q.z / 1000) * 1000 - q.y;
    if (min === null || mg < min) { min = mg; }
  });
  assert.ok(Math.abs(m.rs.min.margin - min) < 1e-9, m.rs.min.margin + ' vs ' + min);
  assert.ok(m.rs.ok && Math.abs(m.rs.topMargin - (m.top - Math.max.apply(null, pr.points.map(function (q) { return q.z; })))) < 1e-6);
});

test('Validation and dynamic run: forward needs RS profiles; backward runs the route with the whole-car gauge', function () {
  var pf = sample('forward'); pf.rs.profiles = [];
  assert.ok(errs(M.validate(pf), 'rs').length > 0, 'forward without RS profile is an error');
  var p = sample('backward'), d = E.dynamicRun(p, p.settings['static'], p.settings.dynamic);
  assert.strictEqual(d.study, 'backward');
  d.cars.forEach(function (c) { assert.ok(/^MCG .* whole car$/.test(c.consts.profile), c.consts.profile); });
  assert.ok(d.warnings.some(function (w) { return /Backward study/.test(w); }));
});

test('Report: study direction in the scope, gauge rows in the summary, appendix C with the outlines', function () {
  var p = sample('backward'), s = E.staticRun(p, p.settings['static']);
  var bl = RPT.blocks({ p: p, sres: s, dres: null, opt: p.settings.report, messages: [], methodMd: '' });
  var txt = JSON.stringify(bl);
  assert.ok(/study direction: backward/.test(txt));
  assert.ok(/Maximum construction gauge – whole car/.test(txt));
  assert.ok(/Closure of the derived gauge/.test(txt));
  assert.ok(bl.some(function (b) { return b.type === 'h1' && /Appendix C/.test(b.text); }));
  var pf = sample('forward'), bf = RPT.blocks({ p: pf, sres: E.staticRun(pf, pf.settings['static']), dres: null, opt: pf.settings.report, messages: [], methodMd: '' });
  assert.ok(!bf.some(function (b) { return b.type === 'h1' && /Appendix C/.test(b.text); }));
});

module.exports = tests;
