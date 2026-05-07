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
  const skin = document.getElementById('frame-skin');
  const skinIcon = document.getElementById('skin-icon');
  const skinTitle = document.getElementById('skin-title');
  const skinTagline = document.getElementById('skin-tagline');

  // Match the CSS transitions on .frame-wrap.
  const ZOOM_MS = 550;
  // Card border-radius applied at the small end of the morph.
  const CARD_RADIUS = 16;

  // Tracks the tile that launched the current overlay so we can shrink
  // the iframe wrapper back into it on close.
  let lastCard = null;
  let lastCardRect = null;
  let lastGame = null;

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

  function rectFromCard(card) {
    if (card) {
      const r = card.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    // Deep-link fallback: a card-shaped rect at the viewport center.
    const w = Math.min(180, window.innerWidth - 32);
    const h = w * 1.3;
    return {
      left: (window.innerWidth - w) / 2,
      top: (window.innerHeight - h) / 2,
      width: w,
      height: h,
    };
  }

  function transformForRect(rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return `translate(${rect.left}px, ${rect.top}px)`
         + ` scale(${rect.width / vw}, ${rect.height / vh})`;
  }

  function applySkinFromCard(card, game) {
    if (card) {
      const cs = getComputedStyle(card);
      const g1 = cs.getPropertyValue('--g1').trim();
      const g2 = cs.getPropertyValue('--g2').trim();
      if (g1) skin.style.setProperty('--g1', g1);
      if (g2) skin.style.setProperty('--g2', g2);
    }
    skinIcon.textContent = game.icon;
    skinTitle.textContent = game.name;
    skinTagline.textContent = game.tagline;
  }

  // Double-rAF guarantees the browser commits the "before" state to the
  // compositor before we set the "after" state, so the transition runs.
  function nextFrame(fn) {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  function openGame(card, game) {
    if (overlay.dataset.state) return;

    const rect = rectFromCard(card);
    lastCard = card || null;
    lastCardRect = rect;
    lastGame = game;

    applySkinFromCard(card, game);

    overlay.hidden = false;
    overlay.dataset.state = 'open';

    // Place the wrap at the card's rect with card-shaped border-radius,
    // skin visible (looks like the card), iframe hidden.
    wrap.style.transition = 'none';
    wrap.style.transformOrigin = '0 0';
    wrap.style.transform = transformForRect(rect);
    wrap.style.borderRadius = CARD_RADIUS + 'px';
    wrap.style.pointerEvents = 'none';

    skin.classList.add('visible');
    frame.classList.remove('visible');
    frame.src = game.url;

    void wrap.offsetWidth;

    // Animate: wrap grows over 550ms, skin/iframe crossfade over 220ms
    // (faster than the size animation, so the user sees the card design
    // briefly then the iframe takes over while the wrap is still mid-grow).
    nextFrame(() => {
      wrap.style.transition = '';
      wrap.style.transform = 'translate(0, 0) scale(1, 1)';
      wrap.style.borderRadius = '0';
      skin.classList.remove('visible');
      frame.classList.add('visible');
    });

    setTimeout(() => { wrap.style.pointerEvents = ''; }, ZOOM_MS + 40);

    try { history.pushState({ gameOpen: true }, '', '#' + game.url); } catch (_) {}
  }

  function closeGame() {
    if (overlay.dataset.state !== 'open') return;
    overlay.dataset.state = 'shrinking';

    // Recompute destination rect from the live card (gallery may have
    // scrolled while the game was open).
    let rect;
    if (lastCard && document.contains(lastCard)) {
      rect = rectFromCard(lastCard);
    } else if (lastCardRect) {
      rect = lastCardRect;
    } else {
      rect = rectFromCard(null);
    }
    lastCardRect = rect;

    // Make sure the skin still has the right gradient / icon (in case
    // the user navigated back via popstate before openGame configured it).
    if (lastGame) applySkinFromCard(lastCard, lastGame);

    wrap.style.pointerEvents = 'none';
    wrap.style.transition = 'none';
    wrap.style.transformOrigin = '0 0';
    void wrap.offsetWidth;

    nextFrame(() => {
      wrap.style.transition = '';
      wrap.style.transform = transformForRect(rect);
      wrap.style.borderRadius = CARD_RADIUS + 'px';
      // Crossfade — skin fades in faster than the wrap resizes, so by
      // the time the wrap is at card size the content already reads as
      // the card.
      skin.classList.add('visible');
      frame.classList.remove('visible');
    });

    setTimeout(finalizeClose, ZOOM_MS + 40);
  }

  function finalizeClose() {
    overlay.hidden = true;
    overlay.removeAttribute('data-state');
    frame.onload = null;
    frame.src = 'about:blank';
    frame.classList.remove('visible');
    skin.classList.remove('visible');
    wrap.style.transition = 'none';
    wrap.style.transform = '';
    wrap.style.transformOrigin = '';
    wrap.style.borderRadius = '';
    wrap.style.pointerEvents = '';
    lastCard = null;
    lastCardRect = null;
    lastGame = null;
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
