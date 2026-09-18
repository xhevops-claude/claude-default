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

/* One solid per level, stacked without gaps: a level owns the slab
   under it, so its underside meets the top of the level below. A level
   with `extendFront` is pushed out of the downhill face by that much. */
const VOLS = PLAN.levels.map((l) => {
  const out = l.extendFront || 0;
  const v = {
    name: l.name,
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
const span = (key, fn) => fn(...FRAMED.flatMap((v) => [v[key], v[`${key}End`] ?? v[key]]));
const BOX = {
  x0: span('x0', Math.min), x1: span('x1', Math.max),
  z0: span('z0', Math.min), z1: span('z1', Math.max),
  y0: span('y0', Math.min), y1: span('y1', Math.max),
};
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

function sampleProfile(prof, d) {
  let i = 0;
  while (i + 1 < prof.length && prof[i + 1][0] <= d) i++;
  const [d0, y0] = prof[i];
  if (i + 1 >= prof.length || d <= d0) return y0;
  const [d1, y1] = prof[i + 1];
  return y0 + ((y1 - y0) * (d - d0)) / (d1 - d0);
}

/* Ground before the driveway is cut into it: the natural fall, and the
   apron's cut in front of the house. */
function groundBase(x, z) {
  if (!TER) return BOX.y0;
  const along = FRONT.axis === 'x' ? x : z;
  const across = FRONT.axis === 'x' ? z : x;
  const d = (along - FACE) * FRONT.sign;
  if (!CUT || across < CUT.from || across > CUT.to) return sampleProfile(PROFILE, d);
  return sampleProfile(CUT.profile, d);
}

/* The driveway: a Catmull-Rom curve through plan.driveway.path, sampled
   finely, each sample carrying its level and its direction. */
const DRIVE = (() => {
  const dw = PLAN.driveway;
  if (!dw || !dw.path || dw.path.length < 2) return null;
  const P = dw.path.map(([x, z, y]) => ({ x, y, z }));
  const pts = [P[0], ...P, P[P.length - 1]];
  const out = [];
  const cr = (a, b, c, d, t) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  for (let i = 1; i < pts.length - 2; i++) {
    const [a, b, c, d] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
    const len = Math.hypot(c.x - b.x, c.z - b.z);
    const n = Math.max(4, Math.ceil(len / 0.4));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: cr(a.x, b.x, c.x, d.x, t), y: cr(a.y, b.y, c.y, d.y, t), z: cr(a.z, b.z, c.z, d.z, t) });
    }
  }
  out.push({ ...P[P.length - 1] });
  for (let i = 0; i < out.length; i++) {
    const p0 = out[Math.max(0, i - 1)], p1 = out[Math.min(out.length - 1, i + 1)];
    const L = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
    out[i].tx = (p1.x - p0.x) / L;
    out[i].tz = (p1.z - p0.z) / L;
  }
  return { width: dw.width || 3, samples: out, control: P };
})();

/* Where a point stands relative to the driveway: its distance from the
   centreline and the floor level there, from the nearest segment. */
function nearestOnDrive(x, z) {
  let best = { dist: Infinity, y: 0 };
  const S = DRIVE.samples;
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i], b = S[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    const px = a.x + dx * t, pz = a.z + dz * t;
    const dist = Math.hypot(x - px, z - pz);
    if (dist < best.dist) best = { dist, y: a.y + (b.y - a.y) * t };
  }
  return best;
}

function groundY(x, z) {
  if (DRIVE) {
    const n = nearestOnDrive(x, z);
    if (n.dist <= DRIVE.width / 2) return n.y;
  }
  return groundBase(x, z);
}

const pushed = PLAN.levels.find((l) => l.extendFront);
$('wf-name').textContent = PLAN.name;
$('wf-dims').textContent = `${fmt(e.x1 - e.x0)} × ${fmt(e.y1 - e.y0)} × ${fmt(BOX.y1 - BOX.y0)} m`
  + (pushed ? ` · ${pushed.name.toLowerCase()} out ${fmt(pushed.extendFront)} m to ${TER.front}` : '')
  + (TER ? ` · site falls ${fmt(TER.backLevel - PROFILE[PROFILE.length - 1][1])} m` : '');

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

  const LINE = 0x8fd8ff;
  const lineMat = (opacity) => new THREE.LineBasicMaterial({ color: LINE, transparent: true, opacity });
  const segments = (pts, mat) => new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), mat,
  );

  /* ── one box per level ──────────────────────────────── */

  /* Uprights and plates go into separate groups: dropping the plates
     leaves the bare corner sticks, which is a useful thing to look at. */
  const faces = new THREE.Group();
  const edges = new THREE.Group();
  const floors = new THREE.Group();
  const glassMat = new THREE.MeshBasicMaterial({
    color: 0xbfe9ff, transparent: true, opacity: 0.045,
    side: THREE.DoubleSide, depthWrite: false,
  });

  /* Every solid is a prism over a footprint: a bottom ring and a top
     ring of [x, y, z], same length, same order. Uprights join them,
     the rings are the plates, and the glass is the caps (triangulated,
     so a footprint may be concave — the fillet is) plus the sides. */
  const dotPos = [];
  function addVolume(bottom, top, { dots: withDots = true, uprightEvery = 1 } = {}) {
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
    faces.add(new THREE.Mesh(geo, glassMat));

    const uprights = [];
    for (let i = 0; i < n; i++) if (i % uprightEvery === 0) uprights.push(...bottom[i], ...top[i]);
    edges.add(segments(uprights, lineMat(0.95)));

    const rings = [];
    for (const ring of [bottom, top]) {
      for (let i = 0; i < n; i++) rings.push(...ring[i], ...ring[(i + 1) % n]);
    }
    floors.add(segments(rings, lineMat(0.6)));

    if (withDots) for (const ring of [bottom, top]) for (const p of ring) dotPos.push(...p);
  }

  /* A box volume's z1 end may sit lower than its z0 end (y0End / y1End),
     so every corner carries its own bottom and top. */
  for (const v of VOLS) {
    const corners = [[v.x0, v.z0], [v.x1, v.z0], [v.x1, v.z1], [v.x0, v.z1]];
    addVolume(
      corners.map(([x, z]) => [x, z === v.z1 ? v.y0End ?? v.y0 : v.y0, z]),
      corners.map(([x, z]) => [x, z === v.z1 ? v.y1End ?? v.y1 : v.y1, z]),
    );
  }

  /* The driveway: a ribbon swept along the curve, and on each side a
     wall wherever the ground disagrees with the floor — a cut wall
     where the hill stands above it, a fill wall where the ground has
     fallen below. Nothing is drawn where the edge runs over another
     work (the road, the apron), which already own that ground. */
  if (DRIVE) {
    const { width, samples } = DRIVE;
    const half = width / 2;
    const worksXZ = (PLAN.works || []);
    const insideWork = (x, z) => worksXZ.some((w) => x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1);
    const edgeAt = (p, side, off = half) => [p.x - side * p.tz * off, p.z + side * p.tx * off];

    const left = samples.map((p) => edgeAt(p, 1));
    const right = samples.map((p) => edgeAt(p, -1));
    const ring = [...left.map((e, i) => [e, samples[i].y]), ...right.map((e, i) => [e, samples[i].y]).reverse()];
    addVolume(
      ring.map(([[x, z], y]) => [x, y - 0.1, z]),
      ring.map(([[x, z], y]) => [x, y + 0.1, z]),
      { dots: false, uprightEvery: 4 },
    );

    for (const side of [1, -1]) {
      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          const inner = run.map((r) => r.inner), outer = run.map((r) => r.outer);
          const ringXZ = [...inner, ...outer.slice().reverse()];
          const bottoms = [...run.map((r) => r.bottom), ...run.map((r) => r.bottom).reverse()];
          const tops = [...run.map((r) => r.top), ...run.map((r) => r.top).reverse()];
          addVolume(
            ringXZ.map(([x, z], i) => [x, bottoms[i], z]),
            ringXZ.map(([x, z], i) => [x, tops[i], z]),
            { dots: false, uprightEvery: 3 },
          );
        }
        run = [];
      };
      let kind = null;
      for (const p of samples) {
        const [ex, ez] = edgeAt(p, side);
        const natural = groundBase(ex, ez);
        let k = null;
        if (!insideWork(ex, ez)) {
          if (natural > p.y + 0.05) k = 'cut';
          else if (natural < p.y - 0.05) k = 'fill';
        }
        if (k !== kind) { flush(); kind = k; }
        if (k) {
          run.push({
            inner: [ex, ez],
            outer: edgeAt(p, side, half + 0.3),
            bottom: k === 'cut' ? p.y - 0.1 : natural,
            top: k === 'cut' ? natural : p.y + 0.1,
          });
        }
      }
      flush();
    }

    /* The control points are the handles you edit, so they get dots. */
    for (const c of DRIVE.control) dotPos.push(c.x, c.y + 0.1, c.z);
  }
  scene.add(faces, edges, floors);

  const dots = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(dotPos, 3)),
    new THREE.PointsMaterial({
      color: 0xe8f7ff, size: 7, sizeAttenuation: false,
      map: dotTexture(THREE), transparent: true, alphaTest: 0.35, depthWrite: false,
    }),
  );
  scene.add(dots);

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
  toggle('t-faces', 'faces', (v) => { faces.visible = v; });
  toggle('t-floors', 'floors', (v) => { floors.visible = v; });
  toggle('t-dots', 'dots', (v) => { dots.visible = v; });
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
