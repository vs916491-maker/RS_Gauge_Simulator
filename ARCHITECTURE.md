# ARCHITECTURE

How the Rolling Stock Gauge Simulator is built. The calculation method is specified in `METHOD.md`.
Same rules and layout as the SEC simulator (`rs-sec-simulator`), so both tools work the same way.

## 1. Hard rules

1. **Opens by double-clicking `index.html`** (`file://`), **fully offline**.
2. **No build step.** No bundler, transpiler or npm install. What is in git is what runs.
3. **No ES modules.** Classic `<script src>` files sharing one global namespace, `RSGAUGE`; each file is an IIFE / UMD.
4. **No CDN links or external URLs.** Third-party libraries are copied into `vendor/` with their licences. The only
   `http://` strings in own code are XML namespace names of the Word file format in `js/report.js` (identifiers, not
   addresses); `tests/offline.test.js` allows exactly those.
5. **The calculation engine lives in `js/engine.js`**, pure: no DOM, no `Date`, no `Math.random`, no I/O,
   loadable by Node. UI and plot files contain **no equations**; calculated values shown on input tabs come from
   engine calls (`carGeometry`, `deriveCar`, `playCalc`).
6. No `fetch()`/XHR of local files, no Web Workers, no network of any kind (`tests/offline.test.js` checks this).
7. Units: mm for profiles, plays, wear, tolerances and cant; m for vehicle lengths, chainage and radii; km/h for speed.
   Input is never mutated; `model.normalizeProject()` returns a clean copy.
8. ES5-style code (old corporate browsers). No `innerHTML`: the DOM is built with `textContent` only.

## 2. File layout

```
index.html              single page; loads the scripts in the order below
css/style.css           all styling (light/dark via CSS variables)
js/schema.js            every input field: key, label, type, unit, range, default, help (forms, templates, importers, checks)
js/model.js             project structure, normalisation (safe copy, defaults), input checks per tab, profile/track helpers (DOM-free)
js/engine.js            CALCULATION ENGINE (pure, DOM-free): derived car data, static run (Method B, Method A, vertical checks), dynamic run (sweep, summaries, speed steps, cross-section)
js/calcsteps.js         Calculation Method tab content (DOM-free): steps with standard references, formulae and examples from engine results
js/report.js            Word report (DOM-free): content blocks from the project and the runs, .docx parts (WordprocessingML); no equations
js/markdown.js          small Markdown renderer for the Method tab (DOM nodes, never innerHTML)
js/method.js            GENERATED from METHOD.md by tools/make-presets.js
js/presets.js           GENERATED from samples/*.json by tools/make-presets.js (fictional sample + vehicle-type presets)
js/io.js                Excel/CSV templates and importers per tab, export all, static and dynamic results workbooks, project file (*.rsgauge.json)
js/plot.js              Chart.js dataset builders (reshape data only)
js/ui.js                tabs, forms, grids, tables, previews, messages; the only file building the page (exposes RSGAUGE.app)
vendor/                 xlsx.full.min.js (SheetJS 0.18.5), chart.umd.js (Chart.js 4.4.1), jszip.min.js (JSZip 3.10.1, zips the Word report), licences, README
samples/                sample-project.json (FICTIONAL 6-car metro, envelopes, 4.4 km line), vehicle-types.json (LRV / Metro / HS typical values)
tests/                  run-tests.js + *.test.js (Node built-ins only); fixtures/workbook-reference.json (fictional inputs + workbook results)
tools/                  make-presets.js, ui-smoke.py (optional browser check), workbook-reference.py (rebuilds the fixture from the owner's workbook)
```

Script order: `vendor/xlsx.full.min.js` → `vendor/chart.umd.js` → `vendor/jszip.min.js` → `js/schema.js` → `js/model.js` →
`js/markdown.js` → `js/method.js` → `js/presets.js` → `js/io.js` → `js/plot.js` → `js/engine.js` → `js/report.js` → `js/calcsteps.js` → `js/ui.js`.

## 3. Data model (project file `*.rsgauge.json`, `format: "rsgauge-project"`, version 2)

Version-1 files (Phase 1) are migrated on load (`model.migrate1`). Field lists, units and defaults are in `js/schema.js`.

```
{ format, version: 2, name, notes, fictional,
  train:  { name, customer, line, formation, n_cars, vehicle_type: lrv|metro|hs, bogie_arrangement, vmax_kmh, gauge_mm, L_mm (G),
            primary_type, secondary_type, power_supply, tare_label, laden_label, rho_air, Beq_mm,
            carTypes: [{ name, count, length_m, n_free_m, n_art_m, end1/end2: free|shared, ni_m (blank = a/2), na_m, width_mm, floor_mm,
                         sill_hw_mm, mass_tare_t, mass_crush_t, cg_tare_mm, cg_crush_mm, drop_crush_mm, bogie1, bogie2,
                         prof_int, prof_ext, prof_end }] },
  bogies: [{ name, p_m, play_ld_mm, q_mm, w_mm, w_defl_mm, wheel_new_mm, wheel_worn_mm, pack_step_mm, dn_prim_mm, dn_sec_inf_mm,
             dn_sec_def_mm, up_prim_mm, up_sec_mm, up_oi_mm, mass_t, n_axle, kz_prim, n_ps, b1_mm, z_prim_mm, kz2_t, kz2_c, kz_em,
             n_as, b2_mm, k_arb, z_sec_mm, z_sec_d_mm, ky_prim, ky_sec, ky2_d, bb_mm, ef_new_mm, ef_worn_mm }],
  bodies: [{ car, wind_len_m, wind_top_mm, wind_bot_mm, Cf, uf_h_mm, uf_hw_mm, uf_bog_h_mm, s_tare, s_crush, s_defl,
             hc_tare_mm, hc_crush_mm, hc_defl_mm }],
  ke:     { limits: { uf_min_body_mm, uf_min_bog_mm, axle_lim_t, prm_gap_mm, nosing_mm, sod_C_m, sod_L_m, sod_b_m, h_ref1_mm, h_ref2_mm },
            en: { EN 15273-2:2009 rules, G1 defaults }, profiles: [{ name, note, n_up, points: [{pt, y, z}] }] },
  sod:    { frame, margin_mm, profiles: [...], items: [{ name, type, y, z, min_clear_mm, side: both|L|R, ch_from_m, ch_to_m }] },
  tests:  { sway: [{ car, load: tare|crush|deflated, D_mm, low: L|R, h1_mm, y1_mm, h2_mm, y2_mm, h3_mm, y3_mm, note }] },   // not part of the out-of-date check
  rs:     { profiles: [{ name, note, points }] },
  track:  { params: { cant_max_mm, cantdef_max_mm, cantexc_max_mm, wind_open_kmh, wind_plat_kmh, g_tol_mm, fw_mm, align_tol_mm,
                      cl_err_mm, widen_mm, widen_R_m, R_min_m, R_static_m, Rv_static_m, dx_m },
            segments: [{ from_m, to_m, element: tangent|transition|circular, side, R_start_m, R_end_m, cant_start_mm, cant_end_mm,
                         speed_kmh, Rv_m, ke, location: open|tunnel|platform|depot, wind: Y|N, struct_mm, platform_mm, platform_side, sod, remarks }] },
  settings: { static: { ke, flex, latflex, lat_state, vert_state, comb, K_rss, gtol_ext, align, tilt, up_roll, wind, over_infl,
                        ma_from_mm, ma_to_mm, ma_step_mm, en_check: yes|no, cars: 'all' | 'A,B' },
              dynamic: { ov_meth: max|local, load: tare|crush, profile, ch_from_m, ch_to_m, ss_R_m, ss_cant_mm, ss_wind_kmh,
                         ss_step_kmh, ss_n, ss_ke, cars },   // the static options are the common options of both runs
              report: { title, doc_no, revision, prepared, checked, approved, appendix_points } }   // Word report fields; not part of the out-of-date check
}
```

Results are not stored in the project file: the engine is deterministic, so they are recomputed. The UI keeps the
inputs of the last run and flags the results as out of date when anything changes.

## 4. Excel layouts (templates = current-data downloads = importers)

| Sheet | Layout | Tab |
|---|---|---|
| Train | Parameter / Value / Unit / Key | Train Configuration |
| CarTypes | one column per car type; rows = parameters, Key column | Train Configuration |
| Bogies, CarBodies | one column per bogie type / car type | Car body & Bogie |
| KE, SOD | one row per point; profile name (and n_up) repeated | Customer KE & SOD |
| CustomerLimits, SOD_Settings, EN_Params | Parameter / Value / Unit / Key | Customer KE & SOD |
| SOD_Items | one row per item | Customer KE & SOD |
| RSProfile | one row per point; profile name repeated | RS Profile |
| TrackParams | Parameter / Value / Unit / Key | Track Data |
| Track | one row per segment | Track Data |

Headers end with `(key)`; select values may be given as their key or label in any case (e.g. `Circular`, `Open`, `Y`);
the static results export (Static Results tab) writes Static_Summary, Static_BuildUp, Static_Points, Method_A, EN15273_MaxGauge and EN15273_Check (when the EN check is selected),
Vertical_Checks and Derived_Values; the dynamic export (Dynamic Results tab) writes Dyn_Summary, Dyn_CarTypes,
Dyn_Elements, Dyn_SpeedStep and Dyn_Sweep (every sweep row of every car type). The importer matches on the key (and on simple names such as `Profile`, `Point`, `Y`, `Z`
for CSV files). A single-sheet file or CSV is read as the tab's main sheet. Profile coordinates that look like
metres (all ≤ 20) are converted to mm with a message. Each tab imports only its own sheets; *Import all inputs*
reads every known sheet.

## 5. Testing

* `node tests/run-tests.js` — Node built-ins only. `calcsteps.test.js`: Calculation Method steps (parts, references, examples
  equal to engine values, selectors, hints without runs). `test-calcs.test.js`: sway fit (exact recovery), acceptance, gauge test
  plan equal to the static run (linear and RSS), measured-s positions, input checks, tests export. `sod-outline.test.js`: closed-form SOD outline and point-item cases
  (rectangular outline, widening, cant rotation, item sides, ranges and curve hand) and the sample line. `report.test.js`: report chapters with and without the dynamic run and
  EN, well-formed .docx XML parts, escaping, image relations, figure numbering. `en15273.test.js`: the EN 15273-2 reductions and z_kin against the
  standard's formulae typed in literally (random vehicles, both branches), a hand check and the sample run;
  `en15273-mc.test.js`: w varying with the radius, motor coaches A.37–A.45 and variable stops, typed in literally.
  `workbook-dynamic.test.js`: the dynamic run against the workbook's
  Dynamic Calc for four option sets (every sweep column, summaries, speed steps, cross-section).
  `workbook.test.js`: the engine against the reference gauging workbook
  recalculated with fictional inputs for seven option sets (every case minimum, governing point, Method A row, vertical
  check, theoretical s and hc, wind constants, axle load). Plus engine closed forms, model checks and migration,
  import/export round trips, offline rules, generated files, chart data. CI runs it on every pull request.
* `python tools/workbook-reference.py <workbook.xlsx>` — rebuilds `tests/fixtures/workbook-reference.json` (needs
  openpyxl and LibreOffice; the workbook itself is not in the repository).
* `python tools/ui-smoke.py` — optional: opens `index.html` from `file://` in Chrome, visits every tab, re-imports each
  tab's workbook, runs the static simulation, checks the governing case and the export, the out-of-date flag, a
  vehicle-type preset and save/load, and flags any network request or console error.

## 6. Delivery phases

| Phase | Content | Status |
|---|---|---|
| 1 | Input tabs, templates, import/export, project file, previews, checks | Done (PR #1) |
| 2 | Inputs aligned to the workbook, METHOD.md from the workbook, static engine, theoretical s/hc, shared-bogie check, presets, Static Simulation and Static Results | Done (PR #2) |
| 3 | Dynamic Simulation (chainage sweep, speed-step study) and Dynamic Results with chainage selector and cross-section | Done (PR #3) |
| 4 | EN 15273-2:2009 kinematic method as a static option (customer KE as reference profile) | Done (PR #4) |
| 5 | Word gauging report (Overall Summary tab) | Done (PR #5) |
| 6 | Dynamic: whole-profile check against the SOD outline (widened on curves) and point items | Done (PR #6) |
| 7 | Tests tab: sway-test evaluation and kinematic gauge test plan | Done (PR #7) |
| 8 | Calculation Method tab: step-by-step explanation with standard references and live examples | Done (PR #8) |
| 9 | EN 15273-2: motor-coach formulae A.3.9.2, w varying with the radius, variable stops | Done |
| 10 | EN 15273-2: heights above the running surface A.3.4 (lower parts by Table A.1 zones, A.16–A.19), lower-parts table | Done |
| 11 | EN 15273-2: bogie parts A.3.11 (independent-axle formulae A.56–A.59), bogie-parts table | Done |
| 12 | EN 15273-2: static gauge method A.2 (A.2–A.5, s limit, lower parts A.2.3.2) | Done |
| 13 | EN 15273-2: open doors and deployed steps A.3.14, step position A.3.15.2 | **This pull request** |
| 14+ | EN 15273-2: pantograph, other profiles, dynamic method | Next, one PR each |
