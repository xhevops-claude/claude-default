(function () {
  const games = [
    {
      slug: 'snake',
      name: 'Snake',
      tagline: "Eat the dots. Don't bite yourself.",
      icon: '🐍',
      url: 'games/snake/',
    },
    {
      slug: 'tic-tac-toe',
      name: 'Tic-Tac-Toe',
      tagline: 'Three in a row. Hot-seat for two.',
      icon: '#️⃣',
      url: 'games/tic-tac-toe/',
    },
    {
      slug: 'memory',
      name: 'Memory',
      tagline: 'Flip cards. Match the pairs.',
      icon: '🎴',
      comingSoon: true,
    },
  ];

  const grid = document.getElementById('grid');
  const overlay = document.getElementById('game-overlay');
  const frame = document.getElementById('game-frame');
  const closeBtn = document.getElementById('game-close');
  const zoom = document.getElementById('game-zoom');
  const zoomIcon = document.getElementById('zoom-icon');
  const zoomName = document.getElementById('zoom-name');

  // Splash timings — must stay in step with .game-overlay / .game-zoom
  // transitions in styles.css (320ms and 350ms respectively).
  const OVERLAY_FADE_MS = 320;
  const SPLASH_FADE_MS = 350;
  const MIN_SPLASH_VISIBLE_MS = 700;

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function cardInner(g) {
    return `
      <div class="card-art">
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

  // Open: overlay fades IN with the splash already opaque, iframe loads
  // behind, then the splash fades OUT to reveal the game.
  function openGame(game) {
    if (overlay.dataset.state === 'open') return;

    zoomIcon.textContent = game.icon;
    zoomName.textContent = game.name;
    zoom.classList.remove('faded-out');

    overlay.hidden = false;
    overlay.style.opacity = '';
    overlay.style.transition = '';
    void overlay.offsetWidth;

    overlay.dataset.state = 'open';

    const t0 = Date.now();
    frame.onload = () => {
      const remaining = Math.max(0, MIN_SPLASH_VISIBLE_MS - (Date.now() - t0));
      setTimeout(() => { zoom.classList.add('faded-out'); }, remaining);
    };
    frame.src = game.url;

    try { history.pushState({ gameOpen: true }, '', '#' + game.url); } catch (_) {}
  }

  // Close: splash fades IN over the iframe, then overlay fades OUT to
  // reveal the home menu.
  function closeGame() {
    if (overlay.dataset.state !== 'open') return;
    overlay.dataset.state = 'closing';

    // Phase 1: bring the splash back over the iframe.
    zoom.classList.remove('faded-out');

    // Phase 2: once the splash covers the iframe, fade the whole overlay out.
    setTimeout(() => {
      overlay.removeAttribute('data-state');
      setTimeout(finalizeClose, OVERLAY_FADE_MS + 20);
    }, SPLASH_FADE_MS + 20);
  }

  function finalizeClose() {
    overlay.hidden = true;
    overlay.style.opacity = '';
    overlay.style.transition = '';
    frame.onload = null;
    frame.src = 'about:blank';
    zoom.classList.remove('faded-out');
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
    setTimeout(() => { openGame(game); }, 90);
  });

  closeBtn.addEventListener('click', () => {
    if (history.state && history.state.gameOpen) {
      history.back();
    } else {
      closeGame();
      if (location.hash) {
        history.replaceState(null, '', location.pathname + location.search);
      }
    }
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
