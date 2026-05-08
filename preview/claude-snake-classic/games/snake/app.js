(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const actionBtn = document.getElementById('action-btn');
  const quitBtn = document.getElementById('quit-btn');

  function quit() {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (_) {}
    } else {
      location.href = '../../';
    }
  }
  quitBtn.addEventListener('click', quit);

  const GRID = 20;
  const CELL = canvas.width / GRID;
  const TICK_START = 130;
  const TICK_MIN = 60;
  const TICK_STEP = 3;

  let snake, dir, queuedDir, food, score, best, tickMs, lastTick, raf;
  let state = 'ready'; // ready | playing | paused | over

  // Format scores Nokia-style: zero-padded to 4 digits.
  const fmt = (n) => String(n).padStart(4, '0');

  try { best = parseInt(localStorage.getItem('snake-best') || '0', 10) || 0; } catch (_) { best = 0; }
  bestEl.textContent = fmt(best);

  function reset() {
    snake = [
      { x: 9, y: 10 },
      { x: 8, y: 10 },
      { x: 7, y: 10 },
    ];
    dir = { x: 1, y: 0 };
    queuedDir = dir;
    score = 0;
    tickMs = TICK_START;
    placeFood();
    scoreEl.textContent = fmt(score);
  }

  function placeFood() {
    while (true) {
      const f = {
        x: Math.floor(Math.random() * GRID),
        y: Math.floor(Math.random() * GRID),
      };
      if (!snake.some((s) => s.x === f.x && s.y === f.y)) {
        food = f;
        return;
      }
    }
  }

  function setOverlay(s, title, text, btn) {
    state = s;
    if (s === 'playing') {
      overlay.dataset.state = 'hidden';
      return;
    }
    overlay.dataset.state = s;
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    actionBtn.textContent = btn;
  }

  function start() {
    reset();
    setOverlay('playing');
    lastTick = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function pause() {
    if (state !== 'playing') return;
    setOverlay('paused', 'PAUSED', 'Press space, tap, or hit RESUME to continue.', 'RESUME');
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'playing';
    overlay.dataset.state = 'hidden';
    lastTick = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function gameOver() {
    if (score > best) {
      best = score;
      bestEl.textContent = fmt(best);
      try { localStorage.setItem('snake-best', String(best)); } catch (_) {}
    }
    setOverlay('over', 'GAME OVER', `Score: ${score}    Best: ${best}`, 'PLAY AGAIN');
  }

  function step() {
    // Apply queued direction if it isn't a 180° reverse.
    if (queuedDir.x !== -dir.x || queuedDir.y !== -dir.y) {
      dir = queuedDir;
    }

    const head = snake[0];
    const next = { x: head.x + dir.x, y: head.y + dir.y };

    if (next.x < 0 || next.x >= GRID || next.y < 0 || next.y >= GRID) {
      return gameOver();
    }
    // Self-collision (skip the tail tip since it will move out unless we eat).
    const willEat = next.x === food.x && next.y === food.y;
    const body = willEat ? snake : snake.slice(0, -1);
    if (body.some((s) => s.x === next.x && s.y === next.y)) {
      return gameOver();
    }

    snake.unshift(next);
    if (willEat) {
      score += 1;
      scoreEl.textContent = fmt(score);
      tickMs = Math.max(TICK_MIN, tickMs - TICK_STEP);
      placeFood();
    } else {
      snake.pop();
    }
  }

  function loop(now) {
    if (state !== 'playing') return;
    if (now - lastTick >= tickMs) {
      step();
      lastTick = now;
      if (state !== 'playing') {
        draw();
        return;
      }
    }
    draw();
    raf = requestAnimationFrame(loop);
  }

  function draw() {
    // Background grid.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const gridLine = getCss('--grid-line');
    ctx.strokeStyle = gridLine;
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL + 0.5, 0);
      ctx.lineTo(i * CELL + 0.5, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * CELL + 0.5);
      ctx.lineTo(canvas.width, i * CELL + 0.5);
      ctx.stroke();
    }

    // Food — small dark pixel block, no glow.
    const foodColor = getCss('--food');
    ctx.fillStyle = foodColor;
    const fInset = Math.floor(CELL / 4);
    ctx.fillRect(
      food.x * CELL + fInset,
      food.y * CELL + fInset,
      CELL - fInset * 2,
      CELL - fInset * 2
    );

    // Snake — sharp dark pixel blocks, no rounding, no glow.
    const bodyColor = getCss('--snake');
    const headColor = getCss('--snake-head');
    for (let i = snake.length - 1; i >= 0; i--) {
      const seg = snake[i];
      ctx.fillStyle = i === 0 ? headColor : bodyColor;
      ctx.fillRect(seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2);
    }
  }

  function getCss(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function setDirection(nx, ny) {
    queuedDir = { x: nx, y: ny };
  }

  const DIRS = {
    up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
  };

  function applyDir(name) {
    const d = DIRS[name];
    if (d) setDirection(d[0], d[1]);
  }

  function togglePause() {
    if (state === 'playing') pause();
    else if (state === 'paused') resume();
  }

  document.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') { applyDir('up'); e.preventDefault(); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S') { applyDir('down'); e.preventDefault(); }
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { applyDir('left'); e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { applyDir('right'); e.preventDefault(); }
    else if (k === ' ') { togglePause(); e.preventDefault(); }
    else if (k === 'Enter') {
      if (state === 'over' || state === 'ready') start();
      e.preventDefault();
    }
  });

  actionBtn.addEventListener('click', () => {
    if (state === 'paused') resume();
    else start();
  });

  // Continuous swipe on the canvas: each touchmove past a small threshold
  // (relative to the previous registered point) fires a direction change,
  // so the player can keep their finger down and turn repeatedly without
  // lifting. A no-movement touchend toggles pause.
  let touchStart = null;
  let swipePivot = null;
  let didSwipe = false;
  const SWIPE_STEP = 22;
  const TAP_TOLERANCE = 10;

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
    swipePivot = { x: t.clientX, y: t.clientY };
    didSwipe = false;
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!swipePivot) return;
    const t = e.touches[0];
    const dx = t.clientX - swipePivot.x;
    const dy = t.clientY - swipePivot.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < SWIPE_STEP && ay < SWIPE_STEP) return;

    if (ax > ay) applyDir(dx > 0 ? 'right' : 'left');
    else applyDir(dy > 0 ? 'down' : 'up');

    // Re-anchor the pivot to the current point so the next step is measured
    // from here — the player can curl their finger and keep turning.
    swipePivot = { x: t.clientX, y: t.clientY };
    didSwipe = true;
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    if (!didSwipe && Math.abs(dx) < TAP_TOLERANCE && Math.abs(dy) < TAP_TOLERANCE) {
      togglePause();
    }
    touchStart = null;
    swipePivot = null;
    didSwipe = false;
    e.preventDefault();
  }, { passive: false });

  // Initial draw so the board is visible behind the start overlay.
  reset();
  draw();

  // Hide the inline loading screen once the game is ready and at least
  // 3s have elapsed since the document started loading. This is the
  // "loader for at least 3 seconds" requirement from the gallery side.
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
