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

const span = (key, fn) => fn(...VOLS.flatMap((v) => [v[key], v[`${key}End`] ?? v[key]]));
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

function groundY(x, z) {
  if (!TER) return BOX.y0;
  const along = FRONT.axis === 'x' ? x : z;
  const across = FRONT.axis === 'x' ? z : x;
  const d = (along - FACE) * FRONT.sign;
  if (!CUT || across < CUT.from || across > CUT.to) return sampleProfile(PROFILE, d);
  const base = sampleProfile(CUT.profile, d);
  if (d < 0 || !CUT.ramp) return base;
  const r = CUT.ramp;
  const t = Math.min(1, Math.max(0, (across - r.from) / (r.to - r.from)));
  if (t > 0 && d < (r.dFrom ?? 0)) return sampleProfile(PROFILE, d);
  return Math.max(base - r.drop * t, CUT.profile[CUT.profile.length - 1][1]);
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

  /* A volume's z1 end may sit lower than its z0 end (y0End / y1End),
     so every corner carries its own bottom and top. */
  const dotPos = [];
  for (const v of VOLS) {
    const corners = [[v.x0, v.z0], [v.x1, v.z0], [v.x1, v.z1], [v.x0, v.z1]];
    const bot = corners.map(([, z]) => (z === v.z1 ? v.y0End ?? v.y0 : v.y0));
    const top = corners.map(([, z]) => (z === v.z1 ? v.y1End ?? v.y1 : v.y1));

    faces.add(new THREE.Mesh(hexa(THREE, corners, bot, top), glassMat));

    const uprights = [];
    corners.forEach(([x, z], i) => uprights.push(x, bot[i], z, x, top[i], z));
    edges.add(segments(uprights, lineMat(0.95)));

    const plates = [];
    for (const ys of [bot, top]) {
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        plates.push(corners[i][0], ys[i], corners[i][1], corners[j][0], ys[j], corners[j][1]);
      }
    }
    floors.add(segments(plates, lineMat(0.6)));

    for (const ys of [bot, top]) corners.forEach(([x, z], i) => dotPos.push(x, ys[i], z));
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
    if (CUT?.ramp) {
      across.push(CUT.ramp.from, CUT.ramp.to);
      const p = FACE + FRONT.sign * (CUT.ramp.dFrom ?? 0);
      along.push(p - FRONT.sign * 0.001, p);
    }
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

/* Six faces over four bottom and four top corners — a box whose ends
   need not be level. Winding is irrelevant: the glass is double-sided
   and unlit. */
function hexa(THREE, corners, bot, top) {
  const v = [];
  corners.forEach(([x, z], i) => v.push(x, bot[i], z));
  corners.forEach(([x, z], i) => v.push(x, top[i], z));
  const idx = [
    0, 1, 2, 0, 2, 3,   // bottom
    4, 5, 6, 4, 6, 7,   // top
  ];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    idx.push(i, j, j + 4, i, j + 4, i + 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.setIndex(idx);
  return geo;
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
