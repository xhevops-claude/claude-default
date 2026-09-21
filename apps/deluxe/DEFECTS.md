# Deluxe — defects and tasks

The running list for the Deluxe wireframe, kept the way House Wire's is:
one row per defect, numbered once and never renumbered, so "fix 3" always
means the same thing. Status is one of **open**, **agreed** (user picked
the fix, not yet built), **fixed** (on a branch), **shipped** (on `main`),
**wontfix**.

Deluxe is the Crniče site: five building parcels of DUP Ј20 block 01
(KO Kisela Voda 1, Skopje) on the west side of ul. Rilski Kongres, and
the buildings drawn for them. The viewer is House Wire's as merged in
PR #143, with polygon buildings, buildable areas and draped lines added.

World axes: X east, Y up, Z south. Metres. Heights are above the
buildings' ±0.00 = 286.08 m a.s.l.; the site spans x 0–112, z −4–86.

## Sources

| File | What was taken |
|---|---|
| `Podloga_dopolnitelna.pdf` (ГЕО ДЕЗИС, July 2025, 1:500) | 2 m contours (294–318 m) and 62 spot heights read from the sheet, cadastral lines; interpolated into the 1 m relief |
| `Детален урбанистички план … Ј20 Блок 01.pdf` | parcel numbers, class A1, П+2+Пк, 10.20 m; the table's areas, footprints and built areas |
| `DELUXE CRNICE - site podlogi 12.03.2026.dwg` (Archicad export, cm) | site plan (DUP parcels, buildable areas, street), floor plans per level (slab outlines), the two road profiles (story heights, existing ground) |
| `001.DELUXE CRNICE - prezentim1.bimx` | the story levels: lower −2.50 / 1.20 / 4.09 / 6.98 / 9.87 / roof 12.57; upper 12.57 / 15.46 / 18.35 / 21.24 / 24.13 / 27.02 / roof 29.72 |
| `azurirana.dwg` | not readable here (AutoCAD 2007 format); the PDF carries the same survey |
| `PHOTO-2026-09-21-09-18-44.jpg` | the red outline of the site on the survey |

## Site facts

- Parcels and DUP limits: 2.66 (615 m², footprint ≤ 187, built ≤ 749),
  2.67.1 (398 / 174 / 696), 2.67.2 (342 / 138 / 551), 2.76 (185 / 68 /
  271), 2.77 (293 / 122 / 489). All A1 housing, П+2+Пк, cornice 10.20 m.
- Ground: 285.5–288.7 m along Rilski Kongres, a bank up to a terrace at
  293–294 m, then 34 % up to 310 m at the west edge; 318 m at the top of
  the sheet. The access street of the DUP runs north–south on the west.
- Buildings, from the drawing set: a lower pair on 2.66 (Objekt 2, 224 m²
  floors) and 2.67.2 (140 m²) over one 942 m² garage at −2.50; an upper
  three on 2.67.1 (Objekt 1, 189 m²), 2.77 (Objekt 5, 147 m²) and 2.76
  (81 m²), each with two basements dug into the slope. Datum: the
  profile's slab lines fit ±0.00 = 286.08 m, which puts the lower ground
  floor (+1.20 = 287.28) at street level.

## Objects and groups

Every built thing is its own object, coloured by group (`plan.js` →
`groups`; the legend along the bottom of the app hides a group at a tap).

| Group | Colour | Objects |
|---|---|---|
| Buildings | one shade per building | one object per floor of each building, and the garage; walls drawn at 30 % so each building reads as a solid |
| Buildable areas | orange | the DUP's површина за градба, as 10.20 m volumes |
| Parcels | red | the site boundary and the five DUP parcels, as ribbons |
| Cadastre | green | the cadastral lines from the survey, draped |
| Street | grey | the DUP access street parcel |
| Excavation | sand | one object per building's cut, depth and m³ on tap |
| Relief | green | the surveyed ground: points, surface, 1 m / 5 m contours, labels, lattice |

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
| 1 | Upper buildings' floor plates | The floor outlines are 189 / 147 / 81 m² against DUP footprints of 174 / 122 / 68 m²; the lower pair's 224 / 140 m² against 187 / 138 m². Balconies may explain part of it. | Check which outline the DUP measures (footprint at ground) against the plans; a compliance readout per parcel. | open | (120, 40, 90) → (45, 8, 32) |
| 2 | Ground east of the 294 m contour | The survey draws no contours over the terrace and the bank down to the road; the relief there rests on 62 spot heights read by eye from the sheet. | The heights as text from `azurirana.dwg` (a DXF export would do), or the surveyor's point list. | open | (100, 20, 32) → (40, 10, 32) |
| 4 | Building 5 (Objekt 5, parcel 2.77), downhill side; buildings 1 and 4 less so | The lowest floor is at 298.45 m while the ground under the footprint falls from 300 m at the west wall to 294 m at the east: the west half is dug in, the east half stands 2–4 m in the air. The architect's own Objekt 5 profile shows the ground line passing under the building's east end, so it is in the design, not the placement. | D2: buildings 1 and 5 one storey lower. Now dug 5.0 m at the uphill wall and 1.8 m in the air at the downhill corner. | fixed | (10, 16, 70) → (33, 12, 37) |
| 3 | Buildable-area volumes | 10.20 m is the cornice height above the ground; the volumes take the mean ground under the outline, which on a 34 % slope is a rough reading. | The DUP's own rule for the reference ground. | open | — |

## Decisions

- **D2 — decided:** buildings 1 and 5 (parcels 2.67.1 and 2.77) go
  one storey lower: their whole stack shifted 2.89 m down, no floor
  added. Their lowest floor is now at 295.56 m — dug 5 m in at the
  uphill wall, 1.8 m clear of the ground at the downhill corner.
  Building 4 already sat on the ground and stays. The fill-or-walk-out
  question remains for what is left of the gap.

- **D1 — decided:** the buildings' ±0.00 is 286.08 m a.s.l., from the
  profile drawing's slab lines (six of the lower building's match), not
  the 288.97 a first reading of the BIMx stories suggested.

## Done

- The ground is worked, not redrawn: relief.js stays the untouched
  survey; the viewer builds the terrain from it in order — original,
  the objects' own excavation (each building's lowest floor to its
  slab's underside; the shared garage at −2.50 dominates, 10.6 m deep
  at the terrace), then any custom cuts listed in plan.js under
  `excavations` (a ring with a `level` or a `depth`; none yet) — and
  renders the result. Each excavation is an object in the Excavation
  group with its depth and volume on tap (branch, unmerged).

- Viewer cloned from House Wire at PR #143; the scene emptied — no
  terrain, parcel or building until the new documents are read (branch,
  unmerged).
- The Crniče site built from the documents: relief from the survey's
  contours and spot heights, the five DUP parcels and the access street,
  the cadastral lines, the buildable areas, and the six buildings floor
  by floor at the BIMx story levels; the viewer gained polygon buildings,
  buildable-area volumes, draped lines and contour intervals set by the
  relief file (shipped, PR #144).
- Buildings in their own shades with walls at 30 % rather than the
  wireframe's 5 %, and the drawing dots off by default (shipped, PR #144).
