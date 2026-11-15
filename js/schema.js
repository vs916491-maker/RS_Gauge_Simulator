/*
 * Input definitions shared by the forms (ui.js), the Excel/CSV templates and importers (io.js) and the
 * checks (model.js). One field = { k: key, l: label, t: type, u: unit, o: options, h: help, min, max, d: default }.
 * Types: num, int, text, sel. Contains no physics. Attaches to RSGAUGE.schema.
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

  // ---------------------------------------------------------------- Train configuration tab
  var trainDescription = [
    f('name', 'Train name', 'text', '', { d: '' }),
    f('customer', 'Customer', 'text', '', { d: '' }),
    f('line', 'Line / project', 'text', '', { d: '' }),
    f('formation', 'Train formation', 'text', '', { h: 'Car type names joined by "-", e.g. DMC-TC-MC-MC-TC-DMC', d: '' }),
    f('n_cars', 'Number of cars', 'int', '', { min: 1, max: 20, d: 6 }),
    f('gauge_mm', 'Nominal track gauge', 'num', 'mm', { min: 600, max: 1800, d: 1435 }),
    f('L_mm', 'Distance between rail running circles L', 'num', 'mm', { min: 600, max: 1900, d: 1500, h: '1500 mm for 1435 mm gauge; used for cant and roll' }),
    f('vmax_kmh', 'Maximum vehicle speed', 'num', 'km/h', { min: 1, max: 400, d: 90 })
  ];
  var trainConfig = [
    f('bogie_arrangement', 'Bogie arrangement', 'sel', '', { o: [['non_shared', 'Non-shared (2 bogies per car)'], ['shared', 'Shared / Jacobs (bogies between cars)']], d: 'non_shared' }),
    f('primary_type', 'Primary suspension', 'sel', '', { o: [['chevron', 'Chevron / rubber'], ['coil', 'Coil spring'], ['other', 'Other']], d: 'chevron' }),
    f('secondary_type', 'Secondary suspension', 'sel', '', { o: [['air', 'Air spring'], ['coil', 'Coil spring'], ['other', 'Other']], d: 'air' }),
    f('power_supply', 'Power supply', 'sel', '', { o: [['third_rail', 'Third rail'], ['ohe', 'Overhead (pantograph)'], ['none', 'None / other']], d: 'third_rail' })
  ];
  var trainLoad = [
    f('tare_label', 'Tare load condition (upper parts)', 'text', '', { d: 'AW0', h: 'Label of the empty condition: highest body position' }),
    f('laden_label', 'Laden load condition (lower parts)', 'text', '', { d: 'AW4', h: 'Label of the crush condition: lowest body position' }),
    f('pax_mass_kg', 'Passenger mass', 'num', 'kg', { min: 40, max: 120, d: 68 }),
    f('laden_density', 'Standing density at laden', 'num', 'pax/m²', { min: 0, max: 12, d: 8 })
  ];
  var carType = [
    f('name', 'Car type name', 'text', '', { d: 'CAR' }),
    f('count', 'Number in the train', 'int', '', { min: 0, max: 20, d: 1 }),
    f('length_m', 'Length over body', 'num', 'm', { min: 2, max: 40, d: 20.6 }),
    f('a_m', 'Bogie centre distance a', 'num', 'm', { min: 1, max: 30, d: 14.8, h: 'Shared bogies: distance between the articulation centres' }),
    f('na1_m', 'Overhang beyond bogie centre, end 1', 'num', 'm', { min: 0, max: 10, d: 2.9 }),
    f('na2_m', 'Overhang beyond bogie centre, end 2', 'num', 'm', { min: 0, max: 10, d: 2.9 }),
    f('width_mm', 'Maximum body width', 'num', 'mm', { min: 1000, max: 4000, d: 2860 }),
    f('floor_mm', 'Floor height above rail', 'num', 'mm', { min: 100, max: 2000, d: 1110 }),
    f('roof_mm', 'Roof height above rail', 'num', 'mm', { min: 1500, max: 5500, d: 3780 }),
    f('mass_tare_t', 'Mass tare', 'num', 't', { min: 1, max: 120, d: 38 }),
    f('mass_laden_t', 'Mass laden', 'num', 't', { min: 1, max: 160, d: 56 }),
    f('cg_tare_mm', 'CG height tare', 'num', 'mm', { min: 200, max: 3000, d: 1500 }),
    f('cg_laden_mm', 'CG height laden', 'num', 'mm', { min: 200, max: 3000, d: 1600 }),
    f('bogie1', 'Bogie type at end 1', 'text', '', { d: 'T', h: 'Name of a bogie type on the Car body & Bogie tab' }),
    f('bogie2', 'Bogie type at end 2', 'text', '', { d: 'T' })
  ];

  // ---------------------------------------------------------------- Car body & bogie tab
  var bogie = [
    f('name', 'Bogie type name', 'text', '', { d: 'B' }),
    f('p_m', 'Wheelbase p', 'num', 'm', { min: 0.5, max: 5, d: 2.3 }),
    f('wheel_new_mm', 'Wheel diameter new', 'num', 'mm', { min: 300, max: 1300, d: 860 }),
    f('wheel_worn_mm', 'Wheel diameter fully worn', 'num', 'mm', { min: 300, max: 1300, d: 780 }),
    f('d_min_mm', 'Dimension over flanges d (minimum, worn)', 'num', 'mm', { min: 500, max: 1800, d: 1412, h: 'Measured 10 mm below the tread' }),
    f('q_mm', 'Primary lateral play q (each side)', 'num', 'mm', { min: 0, max: 50, d: 4 }),
    f('w_mm', 'Secondary lateral displacement w (each side, to hard stop)', 'num', 'mm', { min: 0, max: 150, d: 30 }),
    f('wi_mm', 'Secondary lateral towards curve inside wi(R)', 'num', 'mm', { min: 0, max: 150, d: 30, h: 'Blank = same as w' }),
    f('wa_mm', 'Secondary lateral towards curve outside wa(R)', 'num', 'mm', { min: 0, max: 150, d: 30, h: 'Blank = same as w' }),
    f('prim_static_mm', 'Primary vertical deflection tare to laden', 'num', 'mm', { min: 0, max: 100, d: 8 }),
    f('prim_dyn_mm', 'Primary vertical dynamic deflection', 'num', 'mm', { min: 0, max: 100, d: 6 }),
    f('prim_rebound_mm', 'Primary vertical rebound (upwards)', 'num', 'mm', { min: 0, max: 100, d: 10 }),
    f('sec_static_mm', 'Secondary vertical deflection tare to laden', 'num', 'mm', { min: 0, max: 150, d: 5, h: 'Small with levelling valves' }),
    f('sec_dyn_mm', 'Secondary vertical dynamic deflection', 'num', 'mm', { min: 0, max: 150, d: 25 }),
    f('sec_rebound_mm', 'Secondary vertical rebound (upwards)', 'num', 'mm', { min: 0, max: 150, d: 30 }),
    f('deflated_mm', 'Air spring deflated drop', 'num', 'mm', { min: 0, max: 150, d: 35 }),
    f('overinfl_mm', 'Air spring over-inflation (upwards)', 'num', 'mm', { min: 0, max: 150, d: 15 }),
    f('frame_height_mm', 'Bogie frame reference height above rail', 'num', 'mm', { min: 100, max: 1500, d: 700 }),
    f('s_bogie', 'Equivalent flexibility of the bogie frame on primary', 'num', '', { min: 0, max: 1, d: 0 })
  ];
  var body = [
    f('car', 'Car type', 'text', '', { d: '' }),
    f('s_tare', 'Flexibility coefficient s, tare', 'num', '', { min: 0, max: 1, d: 0.25 }),
    f('s_laden', 'Flexibility coefficient s, laden', 'num', '', { min: 0, max: 1, d: 0.3 }),
    f('hc_mm', 'Roll centre height hc above rail', 'num', 'mm', { min: 0, max: 3000, d: 700 }),
    f('eta0_deg', 'Asymmetry angle η0', 'num', 'deg', { min: 0, max: 5, d: 0.5 }),
    f('theta_w_deg', 'Body roll under design wind θw', 'num', 'deg', { min: 0, max: 5, d: 0.4 }),
    f('sag_mm', 'Mid-car body sag, laden', 'num', 'mm', { min: 0, max: 50, d: 6 }),
    f('camber_mm', 'Mid-car body camber, tare', 'num', 'mm', { min: 0, max: 50, d: 4 }),
    f('tol_y_mm', 'Body manufacturing tolerance lateral', 'num', 'mm', { min: 0, max: 50, d: 5 }),
    f('tol_z_mm', 'Body manufacturing tolerance vertical', 'num', 'mm', { min: 0, max: 50, d: 5 }),
    f('dyn_y_mm', 'Dynamic oscillation allowance lateral', 'num', 'mm', { min: 0, max: 100, d: 15 }),
    f('dyn_z_mm', 'Dynamic oscillation allowance vertical', 'num', 'mm', { min: 0, max: 100, d: 15 })
  ];

  // ---------------------------------------------------------------- Customer KE & SOD tab
  var enParams = [
    f('s0', 'Reference flexibility s0', 'num', '', { min: 0, max: 1, d: 0.4 }),
    f('hc0_mm', 'Reference roll centre height hc0', 'num', 'mm', { min: 0, max: 2000, d: 500 }),
    f('D0_mm', 'Cant deficiency allowance D0', 'num', 'mm', { min: 0, max: 300, d: 50 }),
    f('I0_mm', 'Cant excess allowance I0', 'num', 'mm', { min: 0, max: 300, d: 50 }),
    f('Ck_m2', 'Overthrow allowance coefficient Ck (k = Ck/R)', 'num', 'm²', { min: 0, max: 20, d: 2.5, h: 'From the associated rules of the reference profile [verify]' }),
    f('Rmin_m', 'Smallest radius for the formulae', 'num', 'm', { min: 0, max: 1000, d: 150 })
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
    f('min_clear_mm', 'Required clearance', 'num', 'mm', { min: 0, max: 1000, d: 50 })
  ];
  var keProfile = [f('name', 'Profile name', 'text'), f('note', 'Note / condition', 'text')];
  var sodProfile = [f('name', 'Profile name', 'text'), f('note', 'Note', 'text')];

  // ---------------------------------------------------------------- RS profile tab
  var rsProfile = [
    f('name', 'Profile name', 'text'),
    f('car', 'Car type (or ALL)', 'text', '', { d: 'ALL' }),
    f('mount', 'Mounting level', 'sel', '', { o: [['body', 'Car body (sprung on secondary)'], ['bogie', 'Bogie frame (sprung on primary)'], ['axle', 'Axle / unsprung']], d: 'body' })
  ];

  // ---------------------------------------------------------------- Track data tab
  var trackParams = [
    f('gauge_tol_mm', 'Track gauge tolerance (wide)', 'num', 'mm', { min: 0, max: 30, d: 3 }),
    f('align_tol_mm', 'Lateral alignment tolerance', 'num', 'mm', { min: 0, max: 50, d: 3 }),
    f('level_tol_mm', 'Vertical (level) tolerance', 'num', 'mm', { min: 0, max: 50, d: 5 }),
    f('crosslevel_tol_mm', 'Cross-level tolerance', 'num', 'mm', { min: 0, max: 50, d: 4 }),
    f('rail_wear_lat_mm', 'Lateral rail wear', 'num', 'mm', { min: 0, max: 30, d: 6 }),
    f('rail_wear_vert_mm', 'Vertical rail wear', 'num', 'mm', { min: 0, max: 30, d: 8 }),
    f('rail_wear_vehicle', 'Rail wear counted on the vehicle side', 'sel', '', { o: [['no', 'No (infrastructure)'], ['yes', 'Yes']], d: 'no' }),
    f('dx_m', 'Step for long segments (dynamic run)', 'num', 'm', { min: 1, max: 500, d: 10 })
  ];
  var segment = [
    f('from_m', 'Chainage from', 'num', 'm', { min: -1e6, max: 1e7 }),
    f('to_m', 'Chainage to', 'num', 'm', { min: -1e6, max: 1e7 }),
    f('element', 'Element', 'text', '', { d: '' }),
    f('R_m', 'Horizontal radius R (0 = tangent)', 'num', 'm', { min: 0, max: 1e6, d: 0 }),
    f('side', 'Curve side', 'sel', '', { o: [['', '—'], ['L', 'Left'], ['R', 'Right']], d: '' }),
    f('cant_mm', 'Cant E', 'num', 'mm', { min: 0, max: 250, d: 0 }),
    f('Rv_m', 'Vertical radius Rv (+ crest, − sag, 0 none)', 'num', 'm', { min: -1e6, max: 1e6, d: 0 }),
    f('speed_kmh', 'Speed limit', 'num', 'km/h', { min: 0, max: 400, d: 80 }),
    f('section', 'Section type', 'sel', '', { o: [['tunnel', 'Tunnel'], ['elevated', 'Elevated'], ['at_grade', 'At-grade'], ['depot', 'Depot']], d: 'at_grade' }),
    f('form', 'Track form', 'sel', '', { o: [['ballastless', 'Ballastless'], ['ballasted', 'Ballasted']], d: 'ballastless' }),
    f('sod', 'SOD profile', 'text', '', { d: '' }),
    f('ke', 'KE profile', 'text', '', { d: '' }),
    f('widening_mm', 'Gauge widening', 'num', 'mm', { min: 0, max: 40, d: 0 })
  ];

  function defaults(fields) {
    var o = {}, i;
    for (i = 0; i < fields.length; i++) { if (fields[i].d !== undefined) { o[fields[i].k] = fields[i].d; } }
    return o;
  }
  function byKey(fields, k) { for (var i = 0; i < fields.length; i++) { if (fields[i].k === k) { return fields[i]; } } return null; }

  return {
    trainDescription: trainDescription, trainConfig: trainConfig, trainLoad: trainLoad,
    trainFields: trainDescription.concat(trainConfig, trainLoad),
    carType: carType, bogie: bogie, body: body,
    enParams: enParams, sodSettings: sodSettings, point: point, sodItem: sodItem,
    keProfile: keProfile, sodProfile: sodProfile, rsProfile: rsProfile,
    trackParams: trackParams, segment: segment,
    defaults: defaults, byKey: byKey
  };
}));
