/* Brazos Beacon - pure logic (no DOM). Works in the browser and in Node for tests. */
(function (root) {
  'use strict';

  // NWS heat index (Rothfusz regression with NWS adjustments). T in °F, RH in %.
  // Source: https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml
  function heatIndexF(T, RH) {
    if (T == null || RH == null || isNaN(T) || isNaN(RH)) return null;
    var simple = 0.5 * (T + 61.0 + ((T - 68.0) * 1.2) + (RH * 0.094));
    if ((simple + T) / 2 < 80) return Math.round(simple * 10) / 10;
    var HI = -42.379 + 2.04901523 * T + 10.14333127 * RH - 0.22475541 * T * RH
      - 0.00683783 * T * T - 0.05481717 * RH * RH + 0.00122874 * T * T * RH
      + 0.00085282 * T * RH * RH - 0.00000199 * T * T * RH * RH;
    if (RH < 13 && T >= 80 && T <= 112) {
      HI -= ((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    } else if (RH > 85 && T >= 80 && T <= 87) {
      HI += ((RH - 85) / 10) * ((87 - T) / 5);
    }
    return Math.round(HI * 10) / 10;
  }

  // NWS heat index categories -> level 0..4
  function heatLevel(hi) {
    if (hi == null) return 0;
    if (hi >= 125) return 4;   // Extreme Danger
    if (hi >= 103) return 3;   // Danger
    if (hi >= 90) return 2;    // Extreme Caution
    if (hi >= 80) return 1;    // Caution
    return 0;
  }

  // How much forecast heat raises the overall Beacon level, using the NWS Houston/Galveston (HGX)
  // criteria (weather.gov/hgx/WWA_criteria): Heat Advisory at heat index >= 108 F, Extreme Heat Warning
  // at >= 113 F. An ordinary 80-89 F "Caution" afternoon does not move the level at all.
  // Official alerts still arrive through NWS /alerts and count at full weight.
  function heatRiskLevel(hi) {
    if (hi == null || isNaN(hi)) return 0;
    if (hi >= 113) return 3;   // HGX Extreme Heat Warning criterion
    if (hi >= 108) return 2;   // HGX Heat Advisory criterion
    if (hi >= 90) return 1;    // NWS "Extreme Caution" band
    return 0;
  }

  var FLOOD_CAT_LEVEL = { major: 4, moderate: 3, minor: 2, action: 1, no_flooding: 0 };

  // Classify a river stage against NWS flood categories {action, minor, moderate, major} (ft).
  function riverCategory(stage, cats) {
    if (stage == null || !cats || stage < -900) return 'unknown';
    var order = ['major', 'moderate', 'minor', 'action'];
    for (var i = 0; i < order.length; i++) {
      var c = cats[order[i]];
      if (c && c.stage != null && c.stage > -900 && stage >= c.stage) return order[i];
    }
    return 'no_flooding';
  }

  function riverLevel(cat) {
    return FLOOD_CAT_LEVEL.hasOwnProperty(cat) ? FLOOD_CAT_LEVEL[cat] : 0;
  }

  // Feet between the current stage and minor flood stage (positive = below flood stage).
  // Many Houston gauges report water-surface ELEVATION (e.g. 85 ft), so a percent of flood stage
  // would be misleading; a distance in feet is honest for every gauge datum.
  function feetToFlood(stage, cats) {
    var minor = cats && cats.minor && cats.minor.stage;
    if (stage == null || minor == null || minor < -900) return null;
    return Math.round((minor - stage) * 10) / 10;
  }

  // Highest forecast stage in the next `hours` (default 7 days) from a series [{t, v}].
  function forecastPeak(fc, nowMs, hours) {
    var end = nowMs + (hours || 168) * 3600e3, best = null;
    (fc || []).forEach(function (p) { if (p.t >= nowMs - 3600e3 && p.t <= end && p.v > -900 && (!best || p.v > best.v)) best = p; });
    return best;
  }

  // Gauges only drive YOUR level if they are close (<= maxKm). If FEMA maps your point outside the
  // 1% and 0.2% floodplains, a river category counts one step lower. Returns inputs for overallRisk.
  var CAT_ORDER = ['no_flooding', 'action', 'minor', 'moderate', 'major'];
  function riskGauges(gauges, zoneInfo, maxKm) {
    var inPlain = !zoneInfo || zoneInfo.key === 'unknown' || zoneInfo.sfha || zoneInfo.key === 'moderate';
    function adj(c) { if (!c) return c; var i = CAT_ORDER.indexOf(c); return inPlain || i <= 0 ? c : CAT_ORDER[i - 1]; }
    return (gauges || []).filter(function (g) { return g.km <= (maxKm || 15) && g.category && g.category !== 'unknown'; })
      .map(function (g) { return { name: g.name, category: adj(g.category), forecastCategory: adj(g.forecastCategory) }; });
  }

  function kmToMi(km) { return km == null ? null : Math.round(km * 0.621371 * 10) / 10; }

  // Hours since an observation; null if unknown.
  function ageHours(obsMs, nowMs) { return obsMs == null || isNaN(obsMs) ? null : Math.round((nowMs - obsMs) / 36e5 * 10) / 10; }

  // NWS CAP alert -> level 0..4
  function alertLevel(a) {
    if (!a) return 0;
    var ev = (a.event || '').toLowerCase();
    if (/flash flood emergency|tornado warning|hurricane warning|extreme wind|excessive heat warning|extreme heat warning/.test(ev)) return 4;
    if (/warning/.test(ev)) return 3;
    if (/watch/.test(ev)) return 2;
    var sev = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 }[a.severity];
    return sev || 1;
  }

  function alertHazard(a) {
    var ev = ((a && a.event) || '').toLowerCase();
    if (/flood|hydrologic|rain/.test(ev)) return 'flood';
    if (/heat/.test(ev)) return 'heat';
    if (/hurricane|tropical|storm surge/.test(ev)) return 'tropical';
    if (/tornado|thunderstorm|wind/.test(ev)) return 'storm';
    if (/freeze|winter|cold|ice/.test(ev)) return 'cold';
    return 'other';
  }

  // Combine everything into one signal. Returns {level, drivers:[{hazard, level, why}]}
  function overallRisk(input) {
    var drivers = [];
    (input.alerts || []).forEach(function (a) {
      drivers.push({ hazard: alertHazard(a), level: alertLevel(a), source: 'alert', label: a.event });
    });
    (input.gauges || []).forEach(function (g) {
      var lv = riverLevel(g.category);
      var fl = riverLevel(g.forecastCategory);
      if (Math.max(lv, fl) > 0) drivers.push({ hazard: 'river', level: Math.max(lv, fl), source: 'gauge', label: g.name, rising: fl > lv });
    });
    if (input.maxHeatIndex != null) {
      var hl = heatRiskLevel(input.maxHeatIndex);
      if (hl > 0) drivers.push({ hazard: 'heat', level: hl, source: 'forecast', label: input.maxHeatIndex });
    }
    if (input.rain24 != null) {
      var rl = rainLevel(input.rain24);
      if (rl > 0) drivers.push({ hazard: 'rain', level: rl, source: 'forecast', label: input.rain24 });
    }
    drivers.sort(function (a, b) { return b.level - a.level; });
    var level = drivers.length ? drivers[0].level : 0;
    // If a source that could raise the level failed, never claim "All clear".
    var missing = (input.missing || []).slice();
    return { level: level, drivers: drivers, incomplete: missing.length > 0, missing: missing };
  }

  // Haversine distance in km
  function distanceKm(lat1, lon1, lat2, lon2) {
    var R = 6371, toR = Math.PI / 180;
    var dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // Linear trend (ft/hour) over the last `hours` of a series [{t:ms, v:number}]
  function trendFtPerHour(series, hours) {
    if (!series || series.length < 2) return null;
    var end = series[series.length - 1].t, start = end - (hours || 6) * 3600e3;
    var pts = series.filter(function (p) { return p.t >= start && p.v > -900; });
    if (pts.length < 2) return null;
    var n = pts.length, mx = 0, my = 0;
    pts.forEach(function (p) { mx += p.t; my += p.v; }); mx /= n; my /= n;
    var num = 0, den = 0;
    pts.forEach(function (p) { num += (p.t - mx) * (p.v - my); den += (p.t - mx) * (p.t - mx); });
    if (!den) return 0;
    return Math.round((num / den) * 3600e3 * 100) / 100;
  }


  // FEMA NFHL flood zone -> plain-language info. SFHA = Special Flood Hazard Area (1%-annual-chance floodplain).
  function floodZoneInfo(zone, subtype, sfha) {
    if (!zone) return { key: 'unknown', level: 0 };
    var z = String(zone).toUpperCase().trim();
    var sub = String(subtype || '').toUpperCase();
    if (/FLOODWAY/.test(sub)) return { key: 'floodway', level: 4, zone: z, sfha: true };
    if (/^V/.test(z)) return { key: 'coastal', level: 4, zone: z, sfha: true };
    if (/^A/.test(z) || sfha === 'T') return { key: 'sfha', level: 3, zone: z, sfha: true };
    if (z === 'X' && /0\.2|500|REDUCED|LEVEE/.test(sub)) return { key: 'moderate', level: 2, zone: z, sfha: false };
    if (z === 'D') return { key: 'undetermined', level: 1, zone: z, sfha: false };
    if (z === 'OPEN WATER') return { key: 'water', level: 3, zone: z, sfha: true };
    return { key: 'minimal', level: 1, zone: z, sfha: false };
  }

  // Parse an NWS ISO-8601 interval like "2026-10-10T12:00:00+00:00/PT6H" -> {start:ms, hours:n}
  function parseValidTime(vt) {
    if (!vt) return null;
    var parts = String(vt).split('/');
    var start = Date.parse(parts[0]);
    var m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(parts[1] || 'PT1H') || [];
    var hours = (+(m[1] || 0)) * 24 + (+(m[2] || 0)) + (+(m[3] || 0)) / 60;
    return { start: start, hours: hours || 1 };
  }

  // Value of an NWS grid series [{validTime, value}] at time tMs (null if no interval covers it).
  function valueAt(values, tMs) {
    for (var i = 0; i < (values || []).length; i++) {
      var p = parseValidTime(values[i].validTime);
      if (p && tMs >= p.start && tMs < p.start + p.hours * 3600e3) return values[i].value;
    }
    return null;
  }

  // Hourly heat index (F) for the next `hours`, computed from NWS grid temperature (C) and RH (%).
  // NWS grid intervals differ between fields, so each hour is sampled separately instead of pairing by index.
  function hourlyHeatIndex(tempC, rh, nowMs, hours) {
    var out = [], h0 = Math.floor(nowMs / 36e5) * 36e5;
    for (var h = 0; h < (hours || 72); h++) {
      var t = h0 + h * 36e5 + 1, c = valueAt(tempC, t), r = valueAt(rh, t);
      if (c == null || r == null) continue;
      out.push({ t: t - 1, v: heatIndexF(c * 9 / 5 + 32, r) });
    }
    return out;
  }

  // Total forecast rainfall (inches) in the next `hours` from NWS gridData quantitativePrecipitation (mm).
  function rainInches(values, nowMs, hours) {
    if (!values || !values.length) return null;
    var end = nowMs + hours * 3600e3, mm = 0;
    values.forEach(function (v) {
      var p = parseValidTime(v.validTime); if (!p || v.value == null) return;
      var s = p.start, e = s + p.hours * 3600e3;
      var overlap = Math.min(e, end) - Math.max(s, nowMs);
      if (overlap > 0) mm += v.value * (overlap / (e - s));
    });
    return Math.round((mm / 25.4) * 100) / 100;
  }

  // Rain-only signal: NWS rule of thumb for flash flooding in Houston-area clay soils (inferred thresholds).
  function rainLevel(inches24) {
    if (inches24 == null) return 0;
    if (inches24 >= 6) return 3;
    if (inches24 >= 3) return 2;
    if (inches24 >= 1.5) return 1;
    return 0;
  }

  // Build the personal action checklist (keys only; text lives in i18n.js).
  function buildChecklist(risk, zoneInfo) {
    var hz = {}; (risk.drivers || []).forEach(function (d) { hz[d.hazard] = Math.max(hz[d.hazard] || 0, d.level); });
    var out = ['signup_alert', 'know_zone'];
    var flood = Math.max(hz.flood || 0, hz.river || 0, hz.tropical || 0, hz.rain || 0);
    if (zoneInfo && zoneInfo.sfha) out.push('flood_insurance');
    if (flood >= 1 || (zoneInfo && zoneInfo.sfha)) out.push('go_bag', 'docs_up', 'car_high');
    if (flood >= 2) out.push('turn_around', 'charge');
    if (flood >= 3) out.push('evac_ready', 'check_neighbors');
    if (flood >= 4) out.push('leave_now');
    if ((hz.heat || 0) >= 1) out.push('water', 'cool_place');
    if ((hz.heat || 0) >= 2) out.push('check_elderly', 'no_kids_cars');
    if ((hz.storm || 0) >= 2) out.push('shelter_interior');
    if (out.length <= 2) out.push('kit_basics', 'plan_family');
    return out.filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  // Harvey replay: the gauge as it stood at `nowMs`, using only data up to then plus what the river
  // actually did over the next 48 h as a stand-in for the forecast. series = [[ms, ft], ...].
  function replayAt(series, cats, nowMs) {
    var past = series.filter(function (p) { return p[0] <= nowMs; });
    if (!past.length) past = [series[0]];
    var last = past[past.length - 1];
    var next = series.filter(function (p) { return p[0] > nowMs && p[0] <= nowMs + 48 * 3600e3; });
    var peak = next.length ? Math.max.apply(null, next.map(function (p) { return p[1]; })) : null;
    return { stage: last[1], obsTime: last[0], fstage: peak, category: riverCategory(last[1], cats),
      forecastCategory: peak != null ? riverCategory(peak, cats) : null };
  }

  var api = { replayAt: replayAt, heatIndexF: heatIndexF, heatLevel: heatLevel, heatRiskLevel: heatRiskLevel, feetToFlood: feetToFlood,
    forecastPeak: forecastPeak, riskGauges: riskGauges, kmToMi: kmToMi, ageHours: ageHours, valueAt: valueAt,
    hourlyHeatIndex: hourlyHeatIndex, CAT_ORDER: CAT_ORDER, riverCategory: riverCategory, riverLevel: riverLevel,
    alertLevel: alertLevel, alertHazard: alertHazard, overallRisk: overallRisk,
    distanceKm: distanceKm, trendFtPerHour: trendFtPerHour, floodZoneInfo: floodZoneInfo,
    parseValidTime: parseValidTime, rainInches: rainInches, rainLevel: rainLevel, buildChecklist: buildChecklist };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BeaconLogic = api;
})(this);
