'use strict';
// Load definition (METHOD §4.1a): any number of load cases, masses per car type, interpolation of blank values,
// every case calculated; migration of older files (tare / crush on the car type).
var assert = require('assert');
global.XLSX = require('../vendor/xlsx.full.min.js');
var E = require('../js/engine.js'), M = require('../js/model.js'), IO = require('../js/io.js');
var XL = global.XLSX;
var sample = require('../samples/sample-project.json');
var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function near(a, b, tol, what) { assert.ok(Math.abs(a - b) <= (tol || 1e-9), (what || '') + ': ' + a + ' vs ' + b); }
function proj(edit) { var raw = JSON.parse(JSON.stringify(sample)); if (edit) { edit(raw); } return M.normalizeProject(raw); }
function row(p, car, load) { return p.loads.cars.filter(function (r) { return r.car === car && r.load === load; })[0]; }
function has(v, level, re) { return v.messages.some(function (m) { return m.tab === 'train' && m.level === level && re.test(m.text); }); }

test('Sample: four load cases, 3 sections × 4 cases per car type, ids and labels', function () {
  var p = proj(), r = E.staticRun(p, p.settings['static']), c = r.cars[1];
  assert.deepStrictEqual(p.loads.cases.map(function (x) { return x.name + ':' + x.role; }), ['AW0:tare', 'AW2:other', 'AW3:other', 'AW4:crush']);
  assert.deepStrictEqual(c.cases.map(function (k) { return k.id; }), ['int_t', 'int_L1', 'int_L2', 'int_c', 'ext_t', 'ext_L1', 'ext_L2', 'ext_c', 'end_t', 'end_L1', 'end_L2', 'end_c']);
  assert.strictEqual(c.cases[5].label, 'Exterior – AW2');
  return c.cases.length + ' cases for ' + c.car;
});

test('Blank values of an other case are interpolated by mass (Δz, s, hc); wind coefficient from its own mass', function () {
  var p = proj(), o = p.settings['static'], tc = p.train.carTypes[1], d = E.deriveCar(p, tc, o), b = p.bodies[1];
  var t = row(p, 'TC', 'AW0'), c = row(p, 'TC', 'AW4'), a2 = row(p, 'TC', 'AW2'), L = d.loads[1];
  var f = (a2.mass_t - t.mass_t) / (c.mass_t - t.mass_t);
  near(L.dz, f * c.dz_mm, 1e-12, 'Δz');
  near(L.s, b.s_tare + f * (b.s_crush - b.s_tare), 1e-12, 's');
  near(L.hc, (b.hc_tare_mm + f * (b.hc_crush_mm - b.hc_tare_mm)) / 1000, 1e-12, 'hc');
  var body = b, Aw = (d.geo.Lb) * (body.wind_top_mm - body.wind_bot_mm) / 1000;
  near(L.Cw, 0.5 * p.train.rho_air * body.Cf * Aw * p.train.Beq_mm / (a2.mass_t * 1000 * 9.81) / (3.6 * 3.6), 1e-15, 'Cw');
  // the case uses them
  var k = E.staticRun(p, o).cars[1].cases.filter(function (x) { return x.id === 'ext_L1'; })[0];
  near(k.params.s, L.s, 0, 'case s'); near(k.params.drop, L.dz, 0, 'case drop'); near(k.params.wind, L.Cw * Math.pow(p.track.params.wind_open_kmh, 2), 1e-12, 'case wind');
  // an entered value is used as it is (MC AW3 Δz = 18 mm)
  assert.strictEqual(E.deriveCar(p, p.train.carTypes[2], o).loads[2].dz, 18);
  return 'TC AW2: f ' + f.toFixed(4) + ', s ' + L.s.toFixed(4) + ', Δz ' + L.dz.toFixed(2) + ' mm';
});

test('Tare and crush keep the car-body values; an entered s / hc on an other case is used', function () {
  var p = proj(function (raw) { raw.loads.cars[5].s = 0.33; raw.loads.cars[5].hc_mm = 600; }), o = p.settings['static'];
  var d = E.deriveCar(p, p.train.carTypes[1], o);
  assert.deepStrictEqual([d.loads[0].s, d.loads[3].s, d.loads[0].hc, d.loads[3].hc], [d.s_t, d.s_c, d.hc_t, d.hc_c]);
  assert.deepStrictEqual([d.loads[1].s, d.loads[1].hc], [0.33, 0.6]);
  // deflated lateral state: the deflated values for every case
  var od = JSON.parse(JSON.stringify(o)); od.lat_state = 'deflated';
  var dd = E.deriveCar(p, p.train.carTypes[1], od);
  assert.ok(dd.loads.every(function (L) { return L.s === p.bodies[1].s_defl; }));
});

test('Theoretical s and hc of an other case = the tare formula with its mass, CG and kz2 interpolated by mass', function () {
  var p = proj(), o = JSON.parse(JSON.stringify(p.settings['static'])); o.flex = 'theoretical';
  var d = E.deriveCar(p, p.train.carTypes[2], o), L = d.loads[2], th = d.theoretical.loads[2];
  var t = row(p, 'MC', 'AW0'), c = row(p, 'MC', 'AW4'), a3 = row(p, 'MC', 'AW3'), f = (a3.mass_t - t.mass_t) / (c.mass_t - t.mass_t);
  // same car with the tare row replaced by AW3 and kz2 tare = the interpolated stiffness
  var q = proj(function (raw) {
    raw.bogies.forEach(function (b) { b.kz2_t = b.kz2_t + f * (b.kz2_c - b.kz2_t); });
    var r0 = raw.loads.cars.filter(function (r) { return r.car === 'MC' && r.load === 'AW0'; })[0]; r0.mass_t = a3.mass_t; r0.cg_mm = a3.cg_mm;
  });
  var ref = E.deriveCar(q, q.train.carTypes[2], o).theoretical.tare;
  near(th.s, ref.s, 1e-12, 's'); near(th.hc, ref.hc, 1e-12, 'hc'); near(L.s, th.s, 0, 'used s'); near(L.hc, th.hc, 0, 'used hc');
  return 'MC AW3 theoretical s ' + th.s.toFixed(4) + ', hc ' + (th.hc * 1000).toFixed(1) + ' mm';
});

test('Method A takes the largest E of all load cases of a section; vertical roll from the crush case', function () {
  var p = proj(), o = p.settings['static'], c = E.staticRun(p, o).cars[0];
  c.methodA.forEach(function (r) {
    ['int', 'ext', 'end'].forEach(function (sec) {
      var em = Math.max.apply(null, c.cases.filter(function (k) { return k.section === sec; }).map(function (k) { return E.lateralE(k.params, r.h / 1000, o); }));
      near(r['max_' + sec], r.W - em, 1e-9, 'Method A ' + sec + ' at ' + r.h);
    });
  });
  var roll = c.vertical.filter(function (v) { return v.id === 'roll'; })[0].value;
  var crush = c.cases.filter(function (k) { return k.role === 'crush'; });
  near(roll, Math.max.apply(null, crush.map(function (k) { return k.params.thtot; })) * p.bodies[0].uf_hw_mm, 1e-12, 'roll lowering');
});

test('Two load cases AW0 / AW4 give the same result as before (cases, governing, EN)', function () {
  var p = proj(function (raw) { raw.loads.cases.splice(1, 2); raw.loads.cars = raw.loads.cars.filter(function (r) { return r.load === 'AW0' || r.load === 'AW4'; }); });
  var o = JSON.parse(JSON.stringify(p.settings['static'])); o.en_check = 'yes';
  var r = E.staticRun(p, o), q = proj(), rq = E.staticRun(q, o);
  assert.strictEqual(r.cars[0].cases.length, 6);
  // AW2 / AW3 lie between tare and crush: the governing case of the sample stays the TC exterior tare
  assert.deepStrictEqual([r.governing.car, r.governing.id], [rq.governing.car, rq.governing.id]);
  near(r.governing.c, rq.governing.c, 1e-12, 'governing clearance');
  assert.strictEqual(rq.cars[0].en.rows.length, r.cars[0].en.rows.length);
  return 'governing ' + r.governing.car + ' ' + r.governing.label + ' ' + r.governing.c.toFixed(2) + ' mm';
});

test('Axle load and shared-bogie check use the heaviest load case', function () {
  var p = proj(function (raw) { raw.loads.cars.filter(function (r) { return r.car === 'TC' && r.load === 'AW3'; })[0].mass_t = 50; });
  var d = E.deriveCar(p, p.train.carTypes[1], p.settings['static']), g = d.geo;
  var R2 = 50000 * (g.Lb / 2 - g.n1) / g.a, R1 = 50000 - R2;
  near(d.shared.R1, R1, 1e-9, 'R1'); near(d.shared.R2, R2, 1e-9, 'R2');
});

test('Validation: roles, missing rows, empty masses, unknown rows, values ignored and out of range', function () {
  var v = M.validate(proj());
  assert.ok(!v.messages.some(function (m) { return m.tab === 'train' && /Load definition/.test(m.text); }), 'sample is clean');
  v = M.validate(proj(function (raw) { raw.loads.cases[1].role = 'tare'; raw.loads.cases[3].role = 'other'; }));
  assert.ok(has(v, 'err', /more than one load case has the role "tare"/) && has(v, 'err', /no load case has the role "crush"/));
  v = M.validate(proj(function (raw) { raw.loads.cars = raw.loads.cars.filter(function (r) { return !(r.car === 'MC' && r.load === 'AW2'); }); raw.loads.cars[0].mass_t = null; }));
  assert.ok(has(v, 'err', /MC: no mass for load case AW2/) && has(v, 'err', /DMC \/ AW0: sprung car-body mass is empty/));
  v = M.validate(proj(function (raw) {
    raw.loads.cars.push({ car: 'XX', load: 'AW0', mass_t: 20, cg_mm: 1600 });
    raw.loads.cars[0].s = 0.4; raw.loads.cars[1].mass_t = 60; raw.loads.cars[3].dz_mm = null;
  }));
  assert.ok(has(v, 'warn', /car type "XX" is not defined/) && has(v, 'warn', /s and hc of the tare case come from the Car body tab/));
  assert.ok(has(v, 'warn', /DMC \/ AW2: mass outside the tare – crush range/) && has(v, 'err', /DMC \/ AW4: body lowering from tare is needed/));
  assert.ok(M.readiness(v, 'static').ok === false, 'errors block the run');
});

test('Older project: tare / crush on the car type and the load labels become load cases and rows', function () {
  var raw = JSON.parse(JSON.stringify(sample));
  delete raw.loads; raw.train.tare_label = 'L0'; raw.train.laden_label = 'L4'; raw.settings.dynamic.load = 'crush';
  raw.train.carTypes.forEach(function (c, i) { c.mass_tare_t = 20 + i; c.mass_crush_t = 40 + i; c.cg_tare_mm = 1600; c.cg_crush_mm = 1700; c.drop_crush_mm = 20; });
  var p = M.normalizeProject(raw);
  assert.deepStrictEqual(p.loads.cases.map(function (c) { return c.name + ':' + c.role; }), ['L0:tare', 'L4:crush']);
  assert.deepStrictEqual([row(p, 'TC', 'L0').mass_t, row(p, 'TC', 'L4').mass_t, row(p, 'TC', 'L4').dz_mm, row(p, 'TC', 'L0').dz_mm], [21, 41, 20, 0]);
  assert.ok(p.train.carTypes.every(function (c) { return c.mass_tare_t === undefined; }) && p.train.tare_label === undefined);
  assert.strictEqual(p.settings.dynamic.load, 'L4', 'dynamic load "crush" → the crush case');
});

test('Older Excel CarTypes sheet with masses (no CarLoads sheet): masses move to the load rows', function () {
  var P = proj(), rows = IO.sheetRows('CarTypes', P);
  rows.push(['Car body mass tare, sprung m0', 't', 'mass_tare_t', 20, 21, 22], ['Car body mass crush, sprung m4', 't', 'mass_crush_t', 40, 41, 42],
    ['CG height of body tare hG0', 'mm', 'cg_tare_mm', 1600, 1600, 1600], ['CG height of body crush hG4', 'mm', 'cg_crush_mm', 1700, 1700, 1700],
    ['Body lowering tare to crush Δz', 'mm', 'drop_crush_mm', 20, 20, 20]);
  var wb = XL.utils.book_new(); XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet(rows), 'CarTypes');
  var r = IO.importWorkbook(IO.readWorkbookBytes(new Uint8Array(IO.workbookBytes(wb))), M.emptyProject(), { tab: 'train' });
  var p = r.project;
  assert.ok(r.messages.some(function (m) { return /moved to the load cases AW0 \/ AW4/.test(m.text); }), JSON.stringify(r.messages));
  assert.deepStrictEqual([row(p, 'MC', 'AW0').mass_t, row(p, 'MC', 'AW4').mass_t, row(p, 'MC', 'AW4').dz_mm], [22, 42, 20]);
  // the current template round-trips LoadCases and CarLoads
  var q = IO.importWorkbook(IO.readWorkbookBytes(new Uint8Array(IO.workbookBytes(IO.tabWorkbook('train', P)))), M.emptyProject(), { tab: 'train' }).project;
  assert.deepStrictEqual(q.loads, P.loads);
});

test('Vehicle-type preset: masses to the tare and crush rows, other cases keep their place between them', function () {
  require('../js/presets.js');
  var p = proj(), q = M.applyVehicleType(p, global.RSGAUGE.presets.vehicleTypes, 'lrv'), car = global.RSGAUGE.presets.vehicleTypes.types.lrv.car;
  var t0 = row(p, 'TC', 'AW0').mass_t, c0 = row(p, 'TC', 'AW4').mass_t, f = (row(p, 'TC', 'AW2').mass_t - t0) / (c0 - t0);
  assert.deepStrictEqual([row(q, 'TC', 'AW0').mass_t, row(q, 'TC', 'AW4').mass_t, row(q, 'TC', 'AW4').dz_mm], [car.mass_tare_t, car.mass_crush_t, car.drop_crush_mm]);
  near(row(q, 'TC', 'AW2').mass_t, car.mass_tare_t + f * (car.mass_crush_t - car.mass_tare_t), 1e-3, 'AW2 scaled');
});

test('Dynamic calculation with a chosen load case (name), tare and crush words for older settings', function () {
  var p = proj(), d = E.deriveCar(p, p.train.carTypes[1], p.settings['static']);
  var sw = function (load) { var o = JSON.parse(JSON.stringify(p.settings.dynamic)); o.load = load; return E.dynamicRun(p, p.settings['static'], o).summary.xo.v; };
  var a0 = sw('AW0'), a3 = sw('AW3'), a4 = sw('AW4');
  assert.strictEqual(sw('tare'), a0); assert.strictEqual(sw('crush'), a4);
  assert.ok(a3 !== a0 && a3 !== a4, 'AW3 is its own case');
  return 'largest excess outside: AW0 ' + a0.toFixed(1) + ', AW3 ' + a3.toFixed(1) + ', AW4 ' + a4.toFixed(1) + ' mm (' + d.loads.length + ' cases)';
});

test('UI helper: syncLoads adds a blank row per missing car type × case and prunes rows of deleted ones', function () {
  var p = proj();
  p.loads.cases.push({ name: 'AW5', role: 'other', note: '' }); p.loads.cars.push({ car: 'GONE', load: 'AW0', mass_t: 1, cg_mm: 1, dz_mm: 0, s: null, hc_mm: null });
  M.syncLoads(p, true);
  assert.strictEqual(p.loads.cars.length, 3 * 5);
  assert.ok(!p.loads.cars.some(function (r) { return r.car === 'GONE'; }));
  var n = row(p, 'MC', 'AW5'); assert.ok(n && n.mass_t === null && n.dz_mm === null);
  assert.deepStrictEqual(p.loads.cars.slice(0, 5).map(function (r) { return r.load; }), ['AW0', 'AW2', 'AW3', 'AW4', 'AW5'], 'grouped by car, cases in table order');
});

module.exports = tests;
