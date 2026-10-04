# claude-default — roadmap

<!-- Profile: standard. Rules: https://github.com/xhevops-homelab/homelab-setup/tree/main/alm -->

Status legend: ✅ done · 🔧 in progress · ⬜ not started · 🗄️ dropped

Goal: the static arcade shell on GitHub Pages that hosts self-contained apps and games as tiles. Live at https://xhevops-claude.github.io/claude-default/. The architecture is in `CLAUDE.md`; this file tracks what is being built and moved.

## Tier 0 — Ledger and housekeeping

- ⬜ **ALM ledger in this repo** [CD-001](tasks/CD-001/) — this PR; afterwards the row in homelab-setup PROJECTS.md says standard.
- ⬜ **Housekeeping** [CD-002](tasks/CD-002/) — README rewritten from CLAUDE.md, dead branches deleted, gh-pages growth addressed.
- ⬜ **Create migration tasks for each app** [CD-003](tasks/CD-003/) — one task per app and game saying where it goes in the platform move.

## Tier 1 — Platform move (per-app tasks come from migration-map)

- ⬜ **Planner → AchiTech** — tracked in [AchiTech](https://github.com/xhevops-claude/AchiTech/blob/main/docs/roadmap.md); this repo stays the spec and fixture until the Unity viewer reads `scene.json`.

## Not doing

- 🗄️ **A build step** — the no-build property is what makes previews, deep links and the static CDN model work (see `CLAUDE.md`).
