# vendor/

Third-party libraries, copied here as single browser-ready files so the tool runs offline by
double-clicking `index.html`. They are loaded with classic `<script src>` tags (no ES modules, no CDN).
Same files and versions as in the SEC simulator.

| File | Library | Version | Licence | Source |
|---|---|---|---|---|
| `xlsx.full.min.js` | SheetJS Community Edition (Excel/CSV read and write) | 0.18.5 | Apache-2.0 (`LICENSE-sheetjs.txt`) | `dist/xlsx.full.min.js` of the npm package `xlsx@0.18.5` |
| `chart.umd.js` | Chart.js (charts) | 4.4.1 | MIT (`LICENSE-chartjs.txt`) | `dist/chart.umd.js` of the npm package `chart.js@4.4.1` |
| `jszip.min.js` | JSZip (writes the Word report) | 3.10.1 | MIT or GPLv3, used under MIT (`LICENSE-jszip.txt`) | `dist/jszip.min.js` of the npm package `jszip@3.10.1` |

## Security note on SheetJS 0.18.5

0.18.5 is the newest SheetJS release on the npm registry. Later releases (0.19.3 and above, only on the
SheetJS site) fix a prototype-pollution issue (CVE-2023-30533) and a regular-expression denial-of-service
(CVE-2024-22363) that a **crafted spreadsheet** can trigger. This tool only parses files that **you** pick on
your own computer and uploads nothing, so the exposure is small, but **do not import spreadsheets from
untrusted sources**. The importer (`js/model.js`, `clean()`) also drops `__proto__`/`constructor`/`prototype` keys.

## Updating a library

Copy the new single UMD/IIFE build here, update the table and the licence file, then run
`node tests/run-tests.js` (the offline test checks that the file is a classic, non-module build).
