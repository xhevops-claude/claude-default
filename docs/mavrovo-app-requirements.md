# Mavrovo National Park app — initial requirements & analysis

**Status:** v1 SHIPPED — `apps/mavrovo/` is live (tile featured on Home and listed under
Apps). v1 implements the Today dashboard (two-elevation Open-Meteo weather with offline
cache, inline NOAA sun times, notices, events), the map (existing north-macedonia PMTiles +
OSM-extracted park boundary/POIs/trails), 7 trails (4 with real OSM-derived geometry + GPX:
strezimir-korab, lake-loop, galicnik-medenica, korab-falls; the rest link the official park
GPX), the Places encyclopedia (15 POIs), Practical info, the zero-fetch SOS sheet, and full
MK/EN i18n. Known v1 gaps: trail `time` strings are single-language; no elevation profiles
(needs the v2 terrain pipeline); duf-waterfall/anovi-galicnik/sheremetnica-medenica lack
GPX (OSM coverage insufficient — honestly declined rather than fabricated).
**Proposed registry entry:** `apps/mavrovo/` — see [§7](#7-architecture--repo-integration).
**Researched:** 2026-08-24 (web research + fact-check pass; all time-sensitive facts carry a
"verify before publishing" note where warranted — see [§10](#10-fact-sheet-appendix)).

---

## 1. Product vision

One mobile-first web app that answers, for Mavrovo National Park, the two questions nobody
currently answers in one place:

- **"What is it like there *today*?"** — weather at the lake and on the ridges, snow, what's
  open this season, can I get over the Straža pass, is the ski centre running, when does the
  sun set.
- **"What should I do there, and how?"** — trails with honest difficulty and GPX, the sights
  (lake church, waterfalls, monastery, Miyak villages), where to eat and sleep, how to arrive
  without a car, what it costs, and who to call if something goes wrong.

### Why this app has a niche

The research found the digital landscape genuinely fragmented:

- The official park site (npmavrovo.org.mk) has real substance (trail lists, online tickets,
  GPX) but unwieldy Cyrillic-encoded URLs, no practical logistics (transport, food, what's
  open), and it isn't built for phones in the field.
- The resort site (resortmavrovo.com) is a bare Drupal install; ownership of the resort
  changed hands via public auction in Dec 2025, and its facts (prices, branding, even domain)
  keep moving.
- The national portal (exploringmacedonia.com) is visibly abandoned (© 2013). English search
  results are dominated by SEO travel blogs of mixed reliability.
- Nothing serves **locals** at all: road/winter bulletins are Macedonian-only text feeds
  (MIA, AMSM), scattered across sites.
- No dedicated Mavrovo mobile app was found on either store.

The gap: **curation + honesty about freshness**, not volume. Wikiloc has more GPX tracks than
we will ever have; Booking has the hotels. What's missing is one trustworthy, bilingual,
phone-sized front door.

### Product principles

1. **Both audiences, one app.** Locals get road/season/weather utility; tourists get
   orientation, trails and practicalities. The "Today" dashboard serves both.
2. **Never fake liveness.** Anything we maintain by hand (bus times, lift status, notices)
   displays a visible "last verified" date. Volatile facts (ski prices, resort status) are
   link-outs to the source, not hard-coded copies.
3. **Static-first.** Everything works from GitHub Pages: committed JSON, free no-key APIs
   (Open-Meteo), the repo's own PMTiles CDN. No backend, no accounts, no build step.
4. **Field-usable.** Big tap targets, one-hand reach, works in glare, safety info reachable
   from every screen and embedded in the page itself (no fetch needed once loaded).
5. **Standalone-first.** `apps/mavrovo/` is a complete site on its own URL — the shell
   tile is just one door in. Embedding may only add behavior, never be required.

---

## 2. Audiences

| Audience | Situation | Top needs (from research) |
|---|---|---|
| Foreign tourists | Mostly summer; car or Skopje bus; little/no Macedonian | Orientation map, trails w/ GPX, sights explained, **cash/ATM warning**, transport reality, fees, emergency info in English |
| Domestic/Balkan visitors | Weekend trips from Skopje/Tetovo/Gostivar (~1.5 h) | "Is it worth going today" — weather, snow, lake level, what's open, picnic spots, Duf-style easy walks, festival dates |
| Skiers (Dec–Mar) | Day/weekend trips to Zare Lazarevski | Snow report, webcams, prices/hours (link-out), road + winter-equipment status, night skiing |
| Locals & seasonal residents | Mavrovi Anovi, Mavrovo, Rostuše, villages | Straža/Radika road conditions, weather, notices, bus times to Skopje/Gostivar/Debar, services directory (pharmacy, fuel), fishing season/permits |
| Hikers/mountaineers | Bistra day hikes → Korab ambitions | Trail difficulty/time/water sources, Korab border-zone rules, mountain rescue contacts, summit vs valley weather, daylight hours |

**Languages:** the region is genuinely multilingual (Macedonian, Albanian, Turkish); local
info today is MK-only, tourist info EN-only. **v1: MK + EN** with all strings and content
fields structured as `{ mk, en }` so adding **SQ (Albanian)** later is a data task, not a
refactor. (Open question §9.)

---

## 3. Scope

### v1 (MVP)

1. **Today dashboard** — the opening screen:
   - Now + 7-day weather for **two elevations**: lake/village (~1,220 m) and ridge/summit
     (Open-Meteo supports per-call `elevation` downscaling — verified).
   - Sunrise/sunset/daylight (SunCalc, vendored single file, offline-capable).
   - Season-aware cards: winter → snow depth, ski links, winter-equipment law reminder
     (Nov 15–Mar 15), road-conditions links; summer → lake activities, fishing season,
     festival countdown (Galičnik Wedding = Petrovden weekend, mid-July).
   - Notices feed from committed `status.json` (trail closures, road works, events),
     each with date + explicit expiry, edited via Claude Code sessions like the expenses
     ledger.
2. **Map** — MapLibre GL + the repo's existing `north-macedonia.pmtiles` (already covers the
   whole park), recentered on the park (~[20.74, 41.66], z10–11): park boundary, curated POI
   overlay (own GeoJSON — springs/waterfalls are NOT in the OpenMapTiles schema, verified),
   trails overlay, "you are here" dot reusing Locator's geolocation handling.
3. **Trails** — curated list of ~7 launch trails (see §5) as filterable cards
   (distance / ascent / time / difficulty / season) → detail page with description,
   precomputed elevation profile, warnings (marking quality, border zone, seasonality),
   and **GPX download**.
4. **Places** — POI encyclopedia entries for the canonical sights (§5): story + practical
   block (access, season, dress code for the monastery, "check lake level" for the church).
5. **Practical info** — getting there (car/bus with last-verified curated timetable),
   park fee + link to official tickets, fishing permits, **cash/ATM warning**, fuel,
   pharmacy, contacts (park info point).
6. **Safety screen** — reachable from every screen, zero-fetch (content inline in HTML):
   112 (tap-to-call), Mountain Rescue Service SOS **13-112** (pss.org.mk — verified primary
   source), park info point phone, "my coordinates" readout for dispatchers, a short
   Macedonian phrase card for foreign visitors, bear/weather/exposure basics.
7. **MK/EN language toggle** persisted in `localStorage`.

### v1.5 (before the 2026/27 ski season)

8. **Winter/ski section** — static facts (15.5 km pistes, 13 lifts, 1,255–1,878 m —
   independently audited figures), price/hours as **link-outs** to resortmavrovo.com,
   snow forecast, manually updated lift-status JSON with honest timestamp.
9. **Webcams screen** — cards that link out (resort webcams page, snow-forecast.com);
   embed only YouTube live streams (e.g. the public "Bistra Mavrovo" stream) via standard
   YouTube embeds, never hotlinked images.
10. **Events calendar** — static JSON + downloadable `.ics` (Galičnik Wedding, Korab mass
    ascent ~Sep 8, fishing season opening, ski season).

### v2+ (each needs a decision, see §9)

- **Hillshade + contours**: extend the tiles pipeline with a terrain step (AWS Terrain Tiles
  terrarium → raster PMTiles on `/cdn/` + client-side `maplibre-contour`). Verified feasible
  and license-clean (EU-DEM/Copernicus attribution). This is the single biggest "hiking map"
  upgrade available.
- **Park-area PMTiles extract + offline stance** (see §7 — service workers conflict with the
  preview deploy model; needs an explicit decision).
- **Labeled panoramas** (PeakVisor-lite): pre-rendered, tappable peak labels from 2–3
  viewpoints. High delight, zero runtime deps.
- **Albanian (SQ) content**, "my visit" checklist (localStorage), audio/story points.

### Explicitly NOT building (with reasons)

- **Accounts / login** — no backend; localStorage covers personalization; GDPR burden for zero value.
- **Reviews / community reports / uploads** — needs moderation + storage; substitute: curated conditions fields updated via commits.
- **Booking / payments** — link out to providers; PCI/liability out of scope.
- **"Live" lift or parking status** — no public API exists for Mavrovo; faking liveness erodes trust; timestamped manual status instead.
- **AR peak identification** — mobile-web camera+orientation too flaky (esp. iOS); pre-rendered panoramas instead.
- **Turn-by-turn routing** — needs a routing engine; GPX + position-on-map suffices for marked trails.
- **Push notifications, background track recording** — impossible/unreliable in a mobile browser tab.
- **Any framework or build step** — repo constitution; everything above is plain HTML/CSS/JS + static JSON.

---

## 4. UX outline (v1)

Mobile-first; must also read well on tablet/laptop/desktop.

- **Navigation:** bottom tab bar on narrow screens (Today · Map · Trails · Places · More),
  becoming a left rail / top bar at ≥768 px. A persistent, visually distinct **SOS**
  affordance on every screen.
- **Today** = stacked cards, glanceable, zero taps to the answer. Every hand-maintained
  datum shows its "last verified/updated" stamp.
- **Map** = full-bleed, HUD chips (layers, locate), POI tap → bottom sheet with photo-less
  v1 content (fast), "open in Places" link.
- **Trails** = card list with filter chips (difficulty / duration / season / kid-friendly);
  detail = stats header, elevation profile (inline SVG, precomputed points), body text,
  warnings block, GPX button.
- **Desktop** (≥1024 px): Map and list views go side-by-side (list left, map right);
  dashboard becomes a grid of cards. No separate desktop app — same DOM, CSS grid.
- **Theming:** own two-theme palette (dark/light, own `localStorage` key `mavrovo-theme`)
  per repo rule that sub-apps are not themed by the shell. Visual identity: alpine —
  deep pine/lake tones; distinct from Locator's look.
- Standard shell patterns: inline splash (≥3 s), `embedded` class, quit via
  `close-game` postMessage (see §7).

---

## 5. Content inventory (launch set)

### POI encyclopedia (~15 entries at launch)

| POI | Angle / practical note |
|---|---|
| Mavrovo Lake | Reservoir (dam 1947–53, ~1,220 m); boating/pedalos ~€5–10/h May–Sep; level swings hard with hydropower/drought — affects everything below |
| St. Nicholas church | The half-submerged icon of the park (built ~1850, flooded 1953); **visibility depends on lake level** — present as seasonal, walkable in droughts |
| Duf waterfall (Rostuše) | The easy headline walk: ~2.5 km / ~40 min one-way, marked, footbridges; family-friendly Skopje day trip |
| Korab Falls | ~100–138 m, highest in North Macedonia, "among the highest in the Balkans" (do **not** claim tallest — contested); **spring-only** (late May–early June), long approach from Nistrovo/Žužnje |
| Sv. Jovan Bigorski monastery | Active monastery above the Radika; Miyak wood-carved iconostasis (1829–35); strict dress code, wraps at the gate; hours vary — publish soft guidance |
| Galičnik | Miyak showpiece village; amphitheatre square; **road from Mavrovo closed by snow in winter** (de facto); Galičnik Wedding on Petrovden weekend |
| Lazaropole | Bistra plateau village (~1,350 m), St. Gjorgji church (1838) |
| Janče | Radika-valley village; **Hotel Tutto** — the region's slow-food anchor (verified operating), founder tied to Slow Food Macedonia |
| Rostuše | Municipal seat; Duf trailhead |
| Mavrovi Anovi | Gateway: park info point (permits, maps; +389 42 489 425), dam |
| Mavrovo village | Ski-resort base; hotels/restaurants |
| Golem Korab (2,764 m) | Highest peak of North Macedonia *and* Albania; border-zone route from Strezimir — permit practice murky (see §10), annual mass ascent ~Sep 8 |
| Medenica (2,163 m, Bistra) | The classic marked day-summit from Galičnik |
| Elen Skok bridge & Lake Lokuv | Radika-valley curiosities near Janče |
| Bojkov Kladenec | Named picnic area with spring — the "locals' Sunday" entry |

### Launch trails (~7)

1. Duf waterfall from Rostuše (easy)
2. Mavrovo Lake circuit (asphalt; walk/bike; family)
3. Galičnik → Medenica (marked, ~10 km RT, ~550 m ascent)
4. Mavrovi Anovi → Galičnik (historic path)
5. Sheremetnica → Medenica (ridge variant)
6. Strezimir → Golem Korab (border zone — big caveat box)
7. Nistrovo/Žužnje → Korab Falls (long; spring only)

Difficulty taxonomy: adopt the park's official one (trails standardized by the Macedonian
Association of International Mountain Leaders) so our labels match signage.

**Copyright discipline:** trail text is written by us; geometries drawn over OSM data (ODbL,
attribution required) or hand-authored — never copied from Wikiloc/AllTrails/the park site
(their tracks and text are rights-restricted). Facts may be cross-referenced; prose may not.

### Wildlife/nature content

Balkan lynx as the flagship story (critically endangered, 20–39 mature individuals, Mavrovo
is the core area, declining — present as a symbol, not an expectation), brown bear (with
sensible behavior advice), chamois, ~129 recorded bird species / ~50 mammals / 24 reptiles
(park's own figures). **Do not list griffon vultures** — extirpated from the park per
conservation sources; tourism-site mentions are outdated boilerplate.

---

## 6. Data sources & feasibility (verified)

| Source | Verdict | Notes |
|---|---|---|
| **Open-Meteo forecast API** | ✅ primary weather source | Free non-commercial, no key, CORS per README; `elevation` param gives valley vs summit forecasts; `snow_depth` available (indicative at summit). Attribution "Weather data by Open-Meteo.com" (CC BY 4.0). Fair use ~10k req/day — far above our needs |
| **Open-Meteo air quality** | ✅ optional Today tile | CAMS European 11 km; winter PM2.5 is a real regional concern; credit CAMS/Copernicus |
| **Repo PMTiles (north-macedonia)** | ✅ base map, zero pipeline change | Verified against the actual extract: park boundary relation present; 159 peaks, ski pistes/lifts mapped; ~547 km of paths + ~786 km of tracks in the park bbox |
| OpenMapTiles schema limits | ⚠️ | POIs mostly z14; paths z14 (z13 if named/`sac_scale`); **no springs/waterfalls in the schema at all** → curated GeoJSON overlay required. Option: `--transportation_z13_paths` + `BUILD_VERSION` bump for earlier trail visibility |
| OSM route relations | ⚠️ | Only ~4 hiking relations touch the park — official marked trails are largely NOT in OSM as routes; our curated `trails.json` + GPX is the plan, not Waymarked Trails |
| OSM POI completeness | ⚠️ | Peaks/springs/shelters good; **guesthouses drastically under-mapped** (2 nodes) — accommodation/eating directory must be hand-curated |
| **SunCalc** (vendored) | ✅ | BSD-2; sun/moon/golden hour fully client-side, works offline |
| Attribution on map | required | "© OpenMapTiles © OpenStreetMap contributors" — both required (OMT license verified) |
| **Terrain (v2)** | ✅ feasible | AWS Terrain Tiles (terrarium) → build-time repack into raster PMTiles on `/cdn/`; MapLibre native hillshade + `maplibre-contour` (BSD-3) for contour lines; EU-DEM/Copernicus attribution |
| Webcams | ⚠️ link-only | Link resort/snow-forecast pages; embed only YouTube live streams (embeddability + winter liveness to verify); never hotlink images |
| Buses | ❌ no structured data | Zero GTFS for MK intercity buses (verified via Mobility Database/Transitland). Hand-curated timetable JSON with "last verified" date + disclaimer; point to stations for truth |
| Official park GIS | ❌ none open | No open geodata; boundary from OSM (not WDPA — restrictive terms); trail metadata = our own curation |
| pulse.eco sensors | ❔ v2 maybe | Gostivar/Tetovo instances nearest; license/CORS unverified |

---

## 7. Architecture & repo integration

### Standalone-first (explicit requirement)

The app must be fully usable at its own URL (`…/apps/mavrovo/`) with zero shell
involvement — shareable, bookmarkable, opened cold — while still being registered as a
tile in the shell's `apps` array. Concretely:

- **Embedding only adds, never enables.** The `embedded` class (set when
  `window.self !== window.top`) hides standalone-only chrome and swaps quit behavior
  (postMessage to the shell vs `location.href = '../../'`); no feature may depend on the
  shell being present.
- **Own front door.** Its own `<title>`, meta description, favicon and share/social tags —
  standalone visitors land directly, so the page presents itself and never assumes arcade
  context.
- **Own chrome when standalone.** A small header/back affordance visible only outside the
  shell (hidden via `.embedded`), same pattern the existing sub-apps use.
- **History discipline.** Internal navigation (tabs, POI sheets, language switch) must not
  push history entries while embedded — an iframe shares the parent's session history, and
  stray entries would break the shell's `popstate` close flow. Use `replaceState` /
  in-memory state when embedded; standalone may push state (so Back closes a sheet).

### Fit with the shell (from repo analysis)

- **Self-contained** `apps/mavrovo/` (own `index.html`, `styles.css`, `app.js`); no shared
  imports; no build step; CDN libs only as version-pinned unpkg URLs
  (`maplibre-gl@4.7.1`, `pmtiles@3.2.1` — same pins as Locator).
- **Registry entry — already in place** (as a locked tile) in the shell `app.js` `apps`
  array: `{ slug: 'mavrovo', name: 'Mavrovo', meta: 'Park', tagline: 'The park, in your
  pocket — trails, snow, lake.', icon: '🏔️', comingSoon: true, home: true }`. The
  `home: true` flag features it on the Home slide (user request). To go live: add
  `url: 'apps/mavrovo/'` (trailing slash required — deep-link matching is exact-string)
  and remove `comingSoon`.
- **Tile color — already in place** in both files: `--tile-mavrovo: #2e7d5b` (pine green)
  in `themes.css` plus the `.card[data-tile="mavrovo"]` mapping in `styles.css`. (The
  once-stale mapping block is fixed — all tiles are mapped now, and CLAUDE.md documents
  the two-file rule.)
- **Mandatory patterns:** inline splash before external CSS with **3000 ms** minimum
  (note: locator/snake drifted to 1000 ms against CLAUDE.md — copy the expenses/terrain
  value, not locator's), `embedded` class, quit via `postMessage({type:'close-game'})`,
  own `escapeHTML` for anything JSON-supplied that reaches `innerHTML`.
- **Map plumbing to copy from Locator:** pmtiles protocol registration, style building with
  re-registration on `style.load`, emoji→canvas map icons, the PMTiles HEAD probe +
  first-error pill + 10 s no-tiles watchdog (documented iOS-Safari-private-mode failure
  modes), geolocation with visible retry button + stall watchdog (iOS-in-iframe quirk).
  The shell iframe already grants `allow="geolocation"`.

### App data model (committed JSON inside `apps/mavrovo/`, Locator-style)

```
apps/mavrovo/data/park.json      # facts, fees, contacts — each with lastVerified
apps/mavrovo/data/pois.geojson   # curated POIs incl. springs/waterfalls overlay
apps/mavrovo/data/trails.json    # metadata + precomputed elevation profiles
apps/mavrovo/gpx/<trail-id>.gpx  # one GPX per trail
apps/mavrovo/data/status.json    # notices/lift status; updated via Claude sessions
apps/mavrovo/data/events.json    # annual rules + concrete dates
apps/mavrovo/data/i18n.json      # UI strings { mk, en }
```

Single committed files fetched relatively (Locator's `poi-profiles.json` pattern), **not**
the expenses build-script pattern — no per-file provenance need, and it avoids wiring three
build touchpoints. **Every runtime JSON fetch must self-bust** (`cache: 'no-cache'` or
`?t=Date.now()`): the deploy-time cache-buster only rewrites `.js`/`.css` refs, and GitHub
Pages serves 10-minute cache headers.

### Offline stance (explicit, honest)

The repo's preview model (immutable per-SHA URLs, production under a subpath) makes service
workers/PWA install a footgun — there is deliberately no SW anywhere in the repo. Therefore:

- **v1 offline = graceful degradation, not offline-first:** safety content inlined in the
  HTML; last-good weather/status cached in `localStorage` and shown with a "cached at" stamp
  when fetches fail; GPX downloads positioned as "save before you go"; app kept small and
  cache-friendly. Copy advises pre-downloading — mobile coverage in the park genuinely drops
  to nothing on high trails and in the Radika gorge.
- A production-only SW (registration guarded to the production origin+path) is *possible*
  later but needs an explicit decision to diverge from repo convention (§9).

### Pipeline touchpoints (only if/when v2 terrain lands)

New workflow step or job building `mavrovo`-area terrain PMTiles onto `/cdn/`; shares the
`pages-deploy` concurrency group; `BUILD_VERSION` bump forces region rebuilds. Not needed
for v1.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Resort facts are volatile (ownership changed Dec 2025; prices/domains move) | Link-outs + `lastVerified` stamps; never hard-code prices; status JSON is clearly manual |
| Hand-maintained data goes stale and quietly lies | Expiry dates on notices; "last verified" rendered prominently; stale (>N months) data auto-flags itself in UI |
| Korab border-zone guidance is legally fuzzy | Present the range of sources, tell users to confirm with border police / park info point; never present our text as authoritative permission |
| Emergency info wrong = real harm | 112 + PSS 13-112 both verified against primary sources; re-verify each release; phrase card reviewed by a Macedonian speaker |
| Content copyright (trail text/photos/tracks) | All prose original; geometry from OSM (ODbL) or own; photos own/CC-licensed only |
| demotiles glyph server (map labels) is a third-party single point of failure | Accept for v1 (Locator precedent); candidate fix: self-host the font PBFs on `/cdn/` later |
| iOS Safari in iframes: geolocation stalls, PMTiles blank-canvas in private mode | Copy Locator's mitigations wholesale (they exist because of these exact bugs) |
| Macedonian text + htmlhint `spec-char-escape` | Escape `&` `<` `>` in static HTML; Cyrillic itself is fine |
| Seasonal whiplash (app feels dead off-season) | Season-aware Today layout — the dashboard reorders itself by month, so winter opens on snow and summer on the lake |

---

## 9. Open questions (user input wanted)

1. **Name & tile.** `apps/mavrovo/` with icon 🏔️ and a pine-green tile — OK? App display
   name: "Mavrovo" (or "Mavrovo Park")?
2. **Languages.** MK + EN for v1 confirmed? Add Albanian in v2? (Structure supports it
   either way.)
3. **Winter priority.** Is v1.5 (ski section + webcams) wanted before this December, or is
   summer content the priority?
4. **Terrain pipeline (v2).** Hillshade/contours means a new CI job + CDN artifacts —
   appetite for that, or keep the flat vector map?
5. **Offline.** Accept the honest v1 stance (no service worker), or explore a
   production-only SW as a deliberate exception to repo convention?
6. **Maintenance.** Notices/bus times/lift status assume occasional Claude Code sessions to
   update `status.json` (the expenses model). Comfortable owning that cadence?

---

## 10. Fact sheet appendix

Verified facts, safe to publish in-app (source class in parentheses):

- Park: largest in North Macedonia, ~73,088 ha, proclaimed 19 Apr 1949 (encyclopedic).
- Park fee: **100 MKD/person/day** per the park's own price list, sold online and at the
  Mavrovi Anovi info point; no physical toll gate, enforcement is lax (official price list;
  spot-check `npmavrovo.mk/tickets` before publishing).
- Fishing: **300 MKD/day**, online permits; 2026 season Feb 1 – Oct 31 (multiple
  independent 2026 sources + park announcements).
- Info point: Mavrovi Anovi, ~500 m from the dam; issues activity permits;
  +389 42 489 425, infopoint@npmavrovo.org.mk; reported 08:00–18:00 daily (confirm hours
  by phone).
- Emergency: **112** live nationally since Feb 2022 (192/193/194 legacy still work);
  Mountain Rescue Service (ПСС) 24/7 SOS line **13-112** — published on pss.org.mk itself.
  112 operators may not speak English → phrase card.
- Winter equipment law: Nov 15 – Mar 15 (winter tires or chains carried; studs banned) —
  Ministry of Interior.
- Roads: the corridor is **A2 (E65)** Gostivar–Kičevo over Straža (there is no "A8");
  Mavrovo–Galičnik road is de facto closed by snow in winter (news-corroborated);
  live conditions via AMSM.
- Ski centre Zare Lazarevski: 15.5 km pistes, 13 lifts (3 chair + 10 surface),
  1,255–1,878 m (independent audit, skiresort.info); sold at public auction to Besian
  Holdings, completed ~Dec 2025, 2025/26 season ran; hotels Sport/Smrcha/Lodge reopened,
  Bistra unclear. 2025/26 day pass: adult 1,500 / youth 1,250 / child 1,050 MKD. All of
  this is volatile → link-outs.
- Galičnik Wedding: Petrovden weekend (~Jul 12); 2026 edition was Jul 10–12. Compute the
  weekend, verify dates annually.
- Korab mass ascent: annually ~Sep 8 (Independence Day), organized by PSD Korab, from
  Strezimir with police/army escort — the one straightforward window for the border route.
- Korab from the Macedonian side outside that day: official tourism site (reviewed
  Dec 2025) says no permit needed "today"; older sources say MoI permit; reports of
  unmanned posts. Publish as "rules vary — confirm with border police / park info point,
  carry a passport."
- Mavrovo Lake: dam built 1947–53, church submerged 1953; ~1,220 m altitude; ~357M m³
  (lake); level swings hard with drought/hydropower (2024–25 national reservoir crisis) —
  present shoreline/church visibility as variable.
- Bigorski monastery: publish soft hours ("daily roughly 8:00–19:00, seasonal, liturgies
  morning and evening") — official site publishes no visitor hours; dress code enforced.
- Balkan lynx: 20–39 mature individuals, Mavrovo = core area, 2025 study shows decline.
  No griffon vultures in the park (extirpated; only colonies are near Demir Kapija).
- Species (park's own figures): 129 birds, 50 mammals, 24 reptiles, 11 amphibians, 8 fish.
- Cash: ATMs in/around the park are very limited — advise withdrawing in Skopje/Gostivar;
  cards only at larger hotels/e-shops (multiple travel-finance sources; exact ATM locations
  unverified).
- Buses: Skopje–Mavrovi Anovi service exists (operator Hisar Turizam per aggregators;
  frequency unverified); no GTFS for MK intercity buses; frequent Skopje–Gostivar buses +
  onward taxi is the reliable fallback.
- Food: Hotel Tutto (Janče) verified operating — the region's destination restaurant;
  elsewhere dining is thin off-peak ("what's actually open" is a real content niche).
- Slow Food Presidium: "Mavrovo Reka mountain pasture cheeses" (Galičnik/Lazaropole
  transhumance tradition); no organized where-to-buy info exists — a gap this app could own.

**Re-verify at implementation time** (time-sensitive or single-source): park fee & info-point
hours (phone them), 2026/27 ski season status/prices, webcam liveness/embeddability,
bus timetable, Korab permit practice, Bigorski hours, lynx figure (use latest programme
number), lake-level talking points.

---

*Research provenance: five parallel research passes (park facts, audience needs, comparable
park/outdoor/municipal apps, data-source feasibility, repo integration analysis) + a
21-claim fact-check round, 2026-08-24. Comparable apps studied: US NPS app, Swiss National
Park app, Juliana Trail / Hohe Tauern (Outdooractive white-labels), AllTrails/Komoot/Wikiloc,
PeakVisor, ski-resort and municipal apps. One note on method: several key sites
(npmavrovo.org.mk, resortmavrovo.com) were unreachable from the research sandbox and were
assessed via search snippets — marked accordingly above.*
