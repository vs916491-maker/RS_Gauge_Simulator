'use strict';
// EN 15273-2 dynamic method (METHOD §15, Annex O): displacements O.4–O.18, rigid-body sections, curving, case choice,
// tangent and line checks, model validation (Tables O.1–O.3, Figure O.1) and the O.6 import. Fictional data only.
var assert = require('assert');
global.XLSX = require('../vendor/xlsx.full.min.js');
var E = require('../js/engine.js');
var M = require('../js/model.js');
var IO = require('../js/io.js');
var tests = [];
function sample() { return M.normalizeProject(JSON.parse(JSON.stringify(require('../samples/sample-project.json')))); }
function near(a, b, t) { return Math.abs(a - b) < (t || 1e-9); }
var K = 3 / Math.SQRT2;

tests.push({ name: 'O.11–O.18 displacements and O.4–O.9 deficiency cases by hand; centre datum from O.1–O.3', fn: function () {
  var t = { y_mean: 10, y_sd: 2, z_mean: 5, z_sd: 1, th_mean: 8, th_sd: 1.5 }, d = E.simDisp(t, K, 20);
  assert.ok(near(d.dpl, 10 + K * 2) && near(d.hd, 5 + K + 20) && near(d.hu, 5 + K) && near(d.th, (8 + K * 1.5) / 1000));
  function row(v, c, dn, z) { return { v_kmh: v, cant_mm: c, datum: dn, y_mean: 10 + c / 10, y_sd: 1, z_mean: z, z_sd: 1, th_mean: c / 10, th_sd: 0.5 }; }
  var rows = [row(60, 0, 'lead', 4), row(60, 0, 'trail', 6), row(60, 100, 'lead', 9), row(60, 100, 'trail', 11)];
  var cs = E.simCases(rows), exc100 = cs.filter(function (x) { return x.kind === 'exc' && x.c === 100; })[0], def100 = cs.filter(function (x) { return x.kind === 'def' && x.c === 100; })[0];
  assert.strictEqual(cs.length, 4);
  assert.ok(near(exc100.d.centre.z_mean, 10) && exc100.d.centreDerived);                 // (9 + 11)/2
  assert.ok(near(def100.d.lead.z_mean, 1) && near(def100.d.trail.z_mean, 2 * 6 - 11) && near(def100.d.centre.z_mean, 2 * 5 - 10));
  assert.ok(near(def100.d.lead.y_mean, exc100.d.lead.y_mean) && near(def100.d.lead.th_sd, exc100.d.lead.th_sd));
  return 'ok';
} });

tests.push({ name: 'Interpolation along the body, curving in 1/R, case choice', fn: function () {
  assert.ok(near(E.simAlong(10, 4, 6, 3.7, 7.4), 7) && near(E.simAlong(10, 4, 6, -7.4, 7.4), 6) && near(E.simAlong(10, 4, 6, 11.1, 7.4), 13));
  var cv = [{ R_m: 150, yo_lead: 12, yo_trail: 12, yi_lead: 6, yi_trail: 6 }, { R_m: 300, yo_lead: 8, yo_trail: 8, yi_lead: 4, yi_trail: 4 }];
  assert.ok(near(E.simCurve(cv, 200, 0, 7.4).o, 8 + (12 - 8) * (1 / 200 - 1 / 300) / (1 / 150 - 1 / 300)));
  assert.ok(near(E.simCurve(cv, 600, 0, 7.4).o, 8 * (1 / 600) / (1 / 300)));                 // towards 0 on straight track
  var below = E.simCurve(cv, 100, 0, 7.4); assert.ok(near(below.o, 12) && below.below);
  assert.strictEqual(E.simCurve(cv, 0, 0, 7.4).o, 0);
  var cases = [30, 60, 90].reduce(function (a, v) { return a.concat([0, 50, 100].map(function (c) { return { v: v, c: c, kind: 'def' }; })); }, []);
  var pk = E.simPick(cases, 'def', 45, 60); assert.ok(pk.cs.v === 60 && pk.cs.c === 100 && !pk.beyond);
  pk = E.simPick(cases, 'def', 100, 120); assert.ok(pk.cs.v === 90 && pk.cs.c === 100 && pk.beyond);
  return 'ok';
} });

tests.push({ name: 'Rigid-body section point by hand; tangent check on the sample; failure', fn: function () {
  var p = sample(), sOpt = p.settings['static'], c = p.train.carTypes[0], d = E.deriveCar(p, c, sOpt), ctx = E.simContext(p, d, sOpt);
  var cd = ctx.conds[0], cs = cd.cases.filter(function (x) { return x.kind === 'exc' && x.v === 90 && x.c === 150; })[0], sec = ctx.secs[1], x = sec.x;
  assert.ok(near(ctx.xd, d.geo.a / 2) && near(ctx.fmax, 20) && near(x, d.geo.a / 2 + d.geo.na));
  var sw = E.simSection(ctx, sec, x, cs, null, 0, []), q = sec.prof.pts[2], got = sw.pts[4];        // point H3, drop variant
  var L = E.simDisp(cs.d.lead, K, 20), C = E.simDisp(cs.d.centre, K, 20), t = x / ctx.xd;
  var dpl = (C.dpl + (L.dpl - C.dpl) * t) / 1000, th = C.th + (L.th - C.th) * t, hd = (C.hd + (L.hd - C.hd) * t) / 1000;
  assert.ok(near(got.x, q.x + dpl + (q.h - 1) * th) && near(got.y, q.h - q.x * th - hd), JSON.stringify(got));
  var tg = E.simTangent(p, sOpt);
  assert.ok(tg.ok && tg.cars.length === 1 && tg.cars[0].worst.margin > 0);
  p.sim.transient.forEach(function (r) { r.y_mean += 300; });
  assert.ok(!E.simTangent(p, sOpt).ok);
  return 'worst tangent margin ' + tg.cars[0].worst.margin.toFixed(1) + ' mm (' + tg.cars[0].worst.sec + ' ' + tg.cars[0].worst.pt + ')';
} });

tests.push({ name: 'Along the line: swept envelope to the SOD on the sample; failure enters the dynamic verdict', fn: function () {
  var p = sample(), dres = E.dynamicRun(p, p.settings['static'], p.settings.dynamic), sm = dres.summary;
  assert.ok(sm.simc && sm.sim_pts > 0 && sm.sim_n === 0 && dres.ok, JSON.stringify(sm.simc));
  assert.ok(dres.cars[0].rows.some(function (r) { return r.simc !== null; }) && dres.cars[1].rows.every(function (r) { return r.simc === null || r.simc === undefined; }));
  p.sim.transient.forEach(function (r) { r.y_mean += 600; });
  var bad = E.dynamicRun(p, p.settings['static'], p.settings.dynamic);
  assert.ok(bad.summary.sim_n > 0 && !bad.ok);
  p.sim.settings.line = 'no';
  assert.strictEqual(E.dynamicRun(p, p.settings['static'], p.settings.dynamic).summary.simc, null);
  return 'smallest clearance ' + sm.simc.v.toFixed(1) + ' mm at ' + sm.simc.ch + ' m over ' + sm.sim_pts + ' points';
} });

tests.push({ name: 'Model validation: Tables O.1–O.3 and the status of Figure O.1', fn: function () {
  var p = sample(), v = E.simValidation(p)[0];
  assert.strictEqual(v.status, 'Fully validated');
  // wheel errors by hand: |62.1 − 61.2|/61.2 …
  var m = [61.2, 60.8, 59.9, 60.4, 62.0, 61.5, 60.2, 60.9], s = [62.1, 60.1, 60.8, 59.6, 61.4, 62.3, 59.4, 61.6];
  var e = m.map(function (x, i) { return Math.abs(s[i] - x) / x * 100; });
  assert.ok(near(v.weigh.wheel.max, Math.max.apply(null, e)) && near(v.weigh.wheel.avg, e.reduce(function (a, b) { return a + b; }) / 8));
  assert.ok(near(v.sway.roll2.max, 2 * 0 + 1.2) && v.sway.roll2.lmax === 4 && v.sway.sway.lavg === 15);
  p.sim.ride[0].ride_ok = 'no';
  assert.strictEqual(E.simValidation(p)[0].status, 'Statically validated – quasi-static use only');
  p.sim.ride[0].nobo = 'yes';
  assert.strictEqual(E.simValidation(p)[0].status, 'Partially validated (notified body)');
  p.sim.sway.forEach(function (r) { r.loop_err = null; });
  assert.strictEqual(E.simValidation(p)[0].status, 'Not validated – further work');
  p = sample(); p.sim.weigh[0].sim_kN = 80;
  assert.ok(!E.simValidation(p)[0].weigh.wheel.ok && E.simValidation(p)[0].level === 0);
  return 'wheel loads max ' + v.weigh.wheel.max.toFixed(2) + ' %, avg ' + v.weigh.wheel.avg.toFixed(2) + ' %';
} });

tests.push({ name: 'Annex O.6 spreadsheet import: layout, m/s → km/h, m → mm, rad → mrad, vehicles to car types', fn: function () {
  var XL = global.XLSX, aoa = [];
  function put(r, c, v) { while (aoa.length < r) { aoa.push([]); } var row = aoa[r - 1]; while (row.length <= c) { row.push(''); } row[c] = v; }
  put(1, 0, 'Nv'); put(2, 0, 2); put(2, 1, 2); put(2, 2, 2); put(2, 3, 1);                 // 2 speeds, 2 cants, 2 radii, 1 vehicle
  put(4, 0, 10); put(5, 0, 20); put(4, 1, 0); put(5, 1, 100); put(4, 2, 300); put(5, 2, 600);
  var N = 2 + 5, k = 0;                                                                    // max(counts) + 5 = 7
  for (var i = 0; i < 2; i++) { for (var j = 0; j < 2; j++) { for (var dn = 0; dn < 3; dn++) {
    var r = N + (i * 2 + j) * 3 + 1 + dn; put(r, 0, i ? 20 : 10); put(r, 1, j ? 100 : 0);
    [0.010 + k * 0.001, 0.002, 0.004, 0.001, 0.005, 0.0004].forEach(function (v, c) { put(r, 2 + c, v); }); k++;
  } } }
  var Nc = N + 2 * 2 * 3 + 2;
  put(Nc + 1, 0, 300); [0.008, 0.008, 0.004, 0.004].forEach(function (v, c) { put(Nc + 1, 1 + c, v); });
  put(Nc + 2, 0, 600); [0.005, 0.005, 0.002, 0.002].forEach(function (v, c) { put(Nc + 2, 1 + c, v); });
  var wb = XL.utils.book_new(); XL.utils.book_append_sheet(wb, XL.utils.aoa_to_sheet(aoa), 'O6');
  var p = sample(), res = IO.importO6(wb, p, { len: 'm', rot: 'rad', cond: 'crush' });
  assert.deepStrictEqual(res.imported, ['Sim_Transient', 'Sim_Curving']);
  var tr = res.project.sim.transient.filter(function (x) { return x.cond === 'crush'; }), cv = res.project.sim.curving.filter(function (x) { return x.cond === 'crush'; });
  assert.strictEqual(tr.length, 12); assert.strictEqual(cv.length, 2);
  assert.ok(tr.every(function (x) { return x.car === 'DMC'; }) && tr[0].v_kmh === 36 && tr[11].v_kmh === 72 && tr[3].cant_mm === 100);
  assert.ok(near(tr[0].y_mean, 10) && near(tr[0].th_mean, 5) && tr[0].datum === 'lead' && tr[1].datum === 'centre' && near(tr[11].y_mean, 21));
  assert.ok(near(cv[1].yo_lead, 5) && cv[1].R_m === 600);
  assert.ok(res.project.sim.transient.some(function (x) { return x.cond === 'tare'; }), 'the other condition is kept');
  return '12 transient and 2 curving rows';
} });

module.exports = tests;
