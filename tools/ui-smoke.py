# Optional browser smoke test (needs Python Playwright and Chrome/Chromium; NOT a dependency of the tool):
#   python tools/ui-smoke.py [outputDir]
# Opens index.html from file://, flags any non-file request or console error, visits every tab,
# downloads each tab template and re-imports it, edits a value, pastes cells, and writes screenshots. Dev aid only.
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
    ok(page.locator('#g-cartypes input, #g-cartypes select').count() >= 45, 'car type grid rendered')
    ok(page.locator('#train-drawing svg rect.car-body').count() == 6, 'train drawing has 6 cars')
    page.screenshot(path=os.path.join(out, '01-train.png'), full_page=True)

    tabs = ['train', 'bogie', 'ke', 'rs', 'track', 'ssim', 'sres', 'dsim', 'dres', 'summary', 'method']
    for i, t in enumerate(tabs):
        page.click('#tabbtn-' + t)
        page.wait_for_timeout(350)
        ok(page.locator('#tab-' + t).is_visible(), 'tab %s visible' % t)
        page.screenshot(path=os.path.join(out, '%02d-%s.png' % (i + 1, t)), full_page=True)
    ok(page.evaluate("!!Chart.getChart('chart-track')"), 'track chart drawn')
    page.click('#tabbtn-ke'); page.wait_for_timeout(300)
    ok(page.evaluate("Chart.getChart('chart-ke').data.datasets.length") >= 5, 'KE preview has KE + SOD + items datasets')
    page.click('#tabbtn-method'); page.wait_for_timeout(200)
    ok(page.locator('#method-toc button').count() > 15, 'method table of contents built')

    # template download + re-import for every input tab, after breaking something in that tab
    for t in ['train', 'bogie', 'ke', 'rs', 'track']:
        page.click('#tabbtn-' + t); page.wait_for_timeout(250)
        with page.expect_download() as d:
            page.click('[data-io="%s"] button:nth-of-type(2)' % t)
        f = os.path.join(out, '%s-current.xlsx' % t)
        d.value.save_as(f)
        ok(os.path.getsize(f) > 3000, '%s current-data workbook downloaded (%d bytes)' % (t, os.path.getsize(f)))
        page.set_input_files('#file-' + t, f)
        page.wait_for_timeout(500)
        txt = page.locator('#tab-%s .importmsg' % t).text_content()
        ok('Imported' in txt and 'None of the expected' not in txt, '%s re-import: %s' % (t, txt[:110]))

    # edit a value -> validation message, badge
    page.click('#tabbtn-train'); page.wait_for_timeout(200)
    page.locator('#f-train-desc input').nth(3).fill('DMC-TC-ZZ-MC-TC-DMC')
    page.wait_for_timeout(400)
    ok('"ZZ"' in page.locator('[data-msgs=train]').text_content(), 'formation error shown')
    ok(page.locator('#tabbtn-train .badge').text_content() != '', 'error badge on tab')
    ok(page.locator('#train-drawing rect.missing').count() == 1, 'unknown car drawn as missing')
    page.locator('#f-train-desc input').nth(3).fill('DMC-TC-MC-MC-TC-DMC')

    # paste two columns into the KE points table
    page.click('#tabbtn-ke'); page.wait_for_timeout(250)
    n0 = page.locator('#ps-ke table.rows tbody tr').count()
    cell = page.locator('#ps-ke table.rows tbody tr').nth(n0 - 1).locator('input').nth(1)
    page.evaluate("""(el) => { const dt = new DataTransfer(); dt.setData('text/plain', '10\\t75\\n0\\t60\\n'); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }""", cell.element_handle())
    page.wait_for_timeout(400)
    ok(page.locator('#ps-ke table.rows tbody tr').count() == n0 + 1, 'paste of 2 rows added 1 row (%d -> %d)' % (n0, page.locator('#ps-ke table.rows tbody tr').count()))

    # project save -> load
    with page.expect_download() as d:
        page.click('#btn-save')
    pj = os.path.join(out, 'project.rsgauge.json'); d.value.save_as(pj)
    page.click('#btn-new'); page.wait_for_timeout(300)
    page.set_input_files('#file-project', pj); page.wait_for_timeout(500)
    ok(page.locator('#ps-ke table.rows tbody tr').count() == n0 + 1 or page.evaluate("RSGAUGE.app.state.p.ke.profiles[0].points.length") == n0 + 1, 'project file restores the pasted point')
    page.click('#tabbtn-summary'); page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(out, '20-summary-after.png'), full_page=True)
    browser.close()

ok(not external, 'no network requests (%s)' % external[:3])
print('\n'.join(checks))
if problems:
    print('\nPROBLEMS:\n' + '\n'.join(problems))
    sys.exit(1)
print('\nall %d checks ok' % len(checks))
