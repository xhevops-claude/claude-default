# Create migration tasks for each app

<!-- Task folder — rules: https://github.com/xhevops-homelab/homelab-setup/tree/main/alm#tasks-one-folder-each-with-a-codename -->

| Codename | Title | Project | Tier | Status | Created | Done |
|---|---|---|---|---|---|---|
| `migration-map` | Create migration tasks for each app | claude-default | T0 | ready | 2026-10-04 | — |

## Goal

Every app and game in the shell (binge, buildtrack, expenses, forecast, locator, marathon, planner, terrain, timemachine, usage; crusaders, crusaders3d, memory, snake, tic-tac-toe) has its own task folder describing where it goes in the platform move: stays public on Pages, moves to the private shell at home, is rebuilt elsewhere (planner → AchiTech), or is retired.

## Context

The platform direction is being decided; this task produces one task per app so each migration is tracked on its own with its own codename. It creates tasks, it does not migrate anything.

## Acceptance

- [ ] one docs/tasks/<codename>/ per app and game, status backlog, with the destination field filled or marked undecided
- [ ] roadmap.md gains a Tier for the migration listing them
- [ ] features.md rows for every app point at their migration task
- [ ] roadmap line flipped to ✅; features.md updated if this is a feature

## Log

- 2026-10-04 — created.

## Links

- Roadmap: docs/roadmap.md
- Platform direction: homelab-setup checkpoints/2026-10-04.md
