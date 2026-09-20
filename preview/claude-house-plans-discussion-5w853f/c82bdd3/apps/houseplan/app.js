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
const TER = PLAN.terrain;
const e = PLAN.envelope;

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toFixed(2).replace(/\.?0+$/, '');

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
   the road's low point stands in for their bottoms. */
if (TER) BOX.y0 = Math.min(BOX.y0, ROAD_MIN);
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
  const corner = { along: FACE + FRONT.sign * (r.dFrom ?? 0), across: Math.max(r.from, HOUSE_EDGE) };
  return { r: f.r, corner, centre: { along: corner.along - FRONT.sign * f.r, across: corner.across + f.r } };
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

/* The entrance, over the ramp's last `flare` metres: the hill is cut
   back along a quarter-ellipse centred on the outer wall line at the
   ramp's end, one semi-axis the ramp's width and the other `flare`
   back along the road. The arc leaves the ramp's uphill edge
   tangentially, so the wall beside it stays at full height for a
   while, then sweeps out to meet the road's edge at the ramp's end.
   Everything between the arc and the outer wall line is the ramp's
   floor, still climbing. In (d, across), where d is metres out from
   the house face. */
const MOUTH = (() => {
  const m = CUT?.mouth, r = CUT?.ramp;
  if (!m || !r) return null;
  const dFrom = r.dFrom ?? 0;
  return { a: WALL_D - dFrom, b: m.flare, d0: WALL_D, dFrom, across0: r.to - m.flare };
})();

function inMouth(d, across) {
  if (!MOUTH) return false;
  const { a, b, d0, across0 } = MOUTH;
  const u = (across - across0) / b;
  if (u < 0 || u > 1 || d > d0) return false;
  const edge = d0 - a * Math.sqrt(Math.max(0, 1 - u * u));
  return d >= edge;
}

/* The ramp's floor at a position across the front: the apron level,
   falling past ramp.from, never below the road. */
function rampLevel(across) {
  const r = CUT.ramp;
  const base = sampleProfile(CUT.profile, r.dFrom ?? 0, across);
  return Math.max(base - r.drop * rampT(across), roadLevel(across));
}

function groundY(x, z) {
  if (!TER) return BOX.y0;
  const along = FRONT.axis === 'x' ? x : z;
  const across = FRONT.axis === 'x' ? z : x;
  const d = (along - FACE) * FRONT.sign;
  if (!CUT || across < CUT.from || across > CUT.to) return natural(d, across);
  const base = sampleProfile(CUT.profile, d, across);
  if (d < 0 || !CUT.ramp) return base;
  const r = CUT.ramp;
  if (across <= r.from || across > r.to || d >= WALL_D) return base;
  if (MOUTH && across >= MOUTH.across0) return inMouth(d, across) ? rampLevel(across) : natural(d, across);
  if (d < (r.dFrom ?? 0)) {
    if (across <= HOUSE_EDGE) return base;
    if (!inFillet(along, across)) return natural(d, across);
  }
  return rampLevel(across);
}

const pushed = PLAN.levels.find((l) => l.extendFront);
$('wf-name').textContent = PLAN.name;
$('wf-dims').textContent = `${fmt(e.x1 - e.x0)} × ${fmt(e.y1 - e.y0)} × ${fmt(BOX.y1 - BOX.y0)} m`
  + (pushed ? ` · ${pushed.name.toLowerCase()} out ${fmt(pushed.extendFront)} m to ${TER.front}` : '')
  + (TER ? ` · site falls ${fmt(TER.backLevel - ROAD_MIN)} m` : '');

/* ── scene ────────────────────────────────────────────── */

const state = { faces: true, floors: true, dots: true, grid: true, spin: false };

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
  function addVolume(o, bottom, top, { dots: withDots = true, uprightAt = null } = {}) {
    const n = bottom.length;
    const pos = [...bottom.flat(), ...top.flat()];
    const idx = [];
    const tris = THREE.ShapeUtils.triangulateShape(bottom.map(([x, , z]) => new THREE.Vector2(x, z)), []);
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
  for (const v of VOLS) {
    const o = makeObject(v);
    if (followsGround(v) && TER) {
      const [a0, a1] = FRONT.axis === 'x' ? [v.z0, v.z1] : [v.x0, v.x1];
      const n = Math.max(2, Math.ceil((a1 - a0) / 0.5) + 1);
      const steps = Array.from({ length: n }, (_, i) => a0 + ((a1 - a0) * i) / (n - 1));
      const side = (fixed, list) => list.map((a) => (FRONT.axis === 'x' ? [fixed, a] : [a, fixed]));
      const lo = FRONT.axis === 'x' ? v.x0 : v.z0, hi = FRONT.axis === 'x' ? v.x1 : v.z1;
      const dFace = ((FRONT.sign > 0 ? lo : hi) - FACE) * FRONT.sign;
      const ring = [...side(lo, steps), ...side(hi, steps.slice().reverse())];
      const acrossOf = ([x, z]) => (FRONT.axis === 'x' ? z : x);
      const cornersAt = [0, n - 1, n, 2 * n - 1];
      const bottom = ring.map(([x, z]) => [x, yAt(v.y0, acrossOf([x, z]), dFace), z]);
      const top = ring.map(([x, z]) => [x, yAt(v.y1, acrossOf([x, z]), dFace), z]);
      addVolume(o, bottom, top, { dots: false, uprightAt: cornersAt });
      for (const i of cornersAt) o.dotPos.push(...bottom[i], ...top[i]);
      continue;
    }
    const corners = [[v.x0, v.z0], [v.x1, v.z0], [v.x1, v.z1], [v.x0, v.z1]];
    addVolume(
      o,
      corners.map(([x, z]) => [x, z === v.z1 ? v.y0End ?? v.y0 : v.y0, z]),
      corners.map(([x, z]) => [x, z === v.z1 ? v.y1End ?? v.y1 : v.y1, z]),
    );
  }

  /* The fillet: its floor is the sliver between the corner and the arc,
     at the ramp's level; its wall is a 30 cm band along the arc, on the
     hill side, from the ramp's floor up to the natural ground. */
  if (FILLET) {
    const { r, corner, centre } = FILLET;
    const toXZ = (along, across) => (FRONT.axis === 'x' ? [along, across] : [across, along]);
    const hill = (along, across) => natural((along - FACE) * FRONT.sign, across);
    const arc = (rad, N = 12) => Array.from({ length: N + 1 }, (_, i) => {
      const th = (i / N) * (Math.PI / 2);
      return [centre.along + FRONT.sign * rad * Math.sin(th), centre.across - rad * Math.cos(th)];
    });

    const floorRing = [[corner.along, corner.across], ...arc(r)];
    addVolume(
      makeObject({ id: 'fillet-floor', name: 'Corner fillet, floor', group: 'drive' }),
      floorRing.map(([a, c]) => [toXZ(a, c)[0], rampLevel(c) - 0.1, toXZ(a, c)[1]]),
      floorRing.map(([a, c]) => [toXZ(a, c)[0], rampLevel(c) + 0.1, toXZ(a, c)[1]]),
      { dots: false, uprightAt: [0, 1, floorRing.length - 1] },
    );

    const wallRing = [...arc(r), ...arc(r - 0.3).reverse()];
    const n = wallRing.length / 2;
    addVolume(
      makeObject({ id: 'fillet-wall', name: 'Corner fillet, wall', group: 'wall' }),
      wallRing.map(([a, c]) => [toXZ(a, c)[0], rampLevel(c) - 0.1, toXZ(a, c)[1]]),
      wallRing.map(([a, c]) => [toXZ(a, c)[0], hill(a, c), toXZ(a, c)[1]]),
      { dots: false, uprightAt: [0, n - 1, n, 2 * n - 1] },
    );
  }
  /* The mouth: its floor is the quarter-ellipse itself, still on the
     ramp's grade; its wall a 30 cm band along the arc on the hill side,
     from the floor up to the natural ground — full height where it
     leaves the ramp, nothing where it meets the road. */
  if (MOUTH) {
    const { a, b, d0, across0 } = MOUTH;
    const toXZ = (d, across) => {
      const along = FACE + FRONT.sign * d;
      return FRONT.axis === 'x' ? [along, across] : [across, along];
    };
    const arc = (ra, rb, N = 14) => Array.from({ length: N + 1 }, (_, i) => {
      const th = (i / N) * (Math.PI / 2);
      return [d0 - ra * Math.cos(th), across0 + rb * Math.sin(th)];
    });

    const floorRing = [[d0, across0], ...arc(a, b)];
    addVolume(
      makeObject({ id: 'mouth-floor', name: 'Entrance mouth, floor', group: 'drive' }),
      floorRing.map(([d, c]) => [toXZ(d, c)[0], rampLevel(c) - 0.1, toXZ(d, c)[1]]),
      floorRing.map(([d, c]) => [toXZ(d, c)[0], rampLevel(c) + 0.1, toXZ(d, c)[1]]),
      { dots: false, uprightAt: [0, 1, floorRing.length - 1] },
    );

    const wallRing = [...arc(a, b), ...arc(a + 0.3, b + 0.3).reverse()];
    addVolume(
      makeObject({ id: 'mouth-wall', name: 'Entrance mouth, wall', group: 'wall' }),
      wallRing.map(([d, c]) => [toXZ(d, c)[0], rampLevel(c) - 0.1, toXZ(d, c)[1]]),
      wallRing.map(([d, c]) => [toXZ(d, c)[0], natural(d, c), toXZ(d, c)[1]]),
      { dots: false, uprightAt: [0, wallRing.length - 1] },
    );
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
    chip.innerHTML = `<i></i>${g.name}`;
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
  const EXT = 22;
  const xs = [], zs = [];
  for (let x = Math.round(BOX.cx - EXT); x <= BOX.cx + EXT; x += 1) xs.push(x);
  for (let z = Math.round(BOX.cz - EXT); z <= BOX.cz + EXT; z += 1) zs.push(z);
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
      across.push(CUT.ramp.from, CUT.ramp.to);
      if (MOUTH) across.push(MOUTH.across0);
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

  function fit() {
    const dist = (BOX.r / Math.sin((camera.fov * Math.PI / 180) / 2)) * 1.25;
    const dir = new THREE.Vector3(0.75, 0.42, 1).normalize();
    controls.target.set(BOX.cx, BOX.cy, BOX.cz);
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    controls.update();
  }
  $('fit').addEventListener('click', fit);

  $('quit').addEventListener('click', () => {
    if (window.self !== window.top) window.parent.postMessage({ type: 'close-game' }, '*');
    else window.location.href = '../../';
  });

  /* Tap an axis ball to look straight down that axis. */
  const hit = $('gizmo-hit');
  let tween = null;

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
    const dist = camera.position.distanceTo(controls.target);
    camera.up.set(0, 1, 0);
    if (Math.abs(dir[1]) > 0.9) camera.up.set(0, 0, dir[1] > 0 ? -1 : 1);
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
  window.houseWire = { THREE, camera, controls, objects, fit };

  renderer.autoClear = false;

  (function loop() {
    requestAnimationFrame(loop);

    if (tween) {
      const k = Math.min(1, (performance.now() - tween.t0) / 380);
      const ease = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
      camera.position.lerpVectors(tween.from, tween.to, ease);
      if (k >= 1) tween = null;
    }
    controls.update();

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
