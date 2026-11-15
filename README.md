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
   Method A and the vertical checks, and exports them to Excel.
6. **Dynamic Simulation**: sweeps every car type along the Track Data and press **Run dynamic simulation**;
   **Dynamic Results** gives the line summary (worst car type per chainage), charts against chainage, a chainage
   selector with the cross-section in the vertical frame, the per-element table and the speed-step study, and
   exports every sweep row to Excel.
7. **Apply typical values** (Train Configuration) loads LRV, Metro or High-speed typical inputs.
8. The **Overall Summary** tab shows what still needs fixing; the **Method & Assumptions** tab is the full method.

## Status

| Phase | Content | Status |
|---|---|---|
| 1 | Input tabs, templates, import/export, previews, input checks | Done |
| 2 | Inputs aligned to the workbook, static engine, Static Simulation and Static Results | Done |
| 3 | Dynamic Simulation and Dynamic Results (chainage selector, cross-section, speed-step study) | Done |
| 4 | Report, full SOD outline checks, EN 15273-2 option, validation calculations | Later |

## For developers

* Tests: `node tests/run-tests.js` (Node only, no packages). CI runs them on every pull request.
* After editing `METHOD.md` or `samples/sample-project.json`: `node tools/make-presets.js`.
* Optional browser check: `python tools/ui-smoke.py` (needs Python Playwright and Chrome).
* Rules and layout: `ARCHITECTURE.md`; the specification: `METHOD.md`.

All bundled data is **fictional**. Do not commit real customer envelopes, vehicle data or alignment data.
