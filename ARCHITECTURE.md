# ARCHITECTURE

How the Rolling Stock Gauge Simulator is built. The calculation method is specified in `METHOD.md`.
Same rules and layout as the SEC simulator (`rs-sec-simulator`), so both tools work the same way.

## 1. Hard rules

1. **Opens by double-clicking `index.html`** (`file://`), **fully offline**.
2. **No build step.** No bundler, transpiler or npm install. What is in git is what runs.
3. **No ES modules.** Classic `<script src>` files sharing one global namespace, `RSGAUGE`; each file is an IIFE / UMD.
4. **No CDN links or external URLs.** Third-party libraries are copied into `vendor/` with their licences.
5. **The calculation engine lives in `js/engine.js` (Phase 2)**, pure: no DOM, no `Date`, no `Math.random`, no I/O,
   loadable by Node. UI and plot files contain **no equations**.
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
js/engine.js            CALCULATION ENGINE - Phase 2 (pure, DOM-free)
js/markdown.js          small Markdown renderer for the Method tab (DOM nodes, never innerHTML)
js/method.js            GENERATED from METHOD.md by tools/make-presets.js
js/presets.js           GENERATED from samples/sample-project.json by tools/make-presets.js (fictional data)
js/io.js                Excel/CSV templates and importers per tab, export all, project file (*.rsgauge.json)
js/plot.js              Chart.js dataset builders (reshape data only)
js/ui.js                tabs, forms, grids, tables, previews, messages; the only file building the page (exposes RSGAUGE.app)
vendor/                 xlsx.full.min.js (SheetJS 0.18.5), chart.umd.js (Chart.js 4.4.1), licences, README
samples/                sample-project.json (FICTIONAL 6-car metro, envelopes and 4.4 km line)
tests/                  run-tests.js + *.test.js (Node built-ins only)
tools/                  make-presets.js, ui-smoke.py (optional browser check, Python Playwright)
```

Script order: `vendor/xlsx.full.min.js` → `vendor/chart.umd.js` → `js/schema.js` → `js/model.js` →
`js/markdown.js` → `js/method.js` → `js/presets.js` → `js/io.js` → `js/plot.js` → (`js/engine.js`, Phase 2) → `js/ui.js`.

## 3. Data model (project file `*.rsgauge.json`, `format: "rsgauge-project"`, version 1)

```
{ format, version, name, notes, fictional,
  train:  { name, customer, line, formation, n_cars, gauge_mm, L_mm, vmax_kmh,
            bogie_arrangement: non_shared|shared, primary_type, secondary_type, power_supply,
            tare_label, laden_label, pax_mass_kg, laden_density,
            carTypes: [{ name, count, length_m, a_m, na1_m, na2_m, width_mm, floor_mm, roof_mm,
                         mass_tare_t, mass_laden_t, cg_tare_mm, cg_laden_mm, bogie1, bogie2 }] },
  bogies: [{ name, p_m, wheel_new_mm, wheel_worn_mm, d_min_mm, q_mm, w_mm, wi_mm, wa_mm,
             prim_static_mm, prim_dyn_mm, prim_rebound_mm, sec_static_mm, sec_dyn_mm, sec_rebound_mm,
             deflated_mm, overinfl_mm, frame_height_mm, s_bogie }],
  bodies: [{ car, s_tare, s_laden, hc_mm, eta0_deg, theta_w_deg, sag_mm, camber_mm, tol_y_mm, tol_z_mm, dyn_y_mm, dyn_z_mm }],
  ke:     { en: { s0, hc0_mm, D0_mm, I0_mm, Ck_m2, Rmin_m }, profiles: [{ name, note, points: [{pt, y, z}] }] },
  sod:    { frame: track|vertical, margin_mm, profiles: [...], items: [{ name, type, y, z, min_clear_mm }] },
  rs:     { profiles: [{ name, car (or ALL), mount: body|bogie|axle, points: [...] }] },
  track:  { params: { gauge_tol_mm, align_tol_mm, level_tol_mm, crosslevel_tol_mm, rail_wear_lat_mm, rail_wear_vert_mm, rail_wear_vehicle, dx_m },
            segments: [{ from_m, to_m, element, R_m, side, cant_mm, Rv_m, speed_kmh, section, form, sod, ke, widening_mm }] },
  settings: { static: {...}, dynamic: {...} }   // Phase 2-3
}
```

Results are not stored in the project file: the engine is deterministic, so they are recomputed.

## 4. Excel layouts (templates = current-data downloads = importers)

| Sheet | Layout | Tab |
|---|---|---|
| Train | Parameter / Value / Unit / Key | Train Configuration |
| CarTypes | one column per car type; rows = parameters, Key column | Train Configuration |
| Bogies, CarBodies | one column per bogie type / car type | Car body & Bogie |
| KE, SOD | one row per point; profile name repeated | Customer KE & SOD |
| EN_Params, SOD_Settings | Parameter / Value / Unit / Key | Customer KE & SOD |
| SOD_Items | one row per item | Customer KE & SOD |
| RSProfile | one row per point; profile name, car type, mounting repeated | RS Profile |
| TrackParams | Parameter / Value / Unit / Key | Track Data |
| Track | one row per segment | Track Data |

Headers end with `(key)`; the importer matches on the key (and on simple names such as `Profile`, `Point`, `Y`, `Z`
for CSV files). A single-sheet file or CSV is read as the tab's main sheet. Profile coordinates that look like
metres (all ≤ 20) are converted to mm with a message. Each tab imports only its own sheets; *Import all inputs*
reads every known sheet.

## 5. Testing

* `node tests/run-tests.js` — Node built-ins only. Model checks, import/export round trips, offline rules,
  generated files in step with their sources, plot data. CI runs it on every pull request.
* `python tools/ui-smoke.py` — optional: opens `index.html` from `file://` in Chrome, visits every tab, downloads and
  re-imports each tab's workbook, pastes cells, saves and reloads the project, flags any network request or console error.

## 6. Delivery phases

| Phase | Content | Status |
|---|---|---|
| 1 | METHOD.md draft, all input tabs, templates, import/export, project file, previews, checks, tests | **This pull request** |
| 2 | `js/engine.js`: displacement build-up, both methods; Static Simulation settings + Run; Static Results with graphs and build-up table | Next |
| 3 | Dynamic Simulation along the track data; Dynamic Results with clearance vs chainage and a chainage selector | |
| 4 | Overall Summary (static + dynamic), Excel results export, report | |
