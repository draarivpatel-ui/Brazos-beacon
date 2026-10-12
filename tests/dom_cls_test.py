#!/usr/bin/env python3
"""Headless-Chromium layout-stability test: when the 'Checking live sources' hero is replaced by the answer,
the page must not jump. Before Oct 11, 2026 the loading sentence took 2 lines at 1280 px and the answer 1, so
the whole page moved up ~24 px (CLS 0.11, over Google's 0.1 'good' limit). Now the loading sentence is short
and #lvlDesc reserves two lines.

Run: python3 tests/dom_cls_test.py   (same setup as tests/dom_429_test.py; every network call is stubbed)
Checks at 1280 and 390 px, EN and ES, with the CPU slowed 4x like Lighthouse mobile: cumulative layout shift
from first paint until the answer is shown stays under 0.1, and the level is a real number.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dom_429_test as base_t
from dom_429_test import fixtures, classify, serve, launch
from playwright.sync_api import sync_playwright

# __boot: the placeholder text as parsed, read when parsing ends and before the deferred scripts run.
INIT = ("document.addEventListener('readystatechange',()=>{if(document.readyState==='interactive'){const e=document.getElementById('leadBoot');window.__boot=e?e.textContent:''}});"
        "window.__cls=0;new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__cls+=e.value})"
        ".observe({type:'layout-shift',buffered:true});")

def run(browser, baseurl, w, h, lang, extra='', zone=None):
    fx = fixtures()
    if zone: fx['fema'] = {'features': [{'attributes': zone, 'geometry': None}]}
    ctx = browser.new_context(viewport={'width': w, 'height': h}, service_workers='block')
    page = ctx.new_page(); errors = []
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
        body = fx[k]
        return r.fulfill(status=200, headers=cors, content_type='application/json', body=json.dumps(body))
    page.route('**/*', route)
    if os.environ.get('CLS_THROTTLE', '1') == '1':
        cdp = ctx.new_cdp_session(page); cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
    page.add_init_script(INIT)
    page.goto(baseurl + '/index.html?lang=' + lang + extra, wait_until='domcontentloaded')
    page.wait_for_function("document.getElementById('main') && !document.getElementById('main').hasAttribute('aria-busy') && /^[0-4?]$/.test(document.getElementById('lvlNum').textContent.trim())", timeout=30000)
    page.wait_for_timeout(1500)
    if extra: page.wait_for_function("!document.getElementById('leadBoot')", timeout=15000)
    o = page.evaluate("({cls: window.__cls, num: document.getElementById('lvlNum').textContent.trim(), lead: document.getElementById('lead').textContent, booted: !!document.getElementById('leadBoot')})")
    o['boot'] = page.evaluate("window.__boot || ''")
    o['errors'] = errors
    ctx.close()
    return o

def main():
    for f in ('/tmp/leaflet.js', os.path.join(base_t.ROOT, 'vendor', 'leaflet.js')):
        if os.path.exists(f): base_t.LEAFLET = open(f, 'rb').read(); break
    srv = serve(); baseurl = 'http://127.0.0.1:%d' % srv.server_address[1]
    n, fails = 0, []
    with sync_playwright() as p:
        b = launch(p)
        for (w, h) in ((1280, 900), (390, 844)):
            for lang in ('en', 'es'):
                o = run(b, baseurl, w, h, lang)
                for name, cond in (('%dpx %s: layout shift until the answer shows is under 0.1 (CLS %.3f)' % (w, lang, o['cls']), o['cls'] < 0.1),
                                   ('%dpx %s: a real level is shown, no page errors' % (w, lang), o['num'] in '01234' and o['num'] and not o['errors'])):
                    n += 1; print(('ok - ' if cond else 'FAIL - ') + name + ('' if cond else '  ' + json.dumps(o)[:400]))
                    if not cond: fails.append(name)
            # The Harvey replay link (README, Devpost): before Oct 11 night the replay banner only appeared when
            # app.js ran, pushing the whole page down (CLS 0.35 at 390 px, 0.12 at 1280 px).
            # The lead-time box needs the FEMA answer; the replay spot is in Zone AE (real NFHL answer), so stub that.
            AE = {'FLD_ZONE': 'AE', 'ZONE_SUBTY': None, 'SFHA_TF': 'T'}
            for lang in ('en', 'es'):
                o = run(b, baseurl, w, h, lang, '&demo=harvey', zone=AE)
                for name, cond in (
                        ('%dpx %s ?demo=harvey: replay banner + lead-time box held at first paint, layout shift under 0.1 (CLS %.3f)' % (w, lang, o['cls']), o['cls'] < 0.1 and not o['errors']),
                        ('%dpx %s ?demo=harvey: the first-paint lead-time copy says exactly what app.js writes, then is removed' % (w, lang),
                         len(o['boot']) > 100 and o['boot'].strip() == o['lead'].strip() and not o['booted'])):
                    n += 1; print(('ok - ' if cond else 'FAIL - ') + name + ('' if cond else '  ' + json.dumps(o, ensure_ascii=False)[:700]))
                    if not cond: fails.append(name)
            # If FEMA ever answers a zone where the lead box stays empty, the placeholder must not linger.
            o = run(b, baseurl, w, h, 'en', '&demo=harvey')
            name = '%dpx ?demo=harvey with a Zone X answer: no stale lead-time copy left on the page' % w
            cond = not o['booted'] and not o['lead'].strip()
            n += 1; print(('ok - ' if cond else 'FAIL - ') + name + ('' if cond else '  ' + json.dumps(o)[:400]))
            if not cond: fails.append(name)
        b.close()
    srv.shutdown()
    # The inline first-paint script in index.html copies three strings from i18n.js; they must not drift apart.
    import re, subprocess
    html = open(os.path.join(base_t.ROOT, 'index.html'), encoding='utf-8').read()
    js = ("global.window=global;require(%r);const T=window.I18N||I18N;console.log(JSON.stringify(['en','es'].map(l=>[T[l].demo_banner,T[l].play,T[l].crest_btn])))"
          % os.path.join(base_t.ROOT, 'i18n.js'))
    try:
        want = json.loads(subprocess.run(['node', '-e', js], capture_output=True, text=True, check=True).stdout)
        for lang, strings in zip(('en', 'es'), want):
            cond = all(("'%s'" % x) in html for x in strings)
            name = 'index.html first-paint replay strings match i18n.js (%s)' % lang
            n += 1; print(('ok - ' if cond else 'FAIL - ') + name)
            if not cond: fails.append(name)
    except Exception as e:
        n += 1; fails.append('i18n parity check could not run: %s' % e); print('FAIL - i18n parity check could not run: %s' % e)
    print('\n%d checks, %d failed' % (n, len(fails)))
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
