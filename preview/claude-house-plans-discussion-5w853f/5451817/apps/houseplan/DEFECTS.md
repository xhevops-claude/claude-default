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
| Driveway | yellow | driveway (apron), driveway-ramp (one slab from the apron to the road, fillet and mouth included) |
| Retaining walls | violet | garage-wall-south / -west / -north, retainer, retainer-ramp, fillet-wall, ramp-wall, mouth-wall |
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

| # | Where | What was wrong | Fix | Status | Camera (pos → target) |
|---|---|---|---|---|---|
| 1 | Uphill wall ends, z 9 and z 16 | The straight uphill wall stood *inside* the cut while the fillet wall and the mouth wall were bands in the *hill*; at both ends the wall line jogged 30 cm. | R2: the uphill side is one derived wall line — fillet arc, straight run (`ramp-wall`), mouth arc — every piece a `wall`-thick band on the hill side of the cut line at `dFrom` 3; the straight run is derived from the fillet's end to the mouth's start, so it cannot jog. | shipped | (16.5, −1.2, 5.5) → (12.85, −3.6, 8.7); (16.5, −3.2, 12.2) → (12.85, −5.4, 16) |
| 2 | Fillet at the house corner (10, 6) | The radius was typed by hand and had to match `dFrom` to stay tangent. | R4: the radius *is* `dFrom` unless overridden, so the arc leaves the house face at the corner and meets the ramp's edge tangentially by construction. | shipped | plan view (11.6, 6, 7.4) → (11.6, −3, 7.4), up −Z |
| 3 | x 13, z 5–6 | A 7 cm lip between the flat door strip and the eased ramp. | D1: the ramp starts at z 6, the apron is one slab. | shipped | (15.2, −1.9, 8.6) → (13, −2.95, 5.5) |
| 4 | Outer wall, z −2…16 | The wall was drawn up to the slab's *top*, so it occupied the slab; at the ramp foot its top ended below its foot. | R3: wall top = slab underside (`{ floor: -0.2 }` / −3.1), foot on the road; a walked wall now *runs out* where top meets foot (bisection), so the outer wall ends at z ≈ 16.1 where the slab's underside reaches the road. | shipped | (12.4, −4.2, 19.6) → (15.85, −5.8, 15.6); (19.2, −1.6, 7.6) → (15.85, −3.2, 3.5) |
| 5 | Apron, walls, road | "Level" meant three things (profile −3, slab top −2.9, road slab straddling −6). | R1: every profile number is a finished surface — cut profile −2.9 (the garage floor), road −5.9 → −4.9; slabs are `slab` deep *under* their surface (`{ road: -0.2 }`…`{ road: 0 }`, `{ floor: -0.2 }`…`{ floor: 0 }`). | shipped | (19.5, −2.4, 10.5) → (16, −4.4, 2.5) |
| 6 | Fillet wall and mouth wall tops | The top was read per vertex, so it tilted across the thickness. | The top is the natural ground at the hill-side face, used for both edges of the band. | shipped | (14.6, 0.2, 10.6) → (11.3, −1.4, 8.2) |
| 7 | Ramp, z 6–22 | Grid at 1 m, slabs at 0.5 m: lines that should coincide did not. | R5: one `STEP` (0.5 m) for walked volumes and for the grid over the driveway, stations from `ramp.from`, so slab edges and grid lines are the same polyline. | shipped | (19, −1.6, 9.6) → (14.5, −4.2, 10.5) |
| 8 | Whole ramp | 27 % average, ~36 % mid. | D2 brought it to 12.5 % — but D3's landing shortens the run again: 2.17 m over 12 m (z 6–18) is **18 % average, ~23 % mid** (`ease` 0.2). Trade-off between the landing's length and the grade; see D4. | open — decision D4 | (34, −2.5, 10) → (14.5, −4.5, 10) |
| 9 | The entrance, z 16–22 | The outer wall ran to the tip and the floor met the road only over the last 1.5 m. | D3: the driveway reaches the road at z 18 and from there *is* the road's surface (a 4 m landing that follows the road's own fall, with the mouth's flare opening onto it); the outer wall runs out at z ≈ 16.1, so the road side is open for 6 m, the first 2 m with a kerb of at most 24 cm. | shipped | plan view (15.5, 6, 19) → (15.5, −5, 19), up −Z |
| 10 | Apron's north edge, z −2, x 10–16, and the house face x 10, z −2…0 | The cut in front of the house is bounded to the north by a bare vertical face: 2.9 m of hill at x 10 falling to nothing at x ≈ 12.95, and from there to the outer wall the apron sits *above* the natural ground with no wall under its edge. The strip of the house's east face line north of the garage (x 10, z −2…0) is bare too. | Carry the wall line on: garage north band → a band on the hill side of x 10 from z −0.3 to −2.3 → a band on the north side of z −2 from x 9.7 to 16, cut wall as far as the ground is above the apron, fill wall (down to natural ground) beyond, meeting the outer wall at (16, −2). | open | plan view (12.5, 8, −1) → (12.5, −3, −1), up −Z |

## Decisions

- **D1 — decided:** the ramp starts at the house edge (z 6); the apron
  stays flat and whole.
- **D2 — decided:** the driveway climbs from the very entrance; no flat
  pad. The mouth is the ramp's last 6 m and its floor is on the grade.
- **Site fact (user):** the road is not level — it rises 1 m along the
  property, so the entrance (south end, z 22) is 2 m below the garage
  floor, not 3. `terrain.road` holds it as [across, level] and a profile
  level written `'road'` follows it; the walls' feet ride it too.
  Assumed: the north end of the property (z −2) is the 3 m-below end.
- **D3 — decided:** a road-level landing. The ramp reaches the road at
  z 18; from there to the property's end the driveway is the road's own
  surface, and the outer wall runs out where the slab meets the road.
- **D4 — waiting:** the grade is back to 18 % (23 % mid) because the
  landing takes 4 m off the run. Options: a shorter landing (3 m → 16 %),
  a flatter `ease`, starting the grade inside the apron again, or accept
  it.

## Done

- Wireframe box, gizmo, 10 × 6 house, three levels, garage under a
  cantilever, site cascades, driveway cut, tapering wall, road, apron,
  corner fillet, eased grade, bell-mouth entrance — all on `main`.
- Fillet anchored to the house corner rather than the ramp's start
  (shipped, PR #139).
- Scene split into independent objects with group colours and a legend
  (shipped, PR #139).
- D1, D2 and the sloping road: ramp z 6–22 on the grade from the entrance,
  road 1 m rise, walls following the road (shipped, PR #139).
- Defects 1, 2, 4, 5, 6, 7, 9 fixed in one pass: finished-surface
  levels, one derived wall line on the uphill side, slabs on walls, walls
  that run out, flat wall tops, shared sampling, a road-level landing
  (shipped, PR #139).
- The ramp is one derived slab, the fillet's corner part of its outline
  rather than a separate sliver (shipped, PR #139).
- The whole driveway — ramp, fillet, mouth and landing — is one strip built
  station by station, so the entrance surface follows the grade and the road
  exactly instead of spanning them with flat triangles (shipped, PR #139).
- The garage's buried sides get their structural wall: 30 cm bands outside
  the envelope on the south, west and north, garage slab to ground level,
  the south one ending where the fillet band's hill edge begins (shipped, PR #140).
- Tap an object for its dimensions: its lines brighten and its own set of
  measured lines is drawn on it — length, width, height for boxes;
  thickness, plan length and the height at each end for walked walls;
  run, width, grade, slab depth, fillet radius and mouth flare for the
  driveway; thickness, arc length and end heights for the wall bands
  (shipped, PR #141).
- Two ways to move: Object (orbit the scene, as before) and Camera (drag
  turns the camera in place, pinch or wheel walks it along its facing, two
  fingers or a right-drag slide it). A toggle in the bottom bar; the axis
  gizmo turns the camera in place in Camera mode (branch, unmerged).
- Settings sheet behind a gear top right: the Object / Camera navigation
  choice and an EN / DE language switch that translates the interface,
  legend, object names and dimension labels (branch, unmerged).
