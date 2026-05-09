(function () {
  const games = [
    {
      slug: 'snake',
      name: 'Snake',
      meta: 'Arcade',
      tagline: "Eat the dots. Don't bite yourself.",
      icon: '🐍',
      url: 'games/snake/',
    },
    {
      slug: 'tic-tac-toe',
      name: 'Tic-Tac-Toe',
      meta: 'Classic',
      tagline: 'Three in a row. Hot-seat for two.',
      icon: '#️⃣',
      url: 'games/tic-tac-toe/',
    },
    {
      slug: 'memory',
      name: 'Memory',
      meta: 'Coming soon',
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
  const pageMeta = document.getElementById('page-meta');
  const footMeta = document.getElementById('foot-meta');

  // Match the CSS transitions on .frame-wrap.
  const ZOOM_MS = 550;
  // Card border-radius applied at the small end of the morph.
  const CARD_RADIUS = 0;

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
        <p class="card-meta">${escapeHTML(g.meta)}</p>
      </div>
    `;
  }

  function render() {
    grid.innerHTML = games.map((g) => {
      if (g.comingSoon) {
        return `
          <li class="card locked" data-tile="${escapeHTML(g.slug)}" data-locked="1">
            ${cardInner(g)}
          </li>
        `;
      }
      return `
        <li class="card" data-tile="${escapeHTML(g.slug)}" data-url="${escapeHTML(g.url)}">
          <a href="${escapeHTML(g.url)}">
            ${cardInner(g)}
          </a>
        </li>
      `;
    }).join('');

    const total = games.length;
    const playable = games.filter((g) => !g.comingSoon).length;
    if (pageMeta) pageMeta.textContent = `${playable} / ${total}`;
    if (footMeta) footMeta.textContent = `${total} games`;
  }

  function rectFromCard(card) {
    if (card) {
      const r = card.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
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
      if (g1) skin.style.setProperty('--g1', g1);
    }
    skinIcon.textContent = game.icon;
    skinTitle.textContent = game.name;
    skinTagline.textContent = game.meta || '';
  }

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

    wrap.style.transition = 'none';
    wrap.style.transformOrigin = '0 0';
    wrap.style.transform = transformForRect(rect);
    wrap.style.borderRadius = CARD_RADIUS + 'px';
    wrap.style.pointerEvents = 'none';

    skin.classList.add('visible');
    frame.classList.remove('visible');
    frame.src = game.url;

    void wrap.offsetWidth;

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

    let rect;
    if (lastCard && document.contains(lastCard)) {
      rect = rectFromCard(lastCard);
    } else if (lastCardRect) {
      rect = lastCardRect;
    } else {
      rect = rectFromCard(null);
    }
    lastCardRect = rect;

    if (lastGame) applySkinFromCard(lastCard, lastGame);

    wrap.style.pointerEvents = 'none';
    wrap.style.transition = 'none';
    wrap.style.transformOrigin = '0 0';
    void wrap.offsetWidth;

    nextFrame(() => {
      wrap.style.transition = '';
      wrap.style.transform = transformForRect(rect);
      wrap.style.borderRadius = CARD_RADIUS + 'px';
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

  // Allow embedded games to request close (their Quit button posts this).
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'close-game') {
      if (history.state && history.state.gameOpen) history.back();
      else closeGame();
    }
  });

  render();

  // ---- Section pager (Tools / Apps / Games) ----
  // Native horizontal scroll-snap drives the swipe; this just keeps the
  // dot indicator in sync with the visible slide and persists the last
  // section between visits. Default landing page is Games.
  (function pager() {
    const pagerEl = document.getElementById('pager');
    const dotsEl = document.getElementById('dots');
    if (!pagerEl || !dotsEl) return;

    const PAGE_KEY = 'arcade-section';
    const dots = Array.from(dotsEl.querySelectorAll('.dot'));
    const pages = Array.from(pagerEl.querySelectorAll('.page'));
    const order = pages.map((p) => p.dataset.page);

    function indexOfPage(name) {
      const i = order.indexOf(name);
      return i === -1 ? order.indexOf('games') : i;
    }

    function scrollToPage(name, smooth) {
      const i = indexOfPage(name);
      const left = pages[i].offsetLeft;
      pagerEl.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
    }

    function setActive(name) {
      dots.forEach((d) => {
        if (d.dataset.page === name) d.setAttribute('aria-current', 'page');
        else d.removeAttribute('aria-current');
      });
      try { localStorage.setItem(PAGE_KEY, name); } catch (_) {}
    }

    // Restore last section, fall back to Games. Use auto scroll so the
    // user doesn't see a swipe animation on first paint.
    let initial = 'games';
    try {
      const saved = localStorage.getItem(PAGE_KEY);
      if (saved && order.indexOf(saved) !== -1) initial = saved;
    } catch (_) {}
    requestAnimationFrame(() => {
      scrollToPage(initial, false);
      setActive(initial);
    });

    // Track the visible slide on scroll; pick whichever page's left
    // edge is closest to the current scrollLeft.
    let scrollRaf = 0;
    pagerEl.addEventListener('scroll', () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        const x = pagerEl.scrollLeft;
        let best = 0, bestDist = Infinity;
        for (let i = 0; i < pages.length; i++) {
          const d = Math.abs(pages[i].offsetLeft - x);
          if (d < bestDist) { bestDist = d; best = i; }
        }
        setActive(order[best]);
      });
    }, { passive: true });

    dots.forEach((d) => {
      d.addEventListener('click', () => {
        const name = d.dataset.page;
        scrollToPage(name, true);
        setActive(name);
      });
    });

    // Re-snap on resize so the active slide stays aligned after layout
    // changes (orientation, window resize, etc.).
    let resizeRaf = 0;
    window.addEventListener('resize', () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        const active = dots.find((d) => d.getAttribute('aria-current') === 'page');
        if (active) scrollToPage(active.dataset.page, false);
      });
    });
  })();

  // Deep link: opening /#games/<slug>/ goes straight into the game.
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
