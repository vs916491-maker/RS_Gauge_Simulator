/*
 * Project data model: empty project, safe normalisation of loaded data (with migration of version-1 files),
 * input checks per tab, profile and track helpers. DOM-free and deterministic (loads in Node for tests).
 * Contains no gauging physics (that is js/engine.js). Attaches to RSGAUGE.model.
 */
(function (root, factory) {
  var schema = (typeof module === 'object' && module.exports) ? require('./schema.js') : root.RSGAUGE.schema;
  var api = factory(schema);
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.RSGAUGE = root.RSGAUGE || {}; root.RSGAUGE.model = api; }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (S) {
  'use strict';

  var FORMAT = 'rsgauge-project', VERSION = 2;
  var BAD_KEYS = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };

  // ---------------------------------------------------------------- safe copy and records
  function clean(v) {
    if (Array.isArray(v)) { return v.map(clean); }
    if (v && typeof v === 'object') {
      var o = {}, k;
      for (k in v) { if (Object.prototype.hasOwnProperty.call(v, k) && !BAD_KEYS[k]) { o[k] = clean(v[k]); } }
      return o;
    }
    return v;
  }
  function num(v) {
    if (typeof v === 'number') { return isFinite(v) ? v : null; }
    if (typeof v === 'string' && v.trim() !== '') { var n = Number(v.trim().replace(',', '.')); return isFinite(n) ? n : null; }
    return null;
  }
  function blank(v) { return v === undefined || v === null || (typeof v === 'string' && v.trim() === ''); }
  // Fill one record from its field list: numbers converted, defaults applied (blank stays blank for optional fields).
  function record(src, fields) {
    var o = clean(src || {}), i, fd, v;
    for (i = 0; i < fields.length; i++) {
      fd = fields[i]; v = o[fd.k];
      if (fd.t === 'num' || fd.t === 'int') {
        v = num(v);
        if (v === null && !fd.opt) { v = fd.d !== undefined ? fd.d : null; }
        if (fd.t === 'int' && v !== null) { v = Math.round(v); }
      } else {
        v = blank(v) ? (fd.d !== undefined ? fd.d : '') : String(v).trim();
        if (fd.t === 'sel' && fd.o && !fd.o.some(function (op) { return op[0] === v; })) {
          var low = v.toLowerCase(), m = fd.o.filter(function (op) { return op[0].toLowerCase() === low || op[1].toLowerCase() === low; })[0];
          v = m ? m[0] : (fd.d !== undefined ? fd.d : fd.o[0][0]);
        }
      }
      o[fd.k] = v;
    }
    return o;
  }
  function points(list) {
    return (list || []).map(function (p) { return record(p, S.point); }).filter(function (p) { return p.y !== null && p.z !== null; });
  }
  function profiles(list, fields) {
    return (list || []).map(function (pr, i) {
      var r = record(pr, fields), o = {}, k;
      if (!r.name) { r.name = 'Profile ' + (i + 1); }
      fields.forEach(function (fd) { o[fd.k] = r[fd.k]; });
      for (k in r) { if (Object.prototype.hasOwnProperty.call(r, k) && o[k] === undefined && k !== 'points') { o[k] = r[k]; } }
      o.points = points(pr && pr.points);
      return o;
    });
  }

  // ---------------------------------------------------------------- migration of version-1 projects
  function migrate1(p) {
    var t = p.train || {};
    (t.carTypes || []).forEach(function (c) {
      if (c.mass_crush_t === undefined && c.mass_laden_t !== undefined) { c.mass_crush_t = c.mass_laden_t; }
      if (c.cg_crush_mm === undefined && c.cg_laden_mm !== undefined) { c.cg_crush_mm = c.cg_laden_mm; }
      if (c.n_free_m === undefined && (c.na1_m !== undefined || c.na2_m !== undefined)) { c.n_free_m = Math.max(num(c.na1_m) || 0, num(c.na2_m) || 0); }
      delete c.a_m; delete c.na1_m; delete c.na2_m; delete c.mass_laden_t; delete c.cg_laden_mm;
    });
    (p.bodies || []).forEach(function (b) {
      if (b.s_crush === undefined && b.s_laden !== undefined) { b.s_crush = b.s_laden; }
      if (b.hc_tare_mm === undefined && b.hc_mm !== undefined) { b.hc_tare_mm = b.hc_mm; b.hc_crush_mm = b.hc_mm; }
      ['s_laden', 'hc_mm', 'eta0_deg', 'theta_w_deg', 'sag_mm', 'camber_mm', 'tol_y_mm', 'tol_z_mm', 'dyn_y_mm', 'dyn_z_mm'].forEach(function (k) { delete b[k]; });
    });
    (p.bogies || []).forEach(function (b) {
      if (b.up_prim_mm === undefined && b.prim_rebound_mm !== undefined) { b.up_prim_mm = b.prim_rebound_mm; }
      if (b.up_sec_mm === undefined && b.sec_rebound_mm !== undefined) { b.up_sec_mm = b.sec_rebound_mm; }
      if (b.up_oi_mm === undefined && b.overinfl_mm !== undefined) { b.up_oi_mm = b.overinfl_mm; }
      if (b.w_defl_mm === undefined && b.w_mm !== undefined) { b.w_defl_mm = b.w_mm; }
      ['d_min_mm', 'wi_mm', 'wa_mm', 'prim_static_mm', 'prim_dyn_mm', 'prim_rebound_mm', 'sec_static_mm', 'sec_dyn_mm', 'sec_rebound_mm', 'deflated_mm', 'overinfl_mm', 'frame_height_mm', 's_bogie'].forEach(function (k) { delete b[k]; });
    });
    var tr = p.track || {}, prm = tr.params || {};
    if (prm.gauge_tol_mm !== undefined && prm.g_tol_mm === undefined) { prm.g_tol_mm = prm.gauge_tol_mm; }
    if (prm.crosslevel_tol_mm !== undefined && prm.cl_err_mm === undefined) { prm.cl_err_mm = prm.crosslevel_tol_mm; }
    ['gauge_tol_mm', 'level_tol_mm', 'crosslevel_tol_mm', 'rail_wear_lat_mm', 'rail_wear_vert_mm', 'rail_wear_vehicle'].forEach(function (k) { delete prm[k]; });
    var LOC = { tunnel: 'tunnel', depot: 'depot', elevated: 'open', at_grade: 'open' };
    (tr.segments || []).forEach(function (s) {
      if (s.R_start_m === undefined && s.R_m !== undefined) { s.R_start_m = s.R_m; s.R_end_m = s.R_m; }
      if (s.cant_start_mm === undefined && s.cant_mm !== undefined) { s.cant_start_mm = s.cant_mm; s.cant_end_mm = s.cant_mm; }
      if (s.location === undefined && s.section !== undefined) { s.location = LOC[s.section] || 'open'; }
      if (s.element !== undefined && ['tangent', 'transition', 'circular'].indexOf(String(s.element).toLowerCase()) < 0) {
        if (s.remarks === undefined) { s.remarks = s.element; }
        s.element = num(s.R_start_m) > 0 ? 'circular' : 'tangent';
      }
      ['R_m', 'cant_mm', 'section', 'form', 'widening_mm'].forEach(function (k) { delete s[k]; });
    });
    ((p.rs && p.rs.profiles) || []).forEach(function (pr) { delete pr.car; delete pr.mount; });
    return p;
  }

  function emptyProject() {
    var t = S.defaults(S.trainFields);
    t.carTypes = [];
    return normalizeProject({ version: VERSION, name: 'New project', train: t, bogies: [], bodies: [], ke: { profiles: [] }, sod: { profiles: [], items: [] }, rs: { profiles: [] }, track: { segments: [] } });
  }

  // Normalise any loaded or edited project into the full version-2 structure (never mutates the input).
  function normalizeProject(raw) {
    var p = clean(raw || {}), out = {};
    if (p.version !== undefined && p.version < 2) { p = migrate1(p); }
    out.format = FORMAT; out.version = VERSION;
    out.name = p.name ? String(p.name) : 'Untitled project';
    out.notes = p.notes ? String(p.notes) : '';
    out.fictional = !!p.fictional;
    var t = record(p.train, S.trainFields);
    delete t.bogie_arrangement;   // retired: bogie ends are set per car type (Load definition)
    t.carTypes = ((p.train && p.train.carTypes) || []).map(function (c) { return record(c, S.carType); });
    out.train = t;
    out.bogies = (p.bogies || []).map(function (b) { return record(b, S.bogie); });
    out.bodies = (p.bodies || []).map(function (b) { return record(b, S.body); });
    out.lowerParts = (p.lowerParts || []).map(function (r) { return record(r, S.lowerPart); });
    out.bogieParts = (p.bogieParts || []).map(function (r) { return record(r, S.bogiePart); });
    out.doorSteps = (p.doorSteps || []).map(function (r) { return record(r, S.doorStep); });
    out.pantographs = (p.pantographs || []).map(function (r) { return record(r, S.pantograph); });
    out.ccds = (p.ccds || []).map(function (r) { return record(r, S.ccd); });
    out.ccdPoints = (p.ccdPoints || []).map(function (r) { return record(r, S.ccdPoint); });
    var tr = p.thirdRail || {}, trr = record(tr, S.thirdRail);
    trr.parts = (tr.parts || []).map(function (r) { return record(r, S.trPart); });
    out.thirdRail = trr;
    var sm = p.sim || {}, sim = { settings: record(sm.settings, S.simSettings) };
    [['cars', S.simCar], ['transient', S.simTransient], ['curving', S.simCurving], ['weigh', S.valWeigh], ['rot', S.valRot], ['sway', S.valSway], ['ride', S.valRide]].forEach(function (x) {
      sim[x[0]] = (sm[x[0]] || []).map(function (r) { return record(r, x[1]); });
    });
    out.sim = sim;
    var ke = p.ke || {}, sod = p.sod || {}, rs = p.rs || {}, tr = p.track || {};
    out.ke = { limits: record(ke.limits, S.customerLimits), en: record(ke.en, S.enParams), profiles: profiles(ke.profiles, S.keProfile) };
    var so = record(sod, S.sodSettings);
    out.sod = { frame: so.frame, margin_mm: so.margin_mm, profiles: profiles(sod.profiles, S.sodProfile),
      items: (sod.items || []).map(function (it) { return record(it, S.sodItem); }) };
    out.rs = { profiles: profiles(rs.profiles, S.rsProfile) };
    out.track = { params: record(tr.params, S.trackParams), segments: (tr.segments || []).map(function (s) { return record(s, S.segment); }) };
    out.tests = { sway: (((p.tests || {}).sway) || []).map(function (r) { return record(r, S.swayTest); }) };
    var st = p.settings || {};
    out.settings = { 'static': record(st['static'], S.staticOptions), dynamic: record(st.dynamic, S.dynamicOptions), report: record(st.report, S.reportOptions) };
    Object.keys(st).forEach(function (k) { if (k !== 'static' && k !== 'dynamic' && k !== 'report') { out.settings[k] = clean(st[k]); } });
    syncBodies(out);
    fillRefs(out);
    return out;
  }

  // One car body record per car type (added with defaults when missing).
  function syncBodies(p) {
    var have = {}, i;
    for (i = 0; i < p.bodies.length; i++) { have[p.bodies[i].car] = true; }
    for (i = 0; i < p.train.carTypes.length; i++) {
      var n = p.train.carTypes[i].name;
      if (n && !have[n]) { var b = S.defaults(S.body); b.car = n; p.bodies.push(record(b, S.body)); have[n] = true; }
    }
    return p;
  }
  // Empty profile / KE references point to the first profile so a new project runs without extra clicks.
  function fillRefs(p) {
    var first = p.rs.profiles[0] && p.rs.profiles[0].name;
    p.train.carTypes.forEach(function (c) { ['prof_int', 'prof_ext', 'prof_end'].forEach(function (k) { if (!c[k] && first) { c[k] = first; } }); });
    if (!p.settings['static'].ke && p.ke.profiles[0]) { p.settings['static'].ke = p.ke.profiles[0].name; }
    return p;
  }

  // Copy the typical values of a vehicle type (samples/vehicle-types.json) into a copy of the project.
  // Names, formation, counts, bogie / profile assignments, KE, profiles and track segments are kept.
  function applyVehicleType(p, types, type) {
    var t = types && types.types && types.types[type];
    if (!t) { throw new Error('Unknown vehicle type "' + type + '".'); }
    var q = clean(p);
    function put(target, vals) { Object.keys(vals || {}).forEach(function (k) { if (!BAD_KEYS[k]) { target[k] = vals[k]; } }); }
    put(q.train, t.train); q.train.vehicle_type = type;
    put(q.track.params, t.track); put(q.ke.limits, t.limits);
    q.train.carTypes.forEach(function (c) { put(c, t.car); });
    q.bodies.forEach(function (b) { put(b, t.body); });
    q.bogies.forEach(function (b) { put(b, t.bogie); });
    return normalizeProject(q);
  }

  function formationTokens(s) {
    return String(s || '').split(/[-+,;\s]+/).map(function (x) { return x.trim(); }).filter(function (x) { return x; });
  }

  // Formation layout (topology only, no physics): each car is drawn with end 1 on the left unless it is reversed.
  // The orientation of each car is chosen so that its left end matches the right end of the car before it
  // (shared with shared, own bogie with own bogie) and a train end is never a shared end; with a tie the car
  // keeps end 1 on the left, except the last car, which is reversed (end 1 = cab end facing outwards).
  // Returns { cars: [{ pos, name, car, rev, left, right, bogieLeft, bogieRight }],
  //           joints: [{ pos, shared, ok, bogieOk, text }], issues: [text] }.
  function formationLayout(train) {
    var tok = formationTokens(train && train.formation), types = {}, cars = [], joints = [], issues = [];
    ((train && train.carTypes) || []).forEach(function (c) { types[c.name] = c; });
    tok.forEach(function (n, i) {
      var c = types[n] || null, e1 = c && c.end1 === 'shared' ? 'shared' : 'free', e2 = c && c.end2 === 'shared' ? 'shared' : 'free';
      var prev = cars[i - 1], last = i === tok.length - 1;
      function score(rev) {
        var l = rev ? e2 : e1, r = rev ? e1 : e2, k = 0;
        if (prev ? l !== prev.right : l === 'shared') { k += 1; }
        if (last && r === 'shared') { k += 1; }
        return k;
      }
      var s0 = score(false), s1 = score(true), rev;
      if (e1 === e2) { rev = last; }            // symmetric ends: only the drawing changes
      else { rev = s1 < s0; }                   // otherwise the orientation that fits its neighbours
      cars.push({ pos: i + 1, name: n, car: c, rev: rev, left: rev ? e2 : e1, right: rev ? e1 : e2,
        bogieLeft: c ? (rev ? c.bogie2 : c.bogie1) : '', bogieRight: c ? (rev ? c.bogie1 : c.bogie2) : '' });
    });
    cars.forEach(function (k, i) {
      var who = 'Car ' + k.pos + ' (' + k.name + ')';
      if (cars.length === 1) { if (k.left === 'shared' || k.right === 'shared') { issues.push(who + ': a single car cannot have a shared end.'); } return; }
      if (i === 0 && k.left === 'shared') { issues.push(who + ': the end at the front of the train is a shared end, but there is no car in front of it.'); }
      if (i === cars.length - 1 && k.right === 'shared') { issues.push(who + ': the end at the rear of the train is a shared end, but there is no car behind it.'); }
      var nx = cars[i + 1];
      if (!nx) { return; }
      var shared = k.right === 'shared' && nx.left === 'shared', ok = k.right === nx.left;
      var bogieOk = !shared || !k.bogieRight || !nx.bogieLeft || k.bogieRight === nx.bogieLeft, text;
      if (!ok) {
        text = 'Cars ' + k.pos + ' (' + k.name + ') and ' + nx.pos + ' (' + nx.name + '): one side of the joint is a shared bogie, the other an own bogie. Set both ends to "Shared" (articulated joint) or both to "Own bogie".';
        issues.push(text);
      } else if (!bogieOk) {
        text = 'Cars ' + k.pos + ' (' + k.name + ') and ' + nx.pos + ' (' + nx.name + ') share one bogie but name different bogie types ("' + k.bogieRight + '" and "' + nx.bogieLeft + '").';
        issues.push(text);
      }
      joints.push({ pos: k.pos, shared: shared, ok: ok, bogieOk: bogieOk, text: text || '' });
    });
    return { cars: cars, joints: joints, issues: issues };
  }

  // ---------------------------------------------------------------- profile helpers
  function fullProfile(pts) {
    var right = pts.map(function (p) { return { y: p.y, z: p.z }; }), left = [], i;
    for (i = right.length - 1; i >= 0; i--) {
      if (right[i].y === 0 && (i === right.length - 1 || i === 0)) { continue; }
      left.push({ y: -right[i].y, z: right[i].z });
    }
    var out = right.concat(left);
    if (out.length) { out.push({ y: out[0].y, z: out[0].z }); }
    return out;
  }
  function extent(pts) {
    var e = { ymin: Infinity, ymax: -Infinity, zmin: Infinity, zmax: -Infinity };
    pts.forEach(function (p) { e.ymin = Math.min(e.ymin, p.y); e.ymax = Math.max(e.ymax, p.y); e.zmin = Math.min(e.zmin, p.z); e.zmax = Math.max(e.zmax, p.z); });
    return e;
  }
  function toMillimetres(pts) {
    var big = 0;
    pts.forEach(function (p) { big = Math.max(big, Math.abs(p.y), Math.abs(p.z)); });
    if (big > 0 && big <= 20) {
      return { converted: true, points: pts.map(function (p) { var q = clean(p); q.y = Math.round(p.y * 1e7) / 1e4; q.z = Math.round(p.z * 1e7) / 1e4; return q; }) };
    }
    return { converted: false, points: pts };
  }

  // ---------------------------------------------------------------- checks
  function Msgs() { this.list = []; }
  Msgs.prototype.add = function (tab, level, text) { this.list.push({ tab: tab, level: level, text: text }); };

  function rangeChecks(m, tab, where, rec, fields) {
    fields.forEach(function (fd) {
      var v = rec[fd.k];
      if (fd.t !== 'num' && fd.t !== 'int') { return; }
      if (v === null || v === undefined) { if (!fd.opt) { m.add(tab, 'err', where + ': ' + fd.l + ' is missing.'); } return; }
      if (fd.min !== undefined && v < fd.min) { m.add(tab, 'err', where + ': ' + fd.l + ' = ' + v + ' is below ' + fd.min + ' ' + fd.u + '.'); }
      if (fd.max !== undefined && v > fd.max) { m.add(tab, 'err', where + ': ' + fd.l + ' = ' + v + ' is above ' + fd.max + ' ' + fd.u + '.'); }
    });
  }
  function uniqueNames(m, tab, what, list, key) {
    var seen = {};
    list.forEach(function (r) {
      var n = r[key || 'name'];
      if (!n) { m.add(tab, 'err', what + ' without a name.'); return; }
      if (seen[n]) { m.add(tab, 'err', what + ' "' + n + '" appears twice.'); }
      seen[n] = true;
    });
    return seen;
  }
  function profileChecks(m, tab, what, pr, isSod) {
    var w = what + ' "' + pr.name + '"';
    if (pr.points.length < 3) { m.add(tab, 'err', w + ' needs at least 3 points (has ' + pr.points.length + ').'); return; }
    pr.points.forEach(function (p, i) {
      if (p.y < 0) { m.add(tab, 'err', w + ', point ' + (p.pt || i + 1) + ': Y must be ≥ 0 (enter the right half only).'); }
    });
    if (pr.points[0].y !== 0) { m.add(tab, 'warn', w + ' does not start on the centre line (Y = 0): the first point should be the top centre.'); }
    var e = extent(pr.points);
    if (e.ymax <= 20 && e.zmax <= 20) { m.add(tab, 'warn', w + ' looks like it is in metres; coordinates must be in mm.'); }
    if (pr.n_up !== undefined && pr.n_up !== null && pr.n_up > pr.points.length) { m.add(tab, 'err', w + ': n_up (' + pr.n_up + ') is larger than the number of points.'); }
    if (!isSod && pr.points[0].z < e.zmax - 0.001) { m.add(tab, 'warn', w + ': the first point is not the highest point; the top check uses the first point.'); }
  }

  function validate(p) {
    var m = new Msgs(), t = p.train, cars = t.carTypes, carNames, bogieNames = {}, rsNames = {}, keNames, i;
    // ---- train
    rangeChecks(m, 'train', 'Train', t, S.trainDescription.concat(S.trainConfig));
    rangeChecks(m, 'bogie', 'Wind', t, S.trainWind);
    if (!cars.length) { m.add('train', 'err', 'No car types defined.'); }
    carNames = uniqueNames(m, 'train', 'Car type', cars);
    p.bogies.forEach(function (b) { if (b.name) { bogieNames[b.name] = true; } });
    p.rs.profiles.forEach(function (r) { if (r.name) { rsNames[r.name] = true; } });
    var total = 0;
    cars.forEach(function (c) {
      var w = 'Car type ' + (c.name || '?');
      rangeChecks(m, 'train', w, c, S.carType);
      total += c.count || 0;
      var n1 = c.end1 === 'shared' ? c.n_art_m : c.n_free_m, n2 = c.end2 === 'shared' ? c.n_art_m : c.n_free_m, a = c.length_m - n1 - n2;
      if (!(a > 0)) { m.add('train', 'err', w + ': pivot distance a = Lb − n1 − n2 = ' + (isFinite(a) ? a.toFixed(2) : '?') + ' m is not positive.'); }
      else {
        if (c.ni_m !== null && c.ni_m > a) { m.add('train', 'err', w + ': interior section ni (' + c.ni_m + ' m) is beyond the other pivot (a = ' + a.toFixed(2) + ' m).'); }
        if (c.na_m !== null && c.na_m > Math.max(n1, n2) + 0.0001) { m.add('train', 'warn', w + ': exterior section na (' + c.na_m + ' m) is beyond the car-end overhang (' + Math.max(n1, n2).toFixed(2) + ' m).'); }
      }
      if (c.mass_crush_t !== null && c.mass_tare_t !== null && c.mass_crush_t < c.mass_tare_t) { m.add('train', 'err', w + ': crush mass is below tare mass.'); }
      ['bogie1', 'bogie2'].forEach(function (k) {
        if (!c[k]) { m.add('train', 'err', w + ': bogie type at ' + (k === 'bogie1' ? 'end 1' : 'end 2') + ' is empty.'); }
        else if (!bogieNames[c[k]]) { m.add('train', 'err', w + ': bogie type "' + c[k] + '" is not defined on the Car body & Bogie tab.'); }
      });
      ['prof_int', 'prof_ext', 'prof_end'].forEach(function (k) {
        if (!c[k]) { m.add('train', 'err', w + ': ' + S.byKey(S.carType, k).l + ' is empty.'); }
        else if (!rsNames[c[k]]) { m.add('train', 'err', w + ': RS profile "' + c[k] + '" is not defined on the RS Profile tab.'); }
      });
    });
    if (cars.length && total !== t.n_cars) { m.add('train', 'warn', 'Car type counts add up to ' + total + ' cars, the train has ' + t.n_cars + '.'); }
    var tok = formationTokens(t.formation);
    if (!tok.length) { m.add('train', 'warn', 'Train formation is empty.'); }
    else {
      if (tok.length !== t.n_cars) { m.add('train', 'warn', 'Formation has ' + tok.length + ' cars, number of cars is ' + t.n_cars + '.'); }
      tok.forEach(function (n) { if (!carNames[n]) { m.add('train', 'err', 'Formation uses "' + n + '", which is not a car type.'); } });
      cars.forEach(function (c) {
        var k = tok.filter(function (n) { return n === c.name; }).length;
        if (c.name && k !== c.count) { m.add('train', 'warn', 'Car type ' + c.name + ': count is ' + c.count + ' but it appears ' + k + ' times in the formation.'); }
      });
      formationLayout(t).issues.forEach(function (x) { m.add('train', 'warn', 'Bogie arrangement – ' + x); });
    }
    if (t.L_mm && t.gauge_mm && t.L_mm < t.gauge_mm) { m.add('train', 'warn', 'G (' + t.L_mm + ' mm) is smaller than the track gauge.'); }

    // ---- bogies and bodies
    if (!p.bogies.length) { m.add('bogie', 'err', 'No bogie types defined.'); }
    uniqueNames(m, 'bogie', 'Bogie type', p.bogies);
    p.bogies.forEach(function (b) {
      var w = 'Bogie ' + (b.name || '?');
      rangeChecks(m, 'bogie', w, b, S.bogie);
      if (b.wheel_worn_mm !== null && b.wheel_new_mm !== null && b.wheel_worn_mm > b.wheel_new_mm) { m.add('bogie', 'err', w + ': worn wheel diameter is larger than new.'); }
      if (b.z_sec_mm !== null && b.z_prim_mm !== null && b.z_sec_mm <= b.z_prim_mm) { m.add('bogie', 'warn', w + ': secondary roll level is not above the primary one.'); }
    });
    var bodyCars = {};
    p.bodies.forEach(function (b) {
      bodyCars[b.car] = true;
      if (!carNames[b.car]) { m.add('bogie', 'warn', 'Car body data for "' + b.car + '", which is not a car type (ignored).'); return; }
      rangeChecks(m, 'bogie', 'Car body ' + b.car, b, S.body);
      if (b.wind_top_mm !== null && b.wind_bot_mm !== null && b.wind_top_mm <= b.wind_bot_mm) { m.add('bogie', 'err', 'Car body ' + b.car + ': top of the wind-exposed side is not above its bottom.'); }
    });
    cars.forEach(function (c) { if (c.name && !bodyCars[c.name]) { m.add('bogie', 'err', 'No car body data for ' + c.name + '.'); } });

    // ---- KE / SOD
    if (!p.ke.profiles.length) { m.add('ke', 'err', 'No customer KE profile.'); }
    keNames = uniqueNames(m, 'ke', 'KE profile', p.ke.profiles);
    p.ke.profiles.forEach(function (pr) { profileChecks(m, 'ke', 'KE profile', pr); });
    rangeChecks(m, 'ke', 'Customer limits', p.ke.limits, S.customerLimits);
    if (p.ke.limits.h_ref2_mm !== null && p.ke.limits.h_ref1_mm !== null && p.ke.limits.h_ref2_mm <= p.ke.limits.h_ref1_mm) { m.add('ke', 'warn', 'Reference height 2 is not above reference height 1.'); }
    rangeChecks(m, 'ke', 'EN 15273-2 rules', p.ke.en, S.enParams);
    var gv = S.enGaugeValues(p.ke.en.en_gauge);
    if (gv) {
      var diff = Object.keys(gv).filter(function (k) { var a = p.ke.en[k], b = gv[k]; return !(a === b || (a !== null && b !== null && Math.abs(a - b) < 1e-9)); });
      if (diff.length) { m.add('ke', 'warn', 'EN 15273-2 rules: ' + diff.length + ' value(s) differ from the rules of gauge ' + p.ke.en.en_gauge + ' (' + diff.slice(0, 4).join(', ') + (diff.length > 4 ? ', …' : '') + '); choose the gauge again to reload them, or Custom.'); }
    }
    if (p.ke.en.zb_from_mm !== null && p.ke.en.zb_to_mm !== null && !(p.ke.en.zb_to_mm > p.ke.en.zb_from_mm)) { m.add('ke', 'err', 'EN 15273-2 rules: the roll band must go from a lower to a higher height.'); }
    if (p.ke.en.R1_m !== null && p.ke.en.Rmin_m !== null && !(p.ke.en.R1_m > p.ke.en.Rmin_m)) { m.add('ke', p.settings['static'].en_check === 'yes' ? 'err' : 'warn', 'EN 15273-2 rules: R1 must be larger than R2.'); }
    var sto = p.settings['static'];
    if (sto.en_static === 'yes' && sto.en_static_ref && !p.ke.profiles.some(function (x) { return x.name === sto.en_static_ref; })) { m.add('ssim', 'err', 'EN static gauge: reference profile "' + sto.en_static_ref + '" is not on the Customer KE & SOD tab.'); }
    uniqueNames(m, 'ke', 'SOD profile', p.sod.profiles);
    p.sod.profiles.forEach(function (pr) { profileChecks(m, 'ke', 'SOD profile', pr, true); });
    p.sod.items.forEach(function (it, k) {
      if (it.y === null || it.z === null) { m.add('ke', 'err', 'SOD item ' + (it.name || k + 1) + ': Y and Z are needed.'); }
      if (it.ch_from_m !== null && it.ch_to_m !== null && !(it.ch_to_m > it.ch_from_m)) { m.add('ke', 'err', 'SOD item ' + (it.name || k + 1) + ': the "to" chainage must be after the "from" chainage.'); }
    });
    if (p.sod.items.length || p.track.segments.some(function (sg) { return sg.sod; })) {
      if (!(p.sod.margin_mm >= 0)) { m.add('ke', 'warn', 'SOD: no minimum clearance KE to SOD given; 50 mm is used.'); }
    }

    p.bogies.forEach(function (b) {
      if (b.wv_R_m !== null && b.wv_R_m < 250) { m.add('bogie', 'warn', 'Bogie ' + b.name + ': variable stops starting below 250 m need the 150 m formulae of EN 15273-2 (A.34, A.36, A.53, A.55), which the tool does not apply; the bracket is evaluated at the radius given.'); }
      if (b.wv_R_m !== null && b.wv_mm === null) { m.add('bogie', 'warn', 'Bogie ' + b.name + ': variable-stop radius given without w at that radius; w is used.'); }
    });

    // ---- EN 15273-2 lower parts (A.3.4.1)
    var carNames = p.train.carTypes.map(function (c) { return c.name; });
    (p.lowerParts || []).forEach(function (r, k) {
      var id = 'Lower part ' + (r.name || k + 1);
      rangeChecks(m, 'bogie', id, r, S.lowerPart);
      if (!r.car || carNames.indexOf(r.car) < 0) { m.add('bogie', 'err', id + ': car type "' + (r.car || '') + '" is not in the Train Configuration.'); }
    });

    var bogieNames = p.bogies.map(function (b) { return b.name; });
    (p.bogieParts || []).forEach(function (r, k) {
      var id = 'Bogie part ' + (r.name || k + 1);
      rangeChecks(m, 'bogie', id, r, S.bogiePart);
      if (!r.bogie || bogieNames.indexOf(r.bogie) < 0) { m.add('bogie', 'err', id + ': bogie type "' + (r.bogie || '') + '" is not on the Car body & Bogie tab.'); }
    });

    (p.doorSteps || []).forEach(function (r, k) {
      var id = 'Door / step ' + (r.name || k + 1);
      rangeChecks(m, 'rs', id, r, S.doorStep);
      if (!r.car || carNames.indexOf(r.car) < 0) { m.add('rs', 'err', id + ': car type "' + (r.car || '') + '" is not in the Train Configuration.'); }
      if (r.h_lo_mm !== null && r.h_hi_mm !== null && r.h_hi_mm < r.h_lo_mm) { m.add('rs', 'err', id + ': the highest point is below the lowest point.'); }
    });

    (p.pantographs || []).forEach(function (r, k) {
      var id = 'Pantograph ' + (r.name || k + 1);
      rangeChecks(m, 'rs', id, r, S.pantograph);
      if (!r.car || carNames.indexOf(r.car) < 0) { m.add('rs', 'err', id + ': car type "' + (r.car || '') + '" is not in the Train Configuration.'); }
    });
    if ((p.pantographs || []).length && p.train.power_supply !== 'ohe') { m.add('rs', 'warn', 'Pantographs are given but the power supply on the Train Configuration tab is not overhead.'); }

    // ---- Third-rail CCD (METHOD §14)
    var ccdNames = (p.ccds || []).map(function (c) { return c.name; });
    if ((p.ccds || []).length) {
      uniqueNames(m, 'bogie', 'CCD', p.ccds);
      rangeChecks(m, 'ke', 'Third rail', p.thirdRail, S.thirdRail);
      if (p.thirdRail.tr_ke && !p.ke.profiles.some(function (x) { return x.name === p.thirdRail.tr_ke; })) { m.add('ke', 'err', 'Third rail: envelope "' + p.thirdRail.tr_ke + '" is not a profile on this tab.'); }
      if (p.train.power_supply !== 'third_rail') { m.add('bogie', 'warn', 'CCDs are given but the power supply on the Train Configuration tab is not third rail.'); }
    }
    (p.ccds || []).forEach(function (c) {
      rangeChecks(m, 'bogie', 'CCD ' + c.name, c, S.ccd);
      if (!c.bogie || bogieNames.indexOf(c.bogie) < 0) { m.add('bogie', 'err', 'CCD ' + c.name + ': bogie type "' + (c.bogie || '') + '" is not on this tab.'); }
      if (c.c_max_mm !== null && c.c_min_mm !== null && !(c.c_max_mm > c.c_min_mm)) { m.add('bogie', 'err', 'CCD ' + c.name + ': the working range must go from a lower to a higher value.'); }
      if (c.o_max_mm !== null && c.o_min_mm !== null && !(c.o_max_mm > c.o_min_mm)) { m.add('bogie', 'err', 'CCD ' + c.name + ': the shoe face must go from a lower to a higher value.'); }
      if (!(p.ccdPoints || []).some(function (q) { return q.ccd === c.name; })) { m.add('bogie', 'warn', 'CCD ' + c.name + ': no outline points; only the shoe–rail contact is checked.'); }
    });
    (p.ccdPoints || []).forEach(function (q, k) {
      rangeChecks(m, 'bogie', 'CCD point ' + (q.pt || k + 1), q, S.ccdPoint);
      if (ccdNames.indexOf(q.ccd) < 0) { m.add('bogie', 'err', 'CCD point ' + (q.pt || k + 1) + ': CCD "' + (q.ccd || '') + '" is not in the CCD table.'); }
    });
    ((p.thirdRail || {}).parts || []).forEach(function (q, k) { rangeChecks(m, 'ke', 'Third-rail part ' + (q.name || k + 1), q, S.trPart); });

    // ---- EN dynamic method (METHOD §15)
    var sim = p.sim || {};
    if (sim.settings) {
      rangeChecks(m, 'endyn', 'Settings', sim.settings, S.simSettings);
      if (sim.settings.ref && !p.ke.profiles.some(function (x) { return x.name === sim.settings.ref; })) { m.add('endyn', 'err', 'Reference profile "' + sim.settings.ref + '" is not on the Customer KE & SOD tab.'); }
    }
    [['cars', S.simCar, 'Datum row'], ['transient', S.simTransient, 'Transient row'], ['curving', S.simCurving, 'Curving row'], ['weigh', S.valWeigh, 'Weighbridge row'], ['rot', S.valRot, 'Bogie-rotation row'], ['sway', S.valSway, 'Sway-validation row'], ['ride', S.valRide, 'Ride-test row']].forEach(function (x) {
      (sim[x[0]] || []).forEach(function (r, k) {
        rangeChecks(m, 'endyn', x[2] + ' ' + (k + 1), r, x[1]);
        if (!r.car || carNames.indexOf(r.car) < 0) { m.add('endyn', 'err', x[2] + ' ' + (k + 1) + ': car type "' + (r.car || '') + '" is not in the Train Configuration.'); }
      });
    });

    // ---- Tests (sway test rows)
    ((p.tests || {}).sway || []).forEach(function (r, k) {
      var id = 'Sway test row ' + (k + 1);
      rangeChecks(m, 'tests', id, r, S.swayTest.filter(function (fd) { return fd.k === 'h3_mm' || fd.k === 'y3_mm' || (fd.t === 'num' && r[fd.k] !== null); }));
      if (!r.car || carNames.indexOf(r.car) < 0) { m.add('tests', 'err', id + ': car type "' + (r.car || '') + '" is not in the Train Configuration.'); }
      if (!(r.D_mm > 0)) { m.add('tests', 'err', id + ': shim height D must be > 0.'); }
      var n = [1, 2, 3].filter(function (j) { return r['h' + j + '_mm'] !== null && r['y' + j + '_mm'] !== null; }).length;
      if (n < 2) { m.add('tests', 'err', id + ': at least two heights with a displacement are needed.'); }
      [1, 2, 3].forEach(function (j) { if ((r['h' + j + '_mm'] === null) !== (r['y' + j + '_mm'] === null)) { m.add('tests', 'warn', id + ': height ' + j + ' and its displacement go together; the incomplete pair is ignored.'); } });
    });

    // ---- RS profile
    if (!p.rs.profiles.length) { m.add('rs', 'err', 'No rolling stock profile.'); }
    uniqueNames(m, 'rs', 'RS profile', p.rs.profiles);
    p.rs.profiles.forEach(function (pr) { profileChecks(m, 'rs', 'RS profile', pr); });

    // ---- track
    rangeChecks(m, 'track', 'Track parameters', p.track.params, S.trackParams);
    var tp = p.track.params;
    if (tp.cant_max_mm !== null && tp.cantexc_max_mm !== null && tp.cantexc_max_mm > tp.cant_max_mm) { m.add('track', 'warn', 'Maximum cant excess is above the maximum applied cant.'); }
    var seg = p.track.segments;
    if (!seg.length) { m.add('track', 'warn', 'No track segments (needed for the dynamic simulation).'); }
    for (i = 0; i < seg.length; i++) {
      var s = seg[i], w = 'Segment ' + (i + 1) + (s.remarks ? ' (' + s.remarks + ')' : '');
      rangeChecks(m, 'track', w, s, S.segment);
      if (s.from_m !== null && s.to_m !== null && s.to_m <= s.from_m) { m.add('track', 'err', w + ': chainage end must be greater than chainage start.'); }
      var curved = s.R_start_m > 0 || s.R_end_m > 0;
      if (curved && !s.side) { m.add('track', 'err', w + ': curve without a hand (L/R).'); }
      if (s.element === 'tangent' && curved) { m.add('track', 'warn', w + ': tangent element with a radius.'); }
      if (s.element === 'circular' && (!(s.R_start_m > 0) || s.R_start_m !== s.R_end_m)) { m.add('track', 'warn', w + ': circular element should have the same radius at start and end.'); }
      [s.R_start_m, s.R_end_m].forEach(function (R) { if (R > 0 && R < 150) { m.add('track', 'warn', w + ': R = ' + R + ' m is below 150 m; the throw formulas are approximate (graphic method advised).'); } });
      if (!curved && (s.cant_start_mm > 0 || s.cant_end_mm > 0)) { m.add('track', 'warn', w + ': cant on tangent track.'); }
      if (s.Rv_m && Math.abs(s.Rv_m) < 500) { m.add('track', 'warn', w + ': vertical radius |Rv| below 500 m.'); }
      if (s.ke && p.ke.profiles.length && !keNames[s.ke]) { m.add('track', 'err', w + ': KE "' + s.ke + '" not found.'); }
      if (!s.ke) { m.add('track', 'warn', w + ': no KE assigned.'); }
      if (s.location === 'platform' && !(s.platform_mm > 0)) { m.add('track', 'warn', w + ': platform without a platform edge distance.'); }
      if (s.sod && !p.sod.profiles.some(function (x) { return x.name === s.sod; })) { m.add('track', 'err', w + ': SOD profile "' + s.sod + '" not found.'); }
      if (i > 0 && seg[i - 1].to_m !== null && s.from_m !== null) {
        if (s.from_m < seg[i - 1].to_m - 1e-6) { m.add('track', 'err', w + ' overlaps the previous segment (start ' + s.from_m + ' < ' + seg[i - 1].to_m + ').'); }
        else if (s.from_m > seg[i - 1].to_m + 1e-6) { m.add('track', 'warn', 'Gap in the track data between ' + seg[i - 1].to_m + ' m and ' + s.from_m + ' m.'); }
      }
    }

    // ---- static options
    var so = p.settings['static'];
    rangeChecks(m, 'ssim', 'Static options', so, S.staticOptions);
    if (!so.ke) { m.add('ssim', 'err', 'Static options: no customer KE selected.'); }
    else if (p.ke.profiles.length && !keNames[so.ke]) { m.add('ssim', 'err', 'Static options: KE "' + so.ke + '" not found.'); }
    // ---- dynamic options
    var dyo = p.settings.dynamic;
    rangeChecks(m, 'dsim', 'Dynamic options', dyo, S.dynamicOptions);
    if (dyo.profile && !rsNames[dyo.profile]) { m.add('dsim', 'err', 'Dynamic options: RS profile "' + dyo.profile + '" not found.'); }
    if (dyo.ss_ke && !keNames[dyo.ss_ke]) { m.add('dsim', 'err', 'Dynamic options: KE "' + dyo.ss_ke + '" not found.'); }
    if (dyo.ch_from_m !== null && dyo.ch_to_m !== null && dyo.ch_to_m <= dyo.ch_from_m) { m.add('dsim', 'err', 'Dynamic options: end chainage must be greater than the start chainage.'); }
    if (!seg.length) { m.add('dsim', 'err', 'No track data: the dynamic simulation needs the Track Data tab.'); }
    var errors = m.list.filter(function (x) { return x.level === 'err'; }).length;
    return { ok: errors === 0, errors: errors, warnings: m.list.length - errors, messages: m.list };
  }

  // Errors that block a run: the static run ignores the dynamic-only checks; the dynamic run needs everything.
  function readiness(v, run) {
    var errs = v.messages.filter(function (m) { return m.level === 'err' && (run === 'dynamic' || (m.tab !== 'dsim' && m.tab !== 'endyn')); });
    return { ok: errs.length === 0, errors: errs.length, messages: errs };
  }

  function sortSegments(seg) { return seg.slice().sort(function (a, b) { return (a.from_m || 0) - (b.from_m || 0); }); }
  function trackLength(seg) {
    if (!seg.length) { return 0; }
    var lo = Infinity, hi = -Infinity;
    seg.forEach(function (s) { lo = Math.min(lo, s.from_m); hi = Math.max(hi, s.to_m); });
    return hi - lo;
  }

  return {
    FORMAT: FORMAT, VERSION: VERSION,
    clean: clean, num: num, record: record, emptyProject: emptyProject, normalizeProject: normalizeProject, migrate1: migrate1,
    syncBodies: syncBodies, fillRefs: fillRefs, applyVehicleType: applyVehicleType, formationTokens: formationTokens, formationLayout: formationLayout, fullProfile: fullProfile, extent: extent,
    toMillimetres: toMillimetres, validate: validate, readiness: readiness, sortSegments: sortSegments, trackLength: trackLength
  };
}));
