# Brazos Beacon: demo video shot list, narration and screenshot list

**Length rule:** WarriorHacks asks for a **2–3 minute** demo video (https://warriorhacks-2-0.devpost.com/). This script runs **2:40**, which leaves 20 seconds of slack under 3:00. Don't go under 2:00 if you cut.
**Built from:** the live site https://aariv.me/Brazos-beacon/ in headless Chromium, Sat Oct 10, 2026, ~6:45–7:45 PM CT. Every click below was tried on the live site.
**Judging:** Impact · Feasibility · User Experience · Technical Craft. Each shot names the criterion it serves.

## Honesty rules for the recording
- Read the level and numbers that are actually on screen that day. The [brackets] below are placeholders, not values to say. (On Oct 10 at ~7 PM, Sugar Land and 2200 Texas Pkwy were both level 1 "Stay aware" because of a 102°F max heat index.)
- In the replay, say that the 48-hour outlook is "what really happened" and that the warning is a re-created example. Both are labeled on screen.
- Don't claim users, downloads, partners, or that the county uses it.

## Before you hit record
- Desktop browser at 1280 px wide, zoom 100–110%, bookmarks bar hidden, notifications off.
- Tabs in order: (1) https://water.noaa.gov (2) https://www.weather.gov (3) https://msc.fema.gov/portal/search (4) https://aariv.me/Brazos-beacon/ (5) https://aariv.me/Brazos-beacon/?demo=harvey (6) https://github.com/draarivpatel-ui/Brazos-beacon (7) a terminal in the project folder.
- In tab 4, check **2200 Texas Pkwy, Missouri City** once before recording. Then open DevTools device mode (390 px) and load the same page once, so the offline snapshot exists for shot 7.
- In tab 5 the replay opens **at the crest** (Sep 1, 2017, 55.2 ft). That's the frame for shot 1.
- Record at 1080p. Narration is about 150 words per minute; each line below is written to fit its slot.

## Shot list with timed narration

| # | Time | On screen | Narration | Criterion |
|---|------|-----------|-----------|-----------|
| 1 | 0:00–0:14 | Tab 5, paused at the crest: yellow SIMULATION banner, red "4 · Danger - act now", gauge at 55.2 ft | "In 2017, Hurricane Harvey pushed the Brazos River at Richmond to 55 feet, the highest since 1915. I live in Fort Bend County, and the information to stay safe was public. It was just scattered." | Impact |
| 2 | 0:14–0:26 | Flash tabs 1, 2, 3, about 3 seconds each | "River levels are on NOAA. Warnings are on weather.gov. Flood zones are in FEMA's map viewer. Nobody cross-checks all of that in a storm, especially if English isn't their first language." | Impact |
| 3 | 0:26–0:54 | Tab 4. Type `2200 Texas Pkwy, Missouri City`, press Enter. Point at the level circle and reason chip, then the FEMA zone card and the zone on the map | "So I built Brazos Beacon. I type an address, and it pulls live data from NOAA, the Weather Service and FEMA into one level from zero to four. Right now it says [level name], because [reason chip]. This is my FEMA flood zone in plain English, and the zone is drawn on the map." | UX, Craft |
| 4 | 0:54–1:10 | Scroll to Nearest River Gauges. Click "Brazos River at US 59" (or any Brazos gauge in the list). Hold on the hydrograph | "These are the five nearest river gauges: how far below flood stage each one is and the high point of the official forecast. Far-away ones don't change my level. The chart shows the last week solid and the forecast dashed." | Craft |
| 5 | 1:10–1:24 | Scroll to Your Action Checklist. Click **ES** at the top, hold 2 s, click **EN** | "The checklist changes with your level and your flood zone. In a high-risk zone it reminds you flood insurance usually takes thirty days to start. And one tap puts the whole page in Spanish." | Impact, UX |
| 6 | 1:24–1:40 | Click **Make a printable family flood plan**. Type a meeting place, e.g. `Neighborhood library`. Click **Print / save as PDF**, show the preview | "This makes a one-page family flood plan for the fridge: our flood zone, the river gauge to watch, what to do at each level, and a QR code back to the live page. What I type stays in my browser." | UX |
| 7 | 1:40–1:54 | DevTools device mode, 390 px. Network → Offline. Reload. Point at the white "Offline" note with the time | "Storms knock out the signal. It installs like an app, and with no connection it shows my last check for this same spot, labeled with when it was taken. It never pretends that's live." | Feasibility, UX |
| 8 | 1:54–2:22 | Tab 5. Drag the slider all the way left (Aug 24, 2017), press **Play the flood**. It runs about 22 seconds to Sep 8. Let it play | "Replay Harvey loads the real USGS gauge record from 2017. August 24th: All clear. The app's 48-hour outlook here is what the river actually did, and it's labeled that way. By the evening of the 26th it hits Danger, with an example warning, while the river is still under twenty feet. Even with no look-ahead at all, it reaches Danger seventy-five hours before the crest. In real life, the Weather Service forecast a record crest on the 27th, and the county ordered evacuations that night." | Impact |
| 9 | 2:22–2:34 | Tab 7: run `node logic.test.js` (ends "38 tests passed"), then tab 6, the repo | "It's a static site on GitHub Pages: no server, no API keys, nothing to pay for. The risk rules are pure functions with thirty-six unit tests, and every source fails safely." | Feasibility, Craft |
| 10 | 2:34–2:40 | Back to tab 4, the live page | "Next: push alerts and more languages. Brazos Beacon: know your risk, know what to do." | — |

**If you run long:** show only one tab in shot 2 (−6 s); skip typing in shot 6 (−4 s); stop the replay at Sep 1 instead of letting it reach Sep 8 (the narration already fits). Keep the total over 2:00.
**If an agency API is down while recording:** keep going. The page will say "Could not check everything." Say: "and when a source doesn't answer, it tells you instead of guessing," then move on to the replay.
**After recording:** upload to YouTube as Unlisted (or Vimeo), paste the link into Devpost, and submit the Track Selection Form (Hackathon).

### Facts behind the narration
- Crest 55.19 ft at about 12:15 AM CDT Sep 1, 2017, USGS 08114000 (Brazos River at Richmond); shown in the app's replay banner and in demo.js.
- Replay levels (from logic.js on the bundled record, confirmed on the live site): level 0 from Aug 24, level 1 from Aug 25 ~6 AM, level 2 Aug 26 ~9 AM, level 4 Danger Aug 26 ~9 PM (stage 18.5 ft), back down to 3 on Sep 4 and to 1 by Sep 5.
- NWS forecast of a record 59 ft crest and the county's evacuation order, posted Aug 27, 2017, 8:00 PM: https://www.fortbendcountytx.gov/your-county/news/evacuation-orderorden-de-evacuacion
- 38 unit tests: `node logic.test.js` → "38 tests passed" (re-run Oct 11, 2026, ~10 PM ET), plus the headless-Chromium suites in `tests/` (dom_429 18, dom_far_gauge 17, dom_replay 5, dom_search_map 29, plan_print 22, dom_cls 14, dom_wait 8, live_regression 58, devpost_claims 39), all run by GitHub Actions except live_regression and devpost_claims (real data). The submitted video (youtu.be/Y7AWbC3ZZKc) may quote the older 33; these numbers are for any re-record.
- Lead time (shown in the app's replay lead-time box, computed by `logic.replayLeadTimes` through the app's own level pipeline): with **no look-ahead**, Danger at Aug 28, 2017, 9:00 PM CDT (stage 50.2 ft), **75 hours (3.1 days) before the crest**. With the 48-hour hindsight outlook, Danger at Aug 26, 9:00 PM CDT, 123 hours (5.1 days) before. Say the 75-hour number; if you mention 123, say it is hindsight.

## Screenshot list (Devpost gallery)
**Ready-made (cycle 8):** seven 1500 × 1000 PNGs are already in `../gallery/` (not in the repo): 01 Harvey lead time, 02 Harvey hydrograph, 03 live Richmond, 04 Spanish, 05 never a false all-clear, 06 how it works/tested, 07 phone EN + ES. The list below is for retaking them by hand.

Devpost recommends a 3:2 ratio for gallery images, so set the window to **1440 × 960** (or crop to 3:2). PNG or JPG. Take them yourself from the live site.

| # | What | How to get it | Shows (criterion) |
|---|------|---------------|-------------------|
| 1 | Live result for an address | Tab 4 → search `2200 Texas Pkwy, Missouri City` → top of the page: level circle, reason chip, map, FEMA zone, Next 72 Hours | One answer in plain language (UX, Impact) |
| 2 | River gauges + hydrograph | Same page → scroll to Nearest River Gauges → click a Brazos gauge (Brazos River at Richmond appears in the list when you check Sugar Land or Richmond) → frame the gauge list and chart together | Live NOAA data, forecast, custom SVG chart (Craft) |
| 3 | Harvey replay at the crest | https://aariv.me/Brazos-beacon/?demo=harvey (opens at the crest) → top of page: SIMULATION banner, slider, "4 · Danger - act now", Zone AE, example Flood Warning | The real 2017 record (Impact) |
| 4 | Harvey replay before the crest | Same page → drag the slider to about Aug 27, 2017 (stage ~22 ft) → frame the hero and the gauge card showing "Next 48 h (what really happened): 51.7 ft (Major flooding)" | Warning days ahead, honestly labeled (Impact) |
| 5 | Spanish on a phone | DevTools device mode 390 px → https://aariv.me/Brazos-beacon/?lang=es → top of page ("Mantente atento" or whatever level shows) | Bilingual, mobile (UX, Impact) |
| 6 | Offline mode on a phone | After #5, Network → Offline → reload → the white "Sin conexión" / "Offline" note with the time and age | Works when the signal drops (Feasibility, UX) |
| 7 | Family flood plan | Live page → **Make a printable family flood plan** → fill a field or two → screenshot the dialog, then the print preview (or the saved PDF) | Practical takeaway (UX) |
| 8 | (Optional) Tests | Terminal: `node logic.test.js` showing "38 tests passed" | Code quality (Craft) |

Upload #1 first so it leads the gallery.
