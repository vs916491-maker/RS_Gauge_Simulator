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
  var p = M.normalizeProject({ train: { n_cars: '4', vehicle_type: 'weird', bogie_arrangement: 'shared_one', carTypes: [{ name: 'A', ni_m: '' }] }, bogies: [{ name: 'X', p_m: '2,5' }],
    track: { segments: [{ from_m: 0, to_m: 10, element: 'Circular', location: 'PLATFORM', wind: 'n' }] } });
  assert.strictEqual(p.train.n_cars, 4);
  assert.strictEqual(p.train.gauge_mm, 1435);
  assert.strictEqual(p.train.vehicle_type, 'metro', 'unknown select value falls back to the default');
  assert.strictEqual(p.train.bogie_arrangement, undefined, 'retired train-level bogie arrangement is dropped');
  assert.strictEqual(p.bogies[0].p_m, 2.5);
  assert.strictEqual(p.train.carTypes[0].ni_m, null, 'optional blank stays blank (= a/2)');
  var s = p.track.segments[0];
  assert.deepStrictEqual([s.element, s.location, s.wind], ['circular', 'platform', 'N'], 'select labels matched case-insensitively');
});

test('A car body record is created for every car type', function () {
  var raw = copy(sample); raw.bodies = [];
  var p = M.normalizeProject(raw);
  assert.strictEqual(p.bodies[0].s_tare, 0.3, 'defaults');
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

test('Pivot distance, section positions and profile references are checked', function () {
  var raw = copy(sample);
  raw.train.carTypes[0].n_free_m = 11; raw.train.carTypes[1].na_m = 4; raw.train.carTypes[2].prof_ext = 'Nope';
  var v = M.validate(M.normalizeProject(raw));
  assert.ok(has(v, 'train', 'err', /pivot distance a = Lb − n1 − n2 = -0.40 m is not positive/));
  assert.ok(has(v, 'train', 'warn', /exterior section na \(4 m\) is beyond the car-end overhang/));
  assert.ok(has(v, 'train', 'err', /RS profile "Nope" is not defined/));
});

test('Version-1 project files are migrated (renamed fields, track elements)', function () {
  var v1 = { format: 'rsgauge-project', version: 1, train: { carTypes: [{ name: 'A', length_m: 20, na1_m: 3, na2_m: 2.8, mass_laden_t: 50, cg_laden_mm: 1700 }] },
    bodies: [{ car: 'A', s_laden: 0.33, hc_mm: 600 }], bogies: [{ name: 'B', sec_rebound_mm: 25 }],
    track: { params: { gauge_tol_mm: 4, crosslevel_tol_mm: 7 }, segments: [{ from_m: 0, to_m: 100, element: 'C1', R_m: 400, side: 'R', cant_mm: 90, section: 'elevated' }] } };
  var p = M.normalizeProject(v1), c = p.train.carTypes[0], s = p.track.segments[0];
  assert.strictEqual(p.version, 2);
  var crush = p.loads.cars.filter(function (r) { return r.car === 'A' && r.load === 'AW4'; })[0];
  assert.deepStrictEqual([c.n_free_m, crush.mass_t, crush.cg_mm, c.mass_crush_t], [3, 50, 1700, undefined], 'v1 laden mass → crush load row');
  assert.deepStrictEqual([p.bodies[0].s_crush, p.bodies[0].hc_tare_mm, p.bodies[0].hc_crush_mm, p.bogies[0].up_sec_mm], [0.33, 600, 600, 25]);
  assert.deepStrictEqual([p.track.params.g_tol_mm, p.track.params.cl_err_mm], [4, 7]);
  assert.deepStrictEqual([s.element, s.R_start_m, s.R_end_m, s.cant_start_mm, s.location, s.remarks], ['circular', 400, 400, 90, 'open', 'C1']);
});

test('Vehicle-type presets replace values but keep names, formation, profiles and track', function () {
  require('../js/presets.js');
  var p = M.normalizeProject(sample), q = M.applyVehicleType(p, global.RSGAUGE.presets.vehicleTypes, 'hs');
  assert.strictEqual(q.train.carTypes[0].length_m, 25); assert.strictEqual(q.bogies[0].p_m, 2.5); assert.strictEqual(q.track.params.cantdef_max_mm, 150);
  assert.deepStrictEqual(q.train.carTypes.map(function (c) { return c.name + c.prof_ext + c.bogie2; }), p.train.carTypes.map(function (c) { return c.name + c.prof_ext + c.bogie2; }));
  assert.deepStrictEqual(q.track.segments, p.track.segments); assert.strictEqual(q.train.formation, p.train.formation);
  assert.throws(function () { M.applyVehicleType(p, global.RSGAUGE.presets.vehicleTypes, 'xx'); }, /Unknown vehicle type/);
});

test('Profiles: negative Y, too few points and metre-looking values are reported', function () {
  var raw = copy(sample);
  raw.ke.profiles[0].points[3].y = -5;
  raw.rs.profiles[0].points = [{ pt: 'a', y: 0, z: 3.7 }, { pt: 'b', y: 1.4, z: 3.0 }, { pt: 'c', y: 0, z: 1.0 }];
  raw.rs.profiles[1].points = raw.rs.profiles[1].points.slice(0, 2);
  raw.ke.profiles[1].n_up = 40;
  var v = M.validate(M.normalizeProject(raw));
  assert.ok(has(v, 'ke', 'err', /Y must be ≥ 0/));
  assert.ok(has(v, 'rs', 'warn', /looks like it is in metres/));
  assert.ok(has(v, 'rs', 'err', /at least 3 points/));
  assert.ok(has(v, 'ke', 'err', /n_up \(40\) is larger than the number of points/));
});

test('Track: overlap, gap, missing hand, reversed chainage, unknown KE / SOD and small radius are reported', function () {
  var raw = copy(sample), s = raw.track.segments;
  s[1].from_m = 100;                 // overlap with segment 1 (0-135)
  s[3].from_m = 470;                 // gap 460-470
  s[4].side = '';                    // curve without hand
  s[5].to_m = 700;                   // end < start
  s[6].ke = 'Nope'; s[7].sod = 'Nope';
  s[10].R_start_m = s[10].R_end_m = 120;
  var v = M.validate(M.normalizeProject(raw));
  assert.ok(has(v, 'track', 'err', /overlaps the previous segment/));
  assert.ok(has(v, 'track', 'warn', /Gap in the track data between 460 m and 470 m/));
  assert.ok(has(v, 'track', 'err', /curve without a hand/));
  assert.ok(has(v, 'track', 'err', /chainage end must be greater/));
  assert.ok(has(v, 'track', 'err', /KE "Nope" not found/));
  assert.ok(has(v, 'track', 'err', /SOD profile "Nope" not found/));
  assert.ok(has(v, 'track', 'warn', /R = 120 m is below 150 m/));
});

test('fullProfile mirrors a half-profile into a closed outline without doubling centre-line points', function () {
  var f = M.fullProfile([{ y: 0, z: 10 }, { y: 5, z: 8 }, { y: 5, z: 0 }, { y: 0, z: 0 }]);
  assert.deepStrictEqual(f, [{ y: 0, z: 10 }, { y: 5, z: 8 }, { y: 5, z: 0 }, { y: 0, z: 0 }, { y: -5, z: 0 }, { y: -5, z: 8 }, { y: 0, z: 10 }]);
});

test('toMillimetres converts metre coordinates only', function () {
  var c = M.toMillimetres([{ y: 0, z: 3.93 }, { y: 1.3625, z: 3.5 }]);
  assert.ok(c.converted); assert.strictEqual(c.points[0].z, 3930); assert.strictEqual(c.points[1].y, 1362.5);
  assert.ok(!M.toMillimetres([{ y: 0, z: 3930 }]).converted);
});

test('Every schema field has a unique key within its list and a label', function () {
  ['trainFields', 'carType', 'bogie', 'body', 'customerLimits', 'enParams', 'sodSettings', 'point', 'sodItem', 'keProfile', 'rsProfile', 'trackParams', 'segment', 'staticOptions'].forEach(function (n) {
    var seen = {};
    S[n].forEach(function (fd) { assert.ok(fd.k && fd.l, n + ': field without key/label'); assert.ok(!seen[fd.k], n + ': duplicate key ' + fd.k); seen[fd.k] = 1; });
  });
});

module.exports = tests;

test('Formation layout orients each car to its neighbours and flags mismatched joints (Load definition)', function () {
  var D = { name: 'D', end1: 'free', end2: 'free', bogie1: 'M', bogie2: 'T' }, A = { name: 'A', end1: 'free', end2: 'shared', bogie1: 'T', bogie2: 'J' };
  var B = { name: 'B', end1: 'shared', end2: 'free', bogie1: 'J', bogie2: 'T' }, C = { name: 'C', end1: 'shared', end2: 'shared', bogie1: 'J', bogie2: 'J' };
  function lay(f, ct) { return M.formationLayout({ formation: f, carTypes: ct }); }
  var l = lay('D-D-D', [D]);
  assert.deepStrictEqual(l.cars.map(function (c) { return c.rev; }), [false, false, true], 'last car reversed, cab end outwards');
  assert.deepStrictEqual([l.joints.length, l.issues.length], [2, 0]);
  l = lay('A-A', [A]);   // semi-articulated pair of one car type: the second car is turned round
  assert.deepStrictEqual(l.cars.map(function (c) { return c.rev; }), [false, true]);
  assert.deepStrictEqual([l.joints[0].shared, l.issues.length], [true, 0]);
  l = lay('D-A-C-B-D', [D, A, B, C]);
  assert.deepStrictEqual(l.joints.map(function (j) { return j.shared; }), [false, true, true, false]);
  assert.strictEqual(l.issues.length, 0);
  l = lay('A-D', [A, D]);
  assert.ok(!l.joints[0].ok && /one side of the joint is a shared bogie/.test(l.issues[0]));
  l = lay('A-B', [A, { name: 'B', end1: 'shared', end2: 'free', bogie1: 'X', bogie2: 'T' }]);
  assert.ok(l.joints[0].shared && !l.joints[0].bogieOk && /different bogie types/.test(l.issues[0]));
  assert.ok(/single car cannot have a shared end/.test(lay('C', [C]).issues[0]));
  var raw = JSON.parse(JSON.stringify(sample)); raw.train.carTypes[0].end2 = 'shared';
  var v = M.validate(M.normalizeProject(raw));
  assert.ok(has(v, 'train', 'warn', /Bogie arrangement – Cars 1 \(DMC\) and 2 \(TC\): one side of the joint is a shared bogie/));
});
