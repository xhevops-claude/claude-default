# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication style

Talk to the user like a person, not a report. Keep replies short and conversational — a couple of sentences, not multi-paragraph write-ups. Lead with the answer or what changed; skip exhaustive bullet lists, feature recaps, and restating things they already know. Add detail only when asked.

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

Every sub-experience's `index.html` ships a `#game-loading` (or `#app-loading`) element painted by an inline `<style>` block in `<head>`, BEFORE any external `<link rel="stylesheet">`. This guarantees a black/branded splash on the very first frame, before `styles.css` resolves. The sub-experience's `app.js` removes it as soon as the experience is ready — there is no artificial minimum display time (an earlier "hold for 3 s" rule was removed to make apps load faster). Don't move this CSS to `styles.css` — the whole point is that it paints before that file loads.

### Theme system

`themes.css` defines five palettes via `[data-theme="..."]` selectors: `noir`, `bone`, `steel`, `jade`, `ember`. `theme.js` reads `localStorage.getItem('arcade-theme')`, falls back to `prefers-color-scheme`, applies `document.documentElement.dataset.theme`, and dispatches a `themechange` CustomEvent. The shell's `index.html` runs an inlined boot script BEFORE `themes.css` loads to set the attribute pre-paint and avoid a flash. Sub-experiences are NOT themed — they ship their own palette. If you add a theme, update both `themes.css` and the `THEMES` array in `theme.js` and the `valid` array in `index.html`'s boot script.

## Deployment

`.github/workflows/pages.yml` deploys every push using `peaceiris/actions-gh-pages` with `keep_files: true`:

| Branch | Path |
|---|---|
| `main` | `/` |
| any other | `/preview/<slug>/<short-sha>/` where `<slug>` = branch name with `/`, `_`, ` ` → `-` and lowercased, and `<short-sha>` = the 7-char commit SHA |

So pushing commit `abc1234` to e.g. `claude/foo-bar` deploys to `https://xhevops-claude.github.io/claude-default/preview/claude-foo-bar/abc1234/`. Production and previews coexist on `gh-pages` because of `keep_files: true`.

Each push gets its own immutable, SHA-keyed preview URL, so the browser never serves a cached copy of a stale build. A "Prune this branch's previous preview" step deletes the branch's *old* `preview/<slug>/` directory (operating on `gh-pages` via a worktree) before the new SHA dir is published — old preview deleted, new one added. Production (`main` → `/`) and other branches' previews are never touched. Because the preview URL changes every push, you can't bookmark a stable per-branch preview link; grab the latest from the deploy notice / the reply's final line.

The `exclude_assets` list in `pages.yml` controls what gets excluded from the deploy. If you add a new top-level dev-only file/dir (lockfiles, configs, docs), append it there.

### Asset cache-busting

Source HTML references local `.js`/`.css` with bare relative paths (`<script src="app.js">`, `<link rel="stylesheet" href="styles.css">`) — no `?v=` query strings in the repo. The "Cache-bust local assets" step in `pages.yml` rewrites every relative `.js`/`.css` ref to append `?v=<short-sha>` before the deploy lands on `gh-pages`. This applies to both production and preview deploys.

Don't add `?v=` query strings manually to source HTML — they'd be redundant with the deploy-time rewrite and would also break the `htmlhint` lint rule. CDN-pinned URLs (`https://unpkg.com/foo@1.2.3/...`) already have version tokens in the path and aren't touched by the rewrite. If you introduce a new local asset type (say, a `.wasm` or a `.json` config that has to bypass cache), extend the `sed` alternation in `pages.yml` accordingly.

### Verify the deploy is actually served before sharing any link

The `Deploy` workflow going green only means files landed on the `gh-pages` **branch**. GitHub then runs its own `pages-build-deployment` workflow (1–2 min more) to publish that branch to the CDN — and because each push writes two `gh-pages` commits (preview prune + publish), the first Pages build is usually cancelled and restarted. A link shared before that finishes 404s.

So before posting a preview/production link: poll the `pages-build-deployment` workflow (workflow id `273363858`, via the GitHub MCP actions tools) until the latest run is `completed`/`success` **and** its `head_sha` equals the current `gh-pages` tip (`git fetch origin gh-pages && git rev-parse FETCH_HEAD`), and confirm the tip tree contains the path you're linking (`git ls-tree FETCH_HEAD:<path>`). Only then share the link.

**Every poll has a hard cap.** Never loop on a URL or a branch tip open-endedly: bound each wait (about 4 minutes for the gh-pages landing, about 5 minutes for the Pages publish; use `curl --max-time` and a counted loop). When a cap is hit, do not just retry — check the run statuses via the GitHub Actions tools: the branch's `CI` and `Deploy` runs (`list_workflow_runs` filtered by branch), then the latest `pages-build-deployment` run and its `deploy` job log. A `pages-build-deployment` run that is `cancelled` right after a push is normal (the prune commit's build is superseded by the publish commit's); one that ends in `failure` with the log stuck on `Current status: updating_pages` then `Timeout reached, aborting!` is a GitHub-side publish hang, not a content problem. The MCP integration cannot re-run or dispatch workflows (403), so recover by pushing a real commit to the branch (a genuine tidy-up, never an empty commit), which re-runs `Deploy` and starts a fresh Pages publish.

After such a hang, the next publish can fail fast (under a minute) with `Deployment request failed ... due to in progress deployment. Please cancel <sha> first` — GitHub still holds the hung deployment as active and rejects every new one until it is cancelled or expires. Nothing from this session can clear it: the Pages deployments API is blocked by the proxy and Actions re-runs are 403, and the user works from the sandbox too (no `gh`). It does expire on its own (seen: stuck at 11:15, still blocking at 11:43, publishing again by 14:38), so don't burn pushes on it: tell the user, then retry with a real commit after a decent wait (an hour or more). If the user does have `gh` somewhere, the fast path is `gh api -X POST repos/xhevops-claude/claude-default/pages/deployments/<stuck-sha>/cancel` with the gh-pages SHA from the error, then a new push.

### Always end with a clickable preview link

After pushing changes, the final line of every reply must be a clickable Markdown link to the deployed preview, in the form `[Preview](https://xhevops-claude.github.io/claude-default/preview/<slug>/<short-sha>/...)`, where `<short-sha>` is the 7-char SHA of the commit you just pushed (`git rev-parse --short=7 HEAD`). No bold, no surrounding `**`, no extra prose on that line — just the link. If the change targets a specific sub-experience, deep-link directly into it (e.g. `.../preview/<slug>/<short-sha>/apps/locator/`). If pushed to `main`, link to the corresponding production path under `https://xhevops-claude.github.io/claude-default/`.

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

## Expenses ledger (apps/expenses/)

The Expenses app is a read-only construction-cost ledger whose writes happen through Claude Code sessions. Source of truth is committed per-expense files, aggregated at deploy time:

- `apps/expenses/data/meta.json` — `baseCurrency`, `fixedRates` (MKD pegged at 61.5 per EUR).
- `apps/expenses/data/projects.json` — project registry (`id` slug, `name`, `icon`); the app shows one project at a time via the header picker.
- `apps/expenses/data/categories.json` — category registry, **shared across projects**; each category declares its own `fields`, so new expense types need data changes only.
- `apps/expenses/data/expenses/<project-id>/<yyyy>/<mm>/<id>.json` — one expense per file; the top folder is the project (must match a `projects.json` id), the date folders derive from the expense's ISO UTC `date`. Filename must equal the expense `id` (a GUID). When adding an expense, ask which project it belongs to if it isn't obvious.
- `apps/expenses/files/<guid>.<ext>` — attachment originals; metadata keeps `originalName` (used as label and download name) and `size` (must match the file on disk).
- `apps/expenses/data/expenses.json` is **generated** by `scripts/build-expenses-data.mjs` (run automatically by `pages.yml` on deploy and by `npm run dev` via `predev`). It is gitignored — never edit or commit it. CI runs the script with `--check` to block malformed data.

Adding an expense from an uploaded document: store the file under a GUID in `files/`, transcribe **all readable text verbatim** (original script — e.g. Macedonian Cyrillic) into the attachment's `extractedText` field for future content search, compute the file's `sha256` (`sha256sum <file>`) into the attachment metadata, write the per-expense JSON, then land it on `main` via the normal PR + green CI flow. The user confirms extracted details before anything is committed.

### Duplicate check (mandatory before writing any expense)

Do this with `grep` only — never read expense files in bulk; the check must cost the same at 10,000 expenses as at 20:

1. **Exact re-upload:** `grep -rl "<sha256-of-new-file>" apps/expenses/data/expenses/` — a hit means this exact document is already attached to an expense.
2. **Same invoice, different photo:** `grep -rl '"amount": <amount>' apps/expenses/data/expenses/<project-id>/<yyyy>/` then narrow the (few) hits by currency/date/vendor, and compare invoice/reference numbers against the new document's text. (The `sha256` check stays global across projects; the semantic check is per project, matching the validator.)

### On detection: always prompt, and batch the prompts

A suspected duplicate is never resolved in prose or by guessing — put an explicit choice in front of the user with the AskUserQuestion tool:

- **Single bill:** show the matching existing expense (vendor, date, amount, its attached file) next to the new bill's extracted details, and ask with options like **Skip — already recorded** / **Add as intentional duplicate**. Do not write anything for that bill until one of those is picked.
- **Batch upload (several bills at once):** extract and duplicate-check *all* files first, then raise all suspects together in one prompt round — one question per suspected bill, each self-contained (new bill vs. matching expense) so it can be answered without scrolling back. AskUserQuestion takes up to 4 questions per call; chunk into consecutive calls if there are more. Clean bills are written without prompting; skipped bills are dropped entirely.

Only a bill the user explicitly confirmed gets `"allowDuplicate": true`. The build script remains the backstop: CI fails on duplicate `sha256` or duplicate date+amount+currency+vendor without that flag, so an unconfirmed duplicate cannot merge either way.

## Forecast planner (apps/forecast/)

A forward-looking cash-flow calculator. Like Expenses it is read-only in the
browser and its numbers are committed JSON under `apps/forecast/data/` — but the
files are small and hand-maintained, so there is **no build step and no
aggregate**; `app.js` fetches each file directly.

| File | Holds |
|---|---|
| `meta.json` | `baseCurrency`, `fixedRates` (units per 1 EUR — MKD pegged at 61.5, USD an assumption), `startMonth` (`"auto"` = current month), `horizonMonths`, `startingSavings`, `rollover` |
| `income.json` | `workday` (either `amount` or `hourlyRate` + `hoursPerDay`, in any currency), the `payCycle`, plus an `additional` array of extra income |
| `loans.json` / `liabilities.json` | debts — same shape, two lists, one engine |
| `budget.json` | fixed monthly budget lines (`chargeDay` is only the fallback for a month with no pay) |
| `extras.json` | unplanned one-off expenses, drawn from savings |
| `calendar.json` | per-month work-day `adjustments` (`days: -2`, optional `period` to pin it to one half of the month) |

Everything is computed in EUR internally (the MKD peg makes that lossless) and
converted only for display; the header toggle switches EUR/MKD.

**Cash, not accrual.** This is the part to hold on to: money counts on the day
it lands, not the day it was earned. `payCycle` declares the earning periods
(1–15 and 16–end), `netDays` and `transferWorkingDays`; a period closes, the net
days elapse, the first working day on or after that is the Toptal payout, and one
more working day puts it in Wise. Under net-20 that means **the income you see in
October is September's work**, and a month's cash-in depends on the *previous*
month's work-day count.

Each debt declares `installments` — `[{ payPeriod, amount }]` — so a loan can be
split across the two pays (Tani takes €1,000 from each). An instalment falls due
on the day its pay lands. `monthlyPayment` is only a fallback for a debt with no
`installments`; the monthly total is otherwise derived by summing them.

**The budget follows the pays, not the calendar.** It is not charged on a fixed
day: each pay hands over whatever it still holds once its own instalments are
met, and what the first pay could not cover rolls to the next one. The last pay
of the month clears the remainder whether it can afford it or not — the money
still has to be spent. Amounts therefore settle during the walk, not when the
events are created. `chargeDay` is only the fallback for a month where no pay
lands at all.

**The engine.** `build()` walks the horizon month by month. Interest is charged at
the top of each month on the opening balance (`balance × annualRate/12`);
everything else is an event on a real date — pay arrivals, instalments, the budget
charge on its `chargeDay`, unplanned expenses — applied in date order, income
before outgoings on a shared day, so the running balance is what the account would
actually show. All debts share the one simulation because they interact: a cleared
debt's instalment becomes a pool that cascades down the `priority` order when
`rollover` is on, or falls through to savings when it is off. `priority` is an
integer, 1 first, unique across both lists. A debt whose instalments are below its
monthly interest is flagged `stalled` rather than looping forever.

Savings are the residual: `income − fixed budget − debt payments − unplanned`,
accumulated across the horizon. `startingSavings` in `meta.json` seeds the opening
balance — leave it at 0 and the first weeks can read negative, which is honest
rather than a bug.

**The Timeline is the home view** and it leads with what is still ahead rather
than the first of the month. `build()` marks `model.nextPay` (the earliest pay
arrival on or after today) and that headlines the view, but the list's floor is
**today**, not the pay date — an expense falling between the two is still money
to find, and hiding it would make the running balance jump without explanation.
Months entirely behind are dropped and the one it starts mid-way through is
totalled from what is left ("Rest of Sep"). The simulation itself still runs from
the start of the month — the filter is presentation only, so the loan and budget
bookkeeping behind the opening balance stays whole.

**Adding entries.** Append to the relevant array — every item needs a unique `id`
(used as the ledger toggle key) and `active`. Seed rows Claude invented carry
`"sample": true`, which paints a "sample" tag and the banner; drop the flag as
real numbers replace them. Nothing the user changes in the UI (currency, sliders,
row toggles) persists — it is a session-only overlay on the committed data.

## Conventions worth preserving

- **Every page kills double-tap-to-zoom.** Put `touch-action: manipulation` on
  `html, body` — in the shell's `styles.css`, and in each sub-experience's own
  `styles.css` *and* its critical inline block so it applies on the first frame.
  It suppresses the browser's double-tap zoom (and the tap delay that rides with
  it) while leaving pinch-zoom alone, so it costs nothing in accessibility. Two
  quick taps on a stepper, a tab or a list row must never zoom the page. Prefer
  this over `user-scalable=no` / `maximum-scale=1` in the viewport meta, which
  also blocks pinch-zoom; the few experiences that own their gestures wholesale
  (`crusaders`, `crusaders3d`, `terrain`, `buildtrack`) predate the rule and set
  the viewport meta instead. A surface that drives its own drag gestures still
  narrows further where it needs to — `touch-action: pan-y` on the shell's pager
  and on Forecast's chart, `none` on a game canvas — and that wins over the
  global rule for those elements.
- `escapeHTML` in `app.js` is used for any user-supplied or registry-supplied string interpolated into innerHTML. Anything that ends up in `cardHtml`/`cardInner` MUST go through it.
- Prefer adding `comingSoon: true` (with no `url`) over removing entries — the shell renders these as locked tiles with a shake animation on tap.
- Tile colors come from CSS variables `--tile-<slug>` defined in `themes.css` — these are constant across themes so each card keeps its identity. Add a `--tile-<newslug>` when adding a tile.
- Don't introduce a build tool, package, or framework just to add one feature. The "no build step" property is what makes preview deploys, deep links, and the static CDN model work.
