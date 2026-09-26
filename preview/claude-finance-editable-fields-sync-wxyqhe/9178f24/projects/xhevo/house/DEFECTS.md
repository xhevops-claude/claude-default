# House Wire — defects and tasks

The running list for the house wireframe. One row per defect, numbered
once and never renumbered, so "fix 3" always means the same thing. Status
is one of **open**, **agreed** (user picked the fix, not yet built),
**fixed** (on a branch), **shipped** (on `main`), **wontfix**.

World axes: X east, Y up, Z south. Metres. The house is x 0–10, z 0–6;
the door and the driveway are off its east (+X) face.

## Objects and groups

Every built thing is its own object, coloured by group (`scene.json` →
`groups`; the legend along the bottom of the app hides a group at a tap).

| Group | Colour | Objects |
|---|---|---|
| House | cyan | garage, ground, first |
| Cantilever | orange | canopy |
| Driveway | yellow | driveway (apron), driveway-ramp (one slab from the apron to the road, fillet and mouth included) |
| Retaining walls | violet | garage-wall-south / -west / -north, retainer, retainer-ramp, fillet-wall, ramp-wall, mouth-wall |
| Road | grey | road |
| Parcel | red | parcel (boundary, 705 m²), existing (the 6 × 8 m building at the top corner) |
| Excavation | sand | one object per cut: the house's pit and the apron's, depth and m³ on tap |
| Relief | green | relief — the surveyed ground from the terrain app's two samples (`relief.json`: the 0.2 m cloud over and around the parcel, 34,004 points, and the 1 m grid over the whole survey, emptied where the cloud covers it), as the terrain app's layers: points tinted by height, a translucent surface dimmed outside the parcel, contours every 10 cm with a heavier line each metre, a height label where a parcel edge crosses a metre line, and the survey's own 5 m lattice draped on the ground. Each is a layer in Settings; only the surface is on by default |

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
| 8 | Whole ramp | 27 % average, ~36 % mid. | D2 brought it to 12.5 %, D3's landing to 18 % — and the real frontage (19.3 m, ending at z 16.17) leaves only z 6–14 for the grade: 1.76 m over 8 m, 22 % average, ~27 % mid, with a 2.2 m landing. D6 moved the house 0.68 m up the frontage, so now **1.76 m over 8.68 m, 20 % average, ~25 % mid**. The frontage is the hard limit; see D4. | open — decision D4 | (34, −2.5, 10) → (14.5, −4.5, 10) |
| 9 | The entrance, z 16–22 | The outer wall ran to the tip and the floor met the road only over the last 1.5 m. | D3: the driveway reaches the road at z 18 and from there *is* the road's surface (a 4 m landing that follows the road's own fall, with the mouth's flare opening onto it); the outer wall runs out at z ≈ 16.1, so the road side is open for 6 m, the first 2 m with a kerb of at most 24 cm. | shipped | plan view (15.5, 6, 19) → (15.5, −5, 19), up −Z |
| 10 | Apron's north edge — the north-east boundary from the turned house face (≈ 9.0, −1.03) to the road corner (16, −2.49) — and the house's east face line north of the garage | The cut in front of the house is bounded to the north by a bare vertical face: 2.9 m of hill at x 10 falling to nothing at x ≈ 13, and from there to the outer wall the apron sits *above* the natural ground with no wall under its edge. The strip of the house's east face line north of the garage's north band is bare too. (The edge used to stop at z −1.5, short of the boundary; it now runs on the boundary itself, and the face is the turned house's.) | Carry the wall line on: garage north band → a band on the hill side of the turned face line from the band to the boundary → a band inside the boundary line to the outer wall, cut wall as far as the ground is above the apron, fill wall (down to natural ground) beyond, meeting the outer wall at the road corner. The band would take 30 cm off the apron's north edge. | open | plan view (12.5, 8, −1) → (12.5, −3, −1), up −Z |
| 11 | The house against the real parcel | With the surveyed parcel overlaid, the house's north edge lay outside the north-east boundary and the cut assumed a 24 m frontage. | D5: the parcel is placed 3.5 m further north relative to the house (frontage midpoint at z 6.5), so the north wall clears the boundary by 0.5 m at its north-west corner and the apron's corner at x 10 stays inside; the cut, the road's fall and the ramp now use the surveyed frontage. D6 then turned the house 8.06° about its south-east corner to lie parallel to the boundary and set it 1 m off it (frontage now z −2.49…16.85, midpoint 7.18). | shipped | plan view (−4, 60, 7) → (−4, 0, 7), up −Z |

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
- **Site fact (survey):** the parcel from the terrain app's DXF is 705 m²,
  44 m deep from the road, 19.3 m wide at the road and 10 m at the back,
  rising 17.8 m from its lowest road corner to its top corner. The road
  frontage rises 1.6 m from its east corner to its south corner (the road
  fall the model carries). Where the house stands the real ground runs
  from +1.5 to −0.5 and falls to −5.4 at the road, close to the model.
- **D5 — decided:** the house sits 3.5 m further south within the parcel,
  inside the boundary. The surveyed ground is shown as the Relief group;
  the synthetic hill stays the model's terrain for now.
- **D6 — decided:** the house is turned 8.06° about its south-east
  corner (10, 6) — the corner the fillet hangs off — so its north wall
  runs parallel to the north-east boundary's chord (x 1.21 → 10.25), and
  the site is placed so the wall is 1 m off the boundary at the closest
  point, the boundary's bend at x 7.59 (1.19 m at the chord's ends). The
  driveway, walls and road stay on the frontage's axes; the levels, the
  garage's bands and the canopy turn; the apron's west edge is the
  turned face; the fillet is the largest arc still tangent to the turned
  south edge line at the corner and to the ramp's edge, r = dFrom /
  (1 + sin 8.06°) = 2.63 m, its wall walked by angle from the corner.
- **D4 — waiting:** the grade is 20 % (25 % mid) because the surveyed
  frontage leaves 8.7 m for the ramp. Options: start the grade inside the
  apron (D1 revisited), a shorter landing, a flatter `ease`, a different
  driveway layout, or accept it.

## Done

- The ground is worked, not redrawn: relief.json stays the untouched
  survey; the viewer builds the terrain from it in order — original,
  the objects' own excavation (the house's envelope to the garage slab's underside and the apron (marked `excavate`)), then any custom cuts listed in
  scene.json under `excavations` (a ring with a `level` or a `depth`;
  none yet) — and renders the result. Each excavation is an object in
  the Excavation group with its depth and volume on tap, so moving a
  building means recomputing, never touching the survey (branch,
  unmerged).

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
  gizmo turns the camera in place in Camera mode (shipped, PR #142).
- Settings sheet behind a gear top right: the Object / Camera navigation
  choice and an EN / DE language switch that translates the interface,
  legend, object names and dimension labels (shipped, PR #142).
- The surveyed parcel and the existing building brought in from the terrain
  app's DXF as a red Parcel group: knee-high ribbons at real heights, with
  side lengths and rise on tap; the header height is the house's own and
  the ground grid spans the parcel (shipped, PR #143).
- The surveyed ground as a Relief group, and the parcel re-placed so the
  house clears the boundary; cut, road fall and ramp follow the surveyed
  frontage (shipped, PR #143).
- The house turned 8.06° to the north-east boundary and set 1 m off it
  (D6): the turn lives in scene.json, the levels, garage bands and canopy
  follow it, the apron meets the turned face and the fillet's arc dips
  from the corner tangent to the turned south edge line; the site moved
  0.68 m south along the frontage, which lengthens the ramp to 8.68 m
  and eases the grade to 20 % (shipped, PR #143).
- The apron and the outer retaining wall carried to the surveyed boundary:
  the cut's north edge is the parcel's north-east side itself, bend for
  bend, from where it crosses the house face line (10, −1.93) to the
  road corner (16, −3.17); the apron fills up to it and the outer wall
  ends on it (shipped, PR #143).
- The terrain app's other layers — surface, 10 cm and 1 m contours,
  contour labels at the parcel's edges, the draped survey lattice — and a
  Layers section in Settings with a checkbox for every layer (drawing
  parts, object groups, relief layers), an All switch, and Save / Reset
  that keep the set on the device; the bottom bar and the legend are the
  same switches (shipped, PR #143).
