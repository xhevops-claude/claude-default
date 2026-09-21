/* Deluxe — a second plan, on a different site. Empty for now: the
 * terrain, the parcel and the building come from the documents still to
 * be read. Everything the viewer draws comes from here.
 *
 * Metres. Plan coordinates are (x, y); the renderer turns plan y into
 * world z. World axes: X east, Y up, Z south.
 */
window.HOUSE_PLAN = {
  name: 'Deluxe — wireframe',

  /* Thicknesses anything built later will use: a slab's top is the
   * finished level and its underside `slab` below; a retaining wall is
   * `wall` thick. */
  slab: 0.2,
  wall: 0.3,

  /* Every built thing is its own object in the scene, and belongs to
   * one of these groups — the group gives it its colour, and the
   * legend along the bottom hides or shows a whole group at a tap. */
  groups: {
    house: { name: 'House', color: '#8fd8ff' },
    canopy: { name: 'Cantilever', color: '#ff8c5a' },
    drive: { name: 'Driveway', color: '#f5e663' },
    wall: { name: 'Retaining walls', color: '#d28cff' },
    road: { name: 'Road', color: '#9aa4b2' },
    parcel: { name: 'Parcel', color: '#ff4d3d' },
    relief: { name: 'Relief', color: '#6fbf9a' },
  },

  levels: [],
  works: [],
};
