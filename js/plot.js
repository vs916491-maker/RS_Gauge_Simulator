/*
 * Chart.js dataset builders for the input previews: profiles (KE, SOD, RS) as full mirrored outlines and
 * the track alignment against chainage. Only reshapes input data; contains no physics. DOM-free.
 * Attaches to RSGAUGE.plot.
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

  function outline(pr, group, i, opts) {
    var col = PALETTE[group][i % PALETTE[group].length];
    return {
      label: (group === 'ke' ? 'KE: ' : group === 'sod' ? 'SOD: ' : 'RS: ') + pr.name,
      data: M.fullProfile(pr.points).map(function (p) { return { x: p.y, y: p.z }; }),
      showLine: true, fill: false, borderColor: col, backgroundColor: col,
      borderWidth: opts && opts.bold ? 2.5 : 1.6, borderDash: group === 'sod' ? [6, 4] : (group === 'rs' && i > 0 ? [3, 2] : []),
      pointRadius: opts && opts.points ? 2.5 : 0, pointHoverRadius: 4, tension: 0
    };
  }

  // sel: { ke: true|[names], sod: ..., rs: ..., items: true, highlight: {group, name} }
  function profileDatasets(p, sel) {
    var ds = [];
    function want(group, name) {
      var s = sel[group];
      return s === true || (Array.isArray(s) && s.indexOf(name) >= 0);
    }
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
    ds.forEach(function (d) { d.data.forEach(function (q) { ymax = Math.max(ymax, Math.abs(q.x)); zmax = Math.max(zmax, q.y); zmin = Math.min(zmin, q.y); }); });
    var step = 500;
    ymax = Math.ceil((ymax * 1.05) / step) * step; zmax = Math.ceil((zmax * 1.04) / step) * step; zmin = Math.floor(zmin / step) * step;
    return { xmin: -ymax, xmax: ymax, ymin: zmin, ymax: zmax, aspect: (2 * ymax) / (zmax - zmin) };
  }

  // Stepped series of the track data against chainage: curvature 1000/R (left curves positive), cant, speed, vertical curvature.
  function trackSeries(segments) {
    var seg = M.sortSegments(segments.filter(function (s) { return s.from_m !== null && s.to_m !== null && s.to_m > s.from_m; }));
    var curv = [], cant = [], speed = [], vcurv = [];
    seg.forEach(function (s, i) {
      var k = s.R_m > 0 ? (s.side === 'R' ? -1 : 1) * 1000 / s.R_m : 0;
      var kv = s.Rv_m ? 10000 / s.Rv_m : 0;
      [s.from_m, s.to_m].forEach(function (x) {
        curv.push({ x: x, y: k }); cant.push({ x: x, y: s.cant_mm || 0 }); speed.push({ x: x, y: s.speed_kmh || 0 }); vcurv.push({ x: x, y: kv });
      });
      // break the line where the next segment does not start at this one's end (gap in the data)
      var nx = seg[i + 1];
      if (nx && Math.abs(nx.from_m - s.to_m) > 1e-6) {
        curv.push({ x: s.to_m, y: null }); cant.push({ x: s.to_m, y: null }); speed.push({ x: s.to_m, y: null }); vcurv.push({ x: s.to_m, y: null });
      }
    });
    return { curvature: curv, cant: cant, speed: speed, vcurvature: vcurv };
  }

  return { profileDatasets: profileDatasets, profileAxes: profileAxes, trackSeries: trackSeries, PALETTE: PALETTE };
}));
