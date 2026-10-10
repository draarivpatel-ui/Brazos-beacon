# 🟡 Brazos Beacon

**Live flood & heat risk for your Fort Bend County street, in plain language, in English and Spanish.**

Built for **WarriorHacks 2.0** (Hackathon track): *"Create a project that solves an issue in your community, county, state, or nation."*

**Live demo:** https://aariv.me/Brazos-beacon/
**Try the Harvey replay:** https://aariv.me/Brazos-beacon/?demo=harvey

---

## The problem

Fort Bend County sits where the Brazos River, the San Bernard River, and Houston-area bayous meet. During Hurricane Harvey the Brazos at Richmond crested at **55.19 ft** on Sept 1, 2017 (flood stage is 45 ft), the highest since 1915. The county ordered mandatory evacuations for neighborhoods and levee districts along the river, and its emergency office later estimated about **200,000 residents were impacted**. Summer heat is the other everyday danger.

The information people need is public, but it is spread across agencies, apps, and formats:

| Question a resident has | Where the answer lives today |
|---|---|
| "Is the river near me rising?" | NOAA's National Water Prediction Service hydrographs |
| "Is there a warning for my street?" | National Weather Service alerts |
| "Am I in a flood zone?" | FEMA's National Flood Hazard Layer (a GIS map) |
| "How hot will it actually feel?" | NWS forecast grids |
| "What should I do *right now*?" | County preparedness pages |

Brazos Beacon combines all five for one address into **a single 0–4 risk level, a reason for it, and a short checklist**, in English or Spanish. Nobody has to read a hydrograph to use it.

## What it does

- **Address → answer.** Type an address or ZIP, tap "Use my location", pick a city chip (Sugar Land, Missouri City, Richmond, Rosenberg, Fulshear, Stafford, Needville, Katy), or click the map.
- **One Beacon level (0–4):** *All clear · Stay aware · Get ready · Take action · Danger*, with the specific drivers listed ("River: Brazos River at Richmond (Major flooding)", "Max heat index (3 days) 109°F").
- **Never a false "All clear".** If NWS alerts, NOAA gauges, or the NWS forecast don't answer, the page says *"Could not check everything"* instead of showing green, and names the missing source.
- **FEMA flood zone at your exact point**, explained in plain words, with your zone's polygon and nearby high-risk areas drawn on the map, plus a link to the official FEMA map for that spot.
- **Nearest 5 river gauges** (distance in miles): current stage, **how many feet below or above flood stage**, the **crest of the official NWS forecast** (not just its next point), when it was observed, and a warning if the reading is more than 6 hours old.
- **SVG hydrograph:** 7 days observed plus the NWS forecast, with action / minor / moderate / major flood lines.
- **Active NWS watches and warnings** for that exact point, with "until" times.
- **Next 72 hours:** "feels like" now, max heat index, and forecast rain totals for 24 h and 72 h.
- **A personalized action checklist** that changes with the level and your zone (flood insurance's 30-day waiting period if you're in a high-risk zone, "Turn Around, Don't Drown", heat safety, evacuation readiness).
- **Works when the signal drops:** it can be installed to a phone's home screen, and a service worker keeps the app itself (page, scripts, map library) available offline. Each successful check is saved in your browser; if you open it later with no connection and no agency answers, it shows that last check for the same spot, with a clear "Offline: last saw here on … (2 h ago)" note, instead of a blank screen. It never uses a saved check from more than 1.5 km away or older than 72 hours, and live agency data is never served from the cache.
- **Fort Bend resources:** FBC Alert sign-up (text `FBCAlert` to `888777`), Ready Fort Bend, county Homeland Security & Emergency Management (281-342-6185, non-emergency), FEMA Map Service Center, Texas 2-1-1.
- **English and Spanish**, auto-detected from the browser, switchable anytime (NWS alert text itself stays in English, and the app says so).
- **Printable family flood plan.** One tap builds a one-page, fridge-ready plan for that exact spot (English or Spanish): the FEMA zone and what it means, the Beacon level when printed, the nearest NOAA river gauge with its action / flood / moderate / major stages, a "when to do what" ladder for levels 2-4, a Ready.gov go-bag checklist, Fort Bend key numbers, and a QR code back to the live page. The family fills in who lives there, an out-of-area contact, two meeting places, where they would evacuate, medicines and pets (or leaves blanks to write by hand). Those answers are kept only in the browser's localStorage and are never sent anywhere. Print it or save it as a PDF.
- **Shareable links** (`?lat=…&lon=…&lang=es`) so a parent can text the exact view to family. Refreshes every 15 minutes while open.
- **"Replay Harvey" mode with a time slider.** It loads the **real USGS gage record** for the Brazos at Richmond (Aug 24 – Sep 8, 2017) at a point inside the FEMA floodplain. Drag the slider or press **Play the flood** and watch the level climb from *All clear* (Aug 26) to *Danger* as the forecast crest approaches, then fall again. The app only uses readings up to the chosen moment; what the river actually did over the next 48 h stands in for the forecast. The flood warning shown is a clearly labeled re-created example, not an archived NWS product.

## How it works

```
 address ──► Esri World Geocoder (fallback: OpenStreetMap Nominatim)
                │ lat/lon
   ┌────────────┼──────────────┬──────────────────────┬──────────────────────┐
   ▼            ▼              ▼                      ▼                      ▼
 FEMA NFHL   NOAA NWPS       NWS /alerts/active   NWS /points → gridData   (map: Leaflet + OSM)
 flood zone  gauges in bbox  for the point        heat index + QPF rain
 polygon     → nearest 5 →
             gauge detail +
             stageflow series
   └────────────┴──────────────┴──────────────────────┴──────────────────────┘
                              ▼
                logic.js  (pure functions, unit-tested)
     riverCategory · floodZoneInfo · alertLevel · heatIndexF · rainInches
     overallRisk → level 0-4 + drivers  ·  buildChecklist
                              ▼
                     render (EN / ES strings in i18n.js)
```

- **100% static.** HTML, CSS, and vanilla JS on GitHub Pages: no server, no build step, no API keys, no tracking.
- Every source is a **free, public, CORS-enabled** government or open API.
- Each source loads independently (`Promise.all` over "settled" wrappers with timeouts), so if one agency is down the rest of the page still works and says which source is unavailable.
- **Risk logic is honest about distance:** only gauges within 15 km (about 9 miles) can raise your level, and if FEMA maps you *outside* the 1% and 0.2% floodplains, river stage counts one category lower. (If FEMA's service is down, nothing is discounted.) A flood at a gauge across the county shouldn't make your phone scream.
- **Heat uses NWS Houston's own thresholds** ([criteria](https://www.weather.gov/hgx/WWA_criteria)): a forecast heat index of 90°F+ is *Stay aware*, 108°F+ (Heat Advisory criterion) is *Get ready*, 113°F+ (Extreme Heat Warning criterion) is *Take action*. Official heat alerts count at full weight.
- The heat index comes from NWS's grid; if that field is missing, we compute it hour by hour with the **NWS Rothfusz regression** (including both NWS adjustment terms), sampling temperature and humidity at each hour because NWS grid intervals don't line up between fields.
- Many Houston gauges report water-surface *elevation* (e.g. 85 ft at Barker Reservoir), so the app shows **feet to flood stage** rather than a misleading percentage.

### Data sources

| Data | API |
|---|---|
| River gauges, flood categories, forecasts | NOAA National Water Prediction Service: `api.water.noaa.gov/nwps/v1` |
| Watches and warnings | National Weather Service: `api.weather.gov/alerts/active?point=` |
| Heat index, rain (QPF) | NWS gridpoints: `api.weather.gov/points → forecastGridData` |
| Flood zones | FEMA NFHL ArcGIS REST, layer 28 (Flood Hazard Zones) |
| Geocoding | Esri World Geocoder `findAddressCandidates`, OpenStreetMap Nominatim |
| Harvey replay | USGS NWIS instantaneous values, site 08114000 (sampled every 3 h, plus the crest reading) |
| Map tiles | OpenStreetMap |

## Run it locally

```bash
git clone https://github.com/draarivpatel-ui/Brazos-beacon.git
cd Brazos-beacon
python3 -m http.server 8000      # then open http://localhost:8000
node logic.test.js               # 29 unit tests for the risk logic
```

## Project structure

```
index.html      layout + accessibility landmarks
style.css       responsive, mobile-first styles, colour-coded levels
app.js          data loading, rendering, map, SVG hydrograph, share links
logic.js        pure risk logic (runs in browser and Node)
logic.test.js   unit tests (node logic.test.js)
i18n.js         English + Spanish strings
demo.js         real USGS Harvey 2017 series for the replay mode
vendor/qrcode.js  QR code generator for the printable plan (qrcode-generator 1.4.4, MIT, Kazuhiko Arase)
og-image.png    link-preview image
```

## Accessibility

Skip link, ARIA live regions for the level and status messages, `aria-pressed` toggles, visible focus rings, a labelled replay slider with spoken time values, a text summary on the hydrograph for screen readers, `prefers-reduced-motion` support, and colour plus text labels so levels are never conveyed by colour alone. Text and badge colours were checked against WCAG AA (4.5:1). The Spanish UI covers the county's large Spanish-speaking population.

## Testing

- `node logic.test.js`: 29 unit tests (flood categories incl. missing/-9999 values, feet-to-flood-stage, forecast crest, distance and floodplain discounting, heat index and NWS Houston thresholds, misaligned NWS grid intervals, rain prorating, "never a false all-clear", Harvey replay never peeking into the future, checklist escalation, the family plan choosing the nearest in-range gauge that has an official flood stage, and the offline fallback only reusing a saved check for the same spot (within 1.5 km) from the last 72 hours).
- During development the app was also run headless (jsdom and Chromium) against the live APIs, with every API failing, with only NWS alerts failing, fully offline (service worker serving the app, the saved last check at the same spot, no saved check used for a different spot), through the Harvey replay at several moments, in Spanish, and at phone width (390 px). The deployed site at aariv.me was checked the same way (1280 px and 390 px, no console errors or failed API requests from the real domain).

## What's next

- Push alerts (Web Push / PWA) when *your* level goes up, not the whole county's.
- Show the inundation map NOAA publishes for forecast flood stages.
- Add Harris County Flood Control District gauges and TxDOT road closures (DriveTexas).
- Vietnamese, Chinese, Hindi and Urdu strings (all widely spoken in Fort Bend).
- Web Push alerts when your saved spot's level goes up.

## Disclaimer

Brazos Beacon is a student project that summarizes public data. **It is not an official warning system.** Always follow the National Weather Service and Fort Bend County officials. In an emergency, call 911.

## License

MIT © 2026 Aariv Patel
