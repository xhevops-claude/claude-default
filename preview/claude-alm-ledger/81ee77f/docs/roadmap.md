# claude-default — roadmap

<!-- Profile: standard. Rules: https://github.com/xhevops-homelab/homelab-setup/tree/main/alm -->

Status legend: ✅ done · 🔧 in progress · ⬜ not started · 🗄️ dropped

Goal: the static arcade shell on GitHub Pages that hosts self-contained apps and games as tiles. Live at https://xhevops-claude.github.io/claude-default/. The architecture is in `CLAUDE.md`; this file tracks what is being built and moved.

## Tier 0 — Ledger and housekeeping

- ⬜ **ALM ledger in this repo** [`ledger-arcade`](tasks/ledger-arcade/) — this PR; afterwards the row in homelab-setup PROJECTS.md says standard.
- ⬜ **Housekeeping** [`spring-clean`](tasks/spring-clean/) — README rewritten from CLAUDE.md, dead branches deleted, gh-pages growth addressed.
- ⬜ **Create migration tasks for each app** [`migration-map`](tasks/migration-map/) — one task per app and game saying where it goes in the platform move.

## Tier 1 — Platform move (per-app tasks come from migration-map)

- ⬜ **Planner → AchiTech** — tracked in [AchiTech](https://github.com/xhevops-claude/AchiTech/blob/main/docs/roadmap.md); this repo stays the spec and fixture until the Unity viewer reads `scene.json`.

## Not doing

- 🗄️ **A build step** — the no-build property is what makes previews, deep links and the static CDN model work (see `CLAUDE.md`).
