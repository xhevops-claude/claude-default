(function () {
  const games = [
    {
      slug: 'snake',
      name: 'Snake',
      tagline: "Eat the glowing dots. Don't bite yourself.",
      icon: '🐍',
      gradient: ['#21d4fd', '#7c5cff'],
      tags: ['arcade', 'classic', 'solo'],
      url: 'games/snake/',
    },
  ];

  const grid = document.getElementById('grid');
  const search = document.getElementById('search');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');
  const themeBtn = document.getElementById('theme-btn');

  function escapeHTML(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function highlight(text, query) {
    const safe = escapeHTML(text);
    if (!query) return safe;
    const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(q, 'gi'), (m) => `<mark>${m}</mark>`);
  }

  function render(query) {
    const q = query.trim().toLowerCase();
    const matches = games.filter((g) => {
      if (!q) return true;
      const haystack = [g.name, g.tagline, ...(g.tags || [])].join(' ').toLowerCase();
      return haystack.includes(q);
    });

    grid.innerHTML = matches.map((g) => `
      <li class="card" data-slug="${g.slug}">
        <a href="${g.url}">
          <div class="card-art" style="--g1: ${g.gradient[0]}; --g2: ${g.gradient[1]};">
            <span aria-hidden="true">${g.icon}</span>
          </div>
          <div class="card-body">
            <h2 class="card-title">${highlight(g.name, q)}</h2>
            <p class="card-tagline">${highlight(g.tagline, q)}</p>
            <ul class="tags">
              ${(g.tags || []).map((t) => `<li>${highlight(t, q)}</li>`).join('')}
            </ul>
          </div>
        </a>
      </li>
    `).join('');

    empty.hidden = matches.length !== 0;
    count.textContent = q ? `${matches.length} of ${games.length}` : `${games.length} game${games.length === 1 ? '' : 's'}`;
  }

  search.addEventListener('input', (e) => render(e.target.value));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; render(''); }
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

  render('');
})();
