# rs_gauge_simulator — project notes

Owner: Vivek (GitHub `vs916491-maker`), rolling stock engineer. Sister tool of `rs-sec-simulator`; same rules and style.
Offline **rolling stock gauging simulator**: from the customer kinematic envelope (KE) derive the maximum static profile,
check our RS profile + movements against the customer KE (static), and check our KE against the structure gauge / SOD
chainage by chainage along the line (dynamic). Two methods: Metro SOD-style build-up and EN 15273-2 kinematic method.

**Confidentiality:** all bundled data is FICTIONAL (`samples/`). Never put real vehicle data, customer KE/SOD, tender
specs or alignment data into this repo or these notes.

## Hard rules (ARCHITECTURE.md §1 — do not break)
1. Opens by double-clicking `index.html` (`file://`), fully offline. No build step, no npm install.
2. No ES modules; classic scripts in one namespace `RSGAUGE`, each file an IIFE/UMD. No CDN/external URLs; libs in `vendor/`.
3. Physics only in `js/engine.js` (pure). UI/plot/io files contain no equations.
4. No network APIs, no workers, no `innerHTML`. ES5-style code.
5. Units: mm for profiles/plays/cant, m for lengths/chainage/radii, km/h for speed.

## Where things live
| File | Job |
|---|---|
| `METHOD.md` | **The specification** (every equation, symbol, assumption). Items marked [verify] await the owner's check against EN 15273-2 |
| `js/schema.js` | All input fields (labels, units, ranges, defaults) — shared by forms, templates, importers, checks |
| `js/model.js` | Project structure, `normalizeProject`, `validate` (messages per tab), profile/track helpers |
| `js/io.js` | Excel/CSV templates + importers per tab, export/import all, project file `*.rsgauge.json` |
| `js/plot.js` | Chart.js datasets (profiles mirrored, track vs chainage) |
| `js/ui.js` | The page: tabs, forms, column grids, row tables (paste from Excel), profile editors, previews |
| `js/method.js`, `js/presets.js` | **GENERATED** — run `node tools/make-presets.js` after editing METHOD.md or samples |
| `js/engine.js` | Phase 2 |

## Tabs
Train Configuration · Car body & Bogie · Customer KE & SOD · RS Profile · Track Data · Static Simulation · Static Results ·
Dynamic Simulation · Dynamic Results · Overall Summary · Method & Assumptions.

## Workflow
1. Change maths: METHOD.md first, then `js/engine.js`, then a test.
2. New input: `js/schema.js` (+ checks in `model.validate`), template/import follow automatically; add a test.
3. `node tools/make-presets.js` after METHOD.md / samples changes; `node tests/run-tests.js` must pass (CI runs it on PRs).
4. Optional browser check: `python tools/ui-smoke.py`.
5. Work on a branch, open a pull request; main is merged via PRs. One change per PR where possible.
