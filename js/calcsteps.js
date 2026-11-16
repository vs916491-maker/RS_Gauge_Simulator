/* Rolling Stock Gauge Simulator — "Calculation Method" tab content.
 * DOM-free: builds the step-by-step explanation of the calculation, each step with its standard references, the
 * formulae and a worked example whose numbers come from js/engine.js results of the loaded project (no equations here:
 * the example rows only show values the engine computed). Standard references are given at clause level where the
 * clause is known (EN 15273-2:2009) and by document otherwise; no standard text is reproduced.
 */
(function (root, factory) {
  'use strict';
  var R = root.RSGAUGE = root.RSGAUGE || {};
  var api = factory();
  R.calcsteps = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function fmt(v, d) {
    if (v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v))) { return '–'; }
    if (typeof v !== 'number') { return String(v); }
    var s = v.toFixed(d === undefined ? 1 : d);
    return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
  }
  var SEC = { int: 'Interior (between the bogie centres)', ext: 'Exterior (beyond the bogie centre)', end: 'Car end' };

  // Standard references used by the steps (document, clause, what it covers).
  var REF = {
    en1: { doc: 'EN 15273-1', what: 'Gauges – general: terms (reference profile, associated rules, static / kinematic / dynamic gauges), common rules' },
    en2: { doc: 'EN 15273-2', what: 'Gauges – rolling stock gauge' },
    en3: { doc: 'EN 15273-3', what: 'Gauges – structure (infrastructure) gauge and its allowances' },
    uic1: { doc: 'UIC 505-1', what: 'Railway transport stock – rolling stock construction gauge (origin of the kinematic reduction formulae)' },
    uic4: { doc: 'UIC 505-4', what: 'Effects of the kinematic gauge on the positioning of structures and track centres' },
    uic5: { doc: 'UIC 505-5', what: 'Basic conditions common to 505-1 and 505-4 (background to the reference values and terms)' },
    metro: { doc: 'Metro SOD practice', what: 'Customer kinematic envelope (KE) on tangent track + Schedule of Dimensions (SOD) with curve allowances' },
    tool: { doc: 'METHOD.md', what: 'This tool\'s specification (Method & Assumptions tab)' }
  };
  function ref(key, clause) { var r = REF[key]; return { doc: r.doc, clause: clause || '', what: r.what }; }

  // ctx: { p, sres, dres, car, caseId, ch, sway, plan }
  function steps(ctx) {
    var out = [], p = ctx.p, s = ctx.sres, d = ctx.dres;
    var c = s ? (s.cars.filter(function (x) { return x.car === ctx.car; })[0] || s.cars[0]) : null;
    var k = c ? (c.cases.filter(function (x) { return x.id === ctx.caseId; })[0] || c.cases.filter(function (x) { return c.governing && x.id === c.governing.id; })[0] || c.cases[0]) : null;
    var cp = k ? k.params : null, q = k ? k.min : null, dv = c ? c.derived : null, g = dv ? dv.geo : null, G = p && p.train ? (p.train.L_mm || 1500) : 1500;
    function add(o) { out.push(o); }
    function ex(head, rows, note) { return { head: head || ['Quantity', 'Value'], rows: rows, note: note || '' }; }
    var noStatic = 'Run the static simulation (or fix the input errors) to see the numbers of this project here.';

    // ================================================================ A. Concepts
    add({ part: 'A. Concepts', id: 'concepts', title: 'A1. What gauging checks',
      refs: [ref('en1'), ref('en2', '§5.1 static and kinematic gauges, §5.2 dynamic methods'), ref('uic1'), ref('metro')],
      text: [
        'A gauge is a set of rules: a **reference profile** (a cross-section) and the **associated rules** that say how vehicle and track movements are taken into account. The rolling stock side uses them to size the vehicle, the infrastructure side to place structures.',
        '**Static gauge:** the vehicle at rest on straight, level track must fit inside the reference profile reduced for the movements that the profile does not already include. **Kinematic gauge** (EN 15273-2 §5.1, from UIC 505-1): the reference profile already contains some movements (a reference flexibility, cant, overthrow allowance); the vehicle\'s own movements beyond these are taken off as reductions Ei / Ea. **Dynamic gauge** (EN 15273-2 §5.2): the vehicle\'s swept envelope, from geometric formulae or simulation, must stay inside a dynamic reference profile.',
        'Metro customers usually give a **kinematic envelope (KE)**: the space the car may occupy on straight track with all its movements, and a **Schedule of Dimensions (SOD)** for the structures, with curve allowances added on curves. The tool follows that practice (the owner\'s gauging workbook) and offers the EN 15273-2 kinematic method as a cross-check.'
      ] });
    add({ part: 'A. Concepts', id: 'flow', title: 'A2. The calculation route in this tool',
      refs: [ref('tool', '§1–§13')],
      text: [
        '1. **Static (Static Simulation):** each RS profile point is displaced by every movement of the case and its clearance to the customer KE is measured (Method B, forward); the largest static half-width the KE allows at each height follows (Method A) and, for a backward or both study, the full maximum construction gauge outline (B8a); vertical checks complete it. Optional: EN 15273-2 kinematic reductions with the customer KE as reference profile.',
        '2. **Dynamic (Dynamic Simulation):** along the line, at every chainage and for every car type, the required half-widths in the actual curve, cant and speed are compared with the KE and the SOD curve allowance; the whole profile is checked against the SOD outline, structures, underframe and platforms.',
        '3. **Tests:** the sway test confirms s and hc; the kinematic gauge test plan says how to show the static result on a test stand.',
        'The steps below follow this route. Numbers are those of the loaded project for the car type and case chosen above.'
      ] });

    // ================================================================ B. Static
    add({ part: 'B. Static check', id: 'geometry', title: 'B1. Vehicle geometry and the sections checked',
      refs: [ref('en2', 'Annex A.3.9 symbols a, n, p'), ref('uic1')],
      text: [
        'The body is carried on two pivots (bogie centres) a apart. A cross-section is placed by its distance **n** from the nearest pivot: between the pivots (interior, worst near mid-car, n = a/2) or beyond them (exterior, car end). The bogie wheelbase **p** matters for the overthrow and the yaw of the bogie in the track.',
        'Lateral plays at the bogies shift the body; a section **beyond** a pivot moves more because the body can also yaw. The yaw factor **A** multiplies the bogie plays for those sections.'
      ],
      formulas: ['A = (2·n + a) / a    (sections beyond the pivot; A = 1 between the pivots)'],
      example: c ? ex(null, [['Car type / case', c.car + ' / ' + k.label], ['Pivot distance a', fmt(g.a, 3) + ' m'], ['Bogie wheelbase p', fmt(dv.bogie.p, 3) + ' m'],
        ['Section of this case', SEC[k.section]], ['Position n from the pivot', fmt(cp.n, 3) + ' m'], ['Yaw factor A', fmt(cp.A, 4)]]) : null, nodata: noStatic });

    add({ part: 'B. Static check', id: 'overthrow', title: 'B2. Geometric overthrow on a curve',
      refs: [ref('en2', 'Annex A.3.9 (Δ terms)'), ref('uic1'), ref('en3', 'overthrow allowance of the structure gauge')],
      text: [
        'On a curve of radius R a section between the pivots lies **inside** the track centre line (the chord effect), a section beyond the pivots swings **outside**. The p²/4 term corrects for the bogie itself sitting on the curve.',
        'The static check is made at the static-check radius Rs of the Track Data (0 = straight track, then no overthrow); in the dynamic check the actual curvature is used (step C2).'
      ],
      formulas: ['Inside (between the pivots):  dgi = (a·n − n² + p²/4) / (2·R)', 'Outside (beyond the pivots):  dga = (a·n + n² − p²/4) / (2·R)'],
      example: c ? ex(null, [['Static radius Rs', p.track.params.R_static_m ? fmt(p.track.params.R_static_m, 0) + ' m' : 'straight (0)'], ['Overthrow at this section', fmt(cp.dg, 2) + ' mm']]) : null, nodata: noStatic });

    add({ part: 'B. Static check', id: 'plays', title: 'B3. Lateral plays and wear',
      refs: [ref('en2', 'Annex A.3.9 ((l − d)/2, q, w)'), ref('uic1'), ref('metro', 'rail wear, gauge widening')],
      text: [
        '**Wheel–rail play (l − d)/2:** half the difference between track gauge and the wheelset\'s flange distance, with worn wheels. **q:** primary (axlebox) lateral play. **w:** secondary (bogie–body) lateral play to the bump stops. Metro methods add **rail gauge-face wear** and half the **gauge widening** on tight curves.',
        'Secondary clearance and the curve (METHOD §5.3a): on straight track the body can move w∞ either way before the lateral stop; in a curve rotation or lateral stops may leave a different clearance towards the inside, **w_i(R)**, and towards the outside, **w_a(R)** (given at 250 m and 150 m, linear in 1/R). Between the pivots the body moves to the inside (w_i); beyond them it yaws – to the inside at the far bogie and to the outside at the near bogie: w_i·n/a + w_a·(n + a)/a, which is w·A when both are equal.',
        'All of these move the body bodily sideways; for sections beyond a pivot they are multiplied by A. Together with the overthrow they form the translation **T**, the same at every height.'
      ],
      formulas: ['T = dg + [ (l−d)/2 + q + w + wear + widening/2 ] · A'],
      example: c ? ex(['Term (× A)', 'mm'], [['Wheel–rail play', fmt(cp.play, 2)], ['Primary play q', fmt(cp.q, 2)], ['Secondary play w', fmt(cp.w, 2)], ['Rail wear', fmt(cp.fw, 2)], ['Gauge widening / 2', fmt(cp.widen, 2)], ['Overthrow dg', fmt(cp.dg, 2)], ['Translation T', fmt(cp.T, 2)]]) : null, nodata: noStatic });

    var rsc = c && c.rotStops && c.rotStops.length ? c : (s ? s.cars.filter(function (x) { return x.rotStops && x.rotStops.length; })[0] : null), rsr = rsc ? rsc.rotStops[0] : null;
    add({ part: 'B. Static check', id: 'rotstops', title: 'B3a. Rotation stops: free rotation, contact in service and the limit on w',
      refs: [ref('en2', 'Annex A.3.9 (w varying with the radius: w_i(R), w_a(R))'), ref('uic1'), ref('tool', '§5.3b')],
      text: [
        'On a curve the bogie turns relative to the body by ψ = asin(a / 2R). A rotation stop at a distance x from the bogie centre closes by ψ·x – the front stop on one side and the rear stop on the other, a **diagonal pair**. Design rules: the stop must not obstruct the rotation, and two diagonally opposite stops must never be in contact at the same time; so at the smallest radius ψ·x must stay below the gap.',
        'In service the body also drifts sideways on the air springs under the uncompensated lateral acceleration (cant deficiency + wind). The stop then touches already on wider curves; too many contacts are felt by the passengers, so the tool gives the contact radius and the share of the line below it, and checks a comfort radius if one is entered.',
        'The stops also limit the lateral clearance left at the pivot: w_rs(R) = gap + travel − ψ·x in either direction. This is the physical origin of a w that falls with the radius (w_i(R), w_a(R)); the option *Rotation stops limit w(R)* applies it to every method.'
      ],
      formulas: ['ψ = asin(a / 2R),  closure = ψ·x,  margin = gap − ψ(R_min)·x ≥ 0', 'y_q = (m/2)·g·(I + Dw)/G / (na·ky2),  R_c = a / (2·sin((gap − y_q)/x))', 'w_rs(R) = gap + travel − ψ(R)·x'],
      example: rsr ? ex(null, [['Car type / bogie', rsc.car + ' / end ' + rsr.end + ', ' + rsr.bogie], ['x / gap / travel', fmt(rsr.x, 2) + ' m / ' + fmt(rsr.gap, 0) + ' / ' + fmt(rsr.travel, 0) + ' mm'],
        ['R min / ψ', fmt(rsr.Rmin, 0) + ' m / ' + fmt(rsr.psi * 1000, 2) + ' mrad'], ['Closure / margin to contact', fmt(rsr.closure, 1) + ' / ' + fmt(rsr.margin, 1) + ' mm (' + (rsr.ok ? 'turns freely' : 'BLOCKED') + ')'],
        ['Drift in service / contact below R', fmt(rsr.yq, 1) + ' mm / ' + (rsr.Rrun === Infinity ? 'any radius' : fmt(rsr.Rrun, 0) + ' m')],
        ['w limit straight / 250 m / 150 m', fmt(rsr.w_lim.inf, 1) + ' / ' + fmt(rsr.w_lim.r250, 1) + ' / ' + fmt(rsr.w_lim.r150, 1) + ' mm']]) : null,
      nodata: s ? 'Enter rotation stops for a bogie type (Car body & Bogie tab) and run again to see the numbers.' : noStatic });

    add({ part: 'B. Static check', id: 'roll', title: 'B4. Quasi-static roll: cant, wind, flexibility s and roll centre hc',
      refs: [ref('en2', 'Annex A.3.8.1 quasi-static term; §5.1.4 (s measured by EN 14363)'), ref('uic5', 'reference flexibility s0 and roll centre hc0'), ref('uic1')],
      text: [
        'Standing on cant (inside of the curve, cant **excess**) or running with cant **deficiency** (outside), the body rolls on its suspension. The **flexibility coefficient s** is the ratio of body roll to track cant; the body turns about the **roll centre** at height hc. A point at height h moves sideways by s·(cant)/L·(h − hc) and, on the low side, drops by the roll angle × its half-width.',
        'Side wind acts like extra cant deficiency: the **wind equivalent cant** Dw = Cw·V², from the side area, mass and air density. In the EN kinematic gauge only the part of the roll above the reference values (s0, hc0, D0) is a reduction (step B9); in the metro KE method the full roll is counted.'
      ],
      formulas: ['θq = s · (cant + Dw) / L', 'lateral roll displacement at h:  θq · (h − hc)', 'vertical drop of a point at half-width x:  θ · x'],
      example: c ? ex(null, [['Load', k.load], ['Cant ' + (k.section === 'int' ? 'excess' : 'deficiency'), fmt(cp.cant, 1) + ' mm'], ['Wind equivalent cant Dw', fmt(cp.wind, 2) + ' mm'],
        ['Flexibility s / roll centre hc', fmt(cp.s, 3) + ' / ' + fmt(cp.hc, 3) + ' m'], ['Rail-centre distance L', fmt(G, 0) + ' mm'], ['Roll angle θq', fmt(cp.thq * 1000, 3) + ' mrad'],
        ['At the governing point ' + q.pt + ' (h = ' + fmt(q.h0, 0) + ' mm)', fmt(q.roll, 2) + ' mm lateral']]) : null, nodata: noStatic });

    add({ part: 'B. Static check', id: 'random', title: 'B5. Random track and vehicle effects',
      refs: [ref('en3', 'random allowances combined quadratically'), ref('uic4'), ref('metro', 'track tolerances in the vehicle envelope')],
      text: [
        'Track gauge and alignment tolerances, the cross-level (twist) error and the vehicle\'s rigid tilt on it are random: they do not all reach their extreme at once. In EN 15273-3 / UIC 505-4 they are infrastructure allowances combined as a square root of a sum of squares; metro customers often ask for them inside the vehicle envelope.',
        'The tool adds them linearly (conservative) or as K·√Σ² (option "combination of random terms"), as the customer method requires.'
      ],
      formulas: ['θr = s · cl / L  (roll from the cross-level error)', 'θt = cl / L  (rigid tilt, if selected)', 'linear:  Σ = gauge tol. + alignment + θr·(h − hc) + θt·h      RSS:  Σ = K·√(sum of squares)'],
      example: c ? ex(null, [['Gauge tolerance', fmt(cp.rnd_gauge, 2) + ' mm'], ['Alignment tolerance', fmt(cp.rnd_align, 2) + ' mm'], ['Cross-level error cl', fmt(cp.cl, 1) + ' mm'],
        ['θr / θt', fmt(cp.thr * 1000, 3) + ' / ' + fmt(cp.tht * 1000, 3) + ' mrad'], ['Combination', p.settings['static'].comb === 'rss' ? 'RSS, K = ' + p.settings['static'].K_rss : 'linear']]) : null, nodata: noStatic });

    add({ part: 'B. Static check', id: 'total', title: 'B6. Total displacement of a profile point',
      refs: [ref('en2', '§5.1.1'), ref('tool', '§6.2–6.3')],
      text: [
        'Each point of the RS profile (x0, h0) is moved sideways by the translation, the roll and the random terms at its own height, and vertically by the roll, the body lowering under crush load and the upward suspension movement if selected.'
      ],
      formulas: ['E(h) = T + θq·(h − hc) + Σ(h)', 'x = x0 + E(h0)', 'h = h0 − (θq + θr + θt)·x0 − lowering + upward'],
      example: c ? ex(['Governing point ' + q.pt, 'mm'], [['Static x0 / h0', fmt(q.x0, 1) + ' / ' + fmt(q.h0, 1)], ['Lateral E(h0)', fmt(q.E, 2)], ['Displaced x / h', fmt(q.x, 1) + ' / ' + fmt(q.h, 1)],
        ['Body lowering (crush) / upward movement', fmt(cp.drop, 1) + ' / ' + fmt(cp.up, 1)]]) : null, nodata: noStatic });

    add({ part: 'B. Static check', id: 'methodB', title: 'B7. Clearance to the customer KE (Method B)',
      refs: [ref('metro', 'generated KE vs customer KE'), ref('tool', '§6.4')],
      text: [
        'At the displaced point the horizontal distance to the KE (ΔX, at the point\'s height) and the vertical distance (ΔH, at its half-width) are taken. Near a sloping KE edge the true distance is smaller than either; the tool uses the distance to the straight line through both KE points, which is exact on a straight KE segment and conservative near corners. Negative = the point is outside the KE.',
        'All cases (interior, exterior and car end × every load case of the Load definition, e.g. AW0, AW2, AW3, AW4) and all points are checked; the smallest value governs.'
      ],
      formulas: ['c = ΔX·ΔH / √(ΔX² + ΔH²)'],
      example: c ? ex(null, [['KE half-width at h / ΔX', fmt(q.W, 1) + ' / ' + fmt(q.dX, 1) + ' mm'], ['KE height at x / ΔH', fmt(q.H, 1) + ' / ' + fmt(q.dH, 1) + ' mm'],
        ['Clearance c at ' + q.pt, fmt(q.c, 2) + ' mm ' + (q.c >= 0 ? '(inside the KE)' : '(INFRINGES)')], ['Governing of the whole train', s.governing ? s.governing.car + ', ' + s.governing.label + ': ' + fmt(s.governing.c, 2) + ' mm' : '–']]) : null, nodata: noStatic });

    var ma = c ? c.methodA.filter(function (r) { return r.h >= q.h0; })[0] || c.methodA[c.methodA.length - 1] : null;
    add({ part: 'B. Static check', id: 'methodA', title: 'B8. Maximum static profile from the KE (Method A)',
      refs: [ref('en2', '§5.1.1 maximum construction gauge = reference profile − reductions'), ref('uic1')],
      text: [
        'Turned round, the same movements give the largest **static** half-width the KE allows at each height: the KE half-width minus the movement E(h) of the worst load case of the section. This is how a car body profile is derived from the customer KE at the start of a design.'
      ],
      formulas: ['W_max(h) = W_KE(h) − max over the load cases of E_load(h)'],
      example: ma ? ex(null, [['Height h', fmt(ma.h, 0) + ' mm'], ['KE half-width', fmt(ma.W, 1) + ' mm'], ['Max static half-width – interior / exterior / car end', fmt(ma.max_int, 1) + ' / ' + fmt(ma.max_ext, 1) + ' / ' + fmt(ma.max_end, 1) + ' mm'],
        ['Margin of the RS profile – interior / exterior / car end', fmt(ma.margin_int, 1) + ' / ' + fmt(ma.margin_ext, 1) + ' / ' + fmt(ma.margin_end, 1) + ' mm']]) : null, nodata: noStatic });

    var mg = c && c.mcg, mgc = mg ? mg.car : null, mgs = mg ? mg[k.section] : null;
    add({ part: 'B. Static check', id: 'mcg', title: 'B8a. Maximum construction gauge outline (backward study)',
      refs: [ref('en1', 'terms: maximum construction gauge'), ref('en2', '§5.1.1 maximum construction gauge = reference profile − reductions'), ref('uic1'), ref('tool', '§7.3')],
      text: [
        'Method A only gives half-widths on a height grid and ignores the vertical shift of the displaced point. The **maximum construction gauge outline** is the full backward answer: the largest closed cross-section whose every point, moved by **every** movement of every load case of the section (the same Method B displacement: lateral E(h), roll tilt θ·x, body lowering Δz, upward movement), still lies inside the customer KE.',
        'At each height (default every 10 mm, refined in between where the outline would cut outside) the tool searches the largest half-width with all cases inside the KE. The top is the KE top minus the upward movement Σu (on the centre line, or combined with roll as the option says); the bottom on the centre line is the customer\'s minimum body-equipment height plus the downward movement Σd and the vertical-curve lowering, rising towards the side with the roll angle of the crush case. **Whole car** = all three sections together (the profile of a constant-section car body).',
        'Study direction (Train Configuration): **Backward** uses these outlines as the section profiles (the Method B clearances then close at about 0 mm, a self-check) and the whole-car outline on the route; **Both** also checks the RS profiles and shows how far they stay inside the gauge; **Forward** does not derive it.'
      ],
      formulas: ['x_max(h) = largest x with c(x + E(h), h − θ·x − Δz + up) ≥ 0 for every case of the section', 'top = H_KE,top − Σu,  bottom(y) = cb + Σd + v_c + θ_crush·y'],
      example: mgc && mgc.ok ? ex(null, [['Car type / study', c.car + ' / ' + (s.study || 'both')], ['Whole car: top / bottom on the centre line', fmt(mgc.top, 1) + ' / ' + fmt(mgc.bottom, 1) + ' mm'],
        ['Whole car: largest half-width', fmt(mgc.maxWidth, 1) + ' mm (' + mgc.points.length + ' points)'],
        [SEC[k.section] + ': largest half-width', mgs && mgs.ok ? fmt(mgs.maxWidth, 1) + ' mm' : '–'],
        ['RS profile margin side / top (' + SEC[k.section] + ')', mgs && mgs.rs ? (mgs.rs.min ? fmt(mgs.rs.min.margin, 1) + ' mm at ' + mgs.rs.min.pt : '–') + ' / ' + fmt(mgs.rs.topMargin, 1) + ' mm' : 'not checked (backward study)']]) : null,
      nodata: s ? 'Set the study direction to Backward or Both on Train Configuration and run again to see the outline.' : noStatic });

    var en = c && c.en, eq = en ? en.checks[k.section].min : null;
    add({ part: 'B. Static check', id: 'en', title: 'B9. EN 15273-2 kinematic reductions Ei / Ea',
      refs: [ref('en2', 'Annex A.3.8 (z), A.3.9.1 traction units, A.3.9.2 motor coaches, A.3.9.3 coaches, Table A.4'), ref('uic1'), ref('uic5')],
      text: [
        'In a kinematic gauge the reference profile already contains a reference roll (flexibility s0, roll centre hc0, cant D0 / I0), an overthrow allowance k = Ck/R and some lateral play. The vehicle\'s reductions are only the **excess** of its own movements over these: Ei between the bogie centres, Ea beyond them. The formula set depends on the running gear (Table A.4): coach formulae without a motor bogie, traction-unit formulae with two, and for one motor bogie the traction-unit formulae (note a) or the motor-coach formulae A.3.9.2 (option). When the secondary clearance w changes on curves (w at 250 m and 150 m, or variable stops starting at a given radius), the formulae of A.3.9.1.2 / A.3.9.3.2 are added.',
        'The quasi-static term z counts only the roll above the reference values and only above hc0. Maximum construction gauge = reference profile half-width − E. The tool uses the customer KE as the reference profile with the G1 rules as editable defaults.',
        'Open doors and deployed steps (A.3.14) may stick out of the maximum construction gauge when the train is at a standstill (≤ 5 km/h): above 1,05 m an open door by up to 0,2 m; lower down, and for steps, by the lateral clearance that a stopped car does not use – w_i (at most 0,035 m) between the bogies, or the formulae A.105 / A.106 beyond them. A.3.15.2 then places the steps so that the platform gap stays within the allowed value from straight track down to the verification radius.',
        'Pantographs (A.3.12) are checked by how far the raised head moves sideways compared with a reference pantograph that the infrastructure already allows for: P = geometric overthrow beyond the allowance (term with − 5), plus the vehicle\'s plays beyond 37,5 mm (j\'), plus the roll, flexibility and tolerances of the pantograph beyond the reference values (z\' at 6,5 m, z" at 5,0 m). P ≤ 0 means the head stays inside. Pantographs are mounted close to a bogie centre because the mid-car overthrow on a 150 m curve would be far too large.',
        'A static gauge (A.2) is the older, simpler form: the reference profile is static, the vehicle\'s roll is not added (no z), and the method may only be used when the flexibility coefficient s does not exceed the limit of the gauge (0,2 for G1, §5.1.3). The reductions use Δ not below 7,5 m² and an allowance of 0,075 m; lower parts up to 0,43 m lose the wheel wear and the total suspension travel.',
        'Parts carried by the bogie (A.3.11) use the formulae of vehicles with independent axles (A.56–A.59): the bogie is treated as a short vehicle whose "pivots" are its end axles (a = distance between them), with no secondary clearance (w = 0). With a ≈ 2–3 m the straight-track formulae A.27 / A.30 normally apply.'
      ],
      formulas: ['Δi = a·n − n² + p²/4,  Δa = a·n + n² − p²/4', 'traction unit, curve branch:  Ei = Δi/(2·R1) + (l_max − d)/2 + q + w + z + x − e0 − Ck/R1', 'z = s·D0/L·(h − hc) + [ s·(Dlim − D0)/L·(h − hc) − s0·(Dlim − D0)/L·(h − hc0) ]>0'],
      example: eq ? ex(null, [['Formula set', en.set + ' (' + en.clause + ')'], ['Section / governing height', SEC[k.section] + ' / ' + fmt(eq.h, 0) + ' mm'], ['Reduction E / z_kin', fmt(eq.E, 2) + ' / ' + fmt(eq.z, 2) + ' mm (' + eq.branch + ' branch, ' + eq.load + ')'],
        ['EN max half-width / profile', fmt(eq.max, 1) + ' / ' + fmt(eq.x, 1) + ' mm'], ['Margin', fmt(eq.margin, 2) + ' mm']]) : null,
      nodata: s ? 'Select "Also check EN 15273-2:2009 kinematic" on the Static Simulation tab and run again to see the numbers.' : noStatic });

    add({ part: 'B. Static check', id: 'vertical', title: 'B10. Vertical checks',
      refs: [ref('en2', 'Annex A.3.4 heights above the running surface, A.3.4.1.5 gradient transitions'), ref('uic1')],
      text: [
        'Further vertical terms (METHOD §5.3c, optional): the car body is pre-cambered upwards at mid-car when empty and sags when loaded; the ends deflect; a height difference between the two pivots (different suspension state or wheel wear of the bogies) pitches the body, so parts beyond the pivots rise at one end and fall at the other by Δz·n/a; vertical track unevenness raises and lowers the car, vertical rail head wear lowers it. Each section gets its own upward and downward addition.',
        'The roof plus the upward suspension movement must stay below the KE top; underframe equipment, after all downward movements (wheel wear, suspension deflection, roll of the body on the low side and the vertical-curve effect at mid-car / car end), must keep the customer\'s minimum height above the rail.',
        'With the EN 15273-2 option the heights of A.3.4 are checked as well. Each lower part lies in a body zone of Figure A.7: A (between the bogies, inside the air springs b2), B (between, outside b2), C (beyond the bogies, outside b2) or D (beyond, inside b2). Table A.1 gives its downward displacement: the suspension displacement Aff (air springs deflated), the difference ΔAff between the bogies weighted by n/a, a roll term 0,1·s·(b − b2) outside the springs, and the wheel wear Usr with the radius difference ΔUsr weighted by n/a. Bogie-mounted parts move with the primary suspension and the wheels only. On a vertical curve of 500 m the lower limit rises by the part of the sagitta above the 80 mm already in the reference profile (A.16 / A.17). For the roof, EN adds 10 mm per suspension level for the extension and reduces the allowed height by A.18 / A.19.'
      ],
      formulas: ['crest at mid-car:  a² / (8·Rv)', 'sag at the car end:  (a·n + n²) / (2·|Rv|)', 'EN zone C:  Aff + ΔAff·n/a + 0,1·s·(b − b2) + Usr + ΔUsr·n/a', 'EN gradient between / beyond (m):  [(a·n − n² + p²/4)/1000 − 0,08]>0  /  [(a·n + n² − p²/4)/1000 − 0,08]>0'],
      example: c ? ex(['Check', 'Value / limit / margin (mm)'], c.vertical.map(function (v) { return [v.label, fmt(v.value, 1) + (v.info ? '' : ' / ' + fmt(v.limit, 1) + ' / ' + fmt(v.margin, 1))]; }).concat(
        c.en && c.en.vertical ? c.en.vertical.lower.map(function (q) { return ['EN lower part ' + q.name + ' (zone ' + (q.zone === 'bogie' ? 'bogie' : q.zone) + ')', fmt(q.hmin, 1) + ' / ' + fmt(q.req, 1) + ' / ' + fmt(q.margin, 1)]; }).concat(
          c.en.vertical.upper.map(function (q) { return ['EN maximum height ' + SEC[q.section], fmt(q.value, 1) + ' / ' + fmt(q.lim, 1) + ' / ' + fmt(q.margin, 1)]; })) : [])) : null, nodata: noStatic });

    // ================================================================ C. Dynamic
    var dc = d ? (d.cars.filter(function (x) { return x.car === (c ? c.car : ctx.car); })[0] || d.cars[0]) : null, r = null;
    if (dc) {
      var best = null;
      dc.rows.forEach(function (x) { if (ctx.ch !== null && ctx.ch !== undefined && isFinite(ctx.ch)) { if (x.ch <= ctx.ch + 1e-9) { best = x; } } else if (!best || x.xo > best.xo) { best = x; } });
      r = best || dc.rows[0];
    }
    var noDyn = 'Run the dynamic simulation to see the numbers of this project here.', kk = dc ? dc._k : null;
    add({ part: 'C. Dynamic check along the line', id: 'track', title: 'C1. The line, chainage by chainage',
      refs: [ref('en2', '§5.2.2 movement calculation by geometric formulae'), ref('metro')],
      text: [
        'The Track Data describe the line as tangents, transitions and circular curves with cant, speed limit, KE, location and structures. The line is evaluated every Δx; curvature and cant change linearly along transitions. Because a car spans several sweep points, the **governing curvature** under the car is the largest within ±(a/2 + n_end + p/2) (conservative option).'
      ],
      formulas: ['window = ROUNDUP((a/2 + n_end + p/2) / Δx) points each side'],
      example: r ? ex(null, [['Car type / chainage', dc.car + ' / ' + fmt(r.ch, 1) + ' m'], ['Element', r.type], ['Local radius / governing radius', (r.Rl ? fmt(r.Rl, 0) : '∞') + ' / ' + (r.Rg ? fmt(r.Rg, 0) : '∞') + ' m'],
        ['Cant / speed limit', fmt(r.cant, 1) + ' mm / ' + fmt(r.V, 0) + ' km/h'], ['Window', dc.consts.win + ' points']]) : null, nodata: noDyn });

    add({ part: 'C. Dynamic check along the line', id: 'deficiency', title: 'C2. Cant deficiency, excess and overthrow at the chainage',
      refs: [ref('en2', 'Annex A.3.8 (I, D)'), ref('uic5'), ref('metro')],
      text: [
        'At line speed the car end is checked on the **outside** with the cant deficiency; stopped, mid-car is checked on the **inside** with the full cant as excess. Overthrow uses the governing curvature.'
      ],
      formulas: ['equilibrium cant  Eeq = L·(V/3.6)²·|k| / g', 'deficiency I = max(Eeq − E, 0),  excess = E', 'dgi = (a² + p²)/8·|k|,  dga = (a·n + n² − p²/4)/2·|k|'],
      example: r ? ex(null, [['Equilibrium cant', fmt(r.Eeq, 1) + ' mm'], ['Deficiency / excess', fmt(r.def, 1) + ' / ' + fmt(r.exc, 1) + ' mm'], ['Wind speed / equivalent cant', fmt(r.Vw, 0) + ' km/h / ' + fmt(r.Dw, 1) + ' mm'],
        ['Overthrow mid-car / car end', fmt(r.dgi, 1) + ' / ' + fmt(r.dga, 1) + ' mm'], ['Gauge widening', fmt(r.wd, 0) + ' mm']]) : null, nodata: noDyn });

    add({ part: 'C. Dynamic check along the line', id: 'required', title: 'C3. Required half-widths and excess over the KE',
      refs: [ref('en2', '§5.2.2 swept envelope'), ref('uic4'), ref('metro')],
      text: [
        'At the two reference heights h1 (floor / platform) and h2 (cantrail) the required half-width is the profile half-width plus overthrow, plays, roll and random terms in the actual conditions. The **excess** over the tangent KE is what the curve adds; it is what the SOD curve allowance must cover.'
      ],
      formulas: ['OUT(h) = x_prof(h) + dga + dT_out + A·wd/2 + s·(I + Dw)/L·(h − hc) + random(h)', 'IN(h) = x_prof(h) + dgi + dT_in + wd/2 + s·(E + Dw)/L·(h − hc) + random(h)', 'excess = max(OUT(h1) − W_KE(h1), OUT(h2) − W_KE(h2))  (and IN)'],
      example: r ? ex(null, [['Heights h1 / h2', fmt(kk.h1 * 1000, 0) + ' / ' + fmt(kk.h2 * 1000, 0) + ' mm'], ['OUT h1 / h2', fmt(r.o1, 1) + ' / ' + fmt(r.o2, 1) + ' mm'], ['IN h1 / h2', fmt(r.i1, 1) + ' / ' + fmt(r.i2, 1) + ' mm'],
        ['KE half-width h1 / h2', fmt(r.kw1, 1) + ' / ' + fmt(r.kw2, 1) + ' mm'], ['Excess OUT / IN', fmt(r.xo, 1) + ' / ' + fmt(r.xi, 1) + ' mm']]) : null, nodata: noDyn });

    add({ part: 'C. Dynamic check along the line', id: 'sod', title: 'C4. SOD curve allowance',
      refs: [ref('metro', 'SOD curve allowances'), ref('en3', 'overthrow allowance in the structure gauge'), ref('uic4')],
      text: [
        'The SOD widens the structure gauge on curves for a **design vehicle** (pivot distance C, length L, wheelbase b), less the nosing already in the tangent KE. Our car is acceptable where its excess over the KE does not exceed this allowance, on both sides.'
      ],
      formulas: ['T_out = max((L² − C²)/8·|k| − nosing, 0) + wd/2', 'T_in = max((C² + b²)/8·|k| − nosing, 0) + wd/2', 'OK if excess OUT ≤ T_out and excess IN ≤ T_in'],
      example: r ? ex(null, [['Design vehicle C / L / b', fmt(dc.consts.sod_C, 2) + ' / ' + fmt(dc.consts.sod_L, 2) + ' / ' + fmt(dc.consts.sod_b, 2) + ' m'], ['Allowance OUT / IN', fmt(r.To, 1) + ' / ' + fmt(r.Ti, 1) + ' mm'], ['Check', r.sod]]) : null, nodata: noDyn });

    add({ part: 'C. Dynamic check along the line', id: 'structures', title: 'C5. Structures, underframe and platforms',
      refs: [ref('en3'), ref('uic4'), ref('metro', 'platform gap, underframe clearance')],
      text: [
        'Third-rail current collector shoes (CCD) are checked separately when a CCD is given: the shoe gear and the retracted shoe must stay inside the envelope, the working shoe must keep the conductor rail within its working range and overlap its contact face, and the live gear must keep its clearance from the rail brackets and shroud – on tangent, on the minimum radius with the rail on either side, and chainage by chainage along the line (METHOD §14).', '**Structures:** on canted track the body leans towards the low rail by h2·E/L; the required horizontal distance at h2 is compared with the structure distance of the element. **Underframe:** the lowest body equipment after wheel wear, suspension, roll and the vertical-curve effect must keep the minimum height. **Platforms:** the nominal gap (platform edge − sill − overthrow) and the minimum gap after all movements; a gap larger than the PRM value is reported for information.'
      ],
      formulas: ['structure clearance = S − max(OUT(h2) − lean, IN(h2) + lean),  lean = h2·E/L'],
      example: r ? ex(null, [['Lean at h2', fmt(r.lean, 1) + ' mm'], ['Structure clearance', r.sc === null ? 'no structure here' : fmt(r.sc, 1) + ' mm'], ['Underframe height', fmt(r.uf, 1) + ' mm'],
        ['Platform gap nominal / minimum', r.gn === null ? 'no platform here' : fmt(r.gn, 1) + ' / ' + fmt(r.gm, 1) + ' mm']]) : null, nodata: noDyn });

    add({ part: 'C. Dynamic check along the line', id: 'outline', title: 'C6. Whole profile against the SOD outline and point items',
      refs: [ref('en2', '§5.2.2 envelope within the reference profile'), ref('metro'), ref('tool', '§8.7')],
      text: [
        'Beyond the two reference heights, every point of the profile is displaced (outside at line speed, inside stopped), giving the vehicle envelope at the chainage. Its clearance to the SOD outline of the element, widened by the curve allowance, must be at least the required clearance; point items (third rail, platform edges, signals) must keep their own clearance from the envelope, on their side and chainage range.'
      ],
      formulas: ['clearance = shortest distance from each envelope point to the widened outline (+ inside)', 'item margin = distance from the item to the envelope − required clearance'],
      example: r ? ex(null, [['SOD outline', r.sodn ? r.sodn + ': ' + fmt(r.sodc, 1) + ' mm at ' + r.sodp : 'none on this element'], ['Point items', r.itm === null || r.itm === undefined ? 'none active' : r.itn + ': margin ' + fmt(r.itm, 1) + ' mm']]) : null, nodata: noDyn });

    // ================================================================ D. Tests
    var sw = (ctx.sway || []).filter(function (x) { return !x.error; }), s1 = sw.filter(function (x) { return c && x.car === c.car; })[0] || sw[0];
    add({ part: 'D. Test calculations', id: 'sway', title: 'D1. Sway test: measuring s and hc',
      refs: [ref('en2', '§5.1.4: the flexibility coefficient is measured by the EN 14363 procedure'), ref('uic5')],
      text: [
        'Shims under one side tilt the track plane by D/L; the body rolls further on its suspension. Measuring the lateral displacement at two or three heights for a few shim heights gives s and hc by a straight-line fit. The gauging values are acceptable when the measured roll displacement per 100 mm of cant is not larger than the one assumed, at the heights that matter.'
      ],
      formulas: ['y = s·(D/L)·(h − hc)  →  least squares:  s = a·L,  hc = −b/a', 'accept if 100·s_meas·(h − hc_meas)/L ≤ 100·s_used·(h − hc_used)/L'],
      example: s1 ? ex(null, [['Car type / load', s1.car + ' / ' + s1.load], ['Readings / RMS residual', s1.n + ' / ' + fmt(s1.rms, 2) + ' mm'], ['s, hc measured', fmt(s1.s, 3) + ', ' + fmt(s1.hc, 0) + ' mm'], ['s, hc used', fmt(s1.used.s, 3) + ', ' + fmt(s1.used.hc, 0) + ' mm'],
        ['Per 100 mm cant at h2: measured / used', fmt(s1.checks[1].measured, 1) + ' / ' + fmt(s1.checks[1].used, 1) + ' mm'], ['Result', s1.ok ? 'OK' : 'CHECK']]) : null,
      nodata: 'Enter sway-test readings on the Tests tab to see the evaluation here.' });
    var pl = (ctx.plan || []).filter(function (x) { return c && x.car === c.car; })[0], pk = pl ? pl.cases.filter(function (x) { return x.id === k.id; })[0] : null;
    add({ part: 'D. Test calculations', id: 'gaugetest', title: 'D2. Kinematic gauge test',
      refs: [ref('en2', '§5.1.5 vehicle tolerances'), ref('metro'), ref('tool', '§13.2')],
      text: [
        'On a straight test track the movements that can be reproduced are set physically: shims for the roll (cant + wind equivalent cant) and the plays pushed to their stops. The rest (overthrow, wear, tolerances, random roll) is taken off the KE to make the test template. The expected clearance to the template equals the static result, so the test shows directly whether the real vehicle behaves as calculated.'
      ],
      formulas: ['shims D = cant + Dw', 'lateral to impose = (play + q + w)·A', 'template = KE − terms not reproduced'],
      example: pk ? ex(null, [['Case', pk.label], ['Shims', fmt(pk.D, 1) + ' mm'], ['Lateral to impose', fmt(pk.Rlat, 2) + ' mm'], ['Expected minimum clearance', fmt(pk.min.c, 2) + ' mm at ' + pk.min.pt],
        ['With measured s, hc', pk.minMeasured ? fmt(pk.minMeasured.cm, 2) + ' mm' : 'no sway test for this car type and load']]) : null, nodata: noStatic });

    return out;
  }

  return { steps: steps, REF: REF };
}));
