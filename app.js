(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const actionBtn = document.getElementById('action-btn');
  const themeBtn = document.getElementById('theme-btn');

  const GRID = 20;
  const CELL = canvas.width / GRID;
  const TICK_START = 130;
  const TICK_MIN = 60;
  const TICK_STEP = 3;

  let snake, dir, queuedDir, food, score, best, tickMs, lastTick, raf;
  let state = 'ready'; // ready | playing | paused | over

  try { best = parseInt(localStorage.getItem('snake-best') || '0', 10) || 0; } catch (_) { best = 0; }
  bestEl.textContent = best;

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
    scoreEl.textContent = score;
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
    setOverlay('paused', 'Paused', 'Take a breath. Press Space or Resume.', 'Resume');
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
      bestEl.textContent = best;
      try { localStorage.setItem('snake-best', String(best)); } catch (_) {}
    }
    setOverlay('over', 'Game Over', `You scored ${score}. Best: ${best}.`, 'Play again');
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
      scoreEl.textContent = score;
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

    // Food (pulsing glow).
    const t = performance.now() / 400;
    const pulse = 0.6 + Math.sin(t) * 0.2;
    const foodColor = getCss('--food');
    ctx.save();
    ctx.shadowColor = foodColor;
    ctx.shadowBlur = 18 * pulse;
    ctx.fillStyle = foodColor;
    drawRoundRect(food.x * CELL + 4, food.y * CELL + 4, CELL - 8, CELL - 8, 6);
    ctx.fill();
    ctx.restore();

    // Snake.
    const bodyColor = getCss('--snake');
    const headColor = getCss('--snake-head');
    for (let i = snake.length - 1; i >= 0; i--) {
      const seg = snake[i];
      ctx.fillStyle = i === 0 ? headColor : bodyColor;
      ctx.save();
      if (i === 0) {
        ctx.shadowColor = headColor;
        ctx.shadowBlur = 14;
      }
      drawRoundRect(seg.x * CELL + 2, seg.y * CELL + 2, CELL - 4, CELL - 4, 6);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawRoundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
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

  // On-screen D-pad (touch + click).
  document.querySelectorAll('.dpad-btn[data-dir]').forEach((btn) => {
    const dir = btn.dataset.dir;
    const handler = (e) => { applyDir(dir); e.preventDefault(); };
    btn.addEventListener('click', handler);
    btn.addEventListener('touchstart', handler, { passive: false });
  });

  const pauseBtn = document.getElementById('pause-btn');
  pauseBtn.addEventListener('click', (e) => { togglePause(); e.preventDefault(); });

  // Swipe + tap on the canvas.
  let touchStart = null;
  const SWIPE_MIN = 24;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    touchStart = null;
    if (ax < SWIPE_MIN && ay < SWIPE_MIN) {
      togglePause();
    } else if (ax > ay) {
      applyDir(dx > 0 ? 'right' : 'left');
    } else {
      applyDir(dy > 0 ? 'down' : 'up');
    }
    e.preventDefault();
  }, { passive: false });

  themeBtn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    themeBtn.textContent = next === 'light' ? '🌙' : '☀️';
    try { localStorage.setItem('snake-theme', next); } catch (_) {}
    if (state !== 'playing') draw();
  });

  let savedTheme = null;
  try { savedTheme = localStorage.getItem('snake-theme'); } catch (_) {}
  const initial = savedTheme || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = initial;
  themeBtn.textContent = initial === 'light' ? '🌙' : '☀️';

  // Initial draw so the board is visible behind the start overlay.
  reset();
  draw();
})();
