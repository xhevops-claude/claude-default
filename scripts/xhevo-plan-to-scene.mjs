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
const LEVELS = { gf: { id: 'ground', name: 'Ground floor' }, hl: { id: 'half', name: 'Bedrooms, half level' } };
function box({ level = 'gf', id, name, group, px, py, w, h, y0, y1, color, opacity = 0.35, short }) {
  works.push({
    id: `${level}-${id}`, group: 'house', color, opacity, parent: [LEVELS[level], { id: `${level}-${group[0]}`, name: group[1] }], short: short || name, house: true, name,
    x0: r3(py), x1: r3(py + h), z0: r3(7 - px - w), z1: r3(7 - px), y0: r3(y0), y1: r3(y1),
  });
}

const WALL = '#d8dde3', PART = '#c9ced6', FURN = '#c9a86a', SOFT = '#9fb3c8', STAIR = '#6fc79c', WEDGE = '#e9d8a6', STONE = '#b3a899', GLASS = '#8fd8ff', SLAB = '#c9ced6';
/* One roof over the whole house, its ridge along it: 3.40 under it at the outer walls, 5.85 at the ridge
   (the plan's side view: 3.75 half a metre in from the north wall). The outer walls stand to the eaves. */
const EAVES = 3.4, RIDGE = 5.85;
const roofAt = (z) => EAVES + ((RIDGE - EAVES) * Math.min(z, 7 - z)) / 3.5;
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
let walls = 0, parts = 0, furn = 0, chairs = 0;
for (const e of G) {
  const [t, x, y, w, h] = e;
  if (t === 'wall') {
    /* The outer walls run the whole house and stand to the eaves: there is no storey above, only the roof. */
    for (const p of wallBoxes(x, y, w, h, doors)) {
      const k = ++walls;
      box({ id: `wall-${k}`, name: `Outer wall ${k}, to the eaves at ${EAVES}`, group: ['walls', 'Walls'], px: p.x, py: p.y, w: p.w, h: p.h, y0: 0, y1: EAVES, color: WALL, opacity: 0.5, short: `Wall ${k}` });
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
    /* Every other ground-floor partition is at the hill end, under the bedrooms: the living room's back wall and the
       walls closing the void. They stand to the underside of the bedrooms' slab, 1.25; the slab and the bedrooms'
       own walls carry on above. */
    for (const p of wallBoxes(x, y, w, h, doors)) {
      const k = ++parts;
      box({ id: `part-${k}`, name: `Partition ${k}, under the bedrooms' slab, to ${VOID}`, group: ['void', 'Under the bedrooms'], px: p.x, py: p.y, w: p.w, h: p.h, y0: 0, y1: VOID, color: PART, opacity: 0.5, short: `Partition ${k}` });
    }
  } else if (t === 'glass') {
    box({ id: 'glass', name: 'Glass gable, 6.40 wide', group: ['walls', 'Walls'], px: x, py: y, w, h, y0: 0, y1: 3.6, color: GLASS, opacity: 0.12, short: 'Glass' });
  } else if (t === 'furn' || t === 'soft' || t === 'chair') {
    const label = e[5] || (t === 'chair' ? 'chair' : t);
    const [y0, y1] = heightOf(label, t);
    const room = /worktop|hob|oven|fridge|sink/.test(label) ? ['kitchen', 'Kitchen'] : /table/.test(label) || t === 'chair' ? ['dining', 'Dining'] : /TV|fire/.test(label) ? ['wall-tv', 'TV and fire'] : ['lounge', 'Lounge'];
    const k = t === 'chair' ? ++chairs : ++furn;
    const name = t === 'chair' ? `Chair ${k}` : label;
    box({ id: `${t}-${k}`, name, group: room, px: x, py: y, w, h, y0, y1, color: t === 'furn' ? FURN : SOFT, short: name });
    /* A sofa's back: a strip along its back edge up to 0.85. */
    if (/sofa/.test(label)) {
      const main = h > w;   // the main sofa runs along the house, its back toward the yard
      const back = main ? { px: x, py: y, w: 0.25, h } : y < 9.8 ? { px: x, py: y, w, h: 0.25 } : { px: x, py: y + h - 0.25, w, h: 0.25 };
      box({ id: `${t}-${k}-back`, name: `${label}, back`, group: room, ...back, y0: 0.45, y1: 0.85, color: SOFT, short: 'Back' });
    }
  } else if (t === 'stone') {
    box({ id: 'stone', name: 'Stone on the north wall, floor to roof', group: ['wall-tv', 'TV and fire'], px: x, py: y, w, h, y0: 0, y1: EAVES, color: STONE, opacity: 0.4, short: 'Stone' });
  } else if (t === 'wedge') {
    /* The lid over the garage flight: one box per tread, its top on the slope. The box's
       room-side wall and end wall follow it. */
    for (let i = 0; i < 12; i++) {
      const x0 = y + (i * h) / 12, x1 = y + ((i + 1) * h) / 12, top = lid((x0 + x1) / 2);
      box({ id: `lid-${i + 1}`, name: `Stair lid, step ${i + 1}, top ${r3(top)}`, group: ['stair-box', 'Stair box (the wedge)'], px: x, py: x0, w, h: x1 - x0, y0: Math.max(0, top - 0.1), y1: Math.max(0.02, top), color: WEDGE, opacity: 0.45, short: `Lid ${i + 1}` });
      box({ id: `box-wall-${i + 1}`, name: `Stair box wall, step ${i + 1}`, group: ['stair-box', 'Stair box (the wedge)'], px: x - 0.1, py: x0, w: 0.1, h: x1 - x0, y0: 0, y1: Math.max(0.02, top), color: PART, opacity: 0.5, short: `Box wall ${i + 1}` });
    }
  } else if (t === 'stair') {
    const [, , , , , axis, count] = e;
    if (y > 5) continue;   // the garage flight is the garage's: already in the scene
    /* The flight to the bedrooms: from the landing, across the house toward the yard (the plan's "left", down in
       plan X), `count` treads of w/count, each a riser of 0.181 up; the last riser is the hall's floor at 1.45. */
    if (axis !== 'x') throw new Error('the flight to the bedrooms runs across the house');
    const tread = w / count;
    for (let i = 1; i <= count; i++) {
      const top = i * RISER;
      box({ id: `up-${i}`, name: `Flight to the bedrooms, tread ${i} of ${count}, top at ${r3(top)}`, group: ['stair-up', 'Stair to the bedrooms'], px: x + w - i * tread, py: y, w: tread, h, y0: Math.max(0, top - 0.2), y1: top, color: STAIR, opacity: 0.3, short: `Tread ${i}` });
    }
  }
  /* 'door', 'win', 'roof', 'dashrect' and the labels draw nothing: doors cut the walls above, the roof is not modelled. */
}
/* The shelves on the stair box's face, stepped under the lid. */
const shelf = G.find((e) => e[0] === 'furn' && e[1] === 5.25 && e[2] === 5.9);
if (shelf) {
  const [, x, y, w, h] = shelf;
  for (let i = 0; i < 8; i++) {
    const y0 = y + (i * h) / 8, y1 = y + ((i + 1) * h) / 8, top = Math.max(0.3, lid((y0 + y1) / 2) - 0.1);
    box({ id: `shelves-${i + 1}`, name: `Shelves on the stair wall, bay ${i + 1}, to ${r3(top)}`, group: ['stair-box', 'Stair box (the wedge)'], px: x, py: y0, w, h: y1 - y0, y0: 0, y1: top, color: FURN, opacity: 0.3, short: `Shelves ${i + 1}` });
  }
}
/* The shelves came in as a plain furn box above; drop that one in favour of the bays. */
const plain = works.findIndex((w) => w.x0 === 5.9 && w.z1 === r3(7 - 5.25) && !/bay/.test(w.name));
if (plain >= 0) works.splice(plain, 1);

/* ── the bedrooms, half a level up ────────────────────────────────────── */
/* Their slab: the half level's own (x 0 to 3.8, the whole width) plus a strip in front of it over the hall's end and
   the yard bedroom, x 3.8 to 4.9 at z 3.1 to 7 — the stairwell and the opening over the landing, z 0.3 to 3.1 there,
   stay open. */
box({ level: 'hl', id: 'slab-front', name: 'Slab in front of the stairwell, 1.25 to 1.45', group: ['slab-front', 'Slab, the strip in front'], px: 0, py: 3.8, w: 3.9, h: 1.1, y0: VOID, y1: HALF, color: SLAB, opacity: 0.3, short: 'Slab, front strip' });
const doors2 = doorsOf(G2);
let parts2 = 0, furn2 = 0;
for (const e of G2) {
  const [t, x, y, w, h] = e;
  if (t === 'part') {
    /* The bedrooms' walls, from their floor to the eaves; the roof rises above that toward the ridge. */
    for (const p of wallBoxes(x, y, w, h, doors2)) {
      const k = ++parts2;
      box({ level: 'hl', id: `part-${k}`, name: `Partition ${k}, ${HALF} to the eaves`, group: ['walls', 'Walls'], px: p.x, py: p.y, w: p.w, h: p.h, y0: HALF, y1: EAVES, color: PART, opacity: 0.5, short: `Partition ${k}` });
    }
  } else if (t === 'furn' || t === 'soft') {
    const label = e[5] || t;
    const [y0, y1] = heightOf(label, t);
    const room = x < 2.5 ? ['bed-yard', 'Bedroom, yard side'] : x >= 4.1 ? ['bed-north', 'Bedroom, north side'] : y < 1.8 ? ['bath', 'Bathroom'] : ['hall', 'Hall'];
    const k = ++furn2;
    /* Nothing stands through the roof: a tall piece against a side wall is cut at the roof's underside there. */
    const under = Math.min(roofAt(7 - x), roofAt(7 - x - w));
    const top = Math.min(HALF + y1, under);
    box({ level: 'hl', id: `${t}-${k}`, name: top < HALF + y1 ? `${label}, to the roof at ${r3(top)}` : label, group: room, px: x, py: y, w, h, y0: HALF + y0, y1: top, color: t === 'furn' ? FURN : SOFT, short: label });
  }
  /* The outer walls are the ground floor's, to the eaves; the stairwell is the flight built above; the rest is labels. */
}

/* Levels: the ground floor x 0 to 12 (the envelope's 10 m pushed 2 forward); the bedrooms' half level over the hill end,
   its own slab stopping at x 3.8 (the strip in front is a work, the stairwell beside it open), its storey to the eaves.
   There is no first floor: the living room is open to the roof. */
scene.levels = [
  ...scene.levels.filter((l) => l.id !== 'first' && l.id !== 'half').map((l) => l.id === 'ground' ? { ...l, x0: 0, extendFront: 2 } : l),
  { id: 'half', name: 'Bedrooms, half level', elevation: HALF, height: r3(EAVES - HALF), x0: 0, x1: 3.8 },
];
scene.works = [...scene.works.filter((w) => w.id !== 'balcony' && !w.id.startsWith('gf-') && !w.id.startsWith('hl-')), ...works];
scene.notes = scene.notes.filter((t) => !/^(Ground floor|The house) from the plan page/.test(t));
scene.notes.push(`The house from the plan page (projects/xhevo/house/plan.html, generated by scripts/xhevo-plan-to-scene.mjs): 12 × 7 outside, x 0 to 12, with the glass gable at the front over the garage and no balcony, under one roof — 3.40 at the outer walls, 5.85 at the ridge, not modelled — so the outer walls stand to the eaves and there is no first floor. Walls 0.30, partitions 0.10. The garage flight's hole x 5.7 to 9.18 is closed by a lid on the flight's pitch (2.12 at the landing, the floor at x 9.18), drawn here as one box per tread. The two bedrooms, the bath and their hall are half a level up at +1.45 over the hill end, x 0 to 4.9, with 1.25 clear under them (ids hl-*): 7 treads of 0.243 climb 8 risers of 0.181 from the garage landing, across the house toward the yard, the 8th riser being the hall's floor; the stairwell and the strip over the landing are left open in the slab. The slab of the ground level still runs unbroken under the stair hole: levels have no holes.`);
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
