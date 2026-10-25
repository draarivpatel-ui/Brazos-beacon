'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const L = require('../logic.js');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const html = read('index.html');
const css = read('style.css');
const sw = read('sw.js');
const manifest = JSON.parse(read('manifest.webmanifest'));

test('1. index.html includes doctype, viewport, title and canonical link', () => {
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<title>Brazos Beacon/);
  assert.match(html, /<link rel="canonical" href="https:\/\/aariv\.me\/Brazos-beacon\/">/);
});

test('2. index.html includes OpenGraph and Twitter card metadata', () => {
  assert.match(html, /<meta property="og:title"/);
  assert.match(html, /<meta property="og:description"/);
  assert.match(html, /<meta property="og:type" content="website">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/aariv\.me\/Brazos-beacon\/">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/aariv\.me\/Brazos-beacon\/og-image\.png">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
});

test('3. index.html includes CSP, referrer and noindex privacy headers', () => {
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
  assert.match(html, /<meta http-equiv="Content-Security-Policy"/);
});

test('4. index.html has a skip link and main landmark', () => {
  assert.match(html, /<a class="skip" href="#main"/);
  assert.match(html, /<main id="main">/);
});

test('5. index.html provides bilingual EN and ES noscript fallback with official emergency guidance', () => {
  assert.match(html, /<noscript>[\s\S]*Brazos Beacon needs JavaScript[\s\S]*Brazos Beacon necesita JavaScript[\s\S]*<\/noscript>/);
  assert.match(html, /weather\.gov\/hgx/);
  assert.match(html, /FBCAlert/);
});

test('6. index.html wires language toggle buttons with aria-pressed', () => {
  assert.match(html, /data-lang="en"[^>]*aria-pressed="true"/);
  assert.match(html, /data-lang="es"[^>]*aria-pressed="false"/);
});

test('7. index.html includes search form, address input and geolocation button', () => {
  assert.match(html, /<form id="searchForm"/);
  assert.match(html, /<input id="addr" name="addr" type="search"/);
  assert.match(html, /<button type="button" id="locBtn"/);
});

test('8. index.html includes Fort Bend preset city chips and Harvey replay trigger', () => {
  const cities = ['Sugar Land', 'Missouri City', 'Richmond', 'Rosenberg', 'Fulshear', 'Stafford', 'Needville', 'Katy'];
  cities.forEach((city) => assert.ok(html.includes(city), 'missing preset city: ' + city));
  assert.match(html, /id="demoBtn"/);
});

test('9. index.html includes Harvey replay controls banner with play, crest and range slider', () => {
  assert.match(html, /id="demoBanner"/);
  assert.match(html, /id="playBtn"/);
  assert.match(html, /id="crestBtn"/);
  assert.match(html, /input type="range" id="replay"/);
  assert.match(html, /output id="replayTime"/);
});

test('10. index.html includes hero risk dial, place title, drivers list and share button', () => {
  assert.match(html, /id="hero"/);
  assert.match(html, /id="lvlNum"/);
  assert.match(html, /id="placeName"/);
  assert.match(html, /id="lvlName"/);
  assert.match(html, /id="lvlDesc"/);
  assert.match(html, /id="drivers"/);
  assert.match(html, /id="shareBtn"/);
});

test('11. index.html includes map, FEMA flood zone, 72-hour weather, rivers, alerts, actions and help cards', () => {
  ['map', 'zone', 'wx', 'rivers', 'chartWrap', 'chart', 'alerts', 'actions', 'planBtn', 'help'].forEach((id) => {
    assert.ok(html.includes('id="' + id + '"'), 'missing card element #' + id);
  });
});

test('12. index.html includes accessible status and live announcements', () => {
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live=/);
});

test('13. style.css enforces overflow-x: clip on html and body and defines :focus-visible', () => {
  assert.match(css, /html\s*\{[^}]*overflow-x:\s*clip/);
  assert.match(css, /body\s*\{[^}]*overflow-x:\s*clip/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:/);
});

test('14. style.css defines custom properties for all risk levels 0 through 4', () => {
  ['--l0', '--l1', '--l2', '--l3', '--l4', '--navy', '--teal'].forEach((token) => {
    assert.ok(css.includes(token + ':'), 'missing CSS variable ' + token);
  });
});

test('15. style.css respects prefers-reduced-motion rules', () => {
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('16. style.css includes comprehensive @media print rules', () => {
  assert.match(css, /@media\s*print/);
  assert.match(css, /page-break-inside:\s*avoid|break-inside:\s*avoid/);
});

test('17. manifest.webmanifest is valid and icons exist on disk', () => {
  assert.equal(manifest.short_name, 'Brazos Beacon');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
  manifest.icons.forEach((icon) => {
    assert.ok(fs.existsSync(path.join(ROOT, icon.src)), 'missing icon ' + icon.src);
  });
});

test('18. service worker precaches core shell assets that exist on disk', () => {
  ['index.html', 'style.css', 'logic.js', 'i18n.js', 'demo.js', 'app.js'].forEach((f) => {
    assert.ok(sw.includes(f), 'sw.js missing ' + f);
    assert.ok(fs.existsSync(path.join(ROOT, f)), 'missing file on disk: ' + f);
  });
});

test('19. logic.js heatIndexF and heatLevel compute NWS Rothfusz heat categories', () => {
  const hi = L.heatIndexF(95, 60);
  assert.ok(hi > 105 && hi < 115);
  assert.equal(L.heatLevel(75), 0);
  assert.equal(L.heatLevel(85), 1);
  assert.equal(L.heatLevel(95), 2);
  assert.equal(L.heatLevel(108), 3);
  assert.equal(L.heatLevel(130), 4);
});

test('20. logic.js heatRiskLevel follows NWS Houston/Galveston Heat Advisory (108 F) and Warning (113 F) criteria', () => {
  assert.equal(L.heatRiskLevel(88), 0);
  assert.equal(L.heatRiskLevel(95), 1);
  assert.equal(L.heatRiskLevel(108), 2);
  assert.equal(L.heatRiskLevel(113), 3);
});

test('21. logic.js riverCategory and feetToFlood classify gauge stage against NWS flood thresholds', () => {
  const cats = { action: { stage: 42 }, minor: { stage: 45 }, moderate: { stage: 48 }, major: { stage: 50 } };
  assert.equal(L.riverCategory(40, cats), 'no_flooding');
  assert.equal(L.riverCategory(43, cats), 'action');
  assert.equal(L.riverCategory(46, cats), 'minor');
  assert.equal(L.riverCategory(49, cats), 'moderate');
  assert.equal(L.riverCategory(55.19, cats), 'major');
  assert.equal(L.feetToFlood(41.5, cats), 3.5);
});

test('22. logic.js floodZoneInfo classifies FEMA special flood hazard areas vs minimal flood hazard', () => {
  const ae = L.floodZoneInfo('AE', null);
  assert.equal(ae.sfha, true);
  assert.ok(ae.level >= 1);
  const x = L.floodZoneInfo('X', 'AREA OF MINIMAL FLOOD HAZARD');
  assert.equal(x.sfha, false);
});

test('23. logic.js distanceKm and snapshotUsable validate offline cache proximity and age', () => {
  const km = L.distanceKm(29.6197, -95.6349, 29.5822, -95.7608);
  assert.ok(km > 11 && km < 14);
  const now = 1700000000000;
  assert.equal(L.snapshotUsable({ lat: 29.6197, lon: -95.6349, savedAt: now - 3600000 }, 29.62, -95.635, now).ok, true);
  assert.equal(L.snapshotUsable({ lat: 29.6197, lon: -95.6349, savedAt: now - 3600000 }, 29.8, -95.9, now).reason, 'far');
});

test('24. logic.js overallRisk combines river, rain, heat and NWS alerts conservatively', () => {
  const res = L.overallRisk({
    gauges: [{ name: 'Richmond', category: 'major' }],
    rain24: 8.5,
    maxHeatIndex: 110,
    alerts: []
  });
  assert.equal(res.level, 4);
  assert.ok(res.drivers.length >= 2);
});

test('25. i18n.js provides complete English and Spanish translation dictionaries', () => {
  const i18nSrc = read('i18n.js');
  assert.match(i18nSrc, /\ben\s*:/);
  assert.match(i18nSrc, /\bes\s*:/);
  assert.match(i18nSrc, /skip\s*:/);
});

test('26. repository text files contain zero em-dashes, en-dashes, or personal gmail leaks', () => {
  const files = ['index.html', 'style.css', 'logic.js', 'i18n.js', 'demo.js', 'app.js', 'README.md'];
  files.forEach((f) => {
    const content = read(f);
    assert.equal(/[\u2013\u2014]/.test(content), false, 'em/en dash found in ' + f);
    assert.equal(/[a-z0-9._%+-]+@gmail\.com/i.test(content), false, 'gmail leak in ' + f);
  });
});
