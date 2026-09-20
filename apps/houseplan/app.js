/* House Wireframe.
 *
 * Deliberately almost nothing: a box per level, the vertices as dots,
 * barely-there glass, and the ground it is cut into. Every dimension
 * comes from window.HOUSE_PLAN, so the box grows into the real thing
 * one primitive at a time.
 *
 * Plan coordinates are (x, y) with y running south; three.js gets
 * (x, elevation, y) — plan y becomes world z throughout.
 */

const PLAN = window.HOUSE_PLAN;
const SLAB = PLAN.slab || 0.2;
const WALL = PLAN.wall || 0.3;
/* Everything that follows the ground across the front — slabs, walls,
   the ground grid over the driveway — is sampled at these intervals, so
   lines that should coincide do. */
const STEP = 0.5;
const TER = PLAN.terrain;
const e = PLAN.envelope;

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toFixed(2).replace(/\.?0+$/, '');

/* ── language ─────────────────────────────────────────── */

/* English is the source; German is looked up by the English string, so
   plan.js keeps its names and anything without an entry falls back. The
   choice is remembered on the device. */
const DE = {
  Settings: 'Einstellungen', Close: 'Schließen', Navigation: 'Navigation', Object: 'Objekt', Camera: 'Kamera',
  Language: 'Sprache',
  'Drag orbits the scene, pinch or wheel zooms, two fingers pan.': 'Ziehen kreist um die Szene, Kneifen oder Rad zoomt, zwei Finger verschieben.',
  'Drag turns the camera, pinch or wheel walks it, two fingers slide it.': 'Ziehen dreht die Kamera, Kneifen oder Rad bewegt sie vor und zurück, zwei Finger verschieben sie.',
  Fit: 'Einpassen', Faces: 'Flächen', Floors: 'Böden', Dots: 'Punkte', Ground: 'Gelände', Spin: 'Drehen', Defects: 'Mängel',
  east: 'Ost', up: 'oben', south: 'Süd', 'site falls': 'Gelände fällt',
  House: 'Haus', Cantilever: 'Auskragung', Driveway: 'Einfahrt', 'Retaining walls': 'Stützmauern', Road: 'Straße',
  Garage: 'Garage', 'Ground floor': 'Erdgeschoss', 'First floor': 'Obergeschoss',
  'Cantilever over the door': 'Auskragung über dem Tor', 'Apron, in front of the door': 'Vorplatz vor dem Tor',
  'Driveway, down to the road': 'Einfahrt hinunter zur Straße',
  'Garage wall, south': 'Garagenwand Süd', 'Garage wall, west': 'Garagenwand West', 'Garage wall, north': 'Garagenwand Nord',
  'Retaining wall': 'Stützmauer', 'Retaining wall, tapering out': 'Stützmauer, auslaufend',
  'Corner fillet, wall': 'Eckrundung, Mauer', 'Retaining wall, uphill side': 'Stützmauer bergseitig',
  'Entrance mouth, wall': 'Einfahrtstrichter, Mauer',
  run: 'Lauf', flare: 'Trichter', along: 'entlang', over: 'über', rise: 'Anstieg',
  Parcel: 'Parzelle', 'Parcel boundary, 705 m²': 'Parzellengrenze, 705 m²', 'Existing building': 'Bestandsgebäude',
  Relief: 'Relief',
};
let LANG = (() => {
  try { const v = localStorage.getItem('houseplan-lang'); if (v === 'de' || v === 'en') return v; } catch (err) { /* private mode */ }
  return (navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en';
})();
const t = (key) => (LANG === 'de' ? DE[key] ?? key : key);
/* A dimension label: its words translated, and a decimal comma. */
const tDim = (label) => {
  if (LANG !== 'de') return label;
  return label.replace(/\b(run|flare|along|over|rise)\b/g, (w) => DE[w]).replace(/(\d)\.(\d)/g, '$1,$2');
};

/* ── what the box is ──────────────────────────────────── */

/* The downhill face: which world axis the site falls along, and which
   way. '+X' means the ground is lowest at the x1 end. */
const FRONT = {
  axis: (TER?.front || '+Z').toUpperCase().includes('X') ? 'x' : 'z',
  sign: (TER?.front || '+Z').startsWith('-') ? -1 : 1,
};

/* The road's level across the front — the foot of the hill — from
   terrain.road, straight between its points and held beyond them. A
   profile level written as 'road' resolves to this at that position. */
const ROAD = TER?.road ? TER.road.slice().sort((a, b) => a[0] - b[0]) : null;
const ROAD_MIN = ROAD ? Math.min(...ROAD.map(([, y]) => y)) : (TER ? TER.profile[TER.profile.length - 1][1] : 0);
function roadLevel(across) {
  if (!ROAD) return ROAD_MIN;
  if (across <= ROAD[0][0]) return ROAD[0][1];
  for (let i = 1; i < ROAD.length; i++) {
    const [a0, y0] = ROAD[i - 1], [a1, y1] = ROAD[i];
    if (across <= a1) return y0 + ((y1 - y0) * (across - a0)) / (a1 - a0);
  }
  return ROAD[ROAD.length - 1][1];
}

/* One solid per level, stacked without gaps: a level owns the slab
   under it, so its underside meets the top of the level below. A level
   with `extendFront` is pushed out of the downhill face by that much. */
const VOLS = PLAN.levels.map((l) => {
  const out = l.extendFront || 0;
  const v = {
    id: l.id, name: l.name, group: l.group || 'house',
    x0: e.x0, x1: e.x1, z0: e.y0, z1: e.y1,
    y0: l.elevation - SLAB,
    y1: l.elevation + l.height,
  };
  if (out) {
    const lo = FRONT.axis === 'x' ? 'x0' : 'z0', hi = FRONT.axis === 'x' ? 'x1' : 'z1';
    if (FRONT.sign > 0) v[hi] += out; else v[lo] -= out;
  }
  return v;
});

for (const w of PLAN.works || []) VOLS.push({ ...w });

/* The camera frames everything except volumes that ask to be left out
   of it — a road that runs off the edge of the site would otherwise
   shrink the house to a speck. */
const FRAMED = VOLS.filter((v) => v.frame !== false);
const span = (key, fn) => fn(...FRAMED.flatMap((v) => [v[key], v[`${key}End`] ?? v[key]]).filter((n) => typeof n === 'number'));
const BOX = {
  x0: span('x0', Math.min), x1: span('x1', Math.max),
  z0: span('z0', Math.min), z1: span('z1', Math.max),
  y0: span('y0', Math.min), y1: span('y1', Math.max),
};
/* Volumes that ride the road or the ramp carry no number to span, so
   the road's low point stands in for their bottoms. The parcel and what
   already stands on it are the site, so they are framed too. */
if (TER) BOX.y0 = Math.min(BOX.y0, ROAD_MIN);
const OUTLINES = [PLAN.parcel, PLAN.existing].filter(Boolean);
for (const o of OUTLINES) for (const [x, y, z] of o.points) {
  BOX.x0 = Math.min(BOX.x0, x); BOX.x1 = Math.max(BOX.x1, x);
  BOX.z0 = Math.min(BOX.z0, z); BOX.z1 = Math.max(BOX.z1, z);
  BOX.y0 = Math.min(BOX.y0, y); BOX.y1 = Math.max(BOX.y1, y);
}
BOX.cx = (BOX.x0 + BOX.x1) / 2;
BOX.cy = (BOX.y0 + BOX.y1) / 2;
BOX.cz = (BOX.z0 + BOX.z1) / 2;
BOX.r = Math.hypot(BOX.x1 - BOX.x0, BOX.y1 - BOX.y0, BOX.z1 - BOX.z0) / 2;

/* Ground level at a point. Level under the whole envelope, then from
   the downhill face it follows terrain.profile: straight runs between
   its points, and a vertical step where two points share a distance.
   At a step the lower side wins, so a sample on the line lands at the
   foot of the wall, not the top. Inside terrain.cut's band across the
   front, the cut's own profile is used instead — that is the driveway
   dug into the slope in front of the garage, and only there. */
const FACE = !TER ? 0 : FRONT.axis === 'x'
  ? (FRONT.sign > 0 ? e.x1 : e.x0)
  : (FRONT.sign > 0 ? e.y1 : e.y0);
const PROFILE = TER ? [[0, TER.backLevel], ...TER.profile] : [];
const CUT = TER?.cut ? { ...TER.cut, profile: [[0, TER.backLevel], ...TER.cut.profile] } : null;

function sampleProfile(prof, d, across) {
  const lv = (y) => (y === 'road' ? roadLevel(across) : y);
  let i = 0;
  while (i + 1 < prof.length && prof[i + 1][0] <= d) i++;
  const [d0, y0] = prof[i];
  if (i + 1 >= prof.length || d <= d0) return lv(y0);
  const [d1, y1] = prof[i + 1];
  return lv(y0) + ((lv(y1) - lv(y0)) * (d - d0)) / (d1 - d0);
}

/* The natural hill, `d` metres out from the face at `across`. */
const natural = (d, across) => sampleProfile(PROFILE, d, across);

/* Where the outer retaining wall stands: the cut profile's first
   vertical step beyond the ramp's uphill edge (the step at the door
   does not count). Beyond it the cut is the road, whatever the ramp
   is doing. */
const WALL_D = (() => {
  if (!CUT) return Infinity;
  const dFrom = CUT.ramp?.dFrom ?? 0;
  const step = CUT.profile.find(([d], i) => i && d > dFrom && d === CUT.profile[i - 1][0]);
  return step ? step[0] : CUT.profile[CUT.profile.length - 1][0];
})();

/* Where the house ends across the front, on the ramp's side. In front
   of the house the apron's cut runs the full width whatever the ramp
   is doing; the hill only begins past this line. */
const HOUSE_EDGE = FRONT.axis === 'x' ? e.y1 : e.x1;

/* The quarter-round cut into the inside corner where the apron turns
   onto the ramp. The corner is where the ramp's uphill edge passes the
   house's corner; the circle's centre sits `r` in from it both ways,
   so the arc is tangent to the house's edge line and to the ramp's
   uphill edge. Everything here is in (along, across). */
const FILLET = (() => {
  const f = CUT?.fillet, r = CUT?.ramp;
  if (!f || !r) return null;
  const dFrom = r.dFrom ?? 0;
  const rad = f.r ?? dFrom;
  const corner = { along: FACE + FRONT.sign * dFrom, across: Math.max(r.from, HOUSE_EDGE) };
  return { r: rad, corner, centre: { along: corner.along - FRONT.sign * rad, across: corner.across + rad } };
})();

function inFillet(along, across) {
  if (!FILLET) return false;
  const { r, corner, centre } = FILLET;
  const da = (corner.along - along) * FRONT.sign;
  if (da < 0 || da > r || across < corner.across || across > centre.across) return false;
  return Math.hypot(along - centre.along, across - centre.across) >= r - 1e-9;
}

/* How far down the ramp a position across the front is, 0 at the top
   and 1 at the bottom — with the grade easing in and out over `ease`
   of the run at each end, so the floor curves into the flats rather
   than hinging. Between, the grade is constant and steeper by 1/(1-e)
   to make up the same drop. */
function rampT(across) {
  const r = CUT.ramp;
  const t = Math.min(1, Math.max(0, (across - r.from) / (r.to - r.from)));
  const e = Math.min(0.5, Math.max(0, r.ease || 0));
  if (!e) return t;
  const s = 1 / (1 - e);
  if (t < e) return (s * t * t) / (2 * e);
  if (t > 1 - e) return 1 - (s * (1 - t) * (1 - t)) / (2 * e);
  return s * (e / 2 + (t - e));
}

/* The entrance, over the property's last `flare` metres: the hill is
   cut back along a quarter-ellipse centred on the outer wall line at
   the property's end, one semi-axis the ramp's width and the other
   `flare` back along the road. The arc leaves the ramp's uphill edge
   tangentially, so the wall beside it stays at full height for a
   while, then sweeps out to meet the road's edge. Everything between
   the arc and the outer wall line is the driveway's floor. In
   (d, across), where d is metres out from the house face. */
const MOUTH = (() => {
  const m = CUT?.mouth, r = CUT?.ramp;
  if (!m || !r) return null;
  const dFrom = r.dFrom ?? 0;
  return { a: WALL_D - dFrom, b: m.flare, d0: WALL_D, dFrom, across0: CUT.to - m.flare };
})();

function inMouth(d, across) {
  if (!MOUTH) return false;
  const { a, b, d0, across0 } = MOUTH;
  const u = (across - across0) / b;
  if (u < 0 || u > 1 || d > d0) return false;
  const edge = d0 - a * Math.sqrt(Math.max(0, 1 - u * u));
  return d >= edge;
}

/* The driveway's surface at a position across the front: the apron's
   level up to ramp.from, the road's own surface from ramp.to on (the
   landing), and between them the eased grade from the one to the
   other. */
function rampLevel(across) {
  const r = CUT.ramp;
  const base = sampleProfile(CUT.profile, r.dFrom ?? 0, across);
  if (across <= r.from) return base;
  if (across >= r.to) return roadLevel(across);
  return base - (base - roadLevel(r.to)) * rampT(across);
}

/* The driveway's outline, station by station across the front from the
   apron's edge to the property's end: `edge(c)` is the cut line — the
   fillet's arc, then the straight run `dFrom` out, then the mouth's arc
   — and `edge(c, off)` the same line `off` metres into the hill, which is
   where a wall's far face goes. The stations are every STEP plus every
   bend of both arcs, and everything that follows the driveway (its slab,
   the walls beside it, the ground grid) is built on exactly these, so
   their lines coincide. */
const DRIVE = (() => {
  if (!CUT?.ramp) return null;
  const r = CUT.ramp, dFrom = r.dFrom ?? 0;
  const set = new Set();
  for (let a = r.from; a < CUT.to - 1e-6; a += STEP) set.add(+a.toFixed(6));
  set.add(CUT.to);
  set.add(r.to);
  if (FILLET) {
    set.add(FILLET.centre.across);
    for (let i = 0; i <= 12; i++) set.add(+(FILLET.centre.across - FILLET.r * Math.cos((i / 12) * (Math.PI / 2))).toFixed(6));
  }
  if (MOUTH) {
    set.add(MOUTH.across0);
    for (let i = 0; i <= 14; i++) set.add(+(MOUTH.across0 + MOUTH.b * Math.sin((i / 14) * (Math.PI / 2))).toFixed(6));
  }
  const stations = [...set].filter((c) => c >= r.from - 1e-9 && c <= CUT.to + 1e-9).sort((a, b) => a - b);
  /* The cut line's d at a station. */
  const edge = (c) => {
    if (FILLET && c < FILLET.centre.across) {
      const dc = dFrom - FILLET.r;
      return dc + Math.sqrt(Math.max(0, FILLET.r ** 2 - (c - FILLET.centre.across) ** 2));
    }
    if (MOUTH && c > MOUTH.across0) {
      const u = (c - MOUTH.across0) / MOUTH.b;
      return MOUTH.d0 - MOUTH.a * Math.sqrt(Math.max(0, 1 - u * u));
    }
    return dFrom;
  };
  /* The wall's far face for the cut point at a station: WALL into the
     hill along the line's normal — on an arc that is the same angle on
     the offset arc, so the point moves across as well as out, and the
     wall's top can be read at the ground it actually stands in. */
  const hill = (c) => {
    if (FILLET && c < FILLET.centre.across) {
      const { r: rad, centre } = FILLET;
      const dc = dFrom - rad;
      const cos = (centre.across - c) / rad, sin = (edge(c) - dc) / rad;
      return [dc + (rad - WALL) * sin, centre.across - (rad - WALL) * cos];
    }
    if (MOUTH && c > MOUTH.across0) {
      const { a, b, d0, across0 } = MOUTH;
      const sin = (c - across0) / b, cos = Math.sqrt(Math.max(0, 1 - sin * sin));
      return [d0 - (a + WALL) * cos, across0 + (b + WALL) * sin];
    }
    return [dFrom - WALL, c];
  };
  return { stations, edge, hill, outer: WALL_D, dFrom };
})();

function groundY(x, z) {
  if (!TER) return BOX.y0;
  const along = FRONT.axis === 'x' ? x : z;
  const across = FRONT.axis === 'x' ? z : x;
  const d = (along - FACE) * FRONT.sign;
  if (!CUT || across < CUT.from || across > CUT.to) return natural(d, across);
  const base = sampleProfile(CUT.profile, d, across);
  if (d < 0 || !CUT.ramp) return base;
  const r = CUT.ramp;
  if (across <= r.from || d >= WALL_D) return base;
  if (MOUTH && across >= MOUTH.across0) return inMouth(d, across) ? rampLevel(across) : natural(d, across);
  if (d < (r.dFrom ?? 0)) {
    if (across <= HOUSE_EDGE) return base;
    if (!inFillet(along, across)) return natural(d, across);
  }
  return rampLevel(across);
}

$('wf-name').textContent = PLAN.name;
function paintHeader() {
  const num = (n) => (LANG === 'de' ? fmt(n).replace('.', ',') : fmt(n));
  const top = Math.max(...PLAN.levels.map((l) => l.elevation + l.height));
  const foot = Math.min(...PLAN.levels.map((l) => l.elevation - SLAB));
  $('wf-dims').textContent = `${num(e.x1 - e.x0)} × ${num(e.y1 - e.y0)} × ${num(top - foot)} m`
    + (TER ? ` · ${t('site falls')} ${num(TER.backLevel - ROAD_MIN)} m` : '');
}
paintHeader();

/* ── scene ────────────────────────────────────────────── */

const state = { faces: true, floors: true, dots: true, grid: true, spin: false, mode: 'object' };

boot();

async function boot() {
  let THREE, OrbitControls;
  try {
    THREE = await import('three');
    ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
  } catch (err) {
    $('fail').hidden = false;
    hideLoader();
    return;
  }

  const host = $('canvas-host');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 1);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.rotateSpeed = 0.8;
  controls.minDistance = 4;
  controls.maxDistance = 160;
  controls.autoRotateSpeed = 0.6;
  controls.target.set(BOX.cx, BOX.cy, BOX.cz);

  const segments = (pts, mat) => new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), mat,
  );

  /* ── one object per built thing ─────────────────────── */

  /* Every built thing — a level, a slab, a wall — is its own node in
     the scene, named by its id and coloured by its group, so a part
     can be pointed at, hidden with the rest of its group, and told
     apart from what it meets. Inside a node the uprights, the plates
     (rings), the glass and the dots are separate children tagged with
     a `layer`, which is what the Faces / Floors / Dots toggles flip. */
  const GROUPS = PLAN.groups || {};
  const WHITE = new THREE.Color(0xffffff);
  const parts = new THREE.Group();
  const objects = [];
  function makeObject({ id, name, group }) {
    const col = new THREE.Color(GROUPS[group]?.color || '#8fd8ff');
    const node = new THREE.Group();
    node.name = id;
    node.userData = { id, name, group };
    const o = {
      id, name, group, node, col, dotPos: [],
      glass: new THREE.MeshBasicMaterial({
        color: col.clone().lerp(WHITE, 0.35), transparent: true, opacity: 0.05,
        side: THREE.DoubleSide, depthWrite: false,
      }),
      line: (opacity) => new THREE.LineBasicMaterial({ color: col, transparent: true, opacity }),
    };
    objects.push(o);
    parts.add(node);
    return o;
  }
  const tagged = (obj, layer) => { obj.userData.layer = layer; return obj; };

  /* Every solid is a prism over a footprint: a bottom ring and a top
     ring of [x, y, z], same length, same order. Uprights join them,
     the rings are the plates, and the glass is the caps (triangulated,
     so a footprint may be concave — the fillet is) plus the sides. */
  function addVolume(o, bottom, top, { dots: withDots = true, uprightAt = null, strip = false, caps = true } = {}) {
    const n = bottom.length;
    const pos = [...bottom.flat(), ...top.flat()];
    const idx = [];
    /* A `strip` ring is two chains of equal length, the second reversed,
       and its caps are the quads between matching stations — so a
       surface that bends along the chains is drawn band by band, not
       as whatever triangles happen to span the outline. */
    const tris = [];
    if (!caps) {
      /* sides only — an outline drawn as a ribbon, with nothing across */
    } else if (strip) {
      const m = n / 2;
      for (let j = 0; j < m - 1; j++) tris.push([j, j + 1, n - 2 - j], [j, n - 2 - j, n - 1 - j]);
    } else {
      tris.push(...THREE.ShapeUtils.triangulateShape(bottom.map(([x, , z]) => new THREE.Vector2(x, z)), []));
    }
    for (const [a, b, c] of tris) idx.push(a, b, c, a + n, b + n, c + n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      idx.push(i, j, j + n, i, j + n, i + n);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    o.node.add(tagged(new THREE.Mesh(geo, o.glass), 'faces'));

    const uprights = [];
    for (let i = 0; i < n; i++) if (!uprightAt || uprightAt.includes(i)) uprights.push(...bottom[i], ...top[i]);
    o.node.add(tagged(segments(uprights, o.line(0.95)), 'edges'));

    const rings = [];
    for (const ring of [bottom, top]) {
      for (let i = 0; i < n; i++) rings.push(...ring[i], ...ring[(i + 1) % n]);
    }
    o.node.add(tagged(segments(rings, o.line(0.6)), 'floors'));

    if (withDots) for (const ring of [bottom, top]) for (const p of ring) o.dotPos.push(...p);
  }

  /* A box volume's z1 end may sit lower than its z0 end (y0End / y1End),
     so every corner carries its own bottom and top. A bottom or top
     given as { floor } / { road } / { ground } follows that surface, so
     the volume is walked across the front in half-metre steps and drawn
     as a bent prism — uprights and dots only at its four real corners.
     `ground` is the natural hill at the volume's house-side face, one
     height across its thickness. */
  const followsGround = (v) => typeof v.y0 === 'object' || typeof v.y1 === 'object';
  const yAt = (spec, across, dFace) => {
    if (typeof spec === 'number') return spec;
    if ('road' in spec) return roadLevel(across) + (spec.road || 0);
    if ('ground' in spec) return natural(dFace, across) + (spec.ground || 0);
    return rampLevel(across) + (spec.floor || 0);
  };
  /* The stations a walked volume is sampled at: every STEP from its
     start, then its end. The ground grid uses the same, so a slab's
     edge and the grid line under it are the same polyline. */
  const stationsBetween = (a0, a1) => {
    const s = [];
    for (let a = a0; a < a1 - 1e-6; a += STEP) s.push(a);
    s.push(a1);
    return s;
  };
  /* A wall whose top would pass under its foot ends where they meet:
     the last station is moved to that crossing, found by bisection. */
  const runOut = (steps, height) => {
    let last = steps.length - 1;
    while (last > 0 && height(steps[last]) < 0) last--;
    if (last === steps.length - 1) return steps;
    let lo = steps[last], hi = steps[last + 1];
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (height(mid) < 0) hi = mid; else lo = mid;
    }
    return [...steps.slice(0, last + 1), lo];
  };
  /* ── dimensions ──────────────────────────────────────── */

  /* Every object carries its own list of dimensions — `{ a, b, label }`,
     a measured line between two world points with its label (placed
     `at` that fraction along it, halfway unless said) — shown on it when
     it is tapped. They are written per kind of object, because
     a bent slab and a box do not have the same three numbers. */
  const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const plan2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  const mLabel = (n) => `${fmt(n)} m`;
  const boxDims = (v) => [
    { a: [v.x0, v.y1, v.z1], b: [v.x1, v.y1, v.z1], label: mLabel(v.x1 - v.x0) },
    { a: [v.x1, v.y1, v.z0], b: [v.x1, v.y1, v.z1], label: mLabel(v.z1 - v.z0) },
    { a: [v.x1, v.y0, v.z1], b: [v.x1, v.y1, v.z1], label: `h ${mLabel(v.y1 - v.y0)}` },
  ];
  /* A walked volume: thickness and length read off its top, and the
     height it stands at each end — the second may differ from the first
     or be nothing at all, which is the point of showing both. */
  const walkedDims = (bottom, top, n) => {
    const dims = [
      { a: top[0], b: top[2 * n - 1], label: mLabel(dist3(top[0], top[2 * n - 1])) },
      { a: top[0], b: top[n - 1], label: mLabel(plan2(top[0], top[n - 1])), at: 0.6 },
    ];
    for (const i of [0, n - 1]) {
      const h = top[i][1] - bottom[i][1];
      if (h > 0.05) dims.push({ a: bottom[i], b: top[i], label: `h ${mLabel(h)}` });
    }
    return dims;
  };

  for (const v of VOLS) {
    const o = makeObject(v);
    if (followsGround(v) && TER) {
      const [a0, a1] = FRONT.axis === 'x' ? [v.z0, v.z1] : [v.x0, v.x1];
      const lo = FRONT.axis === 'x' ? v.x0 : v.z0, hi = FRONT.axis === 'x' ? v.x1 : v.z1;
      const dFace = ((FRONT.sign > 0 ? lo : hi) - FACE) * FRONT.sign;
      const steps = runOut(stationsBetween(a0, a1), (a) => yAt(v.y1, a, dFace) - yAt(v.y0, a, dFace));
      const n = steps.length;
      const side = (fixed, list) => list.map((a) => (FRONT.axis === 'x' ? [fixed, a] : [a, fixed]));
      const ring = [...side(lo, steps), ...side(hi, steps.slice().reverse())];
      const acrossOf = ([x, z]) => (FRONT.axis === 'x' ? z : x);
      const cornersAt = [0, n - 1, n, 2 * n - 1];
      const bottom = ring.map(([x, z]) => [x, yAt(v.y0, acrossOf([x, z]), dFace), z]);
      const top = ring.map(([x, z]) => [x, yAt(v.y1, acrossOf([x, z]), dFace), z]);
      addVolume(o, bottom, top, { dots: false, uprightAt: cornersAt });
      for (const i of cornersAt) o.dotPos.push(...bottom[i], ...top[i]);
      o.dims = walkedDims(bottom, top, n);
      continue;
    }
    const corners = [[v.x0, v.z0], [v.x1, v.z0], [v.x1, v.z1], [v.x0, v.z1]];
    addVolume(
      o,
      corners.map(([x, z]) => [x, z === v.z1 ? v.y0End ?? v.y0 : v.y0, z]),
      corners.map(([x, z]) => [x, z === v.z1 ? v.y1End ?? v.y1 : v.y1, z]),
    );
    o.dims = boxDims(v);
  }

  /* ── the driveway, derived ──────────────────────────── */

  /* One slab from the apron's edge to the road, built station by
     station on DRIVE: its outer edge along the retaining wall, its inner
     edge the cut line — the fillet's arc round from the house's corner,
     the straight run, the mouth's arc out to the road. Each band between
     two stations is drawn as its own quad, so the slab bends exactly
     with the grade and the road under it. The uphill wall is the same
     line in three pieces — fillet, straight run, mouth — each a
     WALL-thick band on the hill side, its foot at the slab's underside
     and its top the natural ground read at the hill-side face, so it is
     level across its thickness. */
  const toXZ = (along, across) => (FRONT.axis === 'x' ? [along, across] : [across, along]);
  const atD = (d, across) => toXZ(FACE + FRONT.sign * d, across);
  const pt = (xz, y) => [xz[0], y, xz[1]];

  if (DRIVE) {
    const { stations, edge, hill, outer } = DRIVE;
    const m = stations.length;
    const ring = [...stations.map((c) => [outer, c]), ...stations.slice().reverse().map((c) => [edge(c), c])];
    const at = (c) => stations.indexOf(c);
    const corners = [0, m - 1, 2 * m - 1];
    if (FILLET) corners.push(2 * m - 1 - at(FILLET.centre.across));
    if (MOUTH) corners.push(2 * m - 1 - at(MOUTH.across0));
    const o = makeObject({ id: 'driveway-ramp', name: 'Driveway, down to the road', group: 'drive' });
    const bottom = ring.map(([d, c]) => pt(atD(d, c), rampLevel(c) - SLAB));
    const top = ring.map(([d, c]) => pt(atD(d, c), rampLevel(c)));
    addVolume(o, bottom, top, { dots: false, uprightAt: corners, strip: true });
    for (const i of corners) o.dotPos.push(...bottom[i], ...top[i]);

    /* The slab's own numbers: its run along the outer edge, its width
       across the straight, the grade from the apron to where it meets
       the road, the slab's depth, and the two arcs' sizes. */
    {
      const r = CUT.ramp;
      const straightMid = stations.reduce((best, c) => {
        const target = ((FILLET ? FILLET.centre.across : r.from) + (MOUTH ? MOUTH.across0 : CUT.to)) / 2;
        return Math.abs(c - target) < Math.abs(best - target) ? c : best;
      });
      const outerAt = (c) => pt(atD(outer, c), rampLevel(c));
      const innerAt = (c) => pt(atD(edge(c), c), rampLevel(c));
      const drop = rampLevel(r.from) - rampLevel(r.to);
      o.dims = [
        { a: outerAt(r.from), b: outerAt(CUT.to), label: `run ${mLabel(CUT.to - r.from)}`, at: 0.9 },
        { a: innerAt(straightMid), b: outerAt(straightMid), label: mLabel(outer - edge(straightMid)), at: 0.35 },
        { a: outerAt(r.from), b: outerAt(r.to), label: `↓ ${mLabel(drop)} over ${mLabel(r.to - r.from)} · ${Math.round((drop / (r.to - r.from)) * 100)} %`, at: 0.3 },
        { a: bottom[0], b: top[0], label: mLabel(SLAB) },
      ];
      if (FILLET) {
        const { centre, r: rad } = FILLET;
        const th = Math.PI / 4;
        const c = centre.across - rad * Math.cos(th);
        o.dims.push({ a: pt(atD(r.dFrom - rad, centre.across), rampLevel(c)), b: innerAt(stations.reduce((b2, s) => (Math.abs(s - c) < Math.abs(b2 - c) ? s : b2))), label: `r ${mLabel(rad)}` });
      }
      if (MOUTH) o.dims.push({ a: innerAt(MOUTH.across0), b: innerAt(CUT.to), label: `flare ${mLabel(MOUTH.b)}`, at: 0.3 });
    }

    /* The wall, in its three pieces, over the stations each one spans. */
    const pieces = [];
    const arcEnd = FILLET ? FILLET.centre.across : null;
    const mouthStart = MOUTH ? MOUTH.across0 : null;
    if (FILLET) pieces.push(['fillet-wall', 'Corner fillet, wall', (c) => c <= arcEnd]);
    pieces.push(['ramp-wall', 'Retaining wall, uphill side', (c) => (arcEnd == null || c >= arcEnd) && (mouthStart == null || c <= mouthStart)]);
    if (MOUTH) pieces.push(['mouth-wall', 'Entrance mouth, wall', (c) => c >= mouthStart]);
    for (const [id, name, within] of pieces) {
      const st = stations.filter(within);
      if (st.length < 2) continue;
      const n = st.length;
      const cut = st.map((c) => [edge(c), c]);
      const far = st.map(hill);
      const wallRing = [...cut, ...far.slice().reverse()];
      const topAt = (k) => { const [d, c] = far[k < n ? k : 2 * n - 1 - k]; return natural(d, c); };
      const wo = makeObject({ id, name, group: 'wall' });
      const wb = wallRing.map(([d, c]) => pt(atD(d, c), rampLevel(c) - SLAB));
      const wt = wallRing.map(([d, c], k) => pt(atD(d, c), topAt(k)));
      addVolume(wo, wb, wt, { dots: false, uprightAt: [0, n - 1, n, 2 * n - 1], strip: true });
      /* Thickness at its start, its length along the cut edge (the
         arc's, not the chord's), and its height at each end. */
      let along = 0;
      for (let k = 1; k < n; k++) along += Math.hypot(wt[k][0] - wt[k - 1][0], wt[k][2] - wt[k - 1][2]);
      wo.dims = [
        { a: wt[0], b: wt[2 * n - 1], label: mLabel(WALL) },
        { a: wt[0], b: wt[n - 1], label: `${mLabel(along)} along`, at: 0.65 },
        { a: wb[0], b: wt[0], label: `h ${mLabel(wt[0][1] - wb[0][1])}` },
        { a: wb[n - 1], b: wt[n - 1], label: `h ${mLabel(wt[n - 1][1] - wb[n - 1][1])}` },
      ];
    }
  }

  /* ── the parcel, and what already stands on it ──────── */

  /* An outline is a closed loop of surveyed points at their real
     heights, drawn as a knee-high ribbon along the ground (sides only,
     so it neither roofs the parcel nor cuts through the house) with a
     dot at every vertex. Its dimensions are the `sides` it names,
     measured along the loop, and its rise from lowest to highest
     corner. */
  for (const spec of OUTLINES) {
    const o = makeObject(spec);
    const pts = spec.points;
    const bottom = pts.map(([x, y, z]) => [x, y, z]);
    const top = pts.map(([x, y, z]) => [x, y + 0.5, z]);
    addVolume(o, bottom, top, { dots: true, uprightAt: [], caps: false });
    o.dims = [];
    const n = pts.length;
    for (const [i, j] of spec.sides || []) {
      let along = 0;
      for (let k = i; k !== j; k = (k + 1) % n) along += dist3(pts[k], pts[(k + 1) % n]);
      o.dims.push({ a: top[i], b: top[j], label: `${mLabel(along)} along` });
    }
    let lo = 0, hi = 0;
    pts.forEach((p, k) => { if (p[1] < pts[lo][1]) lo = k; if (p[1] > pts[hi][1]) hi = k; });
    if (hi !== lo) o.dims.push({ a: pts[lo], b: [pts[lo][0], pts[hi][1], pts[lo][2]], label: `rise ${mLabel(pts[hi][1] - pts[lo][1])}` });
  }

  /* ── the relief: the surveyed ground as dots ────────── */

  /* Every surveyed point, tinted by height from the group's colour at
     the bottom of the sample to near white at the top, so the lie of
     the land reads at a glance. Not framed, not tappable — it is the
     backdrop the model sits in. */
  if (window.HOUSE_RELIEF?.points?.length) {
    const R = window.HOUSE_RELIEF;
    const o = makeObject({ id: 'relief', name: R.name || 'Relief', group: 'relief' });
    const pts = R.points;
    let lo = Infinity, hi = -Infinity;
    for (let i = 1; i < pts.length; i += 3) { lo = Math.min(lo, pts[i]); hi = Math.max(hi, pts[i]); }
    const colors = new Float32Array(pts.length);
    const c = new THREE.Color();
    for (let i = 0; i < pts.length; i += 3) {
      c.copy(o.col).lerp(WHITE, 0.15 + 0.7 * ((pts[i + 1] - lo) / (hi - lo || 1)));
      colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    o.node.add(tagged(new THREE.Points(geo, new THREE.PointsMaterial({
      size: 3.5, sizeAttenuation: false, vertexColors: true, map: dotTexture(THREE),
      transparent: true, opacity: 0.85, alphaTest: 0.35, depthWrite: false,
    })), 'relief'));
  }

  /* The dots ride with their object, a shade lighter than its lines. */
  const dotMap = dotTexture(THREE);
  for (const o of objects) {
    if (!o.dotPos.length) continue;
    o.node.add(tagged(new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(o.dotPos, 3)),
      new THREE.PointsMaterial({
        color: o.col.clone().lerp(WHITE, 0.55), size: 7, sizeAttenuation: false,
        map: dotMap, transparent: true, alphaTest: 0.35, depthWrite: false,
      }),
    ), 'dots'));
  }
  scene.add(parts);

  const setLayer = (layer, on) => parts.traverse((n) => { if (n.userData.layer === layer) n.visible = on; });

  /* The legend: one chip per group that has something in it, in the
     group's colour; tap to hide or show the whole group. */
  const legend = $('legend');
  const hidden = new Set();
  for (const [key, g] of Object.entries(GROUPS)) {
    if (!objects.some((o) => o.group === key)) continue;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.style.setProperty('--c', g.color);
    chip.dataset.name = g.name;
    chip.innerHTML = `<i></i>${t(g.name)}`;
    chip.addEventListener('click', () => {
      if (hidden.has(key)) hidden.delete(key); else hidden.add(key);
      chip.classList.toggle('is-off', hidden.has(key));
      for (const o of objects) if (o.group === key) o.node.visible = !hidden.has(key);
    });
    legend.appendChild(chip);
  }

  /* ── the site ───────────────────────────────────────── */

  /* A grid of lines laid on groundY(), so the slope is something you
     can read rather than something you have to be told about. */
  const ground = new THREE.Group();
  /* The grid reaches a little past everything framed, the parcel
     included. */
  const PAD = 8;
  const xs = [], zs = [];
  for (let x = Math.floor(BOX.x0 - PAD); x <= BOX.x1 + PAD; x += 1) xs.push(x);
  for (let z = Math.floor(BOX.z0 - PAD); z <= BOX.z1 + PAD; z += 1) zs.push(z);
  /* Sample every bend of the profiles too, or the shoulders get rounded
     off — and a hair before each step, so a drop is drawn as a wall.
     The cut's edges across the front get the same treatment. */
  if (TER) {
    const along = FRONT.axis === 'x' ? xs : zs;
    const across = FRONT.axis === 'x' ? zs : xs;
    for (const prof of [PROFILE, CUT ? CUT.profile : []]) {
      prof.forEach(([d], i) => {
        const p = FACE + FRONT.sign * d;
        if (i && prof[i - 1][0] === d) along.push(p - FRONT.sign * 0.001);
        if (!along.includes(p)) along.push(p);
      });
    }
    if (CUT) across.push(CUT.from - 0.001, CUT.from, CUT.to, CUT.to + 0.001);
    if (CUT?.ramp) {
      /* Over the driveway the grid runs at the slab's own stations, so
         its lines and the slab's edges are one polyline. */
      for (const a of DRIVE.stations) if (!across.includes(a)) across.push(a);
      const p = FACE + FRONT.sign * (CUT.ramp.dFrom ?? 0);
      along.push(p - FRONT.sign * 0.001, p);
    }
    if (ROAD) for (const [a] of ROAD) if (!across.includes(a)) across.push(a);
  }
  xs.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);

  /* Every line is walked sample by sample in both directions, so the
     grid bends with the ground whichever axis the fall is on. */
  const gridPts = [];
  for (const z of zs) {
    for (let i = 0; i < xs.length - 1; i++) {
      gridPts.push(xs[i], groundY(xs[i], z), z, xs[i + 1], groundY(xs[i + 1], z), z);
    }
  }
  for (const x of xs) {
    for (let i = 0; i < zs.length - 1; i++) {
      gridPts.push(x, groundY(x, zs[i]), zs[i], x, groundY(x, zs[i + 1]), zs[i + 1]);
    }
  }
  ground.add(segments(gridPts, new THREE.LineBasicMaterial({
    color: 0x2a4450, transparent: true, opacity: 0.55,
  })));
  scene.add(ground);

  /* ── axis gizmo ─────────────────────────────────────── */

  /* Drawn as a second pass into a square of the same canvas. It holds
     no camera of its own beyond a fixed ortho view — the arms take the
     inverse of the main camera's rotation, so they read as the world
     axes seen from wherever you are standing. */
  const AXES = [
    { label: 'X', dir: [1, 0, 0], color: 0xff6b6b },
    { label: null, dir: [-1, 0, 0], color: 0xff6b6b },
    { label: 'Y', dir: [0, 1, 0], color: 0x7ce89a },
    { label: null, dir: [0, -1, 0], color: 0x7ce89a },
    { label: 'Z', dir: [0, 0, 1], color: 0x6ba8ff },
    { label: null, dir: [0, 0, -1], color: 0x6ba8ff },
  ];

  const gizmoScene = new THREE.Scene();
  const gizmoCam = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 10);
  gizmoCam.position.set(0, 0, 4);
  const gizmoRoot = new THREE.Group();
  gizmoScene.add(gizmoRoot);

  const tips = [];
  for (const ax of AXES) {
    const v = new THREE.Vector3(...ax.dir);
    if (ax.label) {
      gizmoRoot.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), v.clone().multiplyScalar(0.82)]),
        new THREE.LineBasicMaterial({ color: ax.color, transparent: true, opacity: 0.9 }),
      ));
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tipTexture(THREE, ax.color, ax.label),
      transparent: true, alphaTest: 0.4,
    }));
    sprite.position.copy(v);
    sprite.scale.setScalar(ax.label ? 0.62 : 0.4);
    sprite.userData.dir = ax.dir;
    gizmoRoot.add(sprite);
    tips.push(sprite);
  }

  /* ── chrome ─────────────────────────────────────────── */

  const toggle = (id, key, apply) => {
    const btn = $(id);
    btn.addEventListener('click', () => {
      state[key] = !state[key];
      btn.classList.toggle('is-on', state[key]);
      apply(state[key]);
    });
    apply(state[key]);
    btn.classList.toggle('is-on', state[key]);
  };
  toggle('t-faces', 'faces', (v) => setLayer('faces', v));
  toggle('t-floors', 'floors', (v) => setLayer('floors', v));
  toggle('t-dots', 'dots', (v) => setLayer('dots', v));
  toggle('t-grid', 'grid', (v) => { ground.visible = v; });
  toggle('t-spin', 'spin', (v) => { controls.autoRotate = v; });

  /* ── tap an object for its dimensions ───────────────── */

  /* A tap (not a drag) is cast against every visible object's glass;
     the nearest hit is selected: its lines brighten and its dimensions
     are drawn on it. Tap it again, or empty space, to clear. The
     dimension lines ignore depth so they read through the glass. */
  const dimGroup = new THREE.Group();
  scene.add(dimGroup);
  const labelGeo = new THREE.PlaneGeometry(1, 1);
  const labels = [];
  const dimLineMat = new THREE.LineBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.95, depthTest: false });
  const dimDotMat = new THREE.PointsMaterial({
    color: 0xfff3b0, size: 6, sizeAttenuation: false, map: dotMap,
    transparent: true, alphaTest: 0.35, depthTest: false, depthWrite: false,
  });
  const raycaster = new THREE.Raycaster();
  let selected = null;

  function paintSelection(o, on) {
    o.node.traverse((n) => {
      const layer = n.userData.layer;
      if (layer === 'edges' || layer === 'floors') {
        n.material.color.copy(on ? o.col.clone().lerp(WHITE, 0.6) : o.col);
        n.material.opacity = on ? 1 : (layer === 'edges' ? 0.95 : 0.6);
      } else if (layer === 'faces') {
        n.material.color.copy(o.col.clone().lerp(WHITE, on ? 0.2 : 0.35));
        n.material.opacity = on ? 0.22 : 0.05;
      } else if (layer === 'dots') {
        n.material.color.copy(on ? WHITE : o.col.clone().lerp(WHITE, 0.55));
      }
    });
  }

  function select(o) {
    if (selected) paintSelection(selected, false);
    while (dimGroup.children.length) {
      const c = dimGroup.children.pop();
      if (c.isMesh) { c.material.map.dispose(); c.material.dispose(); } else c.geometry.dispose();
    }
    labels.length = 0;
    selected = o && o !== selected ? o : null;
    $('wf-sel').textContent = selected ? t(selected.name) : '';
    if (!selected) return;
    paintSelection(selected, true);
    for (const d of selected.dims || []) {
      dimGroup.add(segments([...d.a, ...d.b], dimLineMat));
      dimGroup.add(new THREE.Points(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([...d.a, ...d.b], 3)),
        dimDotMat,
      ));
      /* The label lies along its line, in metres, sized to fit inside
         it — small on a small thing, so you zoom in to read it, like
         letters on a grain of rice. It turns about the line to face
         you (see orientLabels), never off it. */
      const tex = labelTexture(THREE, tDim(d.label));
      const aspect = tex.image.width / tex.image.height;
      const len = dist3(d.a, d.b);
      const h = Math.max(0.04, Math.min(0.35, Math.max(0.06, len * 0.05), (0.85 * len) / aspect));
      const label = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      }));
      label.scale.set(h * aspect, h, 1);
      const t = d.at ?? 0.5;
      label.position.set(d.a[0] + (d.b[0] - d.a[0]) * t, d.a[1] + (d.b[1] - d.a[1]) * t, d.a[2] + (d.b[2] - d.a[2]) * t);
      label.renderOrder = 10;
      label.userData.dim = d;
      dimGroup.add(label);
      labels.push(label);
    }
  }

  /* Each label keeps its X along its line and rotates about it to face
     the camera, flipped so the text reads left to right (or bottom to
     top on an upright line) from wherever you are. */
  const camR = new THREE.Vector3(), camU = new THREE.Vector3(), lx = new THREE.Vector3(), ly = new THREE.Vector3(), lz = new THREE.Vector3(), basis = new THREE.Matrix4();
  function orientLabels() {
    if (!labels.length) return;
    camR.set(1, 0, 0).applyQuaternion(camera.quaternion);
    camU.set(0, 1, 0).applyQuaternion(camera.quaternion);
    for (const m of labels) {
      const { a, b } = m.userData.dim;
      lx.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      const along = lx.dot(camR);
      if (along < -1e-3 || (Math.abs(along) <= 1e-3 && lx.dot(camU) < 0)) lx.negate();
      lz.copy(camera.position).sub(m.position);
      lz.addScaledVector(lx, -lz.dot(lx));
      if (lz.lengthSq() < 1e-9) continue;
      lz.normalize();
      ly.crossVectors(lz, lx);
      m.quaternion.setFromRotationMatrix(basis.makeBasis(lx, ly, lz));
    }
  }

  const glassMeshes = () => {
    const glass = [];
    for (const o of objects) if (o.node.visible) o.node.traverse((n) => { if (n.userData.layer === 'faces') { n.userData.owner = o; glass.push(n); } });
    return glass;
  };

  /* Pointers currently down on the canvas, kept by the camera-mode
     handlers below; a tap that overlaps another finger is no tap. */
  const flyPointers = new Map();
  const tap = { x: 0, y: 0, t: 0, id: -1 };
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    if (flyPointers.size) { tap.id = -1; return; }
    tap.x = ev.clientX; tap.y = ev.clientY; tap.t = performance.now(); tap.id = ev.pointerId;
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (ev.pointerId !== tap.id) return;
    if (Math.hypot(ev.clientX - tap.x, ev.clientY - tap.y) > 8 || performance.now() - tap.t > 500) return;
    const r = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(
      ((ev.clientX - r.left) / r.width) * 2 - 1,
      -(((ev.clientY - r.top) / r.height) * 2 - 1),
    ), camera);
    const hit = raycaster.intersectObjects(glassMeshes(), false)[0];
    select(hit ? hit.object.userData.owner : null);
  });

  /* ── two ways to move ───────────────────────────────── */

  /* Object: the scene stays put and the camera goes round it — drag
     orbits, pinch or wheel moves in and out, two fingers pan (that is
     OrbitControls). Camera: you are the camera — drag turns it in place
     like turning your head, pinch or wheel walks it forward and back
     along where it looks, two fingers (or a right-button or shift drag)
     slide it sideways and up. Switching back to Object re-anchors the
     orbit on whatever the camera is looking at. */
  const LOOK = 0.0045, TRUCK = 0.02, WHEEL = 0.012, PINCH = 0.03;
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const camR2 = new THREE.Vector3(), camU2 = new THREE.Vector3(), camF = new THREE.Vector3();
  const look = (dx, dy) => {
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    euler.y -= dx * LOOK;
    euler.x = Math.max(-1.55, Math.min(1.55, euler.x - dy * LOOK));
    euler.z = 0;
    camera.quaternion.setFromEuler(euler);
  };
  const truck = (dx, dy) => {
    camR2.set(1, 0, 0).applyQuaternion(camera.quaternion);
    camU2.set(0, 1, 0).applyQuaternion(camera.quaternion);
    camera.position.addScaledVector(camR2, -dx * TRUCK).addScaledVector(camU2, dy * TRUCK);
  };
  const dolly = (m) => {
    camF.set(0, 0, -1).applyQuaternion(camera.quaternion);
    camera.position.addScaledVector(camF, m);
  };
  let pinchDist = 0;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (ev) => {
    flyPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (flyPointers.size === 2) {
      const [a, b] = [...flyPointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  el.addEventListener('pointermove', (ev) => {
    const p = flyPointers.get(ev.pointerId);
    if (!p) return;
    const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
    p.x = ev.clientX; p.y = ev.clientY;
    if (state.mode !== 'camera') return;
    if (flyPointers.size === 1) {
      if (ev.pointerType === 'mouse' && !(ev.buttons & 1)) { if (ev.buttons & 6) truck(dx, dy); return; }
      if (ev.shiftKey) truck(dx, dy); else look(dx, dy);
    } else if (flyPointers.size === 2) {
      const [a, b] = [...flyPointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      dolly((d - pinchDist) * PINCH);
      pinchDist = d;
      truck(dx / 2, dy / 2);
    }
  });
  const endPointer = (ev) => { flyPointers.delete(ev.pointerId); };
  el.addEventListener('pointerup', endPointer);
  el.addEventListener('pointercancel', endPointer);
  el.addEventListener('wheel', (ev) => {
    if (state.mode !== 'camera') return;
    ev.preventDefault();
    dolly(-ev.deltaY * WHEEL);
  }, { passive: false });
  el.addEventListener('contextmenu', (ev) => ev.preventDefault());

  function setMode(mode) {
    state.mode = mode;
    if (mode === 'object') {
      camF.set(0, 0, -1).applyQuaternion(camera.quaternion);
      raycaster.set(camera.position, camF);
      const hit = raycaster.intersectObjects(glassMeshes(), false)[0];
      controls.target.copy(camera.position).addScaledVector(camF, hit ? hit.distance : 12);
      camera.up.set(0, 1, 0);
      controls.enabled = true;
      controls.update();
    } else {
      if (state.spin) $('t-spin').click();
      controls.enabled = false;
    }
    for (const b of document.querySelectorAll('#seg-mode .seg-btn')) b.classList.toggle('is-on', b.dataset.mode === mode);
    $('mode-hint').textContent = t(mode === 'object'
      ? 'Drag orbits the scene, pinch or wheel zooms, two fingers pan.'
      : 'Drag turns the camera, pinch or wheel walks it, two fingers slide it.');
  }
  for (const b of document.querySelectorAll('#seg-mode .seg-btn')) b.addEventListener('click', () => setMode(b.dataset.mode));

  /* ── settings sheet and language ────────────────────── */

  const sheet = $('settings');
  $('settings-open').addEventListener('click', () => { sheet.hidden = false; });
  $('settings-close').addEventListener('click', () => { sheet.hidden = true; });
  $('settings-backdrop').addEventListener('click', () => { sheet.hidden = true; });

  /* Everything with a data-i18n key, the header, the legend, the axis
     key, the selection and its labels are repainted in the language. */
  function applyLang() {
    document.documentElement.lang = LANG;
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    $('axis-key').innerHTML = `<b class="ax-x">X</b> ${t('east')} · <b class="ax-y">Y</b> ${t('up')} · <b class="ax-z">Z</b> ${t('south')}`;
    paintHeader();
    for (const chip of legend.children) chip.innerHTML = `<i></i>${t(chip.dataset.name)}`;
    for (const b of document.querySelectorAll('#seg-lang .seg-btn')) b.classList.toggle('is-on', b.dataset.lang === LANG);
    setMode(state.mode);
    if (selected) { const o = selected; select(null); select(o); }
  }
  for (const b of document.querySelectorAll('#seg-lang .seg-btn')) b.addEventListener('click', () => {
    LANG = b.dataset.lang;
    try { localStorage.setItem('houseplan-lang', LANG); } catch (err) { /* private mode */ }
    applyLang();
  });
  applyLang();

  function fit() {
    const dist = (BOX.r / Math.sin((camera.fov * Math.PI / 180) / 2)) * 1.25;
    const dir = new THREE.Vector3(0.75, 0.42, 1).normalize();
    controls.target.set(BOX.cx, BOX.cy, BOX.cz);
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    camera.up.set(0, 1, 0);
    camera.lookAt(controls.target);
    if (state.mode === 'object') controls.update();
  }
  $('fit').addEventListener('click', fit);

  $('quit').addEventListener('click', () => {
    if (window.self !== window.top) window.parent.postMessage({ type: 'close-game' }, '*');
    else window.location.href = '../../';
  });

  /* Tap an axis ball to look straight down that axis. */
  const hit = $('gizmo-hit');
  let tween = null, turn = null;

  hit.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    const r = hit.getBoundingClientRect();
    const nx = ((ev.clientX - r.left) / r.width) * 2 - 1;
    const ny = -((((ev.clientY - r.top) / r.height) * 2) - 1);

    gizmoRoot.updateMatrixWorld(true);
    let best = null;
    for (const s of tips) {
      const p = s.getWorldPosition(new THREE.Vector3()).project(gizmoCam);
      const d = Math.hypot(p.x - nx, p.y - ny);
      if (d < 0.3 && (!best || p.z < best.z)) best = { z: p.z, dir: s.userData.dir };
    }
    if (best) snapTo(best.dir);
  });

  function snapTo(dir) {
    if (state.spin) $('t-spin').click();
    camera.up.set(0, 1, 0);
    if (Math.abs(dir[1]) > 0.9) camera.up.set(0, 0, dir[1] > 0 ? -1 : 1);
    if (state.mode === 'camera') {
      /* As the camera: stay put and turn to look down that axis. */
      const m = new THREE.Matrix4().lookAt(camera.position, camera.position.clone().sub(new THREE.Vector3(...dir)), camera.up);
      turn = { from: camera.quaternion.clone(), to: new THREE.Quaternion().setFromRotationMatrix(m), t0: performance.now() };
      return;
    }
    const dist = camera.position.distanceTo(controls.target);
    tween = {
      from: camera.position.clone(),
      to: controls.target.clone().addScaledVector(new THREE.Vector3(...dir), dist),
      t0: performance.now(),
    };
  }

  /* Where on the canvas the gizmo pass draws. Taken from the hit box so
     the two can never drift apart. setViewport counts y from the bottom. */
  const gz = { x: 0, y: 0, s: 0 };
  let VW = 0, VH = 0;

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    VW = w; VH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    const hr = hit.getBoundingClientRect(), cr = host.getBoundingClientRect();
    gz.x = hr.left - cr.left;
    gz.y = cr.bottom - hr.bottom;
    gz.s = hr.width;
  }
  new ResizeObserver(resize).observe(host);
  resize();
  fit();

  /* For scripts that drive the view — screenshots of a corner, say. */
  window.houseWire = { THREE, camera, controls, objects, fit, select };

  renderer.autoClear = false;

  (function loop() {
    requestAnimationFrame(loop);

    if (tween) {
      const k = Math.min(1, (performance.now() - tween.t0) / 380);
      const ease = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
      camera.position.lerpVectors(tween.from, tween.to, ease);
      if (k >= 1) tween = null;
    }
    if (turn) {
      const k = Math.min(1, (performance.now() - turn.t0) / 380);
      const ease = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
      camera.quaternion.slerpQuaternions(turn.from, turn.to, ease);
      if (k >= 1) turn = null;
    }
    if (state.mode === 'object') controls.update();
    orientLabels();

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, VW, VH);
    renderer.clear();
    renderer.render(scene, camera);

    gizmoRoot.quaternion.copy(camera.quaternion).invert();
    renderer.clearDepth();
    renderer.setViewport(gz.x, gz.y, gz.s, gz.s);
    renderer.setScissor(gz.x, gz.y, gz.s, gz.s);
    renderer.setScissorTest(true);
    renderer.render(gizmoScene, gizmoCam);
    renderer.setScissorTest(false);
  })();

  hideLoader();
}

/* A round sprite, so the vertices are dots rather than squares. */
function dotTexture(THREE) {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
  g.fillStyle = '#fff';
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* A dimension's label: the text on a dark pill, sized to fit it. */
function labelTexture(THREE, text) {
  const h = 96, pad = 28;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `700 ${Math.round(h * 0.5)}px -apple-system, Inter, Helvetica, Arial, sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + pad * 2;
  c.width = w; c.height = h;
  g.font = font;
  g.fillStyle = 'rgba(6, 10, 16, 0.82)';
  g.beginPath();
  if (g.roundRect) g.roundRect(2, 8, w - 4, h - 16, (h - 16) / 2); else g.rect(2, 8, w - 4, h - 16);
  g.fill();
  g.strokeStyle = 'rgba(255, 243, 176, 0.55)';
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = '#fff3b0';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* A filled ball with its letter for +X/+Y/+Z, a hollow one for the
   negative ends — the same read as Unity's scene gizmo. */
function tipTexture(THREE, hex, label) {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const col = `#${hex.toString(16).padStart(6, '0')}`;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 10, 0, Math.PI * 2);
  if (label) {
    g.fillStyle = col;
    g.fill();
    g.fillStyle = '#06101a';
    g.font = `700 ${Math.round(s * 0.5)}px -apple-system, Inter, Helvetica, Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, s / 2, s / 2 + s * 0.03);
  } else {
    g.fillStyle = 'rgba(4, 10, 16, 0.75)';
    g.fill();
    g.strokeStyle = col;
    g.lineWidth = 10;
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function hideLoader() {
  const l = $('app-loading');
  if (!l) return;
  l.classList.add('hidden');
  setTimeout(() => l.remove(), 320);
}
