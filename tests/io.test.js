'use strict';
var assert = require('assert');
global.XLSX = require('../vendor/xlsx.full.min.js');
var IO = require('../js/io.js'), M = require('../js/model.js');
var XL = global.XLSX;
var sample = require('../samples/sample-project.json');
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function copy(o) { return JSON.parse(JSON.stringify(o)); }
function reread(wb) { return IO.readWorkbookBytes(new Uint8Array(IO.workbookBytes(wb))); }
function inputs(p) { var o = copy(p); delete o.name; delete o.notes; delete o.fictional; return JSON.stringify(o); }
var P = M.normalizeProject(sample);

test('Export all inputs -> import into an empty project gives the same inputs', function () {
  var r = IO.importWorkbook(reread(IO.allInputsWorkbook(P)), M.emptyProject(), { tab: 'all' });
  assert.strictEqual(r.messages.filter(function (m) { return m.level !== 'ok'; }).length, 0, JSON.stringify(r.messages));
  assert.strictEqual(r.imported.length, IO.ALL_SHEETS.length);
  assert.strictEqual(inputs(r.project), inputs(P));
});

test('Each tab template round-trips and only changes its own tab', function () {
  var base = M.emptyProject();
  Object.keys(IO.TAB_SHEETS).forEach(function (tab) {
    var r = IO.importWorkbook(reread(IO.tabWorkbook(tab, P)), base, { tab: tab });
    assert.deepStrictEqual(r.imported, IO.TAB_SHEETS[tab], tab + ': ' + JSON.stringify(r.messages));
    if (tab === 'track') { assert.deepStrictEqual(r.project.track, P.track); assert.deepStrictEqual(r.project.ke.profiles, []); }
    if (tab === 'rs') { assert.deepStrictEqual(r.project.rs, P.rs); assert.deepStrictEqual(r.project.track.segments, []); }
  });
});

test('Importing does not change the project passed in', function () {
  var p = M.normalizeProject(sample), before = JSON.stringify(p);
  IO.importWorkbook(reread(IO.tabWorkbook('ke', M.emptyProject())), p, { tab: 'ke' });
  assert.strictEqual(JSON.stringify(p), before);
});

test('KE CSV with plain headers and metre values is imported and converted to mm', function () {
  var csv = 'Profile,Point,Y,Z\nKE A,A,0,3.916\nKE A,B,0.4707,3.916\nKE A,C,1.38,3.446\nKE B,A,0,3.9\nKE B,B,1.2,3.4\nKE B,C,1.3,0.1\n';
  var r = IO.importWorkbook(IO.readWorkbookBytes(csv, true), M.emptyProject(), { tab: 'ke' });
  assert.deepStrictEqual(r.project.ke.profiles.map(function (p) { return p.name; }), ['KE A', 'KE B']);
  assert.strictEqual(r.project.ke.profiles[0].points[1].y, 470.7);
  assert.strictEqual(r.project.ke.profiles[0].points[2].z, 3446);
  assert.ok(r.messages.some(function (m) { return /converted to mm/.test(m.text); }));
});

test('Merge mode adds new profiles and replaces same-named ones', function () {
  var csv = 'Profile,Point,Y,Z\nKE Ballasted,A,0,4100\nKE Ballasted,B,1800,2000\nKE Ballasted,C,0,100\nKE New,A,0,4000\nKE New,B,1700,2000\nKE New,C,0,100\n';
  var r = IO.importWorkbook(IO.readWorkbookBytes(csv, true), P, { tab: 'ke', mode: 'merge' });
  var names = r.project.ke.profiles.map(function (p) { return p.name; });
  assert.deepStrictEqual(names, ['KE Ballastless', 'KE Ballasted', 'KE New']);
  assert.strictEqual(r.project.ke.profiles[1].points[0].z, 4100);
});

test('Track sheet with a missing required column is refused with a readable message', function () {
  var wb = XL.utils.book_new();
  XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([['Element (element)', 'Chainage to [m] (to_m)'], ['C1', 100]]), 'Track');
  var r = IO.importWorkbook(wb, P, { tab: 'track' });
  assert.deepStrictEqual(r.imported, []);
  assert.ok(r.messages.some(function (m) { return m.level === 'err' && /Chainage from/.test(m.text); }));
  assert.strictEqual(r.project, P, 'project unchanged when nothing imported');
});

test('A workbook without the expected sheets is refused', function () {
  var wb = XL.utils.book_new();
  XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([['x']]), 'A'); XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([['y']]), 'B');
  var r = IO.importWorkbook(wb, P, { tab: 'rs' });
  assert.ok(r.messages.some(function (m) { return m.level === 'err' && /None of the expected sheets/.test(m.text); }));
});

test('Grid sheet accepts extra car type columns added by the user', function () {
  var rows = IO.sheetRows('CarTypes', P);
  rows[0].push('Item 4');
  rows.slice(1).forEach(function (r, i) { r.push(i === 0 ? 'TCX' : r[r.length - 1]); });
  var wb = XL.utils.book_new(); XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet(rows), 'CarTypes');
  var r = IO.importWorkbook(wb, P, { tab: 'train' });
  assert.deepStrictEqual(r.project.train.carTypes.map(function (c) { return c.name; }), ['DMC', 'TC', 'MC', 'TCX']);
  assert.ok(r.project.bodies.some(function (b) { return b.car === 'TCX'; }), 'car body record added');
});

test('Project file: save/parse round trip, wrong format and newer version are refused', function () {
  var back = IO.parseProject(IO.projectJson(P));
  assert.strictEqual(JSON.stringify(back), JSON.stringify(P));
  assert.throws(function () { IO.parseProject('{"format":"rssec-project"}'); }, /not a gauge simulator project/);
  assert.throws(function () { IO.parseProject('{"format":"rsgauge-project","version":99}'); }, /newer version/);
  assert.throws(function () { IO.parseProject('nope'); }, /not valid JSON/);
  assert.strictEqual(IO.fileSlug('My bid / v2'), 'My-bid-v2');
});

module.exports = tests;
