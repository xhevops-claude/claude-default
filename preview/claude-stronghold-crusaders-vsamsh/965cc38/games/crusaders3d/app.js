/* global THREE */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Crusaders 3D — a three.js proof-of-concept renderer for the same procedural
  // holding. Self-contained; uses the global THREE (classic build) so this file
  // stays a plain script. Primitive geometry for now — the path to high-poly
  // glTF models, instancing and shadows is what this prototype demonstrates.
  // ---------------------------------------------------------------------------

  const canvas = document.getElementById('scene');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  } catch (e) {
    document.getElementById('game-loading').innerHTML = '<p style="padding:24px;text-align:center">WebGL isn\'t available on this device.</p>';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const SKY = 0xcda26a;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 42, 95);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(24, 22, 24);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 8;
  controls.maxDistance = 72;
  controls.maxPolarAngle = 1.45;   // don't dip under the ground

  // ---- Lighting --------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0xfff0d0, 0x4a3a28, 0.7));
  const sun = new THREE.DirectionalLight(0xfff1d0, 1.1);
  sun.position.set(22, 32, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 130;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // ---- Seeded value noise (shared idea with the 2D version) ------------------
  let seed = 1234567;
  try { const s = localStorage.getItem('crusaders-seed'); if (s) seed = (parseInt(s, 10) >>> 0); } catch (e) {}
  function hash2(s, x, y) {
    let h = s | 0;
    h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
    h = Math.imul(h ^ (y | 0), 0x165667b1);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function valueNoise(s, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const top = lerp(hash2(s, xi, yi), hash2(s, xi + 1, yi), u);
    const bot = lerp(hash2(s, xi, yi + 1), hash2(s, xi + 1, yi + 1), u);
    return lerp(top, bot, v);
  }
  function fbm(s, x, y) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < 4; o++) { sum += amp * valueNoise(s + o * 1013, x * freq, y * freq); norm += amp; amp *= 0.5; freq *= 2; }
    return sum / norm;
  }

  const BIOME_COLOR = {
    dw: 0x2d6586, w: 0x3f86a8, sa: 0xd9b56a, g: 0x7d9b46, fo: 0x5f7e34, ro: 0x8d8475, sn: 0xe8eaf0,
  };
  function biomeFrom(e, m) {
    if (e < 0.34) return 'dw';
    if (e < 0.40) return 'w';
    if (e < 0.45) return 'sa';
    if (e < 0.72) { if (m < 0.42) return 'sa'; if (m > 0.62) return 'fo'; return 'g'; }
    if (e < 0.84) return 'ro';
    return 'sn';
  }
  // Height + biome at a world point, with a flattened grass clearing at spawn.
  function sample(x, z) {
    const e = fbm(seed, x * 0.05, z * 0.05);
    const m = fbm(seed + 777, x * 0.045 + 100, z * 0.045 + 100);
    let biome = biomeFrom(e, m);
    let h = Math.max(-1.4, (e - 0.42) * 15);
    const d = Math.hypot(x, z);
    if (d < 13) { const t = clamp((d - 9) / 4, 0, 1); h = lerp(0.3, h, t); if (t < 0.5) biome = 'g'; }
    return { biome: biome, h: h };
  }

  // ---- Terrain mesh ----------------------------------------------------------
  const SIZE = 70;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SIZE, SIZE);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colorArr = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const s = sample(x, z);
    pos.setY(i, s.h);
    col.set(BIOME_COLOR[s.biome]);
    colorArr[i * 3] = col.r; colorArr[i * 3 + 1] = col.g; colorArr[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  ground.receiveShadow = true;
  scene.add(ground);

  // Oasis / sea water plane at y = 0.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, SIZE),
    new THREE.MeshStandardMaterial({ color: 0x2f7fa0, transparent: true, opacity: 0.8, roughness: 0.25, metalness: 0.1 })
  );
  water.rotation.x = -Math.PI / 2; water.position.y = -0.05;
  scene.add(water);

  // ---- Buildings (the demo holding) ------------------------------------------
  const SP = 1.7;          // spacing scale so meshes don't overlap
  const BASE = 0.3;        // clearing ground height
  function mat(color, rough) { return new THREE.MeshStandardMaterial({ color: color, roughness: rough == null ? 0.9 : rough }); }
  function box(w, h, d, color, c, r) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(c * SP, BASE + h / 2, r * SP);
    m.castShadow = true; m.receiveShadow = true; scene.add(m); return m;
  }
  function pyramid(radius, h, color, c, r, yTop) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(radius, h, 4), mat(color));
    m.position.set(c * SP, yTop + h / 2, r * SP);
    m.rotation.y = Math.PI / 4; m.castShadow = true; scene.add(m); return m;
  }
  // Keep
  box(2.4, 3.4, 2.4, 0xded2b6, 0, 0);
  // Towers + conical roofs
  [[-2, -1], [2, -1], [-2, 2], [2, 2]].forEach(function (t) {
    box(1.3, 2.8, 1.3, 0xcdbfa3, t[0], t[1]);
    pyramid(1.05, 1.2, 0x525c70, t[0], t[1], BASE + 2.8);
  });
  // Gatehouse
  box(1.6, 2.2, 1.6, 0xcdbfa3, 0, -3);
  // Curtain wall ring
  [[-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], [-2, 0], [-2, 1], [-2, 2],
   [2, 0], [2, 1], [2, 2], [-1, 2], [0, 2], [1, 2]].forEach(function (w) {
    box(1.05, 1.5, 1.05, 0xb9ad90, w[0], w[1]);
  });
  // Hovels (box + terracotta roof)
  [[-4, 4], [-5, 5], [-3, 6]].forEach(function (hh) {
    box(1.2, 1.0, 1.2, 0xb06a3b, hh[0], hh[1]);
    pyramid(0.95, 0.9, 0xa14a2c, hh[0], hh[1], BASE + 1.0);
  });
  // Mercenary tents (cones)
  [[5, 2], [6, 3]].forEach(function (tt) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.3, 12), mat(0xe3dcc7));
    m.position.set(tt[0] * SP, BASE + 0.65, tt[1] * SP); m.castShadow = true; scene.add(m);
  });
  // Market
  box(1.6, 1.2, 1.6, 0xc98f4e, 6, 1);

  // Keep banner
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), new THREE.MeshStandardMaterial({ color: 0xd64545, side: THREE.DoubleSide, roughness: 1 }));
  flag.position.set(0.55 * SP * 0 + 0, BASE + 4.1, 0); flag.position.x = 0.5;
  scene.add(flag);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), mat(0x3a2817));
  pole.position.set(0, BASE + 3.9, 0); scene.add(pole);

  // ---- Trees (InstancedMesh — the perf path for many objects) ----------------
  const treePts = [];
  for (let x = -SIZE / 2 + 1; x < SIZE / 2; x++) {
    for (let z = -SIZE / 2 + 1; z < SIZE / 2; z++) {
      if (Math.hypot(x, z) < 14) continue;
      const s = sample(x, z);
      if (s.h < 0.2) continue;
      const dense = s.biome === 'fo' ? 0.5 : (s.biome === 'g' ? 0.1 : 0);
      if (dense && hash2(seed ^ 0x9e37, x, z) < dense) {
        treePts.push({ x: x + (hash2(seed, x, z) - 0.5) * 0.6, z: z + (hash2(seed, z, x) - 0.5) * 0.6, h: s.h });
      }
    }
  }
  if (treePts.length) {
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.13, 0.9, 5), mat(0x6b4a2a, 1), treePts.length);
    const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(0.7, 1.6, 7), mat(0x3f7a34, 1), treePts.length);
    trunks.castShadow = true; crowns.castShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < treePts.length; i++) {
      const p = treePts[i];
      dummy.position.set(p.x, p.h + 0.45, p.z); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, p.h + 1.5, p.z); dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix);
    }
    scene.add(trunks, crowns);
  }

  // ---- Resize ----------------------------------------------------------------
  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });

  // ---- Quit ------------------------------------------------------------------
  document.getElementById('quit-btn').addEventListener('click', function () {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (e) {}
    } else { location.href = '../../'; }
  });

  // ---- Loop ------------------------------------------------------------------
  const clock = new THREE.Clock();
  function frame() {
    const t = clock.getElapsedTime();
    flag.rotation.y = Math.sin(t * 2) * 0.25;       // gentle banner wave
    water.position.y = -0.05 + Math.sin(t) * 0.03;  // shimmer
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Fade the hint, and clear the splash once ready + at least 3s elapsed.
  setTimeout(function () { const h = document.getElementById('hint'); if (h) h.classList.add('gone'); }, 6000);
  (function hideLoadingWhenReady() {
    const loading = document.getElementById('game-loading');
    if (!loading) return;
    const navStart = (performance && performance.timeOrigin) || Date.now();
    const remaining = Math.max(0, 3000 - (Date.now() - navStart));
    setTimeout(function () { loading.classList.add('hidden'); setTimeout(function () { loading.remove(); }, 500); }, remaining);
  })();
})();
