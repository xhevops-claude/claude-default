(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Stronghold Crusaders — prototype.
  // A pannable / pinch-zoomable isometric desert holding. Self-contained:
  // no shared imports, ships its own palette (sub-experiences aren't themed).
  // ---------------------------------------------------------------------------

  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');
  const tip = document.getElementById('tip');
  const overlay = document.getElementById('overlay');
  const blurb = document.getElementById('overlay-blurb');

  // ---- Map definition --------------------------------------------------------
  // Terrain codes: g grass/scrub, s sand, w water (oasis), r rock.
  const N = 18;                         // map is N x N tiles
  const TILE_W = 64, TILE_H = 32;       // base iso tile footprint (unzoomed)
  const ELEV = 22;                      // vertical px a 1-unit-tall block rises

  // Deterministic terrain: an oasis pool, ringed by grass, sand everywhere else.
  const OASIS = { c: 12, r: 13, rad: 2.2 };
  function terrainAt(c, r) {
    const d = Math.hypot(c - OASIS.c, r - OASIS.r);
    if (d < OASIS.rad) return 'w';
    if (d < OASIS.rad + 1.4) return 'g';
    // a rocky ridge along the back edge
    if (c + r < 5) return 'r';
    return 's';
  }

  const COLORS = {
    g: { top: '#7d9b46', l: '#5f7836', r: '#4f6429' },
    s: { top: '#d9b56a', l: '#bf9a50', r: '#a8843f' },
    w: { top: '#3f86a8', l: '#336e8b', r: '#2a5c75' },
    r: { top: '#8d8475', l: '#6f675b', r: '#585146' },
  };

  // ---- Things on the map -----------------------------------------------------
  // type drives how it's drawn + its inspect label. h = height in blocks.
  const buildings = [
    { c: 8,  r: 8,  type: 'keep',   h: 3.0, label: 'The Keep' },
    { c: 6,  r: 7,  type: 'tower',  h: 2.4, label: 'Square Tower' },
    { c: 10, r: 7,  type: 'tower',  h: 2.4, label: 'Square Tower' },
    { c: 6,  r: 10, type: 'tower',  h: 2.4, label: 'Square Tower' },
    { c: 10, r: 10, type: 'tower',  h: 2.4, label: 'Square Tower' },
    { c: 8,  r: 5,  type: 'gate',   h: 1.8, label: 'Gatehouse' },
    { c: 4,  r: 12, type: 'house',  h: 1.0, label: "Peasant's Hovel" },
    { c: 3,  r: 13, type: 'house',  h: 1.0, label: "Peasant's Hovel" },
    { c: 5,  r: 14, type: 'house',  h: 1.0, label: "Peasant's Hovel" },
    { c: 13, r: 10, type: 'tent',   h: 1.1, label: 'Mercenary Tent' },
    { c: 14, r: 11, type: 'tent',   h: 1.1, label: 'Mercenary Tent' },
    { c: 11, r: 14, type: 'farm',   h: 0.35, label: 'Wheat Farm' },
    { c: 13, r: 15, type: 'farm',   h: 0.35, label: 'Apple Orchard' },
    { c: 2,  r: 5,  type: 'palm',   h: 1.6, label: 'Date Palm' },
    { c: 15, r: 12, type: 'palm',   h: 1.6, label: 'Date Palm' },
    { c: 14, r: 14, type: 'palm',   h: 1.6, label: 'Date Palm' },
    { c: 3,  r: 9,  type: 'palm',   h: 1.6, label: 'Date Palm' },
    { c: 16, r: 9,  type: 'market', h: 1.3, label: 'Market' },
  ];

  // Wall segments (drawn as low blocks) connecting the towers around the keep.
  const walls = [];
  (function buildWalls() {
    const ring = [[6,7],[7,7],[8,7],[9,7],[10,7],
                  [6,8],[6,9],[6,10],
                  [10,8],[10,9],[10,10],
                  [7,10],[8,10],[9,10]];
    for (const [c, r] of ring) walls.push({ c, r, h: 1.4 });
  })();

  // Patrolling units that walk a fixed loop of tiles. Each renders as a little
  // banner-carrying figure; position lerps between waypoints.
  const units = [
    { color: '#d64545', flag: '#f2d35a', path: [[7,6],[9,6],[9,11],[7,11]], i: 0, t: 0, spd: 0.45, label: 'Spearman patrol' },
    { color: '#3f5fb0', flag: '#e8e8e8', path: [[4,12],[11,14],[13,11],[8,8]], i: 0, t: 0.3, spd: 0.30, label: 'Trader' },
    { color: '#caa23a', flag: '#2b1d12', path: [[13,10],[15,12],[14,14],[12,12]], i: 0, t: 0.6, spd: 0.36, label: 'Mercenary' },
  ];

  // ---- Camera ---------------------------------------------------------------
  const cam = { x: 0, y: 0, zoom: 1 };   // x/y = screen px offset of map origin
  const ZOOM_MIN = 0.55, ZOOM_MAX = 2.2;

  function tileTopScreen(c, r) {
    // iso projection of a tile's top-center, in *world* px (pre-camera).
    return {
      x: (c - r) * (TILE_W / 2),
      y: (c + r) * (TILE_H / 2),
    };
  }

  // Center the camera on a given tile.
  function centerOn(c, r) {
    const p = tileTopScreen(c, r);
    cam.x = canvas.clientWidth / 2 - p.x * cam.zoom;
    cam.y = canvas.clientHeight / 2 - p.y * cam.zoom;
  }

  // ---- Hi-DPI sizing ---------------------------------------------------------
  let DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * DPR);
    canvas.height = Math.round(h * DPR);
  }

  // ---- Drawing ---------------------------------------------------------------
  function diamond(sx, sy, w, h) {
    ctx.beginPath();
    ctx.moveTo(sx, sy - h / 2);
    ctx.lineTo(sx + w / 2, sy);
    ctx.lineTo(sx, sy + h / 2);
    ctx.lineTo(sx - w / 2, sy);
    ctx.closePath();
  }

  function drawTile(c, r) {
    const t = terrainAt(c, r);
    const col = COLORS[t];
    const p = tileTopScreen(c, r);
    const sx = cam.x + p.x * cam.zoom;
    const sy = cam.y + p.y * cam.zoom;
    const w = TILE_W * cam.zoom, h = TILE_H * cam.zoom;

    // Water gets a gentle wobble so the oasis reads as alive.
    let topY = sy;
    if (t === 'w') topY += Math.sin(now / 600 + (c + r)) * 1.2;

    diamond(sx, topY, w, h);
    ctx.fillStyle = col.top;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // A raised box (building/wall) sitting on tile c,r with height `hUnits`.
  function drawBox(c, r, hUnits, faces, footScale) {
    const p = tileTopScreen(c, r);
    const sx = cam.x + p.x * cam.zoom;
    const sy = cam.y + p.y * cam.zoom;
    const w = TILE_W * cam.zoom * (footScale || 1);
    const h = TILE_H * cam.zoom * (footScale || 1);
    const rise = ELEV * hUnits * cam.zoom;

    // left face
    ctx.beginPath();
    ctx.moveTo(sx - w / 2, sy);
    ctx.lineTo(sx, sy + h / 2);
    ctx.lineTo(sx, sy + h / 2 - rise);
    ctx.lineTo(sx - w / 2, sy - rise);
    ctx.closePath();
    ctx.fillStyle = faces.l; ctx.fill();

    // right face
    ctx.beginPath();
    ctx.moveTo(sx + w / 2, sy);
    ctx.lineTo(sx, sy + h / 2);
    ctx.lineTo(sx, sy + h / 2 - rise);
    ctx.lineTo(sx + w / 2, sy - rise);
    ctx.closePath();
    ctx.fillStyle = faces.r; ctx.fill();

    // top
    diamond(sx, sy - rise, w, h);
    ctx.fillStyle = faces.top; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1; ctx.stroke();

    return { sx, sy, rise, w, h };
  }

  const STONE = { top: '#cdbfa3', l: '#9c8e72', r: '#84765c' };
  const KEEP  = { top: '#ded2b6', l: '#a99c7e', r: '#8d8064' };

  function drawBuilding(b) {
    switch (b.type) {
      case 'keep': {
        const r0 = drawBox(b.c, b.r, b.h, KEEP, 1.05);
        // banner on top
        flagpole(r0.sx, r0.sy - r0.rise, '#d64545', '#f2d35a');
        break;
      }
      case 'tower': {
        const r0 = drawBox(b.c, b.r, b.h, STONE, 0.8);
        // crenellation hint: a darker cap
        diamond(r0.sx, r0.sy - r0.rise, r0.w * 0.8, r0.h * 0.8);
        ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fill();
        break;
      }
      case 'gate': {
        drawBox(b.c, b.r, b.h, STONE, 1.0);
        break;
      }
      case 'market': {
        const r0 = drawBox(b.c, b.r, b.h, { top: '#c98f4e', l: '#a06f37', r: '#84592b' }, 0.95);
        // striped awning top
        diamond(r0.sx, r0.sy - r0.rise, r0.w * 0.95, r0.h * 0.95);
        ctx.fillStyle = '#e0d2a0'; ctx.fill();
        break;
      }
      case 'house': {
        drawBox(b.c, b.r, b.h, { top: '#b06a3b', l: '#8a5a34', r: '#6f4828' }, 0.7);
        break;
      }
      case 'tent': {
        // cone-ish tent: triangle on a small base
        const p = tileTopScreen(b.c, b.r);
        const sx = cam.x + p.x * cam.zoom;
        const sy = cam.y + p.y * cam.zoom;
        const rise = ELEV * b.h * cam.zoom;
        const w = TILE_W * 0.55 * cam.zoom;
        ctx.beginPath();
        ctx.moveTo(sx, sy - rise);
        ctx.lineTo(sx - w / 2, sy + 4 * cam.zoom);
        ctx.lineTo(sx + w / 2, sy + 4 * cam.zoom);
        ctx.closePath();
        ctx.fillStyle = '#e3dcc7'; ctx.fill();
        ctx.strokeStyle = '#b6402f'; ctx.lineWidth = 1.4 * cam.zoom; ctx.stroke();
        break;
      }
      case 'farm': {
        // flat tilled patch, slightly raised
        drawBox(b.c, b.r, b.h, { top: '#b9a23f', l: '#8f7d30', r: '#766727' }, 1.0);
        break;
      }
      case 'palm': {
        const p = tileTopScreen(b.c, b.r);
        const sx = cam.x + p.x * cam.zoom;
        const sy = cam.y + p.y * cam.zoom;
        const trunk = ELEV * b.h * cam.zoom;
        // trunk
        ctx.strokeStyle = '#7a5a32'; ctx.lineWidth = 3 * cam.zoom; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 2 * cam.zoom, sy - trunk); ctx.stroke();
        // fronds
        ctx.strokeStyle = '#4f8a3a'; ctx.lineWidth = 2.4 * cam.zoom;
        const top = sy - trunk, tx = sx + 2 * cam.zoom;
        const fr = 13 * cam.zoom;
        for (const a of [-2.5, -1.7, -0.9, -0.2, 0.6]) {
          ctx.beginPath(); ctx.moveTo(tx, top);
          ctx.lineTo(tx + Math.cos(a) * fr, top - Math.sin(a) * fr * 0.7);
          ctx.stroke();
        }
        break;
      }
    }
  }

  function flagpole(sx, topY, pole, cloth) {
    const hgt = 16 * cam.zoom;
    ctx.strokeStyle = '#3a2817'; ctx.lineWidth = 2 * cam.zoom;
    ctx.beginPath(); ctx.moveTo(sx, topY); ctx.lineTo(sx, topY - hgt); ctx.stroke();
    const wave = Math.sin(now / 240) * 2 * cam.zoom;
    ctx.fillStyle = pole;
    ctx.beginPath();
    ctx.moveTo(sx, topY - hgt);
    ctx.lineTo(sx + 12 * cam.zoom + wave, topY - hgt + 3 * cam.zoom);
    ctx.lineTo(sx, topY - hgt + 7 * cam.zoom);
    ctx.closePath();
    ctx.fill();
    void cloth;
  }

  function unitWorldPos(u) {
    const a = u.path[u.i];
    const b = u.path[(u.i + 1) % u.path.length];
    const c = a[0] + (b[0] - a[0]) * u.t;
    const r = a[1] + (b[1] - a[1]) * u.t;
    return tileTopScreen(c, r);
  }

  function drawUnit(u) {
    const p = unitWorldPos(u);
    const sx = cam.x + p.x * cam.zoom;
    const sy = cam.y + p.y * cam.zoom;
    const s = cam.zoom;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(sx, sy, 7 * s, 3.4 * s, 0, 0, Math.PI * 2); ctx.fill();
    // body
    ctx.fillStyle = u.color;
    ctx.fillRect(sx - 3 * s, sy - 13 * s, 6 * s, 11 * s);
    // head
    ctx.fillStyle = '#e9c9a0';
    ctx.beginPath(); ctx.arc(sx, sy - 15 * s, 3 * s, 0, Math.PI * 2); ctx.fill();
    // little banner
    ctx.strokeStyle = '#3a2817'; ctx.lineWidth = 1.4 * s;
    ctx.beginPath(); ctx.moveTo(sx + 4 * s, sy - 2 * s); ctx.lineTo(sx + 4 * s, sy - 18 * s); ctx.stroke();
    ctx.fillStyle = u.flag;
    ctx.beginPath();
    ctx.moveTo(sx + 4 * s, sy - 18 * s);
    ctx.lineTo(sx + 11 * s, sy - 16 * s);
    ctx.lineTo(sx + 4 * s, sy - 14 * s);
    ctx.closePath(); ctx.fill();
  }

  // The painter's-algorithm sort key: tiles & objects drawn back-to-front by
  // (c + r), with objects drawn after the tile they stand on.
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // sky / sand backdrop
    const g = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight);
    g.addColorStop(0, '#c98f4e');
    g.addColorStop(0.5, '#a86f3a');
    g.addColorStop(1, '#7a4f2a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    // 1) all ground tiles
    for (let s = 0; s <= 2 * (N - 1); s++) {
      for (let c = 0; c < N; c++) {
        const r = s - c;
        if (r < 0 || r >= N) continue;
        drawTile(c, r);
      }
    }

    // 2) objects, sorted by depth so nearer ones overlap farther ones.
    const objs = [];
    for (const w of walls) objs.push({ depth: w.c + w.r, kind: 'wall', ref: w });
    for (const b of buildings) objs.push({ depth: b.c + b.r, kind: 'bld', ref: b });
    for (const u of units) {
      const a = u.path[u.i], b = u.path[(u.i + 1) % u.path.length];
      const depth = (a[0] + (b[0] - a[0]) * u.t) + (a[1] + (b[1] - a[1]) * u.t);
      objs.push({ depth: depth + 0.01, kind: 'unit', ref: u });
    }
    objs.sort((p, q) => p.depth - q.depth);
    for (const o of objs) {
      if (o.kind === 'wall') drawBox(o.ref.c, o.ref.r, o.ref.h, STONE, 0.92);
      else if (o.kind === 'bld') drawBuilding(o.ref);
      else drawUnit(o.ref);
    }
  }

  // ---- Picking: screen point -> nearest building/tile ------------------------
  function pickAt(px, py) {
    // Test buildings front-to-back (reverse depth) using their top diamond.
    const ordered = buildings.slice().sort((a, b) => (b.c + b.r) - (a.c + a.r));
    for (const b of ordered) {
      const p = tileTopScreen(b.c, b.r);
      const sx = cam.x + p.x * cam.zoom;
      const sy = cam.y + p.y * cam.zoom - ELEV * b.h * cam.zoom;
      const w = TILE_W * cam.zoom, h = TILE_H * cam.zoom;
      if (Math.abs(px - sx) / (w / 2) + Math.abs(py - sy) / (h / 2) <= 1.1) {
        return b.label;
      }
    }
    // else report terrain under the point (inverse iso transform).
    const wx = (px - cam.x) / cam.zoom;
    const wy = (py - cam.y) / cam.zoom;
    const c = Math.round((wx / (TILE_W / 2) + wy / (TILE_H / 2)) / 2);
    const r = Math.round((wy / (TILE_H / 2) - wx / (TILE_W / 2)) / 2);
    if (c < 0 || c >= N || r < 0 || r >= N) return null;
    const names = { g: 'Scrubland', s: 'Desert sand', w: 'Oasis', r: 'Rocky ridge' };
    return names[terrainAt(c, r)];
  }

  let tipTimer = 0;
  function showTip(text) {
    if (!text) return;
    tip.textContent = text;
    tip.classList.add('show');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => tip.classList.remove('show'), 1800);
  }

  // ---- Gestures: pan (1 finger / mouse), pinch-zoom (2 fingers) ---------------
  const pointers = new Map();
  let panLast = null;          // last pointer pos while panning
  let pinch = null;            // { dist, cx, cy } at gesture start
  let downAt = null;           // for tap detection
  let moved = 0;

  function clientToCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = clientToCanvas(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      panLast = p; downAt = p; moved = 0;
    } else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinch = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
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
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      const target = clamp(pinch.zoom * (dist / pinch.dist), ZOOM_MIN, ZOOM_MAX);
      zoomAround(cx, cy, target);
      return;
    }

    if (panLast) {
      const dx = p.x - panLast.x, dy = p.y - panLast.y;
      cam.x += dx; cam.y += dy;
      moved += Math.abs(dx) + Math.abs(dy);
      panLast = p;
    }
  });

  function endPointer(e) {
    const wasTap = pointers.size === 1 && moved < 8 && downAt;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) {
      panLast = [...pointers.values()][0];
    } else if (pointers.size === 0) {
      if (wasTap) showTip(pickAt(downAt.x, downAt.y));
      panLast = null; downAt = null;
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  function zoomAround(cx, cy, target) {
    // keep the world point under (cx,cy) fixed as zoom changes
    const wx = (cx - cam.x) / cam.zoom;
    const wy = (cy - cam.y) / cam.zoom;
    cam.zoom = target;
    cam.x = cx - wx * cam.zoom;
    cam.y = cy - wy * cam.zoom;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // wheel zoom for desktop
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = clientToCanvas(e);
    const target = clamp(cam.zoom * (e.deltaY < 0 ? 1.12 : 0.89), ZOOM_MIN, ZOOM_MAX);
    zoomAround(p.x, p.y, target);
  }, { passive: false });

  // ---- Button wiring ---------------------------------------------------------
  function zoomStep(factor) {
    zoomAround(canvas.clientWidth / 2, canvas.clientHeight / 2,
               clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX));
  }
  document.getElementById('zin-btn').addEventListener('click', () => zoomStep(1.2));
  document.getElementById('zout-btn').addEventListener('click', () => zoomStep(1 / 1.2));
  document.getElementById('center-btn').addEventListener('click', () => centerOn(8, 8));
  document.getElementById('menu-btn').addEventListener('click', () => openMenu());

  function openMenu() {
    blurb.textContent = 'A castle in the sand. Drag to look around the holding, pinch to zoom, tap a building to inspect it.';
    overlay.dataset.state = 'title';
  }
  function closeMenu() { overlay.dataset.state = 'hidden'; }

  document.getElementById('play-btn').addEventListener('click', closeMenu);
  document.getElementById('how-btn').addEventListener('click', () => {
    blurb.textContent = 'Drag with one finger to pan across the holding. Pinch (or use − / +) to zoom. Tap the keep, towers, tents or farms to inspect them. The 🏰 button recenters on the keep.';
  });

  // Quit: post to parent when embedded, else navigate to the shell root.
  document.getElementById('quit-btn').addEventListener('click', () => {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (_) {}
    } else {
      location.href = '../../';
    }
  });

  // ---- Main loop -------------------------------------------------------------
  let now = 0, last = 0;
  function frame(ts) {
    now = ts;
    const dt = Math.min(0.05, (ts - last) / 1000 || 0);
    last = ts;
    // advance units along their paths
    for (const u of units) {
      u.t += u.spd * dt;
      while (u.t >= 1) { u.t -= 1; u.i = (u.i + 1) % u.path.length; }
    }
    render();
    requestAnimationFrame(frame);
  }

  // ---- Boot ------------------------------------------------------------------
  resize();
  centerOn(8, 8);
  window.addEventListener('resize', () => { resize(); });
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  requestAnimationFrame(frame);

  // Hide the inline loading splash once ready AND at least 3s have elapsed
  // (the gallery's mandatory loading-screen contract).
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
