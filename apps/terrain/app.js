// Terrain — upload a points-with-elevation text file, get a 3D mesh.
// Coordinates are centered on their XY midpoint and the lowest
// elevation is anchored at Y=0 so the surface sits on the floor of
// the viewport regardless of the file's absolute UTM/Gauss-Krüger
// range.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import Delaunator from 'delaunator';

const canvasWrap = document.getElementById('canvas-wrap');
const hint       = document.getElementById('hint');
const readout    = document.getElementById('readout');
const readoutName     = document.getElementById('readout-name');
const readoutCount    = document.getElementById('readout-count');
const readoutElev     = document.getElementById('readout-elev');
const readoutDz       = document.getElementById('readout-dz');
const readoutFootprint = document.getElementById('readout-footprint');
const readoutSurface  = document.getElementById('readout-surface');
const readoutDensity  = document.getElementById('readout-density');
const readoutGrid     = document.getElementById('readout-grid');
const fileInput  = document.getElementById('file-input');
const uploadBtn  = document.getElementById('upload-btn');
const sampleBtn  = document.getElementById('sample-btn');
const resetBtn   = document.getElementById('reset-btn');
const quitBtn    = document.getElementById('quit-btn');
const errorEl    = document.getElementById('error');
const loading    = document.getElementById('app-loading');

// ---- Loader fade ----
// Hold the loader for at least 3 s (the project pattern) before
// fading; if module + script took longer, the await above already
// passed and we fade on the next frame.
const loadStart = performance.now();
const MIN_LOADER_MS = 3000;
function hideLoader() {
  const wait = Math.max(0, MIN_LOADER_MS - (performance.now() - loadStart));
  setTimeout(() => {
    loading.classList.add('hidden');
    // Only fall back to the "upload a file" hint if the auto-load
    // didn't beat us to it.
    if (!currentMesh) hint.hidden = false;
    setTimeout(() => loading.remove(), 600);
  }, wait);
}

// ---- Scene ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1118);
scene.fog = new THREE.Fog(0x0c1118, 6, 14);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
camera.position.set(1.6, 1.4, 1.6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
canvasWrap.appendChild(renderer.domElement);

const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffffff, 0.95);
sun.position.set(2.5, 4, 1.8);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x6699cc, 0.35);
fill.position.set(-2, 1.5, -2);
scene.add(fill);

// Subtle ground grid so the model has a sense of scale before it
// rotates.
// Generic fallback grid — visible until a dataset loads, at which
// point the coord-aligned grid built inside buildMesh takes over.
const fallbackGrid = new THREE.GridHelper(4, 16, 0x223040, 0x18222e);
fallbackGrid.position.y = -0.005;
scene.add(fallbackGrid);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.4;
controls.maxDistance = 8;
// Allow full pitch — looking down from directly above is useful for
// a heightmap, looking up from below is fine too.
controls.minPolarAngle = 0.01;
controls.maxPolarAngle = Math.PI - 0.01;

function resize() {
  const w = canvasWrap.clientWidth;
  const h = canvasWrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let currentMesh = null;
let homeCamera = null;

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
hideLoader();

// ---- File parsing ----
// Tab- or space-separated columns. Header rows / non-numeric junk
// are skipped. The last three numeric columns are interpreted as
// (x, y, elevation); an optional leading id column is ignored.
function parsePoints(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cols = line.split(/[\s,;]+/);
    if (cols.length < 3) continue;
    const nums = [];
    for (const c of cols) {
      const n = Number(c.replace(',', '.'));
      if (Number.isFinite(n)) nums.push(n);
    }
    if (nums.length < 3) continue;
    out.push([
      nums[nums.length - 3],
      nums[nums.length - 2],
      nums[nums.length - 1],
    ]);
  }
  return out;
}

// ---- Mesh build ----
// Center XY on the dataset midpoint, anchor Z at the min elevation,
// scale uniformly so the longer XY extent fits in 2 world units
// (i.e. [-1, +1]). Uniform scale keeps vertical relief honest; we
// don't exaggerate it.
function buildMesh(points) {
  let minX =  Infinity, maxX = -Infinity;
  let minY =  Infinity, maxY = -Infinity;
  let minZ =  Infinity, maxZ = -Infinity;
  for (const [x, y, z] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = 2 / Math.max(spanX, spanY);

  // Delaunay triangulation in the XY plane.
  const coords = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    coords[i * 2]     = points[i][0];
    coords[i * 2 + 1] = points[i][1];
  }
  const delaunay = new Delaunator(coords);
  const triangles = delaunay.triangles;

  // BufferGeometry: positions + per-vertex colours (gradient by
  // normalised elevation). Three.js Y is up; we store (x, z, y).
  const positions = new Float32Array(points.length * 3);
  const colors    = new Float32Array(points.length * 3);
  const zSpan = Math.max(maxZ - minZ, 1e-6);
  for (let i = 0; i < points.length; i++) {
    const px = (points[i][0] - cx) * scale;
    const pz = (points[i][1] - cy) * scale;
    const py = (points[i][2] - minZ) * scale;
    positions[i * 3]     = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;
    const t = (points[i][2] - minZ) / zSpan;
    const c = elevationColor(t);
    colors[i * 3]     = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(triangles), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0.0,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = { minZ, maxZ, scale };

  // Areas computed in the file's native units (so if those units are
  // metres, the numbers are m² straight off). The 2D footprint is
  // the sum of triangle areas projected to the XY plane — for a
  // gridded scan this equals the triangulated convex hull's area,
  // which is what the user actually sees from above. The 3D surface
  // area uses the real triangle areas (so steeper terrain reports a
  // larger surface than its footprint, as expected).
  let footprint = 0;
  let surface = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const i = triangles[t], j = triangles[t + 1], k = triangles[t + 2];
    const ax = points[i][0], ay = points[i][1], az = points[i][2];
    const bx = points[j][0], by = points[j][1], bz = points[j][2];
    const cxp = points[k][0], cyp = points[k][1], cz = points[k][2];
    // 2D area = ½ |(b - a) × (c - a)|_z
    footprint += Math.abs((bx - ax) * (cyp - ay) - (by - ay) * (cxp - ax)) * 0.5;
    // 3D area = ½ |(b - a) × (c - a)|
    const ux = bx - ax,  uy = by - ay,  uz = bz - az;
    const vx = cxp - ax, vy = cyp - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    surface += Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5;
  }

  // Topographic contours every 1 m of native elevation. Marching
  // triangles: for each contour level, walk every triangle and emit
  // segments where the level intersects two of its edges. Lifted a
  // hair above the surface in Y to avoid z-fighting with the mesh.
  // Major contours (every 5 m) get their own object so they render
  // darker — same convention as printed topo maps.
  const MINOR_INTERVAL = 1;
  const MAJOR_EVERY = 5;
  const minorSegs = [];
  const majorSegs = [];
  const Z_LIFT = 0.0015;
  const startLevel = Math.ceil(minZ / MINOR_INTERVAL) * MINOR_INTERVAL;
  const endLevel = Math.floor(maxZ / MINOR_INTERVAL) * MINOR_INTERVAL;
  for (let level = startLevel; level <= endLevel + 1e-9; level += MINOR_INTERVAL) {
    const yLevel = (level - minZ) * scale;
    const isMajor = Math.abs(level / MAJOR_EVERY - Math.round(level / MAJOR_EVERY)) < 1e-6;
    const target = isMajor ? majorSegs : minorSegs;
    for (let t = 0; t < triangles.length; t += 3) {
      const ia = triangles[t], ib = triangles[t + 1], ic = triangles[t + 2];
      const ya = positions[ia * 3 + 1];
      const yb = positions[ib * 3 + 1];
      const yc = positions[ic * 3 + 1];
      // Skip triangles entirely above or below the level.
      if ((ya < yLevel && yb < yLevel && yc < yLevel) ||
          (ya > yLevel && yb > yLevel && yc > yLevel)) continue;
      const xs = [];
      const zs = [];
      crossEdge(positions, ia, ib, yLevel, xs, zs);
      crossEdge(positions, ib, ic, yLevel, xs, zs);
      crossEdge(positions, ic, ia, yLevel, xs, zs);
      if (xs.length >= 2) {
        target.push(xs[0], yLevel + Z_LIFT, zs[0],
                    xs[1], yLevel + Z_LIFT, zs[1]);
      }
    }
  }

  function buildContourLines(segs, color, opacity) {
    if (!segs.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs), 3));
    const m = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
    const line = new THREE.LineSegments(g, m);
    line.renderOrder = 1;
    return line;
  }
  const minorLines = buildContourLines(minorSegs, 0x0a0d12, 0.55);
  const majorLines = buildContourLines(majorSegs, 0x0a0d12, 0.95);

  // Coordinate grid — X/Y lines on the floor plane (Y = small
  // negative so the mesh sits on top). Spacing is a "nice" round
  // number (1, 2, 5 × 10^N) chosen so the longer axis gets roughly
  // 8–15 divisions. Lines are anchored to absolute coordinates
  // (e.g. X = 7466320, 7466330…), so the grid literally "looks
  // like the coordinates themselves" — each crossing identifies a
  // real point in the source CRS. Major every 5 minor steps, with
  // its own object so it can render darker. Extends a small margin
  // past the data bounds so the grid stays visible from above.
  const spanXm = maxX - minX;
  const spanYm = maxY - minY;
  const gridStep = pickNiceStep(Math.max(spanXm, spanYm) / 10);
  const gridMargin = Math.max(spanXm, spanYm) * 0.04 * scale;
  const gridY = -0.002;
  const gridMinor = [];
  const gridMajor = [];
  const gridMajorEvery = 5;
  const xStart = Math.ceil(minX / gridStep) * gridStep;
  for (let X = xStart; X <= maxX + 1e-9; X += gridStep) {
    const px = (X - cx) * scale;
    const z0 = (minY - cy) * scale - gridMargin;
    const z1 = (maxY - cy) * scale + gridMargin;
    const isMajor = Math.abs(X / gridStep / gridMajorEvery - Math.round(X / gridStep / gridMajorEvery)) < 1e-6;
    (isMajor ? gridMajor : gridMinor).push(px, gridY, z0, px, gridY, z1);
  }
  const yStart = Math.ceil(minY / gridStep) * gridStep;
  for (let Y = yStart; Y <= maxY + 1e-9; Y += gridStep) {
    const pz = (Y - cy) * scale;
    const x0 = (minX - cx) * scale - gridMargin;
    const x1 = (maxX - cx) * scale + gridMargin;
    const isMajor = Math.abs(Y / gridStep / gridMajorEvery - Math.round(Y / gridStep / gridMajorEvery)) < 1e-6;
    (isMajor ? gridMajor : gridMinor).push(x0, gridY, pz, x1, gridY, pz);
  }
  const gridMinorLines = buildContourLines(gridMinor, 0x4a5b6e, 0.35);
  const gridMajorLines = buildContourLines(gridMajor, 0x8aa1b8, 0.7);

  // Draped grid — same X/Y values, but each line is computed by
  // marching triangles against a vertical plane (constant X for one
  // family, constant Y for the other) so the line follows the
  // terrain surface. Without this the floor grid above is hidden by
  // the mesh from anything but a side-on view. Lifted slightly less
  // than the elevation contours so contours render on top of grid
  // crossings.
  const drapeMinor = [];
  const drapeMajor = [];
  const DRAPE_LIFT = 0.0012;

  function drapeXEdge(i0, i1, X, hits) {
    const x0 = points[i0][0], x1 = points[i1][0];
    if ((x0 < X && x1 < X) || (x0 > X && x1 > X)) return;
    if (x0 === x1) return;
    const tt = (X - x0) / (x1 - x0);
    const yo = points[i0][1] + (points[i1][1] - points[i0][1]) * tt;
    const zo = points[i0][2] + (points[i1][2] - points[i0][2]) * tt;
    hits.push(
      (X - cx) * scale,
      (zo - minZ) * scale + DRAPE_LIFT,
      (yo - cy) * scale,
    );
  }
  function drapeYEdge(i0, i1, Y, hits) {
    const y0 = points[i0][1], y1 = points[i1][1];
    if ((y0 < Y && y1 < Y) || (y0 > Y && y1 > Y)) return;
    if (y0 === y1) return;
    const tt = (Y - y0) / (y1 - y0);
    const xo = points[i0][0] + (points[i1][0] - points[i0][0]) * tt;
    const zo = points[i0][2] + (points[i1][2] - points[i0][2]) * tt;
    hits.push(
      (xo - cx) * scale,
      (zo - minZ) * scale + DRAPE_LIFT,
      (Y - cy) * scale,
    );
  }
  // Constant-X grid lines (run along the data's Y axis).
  for (let X = xStart; X <= maxX + 1e-9; X += gridStep) {
    const isMajor = Math.abs(X / gridStep / gridMajorEvery - Math.round(X / gridStep / gridMajorEvery)) < 1e-6;
    const target = isMajor ? drapeMajor : drapeMinor;
    for (let t = 0; t < triangles.length; t += 3) {
      const ia = triangles[t], ib = triangles[t + 1], ic = triangles[t + 2];
      const xa = points[ia][0], xb = points[ib][0], xc = points[ic][0];
      if ((xa < X && xb < X && xc < X) || (xa > X && xb > X && xc > X)) continue;
      const hits = [];
      drapeXEdge(ia, ib, X, hits);
      drapeXEdge(ib, ic, X, hits);
      drapeXEdge(ic, ia, X, hits);
      if (hits.length >= 6) target.push(hits[0], hits[1], hits[2], hits[3], hits[4], hits[5]);
    }
  }
  // Constant-Y grid lines (run along the data's X axis).
  for (let Y = yStart; Y <= maxY + 1e-9; Y += gridStep) {
    const isMajor = Math.abs(Y / gridStep / gridMajorEvery - Math.round(Y / gridStep / gridMajorEvery)) < 1e-6;
    const target = isMajor ? drapeMajor : drapeMinor;
    for (let t = 0; t < triangles.length; t += 3) {
      const ia = triangles[t], ib = triangles[t + 1], ic = triangles[t + 2];
      const ya = points[ia][1], yb = points[ib][1], yc = points[ic][1];
      if ((ya < Y && yb < Y && yc < Y) || (ya > Y && yb > Y && yc > Y)) continue;
      const hits = [];
      drapeYEdge(ia, ib, Y, hits);
      drapeYEdge(ib, ic, Y, hits);
      drapeYEdge(ic, ia, Y, hits);
      if (hits.length >= 6) target.push(hits[0], hits[1], hits[2], hits[3], hits[4], hits[5]);
    }
  }
  // Cool-blue tint so draped grid reads as a different layer from
  // the warm-gray elevation contours.
  const drapeMinorLines = buildContourLines(drapeMinor, 0x3d5063, 0.55);
  const drapeMajorLines = buildContourLines(drapeMajor, 0x6e90b0, 0.9);

  const group = new THREE.Group();
  group.add(mesh);
  if (gridMinorLines) group.add(gridMinorLines);
  if (gridMajorLines) group.add(gridMajorLines);
  if (drapeMinorLines) group.add(drapeMinorLines);
  if (drapeMajorLines) group.add(drapeMajorLines);
  if (minorLines) group.add(minorLines);
  if (majorLines) group.add(majorLines);
  group.userData = { mesh, minorLines, majorLines, gridMinorLines, gridMajorLines, drapeMinorLines, drapeMajorLines };

  return {
    group,
    mesh,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
    triangleCount: triangles.length / 3,
    contourCount: minorSegs.length / 6 + majorSegs.length / 6,
    gridStep,
    footprint,
    surface,
    density: footprint > 0 ? points.length / footprint : 0,
  };
}

// Pick a "nice" round-number step (1, 2, 5 × 10^N) close to the
// requested target. Keeps grid spacing legible across datasets that
// span anywhere from a single field to a whole valley.
function pickNiceStep(target) {
  if (target <= 0) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(target)));
  const norm = target / power;
  if (norm < 1.5) return power;
  if (norm < 3.5) return 2 * power;
  if (norm < 7.5) return 5 * power;
  return 10 * power;
}

// Interpolates the intersection of `yLevel` with the edge between
// vertices i0 and i1, appending the (x, z) of the hit to `xs`/`zs`.
// No-op if the edge is entirely on one side or exactly horizontal at
// the level (the adjacent edges will already register the crossing).
function crossEdge(positions, i0, i1, yLevel, xs, zs) {
  const y0 = positions[i0 * 3 + 1];
  const y1 = positions[i1 * 3 + 1];
  if ((y0 < yLevel && y1 < yLevel) || (y0 > yLevel && y1 > yLevel)) return;
  if (y0 === y1) return;
  const t = (yLevel - y0) / (y1 - y0);
  const x0 = positions[i0 * 3];
  const z0 = positions[i0 * 3 + 2];
  const x1 = positions[i1 * 3];
  const z1 = positions[i1 * 3 + 2];
  xs.push(x0 + (x1 - x0) * t);
  zs.push(z0 + (z1 - z0) * t);
}

// Discrete-ish ramp: deep green → meadow green → tan → rock → snow.
function elevationColor(t) {
  const stops = [
    [0.00, [0.16, 0.32, 0.20]],
    [0.30, [0.32, 0.55, 0.28]],
    [0.55, [0.62, 0.58, 0.32]],
    [0.80, [0.55, 0.45, 0.38]],
    [1.00, [0.95, 0.96, 0.98]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1];
      const b = stops[i];
      const u = (t - a[0]) / Math.max(b[0] - a[0], 1e-6);
      return {
        r: a[1][0] + (b[1][0] - a[1][0]) * u,
        g: a[1][1] + (b[1][1] - a[1][1]) * u,
        b: a[1][2] + (b[1][2] - a[1][2]) * u,
      };
    }
  }
  return { r: 1, g: 1, b: 1 };
}

function frameMesh(mesh) {
  const s = mesh.geometry.boundingSphere;
  if (!s) return;
  const fov = camera.fov * Math.PI / 180;
  const dist = s.radius / Math.sin(fov / 2) * 1.1;
  const eye = new THREE.Vector3(
    s.center.x + dist * 0.7,
    s.center.y + dist * 0.55,
    s.center.z + dist * 0.7,
  );
  camera.position.copy(eye);
  controls.target.copy(s.center);
  controls.update();
  homeCamera = { position: eye.clone(), target: s.center.clone() };
}

// Switches to hectares (ha) once the value clears 10 000 m² so the
// number stays human-readable for larger scans.
function fmtArea(m2) {
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(2)} ha`;
  return `${Math.round(m2).toLocaleString()} m²`;
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
  clearTimeout(showError._t);
  showError._t = setTimeout(() => { errorEl.hidden = true; }, 4000);
}

async function loadFile(file) {
  try {
    const text = await file.text();
    const points = parsePoints(text);
    if (points.length < 3) {
      showError('Need at least 3 numeric rows. Check the file format.');
      return;
    }
    const t0 = performance.now();
    const built = buildMesh(points);
    const t1 = performance.now();
    if (currentMesh) {
      scene.remove(currentMesh);
      currentMesh.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }
    currentMesh = built.group;
    scene.add(currentMesh);
    fallbackGrid.visible = false;
    frameMesh(built.mesh);
    hint.hidden = true;
    readout.hidden = false;
    resetBtn.hidden = false;
    readoutName.textContent = file.name;
    const b = built.bounds;
    readoutCount.textContent =
      `${points.length.toLocaleString()} pts · ` +
      `${built.triangleCount.toLocaleString()} tris · ` +
      `${built.contourCount.toLocaleString()} contour segs · ` +
      `${Math.round(t1 - t0)} ms`;
    readoutElev.textContent      = `${b.minZ.toFixed(2)} – ${b.maxZ.toFixed(2)} m`;
    readoutDz.textContent        = `${(b.maxZ - b.minZ).toFixed(2)} m`;
    readoutFootprint.textContent = `${fmtArea(built.footprint)} (${(b.maxX - b.minX).toFixed(1)} × ${(b.maxY - b.minY).toFixed(1)} m)`;
    readoutSurface.textContent   = fmtArea(built.surface);
    readoutDensity.textContent   = `${built.density.toFixed(2)} pt/m²`;
    readoutGrid.textContent      = `${built.gridStep} m`;
  } catch (e) {
    showError('Could not read file: ' + (e && e.message || e));
  }
}

uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const f = fileInput.files && fileInput.files[0];
  if (f) loadFile(f);
  fileInput.value = '';
});

// Bundled samples live in apps/terrain/sample-files/. For now the
// Sample button is single-action (Trebishte); when there's more than
// one file in that folder, swap this for a picker.
async function loadBundledSample(path, displayName) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    await loadFile(new File([blob], displayName, { type: 'text/plain' }));
  } catch (e) {
    showError('Could not load sample: ' + (e && e.message || e));
  }
}
sampleBtn.addEventListener('click', () => {
  loadBundledSample('sample-files/trebishte.txt', 'trebishte.txt');
});

// Open the bundled Trebishte plot on first launch so the user lands
// on a populated viewport instead of an empty grid. Sample / Upload
// remain available to swap to a different file.
loadBundledSample('sample-files/trebishte.txt', 'trebishte.txt');

resetBtn.addEventListener('click', () => {
  if (!homeCamera) return;
  camera.position.copy(homeCamera.position);
  controls.target.copy(homeCamera.target);
  controls.update();
});

// Drag-and-drop a file anywhere on the viewport.
['dragover', 'drop'].forEach((ev) => {
  window.addEventListener(ev, (e) => { e.preventDefault(); });
});
window.addEventListener('drop', (e) => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});

// Quit — bubbles up to the shell when embedded, or returns to the
// shell root when standalone.
quitBtn.addEventListener('click', () => {
  if (window.self !== window.top) {
    window.parent.postMessage({ type: 'close-game' }, '*');
  } else {
    location.href = '../../';
  }
});
