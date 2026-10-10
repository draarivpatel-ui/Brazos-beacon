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
