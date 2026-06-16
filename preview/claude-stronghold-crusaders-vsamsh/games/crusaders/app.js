(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Stronghold Crusaders — prototype.
  // A SEEDED, ENDLESS isometric world. Terrain and props are pure functions of
  // (seed, tileC, tileR), so the map isn't stored anywhere — we just compute &
  // draw whatever tiles the camera currently covers. Pan in any direction and
  // new land appears forever (bounded only by float precision — "almost"
  // infinite). Self-contained: no shared imports, ships its own palette.
  // ---------------------------------------------------------------------------

  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');
  const tip = document.getElementById('tip');
  const overlay = document.getElementById('overlay');
  const blurb = document.getElementById('overlay-blurb');
  const seedVal = document.getElementById('seed-val');

  const TILE_W = 64, TILE_H = 32;   // base iso footprint (unzoomed)
  const ELEV = 22;                  // px a 1-unit-tall block rises

  // ---- Seed ------------------------------------------------------------------
  function loadSeed() {
    try {
      const s = localStorage.getItem('crusaders-seed');
      if (s != null && s !== '') return (parseInt(s, 10) >>> 0);
    } catch (_) {}
    return (Math.random() * 4294967296) >>> 0;
  }
  let seed = loadSeed();
  function setSeed(s) {
    seed = s >>> 0;
    try { localStorage.setItem('crusaders-seed', String(seed)); } catch (_) {}
    if (seedVal) seedVal.textContent = seed;
  }

  // ---- Seeded value noise ----------------------------------------------------
  // 32-bit integer hash (Math.imul keeps it deterministic for huge coords).
  function hash2(s, x, y) {
    let h = s | 0;
    h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
    h = Math.imul(h ^ (y | 0), 0x165667b1);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  function valueNoise(s, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const top = lerp(hash2(s, xi, yi), hash2(s, xi + 1, yi), u);
    const bot = lerp(hash2(s, xi, yi + 1), hash2(s, xi + 1, yi + 1), u);
    return lerp(top, bot, v);
  }
  function fbm(s, x, y) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < 4; o++) {
      sum += amp * valueNoise(s + o * 1013, x * freq, y * freq);
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }

  // ---- Biomes ----------------------------------------------------------------
  const COLORS = {
    dw: { top: '#2d6586', l: '#244f68', r: '#1d4254' },  // deep water
    w:  { top: '#3f86a8', l: '#336e8b', r: '#2a5c75' },  // shallow water
    sa: { top: '#d9b56a', l: '#bf9a50', r: '#a8843f' },  // sand
    g:  { top: '#7d9b46', l: '#5f7836', r: '#4f6429' },  // grassland
    fo: { top: '#5f7e34', l: '#496127', r: '#3c5020' },  // woodland floor
    ro: { top: '#8d8475', l: '#6f675b', r: '#585146' },  // rocky highland
    sn: { top: '#e8eaf0', l: '#c2c8d6', r: '#a9b0c2' },  // snowfield
  };
  const BIOME_NAME = {
    dw: 'Deep water', w: 'Shallow water', sa: 'Desert sand', g: 'Grassland',
    fo: 'Woodland', ro: 'Rocky highland', sn: 'Snowfield',
  };

  // Home clearing: force grass within this radius of spawn so the keep always
  // sits on solid, buildable ground regardless of seed.
  const HOME_R = 9;
  function isHome(c, r) { return (c * c + r * r) < HOME_R * HOME_R; }

  function biomeAt(c, r) {
    if (isHome(c, r)) return 'g';
    const e = fbm(seed, c * 0.06, r * 0.06);            // elevation
    const m = fbm(seed + 777, c * 0.05 + 100, r * 0.05 + 100); // moisture
    if (e < 0.34) return 'dw';
    if (e < 0.40) return 'w';
    if (e < 0.45) return 'sa';
    if (e < 0.72) { if (m < 0.42) return 'sa'; if (m > 0.62) return 'fo'; return 'g'; }
    if (e < 0.84) return 'ro';
    return 'sn';
  }

  // Deterministic prop per tile (trees, rocks, ruins...). Pure function of seed.
  const PROP_NAME = {
    tree: 'Tree', palm: 'Date palm', cactus: 'Cactus', rock: 'Boulder', ruin: 'Ancient ruin',
  };
  function propAt(c, r) {
    if (isHome(c, r)) return null;
    const b = biomeAt(c, r);
    const h = hash2(seed ^ 0x9e37, c, r);
    const j = hash2(seed ^ 0x51ed, c, r);
    if (b === 'fo') { if (h < 0.55) return { type: 'tree', h: 1.3 + j * 0.9 }; }
    else if (b === 'g') { if (h < 0.12) return { type: 'tree', h: 1.1 + j * 0.5 }; if (h > 0.985) return { type: 'ruin', h: 1.0 }; }
    else if (b === 'sa') { if (h < 0.045) return { type: 'palm', h: 1.5 }; if (h > 0.98) return { type: 'cactus', h: 1.0 }; }
    else if (b === 'ro') { if (h < 0.20) return { type: 'rock', h: 0.7 + j * 0.8 }; }
    else if (b === 'sn') { if (h < 0.10) return { type: 'rock', h: 0.8 }; }
    return null;
  }

  // ---- The home holding (fixed structures around spawn 0,0) -------------------
  const buildings = [
    { c: 0,  r: 0,  type: 'keep',   h: 3.0, label: 'The Keep' },
    { c: -2, r: -1, type: 'tower',  h: 2.4, label: 'Square Tower' },
    { c: 2,  r: -1, type: 'tower',  h: 2.4, label: 'Square Tower' },
    { c: -2, r: 2,  type: 'tower',  h: 2.4, label: 'Square Tower' },
    { c: 2,  r: 2,  type: 'tower',  h: 2.4, label: 'Square Tower' },
    { c: 0,  r: -3, type: 'gate',   h: 1.8, label: 'Gatehouse' },
    { c: -4, r: 4,  type: 'house',  h: 1.0, label: "Peasant's Hovel" },
    { c: -5, r: 5,  type: 'house',  h: 1.0, label: "Peasant's Hovel" },
    { c: -3, r: 6,  type: 'house',  h: 1.0, label: "Peasant's Hovel" },
    { c: 5,  r: 2,  type: 'tent',   h: 1.1, label: 'Mercenary Tent' },
    { c: 6,  r: 3,  type: 'tent',   h: 1.1, label: 'Mercenary Tent' },
    { c: 3,  r: 6,  type: 'farm',   h: 0.35, label: 'Wheat Farm' },
    { c: 5,  r: 7,  type: 'farm',   h: 0.35, label: 'Apple Orchard' },
    { c: 6,  r: 1,  type: 'market', h: 1.3, label: 'Market' },
  ];
  const walls = [];
  (function buildWalls() {
    const ring = [[-2,-1],[-1,-1],[0,-1],[1,-1],[2,-1],
                  [-2,0],[-2,1],[-2,2],
                  [2,0],[2,1],[2,2],
                  [-1,2],[0,2],[1,2]];
    for (const [c, r] of ring) walls.push({ c, r, h: 1.4 });
  })();
  const units = [
    { color: '#d64545', flag: '#f2d35a', path: [[-1,-2],[1,-2],[1,3],[-1,3]], i: 0, t: 0, spd: 0.45, label: 'Spearman patrol' },
    { color: '#3f5fb0', flag: '#e8e8e8', path: [[-4,4],[3,6],[5,3],[0,0]], i: 0, t: 0.3, spd: 0.30, label: 'Trader' },
    { color: '#caa23a', flag: '#2b1d12', path: [[5,2],[7,4],[6,6],[4,4]], i: 0, t: 0.6, spd: 0.36, label: 'Mercenary' },
  ];

  // ---- Camera ---------------------------------------------------------------
  const cam = { x: 0, y: 0, zoom: 1 };
  const ZOOM_MIN = 0.5, ZOOM_MAX = 2.2;

  function tileTopScreen(c, r) {
    return { x: (c - r) * (TILE_W / 2), y: (c + r) * (TILE_H / 2) };
  }
  function screenOf(c, r) {
    const p = tileTopScreen(c, r);
    return { sx: cam.x + p.x * cam.zoom, sy: cam.y + p.y * cam.zoom };
  }
  function centerOn(c, r) {
    const p = tileTopScreen(c, r);
    cam.x = canvas.clientWidth / 2 - p.x * cam.zoom;
    cam.y = canvas.clientHeight / 2 - p.y * cam.zoom;
  }

  // Which tiles does the viewport currently cover? Invert the iso transform on
  // the (padded) screen corners and take the axis-aligned tile bounding box.
  function visibleBounds() {
    const W = canvas.clientWidth, H = canvas.clientHeight, pad = 80;
    const corners = [[-pad, -pad], [W + pad, -pad], [-pad, H + pad], [W + pad, H + pad]];
    let cMin = Infinity, cMax = -Infinity, rMin = Infinity, rMax = -Infinity;
    for (const [px, py] of corners) {
      const wx = (px - cam.x) / cam.zoom, wy = (py - cam.y) / cam.zoom;
      const c = (wx / (TILE_W / 2) + wy / (TILE_H / 2)) / 2;
      const r = (wy / (TILE_H / 2) - wx / (TILE_W / 2)) / 2;
      cMin = Math.min(cMin, c); cMax = Math.max(cMax, c);
      rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
    }
    return {
      cMin: Math.floor(cMin) - 2, cMax: Math.ceil(cMax) + 2,
      rMin: Math.floor(rMin) - 2, rMax: Math.ceil(rMax) + 3,
    };
  }

  // ---- Hi-DPI sizing ---------------------------------------------------------
  let DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * DPR);
    canvas.height = Math.round(canvas.clientHeight * DPR);
  }

  // ---- Drawing primitives ----------------------------------------------------
  function diamond(sx, sy, w, h) {
    ctx.beginPath();
    ctx.moveTo(sx, sy - h / 2);
    ctx.lineTo(sx + w / 2, sy);
    ctx.lineTo(sx, sy + h / 2);
    ctx.lineTo(sx - w / 2, sy);
    ctx.closePath();
  }

  function drawTile(c, r) {
    const t = biomeAt(c, r);
    const { sx } = screenOf(c, r);
    let { sy } = screenOf(c, r);
    const w = TILE_W * cam.zoom, h = TILE_H * cam.zoom;
    if (sx < -w || sx > canvas.clientWidth + w || sy < -h || sy > canvas.clientHeight + h) return;
    if (t === 'w' || t === 'dw') sy += Math.sin(now / 600 + (c + r)) * 1.2;
    diamond(sx, sy, w, h);
    ctx.fillStyle = COLORS[t].top; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.10)'; ctx.lineWidth = 1; ctx.stroke();
  }

  function drawBox(c, r, hUnits, faces, footScale) {
    const { sx, sy } = screenOf(c, r);
    const w = TILE_W * cam.zoom * (footScale || 1);
    const h = TILE_H * cam.zoom * (footScale || 1);
    const rise = ELEV * hUnits * cam.zoom;
    ctx.beginPath();
    ctx.moveTo(sx - w / 2, sy); ctx.lineTo(sx, sy + h / 2);
    ctx.lineTo(sx, sy + h / 2 - rise); ctx.lineTo(sx - w / 2, sy - rise);
    ctx.closePath(); ctx.fillStyle = faces.l; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sx + w / 2, sy); ctx.lineTo(sx, sy + h / 2);
    ctx.lineTo(sx, sy + h / 2 - rise); ctx.lineTo(sx + w / 2, sy - rise);
    ctx.closePath(); ctx.fillStyle = faces.r; ctx.fill();
    diamond(sx, sy - rise, w, h);
    ctx.fillStyle = faces.top; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1; ctx.stroke();
    return { sx, sy, rise, w, h };
  }

  const STONE = { top: '#cdbfa3', l: '#9c8e72', r: '#84765c' };
  const KEEP  = { top: '#ded2b6', l: '#a99c7e', r: '#8d8064' };
  const ROCK  = { top: '#9a9183', l: '#7a7264', r: '#615a4e' };

  function flagpole(sx, topY, pole) {
    const hgt = 16 * cam.zoom;
    ctx.strokeStyle = '#3a2817'; ctx.lineWidth = 2 * cam.zoom;
    ctx.beginPath(); ctx.moveTo(sx, topY); ctx.lineTo(sx, topY - hgt); ctx.stroke();
    const wave = Math.sin(now / 240) * 2 * cam.zoom;
    ctx.fillStyle = pole;
    ctx.beginPath();
    ctx.moveTo(sx, topY - hgt);
    ctx.lineTo(sx + 12 * cam.zoom + wave, topY - hgt + 3 * cam.zoom);
    ctx.lineTo(sx, topY - hgt + 7 * cam.zoom);
    ctx.closePath(); ctx.fill();
  }

  function drawBuilding(b) {
    switch (b.type) {
      case 'keep': {
        const o = drawBox(b.c, b.r, b.h, KEEP, 1.05);
        flagpole(o.sx, o.sy - o.rise, '#d64545');
        break;
      }
      case 'tower': {
        const o = drawBox(b.c, b.r, b.h, STONE, 0.8);
        diamond(o.sx, o.sy - o.rise, o.w * 0.8, o.h * 0.8);
        ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fill();
        break;
      }
      case 'gate': drawBox(b.c, b.r, b.h, STONE, 1.0); break;
      case 'market': {
        const o = drawBox(b.c, b.r, b.h, { top: '#c98f4e', l: '#a06f37', r: '#84592b' }, 0.95);
        diamond(o.sx, o.sy - o.rise, o.w * 0.95, o.h * 0.95);
        ctx.fillStyle = '#e0d2a0'; ctx.fill();
        break;
      }
      case 'house': drawBox(b.c, b.r, b.h, { top: '#b06a3b', l: '#8a5a34', r: '#6f4828' }, 0.7); break;
      case 'farm': drawBox(b.c, b.r, b.h, { top: '#b9a23f', l: '#8f7d30', r: '#766727' }, 1.0); break;
      case 'tent': {
        const { sx, sy } = screenOf(b.c, b.r);
        const rise = ELEV * b.h * cam.zoom, w = TILE_W * 0.55 * cam.zoom;
        ctx.beginPath();
        ctx.moveTo(sx, sy - rise);
        ctx.lineTo(sx - w / 2, sy + 4 * cam.zoom);
        ctx.lineTo(sx + w / 2, sy + 4 * cam.zoom);
        ctx.closePath();
        ctx.fillStyle = '#e3dcc7'; ctx.fill();
        ctx.strokeStyle = '#b6402f'; ctx.lineWidth = 1.4 * cam.zoom; ctx.stroke();
        break;
      }
      case 'ruin': {
        const o = drawBox(b.c, b.r, b.h, STONE, 0.7);
        // knock a notch out of the top to read as broken
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(o.sx - 2 * cam.zoom, o.sy - o.rise - 8 * cam.zoom, 8 * cam.zoom, 8 * cam.zoom);
        break;
      }
      case 'rock': drawBox(b.c, b.r, b.h, ROCK, 0.6); break;
      case 'cactus': {
        const { sx, sy } = screenOf(b.c, b.r);
        const s = cam.zoom, th = ELEV * b.h * s;
        ctx.strokeStyle = '#3f7a34'; ctx.lineWidth = 4 * s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - th); ctx.stroke();
        ctx.lineWidth = 3 * s;
        ctx.beginPath(); ctx.moveTo(sx, sy - th * 0.55); ctx.lineTo(sx - 6 * s, sy - th * 0.55);
        ctx.lineTo(sx - 6 * s, sy - th * 0.8); ctx.stroke();
        break;
      }
      case 'palm': {
        const { sx, sy } = screenOf(b.c, b.r);
        const s = cam.zoom, trunk = ELEV * b.h * s;
        ctx.strokeStyle = '#7a5a32'; ctx.lineWidth = 3 * s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 2 * s, sy - trunk); ctx.stroke();
        ctx.strokeStyle = '#4f8a3a'; ctx.lineWidth = 2.4 * s;
        const tx = sx + 2 * s, ty = sy - trunk, fr = 13 * s;
        for (const a of [-2.5, -1.7, -0.9, -0.2, 0.6]) {
          ctx.beginPath(); ctx.moveTo(tx, ty);
          ctx.lineTo(tx + Math.cos(a) * fr, ty - Math.sin(a) * fr * 0.7); ctx.stroke();
        }
        break;
      }
      case 'tree': {
        const { sx, sy } = screenOf(b.c, b.r);
        const s = cam.zoom, th = ELEV * b.h * s;
        ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 3 * s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - th); ctx.stroke();
        ctx.fillStyle = '#3f7a34';
        ctx.beginPath(); ctx.arc(sx, sy - th - 4 * s, 9 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#4f8f40';
        ctx.beginPath(); ctx.arc(sx - 4 * s, sy - th, 6.5 * s, 0, Math.PI * 2); ctx.fill();
        break;
      }
    }
  }

  function unitWorldPos(u) {
    const a = u.path[u.i], b = u.path[(u.i + 1) % u.path.length];
    return tileTopScreen(a[0] + (b[0] - a[0]) * u.t, a[1] + (b[1] - a[1]) * u.t);
  }
  function drawUnit(u) {
    const p = unitWorldPos(u);
    const sx = cam.x + p.x * cam.zoom, sy = cam.y + p.y * cam.zoom, s = cam.zoom;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(sx, sy, 7 * s, 3.4 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = u.color; ctx.fillRect(sx - 3 * s, sy - 13 * s, 6 * s, 11 * s);
    ctx.fillStyle = '#e9c9a0';
    ctx.beginPath(); ctx.arc(sx, sy - 15 * s, 3 * s, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a2817'; ctx.lineWidth = 1.4 * s;
    ctx.beginPath(); ctx.moveTo(sx + 4 * s, sy - 2 * s); ctx.lineTo(sx + 4 * s, sy - 18 * s); ctx.stroke();
    ctx.fillStyle = u.flag;
    ctx.beginPath();
    ctx.moveTo(sx + 4 * s, sy - 18 * s); ctx.lineTo(sx + 11 * s, sy - 16 * s);
    ctx.lineTo(sx + 4 * s, sy - 14 * s); ctx.closePath(); ctx.fill();
  }

  // ---- Render ----------------------------------------------------------------
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight);
    g.addColorStop(0, '#c98f4e'); g.addColorStop(0.5, '#a86f3a'); g.addColorStop(1, '#7a4f2a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    const b = visibleBounds();
    const inView = (c, r) => c >= b.cMin && c <= b.cMax && r >= b.rMin && r <= b.rMax;

    // 1) ground tiles, back-to-front by (c + r)
    for (let s = b.cMin + b.rMin; s <= b.cMax + b.rMax; s++) {
      for (let c = b.cMin; c <= b.cMax; c++) {
        const r = s - c;
        if (r < b.rMin || r > b.rMax) continue;
        drawTile(c, r);
      }
    }

    // 2) everything that stands up, depth-sorted
    const objs = [];
    for (const w of walls) if (inView(w.c, w.r)) objs.push({ d: w.c + w.r, kind: 'wall', ref: w });
    for (const bd of buildings) if (inView(bd.c, bd.r)) objs.push({ d: bd.c + bd.r, kind: 'bld', ref: bd });
    for (let c = b.cMin; c <= b.cMax; c++) {
      for (let r = b.rMin; r <= b.rMax; r++) {
        const p = propAt(c, r);
        if (p) objs.push({ d: c + r + 0.02, kind: 'bld', ref: { c, r, type: p.type, h: p.h } });
      }
    }
    for (const u of units) {
      const a = u.path[u.i], n = u.path[(u.i + 1) % u.path.length];
      const d = (a[0] + (n[0] - a[0]) * u.t) + (a[1] + (n[1] - a[1]) * u.t);
      objs.push({ d: d + 0.01, kind: 'unit', ref: u });
    }
    objs.sort((p, q) => p.d - q.d);
    for (const o of objs) {
      if (o.kind === 'wall') drawBox(o.ref.c, o.ref.r, o.ref.h, STONE, 0.92);
      else if (o.kind === 'bld') drawBuilding(o.ref);
      else drawUnit(o.ref);
    }
  }

  // ---- Picking ---------------------------------------------------------------
  function pickAt(px, py) {
    const ordered = buildings.slice().sort((a, b) => (b.c + b.r) - (a.c + a.r));
    for (const b of ordered) {
      const { sx } = screenOf(b.c, b.r);
      const sy = screenOf(b.c, b.r).sy - ELEV * b.h * cam.zoom;
      const w = TILE_W * cam.zoom, h = TILE_H * cam.zoom;
      if (Math.abs(px - sx) / (w / 2) + Math.abs(py - sy) / (h / 2) <= 1.1) return b.label;
    }
    const wx = (px - cam.x) / cam.zoom, wy = (py - cam.y) / cam.zoom;
    const c = Math.round((wx / (TILE_W / 2) + wy / (TILE_H / 2)) / 2);
    const r = Math.round((wy / (TILE_H / 2) - wx / (TILE_W / 2)) / 2);
    const p = propAt(c, r);
    if (p) return PROP_NAME[p.type];
    return BIOME_NAME[biomeAt(c, r)];
  }

  let tipTimer = 0;
  function showTip(text) {
    if (!text) return;
    tip.textContent = text; tip.classList.add('show');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => tip.classList.remove('show'), 1800);
  }

  // ---- Gestures: pan (1 finger) / pinch-zoom (2 fingers) ---------------------
  const pointers = new Map();
  let panLast = null, pinch = null, downAt = null, moved = 0;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function clientToCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = clientToCanvas(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) { panLast = p; downAt = p; moved = 0; }
    else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinch = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        zoom: cam.zoom,
      };
      panLast = null;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = clientToCanvas(e);
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
      zoomAround(cx, cy, clamp(pinch.zoom * (dist / pinch.dist), ZOOM_MIN, ZOOM_MAX));
      return;
    }
    if (panLast) {
      const dx = p.x - panLast.x, dy = p.y - panLast.y;
      cam.x += dx; cam.y += dy; moved += Math.abs(dx) + Math.abs(dy);
      panLast = p;
    }
  });
  function endPointer(e) {
    const wasTap = pointers.size === 1 && moved < 8 && downAt;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) panLast = [...pointers.values()][0];
    else if (pointers.size === 0) {
      if (wasTap) showTip(pickAt(downAt.x, downAt.y));
      panLast = null; downAt = null;
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  function zoomAround(cx, cy, target) {
    const wx = (cx - cam.x) / cam.zoom, wy = (cy - cam.y) / cam.zoom;
    cam.zoom = target;
    cam.x = cx - wx * cam.zoom; cam.y = cy - wy * cam.zoom;
  }
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = clientToCanvas(e);
    zoomAround(p.x, p.y, clamp(cam.zoom * (e.deltaY < 0 ? 1.12 : 0.89), ZOOM_MIN, ZOOM_MAX));
  }, { passive: false });

  // ---- Buttons ---------------------------------------------------------------
  function zoomStep(f) {
    zoomAround(canvas.clientWidth / 2, canvas.clientHeight / 2, clamp(cam.zoom * f, ZOOM_MIN, ZOOM_MAX));
  }
  document.getElementById('zin-btn').addEventListener('click', () => zoomStep(1.2));
  document.getElementById('zout-btn').addEventListener('click', () => zoomStep(1 / 1.2));
  document.getElementById('center-btn').addEventListener('click', () => centerOn(0, 0));
  document.getElementById('menu-btn').addEventListener('click', openMenu);

  function openMenu() {
    if (seedVal) seedVal.textContent = seed;
    overlay.dataset.state = 'title';
  }
  function closeMenu() { overlay.dataset.state = 'hidden'; }
  document.getElementById('play-btn').addEventListener('click', closeMenu);
  document.getElementById('how-btn').addEventListener('click', () => {
    blurb.textContent = 'Drag with one finger to roam the endless map. Pinch (or − / +) to zoom. Tap any building, prop or tile to inspect it. 🏰 recenters on your keep. Each seed is a different world — try “New world”.';
  });
  document.getElementById('reroll-btn').addEventListener('click', () => {
    setSeed((Math.random() * 4294967296) >>> 0);
    centerOn(0, 0);
    // reset patrol positions so units sit back home in the fresh world
    for (const u of units) { u.i = 0; }
  });

  document.getElementById('quit-btn').addEventListener('click', () => {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (_) {}
    } else { location.href = '../../'; }
  });

  // ---- Main loop -------------------------------------------------------------
  let now = 0, last = 0;
  function frame(ts) {
    now = ts;
    const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
    for (const u of units) {
      u.t += u.spd * dt;
      while (u.t >= 1) { u.t -= 1; u.i = (u.i + 1) % u.path.length; }
    }
    render();
    requestAnimationFrame(frame);
  }

  // ---- Boot ------------------------------------------------------------------
  setSeed(seed);
  resize();
  centerOn(0, 0);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  requestAnimationFrame(frame);

  (function hideLoadingWhenReady() {
    const loading = document.getElementById('game-loading');
    if (!loading) return;
    const navStart = (performance && performance.timeOrigin) || Date.now();
    const remaining = Math.max(0, 3000 - (Date.now() - navStart));
    setTimeout(() => {
      loading.classList.add('hidden');
      setTimeout(() => loading.remove(), 500);
    }, remaining);
  })();
})();
