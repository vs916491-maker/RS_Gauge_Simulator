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
    t.carTypes = ((p.train && p.train.carTypes) || []).map(function (c) { return record(c, S.carType); });
    out.train = t;
    out.bogies = (p.bogies || []).map(function (b) { return record(b, S.bogie); });
    out.bodies = (p.bodies || []).map(function (b) { return record(b, S.body); });
    var ke = p.ke || {}, sod = p.sod || {}, rs = p.rs || {}, tr = p.track || {};
    out.ke = { limits: record(ke.limits, S.customerLimits), en: record(ke.en, S.enParams), profiles: profiles(ke.profiles, S.keProfile) };
    var so = record(sod, S.sodSettings);
    out.sod = { frame: so.frame, margin_mm: so.margin_mm, profiles: profiles(sod.profiles, S.sodProfile),
      items: (sod.items || []).map(function (it) { return record(it, S.sodItem); }) };
    out.rs = { profiles: profiles(rs.profiles, S.rsProfile) };
    out.track = { params: record(tr.params, S.trackParams), segments: (tr.segments || []).map(function (s) { return record(s, S.segment); }) };
    var st = p.settings || {};
    out.settings = { 'static': record(st['static'], S.staticOptions) };
    Object.keys(st).forEach(function (k) { if (k !== 'static') { out.settings[k] = clean(st[k]); } });
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
    uniqueNames(m, 'ke', 'SOD profile', p.sod.profiles);
    p.sod.profiles.forEach(function (pr) { profileChecks(m, 'ke', 'SOD profile', pr, true); });
    p.sod.items.forEach(function (it, k) {
      if (it.y === null || it.z === null) { m.add('ke', 'err', 'SOD item ' + (it.name || k + 1) + ': Y and Z are needed.'); }
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
    var errors = m.list.filter(function (x) { return x.level === 'err'; }).length;
    return { ok: errors === 0, errors: errors, warnings: m.list.length - errors, messages: m.list };
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
    syncBodies: syncBodies, fillRefs: fillRefs, applyVehicleType: applyVehicleType, formationTokens: formationTokens, fullProfile: fullProfile, extent: extent,
    toMillimetres: toMillimetres, validate: validate, sortSegments: sortSegments, trackLength: trackLength
  };
}));
