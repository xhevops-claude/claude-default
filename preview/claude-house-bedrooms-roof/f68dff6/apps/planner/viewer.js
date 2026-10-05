/* The viewer: builds the scene from the model, draws it, and runs the
   interface — layers, settings, tap-to-measure, navigation. One project
   at a time, named by the address; main.js decides whether to load it. */

import { loadCurrent, stage } from './load.js?v=f68dff6';
import { $, fmt, hideLoader } from './util.js?v=f68dff6';
import { LANG, t, tDim, setLang } from './i18n.js?v=f68dff6';
import { deriveModel } from './model.js?v=f68dff6';
import { dotTexture, labelTexture, tipTexture } from './textures.js?v=f68dff6';

const { PLAN, RELIEF, PROJECT } = await loadCurrent();
const M = deriveModel(PLAN);
const { SLAB, WALL, STEP, TER, e, TURN, PIVOT, H, FRONT, ROAD, ROAD_MIN, roadLevel, VOLS, FRAMED, BOX, OUTLINES, PRISMS, FACE, PROFILE, CUT, cutFrom, sampleProfile, natural, WALL_D, HOUSE_EDGE, FILLET, insideFillet, inFillet, rampT, MOUTH, inMouth, rampLevel, DRIVE, groundY, faceD } = M;

/* The tracker lives with the project. */
{
  const a = $('defects-link');
  if (PROJECT.tracker) a.href = PROJECT.tracker; else a.hidden = true;
}

$('wf-name').textContent = PLAN.name;
function paintHeader() {
  const num = (n) => (LANG === 'de' ? fmt(n).replace('.', ',') : fmt(n));
  if (!PLAN.levels?.length) {
    /* Nothing built yet: the site's own numbers instead. */
    const nb = (PLAN.buildings || []).length;
    const site = PLAN.parcel ? `${t(PLAN.parcel.name)}${nb ? ` · ${nb} ${t('buildings')}` : ''}` : t('Nothing built yet');
    $('wf-dims').textContent = site;
    return;
  }
  const top = Math.max(...PLAN.levels.map((l) => l.elevation + l.height));
  const foot = Math.min(...PLAN.levels.map((l) => l.elevation - SLAB));
  $('wf-dims').textContent = `${num(e.x1 - e.x0)} × ${num(e.y1 - e.y0)} × ${num(top - foot)} m`
    + (TER ? ` · ${t('site falls')} ${num(TER.backLevel - ROAD_MIN)} m` : '');
}
paintHeader();

/* ── scene ────────────────────────────────────────────── */

const state = { spin: false, mode: 'object', fs: 0 };

boot();

async function boot() {
  let THREE, OrbitControls;
  try {
    /* three.js comes from the app's own vendor folder; still, give it
       a deadline, so a fetch that never answers ends in the message
       below rather than a bar that runs forever */
    stage('loading three.js');
    const deadline = new Promise((_, reject) => setTimeout(() => reject(new Error('three.js took too long to load')), 30000));
    THREE = await Promise.race([import('three'), deadline]);
    ({ OrbitControls } = await Promise.race([import('three/addons/controls/OrbitControls.js'), deadline]));
  } catch (err) {
    $('fail').textContent = `${t('This project could not be loaded.')} ${err.message}`;
    $('fail').hidden = false;
    hideLoader();
    return;
  }
  stage('building the scene');

  const host = $('canvas-host');
  /* No context menu on a long press or right-click: the press is a
     look, the right button a slide. */
  host.addEventListener('contextmenu', (e) => e.preventDefault());
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
  const BLACK = new THREE.Color(0x000000);
  const parts = new THREE.Group();
  /* Light for the solid objects only — the glass volumes are unlit and
     keep their flat tint: a soft sky from above, and a sun from the
     south-east so a box's three visible faces come out three shades. */
  parts.add(new THREE.HemisphereLight(0xe6edf5, 0x3a4048, 1.0));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.4);
  sun.position.set(0.5, 1, 0.75);
  parts.add(sun);
  const objects = [];
  /* the tapped object; declared here, ahead of the layers, because a
     saved layer set applied at boot can switch a group off and must be
     able to ask whether the selection is in it */
  let selected = null;
  /* `color` overrides the group's; `opacity` is the glass's — 0.05 for
     a wireframe's whisper of a face, more for a building whose walls
     should read as walls. */
  /* `parent` and `short` are for the dock's tree: a floor lists under
     its building by its short name. `parent` is one `{ id, name }` or a
     path of them, top down — a wall under its floor's "Walls" under the
     floor. `hidden` is the object's own switch there, on top of its
     group's. */
  /* `solid` is for a thing that is not a volume of the plan but an
     object in it — a sofa, a fridge, a tread: an opaque, lit body in
     its own colour, outlined in a darker shade, no dots at its
     corners, so it reads as a piece of furniture and not as a lantern. */
  function makeObject({ id, name, group, color = null, opacity = 0.05, parent = null, short = null, solid = false }) {
    const col = new THREE.Color(color || GROUPS[group]?.color || '#8fd8ff');
    const node = new THREE.Group();
    node.name = id;
    node.userData = { id, name, group };
    const body = () => new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide });
    const o = {
      id, name, group, node, col, dotPos: [], opacity, parent, short: short || name, hidden: false, props: [], solid,
      glass: solid ? body() : new THREE.MeshBasicMaterial({
        color: col.clone().lerp(WHITE, 0.35), transparent: true, opacity,
        side: THREE.DoubleSide, depthWrite: false,
      }),
      /* An interior floor: the slab between two storeys, seen through
         the facade and the storeys above, so far fainter than a wall —
         two of them stacked still read lighter than the roof. */
      glassIn: solid ? body() : new THREE.MeshBasicMaterial({
        color: col.clone().lerp(WHITE, 0.35), transparent: true, opacity: opacity * 0.4,
        side: THREE.DoubleSide, depthWrite: false,
      }),
      line: (opacity) => new THREE.LineBasicMaterial({ color: solid ? col.clone().lerp(BLACK, 0.5) : col, transparent: true, opacity }),
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
  /* The glass comes in up to three meshes — sides, bottom cap, top cap —
     so a storey's slab against the storey below (`interior.bottom`) or
     above (`interior.top`) can be its own, fainter layer while the
     outer walls, the roof and the underside stay the facade. */
  function addVolume(o, bottom, top, { dots: withDots = true, uprightAt = null, strip = false, caps = true, interior = null } = {}) {
    const n = bottom.length;
    const pos = [...bottom.flat(), ...top.flat()];
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
    const capBottom = [], capTop = [], sides = [];
    for (const [a, b, c] of tris) { capBottom.push(a, b, c); capTop.push(a + n, b + n, c + n); }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      sides.push(i, j, j + n, i, j + n, i + n);
    }
    const glass = (idx, inside) => {
      if (!idx.length) return;
      let geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      /* A solid is lit, so it needs normals — one per face, not blended
         across the shared corners, so each face of a box is its own flat
         shade. */
      if (o.solid) { geo = geo.toNonIndexed(); geo.computeVertexNormals(); }
      o.node.add(tagged(new THREE.Mesh(geo, inside ? o.glassIn : o.glass), inside ? 'interior' : 'faces'));
    };
    glass(sides, false);
    glass(capBottom, !!interior?.bottom);
    glass(capTop, !!interior?.top);

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
  const boxDims = (v, turn = null) => {
    const P = (x, y, z) => { const [px, pz] = turn ? turn(x, z) : [x, z]; return [px, y, pz]; };
    return [
      { a: P(v.x0, v.y1, v.z1), b: P(v.x1, v.y1, v.z1), label: mLabel(v.x1 - v.x0) },
      { a: P(v.x1, v.y1, v.z0), b: P(v.x1, v.y1, v.z1), label: mLabel(v.z1 - v.z0) },
      { a: P(v.x1, v.y0, v.z1), b: P(v.x1, v.y1, v.z1), label: `h ${mLabel(v.y1 - v.y0)}` },
    ];
  };
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
    /* A z0 of 'cut' stops the volume on the cut's near edge — a line
       when the boundary runs at an angle — so its end follows it. */
    const onCut = v.z0 === 'cut' && CUT && FRONT.axis === 'x';
    const cutAt = (x) => cutFrom((x - FACE) * FRONT.sign);
    if (followsGround(v) && TER) {
      const lo = FRONT.axis === 'x' ? v.x0 : v.z0, hi = FRONT.axis === 'x' ? v.x1 : v.z1;
      const a0Lo = onCut ? cutAt(lo) : (FRONT.axis === 'x' ? v.z0 : v.x0);
      const a0Hi = onCut ? cutAt(hi) : a0Lo;
      const a1 = FRONT.axis === 'x' ? v.z1 : v.x1;
      const dFace = ((FRONT.sign > 0 ? lo : hi) - FACE) * FRONT.sign;
      const steps = runOut(stationsBetween(Math.max(a0Lo, a0Hi), a1), (a) => yAt(v.y1, a, dFace) - yAt(v.y0, a, dFace));
      const n = steps.length;
      /* Each side starts on its own end of the cut edge; the stations
         beyond the first are shared, so the two chains match. */
      const side = (fixed, list) => list.map((a) => (FRONT.axis === 'x' ? [fixed, a] : [a, fixed]));
      const ring = [...side(lo, [a0Lo, ...steps.slice(1)]), ...side(hi, [a0Hi, ...steps.slice(1)].reverse())];
      const acrossOf = ([x, z]) => (FRONT.axis === 'x' ? z : x);
      const cornersAt = [0, n - 1, n, 2 * n - 1];
      const bottom = ring.map(([x, z]) => [x, yAt(v.y0, acrossOf([x, z]), dFace), z]);
      const top = ring.map(([x, z]) => [x, yAt(v.y1, acrossOf([x, z]), dFace), z]);
      addVolume(o, bottom, top, { dots: false, uprightAt: cornersAt });
      for (const i of cornersAt) o.dotPos.push(...bottom[i], ...top[i]);
      o.dims = walkedDims(bottom, top, n);
      continue;
    }
    /* A work with its own `ring` is that footprint; a box otherwise. */
    let corners = v.ring ? v.ring.map((p) => p.slice()) : [[v.x0, v.z0], [v.x1, v.z0], [v.x1, v.z1], [v.x0, v.z1]];
    /* Which corners are the volume's lower end (y0End / y1End): its z1
       side, or its x1 side when it says `end: "x"` — a lid pitched along
       the house. Read before the turn, in the frame the numbers are in. */
    let ends = corners.map(([x, z]) => (v.end === 'x' ? x === v.x1 : z === v.z1));
    /* A part of the house is drawn in the house's frame, turned. */
    if (v.house) corners = corners.map(([x, z]) => H(x, z));
    if (onCut && !v.ring) {
      /* The near edge is the cut line itself: its end points at the
         volume's two sides, and every bend of the line between them.
         With the house turned, the west side is its east face, from
         the corner north to where it meets the cut line — and the
         south-east corner is rounded by the fillet's arc, which dips a
         touch north of the corner's line before it swings out. */
      const westX = TURN ? faceMeetsCut() : null;
      const west = westX ? westX[0] : v.x0;
      const bends = typeof CUT.from === 'number' ? [] : CUT.from
        .map(([d, a]) => [FACE + FRONT.sign * d, a])
        .filter(([x]) => x > west + 1e-6 && x < v.x1 - 1e-6)
        .sort((p, q) => q[0] - p[0]);
      const dip = [];
      if (FILLET && TURN) {
        const { r: rad, centre } = FILLET;
        const n = 6;
        for (let i = 1; i <= n; i++) {
          const phi = -TURN + (2 * TURN * i) / n;
          dip.push([centre.along + rad * Math.sin(phi), centre.across - rad * Math.cos(phi)]);
        }
      }
      corners = [[v.x0, v.z1], ...dip, [v.x1, v.z1], [v.x1, cutAt(v.x1)], ...bends, westX || [v.x0, cutAt(v.x0)]];
      ends = corners.map(([, z]) => z === v.z1);
    }
    const bottom = corners.map(([x, z], i) => [x, ends[i] ? v.y0End ?? v.y0 : v.y0, z]);
    const top = corners.map(([x, z], i) => [x, ends[i] ? v.y1End ?? v.y1 : v.y1, z]);
    addVolume(o, bottom, top, { dots: !v.solid });
    if (onCut || v.ring) {
      /* Every straight side of the footprint, and the height. */
      o.dims = [];
      top.forEach((a, i) => {
        const b = top[(i + 1) % top.length];
        if (plan2(a, b) < 0.5) return;
        o.dims.push({ a, b, label: mLabel(plan2(a, b)) });
      });
      o.dims.push({ a: bottom[1], b: top[1], label: `h ${mLabel(top[1][1] - bottom[1][1])}` });
    } else {
      o.dims = boxDims(v, v.house ? H : null);
    }
  }
  /* Where the turned house's east face line meets the cut's near edge:
     the apron's north-west corner. */
  function faceMeetsCut() {
    if (typeof CUT.from === 'number') return [FACE + FRONT.sign * faceD(CUT.from), CUT.from];
    const t = Math.tan(TURN);
    for (let i = 1; i < CUT.from.length; i++) {
      const [d0, a0] = CUT.from[i - 1], [d1, a1] = CUT.from[i];
      /* d0 + u (d1 - d0) = -(E - a0 - u (a1 - a0)) t */
      const den = d1 - d0 - (a1 - a0) * t;
      if (Math.abs(den) < 1e-9) continue;
      const u = (-(HOUSE_EDGE - a0) * t - d0) / den;
      if (u >= -1e-9 && u <= 1 + 1e-9) {
        const a = a0 + u * (a1 - a0);
        return [FACE + FRONT.sign * faceD(a), a];
      }
    }
    return null;
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
      let cut = st.map((c) => [edge(c), c]);
      let far = st.map(hill);
      if (id === 'fillet-wall' && TURN) {
        /* The arc starts at the house's corner, which with the house
           turned lies before the arc's northernmost point, where a
           station's across would be ambiguous — so this band is walked
           by angle about the centre instead: from -TURN up to where the
           stations take over, then at the stations' own angles. */
        const { r: rad, centre } = FILLET;
        const dc = rad - WALL;
        const phis = [-TURN, -TURN / 2, 0];
        for (const c of st) {
          const phi = Math.acos(Math.min(1, Math.max(-1, (centre.across - c) / rad)));
          if (phi > 1e-9) phis.push(phi);
        }
        cut = phis.map((phi) => [centre.along - FACE + rad * Math.sin(phi), centre.across - rad * Math.cos(phi)]);
        far = phis.map((phi) => [centre.along - FACE + dc * Math.sin(phi), centre.across - dc * Math.cos(phi)]);
      }
      const n = cut.length;
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

  /* ── buildings, buildable areas, draped lines ───────── */

  /* A building is a stack of floors, each its own object: a prism over
     the floor's slab outline from the slab's underside to the top of
     the storey, with the outline's sides and the storey height as its
     dimensions. A buildable area is one such prism on its own. */
  const ringArea = (ring) => Math.abs(ring.reduce((s, [x, z], i) => { const [x2, z2] = ring[(i + 1) % ring.length]; return s + x * z2 - x2 * z; }, 0)) / 2;
  const prism = (o, ring, y0, y1, { name = null, interior = null } = {}) => {
    const bottom = ring.map(([x, z]) => [x, y0, z]);
    const top = ring.map(([x, z]) => [x, y1, z]);
    addVolume(o, bottom, top, { interior });
    o.props.push(['Footprint', `${fmt(Math.round(ringArea(ring) * 10) / 10)} m²`], ['Height', `${fmt(y1 - y0)} m`]);
    o.dims = [];
    top.forEach((a, i) => {
      const b = top[(i + 1) % top.length];
      if (plan2(a, b) >= 1) o.dims.push({ a, b, label: mLabel(plan2(a, b)) });
    });
    o.dims.push({ a: bottom[0], b: top[0], label: `h ${mLabel(y1 - y0)}` });
    if (name) o.dims.push({ a: top[0], b: top[0], label: name });
  };
  /* Each building in its own shade of the group's colour, and with
     walls solid enough to tell one from the next. */
  const shades = ['#8fd8ff', '#ffd27a', '#b9a3ff', '#7ee8c9', '#ff9db4', '#c8d6e5'];
  (PLAN.buildings || []).forEach((b, bi) => {
    b.floors.forEach((f, fi) => {
      const o = makeObject({ id: `${b.id}-${f.id}`, name: `${b.name} · ${f.name}`, group: b.group || 'house', color: b.color || shades[bi % shades.length], opacity: 0.3, parent: { id: b.id, name: b.name }, short: f.name });
      /* The lowest floor's underside and the top floor's roof are
         facade; every slab between two storeys is interior. */
      o.props.push(['Level', `${fmt(f.elevation)} · ${fmt(f.elevation + (PLAN.datum || 0))} m`]);
      prism(o, f.ring, f.elevation - SLAB, f.elevation + f.height, { interior: { bottom: fi > 0, top: fi < b.floors.length - 1 } });
      /* the floor's level, in the header's frame, as a dimension on it */
      o.dims.push({ a: [f.ring[0][0], f.elevation, f.ring[0][1]], b: [f.ring[1][0], f.elevation, f.ring[1][1]], label: `${t('floor')} ${fmt(f.elevation)} · ${fmt(f.elevation + (PLAN.datum || 0))} m` });
    });
  });
  for (const v of PLAN.envelopes || []) {
    const o = makeObject({ id: v.id, name: v.name, group: v.group || 'envelope' });
    prism(o, v.ring, v.y0, v.y1);
  }
  /* A draped line: [x, y, z] points already on the ground, drawn as a
     strip of segments; closed if it says so. */
  for (const l of PLAN.lines || []) {
    const o = makeObject({ id: l.id, name: l.name, group: l.group });
    const pts = l.points, seg = [];
    for (let i = 0; i + 1 < pts.length; i++) seg.push(...pts[i], ...pts[i + 1]);
    if (l.closed && pts.length > 2) seg.push(...pts[pts.length - 1], ...pts[0]);
    o.node.add(tagged(segments(seg, o.line(0.8)), 'edges'));
    o.dims = [];
  }

  /* ── the relief: the surveyed ground ────────────────── */

  /* The terrain app's layers, in this frame. relief.js carries the
     survey as height fields — a 0.2 m lattice over and around the
     parcel, and the 1 m grid over the whole survey, emptied where the
     fine one covers it — and from them come: every surveyed point,
     tinted by height from the group's colour at the bottom of the
     sample to near white at the top; the ground as a surface, dimmed
     outside the parcel; contours every 10 cm of real height with a
     heavier line at each metre, as the terrain app draws them; a height
     label wherever a parcel edge crosses a metre line; and the survey's
     own eastings and northings every 5 m, draped on the ground. Each
     is a layer of one Relief object, hidden with the group or on its
     own from Settings. Not framed, not tappable — it is the backdrop
     the model sits in. */
  const reliefLabels = [];
  const RELIEF_INK = '#bff2d6';
  if (RELIEF?.fields?.length && RELIEF.frame) {
    const R = RELIEF;
    const o = makeObject({ id: 'relief', name: R.name || 'Relief', group: 'relief' });
    const { mid, ex, ez, org } = R.frame;
    const toModel = (X, Y, h) => {
      const dX = X - mid[0], dY = Y - mid[1];
      return [org[0] + dX * ex[0] + dY * ex[1], h - R.datum, org[1] + dX * ez[0] + dY * ez[1]];
    };
    const surveyOf = (F, i, j) => [F.origin[0] + i * F.u[0] + j * F.v[0], F.origin[1] + i * F.u[1] + j * F.v[1]];
    /* A model point back to the survey's frame. */
    const toSurvey = (x, z) => {
      const det = ex[0] * ez[1] - ex[1] * ez[0];
      const dX = ((x - org[0]) * ez[1] - (z - org[1]) * ex[1]) / det, dY = ((z - org[1]) * ex[0] - (x - org[0]) * ez[0]) / det;
      return [mid[0] + dX, mid[1] + dY];
    };

    /* ── the worked ground ──────────────────────────────── */

    /* relief.js is the original, and stays it. The ground the model
       shows is worked from it in order — original, then what the
       objects need dug out (a building's lowest floor, a house's
       garage), then the ground the terrain model designs in front of
       the house (the driveway's cut: apron, ramp, fillet and mouth,
       wherever groundY() departs from the natural hill), then a work
       marked `excavate`, then whatever else plan.js lists under
       `excavations` for later (a path carved, a terrace) — so moving a
       building means recomputing, never redrawing the survey. A cut is
       a ring in plan with a `level` (the model's y the ground is taken
       down to) or a `depth` below the ground as found; each becomes a
       `floor(x, z, w, cell)` — the survey height it takes a point down
       to, or null where it does not reach — and the ground only ever
       goes down, so a relief point that ends up lower than the survey
       found it is excavation, whichever cut got there. */
    const inRing = (ring, x, z) => {
      let inn = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, zi] = ring[i], [xj, zj] = ring[j];
        if ((zi > z) !== (zj > z) && x < xi + ((xj - xi) * (z - zi)) / (zj - zi)) inn = !inn;
      }
      return inn;
    };
    /* Inside the ring, or within `m` of its edge: a pit is dug a working
       margin wider than what stands in it, and that margin is at least
       a cell, so the surface's step from cut to uncut falls outside the
       walls instead of ramping through the basement. */
    const nearRing = (ring, x, z, m) => {
      if (inRing(ring, x, z)) return true;
      if (!m) return false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, az] = ring[j], [bx, bz] = ring[i];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        if (Math.hypot(x - ax - u * dx, z - az - u * dz) <= m) return true;
      }
      return false;
    };
    const EXC = [];
    /* Beyond a levelled ring, a `taper` band — `width` metres out from
       the ring's listed `edges` (all of them if none are listed) —
       rolls the ring's level down into the ground as found on an
       S-curve, level at the edge and flat again where it lands, so the
       fill under the yard's edge is a rounded shoulder, not a wall, and
       never reaches further than that width. */
    const taperT = (ring, edges, width, x, z) => {
      let best = Infinity;
      for (let i = 0; i < ring.length; i++) {
        if (edges && !edges.includes(i)) continue;
        const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const u = ((x - ax) * dx + (z - az) * dz) / l2;
        if (u < 0 || u > 1) continue;
        best = Math.min(best, Math.hypot(x - ax - u * dx, z - az - u * dz));
      }
      return best < width ? best / width : null;
    };
    const ringCut = (c) => ({
      ...c,
      floor: (x, z, w, cell) => {
        if (nearRing(c.ring, x, z, c.margin ?? Math.max(cell, 0.5))) return c.depth != null ? w - c.depth : c.level + R.datum;
        if (!c.taper || c.depth != null) return null;
        const t0 = taperT(c.ring, c.taper.edges || null, c.taper.width ?? 1, x, z);
        if (t0 == null) return null;
        const lv = c.level + R.datum;
        return lv + (w - lv) * (1 - Math.cos(Math.PI * t0)) / 2;
      },
    });
    for (const b of PLAN.buildings || []) {
      if (!b.floors?.length) continue;
      const low = b.floors.reduce((m, f) => (f.elevation < m.elevation ? f : m));
      EXC.push(ringCut({ key: b.id, what: t(b.name), ring: low.ring, level: low.elevation - SLAB }));
    }
    if (PLAN.levels?.length && e.x1 > e.x0) {
      /* each level digs to its own underside over its own extent — a
         garage that stops short of the back leaves the hill there for
         the storey above to sit on, dug only to that storey's slab */
      const pits = VOLS.filter((v) => v.slab)
        .map((v) => ({ ring: [[v.x0, v.z0], [v.x1, v.z0], [v.x1, v.z1], [v.x0, v.z1]].map(([x, z]) => H(x, z)), level: v.y0 + R.datum }));
      EXC.push({
        key: 'house', what: t('the house'),
        floor: (x, z, w, cell) => pits.reduce((f, p) => (nearRing(p.ring, x, z, Math.max(cell, 0.5)) && (f == null || p.level < f) ? p.level : f), null),
      });
    }
    if (CUT) {
      /* the designed ground: wherever the terrain model's groundY() is
         not the natural hill, the survey comes down to it */
      const designed = (x, z) => {
        const along = FRONT.axis === 'x' ? x : z, across = FRONT.axis === 'x' ? z : x;
        const g = groundY(x, z);
        return Math.abs(g - natural((along - FACE) * FRONT.sign, across)) < 1e-9 ? null : g + R.datum;
      };
      EXC.push({ key: 'driveway-cut', what: t('the driveway'), floor: designed, fill: true });
    }
    for (const w of PLAN.works || []) {
      if (!w.excavate || typeof w.y0 !== 'number') continue;
      const zAt = (x) => (w.z0 === 'cut' && CUT ? cutFrom((x - FACE) * FRONT.sign) : w.z0);
      const ring = w.ring ? (w.house ? w.ring.map(([x, z]) => H(x, z)) : w.ring) : [[w.x0, zAt(w.x0)], [w.x1, zAt(w.x1)], [w.x1, w.z1], [w.x0, w.z1]];
      EXC.push(ringCut({ key: w.id, what: t(w.name), ring, level: w.y0 }));
    }
    for (const c of PLAN.excavations || []) EXC.push(ringCut({ ...c, key: c.id, what: t(c.what || c.name) }));
    /* What each cut takes out is measured right here, on the relief
       points themselves: every point stands for one lattice cell
       (|u × v| m²), and the cut's volume is the sum over the points it
       lowers of how far it lowers them, times that cell. Cuts are
       applied in order, each against the ground as the ones before it
       left it, so where two pits overlap — a garage under a building's
       own dig — the shared ground is counted once, by the first cut to
       reach it, and the cuts' volumes add up to exactly the ground's
       total lowering. `deep` is measured from the original survey, the
       true depth of the pit, and `at` is where. Where the designed
       ground stands above the survey there is nothing to dig: that
       point is `raised` instead — fill, the land to be added — and the
       relief itself is left as found. Each lowered point is
       kept, with the ground before and after the cut, so the pit can be
       drawn as exactly that soil. */
    const dug = new Map(EXC.map((c) => [c, { vol: 0, area: 0, deep: 0, at: null, lowered: new Map(), raised: new Map() }]));
    const worked = new Map();
    for (const F of R.fields) {
      const [nx, ny] = F.size;
      const W = Array.from(F.heights);
      const cellA = Math.abs(F.u[0] * F.v[1] - F.u[1] * F.v[0]);
      const cellM = Math.sqrt(cellA);
      if (EXC.length) {
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const k = j * nx + i;
            if (W[k] == null) continue;
            const [X, Y] = surveyOf(F, i, j);
            const [x, , z] = toModel(X, Y, W[k]);
            for (const c of EXC) {
              const cut = c.floor(x, z, W[k], cellM);
              if (cut == null) continue;
              const s = dug.get(c);
              /* designed ground above the survey as found is fill, not
                 excavation; above a pit dug earlier it is the pit's slab */
              if (c.fill && cut > W[k] && W[k] === F.heights[k]) {
                if (!s.raised.has(F)) s.raised.set(F, new Map());
                s.raised.get(F).set(k, [W[k], cut]);
              }
              if (cut >= W[k]) continue;
              s.vol += (W[k] - cut) * cellA;
              s.area += cellA;
              if (F.heights[k] - cut > s.deep) { s.deep = F.heights[k] - cut; s.at = [F, k]; }
              if (!s.lowered.has(F)) s.lowered.set(F, new Map());
              s.lowered.get(F).set(k, [W[k], cut]);
              W[k] = cut;
            }
          }
        }
      }
      worked.set(F, W);
    }

    /* Each field: one vertex per sampled cell, shared by the points,
       the surface and the contours, so they cannot disagree; and two
       triangles per cell whose four corners were all sampled. */
    let lo = Infinity, hi = -Infinity;
    let sx0 = Infinity, sx1 = -Infinity, sy0 = Infinity, sy1 = -Infinity;
    const fields = R.fields.map((F) => {
      const [nx, ny] = F.size;
      const H = worked.get(F);
      const has = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && H[j * nx + i] != null;
      const survey = (i, j) => [F.origin[0] + i * F.u[0] + j * F.v[0], F.origin[1] + i * F.u[1] + j * F.v[1]];
      const vid = new Int32Array(nx * ny).fill(-1);
      const pos = [];
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          if (!has(i, j)) continue;
          vid[j * nx + i] = pos.length / 3;
          const [X, Y] = survey(i, j);
          sx0 = Math.min(sx0, X); sx1 = Math.max(sx1, X); sy0 = Math.min(sy0, Y); sy1 = Math.max(sy1, Y);
          const p = toModel(X, Y, H[j * nx + i]);
          pos.push(...p);
          lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]);
        }
      }
      const tri = [];
      for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          if (!(has(i, j) && has(i + 1, j) && has(i, j + 1) && has(i + 1, j + 1))) continue;
          const a = vid[j * nx + i], b = vid[j * nx + i + 1], d = vid[(j + 1) * nx + i], e = vid[(j + 1) * nx + i + 1];
          tri.push(a, b, e, a, e, d);
        }
      }
      /* The field's height at a survey point, bilinear in its own
         lattice; null where any corner is missing. */
      const det = F.u[0] * F.v[1] - F.u[1] * F.v[0];
      const sampler = (A) => (X, Y) => {
        const dx = X - F.origin[0], dy = Y - F.origin[1];
        const fu = (dx * F.v[1] - dy * F.v[0]) / det, fv = (dy * F.u[0] - dx * F.u[1]) / det;
        const i = Math.floor(fu), j = Math.floor(fv);
        if (!(has(i, j) && has(i + 1, j) && has(i, j + 1) && has(i + 1, j + 1))) return null;
        const s = fu - i, t = fv - j;
        return A[j * nx + i] * (1 - s) * (1 - t) + A[j * nx + i + 1] * s * (1 - t) + A[(j + 1) * nx + i] * (1 - s) * t + A[(j + 1) * nx + i + 1] * s * t;
      };
      /* the worked ground */
      const heightAt = sampler(H);
      return { pos, tri, heightAt, F, W: H, nx, ny };
    });
    /* Tinted by height; and outside the parcel — a ray cast from the
       point against the boundary in plan — dimmed, as the terrain app
       masks its parcels. */
    const poly = PLAN.parcel?.points?.map(([x, , z]) => [x, z]);
    const inside = (x, z) => {
      let inn = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i], [xj, zj] = poly[j];
        if ((zi > z) !== (zj > z) && x < xi + ((xj - xi) * (z - zi)) / (zj - zi)) inn = !inn;
      }
      return inn;
    };
    const c = new THREE.Color();
    const minorSegs = [], majorSegs = [];
    const LIFT = 0.02;
    /* Contour intervals, in metres of real height: the terrain app's
       10 cm / 1 m unless the relief says otherwise. */
    const CM = R.contours?.minor ?? 0.1, CMJ = R.contours?.major ?? 1;
    const PER = Math.round(CMJ / CM);
    const dotMapRelief = dotTexture(THREE);
    for (const { pos, tri } of fields) {
      const colors = new Float32Array(pos.length);
      for (let k = 0; k < pos.length; k += 3) {
        c.copy(o.col).lerp(WHITE, 0.15 + 0.7 * ((pos[k + 1] - lo) / (hi - lo || 1)));
        if (poly?.length && !inside(pos[k], pos[k + 2])) c.multiplyScalar(0.4);
        colors[k] = c.r; colors[k + 1] = c.g; colors[k + 2] = c.b;
      }
      const posAttr = new THREE.Float32BufferAttribute(pos, 3);
      const colAttr = new THREE.BufferAttribute(colors, 3);

      o.node.add(tagged(new THREE.Points(
        new THREE.BufferGeometry().setAttribute('position', posAttr).setAttribute('color', colAttr),
        new THREE.PointsMaterial({
          size: 3, sizeAttenuation: false, vertexColors: true, map: dotMapRelief,
          transparent: true, opacity: 0.85, alphaTest: 0.35, depthWrite: false,
        }),
      ), 'relief-points'));

      /* The surface, translucent so the model still reads through it. */
      const surf = new THREE.BufferGeometry();
      surf.setAttribute('position', posAttr);
      surf.setAttribute('color', colAttr);
      surf.setIndex(tri);
      const surfMesh = new THREE.Mesh(surf, new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false,
      }));
      surfMesh.renderOrder = -1;
      o.node.add(tagged(surfMesh, 'relief-surface'));

      /* Contours, walked per triangle over the 10 cm levels it spans —
         levels of real height, so a metre line is a metre above sea
         level, as on the survey. */
      const cross = (a, b, y, out) => {
        const ya = pos[a * 3 + 1], yb = pos[b * 3 + 1];
        if ((ya < y) === (yb < y)) return;
        const f = (y - ya) / (yb - ya);
        out.push(pos[a * 3] + (pos[b * 3] - pos[a * 3]) * f, pos[a * 3 + 2] + (pos[b * 3 + 2] - pos[a * 3 + 2]) * f);
      };
      for (let k = 0; k < tri.length; k += 3) {
        const a = tri[k], b = tri[k + 1], d = tri[k + 2];
        const ya = pos[a * 3 + 1], yb = pos[b * 3 + 1], yd = pos[d * 3 + 1];
        const s0 = Math.ceil((Math.min(ya, yb, yd) + R.datum) / CM - 1e-6);
        const s1 = Math.floor((Math.max(ya, yb, yd) + R.datum) / CM + 1e-6);
        for (let st = s0; st <= s1; st++) {
          const y = st * CM - R.datum;
          const xz = [];
          cross(a, b, y, xz); cross(b, d, y, xz); cross(d, a, y, xz);
          if (xz.length >= 4) (st % PER === 0 ? majorSegs : minorSegs).push(xz[0], y + LIFT, xz[1], xz[2], y + LIFT, xz[3]);
        }
      }
    }
    o.node.add(tagged(segments(minorSegs, new THREE.LineBasicMaterial({ color: o.col, transparent: true, opacity: 0.3 })), 'relief-minor'));
    o.node.add(tagged(segments(majorSegs, new THREE.LineBasicMaterial({ color: o.col.clone().lerp(WHITE, 0.45), transparent: true, opacity: 0.9 })), 'relief-major'));

    /* A label at every point where a parcel edge crosses a metre line:
       the real height, and the model's (above the garage-floor datum)
       beside it. Sprites, so they face you from anywhere. */
    const labelsNode = tagged(new THREE.Group(), 'relief-labels');
    const pts = PLAN.parcel?.points || [];
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], q = pts[(k + 1) % pts.length];
      const ya = p[1] + R.datum, yb = q[1] + R.datum;
      if (ya === yb) continue;
      for (let m = Math.ceil(Math.min(ya, yb) / CMJ) * CMJ; m <= Math.max(ya, yb) + 1e-9; m += CMJ) {
        const f = (m - ya) / (yb - ya);
        const rel = m - R.datum;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
        sprite.userData.text = `${m} m · ${rel >= 0 ? '+' : '−'}${Math.abs(rel).toFixed(1)}`;
        sprite.position.set(p[0] + (q[0] - p[0]) * f, rel + 0.05, p[2] + (q[2] - p[2]) * f);
        sprite.renderOrder = 5;
        labelsNode.add(sprite);
        reliefLabels.push(sprite);
      }
    }
    o.node.add(labelsNode);

    /* The survey's own coordinates: its eastings and northings every
       5 m, each line draped on whichever field covers it — the fine one
       first — a quarter-metre at a time, broken where neither does. */
    const EVERY = 5, SAMPLE = 0.25;
    const heightAt = (X, Y) => { for (const f of fields) { const h = f.heightAt(X, Y); if (h != null) return h; } return null; };
    const gridSegs = [];
    const drape = (walk) => {
      let prev = null;
      for (const [X, Y] of walk) {
        const h = heightAt(X, Y);
        const p = h == null ? null : toModel(X, Y, h + LIFT);
        if (prev && p) gridSegs.push(...prev, ...p);
        prev = p;
      }
    };
    const span = (a, b) => { const out = []; for (let v = a; v <= b + 1e-9; v += SAMPLE) out.push(v); return out; };
    for (let X = Math.ceil(sx0 / EVERY) * EVERY; X <= sx1; X += EVERY) drape(span(sy0, sy1).map((Y) => [X, Y]));
    for (let Y = Math.ceil(sy0 / EVERY) * EVERY; Y <= sy1; Y += EVERY) drape(span(sx0, sx1).map((X) => [X, Y]));
    o.node.add(tagged(segments(gridSegs, new THREE.LineBasicMaterial({ color: o.col.clone().lerp(WHITE, 0.25), transparent: true, opacity: 0.45 })), 'relief-grid'));

    /* The earthworks. Every relief point that ends up below the survey
       is excavation, and every point the designed ground stands above
       the survey is fill — the land to be added — so both come off the
       same lattice. A hole is a patch of touching cells whose floor runs
       on without a step: the garage pit and the apron dug flush with it
       are one hole; the driveway's band, which meets the apron over the
       slab's 20 cm step, is another; the shallow cut for the back of the
       ground floor a third. Which cut dug a column does not divide it —
       a column belongs to one hole whole, and each cut's share is a line
       on the panel. A fill is the same the other way up, its designed
       top the surface that must run on. Each is one body, roofed and
       floored by its two surfaces and walled wherever a cell in it meets
       one that is not. On tap: its m³, the ground it covers in m², its
       depth or height, each cut's share, and the total over the site. */
    const m3 = (v) => `${fmt(Math.round(v))} m³`;
    const m2 = (a) => `${fmt(Math.round(a * 10) / 10)} m²`;
    /* Every touched point, field by field: k → { cuts, top, bottom },
       the cuts in order and the column between the ground the first
       found and the ground the last left. */
    const gather = (listOf) => {
      const byPoint = new Map();
      for (const c of EXC) {
        for (const [F, pts] of listOf(dug.get(c))) {
          if (!byPoint.has(F)) byPoint.set(F, new Map());
          const m = byPoint.get(F);
          for (const [k, r] of pts) {
            const lo = Math.min(r[0], r[1]), hi = Math.max(r[0], r[1]);
            const q = m.get(k);
            if (q) { q.cuts.push(c); q.top = Math.max(q.top, hi); q.bottom = Math.min(q.bottom, lo); } else m.set(k, { cuts: [c], top: hi, bottom: lo });
          }
        }
      }
      return byPoint;
    };
    /* The patches, grown cell by cell: every touched point seeds one,
       each grows into the neighbours it shares an edge with, and two
       that meet are one. The growth stops at a step: `level` — the
       surface the cuts made — must run on from one point to the next,
       and a jump of more than `steep` cells is a wall between two
       bodies. For a hole that is three-quarters of a cell (a slope past
       about 37°): a slab's 20 cm step parts the ramp's band from the
       apron. A fill's top is a designed grade and may be a batter as
       steep as 70° (2.75 cells), while the near-3 m drop from the yard
       to the driveway still parts the two. Corners alone do not join:
       a step must not leak through diagonally. */
    const patchesOf = (byPoint, level, steep) => {
      const out = [];
      for (const [F, pts] of byPoint) {
        const [nx, ny] = F.size;
        const cellM = Math.sqrt(Math.abs(F.u[0] * F.v[1] - F.u[1] * F.v[0]));
        const seen = new Set();
        for (const k0 of pts.keys()) {
          if (seen.has(k0)) continue;
          const patch = [], stack = [k0];
          seen.add(k0);
          while (stack.length) {
            const k = stack.pop();
            patch.push(k);
            const i = k % nx, j = (k - i) / nx, y = level(pts.get(k));
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const ii = i + di, jj = j + dj;
              if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
              const kk = jj * nx + ii;
              if (!pts.has(kk) || seen.has(kk)) continue;
              if (Math.abs(level(pts.get(kk)) - y) > steep * cellM) continue;
              seen.add(kk);
              stack.push(kk);
            }
          }
          out.push({ F, pts, patch });
        }
      }
      return out;
    };
    /* One body: a patch's cells between two surfaces, `pair(k)` giving
       [top, bottom] as survey heights — the glass over the top, the
       bottom and the walls, the walls' rims as floor lines, and the
       thickness as an upright at the thickest point, with the m³ along
       the bottom from there to the point farthest away in plan. */
    const body = (eo, F, patch, pair, { vol, thick, at, thickLabel, fromTop = false }) => {
      const [nx, ny] = F.size;
      const mine = new Set(patch);
      const full = (k) => k >= 0 && k % nx < nx - 1 && mine.has(k) && mine.has(k + 1) && mine.has(k + nx) && mine.has(k + nx + 1);
      const pos = [], vid = new Map(), rim = [];
      for (const k of patch) {
        const [X, Y] = surveyOf(F, k % nx, Math.floor(k / nx));
        const [top, bottom] = pair(k);
        vid.set(k, pos.length / 6);
        pos.push(...toModel(X, Y, top), ...toModel(X, Y, bottom));
      }
      const idx = [];
      const wall = (p, q) => { idx.push(2 * p, 2 * q, 2 * q + 1, 2 * p, 2 * q + 1, 2 * p + 1); rim.push(pos[6 * p], pos[6 * p + 1], pos[6 * p + 2], pos[6 * q], pos[6 * q + 1], pos[6 * q + 2], pos[6 * p + 3], pos[6 * p + 4], pos[6 * p + 5], pos[6 * q + 3], pos[6 * q + 4], pos[6 * q + 5]); };
      for (const k of patch) {
        if (!full(k)) continue;
        const i = k % nx;
        const a = vid.get(k), b = vid.get(k + 1), d = vid.get(k + nx), e = vid.get(k + nx + 1);
        idx.push(2 * a, 2 * b, 2 * e, 2 * a, 2 * e, 2 * d, 2 * a + 1, 2 * e + 1, 2 * b + 1, 2 * a + 1, 2 * d + 1, 2 * e + 1);
        if (!full(k - nx)) wall(a, b);
        if (i === 0 || !full(k - 1)) wall(a, d);
        if (!full(k + nx)) wall(d, e);
        if (!full(k + 1)) wall(b, e);
      }
      if (idx.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        eo.node.add(tagged(new THREE.Mesh(geo, eo.glass), 'faces'));
        eo.node.add(tagged(segments(rim, eo.line(0.6)), 'floors'));
      }
      /* A metre grid over the body, on the model's own x and z: an
         upright at every node — its height on tap — and the grid's
         lines walked on the floor and on the top. Nothing runs
         diagonally: a line is either a level or a height. The m³ sits
         on the longest run along the floor; the thickest point keeps
         its own upright. */
      const det = F.u[0] * F.v[1] - F.u[1] * F.v[0];
      const sample = (x, z) => {
        const [X, Y] = toSurvey(x, z);
        const dx = X - F.origin[0], dy = Y - F.origin[1];
        const fu = (dx * F.v[1] - dy * F.v[0]) / det, fv = (dy * F.u[0] - dx * F.u[1]) / det;
        const i = Math.floor(fu), j = Math.floor(fv), k = j * nx + i;
        if (i < 0 || j < 0 || i >= nx - 1 || j >= ny - 1 || !full(k)) return null;
        const sx = fu - i, sz = fv - j;
        const w = [(1 - sx) * (1 - sz), sx * (1 - sz), (1 - sx) * sz, sx * sz];
        let top = 0, bottom = 0;
        [k, k + 1, k + nx, k + nx + 1].forEach((kk, n) => { const [a, b] = pair(kk); top += a * w[n]; bottom += b * w[n]; });
        return [top - R.datum, bottom - R.datum];
      };
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let v = 0; v < pos.length; v += 6) { x0 = Math.min(x0, pos[v]); x1 = Math.max(x1, pos[v]); z0 = Math.min(z0, pos[v + 2]); z1 = Math.max(z1, pos[v + 2]); }
      const gridSegs = [], GSTEP = 0.2;
      let longest = null;
      const walk = (pts) => {
        let prev = null, run = null;
        for (const [x, z] of pts) {
          const h = sample(x, z);
          const p = h ? [[x, h[0], z], [x, h[1], z]] : null;
          if (prev && p) {
            gridSegs.push(...prev[0], ...p[0], ...prev[1], ...p[1]);
            run = run || { a: prev[1] };
            run.b = p[1];
            const len = Math.hypot(run.b[0] - run.a[0], run.b[2] - run.a[2]);
            if (!longest || len > longest.len) longest = { ...run, len };
          } else run = null;
          prev = p;
        }
      };
      for (let z = Math.ceil(z0); z <= z1; z++) { const pts = []; for (let x = x0; x <= x1 + 1e-9; x += GSTEP) pts.push([x, z]); walk(pts); }
      for (let x = Math.ceil(x0); x <= x1; x++) { const pts = []; for (let z = z0; z <= z1 + 1e-9; z += GSTEP) pts.push([x, z]); walk(pts); }
      eo.node.add(tagged(segments(gridSegs, eo.line(0.5)), 'edges'));
      /* a pole's metre dots count from its start: up from the floor of
         a hole, down from the top of a fill */
      const pole = (bottom, top, label, quiet) => (fromTop
        ? { a: top, b: bottom, label, quiet, every: 1 }
        : { a: bottom, b: top, label, quiet, every: 1 });
      const ups = [];
      eo.dims = [];
      for (let x = Math.ceil(x0); x <= x1; x++) {
        for (let z = Math.ceil(z0); z <= z1; z++) {
          const h = sample(x, z);
          if (!h || h[0] - h[1] < 0.05) continue;
          ups.push(x, h[1], z, x, h[0], z);
          eo.dims.push(pole([x, h[1], z], [x, h[0], z], `${thickLabel} ${mLabel(h[0] - h[1])}`, true));
        }
      }
      const v0 = vid.get(at);
      const topPt = [pos[6 * v0], pos[6 * v0 + 1], pos[6 * v0 + 2]], bottomPt = [pos[6 * v0 + 3], pos[6 * v0 + 4], pos[6 * v0 + 5]];
      ups.push(...bottomPt, ...topPt);
      eo.node.add(tagged(segments(ups, eo.line(0.95)), 'edges'));
      eo.dims.push(pole(bottomPt, topPt, `${thickLabel} ${mLabel(thick)}`, false));
      if (longest) eo.dims.push({ a: longest.a, b: longest.b, label: m3(vol) });
    };
    /* The bodies of one kind — holes from the lowered points, fills
       from the raised — biggest first, each named for the cut that did
       most of it; two with the same name are told apart by their
       floor or top. */
    const earthwork = ({ list, group, prefix, thickLabel, thickName }) => {
      const kind = prefix === 'dig';
      const patches = patchesOf(gather(list), (q) => (kind ? q.bottom : q.top), kind ? 0.75 : 2.75).map((p) => {
        const { F, pts, patch } = p;
        const cellA = Math.abs(F.u[0] * F.v[1] - F.u[1] * F.v[0]);
        const share = new Map();
        let vol = 0, thick = 0, at = patch[0], lo = Infinity, hi = -Infinity;
        for (const k of patch) {
          const q = pts.get(k), t0 = q.top - q.bottom, lv = (kind ? q.bottom : q.top) - R.datum;
          vol += t0 * cellA;
          lo = Math.min(lo, lv); hi = Math.max(hi, lv);
          if (t0 > thick) { thick = t0; at = k; }
          for (const c of q.cuts) { const r = list(dug.get(c)).get(F).get(k); share.set(c, (share.get(c) || 0) + Math.abs(r[0] - r[1]) * cellA); }
        }
        const cuts = [...share.keys()].sort((a, b) => share.get(b) - share.get(a));
        return { F, pts, patch, cellA, vol, area: patch.length * cellA, thick, at, share, cuts, lo, hi };
      }).filter((p) => p.thick >= 0.05 && p.vol >= 0.5).sort((a, b) => b.vol - a.vol);
      const total = patches.reduce((s, p) => s + p.vol, 0);
      const named = (p) => `${t(kind ? 'Excavation for' : 'Fill under')} ${p.cuts[0].what}`;
      const names = new Map();
      for (const p of patches) names.set(named(p), (names.get(named(p)) || 0) + 1);
      const ids = new Map();
      for (const p of patches) {
        const { F, pts, patch, vol, area, thick, at, share, cuts, lo, hi } = p;
        const base = `${prefix}-${cuts[0].key}`;
        const n = ids.get(base) || 0;
        ids.set(base, n + 1);
        /* the level, when the name alone would not tell two apart */
        const level = hi - lo < 0.05 ? `${fmt(lo)} m` : `${fmt(lo)}…${fmt(hi)} m`;
        const name = names.get(named(p)) > 1 ? `${named(p)} · ${t(kind ? 'floor at' : 'top at')} ${level}` : named(p);
        const eo = makeObject({ id: n ? `${base}-${n + 1}` : base, name, group, opacity: 0.16 });
        /* its poles, wires and labels in its own colour when tapped */
        eo.ink = true;
        body(eo, F, patch, (k) => { const q = pts.get(k); return [q.top, q.bottom]; }, { vol, thick, at, thickLabel, fromTop: !kind });
        eo.props.push(['Volume', m3(vol)], ['Area', m2(area)], [thickName, mLabel(thick)], [kind ? 'Floor' : 'Surface', level]);
        if (cuts.length > 1) for (const c of cuts) eo.props.push([c.what, m3(share.get(c))]);
        if (patches.length > 1) eo.props.push([kind ? 'All excavations' : 'All fill', m3(total)]);
      }
    };
    earthwork({ list: (s) => s.lowered, group: 'excavation', prefix: 'dig', thickLabel: t('depth'), thickName: 'Deepest' });
    earthwork({ list: (s) => s.raised, group: 'fill', prefix: 'fill', thickLabel: 'h', thickName: 'Thickest' });
  }
  /* A contour label's text, in the language of the moment. */
  function paintReliefLabels() {
    for (const s of reliefLabels) {
      s.material.map?.dispose();
      const tex = labelTexture(THREE, tDim(s.userData.text), RELIEF_INK);
      s.material.map = tex;
      s.material.needsUpdate = true;
      s.scale.set(0.5 * (tex.image.width / tex.image.height), 0.5, 1);
    }
  }
  paintReliefLabels();

  /* The dots ride with their object, a shade lighter than its lines. */
  const dotMap = dotTexture(THREE);
  for (const o of objects) {
    if (!o.dotPos.length) continue;
    o.node.add(tagged(new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(o.dotPos, 3)),
      new THREE.PointsMaterial({
        color: o.col.clone().lerp(WHITE, 0.55), size: 5, sizeAttenuation: false,
        map: dotMap, transparent: true, alphaTest: 0.35, depthWrite: false,
      }),
    ), 'dots'));
  }
  scene.add(parts);

  const setLayer = (layer, on) => parts.traverse((n) => { if (n.userData.layer === layer) n.visible = on; });

  const legend = $('legend');

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
    if (CUT) across.push(CUT.to, CUT.to + 0.001);
    if (CUT && typeof CUT.from === 'number') across.push(CUT.from - 0.001, CUT.from);
    /* A cut edge that runs at an angle is met line by line below; its
       bends get a line of their own along the front. */
    if (CUT && typeof CUT.from !== 'number') for (const [d] of CUT.from) { const p = FACE + FRONT.sign * d; if (!along.includes(p)) along.push(p); }
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
  /* Where the cut's near edge is a line at an angle, each grid line
     crossing it takes a sample a hair either side of the crossing, so
     the drop is drawn as a wall there too. */
  const slanted = CUT && typeof CUT.from !== 'number' && FRONT.axis === 'x';
  const withCrossings = (list, crossings) => {
    if (!crossings.length) return list;
    const out = [...list];
    for (const c of crossings) out.push(c - 0.001, c, c + 0.001);
    return out.sort((a, b) => a - b);
  };
  const xCrossings = (z) => {
    const out = [];
    if (!slanted) return out;
    for (let i = 1; i < CUT.from.length; i++) {
      const [d0, a0] = CUT.from[i - 1], [d1, a1] = CUT.from[i];
      if ((a0 - z) * (a1 - z) <= 0 && a0 !== a1) out.push(FACE + FRONT.sign * (d0 + ((z - a0) * (d1 - d0)) / (a1 - a0)));
    }
    return out;
  };
  const zCrossings = (x) => {
    const d = (x - FACE) * FRONT.sign;
    const out = slanted && d >= faceD(cutFrom(d)) ? [cutFrom(d)] : [];
    /* the turned house's east face, between the cut's edge and the corner */
    if (TURN && d < 0 && d >= faceD(cutFrom(d))) out.push(HOUSE_EDGE + d / Math.tan(TURN));
    return out;
  };
  const faceXCrossing = (z) => {
    if (!TURN || z > HOUSE_EDGE) return [];
    const d = faceD(z);
    return z >= cutFrom(d) ? [FACE + FRONT.sign * d] : [];
  };
  for (const z of zs) {
    const line = withCrossings(xs, [...xCrossings(z), ...faceXCrossing(z)]);
    for (let i = 0; i < line.length - 1; i++) {
      gridPts.push(line[i], groundY(line[i], z), z, line[i + 1], groundY(line[i + 1], z), z);
    }
  }
  for (const x of xs) {
    const line = withCrossings(zs, zCrossings(x));
    for (let i = 0; i < line.length - 1; i++) {
      gridPts.push(x, groundY(x, line[i]), line[i], x, groundY(x, line[i + 1]), line[i + 1]);
    }
  }
  ground.add(segments(gridPts, new THREE.LineBasicMaterial({
    color: 0x2a4450, transparent: true, opacity: 0.55,
  })));
  if (TER) scene.add(ground);

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

  /* ── layers, and the settings that keep them ────────── */

  /* Everything that can be shown or hidden is a layer: the drawing's
     own parts, each object group, and the relief's layers from the
     terrain app. The bottom bar's buttons, the legend's chips and the
     checkboxes in Settings are three faces of the same switch. The set
     can be saved on the device and reset to how it ships, as in the
     terrain app. */
  const LAYERS = [];
  /* A layer's shipped default is the engine's unless the scene's
     `defaults.layers` says otherwise. */
  const layer = (id, name, def, apply, section, extra = {}) => {
    const d = PLAN.defaults?.layers?.[id] ?? def;
    LAYERS.push({ id, name, def: d, on: d, apply, section, ...extra });
  };
  layer('faces', 'Facade', true, (v) => setLayer('faces', v), 'Drawing');
  layer('interior', 'Interior floors', true, (v) => setLayer('interior', v), 'Drawing');
  layer('wire', 'Wireframe', true, (v) => setLayer('edges', v), 'Drawing');
  layer('floors', 'Floor lines', true, (v) => setLayer('floors', v), 'Drawing');
  layer('dots', 'Dots', false, (v) => setLayer('dots', v), 'Drawing');
  if (TER) layer('grid', 'Ground grid', true, (v) => { ground.visible = v; }, 'Drawing');
  for (const [key, g] of Object.entries(GROUPS)) {
    if (!objects.some((o) => o.group === key)) continue;
    /* switching a group off also drops a selection in it, so the
       selected body's poles and labels go with it */
    layer(`group:${key}`, g.name, true, (v) => { for (const o of objects) if (o.group === key) o.node.visible = v && !o.hidden; if (!v && selected && selected.group === key) select(null); }, 'Objects', { color: g.color });
  }
  if (reliefLabels.length || objects.some((o) => o.id === 'relief')) {
    /* The surface alone by default; the rest is there to switch on. */
    layer('relief-points', 'Relief points', false, (v) => setLayer('relief-points', v), 'Relief');
    layer('relief-surface', 'Relief surface', true, (v) => setLayer('relief-surface', v), 'Relief');
    const R = RELIEF, cm = R.contours?.minor ?? 0.1, cmj = R.contours?.major ?? 1;
    const ival = (v) => (v < 1 ? `${Math.round(v * 100)} cm` : `${v} m`);
    layer('relief-minor', `Contours ${ival(cm)}`, true, (v) => setLayer('relief-minor', v), 'Relief');
    layer('relief-major', `Contours ${ival(cmj)}`, true, (v) => setLayer('relief-major', v), 'Relief');
    layer('relief-labels', 'Contour labels', true, (v) => setLayer('relief-labels', v), 'Relief');
    layer('relief-grid', 'Relief grid', false, (v) => setLayer('relief-grid', v), 'Relief');
  }

  const SETTINGS_KEY = `planner-settings:${PROJECT.org}/${PROJECT.slug}`;
  let saved = (() => {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      return s?.layers && typeof s.layers === 'object' ? s.layers : null;
    } catch (err) { return null; }
  })();
  const savedOr = (L) => (typeof saved?.[L.id] === 'boolean' ? saved[L.id] : L.def);
  for (const L of LAYERS) L.on = savedOr(L);

  /* ── the dock's tree ────────────────────────────────── */

  /* Section by section: a layer is a row with a checkbox; an object
     group's row opens to its objects (a building's floors under the
     building), each with its own checkbox and a name that, tapped,
     selects it and flies the camera to it. */
  const tree = $('tree');
  const treeRows = new Map();
  const row = ({ name, color = null, kids = false, onName = null }) => {
    const li = document.createElement('li');
    li.className = 'tnode';
    const r = document.createElement('div');
    r.className = 'trow';
    if (color) r.style.setProperty('--c', color);
    const tw = document.createElement('button');
    tw.type = 'button';
    tw.className = `tw${kids ? '' : ' is-leaf'}`;
    tw.tabIndex = kids ? 0 : -1;
    const open = () => li.classList.toggle('is-open');
    if (kids) tw.addEventListener('click', open);
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const nm = document.createElement(onName || kids ? 'button' : 'span');
    nm.className = 'tname';
    if (onName || kids) { nm.type = 'button'; nm.addEventListener('click', onName || open); }
    nm.dataset.i18n = name;
    nm.textContent = t(name);
    r.append(tw, cb, nm);
    li.appendChild(r);
    let ul = null;
    if (kids) { ul = document.createElement('ul'); li.appendChild(ul); }
    return { li, row: r, cb, ul };
  };
  const groupOn = (o) => LAYERS.find((L) => L.id === `group:${o.group}`)?.on ?? true;
  const pathOf = (o) => (!o.parent ? [] : Array.isArray(o.parent) ? o.parent : [o.parent]);
  const objectRows = [];
  function showObject(o, v) {
    o.hidden = !v;
    o.node.visible = groupOn(o) && v;
    if (!v && selected === o) select(null);
    paintObjectRows();
  }
  function paintObjectRows() {
    for (const { o, kids, cb, row: r } of objectRows) {
      if (o) { cb.checked = !o.hidden; r.classList.toggle('is-hidden', o.hidden); continue; }
      const on = kids.filter((k) => !k.hidden).length;
      cb.checked = on === kids.length;
      cb.indeterminate = on > 0 && on < kids.length;
      r.classList.toggle('is-hidden', on === 0);
    }
  }
  const objectRow = (ul, o) => {
    const r = row({ name: o.short, onName: () => goTo([o]) });
    r.cb.addEventListener('change', () => showObject(o, r.cb.checked));
    ul.appendChild(r.li);
    objectRows.push({ o, cb: r.cb, row: r.row });
    treeRows.set(o.id, r);
  };
  let section = null;
  for (const L of LAYERS) {
    if (L.section !== section) {
      section = L.section;
      const head = document.createElement('li');
      head.className = 'tree-head';
      head.dataset.i18n = section;
      head.textContent = t(section);
      tree.appendChild(head);
    }
    const members = L.id.startsWith('group:') ? objects.filter((o) => o.group === L.id.slice(6)) : [];
    /* One object standing for its whole group (the relief) needs no
       row of its own. */
    const listed = members.length === 1 && members[0].id === members[0].group ? [] : members;
    const r = row({ name: L.name, color: L.color, kids: listed.length > 0 });
    L.checkbox = r.cb;
    r.cb.addEventListener('change', () => setLayerOn(L, r.cb.checked));
    tree.appendChild(r.li);
    /* Each step of an object's parent path is a row of its own, made
       once, holding every object whose path passes through it. */
    const keyOf = (path) => path.map((p) => p.id).join('/');
    const nodes = new Map();
    const nodeFor = (path) => {
      if (!path.length) return r;
      const key = keyOf(path);
      let n = nodes.get(key);
      if (!n) {
        const up = nodeFor(path.slice(0, -1));
        const kids = listed.filter((k) => (keyOf(pathOf(k)) + '/').startsWith(key + '/'));
        n = row({ name: path[path.length - 1].name, kids: true, onName: () => goTo(kids) });
        n.cb.addEventListener('change', () => { for (const k of kids) { k.hidden = !n.cb.checked; k.node.visible = groupOn(k) && !k.hidden; } if (!n.cb.checked && kids.includes(selected)) select(null); paintObjectRows(); });
        up.ul.appendChild(n.li);
        objectRows.push({ kids, cb: n.cb, row: n.row });
        nodes.set(key, n);
      }
      return n;
    };
    for (const o of listed) objectRow(nodeFor(pathOf(o)).ul, o);
  }
  paintObjectRows();
  /* The selected object's row lit, its branch opened and scrolled to. */
  function paintTreeSel() {
    for (const [id, r] of treeRows) r.row.classList.toggle('is-sel', selected?.id === id);
    const r = selected && treeRows.get(selected.id);
    if (!r) return;
    for (let n = r.li.parentElement; n && n !== tree; n = n.parentElement) if (n.classList.contains('tnode')) n.classList.add('is-open');
    r.row.scrollIntoView({ block: 'nearest' });
  }
  /* Tapped in the tree: selected, and flown to; on a phone held upright
     the dock lies over the scene, so it folds away to show the flight. */
  function goTo(list) {
    if (list.length === 1 && selected !== list[0]) select(list[0]);
    flyTo(list);
    if (portrait()) setDock('left', false);
  }
  const layersAll = $('layers-all');
  const layersSave = $('layers-save');

  /* Each dock folds to a rail and back; the choices are kept on the
     device, except upright on a phone, where both always start folded.
     The properties dock starts folded everywhere until asked for. */
  const DOCK_KEY = 'planner-dock';
  const portrait = () => window.matchMedia('(orientation: portrait) and (max-width: 700px)').matches;
  const docks = {
    left: { el: $('dock-left'), rail: $('dock-left-open'), fold: $('dock-left-fold'), def: true },
    right: { el: $('dock-right'), rail: $('dock-right-open'), fold: $('dock-right-fold'), def: false },
  };
  const dockState = (() => {
    try { const s = JSON.parse(localStorage.getItem(DOCK_KEY) || 'null'); return s && typeof s === 'object' ? s : {}; } catch (err) { return {}; }
  })();
  function setDock(side, open, remember = false) {
    const d = docks[side];
    d.open = open;
    d.el.hidden = !open;
    d.rail.hidden = open;
    if (remember && !portrait()) {
      dockState[side] = open;
      try { localStorage.setItem(DOCK_KEY, JSON.stringify(dockState)); } catch (err) { /* private mode */ }
    }
  }
  for (const [side, d] of Object.entries(docks)) {
    d.fold.addEventListener('click', () => setDock(side, false, true));
    d.rail.addEventListener('click', () => setDock(side, true, true));
    setDock(side, portrait() ? false : (typeof dockState[side] === 'boolean' ? dockState[side] : d.def));
  }

  /* ── the properties dock ────────────────────────────── */

  /* What the tapped object is: its group and building, the facts the
     model recorded on it (`props`), its extent, and its dimensions as
     the scene labels them. With the dock folded, its rail lights up so
     the properties are one tap away. */
  const propsEl = $('props');
  const propBox = new THREE.Box3();
  function paintProps() {
    docks.right.rail.classList.toggle('is-lit', !!selected);
    propsEl.replaceChildren();
    if (!selected) {
      const p = document.createElement('p');
      p.className = 'props-empty';
      p.textContent = t('Nothing selected. Tap an object in the scene or in the layer tree.');
      propsEl.appendChild(p);
      return;
    }
    const o = selected;
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const rowOf = (label, value) => { const r = el('div', 'props-row'); r.append(el('b', null, t(label)), el('span', null, value)); propsEl.appendChild(r); };
    propsEl.appendChild(el('div', 'props-name', t(o.name)));
    rowOf('Group', t(GROUPS[o.group]?.name || o.group));
    if (o.parent) rowOf('Part of', pathOf(o).map((p) => t(p.name)).join(' · '));
    for (const [k, v] of o.props) rowOf(k, tDim(v));
    propBox.makeEmpty().expandByObject(o.node);
    if (!propBox.isEmpty()) {
      const s = propBox.getSize(new THREE.Vector3());
      rowOf('Extent', tDim(`${fmt(s.x)} × ${fmt(s.z)} × ${fmt(s.y)} m`));
      rowOf('Top', tDim(`${fmt(propBox.max.y)}${PLAN.datum ? ` · ${fmt(propBox.max.y + PLAN.datum)}` : ''} m`));
    }
    rowOf('Id', o.id);
    const dims = (o.dims || []).filter((d) => d.a !== d.b && !d.quiet);
    if (dims.length) {
      propsEl.appendChild(el('div', 'props-sub', t('Dimensions')));
      const ul = el('ul', 'props-dims');
      for (const d of dims) ul.appendChild(el('li', null, tDim(d.label)));
      propsEl.appendChild(ul);
    }
    const actions = el('div', 'props-actions');
    const fly = el('button', 'ghost', t('Fly to'));
    fly.type = 'button';
    fly.addEventListener('click', () => flyTo([o]));
    const hide = el('button', 'ghost', t('Hide'));
    hide.type = 'button';
    hide.addEventListener('click', () => showObject(o, false));
    actions.append(fly, hide);
    propsEl.appendChild(actions);
  }

  /* The bottom bar's buttons and the legend's chips. */
  for (const [id, key] of [['t-faces', 'faces'], ['t-interior', 'interior'], ['t-wire', 'wire'], ['t-floors', 'floors'], ['t-dots', 'dots'], ['t-grid', 'grid']]) {
    const L = LAYERS.find((l) => l.id === key);
    if (!L) { $(id).hidden = true; continue; }
    L.btn = $(id);
    L.btn.addEventListener('click', () => setLayerOn(L, !L.on));
  }
  for (const L of LAYERS) {
    if (!L.id.startsWith('group:')) continue;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.style.setProperty('--c', L.color);
    chip.dataset.name = L.name;
    chip.innerHTML = `<i></i>${t(L.name)}`;
    chip.addEventListener('click', () => setLayerOn(L, !L.on));
    legend.appendChild(chip);
    L.chip = chip;
  }

  function paintLayers() {
    for (const L of LAYERS) {
      L.checkbox.checked = L.on;
      if (L.btn) L.btn.classList.toggle('is-on', L.on);
      if (L.chip) L.chip.classList.toggle('is-off', !L.on);
    }
    const on = LAYERS.filter((L) => L.on).length;
    layersAll.checked = on === LAYERS.length;
    layersAll.indeterminate = on > 0 && on < LAYERS.length;
    layersSave.disabled = LAYERS.every((L) => L.on === savedOr(L));
  }
  function setLayerOn(L, v) {
    L.on = v;
    L.apply(v);
    paintLayers();
  }
  /* All: on if any is off, else off. */
  layersAll.addEventListener('change', () => {
    const v = !LAYERS.every((L) => L.on);
    for (const L of LAYERS) { L.on = v; L.apply(v); }
    paintLayers();
  });
  $('layers-reset').addEventListener('click', () => {
    for (const L of LAYERS) { L.on = L.def; L.apply(L.def); }
    paintLayers();
  });
  layersSave.addEventListener('click', () => {
    saved = Object.fromEntries(LAYERS.map((L) => [L.id, L.on]));
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ layers: saved })); } catch (err) { /* private mode */ }
    paintLayers();
  });
  for (const L of LAYERS) L.apply(L.on);
  paintLayers();

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

  function paintSelection(o, on) {
    o.node.traverse((n) => {
      const layer = n.userData.layer;
      if (layer === 'edges' || layer === 'floors') {
        n.material.color.copy(on ? o.col.clone().lerp(WHITE, 0.6) : o.col);
        n.material.opacity = on ? 1 : (layer === 'edges' ? 0.95 : 0.6);
      } else if (o.solid && (layer === 'faces' || layer === 'interior')) {
        /* A solid lights up from within rather than going paler. */
        n.material.emissive.copy(on ? o.col.clone().multiplyScalar(0.45) : BLACK);
      } else if (layer === 'faces' || layer === 'interior') {
        const base = layer === 'faces' ? o.opacity : o.opacity * 0.4;
        n.material.color.copy(o.col.clone().lerp(WHITE, on ? 0.2 : 0.35));
        n.material.opacity = on ? Math.max(0.22, base + 0.15) : base;
      } else if (layer === 'dots') {
        n.material.color.copy(on ? WHITE : o.col.clone().lerp(WHITE, 0.55));
      }
    });
  }

  function select(o) {
    if (selected) paintSelection(selected, false);
    while (dimGroup.children.length) {
      const c = dimGroup.children.pop();
      if (c.isMesh) { c.material.map.dispose(); c.material.dispose(); } else { c.geometry.dispose(); if (c.material !== dimLineMat && c.material !== dimDotMat) c.material.dispose(); }
    }
    labels.length = 0;
    selected = o && o !== selected ? o : null;
    $('wf-sel').textContent = selected ? t(selected.name) : '';
    paintTreeSel();
    paintProps();
    if (!selected) return;
    paintSelection(selected, true);
    /* The dimensions' ink: the one pale yellow for most things, but an
       earthwork body's own colour, so a fill's poles and wires read
       purple like the fill and a hole's like the hole. */
    const ink = selected.ink ? selected.col.clone().lerp(WHITE, 0.35) : null;
    const lineMat = ink ? new THREE.LineBasicMaterial({ color: ink, transparent: true, opacity: 0.95, depthTest: false }) : dimLineMat;
    const dotMat = ink ? new THREE.PointsMaterial({ color: ink, size: 6, sizeAttenuation: false, map: dotMap, transparent: true, alphaTest: 0.35, depthTest: false, depthWrite: false }) : dimDotMat;
    const inkHex = ink ? `#${ink.getHexString()}` : undefined;
    for (const d of selected.dims || []) {
      dimGroup.add(segments([...d.a, ...d.b], lineMat));
      /* a dot at each end, and, for a line marked `every`, one at each
         such step from its start — a pole reads off metre by metre */
      const dots = [...d.a, ...d.b];
      if (d.every) {
        const len = dist3(d.a, d.b);
        for (let m = d.every; m < len - 1e-6; m += d.every) {
          const f = m / len;
          dots.push(d.a[0] + (d.b[0] - d.a[0]) * f, d.a[1] + (d.b[1] - d.a[1]) * f, d.a[2] + (d.b[2] - d.a[2]) * f);
        }
      }
      dimGroup.add(new THREE.Points(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(dots, 3)),
        dotMat,
      ));
      /* The label lies along its line, in metres, sized to fit inside
         it — small on a small thing, so you zoom in to read it, like
         letters on a grain of rice. It turns about the line to face
         you (see orientLabels), never off it. */
      const tex = labelTexture(THREE, tDim(d.label), inkHex);
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
    for (const o of objects) if (o.node.visible) o.node.traverse((n) => { if ((n.userData.layer === 'faces' || n.userData.layer === 'interior') && n.visible) { n.userData.owner = o; glass.push(n); } });
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
  $('settings-projects').addEventListener('click', (ev) => { ev.preventDefault(); window.location.hash = ''; });
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
    for (const [id, key] of [['dock-left-fold', 'Collapse'], ['dock-left-open', 'Expand'], ['dock-right-fold', 'Collapse'], ['dock-right-open', 'Expand'], ['fs-exit', 'Exit full screen'], ['settings-open', 'Settings']]) { $(id).title = t(key); $(id).setAttribute('aria-label', t(key)); }
    paintFS();
    paintProps();
    setMode(state.mode);
    paintReliefLabels();
    if (selected) { const o = selected; select(null); select(o); }
  }
  for (const b of document.querySelectorAll('#seg-lang .seg-btn')) b.addEventListener('click', () => {
    setLang(b.dataset.lang);
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
    else window.location.hash = '';
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

  /* Fly to one object or several (a building's floors): the camera keeps
     its bearing and glides in until the whole of it fills the view,
     the orbit centred on it. As the camera it turns to face it too. */
  const flyBox = new THREE.Box3();
  function flyTo(list) {
    flyBox.makeEmpty();
    for (const o of list) flyBox.expandByObject(o.node);
    if (flyBox.isEmpty()) return;
    if (state.spin) $('t-spin').click();
    const c = flyBox.getCenter(new THREE.Vector3());
    const r = Math.max(0.6, flyBox.getSize(new THREE.Vector3()).length() / 2);
    const dist = Math.max(controls.minDistance + 0.5, (r / Math.sin((camera.fov * Math.PI) / 360)) * 1.15);
    const dir = state.mode === 'object'
      ? camera.position.clone().sub(controls.target)
      : new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    if (dir.lengthSq() < 1e-6) dir.set(0.75, 0.42, 1);
    dir.normalize();
    /* never from below the ground, and a little above at the least */
    if (dir.y < 0.2) { dir.y = 0.2; dir.normalize(); }
    const to = c.clone().addScaledVector(dir, dist);
    camera.up.set(0, 1, 0);
    tween = { from: camera.position.clone(), to, tFrom: controls.target.clone(), tTo: c, t0: performance.now(), ms: 520 };
    if (state.mode === 'camera') {
      const m = new THREE.Matrix4().lookAt(to, c, camera.up);
      turn = { from: camera.quaternion.clone(), to: new THREE.Quaternion().setFromRotationMatrix(m), t0: performance.now(), ms: 520 };
    }
  }

  /* ── full screen, in two steps ──────────────────────── */

  /* The first press asks the browser for the whole screen and keeps the
     bars and the dock; the second hides those too, so the scene has
     everything, with one small button (or Escape) to come back; the
     third, or leaving full screen any other way, puts it all back. */
  const FS = document.documentElement;
  const isFS = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function paintFS() {
    document.body.classList.toggle('fs-1', state.fs === 1);
    document.body.classList.toggle('fs-2', state.fs === 2);
    const label = t(['Full screen', 'Scene only', 'Exit full screen'][state.fs]);
    $('fs').title = label;
    $('fs').setAttribute('aria-label', label);
  }
  function setFS(stage) {
    state.fs = stage;
    try {
      if (stage > 0 && !isFS()) (FS.requestFullscreen || FS.webkitRequestFullscreen)?.call(FS)?.catch?.(() => {});
      if (stage === 0 && isFS()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
    } catch (err) { /* no full screen here (an iPhone): the stages still fold the chrome */ }
    paintFS();
  }
  $('fs').addEventListener('click', () => setFS((state.fs + 1) % 3));
  $('fs-exit').addEventListener('click', () => setFS(0));
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => { if (!isFS() && state.fs) setFS(0); });
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && state.fs === 2) setFS(0); });

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
  window.houseWire = { THREE, camera, controls, objects, fit, select, flyTo, setFS, setDock };

  renderer.autoClear = false;

  (function loop() {
    requestAnimationFrame(loop);

    if (tween) {
      const k = Math.min(1, (performance.now() - tween.t0) / (tween.ms || 380));
      const ease = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
      camera.position.lerpVectors(tween.from, tween.to, ease);
      if (tween.tTo) controls.target.lerpVectors(tween.tFrom, tween.tTo, ease);
      if (k >= 1) tween = null;
    }
    if (turn) {
      const k = Math.min(1, (performance.now() - turn.t0) / (turn.ms || 380));
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
