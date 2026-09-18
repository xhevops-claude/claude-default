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

const span = (key, fn) => fn(...VOLS.map((v) => v[key]));
const BOX = {
  x0: span('x0', Math.min), x1: span('x1', Math.max),
  z0: span('z0', Math.min), z1: span('z1', Math.max),
  y0: span('y0', Math.min), y1: span('y1', Math.max),
};
BOX.cx = (BOX.x0 + BOX.x1) / 2;
BOX.cy = (BOX.y0 + BOX.y1) / 2;
BOX.cz = (BOX.z0 + BOX.z1) / 2;
BOX.r = Math.hypot(BOX.x1 - BOX.x0, BOX.y1 - BOX.y0, BOX.z1 - BOX.z0) / 2;

/* Ground level at a point. Level under the whole envelope, then it
   breaks at the downhill face and falls at `angle` until it has
   dropped `drop`, then level again. At 45° a 3 m drop runs 3 m — the
   width of what the garage pushes out — so the fall cuts that part
   diagonally: earth meets the outer edge of its floor, and its ceiling
   stands the full 3 m out in the air. */
const RAMP = (() => {
  if (!TER) return null;
  const run = TER.drop / Math.tan((TER.angle ?? 45) * Math.PI / 180);
  const face = FRONT.axis === 'x'
    ? (FRONT.sign > 0 ? e.x1 : e.x0)
    : (FRONT.sign > 0 ? e.y1 : e.y0);
  return { face, run, toe: face + FRONT.sign * run };
})();

function groundY(x, z) {
  if (!TER) return BOX.y0;
  const p = FRONT.axis === 'x' ? x : z;
  const t = ((p - RAMP.face) * FRONT.sign) / RAMP.run;
  return TER.backLevel - TER.drop * Math.min(1, Math.max(0, t));
}

const pushed = PLAN.levels.find((l) => l.extendFront);
$('wf-name').textContent = PLAN.name;
$('wf-dims').textContent = `${fmt(e.x1 - e.x0)} × ${fmt(e.y1 - e.y0)} × ${fmt(BOX.y1 - BOX.y0)} m`
  + (pushed ? ` · ${pushed.name.toLowerCase()} out ${fmt(pushed.extendFront)} m to ${TER.front}` : '')
  + (TER ? ` · site falls ${fmt(TER.drop)} m at ${fmt(TER.angle ?? 45)}°` : '');

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

  const dotPos = [];
  for (const v of VOLS) {
    const corners = [[v.x0, v.z0], [v.x1, v.z0], [v.x1, v.z1], [v.x0, v.z1]];

    const glass = new THREE.Mesh(new THREE.BoxGeometry(v.x1 - v.x0, v.y1 - v.y0, v.z1 - v.z0), glassMat);
    glass.position.set((v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2, (v.z0 + v.z1) / 2);
    faces.add(glass);

    const uprights = [];
    for (const [x, z] of corners) uprights.push(x, v.y0, z, x, v.y1, z);
    edges.add(segments(uprights, lineMat(0.95)));

    const plates = [];
    for (const y of [v.y0, v.y1]) {
      for (let i = 0; i < 4; i++) {
        plates.push(corners[i][0], y, corners[i][1], corners[(i + 1) % 4][0], y, corners[(i + 1) % 4][1]);
      }
    }
    floors.add(segments(plates, lineMat(0.6)));

    for (const y of [v.y0, v.y1]) for (const [x, z] of corners) dotPos.push(x, y, z);
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
  /* Sample the ramp's shoulders too, or they get rounded off. */
  if (RAMP) {
    const along = FRONT.axis === 'x' ? xs : zs;
    for (const p of [RAMP.face, RAMP.toe]) if (!along.includes(p)) along.push(p);
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
