'use strict';
// Body camber / sag / end deflection / pitch, track unevenness and rail head wear (METHOD §5.3c).
var assert = require('assert');
var M = require('../js/model.js'), E = require('../js/engine.js');
var SAMPLE = require('../samples/sample-project.json');
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= (tol || 1e-9), (msg || '') + ' ' + a + ' vs ' + b); }
function sample() { return M.normalizeProject(JSON.parse(JSON.stringify(SAMPLE))); }
function setX(p) {
  p.bodies.forEach(function (b) { b.cam_up_mid_mm = 10; b.sag_dn_mid_mm = 8; b.end_up_mm = 4; b.end_dn_mm = 6; b.pitch_dz_mm = 10; });
  p.track.params.unev_mm = 3; p.track.params.railw_v_mm = 2;
}

test('Section additions: parabola between the pivots, linear to the car end with pitch (hand values)', function () {
  var p = sample(); setX(p);
  var d = E.deriveCar(p, p.train.carTypes[1], p.settings['static']), g = d.geo;
  var m = d.vert(g.a / 2, true); near(m.up, 13); near(m.dn, 13);
  var q = d.vert(g.a / 4, true); near(q.up, 10 * 0.75 + 3); near(q.dn, 8 * 0.75 + 5);
  var e = d.vert(g.n_end, false); near(e.up, 4 + 10 * g.n_end / g.a + 3); near(e.dn, 6 + 10 * g.n_end / g.a + 5);
  var x = d.vert(g.na, false); near(x.up, 4 * g.na / g.n_end + 10 * g.na / g.a + 3);
});

test('Vertical checks, upward movement with roll, gauge top / bottom and the route underframe include them; zero inputs change nothing', function () {
  var p0 = sample(), p = sample(); setX(p);
  var o = p.settings['static'], r0 = E.staticRun(p0, o), r = E.staticRun(p, o), c0 = r0.cars[1], c = r.cars[1], d = c.derived, g = d.geo;
  function v(cr, id) { return cr.vertical.filter(function (x) { return x.id === id; })[0].value; }
  near(v(c, 'top_int') - v(c0, 'top_int'), d.vert(g.ni, true).up, 1e-9);
  near(v(c, 'top_end') - v(c0, 'top_end'), d.vert(g.n_end, false).up, 1e-9);
  near(v(c0, 'uf_body') - v(c, 'uf_body'), d.vert(g.a / 2, true).dn, 1e-9);
  near(v(c0, 'uf_bog') - v(c, 'uf_bog'), 5, 1e-9);
  near(c0.mcg.int.top - c.mcg.int.top, 13, 0.11, 'gauge top lowered');
  near(c.mcg.int.bottom - c0.mcg.int.bottom, 13, 1e-9, 'gauge bottom raised');
  near(c0.mcg.end.top - c.mcg.end.top, d.vert(g.n_end, false).up, 0.11);
  var o2 = JSON.parse(JSON.stringify(o)); o2.up_roll = 'yes';
  var cs = E.carCases(d, []).filter(function (k) { return k.section === 'end'; })[0];
  near(E.caseParams(p, d, cs, o2).up, d.up_total + d.vert(g.n_end, false).up, 1e-9);
  var d0 = E.dynamicRun(p0, o, p.settings.dynamic), d1 = E.dynamicRun(p, o, p.settings.dynamic);
  near(d0.cars[1].rows[0].uf - d1.cars[1].rows[0].uf, d.vert(g.a / 2, true).dn, 1e-9);
});

module.exports = tests;
