# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm install
npm run dev            # http://localhost:8080  (npx serve@14)
npm run lint           # lint:html + lint:css
npm run lint:html      # htmlhint with .htmlhintrc
npm run lint:css       # stylelint with .stylelintrc.json
```

There is no test runner. CI (`.github/workflows/ci.yml`) additionally runs `node --check` against every `*.js` file outside `node_modules`; reproduce it locally with:

```sh
shopt -s globstar nullglob; for f in **/*.js; do [[ "$f" == node_modules/* ]] || node --check "$f"; done
```

CI runs on pull requests to `main` and on every push to a non-`main` branch.

## Architecture

### Static, no build step

The site is plain HTML/CSS/JS served as files. There is no bundler, no framework, no transpile step — `npm run dev` just statically serves the repo root. Anything that works in a modern browser works in production.

### Shell vs. embedded experiences

The repo is a "shell" home page (`index.html`, `styles.css`, `app.js`, `theme.js`, `themes.css`) that hosts independent sub-experiences in `games/<slug>/` and `apps/<slug>/`. Each sub-experience is fully self-contained: its own `index.html`, `styles.css`, `app.js`, no shared imports. The shell embeds them via `<iframe>`. That isolation is load-bearing — do not try to pull a sub-experience's JS/CSS into the shell or vice versa.

### Tile registry → grid → iframe morph

`app.js` declares two arrays at the top: `games` and `apps`. Each entry needs `{ slug, name, meta, tagline, icon, url }` (or `comingSoon: true` and no `url`). The arrays drive the rendered grid tiles, the iframe loader, and deep-link resolution. Adding a tile = create `games/<slug>/` (or `apps/<slug>/`) and append one entry to the relevant array.

When a tile is tapped, `openGame` positions `#frame-wrap` over the tapped card's bounding rect with `transform: translate(...) scale(...)`, then transitions to fullscreen. A `.frame-skin` layer paints the card art on top of the loading iframe and crossfades out — `ZOOM_MS` (550ms) is the wrap's size animation, and the skin/frame crossfade is intentionally faster (220ms in CSS) so the morph reads as the card *becoming* the experience. `closeGame` runs the same animation in reverse. If you change the timing in CSS, mirror it in `ZOOM_MS`.

### Section pager (Home / Apps / Tools / Games)

The IIFE labelled `pager()` in `app.js` is a transform-driven barrel carousel — there is no scroll container and no DOM clones. `pos` is a continuous float; `paint()` places each slide at its visually-nearest copy via `((d % N) + N) % N`. After settle, `pos` is renormalised back into `[0, N)` to stay bounded. Touch uses Pointer Events with axis detection (`DIR_LOCK_PX = 8`) so vertical pans inside a grid still scroll natively. A swipe that ends over a card sets `suppressClickUntil` to swallow the click that would otherwise open the game — preserve this when changing gesture handling.

### Deep linking and embedded close

- The shell pushes `#games/<slug>/` (or `#apps/<slug>/`) to history on open and listens for `popstate` to close. The deep-link IIFE at the bottom of `app.js` opens the matching tile if the page loads with such a hash.
- Embedded experiences must NOT navigate the parent. Their "Quit" button posts `{ type: 'close-game' }` to `window.parent`; the shell's `message` handler triggers `history.back()` (or `closeGame()` directly). When standalone (`window.self === window.top`), the same button does `location.href = '../../'`. Both games already implement this — copy the pattern.
- Each sub-experience adds `embedded` to `<html>` when iframed: `if (window.self !== window.top) document.documentElement.classList.add('embedded');`. CSS uses `.embedded` to hide elements that don't belong inside the shell (e.g. back links).

### Loading screens (mandatory pattern)

Every sub-experience's `index.html` ships a `#game-loading` (or `#app-loading`) element painted by an inline `<style>` block in `<head>`, BEFORE any external `<link rel="stylesheet">`. This guarantees a black/branded splash on the very first frame, before `styles.css` resolves. The sub-experience's `app.js` removes it once ready AND at least 3 seconds have elapsed. Don't move this CSS to `styles.css` — the whole point is that it paints before that file loads.

### Theme system

`themes.css` defines five palettes via `[data-theme="..."]` selectors: `noir`, `bone`, `steel`, `jade`, `ember`. (The README lists older names like `dark`/`light`/`space` — those are stale; use the actual five.) `theme.js` reads `localStorage.getItem('arcade-theme')`, falls back to `prefers-color-scheme`, applies `document.documentElement.dataset.theme`, and dispatches a `themechange` CustomEvent. The shell's `index.html` runs an inlined boot script BEFORE `themes.css` loads to set the attribute pre-paint and avoid a flash. Sub-experiences are NOT themed — they ship their own palette. If you add a theme, update both `themes.css` and the `THEMES` array in `theme.js` and the `valid` array in `index.html`'s boot script.

## Deployment

`.github/workflows/pages.yml` deploys every push using `peaceiris/actions-gh-pages` with `keep_files: true`:

| Branch | Path |
|---|---|
| `main` | `/` |
| any other | `/preview/<slug>/` where `<slug>` = branch name with `/`, `_`, ` ` → `-` and lowercased |

So pushing to e.g. `claude/foo-bar` deploys to `https://xhevops-claude.github.io/claude-default/preview/claude-foo-bar/`. Production and previews coexist on `gh-pages` because of `keep_files: true`.

The `exclude_assets` list in `pages.yml` controls what gets excluded from the deploy. If you add a new top-level dev-only file/dir (lockfiles, configs, docs), append it there.

### Asset cache-busting

Source HTML references local `.js`/`.css` with bare relative paths (`<script src="app.js">`, `<link rel="stylesheet" href="styles.css">`) — no `?v=` query strings in the repo. The "Cache-bust local assets" step in `pages.yml` rewrites every relative `.js`/`.css` ref to append `?v=<short-sha>` before the deploy lands on `gh-pages`. This applies to both production and preview deploys.

Don't add `?v=` query strings manually to source HTML — they'd be redundant with the deploy-time rewrite and would also break the `htmlhint` lint rule. CDN-pinned URLs (`https://unpkg.com/foo@1.2.3/...`) already have version tokens in the path and aren't touched by the rewrite. If you introduce a new local asset type (say, a `.wasm` or a `.json` config that has to bypass cache), extend the `sed` alternation in `pages.yml` accordingly.

### Always end with a clickable preview link

After pushing changes, the final line of every reply must be a clickable Markdown link to the deployed preview, in the form `[Preview](https://xhevops-claude.github.io/claude-default/preview/<slug>/...)`. No bold, no surrounding `**`, no extra prose on that line — just the link. If the change targets a specific sub-experience, deep-link directly into it (e.g. `.../preview/<slug>/apps/locator/`). If pushed to `main`, link to the corresponding production path under `https://xhevops-claude.github.io/claude-default/`.

### Branch names — match the work

Branch names should describe what's on the branch. Use the pattern `claude/<short-kebab-descriptor>` (lowercase, dashes, no random suffixes), e.g. `claude/terrain-app`, `claude/locator-cluster-fix`, `claude/cdn-pipeline-retry`. If the work pivots mid-branch (you started on X and ended up shipping Y), rename the branch before opening the PR so the name still tells the truth.

Auto-generated names like `claude/add-claude-documentation-0XFkn` get reused across unrelated work and end up meaning nothing. Don't keep them — rename on first push (`git branch -m`) or, if a PR is already open with a stale name, mention it to the user and offer to migrate.

### Merging to main — always via a PR with green CI

Direct pushes to `main` are blocked. To land changes on production:

1. Open a pull request from the feature branch into `main`.
2. Wait for CI on the PR to go green — the `lint` and `node --check` jobs in `.github/workflows/ci.yml` plus the preview deploy in `pages.yml`. Inspect any failures and fix them before merging; do not merge a PR with a red or pending check unless the user explicitly tells you to override.
3. Only then merge the PR (default to a normal merge commit so the feature-branch history stays inspectable; squash if the user asks).

This applies even when the user just says "merge it" — the PR + green-checks loop is the merge mechanism, not an extra step.

## Data pipeline (cdn/)

Two scheduled workflows publish open data to `gh-pages` under `/cdn/`, **decoupled from the app source** — apps fetch from `https://xhevops-claude.github.io/claude-default/cdn/...`, never from a path inside this repo. The repo `.gitignore` excludes `cdn/`.

- `data-refresh.yml` (05:30 UTC daily): for each `<slug> <url>` in `data-sources/maps-osm.txt`, compares the upstream `.md5` sidecar (Geofabrik) to the one currently on `gh-pages` (read via `git show origin/gh-pages:<path>`, NOT HTTP — Pages republish lag would cause races). If different, downloads the PBF, validates it (rejects HTML responses and files <100KB), verifies MD5, and republishes. Skips if all regions match.
- `tiles-build.yml` (`workflow_run` after data-refresh): for each region, checks a `<pmtiles>.source-md5` sidecar containing `<source-md5> <BUILD_VERSION>`. If either the source MD5 or `BUILD_VERSION` changed, runs Planetiler to (re)build PMTiles. Bump the `BUILD_VERSION` env var in the workflow whenever the renderer or schema changes meaningfully — this forces every region to rebuild.

Both workflows share a `concurrency: pages-deploy` group with `pages.yml` to serialize `gh-pages` writes.

## Conventions worth preserving

- `escapeHTML` in `app.js` is used for any user-supplied or registry-supplied string interpolated into innerHTML. Anything that ends up in `cardHtml`/`cardInner` MUST go through it.
- Prefer adding `comingSoon: true` (with no `url`) over removing entries — the shell renders these as locked tiles with a shake animation on tap.
- Tile colors come from CSS variables `--tile-<slug>` defined in `themes.css` — these are constant across themes so each card keeps its identity. Add a `--tile-<newslug>` when adding a tile.
- Don't introduce a build tool, package, or framework just to add one feature. The "no build step" property is what makes preview deploys, deep links, and the static CDN model work.
