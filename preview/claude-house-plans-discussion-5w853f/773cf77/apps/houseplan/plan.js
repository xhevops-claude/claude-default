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
  slab: 0.2,

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
    profile: [
      [6, -6],   // one 45° fall from the house face to the foot of the wall
      [9, -6],   // and level beyond
    ],
    /* In front of the house only — between `from` and `to` across the
     * front — the ground is cut to this profile instead: dropped to the
     * garage floor at the door, level out to the wall, then down. */
    cut: {
      from: -2,
      to: 22,
      profile: [
        [0, -3],   // straight down at the door, to the garage floor
        [6, -3],   // the driveway, level out to the wall
        [6, -6],   // the retaining wall: straight down 3 m
        [9, -6],   // and level beyond
      ],
      /* Past `from` across the front the cut floor descends, reaching
       * `drop` lower at `to` — the driveway running on along the house
       * and down the hill — but never below the profile's last level,
       * so the wall at its edge shrinks to nothing as the two meet. The
       * ramp is only `dFrom` metres out and beyond; nearer the house the
       * natural slope stands, which is the face the driveway is carved
       * into. `ease` is the share of the run at each end over which the
       * grade builds up and tails off, so the floor bends into the pad
       * and the apron instead of hinging onto them — the middle is
       * correspondingly steeper. */
      ramp: { from: 5, to: 16, drop: 3, dFrom: 2.7, ease: 0.25 },
      /* The inside corner where the apron turns onto the ramp is cut
       * back in a quarter-round of this radius, so a car can swing out
       * of the garage without clipping the hill. The floor and the wall
       * along it are derived from the terrain, not listed as works. */
      fillet: { r: 2.7 },
      /* The entrance at the foot: past the ramp the hill is cut back
       * along a quarter-ellipse `flare` metres long, hugging the road's
       * edge and swinging in to the ramp's full width at its foot — the
       * way a car peels off the road. Floor and wall are derived, as
       * for the fillet. */
      mouth: { flare: 6 },
    },
  },

  /* Built things that are not a level, drawn the same way as the levels.
   * World coordinates: x0..x1 along X, z0..z1 along Z, y0..y1 up. A
   * bottom or top given as `{ floor: offset }` follows the ramp's floor
   * along Z, that much above or below it — which is how the ramp slab
   * and the walls beside it bend with the eased grade. */
  works: [
    { id: 'canopy', name: 'Cantilever over the door', x0: 10, x1: 13, y0: -0.2, y1: 0, z0: 0, z1: 6 },
    /* The apron gives its last metre to the ramp, so the grade starts
     * bending before the junction rather than at it. */
    { id: 'driveway', name: 'Apron, in front of the door', x0: 10, x1: 16, y0: -3.1, y1: -2.9, z0: -2, z1: 5 },
    { id: 'driveway-ramp', name: 'Driveway, down the hill', x0: 13, x1: 16, z0: 5, z1: 16, y0: { floor: -0.1 }, y1: { floor: 0.1 } },
    { id: 'retainer', name: 'Retaining wall', x0: 15.7, x1: 16, y0: -6, y1: -2.9, z0: -2, z1: 5 },
    { id: 'retainer-ramp', name: 'Retaining wall, tapering out', x0: 15.7, x1: 16, z0: 5, z1: 16, y0: -6, y1: { floor: 0.1 } },
    /* The uphill side of the ramp is the opposite shape: the cut face
     * beside the driveway grows from nothing to 3 m, so this wall's top
     * stays at the natural ground while its foot goes down with the
     * driveway. It stands in the 30 cm the cut is widened by. */
    { id: 'retainer-uphill', name: 'Mini retaining wall, uphill side', x0: 12.7, x1: 13, z0: 7.7, z1: 16, y0: { floor: -0.1 }, y1: -2.7 },
    /* The road, parallel to the wall along its outer face. `frame: false`
     * keeps its 30 m out of the camera's Fit, so the house stays the
     * subject. */
    { id: 'road', name: 'Road', x0: 16, x1: 20, z0: -6, z1: 24, y0: -6.1, y1: -5.9, frame: false },
  ],
};
