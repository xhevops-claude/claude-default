/* House Plans — draws window.HOUSE_PLAN two ways.
 *
 * The 2D plan is hand-built SVG in world metres (viewBox is metres, so
 * pan/zoom is just a viewBox edit). The 3D view is three.js, imported
 * lazily the first time it is opened so a failed CDN fetch costs the
 * plan view nothing.
 */

const PLAN = window.HOUSE_PLAN;
const SLAB = PLAN.slab || 0.2;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 2) => n.toFixed(d).replace(/\.?0+$/, '');

/* ── room palette ─────────────────────────────────────── */

const USE = {
  living: { fill: '#e3ecf8', ink: '#2c4a72' },
  kitchen: { fill: '#e8f2e4', ink: '#3b5c31' },
  bed: { fill: '#f0e9f6', ink: '#4e3a64' },
  bath: { fill: '#e2f1f3', ink: '#2c5a60' },
  circulation: { fill: '#efece5', ink: '#4b463c' },
  service: { fill: '#f1eee4', ink: '#5a5340' },
  garage: { fill: '#e9edf1', ink: '#3f4a55' },
  outdoor: { fill: '#e6eddd', ink: '#4a5a3c' },
};

/* height (m), 3D colour, and how tall it sits off its floor */
const FX = {
  sofa: { h: 0.45, c: 0x8fa3bd }, chair: { h: 0.45, c: 0x8fa3bd },
  table: { h: 0.4, c: 0xa98b62 }, dining: { h: 0.75, c: 0xa98b62 },
  tv: { h: 0.5, c: 0x4a5560 }, counter: { h: 0.9, c: 0xb8a88c },
  island: { h: 0.92, c: 0xb8a88c }, fridge: { h: 1.8, c: 0xc9d1da },
  bed: { h: 0.55, c: 0xb9a8c6 }, nightstand: { h: 0.5, c: 0xa98b62 },
  wardrobe: { h: 2.1, c: 0x9c8467 }, desk: { h: 0.74, c: 0xa98b62 },
  shelf: { h: 1.9, c: 0x9c8467 }, wc: { h: 0.75, c: 0xe8eef2 },
  basin: { h: 0.85, c: 0xe8eef2 }, bath: { h: 0.55, c: 0xe8eef2 },
  shower: { h: 0.06, c: 0xd3dde4 }, washer: { h: 0.85, c: 0xd8dee5 },
  boiler: { h: 1.5, c: 0xb6bec7 }, car: { h: 1.45, c: 0x6f7c8c },
};

/* ── geometry helpers ─────────────────────────────────── */

function axis(w) {
  const [ax, ay] = w.a, [bx, by] = w.b;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  return { ax, ay, bx, by, len, ux: dx / len, uy: dy / len, deg: Math.atan2(dy, dx) * 180 / Math.PI };
}

/* Solid runs of a wall once its openings are punched out. */
function spans(wall, openings) {
  const os = openings.filter((o) => o.wall === wall.id)
    .map((o) => ({ ...o, s0: o.at - o.w / 2, s1: o.at + o.w / 2 }))
    .sort((p, q) => p.s0 - q.s0);
  const len = axis(wall).len;
  const solid = [];
  let cursor = 0;
  for (const o of os) {
    if (o.s0 > cursor) solid.push([cursor, Math.min(o.s0, len)]);
    cursor = Math.max(cursor, o.s1);
  }
  if (cursor < len) solid.push([cursor, len]);
  return { solid, holes: os, len };
}

function area(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function centroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  a *= 0.5;
  return Math.abs(a) < 1e-9 ? poly[0] : [cx / (6 * a), cy / (6 * a)];
}

function bounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const eat = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const lv of PLAN.levels) for (const r of lv.rooms) for (const p of r.poly) eat(p[0], p[1]);
  eat(PLAN.envelope.x0 - 0.2, PLAN.envelope.y0 - 0.2);
  eat(PLAN.envelope.x1 + 0.2, PLAN.envelope.y1 + 0.2);
  return { x0, y0, x1, y1 };
}

/* ── state ────────────────────────────────────────────── */

const B = bounds();
const SHEET = { x: B.x0 - 2.6, y: B.y0 - 2.1, w: (B.x1 - B.x0) + 3.4, h: (B.y1 - B.y0) + 4.9 };

const state = {
  view: '2d',
  level: 'ground',
  level3: 'all',
  opts: { dims: true, furn: true, labels: true, ghost: true, grid: false, schedule: false },
  opts3: { roof: true, furn: true, cut: false, explode: 0 },
};

const view = { x: SHEET.x, y: SHEET.y, w: SHEET.w };

const svgHost = $('svg-host');
let svgEl = null;

/* ── 2D: pieces ───────────────────────────────────────── */

/* Extend exterior wall runs into the corners so the shell reads solid. */
function wallSvg(level, ghost) {
  const fill = ghost ? 'rgba(29,39,51,.18)' : '#1d2733';
  let out = '';
  for (const w of level.walls) {
    const a = axis(w), { solid } = spans(w, level.openings);
    const t = w.t, ext = w.kind === 'ext' ? t / 2 : 0;
    for (const [s0raw, s1raw] of solid) {
      const s0 = s0raw <= 0.001 ? -ext : s0raw;
      const s1 = s1raw >= a.len - 0.001 ? a.len + ext : s1raw;
      const nx = -a.uy * (t / 2), ny = a.ux * (t / 2);
      const x = a.ax + a.ux * s0, y = a.ay + a.uy * s0;
      const ex = a.ax + a.ux * s1, ey = a.ay + a.uy * s1;
      out += `<path d="M${x + nx} ${y + ny}L${ex + nx} ${ey + ny}L${ex - nx} ${ey - ny}L${x - nx} ${y - ny}Z" fill="${fill}"/>`;
    }
  }
  return out;
}

function openingSvg(level) {
  let out = '';
  for (const w of level.walls) {
    const a = axis(w), t = w.t;
    for (const o of level.openings.filter((x) => x.wall === w.id)) {
      const g = `<g transform="translate(${a.ax},${a.ay}) rotate(${a.deg})">`;
      const s = o.at - o.w / 2, e = o.at + o.w / 2, h = t / 2;
      if (o.kind === 'window') {
        out += g
          + `<rect x="${s}" y="${-h}" width="${o.w}" height="${t}" fill="#fbfaf7" stroke="#1d2733" stroke-width=".016"/>`
          + `<line x1="${s}" y1="0" x2="${e}" y2="0" stroke="#1d2733" stroke-width=".03"/></g>`;
      } else if (o.kind === 'slider') {
        out += g
          + `<rect x="${s}" y="${-h}" width="${o.w}" height="${t}" fill="#fbfaf7" stroke="#1d2733" stroke-width=".016"/>`
          + `<rect x="${s}" y="${-0.05}" width="${o.w / 2}" height=".05" fill="#1d2733"/>`
          + `<rect x="${s + o.w / 2}" y="0" width="${o.w / 2}" height=".05" fill="#1d2733"/></g>`;
      } else if (o.kind === 'opening') {
        out += g + `<rect x="${s}" y="${-h}" width="${o.w}" height="${t}" fill="#fbfaf7"/>`
          + `<line x1="${s}" y1="${-h}" x2="${s}" y2="${h}" stroke="#1d2733" stroke-width=".02" stroke-dasharray=".08 .06"/>`
          + `<line x1="${e}" y1="${-h}" x2="${e}" y2="${h}" stroke="#1d2733" stroke-width=".02" stroke-dasharray=".08 .06"/></g>`;
      } else {
        /* door / entry / garage: gap, leaf and swing arc. `flip` puts the
           swing on the other face, which is how the front door opens in. */
        const left = o.swing !== 'right';
        const side = o.flip ? 1 : -1;
        const sweep = (left ? 1 : 0) ^ (side === 1 ? 1 : 0);
        const hx = left ? s : e, dir = left ? 1 : -1;
        const leaf = o.kind === 'garage' ? '' :
          `<path d="M${hx} 0 A${o.w} ${o.w} 0 0 ${sweep} ${hx + dir * o.w} ${side * o.w}" fill="none" stroke="#1d2733" stroke-width=".018" opacity=".55"/>`
          + `<rect x="${left ? hx : hx - 0.05}" y="${side < 0 ? -o.w : 0}" width=".05" height="${o.w}" fill="#1d2733" opacity=".8"/>`;
        const sillMark = o.kind === 'garage'
          ? `<rect x="${s}" y="${-0.04}" width="${o.w}" height=".08" fill="#1d2733" opacity=".5"/>` : '';
        out += g + `<rect x="${s}" y="${-h}" width="${o.w}" height="${t}" fill="#fbfaf7"/>` + sillMark + leaf + '</g>';
      }
    }
  }
  return out;
}

/* The flight rising from this level is drawn with treads; the one
   arriving from below is just outlined and labelled DN, because the two
   share a footprint in a stacked stairwell. */
function stairSvg(stair, down, outlineOnly) {
  const ink = down ? 'rgba(29,39,51,.3)' : '#1d2733';
  let out = `<g stroke="${ink}" fill="none" stroke-width=".022">`;
  const L = stair.landing;
  if (L && !outlineOnly) out += `<rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.d}" fill="rgba(29,39,51,.04)"/>`;
  for (const f of stair.flights) {
    if (outlineOnly) {
      out += `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.l}" fill="none" stroke-dasharray=".12 .1"/>`;
      continue;
    }
    out += `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.l}" fill="rgba(29,39,51,.04)"/>`;
    const step = f.l / f.steps;
    for (let i = 1; i < f.steps; i++) {
      const y = f.y + i * step;
      out += `<line x1="${f.x}" y1="${y}" x2="${f.x + f.w}" y2="${y}"/>`;
    }
    /* direction arrow along the run */
    const cx = f.x + f.w / 2;
    const y0 = f.dir === 'N' ? f.y + f.l - 0.15 : f.y + 0.15;
    const y1 = f.dir === 'N' ? f.y + 0.15 : f.y + f.l - 0.15;
    const s = Math.sign(y1 - y0);
    out += `<line x1="${cx}" y1="${y0}" x2="${cx}" y2="${y1}" stroke-width=".03"/>`
      + `<path d="M${cx - 0.11} ${y1 - s * 0.22}L${cx} ${y1}L${cx + 0.11} ${y1 - s * 0.22}" stroke-width=".03"/>`;
  }
  out += '</g>';
  const f0 = stair.flights[down ? stair.flights.length - 1 : 0];
  const ty = outlineOnly ? f0.y + f0.l / 2 : (f0.dir === 'N' ? f0.y + f0.l - 0.3 : f0.y + 0.45);
  out += `<text x="${f0.x + f0.w / 2}" y="${ty}" fill="${ink}"`
    + ` font-size=".26" text-anchor="middle" font-weight="700">${down ? 'DN' : 'UP'}</text>`;
  return out;
}

function fixtureSvg(f) {
  const x = f.x - f.w / 2, y = f.y - f.d / 2, w = f.w, d = f.d;
  const box = (r = 0.04, fill = '#fff', op = 1) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${d}" rx="${r}" fill="${fill}" fill-opacity="${op}" stroke="#1d2733" stroke-opacity=".55" stroke-width=".022"/>`;
  const line = (x1, y1, x2, y2) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1d2733" stroke-opacity=".45" stroke-width=".02"/>`;
  switch (f.type) {
    case 'sofa': {
      const back = w > d ? `<rect x="${x}" y="${y}" width="${w}" height="${d * 0.28}" rx=".05" fill="#1d2733" fill-opacity=".1"/>`
        : `<rect x="${x}" y="${y}" width="${w * 0.28}" height="${d}" rx=".05" fill="#1d2733" fill-opacity=".1"/>`;
      return box(0.1) + back;
    }
    case 'bed': {
      const pillow = `<rect x="${x + 0.08}" y="${y + 0.07}" width="${w - 0.16}" height="${d * 0.2}" rx=".06" fill="#1d2733" fill-opacity=".12"/>`;
      return box(0.06) + pillow + line(x, y + d * 0.34, x + w, y + d * 0.34);
    }
    case 'dining': {
      let out = box(0.06);
      const n = 3, sp = w / (n + 1);
      for (let i = 1; i <= n; i++) {
        out += `<rect x="${x + i * sp - 0.2}" y="${y - 0.42}" width=".4" height=".36" rx=".07" fill="#fff" stroke="#1d2733" stroke-opacity=".4" stroke-width=".02"/>`;
        out += `<rect x="${x + i * sp - 0.2}" y="${y + d + 0.06}" width=".4" height=".36" rx=".07" fill="#fff" stroke="#1d2733" stroke-opacity=".4" stroke-width=".02"/>`;
      }
      return out;
    }
    case 'counter': case 'island':
      return box(0.03) + (w > d
        ? line(x, y + d - 0.08, x + w, y + d - 0.08)
        : line(x + 0.08, y, x + 0.08, y + d));
    case 'wc':
      return `<rect x="${x}" y="${y}" width="${w}" height="${d * 0.28}" rx=".03" fill="#fff" stroke="#1d2733" stroke-opacity=".5" stroke-width=".02"/>`
        + `<ellipse cx="${f.x}" cy="${y + d * 0.62}" rx="${w / 2}" ry="${d * 0.36}" fill="#fff" stroke="#1d2733" stroke-opacity=".5" stroke-width=".022"/>`;
    case 'basin':
      return box(0.05) + `<ellipse cx="${f.x}" cy="${f.y + 0.03}" rx="${w * 0.33}" ry="${d * 0.3}" fill="none" stroke="#1d2733" stroke-opacity=".45" stroke-width=".02"/>`;
    case 'bath':
      return box(0.08) + `<rect x="${x + 0.1}" y="${y + 0.08}" width="${w - 0.2}" height="${d - 0.16}" rx=".08" fill="none" stroke="#1d2733" stroke-opacity=".4" stroke-width=".02"/>`;
    case 'shower':
      return box(0.03, '#e2f1f3', 0.8) + line(x, y, x + w, y + d) + line(x + w, y, x, y + d);
    case 'car':
      return `<rect x="${x}" y="${y}" width="${w}" height="${d}" rx=".35" fill="#1d2733" fill-opacity=".07" stroke="#1d2733" stroke-opacity=".35" stroke-width=".025" stroke-dasharray=".14 .1"/>`
        + `<rect x="${x + 0.22}" y="${y + d * 0.24}" width="${w - 0.44}" height="${d * 0.34}" rx=".18" fill="none" stroke="#1d2733" stroke-opacity=".3" stroke-width=".02"/>`;
    case 'tv':
      return `<rect x="${x}" y="${y}" width="${w}" height="${d * 0.5}" rx=".02" fill="#1d2733" fill-opacity=".5"/>` + box(0.02);
    case 'chair':
      return box(0.09);
    default:
      return box(0.03) + (w > d ? line(x, y + d / 2, x + w, y + d / 2) : line(x + w / 2, y, x + w / 2, y + d));
  }
}

function dimLine(p0, p1, at, vertical, label) {
  const tick = 0.14;
  const a = vertical ? `M${at} ${p0}L${at} ${p1}` : `M${p0} ${at}L${p1} ${at}`;
  const t = (p) => vertical
    ? `M${at - tick} ${p + tick}L${at + tick} ${p - tick}`
    : `M${p - tick} ${at + tick}L${p + tick} ${at - tick}`;
  const mid = (p0 + p1) / 2;
  const txt = vertical
    ? `<text x="${at - 0.12}" y="${mid}" font-size=".26" text-anchor="middle" fill="#6b7686" transform="rotate(-90 ${at - 0.12} ${mid})">${label}</text>`
    : `<text x="${mid}" y="${at - 0.12}" font-size=".26" text-anchor="middle" fill="#6b7686">${label}</text>`;
  return `<path d="${a}${t(p0)}${t(p1)}" stroke="#8d97a5" stroke-width=".018" fill="none"/>${txt}`;
}

function dimsSvg(level) {
  const e = PLAN.envelope;
  const ext = 0.15;
  const L = e.x0 - ext, R = e.x1 + ext, T = e.y0 - ext, Bm = e.y1 + ext;
  let out = '<g>';

  const xs = [...new Set(level.walls.filter((w) => w.kind === 'int' && w.a[0] === w.b[0]).map((w) => w.a[0]))].sort((a, b) => a - b);
  const ys = [...new Set(level.walls.filter((w) => w.kind === 'int' && w.a[1] === w.b[1]).map((w) => w.a[1]))].sort((a, b) => a - b);

  /* Two partitions 100 mm apart would otherwise print a "0.1" tick. */
  const thin = (arr) => arr.filter((v, i) => i === 0 || v - arr[i - 1] > 0.4);

  const chainX = thin([L, ...xs, R]);
  for (let i = 0; i < chainX.length - 1; i++) {
    out += dimLine(chainX[i], chainX[i + 1], T - 0.75, false, fmt(chainX[i + 1] - chainX[i]));
  }
  out += dimLine(L, R, T - 1.55, false, fmt(R - L));

  const chainY = thin([T, ...ys, Bm]);
  for (let i = 0; i < chainY.length - 1; i++) {
    out += dimLine(chainY[i], chainY[i + 1], L - 0.75, true, fmt(chainY[i + 1] - chainY[i]));
  }
  out += dimLine(T, Bm, L - 1.55, true, fmt(Bm - T));
  return out + '</g>';
}

function annotationSvg() {
  const e = PLAN.envelope;
  const y = e.y1 + 1.9, x = e.x0;
  let bar = `<g><text x="${x}" y="${y - 0.22}" font-size=".24" fill="#6b7686">0</text>`
    + `<text x="${x + 5}" y="${y - 0.22}" font-size=".24" fill="#6b7686" text-anchor="middle">5 m</text>`;
  for (let i = 0; i < 5; i++) {
    bar += `<rect x="${x + i}" y="${y}" width="1" height=".14" fill="${i % 2 ? '#fbfaf7' : '#1d2733'}" stroke="#1d2733" stroke-width=".016"/>`;
  }
  bar += '</g>';
  const nx = e.x0 - 1.6, ny = y + 0.1;
  const north = `<g stroke="#6b7686" fill="#6b7686">`
    + `<path d="M${nx} ${ny - 0.7}L${nx + 0.26} ${ny + 0.25}L${nx} ${ny + 0.02}L${nx - 0.26} ${ny + 0.25}Z" stroke-width=".02"/>`
    + `<text x="${nx}" y="${ny + 0.75}" font-size=".3" text-anchor="middle" stroke="none" font-weight="700">N</text></g>`;
  return bar + north;
}

function currentLevel() {
  return PLAN.levels.find((l) => l.id === state.level) || PLAN.levels[0];
}

function render2D() {
  const level = currentLevel();
  const idx = PLAN.levels.indexOf(level);
  const below = idx > 0 ? PLAN.levels[idx - 1] : null;

  let g = '';

  if (state.opts.grid) {
    let grid = '<g stroke="#1d2733" stroke-opacity=".07" stroke-width=".012">';
    for (let x = Math.ceil(SHEET.x); x < SHEET.x + SHEET.w; x++) grid += `<line x1="${x}" y1="${SHEET.y}" x2="${x}" y2="${SHEET.y + SHEET.h}"/>`;
    for (let y = Math.ceil(SHEET.y); y < SHEET.y + SHEET.h; y++) grid += `<line x1="${SHEET.x}" y1="${y}" x2="${SHEET.x + SHEET.w}" y2="${y}"/>`;
    g += grid + '</g>';
  }

  if (state.opts.ghost && below) g += `<g opacity=".55">${wallSvg(below, true)}</g>`;

  /* room fills */
  for (const r of level.rooms) {
    const u = USE[r.use] || USE.service;
    const pts = r.poly.map((p) => p.join(',')).join(' ');
    const dash = r.outdoor ? ' stroke-dasharray=".18 .12"' : '';
    g += `<polygon class="room" data-room="${esc(r.id)}" points="${pts}" fill="${u.fill}"`
      + ` stroke="${u.ink}" stroke-opacity=".28" stroke-width=".02"${dash}/>`;
  }

  /* stair void on the level above reads as a hole */
  for (const v of level.voids || []) {
    g += `<polygon points="${v.poly.map((p) => p.join(',')).join(' ')}" fill="url(#hatch)"`
      + ` stroke="#1d2733" stroke-opacity=".35" stroke-width=".022" stroke-dasharray=".14 .1"/>`;
  }

  g += wallSvg(level, false);
  g += openingSvg(level);

  /* A level with its own rising flight shares the stairwell with the one
     arriving from below, so that one is outlined rather than drawn twice. */
  const ownStairs = (level.stairs || []).length > 0;
  if (below) for (const s of below.stairs || []) g += stairSvg(s, true, ownStairs);
  for (const s of level.stairs || []) g += stairSvg(s, false, false);

  if (state.opts.furn) {
    g += '<g class="fx">';
    for (const f of level.fixtures || []) g += fixtureSvg(f);
    g += '</g>';
  }

  if (state.opts.labels) {
    for (const r of level.rooms) {
      const [cx, cy] = r.label || centroid(r.poly);
      const u = USE[r.use] || USE.service;
      /* Shrink the name until it clears the room's narrowest dimension —
         "WC / shower" in a 1.6 m room otherwise runs over the wall. */
      const xsP = r.poly.map((p) => p[0]);
      const wRoom = Math.max(...xsP) - Math.min(...xsP);
      const size = Math.max(0.15, Math.min(0.3, (wRoom * 0.92) / (0.54 * r.name.length)));
      g += `<g text-anchor="middle" fill="${u.ink}">`
        + `<text x="${cx}" y="${cy - 0.06}" font-size="${fmt(size, 3)}" font-weight="700">${esc(r.name)}</text>`
        + `<text x="${cx}" y="${cy + size * 1.15}" font-size="${fmt(size * 0.84, 3)}" opacity=".72">${fmt(area(r.poly), 1)} m²</text></g>`;
    }
  }

  if (state.opts.dims) g += dimsSvg(level);
  g += annotationSvg();

  const h = view.w * (svgHost.clientHeight / Math.max(1, svgHost.clientWidth));
  svgHost.innerHTML = `<svg viewBox="${view.x} ${view.y} ${view.w} ${h}" preserveAspectRatio="xMidYMid meet">`
    + '<defs><pattern id="hatch" width=".3" height=".3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
    + '<rect width=".3" height=".3" fill="#eae5da"/>'
    + '<line x1="0" y1="0" x2="0" y2=".3" stroke="#1d2733" stroke-opacity=".22" stroke-width=".03"/></pattern></defs>'
    + `<rect x="${SHEET.x - 40}" y="${SHEET.y - 40}" width="${SHEET.w + 80}" height="${SHEET.h + 80}" fill="#f4f1ea"/>`
    + `<g font-family="-apple-system, Inter, Helvetica, Arial, sans-serif">${g}</g></svg>`;
  svgEl = svgHost.firstChild;

  renderSchedule(level);
}

function renderSchedule(level) {
  const box = $('readout');
  if (!state.opts.schedule) { box.hidden = true; return; }
  const indoor = level.rooms.filter((r) => !r.outdoor);
  let total = 0;
  let rows = '';
  for (const r of indoor) {
    const a = area(r.poly); total += a;
    rows += `<div class="readout-row"><span>${esc(r.name)}</span><span>${fmt(a, 1)} m²</span></div>`;
  }
  for (const r of level.rooms.filter((x) => x.outdoor)) {
    rows += `<div class="readout-row"><span>${esc(r.name)}</span><span>${fmt(area(r.poly), 1)} m²</span></div>`;
  }
  box.innerHTML = `<h3>${esc(level.name)}</h3>${rows}`
    + `<div class="readout-row readout-total"><span>Internal</span><span>${fmt(total, 1)} m²</span></div>`;
  box.hidden = false;
}

function fit2D() {
  const aspect = svgHost.clientHeight / Math.max(1, svgHost.clientWidth);
  const sheetAspect = SHEET.h / SHEET.w;
  view.w = aspect > sheetAspect ? SHEET.w : SHEET.h / aspect;
  view.x = SHEET.x - (view.w - SHEET.w) / 2;
  view.y = SHEET.y - (view.w * aspect - SHEET.h) / 2;
}

/* ── 2D interaction ───────────────────────────────────── */

(function pan2d() {
  /* Live pointers, plus the anchor the drag started from. Panning keeps
     the world point under the finger fixed; pinch does the same about
     the midpoint. */
  const pts = new Map();
  let drag = null;
  let pinch = 0;
  let moved = 0;

  const rect = () => svgHost.getBoundingClientRect();
  const apply = () => {
    if (!svgEl) return;
    const r = rect();
    svgEl.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.w * (r.height / r.width)}`);
  };

  function zoomAt(fx, fy, k) {
    const r = rect();
    const h = view.w * (r.height / r.width);
    const wx = view.x + fx * view.w, wy = view.y + fy * h;
    const nw = Math.min(SHEET.w * 3, Math.max(2.5, view.w * k));
    view.x = wx - fx * nw;
    view.y = wy - fy * (nw * (r.height / r.width));
    view.w = nw;
  }

  svgHost.addEventListener('pointerdown', (ev) => {
    svgHost.setPointerCapture(ev.pointerId);
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pts.size === 1) {
      const r = rect();
      moved = 0;
      drag = {
        fx: (ev.clientX - r.left) / r.width,
        fy: (ev.clientY - r.top) / r.height,
        vx: view.x, vy: view.y,
      };
    } else {
      drag = null;
      pinch = 0;
    }
  });

  svgHost.addEventListener('pointermove', (ev) => {
    if (!pts.has(ev.pointerId)) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const r = rect();

    if (pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) {
        zoomAt(((a.x + b.x) / 2 - r.left) / r.width, ((a.y + b.y) / 2 - r.top) / r.height, pinch / Math.max(1, dist));
      }
      pinch = dist;
      moved += 4;
      apply();
      return;
    }

    if (!drag) return;
    const fx = (ev.clientX - r.left) / r.width, fy = (ev.clientY - r.top) / r.height;
    const h = view.w * (r.height / r.width);
    view.x = drag.vx + (drag.fx - fx) * view.w;
    view.y = drag.vy + (drag.fy - fy) * h;
    moved += Math.abs(fx - drag.fx) * r.width + Math.abs(fy - drag.fy) * r.height;
    apply();
  });

  const release = (ev) => {
    pts.delete(ev.pointerId);
    if (pts.size < 2) pinch = 0;
    if (pts.size === 0) drag = null;
  };
  svgHost.addEventListener('pointerup', release);
  svgHost.addEventListener('pointercancel', release);

  svgHost.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = rect();
    zoomAt((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height, Math.exp(ev.deltaY * 0.0012));
    apply();
  }, { passive: false });

  /* A pan that ends over a room must not read as a tap on it. */
  svgHost.addEventListener('click', (ev) => {
    if (moved > 6) return;
    const el = ev.target.closest && ev.target.closest('[data-room]');
    if (!el) return;
    const room = currentLevel().rooms.find((r) => r.id === el.dataset.room);
    if (room) $('hint').textContent = `${room.name} · ${fmt(area(room.poly), 1)} m²`;
  });

  window.addEventListener('resize', apply);
})();

/* ── 3D ───────────────────────────────────────────────── */

const three = { loaded: false, failed: false };

async function ensure3D() {
  if (three.loaded || three.failed) return !three.failed;
  try {
    const THREE = await import('three');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    init3D(THREE, OrbitControls);
    three.loaded = true;
    return true;
  } catch (err) {
    three.failed = true;
    $('webgl-fail').hidden = false;
    return false;
  }
}

function init3D(THREE, OrbitControls) {
  const host = $('canvas-host');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141c26);
  scene.fog = new THREE.Fog(0x141c26, 55, 150);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  camera.position.set(19, 15, 22);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 6;
  controls.maxDistance = 90;
  controls.target.set(6, 1.5, 5);

  scene.add(new THREE.HemisphereLight(0xd6e6fb, 0x55604c, 2.1));
  const fill = new THREE.DirectionalLight(0xcfe0f5, 0.6);
  fill.position.set(18, 12, -14);
  scene.add(fill);
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
  sun.position.set(-12, 30, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0008;
  const sc = sun.shadow.camera;
  sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 90;
  sun.target.position.set(6, 0, 5);
  scene.add(sun);
  scene.add(sun.target);

  /* The site sits at the basement's floor level: this house is cut into
     a slope, which is what puts a garage under the living floor. */
  const siteY = PLAN.levels[0].elevation - SLAB;
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(70, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x46583c, roughness: 1 }),
  );
  ground.position.set(6, siteY, 5);
  ground.receiveShadow = true;
  scene.add(ground);

  const MAT = {
    ext: new THREE.MeshStandardMaterial({ color: 0xe9e3d6, roughness: 0.9 }),
    int: new THREE.MeshStandardMaterial({ color: 0xd9d3c6, roughness: 0.95 }),
    slab: new THREE.MeshStandardMaterial({ color: 0xbdb7ab, roughness: 1 }),
    deck: new THREE.MeshStandardMaterial({ color: 0x9c8467, roughness: 0.95 }),
    stair: new THREE.MeshStandardMaterial({ color: 0xcfc8ba, roughness: 0.95 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x9fd4e8, roughness: 0.08, metalness: 0,
      transparent: true, opacity: 0.32, transmission: 0.6, side: THREE.DoubleSide,
    }),
    roof: new THREE.MeshStandardMaterial({ color: 0x8a4b3c, roughness: 0.85, side: THREE.DoubleSide }),
  };
  const fxMat = {};
  const matFor = (type) => (fxMat[type] ||= new THREE.MeshStandardMaterial({ color: (FX[type] || FX.shelf).c, roughness: 0.8 }));

  const root = new THREE.Group();
  scene.add(root);

  function box(w, h, d, x, y, z, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  function slabFor(level) {
    const e = PLAN.envelope;
    const shape = new THREE.Shape();
    shape.moveTo(e.x0 - 0.15, e.y0 - 0.15);
    shape.lineTo(e.x1 + 0.15, e.y0 - 0.15);
    shape.lineTo(e.x1 + 0.15, e.y1 + 0.15);
    shape.lineTo(e.x0 - 0.15, e.y1 + 0.15);
    shape.closePath();
    for (const v of level.voids || []) {
      const hole = new THREE.Path();
      v.poly.forEach((p, i) => (i ? hole.lineTo(p[0], p[1]) : hole.moveTo(p[0], p[1])));
      hole.closePath();
      shape.holes.push(hole);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: SLAB, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, MAT.slab);
    m.position.y = 0;
    m.receiveShadow = true; m.castShadow = true;
    return m;
  }

  function outdoorSlab(room) {
    const shape = new THREE.Shape();
    room.poly.forEach((p, i) => (i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1])));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    const g = new THREE.Group();
    const deck = new THREE.Mesh(geo, MAT.deck);
    deck.receiveShadow = true; deck.castShadow = true;
    g.add(deck);
    /* a low parapet round the outside edge */
    const n = room.poly.length;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = room.poly[i], [x2, y2] = room.poly[(i + 1) % n];
      if (Math.abs(x1 - PLAN.envelope.x1 - 0.15) < 0.05 && Math.abs(x2 - PLAN.envelope.x1 - 0.15) < 0.05) continue;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 1.0, 0.1), MAT.ext);
      rail.position.set((x1 + x2) / 2, 0.5, (y1 + y2) / 2);
      rail.rotation.y = -Math.atan2(y2 - y1, x2 - x1);
      rail.castShadow = true;
      g.add(rail);
    }
    return g;
  }

  function wallsFor(level, cut) {
    const g = new THREE.Group();
    const H = cut ? Math.min(1.25, level.height) : level.height;
    for (const w of level.walls) {
      const a = axis(w);
      const { solid, holes } = spans(w, level.openings);
      const mat = w.kind === 'ext' ? MAT.ext : MAT.int;
      const ext = w.kind === 'ext' ? w.t / 2 : 0;
      const put = (s0, s1, y0, y1) => {
        if (s1 - s0 < 0.001 || y1 - y0 < 0.001) return;
        const cx = a.ax + a.ux * (s0 + s1) / 2, cz = a.ay + a.uy * (s0 + s1) / 2;
        const m = box(s1 - s0, y1 - y0, w.t, cx, y0, cz, mat);
        m.rotation.y = -a.deg * Math.PI / 180;
        m.position.set(cx, y0 + (y1 - y0) / 2, cz);
        g.add(m);
      };
      for (const [s0raw, s1raw] of solid) {
        put(s0raw <= 0.001 ? -ext : s0raw, s1raw >= a.len - 0.001 ? a.len + ext : s1raw, 0, H);
      }
      for (const o of holes) {
        put(o.s0, o.s1, 0, Math.min(o.sill, H));
        put(o.s0, o.s1, Math.min(o.sill + o.h, H), H);
        if ((o.kind === 'window' || o.kind === 'slider') && o.sill < H) {
          const top = Math.min(o.sill + o.h, H);
          const cx = a.ax + a.ux * o.at, cz = a.ay + a.uy * o.at;
          const glass = new THREE.Mesh(new THREE.BoxGeometry(o.w, top - o.sill, 0.04), MAT.glass);
          glass.position.set(cx, o.sill + (top - o.sill) / 2, cz);
          glass.rotation.y = -a.deg * Math.PI / 180;
          g.add(glass);
        }
      }
    }
    return g;
  }

  function stairsFor(level) {
    const g = new THREE.Group();
    for (const st of level.stairs || []) {
      const total = st.flights.reduce((n, f) => n + f.steps, 0);
      const riser = st.rise / total;
      let done = 0;
      for (const f of st.flights) {
        const tread = f.l / f.steps;
        for (let i = 0; i < f.steps; i++) {
          const y = (done + i + 1) * riser;
          const z = f.dir === 'N' ? f.y + f.l - (i + 0.5) * tread : f.y + (i + 0.5) * tread;
          g.add(box(f.w, riser + 0.04, tread, f.x + f.w / 2, y - riser, z, MAT.stair));
        }
        done += f.steps;
      }
      if (st.landing) {
        const L = st.landing, y = st.flights[0].steps * riser;
        g.add(box(L.w, 0.16, L.d, L.x + L.w / 2, y - 0.16, L.y + L.d / 2, MAT.stair));
      }
    }
    return g;
  }

  function fixturesFor(level) {
    const g = new THREE.Group();
    for (const f of level.fixtures || []) {
      const spec = FX[f.type] || { h: 0.7 };
      g.add(box(f.w, spec.h, f.d, f.x, 0, f.y, matFor(f.type)));
    }
    return g;
  }

  function roofMesh() {
    const e = PLAN.envelope, r = PLAN.roof;
    const ov = r.overhang + 0.15;
    const x0 = e.x0 - ov, x1 = e.x1 + ov, y0 = e.y0 - ov, y1 = e.y1 + ov;
    const halfSpan = (y1 - y0) / 2;
    const rise = halfSpan * Math.tan(r.pitch * Math.PI / 180);
    const ridgeY = (y0 + y1) / 2;
    const rx0 = x0 + halfSpan, rx1 = x1 - halfSpan;
    const v = [
      x0, 0, y0, x1, 0, y0, x1, 0, y1, x0, 0, y1,
      rx0, rise, ridgeY, rx1, rise, ridgeY,
    ];
    const idx = [
      0, 1, 5, 0, 5, 4,   // north slope
      2, 3, 4, 2, 4, 5,   // south slope
      3, 0, 4,            // west hip
      1, 2, 5,            // east hip
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, MAT.roof);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  const levelGroups = new Map();
  let roof = null;

  function build() {
    root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    root.clear();
    levelGroups.clear();
    PLAN.levels.forEach((level) => {
      const g = new THREE.Group();
      g.add(slabFor(level));
      g.add(wallsFor(level, state.opts3.cut));
      g.add(stairsFor(level));
      if (state.opts3.furn) g.add(fixturesFor(level));
      for (const r of level.rooms) if (r.outdoor) g.add(outdoorSlab(r));
      g.position.y = level.elevation;
      g.userData.baseY = level.elevation;
      levelGroups.set(level.id, g);
      root.add(g);
    });
    roof = roofMesh();
    roof.position.y = PLAN.levels[PLAN.levels.length - 1].elevation + PLAN.levels[PLAN.levels.length - 1].height + SLAB;
    root.add(roof);
    applyVisibility();
  }

  function applyVisibility() {
    const sel = state.level3;
    PLAN.levels.forEach((level, i) => {
      const g = levelGroups.get(level.id);
      g.visible = sel === 'all' || sel === level.id;
      g.position.y = g.userData.baseY + (sel === 'all' ? i * state.opts3.explode : 0);
    });
    if (roof) {
      roof.visible = state.opts3.roof && (sel === 'all' || sel === PLAN.levels[PLAN.levels.length - 1].id);
      const last = PLAN.levels.length - 1;
      roof.position.y = PLAN.levels[last].elevation + PLAN.levels[last].height + SLAB
        + (sel === 'all' ? last * state.opts3.explode : 0);
    }
  }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  new ResizeObserver(resize).observe(host);
  resize();
  build();

  (function loop() {
    requestAnimationFrame(loop);
    if ($('pane-3d').hidden) return;
    controls.update();
    renderer.render(scene, camera);
  })();

  three.rebuild = build;
  three.refresh = applyVisibility;
  three.resize = resize;
  three.fit = () => {
    controls.target.set(6, state.level3 === 'all' ? 1.5 : 1.2, 5);
    camera.position.set(19, 15, 22);
    controls.update();
  };
}

/* ── chrome ───────────────────────────────────────────── */

function renderRail() {
  const rail = $('rail');
  const items = state.view === '3d'
    ? [{ id: 'all', short: '◧', name: 'All levels', sub: '' }].concat(
      PLAN.levels.map((l) => ({ id: l.id, short: l.short, name: l.name, sub: `${l.elevation >= 0 ? '+' : ''}${fmt(l.elevation, 2)} m` })))
    : PLAN.levels.map((l) => ({ id: l.id, short: l.short, name: l.name, sub: `${l.elevation >= 0 ? '+' : ''}${fmt(l.elevation, 2)} m` }));
  const active = state.view === '3d' ? state.level3 : state.level;
  rail.innerHTML = items.map((it) =>
    `<button type="button" class="lvl${it.id === active ? ' is-on' : ''}" data-level="${esc(it.id)}">`
    + `<b>${esc(it.short)}</b><span>${esc(it.name)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('');
}

$('rail').addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-level]');
  if (!btn) return;
  if (state.view === '3d') { state.level3 = btn.dataset.level; if (three.refresh) three.refresh(); }
  else { state.level = btn.dataset.level; render2D(); }
  renderRail();
});

function setView(v) {
  state.view = v;
  const is3 = v === '3d';
  $('view-plan').classList.toggle('is-on', !is3);
  $('view-3d').classList.toggle('is-on', is3);
  $('view-plan').setAttribute('aria-selected', String(!is3));
  $('view-3d').setAttribute('aria-selected', String(is3));
  $('pane-plan').hidden = is3;
  $('pane-3d').hidden = !is3;
  $('opts-plan').hidden = is3;
  $('opts-3d').hidden = !is3;
  $('hint').textContent = is3 ? 'Drag to orbit · pinch to zoom' : 'Drag to pan · tap a room';
  renderRail();
  if (is3) ensure3D().then((ok) => { if (ok && three.resize) three.resize(); });
  else render2D();
}

$('view-plan').addEventListener('click', () => setView('2d'));
$('view-3d').addEventListener('click', () => setView('3d'));

$('btn-fit').addEventListener('click', () => {
  if (state.view === '3d') { if (three.fit) three.fit(); }
  else { fit2D(); render2D(); }
});

const bind = (id, fn) => $(id).addEventListener('change', (ev) => fn(ev.target.checked));
bind('o-dims', (v) => { state.opts.dims = v; render2D(); });
bind('o-furn', (v) => { state.opts.furn = v; render2D(); });
bind('o-labels', (v) => { state.opts.labels = v; render2D(); });
bind('o-ghost', (v) => { state.opts.ghost = v; render2D(); });
bind('o-grid', (v) => { state.opts.grid = v; render2D(); });
bind('o-schedule', (v) => { state.opts.schedule = v; render2D(); });
bind('o-roof', (v) => { state.opts3.roof = v; if (three.refresh) three.refresh(); });
bind('o-furn3', (v) => { state.opts3.furn = v; if (three.rebuild) three.rebuild(); });
bind('o-cut', (v) => { state.opts3.cut = v; if (three.rebuild) three.rebuild(); });
$('o-explode').addEventListener('input', (ev) => {
  state.opts3.explode = Number(ev.target.value);
  if (three.refresh) three.refresh();
});

$('quit').addEventListener('click', () => {
  if (window.self !== window.top) window.parent.postMessage({ type: 'close-game' }, '*');
  else window.location.href = '../../';
});

window.addEventListener('resize', () => { if (state.view === '2d') render2D(); });

/* ── boot ─────────────────────────────────────────────── */

$('plan-name').textContent = PLAN.name;
$('plan-sub').textContent = PLAN.subtitle;
renderRail();
fit2D();
render2D();
setTimeout(() => {
  const l = $('app-loading');
  l.classList.add('hidden');
  setTimeout(() => l.remove(), 400);
}, 60);
$('hint').textContent = 'Drag to pan · tap a room';
