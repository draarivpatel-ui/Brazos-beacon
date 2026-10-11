# Brazos Beacon review log

Earlier iterations 1-5 (Oct 10, 2026) are recorded in ../brazos-beacon-QA.md (not in the repo).

## Cycle 6 · Sat Oct 10, 2026, ~4 PM CT (scheduled improvement loop)

Fresh strict-judge review: the app was already solid on correctness and polish; the biggest gap against
Impact/UX was the moment it matters most. In a storm, data and power drop, and the page showed only
"No live sources answered". Offline support was also listed under "What's next". Built it:

| Change | Detail |
|---|---|
| Installable app | `manifest.webmanifest`, 192/512 px icons, `apple-touch-icon`. |
| Service worker (`sw.js`) | Network-first for the page, scripts, styles and the pinned Leaflet 1.9.4 files, cache only as fallback, so a new deploy always wins when online. Agency APIs (NOAA, NWS, FEMA) are never cached. |
| Last-check snapshot | After each live check, the result is saved in localStorage (browser only). If every live source fails, the app shows that snapshot only for the same spot (within 1.5 km) and only if it is under 72 hours old, with a white "Offline: … last saw here on {time} ({age})" note in the hero and a status message, EN + ES. Re-checks automatically on the `online` event. A different spot offline still gets the honest "Could not check everything / ?" state. |
| Logic + test | `logic.snapshotUsable()` (same spot, recent, rejects future clocks). New unit test: 28 -> 29 passing. |
| Docs | README features/tests/what's-next and devpost.md "What it does", test count, "What's next" updated. |

Checks run (headless Chromium via bb_qa/offline.py against a local server, live APIs through the proxy):
1280 px EN and 390 px ES: online run saves snapshot and SW controls page; reload offline -> app served
from SW, last check shown with note; offline at Richmond (no snapshot) -> honest "?" state; Harvey
replay offline still works. 0 page errors, no horizontal overflow. node logic.test.js: 29/29.

## Cycle 7 · Sat Oct 10, 2026, ~7:25 PM ET (swarm)

Live site returns 200; jsdom run against live NOAA/NWS/FEMA for Sugar Land: level 1 with heat driver, 5 gauges, hydrograph, 0 console errors; 29/29 unit tests. Visual check was code-level only (no headless browser in this sandbox this cycle). Fixed: README "What's next" listed Web Push twice; merged into one honest line noting it needs a server. No code changes, so no redeploy of the app files.

## Cycle 8 · Sat Oct 10, 2026, ~8:10 PM ET (research recommendations: engineering + impact)

Source: ../research-winning-patterns.md, Brazos Beacon P1(a)/P2/P3. No big new features.

| Change | Detail |
|---|---|
| Replay lead time in the UI | New `logic.replayLeadTimes(series, cats, levelFn)`: for each level, the first replay moment before the crest, computed two ways. The app runs it through its own level pipeline (zone adjustment + demo alert + `overallRisk`). A lead-time box under the replay slider (EN + ES) says: **Danger 75 h (3.1 days) before the 55.19 ft crest using only readings up to each moment** (Aug 28, 2017, 9 PM CDT, stage 50.2 ft), and that with the 48-hour outlook it would be 123 h (5.1 days), but that number is hindsight because the 2017 NWS forecasts aren't archived. Notes 3-hour sampling. "Jump to that moment" button moves the slider. Box is cleared on every run and on language change, so it can't go stale. |
| "How it works · tested" panel | New full-width card at the bottom (EN + ES): never a false all-clear, rules-not-AI (published NWS/FEMA thresholds), the unit-test count, data sources with links, "no keys, no server, no tracking", link to the repo. 4 columns on desktop, 2 under 1100 px, 1 on phones. |
| Honest test count | `TEST_COUNT` in app.js feeds the panel; logic.test.js now fails if it differs from the real count. |
| Tests | New unit test for replayLeadTimes (observed-only never uses look-ahead, outlook earlier, null when never reached, sanity on the real Harvey series). 29 -> **30 passing**. |
| Service worker | Cache name bumped to beacon-shell-v2 (still network-first). |
| Docs | README (features, test count), demo-script (30 tests, lead-time fact + one narration line, gallery pointer). |
| Workspace | Stale ../brazos-beacon.zip (Oct 10 ~8:25 PM build, 10 files, nothing referenced it) deleted. 7 Devpost gallery PNGs (1500x1000, 3:2) made in ../gallery/. |

Checks (headless Chromium via bb_qa/cycle8.py, live agency APIs through the proxy): 1280 px and 390 px, EN and ES: replay shows the lead box, Jump-to-moment lands on Aug 28 9 PM at level 4; Play then Back to live data returns to Sugar Land with the box cleared; live Sugar Land/Richmond level 1; all agency APIs blocked -> "Could not check everything / ?". No page errors, no horizontal overflow (scrollWidth == clientWidth). `node logic.test.js`: 30/30.

## Cycle 9 · Sat Oct 10, 2026, ~8:35-9:30 PM ET (accessibility, performance, Spanish pass; no new features)

| Area | Change |
|---|---|
| axe-core (before) | 1280 px EN live: `color-contrast` on **Copy share link** (white on the translucent-white-over-blue button, 4.28:1; on green and orange levels it was 3.8-3.9:1) and `label-content-name-mismatch` on the **EN/ES** buttons (aria-label "English"/"Español" did not contain the visible "EN"/"ES"). Replay view: `region` (replay banner outside any landmark). |
| Fixes | Share/ghost button now darkens the level colour (rgba(0,0,0,.2)) instead of lightening it: 7.0-9.4:1 on every level, 10.9:1 dark-on-yellow at level 2. EN/ES buttons: aria-label removed; visible text plus a visually hidden word, so the names are "EN English" / "ES Español". Replay banner is now a labelled `<section>` landmark. Duplicate "Map" region label removed. |
| Spanish mode leftovers | Skip link, language group, search and replay region labels, and the data-source descriptions were English-only in Spanish; all now translated (`data-i18n` / new `data-i18n-aria`). |
| Focus | Focus ring was yellow on white (~1.7:1). Now two-tone (navy outline + yellow ring), white on the coloured level card, dark on yellow. |
| Replay keyboard | Starting the replay moves focus to Play. Play button no longer flips both its label and `aria-pressed` (it just says Play/Pause). |
| axe-core (after) | **0 violations** in all 12 runs: 1280/390 px x EN/ES x live / Harvey replay / plan dialog open (WCAG 2.0-2.2 A+AA + best-practice tags). |
| Keyboard-only | Scripted with Playwright, EN 1280 and ES 390: Tab reaches all controls with a visible ring; Enter on Replay -> focus on Play; Enter/Space play+pause; Tab -> Jump to crest -> slider (ArrowLeft = 3 h back, Home = Aug 24) -> Jump to that moment (lands Aug 28 9 PM, level 4, focus kept); exit replay keeps focus. Plan dialog: Enter opens with focus in the first field, Tab stays inside, Escape and Close both close and return focus to the button, typed answers persist. |
| Lighthouse (local, before -> after) | Mobile: Perf 50 -> **99**, CLS 0.49 -> **0.011**, LCP 15.9 s -> 1.9 s (LCP was the level text waiting for live data; now a real "Asking NOAA, NWS and FEMA…" line paints first); Desktop Perf 93 -> **95** (CLS 0.14 -> 0.12, from the level card growing when data lands). A11y 100, SEO 100, Best practices 96 (only a CORS console line from the sandbox's direct NOAA call; the API sends `access-control-allow-origin: *`). Cheap wins: English text shipped in the HTML (no empty-label shift), `defer` on all scripts, QR library lazy-loaded when the plan opens (loaded before printing; offline copy still cached by the service worker), `preconnect` to unpkg, reserved height for the "why" chips. Skipped: minification and cache headers (GitHub Pages; code stays readable for judges). |
| Spanish terminology | Checked against the NWS English-Spanish dictionary (weather.gov/mfl/EngSpaDict), weather.gov/fsd/espanol, FEMA Spanish pages and listo.gov/es/kit. Changes: storm surge "marejada" -> **marejada ciclónica** (NWS); floodway "cauce de inundación"/"cauce de alivio" (inconsistent) -> **cauce mayor reglamentario** (FEMA); SFHA -> **Área Especial de Riesgo de Inundación (SFHA)** (FEMA/FloodSmart); "seguro de inundación" -> **seguro contra inundaciones** (NFIP Spanish); "etapa de inundación mayor" -> **nivel de inundación mayor** (matches NWS "nivel de inundación" used elsewhere in the app); Turn Around Don't Drown -> the official **"¡Dé la vuelta, no se ahogue!"** in both places; go-bag list reworded to Listo.gov's terms (radio a pilas o a manivela, pilas de repuesto, botiquín de primeros auxilios, muda de ropa, calzado resistente, abrelatas manual). Kept: vigilancia/aviso (already NWS-correct), índice de calor, hidrograma. Natural-Spanish fixes: "Sensación térmica", "Prepárate ahora, mientras hay calma", "Pregunta cómo están tus vecinos…", "Llama o visita…", "La mayoría de las hipotecas", "aparatos electrónicos", "control deslizante". |
| Service worker | Cache bumped to beacon-shell-v3. |
| Tests | `node logic.test.js`: 30/30 (no logic changes; TEST_COUNT stays 30). Plan print path re-checked: QR code present on the sheet after lazy load, EN 1280 and ES 390, no page errors, no horizontal overflow. |

Scripts: /workspace/work/bb_a11y/ (axe.py, kbd.py, cls.py, hero.py, final.py; Lighthouse JSON lh_mobile.json, lh_desktop.json).
