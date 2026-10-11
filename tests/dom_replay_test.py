#!/usr/bin/env python3
"""Headless-Chromium DOM test: the Harvey replay slider's spoken readout (aria-valuetext) follows the
language while the replay is on, and is gone once the replay is off (it used to leak Spanish into the English UI).
Every network call is stubbed (same fixtures as dom_429_test.py). Run: python3 tests/dom_replay_test.py"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dom_429_test as D
from playwright.sync_api import sync_playwright

def main():
    for f in ('/tmp/leaflet.js',):
        if os.path.exists(f): D.LEAFLET = open(f, 'rb').read()
    srv = D.serve(); base = 'http://127.0.0.1:%d' % srv.server_address[1]
    fx = D.fixtures(); res = []
    def check(name, cond, info=''):
        res.append(cond); print(('ok - ' if cond else 'FAIL - ') + name + ('' if cond else '   ' + str(info)))
    with sync_playwright() as p:
        b = D.launch(p)
        ctx = b.new_context(viewport={'width': 390, 'height': 800}, service_workers='block'); pg = ctx.new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        def route(r):
            u = r.request.url
            if u.startswith(base): return r.continue_()
            if 'unpkg.com/leaflet' in u and D.LEAFLET: return r.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'}, content_type='application/javascript', body=D.LEAFLET)
            k = D.classify(u)
            if k is None: return r.fulfill(status=204, body='')
            return r.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'}, content_type='application/json', body=json.dumps(fx[k]))
        pg.route('**/*', route)
        pg.goto(base + '/index.html?demo=harvey&lang=es', wait_until='domcontentloaded')
        pg.wait_for_function("document.getElementById('replay').getAttribute('aria-valuetext')", timeout=20000)
        vt = lambda: pg.evaluate("document.getElementById('replay').getAttribute('aria-valuetext')")
        check('replay on (ES): readout says pies', ' pies' in (vt() or ''), vt())
        pg.click('[data-lang=en]'); pg.wait_for_timeout(500)
        check('replay on, switched to EN: readout says ft, not pies', ' ft' in (vt() or '') and 'pies' not in (vt() or ''), vt())
        pg.click('#demoBtn'); pg.wait_for_timeout(1200)   # leave the replay
        check('replay off: no stale readout', vt() is None, vt())
        pg.click('[data-lang=es]'); pg.wait_for_timeout(500)
        check('replay off, switched to ES: still no readout', vt() is None, vt())
        check('no page errors', not errs, errs)
        b.close()
    srv.shutdown()
    print('\n%d/%d checks passed' % (sum(res), len(res))); sys.exit(0 if all(res) else 1)
main()
