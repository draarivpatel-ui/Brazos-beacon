#!/usr/bin/env python3
"""Headless-Chromium DOM test: every listed gauge card, including gauges farther than ~9 mi (15 km) that cannot
change the level, shows feet below/above flood stage and the NWS 7-day forecast high when NWPS has them.
If a far gauge's flood stage truly cannot be loaded (e.g. NWPS 429), the card says "flood stage not loaded"
(EN/ES) and keeps the gauge list's flood category on the badge: never the false "no flood stage set for this
gauge" and never a "No data" badge when the list already reports a category. Far-gauge flood stages are cached
(7 days), so a refresh does not spend NWPS calls (10 / 5 min limit) on them again.

Run: python3 tests/dom_far_gauge_test.py   (same setup as tests/dom_429_test.py; uses /tmp/leaflet.js if present)
Every network call is stubbed, so this test never hits NOAA / NWS / FEMA.
"""
import json, os, sys
from datetime import timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dom_429_test as base_t
from dom_429_test import NOW, iso, NEAR, FAR, CATS, status, fixtures, classify, serve, launch
from playwright.sync_api import sync_playwright

# Barker-like elevation-datum gauge ~40 km away (FAR in the shared fixtures): action 90.2 ft, flood 93.2 ft.
FAR_CATS = {'action': {'stage': 90.2}, 'minor': {'stage': 93.2}, 'moderate': {'stage': -9999}, 'major': {'stage': -9999}}
FAR_STAGE = 82.3

def fx_far():
    fx = fixtures()
    fx['nwpsList'] = {'gauges': [dict(NEAR, status=status(12.0, 'no_flooding')), dict(FAR, status=status(FAR_STAGE, 'no_flooding'))]}
    fx['meta'] = {'NEAR2': dict(NEAR, status=status(12.0, 'no_flooding'), flood={'categories': CATS}),
                  'FARR2': dict(FAR, status=status(FAR_STAGE, 'no_flooding'), flood={'categories': FAR_CATS})}
    def flow(stage, crest):
        return {'observed': {'data': [{'validTime': iso(NOW - timedelta(hours=h)), 'primary': stage} for h in range(24, 0, -1)]},
                'forecast': {'data': [{'validTime': iso(NOW + timedelta(hours=h)), 'primary': v}
                                      for h, v in ((6, stage + 0.5), (24, crest), (48, stage + 1))]}}
    fx['flow'] = {'NEAR2': flow(12.0, 14.0), 'FARR2': flow(FAR_STAGE, 84.1)}
    return fx

def lid_of(url):
    return url.split('/gauges/')[1].split('/')[0].split('?')[0]

def run(browser, baseurl, fail_far_meta=False, lang='en', reloads=0):
    fx = fx_far()
    ctx = browser.new_context(viewport={'width': 360, 'height': 780}, service_workers='block')
    page = ctx.new_page()
    errors, calls = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    cors = {'Access-Control-Allow-Origin': '*'}
    def route(r):
        url = r.request.url
        if url.startswith(baseurl): return r.continue_()
        if 'unpkg.com/leaflet' in url:
            if base_t.LEAFLET: return r.fulfill(status=200, headers=cors, content_type='application/javascript', body=base_t.LEAFLET)
            return r.continue_()
        k = classify(url)
        if k is None: return r.fulfill(status=204, body='')
        if k in ('nwpsGauge', 'stageflow'):
            lid = lid_of(url); calls.append((k, lid))
            if k == 'nwpsGauge' and lid == 'FARR2' and fail_far_meta:
                return r.fulfill(status=429, headers=cors, content_type='application/json', body='{"code":429}')
            body = fx['meta'][lid] if k == 'nwpsGauge' else fx['flow'][lid]
            return r.fulfill(status=200, headers=cors, content_type='application/json', body=json.dumps(body))
        calls.append((k, None))
        return r.fulfill(status=200, headers=cors, content_type='application/json', body=json.dumps(fx[k]))
    page.route('**/*', route)
    ready = "document.getElementById('main') && !document.getElementById('main').hasAttribute('aria-busy') && document.querySelectorAll('#rivers .gauge').length > 0"
    outs = []
    for i in range(reloads + 1):
        del calls[:]
        if i == 0: page.goto(baseurl + '/index.html?lang=' + lang, wait_until='domcontentloaded')
        else: page.reload(wait_until='domcontentloaded')
        page.wait_for_function(ready, timeout=20000)
        page.wait_for_timeout(300)
        o = page.evaluate("""() => ({
            num: document.getElementById('lvlNum').textContent.trim(),
            name: document.getElementById('lvlName').textContent.trim(),
            cards: Array.from(document.querySelectorAll('#rivers .gauge')).map(b => ({
                lid: b.getAttribute('data-lid'), badge: b.querySelector('.badge').textContent.trim(), text: b.textContent })),
            overflowX: document.documentElement.scrollWidth > window.innerWidth + 1
        })""")
        o['errors'] = list(errors); o['calls'] = list(calls)
        outs.append(o)
    ctx.close()
    return outs

def card(o, lid): return [c for c in o['cards'] if c['lid'] == lid][0]

def main():
    if os.path.exists('/tmp/leaflet.js'): base_t.LEAFLET = open('/tmp/leaflet.js', 'rb').read()
    srv = serve(); baseurl = 'http://127.0.0.1:%d' % srv.server_address[1]
    n = 0; failures = []
    def check(name, cond, info):
        nonlocal n; n += 1
        print(('ok - ' if cond else 'FAIL - ') + name)
        if not cond: failures.append((name, info))
    with sync_playwright() as p:
        b = launch(p)
        # 1. Far gauge, NWPS has stages -> feet below flood stage + forecast high, real badge.
        o1, o2 = run(b, baseurl, reloads=1)
        far = card(o1, 'FARR2')
        check('far gauge (EN): "10.9 ft below flood stage (93.2 ft)"', '10.9 ft below flood stage (93.2 ft)' in far['text'], far)
        check('far gauge (EN): shows the NWS 7-day forecast high (84.1 ft)', 'NWS forecast high (7 days): 84.1 ft' in far['text'], far)
        check('far gauge (EN): badge "Normal", not "No data"', far['badge'] == 'Normal', far)
        check('far gauge (EN): never "no flood stage set" / "not loaded" when stages exist',
              'no flood stage set' not in far['text'] and 'not loaded' not in far['text'], far)
        check('far gauge still marked too far to change the level', 'too far to change your level' in far['text'], far)
        nearc = card(o1, 'NEAR2')
        check('near gauge unchanged: ft below flood stage + forecast high', '33 ft below flood stage (45 ft)' in nearc['text'] and 'NWS forecast high (7 days): 14 ft' in nearc['text'], nearc)
        check('level is a real 0, page error-free, no overflow', o1['num'] == '0' and not o1['errors'] and not o1['overflowX'], o1)
        nw1 = [c for c in o1['calls'] if c[0] in ('nwpsList', 'nwpsGauge', 'stageflow')]
        check('first check: NWPS calls = 1 list + 2 metadata + 2 stageflow (5)', len(nw1) == 5, nw1)
        # 2. Refresh: far flood stages come from the 7-day cache, near gauge metadata is still fresh.
        nw2 = [c for c in o2['calls'] if c[0] in ('nwpsList', 'nwpsGauge', 'stageflow')]
        check('refresh: far gauge metadata not re-fetched (cached), near metadata re-fetched',
              ('nwpsGauge', 'FARR2') not in nw2 and ('nwpsGauge', 'NEAR2') in nw2 and len(nw2) == 4, nw2)
        far2 = card(o2, 'FARR2')
        check('refresh: cached far gauge still shows ft below flood stage', '10.9 ft below flood stage (93.2 ft)' in far2['text'] and far2['badge'] == 'Normal', far2)
        # 3. Spanish.
        es = run(b, baseurl, lang='es')[0]; fes = card(es, 'FARR2')
        check('far gauge (ES): pies debajo del nivel de inundación + máximo pronosticado, badge Normal',
              '10.9 pies debajo del nivel de inundación (93.2 pies)' in fes['text'] and 'Máximo pronosticado por el NWS (7 días): 84.1' in fes['text'] and fes['badge'] == 'Normal', fes)
        # 4. Far metadata 429 (no cache) -> honest "flood stage not loaded", list category on the badge, level unaffected.
        for lang, phrase, bad, nodata in (('en', 'flood stage not loaded', 'no flood stage set', 'No data'),
                                          ('es', 'no se cargó el nivel de inundación', 'no tiene nivel de inundación', 'Sin datos')):
            o = run(b, baseurl, fail_far_meta=True, lang=lang)[0]; f = card(o, 'FARR2')
            check('far metadata 429 (%s): "%s", not "%s"' % (lang, phrase, bad), phrase in f['text'] and bad not in f['text'], f)
            check('far metadata 429 (%s): badge from the list category (Normal), not "%s"' % (lang, nodata), f['badge'] == 'Normal', f)
            check('far metadata 429 (%s): forecast high still shown; level still a real 0; no errors' % lang,
                  ('84.1' in f['text'] or '84,1' in f['text']) and o['num'] == '0' and not o['errors'], o)
        b.close()
    srv.shutdown()
    for name, info in failures:
        print('\n--', name, '\n', json.dumps(info, ensure_ascii=False, indent=1)[:1500])
    print('\n%d/%d DOM checks passed' % (n - len(failures), n))
    sys.exit(1 if failures else 0)

if __name__ == '__main__':
    main()
