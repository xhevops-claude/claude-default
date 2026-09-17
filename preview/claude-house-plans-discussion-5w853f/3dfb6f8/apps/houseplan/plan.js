/* The house, as little of it as the wireframe needs.
 *
 * Metres. Plan coordinates are (x, y) with +x east and +y south; the
 * renderer turns plan y into world z. `envelope` is the wall centreline
 * rectangle, so the drawn box is inflated by half of `extWall`.
 *
 * Everything the viewer draws comes from here. Add to this file and the
 * box grows — nothing is hard-coded in app.js.
 */
window.HOUSE_PLAN = {
  name: 'House — wireframe',

  envelope: { x0: 0, y0: 0, x1: 12, y1: 10 },
  extWall: 0.3,
  slab: 0.2,

  levels: [
    { id: 'basement', name: 'Basement', elevation: -2.9, height: 2.7 },
    { id: 'ground', name: 'Ground floor', elevation: 0, height: 2.7 },
    { id: 'first', name: 'First floor', elevation: 2.9, height: 2.7 },
  ],
};
