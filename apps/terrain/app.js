// Terrain — upload a points-with-elevation text file, get a 3D mesh.
// Coordinates are centered on their XY midpoint and the lowest
// elevation is anchored at Y=0 so the surface sits on the floor of
// the viewport regardless of the file's absolute UTM/Gauss-Krüger
// range.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import Delaunator from 'delaunator';
import DxfParser from 'dxf-parser';

const canvasWrap = document.getElementById('canvas-wrap');
const hint       = document.getElementById('hint');
const readout    = document.getElementById('readout');
const readoutName     = document.getElementById('readout-name');
const readoutToggle   = document.getElementById('readout-toggle');
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
// Start top-down with a hair of Z offset — exact straight-down with
// default `up = (0, 1, 0)` is an OrbitControls singularity. The
// 0.001 nudge gives the user a map view that OrbitControls can
// orbit cleanly from when they want to tilt.
camera.position.set(0, 3, 0.001);
// View orientation: rotate screen-up 135° clockwise from north-up.
// For a top-down camera (view = -Y), the projection of `camera.up`
// onto the XZ plane defines screen-up; setting it to
// (sin θ, 0, -cos θ) gives a θ-CCW rotation, with θ=0 being
// north-up. Negative θ for clockwise.
{
  const rad = -135 * Math.PI / 180;
  camera.up.set(Math.sin(rad), 0, -Math.cos(rad));
}

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
let currentParcels = null;
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

  // Spatial index over the triangulation so drape/lookup queries
  // (parcel overlays etc.) can find the containing triangle for an
  // (X, Y) without scanning all triangles. Uniform 64×64 grid keyed
  // by the source-CRS bbox; each cell stores triangle indices whose
  // axis-aligned bbox overlaps that cell.
  const tindex = buildTriangleIndex(points, triangles, { minX, maxX, minY, maxY });
  const drapeCtx = { points, triangles, index: tindex, cx, cy, scale, minZ };

  const group = new THREE.Group();
  // Mirror across the YZ plane so the rendered orientation matches
  // what xhevops sees in the source CAD (East to the LEFT on
  // screen). Data, the triangulation index, and the drape function
  // all stay in the native survey CRS — only the visual transform
  // flips. Three.js handles the resulting winding-order parity for
  // lighting automatically.
  group.scale.x = -1;
  group.add(mesh);
  if (gridMinorLines) group.add(gridMinorLines);
  if (gridMajorLines) group.add(gridMajorLines);
  if (minorLines) group.add(minorLines);
  if (majorLines) group.add(majorLines);
  group.userData = {
    mesh, minorLines, majorLines,
    gridMinorLines, gridMajorLines,
    drapeCtx,
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
  for (const poly of polylines) {
    let prevWorld = null;
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
        if (z == null) { outBounds++; prevWorld = null; continue; }
        inBounds++;
        if (z < parcelMinZ) parcelMinZ = z;
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
  return { segs, inBounds, outBounds, parcelMinZ: parcelMinZ === Infinity ? null : parcelMinZ };
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

// Positions the camera straight above `center`, far enough back to
// fit a box of `size` in view with a small padding margin. The
// 0.001 Z nudge keeps OrbitControls out of its top-down singularity
// so the user can immediately drag to orbit.
function frameView(center, size) {
  const fov = camera.fov * Math.PI / 180;
  const maxDim = Math.max(size.x, size.z, 1e-6);
  const dist = (maxDim * 0.5) / Math.tan(fov * 0.5) * 1.25;
  const eye = new THREE.Vector3(center.x, center.y + dist + size.y * 0.5, center.z + 0.001);
  camera.position.copy(eye);
  controls.target.copy(center);
  controls.update();
  homeCamera = { position: eye.clone(), target: center.clone() };
}

// Frames the camera over the full terrain mesh (top-down).
function frameMesh(mesh) {
  const bbox = new THREE.Box3().setFromObject(mesh);
  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  frameView(center, size);
}

// Frames the camera over the parcel polygons (top-down). Called
// after a DXF loads so the user lands looking straight at their
// plot. The matrixWorld walk is critical: parcels were just added
// to the group whose `scale.x = -1` mirrors the CRS; without a
// fresh updateMatrixWorld the bbox is computed in pre-mirror local
// coords and the camera aims at the wrong half of the scene.
function frameParcels(parcels) {
  if (!parcels) return;
  if (currentMesh) currentMesh.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(parcels);
  if (bbox.isEmpty()) return;
  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  // Expand Y by the mesh height so the parcel sits comfortably in
  // the camera's depth range even when the relief is significant.
  if (currentMesh && currentMesh.userData && currentMesh.userData.mesh) {
    const meshBox = new THREE.Box3().setFromObject(currentMesh.userData.mesh);
    size.y = Math.max(size.y, meshBox.max.y - meshBox.min.y);
  }
  frameView(center, size);
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
    frameMesh(built.mesh);
    hint.hidden = true;
    readout.hidden = false;
    resetBtn.hidden = false;
    parcelBtn.hidden = false;
    currentParcels = null;
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
  await loadBundledSample('sample-files/trebishte.txt', 'trebishte.txt');
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
    const { segs, inBounds, outBounds } = drapeParcelPolylines(polylines, currentMesh.userData.drapeCtx);
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
    // Pop the camera over the parcel so the user lands looking at
    // their plot rather than at the whole survey.
    frameParcels(currentParcels);
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

// Stats panel collapse — toggles `.collapsed` on the readout root.
// CSS hides `.readout-body` and rotates the chevron when collapsed.
readoutToggle.addEventListener('click', () => {
  const collapsed = readout.classList.toggle('collapsed');
  readoutToggle.setAttribute('aria-expanded', String(!collapsed));
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
