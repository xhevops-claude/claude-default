/* Generates the house above the garage for projects/xhevo/house/scene.json
   and splices it into the `works` array, keeping the file's own style; then
   patches the levels, the yard's west edge, the defaults and the notes. Run
   against the scene as it was before the house (git show main:…).
   House frame: x along (east = front, +x), z across (north 0, south 7),
   y up, metres above the garage floor; the ground floor at 0, its ceiling
   2.70, the first floor at 2.90, the roof off the first floor. */
import fs from 'node:fs';

const FILE = '/home/user/claude-default/projects/xhevo/house/scene.json';
let src = fs.readFileSync(FILE, 'utf8');

const r3 = (n) => Math.round(n * 1000) / 1000;
const G = (id, name) => ({ id, name });
const GROUND = G('ground', 'Ground floor'), FIRSTG = G('first', 'First floor');
const works = [];
const add = (o) => works.push({ id: o.id, group: 'house', ...o, house: true });

const WALL = '#cfc3a6', GLASS = '#8fd8ff', DOOR = '#e2834f', KITCHEN = '#f0b26b', STAIR = '#6fc79c', ROOF = '#d9a066', AIR = '#8fd8ff', STONE = '#b8a48c', TVC = '#9ad0ff';
const OP = { wall: 0.22, part: 0.18, room: 0.1, air: 0.03, glass: 0.08, door: 0.2, kitchen: 0.18, stair: 0.2, roof: 0.14, stone: 0.3 };

const box = (id, name, short, parent, color, opacity, x0, x1, z0, z1, y0, y1, ends = {}) => {
  const o = { id, color, opacity, parent, short, name, x0: r3(x0), x1: r3(x1), z0: r3(z0), z1: r3(z1), y0: r3(y0), y1: r3(y1) };
  if (ends.y0End != null) o.y0End = r3(ends.y0End);
  if (ends.y1End != null) o.y1End = r3(ends.y1End);
  add(o);
};
const poly = (id, name, short, parent, color, opacity, ring, y0, y1) =>
  add({ id, color, opacity, parent, short, name, ring: ring.map(([x, z]) => [r3(x), r3(z)]), y0: r3(y0), y1: r3(y1) });
const under = (...path) => [GROUND, ...path];
const up = (...path) => [FIRSTG, ...path];

/* ── the house: x 2–11 over all, 0.30 outer walls, so x 2.3–10.7 and z 0.3–6.7 clear ── */
const X0 = 2, XW = 2.3, LIV = 5.7, XE = 10.7;

/* ── the roof: a gable with its ridge along the house over z 3.5, 35°, off
   the first floor: a 0.50 knee wall puts the eaves at 3.40 on the north and
   south walls, the ridge at 5.85; 0.40 of overhang all round ── */
const KNEE = 0.5, EAVES = 2.9 + KNEE, TAN = Math.tan(35 * Math.PI / 180), RIDGE = EAVES + 3.5 * TAN;
const roofUnder = (z) => EAVES + (3.5 - Math.abs(z - 3.5)) * TAN;
const RT = 0.2; // the roof's thickness

/* ── the stair to the first floor: a quarter turn in the north-west corner,
   17 risers of 2.90/17: four 0.27 treads west along the north wall from the
   hall (foot x 4.4), three winders in the corner square, nine treads south
   along the back wall to the top riser at z 3.73; the toilet under the west leg ── */
const RISE = 2.9 / 17, T = 0.27;
const FOOTX = 4.4, WELLZ = 1.3, TOPZ = WELLZ + 9 * T;
const WCX1 = 3.8, WCZ0 = 2.0, WCZ1 = 3.7, BEDZ = 3.8;
const soffit = (z) => (8 + (z - WELLZ) / T) * RISE - 0.2;

/* ════════ ground floor ════════ */
const ROOMS = under(G('rooms', 'Rooms'));
poly('room-hall', 'Hall: the landing where the garage flight arrives and the stair up begins, and the room south of it with the toilet and bedroom doors, 5.8 m²', 'Hall', ROOMS, '#f5e663', OP.room,
  [[FOOTX, 0.3], [LIV, 0.3], [LIV, WCZ1], [WCX1 + 0.1, WCZ1], [WCX1 + 0.1, WCZ0 - 0.1], [3.4, WCZ0 - 0.1], [3.4, 1.4], [FOOTX, 1.4]], 0, 0.02);
box('room-wc', 'Toilet under the stair’s west leg, 1.50 × 1.70, 2.6 m²: the flight is its ceiling over the pan, 2.70 at the door', 'Toilet', ROOMS, '#9aa4b2', OP.room, XW, WCX1, WCZ0, WCZ1, 0, 0.02);
box('room-store', 'Low store under the winders and the first treads, from the hall’s bay through the stair wall: 1.00 × 0.50, up to 1.5', 'Store', ROOMS, '#9aa4b2', 0.06, XW, 3.3, 1.4, 1.9, 0, 0.02);
box('room-bed', 'Bedroom, 3.30 × 2.90, 9.6 m², window to the yard', 'Bedroom', ROOMS, '#b47cff', OP.room, XW, LIV - 0.1, BEDZ, 6.7, 0, 0.02);
box('room-living', 'Living room with kitchen, 5.00 × 5.20, 26.0 m², open to the roof: the closed stair with the fire and the TV on its north side, the panorama its alone', 'Living room', ROOMS, '#6fc79c', OP.room, LIV, XE, 1.5, 6.7, 0, 0.02);

/* the living room's air up to the roof */
const TALL = under(G('tall', 'Open to the roof'));
box('tall-1', 'Living room above the ground storey, to the eaves at 3.40', 'To the eaves', TALL, AIR, OP.air, LIV, XE, 0.3, 6.7, 2.7, EAVES);
box('tall-2', 'Living room under the north slope, 3.61 at the wall to 5.85 at the ridge', 'Under the north slope', TALL, AIR, OP.air, LIV, XE, 0.3, 3.5, EAVES, roofUnder(0.3), { y1End: RIDGE });
box('tall-3', 'Living room under the south slope, 5.85 at the ridge to 3.61 at the wall', 'Under the south slope', TALL, AIR, OP.air, LIV, XE, 3.5, 6.7, EAVES, RIDGE, { y1End: roofUnder(6.7) });

/* outer walls: north and south up to the eaves (the knee wall is their top 0.50), the west gable to the roof */
const OUTER = under(G('outer-walls', 'Outer walls'));
box('wall-n', 'Outer wall, north, up to the eaves at 3.40: the knee wall is its top 0.50', 'North', OUTER, WALL, OP.wall, X0, 11, 0, 0.3, 0, EAVES);
box('wall-w-n', 'Outer wall, west, against the hill: the gable’s north half, up to the roof', 'West, north half', OUTER, WALL, OP.wall, X0, XW, 0.3, 3.5, 0, roofUnder(0.3), { y1End: RIDGE });
box('wall-w-s', 'Outer wall, west, against the hill: the gable’s south half, up to the roof', 'West, south half', OUTER, WALL, OP.wall, X0, XW, 3.5, 6.7, 0, RIDGE, { y1End: roofUnder(6.7) });
box('wall-s-1', 'Outer wall, south, west of the bedroom window', 'South 1', OUTER, WALL, OP.wall, X0, 4.0, 6.7, 7, 0, 2.7);
box('wall-s-1-sill', 'Outer wall, south, under the bedroom window', 'South 1, sill', OUTER, WALL, OP.wall, 4.0, 5.4, 6.7, 7, 0, 0.9);
box('wall-s-1-head', 'Outer wall, south, over the bedroom window', 'South 1, head', OUTER, WALL, OP.wall, 4.0, 5.4, 6.7, 7, 2.2, 2.7);
box('wall-s-2', 'Outer wall, south, from the bedroom window to the yard door', 'South 2', OUTER, WALL, OP.wall, 5.4, 7.5, 6.7, 7, 0, 2.7);
box('wall-s-2-head', 'Outer wall, south, over the yard door', 'South 2, head', OUTER, WALL, OP.wall, 7.5, 8.4, 6.7, 7, 2.1, 2.7);
box('wall-s-3', 'Outer wall, south, between the yard door and the window', 'South 3', OUTER, WALL, OP.wall, 8.4, 8.9, 6.7, 7, 0, 2.7);
box('wall-s-3-sill', 'Outer wall, south, under the window by the table', 'South 3, sill', OUTER, WALL, OP.wall, 8.9, 10.3, 6.7, 7, 0, 0.9);
box('wall-s-3-head', 'Outer wall, south, over the window by the table', 'South 3, head', OUTER, WALL, OP.wall, 8.9, 10.3, 6.7, 7, 2.2, 2.7);
box('wall-s-4', 'Outer wall, south, to the panorama glass', 'South 4', OUTER, WALL, OP.wall, 10.3, 11, 6.7, 7, 0, 2.7);
box('wall-s-top', 'Outer wall, south, the band from the ground floor’s ceiling to the eaves at 3.40', 'South, top', OUTER, WALL, OP.wall, X0, 11, 6.7, 7, 2.7, EAVES);

/* the panorama: the east gable is glass between the walls, from the floor to the roof, a door to the balcony at its south end */
const GL = under(G('glass', 'Panorama glass'));
box('glass-n', 'Panorama glass, north half: 3.20 wide, from the floor to the roof, 3.61 at the wall rising to 5.85 at the ridge', 'North half', GL, GLASS, OP.glass, XE, 11, 0.3, 3.5, 0, roofUnder(0.3), { y1End: RIDGE });
box('glass-s-1', 'Panorama glass, south half to the balcony door: 2.00 wide, 5.85 at the ridge falling to 4.45', 'South half', GL, GLASS, OP.glass, XE, 11, 3.5, 5.5, 0, RIDGE, { y1End: roofUnder(5.5) });
box('door-balcony', 'Door to the balcony in the glass, 1.00 × 2.30', 'Balcony door', GL, DOOR, OP.door, XE, 11, 5.5, 6.5, 0, 2.3);
box('glass-s-2', 'Panorama glass over the balcony door, 4.45 falling to 3.75', 'Over the door', GL, GLASS, OP.glass, XE, 11, 5.5, 6.5, 2.3, roofUnder(5.5), { y1End: roofUnder(6.5) });
box('glass-s-3', 'Panorama glass, south end: 0.20 wide, 3.75 falling to 3.61 at the wall', 'South end', GL, GLASS, OP.glass, XE, 11, 6.5, 6.7, 0, roofUnder(6.5), { y1End: roofUnder(6.7) });

/* the garage stair, closed in: walls on the opening's south side and east end up to the ceiling line, a lid flush with the first floor */
const SBOX = under(G('stair-box', 'Garage stair, closed'));
box('stair-box-s', 'Stair enclosure, south wall, 3.58 × 2.70: the breast with the fire and the TV stands against it', 'South wall', SBOX, WALL, OP.part, LIV, 9.28, 1.4, 1.5, 0, 2.7);
box('stair-box-e', 'Stair enclosure, east end', 'East end', SBOX, WALL, OP.part, 9.18, 9.28, 0.3, 1.4, 0, 2.7);
box('stair-box-lid', 'Stair enclosure, the lid at the first floor’s level: a 3.58 × 1.20 ledge, out of reach', 'Lid', SBOX, WALL, OP.part, LIV, 9.28, 0.3, 1.5, 2.7, 2.9);

/* the fireplace: a stone-faced breast 2.20 × 0.50 in front of the closed stair, up to the roof,
   a low wide insert at its foot, a mantel shelf, the TV above on a pull-down mount, the chimney through the roof */
const FIRE = under(G('fireplace', 'Fireplace and TV'));
const BX0 = 7.0, BX1 = 9.2, BZ0 = 1.5, BZ1 = 2.0;
box('breast', 'Chimney breast, 2.20 × 0.50, stone on a frame, from the floor to the roof’s underside: the fire at its foot, the TV above', 'Breast', FIRE, STONE, OP.stone, BX0, BX1, BZ0, BZ1, 0, roofUnder(BZ0), { y1End: roofUnder(BZ1) });
box('firebox', 'The fire: a closed insert 1.00 × 0.50, its opening 0.20 to 0.70 above the floor, facing the sofa', 'Fire', FIRE, DOOR, 0.3, 7.6, 8.6, 1.55, BZ1, 0.2, 0.7);
box('mantel', 'Mantel shelf at 0.85, 0.35 deep: throws the fire’s heat forward, away from the TV', 'Mantel', FIRE, STONE, OP.stone, 6.9, 9.3, BZ1, 2.35, 0.85, 0.93);
box('tv', 'TV 75″, 1.67 × 0.95, on a pull-down mount: winter up at 1.15–2.10 tilted 10° down, summer down 0.45 over the cold fire; 2.7 m from the sofa', 'TV', FIRE, TVC, 0.25, 7.265, 8.935, BZ1, 2.06, 1.15, 2.1);
box('chimney-1', 'Chimney, 0.80 × 0.50, through the roof’s north slope', 'Chimney, through the roof', FIRE, STONE, OP.stone, 7.7, 8.5, BZ0, BZ1, roofUnder(BZ0), roofUnder(BZ1) + RT, { y0End: roofUnder(BZ1) });
box('chimney-2', 'Chimney above the roof, to 6.65: 0.80 over the ridge', 'Chimney, above the roof', FIRE, STONE, OP.stone, 7.7, 8.5, BZ0, BZ1, roofUnder(BZ1) + RT, RIDGE + 0.8);

/* windows and doors */
const OPEN = under(G('openings', 'Windows and doors'));
box('win-bed', 'Bedroom window to the yard, 1.40 × 1.30, sill 0.90', 'Bedroom window', OPEN, GLASS, OP.glass, 4.0, 5.4, 6.7, 7, 0.9, 2.2);
box('door-yard', 'Yard door in the south wall, 0.90, glazed, swings in: the entrance from the yard', 'Yard door', OPEN, DOOR, OP.door, 7.5, 8.4, 6.7, 7, 0, 2.1);
box('win-south', 'Window to the yard by the table, 1.40 × 1.30, sill 0.90', 'South window', OPEN, GLASS, OP.glass, 8.9, 10.3, 6.7, 7, 0.9, 2.2);
box('door-wc', 'Toilet door, 0.80 × 2.00, from the hall, swings in', 'Toilet door', OPEN, DOOR, OP.door, WCX1, WCX1 + 0.1, 2.8, 3.6, 0, 2.0);
box('door-bed', 'Bedroom door, 0.90, from the hall, swings in', 'Bedroom door', OPEN, DOOR, OP.door, 4.6, 5.5, WCZ1, BEDZ, 0, 2.1);
box('door-store', 'Store hatch in the stair wall, 0.50 × 1.40, from the hall’s bay', 'Store hatch', OPEN, DOOR, OP.door, 3.3, 3.4, 1.4, 1.9, 0, 1.4);

/* partitions, 0.10 */
const PART = under(G('partitions', 'Partitions'));
box('part-stair-n', 'Stair wall along the north leg, its south side', 'Stair wall, north leg', PART, WALL, OP.part, 3.3, FOOTX, 1.3, 1.4, 0, 2.7);
box('part-stair-w-head', 'Stair wall along the west leg’s first treads, over the store hatch', 'Stair wall, west leg, head', PART, WALL, OP.part, 3.3, 3.4, 1.4, 1.9, 1.4, 2.7);
box('part-stair-w-2', 'Stair wall along the west leg, the post at the toilet’s wall', 'Stair wall, west leg, post', PART, WALL, OP.part, 3.3, 3.4, 1.9, WCZ0, 0, 2.7);
box('part-stair-parapet', 'Stair parapet on the west leg’s east string, from the flight’s underside to the ceiling: the toilet’s side to the stair', 'Stair parapet', PART, WALL, OP.part, 3.3, 3.4, WCZ0, WCZ1, soffit(WCZ0), 2.7, { y0End: soffit(WCZ1) });
box('part-wc-n-1', 'Toilet wall, north, under the flight', 'Toilet, north 1', PART, WALL, OP.part, XW, 3.3, 1.9, WCZ0, 0, 1.5);
box('part-wc-n-2', 'Toilet wall, north, east of the stair', 'Toilet, north 2', PART, WALL, OP.part, 3.3, WCX1 + 0.1, 1.9, WCZ0, 0, 2.7);
box('part-wc-e-1', 'Toilet wall, east, north of the door', 'Toilet, east 1', PART, WALL, OP.part, WCX1, WCX1 + 0.1, WCZ0, 2.8, 0, 2.7);
box('part-wc-e-head', 'Toilet wall, east, over the door', 'Toilet, east head', PART, WALL, OP.part, WCX1, WCX1 + 0.1, 2.8, 3.6, 2.0, 2.7);
box('part-wc-e-2', 'Toilet wall, east, south of the door', 'Toilet, east 2', PART, WALL, OP.part, WCX1, WCX1 + 0.1, 3.6, WCZ1, 0, 2.7);
box('part-bed-n-1', 'Bedroom wall, north, west of the door; the toilet’s south wall', 'Bedroom, north 1', PART, WALL, OP.part, XW, 4.6, WCZ1, BEDZ, 0, 2.7);
box('part-bed-n-head', 'Bedroom wall, north, over the door', 'Bedroom, north head', PART, WALL, OP.part, 4.6, 5.5, WCZ1, BEDZ, 2.1, 2.7);
box('part-bed-n-2', 'Bedroom wall, north, the corner east of the door', 'Bedroom, north 2', PART, WALL, OP.part, 5.5, LIV, WCZ1, BEDZ, 0, 2.7);
box('part-bed-e', 'Bedroom wall, east; the kitchen stands against it', 'Bedroom, east', PART, WALL, OP.part, LIV - 0.1, LIV, BEDZ, 6.7, 0, 2.7);

/* kitchen */
const KIT = under(G('kitchen', 'Kitchen'));
box('kitchen-run', 'Kitchen counter along the bedroom wall, 2.90 × 0.60, 0.90 high', 'Counter', KIT, KITCHEN, OP.kitchen, LIV, LIV + 0.6, BEDZ, 6.7, 0.02, 0.9);
box('kitchen-return', 'Kitchen counter, the return along the south wall, 0.90 × 0.60', 'Return', KIT, KITCHEN, OP.kitchen, LIV + 0.6, 7.2, 6.1, 6.7, 0.02, 0.9);

/* the stair to the first floor */
const UP = under(G('up-stair', 'Stair to the first floor'));
const TR = [...UP, G('up-treads', 'Treads')];
for (let i = 1; i <= 4; i++) {
  const x1 = FOOTX - (i - 1) * T, top = i * RISE;
  box(`up-stair-${String(i).padStart(2, '0')}`, `Tread ${i} of 16, west along the north wall, top at +${top.toFixed(2)}`, `Tread ${i}`, TR, STAIR, OP.stair, x1 - T, x1, 0.3, 1.3, top - 0.2, top);
}
const P0 = [3.3, 0.3], P1 = [2.633, 0.3], P2 = [XW, 0.633], P3 = [XW, 1.3], IN = [3.3, 1.3];
const winders = [[IN, P0, P1], [IN, P1, [XW, 0.3], P2], [IN, P2, P3]];
winders.forEach((ring, k) => {
  const i = 5 + k, top = i * RISE;
  poly(`up-stair-${String(i).padStart(2, '0')}`, `Tread ${i} of 16, a winder in the corner, top at +${top.toFixed(2)}`, `Tread ${i}`, TR, STAIR, OP.stair, ring, top - 0.2, top);
});
for (let i = 8; i <= 16; i++) {
  const z0 = WELLZ + (i - 8) * T, top = i * RISE;
  box(`up-stair-${String(i).padStart(2, '0')}`, `Tread ${i} of 16, south along the back wall, top at +${top.toFixed(2)}`, `Tread ${i}`, TR, STAIR, OP.stair, XW, 3.3, z0, z0 + T, top - 0.2, top);
}

/* ════════ first floor: two bedrooms under the roof, the stair and its landing between them ════════ */
const FR = up(G('ff-rooms', 'Rooms'));
box('ff-north', 'North bedroom, 2.20 × 3.30, 7.3 m²: the bed under the north slope, a window onto the tall room; nothing to the neighbour’s side', 'North bedroom', FR, '#b47cff', OP.room, 3.4, LIV - 0.1, 0.3, 3.6, 2.9, 2.92);
box('ff-south', 'South bedroom, 3.30 × 2.10, 6.9 m²: the bed under the south slope, a window onto the tall room and a roof window to the yard', 'South bedroom', FR, '#b47cff', OP.room, XW, LIV - 0.1, 4.6, 6.7, 2.9, 2.92);
box('ff-landing', 'Landing at the stair’s top, 0.77 deep, the bedroom doors facing each other across it', 'Landing', FR, '#f5e663', OP.room, XW, 4.5, TOPZ, 4.5, 2.9, 2.92);
box('ff-cupboard', 'Cupboard at the landing’s end, 1.00 × 0.80', 'Cupboard', FR, '#9aa4b2', 0.06, 4.6, LIV - 0.1, 3.7, 4.5, 2.9, 2.92);

const FP = up(G('ff-partitions', 'Partitions'));
const ru = roofUnder;
box('ff-well-wall', 'Stairwell wall, the stair’s east side up to the roof', 'Stairwell wall', FP, WALL, OP.part, 3.3, 3.4, 0.3, TOPZ, 2.9, ru(0.3), { y1End: ru(TOPZ) });
box('ff-north-s-1', 'North bedroom, south wall, west of the door', 'North bedroom, south 1', FP, WALL, OP.part, 3.4, 3.5, 3.6, 3.7, 2.9, ru(3.65));
box('ff-north-s-head', 'North bedroom, south wall, over the door', 'North bedroom, south head', FP, WALL, OP.part, 3.5, 4.3, 3.6, 3.7, 4.9, ru(3.65));
box('ff-north-s-2', 'North bedroom, south wall, east of the door', 'North bedroom, south 2', FP, WALL, OP.part, 4.3, LIV - 0.1, 3.6, 3.7, 2.9, ru(3.65));
box('ff-south-n-1', 'South bedroom, north wall, west of the door', 'South bedroom, north 1', FP, WALL, OP.part, XW, 3.5, 4.5, 4.6, 2.9, ru(4.55));
box('ff-south-n-head', 'South bedroom, north wall, over the door', 'South bedroom, north head', FP, WALL, OP.part, 3.5, 4.3, 4.5, 4.6, 4.9, ru(4.55));
box('ff-south-n-2', 'South bedroom, north wall, east of the door', 'South bedroom, north 2', FP, WALL, OP.part, 4.3, LIV - 0.1, 4.5, 4.6, 2.9, ru(4.55));
box('ff-cupboard-w', 'Cupboard, its wall to the landing, with a 0.60 door', 'Cupboard wall', FP, WALL, OP.part, 4.5, 4.6, 3.7, 4.5, 2.9, ru(3.7), { y1End: ru(4.5) });
/* the front wall onto the tall room, its top following the roof, a window in each room's part */
const FW = up(G('ff-front', 'Front wall, onto the tall room'));
const front = (id, name, short, z0, z1, y0, y1, y0End, y1End, color = WALL, opacity = OP.part) =>
  box(id, name, short, FW, color, opacity, LIV - 0.1, LIV, z0, z1, y0, y1, { y0End, y1End });
front('ff-front-1', 'Front wall, north end, up to the roof', 'North end', 0.3, 1.6, 2.9, ru(0.3), 2.9, ru(1.6));
front('ff-front-2-sill', 'Front wall under the north bedroom’s window', 'North window, sill', 1.6, 3.2, 2.9, 3.7, 2.9, 3.7);
front('ff-win-n', 'North bedroom’s window onto the tall room, 1.60 wide, from 0.80 up to the roof: the gable’s glass beyond it', 'North window', 1.6, 3.2, 3.7, ru(1.6) - 0.15, 3.7, ru(3.2) - 0.15, GLASS, OP.glass);
front('ff-front-2-head', 'Front wall over the north bedroom’s window, a strip under the roof', 'North window, head', 1.6, 3.2, ru(1.6) - 0.15, ru(1.6), ru(3.2) - 0.15, ru(3.2));
front('ff-front-3', 'Front wall from the north window to the south window, past the landing', 'Middle', 3.2, 4.6, 2.9, ru(3.2), 2.9, ru(4.6));
front('ff-front-4-sill', 'Front wall under the south bedroom’s window', 'South window, sill', 4.6, 5.8, 2.9, 3.7, 2.9, 3.7);
front('ff-win-s', 'South bedroom’s window onto the tall room, 1.20 wide, from 0.80 up to the roof', 'South window', 4.6, 5.8, 3.7, ru(4.6) - 0.15, 3.7, ru(5.8) - 0.15, GLASS, OP.glass);
front('ff-front-4-head', 'Front wall over the south bedroom’s window, a strip under the roof', 'South window, head', 4.6, 5.8, ru(4.6) - 0.15, ru(4.6), ru(5.8) - 0.15, ru(5.8));
front('ff-front-5', 'Front wall, south end, down to the eaves', 'South end', 5.8, 6.7, 2.9, ru(5.8), 2.9, ru(6.7));
const FO = up(G('ff-openings', 'Doors and the roof window'));
box('door-ff-north', 'North bedroom door, 0.80 × 2.00, from the landing', 'North bedroom door', FO, DOOR, OP.door, 3.5, 4.3, 3.6, 3.7, 2.9, 4.9);
box('door-ff-south', 'South bedroom door, 0.80 × 2.00, from the landing', 'South bedroom door', FO, DOOR, OP.door, 3.5, 4.3, 4.5, 4.6, 2.9, 4.9);
box('door-ff-cupboard', 'Cupboard door, 0.60', 'Cupboard door', FO, DOOR, OP.door, 4.5, 4.6, 3.8, 4.4, 2.9, 4.9);
box('roof-win-s', 'Roof window to the yard over the south bedroom, 1.40 × 0.80, in the south slope', 'Roof window', FO, GLASS, 0.2, 2.6, 4.0, 5.5, 6.3, ru(5.5) + RT, ru(5.5) + RT + 0.05, { y0End: ru(6.3) + RT, y1End: ru(6.3) + RT + 0.05 });

/* ════════ the roof ════════ */
const RF = [G('roof', 'Roof')];
box('roof-n', 'Roof, north slope: 35°, eaves at 3.40 on the wall, ridge at 5.85, 0.40 of overhang; the chimney comes through it', 'North slope', RF, ROOF, OP.roof, X0 - 0.4, 11.4, -0.4, 3.5, ru(-0.4), ru(-0.4) + RT, { y0End: RIDGE, y1End: RIDGE + RT });
box('roof-s', 'Roof, south slope: 35°, ridge at 5.85, eaves at 3.40 on the wall, 0.40 of overhang; the roof window in it', 'South slope', RF, ROOF, OP.roof, X0 - 0.4, 11.4, 3.5, 7.4, RIDGE, RIDGE + RT, { y0End: ru(7.4), y1End: ru(7.4) + RT });

/* ════════ splice ════════ */
const val = (v) => Array.isArray(v) ? `[ ${v.map(val).join(', ')} ]`
  : v && typeof v === 'object' ? `{ ${Object.entries(v).map(([k, x]) => `"${k}": ${val(x)}`).join(', ')} }`
  : JSON.stringify(v);
const block = (o) => `  {\n${Object.entries(o).map(([k, v]) => `   "${k}": ${val(v)}`).join(',\n')}\n  }`;
const rep = (a, b) => { const n = src.split(a).length - 1; if (n !== 1) throw new Error(`${n} matches for: ${a.slice(0, 70)}`); src = src.replace(a, b); };

const TAIL = '  } ]\n}\n';
if (!src.endsWith(TAIL)) throw new Error('unexpected tail');
if (src.includes('"id": "room-hall"')) throw new Error('already applied');
src = src.slice(0, -TAIL.length) + '  },\n' + works.map(block).join(',\n') + ' ]\n}\n';

rep('   "id": "ground",\n   "name": "Ground floor",\n   "elevation": 0,\n   "height": 2.7,\n   "x0": 3,\n   "extendFront": 1\n  },',
    '   "id": "ground",\n   "name": "Ground floor",\n   "elevation": 0,\n   "height": 2.7,\n   "x0": 2,\n   "extendFront": 1,\n   "holes": [ { "x0": 5.7, "x1": 9.18, "z0": 0.3, "z1": 1.4 } ]\n  },');
rep('   "id": "first",\n   "name": "First floor",\n   "elevation": 2.9,\n   "height": 2.7,\n   "x0": 3,\n   "extendFront": 1\n  } ],',
    `   "id": "first",\n   "name": "First floor",\n   "elevation": 2.9,\n   "height": ${KNEE},\n   "x0": 2,\n   "x1": 5.7,\n   "holes": [ { "x0": ${XW}, "x1": 3.3, "z0": 0.3, "z1": ${r3(TOPZ)} } ]\n  } ],`);
rep('  "layers": {\n   "dots": true,', '  "layers": {\n   "dots": false,');
rep('"ring": [ [ 10.99, 6.86 ], [ 3.07, 7.98 ], [ 4.43, 17.57 ], [ 7.25, 17.23 ], [ 9.95, 17.35 ], [ 12.54, 17.78 ] ],',
    '"ring": [ [ 10.99, 6.86 ], [ 2.08, 8.12 ], [ 3.43, 17.69 ], [ 7.25, 17.23 ], [ 9.95, 17.35 ], [ 12.54, 17.78 ] ],');
rep('The back 2.7 m of the hill stay in place under the ground floor, so the pit is shallower there and the retaining walls behind it shorter.',
    'The back 3.7 m of the hill stay in place under the ground floor, so the pit is shallower there and the retaining walls behind it shorter.');
rep('The ground and first floors are moved 1 m forward and shortened 2 m at the back, x 3–11, 8 m long (`x0` 3, `extendFront` 1), so the ground floor\'s slab covers the garage to x 11.',
    'The ground and first floors are moved 1 m forward and shortened 1 m at the back, x 2–11, 9 m long (`x0` 2, `extendFront` 1; the first floor ends at x 5.7, see below), so the ground floor\'s slab covers the garage to x 11.');
rep('its north edge is the house\'s south wall (house x 3–11 at z 7), its west and east edges run in line with the house\'s end walls (house x 3 and x 11) down to the parcel boundary, and the boundary closes it.',
    'its north edge is the house\'s south wall (house x 2–11 at z 7), its west and east edges run in line with the house\'s end walls (house x 2 and x 11) down to the parcel boundary, and the boundary closes it.');
rep('no fill is planned yet — that is decided once the house is built (`fill: true` and a `taper` band on the east edge would add it). Recompute the ring (the four turned points) if the turn or the floors\' extent changes." ],',
    'no fill is planned yet — that is decided once the house is built (`fill: true` and a `taper` band on the east edge would add it). Recompute the ring (the four turned points) if the turn or the floors\' extent changes.",\n'
  + '  "The house above the garage is one storey and a roof. The ground floor (x 2–11, z 0–7, 0.30 outer walls, 8.40 × 6.40 clear) is planned around where the garage flight lands: its top riser is the garage\'s back wall line, x 5.7, so you step out into the hall at the back of the north strip. The flight\'s opening in the deck (x 5.7–9.18 × z 0.3–1.4, from the 5th riser) is closed in — 0.10 walls on its south side and east end to 2.7 and a lid at 2.7–2.9 — so the living room sees a 3.58 × 1.20 × 2.90 block along the north wall, not a hole. The hall holds the landing (x 4.4–5.7, z 0.3–1.4) and the room south of it (to z 3.7) with the toilet door (x 3.8, z 2.8–3.6) and the bedroom door (z 3.7, x 4.6–5.5). The stair to the first floor is a quarter turn in the north-west corner, 17 risers of 2.90/17: four 0.27 treads west along the north wall, three winders in the corner square (x 2.3–3.3, z 0.3–1.3), nine treads south along the back wall to the top riser at z 3.73; the toilet is under its west leg (x 2.3–3.8, z 2.0–3.7), the flight its ceiling, a parapet on the flight\'s string its side to the stair; a low store under the winders opens off the hall\'s bay. The bedroom takes the south-west corner, x 2.3–5.6 × z 3.8–6.7, 9.6 m², a 1.40 window to the yard, its north wall on the toilet\'s south wall line. The living room is the whole front from the bedroom wall, x 5.7–10.7, z 1.5–6.7, 26 m², and it is open to the roof: the first floor stops at x 5.7. The roof is a gable with its ridge along the house over z 3.5, 35°, off the first floor with a 0.50 knee wall: eaves at 3.40 on the north and south walls, ridge at 5.85, 0.40 of overhang, two `works` slopes whose `y0End`/`y1End` carry the pitch. The panorama is the east gable itself: one pentagon of glass between the walls, 6.40 wide, 3.61 at the walls and 5.85 at the apex, with a 1.00 door to the balcony at its south end. In front of the closed stair stands the chimney breast, 2.20 × 0.50 (x 7.0–9.2, z 1.5–2.0), stone on a frame up to the roof: a low wide insert at its foot (opening 0.20–0.70), a mantel shelf at 0.85, and the TV above it (1.15–2.10) on a pull-down mount that drops it over the cold fire in summer; the chimney, 0.80 × 0.50, goes through the north slope to 6.65, 0.80 over the ridge. The sofa faces the breast 2.7 m away, the glass at its side; the table is under the south window; the entrance from the yard is a 0.90 door beside the kitchen, which runs along the bedroom wall with a 0.90 return. The first floor (x 2–5.7, under the roof, 0.50 at the walls, 2.95 under the ridge) is two bedrooms side by side with the stair and a 0.77 landing between them: the north one 2.20 × 3.30 (7.3 m², nothing to the neighbour\'s side), the south one 3.30 × 2.10 (6.9 m², a roof window to the yard); each has a window in the front wall onto the tall room and the gable\'s glass. Partitions are 0.10. The study is `ground-floor-study.html`." ],');

const parsed = JSON.parse(src);
const ids = parsed.works.map((w) => w.id);
if (new Set(ids).size !== ids.length) throw new Error('duplicate id: ' + ids.filter((v, i) => ids.indexOf(v) !== i).join(','));
fs.writeFileSync(FILE, src);
console.log(`${works.length} objects added; ${ids.length} works in all; eaves ${r3(EAVES)}, ridge ${r3(RIDGE)}, roofUnder(0.3) ${r3(roofUnder(0.3))}, roofUnder(2.0) ${r3(roofUnder(2.0))}`);
