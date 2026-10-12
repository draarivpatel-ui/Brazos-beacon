#!/usr/bin/env python3
"""README 'Judge it in 60 seconds' tour, step by step, in headless Chromium at 390 px, English and Spanish.

Run:  python3 tests/readme_tour.py           (serves this folder on 127.0.0.1)
      python3 tests/readme_tour.py --live    (loads https://aariv.me/Brazos-beacon/)

Like live_regression.py, data is real (NOAA / NWS / FEMA / geocoders), fetched from Python and handed to the page.
Steps (the README's own words):
  1. Open the site and enter a Fort Bend County address or ZIP -> the hero names the new place and shows a level
     (0-4, or the honest '?' state), gauges are listed, no 'could not find' error.
  2. Open ?demo=harvey -> replay banner opens straight from the URL, crest level 4 with the lead-time box.
  3. Toggle English/Espanol with the header buttons -> <html lang>, aria-pressed and the visible strings switch
     (no English level/tagline left in the Spanish UI and vice versa), and the choice survives into step 2's URL.
Each step: no page errors, no console errors, no horizontal overflow, axe serious/critical 0 (when axe is available).
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import live_regression as L
from playwright.sync_api import sync_playwright

ADDR = '77469'  # Richmond ZIP: a Fort Bend ZIP other than the Sugar Land default, so the place must change
TAG = {'en': 'Live flood & heat risk for your Fort Bend street, in plain language.'}

def main():
    srv = None
    if L.LIVE: base = 'https://aariv.me/Brazos-beacon'
    else:
        srv = L.serve(); base = 'http://127.0.0.1:%d' % srv.server_address[1]
    n, fails, upstream = 0, [], []
    def check(name, cond, info=''):
        nonlocal n
        n += 1
        print(('ok - ' if cond else 'FAIL - ') + name + ('' if cond else '  ' + json.dumps(info, ensure_ascii=False)[:600]))
        if not cond: fails.append(name)
    exe = '/usr/bin/chromium' if os.path.exists('/usr/bin/chromium') else None
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=exe, args=['--no-sandbox'])
        for lang in ('en', 'es'):
            other = 'es' if lang == 'en' else 'en'
            tag = '%s 390px %s' % ('live' if L.LIVE else 'local', lang)
            ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block', locale='en-US', timezone_id='America/Chicago')
            page = ctx.new_page(); errs, cons = [], []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.on('console', lambda m: cons.append(m.text) if m.type == 'error' else None)
            page.route('**/*', L.route_factory(base, upstream))
            # Step 1: open + enter a ZIP
            page.goto(base + '/?lang=' + lang, wait_until='domcontentloaded'); L.settle(page)
            before = page.evaluate("document.getElementById('placeName').textContent.trim()")
            page.fill('#addr', ADDR); page.press('#addr', 'Enter')
            page.wait_for_function("p => document.getElementById('placeName').textContent.trim() !== p || document.querySelector('#msg.err, #msg[role=alert]:not(:empty)')", arg=before, timeout=45000)
            L.settle(page); s = L.snap(page)
            place = page.evaluate("document.getElementById('placeName').textContent.trim()")
            ok_level = (s['num'] in ('0', '1', '2', '3', '4') and s['name'] == L.LEVELS[lang][int(s['num'])]) or s['num'] == '?'
            check(tag + ' step 1: ZIP %s moves the hero to a new place (%s -> %s)' % (ADDR, before, place), bool(place) and place != before and ('Richmond' in place or ADDR in place), [before, place, s['msg']])
            check(tag + ' step 1: level shown in this language (%s %s)' % (s['num'], s['name']), ok_level, s)
            check(tag + ' step 1: gauges listed', len(s['rivers']) > 20, s)
            check(tag + ' step 1: no overflow', not s['overflow'], s)
            ax = L.axe_serious(page)
            if ax is not None: check(tag + ' step 1: axe no serious/critical', not ax, ax)
            # Step 2: the ?demo=harvey URL itself
            page.goto(base + '/?demo=harvey&lang=' + lang, wait_until='domcontentloaded'); L.settle(page); d = L.snap(page)
            check(tag + ' step 2: ?demo=harvey opens the replay banner', d['bannerShown'], d)
            check(tag + ' step 2: crest level 4 (%s)' % d['name'], d['num'] == '4' and d['name'] == L.LEVELS[lang][4], d)
            check(tag + ' step 2: lead-time box', len(d['lead']) > 20, d)
            check(tag + ' step 2: no overflow', not d['overflow'], d)
            ax = L.axe_serious(page)
            if ax is not None: check(tag + ' step 2: axe no serious/critical', not ax, ax)
            # Step 3: toggle to the other language with the header button, then back
            for want in (other, lang):
                page.click('.lang button[data-lang=%s]' % want); page.wait_for_timeout(500); t = L.snap(page)
                st = page.evaluate("""() => ({lang: document.documentElement.lang,
                    pressed: [...document.querySelectorAll('.lang button')].map(b => b.dataset.lang + ':' + b.getAttribute('aria-pressed')).join(' '),
                    tagline: document.querySelector('[data-i18n=tagline]').textContent.trim(),
                    url: location.search, hero: document.getElementById('hero').innerText})""")
                check(tag + ' step 3: toggle to %s sets <html lang> + aria-pressed' % want, st['lang'] == want and ('%s:true' % want) in st['pressed'], st)
                check(tag + ' step 3: %s level name during replay (%s)' % (want, t['name']), t['name'] == L.LEVELS[want][int(t['num'])] if t['num'].isdigit() else True, t)
                tagline_ok = (st['tagline'] == TAG['en']) if want == 'en' else (st['tagline'] and st['tagline'] != TAG['en'])
                check(tag + ' step 3: tagline in %s' % want, tagline_ok, st['tagline'])
                leak = [w for w in L.LEVELS['es' if want == 'en' else 'en'] if w in st['hero'] and w not in L.LEVELS[want]]
                check(tag + ' step 3: no %s level words left in the %s hero' % ('es' if want == 'en' else 'en', want), not leak, leak)
                check(tag + ' step 3: still in the replay after toggling to %s' % want, 'demo=harvey' in st['url'] and t['bannerShown'], st['url'])
                check(tag + ' step 3: no overflow in %s' % want, not t['overflow'], t)
            ax = L.axe_serious(page)
            if ax is not None: check(tag + ' step 3: axe no serious/critical', not ax, ax)
            check(tag + ' tour: no page errors', not errs, errs)
            check(tag + ' tour: no console errors', not cons, cons)
            ctx.close()
        b.close()
    if upstream: print('note: upstream answered errors (page must show them honestly):', sorted(set(upstream)))
    print('\n%d/%d README-tour checks passed' % (n - len(fails), n))
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
