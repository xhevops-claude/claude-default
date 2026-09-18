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

  /* `envelope` is the upper floors. A level can push past it on the
   * downhill face with `extendFront` — the garage is dug into the back
   * of the slope and pushed 3 m out of the front of it. */
  levels: [
    { id: 'garage', name: 'Garage', elevation: -2.9, height: 2.7, extendFront: 3 },
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
      [3, -3],   // 45° down across the pushed-out garage, corner to corner
      [6, -3],   // level fill under the apron
      [6, -6],   // the retaining wall: straight down 3 m
      [9, -6],   // and level beyond
    ],
  },

  /* Built ground that is not a level, drawn the same way as the levels.
   * World coordinates: x0..x1 along X, z0..z1 along Z, y0..y1 up. */
  works: [
    { id: 'apron', name: 'Garage apron', x0: 13, x1: 16, y0: -3.1, y1: -2.9, z0: 0, z1: 6 },
    { id: 'retainer', name: 'Retaining wall', x0: 15.7, x1: 16, y0: -6, y1: -2.9, z0: 0, z1: 6 },
  ],
};
