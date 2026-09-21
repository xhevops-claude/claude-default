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

## Private data is encrypted (read this before touching apps/expenses or apps/forecast)

Both of those apps hold real personal finances, and this repo is public with a
static site — so anything the browser can fetch, anyone can fetch. A login
screen would be theatre; only the encryption is real. **Their data is not in
the repo in plaintext and a fresh clone cannot read it.**

What is committed:

| Path | What |
|---|---|
| `apps/<app>/data/vault.json` | the app's data, encrypted |
| `apps/expenses/files/<guid>.<ext>.enc` | one attachment each, `iv‖ciphertext` |

Everything else under `apps/forecast/data/`, `apps/expenses/data/` and
`apps/expenses/files/` is gitignored. It exists only on a machine that has
unlocked it, so **a fresh clone starts with no readable data — that is correct,
not a broken checkout.**

### Working on that data

The secret is a passphrase and a PIN. **Ask the user for both; never invent
them, and never commit them.** Then:

```sh
export FORECAST_PASSPHRASE='…' FORECAST_PIN='…'   # from the user, this session only
node scripts/vault.mjs unlock       # vault -> plaintext working files
#   … edit apps/<app>/data/** as usual …
npm run build:data                  # expenses only: rebuild the aggregate first
node scripts/vault.mjs lock         # plaintext -> vault + .enc
node scripts/vault.mjs scrub        # optional: delete the plaintext again
```

`lock` reuses the data key already in the vault, so attachments encrypted
earlier keep opening. Commit only `vault.json` and the `.enc` files — the
gitignore already enforces this, so if plaintext ever shows up in
`git status`, something is wrong; stop rather than committing it.

### How it is built

AES-256-GCM under a key from PBKDF2-SHA256 at 600k iterations. The secret is
the passphrase and the PIN joined by `\u0000`, which neither can contain —
`scripts/vault.mjs` and both apps do that join, and **all three must agree or
nothing opens**.

Envelope: a random data key encrypts the content and the passphrase only
encrypts *that key*. So `rekey` changes a passphrase by rewriting ~100 bytes
instead of every file, which is what stops each password change adding another
copy of the attachments to a public repo's history forever (ciphertext does not
compress). `rekey --full` mints a new data key and re-encrypts everything, which
is the only thing that locks out someone who already has the old data key.

Both vaults share a salt and a data key on purpose, so one unlock covers the
whole site. In the browser the **wrapping** key is cached in localStorage under
`forecast-key-v1` — never the passphrase — so it is asked for once per device,
and a passphrase change still re-gates everyone because the new salt makes every
cached key useless. The lock button clears it immediately.

The crypto helpers are duplicated in each app rather than imported, because
sub-experiences share no code by design (see above). They must stay in step.

**Gotcha worth remembering:** a `[hidden]` lock screen with `display: flex` stays
laid out and silently swallows every click on the app underneath. Both gates
carry an explicit `#lock-screen[hidden] { display: none; }`.

### Deploy and CI

`pages.yml` no longer builds the expenses aggregate — it is inside the vault.
CI's `--check` validation runs only when `apps/expenses/data/expenses/` exists,
i.e. an unlocked checkout, and skips otherwise.

**`keep_files: true` does not delete.** Removing a file from the source leaves
it served on `gh-pages` forever. Taking something down means deleting it from
`gh-pages` directly via a worktree, then confirming a 404 — merging is not
enough.

## Expenses ledger (apps/expenses/)

The Expenses app is a read-only construction-cost ledger whose writes happen through Claude Code sessions. Source of truth is per-expense files, aggregated into one JSON — all of it encrypted into `data/vault.json` (see the section above; you need the passphrase and PIN from the user before any of the paths below exist):

- `apps/expenses/data/meta.json` — `baseCurrency`, `fixedRates` (MKD pegged at 61.5 per EUR).
- `apps/expenses/data/projects.json` — project registry (`id` slug, `name`, `icon`); the app shows one project at a time via the header picker.
- `apps/expenses/data/categories.json` — category registry, **shared across projects**; each category declares its own `fields`, so new expense types need data changes only.
- `apps/expenses/data/expenses/<project-id>/<yyyy>/<mm>/<id>.json` — one expense per file; the top folder is the project (must match a `projects.json` id), the date folders derive from the expense's ISO UTC `date`. Filename must equal the expense `id` (a GUID). When adding an expense, ask which project it belongs to if it isn't obvious.
- `apps/expenses/files/<guid>.<ext>` — attachment originals; metadata keeps `originalName` (used as label and download name) and `size` (must match the file on disk).
- `apps/expenses/data/expenses.json` is **generated** by `scripts/build-expenses-data.mjs` (run by `npm run dev` via `predev`, and by hand before a `vault.mjs lock`). It is gitignored, and these days it rides inside the vault rather than being rebuilt at deploy time — never edit or commit it. CI runs the script with `--check` only on an unlocked checkout.

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
| `investments.json` | property projects — `salePricePerM2`, and per project `areaM2`, a `loanId`, a `costs` list and `saleExtras` |

Everything is computed in EUR internally (the MKD peg makes that lossless) and
converted only for display; the header toggle switches EUR/MKD.

The app is **dark-only** — there is no light variant to keep in step. The palette
lives entirely in `:root` in its `styles.css`, including `--viz-savings` and
`--viz-debt`, which `app.js` reads at boot for the chart so the colours are
defined in one place. A debt's `principal` is its balance where the projection
opens (the 1st of the current month), which may be a fortnight back; the engine
tracks each balance forward to `balanceToday` and that is what "Debt today" and
the debt cards show, so a figure the user quotes as of today lands on screen
unchanged even though the file carries the earlier opening.

**Cash, not accrual.** This is the part to hold on to: money counts on the day
it lands, not the day it was earned. `payCycle` declares the earning periods
(1–15 and 16–end), `netDays` and `transferWorkingDays`; a period closes, the net
days elapse, the first working day on or after that is the Toptal payout, and one
more working day puts it in Wise. Under net-20 that means **the income you see in
October is September's work**, and a month's cash-in depends on the *previous*
month's work-day count.

Each debt declares `installments` — `[{ payPeriod, amount }]` — so a loan can be
split across the two pays (Tani takes €1,000 from each). An instalment falls due
on the day its pay lands. `payPeriod` may also be a **list** in preference order
(Naim is `["first-half", "second-half"]`): the instalment then hangs a claim off
every pay it could come from and the walk settles it against the earliest one
that can still cover it, falling through to the last candidate regardless if
none can. Because that depends on what a pay has left, pinned instalments are
queued before flexible ones so a flexible claim sees the real remainder.
`monthlyPayment` is only a fallback for a debt with no `installments`; the
monthly total is otherwise derived by summing them. A rate that steps partway —
a promotional period ending, a reset — goes in `rateSchedule`,
`[{ from, annualRate }]`, and each month takes the last entry that has already
started; `annualRate` is the rate before any of them. Rates are projected flat
from today onward on purpose: a bank's own plan carries assumptions about future
rates that can change, so the app does not import them.

The figures were checked against the bank's annuity plans (Sep 2026): B100's
balance after 31.08.2026 is €57,311.35 and its September interest €157.61, and
B56's are 7,423,825 and 46,399 MKD — the engine reproduces all four exactly, and
its payoff dates land within a month of the bank's final rows (Apr 2051 and
Jan 2052).

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

**There is no overdraft.** An unplanned expense cannot go out before the money
to cover it has landed: one that would push the running balance below zero is
held, and released only once a pay has arrived *and* that day's instalments and
budget are done with — pay first, then the expense. A held expense carries across
months for as long as it needs to, and its row says which date it was held from.
At the end of the visible window anything still held is forced out so the balance
shows the shortfall rather than quietly losing the expense. Only extras defer;
the budget does not, because it is what you live on.

Savings are the residual: `income − fixed budget − debt payments − unplanned`,
accumulated across the horizon. `startingSavings` in `meta.json` seeds the opening
balance.

**The Invest view** values the property projects. A project's `loanId` ties it
to a debt in `loans.json`, and everything on the loan side — what is still owed
(`balanceToday`), what is left to pay (the instalments still ahead, whose excess
over the balance is the interest yet to come) — is read off the same simulation
the timeline runs on, so the two views cannot drift apart. `costs` is the cash
basis (deposit, parking); it does not include instalments paid before the
forecast opens, so add those as a cost line if you want them counted. Sale value
is `areaM2 × salePricePerM2` plus the `saleExtras`, and the target price is
editable on the view as a session-only override like the budget field.

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
real numbers replace them. What the user changes in the UI is an overlay on the
committed data, never a write back to it — but it does persist: the currency,
the budget and target-price overrides, the what-if sliders and the ledger's
excluded ids are kept in localStorage under `forecast-scenario-v1`, saved from
`recompute()` (every change passes through it) and restored at boot. A slider
the user never moved is stored as `null`, not its value, so untouched knobs keep
following the committed data when it changes. Only the user's own overrides go
in there, never a figure from the vault. Reset in the scenario sheet puts
everything but the currency back.

## Wire (apps/wire/) — one viewer, many projects

Wire is the site-and-buildings wireframe viewer. It is software only; a
project is data. The address picks the project: `apps/wire/#/<org>/<slug>`;
with no project in the address the launcher shows the organizations and
their projects. Changing the hash reloads the page (one scene at a time).

- `projects/index.json` lists the organizations (a namespace, not access
  control — the repo is public); `projects/<org>/index.json` lists that
  org's projects (slug, name, site, summary, status). Add a project =
  a folder plus one line there.
- `projects/<org>/<slug>/scene.json` is the whole plan: name, `notes`,
  `datum`, `assets` (the relief as `relief.json`, a height field with a
  frame), `tracker` (the defects page), `defaults.layers` (which layers
  ship on), `groups`, `levels`/`works`/`terrain` (the house model),
  `buildings`/`envelopes`/`outlines`/`lines` (polygon models),
  `excavations` (custom cuts). **Projects hold no JavaScript.** Only
  JSON, Markdown, HTML for the tracker page, PNG screenshots.
- The engine, by area: `load.js` (route, registries, scene and assets),
  `model.js` (`deriveModel(scene)` — terrain, cut, driveway, volumes,
  framing; no three.js), `viewer.js` (builds the scene, the ground
  pipeline original → dig → custom cuts → render, objects, layers,
  settings, tap-to-measure, navigation), `i18n.js`, `textures.js`,
  `util.js`, `main.js` (launcher or viewer). Editing and export do not
  exist yet; every change is an edit to `scene.json` and a commit.
- Layer sets are saved per project (`wire-settings:<org>/<slug>`), the
  language once for all (`wire-lang`), recent projects in `wire-recent`.
- `apps/houseplan/` and `apps/deluxe/` are redirects to their projects.
- `package.json` has `"type": "module"` so CI's `node --check` parses
  the engine's `import`/`export`; every `.js` in the repo is parsed as a
  module now.

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
