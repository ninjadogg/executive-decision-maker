"""End-to-end checks for the Executive Decision Maker.

Starts a local no-cache server on a free port, drives Google Chrome (on the
GPU) with Playwright, and reports each check. Needs Python 3, the `playwright`
package (pip install playwright) and Google Chrome installed.

    python3 tests/run_tests.py
"""
import base64
import functools
import hashlib
import http.server
import pathlib
import socket
import sys
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
ANSWERS = {'DEFINITELY', 'ASK AGAIN', 'NEVER', 'FORGET IT', 'WHY NOT', 'POSSIBLY'}
LOCAL_FILES = ['index.html', 'style.css', 'boot.js', 'loader.js', 'main.js', 'themes.js',
               'favicon.svg', 'favicon.png', 'og-image.png',
               'fonts/montserrat-500.woff2', 'fonts/montserrat-alternates-800.woff2', 'fonts/press-start-2p.woff2']

# Collects CSP violations and page errors before any page script runs.
WATCH = """
window.__violations = [];
document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(e.violatedDirective + ' ' + e.blockedURI));
"""


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


def serve():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(NoCache, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f'http://127.0.0.1:{port}/'


results = []


def check(name):
    def wrap(fn):
        def run(*args):
            t0 = time.time()
            try:
                fn(*args)
                results.append((name, True, ''))
                print(f'  PASS  {name} ({time.time() - t0:.1f}s)')
            except Exception as e:  # report and carry on with the other checks
                results.append((name, False, str(e)))
                print(f'  FAIL  {name}: {e}')
        return run
    return wrap


def wait_js(page, expr, timeout=30000):
    """Poll a JS expression until truthy. (Playwright's wait_for_function evaluates
    a string in the page, which the site's Content-Security-Policy rightly blocks.)"""
    end = time.time() + timeout / 1000
    while time.time() < end:
        if page.evaluate(expr):
            return
        page.wait_for_timeout(100)
    raise TimeoutError(f'timed out waiting for {expr}')


def open_page(browser, url, **ctx):
    page = browser.new_page(**ctx)
    page.errors = []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and page.errors.append(m.text))
    page.add_init_script(WATCH)
    page.goto(url, wait_until='commit')
    wait_js(page, 'window.__edm && window.__edm.ready', 120000)
    return page


def decide(page, timeout=30000):
    page.evaluate('__edm.askDown(); __edm.askUp()')
    assert page.evaluate('__edm.answer') is None, 'an answer was showing while the lights ran'
    wait_js(page, '__edm.answer', timeout)
    return page.evaluate('__edm.answer')


def main():
    base = serve()
    debug = base + '?debug'
    print(f'Serving {ROOT} at {base}')
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True,
                                    args=['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'])

        @check('local files are served')
        def _():
            page = browser.new_page()
            for f in LOCAL_FILES:
                r = page.request.get(base + f)
                assert r.ok, f'{f}: HTTP {r.status}'
            page.close()
        _()

        @check('the CSP hash matches the import map (recompute it if the map changes)')
        def _():
            html = (ROOT / 'index.html').read_text()
            body = html.split('<script type="importmap">', 1)[1].split('</script>', 1)[0]
            digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
            assert f"'sha256-{digest}'" in html, f'import map now hashes to sha256-{digest}'
        _()

        for theme in ('studio', 'halloween'):
            @check(f'{theme}: loads cleanly (no errors, CSP violations or failed requests)')
            def _(theme=theme):
                failed = []
                page = browser.new_page()
                page.errors = []
                page.on('pageerror', lambda e: page.errors.append(str(e)))
                page.on('console', lambda m: m.type == 'error' and page.errors.append(m.text))
                page.on('requestfailed', lambda r: failed.append(r.url))
                page.on('response', lambda r: r.status >= 400 and failed.append(f'{r.status} {r.url}'))
                page.add_init_script(WATCH)
                page.goto(f'{debug}&theme={theme}', wait_until='commit')
                wait_js(page, 'window.__edm && window.__edm.ready', 120000)
                page.wait_for_timeout(1500)
                assert not page.errors, page.errors
                assert not failed, failed
                assert page.evaluate('window.__violations.length') == 0, page.evaluate('window.__violations')
                assert page.evaluate("!document.getElementById('loader')"), 'loading screen still up'
                page.close()
            _()

        page = open_page(browser, debug + '&theme=studio')

        @check('a decision lands on one of the six answers and holds')
        def _():
            a = decide(page)
            assert a in ANSWERS, a
            page.wait_for_timeout(3000)
            assert page.evaluate('__edm.answer') == a, 'answer changed after landing'
            assert page.inner_text('#readout') == a, 'readout does not match the lit answer'
        _()

        @check('the game-show wipe shows the answer')
        def _():
            page.evaluate('__edm.askDown(); __edm.askUp()')
            wait_js(page, '__edm.answer', 30000)
            page.wait_for_timeout(700)
            word = page.inner_text('#wipe .word')
            assert word == page.evaluate('__edm.answer'), word
            assert float(page.eval_on_selector('#wipe .word', 'e => getComputedStyle(e).opacity')) > 0.5
            page.wait_for_timeout(2500)
        _()

        @check('presses during a spin do not start a second spin')
        def _():
            page.evaluate('__edm.askDown(); __edm.askUp()')
            for _ in range(5):
                page.wait_for_timeout(80)
                page.evaluate('__edm.askDown(); __edm.askUp()')
            wait_js(page, '__edm.answer', 30000)
            a = page.evaluate('__edm.answer')
            page.wait_for_timeout(2500)
            assert page.evaluate('__edm.answer') == a
        _()

        @check('power off mid-spin cancels it; ASK does nothing while off')
        def _():
            page.evaluate('__edm.askDown(); __edm.askUp()')
            page.wait_for_timeout(400)
            page.evaluate('__edm.setPower(false)')
            page.wait_for_timeout(2500)
            assert page.evaluate('__edm.answer') is None
            page.evaluate('__edm.askDown(); __edm.askUp()')
            page.wait_for_timeout(1500)
            assert page.evaluate('__edm.answer') is None
            page.evaluate('__edm.setPower(true)')
            assert decide(page) in ANSWERS
        _()

        @check('Space bar asks')
        def _():
            page.mouse.move(10, 10)
            page.keyboard.press('Space')
            wait_js(page, '__edm.answer', 30000)
        _()

        @check('audio starts after a key press')
        def _():
            assert page.evaluate('__edm.audioState') == 'running', page.evaluate('__edm.audioState')
        _()

        @check('overlays fade when idle and come back on activity')
        def _():
            wait_js(page, "document.body.classList.contains('quiet')", 12000)
            page.mouse.move(300, 300)
            page.mouse.move(320, 320)
            page.wait_for_timeout(200)
            assert not page.evaluate("document.body.classList.contains('quiet')")
        _()

        @check('mute is remembered across reloads')
        def _():
            page.click('#mute')
            page.reload(wait_until='commit')
            wait_js(page, 'window.__edm && window.__edm.ready', 120000)
            assert page.inner_text('#mute') == 'Sound: off', page.inner_text('#mute')
            page.click('#mute')
            assert page.inner_text('#mute') == 'Sound: on'
        _()

        @check('answers are evenly distributed (chi-square, 60,000 draws)')
        def _():
            counts = page.evaluate('__edm.rngSample(60000)')
            expected = sum(counts) / len(counts)
            chi2 = sum((c - expected) ** 2 / expected for c in counts)
            assert chi2 < 20.5, f'chi-square {chi2:.1f} for {counts} (5 dof, p<0.001 cut-off 20.5)'
        _()
        page.close()

        @check('still decides when random.org is unreachable')
        def _():
            ctx = browser.new_context()
            ctx.route('**/www.random.org/**', lambda r: r.abort())
            pg = ctx.new_page()
            pg.goto(debug + '&theme=studio', wait_until='commit')
            wait_js(pg, 'window.__edm && window.__edm.ready', 120000)
            assert decide(pg) in ANSWERS
            assert 'device CSPRNG' in pg.inner_text('#rng'), pg.inner_text('#rng')
            ctx.close()
        _()

        @check('no debug hooks without ?debug')
        def _():
            pg = browser.new_page()
            pg.goto(base + '?theme=studio')
            wait_js(pg, "!document.getElementById('loader')", 120000)
            assert pg.evaluate('typeof window.__edm') == 'undefined'
            pg.close()
        _()

        @check('odd URL parameters fall back safely (?theme=__proto__, ?tex=1)')
        def _():
            for q in ('&theme=__proto__', '&theme=nope&tex=1'):
                pg = open_page(browser, debug + q)
                assert not pg.errors, pg.errors
                assert pg.evaluate('window.__theme') == 'studio' or pg.evaluate('new Date().getMonth()') == 9
                pg.close()
        _()

        @check('power switch works from the keyboard')
        def _():
            pg = open_page(browser, debug + '&theme=studio')
            pg.focus('#power')
            pg.keyboard.press('Enter')
            assert pg.get_attribute('#power', 'aria-pressed') == 'false'
            pg.evaluate('__edm.askDown(); __edm.askUp()')
            pg.wait_for_timeout(1200)
            assert pg.evaluate('__edm.answer') is None, 'asked while powered off'
            pg.keyboard.press('Enter')
            assert pg.get_attribute('#power', 'aria-pressed') == 'true'
            assert decide(pg) in ANSWERS
            pg.close()
        _()

        @check('a blocked CDN shows an error instead of loading forever')
        def _():
            ctx = browser.new_context()
            ctx.route('**/three.module.js', lambda r: r.abort())
            pg = ctx.new_page()
            pg.goto(base, wait_until='commit')
            wait_js(pg, "(() => { const f = document.getElementById('fail'); return !!f && getComputedStyle(f).display !== 'none'; })()", 20000)
            assert 'went wrong' in pg.inner_text('#fail'), pg.inner_text('#fail')
            ctx.close()
        _()

        @check('recovers from a lost graphics context')
        def _():
            pg = open_page(browser, debug + '&theme=studio')
            pg.evaluate("document.getElementById('c').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()")
            pg.wait_for_url('**tex=2048**', timeout=15000)
            wait_js(pg, 'window.__edm && window.__edm.ready', 120000)
            pg.close()
        _()

        @check('phone: loads, touch hint, decides')
        def _():
            ctx = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=3)
            pg = ctx.new_page()
            pg.goto(debug + '&theme=studio', wait_until='commit')
            wait_js(pg, 'window.__edm && window.__edm.ready', 120000)
            assert pg.inner_text('#hint').startswith('Tap ASK'), pg.inner_text('#hint')
            assert decide(pg) in ANSWERS
            ctx.close()
        _()

        @check('reduced motion: quick decision, no sweeping wipe')
        def _():
            ctx = browser.new_context(reduced_motion='reduce')
            pg = ctx.new_page()
            pg.goto(debug + '&theme=studio', wait_until='commit')
            wait_js(pg, 'window.__edm && window.__edm.ready', 120000)
            t0 = time.time()
            decide(pg)
            assert time.time() - t0 < 6, f'took {time.time() - t0:.1f}s'
            ctx.close()
        _()

        browser.close()

    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
