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
    train: ['Train', 'CarTypes', 'LoadCases', 'CarLoads', 'Sections'],
    bogie: ['Bogies', 'CarBodies', 'EN_Lower_Parts', 'EN_Bogie_Parts', 'CCD', 'CCD_Points'],
    ke: ['KE', 'CustomerLimits', 'SOD', 'SOD_Settings', 'SOD_Items', 'EN_Params', 'Third_Rail', 'Third_Rail_Parts'],
    rs: ['RSProfile', 'EN_Doors_Steps', 'EN_Pantographs'],
    track: ['TrackParams', 'Track'],
    tests: ['Sway_Test'],
    endyn: ['Sim_Settings', 'Sim_Cars', 'Sim_Transient', 'Sim_Curving', 'Val_Weighbridge', 'Val_BogieRotation', 'Val_Sway', 'Val_Ride']
  };
  var PRIMARY = { train: 'Train', bogie: 'Bogies', ke: 'KE', rs: 'RSProfile', track: 'Track', tests: 'Sway_Test', endyn: 'Sim_Transient' };
  var ALL_SHEETS = [].concat(TAB_SHEETS.train, TAB_SHEETS.bogie, TAB_SHEETS.ke, TAB_SHEETS.rs, TAB_SHEETS.track, TAB_SHEETS.tests, TAB_SHEETS.endyn);

  // parameters of older versions, skipped without a warning when an older file is imported
  var RETIRED = { bogie_arrangement: true, tare_label: true, laden_label: true };

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
      case 'LoadCases': return tableRows((p.loads || {}).cases || [], S.loadCase);
      case 'CarLoads': return tableRows((p.loads || {}).cars || [], S.carLoad);
      case 'Sections': return tableRows(p.sections || [], S.extraSection);
      case 'Bogies': return gridRows(p.bogies, S.bogie);
      case 'CarBodies': return gridRows(p.bodies, S.body);
      case 'EN_Lower_Parts': return tableRows(p.lowerParts || [], S.lowerPart);
      case 'EN_Bogie_Parts': return tableRows(p.bogieParts || [], S.bogiePart);
      case 'EN_Doors_Steps': return tableRows(p.doorSteps || [], S.doorStep);
      case 'EN_Pantographs': return tableRows(p.pantographs || [], S.pantograph);
      case 'CCD': return tableRows(p.ccds || [], S.ccd);
      case 'CCD_Points': return tableRows(p.ccdPoints || [], S.ccdPoint);
      case 'Third_Rail': return paramRows(p.thirdRail || {}, S.thirdRail);
      case 'Third_Rail_Parts': return tableRows((p.thirdRail || {}).parts || [], S.trPart);
      case 'KE': return profileRows(p.ke.profiles, S.keProfile);
      case 'CustomerLimits': return paramRows(p.ke.limits, S.customerLimits);
      case 'EN_Params': return paramRows(p.ke.en, S.enParams);
      case 'SOD': return profileRows(p.sod.profiles, S.sodProfile);
      case 'SOD_Settings': return paramRows(p.sod, S.sodSettings);
      case 'SOD_Items': return tableRows(p.sod.items, S.sodItem);
      case 'RSProfile': return profileRows(p.rs.profiles, S.rsProfile);
      case 'TrackParams': return paramRows(p.track.params, S.trackParams);
      case 'Track': return tableRows(p.track.segments, S.segment);
      case 'Sway_Test': return tableRows(p.tests.sway, S.swayTest);
      case 'Sim_Settings': return paramRows((p.sim || {}).settings || {}, S.simSettings);
      case 'Sim_Cars': return tableRows((p.sim || {}).cars || [], S.simCar);
      case 'Sim_Transient': return tableRows((p.sim || {}).transient || [], S.simTransient);
      case 'Sim_Curving': return tableRows((p.sim || {}).curving || [], S.simCurving);
      case 'Val_Weighbridge': return tableRows((p.sim || {}).weigh || [], S.valWeigh);
      case 'Val_BogieRotation': return tableRows((p.sim || {}).rot || [], S.valRot);
      case 'Val_Sway': return tableRows((p.sim || {}).sway || [], S.valSway);
      case 'Val_Ride': return tableRows((p.sim || {}).ride || [], S.valRide);
    }
    throw new Error('Unknown sheet ' + name);
  }

  var README = {
    Train: 'Train description, configuration and wind constants. Edit the Value column only.',
    CarTypes: 'One column per car type (add columns to the right for more types): body length, overhangs, shared ends, section positions, bogie types and the RS profile of each section. Key column must stay unchanged.',
    LoadCases: 'Load cases (Load definition): one row per case, e.g. AW0, AW2, AW3, AW4, with its role: exactly one tare (empty car) and one crush (fully loaded); every other case "Other".',
    Sections: 'Additional sections checked per car type (optional): car type, section name, the body end it is measured from, the distance from that end and the RS profile. Between the pivots the interior rules apply, beyond a pivot the exterior rules with the yaw factor.',
    CarLoads: 'Masses per car type and load case: sprung car-body mass, CG height, body lowering from tare (tare 0; blank for other cases = interpolated), and for other cases optional s and hc (blank = interpolated by mass).',
    Bogies: 'One column per bogie type (e.g. M, T): plays, vertical travels, mass, suspension stiffness (theoretical s and hc) and the play calculator. Car types refer to these names.',
    CarBodies: 'One column per car type: wind-exposed side, lower parts, specified flexibility coefficient and roll-centre height, EN 15273-2 A.3.4 vertical data.',
    EN_Doors_Steps: 'Open access doors and deployed steps checked by EN 15273-2 A.3.14 / A.3.15 (static option): car type, door or step, between / beyond the pivots, distance n, half-width of the open element and its lowest and highest point above rail (tare, new wheels).',
    EN_Pantographs: 'Pantographs checked by EN 15273-2 A.3.12 (static option): car type, between / beyond the pivots, distance n, base height h_t, flexibility t, inclination tolerance θ, installation tolerance τ, head semi-width, lowered height and insulating distance.',
    CCD: 'Third-rail current collector devices (CCD): one row per CCD type with its bogie type, mounting (frame / axleboxes), distance x of the shoe from the bogie centre, working range of the shoe on the contact axis and the extent of its contact face on the other axis.',
    CCD_Points: 'Outline points of each CCD in the working and retracted positions (tare, new wheels, rail side): CCD name, position, part (shoe follows the rail when working; gear moves with the bogie), Y and Z.',
    Third_Rail: 'Conductor rail: envelope used for the CCD check, contact type (bottom / top / side), contact surface position and face extent, installation tolerances, wear and the minimum shoe–rail overlap.',
    Sim_Settings: 'EN 15273-2 dynamic method: reference profile for the tangent check, factor on the standard deviation (3/√2), line check, units of the O.6 import.',
    Sim_Cars: 'Per car type: distance of the outer datum points from the body centre, datum height, and the quasi-static drop terms f_z, f_cr, f_w, f_tol of O.10.',
    Sim_Transient: 'Transient simulation results (Annex O.3.8): per car type, condition, speed and cant-excess case and datum point (lead / centre / trail) the mean and standard deviation of the transverse and vertical displacement (mm) and of the roll angle (mrad).',
    Sim_Curving: 'Quasi-static curving results (Annex O.3.9): per car type, condition and radius the displacement towards the outside and the inside at the leading and trailing datums (mm), without the geometric overthrow.',
    Val_Weighbridge: 'Model validation (O.2.4): measured and simulated wheel loads per wheelset and side.',
    Val_BogieRotation: 'Model validation (O.2.5): measured and simulated maximum X factor per bogie and rotation velocity.',
    Val_Sway: 'Model validation (O.2.6): measured and simulated four-part averages per output and applied cant, and the average error of the hysteresis loop.',
    Val_Ride: 'Model validation (O.2.7): dynamic ride test matched (competent person) and notified-body acceptance of a partial validation.',
    Third_Rail_Parts: 'Points of the conductor-rail assembly (brackets, shroud / cover board, insulators) with the required clearance to the CCD.',
    EN_Bogie_Parts: 'Bogie parts checked laterally by EN 15273-2 A.3.11 (static option): one row per part with bogie type, mounting (frame / axle), position (between / beyond the end axles), distance n from the nearer end axle, half-width and height above rail (tare, new wheels).',
    EN_Lower_Parts: 'Lower parts checked by EN 15273-2 A.3.4.1 (static option): one row per part with car type, mounting (body / bogie), position (between / beyond the pivots or axles), distance n, half-width b, height above rail (tare, new wheels) and the lower limit at that position (blank = customer minimum clearance). A car type without rows uses the lower parts of the car body inputs.',
    KE: 'Customer kinematic envelope(s): one row per point, right half (Y >= 0) from the top centre round the outside to rail level, in mm. Repeat the profile name (and n_up = points of the upper envelope) on every row; several profiles may follow each other.',
    CustomerLimits: 'Customer limits and SOD curve-allowance rule, dynamic reference heights.',
    EN_Params: 'Rules of the EN 15273-2:2009 kinematic check (customer KE as reference profile, G1 values as defaults).',
    SOD: 'Structure gauge / SOD profile(s): same layout as KE.',
    SOD_Settings: 'Frame of the SOD and the required minimum clearance.',
    SOD_Items: 'Point items to clear: third rail, platform edge, walkway, equipment. One row per item.',
    RSProfile: 'Rolling stock static section profile(s) (e.g. roof section, HVAC section): profile name and points as for KE. Car types pick a profile for each section.',
    TrackParams: 'Operating limits (cant, cant deficiency / excess, wind), track tolerances and the static-check geometry.',
    Track: 'One row per element (Tangent / Transition / Circular) in increasing chainage, without gaps. R 0 = infinite; transitions go from R start to R end with cant start to cant end. Rv > 0 crest, < 0 sag. Location Open / Tunnel / Platform / Depot.',
    Sway_Test: 'Sway (roll) test: one row per shim step. Car type name, load state (Tare / Crush / Deflated), shim height D, low side, and the lateral body displacement in the track plane at 2 or 3 heights, relative to the reading without shims, positive towards the low rail.'
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
      if (!k) {
        if (RETIRED[keyOf(r[3] || r[0])]) { return; }   // parameter of an older version, no longer used
        if (r[0]) { msgs.push({ level: 'warn', text: sheet + ' row ' + (i + 1) + ': "' + r[0] + '" is not a known parameter (ignored).' }); }
        return;
      }
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
        case 'CarTypes':
          v = readGrid(rows, S.carType.concat(S.legacyCarMass), msgs, n);
          if (v) {
            raw.train.carTypes = v;
            // an older CarTypes sheet with tare / crush masses and no CarLoads sheet: masses become the load rows
            if (names.indexOf('CarLoads') < 0 && v.some(function (c) { return c.mass_tare_t !== undefined || c.mass_crush_t !== undefined; })) {
              raw.loads = raw.loads || { cases: [], cars: [] };
              if (!raw.loads.cases || !raw.loads.cases.length) { raw.loads.cases = [{ name: 'AW0', role: 'tare', note: 'Empty car' }, { name: 'AW4', role: 'crush', note: 'Crush load' }]; }
              raw.loads.cars = null;   // rebuilt from the car types by normalizeProject
              raw.train.tare_label = (raw.loads.cases.filter(function (c) { return c.role === 'tare'; })[0] || raw.loads.cases[0]).name;
              raw.train.laden_label = (raw.loads.cases.filter(function (c) { return c.role === 'crush'; })[0] || raw.loads.cases[raw.loads.cases.length - 1]).name;
              msgs.push({ level: 'ok', text: 'CarTypes: tare and crush masses of an older template moved to the load cases ' + raw.train.tare_label + ' / ' + raw.train.laden_label + '.' });
            }
          }
          break;
        case 'LoadCases': v = readTable(rows, S.loadCase, msgs, n); if (v) { raw.loads = raw.loads || { cases: [], cars: [] }; raw.loads.cases = v; } break;
        case 'CarLoads': v = readTable(rows, S.carLoad, msgs, n); if (v) { raw.loads = raw.loads || { cases: [], cars: [] }; raw.loads.cars = v; } break;
        case 'Sections': v = readTable(rows, S.extraSection, msgs, n); if (v) { raw.sections = v; } break;
        case 'Bogies': v = readGrid(rows, S.bogie, msgs, n); if (v) { raw.bogies = v; } break;
        case 'CarBodies': v = readGrid(rows, S.body, msgs, n); if (v) { raw.bodies = v; } break;
        case 'EN_Lower_Parts': v = readTable(rows, S.lowerPart, msgs, n); if (v) { raw.lowerParts = v; } break;
        case 'EN_Bogie_Parts': v = readTable(rows, S.bogiePart, msgs, n); if (v) { raw.bogieParts = v; } break;
        case 'EN_Doors_Steps': v = readTable(rows, S.doorStep, msgs, n); if (v) { raw.doorSteps = v; } break;
        case 'EN_Pantographs': v = readTable(rows, S.pantograph, msgs, n); if (v) { raw.pantographs = v; } break;
        case 'CCD': v = readTable(rows, S.ccd, msgs, n); if (v) { raw.ccds = v; } break;
        case 'CCD_Points': v = readTable(rows, S.ccdPoint, msgs, n); if (v) { raw.ccdPoints = v; } break;
        case 'Third_Rail': v = readParams(rows, S.thirdRail, msgs, n); raw.thirdRail = raw.thirdRail || {}; Object.keys(v).forEach(function (k) { raw.thirdRail[k] = v[k]; }); break;
        case 'Third_Rail_Parts': v = readTable(rows, S.trPart, msgs, n); if (v) { raw.thirdRail = raw.thirdRail || {}; raw.thirdRail.parts = v; } break;
        case 'EN_Params': v = readParams(rows, S.enParams, msgs, n); Object.keys(v).forEach(function (k) { raw.ke.en[k] = v[k]; }); break;
        case 'CustomerLimits': v = readParams(rows, S.customerLimits, msgs, n); Object.keys(v).forEach(function (k) { raw.ke.limits[k] = v[k]; }); break;
        case 'SOD_Settings': v = readParams(rows, S.sodSettings, msgs, n); Object.keys(v).forEach(function (k) { raw.sod[k] = v[k]; }); break;
        case 'SOD_Items': v = readTable(rows, S.sodItem, msgs, n); if (v) { raw.sod.items = v; } break;
        case 'TrackParams': v = readParams(rows, S.trackParams, msgs, n); Object.keys(v).forEach(function (k) { raw.track.params[k] = v[k]; }); break;
        case 'Track': v = readTable(rows, S.segment, msgs, n); if (v) { raw.track.segments = v; } break;
        case 'Sway_Test': v = readTable(rows, S.swayTest, msgs, n); if (v) { raw.tests = raw.tests || {}; raw.tests.sway = v; } break;
        case 'Sim_Settings': v = readParams(rows, S.simSettings, msgs, n); raw.sim = raw.sim || {}; raw.sim.settings = raw.sim.settings || {}; Object.keys(v).forEach(function (k) { raw.sim.settings[k] = v[k]; }); break;
        case 'Sim_Cars': v = readTable(rows, S.simCar, msgs, n); if (v) { raw.sim = raw.sim || {}; raw.sim.cars = v; } break;
        case 'Sim_Transient': v = readTable(rows, S.simTransient, msgs, n); if (v) { raw.sim = raw.sim || {}; raw.sim.transient = v; } break;
        case 'Sim_Curving': v = readTable(rows, S.simCurving, msgs, n); if (v) { raw.sim = raw.sim || {}; raw.sim.curving = v; } break;
        case 'Val_Weighbridge': v = readTable(rows, S.valWeigh, msgs, n); if (v) { raw.sim = raw.sim || {}; raw.sim.weigh = v; } break;
        case 'Val_BogieRotation': v = readTable(rows, S.valRot, msgs, n); if (v) { raw.sim = raw.sim || {}; raw.sim.rot = v; } break;
        case 'Val_Sway': v = readTable(rows, S.valSway, msgs, n); if (v) { raw.sim = raw.sim || {}; raw.sim.sway = v; } break;
        case 'Val_Ride': v = readTable(rows, S.valRide, msgs, n); if (v) { raw.sim = raw.sim || {}; raw.sim.ride = v; } break;
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
    var STUDY_L = { both: 'Both – define and check', backward: 'Backward – customer KE → maximum construction gauge', forward: 'Forward – RS profile → generated KE' };
    var sum = [['Rolling Stock Gauge Simulator – static results'], ['Project', p.name], ['Customer KE', res.ke.name], ['Study direction', STUDY_L[res.study || 'both']], ['Engine version', res.engineVersion],
      ['Inputs changed since this run', meta && meta.stale ? 'YES – run again' : 'no'], ['Fictional example data', p.fictional ? 'YES' : 'no'], [''],
      ['Governing', res.governing ? res.governing.car + ' – ' + res.governing.label : '', res.governing ? r2(res.governing.c) : '', 'mm', res.ok ? 'ALL OK' : 'CHECK'], [''],
      ['Car type', 'Case', 'Section n (m)', 'Profile', 'Min clearance (mm)', 'At point', 'x displaced (mm)', 'h displaced (mm)', 'T (mm)', 'Status']];
    res.cars.forEach(function (c) { c.cases.forEach(function (k) { sum.push([c.car, k.label, r2(k.params.n, 3), k.profile, r2(k.min.c, 2), k.min.pt, r2(k.min.x), r2(k.min.h), r2(k.params.T, 2), k.ok ? 'OK' : 'INFRINGES']); }); });
    sum.push([''], ['Options']);
    S.staticOptions.forEach(function (fd) { sum.push([fd.l, o[fd.k] === null ? '' : o[fd.k]]); });
    if (res.warnings.length) { sum.push([''], ['Warnings']); res.warnings.forEach(function (w) { sum.push([w]); }); }
    add('Static_Summary', sum, 34);
    var keys = [['n', 'Section position from pivot', 'm', 3], ['A', 'Yaw factor A', '–', 4], ['dg', 'Geometric overthrow', 'mm', 2], ['play', 'Wheel–rail half play × A', 'mm', 2], ['q', 'Primary lateral play × A', 'mm', 2],
      ['wi', 'w_i(Rs) towards the inside', 'mm', 2], ['wa', 'w_a(Rs) towards the outside', 'mm', 2], ['w', 'Secondary lateral play (w·A; on a curve w_i, or w_i·n/a + w_a·(n + a)/a)', 'mm', 2], ['fw', 'Rail gauge-face wear × A', 'mm', 2], ['widen', 'Gauge widening/2 × A', 'mm', 2], ['T', 'Quasi-static translation T', 'mm', 2],
      ['rnd_gauge', 'Random: track gauge tolerance', 'mm', 2], ['rnd_align', 'Random: alignment tolerance', 'mm', 2], ['cant', 'Cant excess (int) / deficiency (ext, end)', 'mm', 1], ['wind', 'Wind equivalent cant', 'mm', 2],
      ['cl', 'Cross-level error', 'mm', 1], ['s', 'Flexibility coefficient s', '–', 4], ['hc', 'Roll-centre height hc', 'm', 4], ['thq', 'Roll angle quasi-static θq', 'rad', 5], ['thr', 'Roll angle cross-level θr', 'rad', 5],
      ['tht', 'Rigid tilt θt', 'rad', 5], ['thtot', 'Total angle for vertical shift', 'rad', 5], ['drop', 'Body lowering Δz from tare', 'mm', 1], ['up', 'Upward movement combined with roll', 'mm', 1]];
    // one block per car type with its own heading row (car types may have different additional sections)
    var bu = [];
    res.cars.forEach(function (c, i) {
      if (i) { bu.push(['']); }
      bu.push(['Car type', 'Quantity', 'Unit'].concat(c.cases.map(function (k) { return k.label; })));
      keys.forEach(function (k) { bu.push([c.car, k[1], k[2]].concat(c.cases.map(function (cs) { return r2(cs.params[k[0]], k[3]); }))); });
    });
    if (!bu.length) { bu.push(['Car type', 'Quantity', 'Unit']); }
    add('Static_BuildUp', bu, 12);
    var pt = [['Car type', 'Case', 'Pt', 'x0 (mm)', 'h0 (mm)', 'Lateral E (mm)', 'x displaced (mm)', 'h displaced (mm)', 'KE width at h (mm)', 'ΔX (mm)', 'KE height at x (mm)', 'ΔH (mm)', 'Clearance (mm)', 'Status']];
    res.cars.forEach(function (c) { c.cases.forEach(function (k) { k.points.forEach(function (q) { pt.push([c.car, k.label, q.pt, r2(q.x0), r2(q.h0), r2(q.E, 2), r2(q.x, 2), r2(q.h, 2), r2(q.W, 2), r2(q.dX, 2), r2(q.H, 2), r2(q.dH, 2), r2(q.c, 2), q.ok ? 'OK' : 'INFRINGES']); }); }); });
    add('Static_Points', pt, 10);
    // Method A: E of every case (labels of the case list), then the half-widths and margins of the sections; one block per car type
    var ma = [];
    res.cars.forEach(function (c, i) {
      var xs = c.extraSections || [], secs = ['int', 'ext', 'end'].concat(xs.map(function (q) { return q.key; }));
      var nm = { int: 'Int', ext: 'Ext', end: 'End' }; xs.forEach(function (q) { nm[q.key] = q.name; });
      if (i) { ma.push(['']); }
      ma.push(['Car type', 'h (mm)', 'KE width (mm)'].concat(c.cases.map(function (k) { return 'E ' + k.label; }), secs.map(function (k) { return 'Max static ' + nm[k] + ' (mm)'; }),
        secs.map(function (k) { return 'Profile ' + nm[k] + ' (mm)'; }), secs.map(function (k) { return 'Margin ' + nm[k] + ' (mm)'; })));
      c.methodA.forEach(function (r) {
        ma.push([c.car, r2(r.h, 0), r2(r.W)].concat(r.E.map(function (e) { return r2(e); }), secs.map(function (k) { return r2(r['max_' + k]); }),
          secs.map(function (k) { return r2(r['prof_' + k]); }), secs.map(function (k) { return r2(r['margin_' + k]); })));
      });
    });
    if (!ma.length) { ma.push(['Car type', 'h (mm)', 'KE width (mm)']); }
    add('Method_A', ma, 10);
    // rotation stops (METHOD §5.3b)
    if (res.cars.some(function (c) { return (c.rotStops || []).length; })) {
      var rs = [['Car type', 'End', 'Bogie', 'x (m)', 'Gap (mm)', 'Travel (mm)', 'a (m)', 'R min (m)', 'ψ (mrad)', 'Closure (mm)', 'Margin to contact (mm)', 'Margin to solid (mm)', 'Free rotation',
        'Load', 'Drift (mm)', 'Contact R rotation only (m)', 'Contact R in service (m)', 'Line length with contact (m)', 'Line share (%)', 'Comfort R (m)', 'Comfort',
        'w limit ∞ (mm)', 'w limit 250 m (mm)', 'w limit 150 m (mm)', 'Limits w(R)']];
      function rr(v) { return v === Infinity ? 'any' : r2(v, 0); }
      res.cars.forEach(function (c) { (c.rotStops || []).forEach(function (x) {
        rs.push([c.car, x.end, x.bogie, x.x, x.gap, x.travel, r2(x.a, 3), r2(x.Rmin, 0), r2(x.psi * 1000, 3), r2(x.closure, 2), r2(x.margin, 2), r2(x.solid, 2), x.ok ? 'OK' : 'BLOCKED',
          x.load, r2(x.yq, 2), rr(x.Rrot), rr(x.Rrun), r2(x.lineLen, 0), x.lineShare === null ? '' : r2(x.lineShare, 2), x.Rcomf === null ? '' : x.Rcomf, x.comfOk === null ? 'info' : (x.comfOk ? 'OK' : 'CONTACT'),
          r2(x.w_lim.inf, 2), r2(x.w_lim.r250, 2), r2(x.w_lim.r150, 2), x.limits ? 'yes' : 'no']);
      }); });
      add('Rotation_Stops', rs, 10);
    }
    // maximum construction gauge outlines (METHOD §7.3): one row per vertex, ready to paste on the RS Profile tab
    if (res.cars.some(function (c) { return c.mcg; })) {
      var mg = [['Car type', 'Section', 'Profile name', 'Point (pt)', 'Y (y) (mm)', 'Z (z) (mm)', 'Top (mm)', 'Bottom on the centre line (mm)', 'Largest half-width (mm)', 'RS profile', 'Min margin RS → gauge (mm)', 'Top margin (mm)']];
      res.cars.forEach(function (c) {
        if (!c.mcg) { return; }
        var nm = { car: 'Whole car', int: 'Interior', ext: 'Exterior', end: 'Car end' };
        (c.extraSections || []).forEach(function (q) { nm[q.key] = q.name; });
        Object.keys(nm).forEach(function (k) {
          var m = c.mcg[k]; if (!m) { return; }
          if (!m.ok) { mg.push([c.car, nm[k], m.name, '', '', '', '', '', '', '', '', m.warn.join(' ')]); return; }
          m.points.forEach(function (q, i) {
            mg.push([c.car, nm[k], m.name, q.pt, q.y, q.z].concat(i ? ['', '', '', '', '', ''] : [r2(m.top, 1), r2(m.bottom, 1), r2(m.maxWidth, 1), m.rs ? m.rs.profile : '', m.rs && m.rs.min ? r2(m.rs.min.margin, 1) : '', m.rs ? r2(m.rs.topMargin, 1) : '']));
          });
        });
      });
      add('Max_Construction_Gauge', mg, 10);
    }
    if (res.en) {
      var en = [['Car type', 'Formula set', 'h (mm)', 'KE width (mm)', 'Ei Int (mm)', 'Ea Ext (mm)', 'Ea End (mm)', 'z Int (mm)', 'z End (mm)', 'EN max Int (mm)', 'EN max Ext (mm)', 'EN max End (mm)',
        'Method A Int (mm)', 'Method A Ext (mm)', 'Method A End (mm)', 'Margin Int (mm)', 'Margin Ext (mm)', 'Margin End (mm)']];
      res.cars.forEach(function (c) { if (c.en) { c.en.rows.forEach(function (r) { en.push([c.car, c.en.clause, r2(r.h, 0), r2(r.W), r2(r.E_int, 2), r2(r.E_ext, 2), r2(r.E_end, 2), r2(r.z_int, 2), r2(r.z_end, 2), r2(r.max_int), r2(r.max_ext), r2(r.max_end),
        r2(r.ma_int), r2(r.ma_ext), r2(r.ma_end), r2(r.margin_int), r2(r.margin_ext), r2(r.margin_end)]); }); } });
      add('EN15273_MaxGauge', en, 10);
      var ec = [['Car type', 'Section', 'Profile', 'h (mm)', 'Profile half-width (mm)', 'KE half-width (mm)', 'E (mm)', 'z_kin (mm)', 'Branch', 'Load', 'EN max (mm)', 'Margin (mm)', 'Status']];
      res.cars.forEach(function (c) { if (c.en) { ['int', 'ext', 'end'].forEach(function (k) { var ck = c.en.checks[k]; ck.points.forEach(function (q) {
        ec.push([c.car, k, ck.profile, r2(q.h, 0), r2(q.x), r2(q.W), r2(q.E, 2), r2(q.z, 2), q.branch, q.load, r2(q.max), r2(q.margin, 2), q.ok ? 'OK' : 'EXCEEDS']); }); }); } });
      add('EN15273_Check', ec, 10);
      var ZN = { A: 'A', B: 'B', C: 'C', D: 'D', bogie: 'Bogie' }, SEC = { int: 'Interior', ext: 'Exterior', end: 'Car end' };
      var ev = [['Car type', 'Check', 'Part / section', 'Mounted', 'Position', 'Zone', 'n (m)', 'b (mm)', 'Height (mm)', 'Suspension (mm)', 'Wheel wear (mm)', 'Extension (mm)', 'Gradient A.16–A.19 (mm)', 'Value (mm)', 'Limit (mm)', 'Margin (mm)', 'Status']];
      res.cars.forEach(function (c) { var v = c.en && c.en.vertical; if (!v) { return; }
        v.lower.forEach(function (q) { ev.push([c.car, 'Minimum height (A.3.4.1)', q.name, q.mount, q.pos, ZN[q.zone], r2(q.n, 3), r2(q.b, 0), r2(q.h, 1), r2(q.susp, 2), r2(q.wear, 2), '', r2(q.grad, 2), r2(q.hmin, 2), r2(q.req, 2), r2(q.margin, 2), q.ok ? 'OK' : 'BELOW MIN']); });
        v.upper.forEach(function (q) { ev.push([c.car, 'Maximum height (A.3.4.2)', SEC[q.section] + ' – ' + q.profile, 'body', q.section === 'int' ? 'between' : 'beyond', '', r2(q.n, 3), '', r2(q.top, 1), '', '', r2(q.ext, 0), r2(q.grad, 2), r2(q.value, 2), r2(q.lim, 1), r2(q.margin, 2), q.ok ? 'OK' : 'INFRINGES']); });
      });
      add('EN15273_Vertical', ev, 10);
      var dsr = [['Car type', 'Element', 'Kind', 'Position', 'n (m)', 'h lowered (mm)', 'KE half-width (mm)', 'E (mm)', 'Max construction (mm)', 'Rule', 'Allowance (mm)', 'Allowed (mm)', 'Half-width (mm)', 'Margin (mm)', 'Status']];
      res.cars.forEach(function (c) { if (!c.en || !c.en.doors) { return; } c.en.doors.rows.forEach(function (q) {
        q.points.forEach(function (x) { dsr.push([c.car, q.name, q.kind, q.pos, r2(q.n, 3), r2(x.h, 1), r2(x.W, 1), r2(x.E, 2), r2(x.max, 1), x.rule, r2(x.extra, 2), r2(x.allowed, 1), r2(x.y, 1), r2(x.margin, 2), x.ok ? 'OK' : 'EXCEEDS']); });
        q.gap.forEach(function (gp) { dsr.push([c.car, q.name, 'step position A.3.15.2', gp.side + ' of curve', r2(q.n, 3), '', 'b_q0 ' + r2(gp.bq0, 0), 'dg ' + r2(gp.dg, 2), 'dg_max ' + r2(gp.dgmax, 2), 'gap straight / at R', r2(gp.gap0, 1), r2(gp.gapR, 1), 'limit ' + r2(gp.bgap, 0), r2(gp.bgap - gp.gapMax, 2), gp.ok ? 'OK' : 'GAP TOO LARGE']); });
      }); });
      if (dsr.length > 1) { add('EN15273_DoorsSteps', dsr, 10); }
      var pgr = [['Car type', 'Pantograph', 'Position', 'n (m)', 'R (m)', 'Load', 'Far / near bogie', 'w_i / w_a (mm)', 'Geometric term (mm)', 'Play term (mm)', "j' (mm)", "z' (mm)", 'z" (mm)', 'Po at 6,5 m (mm)', 'Pu at 5,0 m (mm)', 'Status']];
      res.cars.forEach(function (c) { if (!c.en || !c.en.pantographs) { return; } c.en.pantographs.rows.forEach(function (q) {
        q.cases.forEach(function (x) { pgr.push([c.car, q.name, q.pos, r2(q.n, 3), x.R === null ? 'straight' : r2(x.R, 0), x.load, x.far + ' / ' + x.near, r2(x.wi, 1) + ' / ' + r2(x.wa, 1), r2(x.geo, 2), r2(x.play, 2), r2(x.j, 2), r2(x.zo, 2), r2(x.zu, 2), r2(x.Po, 2), r2(x.Pu, 2), x.Po <= 1e-9 && x.Pu <= 1e-9 ? 'OK' : 'EXCEEDS']); });
        if (q.lowered) { var lw = q.lowered; pgr.push([c.car, q.name, 'lowered (A.3.12.7)', '', '', '', 'h ' + r2(lw.h, 0), 'b_w + ins ' + r2(lw.bw + lw.ins, 0), 'EN max ' + r2(lw.max, 1), 'KE top ' + r2(lw.top, 0), '', '', '', r2(lw.marginW, 1), r2(lw.marginH, 1), lw.ok ? 'OK' : 'EXCEEDS']); }
      }); });
      if (pgr.length > 1) { add('EN15273_Pantographs', pgr, 10); }
      var bpr = res.en && res.en.bogieParts ? res.en.bogieParts.rows : [];
      if (bpr.length) {
        var bs = [['Bogie type', 'Part', 'Mounted', 'Position', 'p (m)', 'n (m)', 'Height (mm)', 'Lowest (mm)', 'Highest (mm)', 'Half-width (mm)', 'd worn (mm)', 'q (mm)', 'z_kin (mm)', 'Δ (m²)', 'Branch', 'E (mm)', 'KE half-width (mm)', 'EN max (mm)', 'Margin (mm)', 'Status']];
        bpr.forEach(function (q) { bs.push([q.bogie, q.name, q.mount, q.pos, r2(q.a, 3), r2(q.n, 3), r2(q.h, 0), r2(q.h_lo, 1), r2(q.h_hi, 1), r2(q.y, 1), r2(q.d, 1), r2(q.q, 1), r2(q.z, 2), r2(q.delta, 3), q.branch, r2(q.E, 2), r2(q.W, 1), r2(q.max, 1), r2(q.margin, 2), q.ok ? 'OK' : 'EXCEEDS']); });
        add('EN15273_BogieParts', bs, 10);
      }
    }
    if (res.enStatic) {
      var sc = [['Car type', 'Section', 'Profile', 'Reference', 's / s_max', 'n (m)', 'Δ (m²)', 'x (mm)', 'E (mm)', 'h (mm)', 'Profile half-width (mm)', 'Reference half-width (mm)', 'Static max (mm)', 'Margin (mm)', 'Status']];
      res.cars.forEach(function (c) { var q = c.enStatic; if (!q) { return; } ['int', 'ext', 'end'].forEach(function (k) { var ck = q.checks[k], sx = q.sections[k];
        ck.points.forEach(function (x) { sc.push([c.car, k, ck.profile, q.ref, r2(q.s, 3) + ' / ' + r2(q.smax, 2), r2(sx.n, 3), r2(sx.delta, 3), r2(sx.x, 2), r2(sx.E, 2), r2(x.h, 0), r2(x.x), r2(x.W), r2(x.max), r2(x.margin, 2), x.ok && q.sOk ? 'OK' : (q.sOk ? 'EXCEEDS' : 'S > S_MAX')]); });
        sc.push([c.car, k, ck.profile, q.ref, '', '', '', '', '', 'top', r2(ck.top, 0), r2(ck.refTop, 0), '', r2(ck.refTop - ck.top, 1), ck.topOk ? 'OK' : 'EXCEEDS']); });
        q.lower.forEach(function (x) { sc.push([c.car, 'lower part (A.2.3.2)', x.name, x.mount, '', '', '', '', r2(x.disp, 1), r2(x.h, 0), '', r2(x.lim, 0), r2(x.hmin, 1), r2(x.margin, 1), x.ok ? 'OK' : 'BELOW MIN']); });
      });
      add('EN15273_Static', sc, 10);
    }
    var bs = [['Car type', 'Check', 'Value (mm)', 'Limit (mm)', 'Margin (mm)', 'Applies', 'Status']];
    res.cars.forEach(function (c) { if (c.bostrab) { c.bostrab.rows.forEach(function (x) { bs.push([c.car, x.label, r2(x.value, 1), r2(x.limit, 0), r2(x.margin, 1), x.applies ? 'yes' : x.note, x.applies ? (x.ok ? 'OK' : 'EXCEEDS') : '']); }); } });
    if (bs.length > 1) { add('BOStrab_34', bs, 10); }
    if (res.ccd) {
      var cc = [['CCD', 'Bogie', 'Situation', 'Envelope margin (mm)', 'At point', 'Reach: rail rel. lowest (mm)', 'Reach: rail rel. highest (mm)', 'Working range (mm)', 'Reach margin (mm)', 'Face overlap (mm)', 'Overlap margin (mm)', 'Clearance (mm)', 'Required (mm)', 'Clearance margin (mm)', 'To part', 'Status']];
      res.ccd.ccds.forEach(function (c) { c.cases.forEach(function (k) {
        cc.push([c.name, c.bogie, k.situation, k.ke ? r2(k.ke.margin, 2) : '', k.ke ? k.ke.pt + ' (' + k.ke.state + ')' : '', r2(k.contact.relLo, 1), r2(k.contact.relHi, 1), r2(k.contact.cmin, 0) + ' – ' + r2(k.contact.cmax, 0),
          r2(k.contact.reach, 2), r2(k.contact.overlap, 1), r2(k.contact.mOv, 2), k.clear ? r2(k.clear.dist, 1) : '', k.clear ? r2(k.clear.req, 0) : '', k.clear ? r2(k.clear.margin, 2) : '', k.clear ? k.clear.pt + ' – ' + k.clear.part : '', k.ok ? 'OK' : 'CHECK']);
      }); });
      add('CCD_Static', cc, 10);
    }
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

  // ---------------------------------------------------------------- dynamic results export
  // Tests tab: sway-test evaluation and kinematic gauge test plan (METHOD §13).
  function testsWorkbook(sway, plan, p, meta) {
    var XL = X(), wb = XL.utils.book_new();
    function add(name, rows, w) { var sh = XL.utils.aoa_to_sheet(rows); sh['!cols'] = rows[0].map(function (c, i) { return { wch: i === 0 ? (w || 22) : 13 }; }); XL.utils.book_append_sheet(wb, sh, name); }
    var sv = [['Rolling Stock Gauge Simulator – sway test evaluation'], ['Project', p.name], ['Fictional example data', p.fictional ? 'YES' : 'no'], [''],
      ['Car type', 'Load', 'Readings', 's measured', 'hc measured (mm)', 'RMS residual (mm)', 's left', 's right', 's used', 'hc used (mm)',
        'h1 (mm)', 'Measured / 100 mm cant at h1', 'Used at h1', 'h2 (mm)', 'Measured at h2', 'Used at h2', 'Profile top (mm)', 'Measured at top', 'Used at top', 'Status']];
    (sway || []).forEach(function (r) {
      if (r.error) { sv.push([r.car, r.load, r.n, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'ERROR: ' + r.error]); return; }
      var c = r.checks;
      sv.push([r.car, r.load, r.n, r2(r.s, 4), r2(r.hc, 1), r2(r.rms, 3), r.sides.L ? r2(r.sides.L.s, 4) : '', r.sides.R ? r2(r.sides.R.s, 4) : '', r2(r.used.s, 4), r2(r.used.hc, 1),
        c[0].h, r2(c[0].measured, 2), r2(c[0].used, 2), c[1].h, r2(c[1].measured, 2), r2(c[1].used, 2), c[2].h, r2(c[2].measured, 2), r2(c[2].used, 2), r.ok ? 'OK' : 'CHECK']);
    });
    sv.push([''], ['Readings', 'Load', 'Row', 'D (mm)', 'Low side', 'h (mm)', 'y (mm)', 'y per 100 mm cant', 'Fitted (mm)', 'Residual (mm)']);
    (sway || []).forEach(function (r) { (r.points || []).forEach(function (q) { sv.push([r.car, r.load, q.row, q.D, q.side, q.h, q.y, r2(q.y100, 2), r2(q.fit, 2), r2(q.res, 2)]); }); });
    add('Sway_Evaluation', sv, 14);
    var su = [['Rolling Stock Gauge Simulator – kinematic gauge test plan'], ['Project', p.name], ['Static results out of date', meta && meta.stale ? 'YES – run again' : 'no'], [''],
      ['Car type', 'Case', 'Profile', 'Shims D (mm)', 'of which cant (mm)', 'wind eq. cant (mm)', 'A', 'Play × A (mm)', 'q × A (mm)', 'w × A (mm)', 'Total lateral (mm)', 'Load', 's used', 'hc used (m)',
        's measured', 'hc measured (mm)', 'Min clearance (mm)', 'At point', 'Min clearance with measured s (mm)', 'Note']];
    var pts = [['Car type', 'Case', 'Pt', 'x0 (mm)', 'h0 (mm)', 'Expected x (mm)', 'Expected h (mm)', 'Template half-width (mm)', 'Template height (mm)', 'N lateral not reproduced (mm)', 'V vertical not reproduced (mm)',
      'ΔX (mm)', 'ΔH (mm)', 'Clearance (mm)', 'x with measured s (mm)', 'h with measured s (mm)', 'Clearance with measured s (mm)']];
    (plan || []).forEach(function (c) {
      c.cases.forEach(function (k) {
        su.push([c.car, k.label, k.profile, r2(k.D, 1), r2(k.cant, 1), r2(k.wind, 2), r2(k.A, 4), r2(k.play, 2), r2(k.q, 2), r2(k.w, 2), r2(k.Rlat, 2), k.load, r2(k.s, 4), r2(k.hc, 4),
          k.sway ? r2(k.sway.s, 4) : '', k.sway ? r2(k.sway.hc, 1) : '', r2(k.min.c, 2), k.min.pt, k.minMeasured ? r2(k.minMeasured.cm, 2) : '', k.beyondSway ? 'Shims above the largest sway-test shim (' + k.sway.maxD + ' mm)' : '']);
        k.points.forEach(function (q) { pts.push([c.car, k.label, q.pt, r2(q.x0), r2(q.h0), r2(q.xt, 2), r2(q.ht, 2), r2(q.Wt, 2), r2(q.Ht, 2), r2(q.N, 2), r2(q.V, 2), r2(q.dX, 2), r2(q.dH, 2), r2(q.c, 2),
          q.xm === undefined ? '' : r2(q.xm, 2), q.hm === undefined ? '' : r2(q.hm, 2), q.cm === undefined ? '' : r2(q.cm, 2)]); });
      });
    });
    add('Gauge_Test_Setup', su, 12);
    add('Gauge_Test_Points', pts, 10);
    return wb;
  }
  function dynamicResultsWorkbook(res, p, meta) {
    var XL = X(), wb = XL.utils.book_new(), o = p.settings.dynamic, so = p.settings['static'], sm = res.summary;
    function add(name, rows, w) { var sh = XL.utils.aoa_to_sheet(rows); sh['!cols'] = rows[0].map(function (c, i) { return { wch: i === 0 ? (w || 22) : 13 }; }); XL.utils.book_append_sheet(wb, sh, name); }
    function ex(x) { return x ? [r2(x.v, 2), r2(x.ch, 2), x.car || ''] : ['n/a', '', '']; }
    var sum = [['Rolling Stock Gauge Simulator – dynamic results (all car types: worst per chainage)'], ['Project', p.name], ['Engine version', res.engineVersion],
      ['Inputs changed since this run', meta && meta.stale ? 'YES – run again' : 'no'], ['Fictional example data', p.fictional ? 'YES' : 'no'], [''],
      ['Result', 'Value', 'At chainage (m)', 'Car type', 'Limit / reference', 'Status'],
      ['Alignment length evaluated (m)', r2(sm.length, 2)], ['Points evaluated', sm.points + ' (every ' + sm.step + ' m)'],
      ['Maximum cant deficiency at line speed (mm)'].concat(ex(sm.def), [sm.def_lim, sm.def_ok ? 'OK' : 'ABOVE LIMIT']),
      ['Maximum excess over KE – OUTSIDE, car end (mm)'].concat(ex(sm.xo), ['curve allowance needed']),
      ['Maximum excess over KE – INSIDE, mid-car (mm)'].concat(ex(sm.xi), ['curve allowance needed']),
      ['Points where excess > SOD curve allowance', sm.sod_n, sm.sod_first === null ? '' : r2(sm.sod_first, 2), '', 0, sm.sod_n ? 'CHECK' : 'OK'],
      ['Minimum structure clearance (mm)'].concat(ex(sm.sc), [0, sm.sc ? (sm.sc_ok ? 'OK' : 'INFRINGES') : '']),
      ['Minimum underframe height, body-mounted, worst (mm)'].concat(ex(sm.uf), [sm.uf_lim, sm.uf_ok ? 'OK' : 'BELOW MIN']),
      ['Minimum platform gap, worst movement (mm)'].concat(ex(sm.gm), [0, sm.gm ? (sm.gm_ok ? 'OK' : 'CONTACT') : '']),
      ['Maximum nominal platform gap (mm)'].concat(ex(sm.gn), [sm.prm, sm.gn ? (sm.gn_info ? 'INFO: above PRM value' : 'OK') : '']),
      ['Minimum clearance to the SOD outline, whole profile (mm)'].concat(ex(sm.sodc), [sm.sodc_req, sm.sodc ? (sm.sodo_n ? sm.sodo_n + ' points CHECK' : 'OK') : 'no SOD on the line']),
      ['Minimum point-item margin over its required clearance (mm)'].concat(ex(sm.itm), [0, sm.itm ? (sm.it_n ? sm.it_n + ' points CHECK' : 'OK') : 'no items']),
      ['Points with any CHECK', sm.check_n, '', '', 0, sm.ok ? 'ALL OK' : 'REVIEW'], [''], ['Options']];
    if (sm.simc) { sum.splice(sum.length - 3, 0, ['EN dynamic method – minimum clearance of the swept envelope to the SOD (mm)'].concat(ex(sm.simc), [sm.sodc_req, sm.sim_n ? sm.sim_n + ' points CHECK' : 'OK' + (sm.sim_flags ? ' (' + sm.sim_flags + ' points beyond the analysed cases)' : '')])); }
    if (sm.ccd) {
      var cx = function (x) { return x ? [r2(x.v, 2), r2(x.ch, 2), x.ccd + ' (' + x.side + ')'] : ['n/a', '', '']; };
      sum.splice(sum.length - 3, 0, ['Third-rail CCD – minimum envelope margin (mm)'].concat(cx(sm.ccd.ke), [0, sm.ccd.ke ? (sm.ccd.ke.v >= 0 ? 'OK' : 'CHECK') : '']),
        ['Third-rail CCD – minimum reach margin (mm)'].concat(cx(sm.ccd.reach), [0, sm.ccd.reach ? (sm.ccd.reach.v >= 0 ? 'OK' : 'CHECK') : '']),
        ['Third-rail CCD – minimum overlap margin (mm)'].concat(cx(sm.ccd.overlap), [0, sm.ccd.overlap ? (sm.ccd.overlap.v >= 0 ? 'OK' : 'CHECK') : '']),
        ['Third-rail CCD – minimum clearance margin to the rail parts (mm)'].concat(cx(sm.ccd.clear), [0, sm.ccd.clear ? (sm.ccd.clear.v >= 0 ? 'OK' : 'CHECK') : '']),
        ['Third-rail CCD – points evaluated / with CHECK', sm.ccd.n, '', '', 0, sm.ccd.check_n ? sm.ccd.check_n + ' CHECK' : 'OK']);
    }
    S.dynamicOptions.forEach(function (fd) { sum.push([fd.l, o[fd.k] === null ? '' : o[fd.k]]); });
    sum.push(['Sweep step (m)', res.sweep.step], ['Common options (Static Simulation tab)']);
    S.staticOptions.forEach(function (fd) { if (fd.k.indexOf('ma_') !== 0) { sum.push([fd.l, so[fd.k] === null ? '' : so[fd.k]]); } });
    add('Dyn_Summary', sum, 44);
    if (res.ccd && res.ccd.rows.length) {
      var cl = [['Chainage (m)', 'Element', 'Local R (m)', 'Deficiency (mm)', 'Excess (mm)', 'Rv (m)', 'Governing CCD', 'Rail side', 'Rail on curve', 'Envelope margin (mm)', 'Reach margin (mm)', 'Overlap margin (mm)', 'Clearance margin (mm)', 'Status']];
      res.ccd.rows.forEach(function (q) { cl.push([r2(q.ch, 2), q.el, r2(q.R, 1), r2(q.def, 2), r2(q.exc, 2), q.Rv, q.ccd, q.side, q.pos, q.ke === null ? '' : r2(q.ke, 2), r2(q.reach, 2), r2(q.overlap, 2), q.clear === null ? '' : r2(q.clear, 2), q.ok ? 'OK' : 'CHECK']); });
      add('Dyn_CCD', cl, 12);
    }
    var cars = [['Car type', 'Profile', 's', 'hc (m)', 'Max deficiency (mm)', 'Max OUT excess (mm)', 'at (m)', 'Max IN excess (mm)', 'at (m)', 'SOD checks', 'Min structure clearance (mm)', 'Min underframe (mm)', 'Min platform gap (mm)', 'Min SOD outline clearance (mm)', 'Min item margin (mm)', 'CHECK points']];
    res.cars.forEach(function (c) { var q = c.summary; cars.push([c.car, c.consts.profile, r2(c.consts.s, 4), r2(c.consts.hc, 4), r2(q.def && q.def.v, 2), r2(q.xo && q.xo.v, 2), r2(q.xo && q.xo.ch, 2), r2(q.xi && q.xi.v, 2), r2(q.xi && q.xi.ch, 2), q.sod_n, q.sc ? r2(q.sc.v, 2) : 'n/a', r2(q.uf && q.uf.v, 2), q.gm ? r2(q.gm.v, 2) : 'n/a', q.sodc ? r2(q.sodc.v, 2) : 'n/a', q.itm ? r2(q.itm.v, 2) : 'n/a', q.check_n]); });
    add('Dyn_CarTypes', cars, 12);
    var eh = ['Car type', 'No', 'Ch start', 'Ch end', 'Element', 'Hand', 'R start', 'R end', 'Speed', 'Max deficiency', 'Max OUT h2', 'Max IN h2', 'Max excess OUT', 'Max excess IN', 'Min structure clearance', 'Min underframe', 'SOD profile', 'Min SOD outline clearance', 'Min item margin', 'Status', 'Remarks'];
    var el = [eh];
    res.cars.forEach(function (c) { c.elements.forEach(function (e) { el.push([c.car, e.no, e.s0, e.s1, e.type, e.side, r2(e.R0, 1), r2(e.R1, 1), e.V, r2(e.def, 2), r2(e.o2, 1), r2(e.i2, 1), r2(e.xo, 2), r2(e.xi, 2), e.sc === null ? '' : r2(e.sc, 1), r2(e.uf, 1), e.sodn || '', e.sodc === null ? '' : r2(e.sodc, 1), e.itm === null ? '' : r2(e.itm, 1), e.status, e.remarks || '']); }); });
    add('Dyn_Elements', el, 10);
    var sh = ['Car type', 'V (km/h)', 'Eq. cant (mm)', 'I = Eeq − E (mm)', 'Deficiency', 'Excess', 'Wind eq. cant', 'Widening', 'dgi mid', 'dga end', 'OUT h1', 'OUT h2', 'IN h1', 'IN h2', 'KE w h1', 'KE w h2', 'Max excess over KE', 'Remark'];
    var ss = [sh];
    res.cars.forEach(function (c) { c.speedStep.rows.forEach(function (q) { ss.push([c.car, q.V, r2(q.Eeq, 2), r2(q.I, 2), r2(q.def, 2), r2(q.exc, 2), r2(q.Dw, 2), q.wd, r2(q.dgi, 2), r2(q.dga, 2), r2(q.o1, 1), r2(q.o2, 1), r2(q.i1, 1), r2(q.i2, 1), r2(q.kw1, 1), r2(q.kw2, 1), r2(q.excess, 2), q.remark]); }); });
    add('Dyn_SpeedStep', ss, 10);
    var cols = [['ch', 'Chainage (m)', 2], ['el', 'Element', 0], ['type', 'Type'], ['k', 'Curvature k (1/m, +L)', 7], ['Rl', 'Local R (m)', 1], ['cant', 'Cant (mm)', 2], ['V', 'Speed (km/h)', 0], ['Rv', 'Rv (m)', 0], ['ke', 'KE'],
      ['loc', 'Location'], ['kg', 'Governing |k| (1/m)', 7], ['Rg', 'Governing R (m)', 1], ['Eeq', 'Eq. cant (mm)', 2], ['def', 'Deficiency (mm)', 2], ['exc', 'Excess stopped (mm)', 2], ['Vw', 'Wind speed (km/h)', 0],
      ['Dw', 'Wind eq. cant (mm)', 2], ['wd', 'Widening (mm)', 1], ['dgi', 'dgi mid (mm)', 2], ['dga', 'dga end (mm)', 2], ['wi', 'w_i(R) inside (mm)', 2], ['wa', 'w_a(R) outside (mm)', 2], ['o1', 'OUT h1 (mm)', 2], ['o2', 'OUT h2 (mm)', 2], ['i1', 'IN h1 (mm)', 2], ['i2', 'IN h2 (mm)', 2],
      ['kw1', 'KE w h1 (mm)', 2], ['kw2', 'KE w h2 (mm)', 2], ['xo', 'Excess OUT (mm)', 2], ['xi', 'Excess IN (mm)', 2], ['To', 'SOD allowance OUT (mm)', 2], ['Ti', 'SOD allowance IN (mm)', 2], ['sod', 'SOD check'],
      ['lean', 'Lean at h2 (mm)', 2], ['ho', 'Req. horizontal OUT (mm)', 2], ['hi', 'Req. horizontal IN (mm)', 2], ['sc', 'Structure clearance (mm)', 2], ['ss', 'Structure status'], ['vc', 'Vertical-curve effect (mm)', 2],
      ['uf', 'Underframe height (mm)', 2], ['ufs', 'Underframe status'], ['pl', 'Platform position'], ['gn', 'Gap nominal (mm)', 2], ['gm', 'Gap minimum (mm)', 2], ['gs', 'Gap status'], ['sodn', 'SOD profile'], ['sodc', 'SOD outline clearance (mm)', 2], ['sodp', 'Governing profile point'], ['sods', 'SOD outline status'],
      ['itn', 'Governing item'], ['itc', 'Item clearance (mm)', 2], ['itm', 'Item margin (mm)', 2], ['its', 'Item status'], ['simc', 'EN dynamic: swept envelope to SOD (mm)', 2], ['simn', 'EN dynamic: governing point and case'], ['sims', 'EN dynamic status'], ['ok', 'Overall'], ['valid', 'Valid row']];
    var sw = [['Car type'].concat(cols.map(function (c) { return c[1]; }))];
    res.cars.forEach(function (c) { c.rows.forEach(function (q) { sw.push([c.car].concat(cols.map(function (k) { var v = q[k[0]]; return k[0] === 'valid' ? (v ? 1 : 0) : (k[2] === undefined ? (v === null ? '' : v) : r2(v, k[2])); }))); }); });
    add('Dyn_Sweep', sw, 10);
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

  /*
   * EN 15273-2 Annex O.6 spreadsheet (first sheet): A2 = number of speeds, B2 = cants, C2 = radii, D2 = vehicles; speeds
   * (m/s) from A4, cants (mm) from B4, radii (m) from C4; transient blocks of 3 rows (lead, centre, trail) per speed × cant
   * case from row N = max(counts) + 5, 6 columns per vehicle from column C (transverse mean, σ, vertical mean, σ, roll mean,
   * σ); curving rows from N + Nv·Nc·3 + 2, radius in A and 4 columns per vehicle from B (outside lead, outside trail,
   * inside lead, inside trail). Vehicle k is car type `cars[k-1]`. Rows are 1-based as in the standard.
   */
  // EN dynamic method results (tangent check, displacements per case, validation).
  function simResultsWorkbook(res, p, meta) {
    var XL = X(), wb = XL.utils.book_new();
    function add(name, rows, w) { var sh = XL.utils.aoa_to_sheet(rows); sh['!cols'] = rows[0].map(function (c, i) { return { wch: i === 0 ? (w || 18) : 13 }; }); XL.utils.book_append_sheet(wb, sh, name); }
    var t = res.tangent, sum = [['Rolling Stock Gauge Simulator – EN 15273-2 dynamic method (Annex O)'], ['Project', p.name], ['Engine version', res.engineVersion], ['Fictional example data', p.fictional ? 'YES' : 'no'],
      ['Inputs changed since', meta && meta.stale ? 'YES' : 'no'], [''], ['Car type', 'Reference profile', 'Outer datums from centre (m)', 'Datum height (mm)', 'f_max (mm)', 'Factor on σ', 'Points', 'Min margin (mm)', 'Condition', 'Case', 'Section', 'Point', 'Status']];
    (t ? t.cars : []).forEach(function (c) { var w = c.worst; sum.push([c.car, t.ref, r2(c.xd, 3), r2(c.hd, 0), r2(c.fmax, 1), r2(c.kS, 4), c.n, w ? r2(w.margin, 2) : '', w ? w.cond : '', w ? w.v + ' km/h ' + (w.kind === 'def' ? 'D ' : 'I ') + w.c + ' mm' : '', w ? w.sec + ' x ' + r2(w.x, 2) : '', w ? w.pt : '', c.ok ? 'OK' : 'EXCEEDS']); });
    add('Sim_Tangent', sum, 14);
    var dp = [['Car type', 'Condition', 'Speed (km/h)', 'Case', 'Cant (mm)', 'Dpl centre (mm)', 'Dpl lead (mm)', 'Δh down centre (mm)', 'Δh up centre (mm)', 'θ centre (mrad)', 'θ lead (mrad)']];
    (t ? t.cars : []).forEach(function (c) { c.conds.forEach(function (cd) { cd.disp.forEach(function (x) { dp.push([c.car, cd.cond, x.v, x.kind === 'def' ? 'deficiency' : 'excess', x.c, r2(x.dplC, 2), r2(x.dplL, 2), r2(x.hdC, 2), r2(x.huC, 2), r2(x.thC, 3), r2(x.thL, 3)]); }); }); });
    add('Sim_Displacements', dp, 10);
    var va = [['Car type', 'Condition', 'Check', 'Max error', 'Limit', 'Average error', 'Limit', 'Values', 'Matched']];
    res.validation.forEach(function (v) {
      function row(lbl, x, u) { if (x) { va.push([v.car, v.cond, lbl, r2(x.max, 2) + u, x.lmax + u, x.avg !== undefined ? r2(x.avg, 2) + u : (x.loop === null ? 'not given' : r2(x.loop, 2)), x.lavg + u, x.n, x.ok ? 'yes' : 'NO']); } }
      if (v.weigh) { row('Wheel loads', v.weigh.wheel, ' %'); row('Wheelset loads', v.weigh.wheelset, ' %'); row('Side loads', v.weigh.side, ' %'); }
      row('Bogie rotation – max X factor', v.rot, ' %');
      if (v.sway) { [['roll1', 'Primary roll angle', ' mrad'], ['roll2', 'Secondary roll angle', ' mrad'], ['sway', 'Solebar sway', ' mm'], ['drop', 'Solebar drop', ' mm']].forEach(function (q) { row('Sway – ' + q[1] + ' (four-part avg / loop avg)', v.sway[q[0]], q[2]); }); }
      va.push([v.car, v.cond, 'Dynamic ride test (competent person)', '', '', '', '', '', v.ride ? 'yes' : 'NO']);
      va.push([v.car, v.cond, 'Model status', v.status, '', '', '', '', '']);
    });
    add('Sim_Validation', va, 10);
    return wb;
  }
  function importO6(wb, project, opts) {
    opts = opts || {};
    var XL = X(), ws = wb.Sheets[wb.SheetNames[0]], ref = ws && ws['!ref'] ? XL.utils.decode_range(ws['!ref']) : null, msgs = [], raw = JSON.parse(JSON.stringify(project));
    if (ref) { ref.s.r = 0; ref.s.c = 0; }
    var rows = ref ? XL.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true, raw: true, range: ref }) : [];   // row r of the standard = rows[r - 1]
    function cell(r, c) { var row = rows[r - 1] || []; var v = row[c]; return (v === '' || v === undefined || v === null) ? null : Number(v); }
    var st = (raw.sim && raw.sim.settings) || {}, lenF = (opts.len || st.o6_len) === 'm' ? 1000 : 1, rotF = (opts.rot || st.o6_rot) === 'rad' ? 1000 : 1, cond = opts.cond || st.o6_cond || 'tare';
    var Nv = cell(2, 0), Nc = cell(2, 1), Nr = cell(2, 2), Nveh = cell(2, 3), cars = (opts.cars || raw.train.carTypes.map(function (c) { return c.name; }));
    if (!(Nv > 0) || !(Nc > 0) || !(Nveh > 0)) { msgs.push({ level: 'err', text: 'O.6 file: cells A2 (speeds), B2 (cants) and D2 (vehicles) must hold the counts.' }); return { project: project, messages: msgs, imported: [] }; }
    Nr = Nr > 0 ? Nr : 0;
    var V = [], C = [], R = [], i, j, k;
    for (i = 0; i < Nv; i++) { V.push(cell(4 + i, 0)); }
    for (i = 0; i < Nc; i++) { C.push(cell(4 + i, 1)); }
    for (i = 0; i < Nr; i++) { R.push(cell(4 + i, 2)); }
    var Nd = Math.max(Nv, Nc, Nr, Nveh) + 5, tr = [], cv = [], DAT = ['lead', 'centre', 'trail'], used = [];
    for (k = 0; k < Nveh; k++) {
      var car = cars[k]; if (!car) { msgs.push({ level: 'warn', text: 'O.6 file: vehicle ' + (k + 1) + ' has no car type in the Train Configuration; skipped.' }); continue; }
      used.push(car);
      for (i = 0; i < Nv; i++) { for (j = 0; j < Nc; j++) {
        var base = Nd + (i * Nc + j) * 3 + 1;
        DAT.forEach(function (dn, m) {
          var r = base + m, c0 = 2 + 6 * k, vals = [0, 1, 2, 3, 4, 5].map(function (x) { return cell(r, c0 + x); });
          if (vals.some(function (x) { return x === null || !isFinite(x); })) { msgs.push({ level: 'warn', text: 'O.6 file: row ' + r + ', vehicle ' + (k + 1) + ': incomplete values; skipped.' }); return; }
          tr.push({ car: car, cond: cond, v_kmh: Math.round(V[i] * 3.6 * 1000) / 1000, cant_mm: C[j], datum: dn, y_mean: Math.abs(vals[0]) * lenF, y_sd: vals[1] * lenF, z_mean: Math.abs(vals[2]) * lenF, z_sd: vals[3] * lenF, th_mean: Math.abs(vals[4]) * rotF, th_sd: vals[5] * rotF });
        });
      } }
      var Ncd = Nd + Nv * Nc * 3 + 2;
      for (i = 0; i < Nr; i++) {
        var rr = Ncd + 1 + i, rad = cell(rr, 0), q = [0, 1, 2, 3].map(function (x) { return cell(rr, 1 + 4 * k + x); });
        if (rad === null || q.some(function (x) { return x === null; })) { continue; }
        cv.push({ car: car, cond: cond, R_m: rad, yo_lead: q[0] * lenF, yo_trail: q[1] * lenF, yi_lead: q[2] * lenF, yi_trail: q[3] * lenF });
      }
    }
    raw.sim = raw.sim || {};
    raw.sim.transient = (raw.sim.transient || []).filter(function (r) { return !(used.indexOf(r.car) >= 0 && r.cond === cond); }).concat(tr);
    raw.sim.curving = (raw.sim.curving || []).filter(function (r) { return !(used.indexOf(r.car) >= 0 && r.cond === cond); }).concat(cv);
    msgs.push({ level: 'ok', text: 'O.6 file: ' + tr.length + ' transient rows (' + Nv + ' speeds × ' + Nc + ' cants × 3 datums) and ' + cv.length + ' curving rows imported for ' + used.join(', ') + ', condition "' + cond + '".' });
    return { project: raw, messages: msgs, imported: ['Sim_Transient', 'Sim_Curving'] };
  }

  return {
    importO6: importO6, simResultsWorkbook: simResultsWorkbook,
    TAB_SHEETS: TAB_SHEETS, ALL_SHEETS: ALL_SHEETS, sheetRows: sheetRows, keyOf: keyOf,
    tabWorkbook: tabWorkbook, allInputsWorkbook: allInputsWorkbook, workbookBytes: workbookBytes, staticResultsWorkbook: staticResultsWorkbook, dynamicResultsWorkbook: dynamicResultsWorkbook, testsWorkbook: testsWorkbook,
    importWorkbook: importWorkbook, readWorkbookBytes: readWorkbookBytes,
    projectJson: projectJson, parseProject: parseProject, fileSlug: fileSlug,
    downloadBlob: downloadBlob, downloadText: downloadText, downloadWorkbook: downloadWorkbook, readFile: readFile
  };
}));
