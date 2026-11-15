# Optional browser smoke test (needs Python Playwright and Chrome/Chromium; NOT a dependency of the tool):
#   python tools/ui-smoke.py [outputDir]
# Opens index.html from file://, flags any non-file request or console error, visits every tab, re-imports each tab's
# workbook, applies a preset, runs the static simulation, checks the results and exports, and writes screenshots. Dev aid only.
import os, sys, shutil
from playwright.sync_api import sync_playwright

root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, 'tmp-smoke')
os.makedirs(out, exist_ok=True)
url = 'file://' + os.path.join(root, 'index.html')
problems, checks, external = [], [], []

def ok(c, m):
    checks.append(('ok   ' if c else 'FAIL ') + m)
    if not c:
        problems.append(m)

chrome = shutil.which('google-chrome') or shutil.which('chromium') or shutil.which('chromium-browser')
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=chrome) if chrome else pw.chromium.launch()
    ctx = browser.new_context(accept_downloads=True, viewport={'width': 1366, 'height': 900})
    page = ctx.new_page()
    page.on('request', lambda r: external.append(r.url) if not r.url.startswith(('file:', 'data:', 'blob:')) else None)
    page.on('console', lambda m: problems.append('console %s: %s' % (m.type, m.text)) if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: problems.append('pageerror: %s' % e))
    page.on('dialog', lambda d: d.accept())
    page.goto(url)
    page.evaluate('localStorage.clear()')
    page.reload()
    page.wait_for_timeout(400)
    ok('Fictional example' in page.locator('#data-banner').text_content(), 'fictional banner shown')
    ok(page.locator('#g-cartypes input, #g-cartypes select').count() >= 60, 'car type grid rendered')
    ok(page.locator('#train-drawing svg rect.car-body').count() == 6, 'train drawing has 6 cars')
    ok('14.8' in page.locator('#calc-geometry').text_content(), 'calculated pivot distance shown')

    tabs = ['train', 'bogie', 'ke', 'rs', 'track', 'ssim', 'sres', 'dsim', 'dres', 'summary', 'method']
    for i, t in enumerate(tabs):
        page.click('#tabbtn-' + t)
        page.wait_for_timeout(300)
        ok(page.locator('#tab-' + t).is_visible(), 'tab %s visible' % t)
        page.screenshot(path=os.path.join(out, '%02d-%s.png' % (i + 1, t)), full_page=True)
    page.click('#tabbtn-bogie'); page.wait_for_timeout(200)
    ok('REVIEW' not in page.locator('#calc-body').text_content(), 'theoretical s plausible on the sample')
    page.click('#tabbtn-method'); page.wait_for_timeout(200)
    ok(page.locator('#method-toc button').count() > 15, 'method table of contents built')

    for t in ['train', 'bogie', 'ke', 'rs', 'track']:
        page.click('#tabbtn-' + t); page.wait_for_timeout(250)
        with page.expect_download() as d:
            page.click('[data-io="%s"] button:nth-of-type(2)' % t)
        f = os.path.join(out, '%s-current.xlsx' % t)
        d.value.save_as(f)
        page.set_input_files('#file-' + t, f)
        page.wait_for_timeout(500)
        txt = page.locator('#tab-%s .importmsg' % t).text_content()
        ok('Imported' in txt and 'None of the expected' not in txt, '%s re-import: %s' % (t, txt[:100]))

    # static run
    page.click('#tabbtn-ssim'); page.wait_for_timeout(250)
    ok(not page.locator('#btn-run-static').is_disabled(), 'run button enabled')
    page.click('#btn-run-static'); page.wait_for_timeout(800)
    ok(page.locator('#tab-sres').is_visible(), 'results tab opened after the run')
    gov = page.evaluate('RSGAUGE.app.state.run.governing')
    ok(gov and gov['car'] == 'TC' and abs(gov['c'] - 39.65) < 0.05, 'governing case TC exterior tare 39.65 mm (%s)' % gov)
    ok(page.evaluate("!!Chart.getChart('chart-sec-int') && !!Chart.getChart('chart-sec-end') && !!Chart.getChart('chart-methodA')"), 'section and Method A charts drawn')
    ok(page.locator('#sres-table tbody tr').count() == 3, 'one result row per car type')
    page.screenshot(path=os.path.join(out, '20-static-results.png'), full_page=True)
    page.select_option('#sres-car', 'DMC'); page.wait_for_timeout(300)
    page.select_option('#sres-case', 'int_c'); page.wait_for_timeout(300)
    ok(page.locator('#sres-points tbody tr').count() == 15, 'points table of interior crush (15 roof points)')
    eg = page.evaluate('RSGAUGE.app.state.run.en.governing')
    ok(page.locator('#sres-en').is_visible() and eg and eg['car'] == 'DMC' and abs(eg['margin'] - 10.45) < 0.05, 'EN 15273-2 section shown, smallest margin DMC car end 10.45 mm (%s)' % eg)
    ok(page.evaluate("!!Chart.getChart('chart-en')"), 'EN maximum construction gauge chart drawn')
    page.select_option('#sres-en-sec', 'end'); page.wait_for_timeout(300)
    ok(page.locator('#sres-en-check tbody tr.selrow').count() == 1, 'EN check table marks the governing point')
    page.locator('#sres-en').screenshot(path=os.path.join(out, '20b-static-en.png'))
    with page.expect_download() as d:
        page.click('#btn-export-static')
    f = os.path.join(out, 'static-results.xlsx'); d.value.save_as(f)
    ok(os.path.getsize(f) > 10000, 'static results workbook exported (%d bytes)' % os.path.getsize(f))

    # dynamic run
    page.click('#tabbtn-dsim'); page.wait_for_timeout(250)
    ok(not page.locator('#btn-run-dynamic').is_disabled(), 'dynamic run button enabled')
    page.screenshot(path=os.path.join(out, '22-dsim.png'), full_page=True)
    page.click('#btn-run-dynamic'); page.wait_for_timeout(1500)
    ok(page.locator('#tab-dres').is_visible(), 'dynamic results tab opened after the run')
    sm = page.evaluate('RSGAUGE.app.state.drun.summary')
    ok(sm['points'] == 441 and sm['ok'], 'dynamic summary: 441 points, all OK (%s points)' % sm['points'])
    ok(all(page.evaluate("!!Chart.getChart('%s')" % c) for c in ['chart-d-curv', 'chart-d-speed', 'chart-d-hw', 'chart-d-excess', 'chart-d-struct', 'chart-d-uf', 'chart-d-xs', 'chart-d-ss']), 'all 8 dynamic charts drawn')
    ok(page.locator('#dres-elements tbody tr').count() == 20, 'one row per track element')
    ok(page.locator('#dres-ss tbody tr').count() == 13, '13 speed steps')
    page.screenshot(path=os.path.join(out, '23-dres.png'), full_page=True)
    page.fill('#dres-ch', '1990'); page.press('#dres-ch', 'Enter'); page.wait_for_timeout(400)
    ok('Left-hand curve' in page.locator('#dres-xs').text_content(), 'cross-section at 1990 m is in the left-hand R300 curve')
    ok(abs(page.evaluate("Chart.getChart('chart-d-hw').data.datasets.filter(d=>d._marker)[0].data[0].x") - 1990) < 1e-6, 'chainage marker moved on the charts')
    page.screenshot(path=os.path.join(out, '24-dres-1990.png'), full_page=True)
    page.click('#dres-worst'); page.wait_for_timeout(300)
    ok(float(page.input_value('#dres-ch')) > 4000, 'worst outside excess button jumps to the depot curve (%s)' % page.input_value('#dres-ch'))
    page.select_option('#dres-car', 'MC'); page.wait_for_timeout(400)
    ok('MC' in page.locator('#dres-ss-note').text_content(), 'car type selector switches the speed-step study')
    with page.expect_download() as d:
        page.click('#btn-export-dynamic')
    f = os.path.join(out, 'dynamic-results.xlsx'); d.value.save_as(f)
    ok(os.path.getsize(f) > 50000, 'dynamic results workbook exported (%d bytes)' % os.path.getsize(f))
    page.click('#tabbtn-summary'); page.wait_for_timeout(300)
    ok('ALL OK along' in page.locator('#summary-dynamic').text_content(), 'overall summary shows the dynamic result')

    # Word report
    page.locator('#f-report input').nth(1).fill('DEMO-GAU-001'); page.wait_for_timeout(300)
    ok('out of date' not in page.locator('#data-banner').text_content(), 'report fields do not make the results stale')
    with page.expect_download() as d:
        page.click('#btn-report')
    rep = os.path.join(out, 'gauging-report.docx'); d.value.save_as(rep)
    import zipfile, xml.dom.minidom
    with zipfile.ZipFile(rep) as z:
        names = z.namelist()
        for n in names:
            if n.endswith('.xml') or n.endswith('.rels'):
                xml.dom.minidom.parseString(z.read(n))
        media = [n for n in names if n.startswith('word/media/')]
        docxml = z.read('word/document.xml').decode('utf8')
    ok(len(media) >= 12, 'Word report written: %d figures, all XML parts parse' % len(media))
    ok('7. Dynamic results' in docxml and '6. EN 15273-2:2009' in docxml, 'report has the EN and dynamic chapters')
    ok(d.value.suggested_filename.startswith('DEMO-GAU-001'), 'report file name starts with the document number (%s)' % d.value.suggested_filename)
    ok('Report written' in page.locator('#report-status').text_content(), 'report status message')

    # stale flag after an input change, and an option change
    page.click('#tabbtn-track'); page.wait_for_timeout(200)
    page.locator('#f-track-op input').nth(1).fill('110'); page.wait_for_timeout(400)
    ok('out of date' in page.locator('#data-banner').text_content(), 'results flagged out of date after an input change')
    ok('Dynamic results are out of date' in page.locator('#data-banner').text_content(), 'dynamic results flagged out of date too')
    page.click('#tabbtn-ssim'); page.wait_for_timeout(200)
    page.click('#btn-run-static'); page.wait_for_timeout(600)
    ok('Static results are out of date' not in page.locator('#data-banner').text_content(), 'static stale flag cleared after re-run')

    # preset
    page.click('#tabbtn-train'); page.wait_for_timeout(200)
    page.select_option('#f-train-config select >> nth=0', 'lrv'); page.wait_for_timeout(200)
    page.click('#btn-preset'); page.wait_for_timeout(500)
    ok(page.evaluate("RSGAUGE.app.state.p.train.carTypes[0].length_m") == 12, 'LRV preset applied (Lb = 12 m)')
    ok(page.evaluate("RSGAUGE.app.state.p.train.carTypes.map(c=>c.name).join()") == 'DMC,TC,MC', 'names kept by the preset')

    # project save -> load
    with page.expect_download() as d:
        page.click('#btn-save')
    pj = os.path.join(out, 'project.rsgauge.json'); d.value.save_as(pj)
    page.click('#btn-new'); page.wait_for_timeout(300)
    page.set_input_files('#file-project', pj); page.wait_for_timeout(500)
    ok(page.evaluate("RSGAUGE.app.state.p.train.carTypes[0].length_m") == 12, 'project file restores the preset values')
    page.click('#tabbtn-summary'); page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(out, '21-summary.png'), full_page=True)
    browser.close()

ok(not external, 'no network requests (%s)' % external[:3])
print('\n'.join(checks))
if problems:
    print('\nPROBLEMS:\n' + '\n'.join(problems))
    sys.exit(1)
print('\nall %d checks ok' % len(checks))
