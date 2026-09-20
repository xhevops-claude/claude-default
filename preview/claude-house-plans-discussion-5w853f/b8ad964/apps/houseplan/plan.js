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
    /* The road at the foot of the hill is not level: it rises 1 m along
     * the property, from 3 m below the garage floor at the north end to
     * 2 m below it at the entrance. [across the front, level], straight
     * between, held beyond. Wherever a profile says 'road' it means
     * this level, here. */
    road: [
      [-2, -5.9],
      [22, -4.9],
    ],
    profile: [
      [6, 'road'],   // one fall from the house face to the road's edge
      [9, 'road'],   // and level beyond
    ],
    /* In front of the house only — between `from` and `to` across the
     * front — the ground is cut to this profile instead: dropped to the
     * garage floor at the door, level out to the wall, then down. */
    cut: {
      from: -2,
      to: 22,
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
      ramp: { from: 6, to: 18, dFrom: 3, ease: 0.2 },
      /* The inside corner where the apron turns onto the ramp is cut
       * back in a quarter-round, so a car can swing out of the garage
       * without clipping the hill. Its radius is `dFrom` — house face to
       * the cut line — so the arc is tangent to both; give `r` only to
       * override that. The floor and the wall along it, and the straight
       * wall beyond it, are derived from the terrain, not listed as
       * works. */
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
  works: [
    { id: 'canopy', group: 'canopy', name: 'Cantilever over the door', x0: 10, x1: 13, y0: -0.2, y1: 0, z0: 0, z1: 6 },
    { id: 'driveway', group: 'drive', name: 'Apron, in front of the door', x0: 10, x1: 16, y0: -3.1, y1: -2.9, z0: -2, z1: 6 },
    /* The straight run of the ramp, up to where the mouth takes over
     * (the property's end less the mouth's flare). */
    { id: 'driveway-ramp', group: 'drive', name: 'Driveway, down the hill', x0: 13, x1: 16, z0: 6, z1: 16, y0: { floor: -0.2 }, y1: { floor: 0 } },
    /* The outer wall holds the driveway up over the road: its top is the
     * slab's underside, its foot the road, and it runs out where the
     * slab comes down to meet the road. */
    { id: 'retainer', group: 'wall', name: 'Retaining wall', x0: 15.7, x1: 16, y0: { road: 0 }, y1: -3.1, z0: -2, z1: 6 },
    { id: 'retainer-ramp', group: 'wall', name: 'Retaining wall, tapering out', x0: 15.7, x1: 16, z0: 6, z1: 18, y0: { road: 0 }, y1: { floor: -0.2 } },
    /* The road, parallel to the wall along its outer face. `frame: false`
     * keeps its 30 m out of the camera's Fit, so the house stays the
     * subject. */
    { id: 'road', group: 'road', name: 'Road', x0: 16, x1: 20, z0: -6, z1: 24, y0: { road: -0.2 }, y1: { road: 0 }, frame: false },
  ],
};
