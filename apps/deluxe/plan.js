/* Deluxe — a second plan, started from House Wire as it stood at PR #143.
 *
 * The house, as little of it as the wireframe needs.
 *
 * Metres. Plan coordinates are (x, y); the renderer turns plan y into
 * world z, so `envelope` reads x0..x1 along X and y0..y1 along Z.
 * `envelope` is the drawn box itself — outer face to outer face.
 *
 * Everything the viewer draws comes from here. Add to this file and the
 * box grows — nothing is hard-coded in app.js.
 */
window.HOUSE_PLAN = {
  name: 'Deluxe — wireframe',

  /* No house yet: the site alone — the surveyed parcel, the existing
   * building on it and the relief. The plan grows from here. `slab` and
   * `wall` are the thicknesses anything built later will use. */
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

  levels: [],
  works: [],
};
