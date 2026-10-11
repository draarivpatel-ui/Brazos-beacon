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
