/*
 * Project data model: empty project, safe normalisation of loaded data, input checks per tab, profile and
 * track helpers. DOM-free and deterministic (loads in Node for tests). Contains no gauging physics; the
 * calculation engine is js/engine.js (Phase 2). Attaches to RSGAUGE.model.
 */
(function (root, factory) {
  var schema = (typeof module === 'object' && module.exports) ? require('./schema.js') : root.RSGAUGE.schema;
  var api = factory(schema);
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.RSGAUGE = root.RSGAUGE || {}; root.RSGAUGE.model = api; }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (S) {
  'use strict';

  var FORMAT = 'rsgauge-project', VERSION = 1;
  var BAD_KEYS = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };

  // ---------------------------------------------------------------- safe copy
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
  // Fill one record from its field list: numbers converted, defaults applied, unknown keys kept.
  function record(src, fields) {
    var o = clean(src || {}), i, fd, v;
    for (i = 0; i < fields.length; i++) {
      fd = fields[i]; v = o[fd.k];
      if (fd.t === 'num' || fd.t === 'int') {
        v = num(v);
        if (v === null) { v = fd.d !== undefined ? fd.d : null; }
        if (fd.t === 'int' && v !== null) { v = Math.round(v); }
      } else {
        v = (v === undefined || v === null) ? (fd.d !== undefined ? fd.d : '') : String(v);
        if (fd.t === 'sel' && fd.o && !fd.o.some(function (op) { return op[0] === v; })) { v = fd.d !== undefined ? fd.d : fd.o[0][0]; }
      }
      o[fd.k] = v;
    }
    return o;
  }
  function points(list) {
    return (list || []).map(function (p) { var r = record(p, S.point); return r; })
      .filter(function (p) { return p.y !== null && p.z !== null; });
  }
  function profiles(list, fields) {
    return (list || []).map(function (pr, i) {
      var r = record(pr, fields), o = {}, k;
      if (!r.name) { r.name = 'Profile ' + (i + 1); }
      // stable key order: profile fields, any extra keys, then the points
      fields.forEach(function (fd) { o[fd.k] = r[fd.k]; });
      for (k in r) { if (Object.prototype.hasOwnProperty.call(r, k) && o[k] === undefined && k !== 'points') { o[k] = r[k]; } }
      o.points = points(pr && pr.points);
      return o;
    });
  }

  function emptyProject() {
    var t = S.defaults(S.trainFields);
    t.carTypes = [];
    return normalizeProject({ name: 'New project', train: t, bogies: [], bodies: [], ke: { profiles: [] }, sod: { profiles: [], items: [] }, rs: { profiles: [] }, track: { segments: [] } });
  }

  // Normalise any loaded or edited project into the full structure (never mutates the input).
  function normalizeProject(raw) {
    var p = clean(raw || {}), out = {};
    out.format = FORMAT; out.version = VERSION;
    out.name = p.name ? String(p.name) : 'Untitled project';
    out.notes = p.notes ? String(p.notes) : '';
    out.fictional = !!p.fictional;
    var t = record(p.train, S.trainFields);
    t.carTypes = ((p.train && p.train.carTypes) || []).map(function (c) { return record(c, S.carType); });
    out.train = t;
    out.bogies = (p.bogies || []).map(function (b) {
      var r = record(b, S.bogie);
      // blank wi / wa = same as w
      if (b && (b.wi_mm === '' || b.wi_mm === null || b.wi_mm === undefined)) { r.wi_mm = r.w_mm; }
      if (b && (b.wa_mm === '' || b.wa_mm === null || b.wa_mm === undefined)) { r.wa_mm = r.w_mm; }
      return r;
    });
    out.bodies = (p.bodies || []).map(function (b) { return record(b, S.body); });
    var ke = p.ke || {}, sod = p.sod || {}, rs = p.rs || {}, tr = p.track || {};
    out.ke = { en: record(ke.en, S.enParams), profiles: profiles(ke.profiles, S.keProfile) };
    var so = record(sod, S.sodSettings);
    out.sod = { frame: so.frame, margin_mm: so.margin_mm, profiles: profiles(sod.profiles, S.sodProfile),
      items: (sod.items || []).map(function (it) { return record(it, S.sodItem); }) };
    out.rs = { profiles: profiles(rs.profiles, S.rsProfile) };
    out.track = { params: record(tr.params, S.trackParams), segments: (tr.segments || []).map(function (s) { return record(s, S.segment); }) };
    out.settings = clean(p.settings || {});
    syncBodies(out);
    return out;
  }

  // One car body record per car type (added with defaults when missing; extra ones are kept and reported).
  function syncBodies(p) {
    var have = {}, i;
    for (i = 0; i < p.bodies.length; i++) { have[p.bodies[i].car] = true; }
    for (i = 0; i < p.train.carTypes.length; i++) {
      var n = p.train.carTypes[i].name;
      if (n && !have[n]) { var b = S.defaults(S.body); b.car = n; p.bodies.push(record(b, S.body)); have[n] = true; }
    }
    return p;
  }

  function formationTokens(s) {
    return String(s || '').split(/[-+,;\s]+/).map(function (x) { return x.trim(); }).filter(function (x) { return x; });
  }

  // ---------------------------------------------------------------- profile helpers
  // Full closed outline from a right half-profile: right half as given, then its mirror in reverse order.
  function fullProfile(pts) {
    var right = pts.map(function (p) { return { y: p.y, z: p.z }; }), left = [], i;
    for (i = right.length - 1; i >= 0; i--) {
      if (right[i].y === 0 && (i === right.length - 1 || i === 0)) { continue; }   // points on the centre line are not doubled
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
  // Coordinates given in metres (all |values| <= 20 and some non-zero) are converted to mm.
  function toMillimetres(pts) {
    var big = 0;
    pts.forEach(function (p) { big = Math.max(big, Math.abs(p.y), Math.abs(p.z)); });
    if (big > 0 && big <= 20) {
      return { converted: true, points: pts.map(function (p) { var q = clean(p); q.y = Math.round(p.y * 10000) / 10; q.z = Math.round(p.z * 10000) / 10; return q; }) };
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
      if (v === null || v === undefined) { m.add(tab, 'err', where + ': ' + fd.l + ' is missing.'); return; }
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
  function profileChecks(m, tab, what, pr, openEnd) {
    var w = what + ' "' + pr.name + '"';
    if (pr.points.length < 3) { m.add(tab, 'err', w + ' needs at least 3 points (has ' + pr.points.length + ').'); return; }
    pr.points.forEach(function (p, i) {
      if (p.y < 0) { m.add(tab, 'err', w + ', point ' + (p.pt || i + 1) + ': Y must be ≥ 0 (enter the right half only).'); }
    });
    var first = pr.points[0], last = pr.points[pr.points.length - 1];
    if (first.y !== 0) { m.add(tab, 'warn', w + ' does not start on the centre line (Y = 0); the outline is closed with a straight line.'); }
    if (last.y !== 0 && !openEnd) { m.add(tab, 'warn', w + ' does not end on the centre line (Y = 0); the outline is closed with a straight line.'); }
    var e = extent(pr.points);
    if (e.ymax <= 20 && e.zmax <= 20) { m.add(tab, 'warn', w + ' looks like it is in metres; coordinates must be in mm.'); }
  }

  function validate(p) {
    var m = new Msgs(), t = p.train, cars = t.carTypes, carNames, bogieNames, i;
    // ---- train
    rangeChecks(m, 'train', 'Train', t, S.trainDescription);
    if (!cars.length) { m.add('train', 'err', 'No car types defined.'); }
    carNames = uniqueNames(m, 'train', 'Car type', cars);
    bogieNames = {};
    p.bogies.forEach(function (b) { if (b.name) { bogieNames[b.name] = true; } });
    var total = 0;
    cars.forEach(function (c) {
      var w = 'Car type ' + (c.name || '?');
      rangeChecks(m, 'train', w, c, S.carType);
      total += c.count || 0;
      if (c.length_m && c.a_m !== null) {
        var sum = c.a_m + (c.na1_m || 0) + (c.na2_m || 0);
        if (Math.abs(sum - c.length_m) > 0.05) { m.add('train', 'warn', w + ': a + overhangs = ' + sum.toFixed(2) + ' m differs from the body length ' + c.length_m + ' m.'); }
      }
      if (c.mass_laden_t !== null && c.mass_tare_t !== null && c.mass_laden_t < c.mass_tare_t) { m.add('train', 'err', w + ': laden mass is below tare mass.'); }
      ['bogie1', 'bogie2'].forEach(function (k) {
        if (!c[k]) { m.add('train', 'err', w + ': bogie type at ' + (k === 'bogie1' ? 'end 1' : 'end 2') + ' is empty.'); }
        else if (!bogieNames[c[k]]) { m.add('train', 'err', w + ': bogie type "' + c[k] + '" is not defined on the Car body & Bogie tab.'); }
      });
      if (t.bogie_arrangement === 'shared' && ((c.na1_m || 0) > 0.6 && (c.na2_m || 0) > 0.6)) {
        m.add('train', 'warn', w + ': both overhangs are long for a shared-bogie (articulated) car; check a and the overhangs.');
      }
      if (c.width_mm && c.width_mm / 2 > 2500) { m.add('train', 'warn', w + ': half-width above 2500 mm.'); }
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
    if (t.L_mm && t.gauge_mm && t.L_mm < t.gauge_mm) { m.add('train', 'warn', 'L (' + t.L_mm + ' mm) is smaller than the track gauge.'); }

    // ---- bogies and bodies
    if (!p.bogies.length) { m.add('bogie', 'err', 'No bogie types defined.'); }
    uniqueNames(m, 'bogie', 'Bogie type', p.bogies);
    p.bogies.forEach(function (b) {
      var w = 'Bogie ' + (b.name || '?');
      rangeChecks(m, 'bogie', w, b, S.bogie);
      if (b.wheel_worn_mm !== null && b.wheel_new_mm !== null && b.wheel_worn_mm > b.wheel_new_mm) { m.add('bogie', 'err', w + ': worn wheel diameter is larger than new.'); }
      if (b.d_min_mm && t.gauge_mm && b.d_min_mm >= t.gauge_mm) { m.add('bogie', 'err', w + ': dimension over flanges d is not smaller than the track gauge.'); }
    });
    var bodyCars = {};
    p.bodies.forEach(function (b) {
      bodyCars[b.car] = true;
      if (!carNames[b.car]) { m.add('bogie', 'warn', 'Car body data for "' + b.car + '", which is not a car type (ignored).'); return; }
      rangeChecks(m, 'bogie', 'Car body ' + b.car, b, S.body);
    });
    cars.forEach(function (c) { if (c.name && !bodyCars[c.name]) { m.add('bogie', 'err', 'No car body data for ' + c.name + '.'); } });

    // ---- KE / SOD
    if (!p.ke.profiles.length) { m.add('ke', 'err', 'No customer KE profile.'); }
    var keNames = uniqueNames(m, 'ke', 'KE profile', p.ke.profiles);
    p.ke.profiles.forEach(function (pr) { profileChecks(m, 'ke', 'KE profile', pr); });
    rangeChecks(m, 'ke', 'EN 15273 parameters', p.ke.en, S.enParams);
    if (!p.sod.profiles.length) { m.add('ke', 'warn', 'No SOD / structure gauge profile (needed for the dynamic simulation).'); }
    var sodNames = uniqueNames(m, 'ke', 'SOD profile', p.sod.profiles);
    p.sod.profiles.forEach(function (pr) { profileChecks(m, 'ke', 'SOD profile', pr, true); });
    p.sod.items.forEach(function (it, k) {
      if (it.y === null || it.z === null) { m.add('ke', 'err', 'SOD item ' + (it.name || k + 1) + ': Y and Z are needed.'); }
    });

    // ---- RS profile
    if (!p.rs.profiles.length) { m.add('rs', 'err', 'No rolling stock profile.'); }
    uniqueNames(m, 'rs', 'RS profile', p.rs.profiles);
    p.rs.profiles.forEach(function (pr) {
      profileChecks(m, 'rs', 'RS profile', pr);
      if (pr.car !== 'ALL' && !carNames[pr.car]) { m.add('rs', 'err', 'RS profile "' + pr.name + '": car type "' + pr.car + '" is not defined (use ALL or a car type name).'); }
    });
    if (p.rs.profiles.length && !p.rs.profiles.some(function (pr) { return pr.mount === 'body'; })) { m.add('rs', 'warn', 'No car-body profile (mounting level = body).'); }

    // ---- track
    rangeChecks(m, 'track', 'Track parameters', p.track.params, S.trackParams);
    var seg = p.track.segments;
    if (!seg.length) { m.add('track', 'warn', 'No track segments (needed for the dynamic simulation).'); }
    for (i = 0; i < seg.length; i++) {
      var s = seg[i], w = 'Segment ' + (i + 1) + (s.element ? ' (' + s.element + ')' : '');
      rangeChecks(m, 'track', w, s, S.segment);
      if (s.from_m !== null && s.to_m !== null && s.to_m <= s.from_m) { m.add('track', 'err', w + ': chainage to must be greater than chainage from.'); }
      if (s.R_m > 0 && !s.side) { m.add('track', 'err', w + ': curve without a side (L/R).'); }
      if (s.R_m > 0 && s.R_m < (p.ke.en.Rmin_m || 150)) { m.add('track', 'warn', w + ': R = ' + s.R_m + ' m is below ' + (p.ke.en.Rmin_m || 150) + ' m; the overthrow formula needs checking by the graphic method.'); }
      if (!s.R_m && s.cant_mm > 0) { m.add('track', 'warn', w + ': cant on tangent track.'); }
      if (s.Rv_m && Math.abs(s.Rv_m) < 500) { m.add('track', 'warn', w + ': vertical radius |Rv| below 500 m.'); }
      if (s.sod && p.sod.profiles.length && !sodNames[s.sod]) { m.add('track', 'err', w + ': SOD profile "' + s.sod + '" not found.'); }
      if (!s.sod) { m.add('track', 'warn', w + ': no SOD profile assigned.'); }
      if (s.ke && p.ke.profiles.length && !keNames[s.ke]) { m.add('track', 'err', w + ': KE profile "' + s.ke + '" not found.'); }
      if (i > 0 && seg[i - 1].to_m !== null && s.from_m !== null) {
        if (s.from_m < seg[i - 1].to_m - 1e-6) { m.add('track', 'err', w + ' overlaps the previous segment (from ' + s.from_m + ' < ' + seg[i - 1].to_m + ').'); }
        else if (s.from_m > seg[i - 1].to_m + 1e-6) { m.add('track', 'warn', 'Gap in the track data between ' + seg[i - 1].to_m + ' m and ' + s.from_m + ' m.'); }
      }
    }
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
    clean: clean, num: num, record: record, emptyProject: emptyProject, normalizeProject: normalizeProject,
    syncBodies: syncBodies, formationTokens: formationTokens, fullProfile: fullProfile, extent: extent,
    toMillimetres: toMillimetres, validate: validate, sortSegments: sortSegments, trackLength: trackLength
  };
}));
