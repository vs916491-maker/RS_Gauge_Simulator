/*
 * CALCULATION ENGINE - pure, deterministic, DOM-free (loads in Node for tests).
 * Implements METHOD.md (the workbook method "Vehicle Gauging Calculation Tool"):
 *   derived car data (pivots, yaw factors, wind equivalent cant, vertical travels, theoretical s and hc,
 *   shared-bogie check), the static cases per car type (interior / exterior / car end x every load case),
 *   point-by-point clearance to the customer KE, Method A maximum static half-width and vertical checks.
 * Dynamic (METHOD §8): chainage sweep per car type with the workbook's Dynamic Calc columns, line and element summaries,
 *   speed-step study and the cross-section at a chainage.
 * Input: a project normalised by js/model.js (profile coordinates in mm). Never mutated.
 * Attaches to RSGAUGE.engine.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.RSGAUGE = root.RSGAUGE || {}; root.RSGAUGE.engine = api; }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '5.1.0';
  var G_ACC = 9.81;
  // The six cases of the reference workbook (tare and crush); the cases of a run follow the load cases (carCases).
  var CASES = [
    { id: 'int_t', section: 'int', load: 'tare', label: 'Interior – Tare' },
    { id: 'int_c', section: 'int', load: 'crush', label: 'Interior – Crush' },
    { id: 'ext_t', section: 'ext', load: 'tare', label: 'Exterior – Tare' },
    { id: 'ext_c', section: 'ext', load: 'crush', label: 'Exterior – Crush' },
    { id: 'end_t', section: 'end', load: 'tare', label: 'Car end – Tare' },
    { id: 'end_c', section: 'end', load: 'crush', label: 'Car end – Crush' }
  ];

  function n0(v, d) { return (v === null || v === undefined || v === '' || !isFinite(v)) ? (d === undefined ? 0 : d) : Number(v); }
  function yes(v) { return v === 'yes' || v === true || v === 1; }
  function findBy(list, key, name) { for (var i = 0; i < list.length; i++) { if (list[i][key] === name) { return list[i]; } } return null; }

  // ---------------------------------------------------------------- outlines (METHOD §3)
  // Points in m: [{x, h}] from the top centre round the outside. nUp = points of the upper envelope.
  function outline(points, nUp) {
    var pts = points.map(function (p) { return { pt: p.pt, x: p.y / 1000, h: p.z / 1000 }; });
    var n = pts.length, nup = (nUp && nUp > 1 && nUp <= n) ? nUp : n, i, wseg = [], tseg = [], widest = 1, xmax = -Infinity;
    for (i = 0; i < nup; i++) { if (pts[i].x > xmax) { xmax = pts[i].x; widest = i + 1; } }   // first index of the widest point (1-based)
    for (i = 0; i < n - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      if (i + 1 < nup) {
        wseg.push({ lo: Math.min(a.h, b.h), hi: Math.max(a.h, b.h), x: a.x, h: a.h, sl: a.h === b.h ? 0 : (b.x - a.x) / (b.h - a.h) });
      }
      if (i + 1 < widest && a.x < b.x) {
        tseg.push({ lo: a.x, hi: b.x, x: a.x, h: a.h, sl: (b.h - a.h) / (b.x - a.x) });
      }
    }
    // all segments (profiles: half-width at a height over the whole outline)
    var aseg = [];
    for (i = 0; i < n - 1; i++) {
      var c = pts[i], d = pts[i + 1];
      aseg.push({ lo: Math.min(c.h, d.h), hi: Math.max(c.h, d.h), x: c.x, h: c.h, sl: c.h === d.h ? 0 : (d.x - c.x) / (d.h - c.h) });
    }
    return { pts: pts, n: n, nUp: nup, widest: widest, top: n ? pts[0].h : 0, hUpBottom: n ? pts[nup - 1].h : 0, wseg: wseg, tseg: tseg, aseg: aseg };
  }
  // Largest value over the matching segments, never below 0 (the workbook's SUMPRODUCT(MAX(...)) rule).
  function lookup(segs, v) {
    var best = 0, i, s;
    for (i = 0; i < segs.length; i++) {
      s = segs[i];
      if (v >= s.lo && v <= s.hi) { var r = s.x + s.sl * (v - s.h); if (r > best) { best = r; } }
    }
    return best;
  }
  function keWidth(o, h) { return lookup(o.wseg, h); }                       // half-width of the upper envelope at height h (m)
  function keTop(o, x) {                                                      // top boundary height at half-width x (m)
    var best = 0, i, s;
    for (i = 0; i < o.tseg.length; i++) { s = o.tseg[i]; if (x >= s.lo && x <= s.hi) { var r = s.h + s.sl * (x - s.x); if (r > best) { best = r; } } }
    return best;
  }
  function profileWidth(o, h) { return lookup(o.aseg, h); }                  // half-width of a profile at height h (m)

  // Clearance of a displaced point from ΔX and ΔH (METHOD §6.4)
  function clearance(dX, dH) {
    if (dX >= 0 && dH >= 0) { return dX * dH === 0 ? 0 : dX * dH / Math.sqrt(dX * dX + dH * dH); }
    if (dX < 0 && dH < 0) { return -dX * dH / Math.sqrt(dX * dX + dH * dH); }
    return Math.min(dX, dH);
  }

  // ---------------------------------------------------------------- derived car data (METHOD §4–5)
  function carGeometry(c) {
    var Lb = n0(c.length_m), nf = n0(c.n_free_m), na = n0(c.n_art_m);
    var s1 = c.end1 === 'shared', s2 = c.end2 === 'shared';
    var n1 = s1 ? na : nf, n2 = s2 ? na : nf, a = Lb - n1 - n2, nEnd = Math.max(n1, n2);
    var ni = (c.ni_m === null || c.ni_m === undefined || c.ni_m === '') ? a / 2 : n0(c.ni_m);
    var nx = n0(c.na_m);
    return {
      Lb: Lb, n_free: nf, n_art: na, shared1: s1, shared2: s2, n1: n1, n2: n2, a: a, n_end: nEnd, ni: ni, na: nx,
      A_ext: a > 0 ? (a + 2 * nx) / a : NaN, A_end: a > 0 ? (a + 2 * nEnd) / a : NaN,
      share1: s1 ? 0.5 : 1, share2: s2 ? 0.5 : 1, na_ok: nx <= nEnd + 0.0001
    };
  }

  // Secondary lateral clearance as a function of the radius (METHOD §5.3a): w∞ on straight track, w(250), w(150) per
  // direction (i = towards the inside of the curve, a = towards the outside), linear in 1/R, w(150) below 150 m.
  var W_R1 = 250, W_R2 = 150;
  function wPoints(b, dir, defl) {
    var winf = n0(defl ? b.w_defl_mm : b.w_mm);
    if (defl) { return { inf: winf, r1: winf, r2: winf }; }
    var both1 = blankOr(b.w250_mm, winf), both2 = blankOr(b.w150_mm, both1);
    var r1 = blankOr(b['w' + dir + '250_mm'], both1), r2 = blankOr(b['w' + dir + '150_mm'], blankV(b['w' + dir + '250_mm']) ? both2 : r1);
    if (!blankV(b['w' + dir + '250_mm']) && blankV(b['w' + dir + '150_mm'])) { r2 = blankV(b.w150_mm) ? r1 : both2; }
    return { inf: winf, r1: r1, r2: r2 };
  }
  function wCurve(pt, R) {
    if (!(R > 0)) { return pt.inf; }
    var c = 1 / R, c1 = 1 / W_R1, c2 = 1 / W_R2;
    if (c <= c1) { return pt.inf + (pt.r1 - pt.inf) * c / c1; }
    if (c <= c2) { return pt.r1 + (pt.r2 - pt.r1) * (c - c1) / (c2 - c1); }
    return pt.r2;
  }
  // Rotation stops (METHOD §5.3b): lateral clearance left at the pivot with the bogie yawed by ψ = asin(a/2R) relative
  // to the body, in mm; null without stops. a = pivot distance of the car (m), R in m (0 = straight).
  function rsHas(b) { return !blankV(b.rs_x_m) && !blankV(b.rs_gap_mm) && n0(b.rs_x_m) > 0; }
  function rsPsi(a, R) { return R > 0 ? Math.asin(Math.min(1, a / (2 * R))) : 0; }
  function rsLimit(b, a, R) { return rsHas(b) ? Math.max(0, n0(b.rs_gap_mm) + n0(b.rs_comp_mm) - rsPsi(a, R) * n0(b.rs_x_m) * 1000) : null; }
  function rsLimits(b) { return rsHas(b) && b.rs_limit_w === 'yes'; }
  // The two bogies under a car combined conservatively: largest plays, travels and wheelbase.
  function carBogie(p, c) {
    var b1 = findBy(p.bogies, 'name', c.bogie1) || p.bogies[0] || {}, b2 = findBy(p.bogies, 'name', c.bogie2) || b1;
    function mx(k) { return Math.max(n0(b1[k]), n0(b2[k])); }
    return {
      b1: b1, b2: b2,
      p: mx('p_m'), play: mx('play_ld_mm'), q: mx('q_mm'), w: mx('w_mm'), w_defl: mx('w_defl_mm'),
      dn_wheel: Math.max(Math.min((n0(b1.wheel_new_mm) - n0(b1.wheel_worn_mm)) / 2, n0(b1.pack_step_mm)), Math.min((n0(b2.wheel_new_mm) - n0(b2.wheel_worn_mm)) / 2, n0(b2.pack_step_mm))),
      dn_prim: mx('dn_prim_mm'), dn_sec_inf: mx('dn_sec_inf_mm'), dn_sec_def: mx('dn_sec_def_mm'),
      up_prim: mx('up_prim_mm'), up_sec: mx('up_sec_mm'), up_oi: mx('up_oi_mm')
    };
  }

  // ---------------------------------------------------------------- load cases (METHOD §4.1a)
  function interp(m, mt, mc, xt, xc) { return mc === mt ? xt : xt + (xc - xt) * (m - mt) / (mc - mt); }
  function blankV(v) { return v === null || v === undefined || v === ''; }
  // Load cases of one car type, in the order of the load-case table: { name, role, m [kg], hG [m], dz [mm], s, hc [mm] }
  // (s, hc as entered; blank = interpolated in deriveCar). Cases without a row for this car are skipped (validation).
  function carLoads(p, c) {
    var L = p.loads || {}, rows = (L.cars || []).filter(function (r) { return r.car === c.name; }), out = [];
    (L.cases || []).forEach(function (lc) {
      var r = findBy(rows, 'load', lc.name);
      if (!r) { return; }
      out.push({ name: lc.name, role: lc.role, m: n0(r.mass_t) * 1000, hG: n0(r.cg_mm) / 1000, dz: r.dz_mm, s: r.s, hc: r.hc_mm });
    });
    if (!out.length) { out.push({ name: 'tare', role: 'tare', m: 0, hG: 0, dz: 0 }); }
    var lt = loadRole(out, 'tare'), lc2 = loadRole(out, 'crush');
    out.forEach(function (x) {   // body lowering from tare: tare 0, crush as entered, other blank = interpolated
      x.dz = x === lt ? 0 : (x === lc2 || !blankV(x.dz) ? n0(x.dz) : interp(x.m, lt.m, lc2.m, 0, n0(lc2.dz)));
    });
    return out;
  }
  // The load case of a role; without one, tare = the first and crush = the heaviest case.
  function loadRole(loads, role) {
    var x = loads.filter(function (l) { return l.role === role; })[0];
    if (x) { return x; }
    if (role === 'tare') { return loads[0]; }
    return loads.reduce(function (a, b) { return b.m > a.m ? b : a; }, loads[0]);
  }
  // Position of an additional section (METHOD §6.1a): x from body end 1, between / beyond the pivots, n and A.
  function sectionPos(g, r) {
    var d = n0(r.dist_m), x = r.ref_end === 'end2' ? g.Lb - d : d, p1 = g.n1, p2 = g.Lb - g.n2, n, beyond;
    if (x < p1) { beyond = true; n = p1 - x; } else if (x > p2) { beyond = true; n = x - p2; } else { beyond = false; n = x - p1; }
    return { x: x, pos: beyond ? 'beyond' : 'between', side: beyond ? (x < p1 ? 'end1' : 'end2') : '', n: n, A: beyond ? (g.a > 0 ? (g.a + 2 * n) / g.a : NaN) : 1, inner: !beyond };
  }
  // Additional sections of a car type with their keys (x1, x2 …) and positions.
  function carSections(p, c, g) {
    return (p.sections || []).filter(function (r) { return r.car === c.name && r.name; }).map(function (r, i) {
      var sp = sectionPos(g, r);
      return { key: 'x' + (i + 1), name: r.name, ref_end: r.ref_end, dist: n0(r.dist_m), profile: r.profile, x: sp.x, pos: sp.pos, side: sp.side, n: sp.n, A: sp.A, inner: sp.inner };
    });
  }
  // Static cases of a car: 3 sections × the load cases (section-major, METHOD §6.1), then the additional sections (§6.1a).
  var SEC_LABEL = { int: 'Interior', ext: 'Exterior', end: 'Car end' };
  function carCases(d, extras) {
    var out = [];
    function lid(L, i) { return L.role === 'tare' ? 't' : (L.role === 'crush' ? 'c' : 'L' + i); }
    ['int', 'ext', 'end'].forEach(function (sec) {
      d.loads.forEach(function (L, i) {
        out.push({ id: sec + '_' + lid(L, i), section: sec, li: i, load: L.name, role: L.role, label: SEC_LABEL[sec] + ' – ' + L.name });
      });
    });
    (extras || []).forEach(function (xs) {
      d.loads.forEach(function (L, i) {
        out.push({ id: xs.key + '_' + lid(L, i), section: xs.key, extra: true, n: xs.n, A: xs.A, inner: xs.inner, li: i, load: L.name, role: L.role, label: xs.name + ' – ' + L.name });
      });
    });
    return out;
  }

  // Theoretical flexibility coefficient and roll-centre height (METHOD §5.3), states: tare, crush, defl and per load case.
  function theoretical(p, c, g, body, latflex, loads) {
    var bs = [[findBy(p.bogies, 'name', c.bogie1) || p.bogies[0] || {}, g.share1], [findBy(p.bogies, 'name', c.bogie2) || findBy(p.bogies, 'name', c.bogie1) || p.bogies[0] || {}, g.share2]];
    function sum(fn) { return bs[0][1] * fn(bs[0][0]) + bs[1][1] * fn(bs[1][0]); }
    function avg(fn) { return (bs[0][1] * fn(bs[0][0]) + bs[1][1] * fn(bs[1][0])) / (bs[0][1] + bs[1][1]); }
    var K1 = sum(function (b) { return n0(b.n_ps) * n0(b.kz_prim) * Math.pow(n0(b.b1_mm) / 1000, 2); });
    var zp = avg(function (b) { return n0(b.z_prim_mm) / 1000; });
    var Kyp = sum(function (b) { return n0(b.n_ps) * n0(b.ky_prim); });
    function state(kz2Key, zsKey, kySecKey, m, hG) {
      var kz2 = typeof kz2Key === 'function' ? kz2Key : function (b) { return n0(b[kz2Key]); };
      var K2 = sum(function (b) { return n0(b.n_as) * kz2(b) * Math.pow(n0(b.b2_mm) / 1000, 2) + n0(b.k_arb); });
      var zs = avg(function (b) { return n0(b[zsKey]) / 1000; });
      var Kys = sum(function (b) { return n0(b.n_as) * n0(b[kySecKey]); });
      var K = 1 / (1 / K1 + 1 / K2), Ky = 1 / (1 / Kyp + 1 / Kys);
      var w1 = (hG - zp) / K1, w2 = (hG - zs) / K2;
      var hc0 = (w1 * zp + w2 * zs) / (w1 + w2);
      var hc = hc0 - (latflex ? (1 / Ky) / (w1 + w2) : 0);
      var mgh = m * G_ACC * (hG - hc), s = mgh / (K - mgh);
      var check = (s < 0 || s > 0.6) ? 'REVIEW – very soft in roll' : (hc < 0.1 ? 'REVIEW – low hc' : 'OK');
      return { m: m, hG: hG, zs: zs, K1: K1, K2: K2, K: K, Ky: Ky, w1: w1, w2: w2, hc0: hc0, hc: hc, mgh: mgh, s: s, check: check };
    }
    loads = loads || carLoads(p, c);
    var lt = loadRole(loads, 'tare'), lc = loadRole(loads, 'crush'), mt = lt.m, mc = lc.m, ht = lt.hG, hcr = lc.hG;
    var tare = state('kz2_t', 'z_sec_mm', 'ky_sec', mt, ht);
    // crush: crush air-spring stiffness; lateral stiffness as tare (workbook rule)
    var crush = state('kz2_c', 'z_sec_mm', 'ky_sec', mc, hcr);
    var defl = state('kz_em', 'z_sec_d_mm', 'ky2_d', mt, ht);
    // every load case (METHOD §5.4): tare and crush as above, other cases with kz2 interpolated by mass
    var per = loads.map(function (L) {
      if (L.role === 'tare') { return tare; }
      if (L.role === 'crush') { return crush; }
      return state(function (b) { return interp(L.m, mt, mc, n0(b.kz2_t), n0(b.kz2_c)); }, 'z_sec_mm', 'ky_sec', L.m, L.hG);
    });
    return { roll_share: g.share1 + g.share2, zp: zp, tare: tare, crush: crush, defl: defl, loads: per };
  }

  function sharedCheck(p, c, g, bg, loads) {
    var L = p.ke.limits || {}, Rmin = n0(p.track.params.R_min_m);
    var mc = (loads || carLoads(p, c)).reduce(function (a, l) { return Math.max(a, l.m); }, 0);   // heaviest load case (METHOD §5.5)
    var b1 = bg.b1, b2 = bg.b2;
    var R2 = g.a > 0 ? mc * (g.Lb / 2 - g.n1) / g.a : NaN, R1 = mc - R2;
    var Q1 = (g.shared1 ? 2 * R1 : R1) + n0(b1.mass_t) * 1000, Q2 = (g.shared2 ? 2 * R2 : R2) + n0(b2.mass_t) * 1000;
    var axle = Math.max(Q1 / Math.max(1, n0(b1.n_axle, 2)), Q2 / Math.max(1, n0(b2.n_axle, 2))) / 1000;
    var pw = bg.p, aRef = g.Lb - 2 * g.n_free;
    var mt = Rmin > 0 ? (g.a * g.a + pw * pw) / (8 * Rmin) * 1000 : 0;
    var et = Rmin > 0 ? (g.a * g.n_end + g.n_end * g.n_end - pw * pw / 4) / (2 * Rmin) * 1000 : 0;
    var mtRef = Rmin > 0 ? (aRef * aRef + pw * pw) / (8 * Rmin) * 1000 : 0;
    var etRef = Rmin > 0 ? (aRef * g.n_free + g.n_free * g.n_free - pw * pw / 4) / (2 * Rmin) * 1000 : 0;
    var lim = n0(L.axle_lim_t);
    return {
      R1: R1, R2: R2, Q1: Q1, Q2: Q2, axle_t: axle, axle_lim_t: lim, axle_ok: lim > 0 ? axle <= lim : true,
      R_min: Rmin, mt: mt, et: et, mt_ref: mtRef, et_ref: etRef, width_loss: 2 * Math.max(mt - mtRef, et - etRef, 0),
      a_max: Math.sqrt(Math.max(8 * Rmin * mtRef / 1000 - pw * pw, 0))
    };
  }

  // All derived quantities of one car type for the chosen options.
  function deriveCar(p, c, opt) {
    opt = opt || {};
    var g = carGeometry(c), bg = carBogie(p, c), tp = p.track.params, tr = p.train;
    var body = findBy(p.bodies, 'car', c.name) || {};
    var rho = n0(tr.rho_air, 1.2), Beq = n0(tr.Beq_mm, 1510);
    var Lw = (body.wind_len_m === null || body.wind_len_m === undefined || body.wind_len_m === '') ? g.Lb : n0(body.wind_len_m);
    var Aw = Lw * (n0(body.wind_top_mm) - n0(body.wind_bot_mm)) / 1000, Cf = n0(body.Cf, 1);
    var Ls = carLoads(p, c), lT = loadRole(Ls, 'tare'), lC = loadRole(Ls, 'crush'), mt = lT.m, mc = lC.m;
    function cw(m) { return m > 0 ? 0.5 * rho * Cf * Aw * Beq / (m * G_ACC) / (3.6 * 3.6) : 0; }
    var Cw_t = cw(mt), Cw_c = cw(mc);
    var Vw = n0(tp.wind_open_kmh);
    var deflLat = opt.lat_state === 'deflated', deflVert = opt.vert_state !== 'inflated';
    var th = theoretical(p, c, g, body, yes(opt.latflex), Ls);
    var theo = opt.flex === 'theoretical';
    var sT = deflLat ? (theo ? th.defl.s : n0(body.s_defl)) : (theo ? th.tare.s : n0(body.s_tare));
    var sC = deflLat ? (theo ? th.defl.s : n0(body.s_defl)) : (theo ? th.crush.s : n0(body.s_crush));
    var hT = deflLat ? (theo ? th.defl.hc : n0(body.hc_defl_mm) / 1000) : (theo ? th.tare.hc : n0(body.hc_tare_mm) / 1000);
    var hC = deflLat ? (theo ? th.defl.hc : n0(body.hc_defl_mm) / 1000) : (theo ? th.crush.hc : n0(body.hc_crush_mm) / 1000);
    // per load case (METHOD §4.1a): tare / crush as above; other cases their own or interpolated values
    var loads = Ls.map(function (L, i) {
      var s, hc;
      if (L === lT) { s = sT; hc = hT; } else if (L === lC) { s = sC; hc = hC; }
      else if (deflLat) { s = sT; hc = hT; }
      else if (theo) { s = th.loads[i].s; hc = th.loads[i].hc; }
      else { s = blankV(L.s) ? interp(L.m, mt, mc, sT, sC) : n0(L.s); hc = blankV(L.hc) ? interp(L.m, mt, mc, hT, hC) : n0(L.hc) / 1000; }
      return { name: L.name, role: L === lT ? 'tare' : (L === lC ? 'crush' : 'other'), m: L.m, hG: L.hG, dz: L.dz, s: s, hc: hc, Cw: cw(L.m), Dw: cw(L.m) * Vw * Vw };
    });
    // body camber / sag / end deflection / pitch and track unevenness / rail wear (METHOD §5.3c), mm at a section
    var vx = { cam: n0(body.cam_up_mid_mm), sag: n0(body.sag_dn_mid_mm), eu: n0(body.end_up_mm), ed: n0(body.end_dn_mm), pz: n0(body.pitch_dz_mm),
      unev: n0(tp.unev_mm), railw: n0(tp.railw_v_mm) };
    function vert(n, inner) {
      if (inner) { var sh = g.a > 0 ? Math.max(0, Math.min(1, 4 * n * (g.a - n) / (g.a * g.a))) : 0; return { up: vx.cam * sh + vx.unev, dn: vx.sag * sh + vx.unev + vx.railw, body: vx.sag * sh, shape: sh }; }
      var r = g.n_end > 0 ? Math.min(1, n / g.n_end) : 0, pt = g.a > 0 ? vx.pz * n / g.a : 0;
      return { up: vx.eu * r + pt + vx.unev, dn: vx.ed * r + pt + vx.unev + vx.railw, body: vx.ed * r + pt, shape: r, pitch: pt };
    }
    vx.any = vx.cam || vx.sag || vx.eu || vx.ed || vx.pz || vx.unev || vx.railw;
    var up = bg.up_prim + bg.up_sec + (yes(opt.over_infl) ? bg.up_oi : 0);
    var dn = bg.dn_wheel + bg.dn_prim + (deflVert ? bg.dn_sec_def : bg.dn_sec_inf);
    var wb = [bg.b1, bg.b2].map(function (b) { return { i: wPoints(b, 'i', deflLat), a: wPoints(b, 'a', deflLat), b: b }; });
    function wOne(x, dir, R) { var w = wCurve(x[dir], R); return rsLimits(x.b) ? Math.min(w, rsLimit(x.b, g.a, R)) : w; }
    function wDir(dir, R) { return Math.max(wOne(wb[0], dir, R), wOne(wb[1], dir, R)); }
    var rsOn = wb.some(function (x) { return rsLimits(x.b); });
    var wVar = rsOn || wb.some(function (x) { return ['i', 'a'].some(function (k) { return x[k].r1 !== x[k].inf || x[k].r2 !== x[k].inf; }); });
    return {
      car: c.name, carRec: c, geo: g, bogie: bg, body: body,
      w_use: rsOn ? Math.max(wOne(wb[0], 'i', 0), wOne(wb[1], 'i', 0)) : (deflLat ? bg.w_defl : bg.w),
      w_var: wVar, w_pts: wb, wi: function (R) { return wDir('i', R); }, wa: function (R) { return wDir('a', R); },
      wind: { Lw: Lw, Aw: Aw, Cf: Cf, rho: rho, Beq: Beq, Cw_t: Cw_t, Cw_c: Cw_c, F: 0.5 * rho * Cf * Aw * Math.pow(Vw / 3.6, 2), Dw_t: Cw_t * Vw * Vw, Dw_c: Cw_c * Vw * Vw },
      dn_total: dn, up_total: up, vx: vx, vert: vert,
      theoretical: th, s_t: sT, s_c: sC, hc_t: hT, hc_c: hC, loads: loads,
      shared: sharedCheck(p, c, g, bg, Ls)
    };
  }

  // ---------------------------------------------------------------- static cases (METHOD §6)
  function caseParams(p, d, cs, opt) {
    var tp = p.track.params, g = d.geo, bg = d.bogie, G = n0(p.train.L_mm, 1500);
    var Rs = n0(tp.R_static_m), L = d.loads[cs.li || 0], inner = cs.inner !== undefined ? cs.inner : cs.section === 'int';
    var n = cs.n !== undefined ? cs.n : (cs.section === 'int' ? g.ni : (cs.section === 'ext' ? g.na : g.n_end));
    var A = cs.A !== undefined ? cs.A : (cs.section === 'int' ? 1 : (cs.section === 'ext' ? g.A_ext : g.A_end));
    var pw = bg.p;
    var dg = Rs === 0 ? 0 : (inner ? (g.a * n - n * n + pw * pw / 4) : (g.a * n + n * n - pw * pw / 4)) / (2 * Rs) * 1000;
    var widen = (Rs > 0 && Rs < n0(tp.widen_R_m)) ? n0(tp.widen_mm) / 2 : 0;
    // secondary clearance: w∞·A on straight track; on a curve w_i(R) between the pivots, w_i(R)·n/a + w_a(R)·(n + a)/a beyond (§6.1)
    var wi = d.wi ? d.wi(Rs) : d.w_use, wa = d.wa ? d.wa(Rs) : d.w_use;
    var wT = (Rs === 0 || !d.w_var) ? d.w_use * A : (inner ? wi * A : wi * n / g.a + wa * (n + g.a) / g.a);
    var t = { play: bg.play * A, q: bg.q * A, w: wT, fw: n0(tp.fw_mm) * A, widen: widen * A };
    var T = dg + t.play + t.q + t.w + t.fw + t.widen;
    var rg = inner ? n0(tp.g_tol_mm) : n0(tp.g_tol_mm) * A * (yes(opt.gtol_ext) ? 1 : 0);
    var ra = n0(tp.align_tol_mm) * (yes(opt.align) ? 1 : 0);
    var cant = inner ? n0(tp.cantexc_max_mm) : n0(tp.cantdef_max_mm);
    var wind = L.Cw * Math.pow(n0(tp.wind_open_kmh), 2) * (yes(opt.wind) ? 1 : 0);
    var cl = n0(tp.cl_err_mm), s = L.s, hc = L.hc;
    var thq = s * (cant + wind) / G, thr = s * cl / G, tht = (yes(opt.tilt) ? 1 : 0) * cl / G;
    return {
      n: n, A: A, dg: dg, play: t.play, q: t.q, w: t.w, wi: wi, wa: wa, fw: t.fw, widen: t.widen, T: T,
      rnd_gauge: rg, rnd_align: ra, cant: cant, wind: wind, cl: cl, s: s, hc: hc,
      thq: thq, thr: thr, tht: tht, thtot: thq + thr + tht,
      drop: L.dz,
      vup: d.vert ? d.vert(n, inner).up : 0,
      up: yes(opt.up_roll) ? d.up_total + (d.vert ? d.vert(n, inner).up : 0) : 0
    };
  }

  // Lateral movement E(h) in mm at height h (m) (METHOD §6.2)
  function lateralE(cp, h, opt) {
    var K = n0(opt.K_rss, 1), lin = opt.comb !== 'rss';
    var rr = cp.thr * (h - cp.hc) * 1000, rt = cp.tht * h * 1000;
    var rnd = lin ? cp.rnd_gauge + cp.rnd_align + rr + rt : K * Math.sqrt(cp.rnd_gauge * cp.rnd_gauge + cp.rnd_align * cp.rnd_align + rr * rr + rt * rt);
    return cp.T + cp.thq * (h - cp.hc) * 1000 + rnd;
  }

  function runCase(p, d, cs, ke, prof, opt) {
    var cp = caseParams(p, d, cs, opt), pts = [], min = null;
    prof.pts.forEach(function (q, i) {
      var E = lateralE(cp, q.h, opt);
      var x = q.x + E / 1000, h = q.h - cp.thtot * q.x - cp.drop / 1000 + cp.up / 1000;
      var W = keWidth(ke, Math.max(h, ke.hUpBottom)), dX = (W - x) * 1000;
      var Hk = keTop(ke, x), dH = (Hk - h) * 1000, c = clearance(dX, dH);
      var r = { i: i + 1, pt: q.pt, x0: q.x * 1000, h0: q.h * 1000, E: E, roll: cp.thq * (q.h - cp.hc) * 1000, x: x * 1000, h: h * 1000, W: W * 1000, dX: dX, H: Hk * 1000, dH: dH, c: c, ok: c >= 0 };
      pts.push(r);
      if (!min || c < min.c) { min = r; }
    });
    return { id: cs.id, label: cs.label, section: cs.section, extra: !!cs.extra, load: cs.load, role: cs.role, li: cs.li, profile: prof.name, params: cp, points: pts, min: min, ok: min ? min.c >= 0 : true };
  }

  function methodA(p, d, cases, ke, profs, opt) {
    var from = n0(opt.ma_from_mm, 900) / 1000, step = Math.max(0.01, n0(opt.ma_step_mm, 100) / 1000), top = ke.top;
    var to = (opt.ma_to_mm === null || opt.ma_to_mm === undefined || opt.ma_to_mm === '') ? top : Math.min(top, n0(opt.ma_to_mm) / 1000);
    var rows = [], k, h;
    for (k = 0; k <= 1000; k++) {
      h = Math.round((from + k * step) * 1e6) / 1e6;
      if (h > to + 1e-9) { if (k === 0) { h = to; } else { break; } }
      var W = keWidth(ke, h), E = cases.map(function (cs) { return lateralE(cs.params, h, opt); });
      var r = { h: h * 1000, W: W * 1000, E: E };
      Object.keys(profs).forEach(function (sec) {
        var em = -Infinity;
        cases.forEach(function (cs, i) { if (cs.section === sec) { em = Math.max(em, E[i]); } });
        var mx = W - em / 1000, pw = profileWidth(profs[sec], h);
        r['max_' + sec] = mx * 1000; r['prof_' + sec] = pw * 1000; r['margin_' + sec] = pw === 0 ? null : (mx - pw) * 1000;   // blank above the profile top
      });
      rows.push(r);
      if (h >= to - 1e-9) { break; }
    }
    return rows;
  }

  function verticalChecks(p, d, cases, ke, profs, extras) {
    var L = p.ke.limits || {}, tp = p.track.params, b = d.body || {};
    var Rv = n0(tp.Rv_static_m), a = d.geo.a;
    var rows = [];
    var g = d.geo, SECN = { int: [g.ni, true], ext: [g.na, false], end: [g.n_end, false] };
    function vu(n, inner) { return d.vert ? d.vert(n, inner).up : 0; }
    ['int', 'ext', 'end'].forEach(function (sec) {
      var v = profs[sec].top * 1000 + d.up_total + vu(SECN[sec][0], SECN[sec][1]);
      rows.push({ id: 'top_' + sec, label: { int: 'Interior', ext: 'Exterior', end: 'Car-end' }[sec] + ' profile top + upward movement', value: v, limit: ke.top * 1000, margin: ke.top * 1000 - v, unit: 'mm' });
    });
    var extraTops = (extras || []).map(function (xs) {   // additional sections (METHOD §6.1a), after the standard rows
      var v = profs[xs.key].top * 1000 + d.up_total + vu(xs.n, xs.inner);
      return { id: 'top_' + xs.key, label: xs.name + ' profile top + upward movement', value: v, limit: ke.top * 1000, margin: ke.top * 1000 - v, unit: 'mm' };
    });
    var vc = Rv === 0 ? 0 : a * a / (8 * Rv) * 1000;
    var roll = cases.filter(function (k) { return k.role === 'crush'; }).reduce(function (m, k) { return Math.max(m, k.params.thtot); }, 0) * n0(b.uf_hw_mm);
    var vm = d.vert ? d.vert(a / 2, true) : { dn: 0 }, vxx = d.vx || {};
    var body = n0(b.uf_h_mm) - d.dn_total - vc - roll - vm.dn;
    var bog = n0(b.uf_bog_h_mm) - d.bogie.dn_wheel - d.bogie.dn_prim - n0(vxx.unev) - n0(vxx.railw);
    if (vxx.any) { rows.push({ id: 'vx', label: 'Body sag + track unevenness + rail head wear at mid-car (§5.3c)', value: vm.dn, unit: 'mm', info: true }); }
    rows.push({ id: 'vc', label: 'Vertical-curve lowering at mid-car (crest Rv static)', value: vc, unit: 'mm', info: true });
    rows.push({ id: 'roll', label: 'Roll lowering of underframe edge (largest crush θ)', value: roll, unit: 'mm', info: true });
    rows.push({ id: 'uf_body', label: 'Body-mounted equipment height in worst case', value: body, limit: n0(L.uf_min_body_mm), margin: body - n0(L.uf_min_body_mm), unit: 'mm' });
    rows.push({ id: 'uf_bog', label: 'Bogie-mounted equipment height in worst case', value: bog, limit: n0(L.uf_min_bog_mm), margin: bog - n0(L.uf_min_bog_mm), unit: 'mm' });
    rows = rows.concat(extraTops);
    rows.forEach(function (r) { if (!r.info) { r.ok = r.margin >= 0; } });
    return rows;
  }

  function profileFor(p, name) {
    var list = p.rs.profiles, pr = findBy(list, 'name', name) || list[0];
    if (!pr) { return null; }
    var o = outline(pr.points, null); o.name = pr.name; return o;
  }

  // ---------------------------------------------------------------- maximum construction gauge outline (METHOD §7.3)
  // Study direction (Train Configuration): backward = customer KE → maximum construction gauge (no RS profile needed),
  // forward = RS profile → generated KE checked against the customer KE, both = the two together.
  function studyOf(p) { var s = p.train && p.train.study; return s === 'backward' || s === 'forward' ? s : 'both'; }

  // Smallest clearance (mm) to the KE over the cases cps of a body point (x, h) in m, as Method B (§6.3–6.4).
  // Below the bottom of the KE's upper envelope the displaced point must also lie inside the whole KE outline (its lower
  // part, e.g. a third-rail or platform notch), which Method B does not look at.
  function mcgClear(cps, ke, opt, x, h) {
    var best = Infinity, i, cp, E, xd, hd, W, c;
    if (!ke._full) { ke._full = keFullPoly(ke); }
    for (i = 0; i < cps.length; i++) {
      cp = cps[i]; E = lateralE(cp, h, opt);
      xd = x + E / 1000; hd = h - cp.thtot * x - cp.drop / 1000 + cp.up / 1000;
      W = keWidth(ke, Math.max(hd, ke.hUpBottom));
      c = clearance((W - xd) * 1000, (keTop(ke, xd) - hd) * 1000);
      if (hd < ke.hUpBottom) { c = Math.min(c, polySigned(xd * 1000, hd * 1000, ke._full)); }
      if (c < best) { best = c; }
    }
    return best;
  }
  // Largest half-width x (m) at height h with every case inside the KE; null when even x = 0 is outside.
  function mcgWidth(cps, ke, opt, h) {
    if (mcgClear(cps, ke, opt, 0, h) < 0) { return null; }
    var lim = 0, i;
    for (i = 0; i < ke.pts.length; i++) { lim = Math.max(lim, ke.pts[i].x); }
    var lo = 0, hi = null, x, step = 0.01;
    for (x = step; x <= lim + 0.5; x += step) { if (mcgClear(cps, ke, opt, x, h) < 0) { hi = x; break; } lo = x; }
    if (hi === null) { return lo; }
    for (i = 0; i < 40; i++) { x = (lo + hi) / 2; if (mcgClear(cps, ke, opt, x, h) >= 0) { lo = x; } else { hi = x; } }
    return lo;
  }
  /*
   * Outline of the maximum construction gauge for the cases cps (one section, or all three for the whole car):
   * top centre → side (upper and side part from the lateral and vertical movements) → bottom side → bottom centre.
   * vb = { z0 (m, bottom on the centre line), th (rad, roll slope of the bottom) }. Points in mm (y floored to 0,1 mm).
   */
  function mcgOutline(cps, ke, opt, top, vb, step, name) {
    var pts = [], warn = [], h, x;
    function W(hh) { return mcgWidth(cps, ke, opt, hh); }
    if (!(top > vb.z0)) { return { name: name, ok: false, points: [], warn: ['The KE leaves no height: bottom ' + fmtMm(vb.z0) + ' mm is above the top ' + fmtMm(top) + ' mm.'] }; }
    // top: the cap, or lower where even the centre line leaves the KE
    var hTop = top, xTop = W(top);
    if (xTop === null) {
      var lo = vb.z0, hi = top, k;
      if (W(lo) === null) { return { name: name, ok: false, points: [], warn: ['No width at any height: the movements exceed the KE.'] }; }
      for (k = 0; k < 50; k++) { h = (lo + hi) / 2; if (W(h) === null) { hi = h; } else { lo = h; } }
      hTop = lo; xTop = W(hTop);
    }
    // bottom side point: on the roll-sloped bottom line z = z0 + th·x
    var xb = W(vb.z0) || 0, zs = vb.z0 + vb.th * xb;
    xb = W(zs) || 0; zs = vb.z0 + vb.th * xb;
    var xs = W(zs);
    if (xs === null) { xs = 0; warn.push('No width at the bottom side point (' + fmtMm(zs) + ' mm).'); }
    var raw = [{ x: 0, h: hTop }];
    if (xTop > 0) { raw.push({ x: xTop, h: hTop }); }
    var hs = [];
    for (h = Math.floor(hTop / step - 1e-9) * step; h > zs + 1e-9; h -= step) { hs.push(Math.round(h * 1e6) / 1e6); }
    hs.forEach(function (hh) {
      x = W(hh);
      if (x === null) { x = 0; if (warn.length < 3) { warn.push('No width at ' + fmtMm(hh) + ' mm (the outline is closed to the centre line there).'); } }
      raw.push({ x: x, h: hh });
    });
    raw.push({ x: xs, h: zs });
    // refine: where the straight line between two points cuts outside the true width, add the midpoint (6 levels)
    function refine(a, b, depth) {
      if (depth > 6 || Math.abs(a.h - b.h) < 1e-5) { return [a]; }
      var hm = (a.h + b.h) / 2, xm = W(hm), xl = (a.x + b.x) / 2;
      if (xm === null || xl <= xm + 1e-5) { return [a]; }
      var m = { x: xm, h: hm };
      return refine(a, m, depth + 1).concat(refine(m, b, depth + 1));
    }
    var fine = [];
    for (var i = 0; i < raw.length - 1; i++) { fine = fine.concat(i === 0 ? [raw[0]] : refine(raw[i], raw[i + 1], 0)); }
    fine.push(raw[raw.length - 1]);
    // drop points whose neighbours' chord stays on or inside them (never outside)
    var keep = [fine[0]], j;
    for (j = 1; j < fine.length - 1; j++) {
      var a0 = keep[keep.length - 1], b0 = fine[j + 1], m0 = fine[j];
      var t = (b0.h === a0.h) ? null : (m0.h - a0.h) / (b0.h - a0.h);
      var xl0 = t === null ? null : a0.x + t * (b0.x - a0.x);
      if (xl0 === null || t < 0 || t > 1 || xl0 > m0.x + 1e-6 || Math.abs(xl0 - m0.x) > 5e-5) { keep.push(m0); }
    }
    keep.push(fine[fine.length - 1]);
    keep.push({ x: 0, h: vb.z0 });
    var out = keep.map(function (q, n) { return { pt: 'M' + (n + 1), y: Math.floor(q.x * 10000 + 1e-6) / 10, z: (q.h === hTop ? Math.floor(q.h * 10000 + 1e-6) : Math.round(q.h * 10000)) / 10 }; });
    // the 0,1 mm rounding must not put a vertex outside: pull it in until every case is inside
    out.forEach(function (q) { var k2 = 0; while (q.y > 0 && k2 < 10 && mcgClear(cps, ke, opt, q.y / 1000, q.z / 1000) < 0) { q.y = Math.max(0, Math.round((q.y - 0.1) * 10) / 10); k2++; } });
    var o = outline(out, null);
    var maxW = 0; out.forEach(function (q) { maxW = Math.max(maxW, q.y); });
    return { name: name, ok: true, points: out, top: out[0].z, bottom: vb.z0 * 1000, side: { y: Math.floor(xs * 10000) / 10, z: zs * 1000 }, maxWidth: maxW, warn: warn, o: o };
  }
  function fmtMm(m) { return (Math.round(m * 10000) / 10).toFixed(1); }

  // Maximum construction gauge of one car type: per section (int, ext, end, additional sections) and the whole car.
  function mcgCar(p, d, extras, ke, opt) {
    var L = p.ke.limits || {}, tp = p.track.params, step = Math.max(1, Math.min(50, n0(opt.mcg_step_mm, 10))) / 1000;
    var cases = carCases(d, extras).map(function (cs) { return { cs: cs, cp: caseParams(p, d, cs, opt) }; });
    var top = ke.top - (yes(opt.up_roll) ? 0 : d.up_total / 1000);   // centre line: top + Σu ≤ KE top (§7.2)
    var Rv = n0(tp.Rv_static_m), vc = Rv === 0 ? 0 : d.geo.a * d.geo.a / (8 * Rv) * 1000;
    var th = cases.filter(function (k) { return k.cs.role === 'crush'; }).reduce(function (m, k) { return Math.max(m, k.cp.thtot); }, 0);
    var z0 = (n0(L.uf_min_body_mm) + d.dn_total + vc) / 1000, vb = { z0: z0, th: th };
    function pick(fn) { return cases.filter(function (k) { return fn(k.cs); }).map(function (k) { return k.cp; }); }
    // §5.3c: the section's own upward (top, centre-line rule) and downward (bottom) additions
    var g = d.geo, SECN = { int: [g.ni, true], ext: [g.na, false], end: [g.n_end, false] };
    (extras || []).forEach(function (xs) { SECN[xs.key] = [xs.n, xs.inner]; });
    function vs(k) { return d.vert ? d.vert(SECN[k][0], SECN[k][1]) : { up: 0, dn: 0 }; }
    function topOf(k) { return top - (yes(opt.up_roll) ? 0 : vs(k).up / 1000); }
    function vbOf(k) { return { z0: z0 + vs(k).dn / 1000, th: th }; }
    var carTop = Math.min(topOf('int'), topOf('ext'), topOf('end')), carVb = { z0: Math.max(vbOf('int').z0, vbOf('ext').z0, vbOf('end').z0), th: th };
    var nm = d.car + ' – ';
    var res = {
      step: step * 1000, top: carTop * 1000, bottom: carVb.z0 * 1000, vc: vc, th: th, cb: n0(L.uf_min_body_mm), dn: d.dn_total, up: d.up_total, upRoll: yes(opt.up_roll),
      int: mcgOutline(pick(function (cs) { return cs.section === 'int'; }), ke, opt, topOf('int'), vbOf('int'), step, 'MCG ' + nm + 'interior'),
      ext: mcgOutline(pick(function (cs) { return cs.section === 'ext'; }), ke, opt, topOf('ext'), vbOf('ext'), step, 'MCG ' + nm + 'exterior'),
      end: mcgOutline(pick(function (cs) { return cs.section === 'end'; }), ke, opt, topOf('end'), vbOf('end'), step, 'MCG ' + nm + 'car end'),
      car: mcgOutline(pick(function (cs) { return !cs.extra; }), ke, opt, carTop, carVb, step, 'MCG ' + nm + 'whole car')
    };
    (extras || []).forEach(function (xs) { res[xs.key] = mcgOutline(pick(function (cs) { return cs.section === xs.key; }), ke, opt, topOf(xs.key), vbOf(xs.key), step, 'MCG ' + nm + xs.name); });
    res.ok = ['int', 'ext', 'end', 'car'].concat((extras || []).map(function (xs) { return xs.key; })).every(function (k) { return res[k].ok; });
    return res;
  }
  // Section profiles of a car type for a run: the RS profiles (forward, both) or the maximum construction gauge (backward).
  function carProfiles(p, d, c, extras, ke, opt) {
    var st = studyOf(p), mcg = st === 'forward' ? null : mcgCar(p, d, extras, ke, opt), profs;
    if (st === 'backward') {
      profs = {};
      ['int', 'ext', 'end'].concat(extras.map(function (xs) { return xs.key; })).forEach(function (k) {
        var m = mcg[k]; if (m.ok) { profs[k] = m.o; profs[k].name = m.name; } else { profs[k] = outline([{ pt: 'M1', y: 0, z: 0 }, { pt: 'M2', y: 0, z: 0 }], null); profs[k].name = m.name; }
      });
      extras.forEach(function (xs) { xs.profile = profs[xs.key].name; });
    } else {
      profs = { int: profileFor(p, c.prof_int), ext: profileFor(p, c.prof_ext), end: profileFor(p, c.prof_end) };
      extras.forEach(function (xs) { profs[xs.key] = profileFor(p, xs.profile); xs.profile = profs[xs.key] ? profs[xs.key].name : ''; });
    }
    if (mcg && st === 'both') {   // RS profile against the gauge: horizontal margin at the profile vertex heights inside the gauge's height range
      Object.keys(profs).forEach(function (k) {
        var m = mcg[k]; if (!m || !m.ok || !profs[k]) { return; }
        var min = null;
        profs[k].pts.forEach(function (q) {
          if (q.h > m.top / 1000 + 1e-9 || q.h < m.bottom / 1000 - 1e-9) { return; }
          var mg = (profileWidth(m.o, q.h) - q.x) * 1000;
          if (!min || mg < min.margin) { min = { margin: mg, pt: q.pt, h: q.h * 1000 }; }
        });
        var topM = m.top - profs[k].top * 1000;
        m.rs = { profile: profs[k].name, min: min, topMargin: topM, ok: (!min || min.margin >= -0.05) && topM >= -0.05 };
      });
    }
    return { profs: profs, mcg: mcg };
  }

  // Smallest curve radius of the line (m; 0 = no curves) and the length with |1/R| ≥ kc (curvature linear along each element).
  function lineCurvature(p, kc) {
    var tm = trackModel(p), Rmin = 0, len = 0, tot = 0;
    tm.el.forEach(function (e) {
      var L = e.s1 - e.s0, a = Math.abs(e.ks), b = Math.abs(e.ke), hi = Math.max(a, b), lo = Math.min(a, b);
      tot += L;
      if (hi > 0 && (Rmin === 0 || 1 / hi < Rmin)) { Rmin = 1 / hi; }
      if (kc === undefined) { return; }
      if (lo >= kc) { len += L; } else if (hi > kc) { len += L * (hi - kc) / (hi - lo); }
    });
    return { Rmin: Rmin, len: len, total: tot };
  }
  /*
   * Rotation-stop check (METHOD §5.3b) per car type and bogie end: the bogie must turn freely down to the smallest radius
   * (no contact on two diagonally opposite stops), contact radius in service (comfort) and the stop limit on w(R).
   */
  function rotStops(p, d, opt) {
    var g = d.geo, tp = p.track.params, G = n0(p.train.L_mm, 1500), rows = [];
    var lc = lineCurvature(p), Rmin = n0(tp.R_min_m);
    if (lc.Rmin > 0 && (!(Rmin > 0) || lc.Rmin < Rmin)) { Rmin = lc.Rmin; }
    var heavy = d.loads.reduce(function (x, L) { return !x || L.m > x.m ? L : x; }, null);
    [[d.bogie.b1, 1, g.share1], [d.bogie.b2, 2, g.share2]].forEach(function (e) {
      var b = e[0];
      if (!rsHas(b)) { return; }
      var xs = n0(b.rs_x_m), gap = n0(b.rs_gap_mm), tr = n0(b.rs_comp_mm), psi = rsPsi(g.a, Rmin), clos = psi * xs * 1000;
      var margin = gap - clos, solid = gap + tr - clos;   // contact starts at the gap; the face is solid after the travel
      function Rat(free) { return free <= 0 ? Infinity : (free / 1000 / xs >= Math.PI / 2 ? 0 : g.a / (2 * Math.sin(free / 1000 / xs))); }
      // quasi-static lateral drift of the body on the secondary springs at the largest cant deficiency + wind (heaviest load)
      var aq = G_ACC * (n0(tp.cantdef_max_mm) + (yes(opt.wind) ? heavy.Cw * Math.pow(n0(tp.wind_open_kmh), 2) : 0)) / G;
      var K = e[2] * n0(b.n_as, 2) * n0(b.ky_sec), yq = K > 0 ? Math.min(heavy.m / 2 * aq / K * 1000, gap) : 0;
      var Rrot = Rat(gap), Rrun = Rat(gap - yq), Rc = blankOr(b.rs_Rcomf_m, null);
      var share = Rrun === Infinity ? lc.total : (Rrun > 0 ? lineCurvature(p, 1 / Rrun).len : 0);
      var wp = wPoints(b, 'i', false), wq = wPoints(b, 'a', false);
      var l1 = rsLimit(b, g.a, 250), l2 = rsLimit(b, g.a, 150);
      var wOver = Math.max(wp.r1, wq.r1) > l1 + 1e-9 || Math.max(wp.r2, wq.r2) > l2 + 1e-9 || n0(b.w_mm) > gap + tr + 1e-9;
      rows.push({ end: e[1], bogie: b.name, x: xs, gap: gap, travel: tr, a: g.a, Rmin: Rmin, psi: psi, closure: clos, margin: margin, solid: solid, ok: margin >= 0,
        load: heavy.name, aq: aq, K: K, yq: yq, Rrot: Rrot, Rrun: Rrun, Rcomf: Rc, comfOk: Rc === null ? null : Rrun <= Rc + 1e-9,
        lineLen: share, lineTotal: lc.total, lineShare: lc.total > 0 ? share / lc.total * 100 : null,
        w_lim: { inf: rsLimit(b, g.a, 0), r250: l1, r150: l2 }, w_entered: { inf: n0(b.w_mm), i250: wp.r1, i150: wp.r2, a250: wq.r1, a150: wq.r2 }, limits: rsLimits(b), wOver: wOver });
    });
    return rows;
  }

  /*
   * Suspension travel with sag and roll (METHOD §5.3d): the movements may be added only while the secondary stays
   * within its travel. Per bogie end with bump / rebound travel entered and per load case: the largest suspension roll
   * of the cases, the secondary's share θ2 = θ·Kφ/Kφ2 of the theoretical model, at the air spring b2.
   */
  function suspLimit(p, d, cases, opt) {
    var rows = [], th = d.theoretical;
    if (opt.lat_state === 'deflated') { return rows; }
    [[d.bogie.b1, 1], [d.bogie.b2, 2]].forEach(function (e) {
      var b = e[0], hasDn = !blankV(b.bump_dn_mm), hasUp = !blankV(b.bump_up_mm);
      if (!hasDn && !hasUp) { return; }
      d.loads.forEach(function (L, i) {
        var ks = cases.filter(function (k) { return k.li === i; }), w = ks.reduce(function (a, k) { var t = k.params.thq + k.params.thr; return !a || t > a.t ? { t: t, label: k.label } : a; }, null);
        if (!w) { return; }
        var st = th.loads[i] || th.tare, share = st && st.K2 > 0 && st.K > 0 ? st.K / st.K2 : 1, th2 = w.t * share, dRoll = th2 * n0(b.b2_mm);
        var dn = hasDn ? n0(b.bump_dn_mm) - n0(L.dz) - dRoll : null, up = hasUp ? n0(b.bump_up_mm) + n0(L.dz) - dRoll : null;
        rows.push({ end: e[1], bogie: b.name, load: L.name, case: w.label, theta: w.t, share: share, theta2: th2, b2: n0(b.b2_mm), roll: dRoll, dz: n0(L.dz),
          bumpDn: hasDn ? n0(b.bump_dn_mm) : null, bumpUp: hasUp ? n0(b.bump_up_mm) : null, mDn: dn, mUp: up, ok: (dn === null || dn >= 0) && (up === null || up >= 0) });
      });
    });
    return rows;
  }
  // Static electrical clearance (METHOD §5.3e): live contact-line parts (SOD items of type "Overhead line") to the
  // section profiles of the car at rest, centred on straight track; required ≥ the static value of the customer limits.
  function elStatic(p, profs, labels) {
    var L = p.ke.limits || {}, req = n0(L.el_static_mm, 290), items = ((p.sod || {}).items || []).filter(function (it) { return it.type === 'ohe' && it.y !== null && it.z !== null; }), rows = [];
    items.forEach(function (it) {
      Object.keys(profs).forEach(function (k) {
        var o = profs[k]; if (!o || !o.pts.length) { return; }
        if (!o._full) { o._full = keFullPoly(o); }
        var dist = -polySigned(Math.abs(n0(it.y)), n0(it.z), o._full);
        rows.push({ item: it.name, y: n0(it.y), z: n0(it.z), section: k, label: labels[k] || k, profile: o.name, dist: dist, req: req, margin: dist - req, ok: dist - req >= 0 });
      });
    });
    return rows;
  }
  /*
   * Static gauge measurement of a built car (METHOD §13.3): each measured point (template or laser) is moved by every
   * movement of every case of its section (Method B) and its clearance to the customer KE taken; deviation = measured
   * half-width − design half-width (the profile of the run) at the same height.
   */
  function measuredEval(p, sres, opt) {
    var rows = (p.tests || {}).measured || [], out = [];
    if (!sres || !rows.length) { return out; }
    var keP = findBy(p.ke.profiles, 'name', sres.ke.name) || p.ke.profiles[0], ke = outline(keP.points, keP.n_up);
    var groups = {}, order = [];
    rows.forEach(function (r, i) {
      if (r.y_mm === null || r.z_mm === null || r.y_mm === undefined) { return; }
      var key = r.car + '|' + (r.section || 'int');
      if (!groups[key]) { groups[key] = { car: r.car, section: r.section || 'int', pts: [] }; order.push(key); }
      groups[key].pts.push({ pt: r.pt || String(i + 1), y: n0(r.y_mm), z: n0(r.z_mm), row: i + 1 });
    });
    order.forEach(function (key) {
      var g = groups[key], c = sres.cars.filter(function (x) { return x.car === g.car; })[0], res = { car: g.car, section: g.section, n: g.pts.length, ok: false };
      if (!c) { res.error = 'Car type ' + g.car + ' is not in the static run'; out.push(res); return; }
      var ks = c.cases.filter(function (k) { return k.section === g.section; });
      if (!ks.length) { res.error = 'No cases'; out.push(res); return; }
      var design = outline(ks[0].points.map(function (q) { return { pt: q.pt, y: q.x0, z: q.h0 }; }), null);
      var min = null, dmax = null;
      res.points = g.pts.map(function (q) {
        var x = q.y / 1000, h = q.z / 1000, best = null;
        ks.forEach(function (k) {
          var cp = k.params, E = lateralE(cp, h, opt), xd = x + E / 1000, hd = h - cp.thtot * x - cp.drop / 1000 + cp.up / 1000;
          var W = keWidth(ke, Math.max(hd, ke.hUpBottom)), cl = clearance((W - xd) * 1000, (keTop(ke, xd) - hd) * 1000);
          if (!best || cl < best.c) { best = { c: cl, case: k.label, x: xd * 1000, h: hd * 1000 }; }
        });
        var dw = profileWidth(design, h) * 1000, inRange = h <= design.top + 1e-9 && dw > 0;
        var r = { pt: q.pt, row: q.row, y: q.y, z: q.z, design: inRange ? dw : null, dev: inRange ? q.y - dw : null, c: best.c, case: best.case, xd: best.x, hd: best.h, ok: best.c >= 0 };
        if (!min || r.c < min.c) { min = r; }
        if (r.dev !== null && (dmax === null || r.dev > dmax.dev)) { dmax = r; }
        return r;
      });
      res.profile = ks[0].profile; res.min = min; res.devMax = dmax; res.ok = res.points.every(function (r) { return r.ok; });
      out.push(res);
    });
    return out;
  }

  /*
   * Static run (METHOD §6). opt = settings.static. Returns per car type the 6 cases, Method A and vertical checks,
   * plus the governing car / case. Throws only on missing essentials (callers validate first).
   */
  function staticRun(p, opt) {
    opt = opt || {};
    var keP = findBy(p.ke.profiles, 'name', opt.ke) || p.ke.profiles[0];
    if (!keP) { throw new Error('No customer KE.'); }
    var study = studyOf(p);
    if (study !== 'backward' && !p.rs.profiles.length) { throw new Error('No RS profile.'); }
    var ke = outline(keP.points, keP.n_up); ke.name = keP.name;
    var stP = (opt.en_static_ref && findBy(p.ke.profiles, 'name', opt.en_static_ref)) || keP, stRef = outline(stP.points, stP.n_up); stRef.name = stP.name;
    var want = opt.cars && opt.cars !== 'all' ? String(opt.cars).split(',') : null;
    var cars = p.train.carTypes.filter(function (c) { return !want || want.indexOf(c.name) >= 0; });
    var warnings = [], gov = null;
    var out = cars.map(function (c) {
      var d = deriveCar(p, c, opt);
      if (!(d.geo.a > 0)) { warnings.push(c.name + ': pivot distance a ≤ 0 — check body length and overhangs.'); }
      if (!d.geo.na_ok) { warnings.push(c.name + ': exterior section na is beyond the car-end overhang.'); }
      var extras = carSections(p, c, d.geo), cpr = carProfiles(p, d, c, extras, ke, opt), profs = cpr.profs;
      if (cpr.mcg) {
        ['int', 'ext', 'end', 'car'].concat(extras.map(function (xs) { return xs.key; })).forEach(function (k) {
          cpr.mcg[k].warn.forEach(function (w) { warnings.push(c.name + ' – ' + cpr.mcg[k].name + ': ' + w); });
        });
      }
      var cases = carCases(d, extras).map(function (cs) { return runCase(p, d, cs, ke, profs[cs.section], opt); });
      var worst = null;
      cases.forEach(function (r) { if (r.min && (!worst || r.min.c < worst.min.c)) { worst = r; } });
      var res = { car: c.name, count: c.count, derived: d, cases: cases, governing: worst ? { id: worst.id, label: worst.label, c: worst.min.c } : null,
        methodA: methodA(p, d, cases, ke, profs, opt), vertical: verticalChecks(p, d, cases, ke, profs, extras), profiles: { int: profs.int.name, ext: profs.ext.name, end: profs.end.name },
        extraSections: extras, mcg: cpr.mcg };
      if (yes(opt.en_check)) {
        res.en = enRun(p, d, ke, profs, opt, res.methodA);
        res.en.vertical = enVertical(p, d, c, ke, profs);
        if (!res.en.vertical.ok) { res.en.ok = false; }
        if (res.en.gauge === 'DE1' && warnings.indexOf('DE1: the radius corrections Δs of L.1.2.2 are not applied (they reduce E); the reductions use the G1 formula structure with the DE1 roll rules – confirm with the infrastructure manager.') < 0) {
          warnings.push('DE1: the radius corrections Δs of L.1.2.2 are not applied (they reduce E); the reductions use the G1 formula structure with the DE1 roll rules – confirm with the infrastructure manager.');
        }
        if (d.geo.shared1 || d.geo.shared2) { warnings.push(c.name + ': EN 15273-2 formulae applied to an articulated unit by the Figure 1 equivalence (a = distance between the shared pivots).'); }
        if (n0(d.bogie.b1.n_axle, 2) !== 2 || n0(d.bogie.b2.n_axle, 2) !== 2) { warnings.push(c.name + ': EN 15273-2 formulae are written for two-axle bogies (§5.1.2); adapt them to the actual geometry.'); }
      }
      if (yes(opt.en_static)) { res.enStatic = enStaticRun(p, d, c, stRef, profs, opt); }
      if (yes(opt.bst_check)) { res.bostrab = bostrabCheck(p, d, profs, opt); }
      res.rotStops = rotStops(p, d, opt);
      res.susp = suspLimit(p, d, cases, opt);
      var secLab = { int: 'Interior', ext: 'Exterior', end: 'Car end' }; extras.forEach(function (xs) { secLab[xs.key] = xs.name; });
      res.elStatic = elStatic(p, profs, secLab);
      res.rotStops.forEach(function (x) { if (x.wOver && !x.limits) { warnings.push(c.name + ' bogie ' + x.bogie + ': the entered w (straight / 250 m / 150 m) is larger than the rotation stops allow (' + x.w_lim.inf.toFixed(1) + ' / ' + x.w_lim.r250.toFixed(1) + ' / ' + x.w_lim.r150.toFixed(1) + ' mm) – set "Rotation stops limit w(R)" or correct the inputs.'); } });
      res.ok = res.rotStops.every(function (x) { return x.ok && x.comfOk !== false; }) && res.susp.every(function (x) { return x.ok; }) && res.elStatic.every(function (x) { return x.ok; }) && (!cpr.mcg || cpr.mcg.ok) && cases.every(function (r) { return r.ok; }) && res.vertical.every(function (r) { return r.info || r.ok; }) && (!res.en || res.en.ok) && (!res.enStatic || res.enStatic.ok) && (!res.bostrab || res.bostrab.ok);
      if (worst && (!gov || worst.min.c < gov.c)) { gov = { car: c.name, id: worst.id, label: worst.label, c: worst.min.c, pt: worst.min.pt }; }
      return res;
    });
    var enGov = null;
    out.forEach(function (c) {
      if (!c.en) { return; }
      ['int', 'ext', 'end'].forEach(function (sec) { var m = c.en.checks[sec].min; if (m && (!enGov || m.margin < enGov.margin)) { enGov = { car: c.car, section: sec, margin: m.margin, h: m.h }; } });
    });
    function stGov(list) {
      var g = null;
      list.forEach(function (c) { if (!c.enStatic) { return; } ['int', 'ext', 'end'].forEach(function (sec) { var m = c.enStatic.checks[sec].min; if (m && (!g || m.margin < g.margin)) { g = { car: c.car, section: sec, margin: m.margin, h: m.h }; } }); });
      return g;
    }
    var fw = p.train.framework;
    if (fw === 'ebo') { warnings.push('Framework EBO: the EN 15273-2 rules of reference line ' + (p.train.ebo_use === 'g1' ? 'G1 (Anlage 7)' : 'G2 (Anlage 8)') + ' are used; the EBO-specific rules of Anlage 9 (e.g. track gauge 1,435 m for bogie vehicles in curves) are pending the documents and are not applied.'); }
    if (fw === 'bostrab') { warnings.push('Framework BOStrab: only the public limits of §34 are checked; the Lichtraumbedarf method of the BOStrab-Lichtraum-Richtlinien is pending the documents and is not applied.'); }
    var ccdRes = (p.ccds || []).length ? ccdStatic(p, opt, (p.thirdRail && p.thirdRail.tr_ke && findBy(p.ke.profiles, 'name', p.thirdRail.tr_ke)) ? (function () { var q = findBy(p.ke.profiles, 'name', p.thirdRail.tr_ke), o = outline(q.points, q.n_up); o.name = q.name; return o; }()) : ke) : null;
    var enRes = null;
    if (yes(opt.en_check)) {
      var bp = enBogieParts(p, ke);
      enRes = { governing: enGov, bogieParts: bp, ok: out.every(function (c) { return !c.en || c.en.ok; }) && bp.ok };
    }
    return {
      engineVersion: VERSION, study: study, ke: { name: ke.name, top: ke.top * 1000, nUp: ke.nUp, points: keP.points },
      cars: out, governing: gov, en: enRes, ccd: ccdRes,
      enStatic: yes(opt.en_static) ? { ref: stRef.name, ok: out.every(function (c) { return !c.enStatic || c.enStatic.ok; }), governing: stGov(out) } : null,
      ok: out.every(function (r) { return r.ok; }) && (!enRes || enRes.bogieParts.ok) && (!ccdRes || ccdRes.ok), warnings: warnings
    };
  }

  // ================================================================ EN 15273-2:2009 KINEMATIC (METHOD §10)
  // Associated rules in SI (m, m², rad); defaults are those of gauge G1.
  function enRules(p) {
    var e = (p.ke && p.ke.en) || {};
    function v(k, d) { return n0(e[k], d); }
    return {
      lmax: v('lmax_mm', 1465) / 1000, e0: v('e0_mm', 15) / 1000, R1: v('R1_m', 250), R2: v('Rmin_m', 150),
      Ck_low: v('Ck_m2', 2.5), Ck_up: v('Ck_up_m2', 3.75), Xi: v('Xi_m2', 100), Xa: v('Xa_m2', 120), h_low: v('h_low_mm', 400) / 1000,
      s0: v('s0', 0.4), hc0: v('hc0_mm', 500) / 1000, I0: v('I0_mm', 50) / 1000, D0: v('D0_mm', 50) / 1000, Dlim: v('Dlim_mm', 200) / 1000,
      Lref: v('Lref_mm', 1500) / 1000, eta_lim: v('eta_lim_deg', 1) * Math.PI / 180,
      st_allow: v('st_allow_mm', 75) / 1000, st_Dmin: v('st_Dmin_m2', 7.5), st_smax: v('st_smax', 0.2), st_h_low: v('st_h_low_mm', 430) / 1000,
      dr_h: v('dr_h_mm', 1050) / 1000, dr_above: v('dr_above_mm', 200) / 1000, dr_wmax: v('dr_wmax_mm', 35) / 1000, dr_X: v('dr_X_mm', 20) / 1000,
      gap_bq0i: blankOr(e.gap_bq0i_mm, null), gap_bq0a: blankOr(e.gap_bq0a_mm, null), gap_R: blankOr(e.gap_R_m, null),
      gauge: e.en_gauge || 'G1', kin_h0: v('kin_k_h0_mm', 3250) / 1000, kin_span: v('kin_k_span_mm', 0) / 1000, st_h0: v('st_k_h0_mm', 3220) / 1000, st_span: v('st_k_span_mm', 0) / 1000,
      kD: v('k_D_m2', 32.5), ks0: v('k_s0', 0.1), kXa: v('k_Xa_m2', 20), st_Xa_hi: blankOr(e.st_Xa_hi_m2, null),
      zb_from: blankOr(e.zb_from_mm, null), zb_to: blankOr(e.zb_to_mm, null), zb_s0: v('zb_s0', 0.19), zb_hc0: v('zb_hc0_mm', 695) / 1000, zb_IorD: v('zb_IorD_mm', 150) / 1000, zb_extra: v('zb_extra_mm', 54) / 1000
    };
  }
  function pos(v) { return v > 0 ? v : 0; }
  function copyR(r) { var o = {}, k; for (k in r) { if (Object.prototype.hasOwnProperty.call(r, k)) { o[k] = r[k]; } } return o; }
  // Rules at height h (m) – height law k of GA / GB / GB1 / GB2 (Annexes B, C) and the roll band of DE1 / DE2 (Annex L).
  // noK: motor coaches (B.3.4.1: A.3.9.2 used as it is).
  function enRulesAt(r, h, noK) {
    var o = copyR(r), k = (!noK && r.kin_span > 0 && h > r.kin_h0) ? Math.min(1, (h - r.kin_h0) / r.kin_span) : 0;
    o.k = k; o.Ck_up0 = r.Ck_up;
    if (k > 0) { o.Ck_up = r.Ck_up + r.kD / 2 * k; o.s0 = r.s0 - r.ks0 * k; o.Xa = r.Xa - r.kXa * k; }
    if (r.zb_from !== null && r.zb_to !== null && h >= r.zb_from / 1000 - 1e-12 && h <= r.zb_to / 1000 + 1e-12) {
      o.zband = true; o.s0 = r.zb_s0; o.hc0 = r.zb_hc0;
    }
    return o;
  }
  function enStaticRulesAt(r, h) {
    var o = copyR(r), k = (r.st_span > 0 && h > r.st_h0) ? Math.min(1, (h - r.st_h0) / r.st_span) : 0;
    o.k = k;
    if (r.st_span > 0 && h > r.st_h0) { o.st_Dmin = r.st_Dmin + r.kD * k; o.st_allow = r.st_allow + r.kD * k / (2 * r.R1); if (r.st_Xa_hi !== null) { o.Xa = r.st_Xa_hi; } }
    return o;
  }
  // Quasi-static term z_kin (A.24 and its special cases), C0 = I0 (inside) or D0 (outside); all in m.
  function enZ(r, h, s, hc, C0, eta) {
    if (eta <= r.eta_lim) {
      if (h < r.hc0) { return 0; }
      if (s <= r.s0) { return s * C0 / r.Lref * pos(h - hc); }
    }
    var k2 = r.zband ? (r.zb_IorD - C0 + r.zb_extra) / r.Lref : (r.Dlim - C0) / r.Lref;
    return s * C0 / r.Lref * pos(h - hc) + Math.tan(pos(eta - r.eta_lim)) * Math.abs(h - hc) + pos(s * k2 * pos(h - hc) - r.s0 * k2 * pos(h - r.hc0));
  }
  // General reduction (A.3.9.1, A.3.9.2, A.3.9.3), literal switching conditions, lengths in m.
  // o = { set: traction|coach|motor, side: i|a, low, n, a, d, q, z, near: {p, winf, w250, w150}, far: {...} }
  // For 'motor' near = motor bogie side (A.40–A.42) or carrying side (A.43–A.45) is given by o.motorNear;
  // between the pivots (A.37–A.39) near = motor bogie and n = n_mu (distance from the motor bogie centre).
  function enE(r, o) {
    var Ck = o.low ? r.Ck_low : r.Ck_up, P = (r.lmax - o.d) / 2, k1 = 1 / (2 * r.R1), kx = 1 / (2 * r.R2) - 1 / (2 * r.R1);
    var n = o.n, a = o.a, q = o.q, z = o.z, inner = o.side === 'i', A = inner ? 1 : (2 * n + a) / a;
    // directional clearances (§5.3a): between the pivots the body moves to the inside at both bogies (w_i); beyond them
    // to the inside at the far bogie (w_i) and to the outside at the bogie of the section's end (w_a)
    var N = inner ? (o.near.i || o.near) : (o.near.a || o.near), F = o.far.i || o.far;
    var fn = (n + a) / a, ff = n / a, delta, x, straight, curve, cond, res;
    if (o.set === 'motor') {
      if (inner) {
        var fm = (a - n) / a, fc = n / a;   // A.37–A.39, N = motor bogie, F = carrying bogie
        delta = a * n - n * n + N.p * N.p / 4 * fm + F.p * F.p / 4 * fc;
        x = (delta - r.Xi) * kx + (N.w150 - N.w250) * fm + (F.w150 - F.w250) * fc;
        straight = P + q + N.winf * fm + F.winf * fc + z - r.e0;
        curve = delta * k1 + P * fm + q + N.w250 * fm + F.w250 * fc + z + pos(x) - Ck / r.R1 - r.e0 * fm;
      } else if (o.motorNear) {   // A.40–A.42: motor bogie at the section's end (N), carrying bogie far (F)
        delta = a * n + n * n - N.p * N.p / 4 * fn + F.p * F.p / 4 * ff;
        x = (delta - r.Xa) * kx + (F.w150 - F.w250) * ff + (N.w150 - N.w250) * fn;
        straight = (P + q) * A + N.winf * fn + F.winf * ff + z - r.e0;
        curve = delta * k1 + P * fn + q * A + F.w250 * ff + N.w250 * fn + z + pos(x) - r.e0 - Ck / r.R1;
      } else {   // A.43–A.45: carrying bogie at the section's end (N), motor bogie far (F)
        delta = a * n + n * n + F.p * F.p / 4 * ff - N.p * N.p / 4 * fn;
        x = (delta - r.Xa) * kx + (F.w150 - F.w250) * ff + (N.w150 - N.w250) * fn;
        straight = (P + q) * A + F.winf * ff + N.winf * fn + z - r.e0;
        curve = delta * k1 + (P + q) * A + F.w250 * ff + N.w250 * fn + z + pos(x) - r.e0 - Ck / r.R1;
      }
      res = { E: Math.max(straight, curve), branch: curve > straight ? 'curve' : 'straight' };   // NOTE of A.3.9.2: the largest
    } else if (inner) {
      delta = a * n - n * n + N.p * N.p / 4;
      x = (delta - r.Xi) * kx + N.w150 - N.w250;
      straight = P + q + N.winf + z - r.e0;
      if (o.set === 'traction') {   // A.27–A.29
        cond = delta - 2 * r.R1 * (N.winf - N.w250) <= 2 * Ck;
        curve = delta * k1 + P + q + N.w250 + z + pos(x) - r.e0 - Ck / r.R1;
      } else {                      // A.46–A.48
        cond = delta - 2 * r.R1 * (N.winf - N.w250) <= r.R1 * (r.lmax - o.d) - 2 * ((r.Ck_up0 !== undefined ? r.Ck_up0 : r.Ck_up) - Ck);
        curve = delta * k1 + q + N.w250 + z + pos(x) - Ck / r.R1;
      }
      res = { E: cond ? straight : curve, branch: cond ? 'straight' : 'curve' };
    } else {
      delta = a * n + n * n - N.p * N.p / 4;
      x = (delta - r.Xa) * kx + (F.w150 - F.w250) * ff + (N.w150 - N.w250) * fn;
      var dw = 2 * r.R1 * ((F.winf - F.w250) * ff + (N.winf - N.w250) * fn);
      straight = (P + q) * A + F.winf * ff + N.winf * fn + z - r.e0;
      if (o.set === 'traction') {   // A.30–A.32
        cond = delta - dw <= 2 * Ck;
        curve = delta * k1 + (P + q) * A + F.w250 * ff + N.w250 * fn + z + pos(x) - r.e0 - Ck / r.R1;
      } else {                      // A.49–A.51
        cond = delta - dw <= r.R1 * (r.lmax - o.d) * ff + 2 * Ck;
        curve = delta * k1 + P * fn + q * A + F.w250 * ff + N.w250 * fn + z + pos(x) - r.e0 - Ck / r.R1;
      }
      res = { E: cond ? straight : curve, branch: cond ? 'straight' : 'curve' };
    }
    // non-linear w (A.3.9.1.2 / A.3.9.3.2): bracket evaluated at the radius where the variable stops begin
    if (o.set !== 'motor' && (N.Rv > 0 || F.Rv > 0)) {
      var Rv = Math.max(N.Rv || 0, F.Rv || 0), wN = N.Rv > 0 ? N.wv : N.winf, wF = F.Rv > 0 ? F.wv : F.winf, br;
      if (inner) { br = (delta - 2 * Ck) / (2 * Rv) + wN; res.Ev = br + (o.set === 'traction' ? P : 0) + q + z - (o.set === 'traction' ? r.e0 : 0); }
      else { br = (delta - 2 * Ck) / (2 * Rv) + wF * ff + wN * fn; res.Ev = br + (o.set === 'traction' ? (P + q) * A : P * fn + q * A) + z - r.e0; }
      if (res.Ev > res.E) { res.E = res.Ev; res.branch = 'variable stops R ' + Math.round(Rv); }
    }
    res.straight = straight; res.curve = curve; res.delta = delta; res.x = pos(x); res.z = z; res.A = A; res.Ck = Ck;
    return res;
  }
  // Single-bogie-type form (both bogies alike, w constant with the radius) — kept for the tests and simple use.
  function enReduction(r, set, side, h, n, a, pw, d, q, w, z) {
    var b = { p: pw, winf: w, w250: w, w150: w };
    return enE(r, { set: set, side: side, low: h <= r.h_low, n: n, a: a, d: d, q: q, z: z, near: b, far: b });
  }
  // EN reductions per section: worst of tare and crush, of the bogie orientations and (motor coach) of the formula pairs.
  function enSectionE(r0, en, sec, h) {
    var r = enRulesAt(r0, h, en.set === 'motor'), best = null, side = sec === 'int' ? 'i' : 'a', B = en.bogies;
    en.loads.forEach(function (ld) {
      var z = enZ(r, h, ld.s, ld.hc, side === 'i' ? r.I0 : r.D0, en.eta), cands = [];
      var base = { set: en.set, side: side, low: h <= r.h_low, a: en.a, d: en.d, q: en.q, z: z };
      function c(n, near, far, mn) { var o = {}, k; for (k in base) { if (Object.prototype.hasOwnProperty.call(base, k)) { o[k] = base[k]; } } o.n = n; o.near = near; o.far = far; o.motorNear = mn; cands.push(o); }
      if (en.set === 'motor') {
        var m = B[0].motor ? B[0] : B[1], t = B[0].motor ? B[1] : B[0];
        if (side === 'i') { c(en.n[sec], m, t); c(en.a - en.n[sec], m, t); }
        else { c(en.n[sec], m, t, true); c(en.n[sec], t, m, false); }
      } else { c(en.n[sec], B[0], B[1]); c(en.n[sec], B[1], B[0]); }
      cands.forEach(function (o) { var e = enE(r, o); if (!best || e.E > best.E) { best = e; best.load = ld.load; } });
    });
    if (best) { best.k = r.k; }
    return best;
  }
  function enRun(p, d, ke, profs, opt, ma) {
    var r = enRules(p), g = d.geo, bg = d.bogie, b1 = bg.b1, b2 = bg.b2;
    var nMot = (yes(b1.motor) ? 1 : 0) + (yes(b2.motor) ? 1 : 0);
    var dW = Math.min(n0(b1.bb_mm) + 2 * n0(b1.ef_worn_mm), n0(b2.bb_mm) + 2 * n0(b2.ef_worn_mm)) / 1000;
    var defl = opt.lat_state === 'deflated';
    function bog(b) {   // w at straight track, 250 m and 150 m; variable stops (blank = none); deflated state: w constant
      var winf = n0(defl ? b.w_defl_mm : b.w_mm) / 1000, w250 = defl ? winf : blankOr(b.w250_mm, winf * 1000) / 1000, w150 = defl ? winf : blankOr(b.w150_mm, w250 * 1000) / 1000;
      var o = { name: b.name, motor: yes(b.motor), p: n0(b.p_m), winf: winf, w250: w250, w150: w150, Rv: defl ? 0 : n0(b.wv_R_m), wv: blankOr(b.wv_mm, winf * 1000) / 1000 };
      // directional views (§5.3a): i = clearance towards the inside of the curve, a = towards the outside
      ['i', 'a'].forEach(function (dir) {
        var pt = wPoints(b, dir, defl), v = copyR(o);
        v.w250 = pt.r1 / 1000; v.w150 = pt.r2 / 1000;
        if (dir === 'a') { v.wv = blankOr(b.wv_a_mm, o.wv * 1000) / 1000; }
        o[dir] = v;
      });
      if (rsLimits(b)) {   // rotation stops limit w(R) (§5.3b)
        var li = rsLimit(b, g.a, 0) / 1000, l1 = rsLimit(b, g.a, r.R1) / 1000, l2 = rsLimit(b, g.a, r.R2) / 1000;
        [o, o.i, o.a].forEach(function (v) { v.winf = Math.min(v.winf, li); v.w250 = Math.min(v.w250, l1); v.w150 = Math.min(v.w150, l2); });
      }
      o.dirW = o.i.w250 !== o.a.w250 || o.i.w150 !== o.a.w150 || o.i.wv !== o.a.wv;
      return o;
    }
    var set = nMot === 0 ? 'coach' : (nMot === 1 && opt.en_mc === 'motor' ? 'motor' : 'traction');
    var en = {
      set: set, bogies: [bog(b1), bog(b2)], a: g.a, p: bg.p, d: dW, q: bg.q / 1000, w: d.w_use / 1000, eta: n0(d.body.eta0_deg) * Math.PI / 180,
      n: { int: g.ni, ext: g.na, end: g.n_end },
      loads: d.loads.map(function (L) { return { load: L.name, role: L.role, s: L.s, hc: L.hc }; })
    };
    var varW = en.bogies.some(function (b) { return ['i', 'a'].some(function (k) { return b[k].w250 !== b.winf || b[k].w150 !== b[k].w250; }); }), nonlin = en.bogies.some(function (b) { return b.Rv > 0; });
    var clause = set === 'motor' ? 'A.3.9.2' : (set === 'traction' ? (nonlin ? 'A.3.9.1.1 + A.3.9.1.2' : 'A.3.9.1.1') : (nonlin ? 'A.3.9.3.1 + A.3.9.3.2' : 'A.3.9.3.1'));
    var secs = ['int', 'ext', 'end'], out = { rules: r, gauge: r.gauge, set: en.set, clause: clause, varW: varW, nonlin: nonlin, bogies: en.bogies, d: dW * 1000, q: bg.q, w: d.w_use,
      eta_deg: n0(d.body.eta0_deg), P: (r.lmax - dW) / 2 * 1000, sections: {}, rows: [], checks: {}, ok: true };
    secs.forEach(function (sec) {
      var hi = enSectionE(r, en, sec, ke.top), lo = enSectionE(r, en, sec, Math.min(r.h_low, ke.top));
      out.sections[sec] = { n: en.n[sec], A: hi.A, delta: hi.delta, x_up: hi.x * 1000, x_low: lo.x * 1000, branch_up: hi.branch, branch_low: lo.branch };
    });
    // maximum construction gauge on the Method A grid, compared with the workbook Method A
    ma.forEach(function (m) {
      var h = m.h / 1000, W = m.W / 1000, row = { h: m.h, W: m.W };
      secs.forEach(function (sec) {
        var e = enSectionE(r, en, sec, h), mx = W - e.E, pw = profileWidth(profs[sec], h);
        row['E_' + sec] = e.E * 1000; row['z_' + sec] = e.z * 1000; row['max_' + sec] = mx * 1000; row['ma_' + sec] = m['max_' + sec];
        row['prof_' + sec] = pw * 1000; row['margin_' + sec] = pw === 0 ? null : (mx - pw) * 1000;
      });
      out.rows.push(row);
    });
    // check of the RS profiles: at every profile vertex height and every KE vertex height within the profile
    secs.forEach(function (sec) {
      var pr = profs[sec], hs = [], seen = {}, lo = Infinity, hiH = -Infinity, pts = [], min = null;
      pr.pts.forEach(function (q) { lo = Math.min(lo, q.h); hiH = Math.max(hiH, q.h); });
      pr.pts.forEach(function (q) { hs.push(q.h); });
      ke.pts.forEach(function (q) { if (q.h >= lo && q.h <= hiH) { hs.push(q.h); } });
      hs.sort(function (u, v) { return u - v; });
      hs.forEach(function (h) {
        var key = Math.round(h * 1e6); if (seen[key]) { return; } seen[key] = 1;
        var xw = profileWidth(pr, h); if (!(xw > 0)) { return; }
        var W = keWidth(ke, Math.max(h, ke.hUpBottom)), e = enSectionE(r, en, sec, h), mg = (W - e.E - xw) * 1000;
        var row = { h: h * 1000, x: xw * 1000, W: W * 1000, E: e.E * 1000, z: e.z * 1000, branch: e.branch, load: e.load, max: (W - e.E) * 1000, margin: mg, ok: mg >= 0 };
        pts.push(row);
        if (!min || mg < min.margin) { min = row; }
      });
      out.checks[sec] = { profile: pr.name, points: pts, min: min, ok: min ? min.margin >= 0 : true };
      if (min && min.margin < 0) { out.ok = false; }
    });
    out.doors = enDoors(p, d, r, en, ke);
    if (!out.doors.ok) { out.ok = false; }
    out.pantographs = enPantographs(p, d, r, en, ke);
    if (!out.pantographs.ok) { out.ok = false; }
    return out;
  }

  /*
   * EN 15273-2:2009 A.3.4 vertical (METHOD §10.7). Lower parts: minimum height of each part of the car type (rows of
   * p.lowerParts; none → the two lower parts of the car body inputs) with the Table A.1 displacements of its zone and the
   * A.16 / A.17 gradient increase. Upper parts: profile top + 10 mm per suspension level + A.18 / A.19 against the KE top.
   * All lengths in m inside, results in mm.
   */
  function enGradient(a, p, n, beyond) {                       // A.16 / A.17 (= A.18 / A.19), normal values in m, result ≥ 0
    var v = beyond ? (a * n + n * n - p * p / 4) / 1000 - 0.08 : (a * n - n * n + p * p / 4) / 1000 - 0.08;
    return v > 0 ? v : 0;
  }
  function enZone(pos, b, b2) { return pos === 'beyond' ? (b > b2 ? 'C' : 'D') : (b > b2 ? 'B' : 'A'); }
  // Table A.1 (locomotives, coaches, motor coaches): suspension + wheel wear displacement of a body-mounted part (mm)
  function enTableA1(zone, o) {
    var r = o.a > 0 ? o.n / o.a : 0, roll = 0.1 * o.s * (o.b - o.b2), susp, wear;
    if (zone === 'A') { susp = o.Aff; wear = o.Usr; }
    else if (zone === 'B') { susp = o.Aff + roll; wear = o.Usr; }
    else if (zone === 'C') { susp = o.Aff + o.dAff * r + roll; wear = o.Usr + o.dUsr * r; }
    else { susp = o.Aff + o.dAff * r; wear = o.Usr + o.dUsr * r; }
    return { susp: susp, wear: wear, total: susp + wear };
  }
  function enLowerItems(p, c) {
    var rows = (p.lowerParts || []).filter(function (r) { return r.car === c.name; });
    if (rows.length) { return { src: 'table', rows: rows }; }
    var b = findBy(p.bodies || [], 'car', c.name) || {};
    return { src: 'body', rows: [
      { name: 'Lowest body-mounted equipment (car body inputs)', mount: 'body', pos: 'between', n_m: null, y_mm: n0(b.uf_hw_mm), h_mm: n0(b.uf_h_mm), hlim_mm: null },
      { name: 'Lowest bogie-mounted equipment (car body inputs)', mount: 'bogie', pos: 'between', n_m: null, y_mm: 0, h_mm: n0(b.uf_bog_h_mm), hlim_mm: null }
    ] };
  }
  function enVertical(p, d, c, ke, profs) {
    var g = d.geo, bg = d.bogie, body = d.body || {}, L = p.ke.limits || {}, a = g.a;
    var pMax = Math.max(n0(bg.b1.p_m), n0(bg.b2.p_m)), pMin = Math.min(n0(bg.b1.p_m), n0(bg.b2.p_m));
    var b2 = Math.min(n0(bg.b1.b2_mm), n0(bg.b2.b2_mm));
    var AffBody = blankOr(body.en_Aff_mm, bg.dn_prim + bg.dn_sec_def), AffBog = bg.dn_prim, Usr = bg.dn_wheel;
    var it = enLowerItems(p, c), out = { src: it.src, Aff: AffBody, Aff_bogie: AffBog, dAff: n0(body.en_dAff_mm), s: n0(body.en_s_v),
      Usr: Usr, dUsr: n0(body.en_dUsr_mm), b2: b2, levels: n0(body.en_levels, 2), lower: [], upper: [], ok: true };
    it.rows.forEach(function (r) {
      var isBog = r.mount === 'bogie', beyond = r.pos === 'beyond', ga, gp, n, row, disp;
      if (isBog) { ga = pMax; gp = 0; n = blankOr(r.n_m, beyond ? 0 : pMax / 2); }
      else { ga = a; gp = beyond ? pMin : pMax; n = blankOr(r.n_m, beyond ? g.n_end : a / 2); }
      var b = n0(r.y_mm), zone = isBog ? 'bogie' : enZone(r.pos, b, b2);
      if (isBog) { disp = { susp: AffBog, wear: Usr, total: AffBog + Usr }; }
      else { disp = enTableA1(zone, { Aff: AffBody, dAff: out.dAff, s: out.s, b: b, b2: b2, Usr: Usr, dUsr: out.dUsr, n: n, a: a }); }
      var grad = enGradient(ga, gp, n, beyond) * 1000;
      var lim = blankOr(r.hlim_mm, n0(isBog ? L.uf_min_bog_mm : L.uf_min_body_mm));
      var hmin = n0(r.h_mm) - disp.total;
      row = { name: r.name, mount: r.mount, pos: r.pos, zone: zone, n: n, b: b, h: n0(r.h_mm), susp: disp.susp, wear: disp.wear, disp: disp.total,
        hmin: hmin, grad: grad, lim: lim, limSrc: (r.hlim_mm === null || r.hlim_mm === undefined || r.hlim_mm === '') ? 'customer' : 'input',
        req: lim + grad, margin: hmin - lim - grad };
      row.ok = row.margin >= 0; if (!row.ok) { out.ok = false; }
      out.lower.push(row);
    });
    var N = { int: g.ni, ext: g.na, end: g.n_end }, ext = 10 * out.levels;
    ['int', 'ext', 'end'].forEach(function (sec) {
      var beyond = sec !== 'int', n = N[sec], grad = enGradient(a, beyond ? pMin : pMax, n, beyond) * 1000, top = profs[sec].top * 1000;
      var v = top + ext + grad, row = { section: sec, profile: profs[sec].name, n: n, top: top, ext: ext, grad: grad, value: v, lim: ke.top * 1000,
        margin: ke.top * 1000 - v, below325: top < 3250 };
      row.ok = row.margin >= 0; if (!row.ok) { out.ok = false; }
      out.upper.push(row);
    });
    return out;
  }

  /*
   * EN 15273-2:2009 A.3.11 bogie parts (METHOD §10.8): the reduction formulae of vehicles with independent axles
   * (A.3.10.1, A.56–A.59, w = 0) with a = distance between the end axles of the bogie. o = { side: i|a, low, n, a, d, q, z }.
   */
  function enBogieE(r, o) {
    var Ck = o.low ? r.Ck_low : r.Ck_up, P = (r.lmax - o.d) / 2, k1 = 1 / (2 * r.R1), n = o.n, a = o.a, delta, straight, curve, A;
    if (o.side === 'i') {      // A.56 / A.57
      delta = a * n - n * n; A = 1;
      straight = P + o.q + o.z - r.e0;
      curve = delta * k1 + P + o.q + o.z - r.e0 - Ck / r.R1;
    } else {                   // A.58 / A.59
      delta = a * n + n * n; A = (2 * n + a) / a;
      straight = (P + o.q) * A + o.z - r.e0;
      curve = delta * k1 + (P + o.q) * A + o.z - r.e0 - Ck / r.R1;
    }
    var cond = delta <= 2 * Ck;
    return { E: cond ? straight : curve, branch: cond ? 'straight' : 'curve', delta: delta, A: A, straight: straight, curve: curve, z: o.z, Ck: Ck };
  }
  // Smallest KE half-width over the whole outline between two heights (m): the part moves vertically between them.
  function keMinWidth(ke, h1, h2) {
    var hs = [h1, h2], w = Infinity;
    ke.pts.forEach(function (q) { if (q.h > h1 && q.h < h2) { hs.push(q.h); } });
    hs.forEach(function (h) { w = Math.min(w, lookup(ke.aseg, h)); });
    return w;
  }
  function enBogieParts(p, ke) {
    var r = enRules(p), rows = [], ok = true;
    (p.bogieParts || []).forEach(function (bp) {
      var b = findBy(p.bogies || [], 'name', bp.bogie);
      if (!b) { return; }
      var a = n0(b.p_m), beyond = bp.pos === 'beyond', n = blankOr(bp.n_m, beyond ? 0 : a / 2), side = beyond ? 'a' : 'i';
      var dW = (n0(b.bb_mm) + 2 * n0(b.ef_worn_mm)) / 1000, q = n0(b.q_mm) / 1000, h = n0(bp.h_mm) / 1000, axle = bp.mount === 'axle';
      var wear = Math.min((n0(b.wheel_new_mm) - n0(b.wheel_worn_mm)) / 2, n0(b.pack_step_mm)) / 1000;
      var down = wear + (axle ? 0 : n0(b.dn_prim_mm) / 1000), up = axle ? 0 : n0(b.up_prim_mm) / 1000;
      var s = axle ? 0 : n0(b.en_s_frame), hc = n0(b.en_hc_frame_mm) / 1000;
      var z = axle ? 0 : enZ(r, h, s, hc, beyond ? r.D0 : r.I0, 0);
      var e = enBogieE(r, { side: side, low: h <= r.h_low, n: n, a: a, d: dW, q: q, z: z });
      var W = keMinWidth(ke, h - down, h + up), y = n0(bp.y_mm) / 1000;
      var row = { bogie: b.name, name: bp.name, mount: bp.mount, pos: bp.pos, a: a, n: n, h: h * 1000, h_lo: (h - down) * 1000, h_hi: (h + up) * 1000, y: y * 1000,
        d: dW * 1000, q: q * 1000, z: z * 1000, delta: e.delta, A: e.A, branch: e.branch, E: e.E * 1000, W: W * 1000, max: (W - e.E) * 1000, margin: (W - e.E - y) * 1000 };
      row.ok = row.margin >= 0; if (!row.ok) { ok = false; }
      rows.push(row);
    });
    return { rows: rows, ok: ok };
  }

  /*
   * EN 15273-2:2009 A.2 static gauge method (METHOD §10.9): reductions A.2–A.5 (no roll term), reference profile from the
   * Customer KE & SOD tab, allowed for s ≤ s_max (A.2.3.1); vertical A.2.3.2 for lower parts up to st_h_low. Lengths in m.
   * o = { side: i|a, n, a, p, d, q, w }
   */
  function enStaticE(r, o) {
    var k1 = 1 / (2 * r.R1), kx = 1 / (2 * r.R2) - 1 / (2 * r.R1), n = o.n, a = o.a, P = (r.lmax - o.d) / 2, raw, D, x, E, A;
    if (o.side === 'i') {      // A.2 / A.3
      raw = a * n - n * n + o.p * o.p / 4; x = (raw - r.Xi) * kx; A = 1;
      D = raw <= r.st_Dmin ? r.st_Dmin : raw;
      E = D * k1 + P + o.q + o.w + pos(x) - r.st_allow;
    } else {                   // A.4 / A.5
      raw = a * n + n * n - o.p * o.p / 4; x = (raw - r.Xa) * kx; A = (2 * n + a) / a;
      D = raw <= r.st_Dmin ? r.st_Dmin : raw;
      E = D * k1 + (P + o.q + o.w) * A + pos(x) - r.st_allow;
    }
    return { E: pos(E), raw: raw, delta: D, x: pos(x), A: A, unclipped: E };
  }
  function enStaticRun(p, d, c, ref, profs, opt) {
    var r = enRules(p), g = d.geo, bg = d.bogie, b1 = bg.b1, b2 = bg.b2;
    var dW = Math.min(n0(b1.bb_mm) + 2 * n0(b1.ef_worn_mm), n0(b2.bb_mm) + 2 * n0(b2.ef_worn_mm)) / 1000;
    var pMax = Math.max(n0(b1.p_m), n0(b2.p_m)), pMin = Math.min(n0(b1.p_m), n0(b2.p_m));
    var s = d.loads.reduce(function (m, L) { return Math.max(m, L.s); }, 0), N = { int: g.ni, ext: g.na, end: g.n_end };
    var out = { gauge: r.gauge, ref: ref.name, d: dW * 1000, P: (r.lmax - dW) / 2 * 1000, q: bg.q, w: d.w_use, s: s, smax: r.st_smax, sOk: s <= r.st_smax + 1e-12, sections: {}, checks: {}, lower: [], ok: true };
    ['int', 'ext', 'end'].forEach(function (sec) {
      var beyond = sec !== 'int', so = { side: beyond ? 'a' : 'i', n: N[sec], a: g.a, p: beyond ? pMin : pMax, d: dW, q: bg.q / 1000, w: d.w_use / 1000 }, e = enStaticE(r, so);
      out.sections[sec] = { n: N[sec], raw: e.raw, delta: e.delta, x: e.x * 1000, A: e.A, E: e.E * 1000 };
      var pr = profs[sec], hs = [], seen = {}, lo = Infinity, hi = -Infinity, pts = [], min = null;
      pr.pts.forEach(function (q) { lo = Math.min(lo, q.h); hi = Math.max(hi, q.h); hs.push(q.h); });
      ref.pts.forEach(function (q) { if (q.h >= lo && q.h <= hi) { hs.push(q.h); } });
      hs.sort(function (u, v) { return u - v; });
      hs.forEach(function (h) {
        var key = Math.round(h * 1e6); if (seen[key]) { return; } seen[key] = 1;
        var xw = profileWidth(pr, h); if (!(xw > 0)) { return; }
        var rh = enStaticRulesAt(r, h), eh = rh.k > 0 || rh.Xa !== r.Xa ? enStaticE(rh, so) : e;
        var W = keWidth(ref, Math.max(h, ref.hUpBottom)), mg = (W - eh.E - xw) * 1000;
        var row = { h: h * 1000, x: xw * 1000, W: W * 1000, E: eh.E * 1000, k: rh.k, max: (W - eh.E) * 1000, margin: mg, ok: mg >= 0 };
        pts.push(row);
        if (!min || mg < min.margin) { min = row; }
      });
      var topOk = pr.top <= ref.top + 1e-9;
      out.checks[sec] = { profile: pr.name, points: pts, min: min, top: pr.top * 1000, refTop: ref.top * 1000, topOk: topOk, ok: (min ? min.margin >= 0 : true) && topOk };
      if (!out.checks[sec].ok) { out.ok = false; }
    });
    // A.2.3.2: parts up to st_h_low: wear + total (bottoming) displacement of the suspension
    var L = p.ke.limits || {}, it = enLowerItems(p, c), Usr = bg.dn_wheel;
    it.rows.forEach(function (q) {
      var h = n0(q.h_mm); if (h > r.st_h_low * 1000) { return; }
      var bog = q.mount === 'bogie', disp = Usr + bg.dn_prim + (bog ? 0 : bg.dn_sec_def), lim = blankOr(q.hlim_mm, n0(bog ? L.uf_min_bog_mm : L.uf_min_body_mm));
      var row = { name: q.name, mount: q.mount, h: h, disp: disp, hmin: h - disp, lim: lim, margin: h - disp - lim };
      row.ok = row.margin >= 0; if (!row.ok) { out.ok = false; }
      out.lower.push(row);
    });
    if (!out.sOk) { out.ok = false; }
    return out;
  }

  /*
   * EN 15273-2:2009 A.3.14 open doors / deployed steps and A.3.15.2 step position (METHOD §10.10). Uses the kinematic
   * reductions of enRun (en) at the element's own n. Allowed half-width = KE half-width − E + allowance; m inside, mm out.
   */
  function enDoorAllowance(r, kind, pos, h, n, a, wi, wa) {
    if (kind === 'door' && h >= r.dr_h - 1e-12) { return { v: r.dr_above, rule: 'a) above ' + Math.round(r.dr_h * 1000) }; }
    if (pos === 'between') { return { v: Math.min(wi, r.dr_wmax), rule: kind === 'door' ? 'b) between' : 'step between' }; }
    if (kind === 'door') { return { v: wi * n / a + pos0(wa - r.dr_X) * (n + a) / a, rule: 'b) beyond A.105' }; }
    return { v: wi * n / a + wa * (n + a) / a, rule: 'step beyond A.106' };
  }
  function pos0(v) { return v > 0 ? v : 0; }
  // Step position A.3.15.2: gap to the platform from straight track to the verification radius (both ends checked).
  function enStepGap(r, pos, b, dg, bgap) {
    var out = [];
    [['inside', r.gap_bq0i], ['outside', r.gap_bq0a]].forEach(function (sd) {
      if (sd[1] === null) { return; }
      var bq = sd[1] / 1000, toward = (sd[0] === 'inside') === (pos === 'between');   // mid-car moves inwards, car ends outwards
      var g0 = bq - b, gR = toward ? bq - b - dg : bq - b + dg;
      var dgmax = toward ? bq - b - bgap : b + bgap - bq;                                   // the formulae of A.3.15.2
      var row = { side: sd[0], bq0: bq * 1000, toward: toward, dg: dg * 1000, dgmax: dgmax * 1000, gap0: g0 * 1000, gapR: gR * 1000, gapMax: Math.max(g0, gR) * 1000, bgap: bgap * 1000 };
      row.ok = row.gapMax <= row.bgap + 1e-9; out.push(row);
    });
    return out;
  }
  function enDoors(p, d, r, en, ke) {
    var g = d.geo, rows = [], ok = true, L = p.ke.limits || {}, bgap = n0(L.prm_gap_mm) / 1000;
    var pMax = Math.max(en.bogies[0].p, en.bogies[1].p), pMin = Math.min(en.bogies[0].p, en.bogies[1].p);
    (p.doorSteps || []).filter(function (x) { return x.car === d.car; }).forEach(function (it) {
      var beyond = it.pos === 'beyond', n = blankOr(it.n_m, beyond ? g.n_end : g.a / 2), sec = beyond ? 'end' : 'int', y = n0(it.y_mm) / 1000;
      var en2 = {}, k; for (k in en) { if (Object.prototype.hasOwnProperty.call(en, k)) { en2[k] = en[k]; } }
      en2.n = { int: n, ext: n, end: n };
      var drop = d.dn_total / 1000, lo = n0(it.h_lo_mm) / 1000 - drop, hi = n0(it.h_hi_mm) / 1000 - drop, hs = [lo, hi], seen = {}, pts = [], min = null;
      if (it.kind === 'door' && r.dr_h > lo && r.dr_h < hi) { hs.push(r.dr_h - 1e-9, r.dr_h); }
      ke.pts.forEach(function (q) { if (q.h > lo && q.h < hi) { hs.push(q.h); } });
      hs.sort(function (u, v) { return u - v; });
      var B = en.bogies, pairs = [[B[0], B[1]], [B[1], B[0]]];
      hs.forEach(function (h) {
        var key = Math.round(h * 1e9); if (seen[key]) { return; } seen[key] = 1;
        var e = enSectionE(r, en2, sec, h), W = keWidth(ke, Math.max(h, ke.hUpBottom)), al = null;
        pairs.forEach(function (pr) {   // far bogie i, near bogie a; both orientations, the smaller allowance
          var x = enDoorAllowance(r, it.kind, it.pos, h, n, en.a, pr[0].winf, pr[1].winf);
          if (!al || x.v < al.v) { al = x; }
        });
        var row = { h: h * 1000, W: W * 1000, E: e.E * 1000, max: (W - e.E) * 1000, extra: al.v * 1000, rule: al.rule, allowed: (W - e.E + al.v) * 1000, y: y * 1000 };
        row.margin = row.allowed - row.y; row.ok = row.margin >= 0;
        pts.push(row); if (!min || row.margin < min.margin) { min = row; }
      });
      var res = { name: it.name, kind: it.kind, pos: it.pos, n: n, y: y * 1000, drop: drop * 1000, lo: lo * 1000, hi: hi * 1000, points: pts, min: min, ok: min ? min.ok : true, gap: [] };
      if (it.kind === 'step' && r.gap_R) {
        var dg = (beyond ? en.a * n + n * n - pMin * pMin / 4 : en.a * n - n * n + pMax * pMax / 4) / (2 * r.gap_R);
        res.gap = enStepGap(r, it.pos, y, dg, bgap);
        res.gap.forEach(function (gp) { if (!gp.ok) { res.ok = false; } });
      }
      if (!res.ok) { ok = false; }
      rows.push(res);
    });
    return { rows: rows, ok: ok };
  }

  /*
   * EN 15273-2:2009 A.3.12 pantograph gauge (METHOD §10.11), formulae A.66–A.85 in m. o = { side: i|a, n, a, p, d, q,
   * wi, wa (w of the far / near bogie at R), R (Infinity = straight track), s, hc, ht, t, theta, tau }.
   * P ≤ 0: the pantograph stays inside the gauge at the upper (6,5 m, Po) and lower (5,0 m, Pu) collecting point.
   */
  function enPantoP(o) {
    var soft = o.s > 0.225, k = soft ? 0.2 : 0.066, c1 = soft ? 0.2375 : 0.1175, c2 = soft ? 0.1825 : 0.0925;
    var zo = k * (6.5 - o.hc) / 1.5 * o.s + Math.sqrt(o.t * o.t + o.tau * o.tau + Math.pow(o.theta * (6.5 - o.hc), 2)) - c1;
    var tl = o.t * (5 - o.ht) / (6.5 - o.ht);
    var zu = k * (5 - o.hc) / 1.5 * o.s + Math.sqrt(tl * tl + o.tau * o.tau + Math.pow(o.theta * (5 - o.hc), 2)) - c2;
    var n = o.n, a = o.a, j, geo, play = 0, delta;
    if (o.side === 'i') {      // A.66 / A.71, A.69–A.70 / A.74–A.75
      j = o.q + o.wi - 0.0375; delta = a * n - n * n + o.p * o.p / 4 - 5;
    } else {                   // A.76 / A.81, A.79–A.80 / A.84–A.85
      j = o.q * (2 * n + a) / a + o.wa * (n + a) / a + o.wi * n / a - 0.0375; delta = a * n + n * n - o.p * o.p / 4 - 5;
      play = (1.465 - o.d) / 2 * 2 * n / a;
    }
    geo = o.R === Infinity ? 0 : pos(delta / (2 * o.R));
    return { Po: geo + play + j + zo, Pu: geo + play + j + zu, geo: geo, play: play, j: j, zo: zo, zu: zu, soft: soft };
  }
  // w of a bogie at radius R: given points w∞ (straight), w(R1), w(R2) linear in 1/R; variable stops: w(Rv) at Rv
  function wAtR(r, b, R, dir) {
    if (dir && b[dir]) { b = b[dir]; }
    if (R === Infinity) { return b.winf; }
    if (b.Rv > 0 && Math.abs(R - b.Rv) < 1e-9) { return b.wv; }
    var c = 1 / R, c1 = 1 / r.R1, c2 = 1 / r.R2;
    if (c <= c1) { return b.winf + (b.w250 - b.winf) * c / c1; }
    return b.w250 + (b.w150 - b.w250) * (c - c1) / (c2 - c1);
  }
  function enPantographs(p, d, r, en, ke) {
    var g = d.geo, rows = [], ok = true, B = en.bogies;
    var pMax = Math.max(B[0].p, B[1].p), pMin = Math.min(B[0].p, B[1].p);
    var radii = [Infinity, r.R2];
    B.forEach(function (b) { if (b.Rv > 0 && radii.indexOf(b.Rv) < 0) { radii.push(b.Rv); } });
    (p.pantographs || []).filter(function (x) { return x.car === d.car; }).forEach(function (pg) {
      var beyond = pg.pos === 'beyond', n = blankOr(pg.n_m, beyond ? g.n_end : g.a / 2), cases = [], wo = null, wu = null;
      var base = { side: beyond ? 'a' : 'i', n: n, a: en.a, p: beyond ? pMin : pMax, d: en.d, q: en.q, ht: n0(pg.ht_mm) / 1000, t: n0(pg.t_mm) / 1000,
        theta: n0(pg.theta_mrad) / 1000, tau: n0(pg.tau_mm) / 1000 };
      radii.forEach(function (R) {
        en.loads.forEach(function (ld) {
          [[B[0], B[1]], [B[1], B[0]]].forEach(function (pr, k) {
            if (k === 1 && B[0].name === B[1].name) { return; }
            var o = {}, x; for (x in base) { if (Object.prototype.hasOwnProperty.call(base, x)) { o[x] = base[x]; } }
            o.R = R; o.s = ld.s; o.hc = ld.hc; o.wi = wAtR(r, pr[0], R, 'i'); o.wa = wAtR(r, pr[1], R, 'a');
            var e = enPantoP(o), row = { R: R === Infinity ? null : R, load: ld.load, role: ld.role, far: pr[0].name, near: pr[1].name, wi: o.wi * 1000, wa: o.wa * 1000,
              geo: e.geo * 1000, play: e.play * 1000, j: e.j * 1000, zo: e.zo * 1000, zu: e.zu * 1000, Po: e.Po * 1000, Pu: e.Pu * 1000, soft: e.soft };
            cases.push(row);
            if (!wo || row.Po > wo.Po) { wo = row; }
            if (!wu || row.Pu > wu.Pu) { wu = row; }
          });
        });
      });
      var res = { name: pg.name, pos: pg.pos, n: n, ht: n0(pg.ht_mm), cases: cases, worstO: wo, worstU: wu, ok: wo.Po <= 1e-9 && wu.Pu <= 1e-9, lowered: null };
      if (pg.h_low_mm !== null && pg.h_low_mm !== undefined && pg.h_low_mm !== '') {   // A.3.12.7 lowered pantograph
        var hl = n0(pg.h_low_mm) / 1000, ins = n0(pg.ins_mm) / 1000, en2 = {}, k2;
        for (k2 in en) { if (Object.prototype.hasOwnProperty.call(en, k2)) { en2[k2] = en[k2]; } }
        en2.n = { int: n, ext: n, end: n };
        var e2 = enSectionE(r, en2, beyond ? 'end' : 'int', hl), W = keWidth(ke, Math.max(hl, ke.hUpBottom));
        var lw = { h: hl * 1000, ins: ins * 1000, bw: n0(pg.bw_mm), W: W * 1000, E: e2.E * 1000, max: (W - e2.E) * 1000, top: ke.top * 1000 };
        lw.marginW = lw.max - lw.bw - lw.ins; lw.marginH = lw.top - lw.h - lw.ins; lw.ok = lw.marginW >= 0 && lw.marginH >= 0;
        res.lowered = lw; if (!lw.ok) { res.ok = false; }
      }
      if (!res.ok) { ok = false; }
      rows.push(res);
    });
    return { rows: rows, ok: ok };
  }

  // ================================================================ THIRD-RAIL CCD (METHOD §14)
  /*
   * Movement ranges (mm) of a point of a CCD carried by bogie b at (y on the rail side, z), for a situation
   * sit = { kAbs (1/m), outside (rail on the outside of the curve), Dt / Da (cant deficiency or excess leaning the bogie
   * towards / away from the rail, mm), vc (vertical-curve offset range [lo, hi], mm) }. + y = towards the rail (outwards).
   */
  function ccdBogie(p, b, sOpt) {
    var tp = p.track.params;
    return { name: b.name, p: n0(b.p_m), play: n0(b.play_ld_mm), q: n0(b.q_mm), wear: Math.min((n0(b.wheel_new_mm) - n0(b.wheel_worn_mm)) / 2, n0(b.pack_step_mm)),
      dp: n0(b.dn_prim_mm), up: n0(b.up_prim_mm), s: n0(b.en_s_frame), hc: n0(b.en_hc_frame_mm),
      fw: n0(tp.fw_mm), gtol: yes(sOpt.gtol_ext) ? n0(tp.g_tol_mm) : 0, align: yes(sOpt.align) ? n0(tp.align_tol_mm) : 0,
      widen: n0(tp.widen_mm), widenR: n0(tp.widen_R_m), G: n0(p.train.L_mm, 1500) };
  }
  function ccdMove(bb, c, sit, y, z) {
    var frame = c.mount !== 'axle', x = n0(c.x_m), R = sit.kAbs > 0 ? 1 / sit.kAbs : 0;
    var rand = bb.play + (frame ? bb.q : 0) + bb.fw + (R > 0 && R < bb.widenR ? bb.widen / 2 : 0) + bb.gtol + bb.align;
    var ov = (x * x - bb.p * bb.p / 4) / 2 * sit.kAbs * 1000, O = sit.outside ? ov : -ov;   // outward offset of the point, signed towards the rail
    var tt = frame ? bb.s * sit.Dt / bb.G : 0, ta = frame ? bb.s * sit.Da / bb.G : 0;      // frame roll towards / away from the rail
    var lt = tt * (z - bb.hc), la = -ta * (z - bb.hc);
    return {
      ylo: O - rand + Math.min(0, lt, la), yhi: O + rand + Math.max(0, lt, la),
      zlo: -bb.wear - (frame ? bb.dp : 0) - tt * y + sit.vc[0], zhi: (frame ? bb.up : 0) + ta * y + sit.vc[1],
      parts: { rand: rand, O: O, lt: lt, la: la, tt: tt, ta: ta }
    };
  }
  function ccdRail(tr) {
    var t = tr.tr_contact || 'bottom', axis = t === 'side' ? 'y' : 'z', away = t === 'top' ? -1 : 1;
    var c = n0(tr.tr_c_mm), tc = n0(axis === 'z' ? tr.tr_tol_z_mm : tr.tr_tol_y_mm), to = n0(axis === 'z' ? tr.tr_tol_y_mm : tr.tr_tol_z_mm), w = n0(tr.tr_wear_mm);
    return { type: t, axis: axis, c: c, lo: c - tc - (away < 0 ? w : 0), hi: c + tc + (away > 0 ? w : 0), olo: n0(tr.tr_o_min_mm), ohi: n0(tr.tr_o_max_mm), tolO: to,
      tolY: n0(tr.tr_tol_y_mm), tolZ: n0(tr.tr_tol_z_mm), minOv: n0(tr.tr_overlap_mm) };
  }
  // Shoe–rail contact: working range on the contact axis and face overlap on the other axis (mm).
  function ccdContact(bb, c, sit, rl) {
    var oMid = (n0(c.o_min_mm) + n0(c.o_max_mm)) / 2, m = rl.axis === 'z' ? ccdMove(bb, c, sit, oMid, rl.c) : ccdMove(bb, c, sit, rl.c, oMid);
    var sc = rl.axis === 'z' ? [m.zlo, m.zhi] : [m.ylo, m.yhi], so = rl.axis === 'z' ? [m.ylo, m.yhi] : [m.zlo, m.zhi];
    var relLo = rl.lo - sc[1], relHi = rl.hi - sc[0];
    var ov = [so[0] - rl.tolO, so[1] + rl.tolO].map(function (dl) { return Math.min(n0(c.o_max_mm) + dl, rl.ohi) - Math.max(n0(c.o_min_mm) + dl, rl.olo); });
    var out = { relLo: relLo, relHi: relHi, cmin: n0(c.c_min_mm), cmax: n0(c.c_max_mm), mLo: relLo - n0(c.c_min_mm), mHi: n0(c.c_max_mm) - relHi,
      overlap: Math.min(ov[0], ov[1]), minOv: rl.minOv };
    out.mOv = out.overlap - rl.minOv; out.reach = Math.min(out.mLo, out.mHi); out.ok = out.reach >= 0 && out.mOv >= 0;
    return out;
  }
  // Moved rectangle of an outline point; a working shoe follows the rail on the contact axis.
  function ccdRect(bb, c, sit, q, rl) {
    var m = ccdMove(bb, c, sit, n0(q.y_mm), n0(q.z_mm)), r = { y0: n0(q.y_mm) + m.ylo, y1: n0(q.y_mm) + m.yhi, z0: n0(q.z_mm) + m.zlo, z1: n0(q.z_mm) + m.zhi };
    if (q.state === 'working' && q.part === 'shoe') {
      if (rl.axis === 'z') { r.z0 = n0(q.z_mm) + rl.lo - rl.c; r.z1 = n0(q.z_mm) + rl.hi - rl.c; } else { r.y0 = n0(q.y_mm) + rl.lo - rl.c; r.y1 = n0(q.y_mm) + rl.hi - rl.c; }
    }
    return r;
  }
  function rectDist(a, b) {
    var dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1), dz = Math.max(0, a.z0 - b.z1, b.z0 - a.z1);
    return Math.sqrt(dy * dy + dz * dz);
  }
  function kePoly(ke) {
    var pts = ke.pts.map(function (q) { return { x: q.x * 1000, y: q.h * 1000 }; }), last = pts[pts.length - 1];
    if (last.x !== 0) { pts.push({ x: 0, y: last.y }); }
    return pts;
  }
  // One CCD in one situation: envelope (KE) margin, contact and clearances (mm).
  function ccdCase(p, bb, c, pts, sit, rl, poly) {
    var res = { ke: null, contact: ccdContact(bb, c, sit, rl), clear: null };
    pts.forEach(function (q) {
      var r = ccdRect(bb, c, sit, q, rl);
      if (poly && !(q.state === 'working' && q.part === 'shoe')) {      // the working shoe touches the rail by design
        [[r.y0, r.z0], [r.y0, r.z1], [r.y1, r.z0], [r.y1, r.z1]].forEach(function (k) {
          var mg = polySigned(k[0], k[1], poly);
          if (!res.ke || mg < res.ke.margin) { res.ke = { margin: mg, pt: q.pt, state: q.state, y: k[0], z: k[1] }; }
        });
      }
      ((p.thirdRail || {}).parts || []).forEach(function (tp) {
        var b = { y0: n0(tp.y_mm) - rl.tolY, y1: n0(tp.y_mm) + rl.tolY, z0: n0(tp.z_mm) - rl.tolZ, z1: n0(tp.z_mm) + rl.tolZ };
        var dist = rectDist(r, b), mg = dist - n0(tp.clear_mm);
        if (!res.clear || mg < res.clear.margin) { res.clear = { margin: mg, dist: dist, req: n0(tp.clear_mm), pt: q.pt, state: q.state, part: tp.name }; }
      });
    });
    res.ok = res.contact.ok && (!res.ke || res.ke.margin >= 0) && (!res.clear || res.clear.margin >= 0);
    return res;
  }
  function ccdSetup(p, sOpt) {
    var rl = ccdRail(p.thirdRail || {}), list = [];
    (p.ccds || []).forEach(function (c) {
      var b = findBy(p.bogies || [], 'name', c.bogie); if (!b) { return; }
      list.push({ c: c, bb: ccdBogie(p, b, sOpt), pts: (p.ccdPoints || []).filter(function (q) { return q.ccd === c.name; }) });
    });
    return { rl: rl, list: list };
  }
  // Static check (METHOD §14.3): tangent, minimum radius with the rail outside / inside, vertical curve both ways.
  function ccdStatic(p, sOpt, ke) {
    var tp = p.track.params, set = ccdSetup(p, sOpt), Rmin = n0(tp.R_min_m), Rv = Math.abs(n0(tp.Rv_static_m)), def = n0(tp.cantdef_max_mm), exc = n0(tp.cantexc_max_mm);
    var poly = ke ? kePoly(ke) : null, out = { rail: set.rl, ke: ke ? ke.name : null, ccds: [], ok: true };
    set.list.forEach(function (e) {
      var x = n0(e.c.x_m), dv = Rv > 0 ? Math.abs((x * x - e.bb.p * e.bb.p / 4) / (2 * Rv)) * 1000 : 0, vc = [-dv, dv];
      var sits = [{ id: 'tangent', label: 'Tangent', kAbs: 0, outside: true, Dt: 0, Da: 0, vc: vc }];
      if (Rmin > 0) {
        sits.push({ id: 'out', label: 'R ' + Rmin + ' m, rail outside', kAbs: 1 / Rmin, outside: true, Dt: def, Da: exc, vc: vc });
        sits.push({ id: 'in', label: 'R ' + Rmin + ' m, rail inside', kAbs: 1 / Rmin, outside: false, Dt: exc, Da: def, vc: vc });
      }
      var cases = sits.map(function (st) { var r = ccdCase(p, e.bb, e.c, e.pts, st, set.rl, poly); r.situation = st.label; r.move = ccdMove(e.bb, e.c, st, (n0(e.c.o_min_mm) + n0(e.c.o_max_mm)) / 2, set.rl.c); return r; });
      function worst(fn) { var w = null; cases.forEach(function (k) { var v = fn(k); if (v !== null && (w === null || v.v < w.v)) { w = { v: v.v, case: k.situation, info: v.info }; } }); return w; }
      var r = { name: e.c.name, bogie: e.bb.name, mount: e.c.mount, x: x, vc: dv, cases: cases,
        ke: worst(function (k) { return k.ke ? { v: k.ke.margin, info: k.ke.pt + ' (' + k.ke.state + ')' } : null; }),
        reach: worst(function (k) { return { v: k.contact.reach, info: k.contact.mLo < k.contact.mHi ? 'lower end' : 'upper end' }; }),
        overlap: worst(function (k) { return { v: k.contact.mOv, info: 'overlap ' + k.contact.overlap.toFixed(1) }; }),
        clear: worst(function (k) { return k.clear ? { v: k.clear.margin, info: k.clear.pt + ' – ' + k.clear.part } : null; }) };
      r.ok = cases.every(function (k) { return k.ok; }); if (!r.ok) { out.ok = false; }
      out.ccds.push(r);
    });
    return out;
  }
  // Along the line (METHOD §14.4): sides with a conductor rail from the SOD items of type third rail (none = both sides).
  function ccdLine(p, sOpt, rows, sc, kes) {
    var tp = p.track.params, set = ccdSetup(p, sOpt), trItems = sc.items.filter(function (it) { return it.type === 'third_rail'; });
    var tr = (p.thirdRail || {}).tr_ke, keFix = tr && kes[tr] ? kes[tr] : null, polys = {}, out = [], ok = true;
    function polyFor(r) { var k = keFix || kes[r.ke] || kes.__default; if (!polys[k.name]) { polys[k.name] = kePoly(k); } return polys[k.name]; }
    rows.forEach(function (r) {
      if (!r.valid) { return; }
      var sides = [];
      if (!trItems.length) { sides = ['L', 'R']; }
      else { trItems.forEach(function (it) { if (r.ch >= it.from - 1e-9 && r.ch <= it.to + 1e-9) { (it.side === 'both' ? ['L', 'R'] : [it.side]).forEach(function (sd) { if (sides.indexOf(sd) < 0) { sides.push(sd); } }); } }); }
      if (!sides.length) { return; }
      var best = null;
      set.list.forEach(function (e) {
        var x = n0(e.c.x_m), dz = r.Rv ? (x * x - e.bb.p * e.bb.p / 4) / (2 * r.Rv) * 1000 : 0;
        sides.forEach(function (sd) {
          var outside = r.k === 0 ? true : ((r.k > 0 && sd === 'R') || (r.k < 0 && sd === 'L'));
          var st = { kAbs: Math.abs(r.k), outside: outside, Dt: outside ? r.def : r.exc, Da: outside ? r.exc : r.def, vc: [Math.min(0, dz), Math.max(0, dz)] };
          var k = ccdCase(p, e.bb, e.c, e.pts, st, set.rl, polyFor(r));
          var m = Math.min(k.contact.reach, k.contact.mOv, k.ke ? k.ke.margin : Infinity, k.clear ? k.clear.margin : Infinity);
          if (!best || m < best.m) { best = { m: m, k: k, ccd: e.c.name, side: sd, outside: outside }; }
        });
      });
      if (!best) { return; }
      var row = { ch: r.ch, el: r.el, R: r.k === 0 ? 0 : 1 / Math.abs(r.k), def: r.def, exc: r.exc, Rv: r.Rv, ccd: best.ccd, side: best.side, pos: r.k === 0 ? 'tangent' : (best.outside ? 'outside' : 'inside'),
        ke: best.k.ke ? best.k.ke.margin : null, reach: best.k.contact.reach, overlap: best.k.contact.mOv, clear: best.k.clear ? best.k.clear.margin : null, m: best.m, ok: best.k.ok };
      if (!row.ok) { ok = false; }
      out.push(row);
    });
    function low(key) { var w = null; out.forEach(function (r) { if (r[key] !== null && (!w || r[key] < w.v)) { w = { v: r[key], ch: r.ch, ccd: r.ccd, side: r.side }; } }); return w; }
    return { rows: out, ok: ok, n: out.length, ke: low('ke'), reach: low('reach'), overlap: low('overlap'), clear: low('clear'), check_n: out.filter(function (r) { return !r.ok; }).length };
  }

  // ================================================================ EN DYNAMIC METHOD (METHOD §15, EN 15273-2 §5.2 / Annex O)
  // Displacements at one datum (O.11–O.18), mm and rad: mean + k·σ; downwards adds f_max (O.10).
  function simDisp(t, kS, fmax) {
    return { dpl: t.y_mean + kS * t.y_sd, hd: t.z_mean + kS * t.z_sd + fmax, hu: t.z_mean + kS * t.z_sd, th: (t.th_mean + kS * t.th_sd) / 1000 };
  }
  // Cases of one car and condition: analysed cant-excess cases and the deficiency cases derived from them (O.4–O.9);
  // centre datum from the outer datums (O.1–O.3) when it is not given.
  function simCases(rows) {
    var by = {}, out = [];
    rows.forEach(function (r) { var k = r.v_kmh + '|' + r.cant_mm; (by[k] = by[k] || { v: n0(r.v_kmh), c: n0(r.cant_mm), d: {} }).d[r.datum] = r; });
    var keys = ['y_mean', 'y_sd', 'z_mean', 'z_sd', 'th_mean', 'th_sd'];
    function num(r) { var o = {}; keys.forEach(function (k) { o[k] = n0(r[k]); }); return o; }
    Object.keys(by).forEach(function (k) {
      var g = by[k], d = {};
      ['lead', 'centre', 'trail'].forEach(function (dn) { if (g.d[dn]) { d[dn] = num(g.d[dn]); } });
      if (!d.centre && d.lead && d.trail) { d.centre = {}; keys.forEach(function (x) { d.centre[x] = (d.lead[x] + d.trail[x]) / 2; }); d.centreDerived = true; }
      if (!d.lead && d.centre) { d.lead = d.centre; } if (!d.trail && d.centre) { d.trail = d.centre; }
      if (!d.centre) { return; }
      out.push({ v: g.v, c: g.c, kind: 'exc', d: d });
    });
    var exc = out.slice();
    exc.forEach(function (e) {                                   // O.4–O.9
      var z0 = exc.filter(function (x) { return x.v === e.v && x.c === 0; })[0], d = {};
      ['lead', 'centre', 'trail'].forEach(function (dn) {
        var t = e.d[dn], o = {}; keys.forEach(function (x) { o[x] = t[x]; });
        o.z_mean = z0 ? 2 * z0.d[dn].z_mean - t.z_mean : t.z_mean;
        if (o.z_mean < 0) { o.z_mean = Math.abs(o.z_mean); }
        d[dn] = o;
      });
      out.push({ v: e.v, c: e.c, kind: 'def', d: d, noZ0: !z0 });
    });
    return out;
  }
  // Whole reference outline (right half mirrored), mm, for points on both sides of the centre line.
  function keFullPoly(ke) {
    var r = ke.pts.map(function (q) { return { x: q.x * 1000, y: q.h * 1000 }; }), l = r.slice().reverse().map(function (q) { return { x: -q.x, y: q.y }; });
    return r.concat(l);
  }
  // Car context: datum positions, f_max, sections, curving table per condition.
  function simContext(p, d, sOpt) {
    var sim = p.sim || {}, c = d.carRec, g = d.geo, row = (sim.cars || []).filter(function (r) { return r.car === c.name; })[0] || {};
    var st = sim.settings || {}, kS = blankOr(st.k_sigma, 3 / Math.SQRT2);
    var xd = blankOr(row.xd_m, g.a / 2), hd = blankOr(row.hd_mm, 1000) / 1000, fmax = n0(row.fz_mm) + n0(row.fcr_mm) + n0(row.fw_mm) + n0(row.ftol_mm);
    var conds = {};
    (sim.transient || []).filter(function (r) { return r.car === c.name; }).forEach(function (r) { (conds[r.cond || 'tare'] = conds[r.cond || 'tare'] || { tr: [], cv: [] }).tr.push(r); });
    (sim.curving || []).filter(function (r) { return r.car === c.name; }).forEach(function (r) { if (conds[r.cond || 'tare']) { conds[r.cond || 'tare'].cv.push(r); } });
    var list = Object.keys(conds).map(function (k) {
      var cv = conds[k].cv.slice().sort(function (u, v) { return n0(u.R_m) - n0(v.R_m); });
      return { cond: k, cases: simCases(conds[k].tr), curving: cv };
    }).filter(function (x) { return x.cases.length; });
    var profs;
    if (studyOf(p) === 'backward') { var kp = findBy(p.ke.profiles, 'name', sOpt.ke) || p.ke.profiles[0], ko = outline(kp.points, kp.n_up); profs = carProfiles(p, d, c, [], ko, sOpt).profs; }
    else { profs = { int: profileFor(p, c.prof_int), ext: profileFor(p, c.prof_ext), end: profileFor(p, c.prof_end) }; }
    var secs = [{ key: 'int', x: Math.max(0, g.a / 2 - g.ni), prof: profs.int }, { key: 'ext', x: g.a / 2 + g.na, prof: profs.ext }, { key: 'end', x: g.a / 2 + g.n_end, prof: profs.end }];
    return { car: c.name, a: g.a, p: d.bogie.p, xd: xd, hd: hd, fmax: fmax, kS: kS, conds: list, secs: secs };
  }
  // Value at body position x (m) from the three datums (lead at +xd, centre 0, trail at −xd), linear, extrapolated.
  function simAlong(vl, vc, vt, x, xd) { var t = xd > 0 ? Math.abs(x) / xd : 0; return vc + ((x >= 0 ? vl : vt) - vc) * t; }
  // Quasi-static curving displacement (O.3.9, mm) towards the outside / inside at x, linear in 1/R between the radii
  // analysed, 0 on straight track; below the smallest radius the value there is used and flagged.
  function simCurve(cv, R, x, xd) {
    if (!cv.length || !(R > 0)) { return { o: 0, i: 0, below: false }; }
    var k = 1 / R, pts = cv.map(function (r) { return { k: 1 / n0(r.R_m), r: r }; }).sort(function (u, v) { return u.k - v.k; });
    function val(r, key) { return simAlong(n0(r[key + '_lead']), (n0(r[key + '_lead']) + n0(r[key + '_trail'])) / 2, n0(r[key + '_trail']), x, xd); }
    function at(key) {
      if (k >= pts[pts.length - 1].k) { return val(pts[pts.length - 1].r, key); }
      var lo = { k: 0, v: 0 }, i;
      for (i = 0; i < pts.length; i++) {
        var hi = { k: pts[i].k, v: val(pts[i].r, key) };
        if (k <= hi.k) { return lo.v + (hi.v - lo.v) * (k - lo.k) / (hi.k - lo.k); }
        lo = hi;
      }
      return lo.v;
    }
    return { o: at('yo'), i: at('yi'), below: k > pts[pts.length - 1].k + 1e-12 };
  }
  // Swept points of one section (curve frame, m): right = outside with case co, left = inside with case ci.
  // kg: governing curvature (1/m) for the geometric overthrow; both vertical extremes (drop, rise) are returned.
  function simSection(ctx, sec, x, co, ci, kg, cv) {
    var pts = [], R = kg > 0 ? 1 / kg : 0, off = kg * (x * x - ctx.a * ctx.a / 4 - ctx.p * ctx.p / 4) / 2;   // outward offset of the body centreline
    var cu = simCurve(cv, R, x, ctx.xd);
    function disp(cs) {
      var dl = cs.d.lead, dc = cs.d.centre, dt = cs.d.trail, L = simDisp(dl, ctx.kS, ctx.fmax), C = simDisp(dc, ctx.kS, ctx.fmax), T = simDisp(dt, ctx.kS, ctx.fmax);
      return { dpl: simAlong(L.dpl, C.dpl, T.dpl, x, ctx.xd) / 1000, hd: simAlong(L.hd, C.hd, T.hd, x, ctx.xd) / 1000, hu: simAlong(L.hu, C.hu, T.hu, x, ctx.xd) / 1000, th: simAlong(L.th, C.th, T.th, x, ctx.xd) };
    }
    var Do = co ? disp(co) : null, Di = ci ? disp(ci) : null;
    sec.prof.pts.forEach(function (q) {
      if (Do) {
        var yo = q.x + Do.dpl + cu.o / 1000 + off + (q.h - ctx.hd) * Do.th, zo = q.h - q.x * Do.th;
        pts.push({ pt: q.pt, side: 'outside', x: yo, y: zo - Do.hd, sec: sec.key }, { pt: q.pt, side: 'outside', x: yo, y: zo + Do.hu, sec: sec.key });
      }
      if (Di) {
        var yi = q.x + Di.dpl + cu.i / 1000 - off + (q.h - ctx.hd) * Di.th, zi = q.h - q.x * Di.th;
        pts.push({ pt: q.pt, side: 'inside', x: -yi, y: zi - Di.hd, sec: sec.key }, { pt: q.pt, side: 'inside', x: -yi, y: zi + Di.hu, sec: sec.key });
      }
    });
    return { pts: pts, below: cu.below };
  }
  // Tangent check (METHOD §15.3): every case, every section at ±x, outward lean, against the reference profile.
  function simTangent(p, sOpt) {
    var tr = (p.sim || {}).settings || {}, refP = (tr.ref && findBy(p.ke.profiles, 'name', tr.ref)) || findBy(p.ke.profiles, 'name', sOpt.ke) || p.ke.profiles[0];
    if (!refP) { return null; }
    var ref = outline(refP.points, refP.n_up), poly = keFullPoly(ref), out = { ref: refP.name, cars: [], ok: true };
    p.train.carTypes.forEach(function (c) {
      var d = deriveCar(p, c, sOpt), ctx = simContext(p, d, sOpt); if (!ctx.conds.length) { return; }
      var res = { car: c.name, xd: ctx.xd, hd: ctx.hd * 1000, fmax: ctx.fmax, kS: ctx.kS, conds: [], worst: null, n: 0 };
      ctx.conds.forEach(function (cd) {
        cd.cases.forEach(function (cs) {
          ctx.secs.forEach(function (sec) {
            [sec.x, -sec.x].forEach(function (x) {
              simSection(ctx, sec, x, cs, null, 0, []).pts.forEach(function (q) {
                var mg = polySigned(q.x * 1000, q.y * 1000, poly);
                res.n++;
                if (!res.worst || mg < res.worst.margin) { res.worst = { margin: mg, cond: cd.cond, v: cs.v, c: cs.c, kind: cs.kind, sec: sec.key, x: x, pt: q.pt, y: q.x * 1000, z: q.y * 1000 }; }
              });
            });
          });
        });
        res.conds.push({ cond: cd.cond, n: cd.cases.length, derivedNoZ0: cd.cases.some(function (x) { return x.noZ0; }), curving: cd.curving.length,
          disp: cd.cases.map(function (cs) { var C = simDisp(cs.d.centre, ctx.kS, ctx.fmax), L = simDisp(cs.d.lead, ctx.kS, ctx.fmax); return { v: cs.v, c: cs.c, kind: cs.kind, dplC: C.dpl, dplL: L.dpl, hdC: C.hd, huC: C.hu, thC: C.th * 1000, thL: L.th * 1000 }; }) });
      });
      res.ok = !res.worst || res.worst.margin >= 0; if (!res.ok) { out.ok = false; }
      out.cars.push(res);
    });
    return out.cars.length ? out : null;
  }
  // Case for a line point: the smallest analysed speed ≥ V and cant ≥ the actual one (else the largest; flagged).
  function simPick(cases, kind, V, c) {
    var list = cases.filter(function (x) { return x.kind === kind; }), vs = [], cs = [];
    list.forEach(function (x) { if (vs.indexOf(x.v) < 0) { vs.push(x.v); } if (cs.indexOf(x.c) < 0) { cs.push(x.c); } });
    vs.sort(function (a, b) { return a - b; }); cs.sort(function (a, b) { return a - b; });
    if (!vs.length) { return null; }
    var v = vs.filter(function (x) { return x >= V - 1e-9; })[0], cc = cs.filter(function (x) { return x >= c - 1e-9; })[0], beyond = false;
    if (v === undefined) { v = vs[vs.length - 1]; beyond = true; } if (cc === undefined) { cc = cs[cs.length - 1]; beyond = true; }
    var hit = list.filter(function (x) { return x.v === v && x.c === cc; })[0];
    if (!hit) { hit = list.filter(function (x) { return x.v >= v && x.c >= cc; }).sort(function (a, b) { return (a.v - b.v) || (a.c - b.c); })[0] || list[list.length - 1]; beyond = true; }
    return { cs: hit, beyond: beyond };
  }
  // Along the line (METHOD §15.4): adds simc / sims / simn / simf to each sweep row of car d.
  function simLine(p, d, rows, sOpt, sc, k) {
    var st = (p.sim || {}).settings || {};
    if (st.line === 'no') { return null; }
    var ctx = simContext(p, d, sOpt); if (!ctx.conds.length) { return null; }
    var n = 0;
    rows.forEach(function (r) {
      r.simc = null; r.sims = ''; r.simn = ''; r.simf = false;
      var half = r.sodn ? sc.sods[r.sodn] : null; if (!half || !r.valid) { return; }
      var phi = Math.asin(Math.max(-1, Math.min(1, r.cant / k.G))), cs = Math.cos(phi), sn = Math.sin(phi), poly = sodPolygon(half, r.To / 1000, r.Ti / 1000), best = null;
      ctx.conds.forEach(function (cd) {
        var po = simPick(cd.cases, 'def', r.V, r.def), pi = simPick(cd.cases, 'exc', 0, r.exc);
        ctx.secs.forEach(function (sec) {
          [sec.x, -sec.x].forEach(function (x) {
            var sw = simSection(ctx, sec, x, po ? po.cs : null, pi ? pi.cs : null, r.kg, cd.curving);
            sw.pts.forEach(function (q) {
              var o = sc.vertical ? { x: q.x * cs - q.y * sn, y: q.x * sn + q.y * cs } : { x: q.x, y: q.y };
              var mg = polySigned(o.x, o.y, poly) * 1000;
              if (!best || mg < best.m) { best = { m: mg, q: q, cond: cd.cond, po: po, pi: pi, below: sw.below }; }
            });
          });
        });
      });
      if (!best) { return; }
      n++;
      var cs0 = best.q.side === 'outside' ? best.po : best.pi;
      r.simc = best.m; r.simf = !!(cs0 && cs0.beyond) || best.below;
      r.simn = best.cond + ', ' + best.q.pt + ' ' + best.q.sec + ' (' + best.q.side + ')' + (cs0 ? ', case ' + cs0.cs.v + ' km/h ' + (cs0.cs.kind === 'def' ? 'D ' : 'I ') + cs0.cs.c + ' mm' : '');
      r.sims = best.m >= sc.margin ? 'OK' : 'CHECK';
      if (r.sims === 'CHECK') { r.ok = 'CHECK'; }
    });
    return { n: n };
  }
  // Model validation (METHOD §15.5, Annex O.2, Tables O.1–O.3), per car type and condition.
  var VAL_LIM = { wheel: [15, 7], wheelset: [6, 3], side: [3, 3], X: [15, 7], roll1: [4, 2], roll2: [4, 2], sway: [10, 15], drop: [10, 10] };
  function simValidation(p) {
    var sim = p.sim || {}, keys = {}, out = [];
    function key(r) { return r.car + '|' + (r.cond || 'tare'); }
    ['weigh', 'rot', 'sway', 'ride'].forEach(function (t) { (sim[t] || []).forEach(function (r) { keys[key(r)] = { car: r.car, cond: r.cond || 'tare' }; }); });
    function pct(m, s) { return m === 0 ? null : Math.abs(s - m) / Math.abs(m) * 100; }
    function stat(errs, lim) { var e = errs.filter(function (x) { return x !== null; }); if (!e.length) { return null; } var mx = Math.max.apply(null, e), av = e.reduce(function (a, b) { return a + b; }, 0) / e.length; return { max: mx, avg: av, lmax: lim[0], lavg: lim[1], n: e.length, ok: mx <= lim[0] + 1e-9 && av <= lim[1] + 1e-9 }; }
    Object.keys(keys).forEach(function (kk) {
      var id = keys[kk], res = { car: id.car, cond: id.cond };
      var w = (sim.weigh || []).filter(function (r) { return key(r) === kk; });
      if (w.length) {
        var ax = {}, sd = {};
        w.forEach(function (r) { var a = ax[r.axle] = ax[r.axle] || { m: 0, s: 0 }, b = sd[r.side] = sd[r.side] || { m: 0, s: 0 }; a.m += n0(r.meas_kN); a.s += n0(r.sim_kN); b.m += n0(r.meas_kN); b.s += n0(r.sim_kN); });
        res.weigh = { wheel: stat(w.map(function (r) { return pct(n0(r.meas_kN), n0(r.sim_kN)); }), VAL_LIM.wheel),
          wheelset: stat(Object.keys(ax).map(function (a) { return pct(ax[a].m, ax[a].s); }), VAL_LIM.wheelset),
          side: stat(Object.keys(sd).map(function (a) { return pct(sd[a].m, sd[a].s); }), VAL_LIM.side) };
        res.weigh.ok = res.weigh.wheel.ok && res.weigh.wheelset.ok && res.weigh.side.ok;
      }
      var ro = (sim.rot || []).filter(function (r) { return key(r) === kk; });
      if (ro.length) { res.rot = stat(ro.map(function (r) { return pct(n0(r.meas_X), n0(r.sim_X)); }), VAL_LIM.X); }
      var sw = (sim.sway || []).filter(function (r) { return key(r) === kk; });
      if (sw.length) {
        res.sway = {}; var allOk = true;
        ['roll1', 'roll2', 'sway', 'drop'].forEach(function (q) {
          var rs = sw.filter(function (r) { return r.qty === q; }); if (!rs.length) { return; }
          var mx = Math.max.apply(null, rs.map(function (r) { return Math.abs(n0(r.sim) - n0(r.meas)); })), lp = rs.filter(function (r) { return r.loop_err !== null && r.loop_err !== undefined && r.loop_err !== ''; });
          var av = lp.length ? lp.reduce(function (a, r) { return a + n0(r.loop_err); }, 0) / lp.length : null, lim = VAL_LIM[q];
          var o = { max: mx, loop: av, lmax: lim[0], lavg: lim[1], n: rs.length, ok: mx <= lim[0] + 1e-9 && av !== null && av <= lim[1] + 1e-9 };
          if (!o.ok) { allOk = false; }
          res.sway[q] = o;
        });
        res.sway.ok = allOk && Object.keys(res.sway).length > 0;
      }
      var rd = (sim.ride || []).filter(function (r) { return key(r) === kk; })[0];
      res.ride = rd ? yes(rd.ride_ok) : false; res.nobo = rd ? yes(rd.nobo) : false;
      var stc = !!(res.weigh && res.weigh.ok && res.sway && res.sway.ok), full = stc && !!(res.rot && res.rot.ok) && res.ride;
      res.status = full ? 'Fully validated' : (stc ? (res.nobo ? 'Partially validated (notified body)' : 'Statically validated – quasi-static use only') : 'Not validated – further work');
      res.level = full ? 3 : (stc ? (res.nobo ? 2 : 1) : 0);
      out.push(res);
    });
    return out;
  }
  function simRun(p, sOpt) {
    var sim = p.sim || {};
    if (!((sim.transient || []).length || (sim.weigh || []).length || (sim.sway || []).length || (sim.rot || []).length)) { return null; }
    return { engineVersion: VERSION, tangent: simTangent(p, sOpt || {}), validation: simValidation(p) };
  }

  // ================================================================ BOStrab §34 (METHOD §16.3)
  // Public limits of BOStrab §34(3) (street-running vehicles: width up to / above the split height, height to the top of
  // the lowered pantograph) and §34(2) (extra curve throw on street track at the minimum radius). mm.
  function bostrabCheck(p, d, profs, opt) {
    var t = p.train, street = yes(t.bostrab_street), g = d.geo, P = d.bogie.p, R = n0(p.track.params.R_min_m);
    var split = n0(opt.bst_h_split_mm, 3400) / 1000, out = { street: street, rows: [], ok: true };
    function row(id, label, v, lim, unit, applies, note) {
      var r = { id: id, label: label, value: v, limit: lim, margin: lim - v, unit: unit, applies: applies, note: note || '' };
      r.ok = !applies || r.margin >= 0; if (!r.ok) { out.ok = false; } out.rows.push(r); return r;
    }
    var wLo = 0, wHi = 0, top = 0, wLoAt = '', wHiAt = '';
    ['int', 'ext', 'end'].forEach(function (k) {
      var pr = profs[k]; if (!pr) { return; }
      top = Math.max(top, pr.top);
      pr.pts.forEach(function (q) { if (q.h <= split + 1e-9) { if (q.x > wLo) { wLo = q.x; wLoAt = pr.name + ' ' + q.pt; } } else if (q.x > wHi) { wHi = q.x; wHiAt = pr.name + ' ' + q.pt; } });
      var ws = profileWidth(pr, split); if (ws > wLo) { wLo = ws; wLoAt = pr.name + ' at the split height'; }
      var wa = profileWidth(pr, split + 1e-6); if (wa > wHi) { wHi = wa; wHiAt = pr.name + ' just above the split height'; }
    });
    var pantos = (p.pantographs || []).filter(function (x) { return x.car === d.car && x.h_low_mm !== null && x.h_low_mm !== undefined && x.h_low_mm !== ''; });
    var hTop = top * 1000, hNote = 'RS profile top';
    pantos.forEach(function (x) { if (n0(x.h_low_mm) > hTop) { hTop = n0(x.h_low_mm); hNote = 'lowered pantograph ' + x.name; } });
    var na = street ? '' : 'not applicable: §34(3) applies to street-running vehicles';
    row('w_low', 'Width up to ' + fmtM(split) + ' m above rail (' + wLoAt + ')', 2 * wLo * 1000, n0(opt.bst_w_low_mm, 2650), 'mm', street, na);
    row('w_high', 'Width above ' + fmtM(split) + ' m (' + (wHiAt || 'none') + ')', 2 * wHi * 1000, n0(opt.bst_w_high_mm, 2250), 'mm', street && wHi > 0, na);
    row('h', 'Height to the top of the lowered pantograph (' + hNote + ')', hTop, n0(opt.bst_h_max_mm, 4000), 'mm', street, na);
    if (R > 0) {
      var nE = g.n_end, ti = (g.a * g.a + P * P) / (8 * R) * 1000, ta = (g.a * nE + nE * nE - P * P / 4) / (2 * R) * 1000;
      var n2 = street ? '' : 'not applicable: §34(2) applies on street track';
      row('ov_in', 'Extra curve throw inside, mid-car, at R ' + R + ' m', ti, n0(opt.bst_ov_mm, 650), 'mm', street, n2);
      row('ov_out', 'Extra curve throw outside, car end, at R ' + R + ' m', ta, n0(opt.bst_ov_mm, 650), 'mm', street, n2);
    }
    return out;
  }
  function fmtM(v) { return (Math.round(v * 100) / 100).toString().replace('.', ','); }

  // ================================================================ TEST CALCULATIONS (METHOD §13)
  // Least-squares fit of y = a·(D·h) + b·D over readings [{D, h, y}] (mm): s = a·L, hc = −b/a.
  function swayFit(pts, L) {
    var suu = 0, suv = 0, svv = 0, suy = 0, svy = 0, hs = {};
    pts.forEach(function (q) { var u = q.D * q.h, v = q.D; suu += u * u; suv += u * v; svv += v * v; suy += u * q.y; svy += v * q.y; hs[Math.round(q.h)] = 1; });
    var det = suu * svv - suv * suv;
    if (Object.keys(hs).length < 2 || !(Math.abs(det) > 1e-9 * Math.max(1, suu * svv)) ) { return null; }
    var a = (suy * svv - svy * suv) / det, b = (suu * svy - suv * suy) / det;
    if (a === 0) { return null; }
    var ss = 0;
    pts.forEach(function (q) { var e = q.y - (a * q.D * q.h + b * q.D); ss += e * e; });
    return { s: a * L, hc: -b / a, rms: Math.sqrt(ss / pts.length), n: pts.length };
  }
  // Values of s, hc used in gauging for a load state (source as the static options, §5.4), hc in mm.
  function usedSway(d, load, opt) {
    var th = d.theoretical, b = d.body || {}, theo = opt.flex === 'theoretical';
    if (load === 'crush') { return theo ? { s: th.crush.s, hc: th.crush.hc * 1000 } : { s: n0(b.s_crush), hc: n0(b.hc_crush_mm) }; }
    if (load === 'deflated') { return theo ? { s: th.defl.s, hc: th.defl.hc * 1000 } : { s: n0(b.s_defl), hc: n0(b.hc_defl_mm) }; }
    return theo ? { s: th.tare.s, hc: th.tare.hc * 1000 } : { s: n0(b.s_tare), hc: n0(b.hc_tare_mm) };
  }
  /*
   * Sway-test evaluation (§13.1): one result per car type and load state with readings.
   */
  function swayEval(p, sOpt) {
    sOpt = sOpt || {};
    var L = n0(p.train.L_mm, 1500), lim = p.ke.limits || {}, rows = ((p.tests || {}).sway) || [], groups = {}, order = [];
    rows.forEach(function (r, i) {
      if (!r.car || !(n0(r.D_mm) > 0)) { return; }
      var key = r.car + '|' + (r.load || 'tare');
      if (!groups[key]) { groups[key] = { car: r.car, load: r.load || 'tare', pts: [], rows: [] }; order.push(key); }
      var g = groups[key];
      g.rows.push(i + 1);
      [1, 2, 3].forEach(function (j) {
        var h = r['h' + j + '_mm'], y = r['y' + j + '_mm'];
        if (h !== null && h !== undefined && y !== null && y !== undefined) { g.pts.push({ D: n0(r.D_mm), h: n0(h), y: n0(y), side: r.low || 'L', row: i + 1 }); }
      });
    });
    return order.map(function (key) {
      var g = groups[key], c = findBy(p.train.carTypes, 'name', g.car), out = { car: g.car, load: g.load, rows: g.rows, n: g.pts.length, ok: false };
      if (!c) { out.error = 'Unknown car type ' + g.car; return out; }
      var fit = swayFit(g.pts, L);
      if (!fit) { out.error = 'At least two different heights are needed'; return out; }
      var d = deriveCar(p, c, sOpt), used = usedSway(d, g.load, sOpt);
      var top = 0;
      ['prof_int', 'prof_ext', 'prof_end'].forEach(function (k) {
        var pr = findBy(p.rs.profiles, 'name', c[k]);
        if (pr) { pr.points.forEach(function (q) { if (q.z !== null && q.z > top) { top = q.z; } }); }
      });
      var hs = [{ id: 'h1', h: n0(lim.h_ref1_mm) }, { id: 'h2', h: n0(lim.h_ref2_mm) }, { id: 'top', h: top }];
      var checks = hs.map(function (x) {
        var mm = 100 * fit.s * (x.h - fit.hc) / L, mu = 100 * used.s * (x.h - used.hc) / L;
        return { id: x.id, h: x.h, measured: mm, used: mu, margin: mu - mm, ok: mm <= mu + 1e-9 };
      });
      var sides = {};
      ['L', 'R'].forEach(function (sd) { var f = swayFit(g.pts.filter(function (q) { return q.side === sd; }), L); if (f) { sides[sd] = f; } });
      out.s = fit.s; out.hc = fit.hc; out.rms = fit.rms; out.used = used; out.checks = checks; out.sides = sides;
      out.maxD = Math.max.apply(null, g.pts.map(function (q) { return q.D; }));
      out.theoretical = { s: (g.load === 'crush' ? d.theoretical.crush : (g.load === 'deflated' ? d.theoretical.defl : d.theoretical.tare)).s,
        hc: (g.load === 'crush' ? d.theoretical.crush : (g.load === 'deflated' ? d.theoretical.defl : d.theoretical.tare)).hc * 1000 };
      out.points = g.pts.map(function (q) { var e = fit.s * q.D / L * (q.h - fit.hc); return { D: q.D, h: q.h, y: q.y, side: q.side, row: q.row, fit: e, res: q.y - e, y100: q.y * 100 / q.D }; });
      var hmax = Math.max(top, n0(lim.h_ref2_mm)); g.pts.forEach(function (q) { hmax = Math.max(hmax, q.h); });
      out.curve = [];
      for (var hh = 0; hh <= hmax + 1e-9; hh += Math.max(50, Math.ceil(hmax / 40 / 50) * 50)) { out.curve.push({ h: hh, measured: 100 * fit.s * (hh - fit.hc) / L, used: 100 * used.s * (hh - used.hc) / L }); }
      out.ok = checks.every(function (x) { return x.ok; });
      return out;
    });
  }
  /*
   * Kinematic gauge test plan (§13.2) from a static run: per car type and case the shims, the lateral displacements to
   * impose, and per profile point the expected test position and the test template (KE minus the terms not reproduced).
   */
  function gaugeTestPlan(p, sres, sway) {
    var L = n0(p.train.L_mm, 1500);
    return sres.cars.map(function (c) {
      // tare and crush cases only (METHOD §13.2); load = role, matching the sway-test load states
      var cases = c.cases.filter(function (k) { return k.role !== 'other'; }).map(function (k) {
        var role = k.role || k.load, cp = k.params, Dt = cp.cant + cp.wind, Rlat = cp.play + cp.q + cp.w, hcm = cp.hc * 1000;
        var sw = (sway || []).filter(function (x) { return x.car === c.car && x.load === role && !x.error; })[0] || null;
        var min = null, minM = null;
        var pts = k.points.map(function (q) {
          var roll = cp.thq * (q.h0 - hcm), xt = q.x0 + Rlat + roll, ht = q.h0 - cp.thq * q.x0 - cp.drop;
          var N = q.E - Rlat - roll, V = cp.up - (cp.thr + cp.tht) * q.x0;
          var Wt = q.W - N, Ht = q.H - V, dX = Wt - xt, dH = Ht - ht, cl = clearance(dX, dH);
          var r = { pt: q.pt, x0: q.x0, h0: q.h0, xt: xt, ht: ht, N: N, V: V, Wt: Wt, Ht: Ht, dX: dX, dH: dH, c: cl, ok: cl >= 0 };
          if (sw) {
            var th = sw.s * Dt / L;
            r.xm = q.x0 + Rlat + th * (q.h0 - sw.hc); r.hm = q.h0 - th * q.x0 - cp.drop;
            r.cm = clearance(Wt - r.xm, Ht - r.hm);
            if (minM === null || r.cm < minM.cm) { minM = r; }
          }
          if (!min || cl < min.c) { min = r; }
          return r;
        });
        return { id: k.id, label: k.label, section: k.section, load: role, loadName: k.load, profile: k.profile, D: Dt, cant: cp.cant, wind: cp.wind, A: cp.A,
          play: cp.play, q: cp.q, w: cp.w, Rlat: Rlat, thq: cp.thq, s: cp.s, hc: cp.hc, drop: cp.drop,
          sway: sw ? { s: sw.s, hc: sw.hc, maxD: sw.maxD } : null, beyondSway: !!(sw && Dt > sw.maxD + 1e-9), points: pts, min: min, minMeasured: minM };
      });
      return { car: c.car, cases: cases };
    });
  }

  // Wheel–rail play calculator (information, Bogie Inputs §5): l = nominal gauge + gauge tolerance, d = BB + 2·ef.
  function playCalc(p, b) {
    var l = n0(p.train.gauge_mm) + n0(p.track.params.g_tol_mm), dNew = n0(b.bb_mm) + 2 * n0(b.ef_new_mm), dWorn = n0(b.bb_mm) + 2 * n0(b.ef_worn_mm);
    return { l: l, d_new: dNew, d_worn: dWorn, half_new: (l - dNew) / 2, half_worn: (l - dWorn) / 2 };
  }

  // ================================================================ DYNAMIC (METHOD §8)
  // Track model: elements sorted by start chainage with signed curvature (+ left) and cant at start and end.
  function trackModel(p) {
    var el = p.track.segments.filter(function (s) { return s.from_m !== null && s.to_m !== null && s.to_m > s.from_m; })
      .slice().sort(function (a, b) { return a.from_m - b.from_m; })
      .map(function (s, i) {
        var sg = s.side === 'R' ? -1 : 1;
        return { no: i + 1, s0: s.from_m, s1: s.to_m, type: s.element, side: s.side,
          ks: n0(s.R_start_m) > 0 ? sg / n0(s.R_start_m) : 0, ke: n0(s.R_end_m) > 0 ? sg / n0(s.R_end_m) : 0,
          cs: n0(s.cant_start_mm), ce: n0(s.cant_end_mm), V: n0(s.speed_kmh), Rv: n0(s.Rv_m), keName: s.ke, loc: s.location,
          wind: s.wind, str: n0(s.struct_mm), pe: n0(s.platform_mm), ps: s.platform_side, sodName: s.sod || '', remarks: s.remarks, seg: s };
      });
    var start = el.length ? el[0].s0 : 0, end = -Infinity;
    el.forEach(function (e) { end = Math.max(end, e.s1); });
    return { el: el, start: start, end: el.length ? end : 0 };
  }
  // Last element whose start is at or before the chainage (Excel MATCH(…, 1)).
  function locate(tm, ch) {
    var lo = 0, hi = tm.el.length - 1, i = 0;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (tm.el[mid].s0 <= ch) { i = mid; lo = mid + 1; } else { hi = mid - 1; } }
    return i;
  }
  // Sweep chainages: ch0 + i·step while ≤ end, then the end itself (evaluated, flagged not valid, as the workbook's repeated end rows).
  function sweepChainages(tm, opt, step) {
    var ch0 = (opt.ch_from_m === null || opt.ch_from_m === undefined || opt.ch_from_m === '') ? tm.start : Math.max(tm.start, n0(opt.ch_from_m));
    var end = (opt.ch_to_m === null || opt.ch_to_m === undefined || opt.ch_to_m === '') ? tm.end : Math.min(tm.end, n0(opt.ch_to_m));
    var out = [], i, ch;
    step = Math.max(0.1, step);
    for (i = 0; i < 100000; i++) {
      ch = ch0 + i * step;
      if (ch > end + 1e-9) { out.push({ ch: end, valid: false }); break; }
      out.push({ ch: ch, valid: true });
    }
    return { ch0: ch0, end: end, step: step, pts: out };
  }

  // Load case of the dynamic calculation: a load-case name, or the words tare / crush (role); default the tare case.
  function dynLoad(d, want) {
    var x = d.loads.filter(function (L) { return L.name === want; })[0] || d.loads.filter(function (L) { return L.role === (want === 'crush' ? 'crush' : 'tare'); })[0];
    return x || d.loads[0];
  }
  // Constants of one car type for the dynamic calculation (Dynamic Calc §1).
  function dynConstants(p, d, sOpt, dOpt, mcgProf) {
    var tp = p.track.params, G = n0(p.train.L_mm, 1500), L = p.ke.limits || {}, g = d.geo, bg = d.bogie;
    var ld = dynLoad(d, dOpt.load);
    var s = ld.s, hc = ld.hc, Cw = ld.Cw;
    var dT_in = bg.play + bg.q + d.w_use + n0(tp.fw_mm), dT_out = g.A_end * dT_in;
    // at radius R (m, 0 = straight): w_i(R) between the pivots, w_i·nE/a + w_a·(nE + a)/a at the car end (§8.3)
    function dTat(R) {
      if (!d.w_var || !(R > 0)) { return { in: dT_in, out: dT_out, wi: d.w_use, wa: d.w_use }; }
      var wi = d.wi(R), wa = d.wa(R), base = bg.play + bg.q + n0(tp.fw_mm);
      return { in: base + wi, out: g.A_end * base + wi * g.n_end / g.a + wa * (g.n_end + g.a) / g.a, wi: wi, wa: wa };
    }
    var thr = s * n0(tp.cl_err_mm) / G, tht = (yes(sOpt.tilt) ? 1 : 0) * n0(tp.cl_err_mm) / G;
    var gt = n0(tp.g_tol_mm), al = n0(tp.align_tol_mm) * (yes(sOpt.align) ? 1 : 0), K = n0(sOpt.K_rss, 1), lin = sOpt.comb !== 'rss';
    var gtOut = gt * g.A_end * (yes(sOpt.gtol_ext) ? 1 : 0);
    function rnd(gtol, h) {   // h in m
      var a = thr * (h - hc) * 1000, b = tht * h * 1000;
      return lin ? gtol + al + a + b : K * Math.sqrt(gtol * gtol + al * al + a * a + b * b);
    }
    var prof = null, c = d.carRec;
    if (mcgProf) { prof = mcgProf; }   // backward study: the whole-car maximum construction gauge (METHOD §7.3)
    else {
      var pname = dOpt.profile ? dOpt.profile : c.prof_end;
      var pr = findBy(p.rs.profiles, 'name', pname) || p.rs.profiles[0];
      prof = outline(pr.points, null); prof.name = pr.name;
    }
    var h1 = n0(L.h_ref1_mm) / 1000, h2 = n0(L.h_ref2_mm) / 1000, hf = n0(c.floor_mm) / 1000;
    return {
      s: s, hc: hc, Cw: Cw, dT_in: dT_in, dT_out: dT_out, dTat: dTat, thr: thr, tht: tht, h1: h1, h2: h2, hf: hf, G: G,
      rnd_in1: rnd(gt, h1), rnd_in2: rnd(gt, h2), rout1: rnd(gtOut, h1), rout2: rnd(gtOut, h2), rfl: rnd(gt, hf), rnd: rnd, gtOut: gtOut, gt: gt,
      win_m: g.a / 2 + g.n_end + bg.p / 2, profile: prof, pw1: profileWidth(prof, h1) * 1000, pw2: profileWidth(prof, h2) * 1000,
      sod_C: blankOr(L.sod_C_m, g.a), sod_L: blankOr(L.sod_L_m, g.Lb), sod_b: blankOr(L.sod_b_m, bg.p),
      nosing: n0(L.nosing_mm), sill_hw: n0(c.sill_hw_mm)
    };
  }
  function blankOr(v, d) { return (v === null || v === undefined || v === '') ? d : Number(v); }

  // One sweep row (Dynamic Calc §3 columns) for car d at chainage point.
  function sweepRow(p, d, k, tm, kes, sOpt, ch, kg) {
    var tp = p.track.params, L = p.ke.limits || {}, g = d.geo, bg = d.bogie, G = k.G, body = d.body || {};
    var ei = locate(tm, ch), e = tm.el[ei];
    var t = Math.max(0, Math.min(1, (ch - e.s0) / (e.s1 - e.s0)));
    var kk = e.ks + (e.ke - e.ks) * t, ka = Math.abs(kk), cant = e.cs + (e.ce - e.cs) * t;
    var Eeq = G * Math.pow(e.V / 3.6, 2) * ka / G_ACC, Iq = Eeq - cant, def = Math.max(Iq, 0), exc = cant;
    var Vw = e.wind === 'N' ? 0 : (e.loc === 'platform' ? n0(tp.wind_plat_kmh) : n0(tp.wind_open_kmh));
    var Dw = k.Cw * Vw * Vw * (yes(sOpt.wind) ? 1 : 0);
    var Rg = kg === 0 ? 0 : 1 / kg;
    var wd = (Rg > 0 && Rg < n0(tp.widen_R_m)) ? n0(tp.widen_mm) : 0;
    var pw = bg.p, a = g.a, nE = g.n_end;
    var dgi = (a * a + pw * pw) / 8 * kg * 1000, dga = (a * nE + nE * nE - pw * pw / 4) / 2 * kg * 1000;
    var rollO = k.s * (def + Dw) / G, rollI = k.s * (exc + Dw) / G, dt = k.dTat(Rg);
    var o1 = k.pw1 + dga + dt.out + g.A_end * wd / 2 + rollO * (k.h1 - k.hc) * 1000 + k.rout1;
    var o2 = k.pw2 + dga + dt.out + g.A_end * wd / 2 + rollO * (k.h2 - k.hc) * 1000 + k.rout2;
    var i1 = k.pw1 + dgi + dt.in + wd / 2 + rollI * (k.h1 - k.hc) * 1000 + k.rnd_in1;
    var i2 = k.pw2 + dgi + dt.in + wd / 2 + rollI * (k.h2 - k.hc) * 1000 + k.rnd_in2;
    var ke = kes[e.keName] || kes.__default;
    var kw1 = keWidth(ke, k.h1) * 1000, kw2 = keWidth(ke, k.h2) * 1000;
    var xo = Math.max(o1 - kw1, o2 - kw2), xi = Math.max(i1 - kw1, i2 - kw2);
    var To = Math.max((k.sod_L * k.sod_L - k.sod_C * k.sod_C) / 8 * kg * 1000 - k.nosing, 0) + wd / 2;
    var Ti = Math.max((k.sod_C * k.sod_C + k.sod_b * k.sod_b) / 8 * kg * 1000 - k.nosing, 0) + wd / 2;
    var sod = (xo <= To + 0.05 && xi <= Ti + 0.05) ? 'OK' : 'CHECK';
    var lean = k.h2 * cant / G * 1000, ho = o2 - lean, hi = i2 + lean;
    var sc = e.str === 0 ? null : e.str - Math.max(ho, hi), ss = sc === null ? '' : (sc >= 0 ? 'OK' : 'INFRINGES');
    var vc = e.Rv > 0 ? a * a / (8 * e.Rv) * 1000 : (e.Rv < 0 ? (a * nE + nE * nE) / (2 * Math.abs(e.Rv)) * 1000 : 0);
    var uf = n0(body.uf_h_mm) - d.dn_total - vc - (d.vert ? d.vert(g.a / 2, true).dn : 0) - d.s_c * (Math.max(def, exc) + d.wind.Cw_c * Vw * Vw * (yes(sOpt.wind) ? 1 : 0) + n0(tp.cl_err_mm)) / G * n0(body.uf_hw_mm);
    var ufs = uf >= n0(L.uf_min_body_mm) ? 'OK' : 'BELOW MIN';
    var pl = '', gn = null, gm = null, gs = '';
    if (e.loc === 'platform') {
      pl = ka === 0 ? 'Tangent' : (((e.ps === 'L' && kk > 0) || (e.ps === 'R' && kk < 0)) ? 'Inside' : 'Outside');
      gn = e.pe - k.sill_hw - (pl === 'Inside' ? dgi : (pl === 'Outside' ? dga : 0));
      gm = gn - (dt.in + wd / 2 + k.s * ((pl === 'Inside' ? exc : 0) + Dw) / G * (k.hf - k.hc) * 1000 + k.rfl);
      gs = gm < 0 ? 'CONTACT' : (gn > n0(L.prm_gap_mm) ? 'OK (gap > PRM value: info)' : 'OK');
    }
    var ok = (sod === 'CHECK' || ss === 'INFRINGES' || ufs === 'BELOW MIN' || gs === 'CONTACT') ? 'CHECK' : 'OK';
    return { ch: ch, el: e.no, t: t, type: e.type, k: kk, ka: ka, Rl: ka === 0 ? 0 : 1 / ka, cant: cant, V: e.V, Rv: e.Rv, ke: ke.name, sodn: e.sodName, loc: e.loc, wind: e.wind,
      str: e.str, pe: e.pe, ps: e.ps, kg: kg, Rg: Rg, Eeq: Eeq, Iq: Iq, def: def, exc: exc, Vw: Vw, Dw: Dw, wd: wd, dgi: dgi, dga: dga, wi: dt.wi, wa: dt.wa, dTi: dt.in, dTo: dt.out,
      o1: o1, o2: o2, i1: i1, i2: i2, kw1: kw1, kw2: kw2, xo: xo, xi: xi, To: To, Ti: Ti, sod: sod, lean: lean, ho: ho, hi: hi, sc: sc, ss: ss,
      vc: vc, uf: uf, ufs: ufs, pl: pl, gn: gn, gm: gm, gs: gs, ok: ok };
  }

  // ---------------------------------------------------------------- SOD outline and point items (METHOD §8.7)
  // Displaced dynamic-gauge profile in the curve frame (right = OUTSIDE), track plane, m.
  function envelopeTP(r, k, g) {
    var G = k.G, tho = k.s * (r.def + r.Dw) / G + k.thr + k.tht, thi = k.s * (r.exc + r.Dw) / G + k.thr + k.tht;
    var dTo = r.dTo !== undefined ? r.dTo : k.dT_out, dTi = r.dTi !== undefined ? r.dTi : k.dT_in;
    function Eout(h) { return r.dga + dTo + g.A_end * r.wd / 2 + k.s * (r.def + r.Dw) / G * (h - k.hc) * 1000 + k.rnd(k.gtOut, h); }
    function Ein(h) { return r.dgi + dTi + r.wd / 2 + k.s * (r.exc + r.Dw) / G * (h - k.hc) * 1000 + k.rnd(k.gt, h); }
    var prof = k.profile.pts;
    return {
      tho: tho, thi: thi,
      right: prof.map(function (q) { var E = Eout(q.h); return { pt: q.pt, x0: q.x, h0: q.h, E: E, th: tho, xt: q.x + E / 1000, zt: q.h - tho * q.x }; }),
      left: prof.map(function (q) { var E = Ein(q.h); return { pt: q.pt, x0: q.x, h0: q.h, E: E, th: thi, xt: -(q.x + E / 1000), zt: q.h - thi * q.x }; })
    };
  }
  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    var x = ax + t * dx - px, y = ay + t * dy - py;
    return Math.sqrt(x * x + y * y);
  }
  // Signed distance of a point to a closed polygon [{x, y}] (the last point joins the first): + inside, − outside.
  function polySigned(px, py, poly) {
    var d = Infinity, inside = false, i, j, n = poly.length;
    for (i = 0, j = n - 1; i < n; j = i++) {
      var a = poly[j], b = poly[i];
      d = Math.min(d, segDist(px, py, a.x, a.y, b.x, b.y));
      if (((b.y > py) !== (a.y > py)) && (px < (a.x - b.x) * (py - b.y) / (a.y - b.y) + b.x)) { inside = !inside; }
    }
    return inside ? d : -d;
  }
  // Widened tangent SOD outline in the curve frame (m): right half + T_out, mirrored left half + T_in.
  function sodPolygon(half, To, Ti) {
    var r = half.map(function (q) { return { x: q.y + To, y: q.z }; }), l = half.slice().reverse().map(function (q) { return { x: -(q.y + Ti), y: q.z }; });
    return r.concat(l);
  }
  function sodContext(p) {
    var sods = {}, sd = p.sod || {};
    (sd.profiles || []).forEach(function (pr) {
      var pts = (pr.points || []).filter(function (q) { return q.y !== null && q.y !== undefined && q.z !== null && q.z !== undefined; }).map(function (q) { return { y: q.y / 1000, z: q.z / 1000 }; });
      if (pts.length >= 2) { sods[pr.name] = pts; }
    });
    function lim(v, d) { return (v === null || v === undefined || v === '') ? d : Number(v); }
    var items = (sd.items || []).filter(function (it) { return it.y !== null && it.y !== undefined && it.z !== null && it.z !== undefined; }).map(function (it) {
      return { name: it.name, type: it.type, y: it.y / 1000, z: it.z / 1000, req: it.type === 'ohe' ? Math.max(n0(it.min_clear_mm), n0((p.ke.limits || {}).el_dynamic_mm, 190)) : n0(it.min_clear_mm), side: it.side || 'both', from: lim(it.ch_from_m, -Infinity), to: lim(it.ch_to_m, Infinity) };
    });
    return { sods: sods, items: items, vertical: sd.frame === 'vertical', margin: n0(sd.margin_mm, 50) };
  }
  // Adds the outline and item results to a sweep row (sodc / sodp / sods, itm / itc / itn / its).
  function sodCheck(r, k, g, sc) {
    var en = envelopeTP(r, k, g), phi = Math.asin(Math.max(-1, Math.min(1, r.cant / k.G))), cs = Math.cos(phi), sn = Math.sin(phi);
    function fr(x, z) { return sc.vertical ? { x: x * cs - z * sn, y: x * sn + z * cs } : { x: x, y: z }; }
    var pts = en.right.map(function (q) { var o = fr(q.xt, q.zt); o.pt = q.pt; o.side = 'outside'; return o; })
      .concat(en.left.slice().reverse().map(function (q) { var o = fr(q.xt, q.zt); o.pt = q.pt; o.side = 'inside'; return o; }));
    r.sodc = null; r.sodp = ''; r.sods = '';
    var half = r.sodn ? sc.sods[r.sodn] : null;
    if (half) {
      var poly = sodPolygon(half, r.To / 1000, r.Ti / 1000), best = null;
      pts.forEach(function (q) { var c = polySigned(q.x, q.y, poly) * 1000; if (best === null || c < best.c) { best = { c: c, q: q }; } });
      r.sodc = best.c; r.sodp = best.q.pt + ' (' + best.q.side + ')'; r.sods = best.c >= sc.margin ? 'OK' : 'CHECK';
    }
    r.itm = null; r.itc = null; r.itn = ''; r.its = '';
    var act = sc.items.filter(function (it) { return r.ch >= it.from - 1e-9 && r.ch <= it.to + 1e-9; });
    if (act.length && pts.length >= 3) {
      var hands = r.k > 0 ? [1] : (r.k < 0 ? [-1] : [1, -1]), worst = null;
      act.forEach(function (it) {
        var ys = it.side === 'R' ? [it.y] : (it.side === 'L' ? [-it.y] : [it.y, -it.y]);
        hands.forEach(function (hd) {
          ys.forEach(function (yr) {
            var c = -polySigned(hd * yr, it.z, pts) * 1000, m = c - it.req;
            if (worst === null || m < worst.m) { worst = { m: m, c: c, it: it, real: yr < 0 ? 'L' : 'R' }; }
          });
        });
      });
      r.itm = worst.m; r.itc = worst.c; r.itn = worst.it.name + ' (' + worst.real + ')'; r.its = worst.m >= 0 ? 'OK' : 'CHECK';
    }
    if (r.sods === 'CHECK' || r.its === 'CHECK') { r.ok = 'CHECK'; }
    return r;
  }

  // Speed-step study (Dynamic Calc §2) for one car.
  function speedStep(p, d, k, kes, sOpt, dOpt) {
    var tp = p.track.params, g = d.geo, bg = d.bogie, G = k.G;
    var R = n0(dOpt.ss_R_m), cant = n0(dOpt.ss_cant_mm), Vw = n0(dOpt.ss_wind_kmh), step = n0(dOpt.ss_step_kmh, 10), n = Math.max(1, Math.round(n0(dOpt.ss_n, 13)));
    var ke = kes[dOpt.ss_ke] || kes.__default, kw1 = keWidth(ke, k.h1) * 1000, kw2 = keWidth(ke, k.h2) * 1000;
    var Dw = k.Cw * Vw * Vw * (yes(sOpt.wind) ? 1 : 0), wd = (R > 0 && R < n0(tp.widen_R_m)) ? n0(tp.widen_mm) : 0;
    var dgi = R === 0 ? 0 : (g.a * g.a + bg.p * bg.p) / (8 * R) * 1000, dga = R === 0 ? 0 : (g.a * g.n_end + g.n_end * g.n_end - bg.p * bg.p / 4) / (2 * R) * 1000;
    var rows = [], i, dt = k.dTat(R);
    for (i = 0; i < n; i++) {
      var V = i * step, Eeq = R === 0 ? 0 : G * Math.pow(V / 3.6, 2) / (G_ACC * R), I = Eeq - cant, def = Math.max(I, 0), exc = Math.max(-I, 0);
      var o1 = k.pw1 + dga + dt.out + g.A_end * wd / 2 + k.s * (def + Dw) / G * (k.h1 - k.hc) * 1000 + k.rout1;
      var o2 = k.pw2 + dga + dt.out + g.A_end * wd / 2 + k.s * (def + Dw) / G * (k.h2 - k.hc) * 1000 + k.rout2;
      var i1 = k.pw1 + dgi + dt.in + wd / 2 + k.s * (exc + Dw) / G * (k.h1 - k.hc) * 1000 + k.rnd_in1;
      var i2 = k.pw2 + dgi + dt.in + wd / 2 + k.s * (exc + Dw) / G * (k.h2 - k.hc) * 1000 + k.rnd_in2;
      rows.push({ V: V, Eeq: Eeq, I: I, def: def, exc: exc, Dw: Dw, wd: wd, dgi: dgi, dga: dga, o1: o1, o2: o2, i1: i1, i2: i2, kw1: kw1, kw2: kw2,
        excess: Math.max(o1 - kw1, o2 - kw2, i1 - kw1, i2 - kw2),
        remark: def > n0(tp.cantdef_max_mm) ? 'Above cant-deficiency limit' : (V > n0(p.train.vmax_kmh) ? 'Above design speed' : '') });
    }
    return { R: R, cant: cant, wind: Vw, ke: ke.name, rows: rows };
  }

  // Line summary (Dynamic Gauge Output §Summary) over the rows of one car or the envelope.
  function lineSummary(p, rows, sw) {
    var tp = p.track.params, L = p.ke.limits || {};
    function ext(key, fn) {
      var best = null;
      rows.forEach(function (r) { var v = r[key]; if (v === null || v === undefined) { return; } if (!best || fn(v, best.v)) { best = { v: v, ch: r.ch, car: r.car }; } });
      return best;
    }
    var gt = function (a, b) { return a > b; }, lt = function (a, b) { return a < b; };
    var valid = rows.filter(function (r) { return r.valid; });
    var def = ext('def', gt), xo = ext('xo', gt), xi = ext('xi', gt), sc = ext('sc', lt), uf = ext('uf', lt), gm = ext('gm', lt), gn = ext('gn', gt);
    var sodN = valid.filter(function (r) { return r.sod === 'CHECK'; }), chkN = valid.filter(function (r) { return r.ok === 'CHECK'; });
    var firstSod = rows.filter(function (r) { return r.sod === 'CHECK'; })[0];
    var sodc = ext('sodc', lt), itm = ext('itm', lt), simc = ext('simc', lt);
    return {
      length: sw.end - sw.ch0, points: valid.length, step: sw.step,
      def: def, def_lim: n0(tp.cantdef_max_mm), def_ok: def ? def.v <= n0(tp.cantdef_max_mm) : true,
      xo: xo, xi: xi, sod_n: sodN.length, sod_first: firstSod ? firstSod.ch : null,
      sc: sc, sc_ok: sc ? sc.v >= 0 : null, uf: uf, uf_lim: n0(L.uf_min_body_mm), uf_ok: uf ? uf.v >= n0(L.uf_min_body_mm) : true,
      gm: gm, gm_ok: gm ? gm.v >= 0 : null, gn: gn, prm: n0(L.prm_gap_mm), gn_info: gn ? gn.v > n0(L.prm_gap_mm) : false,
      sodc: sodc, sodc_req: n0((p.sod || {}).margin_mm, 50), sodo_n: valid.filter(function (r) { return r.sods === 'CHECK'; }).length,
      sodo_pts: valid.filter(function (r) { return r.sodc !== null && r.sodc !== undefined; }).length,
      itm: itm, it_n: valid.filter(function (r) { return r.its === 'CHECK'; }).length, it_pts: valid.filter(function (r) { return r.itm !== null && r.itm !== undefined; }).length,
      simc: simc, sim_n: valid.filter(function (r) { return r.sims === 'CHECK'; }).length, sim_pts: valid.filter(function (r) { return r.simc !== null && r.simc !== undefined; }).length,
      sim_flags: valid.filter(function (r) { return r.simf; }).length,
      check_n: chkN.length, ok: chkN.length === 0
    };
  }
  // Per-element summary (Dynamic Gauge Output, element table).
  function elementSummary(tm, rows) {
    return tm.el.map(function (e) {
      var rs = rows.filter(function (r) { return r.el === e.no; });
      function mx(k) { var v = null; rs.forEach(function (r) { if (r[k] !== null && (v === null || r[k] > v)) { v = r[k]; } }); return v; }
      function mn(k) { var v = null; rs.forEach(function (r) { if (r[k] !== null && (v === null || r[k] < v)) { v = r[k]; } }); return v; }
      return { no: e.no, s0: e.s0, s1: e.s1, type: e.type, side: e.side, R0: e.ks === 0 ? 0 : 1 / Math.abs(e.ks), R1: e.ke === 0 ? 0 : 1 / Math.abs(e.ke), V: e.V,
        remarks: e.remarks, sodn: e.sodName, n: rs.length, def: mx('def'), o2: mx('o2'), i2: mx('i2'), xo: mx('xo'), xi: mx('xi'), sc: mn('sc'), uf: mn('uf'), sodc: mn('sodc'), itm: mn('itm'),
        status: rs.length ? (rs.some(function (r) { return r.ok === 'CHECK'; }) ? 'CHECK' : 'OK') : 'not evaluated' };
    });
  }

  /*
   * Dynamic run (METHOD §8): sweep every selected car type along the track data; returns per car the sweep rows,
   * line summary, per-element summary and speed-step study, plus the envelope of all cars (worst per chainage).
   */
  function dynamicRun(p, sOpt, dOpt) {
    sOpt = sOpt || {}; dOpt = dOpt || {};
    var tm = trackModel(p);
    if (!tm.el.length) { throw new Error('No track data.'); }
    var kes = {};
    p.ke.profiles.forEach(function (pr) { var o = outline(pr.points, pr.n_up); o.name = pr.name; kes[pr.name] = o; });
    kes.__default = kes[sOpt.ke] || kes[(p.ke.profiles[0] || {}).name];
    if (!kes.__default) { throw new Error('No customer KE.'); }
    var sw = sweepChainages(tm, dOpt, n0(p.track.params.dx_m, 10));
    var want = dOpt.cars && dOpt.cars !== 'all' ? String(dOpt.cars).split(',') : null;
    var cars = p.train.carTypes.filter(function (c) { return !want || want.indexOf(c.name) >= 0; });
    var warnings = [], sc = sodContext(p), backward = studyOf(p) === 'backward';
    if (backward) { warnings.push('Backward study: the route is checked with the whole-car maximum construction gauge derived from the customer KE "' + kes.__default.name + '" (static options), not with an RS profile.'); }
    var out = cars.map(function (c) {
      var d = deriveCar(p, c, sOpt), mp = null;
      if (backward) {
        var mc = mcgCar(p, d, [], kes.__default, sOpt).car;
        if (!mc.ok) { throw new Error(c.name + ': no maximum construction gauge – ' + mc.warn.join(' ')); }
        mp = mc.o; mp.name = mc.name;
      }
      var k = dynConstants(p, d, sOpt, dOpt, mp);
      var win = Math.ceil(k.win_m / sw.step - 1e-12);   // ROUNDUP(… / step, 0)
      var ka = sw.pts.map(function (q) { var e = tm.el[locate(tm, q.ch)], t = Math.max(0, Math.min(1, (q.ch - e.s0) / (e.s1 - e.s0))); return Math.abs(e.ks + (e.ke - e.ks) * t); });
      var rows = sw.pts.map(function (q, i) {
        var kg = ka[i];
        if (dOpt.ov_meth !== 'local') { for (var j = Math.max(0, i - win); j <= Math.min(ka.length - 1, i + win); j++) { if (ka[j] > kg) { kg = ka[j]; } } }
        var r = sweepRow(p, d, k, tm, kes, sOpt, q.ch, kg);
        r.valid = q.valid; r.car = c.name;
        sodCheck(r, k, d.geo, sc);
        return r;
      });
      var simL = simLine(p, d, rows, sOpt, sc, k);
      return { car: c.name, count: c.count, derived: d, sim: simL, consts: { s: k.s, hc: k.hc, Cw: k.Cw, dT_in: k.dT_in, dT_out: k.dT_out, thr: k.thr, tht: k.tht,
          rnd_in1: k.rnd_in1, rnd_in2: k.rnd_in2, rout1: k.rout1, rout2: k.rout2, rfl: k.rfl, pw1: k.pw1, pw2: k.pw2, profile: k.profile.name, win: win,
          sod_C: k.sod_C, sod_L: k.sod_L, sod_b: k.sod_b },
        rows: rows, summary: lineSummary(p, rows, sw), elements: elementSummary(tm, rows), speedStep: speedStep(p, d, k, kes, sOpt, dOpt), _k: k };
    });
    // envelope: worst over car types at each chainage
    var env = sw.pts.map(function (q, i) {
      var r = { ch: q.ch, valid: q.valid, el: out[0] ? out[0].rows[i].el : null, def: out[0] ? out[0].rows[i].def : null, sod: 'OK', ok: 'OK' };
      function take(key, better) {
        out.forEach(function (o) { var v = o.rows[i][key]; if (v === null || v === undefined) { return; } if (r[key] === undefined || r[key] === null || better(v, r[key])) { r[key] = v; r[key + '_car'] = o.car; } });
      }
      ['xo', 'xi', 'o2', 'i2', 'gn'].forEach(function (k2) { r[k2] = null; take(k2, function (a, b) { return a > b; }); });
      ['sc', 'uf', 'gm', 'sodc', 'itm', 'simc'].forEach(function (k2) { r[k2] = null; take(k2, function (a, b) { return a < b; }); });
      out.forEach(function (o) { var x = o.rows[i]; if (x.car === r.simc_car) { r.simn = x.simn; r.simf = x.simf; } });
      r.sims = out.some(function (o) { return o.rows[i].sims === 'CHECK'; }) ? 'CHECK' : (r.simc === null ? '' : 'OK');
      out.forEach(function (o) { var x = o.rows[i]; if (x.car === r.sodc_car) { r.sodp = x.sodp; } if (x.car === r.itm_car) { r.itn = x.itn; r.itc = x.itc; } });
      r.sods = out.some(function (o) { return o.rows[i].sods === 'CHECK'; }) ? 'CHECK' : (r.sodc === null ? '' : 'OK');
      r.its = out.some(function (o) { return o.rows[i].its === 'CHECK'; }) ? 'CHECK' : (r.itm === null ? '' : 'OK');
      out.forEach(function (o) { var x = o.rows[i]; if (x.sod === 'CHECK') { r.sod = 'CHECK'; } if (x.ok === 'CHECK') { r.ok = 'CHECK'; } });
      r.car = r.xo_car;
      return r;
    });
    var ccd = (p.ccds || []).length && out[0] ? ccdLine(p, sOpt, out[0].rows, sc, kes) : null;
    var summary = lineSummary(p, env, sw);
    if (ccd) { summary.ccd = { ke: ccd.ke, reach: ccd.reach, overlap: ccd.overlap, clear: ccd.clear, n: ccd.n, check_n: ccd.check_n }; if (!ccd.ok) { summary.ok = false; } }
    ['def', 'xo', 'xi', 'sc', 'uf', 'gm', 'gn', 'sodc', 'itm', 'simc'].forEach(function (key) {
      if (summary[key]) { var row = env.filter(function (r) { return r.ch === summary[key].ch; })[0]; summary[key].car = row ? row[key + '_car'] : null; }
    });
    return { engineVersion: VERSION, study: studyOf(p), sweep: { ch0: sw.ch0, end: sw.end, step: sw.step, n: sw.pts.length }, ke: kes.__default.name,
      cars: out, envelope: env, summary: summary, elements: elementSummary(tm, env), ccd: ccd, ok: summary.ok, warnings: warnings };
  }

  /*
   * Cross-section at a chainage for one car (Dynamic Calc §4): right = OUTSIDE (car end at line speed), left = INSIDE
   * (mid-car, stopped), rotated by the cant angle into the vertical frame. ch = null → chainage of the largest outside excess.
   */
  function crossSection(p, dres, carName, ch, sOpt) {
    var cr = dres.cars.filter(function (c) { return c.car === carName; })[0] || dres.cars[0];
    if (!cr) { return null; }
    var rows = cr.rows, k = cr._k, d = cr.derived, g = d.geo, tp = p.track.params, i, idx = 0;
    if (ch === null || ch === undefined || ch === '' || !isFinite(ch)) {
      var best = -Infinity;
      rows.forEach(function (r, j) { if (r.xo > best) { best = r.xo; idx = j; } });
      ch = rows[idx].ch;
    } else {
      ch = Math.min(Math.max(Number(ch), dres.sweep.ch0), dres.sweep.end);
      for (i = 0; i < rows.length; i++) { if (rows[i].ch <= ch + 1e-9) { idx = i; } }
    }
    var r = rows[idx], G = k.G, phi = Math.asin(r.cant / G), cs = Math.cos(phi), sn = Math.sin(phi);
    function rot(x, z) { return { x: x * cs - z * sn, y: x * sn + z * cs }; }
    var en = envelopeTP(r, k, g), tho = en.tho, thi = en.thi, right = en.right, left = en.left, prof = k.profile.pts, ke = null;
    p.ke.profiles.forEach(function (pr) { if (pr.name === r.ke) { ke = pr; } });
    function both(fnR, fnL, list) { var a = list.map(fnR), b = list.slice().reverse().map(fnL); return a.concat(b, a.length ? [a[0]] : []); }
    var envelope = right.map(function (q) { return rot(q.xt, q.zt); }).concat(left.slice().reverse().map(function (q) { return rot(q.xt, q.zt); }));
    if (envelope.length) { envelope.push(envelope[0]); }
    var stat = both(function (q) { return rot(q.x, q.h); }, function (q) { return rot(-q.x, q.h); }, prof);
    var kp = ke ? ke.points.map(function (q) { return { x: q.y / 1000, h: q.z / 1000 }; }) : [];
    var keR = both(function (q) { return rot(q.x, q.h); }, function (q) { return rot(-q.x, q.h); }, kp);
    var keS = both(function (q) { return rot(q.x + r.To / 1000, q.h); }, function (q) { return rot(-(q.x + r.Ti / 1000), q.h); }, kp);
    var mm = function (list) { return list.map(function (q) { return { x: q.x * 1000, y: q.y * 1000 }; }); };
    return { car: cr.car, ch: r.ch, row: r, phi: phi, tho: tho, thi: thi, right: right, left: left,
      envelope: mm(envelope), staticProfile: mm(stat), ke: mm(keR), keSod: mm(keS), rails: mm([rot(-0.75, 0), rot(0.75, 0)]),
      structure: r.str ? mm([rot(r.str / 1000, k.h2 - 0.3), rot(r.str / 1000, k.h2 + 0.3)]) : null, h2: k.h2 * 1000,
      sod: sodShow(p, r, rot), items: itemsShow(p, r, rot) };
  }
  // Widened SOD outline and active items for the cross-section, in the vertical frame (mm); tangent: drawn for a left-hand curve.
  function sodShow(p, r, rot) {
    var sc = sodContext(p), half = r.sodn ? sc.sods[r.sodn] : null;
    if (!half) { return null; }
    var poly = sodPolygon(half, r.To / 1000, r.Ti / 1000);
    poly.push(poly[0]);
    return { name: r.sodn, frame: sc.vertical ? 'vertical' : 'track', required: sc.margin, clearance: r.sodc, point: r.sodp,
      pts: poly.map(function (q) { var o = sc.vertical ? { x: q.x, y: q.y } : rot(q.x, q.y); return { x: o.x * 1000, y: o.y * 1000 }; }) };
  }
  function itemsShow(p, r, rot) {
    var sc = sodContext(p), hd = r.k < 0 ? -1 : 1, out = [];
    sc.items.forEach(function (it) {
      if (r.ch < it.from - 1e-9 || r.ch > it.to + 1e-9) { return; }
      (it.side === 'R' ? [it.y] : (it.side === 'L' ? [-it.y] : [it.y, -it.y])).forEach(function (yr) {
        var x = hd * yr, o = sc.vertical ? { x: x, y: it.z } : rot(x, it.z);
        out.push({ x: o.x * 1000, y: o.y * 1000, label: it.name + ' (' + (yr < 0 ? 'L' : 'R') + ')' });
      });
    });
    return out;
  }


  return {
    VERSION: VERSION, CASES: CASES, carLoads: carLoads, carCases: carCases, sectionPos: sectionPos, carSections: carSections, G_ACC: G_ACC, playCalc: playCalc,
    trackModel: trackModel, locate: locate, sweepChainages: sweepChainages, dynamicRun: dynamicRun, crossSection: crossSection,
    envelopeTP: envelopeTP, polySigned: polySigned, sodPolygon: sodPolygon, sodContext: sodContext, sodCheck: sodCheck,
    suspLimit: suspLimit, elStatic: elStatic, measuredEval: measuredEval, wPoints: wPoints, wCurve: wCurve, rsPsi: rsPsi, rsLimit: rsLimit, rotStops: rotStops, lineCurvature: lineCurvature, studyOf: studyOf, mcgClear: mcgClear, mcgWidth: mcgWidth, mcgOutline: mcgOutline, mcgCar: mcgCar, carProfiles: carProfiles,
    outline: outline, keWidth: keWidth, keTop: keTop, profileWidth: profileWidth, clearance: clearance,
    carGeometry: carGeometry, deriveCar: deriveCar, caseParams: caseParams, lateralE: lateralE, staticRun: staticRun,
    enRules: enRules, enZ: enZ, enReduction: enReduction, enE: enE, enGradient: enGradient, enTableA1: enTableA1, enVertical: enVertical, enBogieE: enBogieE, enBogieParts: enBogieParts, enStaticE: enStaticE, enStaticRun: enStaticRun, enRulesAt: enRulesAt, enStaticRulesAt: enStaticRulesAt, enDoorAllowance: enDoorAllowance, enStepGap: enStepGap, enPantoP: enPantoP, wAtR: wAtR, bostrabCheck: bostrabCheck, simDisp: simDisp, simCases: simCases, simSection: simSection, simContext: simContext, simAlong: simAlong, simCurve: simCurve, simPick: simPick, simTangent: simTangent, simValidation: simValidation, simRun: simRun, ccdMove: ccdMove, ccdBogie: ccdBogie, ccdRail: ccdRail, ccdContact: ccdContact, ccdStatic: ccdStatic, ccdLine: ccdLine, rectDist: rectDist, swayFit: swayFit, swayEval: swayEval, gaugeTestPlan: gaugeTestPlan
  };
}));
