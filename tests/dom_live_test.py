#!/usr/bin/env python3
"""Headless-Chromium DOM test: what a screen reader is told, and how often.

The hero card used to be one big aria-live="polite" aria-atomic region, so every step of the Harvey replay slider,
every 15-minute refresh (even with the same answer) and the Share button's "Link copied" re-read the whole card,
and the alerts list re-announced itself on every unchanged refresh. Now one short sr-only status line (#heroLive)
speaks only when the place or level changes (the replay waits until the slider rests), and alerts are rewritten
only when they change. Every network call is stubbed (fixtures from dom_429_test.py).
Run: python3 tests/dom_live_test.py
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dom_429_test as D
from playwright.sync_api import sync_playwright

WATCH = """() => { window.__said = []; window.__alertWrites = 0;
  new MutationObserver(() => { const t = document.getElementById('heroLive').textContent; if (t) window.__said.push(t); })
    .observe(document.getElementById('heroLive'), {childList: true, characterData: true, subtree: true});
  new MutationObserver(() => { window.__alertWrites++; }).observe(document.getElementById('alerts'), {childList: true}); }"""

def main():
    for f in ('/tmp/leaflet.js',):
        if os.path.exists(f): D.LEAFLET = open(f, 'rb').read()
    srv = D.serve(); base = 'http://127.0.0.1:%d' % srv.server_address[1]
    fx = D.fixtures(); res = []
    def check(name, cond, info=''):
        res.append(cond); print(('ok - ' if cond else 'FAIL - ') + name + ('' if cond else '   ' + json.dumps(info, ensure_ascii=False)[:500]))
    def route_for(pg):
        def route(r):
            u = r.request.url
            if u.startswith(base): return r.continue_()
            if 'unpkg.com/leaflet' in u and D.LEAFLET: return r.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'}, content_type='application/javascript', body=D.LEAFLET)
            k = D.classify(u)
            if k is None: return r.fulfill(status=204, body='')
            return r.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'}, content_type='application/json', body=json.dumps(fx[k]))
        pg.route('**/*', route)
    settle = lambda pg: (pg.wait_for_function("!document.getElementById('main').hasAttribute('aria-busy') && document.getElementById('lvlNum').textContent.trim() !== '-'", timeout=20000), pg.wait_for_timeout(400))
    with sync_playwright() as p:
        b = D.launch(p)
        for lang, word in (('en', 'Beacon level'), ('es', 'Nivel Beacon')):
            ctx = b.new_context(viewport={'width': 390, 'height': 800}, service_workers='block', permissions=['clipboard-read', 'clipboard-write'])
            pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); route_for(pg)
            pg.goto(base + '/index.html?lang=' + lang, wait_until='domcontentloaded'); settle(pg)
            roles = pg.evaluate("[document.getElementById('hero').getAttribute('aria-live'), document.getElementById('heroLive').getAttribute('role'), getComputedStyle(document.getElementById('heroLive')).width]")
            check(lang + ': the hero card is not a live region; #heroLive is a status line, visually hidden', roles[0] is None and roles[1] == 'status' and roles[2] == '1px', roles)
            line = pg.evaluate("document.getElementById('heroLive').textContent")
            name = pg.evaluate("document.getElementById('lvlName').textContent.trim()")
            check(lang + ': first answer is spoken as one short line (place + level)', word in line and name in line and len(line) < 120, line)
            pg.evaluate(WATCH)
            pg.click('.chip[data-ll] >> nth=2'); settle(pg)   # Richmond chip = a new place: one line, no more
            first = pg.evaluate("window.__said.slice()")
            check(lang + ': a new place is spoken once', len(first) == 1 and word in first[0], first)
            pg.evaluate("window.__said = []; window.__alertWrites = 0")
            pg.click('.chip[data-ll] >> nth=2'); settle(pg)   # same place again = what a 15-minute refresh with the same answer does
            check(lang + ': the same answer again says nothing', pg.evaluate("window.__said.length") == 0, pg.evaluate("window.__said"))
            check(lang + ': unchanged alerts are not rewritten (no re-announcement)', pg.evaluate("window.__alertWrites") == 0, pg.evaluate("window.__alertWrites"))
            pg.click('#shareBtn'); pg.wait_for_timeout(300)
            said = pg.evaluate("window.__said.slice()"); btn = pg.inner_text('#shareBtn').strip()
            check(lang + ': Share says only "%s", not the whole card' % btn, said == [btn], [said, btn])
            # Harvey replay: scrub the slider through 30 steps quickly; the line speaks once, after it rests
            pg.click('#demoBtn'); settle(pg); pg.wait_for_timeout(1000)
            pg.evaluate("window.__said = []")
            pg.evaluate("""() => { const r = document.getElementById('replay'), lo = +r.min, hi = +r.max;
                for (let i = 0; i <= 30; i++) { r.value = Math.round(lo + (hi - lo) * i / 30); r.dispatchEvent(new Event('input', {bubbles: true})); } }""")
            pg.wait_for_timeout(300)
            mid = pg.evaluate("window.__said.length")
            pg.wait_for_timeout(1200)
            said = pg.evaluate("window.__said.slice()"); now = pg.evaluate("document.getElementById('lvlName').textContent.trim()")
            check(lang + ': scrubbing the replay is silent while moving', mid == 0, mid)
            check(lang + ': ...and speaks the resting level once (%s)' % now, len(said) == 1 and now in said[0], [said, now])
            check(lang + ': no page errors', not errs, errs)
            ctx.close()
        b.close()
    srv.shutdown()
    print('\n%d/%d checks passed' % (sum(res), len(res))); sys.exit(0 if all(res) else 1)
main()
