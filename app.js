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
  const zoom = document.getElementById('game-zoom');
  const zoomIcon = document.getElementById('zoom-icon');
  const zoomName = document.getElementById('zoom-name');

  // Splash sequence timings.
  const ZOOM_MS = 420;
  const DARKEN_AT = 180;
  const SHOW_LOADER_AT = 420;
  const MIN_TOTAL_MS = 750;
  const REVEAL_MS = 350;
  const CLOSE_MS = 320;

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

  function resetZoom() {
    zoom.style.transition = 'none';
    zoom.style.transform = '';
    zoom.style.transformOrigin = '';
    zoom.style.borderRadius = '';
    zoom.classList.remove('darkened', 'show-loader', 'reveal');
  }

  function openGame(card, game) {
    if (overlay.dataset.state === 'open') return;

    // Configure zoom layer with this game's gradient and icon.
    zoom.style.setProperty('--g1', game.gradient[0]);
    zoom.style.setProperty('--g2', game.gradient[1]);
    zoomIcon.textContent = game.icon;
    zoomName.textContent = game.name;
    resetZoom();

    // FLIP: position zoom to look like the tapped card, then animate it to
    // fullscreen. If we have no source card (deep link), fall back to a
    // small centered scale-in.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (card) {
      const r = card.getBoundingClientRect();
      zoom.style.transformOrigin = '0 0';
      zoom.style.transform =
        `translate(${r.left}px, ${r.top}px) scale(${r.width / vw}, ${r.height / vh})`;
      zoom.style.borderRadius = '16px';
    } else {
      zoom.style.transformOrigin = 'center';
      zoom.style.transform = 'scale(0.6)';
      zoom.style.borderRadius = '24px';
    }

    overlay.hidden = false;
    overlay.style.opacity = '';
    overlay.dataset.state = 'open';

    // Force layout so the next frame's transition runs from this state.
    void zoom.offsetWidth;

    // Phase 1: zoom expands to fullscreen.
    zoom.style.transition =
      `transform ${ZOOM_MS}ms cubic-bezier(0.16, 1, 0.3, 1), ` +
      `border-radius ${ZOOM_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`;
    zoom.style.transform = 'translate(0, 0) scale(1, 1)';
    zoom.style.borderRadius = '0';

    // Phase 2: gradient cross-fades to dark.
    setTimeout(() => zoom.classList.add('darkened'), DARKEN_AT);
    // Phase 3: name + bar fade in over the dark background.
    setTimeout(() => zoom.classList.add('show-loader'), SHOW_LOADER_AT);

    // Phase 4: load the iframe; reveal once loaded AND minimum elapsed.
    const t0 = Date.now();
    frame.onload = () => {
      const remaining = Math.max(0, MIN_TOTAL_MS - (Date.now() - t0));
      setTimeout(() => zoom.classList.add('reveal'), remaining);
    };
    frame.src = game.url;

    try { history.pushState({ gameOpen: true }, '', '#' + game.url); } catch (_) {}
  }

  function closeGame() {
    if (overlay.dataset.state !== 'open') return;
    overlay.dataset.state = 'closing';

    setTimeout(() => {
      overlay.hidden = true;
      overlay.dataset.state = '';
      frame.onload = null;
      frame.src = 'about:blank';
      resetZoom();
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
    }, CLOSE_MS);
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
    setTimeout(() => { openGame(card, game); }, 90);
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
    if (game) openGame(null, game);
  })();
})();
