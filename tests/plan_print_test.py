#!/usr/bin/env python3
"""Print check for the family flood plan: the sheet must fit ONE US Letter page in English and Spanish,
blank (to fill by hand) and with every answer at its maximum length, for a normal spot and the Harvey replay.

Run: python3 tests/plan_print_test.py     (needs pip playwright + /usr/bin/chromium; poppler-utils for text checks)
     PDFS=out/ python3 tests/plan_print_test.py   to keep the PDFs.
Every API is stubbed with the synthetic fixtures from dom_429_test.py, so this never hits NOAA / NWS / FEMA.
"""
import os, re, shutil, subprocess, sys, tempfile, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dom_429_test as D
from playwright.sync_api import sync_playwright

OUT = os.environ.get('PDFS') or tempfile.mkdtemp()
os.makedirs(OUT, exist_ok=True)
MAXLEN = {'people': 300, 'needs': 300, 'evac': 160, 'contact': 120, 'meetNear': 120, 'meetFar': 120, 'pets': 120}

def pages(path):
    if shutil.which('pdfinfo'):
        m = re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', path], capture_output=True, text=True).stdout)
        return int(m.group(1)) if m else -1
    return len(re.findall(rb'/Type\s*/Page[^s]', open(path, 'rb').read()))

def text(path):
    if not shutil.which('pdftotext'): return None
    return re.sub(r'\s+', ' ', subprocess.run(['pdftotext', path, '-'], capture_output=True, text=True).stdout)

def filler(name, n):
    # words of realistic length, ending in a unique marker so we can prove the whole answer printed
    end = ' END' + name.upper()
    body = ('Grandma Rosa needs insulin in the fridge and her walker; call Dr. Patel 281-555-0100 '
            'Abuela necesita insulina y su andador ') * 6
    return (body[:n - len(end)].rstrip() + end)[:n]

def main():
    if os.path.exists('/tmp/leaflet.js'): D.LEAFLET = open('/tmp/leaflet.js', 'rb').read()
    srv = D.serve(); base = 'http://127.0.0.1:%d' % srv.server_address[1]
    n, fails = 0, []
    def check(name, cond, info=''):
        nonlocal n
        n += 1
        print(('ok - ' if cond else 'FAIL - ') + name + ('' if cond else '  ' + str(info)[:500]))
        if not cond: fails.append(name)
    fx = D.fixtures()
    with sync_playwright() as p:
        b = D.launch(p)
        for lang in ('en', 'es'):
            for mode in ('live',):  # the plan button is hidden during the Harvey replay (a plan is for your real spot)
                for filled in (False, True):
                    tag = '%s %s %s' % (lang, mode, 'max-length answers' if filled else 'blank')
                    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, service_workers='block')
                    ctx.add_init_script('window.print = function () { window.__printed = (window.__printed || 0) + 1; };')
                    page = ctx.new_page(); errs = []
                    page.on('pageerror', lambda e: errs.append(str(e)))
                    def route(r):
                        url = r.request.url
                        if url.startswith(base): return r.continue_()
                        if 'unpkg.com/leaflet' in url and D.LEAFLET:
                            return r.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'}, content_type='application/javascript', body=D.LEAFLET)
                        k = D.classify(url)
                        if k is None: return r.fulfill(status=204, body='')
                        r.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'}, content_type='application/json', body=json.dumps(fx[k]))
                    page.route('**/*', route)
                    page.goto(base + '/index.html?lang=' + lang, wait_until='domcontentloaded')
                    page.wait_for_function("!document.getElementById('main').hasAttribute('aria-busy') && document.getElementById('lvlNum').textContent.trim() !== ''", timeout=30000)
                    if mode == 'harvey':
                        page.click('#demoBtn')
                        page.wait_for_function("!document.getElementById('demoBanner').hidden && !document.getElementById('main').hasAttribute('aria-busy') && document.getElementById('lvlNum').textContent.trim() !== ''", timeout=30000)
                        lvl = page.evaluate("document.getElementById('lvlNum').textContent.trim()")
                    page.click('#planBtn')
                    if filled:
                        for k, ln in MAXLEN.items(): page.fill('#planForm [name=%s]' % k, filler(k, ln))
                    page.click('#planPrint')
                    page.wait_for_function("document.body.classList.contains('print-plan') && window.__printed >= 1", timeout=10000)
                    I = page.evaluate("l => { const x = window.I18N[l]; return {title: x.ps_title, bag: x.ps_bag, numbers: x.ps_numbers, foot: x.ps_foot, live: x.ps_live, names: x.level_names, demo: x.demo_btn, plan: x.plan_btn} }", lang)
                    fit = page.evaluate("document.getElementById('planSheet').className")
                    qr = page.evaluate("!!document.querySelector('#planSheet .ps-qr svg')")
                    path = os.path.join(OUT, 'plan-%s-%s-%s.pdf' % (lang, mode, 'max' if filled else 'blank'))
                    page.pdf(path=path, format='Letter', prefer_css_page_size=True)
                    np = pages(path); t = text(path)
                    check(tag + ': fits 1 Letter page (%d; %s)' % (np, fit), np == 1, np)
                    check(tag + ': QR code to the live page is drawn', qr)
                    check(tag + ': no page errors', not errs, errs)
                    if t is not None:
                        flat = lambda s: re.sub(r'\s+', ' ', s)
                        want = [I['title'], I['numbers'], I['bag']]
                        if mode == 'harvey': want.append(lvl + ' · ' + I['names'][int(lvl)])
                        missing = [w for w in want if flat(w).lower() not in t.lower()]  # h2s print in capitals
                        check(tag + ': title, level, key numbers and go-bag printed', not missing, missing)
                        check(tag + ': no app screen printed behind the sheet', flat(I['demo']) not in t and flat(I['plan']) not in t, t[:200])
                        if filled:
                            cut = [k for k in MAXLEN if ('END' + k.upper()) not in t.replace(' ', '')]
                            check(tag + ': every answer printed in full (no clipping)', not cut, cut)
                    ctx.close()
        b.close()
    print('\n%d/%d plan print checks passed (PDFs in %s)' % (n - len(fails), n, OUT))
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
