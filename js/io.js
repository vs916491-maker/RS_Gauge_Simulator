/*
 * Import/export: Excel/CSV templates and importers for every input tab, the project file (*.rsgauge.json)
 * and downloads. Needs vendor/xlsx.full.min.js (XLSX global). Works offline: files are read with FileReader
 * and written with Blob downloads. Contains no physics. Attaches to RSGAUGE.io.
 *
 * Sheet layouts (the same in templates, "download current data", "export all" and the importers):
 *   parameter sheet : Parameter | Value | Unit | Key            (Train, CustomerLimits, EN_Params, SOD_Settings, TrackParams)
 *   grid sheet      : Parameter | Unit | Key | item 1 | item 2   (CarTypes, Bogies, CarBodies: one column per item)
 *   table sheet     : one row per record, headers "Label [unit] (key)"   (SOD_Items, Track)
 *   profile sheet   : one row per point, the profile name repeated  (KE, SOD, RSProfile)
 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var S = node ? require('./schema.js') : root.RSGAUGE.schema;
  var M = node ? require('./model.js') : root.RSGAUGE.model;
  var api = factory(S, M, root);
  if (node) { module.exports = api; }
  else { root.RSGAUGE = root.RSGAUGE || {}; root.RSGAUGE.io = api; }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (S, M, root) {
  'use strict';

  function X() { if (!root.XLSX) { throw new Error('The Excel library (vendor/xlsx.full.min.js) did not load.'); } return root.XLSX; }

  // ---------------------------------------------------------------- sheet catalogue
  var PROFILE_SHEETS = {
    KE: { group: 'ke', fields: S.keProfile },
    SOD: { group: 'sod', fields: S.sodProfile },
    RSProfile: { group: 'rs', fields: S.rsProfile }
  };
  var TAB_SHEETS = {
    train: ['Train', 'CarTypes'],
    bogie: ['Bogies', 'CarBodies'],
    ke: ['KE', 'CustomerLimits', 'SOD', 'SOD_Settings', 'SOD_Items', 'EN_Params'],
    rs: ['RSProfile'],
    track: ['TrackParams', 'Track']
  };
  var PRIMARY = { train: 'Train', bogie: 'Bogies', ke: 'KE', rs: 'RSProfile', track: 'Track' };
  var ALL_SHEETS = [].concat(TAB_SHEETS.train, TAB_SHEETS.bogie, TAB_SHEETS.ke, TAB_SHEETS.rs, TAB_SHEETS.track);

  function head(fd) { return fd.l + (fd.u ? ' [' + fd.u + ']' : '') + ' (' + fd.k + ')'; }
  function keyOf(cell) {
    var s = String(cell === undefined || cell === null ? '' : cell).trim(), m = /\(([A-Za-z][A-Za-z0-9_]*)\)\s*$/.exec(s);
    return m ? m[1] : s;
  }
  var ALIASES = { profile: 'name', 'profile name': 'name', point: 'pt', 'point name': 'pt', lateral: 'y', 'y_mm': 'y', 'y (mm)': 'y',
    height: 'z', 'z_mm': 'z', 'z (mm)': 'z', 'car type': 'car', mounting: 'mount', 'mounting level': 'mount' };
  function matchKey(cell, fields) {
    var k = keyOf(cell), low = String(cell || '').trim().toLowerCase(), i;
    for (i = 0; i < fields.length; i++) { if (fields[i].k === k || fields[i].k.toLowerCase() === k.toLowerCase()) { return fields[i].k; } }
    if (ALIASES[low]) { return ALIASES[low]; }
    if (ALIASES[k.toLowerCase()]) { return ALIASES[k.toLowerCase()]; }
    for (i = 0; i < fields.length; i++) { if (fields[i].l.toLowerCase() === low) { return fields[i].k; } }
    return null;
  }
  function optLabel(fd) { return fd.o ? ' — options: ' + fd.o.map(function (o) { return o[0] || '(blank)'; }).join(' / ') : ''; }

  // ---------------------------------------------------------------- writers (array-of-arrays)
  function paramRows(obj, fields) {
    var rows = [['Parameter', 'Value', 'Unit', 'Key']];
    fields.forEach(function (fd) { rows.push([fd.l, obj[fd.k] === null || obj[fd.k] === undefined ? '' : obj[fd.k], fd.u, fd.k]); });
    return rows;
  }
  function gridRows(items, fields) {
    var hdr = ['Parameter', 'Unit', 'Key'];
    items.forEach(function (it, i) { hdr.push('Item ' + (i + 1)); });
    var rows = [hdr];
    fields.forEach(function (fd) {
      var r = [fd.l + optLabel(fd), fd.u, fd.k];
      items.forEach(function (it) { r.push(it[fd.k] === null || it[fd.k] === undefined ? '' : it[fd.k]); });
      rows.push(r);
    });
    return rows;
  }
  function tableRows(recs, fields) {
    var rows = [fields.map(head)];
    recs.forEach(function (r) { rows.push(fields.map(function (fd) { return r[fd.k] === null || r[fd.k] === undefined ? '' : r[fd.k]; })); });
    return rows;
  }
  function profileRows(list, prFields) {
    var hdr = prFields.map(head).concat(S.point.map(head)), rows = [hdr];
    list.forEach(function (pr) {
      pr.points.forEach(function (pt) {
        rows.push(prFields.map(function (fd) { return pr[fd.k] === undefined ? '' : pr[fd.k]; }).concat([pt.pt, pt.y, pt.z]));
      });
    });
    return rows;
  }
  function sheetRows(name, p) {
    switch (name) {
      case 'Train': return paramRows(p.train, S.trainFields);
      case 'CarTypes': return gridRows(p.train.carTypes, S.carType);
      case 'Bogies': return gridRows(p.bogies, S.bogie);
      case 'CarBodies': return gridRows(p.bodies, S.body);
      case 'KE': return profileRows(p.ke.profiles, S.keProfile);
      case 'CustomerLimits': return paramRows(p.ke.limits, S.customerLimits);
      case 'EN_Params': return paramRows(p.ke.en, S.enParams);
      case 'SOD': return profileRows(p.sod.profiles, S.sodProfile);
      case 'SOD_Settings': return paramRows(p.sod, S.sodSettings);
      case 'SOD_Items': return tableRows(p.sod.items, S.sodItem);
      case 'RSProfile': return profileRows(p.rs.profiles, S.rsProfile);
      case 'TrackParams': return paramRows(p.track.params, S.trackParams);
      case 'Track': return tableRows(p.track.segments, S.segment);
    }
    throw new Error('Unknown sheet ' + name);
  }

  var README = {
    Train: 'Train description, configuration, load labels and wind constants. Edit the Value column only.',
    CarTypes: 'One column per car type (add columns to the right for more types): body length, overhangs, shared ends, section positions, masses, CG, bogie types and the RS profile of each section. Key column must stay unchanged.',
    Bogies: 'One column per bogie type (e.g. M, T): plays, vertical travels, mass, suspension stiffness (theoretical s and hc) and the play calculator. Car types refer to these names.',
    CarBodies: 'One column per car type: wind-exposed side, lower parts, specified flexibility coefficient and roll-centre height.',
    KE: 'Customer kinematic envelope(s): one row per point, right half (Y >= 0) from the top centre round the outside to rail level, in mm. Repeat the profile name (and n_up = points of the upper envelope) on every row; several profiles may follow each other.',
    CustomerLimits: 'Customer limits and SOD curve-allowance rule, dynamic reference heights.',
    EN_Params: 'EN 15273-2 reference parameters (kept for a later phase; not used by the current method).',
    SOD: 'Structure gauge / SOD profile(s): same layout as KE.',
    SOD_Settings: 'Frame of the SOD and the required minimum clearance.',
    SOD_Items: 'Point items to clear: third rail, platform edge, walkway, equipment. One row per item.',
    RSProfile: 'Rolling stock static section profile(s) (e.g. roof section, HVAC section): profile name and points as for KE. Car types pick a profile for each section.',
    TrackParams: 'Operating limits (cant, cant deficiency / excess, wind), track tolerances and the static-check geometry.',
    Track: 'One row per element (Tangent / Transition / Circular) in increasing chainage, without gaps. R 0 = infinite; transitions go from R start to R end with cant start to cant end. Rv > 0 crest, < 0 sag. Location Open / Tunnel / Platform / Depot.'
  };

  function buildWorkbook(sheets, p, title) {
    var XL = X(), wb = XL.utils.book_new(), rd = [[title], [''], ['Sheet', 'What it holds']];
    sheets.forEach(function (n) { rd.push([n, README[n]]); });
    rd.push([''], ['Rules: lengths of vehicle and track in m, profile coordinates, plays, travels and heights in mm, cant in mm, speed in km/h, masses in t.'],
      ['Y = lateral from track centre (right half, >= 0), Z = height above top of rail. Coordinates in metres are converted to mm on import.'],
      ['Do not rename sheets or change the Key column / the (key) at the end of a header: the importer uses them.']);
    if (p.fictional) { rd.push([''], ['Data in this file is the FICTIONAL demo example.']); }
    var ws = XL.utils.aoa_to_sheet(rd); ws['!cols'] = [{ wch: 16 }, { wch: 120 }];
    XL.utils.book_append_sheet(wb, ws, 'README');
    sheets.forEach(function (n) {
      var rows = sheetRows(n, p), sh = XL.utils.aoa_to_sheet(rows);
      sh['!cols'] = rows[0].map(function (c, i) { return { wch: i === 0 ? 52 : Math.max(10, Math.min(36, String(c).length + 2)) }; });
      XL.utils.book_append_sheet(wb, sh, n);
    });
    return wb;
  }
  function workbookBytes(wb) { return X().write(wb, { bookType: 'xlsx', type: 'array' }); }
  function tabWorkbook(tab, p, title) { return buildWorkbook(TAB_SHEETS[tab], p, title || ('Rolling Stock Gauge Simulator — ' + tab + ' inputs')); }
  function allInputsWorkbook(p) { return buildWorkbook(ALL_SHEETS, p, 'Rolling Stock Gauge Simulator — all inputs: ' + p.name); }

  // ---------------------------------------------------------------- readers
  function rowsOf(wb, name) {
    var XL = X();
    return XL.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false, raw: true })
      .map(function (r) { return r.map(function (c) { return typeof c === 'string' ? c.trim() : c; }); })
      .filter(function (r) { return r.some(function (c) { return c !== ''; }); });
  }
  function readParams(rows, fields, msgs, sheet) {
    var out = {}, n = 0;
    rows.forEach(function (r, i) {
      if (i === 0 && String(r[0]).toLowerCase() === 'parameter') { return; }
      var k = r[3] ? matchKey(r[3], fields) : matchKey(r[0], fields);
      if (!k) { if (r[0]) { msgs.push({ level: 'warn', text: sheet + ' row ' + (i + 1) + ': "' + r[0] + '" is not a known parameter (ignored).' }); } return; }
      out[k] = r[1]; n++;
    });
    if (!n) { msgs.push({ level: 'err', text: sheet + ': no parameters found.' }); }
    return out;
  }
  function readGrid(rows, fields, msgs, sheet) {
    var keyRow = {}, nameKey = fields[0].k, cols = 0;
    rows.forEach(function (r, i) {
      if (i === 0 && String(r[0]).toLowerCase() === 'parameter') { cols = r.length; return; }
      var k = r[2] ? matchKey(r[2], fields) : matchKey(String(r[0]).replace(/ — options:.*$/, ''), fields);
      if (k) { keyRow[k] = r; cols = Math.max(cols, r.length); }
    });
    if (!keyRow[nameKey]) { msgs.push({ level: 'err', text: sheet + ': the "' + fields[0].l + '" row (key ' + nameKey + ') was not found.' }); return null; }
    var items = [], c;
    for (c = 3; c < cols; c++) {
      if (keyRow[nameKey][c] === '' || keyRow[nameKey][c] === undefined) { continue; }
      var it = {};
      fields.forEach(function (fd) { if (keyRow[fd.k]) { it[fd.k] = keyRow[fd.k][c]; } });
      items.push(it);
    }
    if (!items.length) { msgs.push({ level: 'err', text: sheet + ': no columns with a name.' }); }
    return items;
  }
  function headerMap(hdr, fields) {
    var map = {};
    hdr.forEach(function (h, i) { var k = matchKey(h, fields); if (k && map[k] === undefined) { map[k] = i; } });
    return map;
  }
  function readTable(rows, fields, msgs, sheet) {
    if (!rows.length) { msgs.push({ level: 'err', text: sheet + ': empty sheet.' }); return null; }
    var map = headerMap(rows[0], fields), recs = [];
    var missing = fields.filter(function (fd) { return fd.t === 'num' && fd.d === undefined && map[fd.k] === undefined; });
    if (missing.length) { msgs.push({ level: 'err', text: sheet + ': column(s) missing: ' + missing.map(function (fd) { return fd.l; }).join(', ') + '.' }); return null; }
    rows.slice(1).forEach(function (r) {
      var o = {};
      fields.forEach(function (fd) { if (map[fd.k] !== undefined) { o[fd.k] = r[map[fd.k]]; } });
      recs.push(o);
    });
    return recs;
  }
  function readProfiles(rows, prFields, msgs, sheet) {
    if (!rows.length) { msgs.push({ level: 'err', text: sheet + ': empty sheet.' }); return null; }
    var all = prFields.concat(S.point), map = headerMap(rows[0], all);
    if (map.y === undefined || map.z === undefined) { msgs.push({ level: 'err', text: sheet + ': the Y and Z columns were not found (headers like "Y [mm] (y)" and "Z [mm] (z)").' }); return null; }
    var list = [], byName = {}, single = map.name === undefined;
    rows.slice(1).forEach(function (r, i) {
      var y = M.num(r[map.y]), z = M.num(r[map.z]);
      if (y === null || z === null) { msgs.push({ level: 'warn', text: sheet + ' row ' + (i + 2) + ': Y or Z is not a number (row skipped).' }); return; }
      var name = single ? 'Imported' : String(r[map.name] || '').trim() || 'Imported';
      var pr = byName[name];
      if (!pr) {
        pr = { name: name, points: [] };
        prFields.forEach(function (fd) { if (fd.k !== 'name' && map[fd.k] !== undefined && r[map[fd.k]] !== '') { pr[fd.k] = r[map[fd.k]]; } });
        byName[name] = pr; list.push(pr);
      }
      pr.points.push({ pt: map.pt !== undefined ? String(r[map.pt]) : String(pr.points.length + 1), y: y, z: z });
    });
    list.forEach(function (pr) {
      var c = M.toMillimetres(pr.points);
      if (c.converted) { pr.points = c.points; msgs.push({ level: 'warn', text: sheet + ' "' + pr.name + '": coordinates looked like metres and were converted to mm.' }); }
    });
    return list;
  }
  function mergeByName(old, add) {
    var out = old.slice(), idx = {};
    out.forEach(function (p, i) { idx[p.name] = i; });
    add.forEach(function (p) { if (idx[p.name] !== undefined) { out[idx[p.name]] = p; } else { idx[p.name] = out.length; out.push(p); } });
    return out;
  }

  /*
   * Import the known sheets of a workbook into a copy of the project.
   * opts: { tab: 'train'|'bogie'|'ke'|'rs'|'track'|'all', mode: 'replace'|'merge' (profiles only) }
   * Returns { project, messages, imported:[sheet names] }. The input project is not changed.
   */
  function importWorkbook(wb, project, opts) {
    opts = opts || {};
    var tab = opts.tab || 'all', mode = opts.mode || 'replace';
    var raw = JSON.parse(JSON.stringify(project)), msgs = [], imported = [];
    var want = tab === 'all' ? ALL_SHEETS : TAB_SHEETS[tab];
    var names = wb.SheetNames.slice();
    var present = want.filter(function (n) { return names.indexOf(n) >= 0; });
    // a CSV (or a workbook with a single unknown sheet) is read as the tab's main sheet
    if (!present.length && names.length === 1 && tab !== 'all') {
      wb = { SheetNames: [PRIMARY[tab]], Sheets: (function () { var o = {}; o[PRIMARY[tab]] = wb.Sheets[names[0]]; return o; }()) };
      present = [PRIMARY[tab]];
      msgs.push({ level: 'ok', text: 'Single sheet read as "' + PRIMARY[tab] + '".' });
    }
    if (!present.length) {
      msgs.push({ level: 'err', text: 'None of the expected sheets (' + want.join(', ') + ') was found. Use the template of this tab.' });
      return { project: project, messages: msgs, imported: imported };
    }
    present.forEach(function (n) {
      var rows = rowsOf(wb, n), before = msgs.length, v, list;
      switch (n) {
        case 'Train':
          v = readParams(rows, S.trainFields, msgs, n);
          Object.keys(v).forEach(function (k) { raw.train[k] = v[k]; });
          break;
        case 'CarTypes': v = readGrid(rows, S.carType, msgs, n); if (v) { raw.train.carTypes = v; } break;
        case 'Bogies': v = readGrid(rows, S.bogie, msgs, n); if (v) { raw.bogies = v; } break;
        case 'CarBodies': v = readGrid(rows, S.body, msgs, n); if (v) { raw.bodies = v; } break;
        case 'EN_Params': v = readParams(rows, S.enParams, msgs, n); Object.keys(v).forEach(function (k) { raw.ke.en[k] = v[k]; }); break;
        case 'CustomerLimits': v = readParams(rows, S.customerLimits, msgs, n); Object.keys(v).forEach(function (k) { raw.ke.limits[k] = v[k]; }); break;
        case 'SOD_Settings': v = readParams(rows, S.sodSettings, msgs, n); Object.keys(v).forEach(function (k) { raw.sod[k] = v[k]; }); break;
        case 'SOD_Items': v = readTable(rows, S.sodItem, msgs, n); if (v) { raw.sod.items = v; } break;
        case 'TrackParams': v = readParams(rows, S.trackParams, msgs, n); Object.keys(v).forEach(function (k) { raw.track.params[k] = v[k]; }); break;
        case 'Track': v = readTable(rows, S.segment, msgs, n); if (v) { raw.track.segments = v; } break;
        default:
          list = readProfiles(rows, PROFILE_SHEETS[n].fields, msgs, n);
          if (list) {
            var g = PROFILE_SHEETS[n].group;
            raw[g].profiles = mode === 'merge' ? mergeByName(raw[g].profiles, list) : list;
            v = list;
          }
      }
      var failed = msgs.slice(before).some(function (x) { return x.level === 'err'; });
      if (!failed) {
        imported.push(n);
        var cnt = Array.isArray(v) ? ' (' + v.length + (PROFILE_SHEETS[n] ? ' profile' : ' row') + (v.length === 1 ? '' : 's') + ')' : '';
        msgs.push({ level: 'ok', text: 'Imported ' + n + cnt + '.' });
      }
    });
    return { project: imported.length ? M.normalizeProject(raw) : project, messages: msgs, imported: imported };
  }

  function readWorkbookBytes(data, isCsv) { return isCsv ? X().read(data, { type: 'string' }) : X().read(data, { type: 'array' }); }

  // ---------------------------------------------------------------- static results export
  function r2(v, d) { return (v === null || v === undefined || !isFinite(v)) ? '' : Math.round(v * Math.pow(10, d === undefined ? 1 : d)) / Math.pow(10, d === undefined ? 1 : d); }
  function staticResultsWorkbook(res, p, meta) {
    var XL = X(), wb = XL.utils.book_new(), o = p.settings['static'];
    function add(name, rows, w) { var sh = XL.utils.aoa_to_sheet(rows); sh['!cols'] = rows[0].map(function (c, i) { return { wch: i === 0 ? (w || 22) : 14 }; }); XL.utils.book_append_sheet(wb, sh, name); }
    var sum = [['Rolling Stock Gauge Simulator – static results'], ['Project', p.name], ['Customer KE', res.ke.name], ['Engine version', res.engineVersion],
      ['Inputs changed since this run', meta && meta.stale ? 'YES – run again' : 'no'], ['Fictional example data', p.fictional ? 'YES' : 'no'], [''],
      ['Governing', res.governing ? res.governing.car + ' – ' + res.governing.label : '', res.governing ? r2(res.governing.c) : '', 'mm', res.ok ? 'ALL OK' : 'CHECK'], [''],
      ['Car type', 'Case', 'Section n (m)', 'Profile', 'Min clearance (mm)', 'At point', 'x displaced (mm)', 'h displaced (mm)', 'T (mm)', 'Status']];
    res.cars.forEach(function (c) { c.cases.forEach(function (k) { sum.push([c.car, k.label, r2(k.params.n, 3), k.profile, r2(k.min.c, 2), k.min.pt, r2(k.min.x), r2(k.min.h), r2(k.params.T, 2), k.ok ? 'OK' : 'INFRINGES']); }); });
    sum.push([''], ['Options']);
    S.staticOptions.forEach(function (fd) { sum.push([fd.l, o[fd.k] === null ? '' : o[fd.k]]); });
    if (res.warnings.length) { sum.push([''], ['Warnings']); res.warnings.forEach(function (w) { sum.push([w]); }); }
    add('Static_Summary', sum, 34);
    var keys = [['n', 'Section position from pivot', 'm', 3], ['A', 'Yaw factor A', '–', 4], ['dg', 'Geometric overthrow', 'mm', 2], ['play', 'Wheel–rail half play × A', 'mm', 2], ['q', 'Primary lateral play × A', 'mm', 2],
      ['w', 'Secondary lateral play × A', 'mm', 2], ['fw', 'Rail gauge-face wear × A', 'mm', 2], ['widen', 'Gauge widening/2 × A', 'mm', 2], ['T', 'Quasi-static translation T', 'mm', 2],
      ['rnd_gauge', 'Random: track gauge tolerance', 'mm', 2], ['rnd_align', 'Random: alignment tolerance', 'mm', 2], ['cant', 'Cant excess (int) / deficiency (ext, end)', 'mm', 1], ['wind', 'Wind equivalent cant', 'mm', 2],
      ['cl', 'Cross-level error', 'mm', 1], ['s', 'Flexibility coefficient s', '–', 4], ['hc', 'Roll-centre height hc', 'm', 4], ['thq', 'Roll angle quasi-static θq', 'rad', 5], ['thr', 'Roll angle cross-level θr', 'rad', 5],
      ['tht', 'Rigid tilt θt', 'rad', 5], ['thtot', 'Total angle for vertical shift', 'rad', 5], ['drop', 'Body lowering (crush)', 'mm', 1], ['up', 'Upward movement combined with roll', 'mm', 1]];
    var bu = [['Car type', 'Quantity', 'Unit'].concat(res.cars[0] ? res.cars[0].cases.map(function (k) { return k.label; }) : [])];
    res.cars.forEach(function (c) { keys.forEach(function (k) { bu.push([c.car, k[1], k[2]].concat(c.cases.map(function (cs) { return r2(cs.params[k[0]], k[3]); }))); }); });
    add('Static_BuildUp', bu, 12);
    var pt = [['Car type', 'Case', 'Pt', 'x0 (mm)', 'h0 (mm)', 'Lateral E (mm)', 'x displaced (mm)', 'h displaced (mm)', 'KE width at h (mm)', 'ΔX (mm)', 'KE height at x (mm)', 'ΔH (mm)', 'Clearance (mm)', 'Status']];
    res.cars.forEach(function (c) { c.cases.forEach(function (k) { k.points.forEach(function (q) { pt.push([c.car, k.label, q.pt, r2(q.x0), r2(q.h0), r2(q.E, 2), r2(q.x, 2), r2(q.h, 2), r2(q.W, 2), r2(q.dX, 2), r2(q.H, 2), r2(q.dH, 2), r2(q.c, 2), q.ok ? 'OK' : 'INFRINGES']); }); }); });
    add('Static_Points', pt, 10);
    var ma = [['Car type', 'h (mm)', 'KE width (mm)', 'E Int-T', 'E Int-C', 'E Ext-T', 'E Ext-C', 'E End-T', 'E End-C', 'Max static Int (mm)', 'Max static Ext (mm)', 'Max static End (mm)', 'Profile Int (mm)', 'Profile Ext (mm)', 'Profile End (mm)', 'Margin Int (mm)', 'Margin Ext (mm)', 'Margin End (mm)']];
    res.cars.forEach(function (c) { c.methodA.forEach(function (r) { ma.push([c.car, r2(r.h, 0), r2(r.W)].concat(r.E.map(function (e) { return r2(e); }), [r2(r.max_int), r2(r.max_ext), r2(r.max_end), r2(r.prof_int), r2(r.prof_ext), r2(r.prof_end), r2(r.margin_int), r2(r.margin_ext), r2(r.margin_end)])); }); });
    add('Method_A', ma, 10);
    var vc = [['Car type', 'Check', 'Value (mm)', 'Limit (mm)', 'Margin (mm)', 'Status']];
    res.cars.forEach(function (c) { c.vertical.forEach(function (v) { vc.push([c.car, v.label, r2(v.value, 2), v.info ? '' : r2(v.limit, 1), v.info ? '' : r2(v.margin, 2), v.info ? '' : (v.ok ? 'OK' : 'BELOW MIN / INFRINGES')]); }); });
    add('Vertical_Checks', vc, 10);
    var dv = [['Car type', 'a (m)', 'n1 (m)', 'n2 (m)', 'n end (m)', 'ni (m)', 'na (m)', 'A ext', 'A end', 'w used (mm)', 'Σd (mm)', 'Σu (mm)', 'Cw tare', 'Cw crush', 'Dw tare (mm)', 'Dw crush (mm)', 'Wind force (N)',
      's tare', 's crush', 'hc tare (m)', 'hc crush (m)', 's theo tare', 's theo crush', 's theo defl', 'hc theo tare (m)', 'hc theo crush (m)', 'hc theo defl (m)', 'Axle load (t)', 'Axle limit (t)', 'Width loss vs non-shared (mm)']];
    res.cars.forEach(function (c) {
      var d = c.derived, g = d.geo, t = d.theoretical;
      dv.push([c.car, r2(g.a, 3), r2(g.n1, 3), r2(g.n2, 3), r2(g.n_end, 3), r2(g.ni, 3), r2(g.na, 3), r2(g.A_ext, 4), r2(g.A_end, 4), r2(d.w_use, 1), r2(d.dn_total, 1), r2(d.up_total, 1), r2(d.wind.Cw_t, 6), r2(d.wind.Cw_c, 6),
        r2(d.wind.Dw_t, 2), r2(d.wind.Dw_c, 2), r2(d.wind.F, 0), r2(d.s_t, 4), r2(d.s_c, 4), r2(d.hc_t, 4), r2(d.hc_c, 4), r2(t.tare.s, 4), r2(t.crush.s, 4), r2(t.defl.s, 4), r2(t.tare.hc, 4), r2(t.crush.hc, 4), r2(t.defl.hc, 4),
        r2(d.shared.axle_t, 3), r2(d.shared.axle_lim_t, 2), r2(d.shared.width_loss, 1)]);
    });
    add('Derived_Values', dv, 10);
    return wb;
  }

  // ---------------------------------------------------------------- project file
  function projectJson(p) {
    var o = M.normalizeProject(p);
    o.savedAt = new Date().toISOString();
    return JSON.stringify(o, null, 2);
  }
  function parseProject(text) {
    var o;
    try { o = JSON.parse(text); } catch (e) { throw new Error('The file is not valid JSON: ' + e.message); }
    if (!o || typeof o !== 'object') { throw new Error('The file does not contain a project.'); }
    if (o.format !== M.FORMAT) { throw new Error('This is not a gauge simulator project file (format "' + (o.format || 'none') + '").'); }
    if (o.version > M.VERSION) { throw new Error('The project was saved by a newer version (file version ' + o.version + ', this tool reads up to ' + M.VERSION + ').'); }
    return M.normalizeProject(o);
  }
  function fileSlug(s) { return (String(s || 'project').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project').slice(0, 80); }

  // ---------------------------------------------------------------- browser helpers
  function downloadBlob(blob, filename) {
    var a = root.document.createElement('a'), url = root.URL.createObjectURL(blob);
    a.href = url; a.download = filename; root.document.body.appendChild(a); a.click();
    setTimeout(function () { root.URL.revokeObjectURL(url); a.remove(); }, 0);
  }
  function downloadText(text, filename, type) { downloadBlob(new root.Blob([text], { type: type || 'text/plain' }), filename); }
  function downloadWorkbook(wb, filename) {
    downloadBlob(new root.Blob([workbookBytes(wb)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  }
  function readFile(file, cb) {
    var fr = new root.FileReader(), isCsv = /\.(csv|txt)$/i.test(file.name), isJson = /\.json$/i.test(file.name);
    fr.onerror = function () { cb(new Error('Could not read ' + file.name)); };
    fr.onload = function () {
      try { cb(null, isJson ? fr.result : readWorkbookBytes(isCsv ? fr.result : new Uint8Array(fr.result), isCsv), file.name); }
      catch (e) { cb(e); }
    };
    if (isCsv || isJson) { fr.readAsText(file); } else { fr.readAsArrayBuffer(file); }
  }

  return {
    TAB_SHEETS: TAB_SHEETS, ALL_SHEETS: ALL_SHEETS, sheetRows: sheetRows, keyOf: keyOf,
    tabWorkbook: tabWorkbook, allInputsWorkbook: allInputsWorkbook, workbookBytes: workbookBytes, staticResultsWorkbook: staticResultsWorkbook,
    importWorkbook: importWorkbook, readWorkbookBytes: readWorkbookBytes,
    projectJson: projectJson, parseProject: parseProject, fileSlug: fileSlug,
    downloadBlob: downloadBlob, downloadText: downloadText, downloadWorkbook: downloadWorkbook, readFile: readFile
  };
}));
