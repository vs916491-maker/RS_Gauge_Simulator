/*
 * CALCULATION ENGINE - pure, deterministic, DOM-free (loads in Node for tests).
 * Implements METHOD.md (the workbook method "Vehicle Gauging Calculation Tool"):
 *   derived car data (pivots, yaw factors, wind equivalent cant, vertical travels, theoretical s and hc,
 *   shared-bogie check), the six static cases per car type (interior / exterior / car end x tare / crush),
 *   point-by-point clearance to the customer KE, Method A maximum static half-width and vertical checks.
 * Input: a project normalised by js/model.js (profile coordinates in mm). Never mutated.
 * Attaches to RSGAUGE.engine.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.RSGAUGE = root.RSGAUGE || {}; root.RSGAUGE.engine = api; }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '2.0.0';
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
      var r = { i: i + 1, pt: q.pt, x0: q.x * 1000, h0: q.h * 1000, E: E, x: x * 1000, h: h * 1000, W: W * 1000, dX: dX, H: Hk * 1000, dH: dH, c: c, ok: c >= 0 };
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
      res.ok = cases.every(function (r) { return r.ok; }) && res.vertical.every(function (r) { return r.info || r.ok; });
      if (worst && (!gov || worst.min.c < gov.c)) { gov = { car: c.name, id: worst.id, label: worst.label, c: worst.min.c, pt: worst.min.pt }; }
      return res;
    });
    return {
      engineVersion: VERSION, ke: { name: ke.name, top: ke.top * 1000, nUp: ke.nUp, points: keP.points },
      cars: out, governing: gov, ok: out.every(function (r) { return r.ok; }), warnings: warnings
    };
  }

  // Wheel–rail play calculator (information, Bogie Inputs §5): l = nominal gauge + gauge tolerance, d = BB + 2·ef.
  function playCalc(p, b) {
    var l = n0(p.train.gauge_mm) + n0(p.track.params.g_tol_mm), dNew = n0(b.bb_mm) + 2 * n0(b.ef_new_mm), dWorn = n0(b.bb_mm) + 2 * n0(b.ef_worn_mm);
    return { l: l, d_new: dNew, d_worn: dWorn, half_new: (l - dNew) / 2, half_worn: (l - dWorn) / 2 };
  }

  return {
    VERSION: VERSION, CASES: CASES, G_ACC: G_ACC, playCalc: playCalc,
    outline: outline, keWidth: keWidth, keTop: keTop, profileWidth: profileWidth, clearance: clearance,
    carGeometry: carGeometry, deriveCar: deriveCar, caseParams: caseParams, lateralE: lateralE, staticRun: staticRun
  };
}));
