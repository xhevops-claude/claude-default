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
    {
      slug: 'memory',
      name: 'Memory',
      tagline: 'Flip cards. Match the pairs.',
      icon: '🎴',
      gradient: ['#4ade80', '#06b6d4'],
      comingSoon: true,
    },
  ];

  const grid = document.getElementById('grid');
  const overlay = document.getElementById('game-overlay');
  const frame = document.getElementById('game-frame');
  const closeBtn = document.getElementById('game-close');
  const splash = document.getElementById('game-splash');
  const splashIcon = document.getElementById('splash-icon');
  const splashName = document.getElementById('splash-name');

  const SPLASH_MIN_MS = 700;

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function cardInner(g) {
    return `
      <div class="card-art" style="--g1: ${escapeHTML(g.gradient[0])}; --g2: ${escapeHTML(g.gradient[1])};">
        <span class="card-icon" aria-hidden="true">${escapeHTML(g.icon)}</span>
      </div>
      <div class="card-body">
        <h2 class="card-title">${escapeHTML(g.name)}</h2>
        <p class="card-tagline">${escapeHTML(g.tagline)}</p>
      </div>
    `;
  }

  function render() {
    grid.innerHTML = games.map((g) => {
      if (g.comingSoon) {
        return `
          <li class="card locked" data-locked="1">
            <span class="coming-soon">Coming soon</span>
            ${cardInner(g)}
          </li>
        `;
      }
      return `
        <li class="card" data-url="${escapeHTML(g.url)}">
          <a href="${escapeHTML(g.url)}">
            ${cardInner(g)}
          </a>
        </li>
      `;
    }).join('');
  }

  function openGame(game) {
    if (overlay.dataset.state === 'open') return;

    // Configure the splash with this game's identity.
    splash.style.setProperty('--g1', game.gradient[0]);
    splash.style.setProperty('--g2', game.gradient[1]);
    splashIcon.textContent = game.icon;
    splashName.textContent = game.name;
    splash.dataset.state = 'visible';

    const splashStart = Date.now();
    frame.onload = () => {
      const remaining = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashStart));
      setTimeout(() => { splash.dataset.state = 'hide'; }, remaining);
    };

    frame.src = game.url;
    overlay.hidden = false;
    void overlay.offsetWidth;
    overlay.dataset.state = 'open';
    try { history.pushState({ gameOpen: true }, '', '#' + game.url); } catch (_) {}
  }

  function closeGame() {
    if (overlay.dataset.state !== 'open') return;
    overlay.dataset.state = '';
    setTimeout(() => {
      overlay.hidden = true;
      frame.onload = null;
      frame.src = 'about:blank';
      // Reset splash for the next open.
      splash.dataset.state = 'visible';
      // The iframe may have changed the theme; re-sync the gallery.
      try {
        const t = localStorage.getItem('arcade-theme');
        if (t) {
          document.documentElement.dataset.theme = t;
          document.querySelectorAll('.swatch').forEach((s) => {
            s.classList.toggle('active', s.dataset.theme === t);
          });
        }
      } catch (_) {}
    }, 340);
  }

  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;

    if (card.dataset.locked === '1') {
      e.preventDefault();
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
      return;
    }

    const url = card.dataset.url;
    if (!url) return;
    const game = games.find((g) => g.url === url);
    if (!game) return;
    e.preventDefault();
    card.classList.add('tapped');
    setTimeout(() => { card.classList.remove('tapped'); }, 240);
    setTimeout(() => { openGame(game); }, 120);
  });

  closeBtn.addEventListener('click', () => {
    if (history.state && history.state.gameOpen) history.back();
    else closeGame();
  });

  window.addEventListener('popstate', () => {
    if (overlay.dataset.state === 'open') closeGame();
  });

  // Allow embedded games to request close (e.g. via their own back button).
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'close-game') {
      if (history.state && history.state.gameOpen) history.back();
      else closeGame();
    }
  });

  render();

  // Deep link: opening /#games/<slug>/ goes straight into the game.
  (function deepLink() {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (!hash) return;
    const game = games.find((g) => g.url === hash && !g.comingSoon);
    if (game) openGame(game);
  })();
})();
