#!/usr/bin/env node
/* Writes the plan page of projects/xhevo/house/plan.html into the scene: the
   ground floor (`G`) and the bedrooms' half level (`G2`). The plan's elements
   are rectangles in metres: plan X across the house (0 at the yard wall's
   outer face, 7 at the north wall's), plan Y along it (the house's own x, back
   wall at 0, glass at 12). The scene's house frame is x along, z across with 0
   at the north wall, y up — so x = plan Y and z = 7 − plan X, and every piece
   becomes a box with a height from the table below. Run it after editing the
   plan; it replaces the works it wrote before (ids `gf-*` and `hl-*`), the
   balcony, and the ground and half levels, and leaves the garage, the drive
   and the site alone. */
import { readFileSync, writeFileSync } from 'node:fs';

const PLAN = new URL('../projects/xhevo/house/plan.html', import.meta.url);
const SCENE = new URL('../projects/xhevo/house/scene.json', import.meta.url);

const html = readFileSync(PLAN, 'utf8');
const G = eval('[' + html.match(/const G = \[([\s\S]*?)\n\];/)[1] + ']');
const G2 = eval('[' + html.match(/const G2 = \[([\s\S]*?)\n\];/)[1] + ']');
const scene = JSON.parse(readFileSync(SCENE, 'utf8'));

const r3 = (n) => Math.round(n * 1000) / 1000;
const works = [];
/* A box from a plan rectangle: x along from plan Y, z across from plan X. `level` is the
   prefix of the id and the top of the parent chain: `gf` the ground floor, `hl` the half level. */
const LEVELS = { gf: { id: 'ground', name: 'Ground floor' }, hl: { id: 'half', name: 'Bedrooms, half level' }, rf: { id: 'roof', name: 'Roof' } };
function box({ level = 'gf', id, name, group, px, py, w, h, y0, y1, color, opacity = 0.35, short, solid = false }) {
  works.push({
    id: `${level}-${id}`, group: 'house', color, ...(solid ? { solid: true } : { opacity }), parent: [LEVELS[level], { id: `${level}-${group[0]}`, name: group[1] }], short: short || name, house: true, name,
    x0: r3(py), x1: r3(py + h), z0: r3(7 - px - w), z1: r3(7 - px), y0: r3(y0), y1: r3(y1),
  });
}

/* Like box(), but handed back pitched along the house (`end: 'x'`) for the caller to add y0End/y1End and push. */
function pitched(spec) {
  box(spec);
  return { ...works.pop(), end: 'x' };
}

const WALL = '#d8dde3', PART = '#c9ced6', WEDGE = '#e9d8a6', GLASS = '#8fd8ff', SLAB = '#c9ced6', ROOF = '#5a6068';
/* The objects are solid, in the colour of what they are made of — the walls, slabs and the lid stay the plan's glass. */
const OAK = '#b98b5a', WALNUT = '#6e4b2e', CABINET = '#8a8f8c', STEEL = '#b4b9bf', BLACK = '#2b2d31', ANTHRACITE = '#3f4144', LINEN = '#e8e2d6', FABRIC = '#6b8597', CERAMIC = '#f1f1ee', STONE = '#9a9087';
const paintOf = (label, t) => {
  if (/^bed/.test(label)) return LINEN;
  if (/wardrobe/.test(label)) return OAK;
  if (/fridge/.test(label)) return STEEL;
  if (/oven/.test(label)) return ANTHRACITE;
  if (/hob|TV/.test(label)) return BLACK;
  if (/worktop|island/.test(label)) return CABINET;
  if (/shower|basin|^wc/.test(label)) return CERAMIC;
  if (/coffee/.test(label)) return WALNUT;
  if (/sofa/.test(label)) return FABRIC;
  if (/fire/.test(label)) return ANTHRACITE;
  if (/table|shelves/.test(label) || t === 'chair') return OAK;
  return OAK;
};
/* One roof over the whole house, its ridge along the middle: it starts 2.50 over the ground floor at the outer
   walls and rises at 0.7 per metre (35°) to 4.95 at the ridge; it runs 0.40 past the side and back walls and 1.00
   past the glass. The outer walls stand to the eaves; what runs across the house (the back wall, the glass, the
   bedrooms' cross walls) has its top on the roof's underside. */
const EAVES = 2.5, PITCH = 0.7, RIDGE = EAVES + PITCH * 3.5;
const roofAt = (z) => EAVES + PITCH * Math.min(z, 7 - z);
const X_BACK = Math.min(...G.filter((e) => e[0] === 'wall').map((e) => e[2]));   // the back wall's outer face, from the plan
/* A piece under the roof: one along the house takes the roof's height at its own z; one across it is split at the
   ridge and each half's top follows the slope (y1 at its z0 corner, y1End at its z1). The spec is in plan terms. */
function toRoof(spec, y0 = 0) {
  const { px, w, h } = spec;
  if (h >= w) { const zMid = 7 - px - w / 2; box({ ...spec, y0, y1: roofAt(zMid) }); return; }
  const halves = px < 3.5 && px + w > 3.5 ? [[px, 3.5 - px], [3.5, px + w - 3.5]] : [[px, w]];
  halves.forEach(([hx, hw], i) => {
    const z0 = 7 - hx - hw, z1 = 7 - hx;
    const piece = pitched({ ...spec, id: halves.length > 1 ? `${spec.id}-${i ? 'yard' : 'north'}` : spec.id, px: hx, w: hw, y0, y1: roofAt(z0) });
    delete piece.end;   // the slope runs across: the end is the z1 side, the viewer's default
    works.push({ ...piece, y1End: r3(roofAt(z1)) });
  });
}
const HALF = 1.45;                   // the bedrooms' floor
const VOID = HALF - 0.2;             // the underside of their slab: 1.25 clear under them
const RISER = 0.181;                 // the flight to the bedrooms: 8 risers of 0.181 = 1.45

/* Heights of the furniture, by the label the plan gives it. */
const heightOf = (label, t) => {
  if (/^bed/.test(label)) return [0, 0.55];
  if (/wardrobe/.test(label)) return [0, 2.2];
  if (/fridge/.test(label)) return [0, 1.9];
  if (/shower/.test(label)) return [0, 0.1];
  if (/basin/.test(label)) return [0, 0.85];
  if (/^wc/.test(label)) return [0, 0.42];
  if (/worktop|hob|oven|island/.test(label)) return [0, 0.9];
  if (/table/.test(label)) return [0, 0.75];
  if (/coffee/.test(label)) return [0, 0.45];
  if (/sofa/.test(label)) return [0, 0.45];
  if (/TV/.test(label)) return [0.8, 1.76];
  if (/fire/.test(label)) return [0, 1.2];
  if (t === 'chair') return [0, 0.45];
  return [0, 0.45];
};

/* Openings cut the walls they sit in: a wall box is split around every door gap on it. */
const doorsOf = (list) => list.filter((e) => e[0] === 'door').map(([, x, y, w, h]) => ({ x, y, w, h }));
function wallBoxes(x, y, w, h, doors) {
  const along = w >= h ? 'x' : 'y';
  let parts = [{ x, y, w, h }];
  for (const d of doors) {
    const hit = d.x < x + w - 1e-6 && x < d.x + d.w - 1e-6 && d.y < y + h - 1e-6 && y < d.y + d.h - 1e-6;
    if (!hit) continue;
    const next = [];
    for (const p of parts) {
      if (along === 'x') {
        if (d.x > p.x) next.push({ x: p.x, y: p.y, w: Math.min(d.x, p.x + p.w) - p.x, h: p.h });
        if (d.x + d.w < p.x + p.w) next.push({ x: d.x + d.w, y: p.y, w: p.x + p.w - d.x - d.w, h: p.h });
      } else {
        if (d.y > p.y) next.push({ x: p.x, y: p.y, w: p.w, h: Math.min(d.y, p.y + p.h) - p.y });
        if (d.y + d.h < p.y + p.h) next.push({ x: p.x, y: d.y + d.h, w: p.w, h: p.y + p.h - d.y - d.h });
      }
    }
    parts = next.filter((p) => p.w > 1e-6 && p.h > 1e-6);
  }
  return parts;
}

const lid = (x) => 2.12 - (x - 5.7) * (0.171 / 0.29);   // top of the wedge lid over the garage flight, by the house's x

/* ── the ground floor ─────────────────────────────────────────────────── */
const doors = doorsOf(G);
let walls = 0, parts = 0, furn = 0, chairs = 0, fills = 0;
for (const e of G) {
  const [t, x, y, w, h] = e;
  if (t === 'wall') {
    /* The outer walls run the whole house and stand to the roof: the side walls to the eaves at 2.50, the back wall
       a gable under the slope. There is no storey above, only the roof. */
    for (const p of wallBoxes(x, y, w, h, doors)) {
      const k = ++walls;
      toRoof({ id: `wall-${k}`, name: p.h >= p.w ? `Outer wall ${k}, to the eaves at ${EAVES}` : `Outer wall ${k}, the back gable, to the roof`, group: ['walls', 'Walls'], px: p.x, py: p.y, w: p.w, h: p.h, color: WALL, opacity: 0.5, short: `Wall ${k}` });
    }
  } else if (t === 'part') {
    /* The stair box's own walls are not floor to ceiling: its room-side wall follows the lid (built below, one step per
       tread, from the wedge) and its end wall is where the lid meets the floor. Only the landing's stub, x 5.4 to 5.7,
       stands at the lid's full 2.12. The triangle above the slope is the living room's. */
    if (x === 5.5 && y === 9.18) continue;
    if (x === 5.5 && y === 5.4) {
      box({ id: 'box-wall-landing', name: 'Stair box wall at the landing, 2.12 high', group: ['stair-box', 'Stair box (the wedge)'], px: x, py: 5.4, w: 0.1, h: 0.3, y0: 0, y1: 2.12, color: PART, opacity: 0.5, short: 'Box wall, landing' });
      continue;
    }
    /* Every other ground-floor partition is at the hill end, holding the fill under the bedrooms: the living room's
       back wall and the walls round the stairwell and the landing. They stand to the top of the fill, 1.25; the
       bedrooms' slab and their own walls carry on above. */
    for (const p of wallBoxes(x, y, w, h, doors)) {
      const k = ++parts;
      box({ id: `part-${k}`, name: `Wall ${k} holding the fill under the bedrooms, to ${VOID}`, group: ['fill-walls', 'Walls holding the fill'], px: p.x, py: p.y, w: p.w, h: p.h, y0: 0, y1: VOID, color: PART, opacity: 0.5, short: `Fill wall ${k}` });
    }
  } else if (t === 'fill') {
    /* The hill end is not dug out: soil, filled where it is short, from the ground up to the underside of the
       bedrooms' slab. In the site's fill group, but drawn in the house's frame. */
    works.push({ id: `gf-fill-${++fills}`, group: 'fill', opacity: 0.35, parent: [{ id: 'fill-bedrooms', name: 'Fill under the bedrooms' }], short: `Fill ${fills}`, house: true, name: `Fill under the bedrooms, part ${fills}, ground to ${VOID}`, x0: r3(y), x1: r3(y + h), z0: r3(7 - x - w), z1: r3(7 - x), y0: 0, y1: VOID });
  } else if (t === 'glass') {
    toRoof({ id: 'glass', name: 'Glass gable, 6.40 wide, to the roof', group: ['walls', 'Walls'], px: x, py: y, w, h, color: GLASS, opacity: 0.12, short: 'Glass' });
  } else if (t === 'furn' || t === 'soft' || t === 'chair') {
    const label = e[5] || (t === 'chair' ? 'chair' : t);
    const [y0, y1] = heightOf(label, t);
    const room = /worktop|hob|oven|fridge|sink/.test(label) ? ['kitchen', 'Kitchen'] : /table/.test(label) || t === 'chair' ? ['dining', 'Dining'] : /fire/.test(label) ? ['fire', 'Fire'] : ['lounge', 'Lounge'];
    const k = t === 'chair' ? ++chairs : ++furn;
    const name = t === 'chair' ? `Chair ${k}` : label;
    box({ id: `${t}-${k}`, name, group: room, px: x, py: y, w, h, y0, y1, color: paintOf(label, t), solid: true, short: name });
    /* A sofa's back: a strip along its back edge up to 0.85. */
    if (/sofa/.test(label)) {
      const main = h > w;   // the main sofa runs along the house, its back toward the yard
      const back = main ? { px: x, py: y, w: 0.25, h } : y < 9.8 ? { px: x, py: y, w, h: 0.25 } : { px: x, py: y + h - 0.25, w, h: 0.25 };
      box({ id: `${t}-${k}-back`, name: `${label}, back`, group: room, ...back, y0: 0.45, y1: 0.85, color: FABRIC, solid: true, short: 'Back' });
    }
  } else if (t === 'stone') {
    toRoof({ id: 'stone', name: 'Stone on the north wall, floor to roof', group: ['fire', 'Fire'], px: x, py: y, w, h, color: STONE, solid: true, short: 'Stone' });
  } else if (t === 'wedge') {
    /* The lid over the garage flight: one flat plane on the flight's pitch, 0.10 thick, 2.12 over the landing and
       down to the floor at the hole's end (`end: 'x'` pitches a box along the house). The box's room-side wall is one
       wall whose top is that same line. */
    const top0 = lid(y), top1 = lid(y + h);
    works.push({ ...pitched({ id: 'lid', name: `Stair lid, one plane on the flight's pitch, ${r3(top0)} at the landing to ${r3(top1)} at the end`, group: ['stair-box', 'Stair box (the wedge)'], px: x, py: y, w, h, y0: top0 - 0.1, y1: top0, color: WEDGE, opacity: 0.45, short: 'Lid' }), y0End: r3(top1 - 0.1), y1End: r3(top1) });
    works.push({ ...pitched({ id: 'box-wall', name: 'Stair box wall, room side, its top on the lid', group: ['stair-box', 'Stair box (the wedge)'], px: x - 0.1, py: y, w: 0.1, h, y0: 0, y1: top0, color: PART, opacity: 0.5, short: 'Box wall' }), y1End: r3(top1) });
  } else if (t === 'stair') {
    const [, , , , , axis, count] = e;
    if (y > 5) continue;   // the garage flight is the garage's: already in the scene
    /* The straight part of the flight to the bedrooms: across the house toward the yard (the plan's "left", down in
       plan X), `count` treads of w/count, each a riser of 0.181 up, after the winders in the corner (3 risers, built
       below); the last riser is the hall's floor at 1.45. */
    if (axis !== 'x') throw new Error('the flight to the bedrooms runs across the house');
    const tread = w / count, first = G.some((e) => e[0] === 'winders') ? 3 : 0;
    for (let i = 1; i <= count; i++) {
      const riser = first + i, top = riser * RISER;
      box({ id: `up-${riser}`, name: `Flight to the bedrooms, tread ${i} of ${count} after the winders, riser ${riser} of 8, top at ${r3(top)}`, group: ['stair-up', 'Stair to the bedrooms'], px: x + w - i * tread, py: y, w: tread, h, y0: Math.max(0, top - 0.2), y1: top, color: OAK, solid: true, short: `Tread ${riser}` });
    }
  } else if (t === 'winders') {
    /* Three winders fanning round the corner's pivot at the square's south-west corner (plan x, y + h): in off the
       landing from the south, out to the west. Each is a `ring` footprint in the house frame, risers 1 to 3. */
    const P = [x, y + h], d30 = Math.tan(Math.PI / 6);
    const fans = [
      [P, [x + w, y + h], [x + w, y + h - w * d30]],
      [P, [x + w, y + h - w * d30], [x + w, y], [x + h * d30, y]],
      [P, [x + h * d30, y], [x, y]],
    ];
    fans.forEach((ring, i) => {
      const top = (i + 1) * RISER;
      works.push({ id: `gf-up-${i + 1}`, group: 'house', color: OAK, solid: true, parent: [LEVELS.gf, { id: 'gf-stair-up', name: 'Stair to the bedrooms' }], short: `Winder ${i + 1}`, house: true, name: `Flight to the bedrooms, winder ${i + 1} of 3 in the corner, riser ${i + 1} of 8, top at ${r3(top)}`, ring: ring.map(([px, py]) => [r3(py), r3(7 - px)]), y0: r3(Math.max(0, top - 0.2)), y1: r3(top) });
    });
  }
  /* 'door', 'win', 'roof', 'dashrect' and the labels draw nothing: doors cut the walls above, the roof is not modelled. */
}
/* The shelves on the stair box's face: one unit whose top runs 0.10 under the lid, from the landing end to where
   the lid comes down to 0.40 — beyond that there is no height left for a shelf. */
const shelf = G.find((e) => e[0] === 'furn' && e[1] === 5.25 && e[2] === 5.9);
if (shelf) {
  const [, x, y, w] = shelf;
  const xEnd = r3(5.7 + (2.12 - 0.4) / (0.171 / 0.29));   // lid(xEnd) = 0.40
  works.push({ ...pitched({ id: 'shelves', name: `Shelves on the stair wall, top under the lid, ${r3(lid(y) - 0.1)} to 0.30 at x ${xEnd}`, group: ['stair-box', 'Stair box (the wedge)'], px: x, py: y, w, h: xEnd - y, y0: 0, y1: lid(y) - 0.1, color: OAK, solid: true, short: 'Shelves' }), y1End: 0.3 });
}
/* The shelves came in as a plain furn box above; drop that one in favour of the bays. */
const plain = works.findIndex((w) => w.x0 === 5.9 && w.z1 === r3(7 - 5.25) && !/bay/.test(w.name));
if (plain >= 0) works.splice(plain, 1);

/* ── the bedrooms, half a level up ────────────────────────────────────── */
/* Their slab: the half level's own (x 0 to 3.8, the whole width) plus a strip in front of it over the hall's end and
   the yard bedroom, x 3.8 to 4.9 from the flight's arrival to the yard wall — the stairwell, with its winders, beyond that
   stay open. */
const upX = G.find((e) => e[0] === 'stair' && e[2] < 5)[1];   // where the flight arrives: the slab runs from the yard wall to there
box({ level: 'hl', id: 'slab-front', name: `Slab in front of the stairwell, 1.25 to 1.45, to x ${upX}`, group: ['slab-front', 'Slab, the strip in front'], px: 0, py: 3.8, w: upX, h: 1.1, y0: VOID, y1: HALF, color: SLAB, opacity: 0.3, short: 'Slab, front strip' });
const doors2 = doorsOf(G2);
let parts2 = 0, furn2 = 0;
for (const e of G2) {
  const [t, x, y, w, h] = e;
  if (t === 'part') {
    /* The bedrooms' walls, from their floor up to the roof's underside. */
    for (const p of wallBoxes(x, y, w, h, doors2)) {
      const k = ++parts2;
      toRoof({ level: 'hl', id: `part-${k}`, name: `Partition ${k}, ${HALF} to the roof`, group: ['walls', 'Walls'], px: p.x, py: p.y, w: p.w, h: p.h, color: PART, opacity: 0.5, short: `Partition ${k}` }, HALF);
    }
  } else if (t === 'furn' || t === 'soft') {
    const label = e[5] || t;
    const [y0, y1] = heightOf(label, t);
    const room = x >= 3.63 ? (y >= 3.8 ? ['landing', 'Landing'] : ['bed-north', 'Bedroom, north side']) : y >= 2.85 ? ['bed-yard', 'Bedroom, yard side'] : x < 2.2 ? ['ensuite', 'Ensuite, yard bedroom'] : ['bath', 'Bathroom, shared'];
    const k = ++furn2;
    /* Nothing stands through the roof: a tall piece against a side wall is cut at the roof's underside there. */
    const under = Math.min(roofAt(7 - x), roofAt(7 - x - w));
    const top = Math.min(HALF + y1, under);
    box({ level: 'hl', id: `${t}-${k}`, name: top < HALF + y1 ? `${label}, to the roof at ${r3(top)}` : label, group: room, px: x, py: y, w, h, y0: HALF + y0, y1: top, color: paintOf(label, t), solid: true, short: label });
  }
  /* The outer walls are the ground floor's, to the eaves; the stairwell is the flight built above; the rest is labels. */
}

/* The ground floor is dug only from the living room's back wall forward (the garage is under it); behind that the
   landing and the stairwell stand on a slab on the ground, and everything else is fill. */
const X_LIVING = G.find((e) => e[0] === 'part' && e[1] === 0.3 && e[2] === 4.8)[2];   // 4.8, the back wall of the living room
const stairEnd = G.find((e) => e[0] === 'part' && e[2] === 3.7 && e[4] === 1.1);         // the wall at the stair's top end
box({ id: 'landing-slab', name: 'Slab on the ground under the stairwell and the landing, −0.20 to 0', group: ['landing', 'Landing and stairwell'], px: stairEnd[1], py: 3.7, w: 7 - 0.3 - stairEnd[1], h: X_LIVING - 3.7, y0: -0.2, y1: 0, color: SLAB, opacity: 0.3, short: 'Landing slab' });

/* ── the roof ─────────────────────────────────────────────────────────── */
/* Two planes, 0.20 thick, from 0.40 outside the side walls up to the ridge over the middle, running from 0.40
   behind the back wall to 1.00 past the glass. */
const RX0 = X_BACK - 0.4, RX1 = 13.0;
for (const [side, px] of [['north', 3.5], ['yard', -0.4]]) {
  const z0 = 7 - px - 3.9, z1 = 7 - px;
  const piece = pitched({ level: 'rf', id: side, name: `Roof, ${side} side, ${r3(roofAt(z0))} to ${r3(roofAt(z1))} under it, x ${RX0} to ${RX1}`, group: ['planes', 'Planes'], px, py: RX0, w: 3.9, h: RX1 - RX0, y0: roofAt(z0), y1: roofAt(z0) + 0.2, color: ROOF, opacity: 0.3, short: `Roof, ${side}` });
  delete piece.end;
  works.push({ ...piece, y0End: r3(roofAt(z1)), y1End: r3(roofAt(z1) + 0.2) });
}

/* Levels: the ground floor from the back wall to x 12 (the envelope's 10 m pushed 2 forward); the bedrooms' half level over the hill end,
   its own slab stopping at x 3.8 (the strip in front is a work, the stairwell beside it open), its storey to the eaves.
   There is no first floor: the living room is open to the roof. */
scene.levels = [
  ...scene.levels.filter((l) => l.id !== 'first' && l.id !== 'half').map((l) => l.id === 'ground' ? { ...l, x0: X_LIVING, extendFront: 2 } : l),
  { id: 'half', name: 'Bedrooms, half level', elevation: HALF, height: r3(EAVES - HALF), x0: X_BACK, x1: 3.8 },
];
scene.works = [...scene.works.filter((w) => w.id !== 'balcony' && !/^(gf|hl|rf)-/.test(w.id)), ...works];
scene.notes = scene.notes.filter((t) => !/^(Ground floor|The house) from the plan page/.test(t));
scene.notes.push(`The house from the plan page (projects/xhevo/house/plan.html, generated by scripts/xhevo-plan-to-scene.mjs): 11 × 7 outside, x ${X_BACK} to 12, with the glass gable at the front over the garage and no balcony, under one roof (ids rf-*) that starts 2.50 over the ground floor at the side walls and rises at 0.7 per metre to ${r3(RIDGE)} at the ridge, 0.40 past the sides and the back, 1.00 past the glass; the side walls stand to the eaves, the back wall and the glass are gables under it. Walls 0.30, partitions 0.10. The garage flight's hole x 5.7 to 9.18 is closed by a lid on the flight's pitch (2.12 at the landing, down to the floor at x 9.18), one plane. The two bedrooms, the yard bedroom's own bath, the shared bath between the bedrooms and the 1 m² landing with a door into each bedroom are half a level up at +1.45 over the hill end, x ${X_BACK} to 4.9, on fill (ids gf-fill-*): the hill end is not dug, the soil is made up to 1.25 and their slab sits on it; the ground level itself starts at the living room's back wall, the landing and the stairwell behind it on a slab on the ground (ids hl-* for the bedrooms): 8 risers of 0.181 climb from the garage landing: straight into 3 winders fanning round the corner by the north wall (ids gf-up-1..3, ring footprints), then 4 treads of 0.243 west, the 8th riser being the hall's floor; the stairwell is left open in the slab. The slab of the ground level still runs unbroken under the stair hole: levels have no holes.`);
/* The file's own layout: one-space indent, short arrays and the objects inside arrays on one line. */
function fmt(v, depth, inArray) {
  const pad = ' '.repeat(depth), inner = ' '.repeat(depth + 1);
  if (Array.isArray(v)) {
    const flat = `[ ${v.map((x) => fmt(x, 0, true)).join(', ')} ]`;
    if (flat.length <= 100 && !flat.includes('\n')) return v.length ? flat : '[]';
    return `[\n${v.map((x) => inner + fmt(x, depth + 1, true)).join(',\n')}\n${pad}]`;
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (inArray) { const flat = `{ ${keys.map((k) => `${JSON.stringify(k)}: ${fmt(v[k], 0, true)}`).join(', ')} }`; if (flat.length <= 100 && !flat.includes('\n')) return flat; }
    return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${fmt(v[k], depth + 1, false)}`).join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(v);
}
/* Splice only the `notes`, `levels` and `works` segments into the file, so everything else stays byte for byte. */
const src = readFileSync(SCENE, 'utf8');
function segment(key) {
  const start = src.indexOf(`\n "${key}":`);
  if (start < 0) throw new Error(`no top-level ${key}`);
  const next = src.indexOf('\n "', start + 1);
  return { start: start + 1, end: next < 0 ? src.lastIndexOf('\n}') : next + 1 };
}
let out = src;
for (const key of ['works', 'levels', 'notes']) {   // from the back, so earlier offsets stay valid
  const { start, end } = segment(key);
  const tail = src.slice(end - 2, end).includes(',') || /,\s*$/.test(src.slice(start, end)) ? ',' : '';
  const body = ` "${key}": ${fmt(scene[key], 1, false)}${tail}\n`;
  out = out.slice(0, start) + body + out.slice(end);
}
writeFileSync(SCENE, out);
JSON.parse(readFileSync(SCENE, 'utf8'));   // it must still parse
console.log(`${works.length} works written (${works.filter((w) => w.id.startsWith('gf-')).length} ground floor, ${works.filter((w) => w.id.startsWith('hl-')).length} half level); levels: ${scene.levels.map((l) => `${l.id} x ${l.x0}–${l.x1 ?? '…'}${l.extendFront ? ' +' + l.extendFront : ''} at ${l.elevation}`).join(', ')}`);
