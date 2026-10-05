#!/usr/bin/env node
/* Writes the ground floor of projects/xhevo/house/plan.html into the scene.
   The plan's elements are rectangles in metres: plan X across the house (0 at
   the yard wall's outer face, 7 at the north wall's), plan Y along it (the
   house's own x, back wall at 2, glass at 12). The scene's house frame is x
   along, z across with 0 at the north wall, y up — so x = plan Y and
   z = 7 − plan X, and every piece becomes a box with a height from the table
   below. Run it after editing the plan; it replaces the ground-floor works
   (ids `gf-*`), the balcony, and the ground and first levels, and leaves
   the garage, the drive and the site alone. */
import { readFileSync, writeFileSync } from 'node:fs';

const PLAN = new URL('../projects/xhevo/house/plan.html', import.meta.url);
const SCENE = new URL('../projects/xhevo/house/scene.json', import.meta.url);

const html = readFileSync(PLAN, 'utf8');
const G = eval('[' + html.match(/const G = \[([\s\S]*?)\n\];/)[1] + ']');
const scene = JSON.parse(readFileSync(SCENE, 'utf8'));

const r3 = (n) => Math.round(n * 1000) / 1000;
const ground = { id: 'ground', name: 'Ground floor' };
const sub = (id, name) => [ground, { id: `gf-${id}`, name }];
const works = [];
let n = 0;
/* A box from a plan rectangle: x along from plan Y, z across from plan X. */
function box({ id, name, group, px, py, w, h, y0, y1, color, opacity = 0.35, short }) {
  works.push({
    id: `gf-${id}`, group: 'house', color, opacity, parent: sub(...group), short: short || name, house: true, name,
    x0: r3(py), x1: r3(py + h), z0: r3(7 - px - w), z1: r3(7 - px), y0: r3(y0), y1: r3(y1),
  });
}

const WALL = '#d8dde3', PART = '#c9ced6', FURN = '#c9a86a', SOFT = '#9fb3c8', STAIR = '#6fc79c', WEDGE = '#e9d8a6', STONE = '#b3a899', GLASS = '#8fd8ff';
const H = 2.7;                       // storey height; the outer walls and partitions go floor to ceiling

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
const doors = G.filter((e) => e[0] === 'door').map(([, x, y, w, h]) => ({ x, y, w, h }));
function wallBoxes(x, y, w, h) {
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

let walls = 0, parts = 0, furn = 0, chairs = 0;
for (const e of G) {
  const [t, x, y, w, h] = e;
  if (t === 'wall' || t === 'part') {
    /* The stair box's own walls are not floor to ceiling: its room-side wall follows the lid (built below, one step per
       tread, from the wedge) and its end wall is where the lid meets the floor. Only the landing's stub, x 5.4 to 5.7,
       stands at the lid's full 2.12. The triangle above the slope is the living room's. */
    if (t === 'part' && x === 5.5 && y === 9.18) continue;
    if (t === 'part' && x === 5.5 && y === 5.4) {
      box({ id: 'box-wall-landing', name: 'Stair box wall at the landing, 2.12 high', group: ['stair-box', 'Stair box (the wedge)'], px: x, py: 5.4, w: 0.1, h: 0.3, y0: 0, y1: 2.12, color: PART, opacity: 0.5, short: 'Box wall, landing' });
      continue;
    }
    const isOuter = t === 'wall';
    for (const p of wallBoxes(x, y, w, h)) {
      const k = isOuter ? ++walls : ++parts;
      box({ id: `${t}-${k}`, name: isOuter ? `Outer wall ${k}` : `Partition ${k}`, group: ['walls', 'Walls'], px: p.x, py: p.y, w: p.w, h: p.h, y0: 0, y1: H, color: isOuter ? WALL : PART, opacity: 0.5, short: isOuter ? `Wall ${k}` : `Partition ${k}` });
    }
  } else if (t === 'glass') {
    box({ id: 'glass', name: 'Glass gable, 6.40 wide', group: ['walls', 'Walls'], px: x, py: y, w, h, y0: 0, y1: 3.6, color: GLASS, opacity: 0.12, short: 'Glass' });
  } else if (t === 'furn' || t === 'soft' || t === 'chair') {
    const label = e[5] || (t === 'chair' ? 'chair' : t);
    const [y0, y1] = heightOf(label, t);
    const room = y < 4.8 ? (x < 3.5 ? ['bedroom', 'Bedroom'] : ['bath', 'Bathroom']) : /worktop|hob|oven|fridge|island|sink/.test(label) || (t === 'chair' && y < 7.5) ? ['kitchen', 'Kitchen'] : /table/.test(label) || (t === 'chair') ? ['dining', 'Dining'] : /TV|fire/.test(label) ? ['wall-tv', 'TV and fire'] : ['lounge', 'Lounge'];
    const k = t === 'chair' ? ++chairs : ++furn;
    const name = t === 'chair' ? (y < 7.5 ? `Stool ${k}` : `Chair ${k}`) : label;
    box({ id: `${t}-${k}`, name, group: room, px: x, py: y, w, h, y0, y1, color: t === 'furn' ? FURN : SOFT, short: name });
    /* A sofa's back: a strip along its back edge up to 0.85. */
    if (/sofa/.test(label)) {
      const main = h > w;   // the main sofa runs along the house, its back toward the yard
      const back = main ? { px: x, py: y, w: 0.25, h } : y < 9.8 ? { px: x, py: y, w, h: 0.25 } : { px: x, py: y + h - 0.25, w, h: 0.25 };
      box({ id: `${t}-${k}-back`, name: `${label}, back`, group: room, ...back, y0: 0.45, y1: 0.85, color: SOFT, short: 'Back' });
    }
  } else if (t === 'stone') {
    box({ id: 'stone', name: 'Stone on the north wall, floor to roof', group: ['wall-tv', 'TV and fire'], px: x, py: y, w, h, y0: 0, y1: 3.4, color: STONE, opacity: 0.4, short: 'Stone' });
  } else if (t === 'wedge') {
    /* The lid over the garage flight: one box per tread, its top on the slope. The box's
       room-side wall and end wall follow it. */
    for (let i = 0; i < 12; i++) {
      const x0 = y + (i * h) / 12, x1 = y + ((i + 1) * h) / 12, top = lid((x0 + x1) / 2);
      box({ id: `lid-${i + 1}`, name: `Stair lid, step ${i + 1}, top ${r3(top)}`, group: ['stair-box', 'Stair box (the wedge)'], px: x, py: x0, w, h: x1 - x0, y0: Math.max(0, top - 0.1), y1: Math.max(0.02, top), color: WEDGE, opacity: 0.45, short: `Lid ${i + 1}` });
      box({ id: `box-wall-${i + 1}`, name: `Stair box wall, step ${i + 1}`, group: ['stair-box', 'Stair box (the wedge)'], px: x - 0.1, py: x0, w: 0.1, h: x1 - x0, y0: 0, y1: Math.max(0.02, top), color: PART, opacity: 0.5, short: `Box wall ${i + 1}` });
    }
  } else if (t === 'stair') {
    const [, , , , , axis, count, dir] = e;
    const isGarage = y > 5;   // the garage flight is the garage's: already in the scene
    if (isGarage) continue;
    /* The up flight: leg 1 is 4 treads from the landing toward the hill (risers 1–4), leg 2 is 9 along the back wall (risers 8–16); the winders between are drawn separately. */
    for (let i = 0; i < count; i++) {
      const riser = axis === 'y' ? i + 1 : 8 + i;
      const top = riser * 0.171;
      const seg = axis === 'y' ? { px: x, py: y + h - ((i + 1) * h) / count, w, h: h / count } : { px: x + w - ((i + 1) * w) / count, py: y, w: w / count, h };
      box({ id: `up-${riser}`, name: `Up flight, tread ${riser} of 16, top at ${r3(top)}`, group: ['stair-up', 'Stair to the first floor'], ...seg, y0: top - 0.2, y1: top, color: STAIR, opacity: 0.3, short: `Tread ${riser}` });
    }
  } else if (t === 'winders') {
    /* Three winders in the back corner, risers 5 to 7, as three boxes fanning round the inner corner. */
    const fan = [{ px: x, py: y + 0.5, w: 0.5, h: 0.5 }, { px: x, py: y, w: 0.5, h: 0.5 }, { px: x + 0.5, py: y, w: 0.5, h: 0.5 }];
    fan.forEach((f, i) => box({ id: `up-${5 + i}`, name: `Up flight, winder ${5 + i} of 16, top at ${r3((5 + i) * 0.171)}`, group: ['stair-up', 'Stair to the first floor'], ...f, y0: (5 + i) * 0.171 - 0.2, y1: (5 + i) * 0.171, color: STAIR, opacity: 0.3, short: `Winder ${5 + i}` }));
  } else if (t === 'tri') {
    /* unused now */
  }
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

/* Levels: the ground floor x 2 to 12 (the envelope's 10 m pushed 2 forward), the first floor over the hill end only, to the kitchen wall at x 4.9. */
scene.levels = scene.levels.map((l) => l.id === 'ground' ? { ...l, x0: 2, extendFront: 2 } : l.id === 'first' ? { id: l.id, name: l.name, elevation: l.elevation, height: l.height, x0: 2, x1: 4.9 } : l);   // the first floor stops at the kitchen wall: the living room is open to the roof
scene.works = [...scene.works.filter((w) => w.id !== 'balcony' && !w.id.startsWith('gf-')), ...works];
scene.notes = scene.notes.filter((t) => !/^Ground floor from the plan page/.test(t));
scene.notes.push(`Ground floor from the plan page (projects/xhevo/house/plan.html, generated by scripts/xhevo-plan-to-scene.mjs): the house is 10 × 7 outside, x 2 to 12, with the glass gable at the front over the garage and no balcony. Walls 0.30, partitions 0.10, floor to ceiling 2.70; the garage flight's hole x 5.7 to 9.18 is closed by a lid on the flight's pitch (2.12 at the landing, the floor at x 9.18), drawn here as one box per tread; the up flight is 4 treads, 3 winders, 9 along the back wall. The slab of the ground level still runs unbroken under the stair hole: levels have no holes.`);
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
console.log(`${works.length} ground-floor works written; levels: ${scene.levels.map((l) => `${l.id} x ${l.x0}–${l.x1 ?? '…'}${l.extendFront ? ' +' + l.extendFront : ''}`).join(', ')}`);
