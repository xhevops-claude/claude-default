# claude-default — features

<!-- Profile: standard. Rules: https://github.com/xhevops-homelab/homelab-setup/tree/main/alm -->

One row per tile in the shell (`app.js` registry). `exists` = live on Pages. Migration destination per tile is decided by its task from [`migration-map`](tasks/migration-map/).

| Feature | State | Notes / spec |
|---|---|---|
| Shell: tile grid, iframe morph, section pager, deep links, themes | exists | `CLAUDE.md` § Architecture |
| Preview-per-branch deploys to gh-pages | exists | `.github/workflows/pages.yml` |
| Data pipeline: OSM data refresh + PMTiles build to `/cdn/` | exists | `data-refresh.yml`, `tiles-build.yml` |
| YouTube channel refresh | exists | `youtube-refresh.yml` |
| apps/planner — site-and-buildings viewer, projects as data | exists | being rebuilt in Unity: AchiTech |
| apps/expenses — encrypted ledger | exists | `CLAUDE.md` § Private data |
| apps/forecast — encrypted planner | exists | `CLAUDE.md` § Private data |
| apps/binge | exists | |
| apps/buildtrack | exists | |
| apps/locator | exists | |
| apps/marathon | exists | |
| apps/terrain | exists | sample DXF/txt files |
| apps/timemachine | exists | |
| apps/usage — Claude usage dashboard | exists | fed by claude-usage-tools |
| games/snake, tic-tac-toe, memory, crusaders, crusaders3d | exists | |
| directions | undecided | registered as coming soon |
