# Xhevo house, working scripts

- `house.mjs` generates the house above the garage into `projects/xhevo/house/scene.json`. Run it against the scene as it is on `main` (`git show origin/main:projects/xhevo/house/scene.json > projects/xhevo/house/scene.json`), then `node scripts/xhevo-house/house.mjs`. Every wall, tread and fitting is one box in the house frame (x along the house, z across, y up); the levels get holes for the stairwells.
- `ascii2.mjs` draws both floors in pipes and dashes, `ascii3.mjs` the living room and kitchen in detail; `build-plan.mjs` wraps their output (`ascii-out.txt`, `ascii3-out.txt`) into the plan page that is published as the artifact.
- `projects/xhevo/house/PLAN.txt` is the same plan as text. The artifact page is the source of truth while the plan is being decided.
