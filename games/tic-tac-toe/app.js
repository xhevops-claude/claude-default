(function () {
  const board = document.getElementById('board');
  const cells = Array.from(board.querySelectorAll('.cell'));
  const status = document.getElementById('status');
  const scoreXEl = document.getElementById('score-x');
  const scoreOEl = document.getElementById('score-o');
  const scoreDEl = document.getElementById('score-d');
  const resetBtn = document.getElementById('reset-btn');
  const clearBtn = document.getElementById('clear-btn');
  const themeBtn = document.getElementById('theme-btn');

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
    status.textContent = `${turn} to play`;
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
        status.textContent = "It's a draw";
        scores.D += 1;
      } else {
        status.textContent = `${result.winner} wins!`;
        scores[result.winner] += 1;
        result.line.forEach((idx) => cells[idx].classList.add('win'));
      }
      saveScores();
      renderScores();
    } else {
      turn = turn === 'X' ? 'O' : 'X';
      status.textContent = `${turn} to play`;
    }
  }

  cells.forEach((c) => {
    c.addEventListener('click', () => play(parseInt(c.dataset.i, 10)));
  });

  resetBtn.addEventListener('click', newRound);
  clearBtn.addEventListener('click', () => {
    scores = { X: 0, O: 0, D: 0 };
    saveScores();
    renderScores();
    newRound();
  });

  themeBtn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    themeBtn.textContent = next === 'light' ? '🌙' : '☀️';
    try { localStorage.setItem('arcade-theme', next); } catch (_) {}
  });

  let savedTheme = null;
  try { savedTheme = localStorage.getItem('arcade-theme'); } catch (_) {}
  const initial = savedTheme || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = initial;
  themeBtn.textContent = initial === 'light' ? '🌙' : '☀️';

  scores = loadScores();
  renderScores();
  newRound();
})();
