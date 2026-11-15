/*
 * Input definitions shared by the forms (ui.js), the Excel/CSV templates and importers (io.js) and the
 * checks (model.js). One field = { k: key, l: label, t: type, u: unit, o: options, h: help, min, max, d: default,
 * opt: true when a blank value is allowed (meaning stated in h) }. Types: num, int, text, sel.
 * Groups follow the input sheets of the gauging workbook (Main Data, Carbody Inputs, Bogie Inputs, KE & Profiles,
 * Track Data). Contains no physics. Attaches to RSGAUGE.schema.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.RSGAUGE = root.RSGAUGE || {}; root.RSGAUGE.schema = api; }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function f(k, l, t, u, extra) {
    var o = { k: k, l: l, t: t, u: u || '' }, p;
    for (p in (extra || {})) { if (Object.prototype.hasOwnProperty.call(extra, p)) { o[p] = extra[p]; } }
    return o;
  }
  var YN = [['yes', 'Yes'], ['no', 'No']];

  // ---------------------------------------------------------------- Train Configuration tab
  var trainDescription = [
    f('name', 'Train name', 'text', '', { d: '' }),
    f('customer', 'Customer', 'text', '', { d: '' }),
    f('line', 'Line / project', 'text', '', { d: '' }),
    f('formation', 'Train formation', 'text', '', { h: 'Car type names joined by "-", e.g. DMC-TC-MC-MC-TC-DMC', d: '' }),
    f('n_cars', 'Number of cars', 'int', '', { min: 1, max: 20, d: 6 })
  ];
  var trainConfig = [
    f('vehicle_type', 'Vehicle type', 'sel', '', { o: [['lrv', 'LRV / tram'], ['metro', 'Metro'], ['hs', 'High-speed']], d: 'metro', h: 'Use "Apply typical values" to load the preset values of this type' }),
    f('bogie_arrangement', 'Bogie arrangement', 'sel', '', { o: [['non_shared', 'Non-shared (2 own bogies per car)'], ['shared_one', 'Shared bogie at one end (semi-articulated pair)'], ['shared_both', 'Shared bogies at both ends (articulated)']], d: 'non_shared', h: 'Default for new car types; each car type sets its own ends below' }),
    f('vmax_kmh', 'Design speed Vd', 'num', 'km/h', { min: 1, max: 400, d: 90 }),
    f('gauge_mm', 'Nominal track gauge l', 'num', 'mm', { min: 600, max: 1800, d: 1435 }),
    f('L_mm', 'Distance between rail centres G (cant base)', 'num', 'mm', { min: 600, max: 1900, d: 1500, h: 'Converts cant to an angle; 1500 mm for 1435 mm gauge' }),
    f('primary_type', 'Primary suspension', 'sel', '', { o: [['chevron', 'Chevron / rubber'], ['coil', 'Coil spring'], ['other', 'Other']], d: 'chevron' }),
    f('secondary_type', 'Secondary suspension', 'sel', '', { o: [['air', 'Air spring'], ['coil', 'Coil spring'], ['other', 'Other']], d: 'air' }),
    f('power_supply', 'Power supply', 'sel', '', { o: [['third_rail', 'Third rail'], ['ohe', 'Overhead (pantograph)'], ['none', 'None / other']], d: 'third_rail' })
  ];
  var trainLoad = [
    f('tare_label', 'Tare load condition', 'text', '', { d: 'AW0', h: 'Empty: highest body, largest wind roll' }),
    f('laden_label', 'Crush load condition', 'text', '', { d: 'AW4', h: 'Crush: lowest body' })
  ];
  var trainWind = [
    f('rho_air', 'Air density ρ', 'num', 'kg/m³', { min: 0.5, max: 2, d: 1.2 }),
    f('Beq_mm', 'Base for equivalent cant Beq', 'num', 'mm', { min: 500, max: 2500, d: 1510, h: 'D = (F/W) × Beq' })
  ];
  var END = [['free', 'Free (own bogie)'], ['shared', 'Shared bogie']];
  var carType = [
    f('name', 'Car type name', 'text', '', { d: 'CAR' }),
    f('count', 'Number in the train', 'int', '', { min: 0, max: 20, d: 1 }),
    f('length_m', 'Body length Lb (over body ends)', 'num', 'm', { min: 2, max: 40, d: 21 }),
    f('n_free_m', 'Overhang pivot to free body end n', 'num', 'm', { min: 0, max: 10, d: 3.4 }),
    f('n_art_m', 'Overhang at a shared end nj', 'num', 'm', { min: -2, max: 10, d: 0, h: '0 = body end over the shared pivot; negative if it stops short' }),
    f('end1', 'End 1', 'sel', '', { o: END, d: 'free' }),
    f('end2', 'End 2', 'sel', '', { o: END, d: 'free' }),
    f('ni_m', 'Interior section from pivot ni', 'num', 'm', { min: 0, max: 20, opt: true, h: 'Blank = a/2 (mid-car, largest inward throw)' }),
    f('na_m', 'Exterior section beyond pivot na', 'num', 'm', { min: 0, max: 10, d: 2.2, h: 'e.g. HVAC unit position' }),
    f('width_mm', 'Maximum body width', 'num', 'mm', { min: 1000, max: 4000, d: 2880 }),
    f('floor_mm', 'Floor / door-sill height above rail hf', 'num', 'mm', { min: 100, max: 2000, d: 1100 }),
    f('sill_hw_mm', 'Door-sill half-width bs', 'num', 'mm', { min: 500, max: 2000, d: 1440 }),
    f('mass_tare_t', 'Car body mass tare, sprung m0', 'num', 't', { min: 1, max: 120, d: 24 }),
    f('mass_crush_t', 'Car body mass crush, sprung m4', 'num', 't', { min: 1, max: 160, d: 42 }),
    f('cg_tare_mm', 'CG height of body tare hG0', 'num', 'mm', { min: 200, max: 3000, d: 1600 }),
    f('cg_crush_mm', 'CG height of body crush hG4', 'num', 'mm', { min: 200, max: 3000, d: 1720 }),
    f('drop_crush_mm', 'Body lowering tare to crush Δz', 'num', 'mm', { min: 0, max: 100, d: 22 }),
    f('bogie1', 'Bogie type at end 1', 'text', '', { d: 'T', h: 'Name of a bogie type on the Car body & Bogie tab' }),
    f('bogie2', 'Bogie type at end 2', 'text', '', { d: 'T' }),
    f('prof_int', 'Profile – interior section', 'text', '', { d: '', h: 'RS profile checked between the pivots' }),
    f('prof_ext', 'Profile – exterior section', 'text', '', { d: '' }),
    f('prof_end', 'Profile – car-end section', 'text', '', { d: '' })
  ];

  // ---------------------------------------------------------------- Car body & Bogie tab
  var body = [
    f('car', 'Car type', 'text', '', { d: '' }),
    f('wind_len_m', 'Wind-exposed length Lw', 'num', 'm', { min: 1, max: 40, opt: true, h: 'Blank = body length' }),
    f('wind_top_mm', 'Top of wind-exposed side zt', 'num', 'mm', { min: 500, max: 6000, d: 3300 }),
    f('wind_bot_mm', 'Bottom of wind-exposed side zb', 'num', 'mm', { min: 0, max: 3000, d: 850 }),
    f('Cf', 'Force coefficient Cf', 'num', '', { min: 0, max: 3, d: 1 }),
    f('uf_h_mm', 'Lowest body-mounted equipment above rail zu (tare, new wheels)', 'num', 'mm', { min: 0, max: 1500, d: 330 }),
    f('uf_hw_mm', 'Half-width of that equipment yu (roll lever)', 'num', 'mm', { min: 0, max: 2500, d: 1200 }),
    f('uf_bog_h_mm', 'Lowest bogie-mounted equipment above rail zbg', 'num', 'mm', { min: 0, max: 1000, d: 150 }),
    f('s_tare', 'Flexibility coefficient s – tare, inflated', 'num', '', { min: 0, max: 1, d: 0.3, h: 'Specified (sway test / bogie supplier)' }),
    f('s_crush', 'Flexibility coefficient s – crush, inflated', 'num', '', { min: 0, max: 1, d: 0.3 }),
    f('s_defl', 'Flexibility coefficient s – deflated', 'num', '', { min: 0, max: 1, d: 0.12 }),
    f('hc_tare_mm', 'Roll-centre height hc – tare', 'num', 'mm', { min: 0, max: 3000, d: 550 }),
    f('hc_crush_mm', 'Roll-centre height hc – crush', 'num', 'mm', { min: 0, max: 3000, d: 530 }),
    f('hc_defl_mm', 'Roll-centre height hc – deflated', 'num', 'mm', { min: 0, max: 3000, d: 300 }),
    f('eta0_deg', 'Body dissymmetry η0 (EN 15273-2)', 'num', '°', { min: 0, max: 5, d: 0, h: 'Only the part above the rules value (1°) adds to z_kin' }),
    f('en_Aff_mm', 'EN A.3.4: suspension displacement Aff', 'num', 'mm', { min: 0, max: 300, opt: true, h: 'Blank = dp + dsd (primary + secondary downward, air springs deflated)' }),
    f('en_dAff_mm', 'EN A.3.4: difference in suspension displacement ΔAff', 'num', 'mm', { min: 0, max: 100, d: 0, h: 'Between the two bogies / the two rows of springs' }),
    f('en_s_v', 'EN A.3.4: flexibility s in the zone B / C terms', 'num', '', { min: 0, max: 1, d: 0, h: '0 when Aff is a bottoming (total) displacement' }),
    f('en_dUsr_mm', 'EN A.3.4: wheel radius difference between bogies ΔUsr', 'num', 'mm', { min: 0, max: 50, d: 0, h: 'Maximum allowed by the maintenance rules' }),
    f('en_levels', 'EN A.3.4.2: suspension levels (10 mm extension each)', 'int', '', { min: 0, max: 3, d: 2 })
  ];
  var bogie = [
    f('name', 'Bogie type name', 'text', '', { d: 'B' }),
    f('p_m', 'Bogie wheelbase p', 'num', 'm', { min: 0.5, max: 5, d: 2.3 }),
    f('motor', 'Motor bogie (adhesion μ ≥ 0,2)', 'sel', '', { o: [['yes', 'Yes'], ['no', 'No']], d: 'no', h: 'EN 15273-2 Table A.4: a car with a motor bogie uses the traction-unit formulae' }),
    f('play_ld_mm', 'Wheel–rail half play (l − d)/2, worn', 'num', 'mm', { min: 0, max: 50, d: 14, h: 'See the play calculator below' }),
    f('q_mm', 'Primary lateral play q (axlebox ↔ frame)', 'num', 'mm', { min: 0, max: 50, d: 5 }),
    f('w_mm', 'Secondary lateral play to bump stop w – inflated', 'num', 'mm', { min: 0, max: 150, d: 30, h: 'Including bump-stop compression' }),
    f('w_defl_mm', 'Secondary lateral play – deflated', 'num', 'mm', { min: 0, max: 150, d: 30 }),
    f('w250_mm', 'Secondary play w at R = 250 m (EN 15273-2)', 'num', 'mm', { min: 0, max: 200, opt: true, h: 'Blank = w (constant with the radius)' }),
    f('w150_mm', 'Secondary play w at R = 150 m (EN 15273-2)', 'num', 'mm', { min: 0, max: 200, opt: true, h: 'Blank = w at 250 m' }),
    f('wv_R_m', 'Variable stops: radius where they start (EN A.3.9.x.2)', 'num', 'm', { min: 150, max: 10000, opt: true, h: 'Blank = no non-linear w' }),
    f('wv_mm', 'Variable stops: w at that radius', 'num', 'mm', { min: 0, max: 200, opt: true }),
    f('wheel_new_mm', 'Wheel diameter – new Dn', 'num', 'mm', { min: 300, max: 1300, d: 860 }),
    f('wheel_worn_mm', 'Wheel diameter – fully worn Dw', 'num', 'mm', { min: 300, max: 1300, d: 780 }),
    f('pack_step_mm', 'Max radial wear between height corrections Δr', 'num', 'mm', { min: 0, max: 100, d: 20, h: 'Radial wear used = min((Dn − Dw)/2, Δr)' }),
    f('dn_prim_mm', 'Primary – downward (load + dynamic) dp', 'num', 'mm', { min: 0, max: 150, d: 38 }),
    f('dn_sec_inf_mm', 'Secondary – downward, inflated ds', 'num', 'mm', { min: 0, max: 150, d: 15 }),
    f('dn_sec_def_mm', 'Secondary – downward, deflated dsd', 'num', 'mm', { min: 0, max: 200, d: 50 }),
    f('up_prim_mm', 'Primary – upward (rebound) up', 'num', 'mm', { min: 0, max: 100, d: 15 }),
    f('up_sec_mm', 'Secondary – upward (rebound) us', 'num', 'mm', { min: 0, max: 100, d: 15 }),
    f('up_oi_mm', 'Air-spring over-inflation uo', 'num', 'mm', { min: 0, max: 100, d: 20 }),
    f('mass_t', 'Bogie mass (complete) mb', 'num', 't', { min: 0.5, max: 20, d: 6.5 }),
    f('n_axle', 'Axles per bogie', 'int', '', { min: 1, max: 4, d: 2 }),
    f('kz_prim', 'Primary vertical stiffness per axlebox kz1', 'num', 'N/m', { min: 1e4, max: 1e8, d: 1100000 }),
    f('n_ps', 'Number of primary spring groups np', 'int', '', { min: 1, max: 16, d: 4 }),
    f('b1_mm', 'Half lateral spacing of primary springs b1', 'num', 'mm', { min: 100, max: 2000, d: 1000 }),
    f('z_prim_mm', 'Height of primary suspension zp', 'num', 'mm', { min: 0, max: 2000, d: 430 }),
    f('kz2_t', 'Air spring vertical stiffness – tare kz2', 'num', 'N/m', { min: 1e4, max: 1e8, d: 350000 }),
    f('kz2_c', 'Air spring vertical stiffness – crush kz2c', 'num', 'N/m', { min: 1e4, max: 1e8, d: 620000 }),
    f('kz_em', 'Emergency spring vertical stiffness kze', 'num', 'N/m', { min: 1e4, max: 1e8, d: 1500000 }),
    f('n_as', 'Number of air springs per bogie na', 'int', '', { min: 1, max: 8, d: 2 }),
    f('b2_mm', 'Half lateral spacing of air springs b2', 'num', 'mm', { min: 100, max: 2000, d: 950 }),
    f('k_arb', 'Anti-roll bar stiffness per bogie kφr', 'num', 'Nm/rad', { min: 0, max: 1e8, d: 0 }),
    f('z_sec_mm', 'Height of secondary suspension zs – inflated', 'num', 'mm', { min: 0, max: 2500, d: 850 }),
    f('z_sec_d_mm', 'Height of secondary suspension – deflated', 'num', 'mm', { min: 0, max: 2500, d: 750 }),
    f('ky_prim', 'Primary lateral stiffness per axlebox ky1', 'num', 'N/m', { min: 1e4, max: 1e9, d: 6000000 }),
    f('ky_sec', 'Secondary lateral stiffness per air spring ky2', 'num', 'N/m', { min: 1e4, max: 1e9, d: 1700000, h: 'Effective value with the body on the bump stop' }),
    f('ky2_d', 'Secondary lateral stiffness – deflated ky2d', 'num', 'N/m', { min: 1e4, max: 1e9, d: 4000000 }),
    f('en_s_frame', 'EN A.3.11: flexibility s of the bogie frame on the primary suspension', 'num', '', { min: 0, max: 1, d: 0, h: 'Roll of frame-mounted bogie parts in z_kin; 0 = none' }),
    f('en_hc_frame_mm', 'EN A.3.11: roll-centre height of the bogie frame', 'num', 'mm', { min: 0, max: 2000, d: 0 })
  ];
  var playCalc = [
    f('bb_mm', 'Back-to-back distance of wheels BB', 'num', 'mm', { min: 500, max: 1800, d: 1360 }),
    f('ef_new_mm', 'Flange thickness – new (10 mm below tread)', 'num', 'mm', { min: 10, max: 50, d: 32.5 }),
    f('ef_worn_mm', 'Flange thickness – worn limit', 'num', 'mm', { min: 10, max: 50, d: 26 })
  ];

  // Lower parts checked by EN 15273-2 A.3.4.1 (one row per part; METHOD §10.7)
  var lowerPart = [
    f('car', 'Car type', 'text', '', { d: '' }),
    f('name', 'Part', 'text', '', { d: '' }),
    f('mount', 'Mounted on', 'sel', '', { o: [['body', 'Car body'], ['bogie', 'Bogie frame']], d: 'body' }),
    f('pos', 'Position', 'sel', '', { o: [['between', 'Between the pivots / axles'], ['beyond', 'Beyond the pivots / end axle']], d: 'between' }),
    f('n_m', 'Distance n from the nearer pivot / axle', 'num', 'm', { min: 0, max: 20, opt: true, h: 'Blank: between = mid (a/2 or p/2); beyond = car-end overhang (body) or 0 (bogie)' }),
    f('y_mm', 'Half-width b of the part', 'num', 'mm', { min: 0, max: 2500, d: 0 }),
    f('h_mm', 'Height above rail (tare, new wheels)', 'num', 'mm', { min: 0, max: 1500 }),
    f('hlim_mm', 'Lower limit at that position', 'num', 'mm', { min: 0, max: 1500, opt: true, h: 'Blank = customer minimum clearance (body / bogie); else e.g. GIC1 / GIC2 height at b' }),
    f('note', 'Note', 'text', '', { d: '' })
  ];

  // Bogie parts checked laterally by EN 15273-2 A.3.11 (one row per part; METHOD §10.8)
  var bogiePart = [
    f('bogie', 'Bogie type', 'text', '', { d: '' }),
    f('name', 'Part', 'text', '', { d: '' }),
    f('mount', 'Mounted on', 'sel', '', { o: [['frame', 'Bogie frame (primary sprung)'], ['axle', 'Axle / axlebox (unsprung)']], d: 'frame' }),
    f('pos', 'Position', 'sel', '', { o: [['between', 'Between the end axles'], ['beyond', 'Beyond the end axle']], d: 'between' }),
    f('n_m', 'Distance n from the nearer end axle', 'num', 'm', { min: 0, max: 5, opt: true, h: 'Blank: between = p/2, beyond = 0' }),
    f('y_mm', 'Half-width of the part', 'num', 'mm', { min: 0, max: 2500 }),
    f('h_mm', 'Height above rail (tare, new wheels)', 'num', 'mm', { min: 0, max: 2000 }),
    f('note', 'Note', 'text', '', { d: '' })
  ];

  // Open doors and deployed steps checked by EN 15273-2 A.3.14 / A.3.15 (one row per element; METHOD §10.10)
  var doorStep = [
    f('car', 'Car type', 'text', '', { d: '' }),
    f('name', 'Element', 'text', '', { d: '' }),
    f('kind', 'Kind', 'sel', '', { o: [['door', 'Access door, open'], ['step', 'Footboard / step, deployed']], d: 'door' }),
    f('pos', 'Position', 'sel', '', { o: [['between', 'Between the pivots'], ['beyond', 'Beyond the pivots']], d: 'between' }),
    f('n_m', 'Distance n from the nearer pivot', 'num', 'm', { min: 0, max: 20, opt: true, h: 'Blank: between = a/2, beyond = car-end overhang' }),
    f('y_mm', 'Half-width of the open element', 'num', 'mm', { min: 0, max: 2500 }),
    f('h_lo_mm', 'Lowest point above rail (tare, new wheels)', 'num', 'mm', { min: 0, max: 5000 }),
    f('h_hi_mm', 'Highest point above rail', 'num', 'mm', { min: 0, max: 5000 }),
    f('note', 'Note', 'text', '', { d: '' })
  ];

  // ---------------------------------------------------------------- Customer KE & SOD tab
  var customerLimits = [
    f('uf_min_body_mm', 'Min. clearance body-mounted equipment to rail cb', 'num', 'mm', { min: 0, max: 500, d: 100 }),
    f('uf_min_bog_mm', 'Min. clearance bogie-mounted equipment to rail cbg', 'num', 'mm', { min: 0, max: 500, d: 75 }),
    f('axle_lim_t', 'Axle-load limit P', 'num', 't', { min: 1, max: 40, d: 16 }),
    f('prm_gap_mm', 'Max horizontal platform gap (PRM)', 'num', 'mm', { min: 0, max: 500, d: 75 }),
    f('nosing_mm', 'Nosing included in tangent KE (SOD)', 'num', 'mm', { min: 0, max: 200, d: 30, h: 'From the customer SOD' }),
    f('sod_C_m', 'SOD design vehicle – bogie centres C', 'num', 'm', { min: 1, max: 40, opt: true, h: 'Blank = this vehicle' }),
    f('sod_L_m', 'SOD design vehicle – body length L', 'num', 'm', { min: 1, max: 40, opt: true, h: 'Blank = this vehicle' }),
    f('sod_b_m', 'SOD design vehicle – bogie wheelbase b', 'num', 'm', { min: 0.5, max: 5, opt: true, h: 'Blank = this vehicle' }),
    f('h_ref1_mm', 'Reference height 1 (floor / platform level) h1', 'num', 'mm', { min: 0, max: 3000, d: 1100 }),
    f('h_ref2_mm', 'Reference height 2 (cantrail) h2', 'num', 'mm', { min: 0, max: 6000, d: 3000 })
  ];
  var enParams = [
    f('lmax_mm', 'Max track gauge in the rules l_max (1,465 m in G1)', 'num', 'mm', { min: 600, max: 1800, d: 1465 }),
    f('e0_mm', 'Lateral allowance in the reference profile (0,015 m)', 'num', 'mm', { min: 0, max: 100, d: 15 }),
    f('R1_m', 'Reference radius R1 (250 m)', 'num', 'm', { min: 50, max: 5000, d: 250 }),
    f('Rmin_m', 'Smaller reference radius R2 (150 m)', 'num', 'm', { min: 20, max: 5000, d: 150, h: 'x-term: (Δ − X)·(1/2R2 − 1/2R1)' }),
    f('Ck_m2', 'Overthrow allowance Ck – lower parts (k = Ck/R)', 'num', 'm²', { min: 0, max: 20, d: 2.5, h: 'G1: 2,5 (Δ threshold 5)' }),
    f('Ck_up_m2', 'Overthrow allowance Ck – upper parts', 'num', 'm²', { min: 0, max: 20, d: 3.75, h: 'G1: 3,75 (Δ threshold 7,5)' }),
    f('Xi_m2', 'x-term constant between the pivots Xi (100)', 'num', 'm²', { min: 0, max: 1000, d: 100 }),
    f('Xa_m2', 'x-term constant beyond the pivots Xa (120)', 'num', 'm²', { min: 0, max: 1000, d: 120 }),
    f('h_low_mm', 'Lower parts up to height (0,400 m)', 'num', 'mm', { min: 0, max: 2000, d: 400 }),
    f('s0', 'Reference flexibility s0', 'num', '', { min: 0, max: 1, d: 0.4 }),
    f('hc0_mm', 'Reference roll centre height hc0', 'num', 'mm', { min: 0, max: 2000, d: 500 }),
    f('D0_mm', 'Cant deficiency in the profile D0 (outside)', 'num', 'mm', { min: 0, max: 300, d: 50 }),
    f('I0_mm', 'Cant excess in the profile I0 (inside)', 'num', 'mm', { min: 0, max: 300, d: 50 }),
    f('Dlim_mm', 'Cant excess / deficiency limit (0,2 m)', 'num', 'mm', { min: 0, max: 400, d: 200 }),
    f('Lref_mm', 'Distance between rail centres in the rules L (1,5 m)', 'num', 'mm', { min: 600, max: 1900, d: 1500 }),
    f('eta_lim_deg', 'Dissymmetry included in the profile (1°)', 'num', '°', { min: 0, max: 5, d: 1 }),
    f('st_allow_mm', 'Static gauge: allowance in the formulae (0,075 m, A.2.4)', 'num', 'mm', { min: 0, max: 300, d: 75 }),
    f('st_Dmin_m2', 'Static gauge: minimum Δ (7,5 m²)', 'num', 'm²', { min: 0, max: 50, d: 7.5 }),
    f('st_smax', 'Static gauge: maximum flexibility coefficient (0,2 for G1)', 'num', '', { min: 0, max: 1, d: 0.2, h: '§5.1.3: 0,3 for GA, GB, GC' }),
    f('st_h_low_mm', 'Static gauge: lower parts up to height (0,43 m)', 'num', 'mm', { min: 0, max: 2000, d: 430 }),
    f('dr_h_mm', 'Doors open: height of the a) / b) boundary (1,05 m)', 'num', 'mm', { min: 0, max: 3000, d: 1050 }),
    f('dr_above_mm', 'Doors open: excess allowed above it (0,2 m)', 'num', 'mm', { min: 0, max: 1000, d: 200 }),
    f('dr_wmax_mm', 'Doors / steps between the pivots: w_i at most (0,035 m)', 'num', 'mm', { min: 0, max: 200, d: 35 }),
    f('dr_X_mm', 'Doors beyond the pivots: residual clearance X (0,02 m)', 'num', 'mm', { min: 0, max: 200, d: 20, h: 'A.105; 0,02 m unless calculated' }),
    f('gap_bq0i_mm', 'Step position A.3.15.2: platform b_q0i (inside of curve)', 'num', 'mm', { min: 0, max: 3000, opt: true, h: 'Platform edge from the track centre (EN 15273-3); blank = no check on the inside' }),
    f('gap_bq0a_mm', 'Step position A.3.15.2: platform b_q0a (outside of curve)', 'num', 'mm', { min: 0, max: 3000, opt: true, h: 'Blank = no check on the outside' }),
    f('gap_R_m', 'Step position A.3.15.2: minimum verification radius', 'num', 'm', { min: 10, max: 100000, opt: true, h: 'Blank = no step-position check; the gap limit is the customer PRM gap' })
  ];
  var sodSettings = [
    f('frame', 'SOD reference frame', 'sel', '', { o: [['track', 'Track plane (same as KE)'], ['vertical', 'Vertical (rotate KE by cant)']], d: 'track' }),
    f('margin_mm', 'Required minimum clearance KE to SOD', 'num', 'mm', { min: 0, max: 500, d: 50 })
  ];
  var point = [
    f('pt', 'Point', 'text', '', { d: '' }),
    f('y', 'Y lateral from track centre', 'num', 'mm', { min: 0, max: 5000 }),
    f('z', 'Z height above top of rail', 'num', 'mm', { min: -500, max: 8000 })
  ];
  var sodItem = [
    f('name', 'Item', 'text', '', { d: '' }),
    f('type', 'Type', 'sel', '', { o: [['third_rail', 'Third rail'], ['platform', 'Platform edge'], ['walkway', 'Walkway'], ['ohe', 'Overhead line'], ['equipment', 'Equipment'], ['other', 'Other']], d: 'other' }),
    f('y', 'Y lateral', 'num', 'mm', { min: 0, max: 6000 }),
    f('z', 'Z height', 'num', 'mm', { min: -500, max: 8000 }),
    f('min_clear_mm', 'Required clearance', 'num', 'mm', { min: 0, max: 1000, d: 50 }),
    f('side', 'Side (in the direction of increasing chainage)', 'sel', '', { o: [['both', 'Both'], ['L', 'Left'], ['R', 'Right']], d: 'both' }),
    f('ch_from_m', 'From chainage', 'num', 'm', { min: -1e6, max: 1e7, opt: true, h: 'Blank = from the start of the line' }),
    f('ch_to_m', 'To chainage', 'num', 'm', { min: -1e6, max: 1e7, opt: true, h: 'Blank = to the end of the line' })
  ];
  var keProfile = [
    f('name', 'Profile name', 'text'), f('note', 'Note / condition', 'text'),
    f('n_up', 'Points in the upper envelope n_up', 'int', '', { min: 2, max: 200, opt: true, h: 'Last point of the car-body envelope (down to the cut); the notch below is excluded. Blank = all points' })
  ];
  var sodProfile = [f('name', 'Profile name', 'text'), f('note', 'Note', 'text')];

  // ---------------------------------------------------------------- RS profile tab
  var rsProfile = [f('name', 'Profile name', 'text'), f('note', 'Note / section', 'text')];

  // ---------------------------------------------------------------- Track data tab
  var trackOperating = [
    f('cant_max_mm', 'Maximum applied cant E', 'num', 'mm', { min: 0, max: 250, d: 120 }),
    f('cantdef_max_mm', 'Maximum cant deficiency I', 'num', 'mm', { min: 0, max: 300, d: 100, h: 'Exterior and car-end static cases (train at speed)' }),
    f('cantexc_max_mm', 'Maximum cant excess Ie (train stopped on max cant)', 'num', 'mm', { min: 0, max: 300, d: 120, h: 'Interior static case' }),
    f('wind_open_kmh', 'Wind speed – open line Vw', 'num', 'km/h', { min: 0, max: 250, d: 120 }),
    f('wind_plat_kmh', 'Wind speed – platform Vwp', 'num', 'km/h', { min: 0, max: 250, d: 60 })
  ];
  var trackTolerances = [
    f('g_tol_mm', 'Track gauge tolerance (maintenance) Δl', 'num', 'mm', { min: 0, max: 30, d: 6 }),
    f('fw_mm', 'Rail gauge-face wear fw', 'num', 'mm', { min: 0, max: 30, d: 8 }),
    f('align_tol_mm', 'Track alignment tolerance al', 'num', 'mm', { min: 0, max: 50, d: 5, h: 'Used only if selected in the simulation options' }),
    f('cl_err_mm', 'Cross-level error CL', 'num', 'mm', { min: 0, max: 50, d: 10 }),
    f('widen_mm', 'Gauge widening on curves wd', 'num', 'mm', { min: 0, max: 40, d: 10, h: 'Adds wd/2 to the wheel–rail half play' }),
    f('widen_R_m', 'Widening applies below radius Rw', 'num', 'm', { min: 0, max: 5000, d: 400 })
  ];
  var trackStatic = [
    f('R_min_m', 'Minimum horizontal radius (main line) Rmin', 'num', 'm', { min: 10, max: 100000, d: 120, h: 'Shared-bogie comparison' }),
    f('R_static_m', 'Curve radius for the static check Rs (0 = tangent)', 'num', 'm', { min: 0, max: 100000, d: 0, h: 'Customer KE on tangent track: keep 0' }),
    f('Rv_static_m', 'Vertical curve radius for the underframe check Rv', 'num', 'm', { min: 0, max: 100000, d: 1500, h: 'Crest; mid-car lowering a²/8Rv' })
  ];
  var trackSweep = [f('dx_m', 'Step for the dynamic sweep', 'num', 'm', { min: 1, max: 500, d: 10 })];
  var segment = [
    f('from_m', 'Chainage start', 'num', 'm', { min: -1e6, max: 1e7 }),
    f('to_m', 'Chainage end', 'num', 'm', { min: -1e6, max: 1e7 }),
    f('element', 'Element', 'sel', '', { o: [['tangent', 'Tangent'], ['transition', 'Transition'], ['circular', 'Circular']], d: 'tangent' }),
    f('side', 'Hand', 'sel', '', { o: [['', '—'], ['L', 'L'], ['R', 'R']], d: '' }),
    f('R_start_m', 'R start (0 = ∞)', 'num', 'm', { min: 0, max: 1e6, d: 0 }),
    f('R_end_m', 'R end (0 = ∞)', 'num', 'm', { min: 0, max: 1e6, d: 0 }),
    f('cant_start_mm', 'Cant start', 'num', 'mm', { min: 0, max: 250, d: 0 }),
    f('cant_end_mm', 'Cant end', 'num', 'mm', { min: 0, max: 250, d: 0 }),
    f('speed_kmh', 'Speed limit', 'num', 'km/h', { min: 0, max: 400, d: 80 }),
    f('Rv_m', 'Vertical curve Rv (+ crest, − sag, 0 none)', 'num', 'm', { min: -1e6, max: 1e6, d: 0 }),
    f('ke', 'KE to use', 'text', '', { d: '' }),
    f('location', 'Location', 'sel', '', { o: [['open', 'Open'], ['tunnel', 'Tunnel'], ['platform', 'Platform'], ['depot', 'Depot']], d: 'open' }),
    f('wind', 'Wind', 'sel', '', { o: [['Y', 'Y'], ['N', 'N']], d: 'Y' }),
    f('struct_mm', 'Structure distance from track centre at h2 (0 = none)', 'num', 'mm', { min: 0, max: 10000, d: 0 }),
    f('platform_mm', 'Platform edge from track centre', 'num', 'mm', { min: 0, max: 5000, d: 0 }),
    f('platform_side', 'Platform side', 'sel', '', { o: [['', '—'], ['L', 'L'], ['R', 'R']], d: '' }),
    f('sod', 'SOD profile (optional)', 'text', '', { d: '' }),
    f('remarks', 'Remarks', 'text', '', { d: '' })
  ];

  // ---------------------------------------------------------------- Static Simulation tab (options)
  var staticOptions = [
    f('ke', 'Customer KE for the static check', 'text', '', { d: '' }),
    f('flex', 'Flexibility coefficient and roll-centre source', 'sel', '', { o: [['specified', 'Specified (Car body inputs)'], ['theoretical', 'Theoretical (stiffness model)']], d: 'specified' }),
    f('latflex', 'Theory: include lateral elastic deflection in the roll centre', 'sel', '', { o: YN, d: 'yes', h: 'Yes = as a sway test measures it' }),
    f('lat_state', 'Suspension state – lateral / roll', 'sel', '', { o: [['inflated', 'Inflated (normal)'], ['deflated', 'Deflated (abnormal)']], d: 'inflated', h: 'Deflated uses deflated s, hc and w' }),
    f('vert_state', 'Suspension state – vertical (lower parts)', 'sel', '', { o: [['inflated', 'Inflated (normal)'], ['deflated', 'Deflated (abnormal)']], d: 'deflated', h: 'Deflated = air-spring drop (abnormal condition governs lower parts)' }),
    f('comb', 'Combination of random terms', 'sel', '', { o: [['linear', 'Linear (all terms added)'], ['rss', 'Statistical (K·√Σ random²)']], d: 'linear' }),
    f('K_rss', 'Statistical factor K (RSS option)', 'num', '', { min: 0, max: 5, d: 1 }),
    f('gtol_ext', 'Include track gauge tolerance in exterior / car end', 'sel', '', { o: YN, d: 'no' }),
    f('align', 'Include track alignment tolerance', 'sel', '', { o: YN, d: 'no' }),
    f('tilt', 'Include rigid tilt from cross-level error', 'sel', '', { o: YN, d: 'no', h: 'Adds CL/G × h' }),
    f('up_roll', 'Combine upward movement with roll', 'sel', '', { o: YN, d: 'no', h: 'No = upward movement checked on the centre line only' }),
    f('wind', 'Include wind', 'sel', '', { o: YN, d: 'yes' }),
    f('over_infl', 'Include air-spring over-inflation (abnormal)', 'sel', '', { o: YN, d: 'no' }),
    f('ma_from_mm', 'Method A: first height', 'num', 'mm', { min: 0, max: 6000, d: 900 }),
    f('ma_to_mm', 'Method A: last height', 'num', 'mm', { min: 0, max: 8000, opt: true, h: 'Blank = top of the KE' }),
    f('ma_step_mm', 'Method A: height step', 'num', 'mm', { min: 10, max: 1000, d: 100 }),
    f('en_check', 'Also check EN 15273-2:2009 kinematic (customer KE as reference profile)', 'sel', '', { o: YN, d: 'no', h: 'Reductions Ei / Ea with the rules on the Customer KE & SOD tab; in the verdict when Yes' }),
    f('en_mc', 'EN: car with one motor bogie uses', 'sel', '', { o: [['traction', 'Traction-unit formulae (Table A.4 note a)'], ['motor', 'Motor-coach formulae A.3.9.2']], d: 'traction' }),
    f('en_static', 'Also check EN 15273-2:2009 static gauge method (A.2)', 'sel', '', { o: YN, d: 'no', h: 'Reductions A.2–A.5, no roll term; allowed only for s ≤ s_max; in the verdict when Yes' }),
    f('en_static_ref', 'EN static: reference profile (Customer KE & SOD tab)', 'text', '', { d: '', h: 'Blank = the KE of the static check' })
  ];

  // ---------------------------------------------------------------- Dynamic Simulation tab (options)
  // ---------------------------------------------------------------- Tests tab (METHOD §13)
  var swayTest = [
    f('car', 'Car type', 'text', '', { d: '' }),
    f('load', 'Load state', 'sel', '', { o: [['tare', 'Tare'], ['crush', 'Crush'], ['deflated', 'Deflated']], d: 'tare' }),
    f('D_mm', 'Shim height / cant D', 'num', 'mm', { min: 1, max: 300 }),
    f('low', 'Low side', 'sel', '', { o: [['L', 'Left'], ['R', 'Right']], d: 'L' }),
    f('h1_mm', 'Height 1', 'num', 'mm', { min: 0, max: 5000 }),
    f('y1_mm', 'Displacement at height 1 (towards low rail)', 'num', 'mm', { min: -300, max: 300 }),
    f('h2_mm', 'Height 2', 'num', 'mm', { min: 0, max: 5000 }),
    f('y2_mm', 'Displacement at height 2', 'num', 'mm', { min: -300, max: 300 }),
    f('h3_mm', 'Height 3', 'num', 'mm', { min: 0, max: 5000, opt: true }),
    f('y3_mm', 'Displacement at height 3', 'num', 'mm', { min: -300, max: 300, opt: true }),
    f('note', 'Note', 'text', '', { d: '' })
  ];

  // Word report (Overall Summary tab); saved in the project file
  var reportOptions = [
    f('title', 'Report title', 'text', '', { d: 'Vehicle gauging report' }),
    f('doc_no', 'Document number', 'text', '', { d: '' }),
    f('revision', 'Revision', 'text', '', { d: 'A' }),
    f('prepared', 'Prepared by', 'text', '', { d: '' }),
    f('checked', 'Checked by', 'text', '', { d: '' }),
    f('approved', 'Approved by', 'text', '', { d: '' }),
    f('appendix_points', 'Appendix: every point of the governing static cases', 'sel', '', { o: YN, d: 'yes' })
  ];
  var dynamicOptions = [
    f('ov_meth', 'Overthrow method', 'sel', '', { o: [['max', 'Max curvature within the car length (conservative)'], ['local', 'Local radius']], d: 'max', h: 'Conservative covers transitions and reverse curves' }),
    f('load', 'Load case for the dynamic calculation', 'sel', '', { o: [['tare', 'Tare (AW0)'], ['crush', 'Crush (AW4)']], d: 'tare', h: 'Tare normally governs (larger wind roll)' }),
    f('profile', 'Profile for the dynamic gauge', 'text', '', { d: '', h: 'Blank = car-end section profile of each car type' }),
    f('ch_from_m', 'Start chainage', 'num', 'm', { min: -1e6, max: 1e7, opt: true, h: 'Blank = start of the track data' }),
    f('ch_to_m', 'End chainage', 'num', 'm', { min: -1e6, max: 1e7, opt: true, h: 'Blank = end of the track data' }),
    f('ss_R_m', 'Speed-step study: curve radius (0 = tangent)', 'num', 'm', { min: 0, max: 1e6, d: 1000 }),
    f('ss_cant_mm', 'Speed-step study: applied cant', 'num', 'mm', { min: 0, max: 250, d: 75 }),
    f('ss_wind_kmh', 'Speed-step study: wind speed', 'num', 'km/h', { min: 0, max: 250, d: 60, h: 'Platform entry wind' }),
    f('ss_step_kmh', 'Speed-step study: speed step', 'num', 'km/h', { min: 1, max: 100, d: 10 }),
    f('ss_n', 'Speed-step study: number of steps (from 0)', 'int', '', { min: 1, max: 60, d: 13 }),
    f('ss_ke', 'Speed-step study: KE', 'text', '', { d: '', h: 'Blank = KE of the static check' })
  ];

  function defaults(fields) {
    var o = {}, i;
    for (i = 0; i < fields.length; i++) { o[fields[i].k] = fields[i].d !== undefined ? fields[i].d : (fields[i].opt ? null : undefined); if (o[fields[i].k] === undefined) { delete o[fields[i].k]; } }
    return o;
  }
  function byKey(fields, k) { for (var i = 0; i < fields.length; i++) { if (fields[i].k === k) { return fields[i]; } } return null; }

  return {
    trainDescription: trainDescription, trainConfig: trainConfig, trainLoad: trainLoad, trainWind: trainWind,
    trainFields: trainDescription.concat(trainConfig, trainLoad, trainWind),
    carType: carType, bogie: bogie.concat(playCalc), bogieMain: bogie, body: body, playCalc: playCalc, lowerPart: lowerPart, bogiePart: bogiePart, doorStep: doorStep,
    customerLimits: customerLimits, enParams: enParams, sodSettings: sodSettings, point: point, sodItem: sodItem,
    keProfile: keProfile, sodProfile: sodProfile, rsProfile: rsProfile,
    trackOperating: trackOperating, trackTolerances: trackTolerances, trackStatic: trackStatic, trackSweep: trackSweep,
    trackParams: trackOperating.concat(trackTolerances, trackStatic, trackSweep), segment: segment,
    staticOptions: staticOptions, dynamicOptions: dynamicOptions, reportOptions: reportOptions, swayTest: swayTest,
    defaults: defaults, byKey: byKey
  };
}));
