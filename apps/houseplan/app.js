/* House Wireframe.
 *
 * Deliberately almost nothing: the house as one box, its floor plates,
 * the vertices as dots, and barely-there glass for the walls. Every
 * dimension comes from window.HOUSE_PLAN, so the box grows into the
 * real thing one primitive at a time.
 *
 * Plan coordinates are (x, y) with y running south; three.js gets
 * (x, elevation, y) — plan y becomes world z throughout.
 */

const PLAN = window.HOUSE_PLAN;
const SLAB = PLAN.slab || 0.2;

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toFixed(2).replace(/\.?0+$/, '');

/* ── what the box is ──────────────────────────────────── */

const levels = PLAN.levels;
const extT = PLAN.extWall ?? 0.3;
const e = PLAN.envelope;

const BOX = {
  x0: e.x0 - extT / 2, x1: e.x1 + extT / 2,
  z0: e.y0 - extT / 2, z1: e.y1 + extT / 2,
  y0: levels[0].elevation - SLAB,
  y1: levels[levels.length - 1].elevation + levels[levels.length - 1].height,
};
BOX.w = BOX.x1 - BOX.x0;
BOX.d = BOX.z1 - BOX.z0;
BOX.h = BOX.y1 - BOX.y0;
BOX.cx = (BOX.x0 + BOX.x1) / 2;
BOX.cy = (BOX.y0 + BOX.y1) / 2;
BOX.cz = (BOX.z0 + BOX.z1) / 2;

/* Every horizontal plate: the underside, each finished floor, the top. */
const plates = [
  BOX.y0,
  ...levels.map((l) => l.elevation),
  BOX.y1,
].filter((y, i, a) => a.indexOf(y) === i).sort((a, b) => a - b);

$('wf-name').textContent = PLAN.name;
$('wf-dims').textContent = `${fmt(BOX.w)} × ${fmt(BOX.d)} × ${fmt(BOX.h)} m · ${levels.length} levels`;

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
  controls.maxDistance = 140;
  controls.autoRotateSpeed = 0.6;
  controls.target.set(BOX.cx, BOX.cy, BOX.cz);

  const LINE = 0x8fd8ff;

  /* ── glass ──────────────────────────────────────────── */

  const faces = new THREE.Mesh(
    new THREE.BoxGeometry(BOX.w, BOX.h, BOX.d),
    new THREE.MeshBasicMaterial({
      color: 0xbfe9ff, transparent: true, opacity: 0.045,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  faces.position.set(BOX.cx, BOX.cy, BOX.cz);
  scene.add(faces);

  /* ── edges of the box ───────────────────────────────── */

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(faces.geometry),
    new THREE.LineBasicMaterial({ color: LINE, transparent: true, opacity: 0.95 }),
  );
  edges.position.copy(faces.position);
  scene.add(edges);

  /* ── floor plates ───────────────────────────────────── */

  const floorPts = [];
  for (const y of plates) {
    if (y === BOX.y0 || y === BOX.y1) continue; // already drawn as box edges
    const c = [
      [BOX.x0, y, BOX.z0], [BOX.x1, y, BOX.z0],
      [BOX.x1, y, BOX.z1], [BOX.x0, y, BOX.z1],
    ];
    for (let i = 0; i < 4; i++) floorPts.push(...c[i], ...c[(i + 1) % 4]);
  }
  const floors = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(floorPts, 3)),
    new THREE.LineBasicMaterial({ color: LINE, transparent: true, opacity: 0.4 }),
  );
  scene.add(floors);

  /* ── dots at every vertex ───────────────────────────── */

  const dotPos = [];
  for (const y of plates) {
    for (const [x, z] of [[BOX.x0, BOX.z0], [BOX.x1, BOX.z0], [BOX.x1, BOX.z1], [BOX.x0, BOX.z1]]) {
      dotPos.push(x, y, z);
    }
  }
  const dots = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(dotPos, 3)),
    new THREE.PointsMaterial({
      color: 0xe8f7ff, size: 7, sizeAttenuation: false,
      map: dotTexture(THREE), transparent: true, alphaTest: 0.35, depthWrite: false,
    }),
  );
  scene.add(dots);

  /* ── ground ─────────────────────────────────────────── */

  const grid = new THREE.GridHelper(60, 60, 0x2a4450, 0x14242c);
  grid.position.set(BOX.cx, BOX.y0, BOX.cz);
  scene.add(grid);

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
  toggle('t-grid', 'grid', (v) => { grid.visible = v; });
  toggle('t-spin', 'spin', (v) => { controls.autoRotate = v; });

  function fit() {
    const r = Math.hypot(BOX.w, BOX.d, BOX.h) / 2;
    const dist = (r / Math.sin((camera.fov * Math.PI / 180) / 2)) * 1.25;
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

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();
  fit();

  (function loop() {
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
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

function hideLoader() {
  const l = $('app-loading');
  if (!l) return;
  l.classList.add('hidden');
  setTimeout(() => l.remove(), 320);
}
