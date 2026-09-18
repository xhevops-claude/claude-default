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
      from: 0,
      to: 6,
      profile: [
        [0, -3],   // straight down at the door, to the garage floor
        [6, -3],   // the driveway, level out to the wall
        [6, -6],   // the retaining wall: straight down 3 m
        [9, -6],   // and level beyond
      ],
    },
  },

  /* Built things that are not a level, drawn the same way as the levels.
   * World coordinates: x0..x1 along X, z0..z1 along Z, y0..y1 up. */
  works: [
    { id: 'canopy', name: 'Cantilever over the door', x0: 10, x1: 13, y0: -0.2, y1: 0, z0: 0, z1: 6 },
    { id: 'driveway', name: 'Driveway', x0: 10, x1: 16, y0: -3.1, y1: -2.9, z0: 0, z1: 6 },
    { id: 'retainer', name: 'Retaining wall', x0: 15.7, x1: 16, y0: -6, y1: -2.9, z0: 0, z1: 6 },
  ],
};
