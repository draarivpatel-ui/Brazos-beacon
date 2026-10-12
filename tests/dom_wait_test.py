#!/usr/bin/env python3
"""Headless-Chromium DOM test: when an agency is slow, the hero says which ones it is still waiting on
(EN/ES), shrinks that list as each answers, and then shows the normal answer. Before Oct 11, 2026 a slow
NOAA call left "Asking NOAA, NWS and FEMA..." on screen with no sign of progress.

Run: python3 tests/dom_wait_test.py   (same setup as tests/dom_429_test.py; every network call is stubbed)
The NOAA gauge list is held back until the test releases it; the 'still waiting' delay is shortened to
0.4 s with window.__BEACON_WAIT_MS (the app uses 5 s).
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dom_429_test as base_t
from dom_429_test import fixtures, classify, serve, launch
from playwright.sync_api import sync_playwright

WANT = {'en': ('Still waiting on NOAA river gauges.', 'FEMA flood zone'),
        'es': ('Todavía esperando: medidores de río de NOAA.', 'zona de inundación de FEMA')}

def run(browser, baseurl, lang):
    fx = fixtures(); held = []
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    cors = {'Access-Control-Allow-Origin': '*'}
    def answer(r, k): r.fulfill(status=200, headers=cors, content_type='application/json', body=json.dumps(fx[k]))
    def route(r):
        url = r.request.url
        if url.startswith(baseurl): return r.continue_()
        if 'unpkg.com/leaflet' in url:
            if base_t.LEAFLET: return r.fulfill(status=200, headers=cors, content_type='application/javascript', body=base_t.LEAFLET)
            return r.continue_()
        k = classify(url)
        if k is None: return r.fulfill(status=204, body='')
        if k == 'nwpsList': held.append(r); return   # NOAA is slow today
        answer(r, k)
    page.route('**/*', route)
    page.add_init_script('window.__BEACON_WAIT_MS = 400;')
    page.goto(baseurl + '/index.html?lang=' + lang, wait_until='domcontentloaded')
    desc = lambda: page.evaluate("document.getElementById('lvlDesc').textContent")
    try: page.wait_for_function("/NOAA/.test(document.getElementById('lvlDesc').textContent) && !/FEMA/.test(document.getElementById('lvlDesc').textContent) && /(Still|Todav)/.test(document.getElementById('lvlDesc').textContent)", timeout=15000)
    except Exception: pass
    waiting = desc(); busy = page.evaluate("document.getElementById('main').getAttribute('aria-busy')")
    for r in held: answer(r, 'nwpsList')
    page.wait_for_function("!document.getElementById('main').hasAttribute('aria-busy')", timeout=15000)
    page.wait_for_timeout(900)
    after = desc(); num = page.evaluate("document.getElementById('lvlNum').textContent.trim()")
    ctx.close()
    return {'waiting': waiting, 'busy': busy, 'after': after, 'num': num, 'held': len(held), 'errors': errors}

def main():
    for f in ('/tmp/leaflet.js',):
        if os.path.exists(f): base_t.LEAFLET = open(f, 'rb').read()
    srv = serve(); baseurl = 'http://127.0.0.1:%d' % srv.server_address[1]
    n, fails = 0, []
    def check(name, cond, info):
        nonlocal n
        n += 1; print(('ok - ' if cond else 'FAIL - ') + name + ('' if cond else '  ' + json.dumps(info, ensure_ascii=False)[:500]))
        if not cond: fails.append(name)
    with sync_playwright() as p:
        b = launch(p)
        for lang in ('en', 'es'):
            o = run(b, baseurl, lang); want, fema = WANT[lang]
            check('%s: while NOAA is slow the hero names it: "%s"' % (lang, want), o['held'] >= 1 and o['waiting'].startswith(want) and o['busy'] == 'true', o)
            check('%s: sources that already answered (%s) drop off the waiting list' % (lang, fema), fema not in o['waiting'], o)
            check('%s: once NOAA answers, the normal level sentence replaces the waiting line' % lang,
                  o['num'] in '01234' and o['num'] and 'NOAA' not in o['after'] and not o['after'].startswith(want[:8]), o)
            check('%s: no page errors' % lang, not o['errors'], o)
        b.close()
    srv.shutdown()
    print('\n%d checks, %d failed' % (n, len(fails)))
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
