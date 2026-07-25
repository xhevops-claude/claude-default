(function () {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const actionBtn = document.getElementById('action-btn');
  const quitBtn = document.getElementById('quit-btn');
  const scoreEl = document.getElementById('score');
  const waveEl = document.getElementById('wave');
  const bestEl = document.getElementById('best');
  const banner = document.getElementById('phase-banner');
  const camoBar = document.getElementById('camo-bar');

  const COLS = 10;
  const ROWS = 10;
  const CELL = 48;

  const PALETTE = ['#3ddc84', '#ff5f6d', '#4aa8ff', '#ffd23f', '#b476ff'];
  const WARN_MS = 800;
  const MOVE_MS = 130;

  let grid = [];
  let colors = 3;
  let wave = 1;
  let score = 0;
  let best = 0;
  try { best = parseInt(localStorage.getItem('mecha-clone-best'), 10) || 0; } catch (e) {}
  bestEl.textContent = best;

  // ready | roam | warn | scan | spotted | over
  let phase = 'ready';
  let phaseStart = 0;
  let roamMs = 5200;
  let scanMs = 2200;
  let beamFromLeft = true;

  const player = {
    x: 4, y: 5,        // grid cell
    fx: 4, fy: 5,      // interpolated position for the tween
    fromX: 4, fromY: 4,
    moveStart: -1,     // <0 = idle
    camo: 0,
  };
  let queuedDir = null;
  let cores = [];
  let spottedAt = 0;
  let beamFreezeK = 0; // beam progress at the moment of detection

  /* ---------- helpers ---------- */

  function now() { return performance.now(); }

  function setPhase(p) {
    phase = p;
    phaseStart = now();
  }

  function showBanner(text, cls) {
    banner.textContent = text;
    banner.className = 'phase-banner show' + (cls ? ' ' + cls : '');
  }

  function hideBanner() {
    banner.className = 'phase-banner';
  }

  function waveParams(w) {
    roamMs = Math.max(2600, 5200 - (w - 1) * 250);
    scanMs = Math.max(1000, 2200 - (w - 1) * 90);
    colors = 3 + Math.min(2, Math.floor((w - 1) / 3));
  }

  // Blobby tile map: each cell usually copies a neighbor so same-colored
  // regions form patches big enough to stand on.
  function genGrid() {
    grid = [];
    for (let y = 0; y < ROWS; y++) {
      const row = [];
      for (let x = 0; x < COLS; x++) {
        let c;
        const r = Math.random();
        if (x > 0 && r < 0.42) c = row[x - 1];
        else if (y > 0 && r < 0.78) c = grid[y - 1][x];
        else c = Math.floor(Math.random() * colors);
        row.push(c);
      }
      grid.push(row);
    }
  }

  function spawnCores() {
    cores = [];
    const count = 3 + Math.min(3, wave);
    let guard = 200;
    while (cores.length < count && guard-- > 0) {
      const x = Math.floor(Math.random() * COLS);
      const y = Math.floor(Math.random() * ROWS);
      if (x === player.x && y === player.y) continue;
      if (cores.some((c) => c.x === x && c.y === y)) continue;
      cores.push({ x, y });
    }
  }

  /* ---------- camo UI ---------- */

  function buildCamoBar() {
    camoBar.innerHTML = '';
    for (let i = 0; i < colors; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'camo-swatch' + (i === player.camo ? ' active' : '');
      b.style.background = PALETTE[i];
      b.setAttribute('aria-label', 'Camo color ' + (i + 1));
      b.addEventListener('click', () => setCamo(i));
      camoBar.appendChild(b);
    }
  }

  function setCamo(i) {
    player.camo = i % colors;
    const kids = camoBar.children;
    for (let k = 0; k < kids.length; k++) {
      kids[k].classList.toggle('active', k === player.camo);
    }
  }

  /* ---------- game flow ---------- */

  function startGame() {
    wave = 1;
    score = 0;
    scoreEl.textContent = '0';
    waveEl.textContent = '1';
    startWave(true);
    overlay.dataset.state = 'playing';
  }

  function startWave(resetPlayer) {
    waveParams(wave);
    genGrid();
    if (resetPlayer) {
      player.x = Math.floor(COLS / 2);
      player.y = Math.floor(ROWS / 2);
      player.moveStart = -1;
      player.camo = 0;
    }
    if (player.camo >= colors) player.camo = 0;
    queuedDir = null;
    spawnCores();
    buildCamoBar();
    beamFromLeft = wave % 2 === 1;
    waveEl.textContent = wave;
    setPhase('roam');
  }

  function surviveWave() {
    score += 10;
    scoreEl.textContent = score;
    showBanner('CLEAR', 'safe');
    wave += 1;
    startWave(false);
  }

  function spotted() {
    spottedAt = now();
    beamFreezeK = Math.min(1, (spottedAt - phaseStart) / scanMs);
    setPhase('spotted');
  }

  function gameOver() {
    setPhase('over');
    if (score > best) {
      best = score;
      try { localStorage.setItem('mecha-clone-best', String(best)); } catch (e) {}
      bestEl.textContent = best;
    }
    hideBanner();
    overlayTitle.textContent = 'Spotted!';
    overlayText.textContent =
      'The seeker locked on at wave ' + wave + '. Final score: ' + score + '.';
    actionBtn.textContent = 'Retry';
    overlay.dataset.state = 'over';
  }

  /* ---------- input ---------- */

  function tryMove(dx, dy) {
    if (phase !== 'roam' && phase !== 'warn' && phase !== 'scan') return;
    if (player.moveStart >= 0) { queuedDir = [dx, dy]; return; }
    const nx = player.x + dx;
    const ny = player.y + dy;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return;
    player.fromX = player.x;
    player.fromY = player.y;
    player.x = nx;
    player.y = ny;
    player.moveStart = now();
  }

  const KEYS = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      if (phase === 'ready' || phase === 'over') return;
      setCamo(player.camo + 1);
      return;
    }
    if (e.key === 'Enter' && overlay.dataset.state !== 'playing') {
      startGame();
      return;
    }
    const dir = KEYS[e.key];
    if (dir) {
      e.preventDefault();
      tryMove(dir[0], dir[1]);
    }
  });

  // Swipe to move (one cell per swipe).
  let touchStart = null;
  canvas.addEventListener('pointerdown', (e) => {
    touchStart = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!touchStart) return;
    const dx = e.clientX - touchStart.x;
    const dy = e.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
    if (Math.abs(dx) > Math.abs(dy)) tryMove(dx > 0 ? 1 : -1, 0);
    else tryMove(0, dy > 0 ? 1 : -1);
  });

  actionBtn.addEventListener('click', startGame);

  quitBtn.addEventListener('click', () => {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (e) {}
    } else {
      location.href = '../../';
    }
  });

  /* ---------- update ---------- */

  function beamX(t) {
    // Beam center in pixels for scan progress t in [0, 1].
    const span = COLS * CELL + 120;
    const p = beamFromLeft ? t : 1 - t;
    return -60 + p * span;
  }

  function update() {
    const t = now();

    // Finish movement tween, start queued move.
    if (player.moveStart >= 0) {
      if (t - player.moveStart >= MOVE_MS) {
        player.moveStart = -1;
        player.fx = player.x;
        player.fy = player.y;
        if (queuedDir) {
          const d = queuedDir;
          queuedDir = null;
          tryMove(d[0], d[1]);
        }
      } else {
        const k = (t - player.moveStart) / MOVE_MS;
        player.fx = player.fromX + (player.x - player.fromX) * k;
        player.fy = player.fromY + (player.y - player.fromY) * k;
      }
    } else {
      player.fx = player.x;
      player.fy = player.y;
    }

    // Core pickup (only while roaming — during a scan you should be frozen).
    if (phase === 'roam') {
      for (let i = cores.length - 1; i >= 0; i--) {
        if (cores[i].x === player.x && cores[i].y === player.y) {
          cores.splice(i, 1);
          score += 5;
          scoreEl.textContent = score;
        }
      }
    }

    if (phase === 'roam') {
      const left = roamMs - (t - phaseStart);
      showBanner('SCAN IN ' + Math.max(0, Math.ceil(left / 1000)));
      if (left <= 0) {
        setPhase('warn');
        showBanner('SCANNING!', 'warn');
      }
    } else if (phase === 'warn') {
      if (t - phaseStart >= WARN_MS) setPhase('scan');
    } else if (phase === 'scan') {
      const k = (t - phaseStart) / scanMs;
      const bx = beamX(Math.min(1, k));
      const px = player.fx * CELL + CELL / 2;
      if (Math.abs(bx - px) < CELL * 0.6) {
        const tile = grid[player.y][player.x];
        const moving = player.moveStart >= 0;
        if (moving || player.camo !== tile) spotted();
      }
      if (k >= 1) surviveWave();
    } else if (phase === 'spotted') {
      if (t - spottedAt >= 1100) gameOver();
    }
  }

  /* ---------- draw ---------- */

  function tileFill(c) {
    // Muted tile version of the palette color.
    const hex = PALETTE[c];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 'rgb(' + Math.round(r * 0.34 + 11) + ',' + Math.round(g * 0.34 + 15) + ',' + Math.round(b * 0.34 + 20) + ')';
  }

  function drawGrid() {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        ctx.fillStyle = tileFill(grid[y][x]);
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL + 0.5, 0);
      ctx.lineTo(x * CELL + 0.5, ROWS * CELL);
      ctx.stroke();
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL + 0.5);
      ctx.lineTo(COLS * CELL, y * CELL + 0.5);
      ctx.stroke();
    }
  }

  function drawCores(t) {
    const pulse = 0.75 + 0.25 * Math.sin(t / 220);
    for (const c of cores) {
      const cx = c.x * CELL + CELL / 2;
      const cy = c.y * CELL + CELL / 2;
      ctx.save();
      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 14 * pulse;
      ctx.fillStyle = '#ffe98a';
      ctx.beginPath();
      ctx.arc(cx, cy, 6 * pulse + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPlayer(t) {
    const cx = player.fx * CELL + CELL / 2;
    const cy = player.fy * CELL + CELL / 2;
    const color = PALETTE[player.camo];
    const onTile = player.moveStart < 0 && grid[player.y][player.x] === player.camo;

    ctx.save();
    ctx.translate(cx, cy);

    if (onTile && (phase === 'roam' || phase === 'warn' || phase === 'scan')) {
      // Blended: dashed "stealth" ring, slightly translucent body.
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, CELL * 0.46, t / 900, t / 900 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Curled tail.
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(-13, 4, 7, Math.PI * 0.2, Math.PI * 1.6);
    ctx.stroke();

    // Legs.
    ctx.fillStyle = '#0b0f14';
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-4, 8); ctx.lineTo(-7, 15); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5, 8); ctx.lineTo(8, 15); ctx.stroke();

    // Body.
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 2, 13, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Plating seams (mecha look).
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-6, -5); ctx.lineTo(-4, 9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(1, -6); ctx.lineTo(3, 10); ctx.stroke();

    // Head.
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(12, -3, 8, 7, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Turret eye.
    ctx.fillStyle = '#0b0f14';
    ctx.beginPath();
    ctx.arc(13, -5, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = onTile ? '#8affc0' : '#ffffff';
    ctx.beginPath();
    ctx.arc(14, -5.5, 2, 0, Math.PI * 2);
    ctx.fill();

    // Antenna.
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(9, -9); ctx.lineTo(7, -15); ctx.stroke();
    ctx.fillStyle = '#ff5f6d';
    ctx.beginPath(); ctx.arc(7, -16, 2, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  function drawBeam(t) {
    if (phase === 'warn') {
      // Flash the edge the beam will come from.
      const alpha = 0.25 + 0.2 * Math.sin(t / 90);
      const g = beamFromLeft
        ? ctx.createLinearGradient(0, 0, 90, 0)
        : ctx.createLinearGradient(COLS * CELL, 0, COLS * CELL - 90, 0);
      g.addColorStop(0, 'rgba(255,95,109,' + alpha + ')');
      g.addColorStop(1, 'rgba(255,95,109,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
      return;
    }
    if (phase !== 'scan' && phase !== 'spotted') return;

    const k = phase === 'spotted'
      ? beamFreezeK
      : Math.min(1, (t - phaseStart) / scanMs);
    const bx = beamX(k);
    const trail = beamFromLeft ? -70 : 70;

    const g = ctx.createLinearGradient(bx + trail, 0, bx, 0);
    g.addColorStop(0, 'rgba(255,95,109,0)');
    g.addColorStop(1, 'rgba(255,95,109,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(bx, bx + trail), 0, Math.abs(trail), ROWS * CELL);

    ctx.save();
    ctx.shadowColor = '#ff5f6d';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#ff8b94';
    ctx.fillRect(bx - 2, 0, 4, ROWS * CELL);
    ctx.restore();
  }

  function drawSpotted(t) {
    if (phase !== 'spotted') return;
    const k = (t - spottedAt) / 1100;
    ctx.fillStyle = 'rgba(255,95,109,' + (0.18 + 0.12 * Math.sin(t / 70)) + ')';
    ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);

    // Lock-on ring closing in on the player.
    const cx = player.fx * CELL + CELL / 2;
    const cy = player.fy * CELL + CELL / 2;
    const r = CELL * (1.6 - 1.1 * Math.min(1, k * 1.6));
    ctx.strokeStyle = '#ff5f6d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#ff5f6d';
    ctx.textAlign = 'center';
    ctx.fillText('!! SPOTTED !!', cx, cy - r - 8);
  }

  function frame() {
    if (phase !== 'ready' && phase !== 'over') update();

    const t = now();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (grid.length) {
      drawGrid();
      drawCores(t);
      drawPlayer(t);
      drawBeam(t);
      drawSpotted(t);
    }
    requestAnimationFrame(frame);
  }

  // Pre-render a grid behind the start overlay so the arena isn't blank.
  waveParams(1);
  genGrid();
  spawnCores();
  buildCamoBar();
  requestAnimationFrame(frame);

  // Hide the inline loading screen once ready and at least 1s has elapsed
  // since the document started loading.
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
