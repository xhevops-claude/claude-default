/* The house, as little of it as the wireframe needs.
 *
 * Metres. Plan coordinates are (x, y); the renderer turns plan y into
 * world z, so `envelope` reads x0..x1 along X and y0..y1 along Z.
 * `envelope` is the drawn box itself — outer face to outer face.
 *
 * Everything the viewer draws comes from here. Add to this file and the
 * box grows — nothing is hard-coded in app.js.
 */
window.HOUSE_PLAN = {
  name: 'House — wireframe',

  envelope: { x0: 0, y0: 0, x1: 10, y1: 6 },
  /* The house is turned this many degrees about its south-east corner
   * (x1, y1) — clockwise seen from above, so its east face swings west
   * as it goes north — to lie parallel to the parcel's north-east
   * boundary. The driveway, the road and the cut stay on the frontage's
   * axes; only the house, the walls wrapped round it and the canopy
   * turn, and the apron and the corner fillet meet them where they now
   * are. */
  turn: 8.06,
  /* Every level in a profile is a finished surface — the floor you stand
   * on, the road you drive on. A slab's top is that number and its
   * underside is `slab` below; a retaining wall is `wall` thick and stands
   * on the hill side of the line it holds. */
  slab: 0.2,
  wall: 0.3,

  /* Every built thing is its own object in the scene, and belongs to
   * one of these groups — the group gives it its colour, and the
   * legend along the bottom hides or shows a whole group at a tap.
   * Levels are `house` unless they say otherwise; each work names its
   * own group; the fillet and the mouth put their floors in `drive`
   * and their walls in `wall`. */
  groups: {
    house: { name: 'House', color: '#8fd8ff' },
    canopy: { name: 'Cantilever', color: '#ff8c5a' },
    drive: { name: 'Driveway', color: '#f5e663' },
    wall: { name: 'Retaining walls', color: '#d28cff' },
    road: { name: 'Road', color: '#9aa4b2' },
    parcel: { name: 'Parcel', color: '#ff4d3d' },
    relief: { name: 'Relief', color: '#6fbf9a' },
  },

  /* The real parcel, from the surveyor's DXF in apps/terrain (layer
   * `Zid`, 23 vertices, 705 m²) with the existing building on it (layer
   * `Objekt`, 6 × 8 m), draped on the terrain sample there. Brought into
   * this frame so its road-side edge — the 19.3 m frontage that rises
   * 1.6 m from its east corner to its south corner, which is the road
   * fall the model already carries — runs along +Z at x 16, its midpoint
   * at z 7.18 (the house, turned to the north-east boundary, sits 1 m
   * off it at the closest point, the boundary's bend at x 7.59), and so
   * uphill into the parcel is −X. Heights are metres
   * above the model's datum: real 991.11 m a.s.l. is y 0, chosen so the
   * real road at the frontage's midpoint meets the model's road there.
   * Points are [x, y, z]; `sides` are vertex spans measured along the
   * loop when the parcel is tapped. relief.js carries the surveyed
   * ground in the same frame. */
  parcel: {
    id: 'parcel', group: 'parcel', name: 'Parcel boundary, 705 m²',
    sides: [[0, 3], [3, 11], [11, 16], [16, 0]],
    points: [
      [ -27.62,  11.63,  17.62],
      [ -27.43,  11.75,  16.21],
      [ -26.84,  10.44,  10.19],
      [ -26.65,  10.31,   7.64],
      [ -20.25,   9.08,   5.57],
      [ -13.80,   6.89,   3.49],
      [  -7.25,   4.84,   1.31],
      [   1.21,   0.67,  -0.02],
      [   7.59,  -0.26,  -0.73],
      [  10.25,  -2.02,  -1.30],
      [  12.52,  -3.50,  -1.61],
      [  16.00,  -6.08,  -2.49],
      [  16.19,  -5.70,   0.01],
      [  16.21,  -5.28,   5.04],
      [  16.11,  -4.87,  12.80],
      [  16.06,  -4.91,  14.80],
      [  16.00,  -4.48,  16.85],
      [  12.73,  -2.58,  17.81],
      [   9.95,  -0.86,  17.35],
      [   7.25,   0.47,  17.23],
      [  -9.80,   7.22,  19.30],
      [ -14.53,   9.69,  18.81],
      [ -21.47,  10.58,  18.18],
    ],
  },
  existing: {
    id: 'existing', group: 'parcel', name: 'Existing building',
    sides: [[0, 1], [1, 2]],
    points: [
      [ -26.84,  10.44,  10.19],
      [ -18.88,   9.23,  10.83],
      [ -19.24,  10.08,  16.86],
      [ -27.43,  11.75,  16.21],
    ],
  },

  /* `envelope` is the house. A level can push past it on the downhill
   * face with `extendFront`; none does at the moment — the garage sits
   * inside, its door on the downhill face, under a cantilevered slab. */
  levels: [
    { id: 'garage', name: 'Garage', elevation: -2.9, height: 2.7 },
    { id: 'ground', name: 'Ground floor', elevation: 0, height: 2.7 },
    { id: 'first', name: 'First floor', elevation: 2.9, height: 2.7 },
  ],

  /* The site is level at the ground floor under the whole house, then
   * cascades down ahead of the downhill face. `profile` is that ground
   * as [metres out from the face, level], straight between points,
   * starting from [0, backLevel]; two points at the same distance make
   * a vertical step. `front` is the downhill face — '+X', '-X', '+Z' or
   * '-Z' — and `extendFront` pushes out of that same face. */
  terrain: {
    front: '+X',
    backLevel: 0,
    /* The road at the foot of the hill is not level: along the surveyed
     * frontage it rises 1.6 m, from the parcel's east corner to its south
     * corner. [across the front, level], straight between, held beyond.
     * Wherever a profile says 'road' it means this level, here. */
    road: [
      [-2.49, -6.08],
      [16.85, -4.48],
    ],
    profile: [
      [6, 'road'],   // one fall from the house face to the road's edge
      [9, 'road'],   // and level beyond
    ],
    /* In front of the house only — between `from` and `to` across the
     * front — the ground is cut to this profile instead: dropped to the
     * garage floor at the door, level out to the wall, then down. */
    /* The cut spans the frontage the survey gives, to z 16.85 at the
     * south end. At the north end the boundary runs at an angle, so
     * `from` is a line, not a number: [out from the face, across], the
     * parcel's own north-east side vertex by vertex from x 1.21 to its
     * road corner (16, −2.49), straight between and held beyond.
     * Everything that stops at the cut's north edge — the apron, the
     * outer wall — stops on it. */
    cut: {
      from: [[-8.79, -0.02], [-2.41, -0.73], [0.25, -1.30], [2.52, -1.61], [6, -2.49]],
      to: 16.85,
      profile: [
        [0, -2.9],     // straight down at the door, to the garage floor
        [6, -2.9],     // the driveway, level out to the wall
        [6, 'road'],   // the retaining wall: straight down to the road
        [9, 'road'],   // and level beyond
      ],
      /* Past `from` across the front the cut floor descends, reaching
       * the road at `to` — the driveway running along the house and down
       * the hill — and from there it is the road's own surface: the
       * landing where a car turns in. The ramp is only `dFrom` metres
       * out and beyond; nearer the house the natural slope stands, which
       * is the face the driveway is carved into. `ease` is the share of
       * the run at each end over which the grade builds up and tails
       * off, so the floor bends into the landing and the apron instead
       * of hinging onto them — the middle is correspondingly steeper. */
      ramp: { from: 6, to: 14.68, dFrom: 3, ease: 0.2 },
      /* The inside corner where the apron turns onto the ramp is
       * rounded off, so a car can swing out of the garage without
       * clipping the hill. The arc leaves the house's corner tangent to
       * its (turned) south edge line and meets the ramp's uphill edge
       * tangentially: its radius is the largest that allows both,
       * dFrom / (1 + sin turn) — `dFrom` itself for a house that is not
       * turned; give `r` only to override that. The floor and the wall
       * along it, and the straight wall beyond it, are derived from the
       * terrain, not listed as works. */
      fillet: {},
      /* The entrance: over the property's last `flare` metres the hill
       * is cut back along a quarter-ellipse, leaving the ramp's uphill
       * edge tangentially and sweeping out to the road's edge, so the
       * wall beside it stays high and then falls away to nothing. The
       * floor is the ramp's, then the landing's. Floor and wall are
       * derived, as for the fillet. */
      mouth: { flare: 6 },
    },
  },

  /* Built things that are not a level, drawn the same way as the levels.
   * World coordinates: x0..x1 along X, z0..z1 along Z, y0..y1 up. A
   * bottom or top may follow the ground along Z instead of being a
   * number: `{ floor: offset }` rides the driveway's surface, `{ road:
   * offset }` the road's, `{ ground: offset }` the natural hill at the
   * volume's house-side face — each that much above or below it. That
   * is how the ramp slab and the wall beside it bend with the eased
   * grade and the road's own fall. A wall whose top would dip under its
   * foot simply ends where the two meet. */
  /* A work with `house: true` is part of the house and turns with it;
   * the rest lies on the frontage's axes. */
  works: [
    { id: 'canopy', group: 'canopy', house: true, name: 'Cantilever over the door', x0: 10, x1: 13, y0: -0.2, y1: 0, z0: 0, z1: 6 },
    /* A z0 of 'cut' is the cut's north edge — the boundary line — so
     * the apron fills the parcel right up to it. */
    { id: 'driveway', group: 'drive', name: 'Apron, in front of the door', x0: 10, x1: 16, y0: -3.1, y1: -2.9, z0: 'cut', z1: 6 },
    /* The ramp itself is derived from `terrain.cut` — one slab from the
     * apron's edge to the mouth, the fillet's corner included — as are
     * the walls along its uphill side and the mouth. */
    /* The outer wall holds the driveway up over the road: its top is the
     * slab's underside, its foot the road, and it runs out where the
     * slab comes down to meet the road. */
    /* The garage is buried on three sides — the ground along them is at
     * 0 and its floor 3 m down — so the uphill wall does not stop at the
     * house's corner: it wraps the garage as its structural wall, a
     * `wall`-thick band on the hill side of the envelope (outside it,
     * like every retaining band), from the garage slab up to ground
     * level. The south band ends on the house's east face line exactly
     * where the fillet band's hill edge begins, so the two are one wall;
     * the west band takes both corners. */
    { id: 'garage-wall-south', group: 'wall', house: true, name: 'Garage wall, south', x0: -0.3, x1: 10, z0: 6, z1: 6.3, y0: -3.1, y1: 0 },
    { id: 'garage-wall-west', group: 'wall', house: true, name: 'Garage wall, west', x0: -0.3, x1: 0, z0: 0, z1: 6, y0: -3.1, y1: 0 },
    { id: 'garage-wall-north', group: 'wall', house: true, name: 'Garage wall, north', x0: -0.3, x1: 10, z0: -0.3, z1: 0, y0: -3.1, y1: 0 },
    { id: 'retainer', group: 'wall', name: 'Retaining wall', x0: 15.7, x1: 16, y0: { road: 0 }, y1: -3.1, z0: 'cut', z1: 6 },
    { id: 'retainer-ramp', group: 'wall', name: 'Retaining wall, tapering out', x0: 15.7, x1: 16, z0: 6, z1: 14.68, y0: { road: 0 }, y1: { floor: -0.2 } },
    /* The road, parallel to the wall along its outer face. `frame: false`
     * keeps its 30 m out of the camera's Fit, so the house stays the
     * subject. */
    { id: 'road', group: 'road', name: 'Road', x0: 16, x1: 20, z0: -6, z1: 24, y0: { road: -0.2 }, y1: { road: 0 }, frame: false },
  ],
};
