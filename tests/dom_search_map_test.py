#!/usr/bin/env python3
"""Headless-Chromium DOM test for the address search and the map (every API stubbed, same fixtures as dom_429_test.py).

- An unreachable / rate-limited address search says so ("Could not reach the address search"), never
  "Could not find that address"; offline gets its own line; a real no-match still says "Could not find".
- A slow search that answers after the user already picked a city chip must not overwrite that newer pick.
- A blank (spaces-only) search explains itself and returns focus to the field.
- Map markers are not unnamed Tab stops; zoom buttons follow the page language (EN/ES).
- The search placeholder fits the field at 390 px in English and Spanish (no mid-word cut).
- "Use my location": denied, unavailable and timed-out each get their own message; a late answer can't overwrite a newer pick.
Run: python3 tests/dom_search_map_test.py
"""
import json, os, sys
import dom_429_test as D
from playwright.sync_api import sync_playwright

def open_page(b, base, lang='en', geo=None, offline=False, hold_geocode=None):
    """geo: dict key->('429'|'nomatch'|'ok'); hold_geocode: list to park geocode routes in (not answered)."""
    fx = D.fixtures()
    geo = geo or {}
    if geo.get('geocode') == 'nomatch': fx['geocode'] = {'candidates': [{'score': 40, 'location': {'x': -95.6, 'y': 29.6}, 'address': 'Somewhere'}]}
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
    if offline: ctx.add_init_script("Object.defineProperty(Navigator.prototype, 'onLine', { get: function () { return false; } });")
    page = ctx.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    def route(r):
        u = r.request.url
        if u.startswith(base): return r.continue_()
        if 'unpkg.com/leaflet' in u: return r.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'}, content_type='application/javascript', body=D.LEAFLET)
        k = D.classify(u)
        if k is None: return r.fulfill(status=204, body='')
        if k == 'geocode' and hold_geocode is not None: hold_geocode.append((r, fx)); return
        mode = geo.get(k)
        cors = {'Access-Control-Allow-Origin': '*'}
        if mode == '429': return r.fulfill(status=429, headers=cors, content_type='application/json', body='{"error":"too many"}')
        if mode == 'abort': return r.abort('internetdisconnected')
        return r.fulfill(status=200, headers=cors, content_type='application/json', body=json.dumps(fx[k]))
    page.route('**/*', route)
    page.goto(base + '/index.html?lang=' + lang, wait_until='domcontentloaded')
    page.wait_for_function("!document.getElementById('main').hasAttribute('aria-busy') && document.getElementById('lvlNum').textContent.trim() !== ''", timeout=20000)
    return ctx, page, errors

def T(page, key): return page.evaluate("k => window.I18N[document.documentElement.lang][k]", key)
def msg(page): return page.evaluate("() => document.getElementById('msg').textContent.trim()")
def search(page, q, wait=1200):
    page.fill('#addr', q); page.press('#addr', 'Enter'); page.wait_for_timeout(wait)

def main():
    D.LEAFLET = open('/tmp/leaflet.js', 'rb').read() if os.path.exists('/tmp/leaflet.js') else None
    srv = D.serve(); base = 'http://127.0.0.1:%d' % srv.server_address[1]
    n = 0; fails = []
    def check(name, cond, info=None):
        nonlocal n; n += 1
        print(('ok - ' if cond else 'FAIL - ') + name)
        if not cond: fails.append((name, info))
    with sync_playwright() as p:
        b = D.launch(p)
        for lang in ('en', 'es'):
            # 1. both geocoders rate-limited -> "could not reach", not "could not find"
            ctx, pg, err = open_page(b, base, lang, geo={'geocode': '429', 'nominatim': '429'})
            search(pg, '2200 Texas Pkwy')
            m = msg(pg)
            check('%s: geocoders 429 -> "could not reach the address search"' % lang, m == T(pg, 'err_geo_net') and m != T(pg, 'err_geo') and not err, m)
            check('%s: error is styled as an error' % lang, 'err' in pg.get_attribute('#msg', 'class'))
            ctx.close()
            # 2. offline -> offline wording
            ctx, pg, err = open_page(b, base, lang, geo={'geocode': 'abort', 'nominatim': 'abort'}, offline=True)
            search(pg, '77479')
            check('%s: offline search -> offline wording' % lang, msg(pg) == T(pg, 'err_geo_offline') and not err, msg(pg))
            ctx.close()
            # 3. real no-match (geocoder answered, low score; Nominatim empty) -> "could not find"
            ctx, pg, err = open_page(b, base, lang, geo={'geocode': 'nomatch'})
            search(pg, 'zzzz qqqq')
            check('%s: genuine no-match -> "could not find that address"' % lang, msg(pg) == T(pg, 'err_geo') and not err, msg(pg))
            # 4. blank search -> hint + focus back in the field (the field is required, so only spaces get here)
            pg.fill('#addr', '   '); pg.press('#addr', 'Enter'); pg.wait_for_timeout(200)
            check('%s: spaces-only search -> "type an address" hint, focus stays in field' % lang,
                  msg(pg) == T(pg, 'err_empty') and pg.evaluate("document.activeElement.id") == 'addr', msg(pg))
            # 5. map: no marker path in the Tab order; zoom titles localized
            info = pg.evaluate("""() => ({
                tabbablePaths: [...document.querySelectorAll('#map path.leaflet-interactive')].filter(p => p.tabIndex >= 0).length,
                paths: document.querySelectorAll('#map path.leaflet-interactive').length,
                zin: document.querySelector('.leaflet-control-zoom-in').getAttribute('aria-label'),
                zout: document.querySelector('.leaflet-control-zoom-out').getAttribute('title'),
                zoomCount: document.querySelectorAll('.leaflet-control-zoom').length })""")
            check('%s: map markers drawn but none is a Tab stop' % lang, info['paths'] >= 2 and info['tabbablePaths'] == 0, info)
            check('%s: zoom buttons in page language, one control' % lang, info['zin'] == T(pg, 'zoom_in') and info['zout'] == T(pg, 'zoom_out') and info['zoomCount'] == 1, info)
            seen = []
            for _ in range(30):
                pg.keyboard.press('Tab'); seen.append(pg.evaluate("document.activeElement.tagName.toLowerCase()"))
            check('%s: 30 Tab presses never land on an SVG path' % lang, 'path' not in seen, seen)
            # 6. placeholder fits the field at 390 px
            fit = pg.evaluate("""() => { const i = document.getElementById('addr'), cs = getComputedStyle(i);
                const c = document.createElement('canvas').getContext('2d'); c.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
                const room = i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 24;  // 24 px: search clear button
                return { w: Math.ceil(c.measureText(i.placeholder).width), room: room, ph: i.placeholder }; }""")
            check('%s: search placeholder fits at 390 px (%s)' % (lang, fit), fit['w'] <= fit['room'], fit)
            ctx.close()
        # 7. language switch re-localizes zoom buttons (EN -> ES -> EN), still one control
        ctx, pg, err = open_page(b, base, 'en')
        pg.click('[data-lang=es]'); pg.wait_for_timeout(200)
        es = pg.get_attribute('.leaflet-control-zoom-in', 'aria-label')
        pg.click('[data-lang=en]'); pg.wait_for_timeout(200)
        en = pg.get_attribute('.leaflet-control-zoom-in', 'aria-label')
        check('language switch: zoom buttons follow (Acercar -> Zoom in), no duplicates',
              es == 'Acercar' and en == 'Zoom in' and pg.evaluate("document.querySelectorAll('.leaflet-control-zoom').length") == 1 and not err, (es, en))
        # 8. normal search still works
        search(pg, '1 Test St', 1500)
        check('successful search shows the geocoded place, clears the message',
              pg.evaluate("document.getElementById('placeName').textContent").startswith('1 Test St') and msg(pg) == '', (msg(pg)))
        ctx.close()
        # 10. "Use my location" errors: denied / unavailable / timeout each get their own line (EN/ES)
        for lang in ('en', 'es'):
            for code, key in ((1, 'err_loc'), (2, 'err_loc_na'), (3, 'err_loc_timeout')):
                ctx, pg, err = open_page(b, base, lang)
                pg.evaluate("c => { navigator.geolocation.getCurrentPosition = (ok, bad) => setTimeout(() => bad({ code: c, message: 'stub' }), 50); }", code)
                pg.click('#locBtn'); pg.wait_for_timeout(300)
                check('%s: location error code %d -> %s' % (lang, code, key), msg(pg) == T(pg, key) and not err, msg(pg))
                ctx.close()
        # 11. location that answers after a newer chip pick is ignored
        ctx, pg, err = open_page(b, base, 'en')
        pg.evaluate("() => { navigator.geolocation.getCurrentPosition = (ok) => setTimeout(() => ok({ coords: { latitude: 29.70, longitude: -95.40 } }), 900); }")
        pg.click('#locBtn'); pg.wait_for_timeout(100)
        pg.click('.chip[data-ll]:has-text("Katy")'); pg.wait_for_timeout(2500)
        check('a slow "Use my location" answer does not overwrite a newer Katy pick', pg.evaluate("document.getElementById('placeName').textContent") == 'Katy' and not err,
              pg.evaluate("document.getElementById('placeName').textContent"))
        ctx.close()
        # 12. JavaScript off: an EN + ES pointer to official alerts instead of an endless "Loading"
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, java_script_enabled=False); pg = ctx.new_page()
        pg.goto(base + '/index.html')
        txt = pg.inner_text('body')
        check('JavaScript off: EN + ES notice with weather.gov/hgx and FBCAlert is shown',
              'needs JavaScript' in txt and 'necesita JavaScript' in txt and pg.locator('noscript a[href="https://www.weather.gov/hgx/"], .noscript a[href="https://www.weather.gov/hgx/"]').count() >= 2, txt[:300])
        ctx.close()
        # 9. race: a slow search answering after a newer city-chip pick must not overwrite it
        held = []
        ctx, pg, err = open_page(b, base, 'en', hold_geocode=held)
        pg.fill('#addr', '1 Test St'); pg.press('#addr', 'Enter'); pg.wait_for_timeout(300)
        pg.click('.chip[data-ll]:has-text("Richmond")'); pg.wait_for_timeout(1200)
        for r, fx in held: r.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'}, content_type='application/json', body=json.dumps(fx['geocode']))
        pg.wait_for_timeout(1500)
        place = pg.evaluate("document.getElementById('placeName').textContent")
        url = pg.url
        check('slow search answering after a Richmond chip pick does not overwrite it', len(held) == 1 and place == 'Richmond' and 'Richmond' in url and not err, (len(held), place, url))
        ctx.close()
        b.close()
    srv.shutdown()
    for name, info in fails: print('\n--', name, '\n', json.dumps(info, ensure_ascii=False)[:800])
    print('\n%d/%d search/map checks passed' % (n - len(fails), n))
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
