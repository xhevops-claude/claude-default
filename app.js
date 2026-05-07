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
  const wrap = document.getElementById('frame-wrap');
  const frame = document.getElementById('game-frame');
  const closeBtn = document.getElementById('game-close');

  // Match the CSS transition on .frame-wrap.
  const ZOOM_MS = 550;
  const OVERLAY_FADE_MS = 300;
  // Microscopic starting / ending scale.
  const SMALL_SCALE = 0.04;

  // Tracks the tile that launched the current overlay so we can shrink
  // the iframe back into it on close.
  let lastCard = null;
  let lastOriginX = null;
  let lastOriginY = null;

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

  function originFromCard(card) {
    if (card) {
      const r = card.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    }
    return [window.innerWidth / 2, window.innerHeight / 2];
  }

  // Double-rAF guarantees the browser commits the "before" state to the
  // compositor before we set the "after" state, so the transition runs.
  // A single rAF or `void offsetWidth` is sometimes not enough on Safari.
  function nextFrame(fn) {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  function openGame(card, game) {
    if (overlay.dataset.state) return;

    const [originX, originY] = originFromCard(card);
    lastCard = card || null;
    lastOriginX = originX;
    lastOriginY = originY;

    // Reveal the overlay (it's already opaque thanks to CSS opacity:1)
    // and put the wrapper at its starting microscopic state without
    // animating.
    overlay.hidden = false;
    overlay.dataset.state = 'open';

    wrap.style.transition = 'none';
    wrap.style.transformOrigin = `${originX}px ${originY}px`;
    wrap.style.transform = `scale(${SMALL_SCALE})`;
    wrap.style.pointerEvents = 'none';
    frame.src = game.url;

    // Force layout commit, then wait two frames so the browser actually
    // paints the starting transform before we change to scale(1).
    void wrap.offsetWidth;
    nextFrame(() => {
      wrap.style.transition = '';
      wrap.style.transform = 'scale(1)';
    });

    setTimeout(() => { wrap.style.pointerEvents = ''; }, ZOOM_MS + 40);

    try { history.pushState({ gameOpen: true }, '', '#' + game.url); } catch (_) {}
  }

  // Close: shrink the iframe back to a microscopic dot at the tile's
  // center, then fade the overlay out.
  function closeGame() {
    if (overlay.dataset.state !== 'open') return;
    overlay.dataset.state = 'shrinking';

    // Recompute the destination from the live card if it's still in the
    // DOM (the gallery may have scrolled while the game was open).
    let ox, oy;
    if (lastCard && document.contains(lastCard)) {
      const r = lastCard.getBoundingClientRect();
      ox = r.left + r.width / 2;
      oy = r.top + r.height / 2;
    } else if (lastOriginX != null && lastOriginY != null) {
      ox = lastOriginX;
      oy = lastOriginY;
    } else {
      ox = window.innerWidth / 2;
      oy = window.innerHeight / 2;
    }

    wrap.style.pointerEvents = 'none';
    wrap.style.transition = 'none';
    wrap.style.transformOrigin = `${ox}px ${oy}px`;
    void wrap.offsetWidth;

    nextFrame(() => {
      wrap.style.transition = '';
      wrap.style.transform = `scale(${SMALL_SCALE})`;
    });

    // After the shrink finishes, fade the overlay out and finalize.
    setTimeout(() => {
      overlay.dataset.state = 'closing';
      setTimeout(finalizeClose, OVERLAY_FADE_MS + 20);
    }, ZOOM_MS + 40);
  }

  function finalizeClose() {
    overlay.hidden = true;
    overlay.removeAttribute('data-state');
    frame.onload = null;
    frame.src = 'about:blank';
    wrap.style.transition = 'none';
    wrap.style.transform = '';
    wrap.style.transformOrigin = '';
    wrap.style.pointerEvents = '';
    lastCard = null;
    lastOriginX = null;
    lastOriginY = null;
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
