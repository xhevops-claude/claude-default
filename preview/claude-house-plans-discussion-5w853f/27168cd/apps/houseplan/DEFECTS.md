# House Wire — defects and tasks

The running list for the house wireframe. One row per defect, numbered
once and never renumbered, so "fix 3" always means the same thing. Status
is one of **open**, **agreed** (user picked the fix, not yet built),
**fixed** (on a branch), **shipped** (on `main`), **wontfix**.

World axes: X east, Y up, Z south. Metres. The house is x 0–10, z 0–6;
the door and the driveway are off its east (+X) face.

## Objects and groups

Every built thing is its own object, coloured by group (`plan.js` →
`groups`; the legend along the bottom of the app hides a group at a tap).

| Group | Colour | Objects |
|---|---|---|
| House | cyan | garage, ground, first |
| Cantilever | orange | canopy |
| Driveway | yellow | driveway (apron), driveway-door, driveway-ramp, fillet-floor, mouth-floor |
| Retaining walls | violet | retainer, retainer-ramp, retainer-uphill, fillet-wall, mouth-wall |
| Road | grey | road |

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

## Defects

Screenshots are `defects/NN-*.png` beside this file, shown with the notes
on `defects.html` (the Defects button in the app opens it — keep that page
in step with this one). They were rendered with the camera settings below
(`window.houseWire.camera` / `.controls`), so they can be retaken after a
fix.

| # | Where | What is wrong | Proposed fix | Status | Camera (pos → target) |
|---|---|---|---|---|---|
| 1 | Uphill wall ends, z 8.7 and z 16 | The straight uphill wall (`retainer-uphill`, x 12.7–13) stands *inside* the cut, while the fillet wall and the mouth wall are bands in the *hill* (arc → arc − 0.3). At both ends the wall line jogs 30 cm. | R2: put all three on the hill side of the cut line. Uphill wall x 12.4–12.7 (or `dFrom` 3 with the wall at 12.7–13 and the ramp 3 m wide from x 13). | open | (16.5, −1.2, 5.5) → (12.85, −3.6, 8.7); (16.5, −3.2, 12.2) → (12.85, −5.4, 16) |
| 2 | Fillet at the house corner (10, 6) | Fillet radius 2.7 = distance house face → ramp's uphill edge (12.7), so the arc *does* end tangent at both ends — but the wall band (r − 0.3) starts at the house corner and its inner edge sits on the house's east face line. With 1 fixed (ramp edge at 13, band outside) r must become 3 for the arc to stay tangent; the straight wall then starts at z 9. | Tie `fillet.r` to `ramp.dFrom` (r = dFrom + wall thickness) rather than hand-typing both. | open | plan view (11.6, 6, 7.4) → (11.6, −3, 7.4), up −Z |
| 3 | x 13, z 5–6 | The ramp eases from z 5 but the door strip (`driveway-door`, x 10–13) stays flat, so along x 13 there is a 7 cm lip between the two slabs for that metre. | Start the ramp at z 6 (house edge) so the two slabs meet at one level — or let the door strip follow the ramp too. | open — decision D1 | (15.2, −1.9, 8.6) → (13, −2.95, 5.5) |
| 4 | Outer wall, z −2…16 | `retainer` and `retainer-ramp` are drawn from y −6 up to the slab's *top* (−2.9 / floor + 0.1), so the wall occupies the slab's volume; at the ramp foot (z 16) the wall's top ends *below* its foot and the stub inverts. | R3: wall top = slab underside (floor − 0.1); at the foot the wall runs out where the slab underside meets −6, not 10 cm above it. | open | (12.4, −4.2, 19.6) → (15.85, −5.8, 15.6); (19.2, −1.6, 7.6) → (15.85, −3.2, 3.5) |
| 5 | Apron, walls, road | "Level" means three things: cut profile −3 (apron), apron slab top −2.9, road slab −6.1…−5.9 on ground −6. The wall tops at −2.9 sit 10 cm above the profile they are meant to hold. | R1: cut profile becomes −2.9 / −6 (finished surfaces); road slab y −6.2…−6; wall tops at slab underside (R3). | open | (19.5, −2.4, 10.5) → (16, −4.4, 2.5) |
| 6 | Fillet wall and mouth wall tops | The band's top is evaluated per vertex, so the inner and outer arcs get different natural-ground heights and the top tilts across the 30 cm. | Evaluate the natural ground once, at the outer (hill-side) face, and use it for both edges. | open | (14.6, 0.2, 10.6) → (11.3, −1.4, 8.2) |
| 7 | Ramp, z 5–16 | The ground grid is sampled at 1 m, the ramp slabs and walls at 0.5 m, so the grid's ramp lines and the slab's edges do not coincide along the eased curve. The slab and the wall also overlap (see 4). | R5: sample the grid across the ramp at the slab's stations (0.5 m), or both at the same list of breakpoints. | open | (19, −1.6, 9.6) → (14.5, −4.2, 10.5) |
| 8 | Whole ramp | 3 m drop over 11 m is 27 % average, ~36 % in the eased middle — too steep for a car in the wet. | Run the ramp longer: 16–18 m (the road runs to z 24, so there is room) for ~17–19 %. | open — decision D2 | (34, −2.5, 10) → (14.5, −4.5, 10) |

## Decisions waiting on the user

- **D1** — Ramp start: at the house edge (z 6, no lip, the door strip
  stays flat) or keep the 1 m into the apron (z 5) and bend the door strip
  with it?
- **D2** — Ramp length: keep 11 m (5–16) or run to ~16–18 m?

## Done

- Wireframe box, gizmo, 10 × 6 house, three levels, garage under a
  cantilever, site cascades, driveway cut, tapering wall, road, apron,
  corner fillet, eased grade, bell-mouth entrance — all on `main`.
- Fillet anchored to the house corner rather than the ramp's start
  (branch, unmerged).
- Scene split into independent objects with group colours and a legend
  (branch, unmerged).
