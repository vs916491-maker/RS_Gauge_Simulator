/*
 * Chart.js dataset builders: input previews (profiles mirrored, track against chainage) and static results
 * (section outlines with the generated KE, Method A half-widths). Only reshapes input data and engine output;
 * contains no physics. DOM-free. Attaches to RSGAUGE.plot.
 */
(function (root, factory) {
  var M = (typeof module === 'object' && module.exports) ? require('./model.js') : root.RSGAUGE.model;
  var api = factory(M);
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.RSGAUGE = root.RSGAUGE || {}; root.RSGAUGE.plot = api; }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';

  var PALETTE = {
    ke: ['#2563eb', '#0891b2', '#4f46e5', '#0284c7'],
    sod: ['#6b7280', '#9a3412', '#57534e', '#78716c'],
    rs: ['#059669', '#d97706', '#7c3aed', '#be185d', '#65a30d']
  };
  function line(label, data, color, o) {
    o = o || {};
    return { label: label, data: data, showLine: true, fill: false, borderColor: color, backgroundColor: color, borderWidth: o.w || 1.6,
      borderDash: o.dash || [], pointRadius: o.points ? 2.5 : 0, pointHoverRadius: 4, tension: 0 };
  }

  function outline(pr, group, i, opts) {
    var col = PALETTE[group][i % PALETTE[group].length];
    return line((group === 'ke' ? 'KE: ' : group === 'sod' ? 'SOD: ' : 'RS: ') + pr.name, M.fullProfile(pr.points).map(function (p) { return { x: p.y, y: p.z }; }), col,
      { w: opts && opts.bold ? 2.5 : 1.6, dash: group === 'sod' ? [6, 4] : (group === 'rs' && i > 0 ? [3, 2] : []), points: opts && opts.points });
  }

  // sel: { ke: true|[names], sod: ..., rs: ..., items: true, highlight: {group, name} }
  function profileDatasets(p, sel) {
    var ds = [];
    function want(group, name) { var s = sel[group]; return s === true || (Array.isArray(s) && s.indexOf(name) >= 0); }
    ['sod', 'ke', 'rs'].forEach(function (g) {
      var list = g === 'ke' ? p.ke.profiles : g === 'sod' ? p.sod.profiles : p.rs.profiles;
      list.forEach(function (pr, i) {
        if (!want(g, pr.name) || pr.points.length < 2) { return; }
        var hl = sel.highlight && sel.highlight.group === g && sel.highlight.name === pr.name;
        ds.push(outline(pr, g, i, { bold: hl, points: hl }));
      });
    });
    if (sel.items && p.sod.items.length) {
      var pts = [];
      p.sod.items.forEach(function (it) { if (it.y !== null && it.z !== null) { pts.push({ x: it.y, y: it.z, label: it.name }, { x: -it.y, y: it.z, label: it.name }); } });
      ds.push({ label: 'SOD items', data: pts, showLine: false, pointStyle: 'crossRot', pointRadius: 6, borderWidth: 2, borderColor: '#dc2626', backgroundColor: '#dc2626' });
    }
    return ds;
  }

  // Axis limits with equal scale in y and z (the chart's aspect ratio is set from the same spans).
  function profileAxes(ds) {
    var ymax = 500, zmax = 500, zmin = 0;
    ds.forEach(function (d) { d.data.forEach(function (q) { if (q.y === null) { return; } ymax = Math.max(ymax, Math.abs(q.x)); zmax = Math.max(zmax, q.y); zmin = Math.min(zmin, q.y); }); });
    var step = 500;
    ymax = Math.ceil((ymax * 1.05) / step) * step; zmax = Math.ceil((zmax * 1.04) / step) * step; zmin = Math.floor(zmin / step) * step;
    return { xmin: -ymax, xmax: ymax, ymin: zmin, ymax: zmax, aspect: (2 * ymax) / (zmax - zmin) };
  }

  // Track data against chainage: curvature 1000/R (left +), linear in transitions; cant linear; speed; vertical curvature.
  function trackSeries(segments) {
    var seg = M.sortSegments(segments.filter(function (s) { return s.from_m !== null && s.to_m !== null && s.to_m > s.from_m; }));
    var curv = [], cant = [], speed = [], vcurv = [];
    function k(R, side) { return R > 0 ? (side === 'R' ? -1 : 1) * 1000 / R : 0; }
    seg.forEach(function (s, i) {
      var kv = s.Rv_m ? 10000 / s.Rv_m : 0;
      curv.push({ x: s.from_m, y: k(s.R_start_m, s.side) }, { x: s.to_m, y: k(s.R_end_m, s.side) });
      cant.push({ x: s.from_m, y: s.cant_start_mm || 0 }, { x: s.to_m, y: s.cant_end_mm || 0 });
      speed.push({ x: s.from_m, y: s.speed_kmh || 0 }, { x: s.to_m, y: s.speed_kmh || 0 });
      vcurv.push({ x: s.from_m, y: kv }, { x: s.to_m, y: kv });
      var nx = seg[i + 1];
      if (nx && Math.abs(nx.from_m - s.to_m) > 1e-6) {
        [curv, cant, speed, vcurv].forEach(function (a) { a.push({ x: s.to_m, y: null }); });
      }
    });
    return { curvature: curv, cant: cant, speed: speed, vcurvature: vcurv };
  }

  // ---------------------------------------------------------------- static results
  // Right side as calculated, left side mirrored (the car can lean either way) - as the workbook plots.
  function mirrorRight(pts) {
    var right = pts.map(function (q) { return { x: q.x, y: q.y }; }), left = [];
    for (var i = right.length - 1; i >= 0; i--) { left.push({ x: -right[i].x, y: right[i].y }); }
    return right.concat(left, right.length ? [right[0]] : []);
  }
  function sectionDatasets(res, car, section, colors) {
    colors = colors || {};
    var ds = [], c = res.cars.filter(function (x) { return x.car === car; })[0];
    if (!c) { return ds; }
    ds.push(line('Customer KE: ' + res.ke.name, M.fullProfile(res.ke.points).map(function (q) { return { x: q.y, y: q.z }; }), colors.ke || '#2563eb', { w: 2.2 }));
    var cs = c.cases.filter(function (k) { return k.section === section; });
    if (cs[0]) {
      ds.push(line('Static profile: ' + cs[0].profile, mirrorRight(cs[0].points.map(function (q) { return { x: q.x0, y: q.h0 }; })), colors.rs || '#059669', { w: 1.6 }));
    }
    cs.forEach(function (k) {
      ds.push(line('Generated KE – ' + k.load, mirrorRight(k.points.map(function (q) { return { x: q.x, y: q.h }; })), k.load === 'tare' ? (colors.tare || '#dc2626') : (colors.crush || '#d97706'), { dash: k.load === 'tare' ? [] : [5, 3] }));
    });
    cs.forEach(function (k) {
      if (k.min) { ds.push({ label: 'Governing point – ' + k.load + ' (' + k.min.pt + ', ' + k.min.c.toFixed(1) + ' mm)', data: [{ x: k.min.x, y: k.min.h }], showLine: false, pointRadius: 6, pointStyle: 'rectRot', borderColor: k.load === 'tare' ? '#dc2626' : '#d97706', backgroundColor: 'transparent', borderWidth: 2 }); }
    });
    return ds;
  }
  // Method A: half-width against height, as (x = half-width, y = height) lines.
  function methodADatasets(res, car, colors) {
    colors = colors || {};
    var c = res.cars.filter(function (x) { return x.car === car; })[0];
    if (!c) { return []; }
    function col(key) { return c.methodA.filter(function (r) { return r[key] !== null && r[key] > 0; }).map(function (r) { return { x: r[key], y: r.h }; }); }
    return [
      line('Customer KE half-width', c.methodA.map(function (r) { return { x: r.W, y: r.h }; }), colors.ke || '#2563eb', { w: 2.2 }),
      line('Max static – interior', col('max_int'), colors.int || '#059669'),
      line('Max static – exterior', col('max_ext'), colors.ext || '#7c3aed', { dash: [6, 3] }),
      line('Max static – car end', col('max_end'), colors.end || '#dc2626', { dash: [2, 2] }),
      line('Profile – interior', col('prof_int'), colors.pint || '#6b7280', { w: 1.2, points: true }),
      line('Profile – exterior / end', col('prof_ext'), colors.pext || '#a8a29e', { w: 1.2, dash: [4, 2] })
    ];
  }

  // EN 15273-2 maximum construction gauge against the workbook Method A (x = half-width, y = height).
  function enDatasets(res, car, colors) {
    colors = colors || {};
    var c = res.cars.filter(function (x) { return x.car === car; })[0];
    if (!c || !c.en) { return []; }
    function col(key) { return c.en.rows.filter(function (r) { return r[key] !== null && r[key] > 0; }).map(function (r) { return { x: r[key], y: r.h }; }); }
    return [
      line('Customer KE half-width', c.en.rows.map(function (r) { return { x: r.W, y: r.h }; }), colors.ke || '#2563eb', { w: 2.2 }),
      line('EN max – interior (Ei)', col('max_int'), colors.int || '#059669', { w: 2 }),
      line('EN max – exterior (Ea)', col('max_ext'), colors.ext || '#7c3aed', { w: 2, dash: [6, 3] }),
      line('EN max – car end (Ea)', col('max_end'), colors.end || '#dc2626', { w: 2, dash: [2, 2] }),
      line('Method A – interior', col('ma_int'), colors.ma || '#94a3b8', { w: 1.2, dash: [8, 4] }),
      line('Method A – car end', col('ma_end'), colors.ma2 || '#cbd5e1', { w: 1.2, dash: [3, 3] }),
      line('Profile – interior', col('prof_int'), colors.pint || '#6b7280', { w: 1.2, points: true })
    ];
  }

  // ---------------------------------------------------------------- dynamic results
  function chainageSeries(rows, key, scale) {
    scale = scale || 1;
    return rows.map(function (r) { var v = r[key]; return { x: r.ch, y: (v === null || v === undefined || v === '') ? null : v * scale }; });
  }
  function crossSectionDatasets(xs, colors) {
    colors = colors || {};
    var ds = [
      line('Customer KE (' + xs.row.ke + ')', xs.ke, colors.ke || '#2563eb', { w: 2 }),
      line('KE + SOD curve allowance', xs.keSod, colors.sod || '#6b7280', { dash: [6, 4] }),
      line('Static profile', xs.staticProfile, colors.rs || '#059669', { w: 1.4 }),
      line('Dynamic envelope (right: outside at speed, left: inside stopped)', xs.envelope, colors.env || '#dc2626', { w: 2 }),
      { label: 'Rails', data: xs.rails, showLine: true, borderColor: colors.rail || '#1b1f24', backgroundColor: colors.rail || '#1b1f24', borderWidth: 3, pointRadius: 3 }
    ];
    if (xs.structure) { ds.push({ label: 'Structure at h2', data: xs.structure, showLine: true, borderColor: colors.str || '#9a3412', backgroundColor: colors.str || '#9a3412', borderWidth: 3, pointRadius: 0 }); }
    return ds;
  }

  return { chainageSeries: chainageSeries, crossSectionDatasets: crossSectionDatasets, profileDatasets: profileDatasets, profileAxes: profileAxes, trackSeries: trackSeries,
    sectionDatasets: sectionDatasets, methodADatasets: methodADatasets, enDatasets: enDatasets, mirrorRight: mirrorRight, PALETTE: PALETTE };
}));
