# RS Gauge Simulator

Offline rolling stock gauging tool (sister of the RS SEC Simulator).

* **Static (profile):** derive the maximum static profile from the customer kinematic envelope (KE), and check our
  RS profile + all vehicle/track movements (our KE) against the customer KE.
* **Dynamic (route):** chainage by chainage along the line (curve, cant, vertical curve, speed, section type), check
  our KE against the structure gauge / SOD and items such as the third rail and platform edge.
* Methods: **Metro SOD-style** movement build-up (deterministic + RSS) and **EN 15273-2** kinematic reductions.

## How to use

1. Download or clone the repository and **double-click `index.html`** (Chrome or Edge). Nothing to install; works offline.
2. The fictional example loads on first opening. Use **New** for an empty project, or replace the example tab by tab.
3. On each input tab: **Download template (Excel)**, fill it in, **Import Excel / CSV…**; or type / paste straight into
   the tables (paste Y/Z columns from Excel into any cell).
4. **Save project** writes one `*.rsgauge.json` file; **Load project…** opens it again. **Export all inputs** gives one
   workbook with every input sheet, which **Import all inputs…** reads back.
5. The **Overall Summary** tab shows what still needs fixing; the **Method & Assumptions** tab is the full method.

## Status

| Phase | Content | Status |
|---|---|---|
| 1 | Method draft, all input tabs, templates, import/export, previews, input checks | Done |
| 2 | Calculation engine; Static Simulation and Static Results | Next |
| 3 | Dynamic Simulation and Dynamic Results (chainage selector) | |
| 4 | Overall Summary of results, Excel export, report | |

## For developers

* Tests: `node tests/run-tests.js` (Node only, no packages). CI runs them on every pull request.
* After editing `METHOD.md` or `samples/sample-project.json`: `node tools/make-presets.js`.
* Optional browser check: `python tools/ui-smoke.py` (needs Python Playwright and Chrome).
* Rules and layout: `ARCHITECTURE.md`; the specification: `METHOD.md`.

All bundled data is **fictional**. Do not commit real customer envelopes, vehicle data or alignment data.
