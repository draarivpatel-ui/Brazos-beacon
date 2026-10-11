#!/usr/bin/env python3
"""Live regression: Harvey replay + live Sugar Land check at 390 and 1280 px, English and Spanish, in headless Chromium.

Run:  python3 tests/live_regression.py            (serves this folder on 127.0.0.1)
      python3 tests/live_regression.py --live     (loads https://aariv.me/Brazos-beacon/)
Needs pip playwright + /usr/bin/chromium (or a playwright browser).

Unlike dom_429_test.py / dom_far_gauge_test.py this does NOT stub the data: every NOAA / NWS / FEMA / ArcGIS call
goes to the real service. Chromium in some sandboxes has no direct route out (ERR_INVALID_AUTH_CREDENTIALS), so
each outside request is fetched from Python and handed back to the page; identical URLs are fetched once per run
so 8 page loads do not trip the NWPS limit (10 requests / 5 minutes). Map tiles are answered 204 (not needed).

Checks per viewport x language:
  Sugar Land (live data): page finishes loading, a level 0-4 or the honest '?' incomplete state is shown,
    no page errors, no console errors, no horizontal overflow, axe-core: no serious/critical violations.
  Harvey replay: the replay banner opens, the level at the 2017 crest is 4 (Danger), the lead-time box renders,
    moving the slider to the start drops the level, no page errors, no console errors, no overflow, axe as above.
"""
import json, os, re, sys, time, threading, functools, http.server, socketserver, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE = '--live' in sys.argv
AXE_PATHS = ['/workspace/work/hackathons/eurekadev_qa/node_modules/axe-core/axe.min.js']
AXE = next((open(p).read() for p in AXE_PATHS if os.path.exists(p)), None)
CACHE, LOCK = {}, threading.Lock()
LEVELS = {'en': ['All clear', 'Stay aware', 'Get ready', 'Take action', 'Danger - act now'],
          'es': ['Todo bien', 'Mantente atento', 'Prepárate', 'Actúa', 'Peligro: actúa ya']}

def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    socketserver.ThreadingTCPServer.daemon_threads = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

def fetch(url, headers):
    with LOCK:
        if url in CACHE: return CACHE[url]
    h = {'User-Agent': 'Mozilla/5.0 (BrazosBeacon regression test)', 'Accept': headers.get('accept', '*/*')}
    for attempt in range(3):  # api.weather.gov sometimes answers a one-off 500; retry like a person pressing reload
        try:
            resp = urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30)
            out = (resp.status, resp.read(), resp.headers.get('Content-Type', 'application/octet-stream'))
        except urllib.error.HTTPError as e:
            out = (e.code, e.read(), e.headers.get('Content-Type', 'text/plain'))
        except Exception as e:  # network trouble: hand the page a 503, which it must handle honestly
            out = (503, str(e).encode(), 'text/plain')
        if out[0] < 500: break
        time.sleep(2)
    with LOCK: CACHE[url] = out
    return out

def route_factory(base, log):
    def route(r):
        url = r.request.url
        if url.startswith(base) and not LIVE: return r.continue_()
        if re.search(r'tile\.openstreetmap|/tile/|basemaps|arcgisonline\.com/.*/tile', url):
            return r.fulfill(status=204, body='')
        st, body, ct = fetch(url, r.request.headers)
        if st >= 400 and 'aariv.me' not in url: log.append('%d %s' % (st, url.split('?')[0]))
        r.fulfill(status=st, body=body, headers={'Content-Type': ct, 'Access-Control-Allow-Origin': '*'})
    return route

def settle(page):
    page.wait_for_function("document.getElementById('main') && !document.getElementById('main').hasAttribute('aria-busy')"
                           " && document.getElementById('lvlNum').textContent.trim() !== ''", timeout=60000)
    page.wait_for_timeout(600)

def snap(page):
    return page.evaluate("""() => ({num: document.getElementById('lvlNum').textContent.trim(),
        name: document.getElementById('lvlName').textContent.trim(),
        msg: document.getElementById('msg').textContent.trim(),
        rivers: document.getElementById('rivers').textContent.trim().slice(0, 160),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        bannerShown: !document.getElementById('demoBanner').hidden,
        lead: (document.getElementById('lead') || {textContent: ''}).textContent.trim().slice(0, 120)})""")

def axe_serious(page):
    if not AXE: return None
    page.evaluate(AXE)
    res = page.evaluate("async () => (await axe.run(document, {resultTypes: ['violations']})).violations"
                        ".filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id + ' x' + v.nodes.length)")
    return res

def main():
    srv = None
    if LIVE: base = 'https://aariv.me/Brazos-beacon'
    else:
        srv = serve(); base = 'http://127.0.0.1:%d' % srv.server_address[1]
    n, fails, upstream = 0, [], []
    def check(name, cond, info=''):
        nonlocal n
        n += 1
        print(('ok - ' if cond else 'FAIL - ') + name + ('' if cond else '  ' + json.dumps(info, ensure_ascii=False)[:600]))
        if not cond: fails.append(name)
    exe = '/usr/bin/chromium' if os.path.exists('/usr/bin/chromium') else None
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=exe, args=['--no-sandbox'])
        for w, h in ((390, 844), (1280, 900)):
            for lang in ('en', 'es'):
                tag = '%s %dpx %s' % ('live' if LIVE else 'local', w, lang)
                ctx = b.new_context(viewport={'width': w, 'height': h}, service_workers='block', locale='en-US', timezone_id='America/Chicago')
                page = ctx.new_page(); errs, cons = [], []
                page.on('pageerror', lambda e: errs.append(str(e)))
                page.on('console', lambda m: cons.append(m.text) if m.type == 'error' else None)
                page.route('**/*', route_factory(base, upstream))
                page.goto(base + '/index.html?lang=' + lang, wait_until='domcontentloaded')
                settle(page); s = snap(page)
                ok_level = s['num'] in ('0', '1', '2', '3', '4') and s['name'] == LEVELS[lang][int(s['num'])] or s['num'] == '?'
                check(tag + ' Sugar Land: level shown (%s %s)' % (s['num'], s['name']), ok_level, s)
                check(tag + ' Sugar Land: river gauges listed', len(s['rivers']) > 20, s)
                check(tag + ' Sugar Land: no page errors', not errs, errs)
                check(tag + ' Sugar Land: no console errors', not cons, cons)
                check(tag + ' Sugar Land: no horizontal overflow', not s['overflow'], s)
                ax = axe_serious(page)
                if ax is not None: check(tag + ' Sugar Land: axe no serious/critical', not ax, ax)
                # Harvey replay
                page.click('#demoBtn'); settle(page); d = snap(page)
                check(tag + ' Harvey: replay banner open', d['bannerShown'], d)
                check(tag + ' Harvey: crest level is 4 (%s)' % d['name'], d['num'] == '4' and d['name'] == LEVELS[lang][4], d)
                check(tag + ' Harvey: lead-time box rendered', len(d['lead']) > 20, d)
                mn = page.evaluate("document.getElementById('replay').min")
                page.evaluate("v => { const r = document.getElementById('replay'); r.value = v; r.dispatchEvent(new Event('input', {bubbles: true})); }", mn)
                page.wait_for_timeout(400); e0 = snap(page)
                check(tag + ' Harvey: start of replay is calmer than the crest (%s)' % e0['num'], e0['num'] in ('0', '1', '2', '3'), e0)
                # Sweep the replay: every hero colour (level 0-4) must keep AA text contrast (axe color-contrast).
                if AXE and w == 390:
                    mx = page.evaluate("document.getElementById('replay').max"); seen = {}
                    for i in range(25):
                        v = int(float(mn) + (float(mx) - float(mn)) * i / 24)
                        page.evaluate("v => { const r = document.getElementById('replay'); r.value = v; r.dispatchEvent(new Event('input', {bubbles: true})); }", v)
                        page.wait_for_timeout(120); lv = page.evaluate("document.getElementById('lvlNum').textContent.trim()")
                        if lv not in seen:
                            seen[lv] = page.evaluate("async () => (await axe.run(document.getElementById('hero'), {runOnly: ['color-contrast']})).violations"
                                                     ".map(v => v.nodes.map(n => n.target.join(' ') + ' ' + n.failureSummary.split('\\n')[1]))")
                    check(tag + ' Harvey sweep: levels %s seen, hero text contrast AA at each' % ','.join(sorted(seen)), len(seen) >= 3 and not any(seen.values()), seen)
                check(tag + ' Harvey: no page errors', not errs, errs)
                check(tag + ' Harvey: no console errors', not cons, cons)
                check(tag + ' Harvey: no horizontal overflow', not d['overflow'] and not e0['overflow'], [d, e0])
                ax = axe_serious(page)
                if ax is not None: check(tag + ' Harvey: axe no serious/critical', not ax, ax)
                ctx.close()
        b.close()
    if upstream: print('note: upstream answered errors (page must show them honestly):', sorted(set(upstream)))
    print('\n%d/%d live-regression checks passed' % (n - len(fails), n))
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
