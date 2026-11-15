'use strict';
var assert = require('assert');
var M = require('../js/model.js'), S = require('../js/schema.js');
var sample = require('../samples/sample-project.json');
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function copy(o) { return JSON.parse(JSON.stringify(o)); }
function has(v, tab, level, re) { return v.messages.some(function (m) { return m.tab === tab && m.level === level && re.test(m.text); }); }

test('Fictional sample is valid (no errors)', function () {
  var v = M.validate(M.normalizeProject(sample));
  assert.strictEqual(v.errors, 0, JSON.stringify(v.messages.filter(function (m) { return m.level === 'err'; })));
  return v.warnings + ' warning(s)';
});

test('normalizeProject never mutates its input and drops prototype keys', function () {
  var raw = copy(sample), before = JSON.stringify(raw);
  var evil = JSON.parse('{"__proto__": {"polluted": 1}, "train": {"constructor": 5}}');
  M.normalizeProject(raw); M.normalizeProject(evil);
  assert.strictEqual(JSON.stringify(raw), before);
  assert.strictEqual({}.polluted, undefined);
});

test('Defaults fill missing fields, numbers from text are converted, unknown select values fall back', function () {
  var p = M.normalizeProject({ train: { n_cars: '4', bogie_arrangement: 'weird' }, bogies: [{ name: 'X', p_m: '2,5', wi_mm: '' , w_mm: 40 }] });
  assert.strictEqual(p.train.n_cars, 4);
  assert.strictEqual(p.train.gauge_mm, 1435);
  assert.strictEqual(p.train.bogie_arrangement, 'non_shared');
  assert.strictEqual(p.bogies[0].p_m, 2.5);
  assert.strictEqual(p.bogies[0].wi_mm, 40, 'blank wi = w');
});

test('A car body record is created for every car type', function () {
  var raw = copy(sample); raw.bodies = [];
  var p = M.normalizeProject(raw);
  assert.deepStrictEqual(p.bodies.map(function (b) { return b.car; }), ['DMC', 'TC', 'MC']);
});

test('Formation, counts and bogie references are checked', function () {
  var raw = copy(sample);
  raw.train.formation = 'DMC-TC-XX-MC-TC-DMC'; raw.train.carTypes[0].bogie2 = 'Q';
  var v = M.validate(M.normalizeProject(raw));
  assert.ok(has(v, 'train', 'err', /"XX", which is not a car type/));
  assert.ok(has(v, 'train', 'err', /bogie type "Q" is not defined/));
  assert.ok(has(v, 'train', 'warn', /Car type MC: count is 2 but it appears 1/));
});

test('Body length versus a + overhangs is checked', function () {
  var raw = copy(sample); raw.train.carTypes[1].length_m = 21.0;
  assert.ok(has(M.validate(M.normalizeProject(raw)), 'train', 'warn', /differs from the body length/));
});

test('Profiles: negative Y, too few points and metre-looking values are reported', function () {
  var raw = copy(sample);
  raw.ke.profiles[0].points[3].y = -5;
  raw.rs.profiles[0].points = [{ pt: 'a', y: 0, z: 3.7 }, { pt: 'b', y: 1.4, z: 3.0 }, { pt: 'c', y: 0, z: 1.0 }];
  raw.rs.profiles[1].points = raw.rs.profiles[1].points.slice(0, 2);
  var v = M.validate(M.normalizeProject(raw));
  assert.ok(has(v, 'ke', 'err', /Y must be ≥ 0/));
  assert.ok(has(v, 'rs', 'warn', /looks like it is in metres/));
  assert.ok(has(v, 'rs', 'err', /at least 3 points/));
});

test('Track: overlap, gap, missing side, reversed chainage, unknown SOD and small radius are reported', function () {
  var raw = copy(sample), s = raw.track.segments;
  s[1].from_m = 450;                 // overlap with segment 1 (0-500)
  s[3].from_m = 1650;                // gap 1600-1650
  s[4].side = '';                    // curve without side
  s[5].to_m = 2000;                  // to < from
  s[6].sod = 'Nope';
  s[9].R_m = 120;
  var v = M.validate(M.normalizeProject(raw));
  assert.ok(has(v, 'track', 'err', /overlaps the previous segment/));
  assert.ok(has(v, 'track', 'warn', /Gap in the track data between 1600 m and 1650 m/));
  assert.ok(has(v, 'track', 'err', /curve without a side/));
  assert.ok(has(v, 'track', 'err', /chainage to must be greater/));
  assert.ok(has(v, 'track', 'err', /SOD profile "Nope" not found/));
  assert.ok(has(v, 'track', 'warn', /R = 120 m is below 150 m/));
});

test('fullProfile mirrors a half-profile into a closed outline without doubling centre-line points', function () {
  var f = M.fullProfile([{ y: 0, z: 10 }, { y: 5, z: 8 }, { y: 5, z: 0 }, { y: 0, z: 0 }]);
  assert.deepStrictEqual(f, [{ y: 0, z: 10 }, { y: 5, z: 8 }, { y: 5, z: 0 }, { y: 0, z: 0 }, { y: -5, z: 0 }, { y: -5, z: 8 }, { y: 0, z: 10 }]);
});

test('toMillimetres converts metre coordinates only', function () {
  var c = M.toMillimetres([{ y: 0, z: 3.916 }, { y: 1.38, z: 3.446 }]);
  assert.ok(c.converted); assert.strictEqual(c.points[0].z, 3916); assert.strictEqual(c.points[1].y, 1380);
  assert.ok(!M.toMillimetres([{ y: 0, z: 3916 }]).converted);
});

test('Every schema field has a unique key within its list and a label', function () {
  ['trainFields', 'carType', 'bogie', 'body', 'enParams', 'sodSettings', 'point', 'sodItem', 'rsProfile', 'trackParams', 'segment'].forEach(function (n) {
    var seen = {};
    S[n].forEach(function (fd) { assert.ok(fd.k && fd.l, n + ': field without key/label'); assert.ok(!seen[fd.k], n + ': duplicate key ' + fd.k); seen[fd.k] = 1; });
  });
});

module.exports = tests;
