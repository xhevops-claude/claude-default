(function () {
  const board = document.getElementById('board');
  const cells = Array.from(board.querySelectorAll('.cell'));
  const status = document.getElementById('status');
  const scoreXEl = document.getElementById('score-x');
  const scoreOEl = document.getElementById('score-o');
  const scoreDEl = document.getElementById('score-d');
  const menu = document.getElementById('menu');
  const menuTitle = document.getElementById('menu-title');
  const menuTagline = document.getElementById('menu-tagline');
  const playBtn = document.getElementById('play-btn');
  const resetBtn = document.getElementById('reset-btn');
  const quitBtn = document.getElementById('quit-btn');

  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  let grid, turn, over, scores;

  function loadScores() {
    try {
      const s = JSON.parse(localStorage.getItem('ttt-scores') || 'null');
      if (s && typeof s === 'object') return s;
    } catch (_) {}
    return { X: 0, O: 0, D: 0 };
  }

  function saveScores() {
    try { localStorage.setItem('ttt-scores', JSON.stringify(scores)); } catch (_) {}
  }

  function renderScores() {
    scoreXEl.textContent = scores.X;
    scoreOEl.textContent = scores.O;
    scoreDEl.textContent = scores.D;
    // Show "RESET SCORES" button only when there's something to reset.
    const hasScores = scores.X || scores.O || scores.D;
    resetBtn.hidden = !hasScores;
  }

  function showMenu(state) {
    if (state === 'ready') {
      menuTitle.innerHTML = 'TIC<br>TAC<br>TOE';
      menuTagline.innerHTML = 'Three in a row.<br>Hot-seat for two.';
      playBtn.textContent = 'PLAY';
    } else if (state === 'over-x') {
      menuTitle.innerHTML = 'X<br>WINS';
      menuTagline.textContent = 'One more?';
      playBtn.textContent = 'PLAY AGAIN';
    } else if (state === 'over-o') {
      menuTitle.innerHTML = 'O<br>WINS';
      menuTagline.textContent = 'One more?';
      playBtn.textContent = 'PLAY AGAIN';
    } else if (state === 'draw') {
      menuTitle.innerHTML = 'DRAW';
      menuTagline.textContent = 'Try again?';
      playBtn.textContent = 'PLAY AGAIN';
    }
    menu.dataset.state = 'ready';
  }

  function hideMenu() {
    menu.dataset.state = 'hidden';
  }

  function newRound() {
    grid = Array(9).fill(null);
    turn = 'X';
    over = false;
    cells.forEach((c) => {
      c.textContent = '';
      c.removeAttribute('data-mark');
      c.classList.remove('win');
      c.disabled = false;
    });
    status.textContent = `${turn} TO PLAY`;
  }

  function checkWinner() {
    for (const line of LINES) {
      const [a, b, c] = line;
      if (grid[a] && grid[a] === grid[b] && grid[a] === grid[c]) {
        return { winner: grid[a], line };
      }
    }
    if (grid.every(Boolean)) return { winner: 'D' };
    return null;
  }

  function play(i) {
    if (over || grid[i]) return;
    grid[i] = turn;
    cells[i].textContent = turn;
    cells[i].setAttribute('data-mark', turn);
    cells[i].disabled = true;

    const result = checkWinner();
    if (result) {
      over = true;
      cells.forEach((c) => { c.disabled = true; });
      if (result.winner === 'D') {
        status.textContent = 'DRAW';
        scores.D += 1;
      } else {
        status.textContent = `${result.winner} WINS`;
        scores[result.winner] += 1;
        result.line.forEach((idx) => cells[idx].classList.add('win'));
      }
      saveScores();
      renderScores();
      // Wait briefly so the player can see the result on the board,
      // then bring the menu back with the appropriate state.
      setTimeout(() => {
        const next = result.winner === 'D' ? 'draw'
          : result.winner === 'X' ? 'over-x' : 'over-o';
        showMenu(next);
      }, 1200);
    } else {
      turn = turn === 'X' ? 'O' : 'X';
      status.textContent = `${turn} TO PLAY`;
    }
  }

  function quit() {
    if (window.self !== window.top) {
      try { window.parent.postMessage({ type: 'close-game' }, '*'); } catch (_) {}
    } else {
      location.href = '../../';
    }
  }

  cells.forEach((c) => {
    c.addEventListener('click', () => play(parseInt(c.dataset.i, 10)));
  });

  playBtn.addEventListener('click', () => {
    newRound();
    hideMenu();
  });

  resetBtn.addEventListener('click', () => {
    scores = { X: 0, O: 0, D: 0 };
    saveScores();
    renderScores();
  });

  quitBtn.addEventListener('click', quit);

  scores = loadScores();
  renderScores();
  newRound();
  showMenu('ready');

  // Hide the inline loading screen once ready and at least 3s have
  // elapsed since the document started loading.
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
