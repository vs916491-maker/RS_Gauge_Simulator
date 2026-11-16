'use strict';
// Additional sections (METHOD §6.1a): position from a body end, between / beyond the pivots, every load case,
// Method A column, profile-top check; not in the EN / dynamic checks.
var assert = require('assert');
global.XLSX = require('../vendor/xlsx.full.min.js');
var E = require('../js/engine.js'), M = require('../js/model.js'), IO = require('../js/io.js');
var sample = require('../samples/sample-project.json');
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function near(a, b, tol, what) { assert.ok(Math.abs(a - b) <= (tol || 1e-9), (what || '') + ': ' + a + ' vs ' + b); }
function proj(edit) { var raw = JSON.parse(JSON.stringify(sample)); if (edit) { edit(raw); } return M.normalizeProject(raw); }
function has(v, level, re) { return v.messages.some(function (m) { return m.tab === 'train' && m.level === level && re.test(m.text); }); }

test('Position: distance from end 1 or end 2, between / beyond the pivots, n and yaw factor A (hand values)', function () {
  var g = E.carGeometry({ length_m: 21.6, n_free_m: 3.4, n_art_m: 0, end1: 'free', end2: 'free' });   // a = 14,8 m
  var cab = E.sectionPos(g, { ref_end: 'end1', dist_m: 1.0 });
  assert.deepStrictEqual([cab.pos, cab.side], ['beyond', 'end1']); near(cab.n, 2.4, 1e-12); near(cab.A, (14.8 + 4.8) / 14.8, 1e-12);
  var door = E.sectionPos(g, { ref_end: 'end1', dist_m: 7.0 });
  assert.strictEqual(door.pos, 'between'); near(door.n, 3.6, 1e-12); assert.strictEqual(door.A, 1);
  var gw = E.sectionPos(g, { ref_end: 'end2', dist_m: 0.3 });
  assert.deepStrictEqual([gw.pos, gw.side], ['beyond', 'end2']); near(gw.x, 21.3, 1e-12); near(gw.n, 3.1, 1e-12);
  var piv = E.sectionPos(g, { ref_end: 'end2', dist_m: 3.4 });
  assert.strictEqual(piv.pos, 'between'); near(piv.n, 14.8, 1e-12, 'at pivot 2 (n from pivot 1 = a)');
});

test('A section placed at the standard interior / exterior / car-end position gives the standard results', function () {
  var base = proj(function (raw) { raw.sections = []; }), c = base.train.carTypes[1], g = E.carGeometry(c);   // TC
  var p = proj(function (raw) {
    raw.sections = [
      { car: 'TC', name: 'At ni', ref_end: 'end1', dist_m: g.n1 + g.ni, profile: c.prof_int },
      { car: 'TC', name: 'At na', ref_end: 'end2', dist_m: g.n2 - g.na, profile: c.prof_ext },
      { car: 'TC', name: 'At end', ref_end: 'end1', dist_m: 0, profile: c.prof_end }];
  });
  var o = p.settings['static'], r = E.staticRun(p, o).cars[1], r0 = E.staticRun(base, o).cars[1], worst = 0;
  [['x1', 'int'], ['x2', 'ext'], ['x3', 'end']].forEach(function (m) {
    var xs = r.cases.filter(function (k) { return k.section === m[0]; }), st = r0.cases.filter(function (k) { return k.section === m[1]; });
    assert.strictEqual(xs.length, st.length);
    xs.forEach(function (k, i) {
      ['n', 'A', 'dg', 'T', 'rnd_gauge', 'cant', 'wind', 's', 'hc', 'thtot', 'drop'].forEach(function (q) { near(k.params[q], st[i].params[q], 1e-9, m[0] + ' ' + q); });
      k.points.forEach(function (pt, j) { worst = Math.max(worst, Math.abs(pt.c - st[i].points[j].c)); });
      assert.strictEqual(k.min.pt, st[i].min.pt);
    });
    r.methodA.forEach(function (row, j) { near(row['max_' + m[0]], r0.methodA[j]['max_' + m[1]], 1e-9, 'Method A ' + m[0]); });
  });
  assert.ok(worst < 1e-9, 'largest difference ' + worst);
  return 'largest difference ' + worst.toExponential(1) + ' mm';
});

test('Sample sections: every load case, Method A column, profile-top row after the standard rows', function () {
  var p = proj(), o = p.settings['static'], s = E.staticRun(p, o), dmc = s.cars[0];
  assert.deepStrictEqual(dmc.extraSections.map(function (q) { return q.key + ':' + q.name + ':' + q.pos; }), ['x1:Cab door:beyond']);
  var ks = dmc.cases.filter(function (k) { return k.section === 'x1'; });
  assert.deepStrictEqual(ks.map(function (k) { return k.id; }), ['x1_t', 'x1_L1', 'x1_L2', 'x1_c']);
  assert.strictEqual(ks[0].label, 'Cab door – AW0');
  dmc.methodA.forEach(function (row) {
    var em = Math.max.apply(null, ks.map(function (k) { return E.lateralE(k.params, row.h / 1000, o); }));
    near(row.max_x1, row.W - em, 1e-9, 'Method A Cab door at ' + row.h);
  });
  var v = dmc.vertical;
  assert.deepStrictEqual(v.slice(0, 7).map(function (x) { return x.id; }), ['top_int', 'top_ext', 'top_end', 'vc', 'roll', 'uf_body', 'uf_bog'], 'standard rows keep their place');
  assert.strictEqual(v[7].id, 'top_x1');
  assert.strictEqual(E.staticRun(p, o).cars[1].extraSections[0].pos, 'between');
});

test('A wide additional section governs the run; the EN check ignores additional sections', function () {
  var p = proj(function (raw) {
    raw.rs.profiles.push({ name: 'Wide', note: '', points: [{ pt: 'W1', y: 0, z: 3600 }, { pt: 'W2', y: 1500, z: 3200 }, { pt: 'W3', y: 1500, z: 1000 }] });
    raw.sections.push({ car: 'MC', name: 'Wide step', ref_end: 'end1', dist_m: 10.5, profile: 'Wide' });
  });
  var o = JSON.parse(JSON.stringify(p.settings['static'])); o.en_check = 'yes';
  var s = E.staticRun(p, o);
  assert.strictEqual(s.governing.car, 'MC'); assert.ok(/^Wide step – /.test(s.governing.label), s.governing.label);
  assert.ok(s.governing.c < 0 && !s.ok);
  var s0 = E.staticRun(proj(), o);
  assert.deepStrictEqual(s.cars[2].en.rows, s0.cars[2].en.rows, 'EN rows unchanged');
  return 'governing ' + s.governing.label + ' ' + s.governing.c.toFixed(1) + ' mm';
});

test('Validation of additional sections', function () {
  assert.ok(!M.validate(proj()).messages.some(function (m) { return /Additional section/.test(m.text); }), 'sample is clean');
  var v = M.validate(proj(function (raw) {
    raw.sections = [{ car: 'XX', name: 'A', ref_end: 'end1', dist_m: 1, profile: 'Roof section' },
      { car: 'TC', name: '', ref_end: 'end1', dist_m: 25, profile: 'Nope' },
      { car: 'MC', name: 'G', ref_end: 'end2', dist_m: null, profile: '' },
      { car: 'MC', name: 'G', ref_end: 'end2', dist_m: 1, profile: 'Roof section' }];
  }));
  assert.ok(has(v, 'err', /car type "XX" is not defined/) && has(v, 'err', /has no name/) && has(v, 'err', /beyond the body length/));
  assert.ok(has(v, 'err', /"Nope" is not defined/) && has(v, 'err', /distance from the body end is empty/) && has(v, 'err', /no RS profile chosen/) && has(v, 'err', /name is used twice/));
});

test('Excel: the Sections sheet of the train tab round-trips', function () {
  var P = proj(), wb = IO.readWorkbookBytes(new Uint8Array(IO.workbookBytes(IO.tabWorkbook('train', P))));
  assert.ok(wb.SheetNames.indexOf('Sections') >= 0);
  var q = IO.importWorkbook(wb, M.emptyProject(), { tab: 'train' }).project;
  assert.deepStrictEqual(q.sections, P.sections);
});

test('Standard sections measured from the body ends (hand values)', function () {
  var g = E.carGeometry({ length_m: 21.7, n_free_m: 3.5, n_art_m: 0, end1: 'free', end2: 'free', ni_m: 7.35, na_m: 2.173 });
  assert.ok(Math.abs(g.int_e1 - 10.85) < 1e-9 && Math.abs(g.int_e2 - 10.85) < 1e-9);
  assert.ok(Math.abs(g.ext_e1 - 1.327) < 1e-9 && Math.abs(g.ext_e2 - 1.327) < 1e-9);
  var h = E.carGeometry({ length_m: 18, n_free_m: 3, n_art_m: 0.5, end1: 'free', end2: 'shared', ni_m: null, na_m: 2 });
  assert.ok(Math.abs(h.int_e1 - (3 + h.a / 2)) < 1e-9 && Math.abs(h.ext_e1 - 1) < 1e-9 && h.ext_e2 === null, 'exterior beyond a 0,5 m shared overhang: none at end 2');
});

module.exports = tests;
