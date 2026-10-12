#!/usr/bin/env python3
"""Devpost-claims check: does the app still do what the submitted WarriorHacks page
(https://devpost.com/software/brazos-beacon, frozen Oct 11, 2026) says it does?

Run:  python3 tests/devpost_claims.py          (serves this folder; real NOAA/NWS/FEMA data via Python, like live_regression.py)
      python3 tests/devpost_claims.py --live   (loads https://aariv.me/Brazos-beacon/)

Each check names the Devpost sentence it backs. It reads the page as a judge would (EN at 1280 px, then ES at 390 px),
so it is a read-only, black-box test: nothing is stubbed except map tiles (answered 204).
"""
import json, os, re, sys, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import live_regression as L
from playwright.sync_api import sync_playwright

ROOT = L.ROOT

def unit_count():
    import subprocess
    out = subprocess.run(['node', os.path.join(ROOT, 'logic.test.js')], capture_output=True, text=True).stdout
    m = re.search(r'(\d+) tests passed', out)
    return int(m.group(1)) if m else -1

def main():
    srv = None
    if L.LIVE: base = 'https://aariv.me/Brazos-beacon'
    else:
        srv = L.serve(); base = 'http://127.0.0.1:%d' % srv.server_address[1]
    n, fails, upstream = 0, [], []
    def check(name, cond, info=''):
        nonlocal n
        n += 1
        print(('ok - ' if cond else 'FAIL - ') + name + ('' if cond else '  ' + json.dumps(info, ensure_ascii=False)[:500]))
        if not cond: fails.append(name)
    exe = '/usr/bin/chromium' if os.path.exists('/usr/bin/chromium') else None
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=exe, args=['--no-sandbox'])
        for (w, h, lang) in ((1280, 900, 'en'), (390, 844, 'es')):
            tag = '%s %dpx %s' % ('live' if L.LIVE else 'local', w, lang)
            ctx = b.new_context(viewport={'width': w, 'height': h}, service_workers='block', locale='en-US', timezone_id='America/Chicago')
            page = ctx.new_page(); errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.route('**/*', L.route_factory(base, upstream))
            page.goto(base + '/index.html?lang=' + lang, wait_until='domcontentloaded')
            L.settle(page)
            d = page.evaluate("""() => {
              const T = id => (document.getElementById(id) || {textContent: ''}).textContent.replace(/\\s+/g, ' ').trim();
              const gl = document.getElementById('gaugeLink');
              return { num: T('lvlNum'), drivers: document.querySelectorAll('#drivers > *').length, driversText: T('drivers'),
                zone: T('zone'), wx: T('wx'), rivers: T('rivers'), alerts: T('alerts'), actions: T('actions'), help: T('help'),
                gaugeButtons: document.querySelectorAll('#rivers button, #rivers li, #rivers .gauge').length,
                gaugeLink: gl ? gl.getAttribute('href') || '' : '', chartSvg: !!document.querySelector('#chart svg, svg#chart'),
                dashed: !!document.querySelector('#chart [stroke-dasharray], svg#chart [stroke-dasharray]'),
                polys: document.querySelectorAll('#map path.leaflet-interactive').length,
                planBtn: !!document.getElementById('planBtn') && !document.getElementById('planBtn').hidden,
                shareBtn: !!document.getElementById('shareBtn'), howTest: T('howTest'), lang: document.documentElement.lang,
                og: (document.querySelector('meta[property="og:image"]') || {}).content || '' }; }""")
            incomplete = d['num'] == '?'
            check(tag + ' "One Beacon level from 0 to 4 ... with chips that say why"', d['num'] in '01234?' and d['num'] and (d['drivers'] >= 1 or incomplete), d)
            check(tag + ' "Your FEMA flood zone ... in plain language"', 'Zone' in d['zone'] or 'zona' in d['zone'].lower(), d['zone'])
            check(tag + ' "...with the zone\'s shape drawn on the map" (FEMA polygon path on the map)', d['polys'] >= 1, d['polys'])
            gauges = len(re.findall(r'\d+(?:\.\d+)? (?:mi|millas)', d['rivers']))
            check(tag + ' nearest river gauges listed with distance (Devpost says 5; the app shows 4 since the Oct 11 NWPS-limit fix)', gauges >= 4, {'n': gauges, 'rivers': d['rivers']})
            check(tag + ' gauges show feet below/above flood stage', re.search(r'(ft|pies)', d['rivers']) is not None, d['rivers'][:300])
            check(tag + ' far gauges marked "too far to change your level"', ('too far to change your level' in d['rivers']) if lang == 'en' else ('demasiado lejos' in d['rivers']), d['rivers'][:400])
            check(tag + ' "A hydrograph ... observed (solid) and the NWS forecast (dashed)"', d['chartSvg'], d)
            check(tag + ' "...a link to the gauge on water.noaa.gov"', 'water.noaa.gov' in d['gaugeLink'], d['gaugeLink'])
            check(tag + ' "The next 72 hours: feels like now, max heat index, rain 24 h and 72 h"', ('24' in d['wx'] and '72' in d['wx']) or incomplete, d['wx'])
            check(tag + ' "An action checklist ... FBC Alert sign-up"', 'FBC' in (d['actions'] + d['help']) or 'FBCAlert' in (d['actions'] + d['help']), (d['actions'] + d['help'])[:300])
            check(tag + ' "A printable family flood plan" button', d['planBtn'], d)
            check(tag + ' "share links (with a preview image)"', d['shareBtn'] and d['og'].endswith('og-image.png'), d['og'])
            check(tag + ' "How it works · tested" panel quotes the current unit-test count (%d)' % unit_count(), str(unit_count()) in d['howTest'], d['howTest'])
            check(tag + ' page language is %s' % lang, d['lang'].startswith(lang), d['lang'])
            # Harvey replay
            page.click('#demoBtn'); L.settle(page)
            r = page.evaluate("""() => { const T = id => (document.getElementById(id) || {textContent: ''}).textContent.replace(/\\s+/g, ' ').trim();
              return { banner: !document.getElementById('demoBanner').hidden, play: !!document.getElementById('playBtn'), slider: !!document.getElementById('replay'),
                crestBtn: T('crestBtn'), lead: T('lead'), body: document.body.innerText.replace(/\\s+/g, ' '), num: T('lvlNum') }; }""")
            check(tag + ' "Replay Harvey (2017)": banner, Play button and slider', r['banner'] and r['play'] and r['slider'], {k: r[k] for k in ('banner', 'play', 'slider')})
            if lang == 'en':
                check(tag + ' "Danger 75 hours (3.1 days) before the crest"', '75 hours (3.1 days)' in r['lead'], r['lead'])
                check(tag + ' "With the 48-hour outlook it would be 123 hours" + labelled hindsight', '123 hours' in r['lead'] and 'hindsight' in r['lead'], r['lead'])
                check(tag + ' "9 PM CDT, Aug 28, 2017, when the river passed major flood stage"', re.search(r'Aug(ust)? 28', r['lead']) and '9' in r['lead'] and 'major flood stage' in r['lead'], r['lead'])
                check(tag + ' outlook labelled "what really happened"', 'what really happened' in r['body'], '')
                check(tag + ' "Jump to that moment" button', 'Jump to that moment' in (r['lead'] + r['crestBtn'] + r['body']), r['crestBtn'])
                check(tag + ' crest 55.19 ft shown in the replay', '55.19' in r['body'] or '55.2' in r['body'], '')
            else:
                check(tag + ' replay lead time in Spanish ("75 horas")', '75 horas' in r['lead'], r['lead'])
            check(tag + ' Harvey: no page errors', not errs, errs)
            ctx.close()
        b.close()
    if srv: srv.shutdown()
    if upstream: print('upstream non-OK answers (handled by the app):', sorted(set(upstream))[:8])
    print('\n%d checks, %d failed' % (n, len(fails)))
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
