// Run: node logic.test.js
const L = require('./logic.js');
const assert = require('assert');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('heat index matches NWS table (90F/60% ~ 100F)', () => { const hi = L.heatIndexF(90, 60); assert(hi >= 99 && hi <= 101, hi); });
t('heat index matches NWS table (100F/50% ~ 118F)', () => { const hi = L.heatIndexF(100, 50); assert(hi >= 117 && hi <= 119, hi); });
t('mild weather uses simple formula', () => { const hi = L.heatIndexF(70, 50); assert(hi > 68 && hi < 71, hi); });
t('heat index handles missing input', () => { assert.strictEqual(L.heatIndexF(null, 50), null); assert.strictEqual(L.heatIndexF(90, NaN), null); });
t('NWS heat categories', () => { assert.strictEqual(L.heatLevel(79), 0); assert.strictEqual(L.heatLevel(95), 2); assert.strictEqual(L.heatLevel(110), 3); assert.strictEqual(L.heatLevel(130), 4); });
t('heat raises the level at NWS Houston advisory/warning criteria (108/113 F), not on an ordinary day', () => {
  assert.strictEqual(L.heatRiskLevel(85), 0); assert.strictEqual(L.heatRiskLevel(95), 1); assert.strictEqual(L.heatRiskLevel(107), 1);
  assert.strictEqual(L.heatRiskLevel(108), 2); assert.strictEqual(L.heatRiskLevel(113), 3); assert.strictEqual(L.heatRiskLevel(null), 0);
});
const cats = { action: { stage: 20 }, minor: { stage: 45 }, moderate: { stage: 48 }, major: { stage: 50 } }; // Brazos at Richmond (RMOT2)
t('river category - normal', () => assert.strictEqual(L.riverCategory(10.06, cats), 'no_flooding'));
t('river category - Harvey crest 55.19 ft is major', () => assert.strictEqual(L.riverCategory(55.19, cats), 'major'));
t('river category - action stage boundary', () => { assert.strictEqual(L.riverCategory(20, cats), 'action'); assert.strictEqual(L.riverCategory(19.99, cats), 'no_flooding'); });
t('river category - missing data', () => { assert.strictEqual(L.riverCategory(null, cats), 'unknown'); assert.strictEqual(L.riverCategory(-999, cats), 'unknown'); assert.strictEqual(L.riverCategory(10, null), 'unknown'); });
t('river category ignores -9999 category stages', () => {
  const c = { action: { stage: -9999 }, minor: { stage: 30 }, moderate: { stage: -9999 }, major: { stage: -9999 } };
  assert.strictEqual(L.riverCategory(35, c), 'minor'); assert.strictEqual(L.riverCategory(25, c), 'no_flooding');
});
t('feet to flood stage works for elevation-datum gauges', () => {
  assert.strictEqual(L.feetToFlood(10.08, cats), 34.9);
  assert.strictEqual(L.feetToFlood(55.19, cats), -10.2);
  assert.strictEqual(L.feetToFlood(85.36, { minor: { stage: 90 } }), 4.6);
  assert.strictEqual(L.feetToFlood(10, { minor: { stage: -9999 } }), null);
});
t('forecast peak picks the crest, not the next point', () => {
  const now = 0, fc = [1, 2, 3, 4].map(h => ({ t: h * 3600e3, v: [10, 14, 12, 11][h - 1] }));
  assert.strictEqual(L.forecastPeak(fc, now).v, 14); assert.strictEqual(L.forecastPeak([], now), null);
});
t('alert levels', () => {
  assert.strictEqual(L.alertLevel({ event: 'Flash Flood Warning', severity: 'Severe' }), 3);
  assert.strictEqual(L.alertLevel({ event: 'Flash Flood Emergency', severity: 'Extreme' }), 4);
  assert.strictEqual(L.alertLevel({ event: 'Heat Advisory', severity: 'Moderate' }), 2);
  assert.strictEqual(L.alertLevel({ event: 'Flood Watch', severity: 'Moderate' }), 2);
  assert.strictEqual(L.alertLevel({ event: 'Extreme Heat Warning', severity: 'Extreme' }), 4);
});
t('alert hazard labels: cold events are never filed under storm, flood or rain', () => {
  const h = e => L.alertHazard({ event: e });
  ['Wind Chill Advisory', 'Wind Chill Warning', 'Extreme Cold Warning', 'Winter Storm Warning', 'Ice Storm Warning',
    'Freezing Rain Advisory', 'Freezing Fog Advisory', 'Hard Freeze Warning', 'Freeze Watch', 'Frost Advisory']
    .forEach(e => assert.strictEqual(h(e), 'cold', e));
  [['Flash Flood Warning', 'flood'], ['Coastal Flood Advisory', 'flood'], ['Flood Watch', 'flood'],
    ['Excessive Heat Warning', 'heat'], ['Heat Advisory', 'heat'], ['Tropical Storm Warning', 'tropical'],
    ['Storm Surge Watch', 'tropical'], ['Hurricane Warning', 'tropical'], ['Severe Thunderstorm Warning', 'storm'],
    ['Tornado Warning', 'storm'], ['High Wind Warning', 'storm'], ['Dense Fog Advisory', 'other'],
    ['Rip Current Statement', 'other'], ['Special Weather Statement', 'other']]
    .forEach(([e, k]) => assert.strictEqual(h(e), k, e));
  assert.strictEqual(L.alertHazard(null), 'other');
});
t('overall risk takes the worst driver', () => {
  const r = L.overallRisk({ alerts: [{ event: 'Heat Advisory', severity: 'Moderate' }], gauges: [{ name: 'Brazos', category: 'minor', forecastCategory: 'moderate' }], maxHeatIndex: 95 });
  assert.strictEqual(r.level, 3); assert.strictEqual(r.drivers[0].hazard, 'river'); assert.strictEqual(r.drivers[0].rising, true);
});
t('all clear only when every source answered', () => {
  const ok = L.overallRisk({ alerts: [], gauges: [], maxHeatIndex: 75 });
  assert.strictEqual(ok.level, 0); assert.strictEqual(ok.incomplete, false);
  const bad = L.overallRisk({ alerts: [], gauges: [], missing: ['alerts'] });
  assert.strictEqual(bad.incomplete, true); assert.deepStrictEqual(bad.missing, ['alerts']);
});
t('distant gauges and out-of-floodplain points are discounted', () => {
  const g = [{ name: 'Near', km: 3, category: 'major', forecastCategory: 'major' }, { name: 'Far', km: 40, category: 'major' }];
  const inPlain = L.riskGauges(g, L.floodZoneInfo('AE', null, 'T'));
  assert.strictEqual(inPlain.length, 1); assert.strictEqual(inPlain[0].category, 'major');
  const outside = L.riskGauges(g, L.floodZoneInfo('X', 'AREA OF MINIMAL FLOOD HAZARD', 'F'));
  assert.strictEqual(outside[0].category, 'moderate');
  const unknownZone = L.riskGauges(g, L.floodZoneInfo(null));
  assert.strictEqual(unknownZone[0].category, 'major', 'if FEMA is down, do not discount');
});
t('distance Sugar Land -> Richmond gauge ~12 km / 7.6 mi', () => { const d = L.distanceKm(29.6197, -95.6349, 29.5822, -95.7575); assert(d > 10 && d < 14, d); assert(Math.abs(L.kmToMi(d) - 7.6) < 0.6); });
t('trend', () => { const s = [0,1,2,3].map(h => ({ t: h * 3600e3, v: 10 + h * 0.5 })); assert.strictEqual(L.trendFtPerHour(s, 6), 0.5); });
t('observation age', () => { assert.strictEqual(L.ageHours(0, 3 * 36e5), 3); assert.strictEqual(L.ageHours(null, 5), null); });
t('flood zones', () => {
  assert.strictEqual(L.floodZoneInfo('AE', null, 'T').key, 'sfha');
  assert.strictEqual(L.floodZoneInfo('AE', 'FLOODWAY', 'T').level, 4);
  assert.strictEqual(L.floodZoneInfo('X', 'AREA OF MINIMAL FLOOD HAZARD', 'F').key, 'minimal');
  assert.strictEqual(L.floodZoneInfo('X', '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', 'F').key, 'moderate');
  assert.strictEqual(L.floodZoneInfo('X', 'AREA WITH REDUCED FLOOD RISK DUE TO LEVEE', 'F').key, 'moderate');
  assert.strictEqual(L.floodZoneInfo(null).key, 'unknown');
});
t('parse NWS interval', () => {
  const p = L.parseValidTime('2026-10-10T12:00:00+00:00/PT6H'); assert.strictEqual(p.hours, 6); assert.strictEqual(p.start, Date.parse('2026-10-10T12:00:00Z'));
  assert.strictEqual(L.parseValidTime('2026-10-10T12:00:00+00:00/P1DT2H').hours, 26);
});
t('rain sums with partial overlap', () => {
  const now = Date.parse('2026-10-10T15:00:00Z');
  const vals = [{ validTime: '2026-10-10T12:00:00+00:00/PT6H', value: 25.4 }, { validTime: '2026-10-10T18:00:00+00:00/PT6H', value: 50.8 }];
  assert.strictEqual(L.rainInches(vals, now, 24), 2.5); // half of 1 in + all of 2 in
});
t('rain levels', () => { assert.strictEqual(L.rainLevel(0.5), 0); assert.strictEqual(L.rainLevel(4), 2); assert.strictEqual(L.rainLevel(8), 3); });
t('grid valueAt + hourly heat index with misaligned intervals', () => {
  const now = Date.parse('2026-07-10T18:00:00Z');
  const T = [{ validTime: '2026-07-10T18:00:00+00:00/PT1H', value: 35 }, { validTime: '2026-07-10T19:00:00+00:00/PT3H', value: 36 }];
  const RH = [{ validTime: '2026-07-10T17:00:00+00:00/PT4H', value: 50 }, { validTime: '2026-07-10T21:00:00+00:00/PT2H', value: 40 }];
  assert.strictEqual(L.valueAt(T, now + 1), 35); assert.strictEqual(L.valueAt(T, now + 2 * 36e5), 36); assert.strictEqual(L.valueAt(T, now + 9 * 36e5), null);
  const hi = L.hourlyHeatIndex(T, RH, now, 6);
  assert.strictEqual(hi.length, 4); // hours 18,19,20,21 UTC have both fields
  assert.strictEqual(hi[3].v, L.heatIndexF(36 * 9 / 5 + 32, 40));
});
t('Harvey replay never peeks past "now" for the observed stage', () => {
  const s = [[0, 10], [36e5, 30], [2 * 36e5, 55.19], [3 * 36e5, 50]];
  const r = L.replayAt(s, cats, 36e5);
  assert.strictEqual(r.stage, 30); assert.strictEqual(r.category, 'action'); assert.strictEqual(r.fstage, 55.19); assert.strictEqual(r.forecastCategory, 'major');
});
t('checklist escalates', () => {
  const calm = L.buildChecklist({ drivers: [] }, L.floodZoneInfo('X', '', 'F'));
  assert(calm.includes('kit_basics') && !calm.includes('leave_now'));
  const bad = L.buildChecklist(L.overallRisk({ gauges: [{ name: 'Brazos', category: 'major' }] }), L.floodZoneInfo('AE', null, 'T'));
  assert(bad.includes('leave_now') && bad.includes('flood_insurance') && bad.includes('evac_ready'));
  const hot = L.buildChecklist(L.overallRisk({ maxHeatIndex: 110 }), null);
  assert(hot.includes('check_elderly') && hot.includes('water'));
  assert.strictEqual(new Set(bad).size, bad.length, 'no duplicates');
});
t('family plan picks nearest gauge with a flood stage inside the risk radius', () => {
  const c = { action: { stage: 40 }, minor: { stage: 45 }, moderate: { stage: 48 }, major: { stage: 50 } };
  const gs = [{ lid: 'FAR', name: 'Far', km: 30, cats: c }, { lid: 'NOFS', name: 'No stage', km: 2, cats: { minor: { stage: -9999 } } },
    { lid: 'B', name: 'Second', km: 8, cats: c }, { lid: 'A', name: 'Nearest', km: 5, cats: c }];
  const p = L.familyPlan(L.floodZoneInfo('AE', null, 'T'), gs, 15);
  assert.strictEqual(p.gauge.lid, 'A'); assert.strictEqual(p.gauge.flood, 45); assert.strictEqual(p.gauge.major, 50);
  assert(p.sfha && p.extras.includes('insurance'));
  assert.strictEqual(L.familyPlan(L.floodZoneInfo('X', '', 'F'), [gs[0], gs[1]], 15).gauge, null);
  assert.deepStrictEqual(L.familyPlan(null, null, 15), { gauge: null, sfha: false, extras: [] });
  assert(L.familyPlan(L.floodZoneInfo('AE', 'FLOODWAY', 'T'), [], 15).extras.includes('leave_early'));
});
t('offline snapshot only stands in for the same spot while recent', () => {
  const now = Date.UTC(2026, 9, 10, 20);
  const snap = { lat: 29.6197, lon: -95.6349, savedAt: now - 3 * 36e5 };
  assert.deepStrictEqual(L.snapshotUsable(snap, 29.6197, -95.6349, now), { ok: true, ageH: 3 });
  assert.strictEqual(L.snapshotUsable(snap, 29.6250, -95.6349, now).ok, true, '~0.6 km away still counts');
  assert.strictEqual(L.snapshotUsable(snap, 29.5822, -95.7608, now).reason, 'far', 'Richmond is not Sugar Land');
  assert.strictEqual(L.snapshotUsable({ ...snap, savedAt: now - 80 * 36e5 }, 29.6197, -95.6349, now).reason, 'old');
  assert.strictEqual(L.snapshotUsable({ ...snap, savedAt: now + 36e5 }, 29.6197, -95.6349, now).reason, 'old', 'future clock is not trusted');
  assert.strictEqual(L.snapshotUsable(null, 29.6, -95.6, now).reason, 'none');
  assert.strictEqual(L.snapshotUsable({ lat: 29.6 }, 29.6, -95.6, now).reason, 'none');
});
t('replay lead time: observed-only never uses look-ahead; outlook is earlier', () => {
  const s = [[0, 10], [36e5, 30], [2 * 36e5, 46], [3 * 36e5, 51], [4 * 36e5, 55.19], [5 * 36e5, 50]];
  const r = L.replayLeadTimes(s, cats);
  assert.strictEqual(r.crestMs, 4 * 36e5); assert.strictEqual(r.crestFt, 55.19);
  assert.strictEqual(r.observed[4].at, 3 * 36e5); assert.strictEqual(r.observed[4].hours, 1);
  assert.strictEqual(r.outlook[4].hours, 4, 'outlook sees the major stage 48 h ahead');
  assert.strictEqual(r.observed[2].hours, 2);
  const flat = L.replayLeadTimes([[0, 5], [36e5, 6]], cats);
  assert.strictEqual(flat.observed[1], null); assert.strictEqual(flat.outlook[4], null);
  const harvey = require('fs').readFileSync(__dirname + '/demo.js', 'utf8');
  const D = {}; new Function('window', harvey)(D);
  const h = L.replayLeadTimes(D.BEACON_DEMO.gauge.series, D.BEACON_DEMO.gauge.categories);
  assert.strictEqual(h.crestFt, 55.19); assert(h.observed[4].hours > 0 && h.outlook[4].hours >= h.observed[4].hours);
});
t('a failed source (e.g. NWPS 429) with no hazards is incomplete, never All clear', () => {
  const r = L.overallRisk({ alerts: [], gauges: [], missing: ['river gauges'] });
  assert.strictEqual(r.level, 0); assert.strictEqual(r.incomplete, true); assert.deepStrictEqual(r.missing, ['river gauges']);
});
t('a failed source does not hide a real hazard from another source', () => {
  const r = L.overallRisk({ alerts: [{ event: 'Flash Flood Warning', severity: 'Severe' }], missing: ['river gauges'] });
  assert(r.level >= 1); assert.strictEqual(r.incomplete, true);
});
t('all sources answering is complete', () => {
  const r = L.overallRisk({ alerts: [], gauges: [], missing: [] });
  assert.strictEqual(r.incomplete, false);
});
t('gauge card: list-only gauge (metadata not loaded) keeps the list flood category and says "not loaded", never "no flood stage set"', () => {
  const r = L.gaugeFloodStatus(82.33, null, false, 'no_flooding'); // e.g. BAKT2 Barker, 10.4 mi from Sugar Land
  assert.deepStrictEqual(r, { category: 'no_flooding', ft: null, note: 'not_loaded' });
  assert.strictEqual(L.gaugeFloodStatus(82.33, null, false, 'fcst_not_current').category, 'unknown');
  assert.strictEqual(L.gaugeFloodStatus(null, null, false, 'no_flooding').note, null);
  assert.strictEqual(L.gaugeFloodStatus(-999, null, false, 'no_flooding').note, null);
});
t('gauge card: loaded flood stages give feet below/above; loaded-but-none says "no flood stage set"', () => {
  const barker = { action: { stage: 90.2 }, minor: { stage: 93.2 }, moderate: { stage: -9999 }, major: { stage: -9999 } };
  assert.deepStrictEqual(L.gaugeFloodStatus(82.33, barker, true, 'no_flooding'), { category: 'no_flooding', ft: 10.9, note: 'below' });
  assert.deepStrictEqual(L.gaugeFloodStatus(55.19, cats, true, 'no_flooding'), { category: 'major', ft: -10.2, note: 'above' });
  const none = L.gaugeFloodStatus(5, { minor: { stage: -9999 } }, true, 'not_defined');
  assert.strictEqual(none.note, 'no_fs'); assert.strictEqual(none.category, 'unknown');
  // a loaded gauge with no stages must not borrow the list category
  assert.strictEqual(L.gaugeFloodStatus(5, null, true, 'minor').category, 'unknown');
});
t('i18n: every English string has a Spanish one (same keys, list lengths and {placeholders}); no English copied into ES', () => {
  const sandbox = { window: {} };
  require('vm').runInNewContext(require('fs').readFileSync(__dirname + '/i18n.js', 'utf8'), sandbox);
  const { en, es } = sandbox.window.I18N;
  const ES_ONLY = ['alert_names']; // Spanish names for NWS alert types (English shows NWS's own names)
  const SAME_OK = /^(https?:\/\/|[\d-]+$|weather\.gov\/|Tropical$|Normal$)/; // URLs, phone numbers, words spelled the same in Spanish
  const ph = (v) => (v.match(/\{\w+\}/g) || []).sort().join();
  const walk = (a, b, path) => {
    Object.keys(a).forEach((k) => {
      const p = path + k;
      assert(k in b, 'missing in es: ' + p);
      if (a[k] && typeof a[k] === 'object') {
        assert(b[k] && typeof b[k] === 'object', 'not an object/list in es: ' + p);
        if (Array.isArray(a[k])) assert.strictEqual(b[k].length, a[k].length, 'list length differs: ' + p);
        walk(a[k], b[k], p + '.');
      } else {
        assert.strictEqual(typeof b[k], typeof a[k], 'type differs: ' + p);
        if (typeof a[k] === 'string') {
          assert.strictEqual(ph(b[k]), ph(a[k]), 'placeholders differ: ' + p);
          if (a[k].trim().length > 3 && !SAME_OK.test(a[k])) assert.notStrictEqual(b[k], a[k], 'English text copied into es: ' + p);
        }
      }
    });
    if (path === '') Object.keys(b).forEach((k) => assert(k in a || ES_ONLY.includes(k), 'extra key in es: ' + k));
  };
  walk(en, es, '');
  ['fs_not_loaded', 'no_fs', 'too_far', 'incomplete_name', 'incomplete_desc', 'incomplete_note', 'err_src', 'offline', 'offline_snap', 'map_attr', 'inch'].forEach((k) => {
    assert(typeof en[k] === 'string' && typeof es[k] === 'string' && es[k] !== en[k], 'far-gauge / rate-limit string not translated: ' + k);
  });
});
t('NWS events Houston sees get sensible levels and hazards (table)', () => {
  [['Red Flag Warning', 3, 'other'], ['Dense Fog Advisory', 1, 'other'], ['Air Quality Alert', 1, 'other'],
   ['Rip Current Statement', 1, 'other'], ['Coastal Flood Warning', 3, 'flood'], ['Storm Surge Warning', 3, 'tropical'],
   ['High Wind Warning', 3, 'storm'], ['Special Weather Statement', 1, 'other']].forEach(([ev, lvl, hz]) => {
    assert.strictEqual(L.alertLevel({ event: ev }), lvl, ev + ' level');
    assert.strictEqual(L.alertHazard({ event: ev }), hz, ev + ' hazard');
  });
  const r = L.overallRisk({ alerts: [{ event: 'Dense Fog Advisory' }] });
  assert.strictEqual(r.drivers[0].label, 'Dense Fog Advisory', 'drivers keep the NWS event name as label');
});
const appCount = +(/var TEST_COUNT = (\d+);/.exec(require('fs').readFileSync(__dirname + '/app.js', 'utf8')) || [])[1];
assert.strictEqual(appCount, n, 'app.js TEST_COUNT (shown in the "How it works" panel) must match the number of tests');
console.log(`\n${n} tests passed`);
