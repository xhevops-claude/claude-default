(function () {
  'use strict';

  /* Mecha Clone — a single-player homage to the hide-and-seek game
     Meccha Chameleon. You are a white chameleon mech: sample colors from
     the arena to paint yourself, pick a spot, freeze, and survive the
     seeker's patrol. Detection is driven by how badly your paint job
     mismatches whatever surface is behind you from the seeker's point
     of view. */

  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const actionBtn = document.getElementById('action-btn');
  const quitBtn = document.getElementById('quit-btn');
  const roundEl = document.getElementById('round');
  const bestEl = document.getElementById('best');
  const phasePill = document.getElementById('phase-pill');
  const suspicionWrap = document.getElementById('suspicion-wrap');
  const suspicionFill = document.getElementById('suspicion-fill');
  const paintSwatch = document.getElementById('paint-swatch');
  const aimSwatch = document.getElementById('aim-swatch');
  const blendFill = document.getElementById('blend-fill');
  const banner = document.getElementById('banner');
  const paintBtn = document.getElementById('paint-btn');
  const poseBtn = document.getElementById('pose-btn');
  const sceneHost = document.getElementById('scene');

  function fatal(msg) {
    const loading = document.getElementById('game-loading');
    if (loading) {
      loading.innerHTML = '<span class="gl-icon">🦎</span><p style="max-width:280px;text-align:center;color:#7d93a2;font-size:13px;line-height:1.6">' + msg + '</p>';
    }
  }

  if (typeof THREE === 'undefined') {
    fatal('Could not load the 3D engine (three.js). Check your connection and reload.');
    return;
  }

  /* ---------- constants ---------- */

  const ARENA = 20;            // half-size of the square arena
  const PLAYER_SPEED = 6;
  const SEEK_TIME = 45;

  const PALETTE = [
    0x3ddc84, 0x4aa8ff, 0xff5f6d, 0xffd23f,
    0xb476ff, 0xff9a3d, 0x5ce1e6, 0x8a97a5,
  ];

  /* ---------- renderer / scene ---------- */

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  sceneHost.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10151c);
  scene.fog = new THREE.Fog(0x10151c, 45, 95);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 200);

  scene.add(new THREE.HemisphereLight(0xbfd6e4, 0x2a2f38, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 0.65);
  sun.position.set(18, 30, 12);
  scene.add(sun);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /* ---------- arena ---------- */

  const envMeshes = [];   // raycast targets that can be sampled for paint
  const colliders = [];   // AABBs the player can't walk through

  function envBox(x, y, z, w, h, d, color, solid) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color })
    );
    m.position.set(x, y, z);
    scene.add(m);
    envMeshes.push(m);
    if (solid) {
      colliders.push({
        minX: x - w / 2, maxX: x + w / 2,
        minZ: z - d / 2, maxZ: z + d / 2,
      });
    }
    return m;
  }

  // Floor: 4x4 patchwork of 10-unit tiles, blobby colors.
  const floorColors = [];
  for (let i = 0; i < 16; i++) {
    const left = i % 4 > 0 ? floorColors[i - 1] : null;
    const up = i >= 4 ? floorColors[i - 4] : null;
    const r = Math.random();
    let c;
    if (left !== null && r < 0.4) c = left;
    else if (up !== null && r < 0.75) c = up;
    else c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    floorColors.push(c);
    const tx = (i % 4) * 10 - 15;
    const tz = Math.floor(i / 4) * 10 - 15;
    const tile = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshLambertMaterial({ color: c })
    );
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(tx, 0, tz);
    scene.add(tile);
    envMeshes.push(tile);
  }

  // Perimeter walls: 4 segments per side, each its own color.
  for (let s = 0; s < 4; s++) {
    for (let i = 0; i < 4; i++) {
      const c = PALETTE[(s * 4 + i * 3) % PALETTE.length];
      const off = i * 10 - 15;
      if (s === 0) envBox(off, 2.5, -ARENA - 0.3, 10, 5, 0.6, c, false);
      if (s === 1) envBox(off, 2.5, ARENA + 0.3, 10, 5, 0.6, c, false);
      if (s === 2) envBox(-ARENA - 0.3, 2.5, off, 0.6, 5, 10, c, false);
      if (s === 3) envBox(ARENA + 0.3, 2.5, off, 0.6, 5, 10, c, false);
    }
  }

  // Props: crates, pillars and free-standing slabs to hide against.
  const PROPS = [
    { x: -12, z: -11, w: 3, h: 2.6, d: 3, c: 0xff5f6d },
    { x: -9.5, z: -13, w: 2, h: 1.8, d: 2, c: 0xffd23f },
    { x: 11, z: -12, w: 3.4, h: 3, d: 2.6, c: 0x4aa8ff },
    { x: 13, z: 6, w: 2.4, h: 2.2, d: 2.4, c: 0x3ddc84 },
    { x: -13, z: 9, w: 2.8, h: 2.4, d: 2.8, c: 0xb476ff },
    { x: 3, z: 13, w: 2.2, h: 2, d: 2.2, c: 0xff9a3d },
    { x: -4, z: -6, w: 1.6, h: 5, d: 1.6, c: 0x5ce1e6 },
    { x: 6, z: -3, w: 1.6, h: 5, d: 1.6, c: 0xffd23f },
    { x: -8, z: 3, w: 1.6, h: 5, d: 1.6, c: 0xff5f6d },
    { x: 0, z: -14, w: 7, h: 3.2, d: 0.8, c: 0x8a97a5 },
    { x: -15, z: 0, w: 0.8, h: 3.2, d: 7, c: 0x3ddc84 },
    { x: 8, z: 9, w: 7, h: 3.2, d: 0.8, c: 0xb476ff },
  ];
  for (const p of PROPS) envBox(p.x, p.h / 2, p.z, p.w, p.h, p.d, p.c, true);

  /* ---------- chameleon (player) ---------- */

  const paintMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x151a20 });

  function buildChameleon() {
    const g = new THREE.Group();

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), paintMat);
    body.scale.set(1, 0.82, 1.45);
    body.position.y = 0.62;
    g.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), paintMat);
    head.position.set(0, 0.95, 0.78);
    g.add(head);

    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.75, 10), paintMat);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, 0.88, 1.3);
    g.add(snout);

    // Casque crest so the silhouette reads "chameleon".
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.55, 4), paintMat);
    crest.position.set(0, 1.3, 0.62);
    crest.rotation.z = Math.PI / 4;
    crest.scale.z = 0.35;
    g.add(crest);

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), darkMat);
      eye.position.set(0.3 * side, 1.1, 0.85);
      g.add(eye);
      for (const lz of [0.45, -0.35]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 8), paintMat);
        leg.position.set(0.42 * side, 0.25, lz);
        g.add(leg);
      }
    }

    const tail = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.11, 8, 14, Math.PI * 1.6), paintMat
    );
    tail.position.set(0, 0.62, -0.98);
    tail.rotation.y = Math.PI / 2;
    g.add(tail);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    g.add(shadow);

    return g;
  }

  const player = buildChameleon();
  player.position.set(0, 0, 10);
  scene.add(player);

  /* ---------- seeker mech ---------- */

  const seeker = new THREE.Group();
  const seekerBodyMat = new THREE.MeshLambertMaterial({ color: 0x2c3540 });
  const sBody = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.1, 1.3), seekerBodyMat);
  sBody.position.y = 1.75;
  seeker.add(sBody);
  for (const side of [-1, 1]) {
    const sLeg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.6), seekerBodyMat);
    sLeg.position.set(0.5 * side, 0.7, 0);
    seeker.add(sLeg);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.5, 0.5), seekerBodyMat);
    arm.position.set(1.1 * side, 1.9, 0);
    seeker.add(arm);
  }

  const seekerHead = new THREE.Group();
  seekerHead.position.y = 3.15;
  const sHead = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 1), seekerBodyMat);
  seekerHead.add(sHead);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2f45 });
  const sEye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), eyeMat);
  sEye.position.set(0, 0.05, 0.52);
  seekerHead.add(sEye);
  seeker.add(seekerHead);

  // Vision cone: unit cone with apex at the head, opening toward local +z.
  const coneGeo = new THREE.ConeGeometry(1, 1, 24, 1, true);
  coneGeo.translate(0, -0.5, 0);
  coneGeo.rotateX(-Math.PI / 2);
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xff2f45, transparent: true, opacity: 0.09,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const visionCone = new THREE.Mesh(coneGeo, coneMat);
  seekerHead.add(visionCone);

  const sShadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.1, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })
  );
  sShadow.rotation.x = -Math.PI / 2;
  sShadow.position.y = 0.02;
  seeker.add(sShadow);

  seeker.position.set(-17, 0, -17);
  scene.add(seeker);

  const WAYPOINTS = [
    [-13, -13], [0, -10], [13, -13], [16, 0],
    [13, 13], [0, 16], [-13, 13], [-17, 0],
    [-4, 0], [4, 5],
  ];

  /* ---------- state ---------- */

  // ready | hide | seek | roundend | caught | over
  let phase = 'ready';
  let phaseT = 0;
  let round = 1;
  let best = 0;
  try { best = parseInt(localStorage.getItem('mecha-clone-best-rounds'), 10) || 0; } catch (e) {}
  bestEl.textContent = best;

  let hideTime = 22;
  let seekerSpeed = 3.5;
  let seekerRange = 15;
  let seekerFov = THREE.MathUtils.degToRad(62);

  let suspicion = 0;
  let seekerState = 'idle'; // idle | patrol | investigate
  let wpIndex = 0;
  let lastSeen = new THREE.Vector3();
  let investigateT = 0;

  let camYaw = Math.PI;     // camera starts behind the player looking at -z? (player faces +z)
  let camPitch = 0.28;
  let posed = false;
  let poseScale = 1;
  let moving = false;

  const paintFrom = new THREE.Color(0xf2f2f2);
  const paintTo = new THREE.Color(0xf2f2f2);
  let paintK = 1;

  const raycaster = new THREE.Raycaster();
  const V = {
    a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(),
    fwd: new THREE.Vector3(), right: new THREE.Vector3(),
  };

  function roundParams() {
    hideTime = Math.max(10, 22 - (round - 1) * 2);
    seekerSpeed = Math.min(7, 3.5 + (round - 1) * 0.5);
    seekerRange = Math.min(20, 15 + (round - 1) * 0.8);
    seekerFov = THREE.MathUtils.degToRad(Math.min(80, 62 + (round - 1) * 3));
    const half = Math.tan(seekerFov / 2) * seekerRange;
    visionCone.scale.set(half, half, seekerRange);
  }

  function setBanner(text, cls, ms) {
    banner.textContent = text;
    banner.className = 'banner show' + (cls ? ' ' + cls : '');
    if (ms) setTimeout(() => { banner.className = 'banner'; }, ms);
  }

  function fmt(t) {
    const s = Math.max(0, Math.ceil(t));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function colorDist(a, b) {
    const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
    return Math.sqrt(dr * dr + dg * dg + db * db) / Math.SQRT2;
  }

  /* ---------- game flow ---------- */

  function startGame() {
    round = 1;
    suspicion = 0;
    posed = false;
    poseBtn.classList.remove('on');
    paintFrom.set(0xf2f2f2);
    paintTo.set(0xf2f2f2);
    paintK = 1;
    paintMat.color.set(0xf2f2f2);
    player.position.set(0, 0, 10);
    camYaw = Math.PI;
    startHide();
    overlay.dataset.state = 'playing';
  }

  function startHide() {
    roundParams();
    roundEl.textContent = round;
    phase = 'hide';
    phaseT = hideTime;
    suspicion = 0;
    suspicionWrap.hidden = true;
    seekerState = 'idle';
    seeker.position.set(-17, 0, -17);
    seeker.rotation.y = Math.PI * 1.25; // face the corner: not peeking
    visionCone.visible = false;
    eyeMat.color.set(0x54606e);
    setBanner('PAINT & HIDE', 'safe', 1400);
  }

  function startSeek() {
    phase = 'seek';
    phaseT = SEEK_TIME;
    suspicionWrap.hidden = false;
    seekerState = 'patrol';
    wpIndex = 0;
    visionCone.visible = true;
    eyeMat.color.set(0xff2f45);
    setBanner('SEEKER AWAKE', 'danger', 1400);
  }

  function roundSurvived() {
    phase = 'roundend';
    phaseT = 1.8;
    visionCone.visible = false;
    if (round > best) {
      best = round;
      try { localStorage.setItem('mecha-clone-best-rounds', String(best)); } catch (e) {}
      bestEl.textContent = best;
    }
    setBanner('SURVIVED', 'safe', 1500);
    round += 1;
  }

  function caught() {
    phase = 'caught';
    phaseT = 1.5;
    eyeMat.color.set(0xffffff);
    setBanner('SPOTTED!', 'danger');
  }

  function gameOver() {
    phase = 'over';
    banner.className = 'banner';
    overlayTitle.textContent = 'Spotted!';
    overlayText.textContent =
      'The seeker tagged you in round ' + round + '. ' +
      (round > 1 ? 'You survived ' + (round - 1) + ' full round' + (round > 2 ? 's' : '') + '.' : 'Blend better next time.') +
      ' Tip: paint against a surface, freeze, and stay out of the red cone.';
    actionBtn.textContent = 'Retry';
    overlay.dataset.state = 'over';
  }

  /* ---------- painting ---------- */

  function aimSurfaceColor() {
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = raycaster.intersectObjects(envMeshes);
    return hits.length ? hits[0].object.material.color : null;
  }

  function doPaint() {
    if (phase !== 'hide' && phase !== 'seek') return;
    const c = aimSurfaceColor();
    if (!c) return;
    paintFrom.copy(paintMat.color);
    paintTo.copy(c);
    paintK = 0;
  }

  function togglePose() {
    if (phase !== 'hide' && phase !== 'seek') return;
    posed = !posed;
    poseBtn.classList.toggle('on', posed);
  }

  // The blend hint compares your paint to the nearest huggable surface
  // (a wall/prop within reach), falling back to the floor under you.
  function nearbySurfaceColor() {
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    let bestHit = null;
    for (const d of dirs) {
      V.a.copy(player.position); V.a.y = 1;
      V.b.set(d[0], 0, d[1]);
      raycaster.set(V.a, V.b);
      raycaster.far = 2.4;
      const hits = raycaster.intersectObjects(envMeshes);
      if (hits.length && (!bestHit || hits[0].distance < bestHit.distance)) bestHit = hits[0];
    }
    raycaster.far = Infinity;
    if (bestHit) return bestHit.object.material.color;
    V.a.copy(player.position); V.a.y = 1;
    V.b.set(0, -1, 0);
    raycaster.set(V.a, V.b);
    const hits = raycaster.intersectObjects(envMeshes);
    return hits.length ? hits[0].object.material.color : null;
  }

  /* ---------- input ---------- */

  const keys = {};
  document.addEventListener('keydown', (e) => {
    if (e.key === ' ') { e.preventDefault(); togglePose(); return; }
    if (e.key === 'e' || e.key === 'E') { doPaint(); return; }
    if (e.key === 'Enter' && overlay.dataset.state !== 'playing') { startGame(); return; }
    keys[e.key.toLowerCase()] = true;
    if (e.key.startsWith('Arrow')) { keys[e.key] = true; e.preventDefault(); }
  });
  document.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
    keys[e.key] = false;
  });

  // Pointer: mouse drag = look. Touch: left half joystick, right half look.
  let lookId = null, lookLast = null;
  let stickId = null, stickOrigin = null;
  const stickVec = { x: 0, y: 0 };

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && e.clientX < window.innerWidth / 2) {
      if (stickId === null) {
        stickId = e.pointerId;
        stickOrigin = { x: e.clientX, y: e.clientY };
      }
    } else if (lookId === null) {
      lookId = e.pointerId;
      lookLast = { x: e.clientX, y: e.clientY };
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId === lookId && lookLast) {
      camYaw -= (e.clientX - lookLast.x) * 0.0055;
      camPitch = THREE.MathUtils.clamp(camPitch + (e.clientY - lookLast.y) * 0.004, -0.1, 0.6);
      lookLast = { x: e.clientX, y: e.clientY };
    }
    if (e.pointerId === stickId && stickOrigin) {
      stickVec.x = THREE.MathUtils.clamp((e.clientX - stickOrigin.x) / 55, -1, 1);
      stickVec.y = THREE.MathUtils.clamp((e.clientY - stickOrigin.y) / 55, -1, 1);
    }
  });
  function releasePointer(e) {
    if (e.pointerId === lookId) { lookId = null; lookLast = null; }
    if (e.pointerId === stickId) { stickId = null; stickOrigin = null; stickVec.x = 0; stickVec.y = 0; }
  }
  window.addEventListener('pointerup', releasePointer);
  window.addEventListener('pointercancel', releasePointer);
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

  paintBtn.addEventListener('click', doPaint);
  poseBtn.addEventListener('click', togglePose);
  actionBtn.addEventListener('click', startGame);
  quitBtn.addEventListener('click', () => {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (e) {}
    } else {
      location.href = '../../';
    }
  });

  /* ---------- player movement ---------- */

  function movePlayer(dt) {
    let ix = (keys.d || keys.ArrowRight ? 1 : 0) - (keys.a || keys.ArrowLeft ? 1 : 0) + stickVec.x;
    let iy = (keys.w || keys.ArrowUp ? 1 : 0) - (keys.s || keys.ArrowDown ? 1 : 0) - stickVec.y;
    ix = THREE.MathUtils.clamp(ix, -1, 1);
    iy = THREE.MathUtils.clamp(iy, -1, 1);
    moving = false;
    if (posed || (ix === 0 && iy === 0)) return;

    V.fwd.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    V.right.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
    V.a.copy(V.fwd).multiplyScalar(iy).addScaledVector(V.right, -ix);
    if (V.a.lengthSq() < 0.0001) return;
    V.a.normalize().multiplyScalar(PLAYER_SPEED * dt);

    const p = player.position;
    p.x += V.a.x;
    p.z += V.a.z;

    const r = 0.8;
    p.x = THREE.MathUtils.clamp(p.x, -ARENA + r, ARENA - r);
    p.z = THREE.MathUtils.clamp(p.z, -ARENA + r, ARENA - r);
    for (const c of colliders) {
      if (p.x > c.minX - r && p.x < c.maxX + r && p.z > c.minZ - r && p.z < c.maxZ + r) {
        const dxl = p.x - (c.minX - r), dxr = (c.maxX + r) - p.x;
        const dzl = p.z - (c.minZ - r), dzr = (c.maxZ + r) - p.z;
        const m = Math.min(dxl, dxr, dzl, dzr);
        if (m === dxl) p.x = c.minX - r;
        else if (m === dxr) p.x = c.maxX + r;
        else if (m === dzl) p.z = c.minZ - r;
        else p.z = c.maxZ + r;
      }
    }

    moving = true;
    player.rotation.y = Math.atan2(V.a.x, V.a.z);
  }

  /* ---------- seeker AI + detection ---------- */

  function seekerHeadPos(out) {
    return seekerHead.getWorldPosition(out);
  }

  function seekerLook(dt, t) {
    if (seekerState === 'patrol') {
      seekerHead.rotation.y = Math.sin(t * 1.2) * 0.75;
    } else {
      seekerHead.rotation.y = THREE.MathUtils.lerp(seekerHead.rotation.y, 0, Math.min(1, dt * 5));
    }
  }

  function moveSeekerToward(target, dt) {
    V.a.set(target.x - seeker.position.x, 0, target.z - seeker.position.z);
    const d = V.a.length();
    if (d < 0.01) return d;
    V.a.normalize();
    const yaw = Math.atan2(V.a.x, V.a.z);
    let dy = yaw - seeker.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    seeker.rotation.y += THREE.MathUtils.clamp(dy, -2.4 * dt, 2.4 * dt);
    const step = Math.min(d, seekerSpeed * dt);
    seeker.position.addScaledVector(V.a, step);
    return d - step;
  }

  function detect(dt) {
    const eye = seekerHeadPos(V.b);
    V.c.copy(player.position); V.c.y = 0.7;
    V.a.copy(V.c).sub(eye);
    const dist = V.a.length();

    let visible = false;
    let mismatch = 1;

    if (dist < seekerRange) {
      V.fwd.set(0, 0, 1).applyQuaternion(seekerHead.getWorldQuaternion(new THREE.Quaternion()));
      const angle = V.fwd.angleTo(V.a.clone().normalize());
      if (angle < seekerFov / 2) {
        raycaster.set(eye, V.a.clone().normalize());
        const hits = raycaster.intersectObjects(envMeshes);
        const blocked = hits.length && hits[0].distance < dist - 0.7;
        if (!blocked) {
          visible = true;
          // What does the seeker see BEHIND the chameleon?
          let bg = null;
          for (const h of hits) {
            if (h.distance > dist + 0.3) { bg = h.object.material.color; break; }
          }
          if (!bg) bg = nearbySurfaceColor();
          mismatch = bg ? colorDist(paintMat.color, bg) : 1;
        }
      }
    }

    if (visible) {
      let rate = 0.16 + 1.15 * mismatch;
      rate *= THREE.MathUtils.clamp(1.6 - dist / seekerRange, 0.25, 1.5);
      if (moving) rate *= 2.6;
      if (posed) rate *= 0.55;
      suspicion += rate * dt;
      lastSeen.copy(player.position);
      if (suspicion > 0.6 && seekerState !== 'investigate') {
        seekerState = 'investigate';
        investigateT = 0;
      }
    } else {
      suspicion -= (seekerState === 'investigate' ? 0.035 : 0.07) * dt * 60 * 0.016;
    }
    if (dist < 2.4) suspicion += 2.2 * dt;
    suspicion = THREE.MathUtils.clamp(suspicion, 0, 1);

    eyeMat.color.set(suspicion > 0.6 ? 0xff8c1a : 0xff2f45);
    coneMat.color.set(suspicion > 0.6 ? 0xff8c1a : 0xff2f45);

    if (suspicion >= 1) caught();
  }

  function updateSeeker(dt, t) {
    if (seekerState === 'patrol') {
      const wp = WAYPOINTS[wpIndex];
      const left = moveSeekerToward({ x: wp[0], z: wp[1] }, dt);
      if (left < 1.2) wpIndex = (wpIndex + 1 + Math.floor(Math.random() * 2)) % WAYPOINTS.length;
    } else if (seekerState === 'investigate') {
      const left = moveSeekerToward(lastSeen, dt);
      if (left < 2) {
        investigateT += dt;
        seekerHead.rotation.y = Math.sin(investigateT * 2.5) * 1.1;
        if (investigateT > 2.5 && suspicion < 0.25) seekerState = 'patrol';
      }
      if (suspicion < 0.15) seekerState = 'patrol';
    }
    seekerLook(dt, t);
    detect(dt);
  }

  /* ---------- camera ---------- */

  function updateCamera() {
    const d = 7;
    const h = 2.6 + camPitch * 5;
    camera.position.set(
      player.position.x + Math.sin(camYaw) * d,
      h,
      player.position.z + Math.cos(camYaw) * d
    );
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -ARENA + 0.8, ARENA - 0.8);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -ARENA + 0.8, ARENA - 0.8);
    V.a.copy(player.position); V.a.y = 1.3;
    camera.lookAt(V.a);
  }

  /* ---------- HUD ---------- */

  let hudT = 0;
  function updateHUD(dt) {
    hudT += dt;
    if (hudT < 0.12) return;
    hudT = 0;

    if (phase === 'hide') {
      phasePill.textContent = 'HIDE ' + fmt(phaseT);
      phasePill.className = 'pill big safe';
    } else if (phase === 'seek') {
      phasePill.textContent = 'SURVIVE ' + fmt(phaseT);
      phasePill.className = 'pill big warn';
    } else if (phase === 'roundend') {
      phasePill.textContent = 'ROUND CLEAR';
      phasePill.className = 'pill big safe';
    }

    suspicionFill.style.width = (suspicion * 100).toFixed(1) + '%';
    paintSwatch.style.background = '#' + paintMat.color.getHexString();

    const aim = aimSurfaceColor();
    aimSwatch.style.background = aim ? '#' + aim.getHexString() : 'transparent';

    const near = nearbySurfaceColor();
    const blend = near ? 1 - colorDist(paintMat.color, near) : 0;
    blendFill.style.width = (blend * 100).toFixed(0) + '%';
    blendFill.style.background = blend > 0.85 ? '#3ddc84' : blend > 0.6 ? '#ffd23f' : '#ff5f6d';
  }

  /* ---------- main loop ---------- */

  const clock = new THREE.Clock();

  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;

    // Paint transition.
    if (paintK < 1) {
      paintK = Math.min(1, paintK + dt / 0.35);
      paintMat.color.copy(paintFrom).lerp(paintTo, paintK);
    }

    // Pose squash.
    const target = posed ? 0.45 : 1;
    poseScale += (target - poseScale) * Math.min(1, dt * 10);
    player.scale.set(1 + (1 - poseScale) * 0.35, poseScale, 1 + (1 - poseScale) * 0.35);

    if (phase === 'hide') {
      movePlayer(dt);
      phaseT -= dt;
      if (phaseT <= 0) startSeek();
    } else if (phase === 'seek') {
      movePlayer(dt);
      updateSeeker(dt, t);
      phaseT -= dt;
      if (phase === 'seek' && phaseT <= 0) roundSurvived();
    } else if (phase === 'roundend') {
      phaseT -= dt;
      if (phaseT <= 0) startHide();
    } else if (phase === 'caught') {
      phaseT -= dt;
      // Seeker leans in on the catch.
      moveSeekerToward(player.position, dt * 0.5);
      if (phaseT <= 0) gameOver();
    }

    updateCamera();
    if (phase !== 'ready' && phase !== 'over') updateHUD(dt);
    renderer.render(scene, camera);
  }
  tick();

  /* ---------- loading screen ---------- */

  (function hideLoadingWhenReady() {
    const loading = document.getElementById('game-loading');
    if (!loading) return;
    const navStart = (performance && performance.timeOrigin) || Date.now();
    const elapsed = Date.now() - navStart;
    const remaining = Math.max(0, 1000 - elapsed);
    setTimeout(() => {
      loading.classList.add('hidden');
      setTimeout(() => loading.remove(), 500);
    }, remaining);
  })();
})();
