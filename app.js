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

  // Open / close timings.
  const ZOOM_MS = 380;
  const DARKEN_AT = 200;
  const SHOW_LOADER_AT = 380;
  // Loader (icon + name + bar) needs to be visible for at least 500ms.
  const LOADER_MIN_MS = 500;
  const MIN_TOTAL_MS = SHOW_LOADER_AT + LOADER_MIN_MS;
  const CLOSE_FADE_MS = 320;
  const SPLASH_FADE_MS = 350;
  const ZOOM_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

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

  function resetZoom() {
    zoom.style.transition = 'none';
    zoom.style.transform = '';
    zoom.style.transformOrigin = '';
    zoom.style.borderRadius = '';
    zoom.style.opacity = '';
    zoom.classList.remove('darkened', 'show-loader', 'faded-out');
  }

  function openGame(card, game) {
    if (overlay.dataset.state === 'open') return;

    // Pull the tile's theme-driven gradient onto the splash so the zoom-in
    // visually continues the tile's colors before fading to black.
    if (card) {
      const cs = getComputedStyle(card);
      const g1 = cs.getPropertyValue('--g1').trim();
      const g2 = cs.getPropertyValue('--g2').trim();
      if (g1) zoom.style.setProperty('--g1', g1);
      if (g2) zoom.style.setProperty('--g2', g2);
    } else {
      zoom.style.removeProperty('--g1');
      zoom.style.removeProperty('--g2');
    }
    zoomIcon.textContent = game.icon;
    zoomName.textContent = game.name;
    resetZoom();

    // FLIP: place the zoom layer over the tapped tile, then animate to
    // fullscreen. Deep links (no source tile) get a small centered scale.
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
    overlay.style.transition = '';
    void overlay.offsetWidth;

    overlay.dataset.state = 'open';
    void zoom.offsetWidth;

    // Phase 1: zoom expands to fullscreen.
    zoom.style.transition =
      `transform ${ZOOM_MS}ms ${ZOOM_EASING}, ` +
      `border-radius ${ZOOM_MS}ms ${ZOOM_EASING}`;
    zoom.style.transform = 'translate(0, 0) scale(1, 1)';
    zoom.style.borderRadius = '0';

    // Phase 2: gradient fades out, revealing the black splash bg.
    setTimeout(() => zoom.classList.add('darkened'), DARKEN_AT);
    // Phase 3: loader (name + bar) fades in over the black bg.
    setTimeout(() => zoom.classList.add('show-loader'), SHOW_LOADER_AT);

    // Phase 4: load iframe; reveal once loaded AND minimum total elapsed.
    const t0 = Date.now();
    frame.onload = () => {
      const remaining = Math.max(0, MIN_TOTAL_MS - (Date.now() - t0));
      setTimeout(() => zoom.classList.add('faded-out'), remaining);
    };
    frame.src = game.url;

    try { history.pushState({ gameOpen: true }, '', '#' + game.url); } catch (_) {}
  }

  // Close: splash fades back in over the iframe, then the overlay fades
  // out to home.
  function closeGame() {
    if (overlay.dataset.state !== 'open') return;
    overlay.dataset.state = 'closing';

    zoom.classList.remove('faded-out');

    setTimeout(() => {
      overlay.removeAttribute('data-state');
      setTimeout(finalizeClose, CLOSE_FADE_MS + 20);
    }, SPLASH_FADE_MS + 20);
  }

  function finalizeClose() {
    overlay.hidden = true;
    overlay.style.opacity = '';
    overlay.style.transition = '';
    frame.onload = null;
    frame.src = 'about:blank';
    resetZoom();
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
    if (overlay.dataset.state === 'open') {
      closeGame();
      // After history.back() lands on the original deep-link URL, the
      // hash is still there. Wipe it so the URL bar reads home.
      if (location.hash) {
        history.replaceState(null, '', location.pathname + location.search);
      }
    }
  });

  // Allow embedded games to request close (e.g. via their own back button).
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'close-game') {
      if (history.state && history.state.gameOpen) history.back();
      else closeGame();
    }
  });

  render();

  // Deep link: opening /#games/<slug>/ goes straight into the game. We
  // first replace the URL with home so closing returns to / cleanly,
  // then openGame pushes a fresh state for the back button.
  (function deepLink() {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (!hash) return;
    const game = games.find((g) => g.url === hash && !g.comingSoon);
    if (game) {
      history.replaceState(null, '', location.pathname + location.search);
      openGame(null, game);
    }
  })();
})();
