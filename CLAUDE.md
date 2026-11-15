# rs_gauge_simulator — project notes

Owner: Vivek (GitHub `vs916491-maker`), rolling stock engineer. Sister tool of `rs-sec-simulator`; same rules and style.
Offline **rolling stock gauging simulator**: from the customer kinematic envelope (KE) derive the maximum static profile,
check our RS profile + movements against the customer KE (static), and check our KE against the structure gauge / SOD
chainage by chainage along the line (dynamic). The method is the owner's gauging workbook ("Vehicle Gauging Calculation
Tool"): Method B (generated KE, point clearance) and Method A (maximum static half-width); optional static check by the
EN 15273-2:2009 kinematic method (customer KE as reference profile, G1 rules as editable defaults; traction units,
motor coaches and coaches, w varying with the radius and variable stops, heights A.3.4 with a lower-parts table, bogie parts A.3.11, open doors / steps A.3.14–A.3.15, pantograph gauge A.3.12; static gauge method A.2 as a second option; rules of gauges GA, GB, GC, GB1, GB2, G2, DE1–DE3 selectable; METHOD §10). Third-rail CCD checks static and along the line (METHOD §14). EN dynamic method from simulation results (Annex O): import, swept envelope, model validation (METHOD §15). Applicable-rules framework (Customer KE / EN / EBO / BOStrab) on Train Configuration with per-check override; BOStrab §34 limits; EBO Anlage 9 and BOStrab-Lichtraum-Richtlinien pending the owner's documents (METHOD §16). The engine
reproduces the workbook exactly (`tests/workbook.test.js`, `tests/workbook-dynamic.test.js`); `tests/en15273*.test.js` check the
EN formulae against the standard typed in literally.

**Confidentiality:** all bundled data is FICTIONAL (`samples/`, `tests/fixtures/`). Never put real vehicle data, customer
KE/SOD, tender specs or alignment data into this repo or these notes. The owner's workbook stays outside the repo.

## Hard rules (ARCHITECTURE.md §1 — do not break)
1. Opens by double-clicking `index.html` (`file://`), fully offline. No build step, no npm install.
2. No ES modules; classic scripts in one namespace `RSGAUGE`, each file an IIFE/UMD. No CDN/external URLs; libs in `vendor/`.
3. Physics only in `js/engine.js` (pure). UI/plot/io files contain no equations.
4. No network APIs, no workers, no `innerHTML`. ES5-style code.
5. Units: mm for profiles/plays/cant, m for lengths/chainage/radii, km/h for speed.

## Where things live
| File | Job |
|---|---|
| `METHOD.md` | **The specification** (every equation, symbol, assumption), written from the workbook's Method & Formulas |
| `js/schema.js` | All input fields (labels, units, ranges, defaults) — shared by forms, templates, importers, checks |
| `js/model.js` | Project structure, `normalizeProject`, `validate` (messages per tab), profile/track helpers |
| `js/engine.js` | Calculation: `deriveCar` (pivots, A, wind Cw, Σd/Σu, theoretical s/hc, shared-bogie check), `staticRun` (3 sections + additional sections × the load cases per car type, `carLoads` / `carCases` / `carSections`, Method A, vertical checks, EN 15273-2 `enRun` + heights `enVertical` + `enBogieParts` when selected, static gauge `enStaticRun`), `dynamicRun` (chainage sweep per car type, worst per chainage, summaries, speed steps, SOD outline + point items `sodCheck`, CCD `ccdLine`), CCD static `ccdStatic`, EN dynamic method `simRun` / `simLine` (METHOD §15), `crossSection`, `swayEval` / `gaugeTestPlan` (Tests tab, METHOD §13), `playCalc` |
| `js/io.js` | Excel/CSV templates + importers per tab, export/import all, static and dynamic results workbooks, project file `*.rsgauge.json` (v2; v1 migrated) |
| `js/plot.js` | Chart.js datasets (profiles mirrored, track vs chainage, section outlines, Method A, chainage series, cross-section) |
| `js/calcsteps.js` | Calculation Method tab: step-by-step explanation (EN 15273-1/-2/-3, UIC 505-1/-4/-5, metro SOD practice) with live examples taken from engine results; no equations |
| `js/report.js` | Word gauging report: blocks from project + runs, .docx parts (zipped in the page with `vendor/jszip.min.js`; charts drawn by `ui.js`) |
| `js/ui.js` | The page: tabs, forms, column grids, row tables (paste from Excel), profile editors, previews, run, results |
| `js/method.js`, `js/presets.js` | **GENERATED** — run `node tools/make-presets.js` after editing METHOD.md or samples |
| `tools/workbook-reference.py` | Rebuilds `tests/fixtures/workbook-reference.json` from the owner's workbook (LibreOffice) |

## Tabs
Train Configuration · Car body & Bogie · Customer KE & SOD · RS Profile · Track Data · Static Simulation · Static Results ·
Dynamic Simulation · Dynamic Results · EN Dynamic Method · Tests · Overall Summary · Calculation Method · Method & Assumptions.

## Workflow
1. Change maths: METHOD.md first, then `js/engine.js`, then a test. Keep the workbook reproduction tests passing
   unless the owner deliberately changes the method (say so in the commit).
2. New input: `js/schema.js` (+ checks in `model.validate`), template/import follow automatically; add a test.
3. `node tools/make-presets.js` after METHOD.md / samples changes; `node tests/run-tests.js` must pass (CI runs it on PRs).
4. Optional browser check: `python tools/ui-smoke.py`.
5. Work on a branch, open a pull request; main is merged via PRs. One change per PR where possible.
