(function () {
  'use strict';

  /* Mecha Clone — a single-player homage to the hide-and-seek game
     Meccha Chameleon. You are a white chameleon mech among AI decoys:
     sample colors from the arena or dial them in with the HSL palette,
     paint each body part, freeze your pose and survive the seeker
     patrol. Detection is driven by the color mismatch between your
     paint job and whatever surface is behind you from the seeker's
     point of view. */

  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const actionBtn = document.getElementById('action-btn');
  const quitBtn = document.getElementById('quit-btn');
  const roundEl = document.getElementById('round');
  const bestEl = document.getElementById('best');
  const hidersEl = document.getElementById('hiders');
  const phasePill = document.getElementById('phase-pill');
  const suspicionWrap = document.getElementById('suspicion-wrap');
  const suspicionFill = document.getElementById('suspicion-fill');
  const blendFill = document.getElementById('blend-fill');
  const banner = document.getElementById('banner');
  const palettePanel = document.getElementById('palette-panel');
  const palettePreview = document.getElementById('palette-preview');
  const partChips = document.getElementById('part-chips');
  const hueEl = document.getElementById('hue');
  const satEl = document.getElementById('sat');
  const litEl = document.getElementById('lit');
  const paletteBtn = document.getElementById('palette-btn');
  const sampleBtn = document.getElementById('sample-btn');
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

  const ARENA = 20;
  const PLAYER_SPEED = 6;
  const SEEK_TIME = 45;
  const PARTS = ['body', 'head', 'legs', 'tail'];
  const PART_WEIGHT = { body: 0.45, head: 0.2, legs: 0.2, tail: 0.15 };

  /* ---------- audio (tiny WebAudio synth, no assets) ---------- */

  let actx = null;
  function audioInit() {
    if (actx) return;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  }
  function beep(freq, dur, type, gain, slideTo) {
    if (!actx) return;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, actx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, actx.currentTime + dur);
    g.gain.setValueAtTime(gain || 0.04, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + dur + 0.02);
  }
  const sfx = {
    sample() { beep(660, 0.09, 'square', 0.05, 990); },
    freeze() { beep(220, 0.12, 'sine', 0.06); },
    alert() { beep(440, 0.3, 'sawtooth', 0.05, 720); },
    tick() { beep(880, 0.04, 'square', 0.03); },
    spotted() { beep(320, 0.7, 'sawtooth', 0.07, 70); },
    decoy() { beep(140, 0.35, 'triangle', 0.08, 60); },
    survived() {
      beep(523, 0.14, 'square', 0.05);
      setTimeout(() => beep(659, 0.14, 'square', 0.05), 130);
      setTimeout(() => beep(784, 0.24, 'square', 0.05), 260);
    },
  };

  /* ---------- renderer / scene ---------- */

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  sceneHost.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x141b26, 50, 110);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 300);

  scene.add(new THREE.HemisphereLight(0xbfd6e4, 0x2a2f38, 0.8));
  const sun = new THREE.DirectionalLight(0xfff2df, 0.85);
  sun.position.set(22, 34, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // Sky dome: vertical gradient on an inverted sphere.
  (function sky() {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#070b12');
    grad.addColorStop(0.55, '#14202e');
    grad.addColorStop(0.8, '#23364a');
    grad.addColorStop(1, '#141b26');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(150, 24, 16),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
    );
    scene.add(dome);
  })();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /* ---------- procedural pattern textures ---------- */

  function makeSurface(kind, hex, repeatX, repeatY) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const base = new THREE.Color(hex);
    const dark = base.clone().multiplyScalar(0.78);
    const light = base.clone().lerp(new THREE.Color(0xffffff), 0.18);
    const css = (col) => '#' + col.getHexString();

    g.fillStyle = css(base);
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = css(dark);
    g.fillStyle = css(dark);

    if (kind === 'panel') {
      g.lineWidth = 3;
      for (let i = 0; i <= 128; i += 64) {
        g.strokeRect(1.5 + i, 1.5, 61, 125);
      }
      g.fillStyle = css(light);
      for (const p of [[10, 10], [54, 10], [74, 10], [118, 10], [10, 118], [54, 118], [74, 118], [118, 118]]) {
        g.beginPath(); g.arc(p[0], p[1], 2.5, 0, Math.PI * 2); g.fill();
      }
    } else if (kind === 'brick') {
      g.lineWidth = 4;
      for (let row = 0; row < 4; row++) {
        const y = row * 32;
        g.beginPath(); g.moveTo(0, y + 2); g.lineTo(128, y + 2); g.stroke();
        const off = row % 2 ? 32 : 0;
        for (let x = off; x <= 128; x += 64) {
          g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke();
        }
      }
    } else if (kind === 'planks') {
      g.lineWidth = 3;
      for (let x = 0; x <= 128; x += 32) {
        g.beginPath(); g.moveTo(x + 1.5, 0); g.lineTo(x + 1.5, 128); g.stroke();
      }
      g.fillStyle = css(dark);
      for (const p of [[16, 30], [48, 88], [80, 50], [112, 108]]) {
        g.beginPath(); g.ellipse(p[0], p[1], 3, 5, 0, 0, Math.PI * 2); g.fill();
      }
    } else if (kind === 'stripes') {
      g.lineWidth = 16;
      g.strokeStyle = css(dark);
      for (let i = -128; i < 256; i += 45) {
        g.beginPath(); g.moveTo(i, 132); g.lineTo(i + 132, -4); g.stroke();
      }
    } else if (kind === 'grate') {
      g.lineWidth = 2;
      for (let i = 0; i <= 128; i += 16) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
        g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
      }
    }

    // Average color for the camouflage math.
    const data = g.getImageData(0, 0, 128, 128).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 16) {
      r += data[i]; gg += data[i + 1]; b += data[i + 2]; n++;
    }
    const avg = new THREE.Color(r / n / 255, gg / n / 255, b / n / 255);

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX || 1, repeatY || 1);
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    return { mat, avg };
  }

  /* ---------- arena ---------- */

  const envMeshes = [];
  const colliders = [];
  const HIDE_SPOTS = [];

  function envBox(x, y, z, w, h, d, hex, kind, solid) {
    const s = makeSurface(kind, hex, Math.max(w, d) / 3, Math.max(h, 3) / 3);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), s.mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.avgColor = s.avg;
    scene.add(m);
    envMeshes.push(m);
    if (solid) {
      colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    }
    return m;
  }

  // Ground far beyond the walls, so the skyline sits on something.
  (function outerGround() {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(320, 320),
      new THREE.MeshLambertMaterial({ color: 0x0d1117 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = -0.05;
    m.receiveShadow = true;
    scene.add(m);
  })();

  // Floor: 4x4 patchwork of 10-unit paneled tiles, blobby colors.
  const FLOOR_PALETTE = [0x3ddc84, 0x4aa8ff, 0xff5f6d, 0xffd23f, 0xb476ff, 0xff9a3d, 0x5ce1e6, 0x8a97a5];
  const floorColors = [];
  for (let i = 0; i < 16; i++) {
    const left = i % 4 > 0 ? floorColors[i - 1] : null;
    const up = i >= 4 ? floorColors[i - 4] : null;
    const r = Math.random();
    let hex;
    if (left !== null && r < 0.4) hex = left;
    else if (up !== null && r < 0.75) hex = up;
    else hex = FLOOR_PALETTE[Math.floor(Math.random() * FLOOR_PALETTE.length)];
    floorColors.push(hex);
    const s = makeSurface('panel', hex, 3, 3);
    const tile = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), s.mat);
    tile.rotation.x = -Math.PI / 2;
    tile.position.set((i % 4) * 10 - 15, 0, Math.floor(i / 4) * 10 - 15);
    tile.receiveShadow = true;
    tile.userData.avgColor = s.avg;
    scene.add(tile);
    envMeshes.push(tile);
  }

  // Perimeter walls: 4 brick segments per side, each its own color.
  const WALL_PALETTE = [0xc0455e, 0x3a6ea5, 0x4b9b6e, 0xc9a13b, 0x7a5fb5, 0xb56a3f, 0x3f8f96, 0x5d6b7a];
  for (let s = 0; s < 4; s++) {
    for (let i = 0; i < 4; i++) {
      const hex = WALL_PALETTE[(s * 4 + i * 3) % WALL_PALETTE.length];
      const off = i * 10 - 15;
      let m;
      if (s === 0) m = envBox(off, 2.5, -ARENA - 0.3, 10, 5, 0.6, hex, 'brick', false);
      if (s === 1) m = envBox(off, 2.5, ARENA + 0.3, 10, 5, 0.6, hex, 'brick', false);
      if (s === 2) m = envBox(-ARENA - 0.3, 2.5, off, 0.6, 5, 10, hex, 'brick', false);
      if (s === 3) m = envBox(ARENA + 0.3, 2.5, off, 0.6, 5, 10, hex, 'brick', false);
      if (i === 1) {
        const p = m.position;
        HIDE_SPOTS.push({
          x: THREE.MathUtils.clamp(p.x, -ARENA + 1.4, ARENA - 1.4),
          z: THREE.MathUtils.clamp(p.z, -ARENA + 1.4, ARENA - 1.4),
          color: m.userData.avgColor,
        });
      }
    }
  }

  // Props: crates, pillars and free-standing slabs to hide against.
  const PROPS = [
    { x: -12, z: -11, w: 3, h: 2.6, d: 3, c: 0xff5f6d, k: 'planks' },
    { x: -9.5, z: -13, w: 2, h: 1.8, d: 2, c: 0xffd23f, k: 'planks' },
    { x: 11, z: -12, w: 3.4, h: 3, d: 2.6, c: 0x4aa8ff, k: 'planks' },
    { x: 13, z: 6, w: 2.4, h: 2.2, d: 2.4, c: 0x3ddc84, k: 'planks' },
    { x: -13, z: 9, w: 2.8, h: 2.4, d: 2.8, c: 0xb476ff, k: 'planks' },
    { x: 3, z: 13, w: 2.2, h: 2, d: 2.2, c: 0xff9a3d, k: 'planks' },
    { x: -4, z: -6, w: 1.6, h: 5, d: 1.6, c: 0x5ce1e6, k: 'panel' },
    { x: 6, z: -3, w: 1.6, h: 5, d: 1.6, c: 0xffd23f, k: 'panel' },
    { x: -8, z: 3, w: 1.6, h: 5, d: 1.6, c: 0xff5f6d, k: 'panel' },
    { x: 0, z: -14, w: 7, h: 3.2, d: 0.8, c: 0x8a97a5, k: 'stripes' },
    { x: -15, z: 0, w: 0.8, h: 3.2, d: 7, c: 0x3ddc84, k: 'stripes' },
    { x: 8, z: 9, w: 7, h: 3.2, d: 0.8, c: 0xb476ff, k: 'stripes' },
    { x: 15, z: -4, w: 2, h: 1.2, d: 4.5, c: 0x3a6ea5, k: 'grate' },
    { x: -2, z: 7, w: 4.5, h: 1.2, d: 2, c: 0xc9a13b, k: 'grate' },
  ];
  for (const p of PROPS) {
    const m = envBox(p.x, p.h / 2, p.z, p.w, p.h, p.d, p.c, p.k, true);
    HIDE_SPOTS.push({ x: p.x + p.w / 2 + 1.1, z: p.z, color: m.userData.avgColor });
    HIDE_SPOTS.push({ x: p.x - p.w / 2 - 1.1, z: p.z, color: m.userData.avgColor });
  }

  // City skyline silhouette beyond the walls.
  (function skyline() {
    const winTexCanvas = document.createElement('canvas');
    winTexCanvas.width = winTexCanvas.height = 64;
    const wg = winTexCanvas.getContext('2d');
    wg.fillStyle = '#131a24';
    wg.fillRect(0, 0, 64, 64);
    wg.fillStyle = '#ffd97a';
    for (let y = 6; y < 64; y += 10) {
      for (let x = 6; x < 64; x += 10) {
        if (Math.random() < 0.28) wg.fillRect(x, y, 3, 4);
      }
    }
    const winTex = new THREE.CanvasTexture(winTexCanvas);
    winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + 0.2;
      const rad = 34 + (i % 4) * 5;
      const w = 5 + (i % 3) * 3;
      const h = 9 + ((i * 7) % 14);
      const tex = winTex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(w / 4, h / 4);
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, w),
        new THREE.MeshLambertMaterial({ map: tex })
      );
      tower.position.set(Math.cos(ang) * rad, h / 2 - 0.1, Math.sin(ang) * rad);
      scene.add(tower);
    }
  })();

  /* ---------- chameleon factory ---------- */

  function buildChameleon() {
    const mats = {
      body: new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }),
      head: new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }),
      legs: new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }),
      tail: new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }),
    };
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x151a20 });
    const g = new THREE.Group();
    const legs = [];

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), mats.body);
    body.scale.set(1, 0.82, 1.45);
    body.position.y = 0.62;
    g.add(body);

    // Segmented back plates for a mecha feel.
    for (let i = 0; i < 3; i++) {
      const plate = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 4), mats.body);
      plate.position.set(0, 1.12 - i * 0.06, 0.15 - i * 0.32);
      plate.scale.z = 0.5;
      g.add(plate);
    }

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), mats.head);
    head.position.set(0, 0.95, 0.78);
    g.add(head);

    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.75, 10), mats.head);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, 0.88, 1.3);
    g.add(snout);

    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.55, 4), mats.head);
    crest.position.set(0, 1.3, 0.62);
    crest.rotation.z = Math.PI / 4;
    crest.scale.z = 0.35;
    g.add(crest);

    for (const side of [-1, 1]) {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), mats.head);
      socket.position.set(0.3 * side, 1.1, 0.85);
      g.add(socket);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), darkMat);
      eye.position.set(0.38 * side, 1.12, 0.9);
      g.add(eye);
      for (const lz of [0.45, -0.35]) {
        const hip = new THREE.Group();
        hip.position.set(0.42 * side, 0.5, lz);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 8), mats.legs);
        leg.position.y = -0.25;
        hip.add(leg);
        const foot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), mats.legs);
        foot.position.y = -0.5;
        hip.add(foot);
        g.add(hip);
        legs.push(hip);
      }
    }

    const tail = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.11, 8, 14, Math.PI * 1.6), mats.tail
    );
    tail.position.set(0, 0.62, -0.98);
    tail.rotation.y = Math.PI / 2;
    g.add(tail);

    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return { group: g, mats, legs, tail };
  }

  function makeHider(isPlayer) {
    const c = buildChameleon();
    scene.add(c.group);
    return {
      isPlayer,
      group: c.group,
      mats: c.mats,
      legs: c.legs,
      tailMesh: c.tail,
      alive: true,
      suspicion: 0,
      lastSeen: new THREE.Vector3(),
      moving: false,
      posed: false,
      poseScale: 1,
      walkT: 0,
      fallT: -1,
      seenThisFrame: false,
      anims: {},          // per-part paint transitions
      spot: null,         // AI: where it's heading to hide
      state: 'idle',      // AI: idle | toSpot | settled
    };
  }

  const playerHider = makeHider(true);
  const player = playerHider.group;
  player.position.set(0, 0, 10);
  let aiHiders = [];
  let hiders = [playerHider];

  function disposeHider(h) {
    scene.remove(h.group);
    h.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    for (const p of PARTS) h.mats[p].dispose();
  }

  /* ---------- seekers ---------- */

  const WAYPOINTS = [
    [-13, -13], [0, -10], [13, -13], [16, 0],
    [13, 13], [0, 16], [-13, 13], [-17, 0],
    [-4, 0], [4, 5], [10, -6], [-10, -4],
  ];
  const SEEKER_HOMES = [[-17, -17], [17, -17]];

  function buildSeeker() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2c3540 });
    const trimMat = new THREE.MeshLambertMaterial({ color: 0x454f5c });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.1, 1.3), bodyMat);
    torso.position.y = 1.75;
    group.add(torso);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 1.45), trimMat);
    chest.position.y = 2.35;
    group.add(chest);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.6), bodyMat);
      leg.position.set(0.5 * side, 0.7, 0);
      group.add(leg);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.5, 0.5), trimMat);
      arm.position.set(1.15 * side, 1.9, 0);
      group.add(arm);
      const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.7), bodyMat);
      shoulder.position.set(1.15 * side, 2.7, 0);
      group.add(shoulder);
    }
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), trimMat);
    antenna.position.set(-0.6, 3.6, 0);
    group.add(antenna);

    const head = new THREE.Group();
    head.position.y = 3.15;
    head.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 1), bodyMat));
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.3, 0.15), trimMat);
    visor.position.set(0, 0.1, 0.5);
    head.add(visor);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2f45 });
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), eyeMat);
    eye.position.set(0, 0.08, 0.56);
    head.add(eye);

    const coneGeo = new THREE.ConeGeometry(1, 1, 24, 1, true);
    coneGeo.translate(0, -0.5, 0);
    coneGeo.rotateX(-Math.PI / 2);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xff2f45, transparent: true, opacity: 0.09,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    head.add(cone);
    group.add(head);

    group.traverse((o) => { if (o.isMesh && o.material !== coneMat) o.castShadow = true; });
    scene.add(group);
    return {
      group, head, cone, coneMat, eyeMat,
      state: 'idle', wpIndex: Math.floor(Math.random() * WAYPOINTS.length),
      target: null, investT: 0,
    };
  }

  let seekers = [];
  function setSeekerCount(n) {
    while (seekers.length < n) seekers.push(buildSeeker());
    while (seekers.length > n) {
      const s = seekers.pop();
      scene.remove(s.group);
    }
    seekers.forEach((s, i) => {
      const home = SEEKER_HOMES[i % SEEKER_HOMES.length];
      s.group.position.set(home[0], 0, home[1]);
      s.group.rotation.y = Math.atan2(home[0], home[1]); // face the corner
      s.state = 'idle';
      s.cone.visible = false;
      s.eyeMat.color.set(0x54606e);
    });
  }

  /* ---------- state ---------- */

  // ready | hide | seek | roundend | caught | over
  let phase = 'ready';
  let phaseT = 0;
  let round = 1;
  let best = 0;
  try { best = parseInt(localStorage.getItem('mecha-clone-best-rounds'), 10) || 0; } catch (e) {}
  bestEl.textContent = best;

  let hideTime = 24;
  let seekerSpeed = 3.5;
  let seekerRange = 15;
  let seekerFov = THREE.MathUtils.degToRad(62);
  let lastTickSec = -1;
  let prevPlayerSusp = 0;

  let camYaw = Math.PI;
  let camPitch = 0.28;

  const raycaster = new THREE.Raycaster();
  const V = {
    a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(),
    dir: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(),
  };
  const Q1 = new THREE.Quaternion();
  const scratchColor = new THREE.Color();

  function roundParams() {
    hideTime = Math.max(12, 24 - (round - 1) * 2);
    seekerSpeed = Math.min(6.5, 3.5 + (round - 1) * 0.45);
    seekerRange = Math.min(20, 15 + (round - 1) * 0.8);
    seekerFov = THREE.MathUtils.degToRad(Math.min(80, 62 + (round - 1) * 3));
    const half = Math.tan(seekerFov / 2) * seekerRange;
    for (const s of seekers) s.cone.scale.set(half, half, seekerRange);
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

  function avgPaint(h, out) {
    out.setRGB(0, 0, 0);
    for (const p of PARTS) {
      const c = h.mats[p].color;
      const w = PART_WEIGHT[p];
      out.r += c.r * w; out.g += c.g * w; out.b += c.b * w;
    }
    return out;
  }

  function surfaceColorAt(pos) {
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    let bestHit = null;
    for (const d of dirs) {
      V.a.copy(pos); V.a.y = 1;
      V.b.set(d[0], 0, d[1]);
      raycaster.set(V.a, V.b);
      raycaster.far = 2.4;
      const hits = raycaster.intersectObjects(envMeshes);
      if (hits.length && (!bestHit || hits[0].distance < bestHit.distance)) bestHit = hits[0];
    }
    raycaster.far = Infinity;
    if (bestHit) return bestHit.object.userData.avgColor;
    V.a.copy(pos); V.a.y = 1;
    V.b.set(0, -1, 0);
    raycaster.set(V.a, V.b);
    const hits = raycaster.intersectObjects(envMeshes);
    return hits.length ? hits[0].object.userData.avgColor : null;
  }

  /* ---------- painting / palette ---------- */

  let selectedPart = 'all';
  const hsl = { h: 120, s: 0, l: 95 };

  function partsOf(sel) { return sel === 'all' ? PARTS : [sel]; }

  function paintPart(h, part, color, instant) {
    if (instant) {
      h.mats[part].color.copy(color);
      delete h.anims[part];
    } else {
      h.anims[part] = { from: h.mats[part].color.clone(), to: color.clone(), k: 0 };
    }
  }

  function sliderColor() {
    return scratchColor.setHSL(hsl.h / 360, hsl.s / 100, hsl.l / 100);
  }

  function refreshPaletteUI() {
    const c = sliderColor();
    palettePreview.style.background = '#' + c.getHexString();
    const mid = new THREE.Color().setHSL(hsl.h / 360, 1, 0.5).getHexString();
    const g1 = new THREE.Color().setHSL(hsl.h / 360, 0, hsl.l / 100).getHexString();
    const g2 = new THREE.Color().setHSL(hsl.h / 360, 1, hsl.l / 100).getHexString();
    satEl.style.setProperty('--track', 'linear-gradient(90deg, #' + g1 + ', #' + g2 + ')');
    litEl.style.setProperty('--track', 'linear-gradient(90deg, #000, #' + mid + ', #fff)');
  }

  function applySliders(instant) {
    const c = sliderColor();
    for (const p of partsOf(selectedPart)) paintPart(playerHider, p, c, instant);
    refreshPaletteUI();
  }

  function setSlidersFromColor(color) {
    const o = { h: 0, s: 0, l: 0 };
    color.getHSL(o);
    hsl.h = Math.round(o.h * 360);
    hsl.s = Math.round(o.s * 100);
    hsl.l = Math.round(o.l * 100);
    hueEl.value = hsl.h;
    satEl.value = hsl.s;
    litEl.value = hsl.l;
    refreshPaletteUI();
  }

  for (const el of [hueEl, satEl, litEl]) {
    el.addEventListener('input', () => {
      hsl.h = +hueEl.value; hsl.s = +satEl.value; hsl.l = +litEl.value;
      applySliders(true);
    });
  }

  partChips.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-part]');
    if (!btn) return;
    selectedPart = btn.dataset.part;
    for (const b of partChips.children) b.classList.toggle('active', b === btn);
    const ref = selectedPart === 'all' ? 'body' : selectedPart;
    setSlidersFromColor(playerHider.mats[ref].color);
  });

  function aimSurface() {
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = raycaster.intersectObjects(envMeshes);
    return hits.length ? hits[0].object.userData.avgColor : null;
  }

  function doSample() {
    if (phase !== 'hide' && phase !== 'seek') return;
    const c = aimSurface();
    if (!c) return;
    setSlidersFromColor(c);
    for (const p of partsOf(selectedPart)) paintPart(playerHider, p, c, false);
    sfx.sample();
  }

  function togglePose() {
    if (phase !== 'hide' && phase !== 'seek') return;
    playerHider.posed = !playerHider.posed;
    poseBtn.classList.toggle('on', playerHider.posed);
    sfx.freeze();
  }

  paletteBtn.addEventListener('click', () => {
    const closed = palettePanel.classList.toggle('closed');
    paletteBtn.classList.toggle('on', !closed);
  });
  sampleBtn.addEventListener('click', doSample);
  poseBtn.addEventListener('click', togglePose);
  refreshPaletteUI();

  /* ---------- game flow ---------- */

  function startGame() {
    audioInit();
    round = 1;
    playerHider.suspicion = 0;
    playerHider.posed = false;
    playerHider.alive = true;
    poseBtn.classList.remove('on');
    for (const p of PARTS) paintPart(playerHider, p, new THREE.Color(0xf2f2f2), true);
    hsl.h = 120; hsl.s = 0; hsl.l = 95;
    hueEl.value = 120; satEl.value = 0; litEl.value = 95;
    refreshPaletteUI();
    player.position.set(0, 0, 10);
    player.rotation.y = Math.PI;
    camYaw = Math.PI;
    startHide();
    overlay.dataset.state = 'playing';
  }

  function spawnAIHiders() {
    for (const h of aiHiders) disposeHider(h);
    aiHiders = [];
    const count = round === 1 ? 2 : 3;
    const spots = HIDE_SPOTS.slice();
    for (let i = 0; i < count; i++) {
      const h = makeHider(false);
      const start = [[-6, 12], [8, 12], [-2, 15]][i % 3];
      h.group.position.set(start[0], 0, start[1]);
      const si = Math.floor(Math.random() * spots.length);
      h.spot = spots.splice(si, 1)[0];
      h.state = 'toSpot';
      aiHiders.push(h);
    }
    hiders = [playerHider].concat(aiHiders);
  }

  function startHide() {
    roundEl.textContent = round;
    setSeekerCount(round >= 3 ? 2 : 1);
    roundParams();
    spawnAIHiders();
    phase = 'hide';
    phaseT = hideTime;
    lastTickSec = -1;
    for (const h of hiders) { h.suspicion = 0; h.seenThisFrame = false; }
    suspicionWrap.hidden = true;
    hidersEl.textContent = hiders.filter((h) => h.alive).length;
    setBanner('ROUND ' + round + ' — PAINT & HIDE', 'safe', 1600);
  }

  function startSeek() {
    phase = 'seek';
    phaseT = SEEK_TIME;
    suspicionWrap.hidden = false;
    for (const s of seekers) {
      s.state = 'patrol';
      s.cone.visible = true;
      s.eyeMat.color.set(0xff2f45);
    }
    // Any decoy still wandering just freezes where it stands.
    for (const h of aiHiders) {
      if (h.state === 'toSpot') settleAI(h);
    }
    setBanner('SEEKERS AWAKE', 'danger', 1400);
    sfx.alert();
  }

  function roundSurvived() {
    phase = 'roundend';
    phaseT = 1.9;
    for (const s of seekers) s.cone.visible = false;
    if (round > best) {
      best = round;
      try { localStorage.setItem('mecha-clone-best-rounds', String(best)); } catch (e) {}
      bestEl.textContent = best;
    }
    setBanner('HIDERS WIN', 'safe', 1700);
    sfx.survived();
    round += 1;
  }

  function caught() {
    if (phase !== 'seek') return;
    phase = 'caught';
    phaseT = 1.6;
    setBanner('SPOTTED!', 'danger');
    sfx.spotted();
  }

  function eliminateAI(h) {
    h.alive = false;
    h.fallT = 0;
    h.suspicion = 0;
    hidersEl.textContent = hiders.filter((x) => x.alive).length;
    for (const s of seekers) {
      if (s.target === h) { s.state = 'patrol'; s.target = null; }
    }
    setBanner('DECOY TAGGED', 'info', 1200);
    sfx.decoy();
  }

  function gameOver() {
    phase = 'over';
    banner.className = 'banner';
    const decoys = aiHiders.filter((h) => h.alive).length;
    overlayTitle.textContent = 'Spotted!';
    overlayText.textContent =
      'A seeker verified you in round ' + round + '. ' +
      (round > 1 ? 'You survived ' + (round - 1) + ' full round' + (round > 2 ? 's' : '') + '. ' : '') +
      (decoys > 0 ? decoys + ' decoy' + (decoys > 1 ? 's were' : ' was') + ' still hidden — they needed you. ' : '') +
      'Tip: sample a surface, fine-tune with the sliders, and freeze with your back against it.';
    actionBtn.textContent = 'Retry';
    overlay.dataset.state = 'over';
  }

  /* ---------- input ---------- */

  const keys = {};
  document.addEventListener('keydown', (e) => {
    if (e.key === ' ') { e.preventDefault(); togglePose(); return; }
    if (e.key === 'e' || e.key === 'E') { doSample(); return; }
    if (e.key === 'Enter' && overlay.dataset.state !== 'playing') { startGame(); return; }
    keys[e.key.toLowerCase()] = true;
    if (e.key.startsWith('Arrow')) { keys[e.key] = true; e.preventDefault(); }
  });
  document.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
    keys[e.key] = false;
  });

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

  actionBtn.addEventListener('click', startGame);
  quitBtn.addEventListener('click', () => {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (e) {}
    } else {
      location.href = '../../';
    }
  });

  /* ---------- movement ---------- */

  function resolveCollisions(p, r) {
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
  }

  function movePlayer(dt) {
    let ix = (keys.d || keys.ArrowRight ? 1 : 0) - (keys.a || keys.ArrowLeft ? 1 : 0) + stickVec.x;
    let iy = (keys.w || keys.ArrowUp ? 1 : 0) - (keys.s || keys.ArrowDown ? 1 : 0) - stickVec.y;
    ix = THREE.MathUtils.clamp(ix, -1, 1);
    iy = THREE.MathUtils.clamp(iy, -1, 1);
    playerHider.moving = false;
    if (playerHider.posed || (ix === 0 && iy === 0)) return;

    V.fwd.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    V.right.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
    V.a.copy(V.fwd).multiplyScalar(iy).addScaledVector(V.right, -ix);
    if (V.a.lengthSq() < 0.0001) return;
    V.a.normalize().multiplyScalar(PLAYER_SPEED * dt);

    player.position.x += V.a.x;
    player.position.z += V.a.z;
    resolveCollisions(player.position, 0.8);
    playerHider.moving = true;
    player.rotation.y = Math.atan2(V.a.x, V.a.z);
  }

  /* ---------- AI hiders ---------- */

  function settleAI(h) {
    h.state = 'settled';
    h.moving = false;
    h.posed = true;
    const base = h.spot && h.spot.color ? h.spot.color : surfaceColorAt(h.group.position);
    const jitter = 0.03 + 0.015 * round;
    for (const p of PARTS) {
      const c = (base ? base.clone() : new THREE.Color(0x888888));
      c.offsetHSL((Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter * 3, (Math.random() - 0.5) * jitter * 2);
      paintPart(h, p, c, false);
    }
    h.group.rotation.y = Math.random() * Math.PI * 2;
  }

  function updateAI(h, dt) {
    if (!h.alive || h.state !== 'toSpot') return;
    V.a.set(h.spot.x - h.group.position.x, 0, h.spot.z - h.group.position.z);
    const d = V.a.length();
    if (d < 0.4) { settleAI(h); return; }
    V.a.normalize().multiplyScalar(Math.min(d, 4.2 * dt));
    h.group.position.add(V.a);
    resolveCollisions(h.group.position, 0.8);
    h.group.rotation.y = Math.atan2(V.a.x, V.a.z);
    h.moving = true;
  }

  /* ---------- seeker AI + detection ---------- */

  function moveGroupToward(group, tx, tz, dt, speed) {
    V.a.set(tx - group.position.x, 0, tz - group.position.z);
    const d = V.a.length();
    if (d < 0.01) return d;
    V.a.normalize();
    const yaw = Math.atan2(V.a.x, V.a.z);
    let dy = yaw - group.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    group.rotation.y += THREE.MathUtils.clamp(dy, -2.4 * dt, 2.4 * dt);
    const step = Math.min(d, speed * dt);
    group.position.addScaledVector(V.a, step);
    return d - step;
  }

  function updateSeeker(s, dt, t) {
    if (s.state === 'patrol') {
      const wp = WAYPOINTS[s.wpIndex];
      const left = moveGroupToward(s.group, wp[0], wp[1], dt, seekerSpeed);
      if (left < 1.2) s.wpIndex = (s.wpIndex + 1 + Math.floor(Math.random() * 2)) % WAYPOINTS.length;
      s.head.rotation.y = Math.sin(t * 1.2 + s.wpIndex) * 0.75;

      let suspect = null;
      for (const h of hiders) {
        if (h.alive && h.suspicion > 0.6 && (!suspect || h.suspicion > suspect.suspicion)) suspect = h;
      }
      if (suspect) { s.state = 'investigate'; s.target = suspect; s.investT = 0; }
    } else if (s.state === 'investigate') {
      const h = s.target;
      if (!h || !h.alive || h.suspicion < 0.15) { s.state = 'patrol'; s.target = null; return; }
      const left = moveGroupToward(s.group, h.lastSeen.x, h.lastSeen.z, dt, seekerSpeed);
      if (left < 2) {
        s.investT += dt;
        s.head.rotation.y = Math.sin(s.investT * 2.5) * 1.1;
        if (s.investT > 2.5 && h.suspicion < 0.25) { s.state = 'patrol'; s.target = null; }
      } else {
        s.head.rotation.y = THREE.MathUtils.lerp(s.head.rotation.y, 0, Math.min(1, dt * 5));
      }
    }
    const investigating = s.state === 'investigate';
    s.eyeMat.color.set(investigating ? 0xff8c1a : 0xff2f45);
    s.coneMat.color.set(investigating ? 0xff8c1a : 0xff2f45);
  }

  function detectAll(dt) {
    for (const h of hiders) if (h.alive) h.seenThisFrame = false;

    for (const s of seekers) {
      const eye = s.head.getWorldPosition(V.b);
      s.head.getWorldQuaternion(Q1);
      V.fwd.set(0, 0, 1).applyQuaternion(Q1);

      for (const h of hiders) {
        if (!h.alive) continue;
        V.c.copy(h.group.position); V.c.y = 0.7;
        V.a.copy(V.c).sub(eye);
        const dist = V.a.length();

        if (dist < 2.4) {
          h.suspicion += 2.2 * dt;
          h.seenThisFrame = true;
          h.lastSeen.copy(h.group.position);
          continue;
        }
        if (dist > seekerRange) continue;
        V.dir.copy(V.a).normalize();
        if (V.fwd.angleTo(V.dir) > seekerFov / 2) continue;

        raycaster.set(eye, V.dir);
        const hits = raycaster.intersectObjects(envMeshes);
        if (hits.length && hits[0].distance < dist - 0.7) continue;

        let bg = null;
        for (const hit of hits) {
          if (hit.distance > dist + 0.3) { bg = hit.object.userData.avgColor; break; }
        }
        if (!bg) bg = surfaceColorAt(h.group.position);
        const mismatch = bg ? colorDist(avgPaint(h, scratchColor), bg) : 1;

        let rate = 0.15 + 1.15 * mismatch;
        rate *= THREE.MathUtils.clamp(1.6 - dist / seekerRange, 0.25, 1.5);
        if (h.moving) rate *= 2.6;
        if (h.posed) rate *= 0.55;
        h.suspicion += rate * dt;
        h.seenThisFrame = true;
        h.lastSeen.copy(h.group.position);
      }
    }

    for (const h of hiders) {
      if (!h.alive) continue;
      if (!h.seenThisFrame) {
        const investigated = seekers.some((s) => s.target === h && s.state === 'investigate');
        h.suspicion -= (investigated ? 0.035 : 0.07) * dt;
      }
      h.suspicion = THREE.MathUtils.clamp(h.suspicion, 0, 1);
      if (h.suspicion >= 1) {
        if (h.isPlayer) caught();
        else eliminateAI(h);
      }
    }

    if (playerHider.suspicion > 0.6 && prevPlayerSusp <= 0.6) sfx.alert();
    prevPlayerSusp = playerHider.suspicion;
  }

  /* ---------- shared hider visuals ---------- */

  function updateHiderVisuals(h, dt, t) {
    // Paint transitions.
    for (const p of PARTS) {
      const a = h.anims[p];
      if (!a) continue;
      a.k = Math.min(1, a.k + dt / 0.35);
      h.mats[p].color.copy(a.from).lerp(a.to, a.k);
      if (a.k >= 1) delete h.anims[p];
    }
    // Pose squash.
    const target = h.posed ? 0.45 : 1;
    h.poseScale += (target - h.poseScale) * Math.min(1, dt * 10);
    h.group.scale.set(1 + (1 - h.poseScale) * 0.35, h.poseScale, 1 + (1 - h.poseScale) * 0.35);
    // Walk cycle + idle tail sway.
    if (h.moving) h.walkT += dt * 11;
    for (let i = 0; i < h.legs.length; i++) {
      h.legs[i].rotation.x = h.moving ? Math.sin(h.walkT + (i % 2) * Math.PI) * 0.55 : 0;
    }
    h.tailMesh.rotation.x = Math.sin(t * 1.6 + (h.isPlayer ? 0 : 2)) * 0.18;
    // Tagged decoys tip over and grey out.
    if (!h.alive && h.fallT >= 0 && h.fallT < 1) {
      h.fallT = Math.min(1, h.fallT + dt * 1.8);
      h.group.rotation.z = (Math.PI / 2) * h.fallT * h.fallT;
      for (const p of PARTS) h.mats[p].color.lerp(new THREE.Color(0x4a5058), dt * 3);
    }
  }

  /* ---------- camera ---------- */

  function updateCamera(dt, t) {
    if (phase === 'ready' || phase === 'over') {
      const a = t * 0.12;
      camera.position.set(Math.cos(a) * 17, 9, Math.sin(a) * 17);
      camera.lookAt(0, 1, 0);
      return;
    }
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

    suspicionFill.style.width = (playerHider.suspicion * 100).toFixed(1) + '%';

    const near = surfaceColorAt(player.position);
    const blend = near ? 1 - colorDist(avgPaint(playerHider, scratchColor), near) : 0;
    blendFill.style.width = (blend * 100).toFixed(0) + '%';
    blendFill.style.background = blend > 0.85 ? '#3ddc84' : blend > 0.6 ? '#ffd23f' : '#ff5f6d';
  }

  /* ---------- main loop ---------- */

  const clock = new THREE.Clock();

  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;

    for (const h of hiders) updateHiderVisuals(h, dt, t);

    if (phase === 'hide') {
      movePlayer(dt);
      for (const h of aiHiders) updateAI(h, dt);
      phaseT -= dt;
      if (phaseT <= 0) startSeek();
    } else if (phase === 'seek') {
      movePlayer(dt);
      for (const s of seekers) updateSeeker(s, dt, t);
      detectAll(dt);
      phaseT -= dt;
      const sec = Math.ceil(phaseT);
      if (sec <= 5 && sec !== lastTickSec && sec > 0) { lastTickSec = sec; sfx.tick(); }
      if (phase === 'seek' && phaseT <= 0) roundSurvived();
    } else if (phase === 'roundend') {
      phaseT -= dt;
      if (phaseT <= 0) startHide();
    } else if (phase === 'caught') {
      phaseT -= dt;
      for (const s of seekers) moveGroupToward(s.group, player.position.x, player.position.z, dt, seekerSpeed * 0.5);
      if (phaseT <= 0) gameOver();
    }

    updateCamera(dt, t);
    if (phase !== 'ready' && phase !== 'over') updateHUD(dt);
    renderer.render(scene, camera);
  }
  setSeekerCount(1);
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
