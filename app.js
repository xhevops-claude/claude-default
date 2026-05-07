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

  // Splash visible for at least 3s so the loading bar reads cleanly.
  const MIN_SPLASH_MS = 3000;
  const SPLASH_FADE_MS = 350;
  const CLOSE_FADE_MS = 320;
  // Initial scale of the splash — small enough to read as a "dot" at the
  // tile's center, large enough that the icon doesn't snap on the first
  // frame.
  const START_SCALE = 0.04;

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

  function openGame(card, game) {
    if (overlay.dataset.state === 'open') return;

    zoomIcon.textContent = game.icon;

    // Compute the splash's grow-from origin: the tapped tile's center,
    // or the viewport center as a fallback (deep links).
    let originX, originY;
    if (card) {
      const r = card.getBoundingClientRect();
      originX = r.left + r.width / 2;
      originY = r.top + r.height / 2;
    } else {
      originX = window.innerWidth / 2;
      originY = window.innerHeight / 2;
    }

    // Hide the iframe behind the splash. While the splash is still small,
    // the iframe would otherwise show through the rest of the overlay area,
    // briefly flashing the game (or the previous game's residue) before
    // the splash grows to cover everything.
    frame.style.transition = 'none';
    frame.style.opacity = '0';

    // Snap the splash to its starting "microscopic" state without animating.
    zoom.style.transition = 'none';
    zoom.style.transformOrigin = `${originX}px ${originY}px`;
    zoom.style.transform = `scale(${START_SCALE})`;
    zoom.classList.remove('faded-out');

    overlay.hidden = false;
    overlay.style.opacity = '';
    overlay.style.transition = '';

    // Force a layout pass so the starting transform is committed before we
    // re-enable transitions.
    void zoom.offsetWidth;

    // Now run the actual zoom: overlay fades in (CSS), splash scales up to
    // 1 (CSS transition on .game-zoom).
    zoom.style.transition = '';
    overlay.dataset.state = 'open';
    zoom.style.transform = 'scale(1)';

    // Load iframe; reveal once loaded AND the minimum splash time elapsed.
    const t0 = Date.now();
    frame.onload = () => {
      const remaining = Math.max(0, MIN_SPLASH_MS - (Date.now() - t0));
      setTimeout(() => {
        // Reveal the iframe just before the splash starts fading out, so
        // it cross-fades cleanly without ever flashing through the splash.
        frame.style.transition = 'opacity 0.2s ease';
        frame.style.opacity = '1';
        zoom.classList.add('faded-out');
      }, remaining);
    };
    frame.src = game.url;

    try { history.pushState({ gameOpen: true }, '', '#' + game.url); } catch (_) {}
  }

  // Close: splash fades in over the iframe, then overlay fades out to home.
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
    frame.style.opacity = '';
    frame.style.transition = '';
    // Reset splash for the next open without animating.
    zoom.style.transition = 'none';
    zoom.style.transform = '';
    zoom.style.transformOrigin = '';
    zoom.classList.remove('faded-out');
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
  // wipe the hash first so the back stack lands on home cleanly.
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
