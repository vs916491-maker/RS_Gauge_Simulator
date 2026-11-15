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
// run options (settings) are kept in the project file, not in the inputs workbook
function inputs(p) { var o = copy(p); delete o.name; delete o.notes; delete o.fictional; delete o.settings; return JSON.stringify(o); }
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
  var csv = 'Profile,Point,Y,Z\nKE A,A,0,3.93\nKE A,B,0.5625,3.93\nKE A,C,1.36,3.5\nKE B,A,0,3.9\nKE B,B,1.2,3.4\nKE B,C,1.3,0.1\n';
  var r = IO.importWorkbook(IO.readWorkbookBytes(csv, true), M.emptyProject(), { tab: 'ke' });
  assert.deepStrictEqual(r.project.ke.profiles.map(function (p) { return p.name; }), ['KE A', 'KE B']);
  assert.strictEqual(r.project.ke.profiles[0].points[1].y, 562.5);
  assert.strictEqual(r.project.ke.profiles[0].points[2].z, 3500);
  assert.ok(r.messages.some(function (m) { return /converted to mm/.test(m.text); }));
});

test('Merge mode adds new profiles and replaces same-named ones', function () {
  var csv = 'Profile,Point,Y,Z\nKE Ballasted,A,0,4100\nKE Ballasted,B,1800,2000\nKE Ballasted,C,0,100\nKE New,A,0,4000\nKE New,B,1700,2000\nKE New,C,0,100\n';
  var r = IO.importWorkbook(IO.readWorkbookBytes(csv, true), P, { tab: 'ke', mode: 'merge' });
  var names = r.project.ke.profiles.map(function (p) { return p.name; });
  assert.deepStrictEqual(names, ['KE Ballastless', 'KE Ballasted', 'KE CCD zone', 'KE New']);
  assert.strictEqual(r.project.ke.profiles[1].points[0].z, 4100);
});

test('Track sheet with a missing required column is refused with a readable message', function () {
  var wb = XL.utils.book_new();
  XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([['Element (element)', 'Chainage end [m] (to_m)'], ['Circular', 100]]), 'Track');
  var r = IO.importWorkbook(wb, P, { tab: 'track' });
  assert.deepStrictEqual(r.imported, []);
  assert.ok(r.messages.some(function (m) { return m.level === 'err' && /Chainage start/.test(m.text); }));
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

test('Workbook-style track rows (labels as in the gauging workbook) are imported', function () {
  var wb = XL.utils.book_new();
  XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet([IO.sheetRows('Track', P)[0], [0, 30, 'Transition', 'L', 0, 900, 0, 30, 80, 0, 'KE Ballastless', 'Open', 'Y', 0, 0, '', '', 'Curve 2']]), 'Track');
  var r = IO.importWorkbook(wb, P, { tab: 'track' }), s = r.project.track.segments[0];
  assert.deepStrictEqual([s.element, s.side, s.R_end_m, s.cant_end_mm, s.location, s.wind, s.remarks], ['transition', 'L', 900, 30, 'open', 'Y', 'Curve 2']);
});

test('Static results workbook has the summary, build-up, points, Method A, EN (when selected), vertical and derived sheets', function () {
  var E = require('../js/engine.js'), res = E.staticRun(P, P.settings['static']);
  var wb = IO.readWorkbookBytes(new Uint8Array(IO.workbookBytes(IO.staticResultsWorkbook(res, P, { stale: false }))));
  assert.deepStrictEqual(wb.SheetNames, ['Static_Summary', 'Static_BuildUp', 'Static_Points', 'Method_A', 'EN15273_MaxGauge', 'EN15273_Check', 'EN15273_Vertical', 'EN15273_DoorsSteps', 'EN15273_BogieParts', 'CCD_Static', 'Vertical_Checks', 'Derived_Values']);
  var pts = XL.utils.sheet_to_json(wb.Sheets.Static_Points, { header: 1 });
  assert.strictEqual(pts.length - 1, res.cars.reduce(function (n, c) { return n + c.cases.reduce(function (m, k) { return m + k.points.length; }, 0); }, 0));
  var ec = XL.utils.sheet_to_json(wb.Sheets.EN15273_Check, { header: 1 });
  assert.strictEqual(ec.length - 1, res.cars.reduce(function (n, c) { return n + c.en.checks.int.points.length + c.en.checks.ext.points.length + c.en.checks.end.points.length; }, 0));
  // without the EN check: no EN sheets
  var o = JSON.parse(JSON.stringify(P.settings['static'])); o.en_check = 'no';
  var wb2 = IO.readWorkbookBytes(new Uint8Array(IO.workbookBytes(IO.staticResultsWorkbook(E.staticRun(P, o), P, { stale: false }))));
  assert.deepStrictEqual(wb2.SheetNames, ['Static_Summary', 'Static_BuildUp', 'Static_Points', 'Method_A', 'CCD_Static', 'Vertical_Checks', 'Derived_Values']);
  // static gauge method only: its own sheet, one row per point, top and lower part
  o.en_static = 'yes';
  var r3 = E.staticRun(P, o), wb3 = IO.readWorkbookBytes(new Uint8Array(IO.workbookBytes(IO.staticResultsWorkbook(r3, P, { stale: false }))));
  assert.ok(wb3.SheetNames.indexOf('EN15273_Static') > 0);
  var sc = XL.utils.sheet_to_json(wb3.Sheets.EN15273_Static, { header: 1 });
  assert.strictEqual(sc.length - 1, r3.cars.reduce(function (n, c) { var q = c.enStatic; return n + q.checks.int.points.length + q.checks.ext.points.length + q.checks.end.points.length + 3 + q.lower.length; }, 0));
});

test('Project file: save/parse round trip, wrong format and newer version are refused', function () {
  var back = IO.parseProject(IO.projectJson(P));
  assert.strictEqual(JSON.stringify(back), JSON.stringify(P));
  assert.throws(function () { IO.parseProject('{"format":"rssec-project"}'); }, /not a gauge simulator project/);
  assert.throws(function () { IO.parseProject('{"format":"rsgauge-project","version":99}'); }, /newer version/);
  assert.strictEqual(IO.parseProject('{"format":"rsgauge-project","version":1}').version, 2, 'version 1 is migrated');
  assert.throws(function () { IO.parseProject('nope'); }, /not valid JSON/);
  assert.strictEqual(IO.fileSlug('My bid / v2'), 'My-bid-v2');
});

module.exports = tests;
