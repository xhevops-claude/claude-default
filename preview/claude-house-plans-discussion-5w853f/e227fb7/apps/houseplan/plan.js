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
   * breaks at the downhill face and falls at `angle` until it is `drop`
   * lower. At 45° that run is 3 m — the same as the garage's push — so
   * the slope cuts the pushed-out part corner to corner: the earth ends
   * exactly at the outer edge of the garage floor, and the ceiling
   * stands 3 m out over it. `front` is the downhill face — '+X', '-X',
   * '+Z' or '-Z' — and `extendFront` pushes out of that same face. */
  terrain: {
    front: '+X',
    backLevel: 0,
    drop: 3,
    angle: 45,
  },
};
