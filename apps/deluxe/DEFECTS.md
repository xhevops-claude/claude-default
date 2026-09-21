# Deluxe — defects and tasks

The running list for the Deluxe wireframe, kept the way House Wire's is:
one row per defect, numbered once and never renumbered, so "fix 3" always
means the same thing. Status is one of **open**, **agreed** (user picked
the fix, not yet built), **fixed** (on a branch), **shipped** (on `main`),
**wontfix**.

Deluxe started as a clone of House Wire as merged in PR #143 — the same
plan, parcel, relief, rules and decisions — and diverges from there. Its
own defects start at 1 below; House Wire's list (`apps/houseplan/DEFECTS.md`)
is history, not this app's.

World axes: X east, Y up, Z south. Metres. The site's frame is House
Wire's: the road frontage runs along +Z at x 16, uphill into the parcel
is −X. There is no house in the plan yet — the site alone.

## Objects and groups

Every built thing is its own object, coloured by group (`plan.js` →
`groups`; the legend along the bottom of the app hides a group at a tap).

| Group | Colour | Objects |
|---|---|---|
| House | cyan | garage, ground, first |
| Cantilever | orange | canopy |
| Driveway | yellow | driveway (apron), driveway-ramp (one slab from the apron to the road, fillet and mouth included) |
| Retaining walls | violet | garage-wall-south / -west / -north, retainer, retainer-ramp, fillet-wall, ramp-wall, mouth-wall |
| Road | grey | road |
| Parcel | red | parcel (boundary, 705 m²), existing (the 6 × 8 m building at the top corner) |
| Relief | green | relief — the surveyed ground from the terrain app's two samples (`relief.js`: the 0.2 m cloud over and around the parcel, 34,004 points, and the 1 m grid over the whole survey, emptied where the cloud covers it), as the terrain app's layers: points tinted by height, a translucent surface dimmed outside the parcel, contours every 10 cm with a heavier line each metre, a height label where a parcel edge crosses a metre line, and the survey's own 5 m lattice draped on the ground. Each is a layer in Settings; only the surface is on by default |

## Rules agreed so far

- **R1 — Levels are finished surfaces.** A number in a terrain profile is
  the surface you walk or drive on. A slab's top is that number; its
  underside is `slab` (20 cm) below.
- **R2 — Walls sit on the cut face, flush.** A wall beside a cut stands
  in the 30 cm the cut is widened by, on the hill side of the line, and
  every wall along one edge is one continuous line — no jog where a
  straight run meets an arc.
- **R3 — Nothing overlaps.** A wall stops at a slab's underside; a slab
  stops at a wall's face. Two objects share a face, never a volume.
- **R4 — Tangent joins.** Where an arc meets a straight, the arc's end
  is tangent to the straight (fillet ↔ house face, fillet ↔ ramp edge,
  mouth ↔ ramp edge).
- **R5 — One sampling.** Anything that follows the ramp (slabs, walls,
  the ground grid) is sampled at the same stations, so lines that should
  coincide do.

## Inherited decisions

From House Wire, still in force unless a row below says otherwise:

- **D1:** the ramp starts at the house edge; the apron stays flat and whole.
- **D2:** the driveway climbs from the very entrance; no flat pad.
- **D3:** a road-level landing; the outer wall runs out where the slab
  meets the road.
- **D5:** the surveyed parcel and ground are the site; the synthetic hill
  is the model's terrain for now.
- **D6:** the house is turned 8.06° about its south-east corner to lie
  parallel to the north-east boundary, 1 m off it at the closest point.
- **Open from House Wire:** the grade (20 %, 25 % mid — D4 waiting) and
  the bare face along the apron's north edge (no wall yet).

## Defects

Screenshots go in `defects/NN-*.png` beside this file, shown with the
notes on `defects.html` (the Defects button in the app opens it — keep
that page in step with this one).

| # | Where | What was wrong | Fix | Status | Camera (pos → target) |
|---|---|---|---|---|---|

## Done

- Cloned from House Wire at PR #143.
- The house, its walls, the driveway, the road and the synthetic terrain
  taken out: the site alone — parcel, existing building, relief — with
  the header showing the parcel and its rise (branch, unmerged).
