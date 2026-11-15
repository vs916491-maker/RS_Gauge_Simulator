'use strict';
// Calculation Method tab (js/calcsteps.js): every step has references and, with runs available, an example
// whose numbers are the engine's.
var assert = require('assert');
var M = require('../js/model.js'), E = require('../js/engine.js'), CS = require('../js/calcsteps.js');
var SAMPLE = require('../samples/sample-project.json');
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function ctx(withDyn) {
  var p = M.normalizeProject(JSON.parse(JSON.stringify(SAMPLE))), s = E.staticRun(p, p.settings['static']), sw = E.swayEval(p, p.settings['static']);
  return { p: p, sres: s, dres: withDyn ? E.dynamicRun(p, p.settings['static'], p.settings.dynamic) : null, car: null, caseId: null, ch: null, sway: sw, plan: E.gaugeTestPlan(p, s, sw) };
}

test('Calculation steps: four parts, references on every step, examples from the engine', function () {
  var c = ctx(true), st = CS.steps(c);
  assert.deepStrictEqual(st.map(function (x) { return x.part; }).filter(function (v, i, a) { return a.indexOf(v) === i; }),
    ['A. Concepts', 'B. Static check', 'C. Dynamic check along the line', 'D. Test calculations']);
  st.forEach(function (x) { assert.ok(x.refs && x.refs.length && x.text && x.text.length, x.id + ' has references and text'); });
  st.filter(function (x) { return x.part !== 'A. Concepts'; }).forEach(function (x) { assert.ok(x.example && x.example.rows.length, x.id + ' has an example'); });
  // governing case by default, numbers equal to the engine
  var b7 = st.filter(function (x) { return x.id === 'methodB'; })[0], g = c.sres.governing;
  assert.ok(JSON.stringify(b7.example.rows).indexOf(g.c.toFixed(2)) > 0, 'governing clearance shown');
  var docs = {}; st.forEach(function (x) { x.refs.forEach(function (r) { docs[r.doc] = 1; }); });
  ['EN 15273-1', 'EN 15273-2', 'EN 15273-3', 'UIC 505-1', 'UIC 505-4', 'UIC 505-5', 'Metro SOD practice'].forEach(function (d) { assert.ok(docs[d], d + ' referenced'); });
  return st.length + ' steps';
});

test('Calculation steps: selected car type, case and chainage drive the examples; missing runs give a hint', function () {
  var c = ctx(true); c.car = 'MC'; c.caseId = 'end_c'; c.ch = 1990;
  var st = CS.steps(c), b1 = st.filter(function (x) { return x.id === 'geometry'; })[0], c1 = st.filter(function (x) { return x.id === 'track'; })[0];
  assert.strictEqual(b1.example.rows[0][1], 'MC / Car end – AW4');
  assert.ok(/1990\.0 m/.test(c1.example.rows[0][1]), c1.example.rows[0][1]);
  var none = CS.steps({ p: c.p, sres: null, dres: null, sway: [], plan: [] });
  none.filter(function (x) { return x.part !== 'A. Concepts'; }).forEach(function (x) { assert.ok(!x.example && x.nodata, x.id + ' gives a hint'); });
  var noEn = CS.steps(ctx(false)).filter(function (x) { return x.id === 'en'; })[0];
  assert.ok(noEn.example, 'sample has the EN check on');
});

module.exports = tests;
