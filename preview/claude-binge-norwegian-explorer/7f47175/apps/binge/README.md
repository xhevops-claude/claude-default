# Binge

Binge works through YouTube channels from their first upload to their latest,
the way you'd binge a series. Each channel keeps a **watched-up-to date**, the
list shows what's left in order, and the date sliders let you hold the list to
a point in time ("everything up to May 2015") so you can catch up from there.

Live: `https://xhevops-claude.github.io/claude-default/apps/binge/`.
Self-contained like every sub-experience (`index.html`, `styles.css`, `app.js`,
no shared code); the shell embeds it in an iframe.

**Keep this file current.** A change to what Binge does, stores or syncs
updates the matching section here in the same commit.

## Files

| File | What |
|---|---|
| `index.html` | markup, the inline loading splash, the SVG icon sprite |
| `styles.css` | everything visual (dark only) |
| `app.js` | the whole app, one IIFE |
| `groups.json` | the groups (bundles) shown as tabs |
| `db.json` | the shared baseline every device starts from (see *Sync*) |

The videos themselves are not in the repo — see *Data*.

## Data

`.github/workflows/youtube-refresh.yml` (daily 04:30 UTC, and on any push to
`data-sources/youtube-channels.txt`) scrapes every channel listed in
`data-sources/youtube-channels.txt` with yt-dlp and publishes to `gh-pages`:

- `cdn/youtube/<slug>.json` — one per channel: `name`, `count`, `url`, and
  `videos[]` with `id`, `title`, `duration`, `ts` / `d` (dates), `vc` (views).
- `cdn/youtube/index.json` — the channel list the app reads first.

With the `YT_API_KEY` secret every video gets its exact publish date; without
it only recent ones do and the rest get a year. When any video in play lacks a
full date, the cutoff collapses to years (Month/Week/Day sliders hide).

**Add a channel:** append `<slug> <channel-url>` to
`data-sources/youtube-channels.txt` and push. To put it in a group, add the
slug to that group in `groups.json`.

## Screen

- **Sidebar** (docked on wide screens, a drawer on phones — swipe in from the
  left edge): the group list, each row with its own **Today ⇄ date flip** and a
  progress ring; then *Sync across devices* and *Quit to arcade*.
- **App bar**: the active group, "N left" (tap for watched / total), and the
  active group's flip.
- **Toolbar**: group by (Year · Bundle · Channel — Bundle only on All), sort
  (oldest · newest · most viewed), and the filters funnel (dot = a filter is
  narrowing the list).
- **Filters**: the group's channel switches (each with its watched-up-to date
  and video count, *Select all* / *Clear all*), **Show up to** sliders —
  Year, Month, Week, Day — and *Show already-watched videos* / *Clear watched*.
  The sliders only show while the flip is on a picked date, not Today.
- **List**: collapsible sections (by year, bundle or channel) with a
  watched / total count and a mark-all check; list or grid view; expand /
  collapse all.
- **Player**: the embedded YouTube player with *Watched & next* and *Skip*.
  A video that can't be embedded says so and links to YouTube.

On touch, a tap arms a card for 5 s instead of acting at once: the thumbnail
splits into *Tap to watch* / *Watch on YouTube*, and the check shows a confirm
square beside it. Tapping anywhere else cancels. Marking watched raises an
**Undo** toast.

## Groups

`groups.json` lists the groups: `{ id, name, channels: [slug] }`. A channel may
sit in several. **All** is built in and holds every channel.

Each group remembers its own settings, independently: which channels are on,
the cutoff and the Today flip, show-watched, group-by, sort, and per group-by
the list/grid view and collapsed sections.

## Watched progress

Per channel, one date: `binge-watchedto[slug] = yyyymmdd`. A video is watched
when its date is on or before its channel's date. Marking a video watched moves
the date forward to it (never back); unmarking pulls it back to the channel's
previous upload. A section's mark-all does the same per channel across the
section. There is no per-video list.

## The cutoff (Show up to)

The list holds videos published **on or before** the cutoff. **Today** (the
flip on) follows the clock; off, the picked date from the sliders applies.

- **Year** — one slot per year from the first upload to now.
- **Month** — 12 slots.
- **Week** — Monday–Sunday weeks *of the selected month*, cut at the month's
  edges, so the first and last weeks can be a day or two long and never reach
  into the neighbouring month or year. Picking a week sets the cutoff to its
  last day inside the month.
- **Day** — one slot per day of the month.

The sliders never go earlier than the group's first upload.

## When the list runs dry

If everything up to the cutoff is watched, the empty panel says when the next
unwatched video landed and how far off that is, and offers:

- **Skip to** that date;
- **Week of …** / **All of …** — the end of the week / month that next video
  lands in, so the whole stretch comes in at once;
- **Next day / week / month / year** — a plain step, each labelled with how
  many videos it would add.

## Sync across devices

There is no backend and no account. Each device keeps its state in
`localStorage` (keys below); `db.json` is the **shared baseline**.

On load the app merges `db.json` in:

- **Watched dates:** the later date per channel wins, so progress is never lost.
- **Everything else:** filled in only where the device has nothing — *unless*
  `db.json`'s `binge-rev` is newer than the device has applied. Then the
  baseline's groups, channel choices, filters and layout replace the device's
  once, and the rev is remembered. That is how a saved baseline reaches every
  device, a TV included, with nothing to clear by hand; changes made on the
  device afterwards stick until the next rev.

Open copies of Binge on the same site (tabs, the arcade iframe, preview links
— they share one storage) follow each other's changes live, so one can't
write stale state back over another.

**The sync page:**

- **Copy my data** — exports the switched-on parts (watched progress, channel
  selection, groups & filters, view & layout) as JSON. Channel selection is
  written as `on` for every group.
- **Merge pasted data** — pulls an export into this device (same rules as the
  baseline, without a rev).
- **Clear this device** — two taps (the first turns it solid red: *Tap again to
  clear*); removes every `binge-*` key and reloads from the baseline. Other
  apps' storage is left alone.

**Saving a baseline** (done by Claude when the user pastes an export): merge it
into `db.json` — watched dates take the later per channel, everything else the
export's value — and **bump `binge-rev`**. Without the bump, devices that
already have settings keep theirs.

## Stored keys

| Key | Holds |
|---|---|
| `binge-watchedto` | `{ slug: yyyymmdd }` — watched up to, per channel |
| `binge-tabs` | per group: `on` (channels switched on), `cutoff`, `live` (Today), `showWatched`, `group`, `sort`, `views: { [groupBy]: { view, collapsed } }` |
| `binge-tab` | the active group id |
| `binge-sidebar` | desktop: sidebar expanded or collapsed |
| `binge-rev-applied` | the last `db.json` rev this device took |
| `binge-view`, `binge-sort`, `binge-group`, `binge-cutoff`, `binge-showwatched` | pre-groups globals; only seed a group with no setting yet |

Older formats still read, never written: a group's `off` (channels switched
off) in place of `on`, `binge-selected` (the pre-groups channel list, folded
into All once and removed), and `binge-watched` (per-video ids, folded into the
watched dates).
