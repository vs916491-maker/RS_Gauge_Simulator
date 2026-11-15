# RS Gauge Simulator

Offline rolling stock gauging tool (sister of the RS SEC Simulator).

* **Static (profile):** derive the maximum static profile from the customer kinematic envelope (KE), and check our
  RS profile + all vehicle/track movements (our KE) against the customer KE.
* **Dynamic (route):** chainage by chainage along the line (curve, cant, vertical curve, speed, section type), check
  our KE against the structure gauge / SOD and items such as the third rail and platform edge.
* Method of the reference gauging workbook: **Method B** (generated KE, point-by-point clearance) and **Method A**
  (maximum static half-width), six cases per car type (interior / exterior / car end × tare / crush), vertical checks,
  theoretical flexibility coefficient and roll centre, shared-bogie and axle-load check.

## How to use

1. Download or clone the repository and **double-click `index.html`** (Chrome or Edge). Nothing to install; works offline.
2. The fictional example loads on first opening. Use **New** for an empty project, or replace the example tab by tab.
3. On each input tab: **Download template (Excel)**, fill it in, **Import Excel / CSV…**; or type / paste straight into
   the tables (paste Y/Z columns from Excel into any cell).
4. **Save project** writes one `*.rsgauge.json` file; **Load project…** opens it again. **Export all inputs** gives one
   workbook with every input sheet, which **Import all inputs…** reads back.
5. **Static Simulation**: choose the options (defaults = reference method) and press **Run static simulation**;
   **Static Results** shows the governing car and case, charts of each section, the movement build-up, every point,
   Method A and the vertical checks, and exports them to Excel. Optionally it also checks by the EN 15273-2:2009
   kinematic method with the customer KE as reference profile (rules on the Customer KE & SOD tab, G1 defaults).
6. **Dynamic Simulation**: sweeps every car type along the Track Data and press **Run dynamic simulation**;
   **Dynamic Results** gives the line summary (worst car type per chainage), charts against chainage, a chainage
   selector with the cross-section in the vertical frame, the per-element table and the speed-step study, and
   exports every sweep row to Excel. Where a track element names an SOD profile, the whole displaced profile is checked
   against that outline (widened by the curve allowance); point items (third rail, platform edges, signals…) are
   checked on their side and chainage range.
7. **Tests**: enter the sway (roll) test readings — the tool fits s and hc and compares the roll displacement with the
   values used in gauging — and, after a static run, get the kinematic gauge test plan per car type and case (shims,
   lateral displacements to impose, test template and expected positions), exported to Excel.
8. **Apply typical values** (Train Configuration) loads LRV, Metro or High-speed typical inputs.
9. The **Overall Summary** tab shows what still needs fixing and writes the **Word gauging report** (document number,
   revision, prepared / checked / approved, then inputs, method, static, EN and dynamic results with charts, assumptions
   and appendices); the **Calculation Method** tab explains every calculation step with its EN 15273 / UIC 505 / metro SOD
   references and the numbers of the loaded project (car type, case and chainage selectable); the **Method & Assumptions**
   tab is the full formal specification.

## Status

| Phase | Content | Status |
|---|---|---|
| 1 | Input tabs, templates, import/export, previews, input checks | Done |
| 2 | Inputs aligned to the workbook, static engine, Static Simulation and Static Results | Done |
| 3 | Dynamic Simulation and Dynamic Results (chainage selector, cross-section, speed-step study) | Done |
| 4 | EN 15273-2:2009 kinematic method (static option) | Done |
| 5 | Word gauging report | Done |
| 6 | SOD outline and point-item checks (dynamic) | Done |
| 7 | Tests: sway-test evaluation and kinematic gauge test plan | Done |
| 8 | Calculation Method tab (step-by-step, standards, live examples) | Done |
| 9 | EN 15273-2: motor coaches, w varying with the radius, variable stops | Done |
| 10 | EN 15273-2: heights above the running surface (A.3.4), lower-parts table | Done |
| 11 | EN 15273-2: bogie parts (A.3.11), bogie-parts table | Done |
| 12 | EN 15273-2: static gauge method (A.2) | Done |
| 13 | EN 15273-2: open doors and steps (A.3.14 / A.3.15) | Done |
| 14 | EN 15273-2: pantograph gauge (A.3.12) | Done |
| 15 | Third-rail current collector (CCD) checks | Done |
| 16 | EN 15273-2: rules of gauges GA, GB, GC, GB1, GB2, G2, DE1–DE3 | Done |
| 17 | EN 15273-2: dynamic method (§5.2, Annex O) – new EN Dynamic Method tab | Done |

## For developers

* Tests: `node tests/run-tests.js` (Node only, no packages). CI runs them on every pull request.
* After editing `METHOD.md` or `samples/sample-project.json`: `node tools/make-presets.js`.
* Optional browser check: `python tools/ui-smoke.py` (needs Python Playwright and Chrome).
* Rules and layout: `ARCHITECTURE.md`; the specification: `METHOD.md`.

All bundled data is **fictional**. Do not commit real customer envelopes, vehicle data or alignment data.
