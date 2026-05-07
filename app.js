(function () {
  const games = [
    {
      slug: 'snake',
      name: 'Snake',
      tagline: "Eat the dots. Don't bite yourself.",
      icon: '🐍',
      gradient: ['#21d4fd', '#7c5cff'],
      url: 'games/snake/',
    },
    {
      slug: 'tic-tac-toe',
      name: 'Tic-Tac-Toe',
      tagline: 'Three in a row. Hot-seat for two.',
      icon: '#️⃣',
      gradient: ['#ff7ad9', '#7c5cff'],
      url: 'games/tic-tac-toe/',
    },
  ];

  const grid = document.getElementById('grid');
  const themeBtn = document.getElementById('theme-btn');

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function render() {
    grid.innerHTML = games.map((g) => `
      <li class="card">
        <a href="${escapeHTML(g.url)}">
          <div class="card-art" style="--g1: ${escapeHTML(g.gradient[0])}; --g2: ${escapeHTML(g.gradient[1])};">
            <span class="card-icon" aria-hidden="true">${escapeHTML(g.icon)}</span>
          </div>
          <div class="card-body">
            <h2 class="card-title">${escapeHTML(g.name)}</h2>
            <p class="card-tagline">${escapeHTML(g.tagline)}</p>
          </div>
        </a>
      </li>
    `).join('');
  }

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

  render();
})();
