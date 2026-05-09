# Data sources

Configuration for the daily **data-refresh** GitHub Action
(`.github/workflows/data-refresh.yml`). Each file in this directory
declares one *type* of upstream data; the action reads them, downloads
the listed assets, and publishes the result to the live site under
`/cdn/<type>/`.

## Layout

```
data-sources/
  maps-osm.txt        # OSM PBF extracts (Geofabrik) — one region per line
```

Add new files here as new data types are introduced — for example a
future `tide-tables.txt`, `gtfs-feeds.txt`, etc. The workflow can be
extended in lockstep to handle each.

## How it lands on the site

The action publishes downloaded files to the `gh-pages` branch under
the top-level `cdn/` directory (with `keep_files: true`, so the rest
of the deploy is untouched). For OSM PBF:

| Source                                                   | Served at                                                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `data-sources/maps-osm.txt` line for `north-macedonia`   | `https://xhevops-claude.github.io/claude-default/cdn/maps/osm/north-macedonia.osm.pbf`   |

The `cdn/` tree on `gh-pages` is intentionally **decoupled from the
app source** — apps fetch from the URL, never from a path inside the
repo. That keeps app code free of large binaries and lets the data
refresh on its own cadence.

## Schedule

The action runs daily at **05:30 UTC** (after Geofabrik's nightly
rebuild around 02:30 UTC) and on `workflow_dispatch` for manual
runs. Geofabrik rebuilds extracts daily and explicitly intends them
to be polled — fetching one region per day per slug is well within
their fair-use guidelines.

## Adding a new region

1. Open `maps-osm.txt`.
2. Add a line with `<slug> <url>`, where `<url>` points to a regional
   `.osm.pbf` on Geofabrik (browse [download.geofabrik.de](https://download.geofabrik.de)).
3. Commit. The next scheduled run picks it up; or run the workflow
   manually from the Actions tab to fetch immediately.
