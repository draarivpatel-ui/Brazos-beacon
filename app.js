/* Brazos Beacon - app controller. Pure static: every call below is a free, keyless, CORS-enabled public API. */
(function () {
  'use strict';
  var L_ = window.BeaconLogic, I = window.I18N, DEMO = window.BEACON_DEMO;
  var $ = function (id) { return document.getElementById(id); };

  var API = {
    nwpsList: function (b) { return 'https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=' + b[0] + '&bbox.ymin=' + b[1] + '&bbox.xmax=' + b[2] + '&bbox.ymax=' + b[3] + '&srid=EPSG_4326'; },
    nwpsGauge: function (lid) { return 'https://api.water.noaa.gov/nwps/v1/gauges/' + lid; },
    nwpsFlow: function (lid) { return 'https://api.water.noaa.gov/nwps/v1/gauges/' + lid + '/stageflow'; },
    alerts: function (lat, lon) { return 'https://api.weather.gov/alerts/active?point=' + lat.toFixed(4) + ',' + lon.toFixed(4); },
    points: function (lat, lon) { return 'https://api.weather.gov/points/' + lat.toFixed(4) + ',' + lon.toFixed(4); },
    fema: function (lat, lon) {
      return 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?geometry=' + lon + ',' + lat +
        '&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF' +
        '&returnGeometry=true&outSR=4326&maxAllowableOffset=0.0003&geometryPrecision=5&f=json';
    },
    femaNear: function (lat, lon) {
      var d = 0.02;
      return 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?geometry=' + (lon - d) + ',' + (lat - d) + ',' + (lon + d) + ',' + (lat + d) +
        '&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&where=SFHA_TF%3D%27T%27&outFields=FLD_ZONE,ZONE_SUBTY' +
        '&returnGeometry=true&outSR=4326&maxAllowableOffset=0.0003&geometryPrecision=5&f=json';
    },
    geocode: function (q) {
      return 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&maxLocations=1&countryCode=USA' +
        '&location=-95.70,29.60&outFields=Match_addr&SingleLine=' + encodeURIComponent(q);
    },
    nominatim: function (q) { return 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=' + encodeURIComponent(q); }
  };

  var REFRESH_MS = 15 * 60e3, STALE_H = 6, RISK_KM = 15;
  // Number of unit tests in logic.test.js (that test file fails if this goes out of date).
  var TEST_COUNT = 35;
  var DEMO_CREST = DEMO.nowMs;
  // Replay point: inside FEMA Zone AE next to the Brazos in Richmond (checked against the NFHL), so the replay shows the full escalation.
  var DEMO_LOC = { lat: 29.5862, lon: -95.7655, label: 'Richmond · Brazos floodplain' };
  var state = { lang: 'en', lat: 29.6197, lon: -95.6349, label: 'Sugar Land', demo: false, demoNow: DEMO_CREST, data: null, selected: null, runId: 0, series: {}, timer: null, playing: null };
  var map, layers = {};
  var SNAP_KEY = 'beacon.snapshot.v1', CATS_KEY = 'beacon.floodstages.v1', CATS_TTL = 7 * 864e5;

  // ---------- helpers ----------
  function t(key) { var v = I[state.lang][key]; return v == null ? I.en[key] : v; }
  function placeText(l) { return l === 'here' ? t('your_location') : l === DEMO_LOC.label ? t('demo_place') : l; }
  function evName(e) { var m = state.lang === 'es' && t('alert_names'); return (m && m[e]) || e; }
  function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, function (_, k) { return o[k] == null ? '' : o[k]; }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function getJSON(url, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 15000);
    return fetch(url, { signal: ctl ? ctl.signal : undefined, headers: { Accept: 'application/geo+json, application/json' } })
      .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); },
        function (e) { clearTimeout(timer); throw e; });
  }
  function settled(p) { return p.then(function (v) { return { ok: true, v: v }; }, function (e) { if (window.console) console.warn(e); return { ok: false, e: e }; }); }
  function locale() { return state.lang === 'es' ? 'es-US' : 'en-US'; }
  function fmtTime(ms, withYear) {
    var o = { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    if (withYear) o.year = 'numeric';
    return new Date(ms).toLocaleString(locale(), o);
  }
  function unit(u) { return u === 'ft' ? t('ft') : u; }
  function cToF(c) { return c == null ? null : Math.round(c * 9 / 5 + 32); }
  function num(v) { return (Math.round(v * 10) / 10).toLocaleString(locale()); }
  function msg(text, isErr) { var m = $('msg'); m.textContent = text || ''; m.className = 'msg' + (isErr ? ' err' : ''); }
  var CAT_COLOR = { no_flooding: 'var(--l0)', action: 'var(--l2)', minor: 'var(--l3)', moderate: 'var(--l4)', major: 'var(--l5)', unknown: 'var(--muted)' };
  var CAT_TEXT = { action: '#1d1600' };

  // ---------- data loaders ----------
  function loadWeather(lat, lon, now) {
    return getJSON(API.points(lat, lon)).then(function (p) {
      var rel = p.properties.relativeLocation && p.properties.relativeLocation.properties;
      return getJSON(p.properties.forecastGridData, 20000).then(function (g) {
        var pr = g.properties, end = now + 72 * 3600e3;
        var hi = ((pr.heatIndex && pr.heatIndex.values) || []).filter(function (v) {
          var q = L_.parseValidTime(v.validTime); return v.value != null && q && q.start + q.hours * 3600e3 > now && q.start < end;
        });
        var maxHI = null, nowHI = null;
        if (hi.length) {
          maxHI = cToF(Math.max.apply(null, hi.map(function (v) { return v.value; })));
          nowHI = cToF(hi[0].value);
        } else {
          // Fallback: compute the heat index ourselves, hour by hour, from temperature + relative humidity.
          var hourly = L_.hourlyHeatIndex(pr.temperature && pr.temperature.values, pr.relativeHumidity && pr.relativeHumidity.values, now, 72);
          if (hourly.length) { maxHI = Math.round(Math.max.apply(null, hourly.map(function (h) { return h.v; }))); nowHI = Math.round(hourly[0].v); }
        }
        var q = pr.quantitativePrecipitation && pr.quantitativePrecipitation.values;
        return { city: rel ? rel.city + ', ' + rel.state : null, maxHI: maxHI, nowHI: nowHI,
          rain24: L_.rainInches(q, now, 24), rain72: L_.rainInches(q, now, 72) };
      });
    });
  }

  function loadZone(lat, lon) {
    return getJSON(API.fema(lat, lon), 20000).then(function (r) {
      if (r.error) throw new Error('FEMA ' + (r.error.message || 'error'));
      var f = r.features && r.features[0];
      if (!f) return { info: { key: 'nodata', level: 0 }, geom: null };
      var a = f.attributes;
      return { info: L_.floodZoneInfo(a.FLD_ZONE, a.ZONE_SUBTY, a.SFHA_TF), geom: f.geometry };
    });
  }

  function loadNearbySFHA(lat, lon) {
    return getJSON(API.femaNear(lat, lon), 20000).then(function (r) { return (r.features || []).map(function (f) { return f.geometry; }); });
  }

  function seriesPts(block) {
    return ((block && block.data) || []).map(function (p) { return { t: Date.parse(p.validTime), v: p.primary }; })
      .filter(function (p) { return p.v > -900 && !isNaN(p.t); });
  }

  function loadGauges(lat, lon, now) {
    var d = 0.45, box = [lon - d, lat - d, lon + d, lat + d].map(function (x) { return x.toFixed(4); });
    return getJSON(API.nwpsList(box), 20000).then(function (r) {
      var list = (r.gauges || []).map(function (g) {
        g.km = L_.distanceKm(lat, lon, g.latitude, g.longitude); return g;
      }).sort(function (a, b) { return a.km - b.km; }).slice(0, 4);
      var cache = catsCacheLoad();
      return Promise.all(list.map(function (g) {
        // Rate-limit friendly (NWPS allows ~10 calls / 5 min): gauges that can change the level (within RISK_KM)
        // always get fresh metadata; farther listed gauges reuse flood stages cached for 7 days, else fetch them once.
        var hit = cache[g.lid], cached = g.km > RISK_KM && hit && now - hit.at >= 0 && now - hit.at < CATS_TTL;
        var full = cached ? Promise.resolve(Object.assign(g, { flood: { categories: hit.cats }, catsLoaded: true }))
          : getJSON(API.nwpsGauge(g.lid)).then(function (m) { m.catsLoaded = true; return m; }, function () { g.metaFailed = true; return g; });
        var flow = getJSON(API.nwpsFlow(g.lid), 20000).then(function (s) {
          return { obs: seriesPts(s.observed).filter(function (p) { return p.t >= now - 7 * 864e5; }), fc: seriesPts(s.forecast) };
        }, function () { return null; });
        return Promise.all([full, flow]).then(function (x) {
          // The gauge list's live status is at least as fresh as the metadata's; keep it when the metadata lacks one.
          if (!(x[0].status && x[0].status.observed) && g.status) x[0].status = g.status;
          x[0].km = g.km; x[0].series = x[1]; return x[0];
        });
      }));
    }).then(function (gs) {
      var cache = catsCacheLoad();
      var out = gs.map(function (g) {
        var cats = g.flood && g.flood.categories;
        var obs = g.status && g.status.observed, fc = g.status && g.status.forecast;
        var stage = obs && obs.primary > -900 ? obs.primary : null;
        if (g.catsLoaded) cache[g.lid] = { cats: cats || null, at: now };
        // Metadata not loaded (e.g. NWPS 429): the badge falls back to the flood category the gauge list already reports.
        var fs = L_.gaugeFloodStatus(stage, cats, !!g.catsLoaded, obs && obs.floodCategory);
        var hasCats = fs.ft != null || !!(cats && cats.minor && cats.minor.stage > -900);
        // Forecast: use the CREST of the official forecast series, not just its next point.
        var peak = g.series ? L_.forecastPeak(g.series.fc, now) : null;
        var fstage = peak ? peak.v : (fc && fc.primary > -900 ? fc.primary : null);
        if (g.series) state.series[g.lid] = g.series;
        return {
          lid: g.lid, name: g.name, lat: g.latitude, lon: g.longitude, km: g.km, unit: (obs && obs.primaryUnit) || 'ft',
          stage: stage, fstage: fstage, fTime: peak ? peak.t : null, obsTime: obs && obs.validTime ? Date.parse(obs.validTime) : null,
          cats: hasCats ? cats : null, fsNote: fs.note, ft: fs.ft,
          category: fs.category, metaFailed: !!g.metaFailed,
          forecastCategory: hasCats && fstage != null ? L_.riverCategory(fstage, cats) : null
        };
      });
      catsCacheSave(cache);
      return out;
    });
  }
  function catsCacheLoad() { try { return JSON.parse(localStorage.getItem(CATS_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function catsCacheSave(c) { try { localStorage.setItem(CATS_KEY, JSON.stringify(c)); } catch (e) { /* private mode: just refetch next time */ } }

  // ---------- Harvey replay ----------
  function demoGauges(lat, lon) {
    var g = DEMO.gauge, r = L_.replayAt(g.series, g.categories, state.demoNow);
    return [{
      lid: g.lid, name: g.name, lat: g.latitude, lon: g.longitude, km: L_.distanceKm(lat, lon, g.latitude, g.longitude), unit: 'ft',
      stage: r.stage, fstage: r.fstage, obsTime: r.obsTime, cats: g.categories, category: r.category, forecastCategory: r.forecastCategory, demo: true
    }];
  }
  function demoAlerts(gauge) {
    var lv = Math.max(L_.riverLevel(gauge.category), L_.riverLevel(gauge.forecastCategory || 'no_flooding'));
    if (lv < 2) return [];
    var a = JSON.parse(JSON.stringify(DEMO.alerts[0]));
    a.description = fmt(DEMO.alertTemplate, { time: fmtTime(gauge.obsTime), stage: gauge.stage,
      what: gauge.category === 'major' ? 'Major flooding is occurring.' : gauge.category === 'moderate' || gauge.category === 'minor' ? 'Flooding is occurring.' : 'The river is forecast to reach flood stage.' });
    return [a];
  }
  // Lead time: run every replay moment through the same level pipeline the page uses (gauge -> zone adjustment -> demo alert -> overall level).
  function demoLevelFn(zoneInfo) {
    var g = DEMO.gauge;
    return function (cat, fcat) {
      var gauge = { name: g.name, km: L_.distanceKm(state.lat, state.lon, g.latitude, g.longitude), category: cat, forecastCategory: fcat };
      return L_.overallRisk({ alerts: demoAlerts(gauge), gauges: L_.riskGauges([gauge], zoneInfo, RISK_KM) }).level;
    };
  }
  function renderLead() {
    var box = $('lead'); if (!box) return;
    var d = state.data;
    if (!state.demo || !d) { box.innerHTML = ''; return; }
    var g = DEMO.gauge, r = L_.replayLeadTimes(g.series, g.categories, demoLevelFn(d.zone && d.zone.info));
    var o = r.observed[4], f = r.outlook[4];
    if (!o) { box.innerHTML = ''; return; }
    var days = function (h) { return num(h / 24); };
    box.innerHTML = '<p class="lead-head">' + esc(fmt(t('lead_head'), { h: o.hours, d: days(o.hours) })) + '</p>' +
      '<p>' + esc(fmt(t('lead_obs'), { t: fmtTime(o.at, true), major: num(g.categories.major.stage), crest: r.crestFt.toLocaleString(locale()), c: fmtTime(r.crestMs, true) })) + '</p>' +
      (f ? '<p class="lead-out">' + esc(fmt(t('lead_out'), { h2: f.hours, d2: days(f.hours) })) + '</p>' : '') +
      '<p class="lead-note">' + esc(t('lead_note')) + '</p>' +
      '<button type="button" id="leadBtn">' + esc(t('lead_jump')) + '</button>';
    $('leadBtn').addEventListener('click', function () { stopPlay(); state.demoNow = o.at; $('replay').value = o.at; recomputeDemo(); });
  }
  function recomputeDemo() {
    var d = state.data; if (!d || !state.demo) return;
    d.gauges = demoGauges(state.lat, state.lon); d.alerts = demoAlerts(d.gauges[0]); d.now = state.demoNow;
    d.risk = L_.overallRisk({ alerts: d.alerts, gauges: L_.riskGauges(d.gauges, d.zone.info, RISK_KM) });
    render(); selectGauge(state.selected || d.gauges[0].lid);
    var rt = fmtTime(state.demoNow, true) + ' CDT · ' + num(d.gauges[0].stage) + ' ' + t('ft');
    $('replayTime').textContent = rt; $('replay').setAttribute('aria-valuetext', rt);
    if (!$('lead').innerHTML) renderLead();
  }

  // ---------- offline snapshot (last good result for this spot, kept only in this browser) ----------
  function saveSnapshot(d, lat, lon) {
    try {
      var copy = JSON.parse(JSON.stringify(d)); delete copy.offlineAt; delete copy.offlineAge;
      var s = JSON.stringify({ lat: lat, lon: lon, label: state.label, savedAt: d.fetched, data: copy });
      if (s.length > 1.5e6) { copy.near = []; s = JSON.stringify({ lat: lat, lon: lon, label: state.label, savedAt: d.fetched, data: copy }); }
      localStorage.setItem(SNAP_KEY, s);
    } catch (e) { /* private mode or storage full: live data still works */ }
  }
  function loadSnapshot() { try { return JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); } catch (e) { return null; } }

  // ---------- main run ----------
  function run(lat, lon, label) {
    var id = ++state.runId;
    $('lead').innerHTML = '';
    state.lat = lat; state.lon = lon; state.label = label || state.label;
    updateURL();
    msg(t('loading'));
    $('main').setAttribute('aria-busy', 'true');
    setMap(lat, lon);
    $('placeName').textContent = placeText(state.label);
    if (!state.data) $('lvlDesc').textContent = t('loading_desc');
    if (!state.data) ['zone', 'wx', 'rivers', 'alerts'].forEach(function (k) { $(k).innerHTML = '<p class="skel">' + esc(t('loading')) + '</p>'; });

    var now = state.demo ? state.demoNow : Date.now();
    var zoneP = settled(loadZone(lat, lon)), nearP = settled(loadNearbySFHA(lat, lon));
    var jobs = state.demo
      ? [zoneP, settled(Promise.resolve(null)), settled(Promise.resolve([])), settled(Promise.resolve(null)), nearP]
      : [zoneP, settled(loadGauges(lat, lon, now)), settled(getJSON(API.alerts(lat, lon)).then(function (r) {
          return (r.features || []).map(function (f) { return f.properties; }).filter(function (p) { return p.status !== 'Test' && p.messageType !== 'Cancel'; });
        })), settled(loadWeather(lat, lon, now)), nearP];

    return Promise.all(jobs).then(function (res) {
      if (id !== state.runId) return;
      $('main').removeAttribute('aria-busy');
      var d = {
        zone: res[0].ok ? res[0].v : { info: L_.floodZoneInfo(null), geom: null },
        gauges: res[1].ok ? res[1].v : null, alerts: res[2].ok ? res[2].v : null, wx: res[3].ok ? res[3].v : null,
        near: res[4].ok ? res[4].v : [], fetched: Date.now(), now: now
      };
      if (!state.demo && d.wx && d.wx.city && (!label || label === 'here' || /^-?\d+\.\d+, -?\d+\.\d+$/.test(label))) {
        state.label = d.wx.city; $('placeName').textContent = state.label; updateURL();
      }
      if (!state.demo) {
        if (!(d.alerts || d.gauges || d.wx)) {
          var snap = loadSnapshot(), use = L_.snapshotUsable(snap, lat, lon, Date.now());
          if (use.ok) { d = snap.data; d.offlineAt = snap.savedAt; d.offlineAge = use.ageH; }
        }
      }
      state.data = d;
      if (state.demo) {
        recomputeDemo();
      } else {
        var missing = [];
        if (d.offlineAt) { render(); if (state.selected) selectGauge(state.selected); msg(fmt(t('offline_snap_msg'), { time: fmtTime(d.offlineAt) }), true); return; }
        if (!d.alerts) missing.push('alerts'); if (!d.gauges || d.gauges.some(function (g) { return g.metaFailed && g.km <= RISK_KM; })) missing.push('rivers'); if (!d.wx) missing.push('weather');
        d.risk = L_.overallRisk({ alerts: d.alerts || [], gauges: L_.riskGauges(d.gauges || [], d.zone.info, RISK_KM),
          maxHeatIndex: d.wx ? d.wx.maxHI : null, rain24: d.wx ? d.wx.rain24 : null, missing: missing });
        var keep = d.gauges && d.gauges.some(function (g) { return g.lid === state.selected; });
        if (!keep) state.selected = d.gauges && d.gauges.length ? (d.gauges.filter(function (g) { return g.cats; })[0] || d.gauges[0]).lid : null;
        render();
        if (state.selected) selectGauge(state.selected); else $('chartWrap').hidden = true;
        saveSnapshot(d, lat, lon);
      }
      var errs = res.filter(function (r) { return !r.ok; }).length;
      msg(!inArea(lat, lon) ? t('outside') : errs === res.length ? t('offline') : '', errs === res.length);
    });
  }

  function inArea(lat, lon) { return lat > 28.8 && lat < 30.6 && lon > -96.8 && lon < -94.6; }

  // ---------- rendering ----------
  function render() {
    var d = state.data; if (!d) return;
    var risk = d.risk, lv = risk.level, unsure = risk.incomplete && lv === 0;
    $('hero').className = 'hero ' + (unsure ? 'lvl-u' : 'lvl-' + lv);
    $('lvlNum').textContent = unsure ? '?' : lv;
    $('lvlName').textContent = unsure ? t('incomplete_name') : t('level_names')[lv];
    var srcNames = t('src_names');
    var missingTxt = risk.missing.map(function (m) { return srcNames[m] || m; }).join(', ');
    $('lvlDesc').textContent = unsure ? fmt(t('incomplete_desc'), { list: missingTxt })
      : t('level_desc')[lv] + (risk.incomplete ? ' ' + fmt(t('incomplete_note'), { list: missingTxt }) : '');
    $('lvlLabel').textContent = t('level_word');
    $('placeName').textContent = placeText(state.label);
    var on = $('offlineNote'); on.hidden = !d.offlineAt;
    if (d.offlineAt) on.textContent = fmt(t('offline_snap'), { time: fmtTime(d.offlineAt), age: d.offlineAge < 1 ? t('age_lt1') : fmt(t('age_h'), { n: num(d.offlineAge) }) });
    var hz = t('hz'), catNames = t('cat');
    $('drivers').innerHTML = risk.drivers.length ? risk.drivers.slice(0, 4).map(function (x) {
      var extra = x.hazard === 'heat' ? ' ' + x.label + '°F' : x.hazard === 'rain' ? ' ' + num(x.label) + ' in' : x.label ? ': ' + (x.source === 'alert' ? evName(x.label) : x.label) : '';
      if (x.hazard === 'river') {
        var gg = (d.gauges || []).filter(function (g) { return g.name === x.label; })[0];
        if (gg) extra += ' (' + (catNames[x.rising ? gg.forecastCategory : gg.category] || '') + (x.rising ? ', ' + t('fcst_short') : '') + ')';
      }
      return '<li>' + esc(hz[x.hazard] || x.hazard) + esc(extra) + (x.rising ? ' <span aria-hidden="true">↑</span>' : '') + '</li>';
    }).join('') : (unsure ? '' : '<li>' + esc(t('nothing_driving')) + '</li>');

    // Zone
    var zi = d.zone.info, zt = t('zone')[zi.key] || t('zone').unknown;
    $('zone').innerHTML = '<p class="big">' + esc(zt[0].replace('{z}', zi.zone || '')) + '</p>' +
      (zi.zone ? '<span class="badge b' + zi.level + '">' + esc(zi.sfha ? t('sfha_yes') : t('sfha_no')) + '</span>' : '') +
      '<p>' + esc(zt[1]) + '</p><p class="fine">' + esc(t('zone_fine')) + ' <a href="https://msc.fema.gov/portal/search?AddressQuery=' +
      encodeURIComponent(state.lat.toFixed(5) + ',' + state.lon.toFixed(5)) + '" target="_blank" rel="noopener">msc.fema.gov</a></p>';

    // Weather
    if (state.demo) {
      $('wx').innerHTML = '<p class="empty">' + esc(t('demo_wx')) + '</p>';
    } else if (!d.wx) {
      $('wx').innerHTML = '<p class="empty">' + esc(fmt(t('err_src'), { src: 'NWS' })) + '</p>';
    } else {
      var w = d.wx;
      $('wx').innerHTML = [
        [w.nowHI != null ? w.nowHI + '°F' : '–', t('hi_now'), w.nowHI != null && L_.heatRiskLevel(w.nowHI) > 0],
        [w.maxHI != null ? w.maxHI + '°F' : '–', t('max_hi'), w.maxHI != null && L_.heatRiskLevel(w.maxHI) > 0],
        [w.rain24 != null ? num(w.rain24) + ' in' : '–', t('rain_24'), L_.rainLevel(w.rain24) > 0],
        [w.rain72 != null ? num(w.rain72) + ' in' : '–', t('rain_72'), false]
      ].map(function (s) { return '<div class="stat' + (s[2] ? ' hot' : '') + '"><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>'; }).join('');
    }

    // Rivers
    var refNow = state.demo ? state.demoNow : Date.now();
    if (!d.gauges) { $('rivers').innerHTML = '<p class="empty">' + esc(fmt(t('err_src'), { src: 'NOAA NWPS' })) + '</p>'; }
    else if (!d.gauges.length) { $('rivers').innerHTML = '<p class="empty">' + esc(t('no_gauges')) + '</p>'; }
    else {
      var cat = t('cat');
      $('rivers').innerHTML = d.gauges.map(function (g) {
        var col = CAT_COLOR[g.category] || CAT_COLOR.unknown, txt = CAT_TEXT[g.category] || '#fff';
        var ft = g.cats ? L_.feetToFlood(g.stage, g.cats) : null;
        var note = g.demo ? null : g.fsNote !== undefined ? g.fsNote : ft == null && g.stage != null ? 'no_fs' : null; // older snapshots lack fsNote
        var age = L_.ageHours(g.obsTime, refNow), stale = !g.demo && (age == null || age > STALE_H);
        var lines = [];
        lines.push(esc(t('stage')) + ': <b>' + (g.stage != null ? num(g.stage) + ' ' + esc(unit(g.unit)) : '–') + '</b>' +
          (ft != null ? ' · ' + esc(ft > 0 ? fmt(t('below_fs'), { ft: num(ft), fs: g.cats.minor.stage }) : fmt(t('above_fs'), { ft: num(-ft), fs: g.cats.minor.stage }))
            : note === 'not_loaded' ? ' · ' + esc(t('fs_not_loaded')) : note === 'no_fs' ? ' · ' + esc(t('no_fs')) : ''));
        if (g.fstage != null) lines.push(esc(t(g.demo ? 'next48' : 'fcst_crest')) + ': ' + num(g.fstage) + ' ' + esc(unit(g.unit)) +
          (cat[g.forecastCategory] ? ' (' + esc(cat[g.forecastCategory]) + ')' : '') + (g.fTime ? ' · ' + esc(fmtTime(g.fTime)) : ''));
        if (g.obsTime) lines.push(esc(t('observed')) + ' ' + esc(fmtTime(g.obsTime)) + (stale ? ' · <span class="stale">' + esc(t('stale')) + '</span>' : ''));
        return '<button type="button" class="gauge" data-lid="' + esc(g.lid) + '" aria-pressed="' + (g.lid === state.selected) + '">' +
          '<span class="nm">' + esc(g.name) + '</span>' +
          '<span class="badge" style="background:' + col + ';color:' + txt + '">' + esc(cat[g.category] || g.category) + '</span>' +
          '<span class="meta wide">' + esc(fmt(t('away'), { mi: num(L_.kmToMi(g.km)) })) + (g.km > RISK_KM ? ' · ' + esc(t('too_far')) : '') + '</span>' +
          lines.map(function (l) { return '<span class="meta wide">' + l + '</span>'; }).join('') + '</button>';
      }).join('');
      Array.prototype.forEach.call(document.querySelectorAll('.gauge'), function (b) {
        b.addEventListener('click', function () { selectGauge(b.getAttribute('data-lid')); });
      });
    }

    // Alerts
    if (!d.alerts) { $('alerts').innerHTML = '<p class="empty">' + esc(fmt(t('err_src'), { src: 'NWS' })) + '</p>'; }
    else if (!d.alerts.length) { $('alerts').innerHTML = '<p class="empty ok">' + esc(t('no_alerts')) + '</p>'; }
    else {
      $('alerts').innerHTML = (state.lang === 'es' ? '<p class="fine">' + esc(t('alerts_en')) + '</p>' : '') + d.alerts.map(function (a) {
        var lvA = L_.alertLevel(a);
        return '<div class="alert a' + lvA + '"><b>' + esc(evName(a.event)) + (evName(a.event) !== a.event ? ' <span lang="en">(' + esc(a.event) + ')</span>' : '') + '</b><small>' + esc(a.headline || a.areaDesc || '') + '</small>' +
          (a.ends || a.expires ? '<small>' + esc(t('until')) + ' ' + esc(fmtTime(Date.parse(a.ends || a.expires))) + '</small>' : '') +
          '<details><summary>' + esc(t('details')) + '</summary><p>' + esc(a.description || '') + '</p>' + (a.instruction ? '<p><b>' + esc(a.instruction) + '</b></p>' : '') + '</details></div>';
      }).join('');
    }

    // Actions
    var acts = t('actions');
    $('actions').innerHTML = L_.buildChecklist(risk, zi).map(function (k) { return '<li>' + (acts[k] || esc(k)) + '</li>'; }).join('');

    // Help
    $('help').innerHTML = t('help').map(function (h) { return '<li><a href="' + esc(h[1]) + '" target="_blank" rel="noopener">' + esc(h[0]) + '</a></li>'; }).join('');
    $('stamp').textContent = state.demo ? t('demo_stamp') : t('updated') + ': ' + fmtTime(d.fetched) + ' CT · ' + t('auto_refresh');

    drawMapLayers();
  }

  function selectGauge(lid) {
    state.selected = lid;
    Array.prototype.forEach.call(document.querySelectorAll('.gauge'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lid') === lid)); });
    var g = ((state.data && state.data.gauges) || []).filter(function (x) { return x.lid === lid; })[0];
    if (!g) return;
    $('chartWrap').hidden = false;
    $('chartTitle').textContent = g.name + ' · ' + t(g.demo ? 'chart_demo' : 'chart_title');
    $('gaugeLink').href = 'https://water.noaa.gov/gauges/' + encodeURIComponent(g.lid);
    $('gaugeLink').textContent = t('gauge_link');
    if (g.demo) {
      var s = DEMO.gauge.series.map(function (p) { return { t: p[0], v: p[1] }; });
      drawChart({ obs: s.filter(function (p) { return p.t <= state.demoNow; }), fc: s.filter(function (p) { return p.t >= state.demoNow; }) }, g, state.demoNow);
      return;
    }
    var series = state.series[lid];
    if (series) drawChart(series, g, Date.now());
    else { $('chart').innerHTML = '<text x="20" y="110" fill="#5a6b76">' + esc(fmt(t('err_src'), { src: 'NOAA' })) + '</text>'; $('chart').setAttribute('aria-label', fmt(t('err_src'), { src: 'NOAA' })); }
  }

  function drawChart(series, g, now) {
    var cats = g.cats, svg = $('chart'), W = Math.max(320, Math.round(svg.clientWidth || svg.parentNode.clientWidth || 640)), H = W < 500 ? 220 : 260, P = { l: 40, r: 12, t: 22, b: 26 };
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var all = series.obs.concat(series.fc);
    if (!all.length) { svg.innerHTML = '<text x="20" y="110" fill="#5a6b76">' + esc(t('no_series')) + '</text>'; svg.setAttribute('aria-label', t('no_series')); return; }
    var t0 = Math.min.apply(null, all.map(function (p) { return p.t; })), t1 = Math.max.apply(null, all.map(function (p) { return p.t; }));
    var vals = all.map(function (p) { return p.v; });
    var lines = [];
    if (cats) ['action', 'minor', 'moderate', 'major'].forEach(function (k) { if (cats[k] && cats[k].stage > -900) lines.push([k, cats[k].stage]); });
    var vmax = Math.max.apply(null, vals), vmin = Math.min.apply(null, vals);
    // Always show the minor flood line when it is within reach so the gap to flooding is visible.
    if (cats && cats.minor && cats.minor.stage > -900 && cats.minor.stage - vmax < Math.max(15, (vmax - vmin) * 3)) vmax = Math.max(vmax, cats.minor.stage);
    // "Nice" axis: steps of 1, 2, 5, 10, 20 ft so labels read cleanly.
    var span = Math.max(4, vmax - vmin), stepY = [1, 2, 5, 10, 20, 50].filter(function (s) { return span / s <= 6; })[0] || 50;
    vmin = Math.floor((vmin - stepY * 0.3) / stepY) * stepY; if (vmin < 0 && Math.min.apply(null, vals) >= 0) vmin = 0;
    vmax = Math.ceil((vmax + stepY * 0.3) / stepY) * stepY;
    function X(tm) { return P.l + (tm - t0) / Math.max(1, t1 - t0) * (W - P.l - P.r); }
    function Y(v) { return H - P.b - (v - vmin) / Math.max(1, vmax - vmin) * (H - P.t - P.b); }
    function path(pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p.v).toFixed(1); }).join(''); }
    var out = [];
    var catCol = { action: '#8a6a00', minor: '#b4500f', moderate: '#b3122e', major: '#6b0018' };
    for (var v = vmin; v <= vmax + 1e-9; v += stepY) {
      out.push('<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="#e6ecef"/>');
      out.push('<text x="' + (P.l - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#5a6b76">' + v.toFixed(0) + '</text>');
    }
    // Draw every flood-category line, then label them in priority order (flood stage first), on the left
    // if there is room, else on the right, else not at all, so labels never overlap.
    var placed = { start: [], end: [] };
    lines.forEach(function (l) {
      if (l[1] < vmin || l[1] > vmax) return;
      out.push('<line x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + Y(l[1]).toFixed(1) + '" y2="' + Y(l[1]).toFixed(1) + '" stroke="' + catCol[l[0]] + '" stroke-dasharray="2 4" stroke-width="1.5"/>');
    });
    ['minor', 'major', 'action', 'moderate'].forEach(function (k) {
      var l = lines.filter(function (x) { return x[0] === k; })[0];
      if (!l || l[1] < vmin || l[1] > vmax) return;
      var y = Y(l[1]), txt = t('cat')[k] + ' ' + l[1] + ' ' + t('ft'), wEst = txt.length * 6.2;
      // Try above the line on the left, then on the right, then just below the line (left, right).
      var room = W - P.l - P.r - 12, pick = null;
      // On phones the flood-stage label goes under its line, leaving room above for the major-flood label.
      var cands = [['start', y - 3], ['end', y - 3], ['start', y + 12], ['end', y + 12]];
      if (W < 500 && k === 'minor') cands.unshift(['start', y + 12]);
      cands.some(function (c) {
        var ok = c[1] > P.t && c[1] < H - P.b - 2 && placed.start.concat(placed.end).every(function (p) {
          return Math.abs(p.ty - c[1]) >= 13 || (p.side !== c[0] && p.w + wEst + 24 <= room);
        });
        if (ok) pick = c; return ok;
      });
      if (!pick) return;
      var side = pick[0];
      placed[side].push({ ty: pick[1], w: wEst, side: side });
      out.push('<text x="' + (side === 'start' ? P.l + 6 : W - P.r - 6) + '" y="' + pick[1].toFixed(1) + '" text-anchor="' + side + '" font-size="11" fill="' + catCol[k] + '" paint-order="stroke" stroke="#fbfcfd" stroke-width="3">' + esc(txt) + '</text>');
    });
    var days = Math.max(1, Math.round((t1 - t0) / 864e5)), step = Math.max(1, Math.ceil(days / (W < 500 ? 4 : 7)));
    // Day ticks at 06:00 UTC = midnight CST / 1 am CDT, so the Central-time date label is right all year.
    var first = Math.ceil((t0 - 6 * 36e5) / 864e5) * 864e5 + 6 * 36e5;
    for (var tm = first; tm <= t1; tm += step * 864e5) {
      if (X(tm) > W - 24 || X(tm) < P.l + 10) continue;
      out.push('<line x1="' + X(tm).toFixed(1) + '" x2="' + X(tm).toFixed(1) + '" y1="' + (H - P.b) + '" y2="' + (H - P.b + 4) + '" stroke="#9aa9b2"/>');
      out.push('<text x="' + X(tm).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#5a6b76">' +
        esc(new Date(tm).toLocaleDateString(locale(), { month: 'short', day: 'numeric', timeZone: 'America/Chicago' })) + '</text>');
    }
    if (now >= t0 && now <= t1) out.push('<line x1="' + X(now).toFixed(1) + '" x2="' + X(now).toFixed(1) + '" y1="' + P.t + '" y2="' + (H - P.b) + '" stroke="#0b2a3c" stroke-width="1"/><text x="' + (X(now) + (X(now) > W - 60 ? -4 : 4)).toFixed(1) + '" y="' + (H - P.b - 6) + '" font-size="11" text-anchor="' + (X(now) > W - 60 ? 'end' : 'start') + '" fill="#0b2a3c">' + esc(t('now')) + '</text>');
    if (series.obs.length) out.push('<path d="' + path(series.obs) + '" fill="none" stroke="#0e7c86" stroke-width="2.5" stroke-linejoin="round"/>');
    if (series.fc.length) out.push('<path d="' + path(series.fc) + '" fill="none" stroke="#0e7c86" stroke-width="2.5" stroke-dasharray="6 5"/>');
    var peak = all.reduce(function (a, b) { return b.v > a.v ? b : a; });
    var px = X(peak.t), right = px > W - 110;
    out.push('<circle cx="' + px.toFixed(1) + '" cy="' + Y(peak.v).toFixed(1) + '" r="4" fill="#0b2a3c"/><text x="' + (right ? px - 8 : px + 8).toFixed(1) + '" y="' + Math.max(Y(peak.v) - 7, 14).toFixed(1) + '" text-anchor="' + (right ? 'end' : 'start') + '" font-size="12" font-weight="700" fill="#0b2a3c" paint-order="stroke" stroke="#fbfcfd" stroke-width="4">' + esc(t('peak')) + ' ' + num(peak.v) + ' ' + esc(t('ft')) + '</text>');
    svg.innerHTML = out.join('');
    var last = series.obs.length ? series.obs[series.obs.length - 1].v : null;
    svg.setAttribute('aria-label', fmt(t('chart_aria'), { name: g.name, now: last != null ? num(last) : '–', peak: num(peak.v),
      fs: cats && cats.minor ? cats.minor.stage : '–' }));
  }

  // ---------- map ----------
  function initMap() {
    if (!window.L) { $('map').innerHTML = '<p class="empty pad">' + esc(t('map_off')) + '</p>'; return; }
    map = L.map('map', { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([state.lat, state.lon], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors · Flood zones: FEMA NFHL' }).addTo(map);
    layers.group = L.layerGroup().addTo(map);
    map.on('click', function (e) { run(e.latlng.lat, e.latlng.lng, e.latlng.lat.toFixed(4) + ', ' + e.latlng.lng.toFixed(4)); });
  }
  function setMap(lat, lon) { if (map) map.setView([lat, lon], 12); }
  function ringsToLatLngs(geom) { return (geom && geom.rings || []).map(function (r) { return r.map(function (p) { return [p[1], p[0]]; }); }); }
  function drawMapLayers() {
    if (!map) return;
    map.invalidateSize();
    var d = state.data; layers.group.clearLayers();
    (d.near || []).forEach(function (g) { L.polygon(ringsToLatLngs(g), { color: '#3d6ea8', weight: 1, fillOpacity: 0.18, interactive: false }).addTo(layers.group); });
    if (d.zone.geom) L.polygon(ringsToLatLngs(d.zone.geom), { color: d.zone.info.sfha ? '#b4500f' : '#1f8a4c', weight: 2, fillOpacity: 0.25, interactive: false }).addTo(layers.group);
    L.circleMarker([state.lat, state.lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#0b2a3c', fillOpacity: 1 }).addTo(layers.group).bindTooltip(esc(placeText(state.label)));
    (d.gauges || []).forEach(function (g) {
      L.circleMarker([g.lat, g.lon], { radius: 7, color: '#fff', weight: 2, fillColor: { no_flooding: '#1f8a4c', action: '#c99a06', minor: '#b4500f', moderate: '#b3122e', major: '#6b0018' }[g.category] || '#7a8a94', fillOpacity: 1 })
        .addTo(layers.group).bindTooltip(esc(g.name) + ': ' + (g.stage != null ? num(g.stage) + ' ft' : '–'))
        .on('click', function (e) { L.DomEvent.stopPropagation(e); selectGauge(g.lid); });
    });
  }


  // ---------- printable family flood plan ----------
  var PLAN_KEY = 'brazosBeaconPlan';
  function planLoad() { try { return JSON.parse(localStorage.getItem(PLAN_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function planSave() {
    var o = {}; Array.prototype.forEach.call($('planForm').elements, function (el) { if (el.name) o[el.name] = el.value.slice(0, 300); });
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(o)); } catch (e) { /* private mode: plan still prints */ }
    return o;
  }
  function planQR(url) {
    try {
      if (!window.qrcode) return '';
      var q = window.qrcode(0, 'M'); q.addData(url); q.make();
      return q.createSvgTag({ cellSize: 3, margin: 2, scalable: true, alt: t('ps_live') });
    } catch (e) { return ''; }
  }
  function buildPlanSheet(f) {
    var d = state.data || {}, zi = (d.zone && d.zone.info) || L_.floodZoneInfo(null), zt = t('zone')[zi.key] || t('zone').unknown;
    var p = L_.familyPlan(zi, d.gauges, RISK_KM), risk = d.risk, lv = risk ? risk.level : null, unsure = risk && risk.incomplete && lv === 0;
    var place = placeText(state.label);
    var url = location.href;
    var row = function (k, v) { return '<div class="ps-field"><b>' + esc(t(k)) + '</b><span>' + (v ? esc(v).replace(/\n/g, '<br>') : '&nbsp;') + '</span></div>'; };
    var river = p.gauge
      ? '<p><b>' + esc(fmt(t('ps_river_line'), { name: p.gauge.name, mi: num(L_.kmToMi(p.gauge.km)), fs: num(p.gauge.flood) })) + '</b><br>' +
        esc(fmt(t('ps_stages'), { a: p.gauge.action != null ? num(p.gauge.action) : '–', m: p.gauge.moderate != null ? num(p.gauge.moderate) : '–', j: p.gauge.major != null ? num(p.gauge.major) : '–' })) +
        '<br>water.noaa.gov/gauges/' + esc(p.gauge.lid) + '</p>'
      : '<p>' + esc(t('ps_river_none')) + '</p>';
    var lvTxt = !risk ? '–' : unsure ? t('incomplete_name') : lv + ' · ' + t('level_names')[lv];
    $('planSheet').innerHTML =
      '<header class="ps-head"><div><p class="ps-brand">◉ Brazos Beacon</p><h1>' + esc(t('ps_title')) + '</h1>' +
        '<p>' + esc(t('ps_for')) + ': <b>' + esc(place) + '</b> (' + state.lat.toFixed(4) + ', ' + state.lon.toFixed(4) + ')<br>' +
        esc(t('ps_printed')) + ': ' + esc(fmtTime(Date.now(), true)) + ' CT</p></div>' +
        '<div class="ps-qr">' + planQR(url) + '<small>' + esc(t('ps_live')) + '</small></div></header>' +
      '<section class="ps-row"><div class="ps-box"><h2>' + esc(t('ps_zone')) + '</h2><p><b>' + esc(zt[0].replace('{z}', zi.zone || '')) + '</b></p><p>' + esc(zt[1]) + '</p>' +
        p.extras.map(function (k) { return '<p class="ps-warn">' + esc(t('ps_extra')[k]) + '</p>'; }).join('') + '</div>' +
      '<div class="ps-box"><h2>' + esc(t('ps_level')) + '</h2><p class="ps-lvl">' + esc(lvTxt) + '</p><p class="ps-small">' + esc(t('ps_level_note')) + '</p>' +
        '<h2>' + esc(t('ps_river')) + '</h2>' + river + '</div></section>' +
      '<section class="ps-box"><h2>' + esc(t('ps_family')) + '</h2><div class="ps-fields">' +
        row('pf_people', f.people) + row('pf_contact', f.contact) + row('pf_meet_near', f.meetNear) + row('pf_meet_far', f.meetFar) +
        row('pf_evac', f.evac) + row('pf_needs', f.needs) + row('pf_pets', f.pets) + '</div></section>' +
      '<section class="ps-row"><div class="ps-box"><h2>' + esc(t('ps_when')) + '</h2><ul class="ps-steps">' +
        t('ps_steps').map(function (x) { return '<li><b>' + esc(x[0]) + ':</b> ' + esc(x[1]) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="ps-box"><h2>' + esc(t('ps_numbers')) + '</h2><table class="ps-table ps-nums">' +
        t('ps_num_items').map(function (x) { return '<tr><th scope="row">' + esc(x[0]) + '</th><td><b>' + esc(x[1]) + '</b></td></tr>'; }).join('') + '</table></div></section>' +
      '<section class="ps-box"><h2>' + esc(t('ps_bag')) + '</h2><ul class="ps-check">' +
        t('ps_bag_items').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></section>' +
      '<p class="ps-small ps-url">' + esc(t('ps_live')) + ': ' + esc(url) + '</p>' +
      '<footer class="ps-foot">' + esc(t('ps_foot')) + '</footer>';
  }
  // The QR library is only needed for the printed plan, so it loads when the plan dialog opens, not on first paint.
  var qrLoading = null;
  function loadQR() {
    if (window.qrcode) return Promise.resolve();
    if (!qrLoading) qrLoading = new Promise(function (res) {
      var sc = document.createElement('script'); sc.src = 'vendor/qrcode.js';
      sc.onload = sc.onerror = function () { res(); }; document.head.appendChild(sc);
    });
    return qrLoading;
  }
  function setupPlan() {
    var dlg = $('planDlg'), form = $('planForm'), saved = planLoad();
    Array.prototype.forEach.call(form.elements, function (el) { if (el.name && saved[el.name]) el.value = saved[el.name]; });
    form.addEventListener('input', planSave);
    $('planBtn').addEventListener('click', function () {
      loadQR();
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      var first = form.querySelector('textarea, input'); if (first) first.focus();
    });
    $('planClear').addEventListener('click', function () {
      Array.prototype.forEach.call(form.elements, function (el) { if (el.name) el.value = ''; });
      try { localStorage.removeItem(PLAN_KEY); } catch (e) { }
    });
    $('planPrint').addEventListener('click', function () {
      var answers = planSave();
      if (dlg.open && dlg.close) dlg.close();
      loadQR().then(function () {
        buildPlanSheet(answers);
        document.body.classList.add('print-plan');
        setTimeout(function () { window.print(); }, 50);
      });
    });
    window.addEventListener('afterprint', function () { document.body.classList.remove('print-plan'); });
  }

  // ---------- inputs ----------
  function geocode(q) {
    return getJSON(API.geocode(q)).then(function (r) {
      var c = r.candidates && r.candidates[0];
      if (c && c.score >= 80) return { lat: c.location.y, lon: c.location.x, label: c.address };
      throw new Error('no match');
    }).catch(function () {
      return getJSON(API.nominatim(q)).then(function (r) {
        if (!r.length) throw new Error('no match');
        return { lat: +r[0].lat, lon: +r[0].lon, label: r[0].display_name.split(',').slice(0, 3).join(',') };
      });
    });
  }

  function updateURL() {
    try {
      var u = new URL(location.href);
      u.searchParams.set('lat', state.lat.toFixed(4)); u.searchParams.set('lon', state.lon.toFixed(4));
      u.searchParams.set('place', state.label); u.searchParams.set('lang', state.lang);
      if (state.demo) u.searchParams.set('demo', 'harvey'); else u.searchParams.delete('demo');
      history.replaceState(null, '', u);
    } catch (e) { /* file:// or sandboxed iframe */ }
  }

  function setupReplay() {
    var s = DEMO.gauge.series, r = $('replay');
    r.min = s[0][0]; r.max = s[s.length - 1][0]; r.step = 3 * 3600e3; r.value = state.demoNow;
    r.addEventListener('input', function () { stopPlay(); state.demoNow = +r.value; recomputeDemo(); });
    $('playBtn').addEventListener('click', function () {
      if (state.playing) { stopPlay(); return; }
      if (state.demoNow >= +r.max) state.demoNow = +r.min;
      $('playBtn').textContent = t('pause');
      state.playing = setInterval(function () {
        state.demoNow = Math.min(+r.max, state.demoNow + 6 * 3600e3); r.value = state.demoNow; recomputeDemo();
        if (state.demoNow >= +r.max) stopPlay();
      }, 350);
    });
    $('crestBtn').addEventListener('click', function () { stopPlay(); state.demoNow = DEMO_CREST; r.value = DEMO_CREST; recomputeDemo(); });
  }
  function stopPlay() { if (state.playing) clearInterval(state.playing); state.playing = null; $('playBtn').textContent = t('play'); }

  function applyLang() {
    document.documentElement.lang = state.lang;
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-aria]'), function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-lang]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === state.lang)); });
    $('addr').placeholder = t('search_ph');
    $('disclaimer').textContent = t('disclaimer');
    $('demoBtn').textContent = state.demo ? t('demo_exit') : t('demo_btn');
    $('planBtn').hidden = state.demo;
    $('demoBanner').hidden = !state.demo; $('demoText').textContent = t('demo_banner');
    $('playBtn').textContent = state.playing ? t('pause') : t('play');
    $('map').setAttribute('aria-label', t('map_label'));
    $('howTest').textContent = fmt(t('how_test'), { n: TEST_COUNT });
    if (!state.data) $('lvlDesc').textContent = t('loading_desc');
    $('lead').innerHTML = '';
    if (state.data) { if (state.demo) recomputeDemo(); else { render(); if (state.selected) selectGauge(state.selected); } }
  }

  function scheduleRefresh() {
    clearInterval(state.timer);
    state.timer = setInterval(function () { if (!state.demo && !document.hidden) run(state.lat, state.lon, state.label); }, REFRESH_MS);
  }

  function init() {
    var p = new URLSearchParams(location.search);
    if (p.get('lang') === 'es' || (!p.get('lang') && /^es/i.test(navigator.language || ''))) state.lang = 'es';
    state.demo = p.get('demo') === 'harvey';
    var lat = parseFloat(p.get('lat')), lon = parseFloat(p.get('lon'));
    if (!isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { state.lat = lat; state.lon = lon; state.label = (p.get('place') || 'here').slice(0, 80); }
    else if (state.demo) { state.lat = DEMO_LOC.lat; state.lon = DEMO_LOC.lon; state.label = DEMO_LOC.label; }
    initMap();
    setupReplay();
    setupPlan();
    applyLang();

    $('searchForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $('addr').value.trim(); if (!q) return;
      if (!/\b(tx|texas)\b/i.test(q)) q += ', TX';
      msg(t('loading'));
      geocode(q).then(function (r) { run(r.lat, r.lon, r.label); }, function () { msg(t('err_geo'), true); });
    });
    $('locBtn').addEventListener('click', function () {
      if (!navigator.geolocation) { msg(t('err_loc'), true); return; }
      msg(t('locating'));
      navigator.geolocation.getCurrentPosition(function (pos) { run(pos.coords.latitude, pos.coords.longitude, 'here'); },
        function () { msg(t('err_loc'), true); }, { timeout: 10000, maximumAge: 300000 });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.chip[data-ll]'), function (b) {
      b.addEventListener('click', function () { var ll = b.getAttribute('data-ll').split(','); run(+ll[0], +ll[1], b.textContent); });
    });
    $('demoBtn').addEventListener('click', function () {
      stopPlay();
      state.demo = !state.demo; state.demoNow = DEMO_CREST; $('replay').value = DEMO_CREST; state.data = null; state.selected = null;
      applyLang();
      if (state.demo) { state.prev = { lat: state.lat, lon: state.lon, label: state.label }; run(DEMO_LOC.lat, DEMO_LOC.lon, DEMO_LOC.label); }
      else { var pv = state.prev || { lat: 29.6197, lon: -95.6349, label: 'Sugar Land' }; run(pv.lat, pv.lon, pv.label); }
      if (state.demo) { $('demoBanner').scrollIntoView({ block: 'nearest' }); $('playBtn').focus(); }
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-lang]'), function (b) {
      b.addEventListener('click', function () { state.lang = b.getAttribute('data-lang'); applyLang(); updateURL(); });
    });
    $('shareBtn').addEventListener('click', function () {
      var btn = $('shareBtn'), done = function (ok) { btn.textContent = ok ? t('copied') : t('copy_fail'); setTimeout(function () { btn.textContent = t('share'); }, 2000); };
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) { navigator.share({ title: 'Brazos Beacon', url: location.href }).catch(function () {}); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(function () { done(true); }, function () { done(false); }); else done(false);
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !state.demo && state.data && Date.now() - state.data.fetched > REFRESH_MS) run(state.lat, state.lon, state.label);
    });
    var rz; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (state.data && state.selected) selectGauge(state.selected); }, 200); });
    window.addEventListener('online', function () { if (!state.demo && state.data && state.data.offlineAt) run(state.lat, state.lon, state.label); });
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(function () {});
    scheduleRefresh();
    run(state.lat, state.lon, state.label);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
