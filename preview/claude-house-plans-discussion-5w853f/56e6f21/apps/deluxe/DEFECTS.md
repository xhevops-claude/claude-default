# Deluxe — defects and tasks

The running list for the Deluxe wireframe, kept the way House Wire's is:
one row per defect, numbered once and never renumbered, so "fix 3" always
means the same thing. Status is one of **open**, **agreed** (user picked
the fix, not yet built), **fixed** (on a branch), **shipped** (on `main`),
**wontfix**.

Deluxe is a different house on a different site. The viewer is House
Wire's as merged in PR #143; the plan starts empty and is built from the
new documents — terrain, parcel, building — as they come.

World axes: X east, Y up, Z south. Metres.

## Objects and groups

Every built thing is its own object, coloured by group (`plan.js` →
`groups`; the legend along the bottom of the app hides a group at a tap).
The palette is House Wire's; nothing is in it yet.

## Rules carried over

- **R1 — Levels are finished surfaces.** A number in a terrain profile is
  the surface you walk or drive on. A slab's top is that number; its
  underside is `slab` (20 cm) below.
- **R2 — Walls sit on the cut face, flush.** A wall beside a cut stands
  in the 30 cm the cut is widened by, on the hill side of the line, and
  every wall along one edge is one continuous line.
- **R3 — Nothing overlaps.** A wall stops at a slab's underside; a slab
  stops at a wall's face. Two objects share a face, never a volume.
- **R4 — Tangent joins.** Where an arc meets a straight, the arc's end
  is tangent to the straight.
- **R5 — One sampling.** Anything that follows a ramp (slabs, walls,
  the ground grid) is sampled at the same stations.

## Defects

Screenshots go in `defects/NN-*.png` beside this file, shown with the
notes on `defects.html` (the Defects button in the app opens it — keep
that page in step with this one).

| # | Where | What was wrong | Fix | Status | Camera (pos → target) |
|---|---|---|---|---|---|

## Decisions

None yet.

## Done

- Viewer cloned from House Wire at PR #143; the scene emptied — no
  terrain, parcel or building until the new documents are read (branch,
  unmerged).
