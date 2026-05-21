// Terrain — upload a points-with-elevation text file, get a 3D mesh.
// Coordinates are centered on their XY midpoint and the lowest
// elevation is anchored at Y=0 so the surface sits on the floor of
// the viewport regardless of the file's absolute UTM/Gauss-Krüger
// range.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter }  from 'three/addons/exporters/OBJExporter.js';
import Delaunator from 'delaunator';
import DxfParser from 'dxf-parser';

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
const parcelBtn  = document.getElementById('parcel-btn');
const parcelInput = document.getElementById('parcel-input');
const resetBtn   = document.getElementById('reset-btn');
const quitBtn    = document.getElementById('quit-btn');
const errorEl    = document.getElementById('error');
const loading    = document.getElementById('app-loading');
const layersPanel = document.getElementById('layers');
const layersList  = document.getElementById('layers-list');
const layersMaster = document.getElementById('layers-master');
const layersReset  = document.getElementById('layers-reset');
const exportBtn   = document.getElementById('export-btn');
const exportMenu  = document.getElementById('export-menu');
const dbgLabelOffset    = document.getElementById('dbg-label-offset');
const dbgLabelOffsetVal = document.getElementById('dbg-label-offset-val');
const dbgLabelSize      = document.getElementById('dbg-label-size');
const dbgLabelSizeVal   = document.getElementById('dbg-label-size-val');
const dbgGrid3DRotZ     = document.getElementById('dbg-grid3d-rotz');
const dbgGrid3DRotZVal  = document.getElementById('dbg-grid3d-rotz-val');
const dbgGrid3DOffX     = document.getElementById('dbg-grid3d-offx');
const dbgGrid3DOffXVal  = document.getElementById('dbg-grid3d-offx-val');
const dbgGrid3DOffY     = document.getElementById('dbg-grid3d-offy');
const dbgGrid3DOffYVal  = document.getElementById('dbg-grid3d-offy-val');
const dbgGrid3DOffZ     = document.getElementById('dbg-grid3d-offz');
const dbgGrid3DOffZVal  = document.getElementById('dbg-grid3d-offz-val');
const dbgGridSurfRotZ   = document.getElementById('dbg-gridsurf-rotz');
const dbgGridSurfRotZVal= document.getElementById('dbg-gridsurf-rotz-val');
const dbgGridSurfOffX   = document.getElementById('dbg-gridsurf-offx');
const dbgGridSurfOffXVal= document.getElementById('dbg-gridsurf-offx-val');
const dbgGridSurfOffY   = document.getElementById('dbg-gridsurf-offy');
const dbgGridSurfOffYVal= document.getElementById('dbg-gridsurf-offy-val');

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

// Green 3D box-lattice reference layer. Builds a cube of line
// segments along all three axes so it reads as a stack of boxes.
// Lives in world space, independent of the data — XY are
// horizontal, Z is up (survey convention). The Layers panel's
// debug section drives its yaw + XYZ offset live. Cells are 1 m
// in survey coordinates, so a freshly-loaded mesh rebuilds the
// lattice with `worldUnitsPerMeter` (the mesh's uniform scale)
// driving the cell size and the dataset's longer-axis span
// driving the cell count.
const GRID3D_CELL_METERS       = 1;
const GRID3D_MAX_CELLS         = 80;
const GRID3D_FALLBACK_CELLS    = 10;
const GRID3D_FALLBACK_CELL_W   = 0.2;
function build3DBoxGridGeometry(cellWorldSize, cells) {
  const half = (cells * cellWorldSize) / 2;
  const verts = [];
  for (let i = 0; i <= cells; i++) {
    for (let j = 0; j <= cells; j++) {
      const a = -half + i * cellWorldSize;
      const b = -half + j * cellWorldSize;
      verts.push(-half, a, b,   half, a, b);
      verts.push(a, -half, b,   a, half, b);
      verts.push(a, b, -half,   a, b, half);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return geo;
}
const grid3D = new THREE.LineSegments(
  build3DBoxGridGeometry(GRID3D_FALLBACK_CELL_W, GRID3D_FALLBACK_CELLS),
  new THREE.LineBasicMaterial({ color: 0x33ff66, transparent: true, opacity: 0.45 }),
);
scene.add(grid3D);
function rebuild3DGridForData(worldUnitsPerMeter, spanMeters) {
  const cells = Math.max(2, Math.min(GRID3D_MAX_CELLS, Math.ceil(spanMeters / GRID3D_CELL_METERS)));
  const cellWorldSize = worldUnitsPerMeter * GRID3D_CELL_METERS;
  const old = grid3D.geometry;
  grid3D.geometry = build3DBoxGridGeometry(cellWorldSize, cells);
  if (old) old.dispose();
}

// Live-tunable defaults for the 3D grid transform. Rot is around
// the vertical (survey-Z = three.js-Y); offsets are in world units
// with X = survey-X (lateral), Y = survey-Y (depth, three.js-Z),
// Z = elevation (three.js-Y).
const GRID3D_ROTZ_DEFAULT = 141;
const GRID3D_OFFX_DEFAULT = 0;
const GRID3D_OFFY_DEFAULT = 0;
const GRID3D_OFFZ_DEFAULT = 0;
let grid3DRotZ = GRID3D_ROTZ_DEFAULT;
let grid3DOffX = GRID3D_OFFX_DEFAULT;
let grid3DOffY = GRID3D_OFFY_DEFAULT;
let grid3DOffZ = GRID3D_OFFZ_DEFAULT;
function applyGrid3DSettings() {
  grid3D.rotation.set(0, THREE.MathUtils.degToRad(grid3DRotZ), 0);
  grid3D.position.set(grid3DOffX, grid3DOffZ, grid3DOffY);
}
function syncGrid3DUI() {
  dbgGrid3DRotZ.value = String(grid3DRotZ);
  dbgGrid3DRotZVal.textContent = `${Math.round(grid3DRotZ)}°`;
  dbgGrid3DOffX.value = String(grid3DOffX);
  dbgGrid3DOffXVal.textContent = grid3DOffX.toFixed(2);
  dbgGrid3DOffY.value = String(grid3DOffY);
  dbgGrid3DOffYVal.textContent = grid3DOffY.toFixed(2);
  dbgGrid3DOffZ.value = String(grid3DOffZ);
  dbgGrid3DOffZVal.textContent = grid3DOffZ.toFixed(2);
}
syncGrid3DUI();
applyGrid3DSettings();
dbgGrid3DRotZ.addEventListener('input', () => {
  grid3DRotZ = parseFloat(dbgGrid3DRotZ.value);
  dbgGrid3DRotZVal.textContent = `${Math.round(grid3DRotZ)}°`;
  applyGrid3DSettings();
});
dbgGrid3DOffX.addEventListener('input', () => {
  grid3DOffX = parseFloat(dbgGrid3DOffX.value);
  dbgGrid3DOffXVal.textContent = grid3DOffX.toFixed(2);
  applyGrid3DSettings();
});
dbgGrid3DOffY.addEventListener('input', () => {
  grid3DOffY = parseFloat(dbgGrid3DOffY.value);
  dbgGrid3DOffYVal.textContent = grid3DOffY.toFixed(2);
  applyGrid3DSettings();
});
dbgGrid3DOffZ.addEventListener('input', () => {
  grid3DOffZ = parseFloat(dbgGrid3DOffZ.value);
  dbgGrid3DOffZVal.textContent = grid3DOffZ.toFixed(2);
  applyGrid3DSettings();
});

// Surface grid — a flat 1 m × 1 m XY grid in survey coords that's
// densely sampled and draped over the terrain so each line follows
// the elevation underneath. Lives as a child of currentMesh so it
// inherits the visual X-mirror; rotation and offset are applied in
// the local survey frame (around the data XY centre).
let gridSurf = null;
const GRID_SURF_CELL_METERS    = 1;
const GRID_SURF_MAX_CELLS      = 80;
const GRID_SURF_LIFT           = 0.0025;
const GRID_SURF_ROTZ_DEFAULT   = 141;
const GRID_SURF_OFFX_DEFAULT   = 0;
const GRID_SURF_OFFY_DEFAULT   = 0;
let gridSurfRotZ = GRID_SURF_ROTZ_DEFAULT;
let gridSurfOffX = GRID_SURF_OFFX_DEFAULT;
let gridSurfOffY = GRID_SURF_OFFY_DEFAULT;
function buildSurfaceGrid(drapeCtx) {
  const { points, triangles, index, cx, cy, scale, minZ } = drapeCtx;
  const spanX = index.maxX - index.minX;
  const spanY = index.maxY - index.minY;
  const span = Math.max(spanX, spanY, 1e-6);
  const cells = Math.max(2, Math.min(
    GRID_SURF_MAX_CELLS,
    Math.ceil(span / GRID_SURF_CELL_METERS),
  ));
  const cellSize = GRID_SURF_CELL_METERS;
  const half = (cells * cellSize) / 2;
  const sampleSpacing = span / (index.N * 2);
  const lineSamples = Math.max(2, Math.ceil((cells * cellSize) / sampleSpacing));

  const rot = THREE.MathUtils.degToRad(gridSurfRotZ);
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const segs = [];

  function pushDrapedLine(getLocalXY) {
    let prevX = 0, prevY = 0, prevZ = 0;
    let havePrev = false;
    for (let s = 0; s <= lineSamples; s++) {
      const t = s / lineSamples;
      const [lx, ly] = getLocalXY(t);
      const rx = lx * cosR - ly * sinR;
      const ry = lx * sinR + ly * cosR;
      const X = cx + gridSurfOffX + rx;
      const Y = cy + gridSurfOffY + ry;
      const z = elevationAt(points, triangles, index, X, Y);
      if (z == null) { havePrev = false; continue; }
      const wx = (X - cx) * scale;
      const wy = (z - minZ) * scale + GRID_SURF_LIFT;
      const wz = (Y - cy) * scale;
      if (havePrev) segs.push(prevX, prevY, prevZ, wx, wy, wz);
      prevX = wx; prevY = wy; prevZ = wz; havePrev = true;
    }
  }
  const totalLen = cells * cellSize;
  for (let i = 0; i <= cells; i++) {
    const ly = -half + i * cellSize;
    pushDrapedLine((t) => [-half + t * totalLen, ly]);
  }
  for (let i = 0; i <= cells; i++) {
    const lx = -half + i * cellSize;
    pushDrapedLine((t) => [lx, -half + t * totalLen]);
  }
  if (segs.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
  const m = new THREE.LineBasicMaterial({
    color: 0x33ff66, transparent: true, opacity: 0.6,
  });
  const obj = new THREE.LineSegments(g, m);
  obj.renderOrder = 2;
  return obj;
}
function rebuildSurfaceGrid() {
  if (!currentMesh || !currentMesh.userData || !currentMesh.userData.drapeCtx) return;
  if (gridSurf) {
    currentMesh.remove(gridSurf);
    gridSurf.geometry.dispose();
    gridSurf.material.dispose();
    gridSurf = null;
  }
  gridSurf = buildSurfaceGrid(currentMesh.userData.drapeCtx);
  if (gridSurf) currentMesh.add(gridSurf);
}
function syncGridSurfUI() {
  dbgGridSurfRotZ.value = String(gridSurfRotZ);
  dbgGridSurfRotZVal.textContent = `${Math.round(gridSurfRotZ)}°`;
  dbgGridSurfOffX.value = String(gridSurfOffX);
  dbgGridSurfOffXVal.textContent = `${gridSurfOffX.toFixed(1)} m`;
  dbgGridSurfOffY.value = String(gridSurfOffY);
  dbgGridSurfOffYVal.textContent = `${gridSurfOffY.toFixed(1)} m`;
}
syncGridSurfUI();
dbgGridSurfRotZ.addEventListener('input', () => {
  gridSurfRotZ = parseFloat(dbgGridSurfRotZ.value);
  dbgGridSurfRotZVal.textContent = `${Math.round(gridSurfRotZ)}°`;
  rebuildSurfaceGrid();
});
dbgGridSurfOffX.addEventListener('input', () => {
  gridSurfOffX = parseFloat(dbgGridSurfOffX.value);
  dbgGridSurfOffXVal.textContent = `${gridSurfOffX.toFixed(1)} m`;
  rebuildSurfaceGrid();
});
dbgGridSurfOffY.addEventListener('input', () => {
  gridSurfOffY = parseFloat(dbgGridSurfOffY.value);
  dbgGridSurfOffYVal.textContent = `${gridSurfOffY.toFixed(1)} m`;
  rebuildSurfaceGrid();
});

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.05;
controls.maxDistance = 8;

// Allow full pitch — looking down from directly above is useful for
// a heightmap, looking up from below is fine too.
controls.minPolarAngle = 0.01;
controls.maxPolarAngle = Math.PI - 0.01;

// ---- Layers panel ----
// Per-layer toggle + zoom-distance gate. Each entry resolves to the
// THREE object(s) it represents on demand (currentMesh / parcels
// can be null before anything has loaded). The animate loop calls
// applyLayerVisibility every frame, so changing a slider or
// checkbox is reflected immediately. defaultDist == controls.max
// (8) means "always visible when toggled on" — the slider is still
// available so any layer can be gated for debugging.
const LAYERS = [
  { id: 'surface', label: 'Surface',          defaultDist: 8,   get: () => currentMesh && currentMesh.userData && currentMesh.userData.mesh },
  { id: 'points',  label: 'Mesh points',      defaultDist: 8,   get: () => currentMesh && currentMesh.userData && currentMesh.userData.meshPoints },
  { id: 'majors',  label: 'Contours (1 m)',   defaultDist: 8,   get: () => currentMesh && currentMesh.userData && currentMesh.userData.majorLines },
  { id: 'minors',  label: 'Contours (10 cm)', defaultDist: 8,   get: () => currentMesh && currentMesh.userData && currentMesh.userData.minorLines },
  { id: 'labels',  label: 'Contour labels',   defaultDist: 8,   get: () => currentMesh && currentMesh.userData && currentMesh.userData.contourLabels },
  { id: 'grid',    label: 'Coord grid',       defaultDist: 8,   get: () => currentMesh && currentMesh.userData && [currentMesh.userData.gridMinorLines, currentMesh.userData.gridMajorLines] },
  { id: 'grid3d',  label: '3D grid',          defaultDist: 8,   defaultEnabled: false, get: () => grid3D },
  { id: 'gridsurf', label: 'Surface grid',    defaultDist: 8,   get: () => gridSurf },
  { id: 'parcels', label: 'Parcels',          defaultDist: 8,   get: () => currentParcels },
];
const layerState = {};
for (const L of LAYERS) layerState[L.id] = { enabled: L.defaultEnabled !== false, maxDist: L.defaultDist };

for (const L of LAYERS) {
  const row = document.createElement('li');
  row.className = 'layer-row';
  const checkedAttr = L.defaultEnabled === false ? '' : ' checked';
  row.innerHTML =
    `<label class="layer-toggle">` +
      `<input type="checkbox" data-layer="${L.id}" data-kind="enabled"${checkedAttr} />` +
      `<span>${L.label}</span>` +
    `</label>` +
    `<div class="layer-slider">` +
      `<input type="range" data-layer="${L.id}" data-kind="dist" min="0.05" max="8" step="0.05" value="${L.defaultDist}" />` +
      `<span class="layer-value" data-value-for="${L.id}">${L.defaultDist.toFixed(2)}</span>` +
    `</div>`;
  layersList.appendChild(row);
}
layersList.addEventListener('input', (e) => {
  const el = e.target;
  if (!el || !el.dataset) return;
  const id = el.dataset.layer;
  const kind = el.dataset.kind;
  if (!id || !layerState[id]) return;
  if (kind === 'enabled') {
    layerState[id].enabled = el.checked;
    updateMasterCheckbox();
  } else if (kind === 'dist') {
    const v = parseFloat(el.value);
    layerState[id].maxDist = v;
    const valEl = layersList.querySelector(`[data-value-for="${id}"]`);
    if (valEl) valEl.textContent = v.toFixed(2);
  }
});

// Tri-state master: indeterminate when some layers are on and some
// off, unchecked when none on, checked when all on. Clicking it
// flips to "all on" if any layer was off, else "all off".
function updateMasterCheckbox() {
  const total = LAYERS.length;
  let on = 0;
  for (const L of LAYERS) if (layerState[L.id].enabled) on++;
  if (on === 0) {
    layersMaster.checked = false;
    layersMaster.indeterminate = false;
  } else if (on === total) {
    layersMaster.checked = true;
    layersMaster.indeterminate = false;
  } else {
    layersMaster.checked = false;
    layersMaster.indeterminate = true;
  }
}
layersMaster.addEventListener('change', () => {
  const allOn = LAYERS.every(L => layerState[L.id].enabled);
  const target = !allOn;
  for (const L of LAYERS) {
    layerState[L.id].enabled = target;
    const cb = layersList.querySelector(`[data-layer="${L.id}"][data-kind="enabled"]`);
    if (cb) cb.checked = target;
  }
  updateMasterCheckbox();
});
layersReset.addEventListener('click', () => {
  for (const L of LAYERS) {
    const on = L.defaultEnabled !== false;
    layerState[L.id].enabled = on;
    layerState[L.id].maxDist = L.defaultDist;
    const cb = layersList.querySelector(`[data-layer="${L.id}"][data-kind="enabled"]`);
    const sl = layersList.querySelector(`[data-layer="${L.id}"][data-kind="dist"]`);
    const vl = layersList.querySelector(`[data-value-for="${L.id}"]`);
    if (cb) cb.checked = on;
    if (sl) sl.value = String(L.defaultDist);
    if (vl) vl.textContent = L.defaultDist.toFixed(2);
  }
  labelOffset = LABEL_OFFSET_DEFAULT;
  labelSize = LABEL_SIZE_DEFAULT;
  syncLabelDebugUI();
  applyLabelDebugSettings();
  grid3DRotZ = GRID3D_ROTZ_DEFAULT;
  grid3DOffX = GRID3D_OFFX_DEFAULT;
  grid3DOffY = GRID3D_OFFY_DEFAULT;
  grid3DOffZ = GRID3D_OFFZ_DEFAULT;
  syncGrid3DUI();
  applyGrid3DSettings();
  gridSurfRotZ = GRID_SURF_ROTZ_DEFAULT;
  gridSurfOffX = GRID_SURF_OFFX_DEFAULT;
  gridSurfOffY = GRID_SURF_OFFY_DEFAULT;
  syncGridSurfUI();
  rebuildSurfaceGrid();
  updateMasterCheckbox();
});
updateMasterCheckbox();

// Contour-label debug knobs exposed in the Layers panel. Defaults
// match the values that used to be baked into buildMesh /
// makeContourLabel. applyLabelDebugSettings recomputes each
// sprite's position (radial outward from world origin in XZ) and
// its viewport-fraction scale from the stored anchor.
const LABEL_OFFSET_DEFAULT = 0;
const LABEL_SIZE_DEFAULT   = 0.033;
let labelOffset = LABEL_OFFSET_DEFAULT;
let labelSize   = LABEL_SIZE_DEFAULT;
function applyLabelDebugSettings(sprites) {
  const list = sprites || (currentMesh && currentMesh.userData && currentMesh.userData.contourLabels);
  if (!list) return;
  const SY = labelSize;
  const SX = SY * (LABEL_W / LABEL_H);
  for (const sprite of list) {
    const a = sprite.userData && sprite.userData.anchor;
    if (a) {
      const dx = a.bearingX || 0;
      const dz = a.bearingZ || 0;
      sprite.position.set(a.x + dx * labelOffset, a.y, a.z + dz * labelOffset);
    }
    sprite.scale.set(-SX, SY, 1);
  }
}
function syncLabelDebugUI() {
  dbgLabelOffset.value = String(labelOffset);
  dbgLabelOffsetVal.textContent = labelOffset.toFixed(3);
  dbgLabelSize.value = String(labelSize);
  dbgLabelSizeVal.textContent = labelSize.toFixed(3);
}
syncLabelDebugUI();
dbgLabelOffset.addEventListener('input', () => {
  labelOffset = parseFloat(dbgLabelOffset.value);
  dbgLabelOffsetVal.textContent = labelOffset.toFixed(3);
  applyLabelDebugSettings();
});
dbgLabelSize.addEventListener('input', () => {
  labelSize = parseFloat(dbgLabelSize.value);
  dbgLabelSizeVal.textContent = labelSize.toFixed(3);
  applyLabelDebugSettings();
});

function applyLayerVisibility() {
  const dist = controls.getDistance();
  for (const L of LAYERS) {
    const s = layerState[L.id];
    const visible = s.enabled && dist < s.maxDist;
    const objs = L.get();
    if (!objs) continue;
    if (Array.isArray(objs)) {
      for (const o of objs) if (o) o.visible = visible;
    } else {
      objs.visible = visible;
    }
  }
}

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
let currentParcels = null;
let currentFileName = null;
let homeCamera = null;

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  applyLayerVisibility();
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
    // Push the mesh a hair away from the camera in the depth buffer
    // so the per-vertex Points layer (added below) draws on top
    // without z-fighting the surface it sits on.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = { minZ, maxZ, scale };

  // Render every source data point as a small dot at its vertex.
  // Shares position and color BufferAttributes with the mesh
  // geometry, so any update to the elevation tint (applyParcelMask)
  // propagates to both draws automatically. No index attribute on
  // purpose — that makes Three.js use drawArrays(POINTS), exactly
  // one dot per data point. With an index it would draw one dot per
  // triangle-vertex reference (~6× per point).
  const pointsGeom = new THREE.BufferGeometry();
  pointsGeom.setAttribute('position', geometry.getAttribute('position'));
  pointsGeom.setAttribute('color', geometry.getAttribute('color'));
  const pointsMat = new THREE.PointsMaterial({
    vertexColors: true,
    size: 3,
    sizeAttenuation: false,
  });
  const meshPoints = new THREE.Points(pointsGeom, pointsMat);
  meshPoints.renderOrder = 1;

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

  // Topographic contours every 10 cm of native elevation. Marching
  // triangles: for each contour level, walk every triangle and emit
  // segments where the level intersects two of its edges. Lifted a
  // hair above the surface in Y to avoid z-fighting with the mesh.
  // Major contours (every full metre) render black; the 10 cm
  // minors in between render blue — same convention as printed topo
  // maps, and only the metre lines carry labels. Iterating in
  // integer steps avoids 0.1 m float drift across many levels.
  const MINOR_INTERVAL = 0.1;
  const MAJOR_EVERY = 10;
  const minorSegs = [];
  const majorSegs = [];
  const Z_LIFT = 0.0015;
  // Per major contour level (every metre): the full list of
  // segment endpoints (XZ pairs) in world space, plus the level's
  // lifted world-Y. After the loop we fan 12 bearings from the
  // model's topmost point and intersect each against this level's
  // segments to place one label per bearing-hit, plus a fallback
  // label if no bearing hits. Minor (10 cm) levels get no
  // aggregate and no label.
  const levelAggs = new Map();
  const startStep = Math.ceil(minZ / MINOR_INTERVAL);
  const endStep = Math.floor(maxZ / MINOR_INTERVAL);
  for (let step = startStep; step <= endStep; step++) {
    const level = step * MINOR_INTERVAL;
    const yLevel = (level - minZ) * scale;
    const isMajor = step % MAJOR_EVERY === 0;
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
        if (isMajor) {
          let agg = levelAggs.get(level);
          if (!agg) { agg = { yLevel: yLevel + Z_LIFT * 4, segs: [] }; levelAggs.set(level, agg); }
          agg.segs.push(xs[0], zs[0], xs[1], zs[1]);
        }
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
  const minorLines = buildContourLines(minorSegs, 0x1d6dd4, 0.55);
  const majorLines = buildContourLines(majorSegs, 0x0a0d12, 0.95);

  // Default state: no contour labels. loadParcels rebuilds the
  // list to place one label at every point where a parcel edge
  // crosses a metre contour line.
  const contourLabels = [];

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

  // Spatial index over the triangulation so drape/lookup queries
  // (parcel overlays etc.) can find the containing triangle for an
  // (X, Y) without scanning all triangles. Uniform 64×64 grid keyed
  // by the source-CRS bbox; each cell stores triangle indices whose
  // axis-aligned bbox overlaps that cell.
  const tindex = buildTriangleIndex(points, triangles, { minX, maxX, minY, maxY });
  const drapeCtx = { points, triangles, index: tindex, cx, cy, scale, minZ };

  // Recomputes the mesh's per-vertex elevation colour, multiplied by
  // OUTSIDE_TINT for vertices that fall outside every closed parcel
  // polygon. Call with an empty/null array to fully restore the
  // original gradient. Per-vertex tinting means the boundary reads
  // as a soft gradient where triangles straddle it — fine for our
  // purposes; no shader / submesh split needed.
  const OUTSIDE_TINT = 0.35;
  const colorAttr = geometry.getAttribute('color');
  function applyParcelMask(closedPolys) {
    const arr = colorAttr.array;
    const hasMask = closedPolys && closedPolys.length > 0;
    for (let i = 0; i < points.length; i++) {
      const t = (points[i][2] - minZ) / zSpan;
      const c = elevationColor(t);
      let r = c.r, g = c.g, b = c.b;
      if (hasMask) {
        let inside = false;
        for (const poly of closedPolys) {
          if (pointInPolygon(points[i][0], points[i][1], poly)) { inside = true; break; }
        }
        if (!inside) { r *= OUTSIDE_TINT; g *= OUTSIDE_TINT; b *= OUTSIDE_TINT; }
      }
      arr[i * 3]     = r;
      arr[i * 3 + 1] = g;
      arr[i * 3 + 2] = b;
    }
    colorAttr.needsUpdate = true;
  }

  const group = new THREE.Group();
  // Mirror across the YZ plane so the rendered orientation matches
  // what xhevops sees in the source CAD (East to the LEFT on
  // screen). Data, the triangulation index, and the drape function
  // all stay in the native survey CRS — only the visual transform
  // flips. Three.js handles the resulting winding-order parity for
  // lighting automatically.
  group.scale.x = -1;
  group.add(mesh);
  group.add(meshPoints);
  if (gridMinorLines) group.add(gridMinorLines);
  if (gridMajorLines) group.add(gridMajorLines);
  if (minorLines) group.add(minorLines);
  if (majorLines) group.add(majorLines);
  for (const s of contourLabels) group.add(s);
  applyLabelDebugSettings(contourLabels);
  group.userData = {
    mesh, meshPoints, minorLines, majorLines,
    gridMinorLines, gridMajorLines,
    contourLabels,
    levelAggs,
    drapeCtx,
    applyParcelMask,
  };

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

// Standard ray-casting point-in-polygon. `poly` is an array of
// [x, y] pairs; closed loops are assumed (last vertex == first).
// Robustness near the edge doesn't matter here — we only use this
// to tint terrain vertices, so a stray pixel either way is fine.
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// True if a polyline's first and last vertex coincide — i.e. the
// DXF entity was a closed shape. extractDxfPolylines pushes the
// closing vertex explicitly when `e.closed || e.shape` is set, so
// this check is reliable.
function isClosedPolyline(poly) {
  if (poly.length < 4) return false;
  const a = poly[0], b = poly[poly.length - 1];
  return a[0] === b[0] && a[1] === b[1];
}

// ---- Triangle spatial index ----
// Uniform-grid index over the Delaunay triangulation so an (X, Y)
// query (e.g. "what's the terrain elevation at this parcel
// vertex?") doesn't have to scan all triangles. 64 cells per axis;
// every triangle gets registered in every grid cell its bbox
// overlaps. Lookup picks the cell, walks its candidates, and
// returns the first triangle whose barycentric coordinates contain
// the query.
function buildTriangleIndex(points, triangles, bounds) {
  const N = 64;
  const { minX, maxX, minY, maxY } = bounds;
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const invDx = N / spanX;
  const invDy = N / spanY;
  const buckets = new Array(N * N);
  for (let i = 0; i < buckets.length; i++) buckets[i] = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const ia = triangles[t], ib = triangles[t + 1], ic = triangles[t + 2];
    const ax = points[ia][0], ay = points[ia][1];
    const bx = points[ib][0], by = points[ib][1];
    const ccx = points[ic][0], ccy = points[ic][1];
    const tMinX = Math.min(ax, bx, ccx);
    const tMaxX = Math.max(ax, bx, ccx);
    const tMinY = Math.min(ay, by, ccy);
    const tMaxY = Math.max(ay, by, ccy);
    const cx0 = Math.max(0, Math.min(N - 1, Math.floor((tMinX - minX) * invDx)));
    const cx1 = Math.max(0, Math.min(N - 1, Math.floor((tMaxX - minX) * invDx)));
    const cy0 = Math.max(0, Math.min(N - 1, Math.floor((tMinY - minY) * invDy)));
    const cy1 = Math.max(0, Math.min(N - 1, Math.floor((tMaxY - minY) * invDy)));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        buckets[cy * N + cx].push(t);
      }
    }
  }
  return { buckets, N, invDx, invDy, minX, minY, maxX, maxY };
}

// Returns the interpolated elevation at (X, Y), or null if the
// point lies outside the triangulation's convex hull.
function elevationAt(points, triangles, index, X, Y) {
  if (X < index.minX || X > index.maxX || Y < index.minY || Y > index.maxY) return null;
  const cx = Math.max(0, Math.min(index.N - 1, Math.floor((X - index.minX) * index.invDx)));
  const cy = Math.max(0, Math.min(index.N - 1, Math.floor((Y - index.minY) * index.invDy)));
  const candidates = index.buckets[cy * index.N + cx];
  const EPS = 1e-9;
  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i];
    const ia = triangles[t], ib = triangles[t + 1], ic = triangles[t + 2];
    const ax = points[ia][0], ay = points[ia][1], az = points[ia][2];
    const bx = points[ib][0], by = points[ib][1], bz = points[ib][2];
    const ccx = points[ic][0], ccy = points[ic][1], ccz = points[ic][2];
    const denom = (by - ccy) * (ax - ccx) + (ccx - bx) * (ay - ccy);
    if (Math.abs(denom) < EPS) continue;
    const w1 = ((by - ccy) * (X - ccx) + (ccx - bx) * (Y - ccy)) / denom;
    const w2 = ((ccy - ay) * (X - ccx) + (ax - ccx) * (Y - ccy)) / denom;
    const w3 = 1 - w1 - w2;
    if (w1 >= -EPS && w2 >= -EPS && w3 >= -EPS) {
      return w1 * az + w2 * bz + w3 * ccz;
    }
  }
  return null;
}

// Layers to skip when treating a DXF as parcel data. The `C-`
// prefix is the AIA CAD-layer convention for "constructed/computed"
// layers (topo contours, TIN boundary, annotation tables); we
// already have our own contours from the TXT mesh so re-rendering
// the DXF's would just paint over them. `ramka` is the Macedonian
// word for the drawing frame; `ceco.net*` is the surveyor's
// watermark layer in the sample. `0` is AutoCAD's default layer —
// often used for decorative elements (scale bars, north arrows)
// that sit at small XY near the origin, far from the parcel.
function isParcelLayer(layer) {
  if (!layer) return false;
  const L = String(layer).toUpperCase();
  if (L === '0') return false;
  if (L.startsWith('C-')) return false;
  if (L === 'RAMKA') return false;
  if (L.startsWith('CECO.NET')) return false;
  return true;
}

// Extracts parcel-like polyline coordinate sequences from a parsed
// DXF tree. Supports LINE, LWPOLYLINE, and POLYLINE; honours the
// open/closed flag so closed parcels read as a loop. Filters by
// layer (see isParcelLayer above) so contour lines etc. don't come
// along for the ride.
function extractDxfPolylines(dxf) {
  const out = [];
  const entities = (dxf && dxf.entities) || [];
  for (const e of entities) {
    if (!e || !e.type) continue;
    if (!isParcelLayer(e.layer)) continue;
    if (e.type === 'LINE') {
      if (e.vertices && e.vertices.length >= 2) {
        out.push([[e.vertices[0].x, e.vertices[0].y], [e.vertices[1].x, e.vertices[1].y]]);
      } else if (e.start && e.end) {
        out.push([[e.start.x, e.start.y], [e.end.x, e.end.y]]);
      }
    } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
      const verts = e.vertices || [];
      if (verts.length < 2) continue;
      const seq = verts.map((v) => [v.x, v.y]);
      if (e.shape || e.closed) seq.push(seq[0].slice());
      out.push(seq);
    }
  }
  return out;
}

// Densely samples each input polyline so the draped result hugs the
// terrain through every triangle it crosses (otherwise long
// straight DXF segments would shortcut across hills). One sample
// per ~half the terrain's grid cell wins on accuracy without
// exploding the segment count.
function drapeParcelPolylines(polylines, ctx) {
  const { points, triangles, index, cx, cy, scale, minZ } = ctx;
  const LIFT = 0.0025;
  const sampleSpacing =
    Math.max(index.maxX - index.minX, index.maxY - index.minY) / (index.N * 2);
  const segs = [];
  let inBounds = 0;
  let outBounds = 0;
  let parcelMinZ = Infinity;
  // Crossings (in source CRS): every point where two consecutive
  // draped samples in the same polyline straddle an integer metre
  // elevation. Each crossing becomes one contour label.
  const crossings = [];
  for (const poly of polylines) {
    let prevWorld = null;
    let prevSrcX = 0, prevSrcY = 0, prevSrcZ = 0;
    let havePrev = false;
    for (let i = 0; i < poly.length - 1; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[i + 1];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      const n = Math.max(1, Math.ceil(len / sampleSpacing));
      for (let s = (i === 0 ? 0 : 1); s <= n; s++) {
        const t = s / n;
        const X = x0 + dx * t;
        const Y = y0 + dy * t;
        const z = elevationAt(points, triangles, index, X, Y);
        if (z == null) { outBounds++; prevWorld = null; havePrev = false; continue; }
        inBounds++;
        if (z < parcelMinZ) parcelMinZ = z;
        if (havePrev && prevSrcZ !== z) {
          const lo = Math.min(prevSrcZ, z);
          const hi = Math.max(prevSrcZ, z);
          const startLevel = Math.ceil(lo + 1e-9);
          const endLevel = Math.floor(hi - 1e-9);
          for (let L = startLevel; L <= endLevel; L++) {
            const tCross = (L - prevSrcZ) / (z - prevSrcZ);
            const Xc = prevSrcX + tCross * (X - prevSrcX);
            const Yc = prevSrcY + tCross * (Y - prevSrcY);
            crossings.push({ srcX: Xc, srcY: Yc, level: L });
          }
        }
        prevSrcX = X; prevSrcY = Y; prevSrcZ = z; havePrev = true;
        const world = [
          (X - cx) * scale,
          (z - minZ) * scale + LIFT,
          (Y - cy) * scale,
        ];
        if (prevWorld) segs.push(prevWorld[0], prevWorld[1], prevWorld[2], world[0], world[1], world[2]);
        prevWorld = world;
      }
    }
  }
  return {
    segs, inBounds, outBounds,
    parcelMinZ: parcelMinZ === Infinity ? null : parcelMinZ,
    crossings,
  };
}

// Contour-label canvas dimensions (logical px). Drawn at 2× into
// the backing canvas for crispness on HiDPI displays. Text only,
// no background pill — relies on a dark halo for legibility against
// any terrain colour.
const LABEL_W = 160;
const LABEL_H = 60;

// Paints (or repaints) a label canvas with two text rows:
// top = absolute elevation (m), bottom = signed height above the
// chosen baseline (typically the parcel bottom). Exposed so the
// parcel loader can refresh every label's relative row in place
// once a new baseline is known.
function drawContourLabel(canvas, abs, baseline) {
  if (!canvas.width) { canvas.width = LABEL_W * 2; canvas.height = LABEL_H * 2; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(2, 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const rel = abs - baseline;
  // Top: absolute
  ctx.font = 'bold 26px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(8, 12, 18, 0.95)';
  ctx.fillStyle = '#ffffff';
  const topY = LABEL_H * 0.33;
  ctx.strokeText(`${abs.toFixed(0)} m`, LABEL_W / 2, topY);
  ctx.fillText(`${abs.toFixed(0)} m`, LABEL_W / 2, topY);
  // Bottom: relative
  ctx.font = '20px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.lineWidth = 4;
  ctx.fillStyle = '#c5d3e0';
  const botY = LABEL_H * 0.72;
  const relText = `${rel >= 0 ? '+' : ''}${rel.toFixed(1)} m`;
  ctx.strokeText(relText, LABEL_W / 2, botY);
  ctx.fillText(relText, LABEL_W / 2, botY);
}

// Two-line contour label: a Sprite wrapping a canvas texture. Uses
// `sizeAttenuation: false` so the label is a constant pixel size on
// screen regardless of camera distance — readable when zoomed out
// without becoming a wall of text when zoomed in. Sprite.scale.x is
// negated so the parent group's `scale.x = -1` CRS mirror leaves
// the text right-reading.
function makeContourLabel(abs, baseline) {
  const canvas = document.createElement('canvas');
  drawContourLabel(canvas, abs, baseline);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    sizeAttenuation: false,
  });
  const sprite = new THREE.Sprite(mat);
  // With sizeAttenuation=false, sprite.scale is interpreted in
  // viewport-normalised units (1.0 ≈ full viewport). 0.045 = ~5 %
  // of viewport height — readable mono text without dominating.
  const SY = 0.045;
  const SX = SY * (LABEL_W / LABEL_H);
  sprite.scale.set(-SX, SY, 1);
  sprite.userData = { abs, canvas };
  return sprite;
}

// Builds label sprites at every point where a parcel edge crosses
// an integer-metre contour line. `crossings` come from
// drapeParcelPolylines and are stored in source CRS; we convert
// them to world coords here using the drape ctx. The yLevel
// formula matches the marching loop in buildMesh so labels float
// on the same plane as their contour line.
function buildContourLabelsFromCrossings(crossings, drapeCtx, baseline) {
  const sprites = [];
  const Z_LIFT_LABEL = 0.006;
  const { cx, cy, scale, minZ } = drapeCtx;
  for (const c of crossings) {
    const wx = (c.srcX - cx) * scale;
    const wz = (c.srcY - cy) * scale;
    const wy = (c.level - minZ) * scale + Z_LIFT_LABEL;
    const sprite = makeContourLabel(c.level, baseline);
    sprite.userData.anchor = { x: wx, y: wy, z: wz, bearingX: 0, bearingZ: 0 };
    sprite.renderOrder = 3;
    sprites.push(sprite);
  }
  return sprites;
}

// Swaps the sprites on an existing terrain group: disposes old
// label textures, adds the new ones to the group, and updates
// userData.contourLabels.
function setContourLabels(group, sprites) {
  if (!group || !group.userData) return;
  const ud = group.userData;
  for (const s of ud.contourLabels || []) {
    group.remove(s);
    if (s.material) {
      if (s.material.map) s.material.map.dispose();
      s.material.dispose();
    }
  }
  for (const s of sprites) group.add(s);
  ud.contourLabels = sprites;
  applyLabelDebugSettings(sprites);
}

// Repaints every contour label's relative row against a new
// baseline elevation (typically the parcel's lowest point, once a
// DXF has loaded). Canvas references live on each sprite's
// userData; the texture is the same object so a `needsUpdate` flag
// is enough to push the new pixels to the GPU.
function updateContourBaseline(group, baseline) {
  if (!group || !group.userData || !group.userData.contourLabels) return;
  for (const sprite of group.userData.contourLabels) {
    const { abs, canvas } = sprite.userData;
    drawContourLabel(canvas, abs, baseline);
    if (sprite.material.map) sprite.material.map.needsUpdate = true;
  }
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

function showError(msg)  { toast(msg, true); }
function showStatus(msg) { toast(msg, false); }
function toast(msg, isError) {
  errorEl.textContent = msg;
  errorEl.classList.toggle('error-warn', isError);
  errorEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { errorEl.hidden = true; }, 4000);
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
        if (obj.material) {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      });
    }
    currentMesh = built.group;
    scene.add(currentMesh);
    fallbackGrid.visible = false;
    {
      const bb = built.bounds;
      const span = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY, 1e-6);
      rebuild3DGridForData(2 / span, span);
    }
    gridSurf = null;
    rebuildSurfaceGrid();
    frameMesh(built.mesh);
    hint.hidden = true;
    readout.hidden = false;
    readout.open = false;
    layersPanel.hidden = false;
    resetBtn.hidden = false;
    parcelBtn.hidden = false;
    exportBtn.hidden = false;
    currentParcels = null;
    currentFileName = file.name;
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
async function loadBundledParcels(path, displayName) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    await loadParcels(new File([blob], displayName, { type: 'application/dxf' }));
  } catch (e) {
    showError('Could not load parcel sample: ' + (e && e.message || e));
  }
}
async function loadFullSample() {
  await loadBundledSample('sample-files/trebishte-high-res.txt', 'trebishte-high-res.txt');
  await loadBundledParcels('sample-files/trebishte.dxf', 'trebishte.dxf');
}
sampleBtn.addEventListener('click', loadFullSample);

// ---- DXF parcel overlay ----
// Parses LINE / LWPOLYLINE / POLYLINE entities from a user-supplied
// DXF, drapes each segment onto the current terrain surface, and
// renders the result as a red line layer in the same group.
async function loadParcels(file) {
  if (!currentMesh || !currentMesh.userData || !currentMesh.userData.drapeCtx) {
    showError('Load a terrain first, then add parcels.');
    return;
  }
  try {
    const text = await file.text();
    const parser = new DxfParser();
    const dxf = parser.parseSync(text);
    const polylines = extractDxfPolylines(dxf);
    if (!polylines.length) {
      showError('No LINE/POLYLINE entities found in DXF.');
      return;
    }
    const { segs, inBounds, outBounds, parcelMinZ, crossings } = drapeParcelPolylines(polylines, currentMesh.userData.drapeCtx);
    if (currentParcels) {
      currentMesh.remove(currentParcels);
      currentParcels.geometry.dispose();
      currentParcels.material.dispose();
    }
    if (!segs.length) {
      showError('Parcel data falls entirely outside the terrain.');
      return;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs), 3));
    const m = new THREE.LineBasicMaterial({ color: 0xff4d3d, transparent: true, opacity: 0.95 });
    currentParcels = new THREE.LineSegments(g, m);
    currentParcels.renderOrder = 2;
    currentMesh.add(currentParcels);
    // Drop one label at every point where a parcel edge crossed
    // a metre contour during draping. Baseline (used for the
    // "+N m" relative row) anchors to the parcel's lowest sampled
    // elevation when available.
    const ctx = currentMesh.userData.drapeCtx;
    const baseline = parcelMinZ != null ? parcelMinZ : ctx.minZ;
    const sprites = buildContourLabelsFromCrossings(crossings || [], ctx, baseline);
    setContourLabels(currentMesh, sprites);
    // Darken the mesh outside the closed parcel polygons so the
    // parcel pops visually. Open polylines (LINE entities) don't
    // define a region, so they're skipped here.
    if (currentMesh.userData.applyParcelMask) {
      currentMesh.userData.applyParcelMask(polylines.filter(isClosedPolyline));
    }
    showStatus(
      `Loaded ${polylines.length} parcel path${polylines.length === 1 ? '' : 's'}` +
      (outBounds > 0 ? ` (${outBounds} sample${outBounds === 1 ? '' : 's'} off-terrain)` : '')
    );
  } catch (e) {
    showError('DXF parse failed: ' + (e && e.message || e));
  }
}
parcelBtn.addEventListener('click', () => parcelInput.click());
parcelInput.addEventListener('change', () => {
  const f = parcelInput.files && parcelInput.files[0];
  if (f) loadParcels(f);
  parcelInput.value = '';
});

// ---- Export ----
// We export the surface mesh only (no contour lines, grid, dots,
// labels or parcels). The on-screen view applies a parent-group
// scale.x = -1 to match CAD orientation; the exported file should
// match the on-screen view, so we bake that mirror into a cloned
// geometry instead of carrying a negative-scale parent (which some
// importers handle inconsistently). Reversing the triangle winding
// keeps faces CCW so computed normals still point outward.
function buildExportMesh() {
  if (!currentMesh || !currentMesh.userData || !currentMesh.userData.mesh) return null;
  const src = currentMesh.userData.mesh;
  const g = src.geometry.clone();
  g.scale(-1, 1, 1);
  const idx = g.index.array;
  for (let t = 0; t < idx.length; t += 3) {
    const tmp = idx[t + 1];
    idx[t + 1] = idx[t + 2];
    idx[t + 2] = tmp;
  }
  g.index.needsUpdate = true;
  g.computeVertexNormals();
  return new THREE.Mesh(g, src.material);
}
function exportFilename(ext) {
  const base = (currentFileName && currentFileName.replace(/\.[^.]+$/, '')) || 'terrain';
  return `${base}.${ext}`;
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
function exportGLB() {
  const m = buildExportMesh();
  if (!m) return;
  new GLTFExporter().parse(
    m,
    (buffer) => {
      const name = exportFilename('glb');
      downloadBlob(new Blob([buffer], { type: 'model/gltf-binary' }), name);
      showStatus(`Exported ${name}`);
      m.geometry.dispose();
    },
    (err) => {
      m.geometry.dispose();
      showError('GLB export failed: ' + (err && err.message || err));
    },
    { binary: true }
  );
}
function exportOBJ() {
  const m = buildExportMesh();
  if (!m) return;
  const text = new OBJExporter().parse(m);
  const name = exportFilename('obj');
  downloadBlob(new Blob([text], { type: 'text/plain' }), name);
  showStatus(`Exported ${name}`);
  m.geometry.dispose();
}
function setExportMenuOpen(open) {
  exportMenu.hidden = !open;
  exportBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
exportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setExportMenuOpen(exportMenu.hidden);
});
document.addEventListener('click', (e) => {
  if (!exportMenu.hidden && !exportMenu.contains(e.target) && e.target !== exportBtn) {
    setExportMenuOpen(false);
  }
});
exportMenu.addEventListener('click', (e) => {
  const t = e.target;
  if (!t || !t.dataset || !t.dataset.fmt) return;
  setExportMenuOpen(false);
  if (t.dataset.fmt === 'glb') exportGLB();
  else if (t.dataset.fmt === 'obj') exportOBJ();
});

// Open the bundled Trebishte plot + parcels on first launch so the
// user lands on a populated viewport instead of an empty grid.
// Sample / Upload / Parcels remain available to swap files.
loadFullSample();

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
