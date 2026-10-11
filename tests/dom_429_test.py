#!/usr/bin/env python3
"""Headless-Chromium DOM test: a 429 (rate limit) from any upstream API must give the honest
"Could not check everything" state (or, for sources that cannot raise the level, a calm working page),
never a false green "All clear" and never a crash.

Run: python3 tests/dom_429_test.py      (needs: pip playwright + /usr/bin/chromium or a playwright browser)
Every network call is stubbed with small synthetic fixtures, so this test never hits NOAA / NWS / FEMA.
"""
import json, os, sys, threading, functools, http.server, socketserver, time
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright

LEAFLET = None  # set in main(): local copy of leaflet 1.9.4 if one is cached, else the real unpkg file
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOW = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
iso = lambda d: d.strftime('%Y-%m-%dT%H:%M:%S+00:00')

# Default spot: Sugar Land (29.6197, -95.6349). One gauge ~2 km away (metadata fetched), one ~40 km away (list only).
NEAR = {'lid': 'NEAR2', 'name': 'Test Creek near Sugar Land', 'latitude': 29.602, 'longitude': -95.630}
FAR = {'lid': 'FARR2', 'name': 'Far River far away', 'latitude': 29.95, 'longitude': -95.85}

def status(stage, cat):
    return {'observed': {'primary': stage, 'primaryUnit': 'ft', 'floodCategory': cat, 'validTime': iso(NOW - timedelta(minutes=30))},
            'forecast': {'primary': -999, 'primaryUnit': '', 'floodCategory': 'fcst_not_current', 'validTime': '0001-01-01T00:00:00Z'}}

CATS = {'action': {'stage': 20}, 'minor': {'stage': 45}, 'moderate': {'stage': 48}, 'major': {'stage': 50}}

def fixtures(near_stage=12.0, near_cat='no_flooding'):
    near_list = dict(NEAR, status=status(near_stage, near_cat))
    far_list = dict(FAR, status=status(5.0, 'no_flooding'))
    hours = [{'validTime': iso(NOW + timedelta(hours=h)) + '/PT1H', 'value': 30.0} for h in range(0, 72)]
    rain = [{'validTime': iso(NOW + timedelta(hours=h)) + '/PT6H', 'value': 0.0} for h in range(0, 72, 6)]
    return {
        'nwpsList': {'gauges': [near_list, far_list]},
        'nwpsGauge': dict(near_list, flood={'categories': CATS}),
        'stageflow': {'observed': {'data': [{'validTime': iso(NOW - timedelta(hours=h)), 'primary': near_stage} for h in range(24, 0, -1)]},
                      'forecast': {'data': []}},
        'alerts': {'features': []},
        'points': {'properties': {'forecastGridData': 'https://api.weather.gov/gridpoints/HGX/60,90',
                                  'relativeLocation': {'properties': {'city': 'Sugar Land', 'state': 'TX'}}}},
        'grid': {'properties': {'heatIndex': {'values': hours}, 'temperature': {'values': hours},
                                'relativeHumidity': {'values': []}, 'quantitativePrecipitation': {'values': rain}}},
        'fema': {'features': [{'attributes': {'FLD_ZONE': 'X', 'ZONE_SUBTY': 'AREA OF MINIMAL FLOOD HAZARD', 'SFHA_TF': 'F'}, 'geometry': None}]},
        'femaNear': {'features': []},
        'geocode': {'candidates': [{'score': 100, 'location': {'x': -95.6349, 'y': 29.6197}, 'address': '1 Test St, Sugar Land, TX'}]},
        'nominatim': [],
    }

def classify(url):
    if 'api.water.noaa.gov/nwps/v1/gauges?' in url: return 'nwpsList'
    if url.endswith('/stageflow'): return 'stageflow'
    if 'api.water.noaa.gov/nwps/v1/gauges/' in url: return 'nwpsGauge'
    if 'api.weather.gov/alerts' in url: return 'alerts'
    if 'api.weather.gov/points' in url: return 'points'
    if 'api.weather.gov/gridpoints' in url: return 'grid'
    if 'NFHL/MapServer' in url: return 'femaNear' if 'esriGeometryEnvelope' in url else 'fema'
    if 'geocode.arcgis.com' in url: return 'geocode'
    if 'nominatim.openstreetmap.org' in url: return 'nominatim'
    return None

def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    socketserver.ThreadingTCPServer.daemon_threads = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

def launch(p):
    exe = '/usr/bin/chromium' if os.path.exists('/usr/bin/chromium') else None
    return p.chromium.launch(executable_path=exe, args=['--no-sandbox'])

def run_case(browser, base, fail, fx=None, lang='en', search=None, fema_200_error=False):
    """fail: set of API keys answering HTTP 429. Returns dict of what the page shows."""
    fx = fx or fixtures()
    ctx = browser.new_context(viewport={'width': 360, 'height': 780}, service_workers='block')
    page = ctx.new_page()
    errors, calls = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    def route(r):
        url = r.request.url
        if url.startswith(base):
            return r.continue_()
        if 'unpkg.com/leaflet' in url:
            if LEAFLET: return r.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'}, content_type='application/javascript', body=LEAFLET)
            return r.continue_()
        k = classify(url)
        if k is None:  # map tiles etc.
            return r.fulfill(status=204, body='')
        calls.append(k)
        cors = {'Access-Control-Allow-Origin': '*'}
        if k in fail:
            if fema_200_error and k in ('fema', 'femaNear'):  # ArcGIS style: HTTP 200 with an error body
                return r.fulfill(status=200, headers=cors, content_type='application/json', body=json.dumps({'error': {'code': 429, 'message': 'Too many requests'}}))
            return r.fulfill(status=429, headers=dict(cors, **{'Retry-After': '300'}), content_type='application/json',
                             body=json.dumps({'code': 429, 'message': '10 requests / 5 minutes'}))
        return r.fulfill(status=200, headers=cors, content_type='application/json', body=json.dumps(fx[k]))
    page.route('**/*', route)
    page.goto(base + '/index.html?lang=' + lang, wait_until='domcontentloaded')
    page.wait_for_function("document.getElementById('main') && !document.getElementById('main').hasAttribute('aria-busy') && document.getElementById('lvlNum').textContent.trim() !== ''", timeout=20000)
    if search:
        page.fill('#addr', search)
        page.click('#searchForm button[type=submit], #searchForm [type=submit]')
        page.wait_for_timeout(1500)
    page.wait_for_timeout(300)
    out = page.evaluate("""() => ({
        num: document.getElementById('lvlNum').textContent.trim(),
        name: document.getElementById('lvlName').textContent.trim(),
        desc: document.getElementById('lvlDesc').textContent.trim(),
        hero: document.getElementById('hero').className,
        msg: document.getElementById('msg').textContent.trim(),
        rivers: document.getElementById('rivers').textContent.trim(),
        wx: document.getElementById('wx').textContent.trim(),
        alerts: document.getElementById('alerts').textContent.trim(),
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1
    })""")
    out['errors'] = errors; out['calls'] = calls
    ctx.close()
    return out

ALL_CLEAR = {'en': 'All clear', 'es': None}
INCOMPLETE = {'en': 'Could not check everything', 'es': 'No pudimos revisar todo'}

def main():
    global LEAFLET
    for f in ('/tmp/leaflet.js',):
        if os.path.exists(f): LEAFLET = open(f, 'rb').read()
    srv = serve(); base = 'http://127.0.0.1:%d' % srv.server_address[1]
    n = 0; failures = []
    def check(name, cond, info):
        nonlocal n
        n += 1
        print(('ok - ' if cond else 'FAIL - ') + name)
        if not cond: failures.append((name, info))
    with sync_playwright() as p:
        b = launch(p)
        # Baseline: every source answers, calm data -> a real level 0, complete (not "?").
        r = run_case(b, base, set())
        check('baseline: all sources answer -> real level, not the incomplete state', r['num'] == '0' and r['name'] != INCOMPLETE['en'] and not r['errors'], r)
        # Level-raising sources: a 429 from each must show "?" + "Could not check everything", naming the source.
        for lang in ('en', 'es'):
            for key, src in (('nwpsList', 'rivers'), ('alerts', 'alerts'), ('points', 'weather'), ('grid', 'weather')):
                r = run_case(b, base, {key}, lang=lang)
                check('%s 429 (%s) -> "?" + "%s", no crash' % (key, lang, INCOMPLETE[lang]),
                      r['num'] == '?' and r['name'] == INCOMPLETE[lang] and 'lvl-u' in r['hero'] and not r['errors'], r)
        # Every NWPS call rate-limited (list, metadata, stageflow).
        r = run_case(b, base, {'nwpsList', 'nwpsGauge', 'stageflow'})
        check('all NWPS calls 429 -> incomplete, rivers card says source failed', r['num'] == '?' and 'NOAA NWPS' in r['rivers'] and not r['errors'], r)
        # Per-gauge metadata 429 for the NEAR gauge while that river is in MAJOR flood (the list still says so).
        fx = fixtures(near_stage=52.0, near_cat='major')
        r = run_case(b, base, {'nwpsGauge'}, fx=fx)
        check('near-gauge metadata 429 during a major flood -> level from the list flood category (>=3), never All clear', r['num'].isdigit() and int(r['num']) >= 3 and r['name'] != 'All clear' and not r['errors'], r)
        # Per-gauge metadata 429, calm river -> cannot confirm that gauge's flood stage -> incomplete, not a green 0.
        r = run_case(b, base, {'nwpsGauge'})
        check('near-gauge metadata 429, calm river -> incomplete "?", not a confident All clear', r['num'] == '?' and not r['errors'], r)
        # Stageflow 429 only: metadata still has status + flood categories, so the level is still known; must not crash.
        r = run_case(b, base, {'stageflow'})
        check('stageflow 429 only -> page still renders a level, no crash', r['num'] in ('0', '?') and not r['errors'], r)
        # Everything rate-limited, no saved snapshot -> "?", offline message, no crash.
        r = run_case(b, base, {'nwpsList', 'nwpsGauge', 'stageflow', 'alerts', 'points', 'grid', 'fema', 'femaNear'})
        check('every API 429, no snapshot -> "?" + offline message, no crash', r['num'] == '?' and r['msg'] != '' and not r['errors'], r)
        # FEMA (zone map) rate-limited, HTTP 429 and ArcGIS-style 200+error: zone unknown, no crash, no false confidence.
        for err200 in (False, True):
            r = run_case(b, base, {'fema', 'femaNear'}, fema_200_error=err200)
            check('FEMA %s -> page renders, no crash' % ('200+error body' if err200 else '429'), r['num'] in ('0', '?') and not r['errors'], r)
        # Address search with both geocoders rate-limited -> friendly error, no crash.
        for lang in ('en', 'es'):
            r = run_case(b, base, {'geocode', 'nominatim'}, lang=lang, search='123 Main St')
            check('geocoder 429 (%s) -> friendly address error, no crash' % lang, r['msg'] != '' and not r['errors'], r)
        b.close()
    srv.shutdown()
    for name, info in failures:
        print('\n--', name, '\n', json.dumps({k: v for k, v in info.items() if k != 'calls'}, ensure_ascii=False, indent=1)[:1200])
    print('\n%d/%d DOM checks passed' % (n - len(failures), n))
    sys.exit(1 if failures else 0)

if __name__ == '__main__':
    main()
