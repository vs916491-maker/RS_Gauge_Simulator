/*
 * CALCULATION ENGINE - pure, deterministic, DOM-free (loads in Node for tests).
 * Implements METHOD.md (the workbook method "Vehicle Gauging Calculation Tool"):
 *   derived car data (pivots, yaw factors, wind equivalent cant, vertical travels, theoretical s and hc,
 *   shared-bogie check), the six static cases per car type (interior / exterior / car end x tare / crush),
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

  var VERSION = '4.1.0';
  var G_ACC = 9.81;
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

  // Theoretical flexibility coefficient and roll-centre height (METHOD §5.3), states: tare, crush, defl.
  function theoretical(p, c, g, body, latflex) {
    var bs = [[findBy(p.bogies, 'name', c.bogie1) || p.bogies[0] || {}, g.share1], [findBy(p.bogies, 'name', c.bogie2) || findBy(p.bogies, 'name', c.bogie1) || p.bogies[0] || {}, g.share2]];
    function sum(fn) { return bs[0][1] * fn(bs[0][0]) + bs[1][1] * fn(bs[1][0]); }
    function avg(fn) { return (bs[0][1] * fn(bs[0][0]) + bs[1][1] * fn(bs[1][0])) / (bs[0][1] + bs[1][1]); }
    var K1 = sum(function (b) { return n0(b.n_ps) * n0(b.kz_prim) * Math.pow(n0(b.b1_mm) / 1000, 2); });
    var zp = avg(function (b) { return n0(b.z_prim_mm) / 1000; });
    var Kyp = sum(function (b) { return n0(b.n_ps) * n0(b.ky_prim); });
    function state(kz2Key, zsKey, kySecKey, m, hG) {
      var K2 = sum(function (b) { return n0(b.n_as) * n0(b[kz2Key]) * Math.pow(n0(b.b2_mm) / 1000, 2) + n0(b.k_arb); });
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
    var mt = n0(c.mass_tare_t) * 1000, mc = n0(c.mass_crush_t) * 1000, ht = n0(c.cg_tare_mm) / 1000, hcr = n0(c.cg_crush_mm) / 1000;
    var tare = state('kz2_t', 'z_sec_mm', 'ky_sec', mt, ht);
    // crush: crush air-spring stiffness; lateral stiffness as tare (workbook rule)
    var crush = state('kz2_c', 'z_sec_mm', 'ky_sec', mc, hcr);
    var defl = state('kz_em', 'z_sec_d_mm', 'ky2_d', mt, ht);
    return { roll_share: g.share1 + g.share2, zp: zp, tare: tare, crush: crush, defl: defl };
  }

  function sharedCheck(p, c, g, bg) {
    var L = p.ke.limits || {}, Rmin = n0(p.track.params.R_min_m), mc = n0(c.mass_crush_t) * 1000;
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
    var mt = n0(c.mass_tare_t) * 1000, mc = n0(c.mass_crush_t) * 1000;
    var Cw_t = mt > 0 ? 0.5 * rho * Cf * Aw * Beq / (mt * G_ACC) / (3.6 * 3.6) : 0;
    var Cw_c = mc > 0 ? 0.5 * rho * Cf * Aw * Beq / (mc * G_ACC) / (3.6 * 3.6) : 0;
    var Vw = n0(tp.wind_open_kmh);
    var deflLat = opt.lat_state === 'deflated', deflVert = opt.vert_state !== 'inflated';
    var th = theoretical(p, c, g, body, yes(opt.latflex));
    var theo = opt.flex === 'theoretical';
    var sT = deflLat ? (theo ? th.defl.s : n0(body.s_defl)) : (theo ? th.tare.s : n0(body.s_tare));
    var sC = deflLat ? (theo ? th.defl.s : n0(body.s_defl)) : (theo ? th.crush.s : n0(body.s_crush));
    var hT = deflLat ? (theo ? th.defl.hc : n0(body.hc_defl_mm) / 1000) : (theo ? th.tare.hc : n0(body.hc_tare_mm) / 1000);
    var hC = deflLat ? (theo ? th.defl.hc : n0(body.hc_defl_mm) / 1000) : (theo ? th.crush.hc : n0(body.hc_crush_mm) / 1000);
    var up = bg.up_prim + bg.up_sec + (yes(opt.over_infl) ? bg.up_oi : 0);
    var dn = bg.dn_wheel + bg.dn_prim + (deflVert ? bg.dn_sec_def : bg.dn_sec_inf);
    return {
      car: c.name, carRec: c, geo: g, bogie: bg, body: body,
      w_use: deflLat ? bg.w_defl : bg.w,
      wind: { Lw: Lw, Aw: Aw, Cf: Cf, rho: rho, Beq: Beq, Cw_t: Cw_t, Cw_c: Cw_c, F: 0.5 * rho * Cf * Aw * Math.pow(Vw / 3.6, 2), Dw_t: Cw_t * Vw * Vw, Dw_c: Cw_c * Vw * Vw },
      dn_total: dn, up_total: up,
      theoretical: th, s_t: sT, s_c: sC, hc_t: hT, hc_c: hC,
      shared: sharedCheck(p, c, g, bg)
    };
  }

  // ---------------------------------------------------------------- static cases (METHOD §6)
  function caseParams(p, d, cs, opt) {
    var tp = p.track.params, g = d.geo, bg = d.bogie, G = n0(p.train.L_mm, 1500);
    var Rs = n0(tp.R_static_m), crush = cs.load === 'crush', inner = cs.section === 'int';
    var n = cs.section === 'int' ? g.ni : (cs.section === 'ext' ? g.na : g.n_end);
    var A = cs.section === 'int' ? 1 : (cs.section === 'ext' ? g.A_ext : g.A_end);
    var pw = bg.p;
    var dg = Rs === 0 ? 0 : (inner ? (g.a * n - n * n + pw * pw / 4) : (g.a * n + n * n - pw * pw / 4)) / (2 * Rs) * 1000;
    var widen = (Rs > 0 && Rs < n0(tp.widen_R_m)) ? n0(tp.widen_mm) / 2 : 0;
    var t = { play: bg.play * A, q: bg.q * A, w: d.w_use * A, fw: n0(tp.fw_mm) * A, widen: widen * A };
    var T = dg + t.play + t.q + t.w + t.fw + t.widen;
    var rg = inner ? n0(tp.g_tol_mm) : n0(tp.g_tol_mm) * A * (yes(opt.gtol_ext) ? 1 : 0);
    var ra = n0(tp.align_tol_mm) * (yes(opt.align) ? 1 : 0);
    var cant = inner ? n0(tp.cantexc_max_mm) : n0(tp.cantdef_max_mm);
    var wind = (crush ? d.wind.Cw_c : d.wind.Cw_t) * Math.pow(n0(tp.wind_open_kmh), 2) * (yes(opt.wind) ? 1 : 0);
    var cl = n0(tp.cl_err_mm), s = crush ? d.s_c : d.s_t, hc = crush ? d.hc_c : d.hc_t;
    var thq = s * (cant + wind) / G, thr = s * cl / G, tht = (yes(opt.tilt) ? 1 : 0) * cl / G;
    return {
      n: n, A: A, dg: dg, play: t.play, q: t.q, w: t.w, fw: t.fw, widen: t.widen, T: T,
      rnd_gauge: rg, rnd_align: ra, cant: cant, wind: wind, cl: cl, s: s, hc: hc,
      thq: thq, thr: thr, tht: tht, thtot: thq + thr + tht,
      drop: crush ? n0(d.carRec.drop_crush_mm) : 0,
      up: yes(opt.up_roll) ? d.up_total : 0
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
    return { id: cs.id, label: cs.label, section: cs.section, load: cs.load, profile: prof.name, params: cp, points: pts, min: min, ok: min ? min.c >= 0 : true };
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
      ['int', 'ext', 'end'].forEach(function (sec, j) {
        var em = Math.max(E[2 * j], E[2 * j + 1]), mx = W - em / 1000, pw = profileWidth(profs[sec], h);
        r['max_' + sec] = mx * 1000; r['prof_' + sec] = pw * 1000; r['margin_' + sec] = pw === 0 ? null : (mx - pw) * 1000;   // blank above the profile top
      });
      rows.push(r);
      if (h >= to - 1e-9) { break; }
    }
    return rows;
  }

  function verticalChecks(p, d, cases, ke, profs) {
    var L = p.ke.limits || {}, tp = p.track.params, b = d.body || {};
    var Rv = n0(tp.Rv_static_m), a = d.geo.a;
    var rows = [];
    ['int', 'ext', 'end'].forEach(function (sec) {
      var v = profs[sec].top * 1000 + d.up_total;
      rows.push({ id: 'top_' + sec, label: { int: 'Interior', ext: 'Exterior', end: 'Car-end' }[sec] + ' profile top + upward movement', value: v, limit: ke.top * 1000, margin: ke.top * 1000 - v, unit: 'mm' });
    });
    var vc = Rv === 0 ? 0 : a * a / (8 * Rv) * 1000;
    var roll = Math.max(cases[1].params.thtot, cases[3].params.thtot, cases[5].params.thtot) * n0(b.uf_hw_mm);
    var body = n0(b.uf_h_mm) - d.dn_total - vc - roll;
    var bog = n0(b.uf_bog_h_mm) - d.bogie.dn_wheel - d.bogie.dn_prim;
    rows.push({ id: 'vc', label: 'Vertical-curve lowering at mid-car (crest Rv static)', value: vc, unit: 'mm', info: true });
    rows.push({ id: 'roll', label: 'Roll lowering of underframe edge (largest crush θ)', value: roll, unit: 'mm', info: true });
    rows.push({ id: 'uf_body', label: 'Body-mounted equipment height in worst case', value: body, limit: n0(L.uf_min_body_mm), margin: body - n0(L.uf_min_body_mm), unit: 'mm' });
    rows.push({ id: 'uf_bog', label: 'Bogie-mounted equipment height in worst case', value: bog, limit: n0(L.uf_min_bog_mm), margin: bog - n0(L.uf_min_bog_mm), unit: 'mm' });
    rows.forEach(function (r) { if (!r.info) { r.ok = r.margin >= 0; } });
    return rows;
  }

  function profileFor(p, name) {
    var list = p.rs.profiles, pr = findBy(list, 'name', name) || list[0];
    if (!pr) { return null; }
    var o = outline(pr.points, null); o.name = pr.name; return o;
  }

  /*
   * Static run (METHOD §6). opt = settings.static. Returns per car type the 6 cases, Method A and vertical checks,
   * plus the governing car / case. Throws only on missing essentials (callers validate first).
   */
  function staticRun(p, opt) {
    opt = opt || {};
    var keP = findBy(p.ke.profiles, 'name', opt.ke) || p.ke.profiles[0];
    if (!keP) { throw new Error('No customer KE.'); }
    if (!p.rs.profiles.length) { throw new Error('No RS profile.'); }
    var ke = outline(keP.points, keP.n_up); ke.name = keP.name;
    var want = opt.cars && opt.cars !== 'all' ? String(opt.cars).split(',') : null;
    var cars = p.train.carTypes.filter(function (c) { return !want || want.indexOf(c.name) >= 0; });
    var warnings = [], gov = null;
    var out = cars.map(function (c) {
      var d = deriveCar(p, c, opt);
      if (!(d.geo.a > 0)) { warnings.push(c.name + ': pivot distance a ≤ 0 — check body length and overhangs.'); }
      if (!d.geo.na_ok) { warnings.push(c.name + ': exterior section na is beyond the car-end overhang.'); }
      var profs = { int: profileFor(p, c.prof_int), ext: profileFor(p, c.prof_ext), end: profileFor(p, c.prof_end) };
      var cases = CASES.map(function (cs) { return runCase(p, d, cs, ke, profs[cs.section], opt); });
      var worst = null;
      cases.forEach(function (r) { if (r.min && (!worst || r.min.c < worst.min.c)) { worst = r; } });
      var res = { car: c.name, count: c.count, derived: d, cases: cases, governing: worst ? { id: worst.id, label: worst.label, c: worst.min.c } : null,
        methodA: methodA(p, d, cases, ke, profs, opt), vertical: verticalChecks(p, d, cases, ke, profs), profiles: { int: profs.int.name, ext: profs.ext.name, end: profs.end.name } };
      if (yes(opt.en_check)) {
        res.en = enRun(p, d, ke, profs, opt, res.methodA);
        if (d.geo.shared1 || d.geo.shared2) { warnings.push(c.name + ': EN 15273-2 formulae applied to an articulated unit by the Figure 1 equivalence (a = distance between the shared pivots).'); }
        if (n0(d.bogie.b1.n_axle, 2) !== 2 || n0(d.bogie.b2.n_axle, 2) !== 2) { warnings.push(c.name + ': EN 15273-2 formulae are written for two-axle bogies (§5.1.2); adapt them to the actual geometry.'); }
      }
      res.ok = cases.every(function (r) { return r.ok; }) && res.vertical.every(function (r) { return r.info || r.ok; }) && (!res.en || res.en.ok);
      if (worst && (!gov || worst.min.c < gov.c)) { gov = { car: c.name, id: worst.id, label: worst.label, c: worst.min.c, pt: worst.min.pt }; }
      return res;
    });
    var enGov = null;
    out.forEach(function (c) {
      if (!c.en) { return; }
      ['int', 'ext', 'end'].forEach(function (sec) { var m = c.en.checks[sec].min; if (m && (!enGov || m.margin < enGov.margin)) { enGov = { car: c.car, section: sec, margin: m.margin, h: m.h }; } });
    });
    return {
      engineVersion: VERSION, ke: { name: ke.name, top: ke.top * 1000, nUp: ke.nUp, points: keP.points },
      cars: out, governing: gov, en: yes(opt.en_check) ? { governing: enGov, ok: out.every(function (c) { return !c.en || c.en.ok; }) } : null,
      ok: out.every(function (r) { return r.ok; }), warnings: warnings
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
      Lref: v('Lref_mm', 1500) / 1000, eta_lim: v('eta_lim_deg', 1) * Math.PI / 180
    };
  }
  function pos(v) { return v > 0 ? v : 0; }
  // Quasi-static term z_kin (A.24 and its special cases), C0 = I0 (inside) or D0 (outside); all in m.
  function enZ(r, h, s, hc, C0, eta) {
    if (eta <= r.eta_lim) {
      if (h < r.hc0) { return 0; }
      if (s <= r.s0) { return s * C0 / r.Lref * pos(h - hc); }
    }
    var k2 = (r.Dlim - C0) / r.Lref;
    return s * C0 / r.Lref * pos(h - hc) + Math.tan(pos(eta - r.eta_lim)) * Math.abs(h - hc) + pos(s * k2 * pos(h - hc) - r.s0 * k2 * pos(h - r.hc0));
  }
  // General reduction (A.3.9.1, A.3.9.2, A.3.9.3), literal switching conditions, lengths in m.
  // o = { set: traction|coach|motor, side: i|a, low, n, a, d, q, z, near: {p, winf, w250, w150}, far: {...} }
  // For 'motor' near = motor bogie side (A.40–A.42) or carrying side (A.43–A.45) is given by o.motorNear;
  // between the pivots (A.37–A.39) near = motor bogie and n = n_mu (distance from the motor bogie centre).
  function enE(r, o) {
    var Ck = o.low ? r.Ck_low : r.Ck_up, P = (r.lmax - o.d) / 2, k1 = 1 / (2 * r.R1), kx = 1 / (2 * r.R2) - 1 / (2 * r.R1);
    var n = o.n, a = o.a, q = o.q, z = o.z, N = o.near, F = o.far, inner = o.side === 'i', A = inner ? 1 : (2 * n + a) / a;
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
        cond = delta - 2 * r.R1 * (N.winf - N.w250) <= r.R1 * (r.lmax - o.d) - 2 * (r.Ck_up - Ck);
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
  function enSectionE(r, en, sec, h) {
    var best = null, side = sec === 'int' ? 'i' : 'a', B = en.bogies;
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
    return best;
  }
  function enRun(p, d, ke, profs, opt, ma) {
    var r = enRules(p), g = d.geo, bg = d.bogie, b1 = bg.b1, b2 = bg.b2;
    var nMot = (yes(b1.motor) ? 1 : 0) + (yes(b2.motor) ? 1 : 0);
    var dW = Math.min(n0(b1.bb_mm) + 2 * n0(b1.ef_worn_mm), n0(b2.bb_mm) + 2 * n0(b2.ef_worn_mm)) / 1000;
    var defl = opt.lat_state === 'deflated';
    function bog(b) {   // w at straight track, 250 m and 150 m; variable stops (blank = none); deflated state: w constant
      var winf = n0(defl ? b.w_defl_mm : b.w_mm) / 1000, w250 = defl ? winf : blankOr(b.w250_mm, winf * 1000) / 1000, w150 = defl ? winf : blankOr(b.w150_mm, w250 * 1000) / 1000;
      return { name: b.name, motor: yes(b.motor), p: n0(b.p_m), winf: winf, w250: w250, w150: w150, Rv: defl ? 0 : n0(b.wv_R_m), wv: blankOr(b.wv_mm, winf * 1000) / 1000 };
    }
    var set = nMot === 0 ? 'coach' : (nMot === 1 && opt.en_mc === 'motor' ? 'motor' : 'traction');
    var en = {
      set: set, bogies: [bog(b1), bog(b2)], a: g.a, p: bg.p, d: dW, q: bg.q / 1000, w: d.w_use / 1000, eta: n0(d.body.eta0_deg) * Math.PI / 180,
      n: { int: g.ni, ext: g.na, end: g.n_end },
      loads: [{ load: 'tare', s: d.s_t, hc: d.hc_t }, { load: 'crush', s: d.s_c, hc: d.hc_c }]
    };
    var varW = en.bogies.some(function (b) { return b.w250 !== b.winf || b.w150 !== b.w250; }), nonlin = en.bogies.some(function (b) { return b.Rv > 0; });
    var clause = set === 'motor' ? 'A.3.9.2' : (set === 'traction' ? (nonlin ? 'A.3.9.1.1 + A.3.9.1.2' : 'A.3.9.1.1') : (nonlin ? 'A.3.9.3.1 + A.3.9.3.2' : 'A.3.9.3.1'));
    var secs = ['int', 'ext', 'end'], out = { rules: r, set: en.set, clause: clause, varW: varW, nonlin: nonlin, bogies: en.bogies, d: dW * 1000, q: bg.q, w: d.w_use,
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
    return out;
  }

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
      var cases = c.cases.map(function (k) {
        var cp = k.params, Dt = cp.cant + cp.wind, Rlat = cp.play + cp.q + cp.w, hcm = cp.hc * 1000;
        var sw = (sway || []).filter(function (x) { return x.car === c.car && x.load === k.load && !x.error; })[0] || null;
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
        return { id: k.id, label: k.label, section: k.section, load: k.load, profile: k.profile, D: Dt, cant: cp.cant, wind: cp.wind, A: cp.A,
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

  // Constants of one car type for the dynamic calculation (Dynamic Calc §1).
  function dynConstants(p, d, sOpt, dOpt) {
    var tp = p.track.params, G = n0(p.train.L_mm, 1500), L = p.ke.limits || {}, g = d.geo, bg = d.bogie;
    var tare = dOpt.load !== 'crush';
    var s = tare ? d.s_t : d.s_c, hc = tare ? d.hc_t : d.hc_c, Cw = tare ? d.wind.Cw_t : d.wind.Cw_c;
    var dT_in = bg.play + bg.q + d.w_use + n0(tp.fw_mm), dT_out = g.A_end * dT_in;
    var thr = s * n0(tp.cl_err_mm) / G, tht = (yes(sOpt.tilt) ? 1 : 0) * n0(tp.cl_err_mm) / G;
    var gt = n0(tp.g_tol_mm), al = n0(tp.align_tol_mm) * (yes(sOpt.align) ? 1 : 0), K = n0(sOpt.K_rss, 1), lin = sOpt.comb !== 'rss';
    var gtOut = gt * g.A_end * (yes(sOpt.gtol_ext) ? 1 : 0);
    function rnd(gtol, h) {   // h in m
      var a = thr * (h - hc) * 1000, b = tht * h * 1000;
      return lin ? gtol + al + a + b : K * Math.sqrt(gtol * gtol + al * al + a * a + b * b);
    }
    var prof = null, c = d.carRec;
    var pname = dOpt.profile ? dOpt.profile : c.prof_end;
    var pr = findBy(p.rs.profiles, 'name', pname) || p.rs.profiles[0];
    prof = outline(pr.points, null); prof.name = pr.name;
    var h1 = n0(L.h_ref1_mm) / 1000, h2 = n0(L.h_ref2_mm) / 1000, hf = n0(c.floor_mm) / 1000;
    return {
      s: s, hc: hc, Cw: Cw, dT_in: dT_in, dT_out: dT_out, thr: thr, tht: tht, h1: h1, h2: h2, hf: hf, G: G,
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
    var rollO = k.s * (def + Dw) / G, rollI = k.s * (exc + Dw) / G;
    var o1 = k.pw1 + dga + k.dT_out + g.A_end * wd / 2 + rollO * (k.h1 - k.hc) * 1000 + k.rout1;
    var o2 = k.pw2 + dga + k.dT_out + g.A_end * wd / 2 + rollO * (k.h2 - k.hc) * 1000 + k.rout2;
    var i1 = k.pw1 + dgi + k.dT_in + wd / 2 + rollI * (k.h1 - k.hc) * 1000 + k.rnd_in1;
    var i2 = k.pw2 + dgi + k.dT_in + wd / 2 + rollI * (k.h2 - k.hc) * 1000 + k.rnd_in2;
    var ke = kes[e.keName] || kes.__default;
    var kw1 = keWidth(ke, k.h1) * 1000, kw2 = keWidth(ke, k.h2) * 1000;
    var xo = Math.max(o1 - kw1, o2 - kw2), xi = Math.max(i1 - kw1, i2 - kw2);
    var To = Math.max((k.sod_L * k.sod_L - k.sod_C * k.sod_C) / 8 * kg * 1000 - k.nosing, 0) + wd / 2;
    var Ti = Math.max((k.sod_C * k.sod_C + k.sod_b * k.sod_b) / 8 * kg * 1000 - k.nosing, 0) + wd / 2;
    var sod = (xo <= To + 0.05 && xi <= Ti + 0.05) ? 'OK' : 'CHECK';
    var lean = k.h2 * cant / G * 1000, ho = o2 - lean, hi = i2 + lean;
    var sc = e.str === 0 ? null : e.str - Math.max(ho, hi), ss = sc === null ? '' : (sc >= 0 ? 'OK' : 'INFRINGES');
    var vc = e.Rv > 0 ? a * a / (8 * e.Rv) * 1000 : (e.Rv < 0 ? (a * nE + nE * nE) / (2 * Math.abs(e.Rv)) * 1000 : 0);
    var uf = n0(body.uf_h_mm) - d.dn_total - vc - d.s_c * (Math.max(def, exc) + d.wind.Cw_c * Vw * Vw * (yes(sOpt.wind) ? 1 : 0) + n0(tp.cl_err_mm)) / G * n0(body.uf_hw_mm);
    var ufs = uf >= n0(L.uf_min_body_mm) ? 'OK' : 'BELOW MIN';
    var pl = '', gn = null, gm = null, gs = '';
    if (e.loc === 'platform') {
      pl = ka === 0 ? 'Tangent' : (((e.ps === 'L' && kk > 0) || (e.ps === 'R' && kk < 0)) ? 'Inside' : 'Outside');
      gn = e.pe - k.sill_hw - (pl === 'Inside' ? dgi : (pl === 'Outside' ? dga : 0));
      gm = gn - (k.dT_in + wd / 2 + k.s * ((pl === 'Inside' ? exc : 0) + Dw) / G * (k.hf - k.hc) * 1000 + k.rfl);
      gs = gm < 0 ? 'CONTACT' : (gn > n0(L.prm_gap_mm) ? 'OK (gap > PRM value: info)' : 'OK');
    }
    var ok = (sod === 'CHECK' || ss === 'INFRINGES' || ufs === 'BELOW MIN' || gs === 'CONTACT') ? 'CHECK' : 'OK';
    return { ch: ch, el: e.no, t: t, type: e.type, k: kk, ka: ka, Rl: ka === 0 ? 0 : 1 / ka, cant: cant, V: e.V, Rv: e.Rv, ke: ke.name, sodn: e.sodName, loc: e.loc, wind: e.wind,
      str: e.str, pe: e.pe, ps: e.ps, kg: kg, Rg: Rg, Eeq: Eeq, Iq: Iq, def: def, exc: exc, Vw: Vw, Dw: Dw, wd: wd, dgi: dgi, dga: dga,
      o1: o1, o2: o2, i1: i1, i2: i2, kw1: kw1, kw2: kw2, xo: xo, xi: xi, To: To, Ti: Ti, sod: sod, lean: lean, ho: ho, hi: hi, sc: sc, ss: ss,
      vc: vc, uf: uf, ufs: ufs, pl: pl, gn: gn, gm: gm, gs: gs, ok: ok };
  }

  // ---------------------------------------------------------------- SOD outline and point items (METHOD §8.7)
  // Displaced dynamic-gauge profile in the curve frame (right = OUTSIDE), track plane, m.
  function envelopeTP(r, k, g) {
    var G = k.G, tho = k.s * (r.def + r.Dw) / G + k.thr + k.tht, thi = k.s * (r.exc + r.Dw) / G + k.thr + k.tht;
    function Eout(h) { return r.dga + k.dT_out + g.A_end * r.wd / 2 + k.s * (r.def + r.Dw) / G * (h - k.hc) * 1000 + k.rnd(k.gtOut, h); }
    function Ein(h) { return r.dgi + k.dT_in + r.wd / 2 + k.s * (r.exc + r.Dw) / G * (h - k.hc) * 1000 + k.rnd(k.gt, h); }
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
      return { name: it.name, type: it.type, y: it.y / 1000, z: it.z / 1000, req: n0(it.min_clear_mm), side: it.side || 'both', from: lim(it.ch_from_m, -Infinity), to: lim(it.ch_to_m, Infinity) };
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
    var rows = [], i;
    for (i = 0; i < n; i++) {
      var V = i * step, Eeq = R === 0 ? 0 : G * Math.pow(V / 3.6, 2) / (G_ACC * R), I = Eeq - cant, def = Math.max(I, 0), exc = Math.max(-I, 0);
      var o1 = k.pw1 + dga + k.dT_out + g.A_end * wd / 2 + k.s * (def + Dw) / G * (k.h1 - k.hc) * 1000 + k.rout1;
      var o2 = k.pw2 + dga + k.dT_out + g.A_end * wd / 2 + k.s * (def + Dw) / G * (k.h2 - k.hc) * 1000 + k.rout2;
      var i1 = k.pw1 + dgi + k.dT_in + wd / 2 + k.s * (exc + Dw) / G * (k.h1 - k.hc) * 1000 + k.rnd_in1;
      var i2 = k.pw2 + dgi + k.dT_in + wd / 2 + k.s * (exc + Dw) / G * (k.h2 - k.hc) * 1000 + k.rnd_in2;
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
    var sodc = ext('sodc', lt), itm = ext('itm', lt);
    return {
      length: sw.end - sw.ch0, points: valid.length, step: sw.step,
      def: def, def_lim: n0(tp.cantdef_max_mm), def_ok: def ? def.v <= n0(tp.cantdef_max_mm) : true,
      xo: xo, xi: xi, sod_n: sodN.length, sod_first: firstSod ? firstSod.ch : null,
      sc: sc, sc_ok: sc ? sc.v >= 0 : null, uf: uf, uf_lim: n0(L.uf_min_body_mm), uf_ok: uf ? uf.v >= n0(L.uf_min_body_mm) : true,
      gm: gm, gm_ok: gm ? gm.v >= 0 : null, gn: gn, prm: n0(L.prm_gap_mm), gn_info: gn ? gn.v > n0(L.prm_gap_mm) : false,
      sodc: sodc, sodc_req: n0((p.sod || {}).margin_mm, 50), sodo_n: valid.filter(function (r) { return r.sods === 'CHECK'; }).length,
      sodo_pts: valid.filter(function (r) { return r.sodc !== null && r.sodc !== undefined; }).length,
      itm: itm, it_n: valid.filter(function (r) { return r.its === 'CHECK'; }).length, it_pts: valid.filter(function (r) { return r.itm !== null && r.itm !== undefined; }).length,
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
    var warnings = [], sc = sodContext(p);
    var out = cars.map(function (c) {
      var d = deriveCar(p, c, sOpt), k = dynConstants(p, d, sOpt, dOpt);
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
      return { car: c.name, count: c.count, derived: d, consts: { s: k.s, hc: k.hc, Cw: k.Cw, dT_in: k.dT_in, dT_out: k.dT_out, thr: k.thr, tht: k.tht,
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
      ['sc', 'uf', 'gm', 'sodc', 'itm'].forEach(function (k2) { r[k2] = null; take(k2, function (a, b) { return a < b; }); });
      out.forEach(function (o) { var x = o.rows[i]; if (x.car === r.sodc_car) { r.sodp = x.sodp; } if (x.car === r.itm_car) { r.itn = x.itn; r.itc = x.itc; } });
      r.sods = out.some(function (o) { return o.rows[i].sods === 'CHECK'; }) ? 'CHECK' : (r.sodc === null ? '' : 'OK');
      r.its = out.some(function (o) { return o.rows[i].its === 'CHECK'; }) ? 'CHECK' : (r.itm === null ? '' : 'OK');
      out.forEach(function (o) { var x = o.rows[i]; if (x.sod === 'CHECK') { r.sod = 'CHECK'; } if (x.ok === 'CHECK') { r.ok = 'CHECK'; } });
      r.car = r.xo_car;
      return r;
    });
    var summary = lineSummary(p, env, sw);
    ['def', 'xo', 'xi', 'sc', 'uf', 'gm', 'gn', 'sodc', 'itm'].forEach(function (key) {
      if (summary[key]) { var row = env.filter(function (r) { return r.ch === summary[key].ch; })[0]; summary[key].car = row ? row[key + '_car'] : null; }
    });
    return { engineVersion: VERSION, sweep: { ch0: sw.ch0, end: sw.end, step: sw.step, n: sw.pts.length }, ke: kes.__default.name,
      cars: out, envelope: env, summary: summary, elements: elementSummary(tm, env), ok: summary.ok, warnings: warnings };
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
    VERSION: VERSION, CASES: CASES, G_ACC: G_ACC, playCalc: playCalc,
    trackModel: trackModel, locate: locate, sweepChainages: sweepChainages, dynamicRun: dynamicRun, crossSection: crossSection,
    envelopeTP: envelopeTP, polySigned: polySigned, sodPolygon: sodPolygon, sodContext: sodContext, sodCheck: sodCheck,
    outline: outline, keWidth: keWidth, keTop: keTop, profileWidth: profileWidth, clearance: clearance,
    carGeometry: carGeometry, deriveCar: deriveCar, caseParams: caseParams, lateralE: lateralE, staticRun: staticRun,
    enRules: enRules, enZ: enZ, enReduction: enReduction, enE: enE, swayFit: swayFit, swayEval: swayEval, gaugeTestPlan: gaugeTestPlan
  };
}));
